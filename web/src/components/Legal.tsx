import { LEGAL, type LegalPage } from '../data/legal'
import { isLegalDraft } from '../data/site'
import { useLang } from '../i18n'

/** Privacy policy, terms of service and crawler information. */
export default function Legal({ page }: { page: LegalPage }) {
  const { lang } = useLang()
  const doc = LEGAL[lang][page]
  return (
    <main className="legal">
      <article className="glass legal__card">
        {isLegalDraft && (
          <p className="legal__draft">
            {lang === 'zh' ? '草案：上线前请在 src/data/site.ts 填写运营者信息，并请法律顾问审阅。' : 'Draft: fill in the operator details in src/data/site.ts and have this reviewed before launch.'}
          </p>
        )}
        <h1>{doc.title}</h1>
        <p className="legal__intro">{doc.intro}</p>
        {doc.sections.map((s) => (
          <section key={s.h}>
            <h2>{s.h}</h2>
            {s.p.map((p) => (
              <p key={p}>{p}</p>
            ))}
            {s.code && <pre>{s.code}</pre>}
          </section>
        ))}
        <a href="#hero" className="auth__back">
          {lang === 'zh' ? '← 返回首页' : '← Back to home'}
        </a>
      </article>
    </main>
  )
}
