import type { Config } from '../config.ts'
import { cached, type Db } from '../db/db.ts'
import type { Link } from './html.ts'

export type Platform = 'x' | 'linkedin' | 'youtube' | 'reddit' | 'weibo' | 'facebook' | 'instagram' | 'tiktok' | 'github' | 'bilibili' | 'xiaohongshu' | 'zhihu' | 'wechat'

export interface Account {
  platform: Platform
  handle: string
  url: string
}

export interface Post {
  platform: Platform
  url: string
  text: string
  date?: string
}

export interface SocialProfile {
  account: Account
  description?: string
  followers?: number
  posts: Post[]
  /** Why posts could not be read (no API key, not supported by the official API …). */
  note?: string
}

const RESERVED = new Set(['share', 'intent', 'home', 'search', 'hashtag', 'i', 'login', 'signup', 'explore', 'settings', 'privacy', 'tos', 'about', 'help', 'watch', 'results', 'feed', 'sharer', 'sharer.php', 'dialog', 'pages', 'groups', 'company', 'in', 'school', 'showcase'])

/** Finds official social accounts among a site's links (usually the footer). */
export function detectAccounts(links: Link[]): Account[] {
  const out = new Map<string, Account>()
  const add = (platform: Platform, handle: string, url: string) => {
    const h = handle.replace(/^@/, '').trim()
    if (!h || RESERVED.has(h.toLowerCase())) return
    const key = `${platform}:${h.toLowerCase()}`
    if (!out.has(key)) out.set(key, { platform, handle: h, url })
  }
  for (const { url } of links) {
    let u: URL
    try {
      u = new URL(url)
    } catch {
      continue
    }
    const host = u.hostname.replace(/^(www|m|mobile)\./, '')
    const seg = u.pathname.split('/').filter(Boolean)
    if (host === 'x.com' || host === 'twitter.com') {
      if (seg[0] && /^[A-Za-z0-9_]{1,15}$/.test(seg[0])) add('x', seg[0], `https://x.com/${seg[0]}`)
    } else if (host === 'linkedin.com' || host.endsWith('.linkedin.com')) {
      if ((seg[0] === 'company' || seg[0] === 'showcase') && seg[1]) add('linkedin', seg[1], `https://www.linkedin.com/company/${seg[1]}`)
    } else if (host === 'youtube.com') {
      if (seg[0]?.startsWith('@')) add('youtube', seg[0], `https://www.youtube.com/${seg[0]}`)
      else if ((seg[0] === 'c' || seg[0] === 'user' || seg[0] === 'channel') && seg[1]) add('youtube', seg[0] === 'channel' ? seg[1] : `@${seg[1]}`, url)
    } else if (host === 'reddit.com') {
      if ((seg[0] === 'r' || seg[0] === 'user' || seg[0] === 'u') && seg[1]) add('reddit', `${seg[0] === 'r' ? 'r' : 'u'}/${seg[1]}`, `https://www.reddit.com/${seg[0] === 'r' ? 'r' : 'user'}/${seg[1]}`)
    } else if (host === 'weibo.com' || host === 'weibo.cn') {
      if (seg[0]) add('weibo', seg[seg.length - 1], url)
    } else if (host === 'facebook.com') {
      if (seg[0] && !seg[0].includes('.php')) add('facebook', seg[0], `https://www.facebook.com/${seg[0]}`)
    } else if (host === 'instagram.com') {
      if (seg[0]) add('instagram', seg[0], `https://www.instagram.com/${seg[0]}`)
    } else if (host === 'tiktok.com') {
      if (seg[0]?.startsWith('@')) add('tiktok', seg[0], url)
    } else if (host === 'github.com') {
      if (seg[0] && seg.length === 1) add('github', seg[0], `https://github.com/${seg[0]}`)
    } else if (host === 'space.bilibili.com') {
      if (seg[0]) add('bilibili', seg[0], url)
    } else if (host === 'xiaohongshu.com') {
      if (seg[0] === 'user' && seg[2]) add('xiaohongshu', seg[2], url)
    } else if (host === 'zhihu.com') {
      if ((seg[0] === 'org' || seg[0] === 'people') && seg[1]) add('zhihu', seg[1], url)
    }
  }
  return [...out.values()]
}

async function getJson(url: string, headers: Record<string, string> = {}): Promise<unknown> {
  const res = await fetch(url, { headers, signal: AbortSignal.timeout(15000) })
  if (!res.ok) throw new Error(`social_http_${res.status}`)
  return res.json()
}

/**
 * Reads recent public posts through each platform's official API.
 * X: API v2 (pay-per-use). YouTube: Data API v3. Reddit: OAuth app-only.
 * LinkedIn and Chinese platforms have no official API for third-party company posts, so only the account link is kept.
 */
export class Social {
  private cfg: Config
  private db: Db
  private redditToken?: { token: string; exp: number }
  calls = 0
  constructor(cfg: Config, db: Db) {
    this.cfg = cfg
    this.db = db
  }

  async profile(a: Account, sinceDays: number): Promise<SocialProfile> {
    const ttl = this.cfg.cacheHours * 3600_000
    const key = `social:${a.platform}:${a.handle.toLowerCase()}:${sinceDays}`
    try {
      return await cached(this.db, key, ttl, async () => {
        if (a.platform === 'x') return this.x(a, sinceDays)
        if (a.platform === 'youtube') return this.youtube(a, sinceDays)
        if (a.platform === 'reddit') return this.reddit(a, sinceDays)
        return { account: a, posts: [], note: 'no_official_api' }
      })
    } catch (e) {
      return { account: a, posts: [], note: (e as Error).message }
    }
  }

