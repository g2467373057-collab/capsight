import { useEffect, useRef, useState, type ReactNode } from 'react'
import { COMPETITORS } from '../data/mock'
import { useLang } from '../i18n'
import TraceGauge from './TraceGauge'
import { Icon, Reveal, SectionHeader, useParallax } from './ui'
import type { SourceKind } from '../api/types'

/* ------------------------------------------------------------------ */
/* Looping product demos, drawn with the studio's own components.       */
/* Each scene is a pure function of `t` (ms into its loop), so it is    */
/* easy to retime. A scene only plays while it is on screen.            */
/* ------------------------------------------------------------------ */

/** Playback speed of the demos (1 = timings as written below). */
const SPEED = 1.5

const reduced = () => typeof window !== 'undefined' && !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches

/**
 * Milliseconds into a repeating loop. Plays only while on screen and `active`;
 * restarts from 0 every time it becomes playable.
 */
function useLoop(loopMs: number, restMs: number, active = true) {
  const ref = useRef<HTMLDivElement>(null)
  const [t, setT] = useState(() => (reduced() ? restMs : 0))
  const [visible, setVisible] = useState(false)
  useEffect(() => {
    const el = ref.current
    if (!el || typeof IntersectionObserver === 'undefined') {
      setVisible(true)
      return
    }
    const io = new IntersectionObserver(([e]) => setVisible(e.isIntersecting), { threshold: 0.3 })
    io.observe(el)
    return () => io.disconnect()
  }, [])
  useEffect(() => {
    if (reduced()) {
      setT(restMs)
      return
    }
    if (!visible || !active) return
    const start = performance.now()
    setT(0)
    const id = window.setInterval(() => setT(((performance.now() - start) * SPEED) % loopMs), 40)
    return () => window.clearInterval(id)
  }, [visible, active, loopMs, restMs])
  return { ref, t }
}

const clamp01 = (x: number) => Math.min(1, Math.max(0, x))
/** 0→1 progress of t across [a, b]. */
const span = (t: number, a: number, b: number) => clamp01((t - a) / (b - a))
const ease = (x: number) => 1 - Math.pow(1 - x, 3)

function Window({ stage, fading, children }: { stage: number; fading: boolean; children: ReactNode }) {
  const { t } = useLang()
  // the six pipeline stages map onto three visible steps: ask · researching · results
  const step = stage <= 0 ? 0 : stage <= 4 ? 1 : stage === 5 ? 2 : 3
  return (
    <div className="glass console demo spot">
      <div className="console__bar">
        <span className="dots" aria-hidden>
          <span />
          <span />
          <span />
        </span>
        <span className="console__title">{t.studio.window}</span>
      </div>
      <ol className="demo__steps" aria-hidden>
        {t.studio.steps.map((s, i) => (
          <li key={s} className={i < step ? 'is-done' : i === step ? 'is-current' : ''}>
            <span className="demo__dot">{i < step ? '✓' : i + 1}</span>
            {i === step && <span>{s}</span>}
          </li>
        ))}
      </ol>
      <div className={`demo__body ${fading ? 'is-fading' : ''}`}>{children}</div>
    </div>
  )
}

