import type { Llm } from '../llm/llm.ts'
import { baseDomain, hostOf } from '../sources/net.ts'
import type { Fetcher } from '../sources/fetcher.ts'
import type { SearchStack } from '../sources/search.ts'
import type { Social } from '../sources/social.ts'
import { columnsOf, customKey, isCustom, PRICING_SLOTS, type Cell, type Intent, type Lang, type Row, type RunEvent, type RunResult, type RunStats } from '../types.ts'
import { candidateUrls, collect, collectField, countKinds, FIELD_PAGES, fetchSiteDoc, INFO_SEARCH, pricingQuery, type Bundle, type CollectDeps, type Doc } from './collect.ts'
import { CORE_SLOT, extractFacts, FACT_FIELDS, filledSlots, isPricingSlot, judge, nameCell, newsCell, pricingCell, slotKey, socialCell, toSources, verifyFact, type Checked, type FactField } from './facts.ts'
import { colLabel, NO_INFO, REASON, SITE_METHOD_LABEL, T } from './i18n.ts'

/** Fact keys checked for a requested field: the pricing template expands into its slots. */
const factKeys = (fields: FactField[]) => fields.flatMap((f) => (f === 'pricing' ? PRICING_SLOTS.map(slotKey) : [f]))

export interface RunDeps {
  llm: Llm
  search: SearchStack
  fetcher: Fetcher
  social: Social
  lang: Lang
  maxRequery: number
  emit: (e: RunEvent) => void
}

/** Runs steps 2–5 for a confirmed intent and returns the table. */
export async function runResearch(runId: string, intent: Intent, deps: RunDeps): Promise<RunResult> {
  const { lang, emit } = deps
  const t = T[lang]
  const dims = intent.dimensions
  const custom = intent.fields ?? []
  const cols = columnsOf(intent)
  const fields: FactField[] = [...FACT_FIELDS.filter((f) => dims.includes(f)), ...custom.map(customKey)]
  const stats: RunStats = { sources: 0, checked: 0, requeried: 0, passed: 0, dropped: 0 }
  const cdeps: CollectDeps = { fetcher: deps.fetcher, search: deps.search, social: deps.social, llm: deps.llm, topic: intent.topic, focus: intent.fields, lang, onStep: (text) => emit({ stage: 2, kind: 'info', text }) }
  emit({ stage: 2, kind: 'info', text: t.start(intent.competitors.length) })

  // ---- step 2: collect, two competitors at a time
  const bundles: (Bundle | null)[] = new Array(intent.competitors.length).fill(null)
  let next = 0
  await Promise.all(
    [0, 1].map(async () => {
      while (next < intent.competitors.length) {
        const i = next++
        const name = intent.competitors[i]
        try {
          const b = await collect(cdeps, name, dims, intent.timeRange, custom, intent.sites?.[name])
          bundles[i] = b
          const k = countKinds(b)
          stats.sources += b.docs.length + b.accounts.length
          emit({ stage: 2, kind: b.home ? 'ok' : 'info', text: b.home ? t.siteFound(name, b.domain, b.siteMethod ? SITE_METHOD_LABEL[lang][b.siteMethod] : '') : t.siteMissing(name) })
          emit({ stage: 2, kind: 'ok', text: t.fetched(name, b.docs.length + b.accounts.length, t.parts(k.site, k.seo, k.news, k.social, k.web)), stats: { sources: stats.sources } })
        } catch {
          emit({ stage: 2, kind: 'fail', text: t.failedCompetitor(name) })
        }
      }
    }),
  )

  // ---- step 3: extract + verify
  const checkedBy: Checked[][] = []
  const total = bundles.filter(Boolean).length * cols.length
  emit({ stage: 3, kind: 'info', text: t.checking(total) })
  let bad = 0
  for (let i = 0; i < bundles.length; i++) {
    const b = bundles[i]
    if (!b) {
      checkedBy[i] = []
      continue
    }
    let facts: Awaited<ReturnType<typeof extractFacts>> = {}
    if (fields.length) emit({ stage: 3, kind: 'info', text: t.extracting(b.name, fields.length) })
    try {
      facts = await extractFacts(deps.llm, lang, b.name, fields, b.docs, intent.topic)
    } catch {
      facts = {}
    }
    checkedBy[i] = factKeys(fields).map((f) => verifyFact(f, facts[f], b.docs))
    // a missing optional pricing slot is not a failure: the cell says "no public information" for it
    bad += checkedBy[i].filter((c) => !c.ok && (!isPricingSlot(c.field) || c.field === CORE_SLOT)).length
  }
  stats.checked = total
  emit({ stage: 3, kind: bad ? 'info' : 'ok', text: t.checkedOk(total - bad, bad), stats: { checked: total } })

  // ---- step 4: self-check, then re-query what failed
  for (let i = 0; i < bundles.length; i++) {
    const b = bundles[i]
    if (!b || !checkedBy[i].length) continue
    try {
      const verdicts = await judge(deps.llm, lang, b.name, checkedBy[i])
      for (const c of checkedBy[i]) {
        const v = verdicts[c.field]
        if (c.ok && v && !v.ok) {
          c.ok = false
          c.reason = v.reason as Checked['reason']
        }
      }
    } catch {
      /* judge unavailable: keep verification result */
    }
    for (const c of [...checkedBy[i]]) {
      if (c.ok) continue
      // optional template slots are filled when the plans slot is re-queried, never re-queried on their own
      if (isPricingSlot(c.field) && c.field !== CORE_SLOT) continue
      const fixed = await requery(deps, cdeps, b, c, intent.topic, checkedBy[i])
      if (fixed) {
        checkedBy[i][checkedBy[i].indexOf(c)] = fixed
        stats.requeried++
        emit({ stage: 4, kind: 'ok', text: t.passedAfter, stats: { requeried: stats.requeried } })
      } else {
        emit({ stage: 4, kind: 'fail', text: t.stillFailed })
      }
    }
  }

  // ---- step 5: organise rows (news + social summarised here)
  const rows: Row[] = []
  for (let i = 0; i < intent.competitors.length; i++) {
    const b = bundles[i]
    const name = intent.competitors[i]
    const cells: Row['cells'] = {}
    if (b && (dims.includes('news') || dims.includes('social'))) emit({ stage: 5, kind: 'info', text: t.summarising(b.name) })
    for (const d of cols) cells[d] = b ? await buildCell(deps, b, d, checkedBy[i]) : missing(lang, d === 'name' ? name : undefined)
    rows.push({ competitor: b?.name ?? name, domain: b?.domain ?? '', ...(b?.siteMethod ? { siteMethod: b.siteMethod } : {}), cells })
  }
  stats.dropped = rows.reduce((n, r) => n + Object.values(r.cells).filter((c) => c?.status === 'missing').length, 0)
  stats.passed = stats.checked - stats.dropped
  if (dims.includes('pricing')) {
    const withBundle = checkedBy.filter((c, i) => bundles[i] && c.length)
    stats.pricingSlots = { filled: withBundle.reduce((n, c) => n + filledSlots(c), 0), total: withBundle.length * PRICING_SLOTS.length }
    stats.pricingThirdParty = rows.filter((r) => r.cells.pricing?.thirdParty).length
  }
  emit({ stage: 4, kind: 'ok', text: t.selfDone(stats.passed), stats: { passed: stats.passed, dropped: stats.dropped } })
  emit({ stage: 5, kind: 'ok', text: t.organised(cols.length, dims.includes('social')) })

  return { runId, intent, rows, stats, finishedAt: new Date().toISOString() }
}

