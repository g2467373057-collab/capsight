import type { Llm } from '../llm/llm.ts'
import type { SearchStack } from '../sources/search.ts'
import { INTENT_EXAMPLES } from './intent-examples.ts'
import { DEFAULT_DIMS_NAMED, DEFAULT_DIMS_OWN, DIMENSIONS, TIME_RANGES, type Dimension, type Intent, type IntentType, type Lang, type TimeRange } from '../types.ts'

interface RawIntent {
  type?: string
  company?: string | null
  /** Search keywords for what to find (type own), e.g. "在线协作文档", "开源向量数据库". */
  product?: string | null
  competitors?: unknown
  timeRange?: string
  dimensions?: unknown
  topic?: string | null
  fields?: unknown
  discover?: string | null
  sites?: unknown
}

const clean = (s: unknown) => String(s ?? '').replace(/\s+/g, ' ').trim().slice(0, 60)
export const MAX_FIELDS = 6

/** Custom field labels that are really a built-in field go to that field instead. */
const BUILTIN_ALIAS: [RegExp, Dimension][] = [
  [/^(公司介绍|公司简介|简介|介绍|基础介绍|基本介绍|主营业务|主要业务|产品定位|overview|about|introduction|description|company overview)$/i, 'overview'],
  [/^(地区|国家|国家\/地区|总部|总部所在地|所在地|region|country|location|headquarters?|hq)$/i, 'region'],
  [/^(公司规模|规模|员工|员工人数|员工规模|人数|团队规模|company size|size|employees|headcount|team size)$/i, 'size'],
  [/^(融资|融资情况|融资轮次|融资历史|投资方|估值|上市情况|funding|funding rounds?|investors|raised|valuation)$/i, 'funding'],
  [/^(功能|主要功能|核心功能|产品功能|features?|key features|capabilities)$/i, 'features'],
  [/^(定价|价格|收费|套餐|费用|pricing|price|prices|plans?|cost)$/i, 'pricing'],
  [/^(联系方式|联系|电话|邮箱|contact|contacts|email|phone)$/i, 'contact'],
  [/^(社媒|社媒账号|社交媒体|social|social media)$/i, 'social'],
  [/^(新闻|动态|最新动态|近期动态|news|latest news|updates)$/i, 'news'],
  [/^(名称|名字|name)$/i, 'name'],
]

