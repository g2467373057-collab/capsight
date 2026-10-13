import { createContext, useContext, useEffect, useState, type ReactNode } from 'react'
import { COPY, type Copy } from './data/content'
import type { Lang } from './api/types'

interface LangCtx {
  lang: Lang
  setLang: (l: Lang) => void
  t: Copy
}

const LangContext = createContext<LangCtx>({ lang: 'zh', setLang: () => {}, t: COPY.zh })

const KEY = 'capsight-lang'

function initialLang(): Lang {
  try {
    const saved = localStorage.getItem(KEY)
    if (saved === 'zh' || saved === 'en') return saved
  } catch {
    /* storage unavailable */
  }
  if (typeof navigator !== 'undefined' && navigator.language && !navigator.language.toLowerCase().startsWith('zh')) {
    return 'en'
  }
  return 'zh'
}

export function LangProvider({ children }: { children: ReactNode }) {
  const [lang, setLangState] = useState<Lang>(initialLang)

  useEffect(() => {
    document.documentElement.lang = lang === 'zh' ? 'zh-CN' : 'en'
    document.title = COPY[lang].meta.title
  }, [lang])

  const setLang = (l: Lang) => {
    setLangState(l)
    try {
      localStorage.setItem(KEY, l)
    } catch {
      /* storage unavailable */
    }
  }

  return <LangContext.Provider value={{ lang, setLang, t: COPY[lang] }}>{children}</LangContext.Provider>
}

// eslint-disable-next-line react-refresh/only-export-components
export const useLang = () => useContext(LangContext)
