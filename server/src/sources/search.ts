import type { Config, NewsProviderName, SearchProviderName } from '../config.ts'
import { cached, type Db } from '../db/db.ts'
import type { Lang, TimeRange } from '../types.ts'

export interface SearchHit {
  title: string
  url: string
  snippet: string
  position: number
  date?: string
  source?: string
}

export interface SearchOpts {
  lang: Lang
  num?: number
  timeRange?: TimeRange
}

export interface SearchProvider {
  name: string
  web(q: string, o: SearchOpts): Promise<SearchHit[]>
  news?(q: string, o: SearchOpts): Promise<SearchHit[]>
}

export const DAYS: Record<TimeRange, number> = { all: 36500, '7d': 7, '30d': 30, '90d': 90, ytd: 366 }
export function rangeDays(r: TimeRange): number {
  if (r !== 'ytd') return DAYS[r]
  const now = new Date()
  return Math.ceil((now.getTime() - Date.UTC(now.getUTCFullYear(), 0, 1)) / 86400000) || 1
}

async function postJson(url: string, headers: Record<string, string>, body: unknown): Promise<unknown> {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headers },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(20000),
  })
  if (!res.ok) throw new Error(`search_http_${res.status}`)
  return res.json()
}

/* ---------- Serper (Google results) ---------- */
function serper(key: string): SearchProvider {
  const tbs = (r?: TimeRange) =>
    !r || r === 'all' ? undefined : r === '7d' ? 'qdr:w' : r === '30d' ? 'qdr:m' : r === '90d' ? 'qdr:m3' : 'qdr:y'
  const loc = (lang: Lang) => (lang === 'zh' ? { gl: 'cn', hl: 'zh-cn' } : { gl: 'us', hl: 'en' })
  return {
    name: 'serper',
    async web(q, o) {
      const data = (await postJson('https://google.serper.dev/search', { 'X-API-KEY': key }, { q, num: o.num ?? 10, tbs: tbs(o.timeRange), ...loc(o.lang) })) as {
        organic?: { title: string; link: string; snippet?: string; position?: number; date?: string }[]
      }
      return (data.organic ?? []).map((r, i) => ({ title: r.title, url: r.link, snippet: r.snippet ?? '', position: r.position ?? i + 1, date: r.date }))
    },
    async news(q, o) {
      const data = (await postJson('https://google.serper.dev/news', { 'X-API-KEY': key }, { q, num: o.num ?? 10, tbs: tbs(o.timeRange), ...loc(o.lang) })) as {
        news?: { title: string; link: string; snippet?: string; date?: string; source?: string; position?: number }[]
      }
      return (data.news ?? []).map((r, i) => ({ title: r.title, url: r.link, snippet: r.snippet ?? '', position: r.position ?? i + 1, date: r.date, source: r.source }))
    },
  }
}

/* ---------- Bocha (博查, mainland China) ---------- */
function bocha(key: string): SearchProvider {
  const fresh = (r?: TimeRange) => (!r || r === 'all' ? 'noLimit' : r === '7d' ? 'oneWeek' : r === '30d' ? 'oneMonth' : 'oneYear')
  const call = async (q: string, o: SearchOpts) => {
    const data = (await postJson('https://api.bochaai.com/v1/web-search', { Authorization: `Bearer ${key}` }, {
      query: q,
      freshness: fresh(o.timeRange),
      summary: true,
      count: o.num ?? 10,
    })) as { data?: { webPages?: { value?: { name: string; url: string; snippet?: string; summary?: string; siteName?: string; datePublished?: string }[] } } }
    return (data.data?.webPages?.value ?? []).map((r, i) => ({
      title: r.name,
      url: r.url,
      snippet: r.summary || r.snippet || '',
      position: i + 1,
      date: r.datePublished,
      source: r.siteName,
    }))
  }
  return { name: 'bocha', web: call, news: call }
}

/* ---------- Google News RSS (no key) ---------- */
export function parseRss(xml: string): SearchHit[] {
  const items: SearchHit[] = []
  const tag = (block: string, name: string) => {
    const m = new RegExp(`<${name}[^>]*>([\\s\\S]*?)</${name}>`, 'i').exec(block)
    return m ? m[1].replace(/^<!\[CDATA\[|\]\]>$/g, '').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").trim() : ''
  }
  for (const m of xml.matchAll(/<item>([\s\S]*?)<\/item>/gi)) {
    const b = m[1]
    const pub = tag(b, 'pubDate')
    items.push({
      title: tag(b, 'title'),
      url: tag(b, 'link'),
      snippet: tag(b, 'description').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 300),
      position: items.length + 1,
      date: pub ? new Date(pub).toISOString() : undefined,
      source: tag(b, 'source'),
    })
  }
  return items
}

