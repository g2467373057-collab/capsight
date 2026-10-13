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

  return { title, description, lang, text, links }
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
