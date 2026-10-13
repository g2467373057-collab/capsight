/* Shapes shared with the web app (web/src/api/types.ts). Keep the two in sync. */

export type Lang = 'zh' | 'en'

export type Dimension = 'name' | 'region' | 'features' | 'pricing' | 'contact' | 'social' | 'news'
export const DIMENSIONS: Dimension[] = ['name', 'region', 'features', 'pricing', 'contact', 'social', 'news']

export type SourceKind = 'site' | 'seo' | 'news' | 'social'
export type IntentType = 'own' | 'named' | 'timeframe'
export type TimeRange = 'all' | '7d' | '30d' | '90d' | 'ytd'
export const TIME_RANGES: TimeRange[] = ['all', '7d', '30d', '90d', 'ytd']

export interface Intent {
  type: IntentType
  query: string
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
  cells: Partial<Record<Dimension, Cell>>
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