function missing(lang: Lang, value?: string): Cell {
  return value
    ? { value, sources: [], status: 'verified' }
    : { value: NO_INFO[lang], sources: [], status: 'missing' }
}

async function buildCell(deps: RunDeps, b: Bundle, d: string, checked: Checked[]): Promise<Cell> {
  const { lang, llm } = deps
  if (d === 'name') return nameCell(lang, b)
  if (d === 'news') {
    try {
      return await newsCell(llm, lang, b)
    } catch {
      return { value: T[lang].noNews, sources: [], status: 'missing' }
    }
  }
  if (d === 'social') {
    try {
      return await socialCell(llm, lang, b)
    } catch {
      return missing(lang)
    }
  }
  if (d === 'pricing') return pricingCell(lang, checked, clip) ?? missing(lang)
  const c = checked.find((x) => x.field === d)
  if (!c || !c.ok || !c.fact) return missing(lang)
  const max = isCustom(d) ? (lang === 'zh' ? 160 : 320) : lang === 'zh' ? 90 : 200
  return { value: clip(String(c.fact.value), max), sources: toSources(lang, c.valid), status: c.requeried ? 'requeried' : 'verified' }
}

/** Keep table cells short: cut at a sentence or list break when the model writes too much. */
function clip(v: string, max: number): string {
  const s = v.replace(/\s+/g, ' ').trim()
  if (s.length <= max) return s
  const cut = s.slice(0, max)
  const at = Math.max(cut.lastIndexOf('。'), cut.lastIndexOf('；'), cut.lastIndexOf('; '), cut.lastIndexOf('. '), cut.lastIndexOf('，'), cut.lastIndexOf(', '))
  return (at > max * 0.5 ? cut.slice(0, at) : cut).replace(/[，,;；\s]+$/, '') + '…'
}

