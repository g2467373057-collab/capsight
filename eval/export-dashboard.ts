/**
 * Capsight · admin dashboard export.
 * Reads the local database (read-only) and writes eval/dashboard/dashboard-data.json:
 * page views, registrations, every research question with its model tokens, search calls and estimated cost,
 * and API balances (DeepSeek live; Serper and Bocha estimated from the amounts in eval/dashboard-prices.json).
 * Usage (from the project folder):  bash eval/export-dashboard.sh
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const { loadDotEnv } = await import('../server/src/config.ts')
loadDotEnv(join(here, '../server/.env'))
loadDotEnv(join(here, '../server/keys.env'))

const dbPath = process.env.DB_PATH || join(here, '../server/data/capsight.db')
const db = new DatabaseSync(dbPath, { readOnly: true })
const prices = JSON.parse(readFileSync(join(here, 'dashboard-prices.json'), 'utf8'))
const TEST_ACCOUNTS = new Set(['batch-eval@capsight.local'])
const fx = Number(prices.usd_to_cny?.rate) || 7.1
const day = (ms: number) => new Date(ms + 8 * 3600_000).toISOString().slice(0, 10) // Asia/Shanghai
const has = (table: string) => !!db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?").get(table)

/* ---------------- cost of one run, in CNY ---------------- */
type Usage = { calls?: number; inputTokens?: number; outputTokens?: number; searches?: Record<string, number>; readerCalls?: number; model?: string }
function cost(u: Usage) {
  const ds = prices.deepseek
  const llm = ((u.inputTokens ?? 0) * (ds.input_per_million_tokens ?? 0) + (u.outputTokens ?? 0) * (ds.output_per_million_tokens ?? 0)) / 1e6
  const llmCny = ds.currency === 'USD' ? llm * fx : llm
  let searchCny = 0
  for (const [k, n] of Object.entries(u.searches ?? {})) {
    const p = prices[k]
    if (!p) continue
    const unit = k === 'serper' ? (p.per_1000_searches ?? 0) / 1000 : (p.per_search ?? p.per_request ?? 0)
    searchCny += n * unit * (p.currency === 'USD' ? fx : 1)
  }
  const readerCny = (u.readerCalls ?? 0) * (prices.jina?.per_request ?? 0) * (prices.jina?.currency === 'USD' ? fx : 1)
  return { llm: +llmCny.toFixed(4), search: +searchCny.toFixed(4), reader: +readerCny.toFixed(4), total: +(llmCny + searchCny + readerCny).toFixed(4), searchesCounted: !!u.searches }
}

/* ---------------- users ---------------- */
const users = db.prepare('SELECT id, email, name, email_verified, created_at FROM users ORDER BY created_at').all() as { id: string; email: string; name: string; email_verified: number; created_at: number }[]
const emailOf = new Map(users.map((u) => [u.id, u.email]))

/* ---------------- runs (the question log) ---------------- */
const runRows = db.prepare('SELECT id, user_id, query, lang, intent_json, status, error, usage_json, created_at, finished_at FROM runs ORDER BY created_at DESC').all() as Record<string, any>[]
const runs = runRows.map((r) => {
  const intent = JSON.parse(r.intent_json || '{}')
  const usage: Usage = r.usage_json ? JSON.parse(r.usage_json) : {}
  const email = emailOf.get(r.user_id) ?? ''
  return {
    id: r.id,
    time: new Date(r.created_at).toISOString(),
    day: day(r.created_at),
    email,
    source: TEST_ACCOUNTS.has(email) ? 'test' : 'user',
    query: r.query,
    lang: r.lang,
    type: intent.type ?? '',
    subjects: (intent.competitors ?? []).length,
    status: r.status,
    error: r.error ?? '',
    seconds: r.finished_at ? Math.round((r.finished_at - r.created_at) / 1000) : null,
    model: usage.model ?? '',
    llmCalls: usage.calls ?? 0,
    inputTokens: usage.inputTokens ?? 0,
    outputTokens: usage.outputTokens ?? 0,
    searches: usage.searches ?? null,
    readerCalls: usage.readerCalls ?? null,
    costCny: cost(usage),
  }
})

/* ---------------- page views ---------------- */
const views = has('page_views') ? (db.prepare('SELECT day, path, visitor, referrer FROM page_views').all() as { day: string; path: string; visitor: string; referrer: string | null }[]) : []

/* ---------------- daily series ---------------- */
const days = new Map<string, { day: string; pv: number; uv: Set<string>; registrations: number; runs: number; testRuns: number; tokens: number; costCny: number }>()
const D = (d: string) => {
  if (!days.has(d)) days.set(d, { day: d, pv: 0, uv: new Set(), registrations: 0, runs: 0, testRuns: 0, tokens: 0, costCny: 0 })
  return days.get(d)!
}
for (const v of views) {
  D(v.day).pv++
  D(v.day).uv.add(v.visitor)
}
for (const u of users) if (!TEST_ACCOUNTS.has(u.email)) D(day(u.created_at)).registrations++
for (const r of runs) {
  const x = D(r.day)
  if (r.source === 'test') x.testRuns++
  else x.runs++
  x.tokens += r.inputTokens + r.outputTokens
  x.costCny += r.costCny.total
}
const daily = [...days.values()].sort((a, b) => a.day.localeCompare(b.day)).map((x) => ({ ...x, uv: x.uv.size, costCny: +x.costCny.toFixed(4) }))

