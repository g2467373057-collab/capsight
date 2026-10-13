import { useEffect, useState } from 'react'
import { loadHistory, resendVerification, saveHistory, type User } from '../api/auth'
import { fetchHistory, fetchQuota } from '../api/client'
import { isDemo } from '../api/http'
import { useLang } from '../i18n'
import Console from './Console'
import { Icon } from './ui'

/** The signed-in research studio: recent queries on the left, the six-step console on the right. */
export default function Workspace({
  user,
  incoming,
  onConsume,
}: {
  user: User
  incoming: { q: string; n: number } | null
  /** Tells the parent the hand-off question was taken, so it is not replayed on the next visit. */
  onConsume: () => void
}) {
  const { t, lang } = useLang()
  const w = t.workspace
  const [quota, setQuota] = useState<{ used: number; limit: number; unlimited?: boolean } | null>(null)
  const [resent, setResent] = useState(false)
  const unverified = !isDemo && user.emailVerified === false

  const refreshServer = () => {
    if (isDemo) return
    fetchHistory().then((h) => h.length && setHistory(h)).catch(() => {})
    fetchQuota().then(setQuota).catch(() => {})
  }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(refreshServer, [])
  const [history, setHistory] = useState<string[]>(() => loadHistory(user.email))
  const [pick, setPick] = useState<{ q: string; n: number } | null>(incoming)
  const [resetKey, setResetKey] = useState(0)

  useEffect(() => {
    if (incoming) onConsume()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const remember = (q: string) => {
    const next = [q, ...history.filter((h) => h !== q)].slice(0, 8)
    setHistory(next)
    saveHistory(user.email, next)
    refreshServer()
  }

  return (
    <main className="workspace">
      <aside className="glass workspace__side spot">
        <p className="mono-label">{w.hello(user.name)}</p>
        <h1>{w.title}</h1>
        <button
          className="btn btn--red btn--sm workspace__new"
          onClick={() => {
            setPick(null)
            setResetKey((k) => k + 1)
          }}
        >
          <Icon name="plus" size={16} /> {w.newRun}
        </button>
        <p className="workspace__h">{w.history}</p>
        {history.length ? (
          <ul className="workspace__history">
            {history.map((h) => (
              <li key={h}>
                <button onClick={() => setPick((p) => ({ q: h, n: (p?.n ?? 0) + 1 }))} title={h}>
                  <Icon name="clock" size={14} />
                  <span>{h}</span>
                </button>
              </li>
            ))}
          </ul>
        ) : (
          <p className="workspace__empty">{w.empty}</p>
        )}
        <p className="workspace__free">{quota ? (quota.unlimited ? w.unlimited : w.quota(Math.max(0, quota.limit - quota.used), quota.limit)) : w.free}</p>
      </aside>
      <section className="workspace__main">
        {unverified && (
          <div className="glass workspace__banner" role="status">
            <span>{w.unverified}</span>
            <button
              className="btn btn--glass btn--sm"
              disabled={resent}
              onClick={() => resendVerification(lang).then(() => setResent(true)).catch(() => {})}
            >
              {resent ? w.resent : w.resend}
            </button>
          </div>
        )}
        <Console key={resetKey} incoming={pick} onDone={remember} />
      </section>
    </main>
  )
}
