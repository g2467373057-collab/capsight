import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import type { Lang } from './types.ts'

/** Minimal .env loader: KEY=value lines, # comments, optional quotes. Never overrides real env vars. */
export function loadDotEnv(file = resolve(process.cwd(), '.env')) {
  if (!existsSync(file)) return
  for (const raw of readFileSync(file, 'utf8').split(/\r?\n/)) {
    const line = raw.trim()
    if (!line || line.startsWith('#')) continue
    const eq = line.indexOf('=')
    if (eq < 1) continue
    const key = line.slice(0, eq).trim()
    let val = line.slice(eq + 1).trim()
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) val = val.slice(1, -1)
    if (process.env[key] === undefined) process.env[key] = val
  }
}

export type LlmProviderName = 'deepseek' | 'qwen' | 'qwen-intl' | 'openai' | 'anthropic' | 'mock'
export type SearchProviderName = 'serper' | 'bocha' | 'mock' | 'none'
export type NewsProviderName = 'googlenews' | 'gdelt' | 'bocha' | 'serper' | 'mock' | 'none'

export interface LlmConfig {
  provider: LlmProviderName
  apiKey: string
  model: string
  baseUrl?: string
}

export interface Config {
  env: 'development' | 'production' | 'test'
  port: number
  host: string
  /** Public URL of the web app, used in e-mails and CORS. */
  appUrl: string
  allowedOrigins: string[]
  dbPath: string
  /** Built web app (web/dist) to serve from the same origin; empty = API only. */
  staticDir: string
  cookie: { name: string; secure: boolean; sameSite: 'Lax' | 'Strict' | 'None'; domain?: string; days: number }
  requireEmailVerification: boolean
  /** Accounts (by e-mail) without the per-user daily limit, e.g. the operator testing the app. */
  adminEmails: string[]
  limits: { runsPerUserPerDay: number; runsPerDayGlobal: number; maxCompetitors: number; concurrency: number; maxRequery: number }
  llm: Record<Lang, LlmConfig>
  search: Record<Lang, SearchProviderName>
  news: Record<Lang, NewsProviderName[]>
  keys: {
    serper?: string
    bocha?: string
    xBearer?: string
    youtube?: string
    redditId?: string
    redditSecret?: string
    redditUserAgent?: string
    resend?: string
    jina?: string
  }
  mailFrom: string
  fetch: { timeoutMs: number; maxBytes: number; userAgent: string; allowPrivate: boolean; respectRobots: boolean; reader: 'none' | 'jina' }
  cacheHours: number
  /** Look up official websites on Wikidata (free, public structured data). */
  wikidata: boolean
  /** Posts read per X account (5–100). X bills per post read. */
  xMaxPosts: number
}

const str = (k: string, d = '') => process.env[k]?.trim() || d
const num = (k: string, d: number) => {
  const v = Number(process.env[k])
  return Number.isFinite(v) && process.env[k] !== '' && process.env[k] !== undefined ? v : d
}
const bool = (k: string, d: boolean) => {
  const v = process.env[k]?.trim().toLowerCase()
  return v === undefined || v === '' ? d : ['1', 'true', 'yes', 'on'].includes(v)
}
const list = (k: string, d: string[]) => {
  const v = process.env[k]?.trim()
  return v ? v.split(',').map((s) => s.trim()).filter(Boolean) : d
}

const LLM_DEFAULT_MODEL: Record<LlmProviderName, string> = {
  deepseek: 'deepseek-flash',
  qwen: 'qwen-plus',
  'qwen-intl': 'qwen-plus',
  openai: 'gpt-4o-mini',
  anthropic: 'claude-haiku-5-5',
  mock: 'mock',
}

const LLM_KEY_ENV: Record<LlmProviderName, string> = {
  deepseek: 'DEEPSEEK_API_KEY',
  qwen: 'DASHSCOPE_API_KEY',
  'qwen-intl': 'DASHSCOPE_API_KEY',
  openai: 'OPENAI_API_KEY',
  anthropic: 'ANTHROPIC_API_KEY',
  mock: '',
}

function llmFor(suffix: '' | '_ZH' | '_EN', fallback?: LlmConfig): LlmConfig {
  const provider = (str(`LLM_PROVIDER${suffix}`) || fallback?.provider || 'deepseek') as LlmProviderName
  if (!(provider in LLM_DEFAULT_MODEL)) throw new Error(`Unknown LLM_PROVIDER${suffix}: ${provider}`)
  const sameAsFallback = fallback && provider === fallback.provider && !str(`LLM_MODEL${suffix}`)
  return {
    provider,
    apiKey: LLM_KEY_ENV[provider] ? str(LLM_KEY_ENV[provider]) : '',
    model: str(`LLM_MODEL${suffix}`) || (sameAsFallback ? fallback.model : LLM_DEFAULT_MODEL[provider]),
    baseUrl: str(`LLM_BASE_URL${suffix}`) || (sameAsFallback ? fallback.baseUrl : undefined),
  }
}

