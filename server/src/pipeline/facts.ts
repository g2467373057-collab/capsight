import { UNTRUSTED_NOTE, type Llm } from '../llm/llm.ts'
import { normalizeForMatch } from '../sources/html.ts'
import { hostOf } from '../sources/net.ts'
import { CUSTOM_PREFIX, PRICING_SLOTS, type Cell, type CellItem, type Lang, type PricingSlot, type Source } from '../types.ts'
import { freshEnough, type Bundle, type Doc } from './collect.ts'
import { NO_INFO, PLATFORM_LABEL, SLOT_LABEL, T } from './i18n.ts'

export type BuiltinFact = 'overview' | 'region' | 'features' | 'pricing' | 'contact'
export const FACT_FIELDS: BuiltinFact[] = ['overview', 'region', 'features', 'pricing', 'contact']

/** Internal fact keys of the pricing template: `pricing.plans`, `pricing.unit` … */
export const slotKey = (s: PricingSlot) => `pricing.${s}`
export const isPricingSlot = (f: string) => f.startsWith('pricing.')
/** The plans-and-prices slot carries the pricing cell; the others fill in around it and are never re-queried on their own. */
export const CORE_SLOT = slotKey('plans')
/** A built-in fact field, or a custom column key `f:<label>`. */
export type FactField = string

export interface Evidence {
  doc: string
  quote: string
}

export interface Fact {
  value: string
  evidence: Evidence[]
}

export interface Checked {
  field: FactField
  fact?: Fact
  /** Evidence that survived verification. */
  valid: { doc: Doc; quote: string }[]
  ok: boolean
  /** Passed only after a re-query. */
  requeried?: boolean
  /** Rests on a dated third-party page, not the official site (pricing only). */
  thirdParty?: boolean
  reason?: 'not_found' | 'quote_not_found' | 'unreachable' | 'unsupported' | 'conflict' | 'seo_only' | 'stale'
}

const FIELD_GUIDE: Record<BuiltinFact, string> = {
  overview: 'Company introduction and main business: what the company/product is, what it mainly does and for whom, in one or two sentences (e.g. "字节跳动旗下的一站式协同办公平台，提供即时消息、文档、会议和多维表格，面向企业团队").',
  region: 'Headquarters city and country, plus main markets if stated (e.g. "美国 · 旧金山，主要面向北美和欧洲").',
  features: 'A short summary of what the product actually does: name 3–5 concrete capabilities or modules the documents mention (e.g. "AI 写作、数据库视图、团队知识库、200+ 集成"), not generic words like "powerful" or "easy to use".',
  pricing: 'The SaaS pricing template, one object with one entry per slot (see below). Never invent a price.',
  contact: 'The concrete channel as stated: the actual sales or support e-mail, phone number, or the contact-form page name.',
}

/** The SaaS pricing template (design v2): each slot is quoted and checked on its own. Missing slots are null. */
export const SLOT_GUIDE: Record<PricingSlot, string> = {
  plans: 'Every plan with its price exactly as shown, in page order, e.g. "Free $0 / Basic $9 / Standard $12 / Pro $19 / Enterprise 定制". Include all plans on the page, the free one and "contact sales" ones too.',
  unit: 'What one price pays for: per user (seat) per month, per workspace, flat fee, usage-based; minimum seats if stated (e.g. "每席位每月，最少 3 席").',
  billing: 'Annual vs monthly billing and the difference if stated (e.g. "价格按年付计算；月付 Basic $12"), currency.',
  addons: 'Costs beyond the plan price: paid add-ons, AI credits, usage or overage charges, implementation fees.',
  free: 'Free plan limits (seats, items, features) and free trial length.',
  promo: 'A current discount or promotion shown on the pricing page (e.g. "Standard 每月立减 $20").',
}

/** What to extract for a field. Custom fields use the user's own words. */
export function fieldGuide(f: FactField): string {
  if (f.startsWith(CUSTOM_PREFIX)) {
    const label = f.slice(CUSTOM_PREFIX.length)
    return `"${label}" — exactly what the user asked for under this name. Give the concrete facts as stated (numbers with units, dates, names, conditions). If the documents give several values (e.g. per plan, per year, per programme), name each briefly.`
  }
  if (isPricingSlot(f)) return SLOT_GUIDE[f.slice(8) as PricingSlot] ?? f
  return FIELD_GUIDE[f as BuiltinFact] ?? f
}

