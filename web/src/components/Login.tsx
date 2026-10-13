import { useEffect, useRef, useState, type FormEvent } from 'react'
import { isEmail, MIN_PASSWORD, requestReset, resetPassword, verifyEmail } from '../api/auth'
import { isDemo } from '../api/http'
import { useAuth } from '../auth'
import { errorText } from '../data/content'
import { useLang } from '../i18n'

type Mode = 'login' | 'register' | 'forgot'

/** Login / sign-up / forgot-password card. On success the parent moves on to the workspace. */
export default function Login({ onSuccess }: { onSuccess: () => void }) {
  const { t, lang } = useLang()
  const a = t.auth
  const { login, register } = useAuth()
  const [mode, setMode] = useState<Mode>('login')
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [info, setInfo] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const switchTo = (m: Mode) => {
    setMode(m)
    setError(null)
    setInfo(null)
  }

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    if (mode === 'register' && !name.trim()) return setError(a.errName)
    if (!isEmail(email)) return setError(a.errEmail)
    if (mode !== 'forgot' && password.length < MIN_PASSWORD) return setError(a.errPw)
    setError(null)
    setBusy(true)
    try {
      if (mode === 'forgot') {
        await requestReset(email, lang)
        setInfo(a.resetSent)
      } else {
        if (mode === 'login') await login(email, password)
        else await register(name, email, password)
        onSuccess()
      }
    } catch (err) {
      setError(errorText(t, err))
    } finally {
      setBusy(false)
    }
  }

  const title = mode === 'register' ? a.register : mode === 'forgot' ? a.forgotTitle : a.login

  return (
    <main className="auth">
      <div className="glass auth__card rise spot">
        <img src="/icon.png" alt="" width={56} height={56} className="auth__logo" />
        <h1>{title}</h1>
        <p className="muted">{mode === 'forgot' ? a.forgotSub : a.sub}</p>

        <form className="auth__form" onSubmit={submit} noValidate>
          {mode === 'register' && (
            <label className="auth__field">
              <span>{a.name}</span>
              <input id="auth-name" value={name} onChange={(e) => setName(e.target.value)} autoComplete="nickname" maxLength={40} />
            </label>
          )}
          <label className="auth__field">
            <span>{a.email}</span>
            <input id="auth-email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" placeholder="you@company.com" />
          </label>
          {mode !== 'forgot' && (
            <label className="auth__field">
              <span className="auth__label-row">
                {a.password}
                {mode === 'login' && !isDemo && (
                  <button type="button" className="auth__forgot" onClick={() => switchTo('forgot')}>
                    {a.forgot}
                  </button>
                )}
              </span>
              <input
                id="auth-password"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoComplete={mode === 'register' ? 'new-password' : 'current-password'}
              />
            </label>
          )}
          {error && <p className="error">{error}</p>}
          {info && <p className="auth__info">{info}</p>}
          <button className="btn btn--red auth__submit" type="submit" disabled={busy}>
            {busy ? a.busy : mode === 'register' ? a.submitReg : mode === 'forgot' ? a.sendReset : a.submit}
          </button>
        </form>

        {mode === 'forgot' ? (
          <p className="auth__switch">
            <button type="button" onClick={() => switchTo('login')}>
              {a.backLogin}
            </button>
          </p>
        ) : (
          <p className="auth__switch">
            {mode === 'register' ? a.toLogin : a.toReg}{' '}
            <button type="button" onClick={() => switchTo(mode === 'register' ? 'login' : 'register')}>
              {mode === 'register' ? a.toLoginLink : a.toRegLink}
            </button>
          </p>
        )}
        <p className="auth__note">{isDemo ? a.note : a.noteServer}</p>
        {mode === 'register' && (
          <p className="auth__note">
            {a.agree[0]}
            <a href="#terms">{a.agree[1]}</a>
            {a.agree[2]}
            <a href="#privacy">{a.agree[3]}</a>
            {a.agree[4]}
          </p>
        )}
        <a href="#hero" className="auth__back">
          {a.back}
        </a>
      </div>
    </main>
  )
}

/** Landing page for the links in verification and password-reset e-mails. */
export function AuthLink({ kind, token, onDone }: { kind: 'verify' | 'reset'; token: string; onDone: () => void }) {
  const { t } = useLang()
  const a = t.auth
  const { setUser } = useAuth()
  const [state, setState] = useState<'idle' | 'busy' | 'ok' | 'bad'>(kind === 'verify' ? 'busy' : 'idle')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const started = useRef(false)

  useEffect(() => {
    if (kind !== 'verify' || started.current) return
    started.current = true
    verifyEmail(token)
      .then((u) => {
        setUser(u)
        setState('ok')
        setTimeout(onDone, 1200)
      })
      .catch(() => setState('bad'))
  }, [kind, token, onDone, setUser])

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    if (password.length < MIN_PASSWORD) return setError(a.errPw)
    setError(null)
    setState('busy')
    try {
      setUser(await resetPassword(token, password))
      setState('ok')
      onDone()
    } catch (err) {
      setError(errorText(t, err))
      setState('idle')
    }
  }

  return (
    <main className="auth">
      <div className="glass auth__card rise spot">
        <img src="/icon.png" alt="" width={56} height={56} className="auth__logo" />
        {kind === 'verify' ? (
          <>
            <h1>{state === 'bad' ? a.linkInvalid : state === 'ok' ? a.verified : a.verifying}</h1>
            {state === 'bad' && (
              <a href="#login" className="btn btn--red auth__submit">
                {a.backLogin}
              </a>
            )}
          </>
        ) : (
          <>
            <h1>{a.resetTitle}</h1>
            <form className="auth__form" onSubmit={submit} noValidate>
              <label className="auth__field">
                <span>{a.newPassword}</span>
                <input id="auth-new-password" type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="new-password" />
              </label>
              {error && <p className="error">{error}</p>}
              <button className="btn btn--red auth__submit" type="submit" disabled={state === 'busy'}>
                {state === 'busy' ? a.busy : a.saveReset}
              </button>
            </form>
          </>
        )}
        <a href="#hero" className="auth__back">
          {a.back}
        </a>
      </div>
    </main>
  )
}