/** Re-query one failing field: fetch more official pages, search with sharper keywords, extract again, check again. */
async function requery(deps: RunDeps, cdeps: CollectDeps, b: Bundle, failed: Checked, topic?: string, siblings: Checked[] = []): Promise<Checked | null> {
  const { lang, emit } = deps
  const t = T[lang]
  emit({ stage: 4, kind: 'retry', text: t.retry(b.name, colLabel(lang, failed.field), REASON[lang][failed.reason ?? 'not_found']) })
  // custom fields, size and funding are re-searched across the web; the others re-read the official site
  const custom = isCustom(failed.field) || failed.field === 'size' || failed.field === 'funding'
  // the pricing template is re-extracted as a whole; its other slots are filled from the same pass
  const pricing = isPricingSlot(failed.field)
  const field = pricing ? 'pricing' : failed.field
  for (let attempt = 0; attempt < deps.maxRequery; attempt++) {
    const fresh: Doc[] = []
    if (attempt === 0 && b.home && !custom) {
      emit({ stage: 4, kind: 'info', text: t.requery(t.reFetch(b.domain)) })
      const urls = candidateUrls(b, FIELD_PAGES[field as keyof typeof FIELD_PAGES] ?? [], true).slice(0, 4)
      for (const u of urls) {
        const doc = await fetchSiteDoc(cdeps, b, u)
        if (doc) fresh.push(doc)
      }
    } else if (custom) {
      // custom field: search again with different wording and read more pages
      emit({ stage: 4, kind: 'info', text: t.requery(t.reSearch) })
      const label = failed.field === 'size' || failed.field === 'funding' ? INFO_SEARCH[failed.field][lang] : colLabel(lang, failed.field)
      const extra = attempt === 0 ? label : `${label} ${lang === 'zh' ? '官方 最新' : 'official latest'}`
      fresh.push(...(await collectField(cdeps, b, extra, 3)))
    } else {
      emit({ stage: 4, kind: 'info', text: t.requery(t.reSearch) })
      const kw: Record<string, string> = { overview: 'about company', pricing: 'pricing plans', features: 'features', region: 'headquarters', contact: 'contact' }
      const kwZh: Record<string, string> = { overview: '公司介绍 关于我们', pricing: '定价 套餐', features: '功能', region: '总部', contact: '联系方式' }
      const q = field === 'pricing' ? `${pricingQuery(b.name, lang)}${b.domain ? ` site:${b.domain}` : ''}` : `${b.name} ${lang === 'zh' ? kwZh[field] : kw[field]}${b.domain ? ` site:${b.domain}` : ''}`
      const hits = await cdeps.search.web(q, { lang, num: 5 })
      // "site:" is not honoured by every search engine: only pages on the official domain count as official, the rest are third-party
      const base = b.domain ? baseDomain(b.domain) : ''
      for (const h of hits.slice(0, 3)) {
        const host = hostOf(h.url)
        const doc = await fetchSiteDoc(cdeps, b, h.url, base && host && baseDomain(host) === base ? 'site' : 'web')
        if (doc) {
          if (doc.kind === 'web' && !doc.date && h.date) doc.date = h.date.slice(0, 10)
          fresh.push(doc)
        }
      }
    }
    // re-extract from official pages (old + new), not from the snippets that misled us
    const pool = b.docs.filter((d) => d.kind === 'site' || (custom && (d.kind === 'web' || d.kind === 'seo')) || (pricing && d.kind === 'web'))
    if (!pool.length && !fresh.length) continue
    let facts: Awaited<ReturnType<typeof extractFacts>>
    try {
      facts = await extractFacts(deps.llm, lang, b.name, [field], [...fresh, ...pool.filter((d) => !fresh.includes(d))], topic)
    } catch {
      continue
    }
    const again = verifyFact(failed.field, facts[failed.field], b.docs)
    if (!again.ok) continue
    if (pricing) {
      for (let k = 0; k < siblings.length; k++) {
        const sib = siblings[k]
        if (sib.ok || !isPricingSlot(sib.field) || sib.field === failed.field) continue
        const v = verifyFact(sib.field, facts[sib.field], b.docs)
        if (v.ok) siblings[k] = Object.assign(v, { requeried: true })
      }
    }
    try {
      const v = (await judge(deps.llm, lang, b.name, [again]))[failed.field]
      if (v && !v.ok) continue
    } catch {
      /* keep the verified result */
    }
    return Object.assign(again, { requeried: true })
  }
  return null
}
