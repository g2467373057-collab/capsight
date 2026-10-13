import { useLang } from '../i18n'
import { OPERATOR, SOCIAL_LINKS } from '../data/site'
import { isDemo } from '../api/http'
import { Icon, Reveal, TitleLines } from './ui'

export function CtaBand({ onStart }: { onStart: () => void }) {
  const { t } = useLang()
  const c = t.ctaBand
  return (
    <section className="closing">
      <Reveal className="glass closing__card spot">
        <img src="/icon.png" alt="" width={64} height={64} className="closing__logo" />
        <p className="eyebrow">{c.eyebrow}</p>
        <h2>
          <TitleLines title={c.title} />
        </h2>
        <p className="closing__sub">{c.sub}</p>
        <div className="closing__actions">
          <button className="btn btn--red" onClick={onStart}>
            {c.button} <Icon name="arrow" size={18} />
          </button>
          <a href="#features" className="btn btn--glass">
            {c.secondary}
          </a>
        </div>
        <ul className="closing__points">
          {c.points.map((p) => (
            <li key={p}>
              <span className="ok">✓</span>
              {p}
            </li>
          ))}
        </ul>
      </Reveal>
    </section>
  )
}

export function Footer() {
  const { t } = useLang()
  const f = t.footer
  return (
    <footer className="site-footer">
      <div className="site-footer__top">
        <a href="#hero" className="site-footer__brand">
          <img src="/icon.png" alt="" width={32} height={32} />
          <span>
            <strong>
              {t.brand.name} <span className="site-footer__alt">{t.brand.alt}</span>
            </strong>
            <small>{f.tagline}</small>
          </span>
        </a>
        <a href={`mailto:${OPERATOR.email}`} className="site-footer__mail">
          <Icon name="mail" size={18} />
          <span>
            <small>{f.contact}</small>
            {OPERATOR.email}
          </span>
        </a>
        <div className="site-footer__social">
          {SOCIAL_LINKS.map((l) => (
            <a key={l.key} href={l.url} target="_blank" rel="noreferrer" aria-label={l.label} title={l.label}>
              <Icon name={l.key} size={18} />
            </a>
          ))}
        </div>
      </div>
      <div className="site-footer__bottom">
        <span>{f.rights}</span>
        <a href="#privacy">{f.privacy}</a>
        <a href="#terms">{f.terms}</a>
        <a href="#bot">{f.bot}</a>
        {isDemo && <span>{f.demo}</span>}
      </div>
    </footer>
  )
}
