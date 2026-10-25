import type { Llm } from '../llm/llm.ts'
import type { Fetcher } from '../sources/fetcher.ts'
import { extractHtml, type Link } from '../sources/html.ts'
import { baseDomain, hostOf } from '../sources/net.ts'
import { rangeDays, type SearchHit, type SearchStack } from '../sources/search.ts'
import { detectAccounts, type Account, type Platform, type Social, type SocialProfile } from '../sources/social.ts'
import type { Dimension, Lang, SiteMethod, SourceKind, TimeRange } from '../types.ts'
import { T } from './i18n.ts'

/** One piece of evidence the model may quote from. */
export interface Doc {
  id: string
  kind: SourceKind
  url: string
  title: string
  text: string
  /** HTTP status for fetched pages; 200 for API / search results. */
  status: number
  date?: string
  /** Search rank, for SEO docs. */
  rank?: number
  query?: string
  /** An official page read through a search engine's index (the site refused direct reading or renders with JavaScript). */
  via?: 'search'
}

export interface Bundle {
  name: string
  domain: string
  home?: string
  docs: Doc[]
  links: Link[]
  accounts: Account[]
  profiles: SocialProfile[]
  news: SearchHit[]
  fetchedUrls: Set<string>
  /** The official site was identified but refused direct reading. */
  blocked?: boolean
  /** How the official site was identified. */
  siteMethod?: SiteMethod
}

export interface CollectDeps {
  fetcher: Fetcher
  search: SearchStack
  social: Social
  lang: Lang
  /** Used for official-domain hints; without it only search results decide. */
  llm?: Llm
  /** What kind of thing the subjects are, e.g. "SaaS 协作工具" (helps the domain hints). */
  topic?: string
  /** What the user cares about, in their words (custom fields): added to pricing searches. */
  focus?: string[]
  /** Progress lines while collecting (shown live in the studio). */
  onStep?: (text: string) => void
}

/** Sites that are about a company but are never its own website. */
const THIRD_PARTY =
  /(^|\.)(wikipedia\.org|wikiwand\.com|baike\.baidu\.com|baike\.com|baidu\.com|sogou\.com|so\.com|bing\.com|g2\.com|capterra\.com|crunchbase\.com|linkedin\.com|facebook\.com|x\.com|twitter\.com|youtube\.com|reddit\.com|zhihu\.com|github\.com|producthunt\.com|trustradius\.com|getapp\.com|softwareadvice\.com|medium\.com|quora\.com|bloomberg\.com|forbes\.com|techcrunch\.com|weibo\.com|csdn\.net|36kr\.com|similarweb\.com|zoominfo\.com|glassdoor\.com|indeed\.com|pitchbook\.com|tracxn\.com|owler\.com|alternativeto\.net|saasworthy\.com|gartner\.com|chinaz\.com|cnblogs\.com|jianshu\.com|woshipm\.com|smzdm\.com|zol\.com\.cn|pconline\.com\.cn|ithome\.com|huxiu\.com|sspai\.com)$/

/** Big platforms hosting many products: only the exact product sub-site named by a hint can be official (docs.qq.com, meet.google.com). */
const PLATFORM = /(^|\.)(qq\.com|google\.com|apple\.com|amazon\.com|163\.com|sohu\.com|sina\.com\.cn|aliyun\.com|alibaba\.com|baidu\.com)$/

/** Link directories, download portals, app mirrors: never an official site, whatever their title says. */
const AGGREGATOR = /(^|\.)hao\.|daohang|xiazai|download|downxia|onlinedown|xitongzhijia|(^|\.)pc6\.com|cr173|crsky|ddooo|duote|itmop|itotii|apkpure|uptodown|softonic|filehippo|(^|\.)nav\./

const squash = (s: string) => s.toLowerCase().normalize('NFKC').replace(/\.(com|io|ai|app|co|net|org|cn|so|im|me|us|dev)$/, '').replace(/[^a-z0-9一-鿿]/g, '')

/** Official-domain hints: known domains and romanised / English brand names (飞书 → feishu.cn, Feishu, Lark). */
export interface SiteHints {
  domains: string[]
  aliases: string[]
}