/** Model output for the pricing template: one fact per slot (an old-style flat fact counts as the plans slot). */
export function splitPricing(raw: unknown): Partial<Record<string, Fact | null>> {
  if (!raw || typeof raw !== 'object') return {}
  const r = raw as Record<string, unknown>
  if (typeof r.value === 'string') return { [CORE_SLOT]: r as unknown as Fact }
  const out: Partial<Record<string, Fact | null>> = {}
  for (const s of PRICING_SLOTS) out[slotKey(s)] = (r[s] as Fact | null | undefined) ?? null
  return out
}

const DOC_BUDGET: Record<Doc['kind'], number> = { site: 6000, web: 4000, seo: 450, news: 300, social: 300 }

export function renderDocs(docs: Doc[], totalChars = 42000): string {
  let used = 0
  const parts: string[] = []
  for (const d of docs) {
    const body = d.text.slice(0, DOC_BUDGET[d.kind])
    if (used + body.length > totalChars) break
    used += body.length
    parts.push(`[${d.id}] kind=${d.kind} url=${d.url}${d.rank ? ` rank=${d.rank}` : ''}${d.date ? ` date=${d.date}` : ''}\ntitle: ${d.title}\n${body}`)
  }
  return parts.join('\n\n---\n\n')
}

/** Step 3a: the model proposes facts, each with verbatim quotes pointing at documents. */
export async function extractFacts(llm: Llm, lang: Lang, name: string, fields: FactField[], docs: Doc[], topic?: string): Promise<Partial<Record<FactField, Fact | null>>> {
  if (!fields.length) return {}
  const one = { value: '…', evidence: [{ doc: 'D1', quote: 'exact text copied from D1' }] }
  const schema = Object.fromEntries(fields.map((f) => [f, f === 'pricing' ? Object.fromEntries(PRICING_SLOTS.map((p) => [p, p === 'plans' ? one : null])) : one]))
  const out = await llm.json<{ facts?: Partial<Record<FactField, Fact | null>> }>({
    task: 'extract',
    system: [
      'You extract facts about one subject (a company, product, school, place, tool, programme…) for a research table. Output JSON only.',
      UNTRUSTED_NOTE,
      'Rules:',
      '- Use only the documents. If a field is not stated, set it to null. Never guess.',
      '- Every fact needs 1–3 evidence items. "quote" must be copied character-for-character from that document (5–220 characters).',
      '- Prefer kind=site (the subject\'s own website), then kind=web (full pages found by search), over search snippets (kind=seo), news or social posts.',
      '- For pricing, quote kind=site whenever an official page states the price; use a kind=web page (it shows its date) only when no official page does.',
      '- Only use facts that are about this exact subject, not a different one with a similar name.',
      `- "value" is a short summary written from the documents in ${lang === 'zh' ? 'Simplified Chinese, 15–60 characters (pricing plans: up to 120)' : 'English, 8–30 words (pricing plans: up to 60)'}: specific and informative (names, numbers, plans, places), one sentence or a compact list, no filler or marketing adjectives. Keep product and plan names and prices exactly as written, with currency.`,
    ].join('\n'),
    user: [
      `Subject: ${name}${topic ? ` (${topic})` : ''}`,
      'Fields:',
      ...fields.map((f) => `- ${JSON.stringify(f)}: ${fieldGuide(f)}`),
      ...(fields.includes('pricing') ? ['  "pricing" slots — each its own { value, evidence } or null when the documents do not state it:', ...PRICING_SLOTS.map((p) => `  - ${p}: ${SLOT_GUIDE[p]}`)] : []),
      `Return JSON like: ${JSON.stringify({ facts: schema })}`,
      '',
      'Documents:',
      renderDocs(docs),
    ].join('\n'),
    maxTokens: Math.min(4000, 900 + fields.length * 300 + (fields.includes('pricing') ? 900 : 0)),
  })
  const facts: Partial<Record<FactField, Fact | null>> = { ...(out.facts ?? {}) }
  if (fields.includes('pricing')) {
    Object.assign(facts, splitPricing(out.facts?.pricing))
    delete facts.pricing
  }
  return facts
}

