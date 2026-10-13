import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react'
import type { Title } from '../data/content'

const reducedMotion = () =>
  typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches

/** Fades + lifts children in the first time they scroll into view. */
export function Reveal({
  children,
  delay = 0,
  className = '',
  as: Tag = 'div',
}: {
  children: ReactNode
  delay?: number
  className?: string
  as?: 'div' | 'li' | 'article' | 'section'
}) {
  const ref = useRef<HTMLElement | null>(null)
  const [shown, setShown] = useState(false)

  useEffect(() => {
    const el = ref.current
    if (!el || reducedMotion() || typeof IntersectionObserver === 'undefined') {
      setShown(true)
      return
    }
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          setShown(true)
          io.disconnect()
        }
      },
      { threshold: 0.15, rootMargin: '0px 0px -40px 0px' },
    )
    io.observe(el)
    return () => io.disconnect()
  }, [])

  const style: CSSProperties = { transitionDelay: `${delay}s` }
  return (
    <Tag
      ref={(n: HTMLElement | null) => {
        ref.current = n
      }}
      className={`reveal ${shown ? 'is-in' : ''} ${className}`}
      style={style}
    >
      {children}
    </Tag>
  )
}

/** Splits a title into display lines (on "\n"); the accent and tail sit on the last line. */
export function TitleLines({ title }: { title: Title }) {
  const parts = title.pre.split('\n')
  const last = parts.pop() ?? ''
  const lines: ReactNode[] = parts.map((p) => p)
  lines.push(
    <>
      {last}
      <span className="accent">{title.accent}</span>
      {title.post}
    </>,
  )
  return (
    <>
      {lines.map((l, i) => (
        <span key={i} className="line">
          <span className="line__in" style={{ transitionDelay: `${0.08 + i * 0.09}s`, animationDelay: `${0.12 + i * 0.1}s` }}>
            {l}
          </span>
        </span>
      ))}
    </>
  )
}

export function SectionHeader({
  index,
  eyebrow,
  title,
  sub,
}: {
  index: string
  eyebrow: string
  title: Title
  sub?: string
}) {
  return (
    <Reveal className="section-header">
      <p className="eyebrow">
        // {index} {eyebrow}
      </p>
      <h2>
        <TitleLines title={title} />
      </h2>
      {sub && <p className="section-sub">{sub}</p>}
    </Reveal>
  )
}

/** Writes window scroll position (px) into a CSS variable on the target element. */
/**
 * Writes scroll state into a CSS variable on the element.
 * page: window.scrollY in px · self: 0..1 progress through the element · viewport: 0..1 over the first screen.
 */
export function useScrollVar<T extends HTMLElement>(name: string, mode: 'page' | 'self' | 'viewport' = 'page') {
  const ref = useRef<T>(null)
  useEffect(() => {
    const el = ref.current
    if (!el || reducedMotion()) return
    let raf = 0
    const update = () => {
      raf = 0
      if (mode === 'page') {
        el.style.setProperty(name, String(window.scrollY))
      } else if (mode === 'viewport') {
        const p = Math.min(1, Math.max(0, window.scrollY / Math.max(1, window.innerHeight)))
        el.style.setProperty(name, p.toFixed(4))
        el.classList.toggle('is-covered', p >= 0.999)
      } else {
        const r = el.getBoundingClientRect()
        const p = Math.min(1, Math.max(0, -r.top / Math.max(1, r.height)))
        el.style.setProperty(name, p.toFixed(4))
      }
    }
    const onScroll = () => {
      if (!raf) raf = requestAnimationFrame(update)
    }
    update()
    window.addEventListener('scroll', onScroll, { passive: true })
    window.addEventListener('resize', onScroll)
    return () => {
      window.removeEventListener('scroll', onScroll)
      window.removeEventListener('resize', onScroll)
      if (raf) cancelAnimationFrame(raf)
    }
  }, [name, mode])
  return ref
}

/**
 * Parallax for a group: every descendant with `data-speed="N"` drifts N px (±N/2 around centre)
 * while the group scrolls through the viewport — cards in one row move at different speeds.
 */