function googleNews(): SearchProvider {
  const news = async (q: string, o: SearchOpts) => {
    const when = o.timeRange && o.timeRange !== 'all' ? ` when:${rangeDays(o.timeRange)}d` : ''
    const loc = o.lang === 'zh' ? 'hl=zh-CN&gl=CN&ceid=CN:zh-Hans' : 'hl=en-US&gl=US&ceid=US:en'
    const res = await fetch(`https://news.google.com/rss/search?q=${encodeURIComponent(q + when)}&${loc}`, { signal: AbortSignal.timeout(15000) })
    if (!res.ok) throw new Error(`news_http_${res.status}`)
    return parseRss(await res.text()).slice(0, o.num ?? 10)
  }
  return { name: 'googlenews', web: news, news }
}

/* ---------- GDELT DOC 2.0 (no key, global) ---------- */
function gdelt(): SearchProvider {
  const news = async (q: string, o: SearchOpts) => {
    const days = o.timeRange && o.timeRange !== 'all' ? Math.min(rangeDays(o.timeRange), 90) : 90
    const url = `https://api.gdeltproject.org/api/v2/doc/doc?query=${encodeURIComponent(`"${q}"`)}&mode=artlist&format=json&sort=datedesc&maxrecords=${o.num ?? 15}&timespan=${days}d`
    const res = await fetch(url, { signal: AbortSignal.timeout(20000) })
    if (!res.ok) throw new Error(`gdelt_http_${res.status}`)
    const text = await res.text()
    if (!text.trim().startsWith('{')) return []
    const data = JSON.parse(text) as { articles?: { url: string; title: string; seendate?: string; domain?: string }[] }
    return (data.articles ?? []).map((a, i) => ({
      title: a.title,
      url: a.url,
      snippet: '',
      position: i + 1,
      date: a.seendate ? a.seendate.replace(/^(\d{4})(\d\d)(\d\d)T(\d\d)(\d\d)(\d\d)Z$/, '$1-$2-$3T$4:$5:$6Z') : undefined,
      source: a.domain,
    }))
  }
  return { name: 'gdelt', web: news, news }
}

export interface SearchStack {
  web(q: string, o: SearchOpts): Promise<SearchHit[]>
  news(q: string, o: SearchOpts): Promise<SearchHit[]>
  calls: number
}

/** Builds the search + news stack for one language, with caching. Providers can be replaced in tests. */
export function createSearch(
  cfg: Config,
  db: Db,
  lang: Lang,
  overrides?: { web?: SearchProvider; news?: SearchProvider[] },
): SearchStack {
  const make = (n: SearchProviderName | NewsProviderName): SearchProvider | undefined => {
    if (n === 'serper' && cfg.keys.serper) return serper(cfg.keys.serper)
    if (n === 'bocha' && cfg.keys.bocha) return bocha(cfg.keys.bocha)
    if (n === 'googlenews') return googleNews()
    if (n === 'gdelt') return gdelt()
    return undefined
  }
  const web = overrides?.web ?? make(cfg.search[lang])
  const news = overrides?.news ?? cfg.news[lang].map(make).filter((p): p is SearchProvider => !!p)
  const ttl = cfg.cacheHours * 3600_000
  const stack: SearchStack = {
    calls: 0,
    async web(q, o) {
      if (!web) return []
      try {
        return await cached(db, `web:${web.name}:${lang}:${o.timeRange ?? 'all'}:${q}`, ttl, async () => {
          stack.calls++
          return web.web(q, o)
        })
      } catch {
        return [] // failures are not cached
      }
    },
    async news(q, o) {
      for (const p of news) {
        let hits: SearchHit[] = []
        try {
          hits = await cached(db, `news:${p.name}:${lang}:${o.timeRange ?? 'all'}:${q}`, ttl, async () => {
            stack.calls++
            return (p.news ?? p.web)(q, o)
          })
        } catch {
          /* try the next provider */
        }
        if (hits.length) return hits
      }
      return []
    },
  }
  return stack
}
