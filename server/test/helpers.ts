import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { loadConfig, type Config } from '../src/config.ts'
import { openDb, type Db } from '../src/db/db.ts'
import { MockLlm, type LlmRequest } from '../src/llm/llm.ts'
import type { Providers } from '../src/runs.ts'
import { Fetcher } from '../src/sources/fetcher.ts'
import { createSearch, type EntityResult, type SearchHit, type SearchProvider, type WikidataSite } from '../src/sources/search.ts'
import { Social } from '../src/sources/social.ts'

export function testConfig(over: Partial<Config> = {}): Config {
  process.env.NODE_ENV = 'test'
  const c = loadConfig()
  return {
    ...c,
    env: 'test',
    dbPath: ':memory:',
    staticDir: '',
    appUrl: 'http://app.test',
    allowedOrigins: ['http://app.test'],
    requireEmailVerification: false,
    cookie: { ...c.cookie, secure: false },
    fetch: { ...c.fetch, allowPrivate: true, timeoutMs: 3000, reader: 'none' },
    keys: {},
    ...over,
  }
}

/** A tiny fake company website. */
export async function fakeSite(pages: Record<string, { status?: number; body: string; type?: string }>): Promise<{ origin: string; server: Server; hits: string[] }> {
  const hits: string[] = []
  const server = createServer((req, res) => {
    const path = (req.url ?? '/').split('?')[0]
    hits.push(path)
    const p = pages[path]
    if (!p) {
      res.writeHead(404, { 'Content-Type': 'text/html' }).end('<h1>Not found</h1>')
      return
    }
    res.writeHead(p.status ?? 200, { 'Content-Type': p.type ?? 'text/html; charset=utf-8' }).end(p.body)
  })
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r))
  return { origin: `http://127.0.0.1:${(server.address() as AddressInfo).port}`, server, hits }
}

export const html = (title: string, body: string, footer = '') =>
  `<!doctype html><html lang="en"><head><title>${title}</title><meta name="description" content="${title} description"></head><body><nav><a href="/">Home</a> <a href="/pricing">Pricing</a> <a href="/about">About</a> <a href="/contact">Contact</a></nav><main>${body}</main><footer>${footer}</footer><script>var secret = "ignore me"</script></body></html>`

/** Parses the documents block the pipeline sends to the model. */
export function docsIn(prompt: string): { id: string; kind: string; url: string; text: string }[] {
  const out: { id: string; kind: string; url: string; text: string }[] = []
  for (const chunk of prompt.split('\n\n---\n\n')) {
    const m = /\[(D\d+)\] kind=(\w+) url=(\S+)[^\n]*\n([\s\S]*)/.exec(chunk)
    if (m) out.push({ id: m[1], kind: m[2], url: m[3], text: m[4] })
  }
  return out
}

export function mockSearch(table: (q: string) => SearchHit[]): SearchProvider {
  return { name: 'mock', web: async (q) => table(q), news: async (q) => table(`news:${q}`) }
}

export function testProviders(
  cfg: Config,
  db: Db,
  llmFn: (r: LlmRequest) => unknown,
  search: SearchProvider,
  lookups: { google?: (q: string) => Promise<EntityResult>; wikidata?: (names: string[]) => Promise<WikidataSite[]> } = {},
): Providers & { llmInstance: MockLlm } {
  const llmInstance = new MockLlm(llmFn)
  const stack = createSearch(cfg, db, 'en', { web: search, news: [search], ...lookups })
  return {
    llmInstance,
    llm: () => llmInstance,
    search: () => stack,
    fetcher: new Fetcher(cfg, db),
    social: new Social(cfg, db),
  }
}

export const freshDb = () => openDb(':memory:')