const bareDomain = (d: string) => d.replace(/^https?:\/\//, '').replace(/^www\./, '').replace(/\/.*$/, '').toLowerCase()

/** The hinted domain a host belongs to, if any (docs.qq.com → docs.qq.com, job.dingtalk.com → dingtalk.com). */
export function matchedHint(host: string, domains: string[]): string | undefined {
  const h = host.replace(/^www\./, '').toLowerCase()
  return domains.map(bareDomain).find((x) => !!x && (h === x || h.endsWith(`.${x}`)))
}
export const hostMatches = (host: string, domains: string[]) => !!matchedHint(host, domains)

export type SiteVerdict = { origin: string; score: number } | undefined

/**
 * Scores one search result as the official site of `name`.
 * The domain must carry the brand (or be a hinted domain); a matching page title alone is not enough,
 * because link directories title their pages "Notion 官网".
 */
export function scoreOfficial(name: string, hit: SearchHit, hints: SiteHints = { domains: [], aliases: [] }): number {
  const host = hostOf(hit.url)
  if (!host) return -1
  const hinted = hostMatches(host, hints.domains)
  if (AGGREGATOR.test(host)) return -1
  if (THIRD_PARTY.test(host) && !hinted) return -1
  if (PLATFORM.test(host) && !hinted) return -1
  const label = squash(baseDomain(host).split('.')[0])
  const tokens = [name, ...hints.aliases].map(squash).filter((t) => t.length >= 2)
  let score = 0
  if (hinted) score += 5
  if (tokens.some((t) => t === label)) score += 5
  // near matches only: getcoda / codahq yes, codacomms or marketingforindustry no
  else if (tokens.some((t) => (t.length >= 4 && label.includes(t) && label.length - t.length <= 3) || (label.length >= 5 && t.includes(label) && t.length - label.length <= 6))) score += 2
  if (hit.position <= 3) score += 1
  if (tokens.some((t) => squash(hit.title).includes(t))) score += 1
  return score
}

/** Picks the official website for a product name from search results (strong matches only; weak ones need verification). */
export function pickOfficialSite(name: string, hits: SearchHit[], hints?: SiteHints, min = 4, hintedOnly = false): string | undefined {
  if (/^[a-z0-9-]+(\.[a-z0-9-]+)+$/i.test(name.trim())) return `https://${name.trim().toLowerCase()}`
  let best: { url: string; score: number } | undefined
  for (const h of hits) {
    if (hintedOnly && !hostMatches(hostOf(h.url), hints?.domains ?? [])) continue
    const score = scoreOfficial(name, h, hints)
    if (score >= min && (!best || score > best.score)) best = { url: h.url, score }
  }
  if (!best) return undefined
  // a hit on a sub-site of the hinted domain (job.dingtalk.com) stands for the domain's own home page
  const host = hostOf(best.url)
  const hint = hints && matchedHint(host, hints.domains)
  return hint && host.replace(/^www\./, '') !== hint ? `https://${hint}` : new URL(best.url).origin
}

/** Is this host a rejected look-alike (directory, download site) rather than the official site? */
export const isAggregator = (host: string) => AGGREGATOR.test(host)

const isLatin = (s: string) => /^[\x20-\x7E]+$/.test(s.trim())

/** Could this site be anyone's official site at all? (not a directory, review, wiki or news site) */
const canBeOfficial = (url: string) => {
  const host = hostOf(url)
  return !!host && !AGGREGATOR.test(host) && !THIRD_PARTY.test(host)
}

/** Google's knowledge-graph panel is about this subject (its title is the name or one of its aliases). */
export function panelMatches(title: string | undefined, names: string[]): boolean {
  if (!title) return false
  const t = squash(title)
  return names.map(squash).some((n) => n.length >= 2 && (t === n || t.startsWith(n) || n.startsWith(t)))
}

/** A Wikidata website is trusted when it agrees with the hints, or carries the brand, or there were no hints to disagree with. */
export function wikidataAgrees(website: string, name: string, hints: SiteHints): boolean {
  const host = hostOf(website)
  if (!host || !canBeOfficial(website)) return false
  if (!hints.domains.length) return true
  if (hostMatches(host, hints.domains)) return true
  const label = squash(baseDomain(host).split('.')[0])
  return [name, ...hints.aliases].map(squash).some((t) => t === label)
}

/** Asks the model which domains the brand officially uses. Only a hint: every domain is checked against search results or the site itself. */
export async function siteHints(llm: Llm | undefined, name: string, topic?: string): Promise<SiteHints> {
  if (!llm) return { domains: [], aliases: [] }
  try {
    const out = await llm.json<{ domains?: unknown; aliases?: unknown }>({
      task: 'site',
      system:
        'You name the official website domains of a company or product, and its brand names in Latin script. Output JSON only. Include the main product domain first, then regional or parent-brand domains that host the same product. Use only domains you are sure of; if unsure return empty lists. Never return directories, app stores, Wikipedia or news sites.',
      user: `Product: ${name}${topic ? ` (${topic})` : ''}\nReturn JSON like {"domains":["feishu.cn","larksuite.com"],"aliases":["Feishu","Lark"]}`,
      maxTokens: 150,
    })
    const list = (v: unknown) => (Array.isArray(v) ? v.map((x) => String(x ?? '').trim()).filter((x) => x && x.length < 60) : [])
    return {
      domains: list(out.domains).filter((d) => /^([a-z0-9.-]+\.[a-z]{2,}|\d{1,3}(\.\d{1,3}){3})(\/[\w-]*)?$/i.test(d.replace(/^https?:\/\//, ''))).slice(0, 4),
      aliases: list(out.aliases).slice(0, 4),
    }
  } catch {
    return { domains: [], aliases: [] }
  }
}

/** Page types worth reading per field, with link-text / path hints in both languages. */
export const PAGE_HINTS: Record<'pricing' | 'about' | 'contact' | 'product', { re: RegExp; guesses: string[] }> = {
  pricing: { re: /pricing|plans?\b|price|定价|价格|套餐|购买|付费/i, guesses: ['/pricing', '/plans', '/price'] },
  about: { re: /about|company|who-we-are|关于|公司介绍|企业介绍/i, guesses: ['/about', '/about-us', '/company'] },
  contact: { re: /contact|sales|support|联系|商务合作|销售/i, guesses: ['/contact', '/contact-us', '/contact-sales'] },
  product: { re: /features?|product|platform|功能|产品/i, guesses: ['/features', '/product'] },
}

export const FIELD_PAGES: Partial<Record<Dimension, (keyof typeof PAGE_HINTS)[]>> = {
  overview: ['about'],
  size: ['about'],
  funding: ['about'],
  pricing: ['pricing'],
  features: ['product', 'pricing'],
  region: ['about', 'contact'],
  contact: ['contact', 'about'],
}

let docSeq = 0
const nextId = () => `D${++docSeq}`
export const resetDocIds = () => {
  docSeq = 0
}

/** Fetches one official page and turns it into a Doc (plus its links). */
export async function fetchSiteDoc(deps: CollectDeps, b: Bundle, url: string, kind: 'site' | 'web' = 'site'): Promise<Doc | undefined> {
  if (b.fetchedUrls.has(url)) return undefined
  b.fetchedUrls.add(url)
  const page = await deps.fetcher.get(url, { lang: deps.lang })
  if (page.status !== 200 || !/html|text\/plain/i.test(page.contentType || 'text/html')) return undefined
  const ex = extractHtml(page.body, page.url)
  let text = ex.text
  // JavaScript-rendered pages: almost no text, or a pricing page that shows no price
  if (text.length < 300 || (PAGE_HINTS.pricing.re.test(new URL(page.url).pathname) && !hasPrice(text))) {
    const rendered = await deps.fetcher.rendered(page.url)
    if (rendered && rendered.length > text.length) text = rendered
  }
  const mails = ex.links.filter((l) => l.url.startsWith('mailto:')).map((l) => l.url.slice(7).split('?')[0])
  if (mails.length) text += `\n${[...new Set(mails)].join(' ')}`
  if (ex.description) text = `${ex.description}\n${text}`
  // links on the subject's own site are used to find its pages and social accounts; other sites' links are not
  if (kind === 'site') b.links.push(...ex.links)
  const doc: Doc = { id: nextId(), kind, url: page.url, title: ex.title || hostOf(page.url), text, status: 200, ...(ex.date ? { date: ex.date } : {}) }
  b.docs.push(doc)
  return doc
}

/**
 * One specific pricing search per company: the template's points (plans, per-user price, billing, free plan)
 * and what the user asked about are in the query, so the results are pricing pages, not general articles.
 */
export function pricingQuery(name: string, lang: Lang, focus: string[] = []): string {
  const extra = focus.slice(0, 3).join(' ')
  return (lang === 'zh' ? `${name} 定价 套餐 价格 每人每月 年付 免费版 ${extra}` : `${name} pricing plans per user per month billed annually free plan ${extra}`).trim()
}

/** A third-party page counts for pricing only when it shows an update date within the last 12 months. */
export const freshEnough = (date: string | undefined, days = 365) => {
  const t = Date.parse(date ?? '')
  return !Number.isNaN(t) && Date.now() - t <= days * 86400000
}

/** Does the text state a price? ($9, ¥360, 360元, €10/month, per user per month …) */
export const hasPrice = (text: string) => /[$€£¥￥]\s?\d|\d+(\.\d+)?\s?(元|美元|usd|eur|\/\s?(月|年|mo|month|user|seat))|per (user|seat|member|month)|每(人|用户|席位|月)/i.test(text)

/** Candidate official URLs for a page type: matching links first, then common paths. */
export function candidateUrls(b: Bundle, kinds: (keyof typeof PAGE_HINTS)[], withGuesses: boolean): string[] {
  if (!b.home) return []
  const home = new URL(b.home)
  const base = baseDomain(home.hostname)
  const out: string[] = []
  for (const k of kinds) {
    const { re, guesses } = PAGE_HINTS[k]
    for (const l of b.links) {
      if (l.url.startsWith('mailto:')) continue
      let u: URL
      try {
        u = new URL(l.url)
      } catch {
        continue
      }
      if (baseDomain(u.hostname) !== base) continue
      if (re.test(u.pathname) || re.test(l.text)) out.push(`${u.origin}${u.pathname}`)
    }
    if (withGuesses) for (const g of guesses) out.push(`${home.origin}${g}`)
  }
  return [...new Set(out)].filter((u) => !b.fetchedUrls.has(u))
}

async function pool<T, R>(items: T[], n: number, fn: (t: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length)
  let i = 0
  await Promise.all(
    Array.from({ length: Math.min(n, items.length) }, async () => {
      while (i < items.length) {
        const idx = i++
        out[idx] = await fn(items[idx])
      }
    }),
  )
  return out
}

/** Hosts whose pages are not worth reading as text (video, social feeds, login walls). */
const NOT_READABLE = /(^|\.)(youtube\.com|youtu\.be|bilibili\.com|x\.com|twitter\.com|facebook\.com|instagram\.com|tiktok\.com|douyin\.com|linkedin\.com|weibo\.com|xiaohongshu\.com|pinterest\.com)$/

/** Search one custom field and read the best result pages. Official-site results count as "site", others as "web". */
export async function collectField(deps: CollectDeps, b: Bundle, label: string, pages = 2): Promise<Doc[]> {
  const { search, lang } = deps
  const q = `${b.name} ${label}`
  const hits = await search.web(q, { lang, num: 8 })
  for (const h of hits.slice(0, 4)) {
    if (b.docs.some((d) => d.kind === 'seo' && d.url === h.url && d.query === q)) continue
    b.docs.push({ id: nextId(), kind: 'seo', url: h.url, title: h.title, text: `${h.title}\n${h.snippet}`, status: 200, rank: h.position, query: q, date: h.date })
  }
  const base = b.home ? baseDomain(hostOf(b.home)) : ''
  const readable = hits.filter((h) => {
    const host = hostOf(h.url)
    return host && !NOT_READABLE.test(host) && !/\.pdf($|\?)/i.test(h.url) && !b.fetchedUrls.has(h.url)
  })
  const picked = readable.slice(0, pages)
  const got = await pool(picked, 2, (h) => fetchSiteDoc(deps, b, h.url, base && baseDomain(hostOf(h.url)) === base ? 'site' : 'web'))
  return got.filter((d): d is Doc => !!d)
}

/** Search words for the company-information fields read from web pages and news (third-party sources are fine for these). */
export const INFO_SEARCH: Record<'size' | 'funding', Record<Lang, string>> = {
  size: { zh: '员工人数 公司规模', en: 'number of employees company size' },
  funding: { zh: '融资 轮 投资方 估值', en: 'funding round raised investors valuation' },
}

/** Step 2: official site + search ranking + news + social (+ pages for custom fields) for one subject. `knownDomain`: an official site already confirmed (carried over). */
export async function collect(deps: CollectDeps, name: string, dims: Dimension[], timeRange: TimeRange, fields: string[] = [], knownDomain?: string): Promise<Bundle> {
  const { search, lang } = deps
  const b: Bundle = { name, domain: '', docs: [], links: [], accounts: [], profiles: [], news: [], fetchedUrls: new Set() }
  const t = T[lang]
  const step = (text: string) => deps.onStep?.(text)
  step(t.stepSite(name))

  // official website, from the most reliable source down; how it was found is recorded for the audit.
  // A domain confirmed in an earlier run (e.g. "find competitors" → details) is used as is.
  const known = knownDomain && /^[a-z0-9.-]+\.[a-z]{2,}$|^\d{1,3}(\.\d{1,3}){3}(:\d+)?$/i.test(knownDomain) ? knownDomain : undefined
  const hints = known ? { domains: [known], aliases: [] } : await siteHints(deps.llm, name, deps.topic)
  const names = [name, ...hints.aliases]
  // a Latin-script name (or alias) is also searched on Google in English: Chinese search often lists no official site for English brands
  const latin = isLatin(name) ? name : hints.aliases.find(isLatin)
  const google = !known && latin && search.google ? await search.google(`${latin} official website`) : undefined
  const siteHits = known ? [] : lang === 'en' && google && latin === name ? google.hits : await search.web(lang === 'zh' ? `${name} 官网` : `${name} official website`, { lang, num: 10 })
  const allHits = google && google.hits !== siteHits ? [...siteHits, ...google.hits] : siteHits
  for (const h of siteHits.slice(0, 3)) {
    const host = hostOf(h.url)
    if (host && isAggregator(host)) step(t.siteRejected(name, host))
  }
  let home: string | undefined
  let method: SiteMethod | undefined
  const found = (url: string | undefined, m: SiteMethod) => {
    if (!home && url) {
      home = url
      method = m
    }
  }
  if (known) found(`${/^\d/.test(known) ? 'http' : 'https'}://${known}`, 'given')
  // 1) Google's own knowledge-graph panel for this brand
  if (google?.website && panelMatches(google.title, names) && canBeOfficial(google.website)) found(new URL(google.website).origin, 'google_kg')
  // 2) the official website listed on Wikidata
  if (!home && search.wikidata) {
    const agreed = (await search.wikidata(names.slice(0, 2))).find((w) => wikidataAgrees(w.website, name, hints))
    if (agreed) found(new URL(agreed.website).origin, 'wikidata')
  }
  // 3) a hinted domain that the search results confirm
  if (!home) found(pickOfficialSite(name, allHits, hints, 5, true), 'search_hint')
  // 4) a hinted domain the results did not show: accept it only if the site itself, or search's copy of it, names the brand
  if (!home) {
    const lower = names.map((n) => n.toLowerCase())
    for (const d of hints.domains) {
      const bare = d.replace(/^https?:\/\//, '').replace(/\/.*$/, '')
      const page = await deps.fetcher.get(`https://${bare}`, { lang })
      if (page.status === 200 && lower.some((n) => page.body.toLowerCase().includes(n))) {
        found(new URL(page.url).origin, 'hint_verified')
        break
      }
      const own = await search.web(`site:${bare} ${name}`, { lang, num: 5 })
      if (own.some((h) => hostMatches(hostOf(h.url), [bare]) && lower.some((n) => `${h.title} ${h.snippet}`.toLowerCase().includes(n)))) {
        found(`https://${bare}`, 'hint_verified')
        break
      }
    }
  }
  // 5) a domain that is exactly the brand (zendesk.co.jp for Zendesk)
  if (!home) found(pickOfficialSite(name, allHits, hints, 5), 'search_domain')
  // 6) weaker matches only when the model had no domain to offer: a hinted domain that could not be confirmed means "no official site", not a guess
  if (!home && !hints.domains.length) found(pickOfficialSite(name, allHits, hints, 4), 'search_weak')
  b.siteMethod = method
  if (home) {
    const doc = await fetchSiteDoc(deps, b, home)
    b.home = doc?.url ?? home
    b.domain = hostOf(b.home)
    if (!doc) {
      // identified but refused direct reading (bot protection): keep the domain, read its pages through search
      b.blocked = true
      step(t.siteBlocked(name, b.domain))
    }
  }

  // key official pages for the requested fields
  if (b.home) {
    const kinds = new Set<keyof typeof PAGE_HINTS>()
    for (const d of dims) for (const k of FIELD_PAGES[d] ?? []) kinds.add(k)
    const urls = candidateUrls(b, [...kinds], false).slice(0, 6)
    if (urls.length) step(t.stepPages(name, urls.length + 1))
    await pool(urls, 3, (u) => fetchSiteDoc(deps, b, u))
    // a page type with no matching link: try its usual path once
    for (const k of kinds) {
      const has = b.docs.some((d) => d.kind === 'site' && PAGE_HINTS[k].re.test(new URL(d.url).pathname))
      if (!has) {
        const guess = candidateUrls(b, [k], true).find((u) => PAGE_HINTS[k].guesses.some((g) => u.endsWith(g)))
        if (guess) await fetchSiteDoc(deps, b, guess)
      }
    }
  }

  // pricing the official pages did not show (blocked or rendered with JavaScript): the search engine's copy of the official pricing pages
  if (b.domain && dims.includes('pricing') && !b.docs.some((d) => d.kind === 'site' && hasPrice(d.text))) {
    const base = baseDomain(b.domain)
    const hits = await search.web(`${name} ${lang === 'zh' ? '定价 价格' : 'pricing plans'} site:${base}`, { lang, num: 8 })
    const own = hits.filter((h) => baseDomain(hostOf(h.url)) === base)
    for (const h of own.slice(0, 5)) {
      b.docs.push({ id: nextId(), kind: 'site', via: 'search', url: h.url, title: h.title, text: `${h.title}\n${h.snippet}`, status: 200, date: h.date })
    }
    // a pricing page the site did not link to: read it directly too
    const page = own.find((h) => PAGE_HINTS.pricing.re.test(new URL(h.url).pathname) && !b.fetchedUrls.has(h.url))
    if (page) await fetchSiteDoc(deps, b, page.url)
    if (own.length) step(t.siteSnippets(name, Math.min(own.length, 5)))
  }

  // search ranking (SEO) for pricing / features keywords
  const seoQueries: string[] = []
  if (dims.includes('overview')) seoQueries.push(lang === 'zh' ? `${name} 是什么 公司介绍` : `what is ${name}`)
  const pq = pricingQuery(name, lang, deps.focus)
  if (dims.includes('pricing')) seoQueries.push(pq)
  if (dims.includes('features')) seoQueries.push(`${name} features`)
  if (dims.includes('region') || dims.includes('contact')) seoQueries.push(lang === 'zh' ? `${name} 公司 总部` : `${name} company headquarters`)
  if (seoQueries.length) step(t.stepSeo(name))
  let pricingHits: SearchHit[] = []
  for (const q of seoQueries) {
    const hits = await search.web(q, { lang, num: q === pq ? 8 : 6 })
    if (q === pq) pricingHits = hits
    for (const h of hits.slice(0, 5)) {
      b.docs.push({ id: nextId(), kind: 'seo', url: h.url, title: h.title, text: `${h.title}\n${h.snippet}`, status: 200, rank: h.position, query: q, date: h.date })
    }
  }

  // still no readable official price: read up to two dated third-party pricing pages (labelled as third party in the results)
  if (dims.includes('pricing') && !b.docs.some((d) => d.kind === 'site' && hasPrice(d.text))) {
    const base = b.domain ? baseDomain(b.domain) : ''
    const candidates = pricingHits.filter((h) => {
      const host = hostOf(h.url)
      return host && (!base || baseDomain(host) !== base) && !AGGREGATOR.test(host) && !NOT_READABLE.test(host) && !/\.pdf($|\?)/i.test(h.url) && !b.fetchedUrls.has(h.url)
    })
    const read: Doc[] = []
    for (const h of candidates.slice(0, 4)) {
      if (read.length >= 2) break
      const doc = await fetchSiteDoc(deps, b, h.url, 'web')
      if (!doc) continue
      if (!doc.date && h.date) doc.date = h.date.slice(0, 10)
      if (hasPrice(doc.text)) read.push(doc)
    }
    if (read.length) step(t.thirdParty(name, read.length))
  }

  // company size and funding: official about page (above), plus search results, news articles and other web pages
  for (const k of ['size', 'funding'] as const) {
    if (dims.includes(k)) await collectField(deps, b, INFO_SEARCH[k][lang], 2)
  }

  // custom fields: search each one and read the top pages
  if (fields.length) {
    step(t.stepFields(name, fields.length))
    await pool(fields, 2, (f) => collectField(deps, b, f, fields.length > 3 ? 1 : 2))
  }

  // news
  if (dims.includes('news')) {
    const range: TimeRange = timeRange === 'all' ? '90d' : timeRange
    const hits = await search.news(name, { lang, num: 12, timeRange: range })
    const cutoff = Date.now() - rangeDays(range) * 86400000
    b.news = hits.filter((h) => !h.date || Date.parse(h.date) >= cutoff || Number.isNaN(Date.parse(h.date))).slice(0, 10)
    for (const h of b.news) b.docs.push({ id: nextId(), kind: 'news', url: h.url, title: h.title, text: `${h.title}\n${h.snippet}`, status: 200, date: h.date })
    step(t.stepNews(name, b.news.length))
  }

  // social accounts linked from the official site, read through official APIs
  if (dims.includes('social')) {
    step(t.stepSocial(name))
    const official = b.home ? b.links.filter((l) => !l.url.startsWith('mailto:')) : []
    b.accounts = detectAccounts(official).slice(0, 6)
    const readable = b.accounts.filter((a) => ['x', 'youtube', 'reddit'].includes(a.platform)).slice(0, 3)
    const sinceDays = timeRange === 'all' ? 90 : rangeDays(timeRange)
    b.profiles = await Promise.all(readable.map((a) => deps.social.profile(a, sinceDays)))
    for (const p of b.profiles) for (const post of p.posts.slice(0, 8)) {
      b.docs.push({ id: nextId(), kind: 'social', url: post.url, title: `${p.account.platform} ${p.account.handle}`, text: post.text, status: 200, date: post.date })
    }
    // platforms without an open API: read the public pages search engines have indexed
    const apiRead = new Set<string>(b.profiles.filter((p) => p.posts.length).map((p) => p.account.platform))
    const days = timeRange === 'all' ? 90 : rangeDays(timeRange)
    for (const target of searchSocialTargets(lang, apiRead)) {
      const hits = await search.web(`site:${target.site} ${name}`, { lang, num: 8, timeRange: timeRange === 'all' ? '90d' : timeRange })
      const host = target.site.split('/')[0]
      for (const h of hits.filter((x) => hostOf(x.url).endsWith(host) && (!x.date || Number.isNaN(Date.parse(x.date)) || Date.parse(x.date) >= Date.now() - days * 86400000)).slice(0, 4)) {
        b.docs.push({ id: nextId(), kind: 'social', url: h.url, title: `${target.platform} · ${h.title}`, text: `${h.title}\n${h.snippet}`, status: 200, date: h.date })
      }
    }
  }

  return b
}

/** Social sites read through search results instead of an API, per language. */
export function searchSocialTargets(lang: Lang, readByApi: Set<string>): { platform: Platform; site: string }[] {
  const en: { platform: Platform; site: string }[] = [
    { platform: 'linkedin', site: 'linkedin.com/posts' },
    { platform: 'x', site: 'x.com' },
  ]
  const zh: { platform: Platform; site: string }[] = [
    { platform: 'weibo', site: 'weibo.com' },
    { platform: 'wechat', site: 'mp.weixin.qq.com' },
    { platform: 'xiaohongshu', site: 'xiaohongshu.com' },
    { platform: 'linkedin', site: 'linkedin.com/posts' },
  ]
  return (lang === 'zh' ? zh : en).filter((t) => !readByApi.has(t.platform))
}

export const countKinds = (b: Bundle) => ({
  site: b.docs.filter((d) => d.kind === 'site').length,
  web: b.docs.filter((d) => d.kind === 'web').length,
  seo: b.docs.filter((d) => d.kind === 'seo').length,
  news: b.docs.filter((d) => d.kind === 'news').length,
  social: b.docs.filter((d) => d.kind === 'social').length + b.accounts.length,
})