/* ---------- 1 · type a question, get the intent back ---------- */
function SceneIntent({ active = true }: { active?: boolean }) {
  const { t: c } = useLang()
  const v = c.features.viz
  const L = 9200
  const { ref, t } = useLoop(L, 8000, active)
  const typed = Math.round(span(t, 500, 2700) * v.query.length)
  const pressed = t > 2800 && t < 3000
  const parsing = t >= 2900 && t < 3900
  const shown = t >= 3900
  const pop = (at: number) => (t >= at ? 'is-in' : '')
  const comps = ['Notion', 'Coda', 'ClickUp', 'Airtable']
  return (
    <div ref={ref}>
      <Window stage={shown ? 1 : 0} fading={t > L - 500}>
        <p className="pane__label">{c.studio.ask}</p>
        <div className="console__field ask ask--studio demo__ask">
          <span className="demo__input">
            {typed ? v.query.slice(0, typed) : <span className="demo__ph">{c.hero.placeholder}</span>}
            {!shown && t < 2900 && <span className="caret" />}
          </span>
          <span className={`btn btn--red btn--sm ${pressed ? 'is-pressed' : ''} ${typed < v.query.length ? 'is-dim' : ''}`}>
            {parsing ? c.studio.detecting : c.studio.detect}
          </span>
        </div>
        {parsing && <div className="shimmer" />}
        {shown && (
          <div className="pane demo__pane">
            <p className="pane__label">{c.studio.intent.heading}</p>
            <dl className="intent intent--demo">
              <div className={`pop ${pop(4100)}`}>
                <dt>{c.studio.intent.type}</dt>
                <dd>
                  <span className="chip chip--on">{c.intentTypes.own}</span>
                </dd>
              </div>
              <div className={`pop ${pop(4500)}`}>
                <dt>{c.studio.intent.competitors}</dt>
                <dd className="chips">
                  {comps.map((n, i) => (
                    <span key={n} className={`chip chip--on pop ${pop(4600 + i * 180)}`}>
                      {n}
                    </span>
                  ))}
                </dd>
              </div>
              <div className={`pop ${pop(5500)}`}>
                <dt>{c.studio.intent.time}</dt>
                <dd>
                  <span className="chip chip--on">{c.timeRanges.all}</span>
                </dd>
              </div>
              <div className={`pop ${pop(5900)}`}>
                <dt>{c.studio.intent.dims}</dt>
                <dd className="chips">
                  {(['name', 'region', 'features', 'pricing', 'contact', 'social', 'news'] as const).map((d, i) => (
                    <span key={d} className={`chip chip--on pop ${pop(6000 + i * 90)}`}>
                      ✓ {c.dims[d]}
                    </span>
                  ))}
                </dd>
              </div>
            </dl>
            <span className={`btn btn--red btn--sm demo__run pop ${pop(6800)}`}>
              {c.studio.intent.run} <Icon name="arrow" size={14} />
            </span>
          </div>
        )}
      </Window>
    </div>
  )
}

/* ---------- 2 · four source types fetched in parallel ---------- */
const KINDS: SourceKind[] = ['site', 'seo', 'news', 'social']
const RATES = [1, 0.8, 0.65, 0.5]

function SceneFetch({ active = true }: { active?: boolean }) {
  const { t: c } = useLang()
  const v = c.features.viz
  const L = 8000
  const { ref, t } = useLoop(L, 6000, active)
  const comps = COMPETITORS.slice(0, 4)
  const counts = [9, 8, 9, 7]
  const lines = comps.filter((_, i) => t >= 900 + i * 900)
  const sources = lines.reduce((s, _, i) => s + counts[i], 0)
  return (
    <div ref={ref}>
      <Window stage={1} fading={t > L - 500}>
        <div className="demo__bars">
          {KINDS.map((k, i) => {
            const p = ease(span(t, 300, 300 + 3600 / RATES[i]))
            return (
              <div key={k} className="viz__src">
                <span className={`src-icon src-icon--${k}`}>
                  <Icon name={k} size={16} />
                </span>
                <div className="viz__src-main">
                  <div className="viz__src-top">
                    <strong>{c.sources[k].label}</strong>
                    <span className="mono">{Math.round(p * 100)}%</span>
                  </div>
                  <div className="viz__bar">
                    <span style={{ width: `${p * 100}%` }} />
                  </div>
                </div>
              </div>
            )
          })}
        </div>
        <div className="pane demo__pane">
          <div className="pane__head">
            <p className="pane__label">
              {t < 4800 && <span className="pulse" />}
              {c.studio.live.heading}
            </p>
            <div className="counters">
              <span>
                <b>{sources}</b> {c.studio.live.sources}
              </span>
            </div>
          </div>
          <ol className="log log--demo">
            {lines.map((m, i) => (
              <li key={m.name} className="log__line log__line--ok">
                <span className="log__stage">{c.studio.stages[1]}</span>
                <span className="log__icon">✓</span>
                <span>{v.fetchLine(m.name, counts[i])}</span>
              </li>
            ))}
          </ol>
        </div>
      </Window>
    </div>
  )
}