/* ---------------- balances ---------------- */
async function deepseekBalance() {
  const key = process.env.DEEPSEEK_API_KEY
  if (!key) return { api: 'DeepSeek', kind: 'missing', note: 'keys.env 里没有 DEEPSEEK_API_KEY' }
  try {
    const res = await fetch('https://api.deepseek.com/user/balance', { headers: { Authorization: `Bearer ${key}`, Accept: 'application/json' }, signal: AbortSignal.timeout(12000) })
    if (!res.ok) return { api: 'DeepSeek', kind: 'error', note: `查询失败 HTTP ${res.status}` }
    const data = (await res.json()) as { is_available?: boolean; balance_infos?: { currency: string; total_balance: string; granted_balance: string; topped_up_balance: string }[] }
    return { api: 'DeepSeek', kind: 'live', available: data.is_available ?? null, balances: data.balance_infos ?? [], checkedAt: new Date().toISOString() }
  } catch (e) {
    return { api: 'DeepSeek', kind: 'error', note: `查询失败：${(e as Error).message}` }
  }
}
function estimated(api: 'serper' | 'bocha') {
  const p = prices[api]
  const since = api === 'serper' ? p.credits_since : p.balance_since
  const bought = api === 'serper' ? p.credits_bought : p.balance_topped_up
  const counted = runs.filter((r) => r.searches && (!since || r.time >= new Date(since).toISOString())).reduce((n, r) => n + (r.searches?.[api] ?? 0), 0)
  const label = api === 'serper' ? 'Serper' : '博查 Bocha'
  if (bought == null || !since) return { api: label, kind: 'usage', counted, note: '没有余额查询接口；在 dashboard-prices.json 填上充值额度和日期后可估算余额。调用次数只统计研究运行，不含识别意图和 Batch C 的直接调用。' }
  const remaining = api === 'serper' ? bought - counted : +(bought - counted * (p.per_search ?? 0)).toFixed(2)
  return { api: label, kind: 'estimate', counted, since, bought, remaining, unit: api === 'serper' ? 'credits' : p.currency, note: '估算值：充值额度 − 之后统计到的调用（不含识别意图和 Batch C），以控制台为准。' }
}
const balances = [await deepseekBalance(), estimated('serper'), estimated('bocha'), { api: 'Jina Reader', kind: 'usage', counted: runs.reduce((n, r) => n + (r.readerCalls ?? 0), 0), note: '免费额度；只统计 10/26 之后的运行' }, { api: 'Wikidata', kind: 'free', counted: runs.reduce((n, r) => n + (r.searches?.wikidata ?? 0), 0), note: '免费公开数据' }]

/* ---------------- totals ---------------- */
const real = runs.filter((r) => r.source === 'user')
const totals = {
  pageViews: views.length,
  visitors: new Set(views.map((v) => v.visitor)).size,
  pageViewsSince: views.length ? daily.find((d) => d.pv > 0)?.day ?? null : null,
  users: users.filter((u) => !TEST_ACCOUNTS.has(u.email)).length,
  verifiedUsers: users.filter((u) => !TEST_ACCOUNTS.has(u.email) && u.email_verified).length,
  runs: real.length,
  testRuns: runs.length - real.length,
  failedRuns: runs.filter((r) => r.status === 'failed').length,
  inputTokens: runs.reduce((n, r) => n + r.inputTokens, 0),
  outputTokens: runs.reduce((n, r) => n + r.outputTokens, 0),
  costCny: +runs.reduce((n, r) => n + r.costCny.total, 0).toFixed(4),
  avgCostPerRunCny: runs.length ? +(runs.reduce((n, r) => n + r.costCny.total, 0) / runs.length).toFixed(4) : 0,
}

const out = {
  generatedAt: new Date().toISOString(),
  note: '页面浏览从 10/26 加上统计后才开始记录；搜索调用次数从 v2.4 起按次记录，此前的运行只有模型 token；成本按 dashboard-prices.json 里的单价估算。',
  pricesConfirmed: Object.fromEntries(Object.entries(prices).filter(([k]) => !k.startsWith('_')).map(([k, v]: [string, any]) => [k, !!v?.confirmed])),
  prices,
  totals,
  daily,
  topPaths: Object.entries(views.reduce<Record<string, number>>((m, v) => ((m[v.path] = (m[v.path] ?? 0) + 1), m), {})).sort((a, b) => b[1] - a[1]).slice(0, 10).map(([path, n]) => ({ path, views: n })),
  users: users.map((u) => ({ email: u.email, name: u.name, registered: new Date(u.created_at).toISOString(), verified: !!u.email_verified, test: TEST_ACCOUNTS.has(u.email), runs: runs.filter((r) => r.email === u.email).length })),
  runs,
  balances,
}
const outDir = join(here, 'dashboard')
if (!existsSync(outDir)) mkdirSync(outDir, { recursive: true })
writeFileSync(join(outDir, 'dashboard-data.json'), JSON.stringify(out, null, 1))
console.log(`\n胶囊AI 看板数据已导出：eval/dashboard/dashboard-data.json`)
console.log(`  浏览 ${totals.pageViews}（访客 ${totals.visitors}）· 注册 ${totals.users} · 问题 ${totals.runs}（测试 ${totals.testRuns}）· token ${totals.inputTokens + totals.outputTokens} · 估算成本 ¥${totals.costCny}`)
for (const b of balances as any[]) console.log(`  ${b.api}: ${b.kind === 'live' ? (b.balances ?? []).map((x: any) => `${x.total_balance} ${x.currency}`).join(' / ') : b.kind === 'estimate' ? `约剩 ${b.remaining} ${b.unit}` : b.note ?? `调用 ${b.counted} 次`}`)
console.log('\n告诉 Claude「导出好了」，它会更新在线看板。\n')