/** Does the quote really appear in the document? Exact after normalising, or ≥ 90 % of its words in order. */
export function quoteInText(quote: string, text: string): boolean {
  const q = normalizeForMatch(quote)
  const t = normalizeForMatch(text)
  if (q.length < 4) return false
  if (t.includes(q)) return true
  const cjk = /[㐀-鿿]/.test(q)
  const tokens = cjk ? [...q.replace(/\s/g, '')] : q.split(/[^\p{L}\p{N}$€£¥%.]+/u).filter(Boolean)
  if (tokens.length < 3) return false
  let pos = 0
  let hit = 0
  const hay = cjk ? t.replace(/\s/g, '') : t
  for (const tok of tokens) {
    const at = hay.indexOf(tok, pos)
    if (at >= 0 && at - pos < (cjk ? 6 : 60)) {
      hit++
      pos = at + tok.length
    }
  }
  return hit / tokens.length >= 0.9
}

/** Step 3b: keep only evidence whose document exists, was reachable, and contains the quote. */
export function verifyFact(field: FactField, fact: Fact | null | undefined, docs: Doc[]): Checked {
  if (!fact || !fact.value || !String(fact.value).trim()) return { field, valid: [], ok: false, reason: 'not_found' }
  const byId = new Map(docs.map((d) => [d.id, d]))
  const valid: Checked['valid'] = []
  let unreachable = false
  for (const e of (fact.evidence ?? []).slice(0, 4)) {
    const doc = byId.get(String(e?.doc ?? ''))
    if (!doc) continue
    if (doc.status !== 200) {
      unreachable = true
      continue
    }
    if (quoteInText(String(e.quote ?? ''), doc.text)) valid.push({ doc, quote: String(e.quote) })
  }
  if (!valid.length) return { field, fact, valid, ok: false, reason: unreachable ? 'unreachable' : 'quote_not_found' }
  const pricing = field === 'pricing' || isPricingSlot(field)
  if ((pricing || field === 'features') && !valid.some((v) => v.doc.kind === 'site')) {
    // pricing may rest on a third-party page, but only one that shows an update date within the last 12 months
    if (pricing) {
      const dated = valid.filter((v) => v.doc.kind === 'web' && freshEnough(v.doc.date))
      if (dated.length) return { field, fact, valid: dated, ok: true, thirdParty: true }
      if (valid.some((v) => v.doc.kind === 'web')) return { field, fact, valid, ok: false, reason: 'stale' }
    }
    return { field, fact, valid, ok: false, reason: 'seo_only' }
  }
  return { field, fact, valid, ok: true }
}

/** Step 4: a second model pass judges whether the quoted evidence supports each value. */
export async function judge(llm: Llm, lang: Lang, name: string, items: Checked[]): Promise<Record<string, { ok: boolean; reason?: string }>> {
  const toJudge = items.filter((c) => c.ok && c.fact)
  if (!toJudge.length) return {}
  const payload = toJudge.map((c) => ({
    field: c.field,
    value: c.fact!.value,
    evidence: c.valid.map((v) => ({ kind: v.doc.kind, url: v.doc.url, quote: v.quote })),
  }))
  const out = await llm.json<{ checks?: Record<string, { ok?: boolean; reason?: string }> }>({
    task: 'judge',
    system: [
      'You are a strict fact checker for a research table. Output JSON only.',
      UNTRUSTED_NOTE,
      'For each field decide ok=true only if the quotes directly support the value and the quotes do not contradict each other.',
      'reason must be one of: "unsupported", "conflict" (when ok=false).',
    ].join('\n'),
    user: `Subject: ${name}\nLanguage of values: ${lang}\nItems: ${JSON.stringify(payload)}\nReturn JSON like {"checks": {"pricing": {"ok": true}, "region": {"ok": false, "reason": "unsupported"}}}`,
    maxTokens: 600,
  })
  const res: Record<string, { ok: boolean; reason?: string }> = {}
  for (const c of toJudge) {
    const r = out.checks?.[c.field]
    res[c.field] = { ok: r?.ok !== false, reason: r?.ok === false ? (r.reason === 'conflict' ? 'conflict' : 'unsupported') : undefined }
  }
  return res
}