/* ---------- 3 · verify, catch a mismatch, re-query ---------- */
function SceneVerify({ active = true }: { active?: boolean }) {
  const { t: c, lang } = useLang()
  const v = c.features.viz
  const L = 9000
  const { ref, t } = useLoop(L, 7500, active)
  const at = [500, 1400, 2500, 3500, 4600]
  const lines = v.verifyLog.filter((_, i) => t >= at[i])
  const fixed = t >= 4600
  const checking = t >= 2500 && t < 4600
  const coda = COMPETITORS[1]
  return (
    <div ref={ref}>
      <Window stage={t < 2500 ? 2 : 3} fading={t > L - 500}>
        <div className="pane demo__pane">
          <div className="pane__head">
            <p className="pane__label">
              {!fixed && <span className="pulse" />}
              {c.studio.stages[t < 2500 ? 2 : 3]}
            </p>
            <div className="counters">
              <span>
                <b>{t >= 1400 ? 15 : 0}</b> {c.studio.live.checked}
              </span>
              <span className="counters--loop">
                <b>{fixed ? 1 : 0}</b> {c.studio.live.requeried}
              </span>
            </div>
          </div>
          <ol className="log log--demo">
            {lines.map((l, i) => (
              <li key={i} className={`log__line log__line--${l.kind}`}>
                <span className="log__stage">{c.studio.stages[i < 2 ? 2 : 3]}</span>
                <span className="log__icon">{l.kind === 'ok' ? '✓' : l.kind === 'retry' ? '!' : '·'}</span>
                <span>{l.text}</span>
              </li>
            ))}
          </ol>
        </div>
        <div className="ftable-wrap demo__table">
          <table className="ftable">
            <thead>
              <tr>
                <th>{c.dims.name}</th>
                <th>{c.dims.pricing}</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td className="cell">
                  <span className="cell__v">{coda.name}</span>
                </td>
                <td className={`cell ${fixed ? 'cell--requeried is-flash' : checking ? 'cell--checking' : ''}`}>
                  <span className="cell__v">{fixed ? coda.pricing.value[lang] : v.before}</span>
                  <span className="cell__meta">
                    {fixed ? (
                      <span className="src-pill">
                        <Icon name="site" size={12} />
                        coda.io
                      </span>
                    ) : (
                      <span className="src-pill src-pill--seo">
                        <Icon name="seo" size={12} />
                        {c.sources.seo.label}
                      </span>
                    )}
                    {fixed && <span className="badge-loop">↺ {c.studio.result.requeriedShort}</span>}
                  </span>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </Window>
    </div>
  )
}

/* ---------- 4 · results table, click Export ---------- */
function SceneExport({ active = true }: { active?: boolean }) {
  const { t: c, lang } = useLang()
  const v = c.features.viz
  const L = 8800
  const { ref, t } = useLoop(L, 6000, active)
  const rows = COMPETITORS.slice(0, 3)
  const ratio = 0.93 * ease(span(t, 200, 1600))
  const cursor = span(t, 2600, 3500)
  const pressed = t > 3550 && t < 3750
  const done = t >= 3700
  const stamp = '202610101118'
  return (
    <div ref={ref}>
      <Window stage={done ? 6 : 5} fading={t > L - 500}>
        <div className="result-head result-head--demo">
          <TraceGauge ratio={ratio} label={c.studio.result.passRate} />
          <div className="result-head__text">
            <p className="pane__label">{c.studio.result.heading}</p>
            <h3>{c.studio.result.summary(3, 3)}</h3>
          </div>
          <span className="demo__btnwrap">
            <span className={`btn btn--red btn--sm ${pressed ? 'is-pressed' : ''}`}>
              <Icon name="download" size={14} />
              {done ? c.studio.result.exported : c.studio.result.export}
            </span>
            <svg
              className="demo__cursor"
              viewBox="0 0 24 24"
              width="22"
              height="22"
              style={{
                opacity: t > 2400 && t < 5200 ? 1 : 0,
                transform: `translate(${(1 - ease(cursor)) * 70}px, ${(1 - ease(cursor)) * 60}px) scale(${pressed ? 0.85 : 1})`,
              }}
              aria-hidden
            >
              <path d="M5 3l14 8-6 1.6L10 19z" />
            </svg>
          </span>
        </div>
        <div className="ftable-wrap demo__table">
          <table className="ftable">
            <thead>
              <tr>
                <th>{c.dims.name}</th>
                <th>{c.dims.region}</th>
                <th>{c.dims.pricing}</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r, i) => (
                <tr key={r.name} className={`pop ${t >= 700 + i * 300 ? 'is-in' : ''}`}>
                  <td className="cell">
                    <span className="cell__v">{r.name}</span>
                  </td>
                  <td className="cell">
                    <span className="cell__v">{r.region.value[lang]}</span>
                  </td>
                  <td className="cell">
                    <span className="cell__v">{r.pricing.value[lang]}</span>
                    <span className="cell__meta">
                      <span className="src-pill">
                        <Icon name="site" size={12} />
                        {r.domain}
                      </span>
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className={`demo__toast ${t >= 3900 && t < 7800 ? 'is-in' : ''}`} role="status">
          <span className="viz__file-icon">CSV</span>
          <span>
            {v.saved} <span className="mono">capsight-{stamp}.csv</span>
          </span>
        </div>
      </Window>
    </div>
  )
}

const SCENES = [SceneIntent, SceneFetch, SceneVerify, SceneExport]

