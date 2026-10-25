import { useEffect, useRef, useState, type FormEvent, type KeyboardEvent } from 'react'
import { colLabel, downloadCsv, parseIntent, runResearch } from '../api/client'
import {
  DEFAULT_DIMS_NAMED,
  DIMENSIONS,
  MAX_FIELDS,
  columnsOf,
  type Cell,
  type Dimension,
  type Intent,
  type IntentType,
  type RunEvent,
  type RunResult,
  type RunStats,
  type Source,
  type TimeRange,
} from '../api/types'
import { COMPETITORS } from '../data/mock'
import { useLang } from '../i18n'
import { errorText } from '../data/content'
import { isDemo } from '../api/http'
import TraceGauge from './TraceGauge'
import { Icon } from './ui'

type Phase = 'input' | 'parsing' | 'intent' | 'running' | 'done'

const ZERO: RunStats = { sources: 0, checked: 0, requeried: 0, passed: 0, dropped: 0 }
const TYPES: IntentType[] = ['own', 'named', 'timeframe']
const RANGES: TimeRange[] = ['all', '7d', '30d', '90d', 'ytd']

function canonical(name: string): string {
  const n = name.trim().toLowerCase()
  return COMPETITORS.find((c) => c.name.toLowerCase() === n || c.aliases.includes(n))?.name ?? name.trim()
}

/* ---------------- small pieces ---------------- */

/** Three steps: ask → researching (with the live sub-stage) → results. */
function Stepper({ current, running, sub }: { current: number; running: boolean; sub?: string }) {
  const { t } = useLang()
  return (
    <ol className="stepper">
      {t.studio.steps.map((s, i) => (
        <li
          key={s}
          className={`stepper__item ${i < current ? 'is-done' : ''} ${i === current ? 'is-current' : ''} ${
            i === current && running ? 'is-running' : ''
          }`}
        >
          <span className="stepper__dot">{i < current ? '✓' : i + 1}</span>
          <span className="stepper__label">
            {s}
            {i === 1 && i === current && sub && <small className="stepper__sub">{sub}</small>}
          </span>
        </li>
      ))}
    </ol>
  )
}

function SourcePill({ s }: { s: Source }) {
  const { t } = useLang()
  let host = ''
  try {
    host = new URL(s.url).hostname.replace(/^www\./, '')
  } catch {
    host = s.url
  }
  const label = s.kind === 'seo' || s.kind === 'news' ? t.sources[s.kind].label : host
  return (
    <a className={`src-pill src-pill--${s.kind}`} href={s.url} target="_blank" rel="noreferrer" title={`${s.title}\n${s.url}`}>
      <Icon name={s.kind === 'web' ? 'site' : s.kind} size={12} />
      {label}
    </a>
  )
}

function CellView({ c }: { c?: Cell }) {
  const { t } = useLang()
  if (!c) return <td />
  if (c.status === 'missing') {
    return (
      <td className="cell cell--missing">
        <span className="cell__v">{c.value}</span>
      </td>
    )
  }
  // pricing template: the slots with no public information are named, never left blank; a third-party basis is flagged
  const gaps = (
    <>
      {c.thirdParty && (
        <span className="cell__meta">
          <span className="badge-loop">{t.studio.result.thirdParty}</span>
        </span>
      )}
      {c.gaps?.length ? (
        <span className="cell__meta cell__gaps">
          {t.studio.result.noInfo}：{c.gaps.join(' / ')}
        </span>
      ) : null}
    </>
  )
  if (c.items?.length) {
    const template = c.gaps !== undefined
    const extra = template ? c.sources : c.sources.filter((s) => s.kind === 'social' && !c.items!.some((i) => i.url === s.url))
    return (
      <td className="cell cell--list">
        {!(c.items.length === 1 && c.items[0].text === c.value) && <span className="cell__v cell__v--sum">{c.value}</span>}
        <ol className="cell__items">
          {c.items.map((i, k) => (
            <li key={i.url + k}>
              <span className="cell__ihead">
                {i.date && <span className="cell__date">{i.date.slice(5)}</span>}
                {i.label && <span className="cell__label">{i.label}</span>}
              </span>
              <a className="cell__itext" href={i.url} target="_blank" rel="noreferrer" title={i.url}>
                {i.text}
                <Icon name="external" size={11} />
              </a>
            </li>
          ))}
        </ol>
        {extra.length > 0 && (
          <span className="cell__meta">
            {extra.map((s) => (
              <SourcePill key={s.url} s={s} />
            ))}
            {c.status === 'requeried' && <span className="badge-loop" title={t.studio.result.requeried}>↺ {t.studio.result.requeriedShort}</span>}
          </span>
        )}
        {gaps}
      </td>
    )
  }
  return (
    <td className={`cell ${c.status === 'requeried' ? 'cell--requeried' : ''}`}>
      <span className="cell__v">
        {c.date && <span className="cell__date">{c.date}</span>}
        {c.value}
      </span>
      <span className="cell__meta">
        {c.sources.map((s) => (
          <SourcePill key={s.url + s.kind} s={s} />
        ))}
        {c.status === 'requeried' && <span className="badge-loop" title={t.studio.result.requeried}>↺ {t.studio.result.requeriedShort}</span>}
      </span>
      {gaps}
    </td>
  )
}

