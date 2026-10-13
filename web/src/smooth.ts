/**
 * Lightweight inertial scrolling for mouse wheels (desktop only).
 * Wheel input sets a target; the page eases toward it each frame. Keyboard, scrollbar,
 * touch and inner scroll areas stay native. Same-page #anchor links glide too.
 * Skipped on Apple platforms, whose native scrolling is already inertial.
 */
export function initSmoothScroll(): () => void {
  const mq = (q: string) => typeof window !== 'undefined' && !!window.matchMedia?.(q).matches
  const apple =
    typeof navigator !== 'undefined' &&
    (/Mac|iPhone|iPad|iPod/.test(navigator.platform || '') || /Mac OS X/.test(navigator.userAgent))
  if (apple || mq('(prefers-reduced-motion: reduce)') || !mq('(pointer: fine)')) return () => {}

  const root = document.documentElement
  let target = window.scrollY
  let current = window.scrollY
  let raf = 0
  let running = false
  const max = () => root.scrollHeight - window.innerHeight
  const clamp = (v: number) => Math.min(max(), Math.max(0, v))

  const innerCanScroll = (start: EventTarget | null, dy: number) => {
    let el = start instanceof Element ? start : null
    while (el && el !== document.body && el !== root) {
      const oy = getComputedStyle(el).overflowY
      if ((oy === 'auto' || oy === 'scroll') && el.scrollHeight > el.clientHeight + 1) {
        if (dy > 0 ? el.scrollTop + el.clientHeight < el.scrollHeight - 1 : el.scrollTop > 0) return true
      }
      el = el.parentElement
    }
    return false
  }

  let last = 0
  const step = (now: number) => {
    // frame-rate independent easing: ~0.12 of the remaining distance per 60fps frame
    const dt = last ? Math.min(64, now - last) : 16.7
    last = now
    current += (target - current) * (1 - Math.pow(1 - 0.12, dt / 16.7))
    if (Math.abs(target - current) < 0.4) {
      current = target
      running = false
      last = 0
    }
    window.scrollTo({ top: current, behavior: 'instant' as ScrollBehavior })
    if (running) raf = requestAnimationFrame(step)
  }

  const glideTo = (y: number) => {
    if (!running) current = window.scrollY
    target = clamp(y)
    if (!running) {
      running = true
      raf = requestAnimationFrame(step)
    }
  }

  const onWheel = (e: WheelEvent) => {
    if (e.ctrlKey || e.defaultPrevented) return
    if (Math.abs(e.deltaX) > Math.abs(e.deltaY)) return
    if (innerCanScroll(e.target, e.deltaY)) return
    e.preventDefault()
    let d = e.deltaY
    if (e.deltaMode === 1) d *= 16
    else if (e.deltaMode === 2) d *= window.innerHeight
    if (!running) target = window.scrollY
    glideTo(target + d)
  }

  const onScroll = () => {
    if (!running) current = target = window.scrollY
  }

  const onClick = (e: MouseEvent) => {
    if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey) return
    const a = e.target instanceof Element ? e.target.closest('a[href^="#"]') : null
    const id = a?.getAttribute('href')?.slice(1)
    if (!id) return
    const el = document.getElementById(id)
    if (!el) return // a route such as #app / #login: let the router handle it
    e.preventDefault()
    glideTo(id === 'hero' ? 0 : el.getBoundingClientRect().top + window.scrollY - 80)
  }

  const stopOnKeys = () => {
    if (running) {
      running = false
      last = 0
      cancelAnimationFrame(raf)
    }
  }

  window.addEventListener('wheel', onWheel, { passive: false })
  window.addEventListener('scroll', onScroll, { passive: true })
  document.addEventListener('click', onClick)
  window.addEventListener('keydown', stopOnKeys)
  window.addEventListener('hashchange', stopOnKeys)
  root.classList.add('has-smooth')
  return () => {
    window.removeEventListener('wheel', onWheel)
    window.removeEventListener('scroll', onScroll)
    document.removeEventListener('click', onClick)
    window.removeEventListener('keydown', stopOnKeys)
    window.removeEventListener('hashchange', stopOnKeys)
    root.classList.remove('has-smooth')
    cancelAnimationFrame(raf)
  }
}

/** Cursor-following soft light on any `.spot` element (sets --mx / --my). */
export function initSpotlight(): () => void {
  if (typeof window === 'undefined' || !window.matchMedia?.('(pointer: fine)').matches) return () => {}
  const onMove = (e: PointerEvent) => {
    const el = e.target instanceof Element ? (e.target.closest('.spot') as HTMLElement | null) : null
    if (!el) return
    const r = el.getBoundingClientRect()
    el.style.setProperty('--mx', `${e.clientX - r.left}px`)
    el.style.setProperty('--my', `${e.clientY - r.top}px`)
  }
  window.addEventListener('pointermove', onMove, { passive: true })
  return () => window.removeEventListener('pointermove', onMove)
}
