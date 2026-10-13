import type { Config } from './config.ts'
import type { Db } from './db/db.ts'
import { createLlm, type Llm } from './llm/llm.ts'
import type { Providers } from './runs.ts'
import { Fetcher } from './sources/fetcher.ts'
import { createSearch, type SearchStack } from './sources/search.ts'
import { Social } from './sources/social.ts'
import type { Lang } from './types.ts'

/** Real providers chosen by config: per-language LLM and search, shared fetcher and social APIs. */
export function createProviders(cfg: Config, db: Db): Providers {
  const llms: Partial<Record<Lang, Llm>> = {}
  const searches: Partial<Record<Lang, SearchStack>> = {}
  return {
    llm: (lang) => (llms[lang] ??= createLlm(cfg.llm[lang])),
    search: (lang) => (searches[lang] ??= createSearch(cfg, db, lang)),
    fetcher: new Fetcher(cfg, db),
    social: new Social(cfg, db),
  }
}
