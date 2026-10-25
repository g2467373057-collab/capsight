import { UNTRUSTED_NOTE, type Llm } from '../llm/llm.ts'
import { normalizeForMatch } from '../sources/html.ts'
import { hostOf } from '../sources/net.ts'
import { CUSTOM_PREFIX, type Cell, type Lang, type Source } from '../types.ts'
import type { Bundle, Doc } from './collect.ts'
import { PLATFORM_LABEL, T } from './i18n.ts'

export type BuiltinFact = 'region' | 'features' | 'pricing' | 'contact'
export const FACT_FIELDS: BuiltinFact[] = ['region', 'features', 'pricing', 'contact']
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
  reason?: 'not_found' | 'quote_not_found' | 'unreachable' | 'unsupported' | 'conflict' | 'seo_only'
}

const FIELD_GUIDE: Record<BuiltinFact, string> = {
  region: 'Headquarters city and country, plus main markets if stated (e.g. "美国 · 旧金山，主要面向北美和欧洲").',
  features: 'A short summary of what the product actually does: name 3–5 concrete capabilities or modules the documents mention (e.g. "AI 写作、数据库视图、团队知识库、200+ 集成"), not generic words like "powerful" or "easy to use".',
  pricing: 'Concrete plans and prices as stated, e.g. "Free / Plus $10 / Business $20 每人每月，Enterprise 需询价". Include the free tier, billing basis and trial if mentioned. Never invent a price.',
  contact: 'The concrete channel as stated: the actual sales or support e-mail, phone number, or the contact-form page name.',
}

/** What to extract for a field. Custom fields use the user's own words. */
export function fieldGuide(f: FactField): string {
  if (f.startsWith(CUSTOM_PREFIX)) {
    const label = f.slice(CUSTOM_PREFIX.length)
    return `"${label}" — exactly what the user asked for under this name. Give the concrete facts as stated (numbers with units, dates, names, conditions). If the documents give several values (e.g. per plan, per year, per programme), name each briefly.`
  }
  return FIELD_GUIDE[f as BuiltinFact] ?? f
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
  const schema = Object.fromEntries(fields.map((f) => [f, { value: '…', evidence: [{ doc: 'D1', quote: 'exact text copied from D1' }] }]))
  const out = await llm.json<{ facts?: Partial<Record<FactField, Fact | null>> }>({
    task: 'extract',
    system: [
      'You extract facts about one subject (a company, product, school, place, tool, programme…) for a research table. Output JSON only.',
      UNTRUSTED_NOTE,
      'Rules:',
      '- Use only the documents. If a field is not stated, set it to null. Never guess.',
      '- Every fact needs 1–3 evidence items. "quote" must be copied character-for-character from that document (5–220 characters).',
      '- Prefer kind=site (the subject\'s own website), then kind=web (full pages found by search), over search snippets (kind=seo), news or social posts.',
      '- Only use facts that are about this exact subject, not a different one with a similar name.',
      `- "value" is a short summary written from the documents in ${lang === 'zh' ? 'Simplified Chinese, 15–60 characters' : 'English, 8–30 words'}: specific and informative (names, numbers, plans, places), one sentence or a compact list, no filler or marketing adjectives. Keep product and plan names as written.`,
    ].join('\n'),
    user: [
      `Subject: ${name}${topic ? ` (${topic})` : ''}`,
      'Fields:',
      ...fields.map((f) => `- ${JSON.stringify(f)}: ${fieldGuide(f)}`),
      `Return JSON like: ${JSON.stringify({ facts: schema })}`,
      '',
      'Documents:',
      renderDocs(docs),
    ].join('\n'),
    maxTokens: Math.min(3200, 900 + fields.length * 300),
  })
  return out.facts ?? {}
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
  if ((field === 'pricing' || field === 'features') && !valid.some((v) => v.doc.kind === 'site')) return { field, fact, valid, ok: false, reason: 'seo_only' }
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
          ? `${zh ? '官网' : 'Website'} · ${v.doc.title.slice(0, 60)}`
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