/* ---------------- main ---------------- */

export default function Console({
  incoming,
  onDone,
}: {
  incoming: { q: string; n: number } | null
  /** Called with the query when a run finishes (for the history list). */
  onDone?: (query: string) => void
}) {
  const { t, lang } = useLang()
  const s = t.studio

  const [phase, setPhase] = useState<Phase>('input')
  const [query, setQuery] = useState('')
  const [intent, setIntent] = useState<Intent | null>(null)
  const [adding, setAdding] = useState('')
  const [addingField, setAddingField] = useState('')
  const [events, setEvents] = useState<RunEvent[]>([])
  const [live, setLive] = useState<RunStats>(ZERO)
  const [result, setResult] = useState<RunResult | null>(null)
  const [exported, setExported] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [showLog, setShowLog] = useState(true)

  const token = useRef(0)
  const logRef = useRef<HTMLOListElement>(null)

  const detect = async (text: string) => {
    const q = text.trim()
    if (!q) return
    const my = ++token.current
    setQuery(q)
    setError(null)
    setResult(null)
    setEvents([])
    setExported(false)
    setPhase('parsing')
    try {
      const it = await parseIntent(q, lang)
      if (my !== token.current) return
      setIntent(it)
      setPhase('intent')
    } catch (e) {
      if (my !== token.current) return
      setError(errorText(t, e))
      setPhase('input')
    }
  }

  const run = async () => {
    if (!intent || !intent.competitors.length) return
    const my = ++token.current
    setPhase('running')
    setShowLog(true)
    setEvents([])
    setLive(ZERO)
    setExported(false)
    try {
      const res = await runResearch(intent, {
        lang,
        onEvent: (e) => {
          if (my !== token.current) return
          setEvents((ev) => [...ev, e])
          if (e.stats) setLive((st) => ({ ...st, ...e.stats }))
        },
      })
      if (my !== token.current) return
      setResult(res)
      setLive(res.stats)
      setShowLog(false)
      setPhase('done')
      onDone?.(intent.query)
    } catch (e) {
      if (my !== token.current) return
      setError(errorText(t, e))
      setPhase('intent')
    }
  }

  /** Branch A done → look up details for the competitors found, keeping their confirmed official sites. The user can still edit before running. */
  const details = () => {
    if (!result) return
    const rows = result.rows
    const sites = Object.fromEntries(rows.filter((r) => r.domain).map((r) => [r.competitor, r.domain]))
    const wanted = new Set<Dimension>([...result.intent.dimensions, ...DEFAULT_DIMS_NAMED])
    token.current++
    setIntent({
      type: 'named',
      query: t.studio.result.detailsQuery(result.intent.query),
      ...(result.intent.company ? { company: result.intent.company } : {}),
      competitors: rows.map((r) => r.competitor),
      timeRange: 'all',
      dimensions: DIMENSIONS.filter((d) => wanted.has(d)),
      ...(result.intent.topic ? { topic: result.intent.topic } : {}),
      ...(result.intent.fields?.length ? { fields: result.intent.fields } : {}),
      ...(Object.keys(sites).length ? { sites } : {}),
    })
    setResult(null)
    setEvents([])
    setExported(false)
    setError(null)
    setPhase('intent')
  }

  const reset = () => {
    token.current++
    setPhase('input')
    setResult(null)
    setIntent(null)
    setEvents([])
    setExported(false)
  }

  // Hand-off from the hero search box.
  useEffect(() => {
    if (incoming) void detect(incoming.q)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [incoming?.n])

  // Keep the live log pinned to the newest line (inside its own box only).
  useEffect(() => {
    const el = logRef.current
    if (el) el.scrollTop = el.scrollHeight
  }, [events])

  /* ---- intent editing ---- */
  const patch = (p: Partial<Intent>) => setIntent((it) => (it ? { ...it, ...p } : it))

  const setType = (type: IntentType) => {
    if (!intent) return
    if (type === 'timeframe') {
      const dims = intent.dimensions.includes('news') ? intent.dimensions : [...intent.dimensions, 'news' as Dimension]
      patch({ type, timeRange: intent.timeRange === 'all' ? '30d' : intent.timeRange, dimensions: DIMENSIONS.filter((d) => dims.includes(d)) })
    } else patch({ type })
  }

  const toggleDim = (d: Dimension) => {
    if (!intent || d === 'name') return
    const on = intent.dimensions.includes(d)
    const next = on ? intent.dimensions.filter((x) => x !== d) : [...intent.dimensions, d]
    patch({ dimensions: DIMENSIONS.filter((x) => next.includes(x)) })
  }

  const addCompetitor = () => {
    if (!intent) return
    const name = canonical(adding)
    if (name && !intent.competitors.some((c) => c.toLowerCase() === name.toLowerCase())) {
      patch({ competitors: [...intent.competitors, name] })
    }
    setAdding('')
  }

  const fields = intent?.fields ?? []
  const addField = () => {
    const label = addingField.replace(/\s+/g, ' ').trim().slice(0, 24)
    if (intent && label && fields.length < MAX_FIELDS && !fields.some((f) => f.toLowerCase() === label.toLowerCase())) {
      patch({ fields: [...fields, label] })
    }
    setAddingField('')
  }
  const onFieldKey = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.preventDefault()
      addField()
    }
  }

  const onAddKey = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.preventDefault()
      addCompetitor()
    }
  }

  const submit = (e: FormEvent) => {
    e.preventDefault()
    void detect(query)
  }

  /* ---- derived ---- */
  const lastStage = events.length ? events[events.length - 1].stage : 2
  const current =
    phase === 'input' || phase === 'parsing' || phase === 'intent' ? 0 : phase === 'running' ? 1 : exported ? 3 : 2
  const busy = phase === 'parsing' || phase === 'running'
  const showInput = phase === 'input' || phase === 'parsing'

  return (
    <div className="glass console" id="studio">
        <div className="console__bar">
          <span className="dots" aria-hidden>
            <span />
            <span />
            <span />
          </span>
          <span className="console__title">{s.window}</span>
        </div>

        <div className="studio__stepper">
          <Stepper current={current} running={busy} sub={phase === 'running' ? s.stages[lastStage - 1] : undefined} />
        </div>

        <div className="console__body studio__body">
          {/* ---------- 1 · ask ---------- */}
          {showInput && (
            <div className="pane pane--ask">
              <label className="pane__label" htmlFor="studio-q">
                {s.ask}
              </label>
              <form className="console__field ask ask--studio" onSubmit={submit}>
                <input
                  id="studio-q"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder={t.hero.placeholder}
                  disabled={phase === 'parsing'}
                />
                <button className="btn btn--red" type="submit" disabled={phase === 'parsing' || !query.trim()}>
                  {phase === 'parsing' ? s.detecting : s.detect}
                </button>
              </form>
              <div className="examples">
                <span className="mono-label">{s.tryOne}</span>
                {t.examples.map((ex) => (
                  <button key={ex} type="button" className="example" onClick={() => void detect(ex)} disabled={phase === 'parsing'}>
                    {ex}
                  </button>
                ))}
              </div>
              {phase === 'parsing' && <div className="shimmer" aria-hidden />}
              {error && <p className="error">{error}</p>}
            </div>
          )}

          {/* ---------- intent card ---------- */}
          {intent && !showInput && phase !== 'intent' && (
            <div className="pane intent-sum">
              <span className="intent-sum__q">“{intent.query}”</span>
              <span className="chip chip--on">{t.intentTypes[intent.type]}</span>
              {intent.competitors.map((c) => (
                <span key={c} className="chip">
                  {c}
                </span>
              ))}
              <span className="chip">{t.timeRanges[intent.timeRange]}</span>
              {intent.topic && <span className="chip">{intent.topic}</span>}
              <span className="chip">
                {columnsOf(intent).length} {lang === 'zh' ? '个字段' : 'fields'}
              </span>
            </div>
          )}

          {intent && phase === 'intent' && (
            <div className="pane pane--intent">
              <div className="pane__head">
                <div>
                  <p className="pane__label">{s.intent.heading}</p>
                  <p className="pane__query">“{intent.query}”</p>
                </div>
                {phase === 'intent' && (
                  <button className="btn btn--ghost btn--sm" onClick={reset}>
                    {s.intent.edit}
                  </button>
                )}
              </div>

              <dl className="intent">
                <div>
                  <dt>{s.intent.type}</dt>
                  <dd className="seg">
                    {TYPES.map((ty) => (
                      <button key={ty} className={intent.type === ty ? 'is-on' : ''} onClick={() => setType(ty)}>
                        {t.intentTypes[ty]}
                      </button>
                    ))}
                  </dd>
                </div>

                {intent.type === 'own' && (
                  <div>
                    <dt>{s.intent.company}</dt>
                    <dd>
                      <input
                        className="field"
                        value={intent.company ?? ''}
                        placeholder={s.intent.companyPh}
                        onChange={(e) => patch({ company: e.target.value })}
                      />
                    </dd>
                  </div>
                )}

                <div>
                  <dt>
                    {s.intent.competitors}
                    {intent.topic && <small>{intent.topic}</small>}
                    {intent.type === 'own' && <small>{s.intent.suggested}</small>}
                  </dt>
                  <dd className="chips">
                    {intent.competitors.map((c) => (
                      <span key={c} className="chip chip--on">
                        {c}
                        {phase === 'intent' && (
                          <button
                            aria-label={`remove ${c}`}
                            onClick={() => patch({ competitors: intent.competitors.filter((x) => x !== c) })}
                          >
                            <Icon name="close" size={12} />
                          </button>
                        )}
                      </span>
                    ))}
                    {phase === 'intent' && (
                      <span className="chip chip--add">
                        <input
                          list={isDemo ? 'ts-competitors' : undefined}
                          value={adding}
                          placeholder={`+ ${s.intent.add}`}
                          onChange={(e) => setAdding(e.target.value)}
                          onKeyDown={onAddKey}
                          onBlur={() => adding.trim() && addCompetitor()}
                        />
                        {isDemo && (
                          <datalist id="ts-competitors">
                            {COMPETITORS.map((c) => (
                              <option key={c.name} value={c.name} />
                            ))}
                          </datalist>
                        )}
                      </span>
                    )}
                  </dd>
                </div>

                <div>
                  <dt>{s.intent.time}</dt>
                  <dd className="chips">
                    {RANGES.map((r) => (
                      <button
                        key={r}
                        className={`chip ${intent.timeRange === r ? 'chip--on' : ''}`}
                        onClick={() => patch({ timeRange: r })}
                      >
                        {t.timeRanges[r]}
                      </button>
                    ))}
                  </dd>
                </div>

                <div>
                  <dt>{s.intent.dims}</dt>
                  <dd className="chips">
                    {DIMENSIONS.map((d) => (
                      <button
                        key={d}
                        className={`chip ${intent.dimensions.includes(d) ? 'chip--on' : ''}`}
                        onClick={() => toggleDim(d)}
                        disabled={d === 'name'}
                      >
                        {intent.dimensions.includes(d) ? '✓ ' : ''}
                        {t.dims[d]}
                      </button>
                    ))}
                  </dd>
                </div>

                <div>
                  <dt>
                    {s.intent.fields}
                    <small>{s.intent.fieldsHint}</small>
                  </dt>
                  <dd className="chips">
                    {fields.map((f) => (
                      <span key={f} className="chip chip--on">
                        {f}
                        <button aria-label={`remove ${f}`} onClick={() => patch({ fields: fields.filter((x) => x !== f) })}>
                          <Icon name="close" size={12} />
                        </button>
                      </span>
                    ))}
                    {fields.length < MAX_FIELDS && (
                      <span className="chip chip--add">
                        <input
                          value={addingField}
                          placeholder={`+ ${s.intent.addField}`}
                          onChange={(e) => setAddingField(e.target.value)}
                          onKeyDown={onFieldKey}
                          onBlur={() => addingField.trim() && addField()}
                        />
                      </span>
                    )}
                  </dd>
                </div>
              </dl>

              {phase === 'intent' && (
                <div className="pane__foot">
                  <button className="btn btn--red" onClick={() => void run()} disabled={!intent.competitors.length}>
                    {s.intent.run} <Icon name="arrow" size={18} />
                  </button>
                  {error && <p className="error">{error}</p>}
                </div>
              )}
            </div>
          )}

          {/* ---------- 2–5 · live run ---------- */}
          {(phase === 'running' || phase === 'done') && (
            <div className="pane pane--live">
              <div className="pane__head">
                <p className="pane__label">
                  {phase === 'running' && <span className="pulse" />}
                  {phase === 'running' ? s.live.heading : s.live.done}
                </p>
                <div className="counters">
                  <span>
                    <b>{live.sources}</b> {s.live.sources}
                  </span>
                  <span>
                    <b>{live.checked}</b> {s.live.checked}
                  </span>
                  <span className="counters--loop">
                    <b>{live.requeried}</b> {s.live.requeried}
                  </span>
                  <span className="counters--ok">
                    <b>{live.passed}</b> {s.live.passed}
                  </span>
                </div>
              </div>
              {phase === 'done' && (
                <button className="log-toggle" onClick={() => setShowLog((v) => !v)}>
                  {showLog ? s.result.hideLog : `${s.result.showLog} (${events.length})`}
                </button>
              )}
              {showLog && (
              <ol className="log" ref={logRef}>
                {events.map((e, i) => (
                  <li key={i} className={`log__line log__line--${e.kind}`}>
                    <span className="log__stage">{s.stages[e.stage - 1]}</span>
                    <span className="log__icon">{e.kind === 'ok' ? '✓' : e.kind === 'retry' ? '!' : e.kind === 'fail' ? '✕' : '·'}</span>
                    <span>{e.text}</span>
                  </li>
                ))}
              </ol>
              )}
            </div>
          )}

          {/* ---------- 6 · results ---------- */}
          {phase === 'done' && result && (
            <div className="pane pane--result">
              <div className="result-head">
                <TraceGauge ratio={result.stats.checked ? result.stats.passed / result.stats.checked : 0} label={s.result.passRate} />
                <div className="result-head__text">
                  <p className="pane__label">{s.result.heading}</p>
                  <h3>{s.result.summary(result.rows.length, columnsOf(result.intent).length)}</h3>
                  <p className="legend">
                    <span className="legend__i legend__i--ok">{s.result.verified}</span>
                    <span className="legend__i legend__i--loop">{s.result.requeried}</span>
                    <span className="legend__i legend__i--bad">{s.result.missing}</span>
                  </p>
                </div>
                <div className="result-head__actions">
                  {result.intent.type === 'own' && result.rows.length > 0 && (
                    <button className="btn btn--red" onClick={details} title={s.result.detailsHint}>
                      <Icon name="table" size={18} />
                      {s.result.details}
                    </button>
                  )}
                  <button
                    className="btn btn--red"
                    onClick={async () => {
                      if (await downloadCsv(result, lang)) setExported(true)
                    }}
                  >
                    <Icon name="download" size={18} />
                    {exported ? s.result.exported : s.result.export}
                  </button>
                  <button className="btn btn--glass btn--soon" disabled aria-disabled title={s.result.soon}>
                    <Icon name="table" size={18} />
                    {s.result.analysis}
                    <span className="soon-badge">{s.result.soon}</span>
                  </button>
                  <button className="btn btn--glass" onClick={reset}>
                    {s.result.again}
                  </button>
                </div>
              </div>

              <div className="ftable-wrap">
                <table className="ftable">
                  <thead>
                    <tr>
                      {columnsOf(result.intent).map((d) => (
                        <th key={d}>{colLabel(lang, d)}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {result.rows.map((r) => (
                      <tr key={r.competitor}>
                        {columnsOf(result.intent).map((d) => (
                          <CellView key={d} c={r.cells[d]} />
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {isDemo && <p className="footnote">{s.result.note}</p>}
            </div>
          )}
        </div>
    </div>
  )
}
