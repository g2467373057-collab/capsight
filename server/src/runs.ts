import { EventEmitter } from 'node:events'
import type { Config } from './config.ts'
import type { Db } from './db/db.ts'
import { newId } from './auth/crypto.ts'
import { HttpError } from './http/http.ts'
import type { Llm } from './llm/llm.ts'
import { runResearch } from './pipeline/run.ts'
import type { Fetcher } from './sources/fetcher.ts'
import type { SearchStack } from './sources/search.ts'
import type { Social } from './sources/social.ts'
import type { Intent, Lang, RunEvent, RunResult } from './types.ts'

export interface Providers {
  llm(lang: Lang): Llm
  search(lang: Lang): SearchStack
  fetcher: Fetcher
  social: Social
}

export type RunStatus = 'queued' | 'running' | 'done' | 'failed'

interface RunRow {
  id: string
  user_id: string
  query: string
  lang: string
  intent_json: string
  status: RunStatus
  result_json: string | null
  error: string | null
  created_at: number
  finished_at: number | null
}

/** Queues research runs, persists their events and results, and fans events out to live listeners. */
export class Runs {
  private db: Db
  private cfg: Config
  private providers: Providers
  private bus = new EventEmitter()
  private queue: string[] = []
  private active = 0
  constructor(db: Db, cfg: Config, providers: Providers) {
    this.db = db
    this.cfg = cfg
    this.providers = providers
    this.bus.setMaxListeners(0)
    // runs interrupted by a restart cannot resume
    db.prepare("UPDATE runs SET status = 'failed', error = 'interrupted', finished_at = ? WHERE status IN ('queued', 'running')").run(Date.now())
  }

  private startOfDay() {
    const d = new Date()
    return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate())
  }

  quota(userId: string, email = '') {
    const admin = this.cfg.adminEmails.includes(email.toLowerCase())
    const used = (this.db.prepare("SELECT COUNT(*) AS n FROM runs WHERE user_id = ? AND created_at >= ? AND error IS NOT 'interrupted'").get(userId, this.startOfDay()) as { n: number }).n
    return { used, limit: admin ? Math.max(this.cfg.limits.runsPerUserPerDay, used + 100) : this.cfg.limits.runsPerUserPerDay, unlimited: admin, resetsAt: new Date(this.startOfDay() + 86400000).toISOString() }
  }

  start(userId: string, intent: Intent, lang: Lang, email = ''): string {
    const q = this.quota(userId, email)
    if (q.used >= q.limit) throw new HttpError(429, 'daily_limit', undefined, q)
    const global = (this.db.prepare('SELECT COUNT(*) AS n FROM runs WHERE created_at >= ?').get(this.startOfDay()) as { n: number }).n
    if (global >= this.cfg.limits.runsPerDayGlobal) throw new HttpError(503, 'service_busy')
    const running = (this.db.prepare("SELECT COUNT(*) AS n FROM runs WHERE user_id = ? AND status IN ('queued','running')").get(userId) as { n: number }).n
    if (running >= 2) throw new HttpError(429, 'too_many_running')
    const id = newId('run')
    this.db
      .prepare("INSERT INTO runs (id, user_id, query, lang, intent_json, status, created_at) VALUES (?, ?, ?, ?, ?, 'queued', ?)")
      .run(id, userId, intent.query, lang, JSON.stringify(intent), Date.now())
    this.queue.push(id)
    this.pump()
    return id
  }

  private pump() {
    while (this.active < this.cfg.limits.concurrency && this.queue.length) {
      const id = this.queue.shift()!
      this.active++
      this.execute(id).finally(() => {
        this.active--
        this.pump()
      })
    }
  }

  private seq = new Map<string, number>()

  private emit(runId: string, e: RunEvent) {
    const seq = (this.seq.get(runId) ?? 0) + 1
    this.seq.set(runId, seq)
    this.db.prepare('INSERT INTO run_events (run_id, seq, json, created_at) VALUES (?, ?, ?, ?)').run(runId, seq, JSON.stringify(e), Date.now())
    this.bus.emit(runId, { type: 'event', seq, event: e })
  }

  private async execute(id: string) {
    const row = this.db.prepare('SELECT * FROM runs WHERE id = ?').get(id) as RunRow | undefined
    if (!row) return
    const lang = (row.lang === 'en' ? 'en' : 'zh') as Lang
    this.db.prepare("UPDATE runs SET status = 'running' WHERE id = ?").run(id)
    const llm = this.providers.llm(lang)
    const before = { ...llm.usage }
    try {
      const result = await runResearch(id, JSON.parse(row.intent_json) as Intent, {
        llm,
        search: this.providers.search(lang),
        fetcher: this.providers.fetcher,
        social: this.providers.social,
        lang,
        maxRequery: this.cfg.limits.maxRequery,
        emit: (e) => this.emit(id, e),
      })
      const usage = { calls: llm.usage.calls - before.calls, inputTokens: llm.usage.inputTokens - before.inputTokens, outputTokens: llm.usage.outputTokens - before.outputTokens }
      this.db.prepare("UPDATE runs SET status = 'done', result_json = ?, usage_json = ?, finished_at = ? WHERE id = ?").run(JSON.stringify(result), JSON.stringify(usage), Date.now(), id)
      this.bus.emit(id, { type: 'result', result })
    } catch (e) {
      const msg = (e as Error).message?.slice(0, 200) || 'failed'
      console.error(`[run ${id}]`, e)
      this.db.prepare("UPDATE runs SET status = 'failed', error = ?, finished_at = ? WHERE id = ?").run(msg, Date.now(), id)
      this.bus.emit(id, { type: 'error', error: 'run_failed' })
    } finally {
      this.seq.delete(id)
    }
  }

  get(id: string, userId: string) {
    const row = this.db.prepare('SELECT * FROM runs WHERE id = ? AND user_id = ?').get(id, userId) as RunRow | undefined
    if (!row) throw new HttpError(404, 'not_found')
    return {
      id: row.id,
      status: row.status,
      query: row.query,
      lang: row.lang as Lang,
      createdAt: new Date(row.created_at).toISOString(),
      result: row.result_json ? (JSON.parse(row.result_json) as RunResult) : undefined,
      error: row.status === 'failed' ? 'run_failed' : undefined,
    }
  }

  events(id: string, afterSeq = 0): { seq: number; event: RunEvent }[] {
    return (this.db.prepare('SELECT seq, json FROM run_events WHERE run_id = ? AND seq > ? ORDER BY seq').all(id, afterSeq) as { seq: number; json: string }[]).map((r) => ({
      seq: r.seq,
      event: JSON.parse(r.json) as RunEvent,
    }))
  }

  subscribe(id: string, fn: (m: { type: 'event'; seq: number; event: RunEvent } | { type: 'result'; result: RunResult } | { type: 'error'; error: string }) => void) {
    this.bus.on(id, fn)
    return () => this.bus.off(id, fn)
  }

  history(userId: string, limit = 20) {
    return (this.db.prepare('SELECT id, query, status, created_at FROM runs WHERE user_id = ? ORDER BY created_at DESC LIMIT ?').all(userId, limit) as Pick<RunRow, 'id' | 'query' | 'status' | 'created_at'>[]).map((r) => ({
      id: r.id,
      query: r.query,
      status: r.status,
      createdAt: new Date(r.created_at).toISOString(),
    }))
  }
}
