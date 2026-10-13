import { useEffect, useState } from 'react'
import BackgroundFX, { ForegroundFX } from './components/BackgroundFX'
import { initSmoothScroll, initSpotlight } from './smooth'
import Navbar from './components/Navbar'
import Hero from './components/Hero'
import Features from './components/Features'
import Login, { AuthLink } from './components/Login'
import Legal from './components/Legal'
import Workspace from './components/Workspace'
import { CtaBand, Footer } from './components/Sections'
import { LangProvider } from './i18n'
import { AuthProvider, useAuth } from './auth'
import { go, useRoute } from './router'

function Shell() {
  const { route, token } = useRoute()
  const { user, ready } = useAuth()
  // A question typed on the home page waits here until the workspace opens (after login if needed).
  const [pending, setPending] = useState<{ q: string; n: number } | null>(null)

  const start = () => go(user ? 'app' : 'login')
  const ask = (q: string) => {
    setPending((p) => ({ q, n: (p?.n ?? 0) + 1 }))
    start()
  }

  // The workspace needs an account: show login until signed in.
  const needLogin = route === 'app' && ready && !user
  useEffect(() => {
    if (route === 'login' && user) go('app')
  }, [route, user])

  useEffect(() => {
    const a = initSmoothScroll()
    const b = initSpotlight()
    return () => {
      a()
      b()
    }
  }, [])

  return (
    <>
      <BackgroundFX />
      <Navbar route={route === 'verify' || route === 'reset' ? 'login' : route} onStart={start} />
      {(route === 'privacy' || route === 'terms' || route === 'bot') && <Legal page={route} />}
      {route === 'home' && (
        <main className="curtain">
          <Hero onAsk={ask} />
          {/* The sheet slides up over the pinned hero. */}
          <div className="sheet">
            <Features />
            <CtaBand onStart={start} />
            <Footer />
          </div>
          <ForegroundFX />
        </main>
      )}
      {(route === 'login' || needLogin) && <Login onSuccess={() => go('app')} />}
      {(route === 'verify' || route === 'reset') && token && <AuthLink kind={route} token={token} onDone={() => go('app')} />}
      {route === 'app' && user && <Workspace user={user} incoming={pending} onConsume={() => setPending(null)} />}
    </>
  )
}

export default function App() {
  return (
    <LangProvider>
      <AuthProvider>
        <Shell />
      </AuthProvider>
    </LangProvider>
  )
}
