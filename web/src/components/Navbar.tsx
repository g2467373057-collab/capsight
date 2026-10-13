import { useEffect, useRef, useState } from 'react'
import { useAuth } from '../auth'
import { SOCIAL_LINKS } from '../data/site'
import { useLang } from '../i18n'
import type { Route } from '../router'
import { Icon } from './ui'

export default function Navbar({ route, onStart }: { route: Route; onStart: () => void }) {
  const { t, lang, setLang } = useLang()
  const { user, logout } = useAuth()
  const [scrolled, setScrolled] = useState(false)
  const bar = useRef<HTMLSpanElement>(null)

  useEffect(() => {
    const onScroll = () => {
      setScrolled(window.scrollY > 40)
      const max = document.documentElement.scrollHeight - window.innerHeight
      if (bar.current) bar.current.style.transform = `scaleX(${max > 0 ? Math.min(1, window.scrollY / max) : 0})`
    }
    onScroll()
    window.addEventListener('scroll', onScroll, { passive: true })
    return () => window.removeEventListener('scroll', onScroll)
  }, [])

  return (
    <header className={`nav ${scrolled ? 'nav--scrolled' : ''}`}>
      <a href="#hero" className="nav__brand">
        <img src="/icon.png" alt="" width={30} height={30} />
        <span>
          {t.brand.name}
          <small className="nav__brand-alt">{t.brand.alt}</small>
        </span>
      </a>
      <span className="nav__progress" ref={bar} aria-hidden />

      <nav className="nav__social" aria-label="Social">
        {SOCIAL_LINKS.map((s) => (
          <a key={s.key} href={s.url} target="_blank" rel="noreferrer" aria-label={s.label} title={s.label}>
            <Icon name={s.key} size={18} />
          </a>
        ))}
      </nav>

      <div className="lang-toggle" role="group" aria-label="Language">
        <button className={lang === 'zh' ? 'is-on' : ''} onClick={() => setLang('zh')} aria-pressed={lang === 'zh'}>
          中
        </button>
        <button className={lang === 'en' ? 'is-on' : ''} onClick={() => setLang('en')} aria-pressed={lang === 'en'}>
          EN
        </button>
      </div>

      {user ? (
        <div className="nav__user">
          <span className="nav__avatar" title={user.email}>
            {user.name.slice(0, 1).toUpperCase()}
          </span>
          <button className="nav__link" onClick={logout}>
            {t.nav.logout}
          </button>
        </div>
      ) : (
        route !== 'login' && (
          <a href="#login" className="nav__link">
            {t.nav.login}
          </a>
        )
      )}

      {route === 'app' ? (
        <a href="#hero" className="btn btn--glass btn--sm nav__cta">
          {t.nav.home}
        </a>
      ) : (
        <button className="btn btn--red btn--sm nav__cta" onClick={onStart}>
          {t.nav.cta}
        </button>
      )}
    </header>
  )
}