  private since(days: number) {
    return new Date(Date.now() - Math.min(days, 365) * 86400000).toISOString()
  }

  private async x(a: Account, days: number): Promise<SocialProfile> {
    const token = this.cfg.keys.xBearer
    if (!token) return { account: a, posts: [], note: 'x_not_configured' }
    const h = { Authorization: `Bearer ${token}` }
    this.calls++
    const user = (await getJson(`https://api.x.com/2/users/by/username/${encodeURIComponent(a.handle)}?user.fields=description,public_metrics,verified`, h)) as {
      data?: { id: string; description?: string; public_metrics?: { followers_count?: number } }
    }
    if (!user.data) return { account: a, posts: [], note: 'x_user_not_found' }
    this.calls++
    const tweets = (await getJson(
      `https://api.x.com/2/users/${user.data.id}/tweets?max_results=${this.cfg.xMaxPosts}&exclude=replies,retweets&post.fields=created_at&start_time=${encodeURIComponent(this.since(days))}`,
      h,
    )) as { data?: { id: string; text: string; created_at?: string }[] }
    return {
      account: a,
      description: user.data.description,
      followers: user.data.public_metrics?.followers_count,
      posts: (tweets.data ?? []).map((t) => ({ platform: 'x', url: `https://x.com/${a.handle}/status/${t.id}`, text: t.text, date: t.created_at })),
    }
  }

  private async youtube(a: Account, days: number): Promise<SocialProfile> {
    const key = this.cfg.keys.youtube
    if (!key) return { account: a, posts: [], note: 'youtube_not_configured' }
    const by = a.handle.startsWith('UC') ? `id=${encodeURIComponent(a.handle)}` : `forHandle=${encodeURIComponent(a.handle)}`
    this.calls++
    const ch = (await getJson(`https://www.googleapis.com/youtube/v3/channels?part=snippet,contentDetails,statistics&${by}&key=${key}`)) as {
      items?: { snippet?: { description?: string }; statistics?: { subscriberCount?: string }; contentDetails?: { relatedPlaylists?: { uploads?: string } } }[]
    }
    const c = ch.items?.[0]
    const uploads = c?.contentDetails?.relatedPlaylists?.uploads
    if (!c || !uploads) return { account: a, posts: [], note: 'youtube_channel_not_found' }
    this.calls++
    const list = (await getJson(`https://www.googleapis.com/youtube/v3/playlistItems?part=snippet&maxResults=10&playlistId=${uploads}&key=${key}`)) as {
      items?: { snippet?: { title?: string; publishedAt?: string; resourceId?: { videoId?: string } } }[]
    }
    const cutoff = Date.now() - days * 86400000
    return {
      account: a,
      description: c.snippet?.description?.slice(0, 300),
      followers: c.statistics?.subscriberCount ? Number(c.statistics.subscriberCount) : undefined,
      posts: (list.items ?? [])
        .map((i) => i.snippet)
        .filter((s) => s?.resourceId?.videoId && (!s.publishedAt || Date.parse(s.publishedAt) >= cutoff))
        .map((s) => ({ platform: 'youtube' as const, url: `https://www.youtube.com/watch?v=${s!.resourceId!.videoId}`, text: s!.title ?? '', date: s!.publishedAt })),
    }
  }

  private async redditAuth(): Promise<string | undefined> {
    const { redditId, redditSecret } = this.cfg.keys
    if (!redditId || !redditSecret) return undefined
    if (this.redditToken && this.redditToken.exp > Date.now() + 60000) return this.redditToken.token
    this.calls++
    const res = await fetch('https://www.reddit.com/api/v1/access_token', {
      method: 'POST',
      headers: {
        Authorization: `Basic ${Buffer.from(`${redditId}:${redditSecret}`).toString('base64')}`,
        'Content-Type': 'application/x-www-form-urlencoded',
        'User-Agent': this.redditUa(),
      },
      body: 'grant_type=client_credentials',
      signal: AbortSignal.timeout(15000),
    })
    if (!res.ok) throw new Error(`reddit_auth_${res.status}`)
    const d = (await res.json()) as { access_token: string; expires_in: number }
    this.redditToken = { token: d.access_token, exp: Date.now() + d.expires_in * 1000 }
    return d.access_token
  }

  private redditUa() {
    return this.cfg.keys.redditUserAgent || 'web:capsight:v1.0 (by /u/capsight)'
  }

  private async reddit(a: Account, days: number): Promise<SocialProfile> {
    const token = await this.redditAuth()
    if (!token) return { account: a, posts: [], note: 'reddit_not_configured' }
    const [kind, name] = a.handle.split('/')
    const path = kind === 'r' ? `/r/${name}/new?limit=10` : `/user/${name}/submitted?limit=10&sort=new`
    this.calls++
    const d = (await getJson(`https://oauth.reddit.com${path}`, { Authorization: `Bearer ${token}`, 'User-Agent': this.redditUa() })) as {
      data?: { children?: { data?: { title?: string; permalink?: string; created_utc?: number; selftext?: string } }[] }
    }
    const cutoff = Date.now() / 1000 - days * 86400
    return {
      account: a,
      posts: (d.data?.children ?? [])
        .map((c) => c.data)
        .filter((p) => p?.permalink && (p.created_utc ?? 0) >= cutoff)
        .map((p) => ({
          platform: 'reddit' as const,
          url: `https://www.reddit.com${p!.permalink}`,
          text: [p!.title, p!.selftext?.slice(0, 200)].filter(Boolean).join(' — '),
          date: p!.created_utc ? new Date(p!.created_utc * 1000).toISOString() : undefined,
        })),
    }
  }
}
