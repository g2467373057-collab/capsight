import { createServer, type Server, type ServerResponse } from 'node:http'
import { existsSync, readFileSync, statSync } from 'node:fs'
import { extname, join, normalize, sep } from 'node:path'
import { Auth } from './auth/auth.ts'
import type { Config } from './config.ts'
import type { Db } from './db/db.ts'
import { clientIp, HttpError, openSse, parseCookies, readJson, Router, sendJson, type Ctx } from './http/http.ts'
import type { Mailer } from './mail/mailer.ts'
import { toCsv } from './pipeline/csv.ts'
import { parseIntent, validateIntent } from './pipeline/intent.ts'
import { Runs, type Providers } from './runs.ts'
import type { Lang } from './types.ts'

export interface App {
  server: Server
  runs: Runs
  auth: Auth
}

const langOf = (v: unknown): Lang => (v === 'en' ? 'en' : 'zh')
const obj = (b: unknown) => (b && typeof b === 'object' ? (b as Record<string, unknown>) : {})

export function createApp(cfg: Config, db: Db, mailer: Mailer, providers: Providers): App {
  const auth = new Auth(db, cfg, mailer)
  const runs = new Runs(db, cfg, providers)
  const r = new Router()

  r.get('/health', () => ({ ok: true }))

  /* ---------- auth ---------- */
  r.get('/auth/me', (c) => ({ user: auth.current(c) }))
  r.post('/auth/register', async (c) => ({ user: await auth.register(c, obj(c.body)) }))
  r.post('/auth/login', async (c) => ({ user: await auth.login(c, obj(c.body)) }))
  r.post('/auth/logout', (c) => {
    auth.logout(c)
    return { ok: true }
  })
  r.post('/auth/verify', (c) => ({ user: auth.verifyEmail(obj(c.body)) }))
  r.post('/auth/verify/resend', async (c) => {
    await auth.resendVerification(c, langOf(obj(c.body).lang))
    return { ok: true }
  })
  r.post('/auth/forgot', async (c) => {
    await auth.forgot(c, obj(c.body))
    return { ok: true }
  })
  r.post('/auth/reset', async (c) => ({ user: await auth.reset(c, obj(c.body)) }))

  /* ---------- research ---------- */
  r.get('/quota', (c) => {
    const u = auth.require(c)
    return runs.quota(u.id, u.email)
  })

  r.post('/intent', async (c) => {
    auth.require(c, { verified: true })
    const b = obj(c.body)
    const query = String(b.query ?? '').trim()
    if (!query) throw new HttpError(400, 'query_required')
    if (query.length > 300) throw new HttpError(400, 'query_too_long')
    const lang = langOf(b.lang)
    try {
      return await parseIntent(providers.llm(lang), providers.search(lang), query, lang, cfg.limits.maxCompetitors)
    } catch (e) {
      console.error('[intent]', e)
      throw new HttpError(503, 'llm_unavailable')
    }
  })

  r.post('/runs', (c) => {
    const user = auth.require(c, { verified: true })
    const b = obj(c.body)
    const intent = validateIntent(b.intent, cfg.limits.maxCompetitors)
    if (!intent) throw new HttpError(400, 'invalid_intent')
    return { runId: runs.start(user.id, intent, langOf(b.lang), user.email) }
  })

  r.get('/runs/:id', (c) => runs.get(c.params.id, auth.require(c).id))

  r.get('/runs/:id/csv', (c) => {
    const run = runs.get(c.params.id, auth.require(c).id)
    if (!run.result) throw new HttpError(409, 'not_ready')
    const csv = toCsv(run.result, langOf(c.url.searchParams.get('lang') ?? run.lang))
    c.res.writeHead(200, {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="capsight-${run.id}.csv"`,
      'Cache-Control': 'no-store',
    })
    c.res.end(csv)
    return undefined
  })

  r.get('/runs/:id/events', (c) => {
    const user = auth.require(c)
    const run = runs.get(c.params.id, user.id)
    const after = Number(c.req.headers['last-event-id'] ?? c.url.searchParams.get('after') ?? 0) || 0
    const sse = openSse(c.res)
    let last = after
    const flush = () => {
      for (const e of runs.events(run.id, last)) {
        sse.send('progress', e.event, e.seq)
        last = e.seq
      }
    }
    flush()
    const finish = () => {
      const now = runs.get(run.id, user.id)
      if (now.status === 'done' && now.result) sse.send('result', now.result)
      else if (now.status === 'failed') sse.send('failed', { error: now.error })
      sse.end()
    }
    if (run.status === 'done' || run.status === 'failed') return finish()
    const off = runs.subscribe(run.id, (m) => {
      if (m.type === 'event' && m.seq > last) {
        sse.send('progress', m.event, m.seq)
        last = m.seq
      } else if (m.type !== 'event') {
        off()
        flush()
        finish()
      }
    })
    c.res.on('close', off)
    return undefined
  })

  r.get('/history', (c) => ({ runs: runs.history(auth.require(c).id) }))

  /* ---------- server ---------- */
  const trustProxy = process.env.TRUST_PROXY === '1' || process.env.TRUST_PROXY === 'true'
  const allowed = new Set(cfg.allowedOrigins)

  const server = createServer(async (req, res) => {
    const origin = req.headers.origin
    res.setHeader('X-Content-Type-Options', 'nosniff')
    res.setHeader('Referrer-Policy', 'no-referrer')
    res.setHeader('X-Frame-Options', 'DENY')
    if (origin && allowed.has(origin)) {
      res.setHeader('Access-Control-Allow-Origin', origin)
      res.setHeader('Access-Control-Allow-Credentials', 'true')
      res.setHeader('Vary', 'Origin')
    }
    if (req.method === 'OPTIONS') {
      if (origin && allowed.has(origin)) {
        res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
        res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Last-Event-ID')
        res.setHeader('Access-Control-Max-Age', '600')
      }
      res.writeHead(204).end()
      return
    }
    const url = new URL(req.url ?? '/', 'http://localhost')
    // Same-origin deploys call the API under /api/… ; strip it so routes stay the same.
    if (url.pathname === '/api' || url.pathname.startsWith('/api/')) url.pathname = url.pathname.slice(4) || '/'
    else if ((req.method === 'GET' || req.method === 'HEAD') && serveStatic(cfg.staticDir, url.pathname, res)) return
    const ctx: Ctx = { req, res, url, params: {}, ip: clientIp(req, trustProxy), cookies: parseCookies(req.headers.cookie), body: undefined, state: {} }
    try {
      // CSRF: state-changing requests must come from an allowed origin
      // (an Origin whose host equals this request's Host is same-origin, e.g. behind a tunnel with a changing URL)
      if (req.method === 'POST' && (!origin || !(allowed.has(origin) || sameHost(origin, req.headers.host)))) throw new HttpError(403, 'bad_origin')
      const m = r.match(req.method ?? 'GET', url.pathname)
      if (!m) throw new HttpError(404, 'not_found')
      if (m === 'method') throw new HttpError(405, 'method_not_allowed')
      ctx.params = m.params
      if (req.method === 'POST') ctx.body = await readJson(req)
      const out = await m.handler(ctx)
      if (out !== undefined && !res.headersSent) sendJson(res, 200, out)
    } catch (e) {
      if (e instanceof HttpError) sendJson(res, e.status, { error: e.code, ...e.extra })
      else {
        console.error('[http]', e)
        sendJson(res, 500, { error: 'server_error' })
      }
    }
  })

  return { server, runs, auth }
}

function sameHost(origin: string, host: string | undefined): boolean {
  try {
    return !!host && new URL(origin).host === host
  } catch {
    return false
  }
}

const TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.json': 'application/json',
  '.woff2': 'font/woff2',
  '.txt': 'text/plain; charset=utf-8',
}

/** Serves the built web app (index.html for "/"). Returns false when there is no such file, so the API router runs. */
function serveStatic(dir: string, pathname: string, res: ServerResponse): boolean {
  if (!dir || !existsSync(join(dir, 'index.html'))) return false
  let rel: string
  try {
    rel = normalize(decodeURIComponent(pathname)).replace(/^([/\\])+/, '')
  } catch {
    return false
  }
  if (rel.split(sep).includes('..')) return false
  const file = join(dir, rel || 'index.html')
  if (!file.startsWith(dir) || !existsSync(file) || !statSync(file).isFile()) return false
  const ext = extname(file)
  const type = TYPES[ext]
  if (!type) return false
  res.setHeader('Content-Type', type)
  // Vite puts a content hash in asset names, so those can be cached for a long time.
  res.setHeader('Cache-Control', rel.startsWith('assets/') ? 'public, max-age=31536000, immutable' : 'no-cache')
  res.writeHead(200).end(readFileSync(file))
  return true
}
