import assert from 'node:assert/strict'
import type { AddressInfo } from 'node:net'
import { after, before, test } from 'node:test'
import { createApp, type App } from '../src/app.ts'
import { createMailer } from '../src/mail/mailer.ts'
import { fakeSite, freshDb, html, mockSearch, testConfig, testProviders } from './helpers.ts'

const ORIGIN = 'http://app.test'
let site: Awaited<ReturnType<typeof fakeSite>>

before(async () => {
  site = await fakeSite({
    '/': { body: html('Beta', '<p>Beta is a whiteboard for teams.</p>') },
    '/pricing': { body: html('Pricing', '<p>Starter and Business plans, billed per user.</p>') },
  })
})
after(() => site.server.close())

async function boot(over: Parameters<typeof testConfig>[0] = {}) {
  const cfg = testConfig(over)
  const db = freshDb()
  const mailer = createMailer(cfg)
  const search = mockSearch((q) => (q.includes('official website') || q.includes('官网') ? [{ title: 'Beta', url: `${site.origin}/`, snippet: '', position: 1 }] : []))
  const providers = testProviders(cfg, db, (r) => {
    if (r.task === 'intent') return { type: 'named', competitors: ['Beta'], timeRange: 'all', dimensions: ['name', 'pricing'] }
    if (r.task === 'extract') {
      const m = /\[(D\d+)\] kind=site url=\S+\/pricing/.exec(r.user)
      return { facts: { pricing: m ? { value: 'Starter / Business, per user', evidence: [{ doc: m[1], quote: 'Starter and Business plans, billed per user.' }] } : null } }
    }
    return { checks: {} }
  }, search)
  const app: App = createApp(cfg, db, mailer, providers)
  await new Promise<void>((r) => app.server.listen(0, '127.0.0.1', r))
  const base = `http://127.0.0.1:${(app.server.address() as AddressInfo).port}`
  let cookie = ''
  const call = async (method: string, path: string, body?: unknown, headers: Record<string, string> = {}) => {
    const res = await fetch(base + path, {
      method,
      headers: { Origin: ORIGIN, ...(body ? { 'Content-Type': 'application/json' } : {}), ...(cookie ? { Cookie: cookie } : {}), ...headers },
      body: body ? JSON.stringify(body) : undefined,
    })
    const set = res.headers.getSetCookie()
    for (const c of set) cookie = c.split(';')[0].endsWith('=') ? '' : c.split(';')[0]
    const text = await res.text()
    let json: any
    try {
      json = JSON.parse(text)
    } catch {
      json = text
    }
    return { status: res.status, json, headers: res.headers, text }
  }
  return { app, base, call, mailer, db, setCookie: (c: string) => (cookie = c), getCookie: () => cookie }
}

test('auth: register, me, logout, login, wrong password, CSRF', async () => {
  const s = await boot()
  try {
    assert.equal((await s.call('GET', '/auth/me')).json.user, null)
    const bad = await s.call('POST', '/auth/register', { name: 'Yi', email: 'nope', password: 'longenough' })
    assert.equal(bad.json.error, 'invalid_email')
    assert.equal((await s.call('POST', '/auth/register', { name: 'Yi', email: 'yi@example.com', password: 'short' })).json.error, 'weak_password')
    const reg = await s.call('POST', '/auth/register', { name: 'Yi', email: 'Yi@Example.com', password: 'longenough' })
    assert.equal(reg.status, 200)
    assert.equal(reg.json.user.email, 'yi@example.com')
    assert.match(reg.headers.get('set-cookie') ?? '', /ts_session=.*HttpOnly.*SameSite=Lax/)
    assert.equal((await s.call('GET', '/auth/me')).json.user.name, 'Yi')
    assert.equal((await s.call('POST', '/auth/register', { name: 'Yi', email: 'yi@example.com', password: 'longenough' })).json.error, 'email_taken')
    await s.call('POST', '/auth/logout')
    assert.equal((await s.call('GET', '/auth/me')).json.user, null)
    assert.equal((await s.call('POST', '/auth/login', { email: 'yi@example.com', password: 'wrongwrong' })).status, 401)
    assert.equal((await s.call('POST', '/auth/login', { email: 'yi@example.com', password: 'longenough' })).status, 200)
    // a POST from another site is refused
    assert.equal((await s.call('POST', '/auth/logout', undefined, { Origin: 'https://evil.example' })).json.error, 'bad_origin')
    // CORS only for the configured origin
    assert.equal((await s.call('GET', '/health')).headers.get('access-control-allow-origin'), ORIGIN)
    assert.equal((await s.call('GET', '/health', undefined, { Origin: 'https://evil.example' })).headers.get('access-control-allow-origin'), null)
  } finally {
    s.app.server.close()
  }
})

