import type { Llm } from '../llm/llm.ts'
import type { SearchStack } from '../sources/search.ts'
import { INTENT_EXAMPLES } from './intent-examples.ts'
import { DIMENSIONS, TIME_RANGES, type Dimension, type Intent, type IntentType, type Lang, type TimeRange } from '../types.ts'

interface RawIntent {
  type?: string
  company?: string | null
  /** Keywords for what the user's own product does (type own), e.g. "在线协作文档". */
  product?: string | null
  competitors?: unknown
  timeRange?: string
  dimensions?: unknown
}

const clean = (s: unknown) => String(s ?? '').replace(/\s+/g, ' ').trim().slice(0, 60)

export function normaliseIntent(raw: RawIntent, query: string, maxCompetitors: number): Intent {
  const type: IntentType = raw.type === 'own' || raw.type === 'timeframe' ? raw.type : 'named'
  const timeRange: TimeRange = TIME_RANGES.includes(raw.timeRange as TimeRange) ? (raw.timeRange as TimeRange) : 'all'
  // "timeframe" needs an explicit period; without one it is a plain lookup of the named companies
  const kind: IntentType = type === 'timeframe' && timeRange === 'all' ? 'named' : type
  const dims = new Set<Dimension>(['name'])
  if (Array.isArray(raw.dimensions)) for (const d of raw.dimensions) if (DIMENSIONS.includes(d as Dimension)) dims.add(d as Dimension)
  if (dims.size === 1) (kind === 'timeframe' ? (['social', 'news'] as Dimension[]) : DIMENSIONS).forEach((d) => dims.add(d))
  if (kind === 'timeframe') dims.add('news')
  const competitors = Array.isArray(raw.competitors) ? [...new Set(raw.competitors.map(clean).filter((n) => n && !n.startsWith('<')))].slice(0, maxCompetitors) : []
  return {
    // A time range never changes the type by itself (e.g. "pricing and latest news" stays "named").
    type: kind,
    query: query.slice(0, 300),
    company: raw.company ? clean(raw.company) : undefined,
    competitors,
    timeRange,
    dimensions: DIMENSIONS.filter((d) => dims.has(d)),
  }
}

const INTENT_SYSTEM = [
  'You turn a competitor-research request into JSON. Output JSON only, shaped like the examples.',
  '',
  'type — decided by where the competitors come from and what the question is about:',
  '- "own": the user describes their own company or product and names NO competitor. Suggest up to 4 real, direct competitors.',
  '- "named" (default): the user names at least one company. Use exactly the names they wrote. If they also describe their own company, still "named" and put it in "company".',
  '- "timeframe": the user names companies AND the question is about what happened in a period (launches, announcements, news, "how is X doing lately") AND asks for no basic info (region, features, pricing, contact).',
  '  A request that mixes basic info with "latest news" or "this month\'s news" is "named", with the time range applied to news.',
  '  "how is X doing lately" / "最近怎么样" / "what\'s new with X" = timeframe, 7d, social + news only.',
  '',
  `timeRange — one of ${TIME_RANGES.join(', ')}. It only limits news and social posts and never changes "type" on its own:`,
  '- no time mentioned → all; "最新/最近/近期/latest/recent" inside a list of fields → 30d',
  '- 本周/这周/近7天/this week/past 7 days → 7d; 本月/过去一个月/近30天/last month/past 30 days → 30d',
  '- 这个季度/近三个月/近90天/this quarter → 90d; 今年/今年以来/this year/YTD → ytd; anything older or a specific date → 90d',
  '',
  `dimensions — subset of ${DIMENSIONS.join(', ')}, always including name. "基本信息/basic info" = region, features, pricing, contact.`,
  '"动态/发布/news/announce/what happened" = news, plus social when the question is about activity in a period. Nothing specific → all dimensions (timeframe: social + news).',
  '',
  'company: the user\'s own company name if they give one, else null.',
  'product: for type "own", 2–8 words naming what the user\'s product does or its key features, in the user\'s language (e.g. "在线协作文档", "AI writing assistant for marketers"); else null.',
  '',
  'Examples:',
  ...INTENT_EXAMPLES.map(
    (e) =>
      `${e.query}\n→ ${JSON.stringify({ type: e.type, company: e.company, product: e.product ?? null, competitors: e.competitors ?? ['<suggest up to 4>'], timeRange: e.timeRange, dimensions: e.dimensions })}`,
  ),
].join('\n')

/** Step 1: read the question. For "find my competitors" the suggestions are checked against real search results. */
export async function parseIntent(llm: Llm, search: SearchStack, query: string, lang: Lang, maxCompetitors: number): Promise<Intent> {
  const raw = await llm.json<RawIntent>({
    task: 'intent',
    system: INTENT_SYSTEM,
    user: `Request (${lang}): ${query}`,
    maxTokens: 400,
  })
  const intent = normaliseIntent(raw, query, maxCompetitors)

  if (intent.type === 'own') {
    // ground the suggestions: keep names that real search results mention as alternatives/competitors
    const product = raw.product ? String(raw.product).replace(/\s+/g, ' ').trim().slice(0, 60) : ''
    const subject = [intent.company, product].filter(Boolean).join(' · ') || query
    // search by what the product does (works without a company name), and by the company name when given
    const queries = [
      product && (lang === 'zh' ? `${product} 软件 竞品 对比` : `best ${product} software alternatives`),
      intent.company && (lang === 'zh' ? `${intent.company} 竞品 替代` : `${intent.company} competitors alternatives`),
    ].filter(Boolean) as string[]
    if (!queries.length) queries.push(lang === 'zh' ? `${query} 竞品 替代` : `${query} competitors alternatives`)
    const hits = (await Promise.all(queries.map((q) => search.web(q, { lang, num: 10 })))).flat()
    const corpus = hits.map((h) => `${h.title} ${h.snippet}`).join('\n')
    if (corpus) {
      const picked = await llm.json<{ competitors?: unknown }>({
        task: 'discover',
        system:
          'From the search results, list up to 4 product or company names that are direct competitors of the subject: products that do the same job for similar customers. Only names that literally appear in the results. Exclude the subject itself, review sites, directories and articles. Output JSON only.',
        user: `Subject: ${subject}\nCandidates from earlier: ${JSON.stringify(intent.competitors)}\nReturn JSON like {"competitors":["A","B"]}\n\nResults:\n${corpus.slice(0, 8000)}`,
        maxTokens: 200,
      })
      const lower = corpus.toLowerCase()
      const grounded = (Array.isArray(picked.competitors) ? picked.competitors.map(clean) : []).filter(
        (n) => n && lower.includes(n.toLowerCase()) && n.toLowerCase() !== intent.company?.toLowerCase(),
      )
      if (grounded.length) intent.competitors = [...new Set(grounded)].slice(0, Math.min(4, maxCompetitors))
    }
  }
  return intent
}

/** Validates an intent sent back by the browser (after the user edited it). */
export function validateIntent(input: unknown, maxCompetitors: number): Intent | null {
  if (!input || typeof input !== 'object') return null
  const i = input as Record<string, unknown>
  const intent = normaliseIntent(
    { type: String(i.type ?? ''), company: (i.company as string) ?? null, competitors: i.competitors, timeRange: String(i.timeRange ?? ''), dimensions: i.dimensions },
    String(i.query ?? ''),
    maxCompetitors,
  )
  if (!intent.competitors.length || !intent.query) return null
  return intent
}
