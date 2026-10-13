import type { IncomingMessage, ServerResponse } from 'node:http'

/* A tiny router: just enough for a JSON API with cookies, CORS and SSE. */

export class HttpError extends Error {
  status: number
  code: string
  extra?: Record<string, unknown>
  constructor(status: number, code: string, message?: string, extra?: Record<string, unknown>) {
    super(message ?? code)
    this.status = status
    this.code = code
    this.extra = extra
  }
}

export interface Ctx {
  req: IncomingMessage
  res: ServerResponse
  url: URL
  params: Record<string, string>
  ip: string
  cookies: Record<string, string>
  body: unknown
  /** Filled by the auth middleware. */
  state: Record<string, unknown>
}

export type Handler = (ctx: Ctx) => Promise<unknown> | unknown

interface Route {
  method: string
  parts: string[]
  handler: Handler
}

export class Router {
  private routes: Route[] = []
  add(method: string, path: string, handler: Handler) {
    this.routes.push({ method, parts: path.split('/').filter(Boolean), handler })
    return this
  }
  get(p: string, h: Handler) {
    return this.add('GET', p, h)
  }
  post(p: string, h: Handler) {
    return this.add('POST', p, h)
  }
  match(method: string, pathname: string): { handler: Handler; params: Record<string, string> } | 'method' | null {
    const segs = pathname.split('/').filter(Boolean)
    let pathMatched = false
    for (const r of this.routes) {
      if (r.parts.length !== segs.length) continue
      const params: Record<string, string> = {}
      let ok = true
      for (let i = 0; i < segs.length; i++) {
        const p = r.parts[i]
        if (p.startsWith(':')) params[p.slice(1)] = decodeURIComponent(segs[i])
        else if (p !== segs[i]) {
          ok = false
          break
        }
      }
      if (!ok) continue
      pathMatched = true
      if (r.method === method) return { handler: r.handler, params }
    }
    return pathMatched ? 'method' : null
  }
}

export function parseCookies(header: string | undefined): Record<string, string> {
  const out: Record<string, string> = {}
  if (!header) return out
  for (const part of header.split(';')) {
    const i = part.indexOf('=')
    if (i < 1) continue
    const k = part.slice(0, i).trim()
    const v = part.slice(i + 1).trim()
    try {
      out[k] = decodeURIComponent(v)
    } catch {
      out[k] = v
    }
  }
  return out
}

export interface CookieOpts {
  maxAgeSec?: number
  httpOnly?: boolean
  secure?: boolean
  sameSite?: 'Lax' | 'Strict' | 'None'
  domain?: string
  path?: string
}

export function setCookie(res: ServerResponse, name: string, value: string, o: CookieOpts) {
  const parts = [`${name}=${encodeURIComponent(value)}`, `Path=${o.path ?? '/'}`]
  if (o.maxAgeSec !== undefined) parts.push(`Max-Age=${Math.max(0, Math.floor(o.maxAgeSec))}`)
  if (o.httpOnly !== false) parts.push('HttpOnly')
  if (o.secure) parts.push('Secure')
  if (o.sameSite) parts.push(`SameSite=${o.sameSite}`)
  if (o.domain) parts.push(`Domain=${o.domain}`)
  const prev = res.getHeader('Set-Cookie')
  const list = Array.isArray(prev) ? prev : prev ? [String(prev)] : []
  res.setHeader('Set-Cookie', [...list, parts.join('; ')])
}

export async function readJson(req: IncomingMessage, limit = 64 * 1024): Promise<unknown> {
  const type = req.headers['content-type'] ?? ''
  const chunks: Buffer[] = []
  let size = 0
  for await (const chunk of req) {
    size += (chunk as Buffer).length
    if (size > limit) throw new HttpError(413, 'body_too_large')
    chunks.push(chunk as Buffer)
  }
  if (!size) return undefined
  if (!type.includes('application/json')) throw new HttpError(415, 'json_required')
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'))
  } catch {
    throw new HttpError(400, 'invalid_json')
  }
}

export function sendJson(res: ServerResponse, status: number, data: unknown) {
  if (res.headersSent) return
  const body = JSON.stringify(data)
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
    'Cache-Control': 'no-store',
  })
  res.end(body)
}

export function clientIp(req: IncomingMessage, trustProxy: boolean): string {
  if (trustProxy) {
    const xf = req.headers['x-forwarded-for']
    const first = (Array.isArray(xf) ? xf[0] : xf)?.split(',')[0]?.trim()
    if (first) return first
  }
  return req.socket.remoteAddress ?? 'unknown'
}

/** Server-sent events stream with a heartbeat; returns a writer and a closed flag. */
export function openSse(res: ServerResponse) {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-store',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  })
  // a 2 KB comment first, so proxies and tunnels that buffer small responses start streaming right away
  res.write(`: ${' '.repeat(2048)}\n: connected\n\n`)
  let closed = false
  const beat = setInterval(() => {
    if (!closed) res.write(': ping\n\n')
  }, 15000)
  res.on('close', () => {
    closed = true
    clearInterval(beat)
  })
  return {
    send(event: string, data: unknown, id?: number) {
      if (closed) return
      res.write(`${id !== undefined ? `id: ${id}\n` : ''}event: ${event}\ndata: ${JSON.stringify(data)}\n\n`)
    },
    end() {
      if (closed) return
      closed = true
      clearInterval(beat)
      res.end()
    },
    get closed() {
      return closed
    },
  }
}
