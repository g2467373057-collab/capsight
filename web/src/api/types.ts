export type Lang = 'zh' | 'en'

/** The seven output fields, in table order. */
export type Dimension = 'name' | 'region' | 'features' | 'pricing' | 'contact' | 'social' | 'news'

export const DIMENSIONS: Dimension[] = ['name', 'region', 'features', 'pricing', 'contact', 'social', 'news']

/** Where a fact was found. */
export type SourceKind = 'site' | 'seo' | 'news' | 'social'

/**
 * own       — "find competitors of my company"
 * named     — "basic info on these competitors"
 * timeframe — "this dimension, in this time window"
 */
export type IntentType = 'own' | 'named' | 'timeframe'

export type TimeRange = 'all' | '7d' | '30d' | '90d' | 'ytd'

export interface Intent {
  type: IntentType
  query: string
  /** The user's own company, for `own` intents. */
  company?: string
  competitors: string[]
  timeRange: TimeRange
  dimensions: Dimension[]
}

export interface Source {
  kind: SourceKind
  url: string
  title: string
}

/** verified: passed first check · requeried: failed self-check, passed after re-query · missing: dropped */
export type CellStatus = 'verified' | 'requeried' | 'missing'

/** One summarised post or article inside a list cell (latest news, social). */
export interface CellItem {
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
  /** ISO date, for time-bound facts such as news. */
  date?: string
  /** Present for list fields: each item has its own summary and link. */
  items?: CellItem[]
}

export interface Row {
  competitor: string
  domain: string
  cells: Partial<Record<Dimension, Cell>>
}

/** Pipeline stage a log line belongs to: 2 fetch · 3 verify · 4 self-check · 5 organise */
export type RunStage = 2 | 3 | 4 | 5

export type RunEventKind = 'info' | 'ok' | 'retry' | 'fail'

export interface RunEvent {
  stage: RunStage
  kind: RunEventKind
  text: string
  /** Optional running counters, merged into the live stats. */
  stats?: Partial<RunStats>
}

export interface RunStats {
  sources: number
  checked: number
  requeried: number
  passed: number
  dropped: number
}

export interface RunResult {
  runId: string
  intent: Intent
  rows: Row[]
  stats: RunStats
  finishedAt: string
}

export interface RunOptions {
  lang: Lang
  onEvent?: (e: RunEvent) => void
}
