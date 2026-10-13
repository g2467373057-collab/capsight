import { useEffect, useState } from 'react'

/**
 * Hash routes: #app (workspace), #login, #verify-<token>, #reset-<token>, #privacy, #terms, #bot.
 * Any other hash is an anchor on the home page.
 */
export type Route = 'home' | 'app' | 'login' | 'verify' | 'reset' | 'privacy' | 'terms' | 'bot'

export interface Location {
  route: Route
  token?: string
}

const parse = (): Location => {
  const h = window.location.hash.replace(/^#\/?/, '')
  if (h === 'app' || h === 'login' || h === 'privacy' || h === 'terms' || h === 'bot') return { route: h }
  const m = /^(verify|reset)-([\w-]{20,})$/.exec(h)
  if (m) return { route: m[1] as Route, token: m[2] }
  return { route: 'home' }
}

export function useRoute(): Location {
  const [loc, setLoc] = useState<Location>(parse)
  useEffect(() => {
    const on = () => {
      const next = parse()
      setLoc((prev) => {
        if (prev.route !== next.route) window.scrollTo({ top: 0, behavior: 'instant' as ScrollBehavior })
        return next
      })
    }
    window.addEventListener('hashchange', on)
    return () => window.removeEventListener('hashchange', on)
  }, [])
  return loc
}

export function go(route: Route) {
  if (route === 'home') {
    if (window.location.hash) window.location.hash = 'hero'
  } else {
    window.location.hash = route
  }
}
