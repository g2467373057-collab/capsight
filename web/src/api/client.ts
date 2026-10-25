import { COMPETITORS, DEFAULT_NAMED, SUGGESTED_FOR_OWN, type MockCompetitor, type MockFact } from '../data/mock'
import {
  CUSTOM_PREFIX,
  DIMENSIONS,
  columnsOf,
  type Cell,
  type Dimension,
  type Intent,
  type Lang,
  type Row,
  type RunEvent,
  type RunOptions,
  type RunResult,
  type RunStats,
  type TimeRange,
} from './types'

import { API_BASE, api, ApiError } from './http'

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

/* ------------------------------------------------------------------ */
/* Step 1 · intent recognition                                         */
/* ------------------------------------------------------------------ */

const OWN_RE = /我(们)?的?公司|我司|我们是|我们做|我是(一家|一个)?做|我是一家|我们公司|自己的?(公司|产品)|our company|my company|my startup|we are|we're|we (build|make|sell|offer|run)|i run/i

/** Explicit periods. These can make a question a "timeframe" one. */
const TIME_RULES: [RegExp, TimeRange][] = [
  [/(7|七)\s*天|一周|本周|这周|上周|this week|last week|past week|7\s*days/i, '7d'],
  [/(30|三十)\s*天|一个月|近一月|本月|这个月|上个?月|this month|last month|past month|30\s*days/i, '30d'],
  [/(90|九十)\s*天|三个月|季度|quarter|90\s*days|3\s*months/i, '90d'],
  [/今年|本年|年初至今|this year|year to date|ytd/i, 'ytd'],
  [/去年|last year|\b20\d{2}\b/i, '90d'],
]
/** "Latest" without a period: limits news to 30 days but never changes the type. */
const FUZZY_TIME = /最近|近期|最新|latest|recent|lately/i
/** "How is X doing lately?" — a status check: last 7 days, news and social only. */
const STATUS_RE = /最近怎么样|最近如何|最近在(干|做)(什么|啥)|近况|有什么(新)?动静|what'?s new (with|at)|how is .+ doing|what is .+ up to/i
/** The question is about what happened. */
const EVENT_RE = /发布|动态|新闻|更新|做了什么|发生|宣布|announce|launch|release|news|updates?|happen/i
/** The user lists competitors by name. */
const NAMES_GIVEN = /竞品(有|是|包括)|对手(有|是|包括)|competitors? (are|include)|compared? (to|with)|\bvs\.?\s/i
const BASIC: Dimension[] = ['region', 'features', 'pricing', 'contact']

const DIM_RULES: [RegExp, Dimension[]][] = [
  [/基本信息|概况|basic info|overview|profile/i, ['region', 'features', 'pricing', 'contact']],
  [/地区|国家|总部|哪里|region|country|location|headquarter|\bhq\b/i, ['region']],
  [/功能|特性|产品能力|feature|capabilit/i, ['features']],
  [/定价|价格|收费|多少钱|套餐|pricing|price|plans?\b|cost/i, ['pricing']],
  [/联系|电话|邮箱|销售|contact|email|phone|sales/i, ['contact']],
  [/社媒|社交|推特|微博|领英|账号|social|twitter|x\.com|linkedin|instagram|accounts?\b/i, ['social']],
  [/动态|新闻|最新|更新|发布|宣布|news|updates?|launch|release|announce|latest/i, ['news']],
]

function findCompetitors(q: string): string[] {
  const lower = q.toLowerCase()
  return COMPETITORS.filter((c) => c.aliases.some((a) => lower.includes(a))).map((c) => c.name)
}

