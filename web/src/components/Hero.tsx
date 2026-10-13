import { useState, type FormEvent } from 'react'
import { useLang } from '../i18n'
import { Icon, TitleLines, useScrollVar } from './ui'

import Mascot from './Mascot'

export default function Hero({ onAsk }: { onAsk: (q: string) => void }) {
  const { t } = useLang()
  const ref = useScrollVar<HTMLElement>('--hp', 'viewport')
  const [q, setQ] = useState('')

  const submit = (e: FormEvent) => {
    e.preventDefault()
    onAsk(q.trim() || t.examples[0])
  }

  return (
    <section id="hero" className="hero" ref={ref}>
      <div className="hero__text">
        <p className="eyebrow rise">{t.hero.eyebrow}</p>
        <h1 className="hero__title">
          <TitleLines title={{ pre: t.hero.h1a, accent: t.hero.h1accent, post: t.hero.h1b }} />
        </h1>
        <p className="hero__sub rise" style={{ animationDelay: '0.25s' }}>
          {t.hero.sub}
        </p>

        <form className="console__field ask rise" style={{ animationDelay: '0.4s' }} onSubmit={submit}>
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder={t.hero.placeholder} aria-label={t.studio.ask} />
          <button className="btn btn--red" type="submit">
            {t.hero.go} <Icon name="arrow" size={18} />
          </button>
        </form>
        <a href="#features" className="hero__how rise" style={{ animationDelay: '0.48s' }}>
          {t.hero.how}
        </a>

        <ul className="hero__stats">
          {t.hero.stats.map((s, i) => (
            <li key={s.label} className="glass stat-chip rise" style={{ animationDelay: `${0.55 + i * 0.1}s` }}>
              <strong>{s.value}</strong>
              <span>{s.label}</span>
            </li>
          ))}
        </ul>
      </div>

      <div className="hero__model">
        <div className="hero__halo" />
        <Mascot chips={t.hero.chips} />
      </div>

      <div className="hero__dim" aria-hidden />
      <div className="hero__scroll" aria-hidden>
        <span />
        scroll
      </div>
    </section>
  )
}