test('auth: login is throttled after repeated failures', async () => {
  const s = await boot()
  try {
    await s.call('POST', '/auth/register', { name: 'A', email: 'a@example.com', password: 'longenough' })
    let last = 0
    for (let i = 0; i < 9; i++) last = (await s.call('POST', '/auth/login', { email: 'a@example.com', password: 'bad-password' })).status
    assert.equal(last, 429)
  } finally {
    s.app.server.close()
  }
})

test('e-mail verification and password reset', async () => {
  const s = await boot({ requireEmailVerification: true })
  try {
    await s.call('POST', '/auth/register', { name: 'V', email: 'v@example.com', password: 'longenough', lang: 'en' })
    assert.equal((await s.call('POST', '/intent', { query: 'Beta pricing', lang: 'en' })).json.error, 'email_unverified')
    const mail = s.mailer.outbox!.at(-1)!
    assert.equal(mail.to, 'v@example.com')
    const token = /#verify-([\w-]+)/.exec(mail.text)![1]
    assert.equal((await s.call('POST', '/auth/verify', { token })).json.user.emailVerified, true)
    assert.equal((await s.call('POST', '/auth/verify', { token })).json.error, 'invalid_token')

    assert.equal((await s.call('POST', '/auth/forgot', { email: 'nobody@example.com' })).status, 200)
    await s.call('POST', '/auth/forgot', { email: 'v@example.com', lang: 'zh' })
    const reset = s.mailer.outbox!.at(-1)!
    assert.match(reset.subject, /重置/)
    const rt = /#reset-([\w-]+)/.exec(reset.text)![1]
    assert.equal((await s.call('POST', '/auth/reset', { token: rt, password: 'brand-new-pass' })).status, 200)
    await s.call('POST', '/auth/logout')
    assert.equal((await s.call('POST', '/auth/login', { email: 'v@example.com', password: 'longenough' })).status, 401)
    assert.equal((await s.call('POST', '/auth/login', { email: 'v@example.com', password: 'brand-new-pass' })).status, 200)
  } finally {
    s.app.server.close()
  }
})

