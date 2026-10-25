/**
 * Capsight · batch runner for the Gate 2 proof bar (eval/PROOF-BAR.md).
 * Runs the fixed 10-question test set through the real API, one question at a time,
 * and saves every result, CSV and cost line into eval/batch-<LABEL>/.
 *
 * Usage (from the project folder):  bash eval/run-batch.sh A
 */
import { mkdirSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import type { AddressInfo } from 'node:net'

const here = dirname(fileURLToPath(import.meta.url))
const label = (process.argv[2] || 'A').replace(/[^A-Za-z0-9_-]/g, '')

// Test-run settings: no e-mail verification, and the batch account is exempt from the 3-runs-a-day limit.
const BATCH_EMAIL = 'batch-eval@capsight.local'
process.env.REQUIRE_EMAIL_VERIFICATION = 'false'
process.env.ADMIN_EMAILS = [process.env.ADMIN_EMAILS, BATCH_EMAIL].filter(Boolean).join(',')

const { loadDotEnv, loadConfig } = await import('../server/src/config.ts')
loadDotEnv(join(here, '../server/.env'))
loadDotEnv(join(here, '../server/keys.env'))
const { openDb } = await import('../server/src/db/db.ts')
const { createMailer } = await import('../server/src/mail/mailer.ts')
const { createProviders } = await import('../server/src/providers.ts')
const { createApp } = await import('../server/src/app.ts')
const { toCsv } = await import('../server/src/pipeline/csv.ts')

const TESTS: { id: string; lang: 'zh' | 'en'; q: string }[] = [
  { id: 'Q01', lang: 'zh', q: '我们是做在线协作文档的，帮我找竞品' },
  { id: 'Q02', lang: 'zh', q: '查一下 Notion、Coda、ClickUp 的基本信息' },
  { id: 'Q03', lang: 'en', q: 'Compare Asana, Monday.com and Trello pricing' },
  { id: 'Q04', lang: 'zh', q: '我们做 CRM，帮我查 Salesforce、HubSpot、纷享销客' },
  { id: 'Q05', lang: 'en', q: 'Find competitors of Calendly' },
  { id: 'Q06', lang: 'zh', q: '查飞书、钉钉、企业微信的定价和功能' },
  { id: 'Q07', lang: 'en', q: 'Zoom, Microsoft Teams, Google Meet: pricing and recent news' },
  { id: 'Q08', lang: 'zh', q: '我们做 SaaS 客服系统，帮我找竞品' },
  { id: 'Q09', lang: 'en', q: 'Figma vs Canva vs Sketch' },
  { id: 'Q10', lang: 'zh', q: '查 Linear、Jira 的定价和联系方式' },
]

const only = process.argv.slice(3) // optional: run only some IDs, e.g. Q02 Q05
const tests = only.length ? TESTS.filter((t) => only.includes(t.id)) : TESTS

const cfg = loadConfig()
const db = openDb(cfg.dbPath)
const app = createApp(cfg, db, createMailer(cfg), createProviders(cfg, db))
await new Promise<void>((r) => app.server.listen(0, '127.0.0.1', r))
const base = `http://127.0.0.1:${(app.server.address() as AddressInfo).port}`
const origin = cfg.appUrl

let cookie = ''
async function api(method: string, path: string, body?: unknown) {
  const res = await fetch(base + path, {
    method,
    headers: { 'Content-Type': 'application/json', Origin: origin, ...(cookie ? { Cookie: cookie } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  const set = res.headers.get('set-cookie')
  if (set) cookie = set.split(';')[0]
  const data = (await res.json().catch(() => ({}))) as Record<string, any>
  return { status: res.status, data }
}

// one dedicated account for all batches, so test runs are easy to tell apart from real users
const PASSWORD = 'capsight-batch-eval-2026'
let r = await api('POST', '/auth/register', { name: 'Batch eval', email: BATCH_EMAIL, password: PASSWORD, lang: 'zh' })
if (r.status === 409) r = await api('POST', '/auth/login', { email: BATCH_EMAIL, password: PASSWORD })
if (r.status !== 200) throw new Error(`login failed: ${r.status} ${JSON.stringify(r.data)}`)

const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)
const outDir = join(here, `batch-${label}`, stamp)
mkdirSync(outDir, { recursive: true })
const sleep = (ms: number) => new Promise((res) => setTimeout(res, ms))

const summary: Record<string, unknown>[] = []
console.log(`\nCapsight batch ${label} · ${tests.length} questions · saving to eval/batch-${label}/${stamp}\n`)

for (const t of tests) {
  const t0 = Date.now()
  process.stdout.write(`${t.id} ${t.q} … `)
  const line: Record<string, unknown> = { id: t.id, lang: t.lang, query: t.q }
  try {
    const intent = await api('POST', '/intent', { query: t.q, lang: t.lang })
    if (intent.status !== 200) throw new Error(`intent ${intent.status} ${intent.data.error}`)
    line.intent = intent.data
    const start = await api('POST', '/runs', { intent: intent.data, lang: t.lang })
    if (start.status !== 200) throw new Error(`start ${start.status} ${start.data.error}`)
    const runId = start.data.runId as string
    line.runId = runId
    let run: Record<string, any> = {}
    for (let i = 0; i < 180; i++) {
      await sleep(5000)
      run = (await api('GET', `/runs/${runId}`)).data
      if (run.status === 'done' || run.status === 'failed') break
    }
    const row = db.prepare('SELECT usage_json, created_at, finished_at, error FROM runs WHERE id = ?').get(runId) as any
    line.status = run.status ?? 'timeout'
    line.error = row?.error ?? undefined
    line.usage = row?.usage_json ? JSON.parse(row.usage_json) : undefined
    line.runSeconds = row?.finished_at ? Math.round((row.finished_at - row.created_at) / 1000) : undefined
    line.totalSeconds = Math.round((Date.now() - t0) / 1000)
    if (run.result) {
      line.stats = run.result.stats
      line.companies = (run.result.rows ?? []).map((x: any) => ({ name: x.competitor, domain: x.domain, method: x.siteMethod ?? '' }))
      writeFileSync(join(outDir, `${t.id}.json`), JSON.stringify({ test: t, intent: intent.data, run }, null, 2))
      writeFileSync(join(outDir, `${t.id}.csv`), toCsv(run.result, t.lang))
    }
    const s = line.stats as any
    console.log(`${line.status} · ${line.runSeconds ?? '?'}s${s ? ` · checked ${s.checked}, passed ${s.passed}, dropped ${s.dropped}` : ''}`)
  } catch (e) {
    line.status = 'error'
    line.error = String((e as Error).message || e)
    console.log(`ERROR ${line.error}`)
  }
  summary.push(line)
  writeFileSync(join(outDir, 'summary.json'), JSON.stringify({ batch: label, startedAt: stamp, tests: summary }, null, 2))
}

// a flat table for the audit sheet
const head = ['id', 'lang', 'query', 'type', 'dimensions', 'status', 'runSeconds', 'sources', 'checked', 'requeried', 'passed', 'dropped', 'coverage', 'pricingSlotsFilled', 'pricingSlotsTotal', 'pricingThirdParty', 'llmCalls', 'inputTokens', 'outputTokens', 'companies']
const esc = (v: unknown) => `"${String(v ?? '').replace(/"/g, '""')}"`
const rows = summary.map((l: any) => {
  const s = l.stats ?? {}
  const cov = s.passed + s.dropped > 0 ? (s.passed / (s.passed + s.dropped)).toFixed(2) : ''
  return [l.id, l.lang, l.query, l.intent?.type, (l.intent?.dimensions ?? []).join(' '), l.status, l.runSeconds, s.sources, s.checked, s.requeried, s.passed, s.dropped, cov, s.pricingSlots?.filled, s.pricingSlots?.total, s.pricingThirdParty, l.usage?.calls, l.usage?.inputTokens, l.usage?.outputTokens, (l.companies ?? []).map((c: any) => `${c.name} (${c.domain || '—'}${c.method ? `, ${c.method}` : ''})`).join('; ')].map(esc).join(',')
})
writeFileSync(join(outDir, 'summary.csv'), '﻿' + [head.join(','), ...rows].join('\n'))

// the official-site audit sheet: one row per company look-up; Harper fills in the last two columns
const siteRows = summary.flatMap((l: any) => (l.companies ?? []).map((c: any) => [l.id, l.lang, c.name, c.domain || '', c.method, '', ''].map(esc).join(',')))
writeFileSync(join(outDir, 'sites.csv'), '\ufeff' + ['test,lang,company,official_site_found,method,correct (Y/N/none),note', ...siteRows].join('\n'))

console.log(`\nDone. Results: eval/batch-${label}/${stamp}/  (summary.csv, sites.csv, one JSON/CSV per question)\n`)
app.server.close()
db.close()
process.exit(0)