export function toSources(lang: Lang, valid: Checked['valid']): Source[] {
  const seen = new Set<string>()
  const out: Source[] = []
  for (const v of valid) {
    if (seen.has(v.doc.url)) continue
    seen.add(v.doc.url)
    const zh = lang === 'zh'
    const title =
      v.doc.kind === 'seo'
        ? zh
          ? `搜索「${v.doc.query}」排名第 ${v.doc.rank}`
          : `Ranks #${v.doc.rank} for “${v.doc.query}”`
        : v.doc.kind === 'site'
          ? `${zh ? (v.doc.via === 'search' ? '官网（搜索引擎收录）' : '官网') : v.doc.via === 'search' ? 'Website (via search index)' : 'Website'} · ${v.doc.title.slice(0, 60)}`
          : v.doc.kind === 'web'
            ? `${zh ? '第三方' : 'Third party'}${v.doc.date ? ` · ${v.doc.date.slice(0, 10)}` : ''} · ${v.doc.title.slice(0, 60)}`
            : v.doc.title.slice(0, 80)
    out.push({ kind: v.doc.kind, url: v.doc.url, title })
  }
  return out.slice(0, 3)
}

/* ---------------- news & social cells ---------------- */

const MAX_ITEMS = 5
const isoDay = (d?: string) => {
  if (!d) return undefined
  const t = Date.parse(d)
  return Number.isNaN(t) ? undefined : new Date(t).toISOString().slice(0, 10)
}

/**
 * Asks the model to keep only items about this company and write one-sentence summaries.
 * Each picked id must be one of the documents shown, so every item keeps its real URL.
 */
async function pickItems(
  llm: Llm,
  lang: Lang,
  task: 'news' | 'social',
  b: Bundle,
  docs: Doc[],
): Promise<{ items: { doc: Doc; text: string }[]; keyPoint?: string }> {
  if (!docs.length) return { items: [] }
  const zh = lang === 'zh'
  const out = await llm.json<{ items?: { id?: string; summary?: string }[]; keyPoint?: string }>({
    task,
    system: [
      task === 'news'
        ? 'You select recent news and announcements about one company and summarise each. Output JSON only.'
        : 'You select recent posts published by one company on social media and summarise each. Output JSON only.',
      UNTRUSTED_NOTE,
      task === 'news'
        ? 'Skip items about a different company with a similar name, duplicates of the same story, and listicles that only mention the company in passing.'
        : 'Keep posts published by the company or its official account (check the URL and title). Skip posts by unrelated people, duplicates and job ads.',
      `Pick up to ${MAX_ITEMS} items, newest first. "summary": one concrete sentence in ${zh ? 'Simplified Chinese, 12–40 characters' : 'English, 8–20 words'} saying what happened (what was launched, announced, raised or shared, with the specific name or number if the item gives one), using only what the item says. Not just the headline repeated.`,
      task === 'social' ? `"keyPoint": one phrase (${zh ? 'at most 24 characters' : 'at most 10 words'}) naming the main themes across the picked posts.` : '',
    ].join('\n'),
    user: `Company: ${b.name}${b.domain ? ` (${b.domain})` : ''}\nReturn JSON like {"items":[{"id":"D12","summary":"…"}]${task === 'social' ? ',"keyPoint":"…"' : ''}}\n\n${renderDocs(docs, 9000)}`,
    maxTokens: 700,
  })
  const byId = new Map(docs.map((d) => [d.id, d]))
  const seen = new Set<string>()
  const items: { doc: Doc; text: string }[] = []
  for (const it of out.items ?? []) {
    const doc = byId.get(String(it?.id ?? ''))
    const text = String(it?.summary ?? '').trim()
    if (!doc || !text || seen.has(doc.url)) continue
    seen.add(doc.url)
    items.push({ doc, text: text.slice(0, 120) })
    if (items.length >= MAX_ITEMS) break
  }
  items.sort((a, b2) => (Date.parse(b2.doc.date ?? '') || 0) - (Date.parse(a.doc.date ?? '') || 0))
  return { items, keyPoint: out.keyPoint ? String(out.keyPoint).slice(0, 60) : undefined }
}

const outlet = (d: Doc) => {
  try {
    return new URL(d.url).hostname.replace(/^www\./, '')
  } catch {
    return ''
  }
}