export function normaliseIntent(raw: RawIntent, query: string, maxCompetitors: number): Intent {
  const type: IntentType = raw.type === 'own' || raw.type === 'timeframe' ? raw.type : 'named'
  const timeRange: TimeRange = TIME_RANGES.includes(raw.timeRange as TimeRange) ? (raw.timeRange as TimeRange) : 'all'
  // "timeframe" needs an explicit period; without one it is a plain lookup of the named subjects
  const kind: IntentType = type === 'timeframe' && timeRange === 'all' ? 'named' : type
  const dims = new Set<Dimension>(['name'])
  if (Array.isArray(raw.dimensions)) for (const d of raw.dimensions) if (DIMENSIONS.includes(d as Dimension)) dims.add(d as Dimension)
  const fields: string[] = []
  if (Array.isArray(raw.fields)) {
    for (const f of raw.fields) {
      const label = String(f ?? '').replace(/[\s:：]+/g, ' ').trim().slice(0, 24)
      if (!label || label.startsWith('<')) continue
      const builtin = BUILTIN_ALIAS.find(([re]) => re.test(label))?.[1]
      if (builtin) dims.add(builtin)
      else if (!fields.some((x) => x.toLowerCase() === label.toLowerCase())) fields.push(label)
    }
  }
  // nothing specific asked → the branch default (A: list + basic introduction; B: full research; timeframe: activity)
  if (dims.size === 1 && !fields.length) (kind === 'timeframe' ? (['social', 'news'] as Dimension[]) : kind === 'own' ? DEFAULT_DIMS_OWN : DEFAULT_DIMS_NAMED).forEach((d) => dims.add(d))
  // branch A always gives each competitor found its basic company information (introduction, country, size, funding)
  if (kind === 'own') DEFAULT_DIMS_OWN.forEach((d) => dims.add(d))
  if (kind === 'timeframe') dims.add('news')
  const competitors = Array.isArray(raw.competitors) ? [...new Set(raw.competitors.map(clean).filter((n) => n && !n.startsWith('<')))].slice(0, maxCompetitors) : []
  const topic = raw.topic ? clean(raw.topic).slice(0, 40) : ''
  // official domains carried over from an earlier run: only for subjects in this intent, only plain host names
  const sites: Record<string, string> = {}
  if (raw.sites && typeof raw.sites === 'object') {
    for (const [k, v] of Object.entries(raw.sites as Record<string, unknown>)) {
      const host = String(v ?? '').trim().toLowerCase().replace(/^https?:\/\//, '').replace(/\/.*$/, '')
      if (competitors.includes(clean(k)) && /^([a-z0-9-]+\.)+[a-z]{2,}$|^\d{1,3}(\.\d{1,3}){3}(:\d+)?$/.test(host)) sites[clean(k)] = host
    }
  }
  return {
    // A time range never changes the type by itself (e.g. "pricing and latest news" stays "named").
    type: kind,
    query: query.slice(0, 300),
    company: raw.company ? clean(raw.company) : undefined,
    competitors,
    timeRange,
    dimensions: DIMENSIONS.filter((d) => dims.has(d)),
    ...(topic ? { topic } : {}),
    ...(fields.length ? { fields: fields.slice(0, MAX_FIELDS) } : {}),
    ...(Object.keys(sites).length ? { sites } : {}),
  }
}

const INTENT_SYSTEM = [
  'You classify a research request and turn it into JSON. Output JSON only, shaped like the examples. Never invent facts; decide only from the user\'s words.',
  'The things being researched ("subjects", stored in "competitors") are usually SaaS companies and products, but can be anything public: apps, AI tools, open-source projects, schools or degree programmes, cities, platforms, public organisations.',
  'Never research private individuals; public companies, products, places and institutions only.',
  '',
  'type — the branch. Decide by one question: did the user write the names of the subjects they want researched?',
  '- "own" (branch A, user does NOT know the competitors): the user describes their own product, feature, category or market and wants to find who is in it. They name no subject to research. Either competitors of their own product (discover "competitors"), e.g. "我们做 AI 客户管理 SaaS，有哪些竞品", or things matching a description (discover "list"), e.g. "客户管理系统有哪些？", "推荐几个开源向量数据库". A reference product named only to describe the market ("Find competitors of Calendly", "像 Notion 一样的工具有哪些") is still "own": put it in "company" so it is excluded from the results. Suggest up to 4 real, well-known candidates.',
  '- "named" (branch B, user knows the competitors, default): the user writes at least one subject\'s name and wants facts about it. Use exactly the names they wrote (add a qualifier only when the bare name is ambiguous). If they also describe their own company, it is still "named" and their company goes in "company".',
  '  A request that both asks "what are the competitors" AND names one to look into ("我做 AI 表单 SaaS，竞品有哪些？帮我看看其中 Typeform 的定价") is "named" with only the named subject(s).',
  '- "timeframe": the user names subjects AND the question is only about what happened in a period (launches, announcements, news, "how is X doing lately") with no other facts asked.',
  '  A request that mixes facts with "latest news" or "this month\'s news" is "named", with the time range applied to news.',
  '  "how is X doing lately" / "最近怎么样" / "what\'s new with X" = timeframe, 7d, social + news only.',
  '',
  `timeRange — one of ${TIME_RANGES.join(', ')}. It only limits news and social posts and never changes "type" on its own:`,
  '- no time mentioned → all; "最新/最近/近期/latest/recent" inside a list of fields → 30d',
  '- 本周/这周/近7天/this week/past 7 days → 7d; 本月/过去一个月/近30天/last month/past 30 days → 30d',
  '- 这个季度/近三个月/近90天/this quarter → 90d; 今年/今年以来/this year/YTD → ytd; anything older or a specific date → 90d',
  '',
  `dimensions — built-in fields, subset of ${DIMENSIONS.join(', ')}, always including name. overview = company introduction and main business (what it is, who it serves); region = country and HQ; size = company size (employees); funding = funding rounds, investors or listing; features = what the product does; pricing = plans and prices; contact; social = official accounts and posts; news = latest news.`,
  'Only list the fields the user actually asks for. If nothing specific is asked, return just ["name"]: the system then applies the branch default (A: overview, region, size, funding, no pricing or news; B: overview, region, features, pricing, social, news).',
  '"基本信息/basic info/概况" = overview, region, features, pricing. "介绍/简介/是做什么的" = overview. "规模/员工" = size. "融资/投资方/估值/上市" = funding. "动态/发布/news/announce/what happened" = news, plus social when the question is about activity in a period.',
  'If the subjects are not companies or products (schools, cities, programmes…), use name plus fields, and news only if asked.',
  '',
  'fields — everything else the user wants to know that is not a built-in dimension, as short column names in the user\'s language (2–10 characters in Chinese, 1–4 words in English), at most 6. Examples: 学费, 学制, 申请截止时间, 融资情况, 成立时间, 创始人, 用户规模, GitHub star 数, 开源协议, visa rules.',
  'If the subjects are not companies/products and the user names nothing specific, propose the 3–5 fields that matter most for that kind of subject. Never put a built-in dimension into fields.',
  '',
  'topic: a short phrase naming what kind of thing the subjects are, in the user\'s language (e.g. "SaaS 协作工具", "大学硕士项目", "开源向量数据库").',
  'company: the user\'s own company name (or, for type "own", the reference product they want competitors of), else null.',
  'product: for type "own", 2–8 words to search for the subjects, in the user\'s language (e.g. "在线协作文档", "AI 客户管理 SaaS", "online meeting scheduling software"); else null.',
  'discover: for type "own", "competitors" or "list"; else null.',
  '',
  'Examples:',
  ...INTENT_EXAMPLES.map(
    (e) =>
      `${e.query}\n→ ${JSON.stringify({ type: e.type, company: e.company, product: e.product ?? null, discover: e.type === 'own' ? (e.discover ?? 'competitors') : null, topic: e.topic ?? null, competitors: e.competitors ?? ['<suggest up to 4>'], timeRange: e.timeRange, dimensions: e.dimensions, fields: e.fields ?? [] })}`,
  ),
].join('\n')

/** Step 1: read the question. For "find my competitors" the suggestions are checked against real search results. */
export async function parseIntent(llm: Llm, search: SearchStack, query: string, lang: Lang, maxCompetitors: number): Promise<Intent> {
  const raw = await llm.json<RawIntent>({
    task: 'intent',
    system: INTENT_SYSTEM,
    user: `Request (${lang}): ${query}`,
    maxTokens: 600,
  })
  const intent = normaliseIntent(raw, query, maxCompetitors)

  if (intent.type === 'own') {
    // ground the suggestions: keep names that real search results mention
    const product = raw.product ? String(raw.product).replace(/\s+/g, ' ').trim().slice(0, 60) : ''
    const list = raw.discover === 'list' || (!intent.company && raw.discover !== 'competitors' && !/竞品|竞争|对手|competitor|alternative|rival/i.test(query))
    const subject = [intent.company, product].filter(Boolean).join(' · ') || query
    const queries = (
      list
        ? [product && (lang === 'zh' ? `${product} 有哪些 推荐` : `best ${product}`), product && (lang === 'zh' ? `${product} 排名 盘点` : `top ${product} list`)]
        : [
            // search by what the product does (works without a company name), and by the company name when given
            product && (lang === 'zh' ? `${product} 竞品 对比` : `best ${product} alternatives`),
            intent.company && (lang === 'zh' ? `${intent.company} 竞品 替代` : `${intent.company} competitors alternatives`),
          ]
    ).filter(Boolean) as string[]
    if (!queries.length) queries.push(list ? query : lang === 'zh' ? `${query} 竞品 替代` : `${query} competitors alternatives`)
    const hits = (await Promise.all(queries.map((q) => search.web(q, { lang, num: 10 })))).flat()
    const corpus = hits.map((h) => `${h.title} ${h.snippet}`).join('\n')
    if (corpus) {
      const picked = await llm.json<{ competitors?: unknown }>({
        task: 'discover',
        system: list
          ? 'From the search results, list up to 5 specific names (companies, products, projects, schools, places…) that match the request. Only names that literally appear in the results. Exclude list articles, review sites, directories and media outlets themselves. Output JSON only.'
          : 'From the search results, list up to 4 product or company names that are direct competitors of the subject: products that do the same job for similar customers. Only names that literally appear in the results. Exclude the subject itself, review sites, directories and articles. Output JSON only.',
        user: `${list ? 'Request' : 'Subject'}: ${list ? query : subject}\nCandidates from earlier: ${JSON.stringify(intent.competitors)}\nReturn JSON like {"competitors":["A","B"]}\n\nResults:\n${corpus.slice(0, 8000)}`,
        maxTokens: 200,
      })
      const lower = corpus.toLowerCase()
      const grounded = (Array.isArray(picked.competitors) ? picked.competitors.map(clean) : []).filter(
        (n) => n && lower.includes(n.toLowerCase()) && n.toLowerCase() !== intent.company?.toLowerCase(),
      )
      if (grounded.length) intent.competitors = [...new Set(grounded)].slice(0, Math.min(list ? 5 : 4, maxCompetitors))
    }
  }
  return intent
}

/** Validates an intent sent back by the browser (after the user edited it). */
export function validateIntent(input: unknown, maxCompetitors: number): Intent | null {
  if (!input || typeof input !== 'object') return null
  const i = input as Record<string, unknown>
  const intent = normaliseIntent(
    { type: String(i.type ?? ''), company: (i.company as string) ?? null, competitors: i.competitors, timeRange: String(i.timeRange ?? ''), dimensions: i.dimensions, topic: (i.topic as string) ?? null, fields: i.fields, sites: i.sites },
    String(i.query ?? ''),
    maxCompetitors,
  )
  if (!intent.competitors.length || !intent.query) return null
  return intent
}
