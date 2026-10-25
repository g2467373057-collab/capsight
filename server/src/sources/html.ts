/* Dependency-free HTML → text extraction, tuned for marketing / pricing pages. */

export interface Link {
  url: string
  text: string
}

export interface Extracted {
  title: string
  description: string
  lang: string
  text: string
  links: Link[]
  /** When the page says it was last updated (or published), ISO day; undefined when it does not say. */
  date?: string
}

const isoDay = (v: string | undefined): string | undefined => {
  if (!v) return undefined
  const s = v.trim().replace(/年|月/g, '-').replace(/日/g, '').replace(/\//g, '-').replace(/\.(?=\d)/g, '-')
  const pad = (n: number) => String(n).padStart(2, '0')
  // calendar dates are taken as written, never shifted by time zone
  const ymd = /^(\d{4})-(\d{1,2})-(\d{1,2})/.exec(s)
  let day: string
  if (ymd) day = `${ymd[1]}-${pad(+ymd[2])}-${pad(+ymd[3])}`
  else {
    const t = Date.parse(s)
    if (Number.isNaN(t)) return undefined
    const d = new Date(t)
    day = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
  }
  const t = Date.parse(`${day}T00:00:00Z`)
  // ignore nonsense: before 2000 or more than a day in the future
  if (Number.isNaN(t) || +day.slice(0, 4) < 2000 || t > Date.now() + 86400000) return undefined
  return day
}

/** The page's own "last updated" date: meta tags, JSON-LD, <time>, or an "Updated: …" / "更新于 …" line. Modified beats published. */
export function pageDate(html: string, text = ''): string | undefined {
  const head = html.slice(0, 300_000)
  const meta = (prop: string) => {
    const tag = new RegExp(`<meta[^>]+(?:property|name|itemprop)=["']${prop}["'][^>]*>`, 'i').exec(head)?.[0]
    return tag ? /content=["']([^"']+)/i.exec(tag)?.[1] : undefined
  }
  const ld = (key: string) => new RegExp(`"${key}"\\s*:\\s*"([^"]+)"`, 'i').exec(head)?.[1]
  const modified = meta('article:modified_time') ?? meta('og:updated_time') ?? meta('dateModified') ?? meta('last-modified') ?? ld('dateModified')
  const textual =
    /(?:last\s+updated|updated(?:\s+on)?|更新(?:于|时间|日期)?)[:：\s]*((?:\d{4}[-/.年]\d{1,2}[-/.月]\d{1,2}日?)|(?:[A-Z][a-z]+\.?\s+\d{1,2},?\s+\d{4})|(?:\d{1,2}\s+[A-Z][a-z]+\s+\d{4})|(?:[A-Z][a-z]+\s+\d{4}))/i.exec(text)?.[1]
  const published = meta('article:published_time') ?? meta('datePublished') ?? ld('datePublished') ?? /<time[^>]+datetime=["']([^"']+)/i.exec(head)?.[1]
  return isoDay(modified) ?? isoDay(textual) ?? isoDay(published)
}

const NAMED: Record<string, string> = {
  amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', ndash: '–', mdash: '—', hellip: '…',
  rsquo: '’', lsquo: '‘', rdquo: '”', ldquo: '“', copy: '©', reg: '®', trade: '™', middot: '·', bull: '•',
  euro: '€', pound: '£', yen: '¥', cent: '¢', times: '×', laquo: '«', raquo: '»',
}

export function decodeEntities(s: string): string {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e: string) => {
    if (e[0] === '#') {
      const code = e[1].toLowerCase() === 'x' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10)
      return Number.isFinite(code) && code > 0 && code < 0x110000 ? String.fromCodePoint(code) : m
    }
    return NAMED[e.toLowerCase()] ?? m
  })
}

const attr = (tag: string, name: string) => {
  const m = new RegExp(`\\s${name}\\s*=\\s*("([^"]*)"|'([^']*)'|([^\\s>]+))`, 'i').exec(tag)
  return m ? decodeEntities(m[2] ?? m[3] ?? m[4] ?? '') : ''
}

const BLOCK = /<\/?(p|div|section|article|header|footer|nav|aside|main|li|ul|ol|h[1-6]|tr|td|th|table|br|hr|dd|dt|dl|blockquote|pre|figure|figcaption|label|button|option)\b[^>]*>/gi

export function extractHtml(html: string, baseUrl: string): Extracted {
  const head = html.slice(0, 200_000)
  const title =
    decodeEntities(/<meta[^>]+property=["']og:title["'][^>]*>/i.exec(head)?.[0]?.match(/content=["']([^"']*)/i)?.[1] ?? '') ||
    decodeEntities(/<title[^>]*>([\s\S]*?)<\/title>/i.exec(head)?.[1] ?? '').trim()
  const descTag = /<meta[^>]+name=["']description["'][^>]*>/i.exec(head)?.[0] ?? /<meta[^>]+property=["']og:description["'][^>]*>/i.exec(head)?.[0] ?? ''
  const description = descTag ? attr(descTag, 'content').trim() : ''
  const lang = attr(/<html\b[^>]*>/i.exec(head)?.[0] ?? '', 'lang')

  let body = html
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<(script|style|noscript|svg|template|iframe|canvas|object)\b[\s\S]*?<\/\1>/gi, ' ')

  const links: Link[] = []
  const seen = new Set<string>()
  body.replace(/<a\b([^>]*)>([\s\S]*?)<\/a>/gi, (_m, attrs: string, inner: string) => {
    const href = attr(' ' + attrs, 'href')
    if (!href || href.startsWith('#') || /^(javascript|mailto|tel):/i.test(href)) {
      if (/^mailto:/i.test(href) && !seen.has(href)) {
        seen.add(href)
        links.push({ url: href, text: 'mailto' })
      }
      return ''
    }
    try {
      const abs = new URL(href, baseUrl)
      abs.hash = ''
      const key = abs.toString()
      if (!seen.has(key)) {
        seen.add(key)
        const text = decodeEntities(inner.replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim().slice(0, 120)
        links.push({ url: key, text: text || attr(' ' + attrs, 'aria-label') || attr(' ' + attrs, 'title') })
      }
    } catch {
      /* ignore */
    }
    return ''
  })

  body = body.replace(BLOCK, '\n').replace(/<[^>]+>/g, ' ')
  const text = decodeEntities(body)
    .replace(/[ \t\f\v ]+/g, ' ')
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l.length > 1)
    .filter((l, i, arr) => l !== arr[i - 1])
    .join('\n')

  return { title, description, lang, text, links, date: pageDate(html, text.slice(0, 20000)) }
}

/** Normalises text for quote matching: case, whitespace, quotes, dashes, full-width forms. */
export function normalizeForMatch(s: string): string {
  return s
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[‘’‚‛`´]/g, "'")
    .replace(/[“”„‟]/g, '"')
    .replace(/[‐-―−]/g, '-')
    .replace(/\s+/g, ' ')
    .trim()
}