/** Latest news: a list of recent items, each with its own summary and link. */
export async function newsCell(llm: Llm, lang: Lang, b: Bundle): Promise<Cell> {
  const docs = b.docs.filter((d) => d.kind === 'news').slice(0, 12)
  const { items } = await pickItems(llm, lang, 'news', b, docs)
  if (!items.length) return { value: T[lang].noNews, sources: [], status: 'missing' }
  return {
    value: items.length === 1 ? items[0].text : T[lang].newsSummary(items.length),
    date: isoDay(items[0].doc.date),
    sources: items.slice(0, 3).map((i) => ({ kind: 'news' as const, url: i.doc.url, title: i.doc.title.slice(0, 80) })),
    items: items.map((i) => ({ text: i.text, url: i.doc.url, date: isoDay(i.doc.date), label: outlet(i.doc) })),
    status: 'verified',
  }
}

/** Social: recent posts from official APIs and from indexed public pages, each summarised with its link. */
export async function socialCell(llm: Llm, lang: Lang, b: Bundle): Promise<Cell> {
  const accountSources: Source[] = b.accounts.slice(0, 3).map((a) => ({ kind: 'social', url: a.url, title: `${PLATFORM_LABEL[a.platform] ?? a.platform} ${a.handle}` }))
  const docs = b.docs.filter((d) => d.kind === 'social').slice(0, 16)
  const { items, keyPoint } = await pickItems(llm, lang, 'social', b, docs)
  if (items.length) {
    const platformOf = (d: Doc) => {
      const p = d.title.split(/[\s·]/)[0]
      return PLATFORM_LABEL[p] ?? p
    }
    return {
      value: T[lang].socialSummary(items.length, keyPoint || '—'),
      sources: accountSources,
      items: items.map((i) => ({ text: i.text, url: i.doc.url, date: isoDay(i.doc.date), label: platformOf(i.doc) })),
      status: 'verified',
    }
  }
  if (!b.accounts.length) return { value: lang === 'zh' ? '没有找到公开的社媒内容' : 'No public social posts found', sources: [], status: 'missing' }
  const list = b.accounts.slice(0, 4).map((a) => `${PLATFORM_LABEL[a.platform] ?? a.platform} ${a.platform === 'x' ? '@' : ''}${a.handle}`).join(' / ')
  return { value: T[lang].accounts(list), sources: accountSources, status: 'verified' }
}

export function nameCell(lang: Lang, b: Bundle): Cell {
  return b.home
    ? { value: b.name, sources: [{ kind: 'site', url: b.home, title: lang === 'zh' ? '官网首页' : 'Homepage' }], status: 'verified' }
    : { value: b.name, sources: [], status: 'verified' }
}

export const domainLabel = (b: Bundle) => b.domain || hostOf(b.home ?? '')

/** The pricing cell: plans and prices as the value, the other template slots as a list, missing slots named. */
export function pricingCell(lang: Lang, checked: Checked[], clipFn: (v: string, max: number) => string): Cell | undefined {
  const by = new Map(checked.filter((c) => isPricingSlot(c.field)).map((c) => [c.field, c]))
  const core = by.get(CORE_SLOT)
  if (!core?.ok || !core.fact) return undefined
  const items: CellItem[] = []
  const gaps: string[] = []
  for (const s of PRICING_SLOTS) {
    if (s === 'plans') continue
    const c = by.get(slotKey(s))
    if (c?.ok && c.fact) items.push({ label: SLOT_LABEL[lang][s], text: clipFn(String(c.fact.value), lang === 'zh' ? 80 : 160), url: c.valid[0].doc.url })
    else gaps.push(SLOT_LABEL[lang][s])
  }
  const sources = toSources(lang, [...core.valid, ...items.length ? checked.filter((c) => isPricingSlot(c.field) && c.ok && c !== core).flatMap((c) => c.valid) : []])
  const used = [core, ...PRICING_SLOTS.map((s) => by.get(slotKey(s))).filter((c): c is Checked => !!c && c.ok && c !== core)]
  return {
    value: clipFn(String(core.fact.value), lang === 'zh' ? 160 : 320),
    sources,
    status: core.requeried ? 'requeried' : 'verified',
    ...(items.length ? { items } : {}),
    gaps,
    ...(used.some((c) => c.thirdParty) ? { thirdParty: true } : {}),
  } as Cell
}

/** Template slots filled with verified facts, for the run stats. */
export const filledSlots = (checked: Checked[]) => checked.filter((c) => isPricingSlot(c.field) && c.ok).length

export const noInfo = (lang: Lang) => NO_INFO[lang]
