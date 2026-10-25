export type Lang = 'zh' | 'en'

/** The output fields, in table order. */
export type Dimension = 'name' | 'overview' | 'region' | 'size' | 'funding' | 'features' | 'pricing' | 'contact' | 'social' | 'news'

export const DIMENSIONS: Dimension[] = ['name', 'overview', 'region', 'size', 'funding', 'features', 'pricing', 'contact', 'social', 'news']

/** Default fields per branch (keep in sync with server/src/types.ts). A: list + basic company info · B: full research. */
export const DEFAULT_DIMS_OWN: Dimension[] = ['name', 'overview', 'region', 'size', 'funding']
export const DEFAULT_DIMS_NAMED: Dimension[] = ['name', 'overview', 'region', 'features', 'pricing', 'social', 'news']

/** Where a fact was found. site = the subject's own website · web = another page found by search. */
export type SourceKind = 'site' | 'web' | 'seo' | 'news' | 'social'

/**
 * own       — "find them for me" (competitors of my company, or things matching a description)
 * named     — "facts about these subjects"
 * timeframe — "this dimension, in this time window"
 */
export type IntentType = 'own' | 'named' | 'timeframe'

export type TimeRange = 'all' | '7d' | '30d' | '90d' | 'ytd'

export interface Intent {
  type: IntentType
  query: string
  /** The user's own company, for `own` intents. */
  company?: string
  /** The things being researched (companies, products, schools, cities…). Name kept for compatibility. */
  competitors: string[]
  timeRange: TimeRange
  dimensions: Dimension[]
  /** What kind of thing the subjects are. */
  topic?: string
  /** Extra fields in the user's own words, e.g. ["融资情况", "集成"]. */
  fields?: string[]
  /** Official domains already confirmed (carried over from a "find competitors" run), keyed by subject name. */
  sites?: Record<string, string>
}

/** Column key of a custom field. */
export const CUSTOM_PREFIX = 'f:'
export const customKey = (label: string) => `${CUSTOM_PREFIX}${label}`
export const isCustom = (key: string) => key.startsWith(CUSTOM_PREFIX)
export const MAX_FIELDS = 6
/** All table columns of an intent, in order: built-in fields, then custom ones, then news/social. */
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
  /** Pricing template: slots with no public information (present, possibly empty, on pricing cells). */
  gaps?: string[]
  /** The pricing rests on a dated third-party page because no official page stated it. */
  thirdParty?: boolean
}

export interface Row {
  competitor: string
  domain: string
  /** How the official site was identified (google_kg, wikidata, search_hint, hint_verified, search_domain, search_weak). */
  siteMethod?: string
  /** Keyed by column: a Dimension or `f:<custom label>`. */
  cells: Record<string, Cell | undefined>
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
  /** Pricing template slots filled with verified facts. */
  pricingSlots?: { filled: number; total: number }
  pricingThirdParty?: number
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