test('research API: intent → run → live events → result → CSV → history, with quota', async () => {
  const s = await boot({ limits: { ...testConfig().limits, runsPerUserPerDay: 1 } })
  try {
    assert.equal((await s.call('POST', '/intent', { query: 'x' })).status, 401)
    await s.call('POST', '/auth/register', { name: 'R', email: 'r@example.com', password: 'longenough' })
    const intent = (await s.call('POST', '/intent', { query: 'Beta 的定价', lang: 'zh' })).json
    assert.deepEqual(intent.competitors, ['Beta'])
    assert.equal((await s.call('POST', '/runs', { intent: { competitors: [] }, lang: 'zh' })).json.error, 'invalid_intent')
    const { runId } = (await s.call('POST', '/runs', { intent, lang: 'zh' })).json
    assert.match(runId, /^run_/)

    // live stream until the result arrives
    const res = await fetch(`${s.base}/runs/${runId}/events`, { headers: { Cookie: s.getCookie(), Origin: ORIGIN } })
    assert.equal(res.headers.get('content-type'), 'text/event-stream; charset=utf-8')
    const body = await res.text()
    assert.match(body, /event: progress/)
    const resultLine = /event: result\ndata: (.*)\n/.exec(body)
    assert.ok(resultLine, body.slice(0, 500))
    const result = JSON.parse(resultLine![1])
    assert.equal(result.rows[0].cells.pricing.status, 'verified')
    assert.equal(result.rows[0].cells.pricing.value, 'Starter / Business, per user')

    const run = (await s.call('GET', `/runs/${runId}`)).json
    assert.equal(run.status, 'done')
    const csv = await s.call('GET', `/runs/${runId}/csv?lang=zh`)
    assert.match(csv.headers.get('content-type') ?? '', /text\/csv/)
    assert.ok(csv.text.replace(/^\uFEFF/, '').startsWith('名称,名称_来源,定价,定价_来源,校验'), csv.text.slice(0, 80))
    assert.equal((await s.call('GET', '/history')).json.runs[0].id, runId)

    // daily limit
    const q = (await s.call('GET', '/quota')).json
    assert.deepEqual([q.used, q.limit], [1, 1])
    const over = await s.call('POST', '/runs', { intent, lang: 'zh' })
    assert.equal(over.status, 429)
    assert.equal(over.json.error, 'daily_limit')

    // another user cannot read this run
    s.setCookie('')
    await s.call('POST', '/auth/register', { name: 'O', email: 'o@example.com', password: 'longenough' })
    assert.equal((await s.call('GET', `/runs/${runId}`)).status, 404)
  } finally {
    s.app.server.close()
  }
})

test('same-origin deploy: serves the web build and the API under /api', async () => {
  const { mkdtempSync, mkdirSync, writeFileSync } = await import('node:fs')
  const { tmpdir } = await import('node:os')
  const { join } = await import('node:path')
  const dir = mkdtempSync(join(tmpdir(), 'web-'))
  mkdirSync(join(dir, 'assets'))
  writeFileSync(join(dir, 'index.html'), '<!doctype html><title>app</title>')
  writeFileSync(join(dir, 'assets', 'a-123.js'), 'console.log(1)')
  const s = await boot({ staticDir: dir })
  try {
    const home = await s.call('GET', '/')
    assert.equal(home.status, 200)
    assert.match(home.headers.get('content-type') ?? '', /text\/html/)
    assert.match(home.text, /<title>app<\/title>/)
    const js = await s.call('GET', '/assets/a-123.js')
    assert.match(js.headers.get('cache-control') ?? '', /immutable/)
    assert.deepEqual((await s.call('GET', '/api/health')).json, { ok: true })
    assert.equal((await s.call('GET', '/api/auth/me')).json.user, null)
    assert.equal((await s.call('GET', '/%2e%2e/%2e%2e/etc/passwd')).status, 404)
    assert.equal((await s.call('GET', '/nope.js')).status, 404)
    // POST from the page's own origin (e.g. a tunnel URL not in ALLOWED_ORIGINS) is accepted; a foreign one is not
    assert.equal((await s.call('POST', '/api/auth/logout', {}, { Origin: s.base })).status, 200)
    assert.equal((await s.call('POST', '/api/auth/logout', {}, { Origin: 'https://evil.example' })).status, 403)
  } finally {
    s.app.server.close()
  }
})

test('operator accounts in ADMIN_EMAILS skip the per-user daily limit', async () => {
  const s = await boot({ adminEmails: ['boss@example.com'], limits: { ...testConfig().limits, runsPerUserPerDay: 1 } })
  try {
    await s.call('POST', '/auth/register', { name: 'B', email: 'Boss@example.com', password: 'longenough1' })
    const intent = { type: 'named', query: 'q', competitors: ['Beta'], timeRange: 'all', dimensions: ['name', 'pricing'] }
    for (let i = 0; i < 3; i++) {
      const r = await s.call('POST', '/runs', { intent, lang: 'en' })
      assert.equal(r.status, 200, JSON.stringify(r.json))
      await new Promise((res) => setTimeout(res, 300))
    }
    const q = (await s.call('GET', '/quota')).json
    assert.equal(q.unlimited, true)
  } finally {
    s.app.server.close()
  }
})
