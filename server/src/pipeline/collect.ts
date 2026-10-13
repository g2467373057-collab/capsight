import type { Fetcher } from '../sources/fetcher.ts'
import { extractHtml, type Link } from '../sources/html.ts'
import { baseDomain, hostOf } from '../sources/net.ts'
import { rangeDays, type SearchHit, type SearchStack } from '../sources/search.ts'
import { detectAccounts, type Account, type Platform, type Social, type SocialProfile } from '../sources/social.ts'
import type { Dimension, Lang, SourceKind, TimeRange } from '../types.ts'
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
}

export interface CollectDeps {
  fetcher: Fetcher
  search: SearchStack
  social: Social
  lang: Lang
  /** Progress lines while collecting (shown live in the studio). */
  onStep?: (text: string) => void
}

/** Sites that are about a company but are not its own website. */
const NOT_OFFICIAL =
  /(^|\.)(wikipedia\.org|wikiwand\.com|baike\.baidu\.com|baike\.com|g2\.com|capterra\.com|crunchbase\.com|linkedin\.com|facebook\.com|x\.com|twitter\.com|youtube\.com|reddit\.com|zhihu\.com|github\.com|producthunt\.com|trustradius\.com|getapp\.com|softwareadvice\.com|apple\.com|google\.com|amazon\.com|medium\.com|quora\.com|bloomberg\.com|forbes\.com|techcrunch\.com|sohu\.com|163\.com|qq\.com|weibo\.com|csdn\.net|36kr\.com|similarweb\.com|zoominfo\.com|glassdoor\.com|indeed\.com|pitchbook\.com|tracxn\.com|owler\.com|alternativeto\.net|saasworthy\.com|gartner\.com)$/

const squash = (s: string) => s.toLowerCase().normalize('NFKC').replace(/\.(com|io|ai|app|co|net|org|cn)$/, '').replace(/[^a-z0-9一-鿿]/g, '')

/** Picks the official website for a product name from search results. */
export function pickOfficialSite(name: string, hits: SearchHit[]): string | undefined {
  if (/^[a-z0-9-]+(\.[a-z0-9-]+)+$/i.test(name.trim())) return `https://${name.trim().toLowerCase()}`
  const token = squash(name)
  const candidates = hits.filter((h) => {
    const host = hostOf(h.url)
    return host && !NOT_OFFICIAL.test(host)
  })
  const byName = candidates.find((h) => token && squash(baseDomain(hostOf(h.url))).includes(token))
  const chosen = byName ?? candidates.find((h) => h.position <= 3 && squash(h.title).includes(token))
  if (!chosen) return undefined
  return new URL(chosen.url).origin
}

/** Page types worth reading per field, with link-text / path hints in both languages. */
export const PAGE_HINTS: Record<'pricing' | 'about' | 'contact' | 'product', { re: RegExp; guesses: string[] }> = {
  pricing: { re: /pricing|plans?\b|price|定价|价格|套餐|购买|付费/i, guesses: ['/pricing', '/plans', '/price'] },
  about: { re: /about|company|who-we-are|关于|公司介绍|企业介绍/i, guesses: ['/about', '/about-us', '/company'] },
  contact: { re: /contact|sales|support|联系|商务合作|销售/i, guesses: ['/contact', '/contact-us', '/contact-sales'] },
  product: { re: /features?|product|platform|功能|产品/i, guesses: ['/features', '/product'] },
}

export const FIELD_PAGES: Partial<Record<Dimension, (keyof typeof PAGE_HINTS)[]>> = {
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
export async function fetchSiteDoc(deps: CollectDeps, b: Bundle, url: string): Promise<Doc | undefined> {
  if (b.fetchedUrls.has(url)) return undefined
  b.fetchedUrls.add(url)
  const page = await deps.fetcher.get(url, { lang: deps.lang })
  if (page.status !== 200 || !/html|text\/plain/i.test(page.contentType || 'text/html')) return undefined
  const ex = extractHtml(page.body, page.url)
  let text = ex.text
  if (text.length < 300) {
    const rendered = await deps.fetcher.rendered(page.url)
    if (rendered && rendered.length > text.length) text = rendered
  }
  const mails = ex.links.filter((l) => l.url.startsWith('mailto:')).map((l) => l.url.slice(7).split('?')[0])
  if (mails.length) text += `\n${[...new Set(mails)].join(' ')}`
  if (ex.description) text = `${ex.description}\n${text}`
  b.links.push(...ex.links)
  const doc: Doc = { id: nextId(), kind: 'site', url: page.url, title: ex.title || hostOf(page.url), text, status: 200 }
  b.docs.push(doc)
  return doc
}

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

/** Step 2: official site + search ranking + news + social for one competitor. */
export async function collect(deps: CollectDeps, name: string, dims: Dimension[], timeRange: TimeRange): Promise<Bundle> {
  const { search, lang } = deps
  const b: Bundle = { name, domain: '', docs: [], links: [], accounts: [], profiles: [], news: [], fetchedUrls: new Set() }
  const t = T[lang]
  const step = (text: string) => deps.onStep?.(text)
  step(t.stepSite(name))

  // official website
  const siteHits = await search.web(lang === 'zh' ? `${name} 官网` : `${name} official website`, { lang, num: 8 })
  const home = pickOfficialSite(name, siteHits)
  if (home) {
    const doc = await fetchSiteDoc(deps, b, home)
    if (doc) {
      b.home = doc.url
      b.domain = hostOf(doc.url)
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

  // search ranking (SEO) for pricing / features keywords
  const seoQueries: string[] = []
  if (dims.includes('pricing')) seoQueries.push(`${name} pricing`)
  if (dims.includes('features')) seoQueries.push(`${name} features`)
  if (dims.includes('region') || dims.includes('contact')) seoQueries.push(lang === 'zh' ? `${name} 公司 总部` : `${name} company headquarters`)
  if (seoQueries.length) step(t.stepSeo(name))
  for (const q of seoQueries) {
    const hits = await search.web(q, { lang, num: 6 })
    for (const h of hits.slice(0, 5)) {
      b.docs.push({ id: nextId(), kind: 'seo', url: h.url, title: h.title, text: `${h.title}\n${h.snippet}`, status: 200, rank: h.position, query: q, date: h.date })
    }
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
  seo: b.docs.filter((d) => d.kind === 'seo').length,
  news: b.docs.filter((d) => d.kind === 'news').length,
  social: b.docs.filter((d) => d.kind === 'social').length + b.accounts.length,
})