export function useParallax<T extends HTMLElement>() {
  const ref = useRef<T>(null)
  useEffect(() => {
    const root = ref.current
    if (!root || reducedMotion()) return
    let raf = 0
    const update = () => {
      raf = 0
      const r = root.getBoundingClientRect()
      const vh = window.innerHeight
      const v = Math.min(1, Math.max(0, (vh - r.top) / (vh + r.height)))
      root.querySelectorAll<HTMLElement>('[data-speed]').forEach((el) => {
        const k = Number(el.dataset.speed) || 0
        el.style.transform = `translate3d(0, ${((v - 0.5) * k).toFixed(1)}px, 0)`
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
  return ref
}

const ICON_PATHS: Record<string, ReactNode> = {
  chat: (
    <>
      <path d="M5 5h14a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H10l-4 3v-3H5a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2z" />
      <path d="M8 10h8M8 13h5" />
    </>
  ),
  link: (
    <>
      <path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1" />
      <path d="M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1" />
    </>
  ),
  loop: (
    <>
      <path d="M4 12a8 8 0 0 1 13.7-5.7L20 8.5" />
      <path d="M20 4v4.5h-4.5" />
      <path d="M20 12a8 8 0 0 1-13.7 5.7L4 15.5" />
      <path d="M4 20v-4.5h4.5" />
    </>
  ),
  table: (
    <>
      <rect x="3.5" y="4.5" width="17" height="15" rx="2.5" />
      <path d="M3.5 9.5h17M3.5 14.5h17M9.5 9.5v10" />
    </>
  ),
  site: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M3 12h18M12 3c2.5 2.7 3.8 5.7 3.8 9s-1.3 6.3-3.8 9c-2.5-2.7-3.8-5.7-3.8-9S9.5 5.7 12 3z" />
    </>
  ),
  seo: (
    <>
      <circle cx="10.5" cy="10.5" r="6.5" />
      <path d="M15.5 15.5 20 20" />
      <path d="M8 12.5v-2M10.5 12.5v-4M13 12.5v-3" />
    </>
  ),
  news: (
    <>
      <rect x="3.5" y="5" width="13" height="14" rx="2" />
      <path d="M16.5 9H20v8a2 2 0 0 1-2 2h-1.5" />
      <path d="M7 9h6M7 12.5h6M7 16h4" />
    </>
  ),
  social: (
    <>
      <circle cx="7" cy="12" r="2.5" />
      <circle cx="17" cy="6.5" r="2.5" />
      <circle cx="17" cy="17.5" r="2.5" />
      <path d="M9.2 10.8 14.8 7.7M9.2 13.2l5.6 3.1" />
    </>
  ),
  arrow: <path d="M5 12h14M13 6l6 6-6 6" />,
  download: (
    <>
      <path d="M12 4v11M7 10l5 5 5-5" />
      <path d="M5 19h14" />
    </>
  ),
  close: <path d="M7 7l10 10M17 7 7 17" />,
  x: (
    <>
      <path d="M4.5 4h4.2l10.8 16h-4.2z" />
      <path d="M19 4l-6.1 6.9M11.2 13.1 5 20" />
    </>
  ),
  linkedin: (
    <>
      <rect x="3.5" y="3.5" width="17" height="17" rx="3.5" />
      <path d="M8 10.5V16M8 7.8v.1M11.5 16v-5.5M11.5 13c0-1.6 1-2.6 2.4-2.6s2.1 1 2.1 2.6v3" />
    </>
  ),
  reddit: (
    <>
      <ellipse cx="12" cy="14.5" rx="7.5" ry="5" />
      <circle cx="9.3" cy="14" r=".6" />
      <circle cx="14.7" cy="14" r=".6" />
      <path d="M9.5 16.6c1.5.9 3.5.9 5 0M12 9.5l1.2-5 3.3.8" />
      <circle cx="17.6" cy="5.6" r="1.2" />
      <circle cx="19" cy="11" r="1.4" />
      <circle cx="5" cy="11" r="1.4" />
    </>
  ),
  user: (
    <>
      <circle cx="12" cy="8.5" r="3.5" />
      <path d="M5 19.5c1.2-3.3 3.8-5 7-5s5.8 1.7 7 5" />
    </>
  ),
  plus: <path d="M12 5v14M5 12h14" />,
  mail: (
    <>
      <rect x="3" y="5" width="18" height="14" rx="2" />
      <path d="m4 7 8 6 8-6" />
    </>
  ),
  external: <path d="M14 5h5v5M19 5l-8 8M17 14v4a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V8a1 1 0 0 1 1-1h4" />,
  clock: (
    <>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M12 7.5V12l3 2" />
    </>
  ),
}

export function Icon({ name, size = 22 }: { name: string; size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.7}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      {ICON_PATHS[name]}
    </svg>
  )
}