function findCompany(q: string): string | undefined {
  const m =
    q.match(/(?:公司叫|公司是|我司是|我们是)\s*([A-Za-z][\w.-]{1,30})/) ??
    q.match(/(?:we are|we're|our company is|my company is|i run)\s+([A-Z][\w.-]{1,30})/)
  return m?.[1]
}

/** Demo-mode version of the server's intent rules (server/src/pipeline/intent-examples.ts has the worked examples). */
function localParse(query: string): Intent {
  const q = query.trim()
  const named = findCompetitors(q)
  // naming a competitor (even one not in the demo data) wins over describing your own company
  const own = OWN_RE.test(q) && !named.length && !NAMES_GIVEN.test(q)
  const explicit = TIME_RULES.find(([re]) => re.test(q))?.[1]
  const status = STATUS_RE.test(q)
  const timeRange: TimeRange = status ? '7d' : (explicit ?? (FUZZY_TIME.test(q) ? '30d' : 'all'))

  const dims = new Set<Dimension>(['name'])
  for (const [re, ds] of DIM_RULES) if (re.test(q)) ds.forEach((d) => dims.add(d))
  const asksBasic = BASIC.some((d) => dims.has(d))
  const timeframe = !own && !asksBasic && (status || (!!explicit && EVENT_RE.test(q)))
  if (timeframe) ['social', 'news'].forEach((d) => dims.add(d as Dimension))
  if (dims.size === 1) DIMENSIONS.forEach((d) => dims.add(d))
  if (own && explicit && EVENT_RE.test(q)) dims.add('social')

  const company = findCompany(q)
  const competitors = own
    ? SUGGESTED_FOR_OWN.filter((n) => n.toLowerCase() !== company?.toLowerCase())
    : named.length
      ? named
      : DEFAULT_NAMED

  return {
    type: own ? 'own' : timeframe ? 'timeframe' : 'named',
    query: q,
    company: own || named.length ? company : undefined,
    competitors,
    timeRange,
    dimensions: DIMENSIONS.filter((d) => dims.has(d)),
  }
}

/** For checks only: the demo parser, exported so the worked examples can be run against it. */
export const __localParse = localParse

/** Step 1 — read a natural-language query into a structured intent. */
export async function parseIntent(query: string, lang: Lang = 'zh'): Promise<Intent> {
  if (!API_BASE) {
    await sleep(700)
    return localParse(query)
  }
  return api<Intent>('/intent', { body: { query, lang } })
}

/* ------------------------------------------------------------------ */
/* Steps 2–5 · fetch, verify, self-check, organise                     */
/* ------------------------------------------------------------------ */

const RANGE_DAYS: Record<TimeRange, number> = { all: 100000, '7d': 7, '30d': 30, '90d': 90, ytd: 0 }

function rangeDays(r: TimeRange): number {
  if (r !== 'ytd') return RANGE_DAYS[r]
  const now = new Date()
  return Math.ceil((now.getTime() - new Date(now.getFullYear(), 0, 1).getTime()) / 86400000)
}

const isoDaysAgo = (n: number) => new Date(Date.now() - n * 86400000).toISOString().slice(0, 10)

const DIM_LABEL: Record<Lang, Record<Dimension, string>> = {
  zh: { name: '名称', region: '地区', features: '功能', pricing: '定价', contact: '联系方式', social: '社媒账号', news: '最新动态' },
  en: { name: 'Name', region: 'Region', features: 'Features', pricing: 'Pricing', contact: 'Contact', social: 'Social', news: 'Latest news' },
}

/** Column header: built-in label or the custom field's own words. */
export function colLabel(lang: Lang, key: string): string {
  return key.startsWith(CUSTOM_PREFIX) ? key.slice(CUSTOM_PREFIX.length) : (DIM_LABEL[lang][key as Dimension] ?? key)
}

function factCell(f: MockFact, lang: Lang): Cell {
  return {
    value: f.value[lang],
    status: 'verified',
    sources: f.sources.map((s) => ({ kind: s.kind, url: s.url, title: s.title[lang] })),
  }
}

function buildCell(c: MockCompetitor, d: Dimension, intent: Intent, lang: Lang): Cell {
  if (d === 'name') {
    return {
      value: c.name,
      status: 'verified',
      sources: [{ kind: 'site', url: `https://${c.domain}`, title: lang === 'zh' ? '官网首页' : 'Homepage' }],
    }
  }
  if (d === 'news' || d === 'social') {
    const max = intent.timeRange === 'all' ? 90 : rangeDays(intent.timeRange)
    const list = (d === 'news' ? c.news : c.posts).filter((n) => n.daysAgo <= max).sort((a, b) => a.daysAgo - b.daysAgo).slice(0, 5)
    if (!list.length) {
      if (d === 'social') return factCell(c.social, lang)
      return { value: lang === 'zh' ? '该时间段内无公开动态' : 'No public updates in this period', status: 'missing', sources: [] }
    }
    const host = (u: string) => {
      try {
        return new URL(u).hostname.replace(/^www\./, '')
      } catch {
        return ''
      }
    }
    const items = list.map((n) => ({
      text: n.text[lang],
      url: n.source.url,
      date: isoDaysAgo(n.daysAgo),
      label: d === 'social' ? n.source.title[lang].split(' ')[0] : host(n.source.url),
    }))
    if (d === 'news') {
      return {
        value: items.length === 1 ? items[0].text : lang === 'zh' ? `近期 ${items.length} 条动态` : `${items.length} recent updates`,
        date: items[0].date,
        status: 'verified',
        sources: list.slice(0, 3).map((n) => ({ kind: n.source.kind, url: n.source.url, title: n.source.title[lang] })),
        items,
      }
    }
    const base = factCell(c.social, lang)
    return {
      ...base,
      value: lang === 'zh' ? `近期 ${items.length} 条帖子 · 要点：${c.socialKey.zh}` : `${items.length} recent posts · Key point: ${c.socialKey.en}`,
      items,
    }
  }
  return factCell(c[d], lang)
}

function unknownRow(name: string, dims: string[], lang: Lang): Row {
  const cells: Row['cells'] = {}
  for (const d of dims) {
    cells[d] =
      d === 'name'
        ? { value: name, status: 'verified', sources: [] }
        : { value: lang === 'zh' ? '演示数据未覆盖' : 'Not in demo data', status: 'missing', sources: [] }
  }
  return { competitor: name, domain: '', cells }
}

async function mockRun(intent: Intent, { lang, onEvent }: RunOptions): Promise<RunResult> {
  const zh = lang === 'zh'
  const emit = async (e: RunEvent, ms = 360) => {
    await sleep(ms + Math.random() * 180)
    onEvent?.(e)
  }
  const dims = columnsOf(intent)
  const known = intent.competitors.map((n) => COMPETITORS.find((c) => c.name.toLowerCase() === n.toLowerCase()))
  const rows: Row[] = intent.competitors.map((n, i) => {
    const c = known[i]
    if (!c) return unknownRow(n, dims, lang)
    const cells: Row['cells'] = {}
    dims.forEach((d) => (cells[d] = d.startsWith(CUSTOM_PREFIX) ? { value: lang === 'zh' ? '演示数据未覆盖' : 'Not in demo data', status: 'missing', sources: [] } : buildCell(c, d as Dimension, intent, lang)))
    return { competitor: c.name, domain: c.domain, cells }
  })

  // Step 2 · multi-source fetch
  let sources = 0
  for (let i = 0; i < rows.length; i++) {
    const c = known[i]
    if (!c) {
      await emit({ stage: 2, kind: 'fail', text: zh ? `${rows[i].competitor} · 未找到官网，跳过` : `${rows[i].competitor} · no official site found, skipped` })
      continue
    }
    const n = Object.values(rows[i].cells).reduce((s, cell) => s + (cell?.sources.length ?? 0), 0) + 2
    sources += n
    await emit({
      stage: 2,
      kind: 'ok',
      text: zh
        ? `${c.name} · 官网 / 搜索排名 / 新闻 / 社媒，共 ${n} 个来源`
        : `${c.name} · site / SEO / news / social — ${n} sources`,
      stats: { sources },
    })
  }

  // Step 3 · fact verification
  const checked = rows.reduce((s, r) => s + Object.keys(r.cells).length, 0)
  await emit({
    stage: 3,
    kind: 'info',
    text: zh ? `逐条核对 ${checked} 条信息的来源 URL 与出处` : `Checking source URL and origin for ${checked} facts`,
  })
  await emit({ stage: 3, kind: 'ok', text: zh ? '来源均可访问，出处已记录' : 'All sources reachable, origins recorded', stats: { checked } })

  // Step 4 · AI self-check → re-query failures
  let requeried = 0
  let dropped = 0
  const label = DIM_LABEL[lang]
  const tryRequery = async (ri: number, d: Dimension, reason: string, fix: string) => {
    const cell = rows[ri]?.cells[d]
    if (!cell || cell.status !== 'verified') return
    await emit({ stage: 4, kind: 'retry', text: `${rows[ri].competitor} · ${label[d]}${zh ? "：" : ": "}${reason}` }, 520)
    await emit({ stage: 4, kind: 'info', text: fix }, 620)
    cell.status = 'requeried'
    requeried++
    await emit({ stage: 4, kind: 'ok', text: zh ? '重查后校验通过' : 'Passed after re-query', stats: { requeried } })
  }
  await tryRequery(
    1,
    'pricing',
    zh ? '搜索摘要与官网定价页不一致' : 'search snippet disagrees with pricing page',
    zh ? '↺ 改为直接抓取官网定价页重新提取' : '↺ Re-fetching the official pricing page',
  )
  await tryRequery(
    0,
    'social',
    zh ? '账号认证状态无法确认' : 'account verification unclear',
    zh ? '↺ 从官网页脚的社媒链接重新定位账号' : '↺ Re-locating the account via the website footer links',
  )
  if (!requeried) {
    const d = (['news', 'features', 'region'] as Dimension[]).find((x) => rows[0]?.cells[x]?.status === 'verified')
    if (d) {
      await tryRequery(
        0,
        d,
        zh ? '不同来源的日期 / 表述不一致' : 'sources disagree on date or wording',
        zh ? '↺ 以官网原文为准重新核对' : '↺ Re-checking against the official page',
      )
    }
  }
  const last = rows.length - 1
  const dropCell = last >= 2 ? rows[last].cells.contact : undefined
  if (dropCell && dropCell.status === 'verified') {
    await emit({ stage: 4, kind: 'retry', text: `${rows[last].competitor} · ${label.contact}：${zh ? '来源页面已失效' : 'source page is gone'}` }, 520)
    await emit({ stage: 4, kind: 'info', text: zh ? '↺ 重查 2 个备选来源' : '↺ Re-querying 2 fallback sources' }, 620)
    dropCell.status = 'missing'
    dropCell.value = zh ? '未找到可靠来源，已剔除' : 'No reliable source — removed'
    dropCell.sources = []
    await emit({ stage: 4, kind: 'fail', text: zh ? '仍未通过，不写入结果' : 'Still failing — left out of results' })
  }
  for (const r of rows) for (const cell of Object.values(r.cells)) if (cell?.status === 'missing') dropped++
  await emit({
    stage: 4,
    kind: 'ok',
    text: zh ? `自检完成 · ${checked - dropped} 条通过` : `Self-check done · ${checked - dropped} passed`,
    stats: { passed: checked - dropped, dropped },
  })

  // Step 5 · organise fields
  await emit({
    stage: 5,
    kind: 'ok',
    text: zh
      ? `整理为 ${dims.length} 个字段${dims.includes('social') ? '，社媒内容已提炼要点' : ''}`
      : `Organised into ${dims.length} fields${dims.includes('social') ? ', social posts summarised' : ''}`,
  })

  const stats: RunStats = { sources, checked, requeried, passed: checked - dropped, dropped }
  return { runId: `run_${Date.now().toString(36)}`, intent, rows, stats, finishedAt: new Date().toISOString() }
}

/** Steps 2–5 — runs the research for a confirmed intent. Real backend unless built with VITE_API_BASE=demo. */
export async function runResearch(intent: Intent, opts: RunOptions): Promise<RunResult> {
  if (!API_BASE) return mockRun(intent, opts)
  const { runId } = await api<{ runId: string }>('/runs', { body: { intent, lang: opts.lang } })
  // live progress over server-sent events; the browser reconnects (with Last-Event-ID) on drops
  return new Promise<RunResult>((resolve, reject) => {
    const es = new EventSource(`${API_BASE}/runs/${runId}/events`, { withCredentials: true })
    let settled = false
    const done = (fn: () => void) => {
      if (settled) return
      settled = true
      es.close()
      fn()
    }
    es.addEventListener('progress', (m) => opts.onEvent?.(JSON.parse((m as MessageEvent).data) as RunEvent))
    es.addEventListener('result', (m) => done(() => resolve(JSON.parse((m as MessageEvent).data) as RunResult)))
    es.addEventListener('failed', () => done(() => reject(new ApiError('run_failed', 500))))
    es.onerror = () => {
      if (es.readyState === EventSource.CLOSED) done(() => reject(new ApiError('network', 0)))
    }
  })
}

/** Recent runs of the signed-in user (server mode only). */
export async function fetchHistory(): Promise<string[]> {
  if (!API_BASE) return []
  const { runs } = await api<{ runs: { query: string }[] }>('/history')
  return [...new Set(runs.map((r) => r.query))].slice(0, 8)
}

export async function fetchQuota(): Promise<{ used: number; limit: number; unlimited?: boolean } | null> {
  if (!API_BASE) return null
  return api<{ used: number; limit: number; unlimited?: boolean }>('/quota')
}

/* ------------------------------------------------------------------ */
/* Step 6 · CSV export                                                 */
/* ------------------------------------------------------------------ */

const esc = (v: string) => (/[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v)

export function toCsv(result: RunResult, lang: Lang): string {
  const dims = columnsOf(result.intent)
  const L = (k: string) => colLabel(lang, k)
  const srcWord = lang === 'zh' ? '来源' : 'source'
  const statusWord = lang === 'zh' ? '校验' : 'check'
  const statusText: Record<string, string> =
    lang === 'zh'
      ? { verified: '通过', requeried: '重查后通过', missing: '未通过' }
      : { verified: 'passed', requeried: 'passed after re-query', missing: 'failed' }

  const header: string[] = []
  for (const d of dims) header.push(L(d), `${L(d)}_${srcWord}`)
  header.push(statusWord)

  const lines = [header.map(esc).join(',')]
  for (const r of result.rows) {
    const out: string[] = []
    let worst = 'verified'
    for (const d of dims) {
      const c = r.cells[d]
      if (c && c.status !== 'missing' && c.items?.length) {
        const items = c.items
        out.push(
          items.map((i) => [i.date, i.label && `[${i.label}]`, i.text].filter(Boolean).join(' ')).join('\n'),
          [...items.map((i) => i.url), ...c.sources.filter((s) => !items.some((i) => i.url === s.url)).map((s) => s.url)].join(' | '),
        )
      } else if (c && c.status !== 'missing') {
        out.push(c.date ? `${c.date} ${c.value}` : c.value, c.sources.map((s) => s.url).join(' | '))
      } else {
        out.push('', '')
      }
      if (c?.status === 'missing') worst = 'missing'
      else if (c?.status === 'requeried' && worst === 'verified') worst = 'requeried'
    }
    out.push(statusText[worst])
    lines.push(out.map(esc).join(','))
  }
  return '﻿' + lines.join('\r\n')
}

type DownloadsNs = { save(r: { filename: string; data: string }): Promise<unknown> }
type ClaudeHost = { use?: (name: string) => Promise<unknown> }

/** Saves the CSV. Inside a claude.ai artifact it goes through the viewer's save dialog; elsewhere a normal download. */
export async function downloadCsv(result: RunResult, lang: Lang): Promise<boolean> {
  const csv = toCsv(result, lang)
  const stamp = new Date().toISOString().slice(0, 16).replace(/[-:T]/g, '')
  const filename = `capsight-${stamp}.csv`

  const host = (window as unknown as { claude?: ClaudeHost }).claude
  if (host?.use) {
    const dl = (await host.use('downloads')) as DownloadsNs | null
    if (dl) {
      try {
        await dl.save({ filename, data: csv })
        return true
      } catch {
        return false
      }
    }
  }

  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
  return true
}
