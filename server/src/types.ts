/* Shapes shared with the web app (web/src/api/types.ts). Keep the two in sync. */

export type Lang = 'zh' | 'en'

export type Dimension = 'name' | 'region' | 'features' | 'pricing' | 'contact' | 'social' | 'news'
export const DIMENSIONS: Dimension[] = ['name', 'region', 'features', 'pricing', 'contact', 'social', 'news']

/** site = the subject's own website · web = any other page found by search · seo = search snippet */
export type SourceKind = 'site' | 'web' | 'seo' | 'news' | 'social'
export type IntentType = 'own' | 'named' | 'timeframe'
export type TimeRange = 'all' | '7d' | '30d' | '90d' | 'ytd'
export const TIME_RANGES: TimeRange[] = ['all', '7d', '30d', '90d', 'ytd']

export interface Intent {
  type: IntentType
  query: string
  company?: string
  /** The things being researched (companies, products, schools, cities, tools…). Name kept for compatibility. */
  competitors: string[]
  timeRange: TimeRange
  dimensions: Dimension[]
  /** What kind of thing the subjects are, e.g. "SaaS 产品", "大学硕士项目", "城市". */
  topic?: string
  /** Extra fields the user wants, in their own words, e.g. ["学费", "申请截止日期"]. */
  fields?: string[]
}

/** Column key of a custom field. */
export const CUSTOM_PREFIX = 'f:'
export const customKey = (label: string) => `${CUSTOM_PREFIX}${label}`
export const isCustom = (key: string) => key.startsWith(CUSTOM_PREFIX)
/** All table columns of an intent, in order: built-in fields, then custom ones. */
export function columnsOf(intent: Pick<Intent, 'dimensions' | 'fields'>): string[] {
  const dims = intent.dimensions
  const head = dims.filter((d) => d !== 'news' && d !== 'social')
  const tail = dims.filter((d) => d === 'news' || d === 'social')
  return [...head, ...(intent.fields ?? []).map(customKey), ...tail]
}

export interface Source {
  kind: SourceKind
  url: string
  title: string
}

export type CellStatus = 'verified' | 'requeried' | 'missing'

/** One summarised post or article inside a list cell (latest news, social). */
export interface CellItem {
  /** One-sentence summary written by the model from the item itself. */
  text: string
  url: string
  date?: string
  /** Where it came from, e.g. "X", "LinkedIn", "微博", or the news outlet. */
  label?: string
}

export interface Cell {
  value: string
  sources: Source[]
  status: CellStatus
  date?: string
  /** Present for list fields: each item has its own summary and link. */
  items?: CellItem[]
}

export interface Row {
  competitor: string
  domain: string
  /** Keyed by column: a Dimension or `f:<custom label>`. */
  cells: Record<string, Cell | undefined>
}

export type RunStage = 2 | 3 | 4 | 5
export type RunEventKind = 'info' | 'ok' | 'retry' | 'fail'

export interface RunStats {
  sources: number
  checked: number
  requeried: number
  passed: number
  dropped: number
}

export interface RunEvent {
  stage: RunStage
  kind: RunEventKind
  text: string
  stats?: Partial<RunStats>
}

export interface RunResult {
  runId: string
  intent: Intent
  rows: Row[]
  stats: RunStats
  finishedAt: string
}

export interface PublicUser {
  id: string
  name: string
  email: string
  emailVerified: boolean
}