export function loadConfig(): Config {
  const env = (str('NODE_ENV', 'development') as Config['env']) || 'development'
  // RENDER_EXTERNAL_URL / RAILWAY_PUBLIC_DOMAIN are set automatically by those hosts.
  const hosted = process.env.RENDER_EXTERNAL_URL || (process.env.RAILWAY_PUBLIC_DOMAIN ? `https://${process.env.RAILWAY_PUBLIC_DOMAIN}` : '')
  const appUrl = str('APP_URL', hosted || 'http://localhost:5173').replace(/\/$/, '')
  const base = llmFor('')
  const prod = env === 'production'
  return {
    env,
    port: num('PORT', 8787),
    host: str('HOST', '0.0.0.0'),
    appUrl,
    allowedOrigins: list('ALLOWED_ORIGINS', [appUrl]),
    adminEmails: list('ADMIN_EMAILS', []).map((e) => e.toLowerCase()),
    dbPath: str('DB_PATH', resolve(process.cwd(), 'data/capsight.db')),
    staticDir: str('STATIC_DIR', resolve(process.cwd(), '../web/dist')),
    cookie: {
      name: 'ts_session',
      secure: bool('COOKIE_SECURE', prod),
      sameSite: (str('COOKIE_SAMESITE', 'Lax') as Config['cookie']['sameSite']) || 'Lax',
      domain: str('COOKIE_DOMAIN') || undefined,
      days: num('SESSION_DAYS', 30),
    },
    requireEmailVerification: bool('REQUIRE_EMAIL_VERIFICATION', prod),
    limits: {
      runsPerUserPerDay: num('RUNS_PER_USER_PER_DAY', 3),
      runsPerDayGlobal: num('RUNS_PER_DAY_GLOBAL', 500),
      maxCompetitors: num('MAX_COMPETITORS', 5),
      concurrency: num('RUN_CONCURRENCY', 3),
      maxRequery: num('MAX_REQUERY', 2),
    },
    llm: { en: llmFor('_EN', base), zh: llmFor('_ZH', base) },
    search: {
      en: str('SEARCH_PROVIDER_EN', 'serper') as SearchProviderName,
      zh: str('SEARCH_PROVIDER_ZH', 'bocha') as SearchProviderName,
    },
    news: {
      en: list('NEWS_PROVIDERS_EN', ['googlenews', 'gdelt']) as NewsProviderName[],
      zh: list('NEWS_PROVIDERS_ZH', ['bocha', 'gdelt']) as NewsProviderName[],
    },
    keys: {
      serper: str('SERPER_API_KEY') || undefined,
      bocha: str('BOCHA_API_KEY') || undefined,
      // X_ENABLED=false keeps the token in keys.env but skips paid X calls (search-based posts still run).
      xBearer: str('X_ENABLED').toLowerCase() === 'false' ? undefined : str('X_BEARER_TOKEN') || undefined,
      youtube: str('YOUTUBE_API_KEY') || undefined,
      redditId: str('REDDIT_CLIENT_ID') || undefined,
      redditSecret: str('REDDIT_CLIENT_SECRET') || undefined,
      redditUserAgent: str('REDDIT_USER_AGENT') || undefined,
      resend: str('RESEND_API_KEY') || undefined,
      jina: str('JINA_API_KEY') || undefined,
    },
    mailFrom: str('MAIL_FROM', 'Capsight <noreply@example.com>'),
    fetch: {
      timeoutMs: num('FETCH_TIMEOUT_MS', 12000),
      maxBytes: num('FETCH_MAX_BYTES', 2_000_000),
      userAgent: str('FETCH_USER_AGENT', `CapsightBot/1.0 (+${appUrl}/#bot)`),
      allowPrivate: bool('FETCH_ALLOW_PRIVATE', false),
      respectRobots: bool('FETCH_RESPECT_ROBOTS', true),
      // JavaScript-rendered pages (pricing tables) are read through Jina Reader by default; READER=none turns it off
      reader: (str('READER', 'jina') as 'none' | 'jina') || 'jina',
    },
    cacheHours: num('CACHE_HOURS', 12),
    wikidata: bool('WIKIDATA', true),
    xMaxPosts: Math.min(100, Math.max(5, num('X_MAX_POSTS', 5))),
  }
}

/** Problems that would stop a production deploy from working; logged at start-up. */
export function configWarnings(c: Config): string[] {
  const w: string[] = []
  for (const lang of ['en', 'zh'] as const) {
    const l = c.llm[lang]
    if (l.provider !== 'mock' && !l.apiKey) w.push(`LLM (${lang}): ${l.provider} has no API key`)
    const s = c.search[lang]
    if (s === 'serper' && !c.keys.serper) w.push(`Search (${lang}): SERPER_API_KEY missing`)
    if (s === 'bocha' && !c.keys.bocha) w.push(`Search (${lang}): BOCHA_API_KEY missing`)
  }
  if (!c.keys.xBearer) w.push('Social: X API off (no X_BEARER_TOKEN or X_ENABLED=false) — X posts come from search instead')
  if (!c.keys.youtube) w.push('Social: YOUTUBE_API_KEY missing — YouTube will be skipped')
  if (!c.keys.redditId || !c.keys.redditSecret) w.push('Social: Reddit credentials missing — Reddit will be skipped')
  if (c.requireEmailVerification && !c.keys.resend) w.push('Mail: RESEND_API_KEY missing — e-mails are only printed to the log')
  if (c.env === 'production' && !c.cookie.secure) w.push('Cookies are not Secure in production')
  return w
}