function useStoryMode() {
  const q = '(min-width: 961px)'
  const [on, setOn] = useState(() => !reduced() && !!window.matchMedia?.(q).matches)
  useEffect(() => {
    const mq = window.matchMedia(q)
    const f = () => setOn(!reduced() && mq.matches)
    mq.addEventListener('change', f)
    return () => mq.removeEventListener('change', f)
  }, [])
  return on
}

/** Desktop: the demo window stays pinned while the four captions scroll past; the window follows along. */
function Story() {
  const { t } = useLang()
  const [active, setActive] = useState(0)
  const steps = useRef<(HTMLDivElement | null)[]>([])
  const deck = useRef<HTMLDivElement>(null)

  useEffect(() => {
    let raf = 0
    const update = () => {
      raf = 0
      const mid = window.innerHeight * 0.5
      let best = 0
      let dist = Infinity
      steps.current.forEach((el, i) => {
        if (!el) return
        const r = el.getBoundingClientRect()
        const d = Math.abs(r.top + r.height / 2 - mid)
        if (d < dist) {
          dist = d
          best = i
        }
      })
      setActive(best)
    }
    const on = () => {
      if (!raf) raf = requestAnimationFrame(update)
    }
    update()
    window.addEventListener('scroll', on, { passive: true })
    window.addEventListener('resize', on)
    return () => {
      window.removeEventListener('scroll', on)
      window.removeEventListener('resize', on)
      if (raf) cancelAnimationFrame(raf)
    }
  }, [])

  const tilt = (e: { clientX: number; clientY: number }) => {
    const el = deck.current
    if (!el) return
    const r = el.getBoundingClientRect()
    const x = (e.clientX - r.left) / r.width - 0.5
    const y = (e.clientY - r.top) / r.height - 0.5
    el.style.setProperty('--ry', `${(x * 6).toFixed(2)}deg`)
    el.style.setProperty('--rx', `${(-y * 5).toFixed(2)}deg`)
  }
  const untilt = () => {
    deck.current?.style.setProperty('--ry', '0deg')
    deck.current?.style.setProperty('--rx', '0deg')
  }

  return (
    <section id="features" className="section story-sec">
      <SectionHeader index="01" eyebrow={t.features.eyebrow} title={t.features.title} sub={t.features.sub} />
      <div className="story">
        <div className="story__steps">
          {t.features.items.map((f, i) => (
            <div
              key={f.tag}
              ref={(n) => {
                steps.current[i] = n
              }}
              className={`story__step ${i === active ? 'is-active' : ''}`}
            >
              <p className="mono-label">
                {String(i + 1).padStart(2, '0')} · {f.tag}
              </p>
              <h3>{f.title}</h3>
              <p className="muted">{f.body}</p>
            </div>
          ))}
        </div>
        <div className="story__stage">
          <div className="story__sticky">
            <div className="story__pager" aria-hidden>
              {t.features.items.map((f, i) => (
                <span key={f.tag} className={i === active ? 'is-on' : i < active ? 'is-past' : ''}>
                  {String(i + 1).padStart(2, '0')}
                </span>
              ))}
            </div>
            <div className="story__deck" ref={deck} onPointerMove={tilt} onPointerLeave={untilt}>
              {SCENES.map((Scene, i) => (
                <div key={i} className={`story__scene ${i === active ? 'is-active' : i < active ? 'is-past' : ''}`}>
                  <Scene active={i === active} />
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </section>
  )
}

/** Phones and reduced motion: alternating rows, each demo plays when it scrolls into view. */
function Rows() {
  const { t } = useLang()
  const ref = useParallax<HTMLElement>()
  return (
    <section id="features" className="section" ref={ref}>
      <SectionHeader index="01" eyebrow={t.features.eyebrow} title={t.features.title} sub={t.features.sub} />
      <div className="features">
        {t.features.items.map((f, i) => {
          const Scene = SCENES[i]
          return (
            <div key={f.tag} className={`feature ${i % 2 ? 'feature--flip' : ''}`}>
              <Reveal className="feature__text">
                <p className="mono-label">
                  {String(i + 1).padStart(2, '0')} · {f.tag}
                </p>
                <h3>{f.title}</h3>
                <p className="muted">{f.body}</p>
              </Reveal>
              <Reveal className="feature__media" delay={0.1}>
                <div className="feature__frame" data-speed={i % 2 ? -50 : 50}>
                  <Scene />
                </div>
              </Reveal>
            </div>
          )
        })}
      </div>
    </section>
  )
}

export default function Features() {
  return useStoryMode() ? <Story /> : <Rows />
}
