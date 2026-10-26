import type { Config } from '../config.ts'
import { cacheGet, cacheSet, type Db } from '../db/db.ts'
import { assertPublicUrl } from './net.ts'
import { isAllowed, parseRobots, type RobotsRules } from './robots.ts'

export interface Page {
  url: string
  status: number
  contentType: string
  body: string
  fetchedAt: number
  /** Why the page could not be fetched (robots, timeout, private host …). */
  error?: string
}

/**
 * Fetches public web pages for the pipeline: SSRF-checked on every redirect hop,
 * robots.txt respected, size- and time-limited, cached.
 */
export class Fetcher {
  private cfg: Config
  private db: Db
  private robots = new Map<string, Promise<RobotsRules>>()
  constructor(cfg: Config, db: Db) {
    this.cfg = cfg
    this.db = db
  }

  private async raw(url: string, accept = 'text/html,application/xhtml+xml;q=0.9,*/*;q=0.5', lang = 'en'): Promise<Page> {
    let current = url
    for (let hop = 0; hop < 5; hop++) {
      await assertPublicUrl(current, this.cfg.fetch.allowPrivate)
      const res = await fetch(current, {
        redirect: 'manual',
        headers: {
          'User-Agent': this.cfg.fetch.userAgent,
          Accept: accept,
          'Accept-Language': lang === 'zh' ? 'zh-CN,zh;q=0.9,en;q=0.6' : 'en-US,en;q=0.9',
        },
        signal: AbortSignal.timeout(this.cfg.fetch.timeoutMs),
      })
      if (res.status >= 300 && res.status < 400 && res.headers.get('location')) {
        current = new URL(res.headers.get('location')!, current).toString()
        await res.body?.cancel()
        continue
      }
      const contentType = res.headers.get('content-type') ?? ''
      const body = await readLimited(res, this.cfg.fetch.maxBytes)
      return { url: current, status: res.status, contentType, body, fetchedAt: Date.now() }
    }
    throw new Error('too_many_redirects')
  }

  private rulesFor(origin: string): Promise<RobotsRules> {
    let p = this.robots.get(origin)
    if (!p) {
      p = (async () => {
        const key = `robots:${origin}`
        const hit = cacheGet<RobotsRules>(this.db, key)
        if (hit) return hit
        let rules: RobotsRules = { rules: [] }
        try {
          const r = await this.raw(`${origin}/robots.txt`, 'text/plain')
          if (r.status === 200) rules = parseRobots(r.body, this.cfg.fetch.userAgent)
          // 401/403 on robots.txt: treat the whole site as off limits
          if (r.status === 401 || r.status === 403) rules = { rules: [{ allow: false, path: '/' }] }
        } catch {
          /* unreachable robots.txt: allowed */
        }
        cacheSet(this.db, key, rules, 24 * 3600_000)
        return rules
      })()
      this.robots.set(origin, p)
    }
    return p
  }

  /** Fetch one page. Never throws: failures come back as status 0 with `error`. */
  async get(url: string, opts: { lang?: 'zh' | 'en'; useCache?: boolean } = {}): Promise<Page> {
    const key = `page:${url}`
    if (opts.useCache !== false) {
      const hit = cacheGet<Page>(this.db, key)
      if (hit) return hit
    }
    let page: Page
    try {
      const u = new URL(url)
      if (this.cfg.fetch.respectRobots) {
        const rules = await this.rulesFor(u.origin)
        if (!isAllowed(rules, u.pathname + u.search)) {
          return { url, status: 0, contentType: '', body: '', fetchedAt: Date.now(), error: 'robots_disallowed' }
        }
      }
      page = await this.raw(url, undefined, opts.lang)
    } catch (e) {
      return { url, status: 0, contentType: '', body: '', fetchedAt: Date.now(), error: (e as Error).message || 'fetch_failed' }
    }
    if (page.status === 200) cacheSet(this.db, key, page, this.cfg.cacheHours * 3600_000)
    return page
  }

  /** Jina Reader requests actually sent (cache hits excluded), for cost tracking. */
  readerCalls = 0

  /** Optional rendered-text fallback for JavaScript-heavy pages (Jina Reader). */
  async rendered(url: string): Promise<string | undefined> {
    if (this.cfg.fetch.reader !== 'jina') return undefined
    const key = `reader:${url}`
    const hit = cacheGet<string>(this.db, key)
    if (hit) return hit
    try {
      await assertPublicUrl(url, this.cfg.fetch.allowPrivate)
      this.readerCalls++
      const res = await fetch(`https://r.jina.ai/${url}`, {
        headers: { Accept: 'text/plain', ...(this.cfg.keys.jina ? { Authorization: `Bearer ${this.cfg.keys.jina}` } : {}) },
        signal: AbortSignal.timeout(25000),
      })
      if (!res.ok) return undefined
      const text = (await readLimited(res, this.cfg.fetch.maxBytes)).trim()
      if (text) cacheSet(this.db, key, text, this.cfg.cacheHours * 3600_000)
      return text || undefined
    } catch {
      return undefined
    }
  }
}

async function readLimited(res: Response, max: number): Promise<string> {
  if (!res.body) return ''
  const reader = res.body.getReader()
  const chunks: Uint8Array[] = []
  let size = 0
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    size += value.length
    if (size > max) {
      chunks.push(value.slice(0, value.length - (size - max)))
      await reader.cancel()
      break
    }
    chunks.push(value)
  }
  const buf = Buffer.concat(chunks)
  const charset = /charset=([\w-]+)/i.exec(res.headers.get('content-type') ?? '')?.[1]?.toLowerCase()
  try {
    return new TextDecoder(charset && charset !== 'utf8' ? charset : 'utf-8').decode(buf)
  } catch {
    return buf.toString('utf8')
  }
}
