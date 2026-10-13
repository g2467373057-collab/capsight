import { useEffect, useRef } from 'react'

const reduced = () => typeof window !== 'undefined' && !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches

/**
 * The page atmosphere, back to front:
 * drifting brand-colour light → a mood layer that cross-fades per section → dot grid → film grain → vignette.
 * --sy (scrollY) drives the slow parallax; data-mood says which section owns the screen.
 */
export default function BackgroundFX() {
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const el = ref.current
    if (!el) return
    let raf = 0
    const update = () => {
      raf = 0
      const vh = window.innerHeight
      if (!reduced()) el.style.setProperty('--sy', String(window.scrollY))
      const sheet = document.querySelector('.sheet')
      const closing = document.querySelector('.closing')
      let mood = 'app'
      if (sheet) {
        const top = sheet.getBoundingClientRect().top
        mood = top > vh * 0.45 ? 'hero' : closing && closing.getBoundingClientRect().top < vh * 0.55 ? 'closing' : 'features'
      }
      if (el.dataset.mood !== mood) el.dataset.mood = mood
    }
    const on = () => {
      if (!raf) raf = requestAnimationFrame(update)
    }
    update()
    window.addEventListener('scroll', on, { passive: true })
    window.addEventListener('resize', on)
    window.addEventListener('hashchange', on)
    const late = window.setTimeout(update, 300)
    return () => {
      window.removeEventListener('scroll', on)
      window.removeEventListener('resize', on)
      window.removeEventListener('hashchange', on)
      window.clearTimeout(late)
      if (raf) cancelAnimationFrame(raf)
    }
  }, [])

  return (
    <div className="bgfx" aria-hidden ref={ref} data-mood="hero">
      <div className="bgfx__mood bgfx__mood--hero" />
      <div className="bgfx__mood bgfx__mood--features" />
      <div className="bgfx__mood bgfx__mood--closing" />
      <div className="bgfx__mood bgfx__mood--app" />
      <div className="bgfx__blob bgfx__blob--a" />
      <div className="bgfx__blob bgfx__blob--b" />
      <div className="bgfx__blob bgfx__blob--c" />
      <div className="bgfx__blob bgfx__blob--d" />
      <div className="bgfx__grid" />
      <div className="bgfx__grain" />
      <div className="bgfx__vignette" />
    </div>
  )
}

/* ------------------------------------------------------------------ */
/* Foreground plane: small props that scroll faster than the content.   */
/* ------------------------------------------------------------------ */

type Prop = { at: number; side: 'left' | 'right'; x: string; kind: 'chip' | 'dot' | 'tile' | 'ring'; text?: string; speed: number }

const PROPS: Prop[] = [
  { at: 1.15, side: 'left', x: '3.2%', kind: 'chip', text: '✓ src', speed: 1.35 },
  { at: 1.6, side: 'right', x: '4%', kind: 'dot', speed: 1.55 },
  { at: 2.05, side: 'right', x: '2.6%', kind: 'chip', text: '200 OK', speed: 1.3 },
  { at: 2.55, side: 'left', x: '4.8%', kind: 'tile', speed: 1.5 },
  { at: 3.05, side: 'left', x: '2.4%', kind: 'ring', speed: 1.25 },
  { at: 3.45, side: 'right', x: '3.6%', kind: 'chip', text: '↺ re-query', speed: 1.4 },
  { at: 4.05, side: 'left', x: '3.8%', kind: 'chip', text: '.csv', speed: 1.3 },
  { at: 4.5, side: 'right', x: '5%', kind: 'tile', speed: 1.55 },
  { at: 5.1, side: 'right', x: '2.8%', kind: 'dot', speed: 1.35 },
  { at: 5.6, side: 'left', x: '4.2%', kind: 'ring', speed: 1.45 },
]

export function ForegroundFX() {
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const el = ref.current
    if (!el || reduced()) return
    const items = Array.from(el.children) as HTMLElement[]
    let raf = 0
    const update = () => {
      raf = 0
      const vh = window.innerHeight
      const sy = window.scrollY
      items.forEach((it, i) => {
        const p = PROPS[i]
        const y = p.at * vh - sy * p.speed
        it.style.transform = `translate3d(0, ${y.toFixed(1)}px, 0)`
        it.style.visibility = y > -120 && y < vh + 120 ? 'visible' : 'hidden'
      })
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
  return (
    <div className="fgfx" aria-hidden ref={ref}>
      {PROPS.map((p, i) => (
        <span key={i} className={`fgfx__prop fgfx__prop--${p.kind}`} style={{ [p.side]: p.x }}>
          {p.text}
        </span>
      ))}
    </div>
  )
}
