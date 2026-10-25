import assert from 'node:assert/strict'
import { after, before, test } from 'node:test'
import type { LlmRequest } from '../src/llm/llm.ts'
import { runResearch } from '../src/pipeline/run.ts'
import type { Intent, RunEvent } from '../src/types.ts'
import { docsIn, fakeSite, freshDb, html, mockSearch, testConfig, testProviders } from './helpers.ts'

let acme: Awaited<ReturnType<typeof fakeSite>>

before(async () => {
  const footer =
    '<a href="https://twitter.com/acmehq">X</a> <a href="https://www.linkedin.com/company/acme">LinkedIn</a> <a href="https://www.youtube.com/@acme">YouTube</a> <a href="mailto:sales@acme.test">Sales</a>'
  acme = await fakeSite({
    '/': { body: html('Acme Docs', '<h1>Acme Docs</h1><p>Docs, wikis and projects in one place. Real-time collaboration and an AI writing assistant.</p>', footer) },
    '/pricing': { body: html('Pricing', '<h2>Plans</h2><p>Free, Pro and Enterprise. Pro is billed per seat each month.</p>') },
    '/about': { body: html('About Acme', '<p>Acme was founded in 2019 and is headquartered in Berlin, Germany.</p>') },
    '/contact': { body: html('Contact', '<p>Talk to sales: sales@acme.test or use the contact form.</p>') },
    '/robots.txt': { body: 'User-agent: *\nDisallow: /internal', type: 'text/plain' },
  })
})
after(() => acme.server.close())

/** A scripted model: first answers are deliberately wrong for pricing and contact, so the pipeline must catch and fix them. */
function scriptedLlm() {
  const calls: string[] = []
  const fn = (r: LlmRequest) => {
    calls.push(r.task)
    const docs = docsIn(r.user)
    const find = (kind: string, pathEnd: string) => docs.find((d) => d.kind === kind && new URL(d.url).pathname === pathEnd)
    if (r.task === 'extract') {
      const fields = [...r.user.matchAll(/^- "?([\w:]+)"?: /gm)].map((m) => m[1])
      const facts: Record<string, unknown> = {}
      const hasSeo = docs.some((d) => d.kind === 'seo')
      for (const f of fields) {
        if (f === 'pricing') {
          const seo = docs.find((d) => d.kind === 'seo')
          const site = find('site', '/pricing')
          facts.pricing =
            hasSeo && seo
              ? { value: 'Pro from $8 per user', evidence: [{ doc: seo.id, quote: 'Acme pricing: Pro from $8 per user' }] }
              : site
                ? { value: 'Free / Pro / Enterprise, per seat', evidence: [{ doc: site.id, quote: 'Free, Pro and Enterprise. Pro is billed per seat each month.' }] }
                : null
        }
        if (f === 'region') {
          const d = find('site', '/about')
          facts.region = d ? { value: 'Germany · Berlin', evidence: [{ doc: d.id, quote: 'headquartered in Berlin, Germany' }] } : null
        }
        if (f === 'features') {
          const d = find('site', '/')
          facts.features = d ? { value: 'Docs, wikis, projects, AI assistant', evidence: [{ doc: d.id, quote: 'Docs, wikis and projects in one place.' }] } : null
        }
        if (f === 'contact') {
          const d = find('site', '/contact')
          facts.contact = d
            ? hasSeo
              ? { value: 'Phone +1 555 0100', evidence: [{ doc: d.id, quote: 'Call us at +1 555 0100' }] } // not on the page
              : { value: 'sales@acme.test or contact form', evidence: [{ doc: d.id, quote: 'Talk to sales: sales@acme.test or use the contact form.' }] }
            : null
        }
      }
      return { facts }
    }
    if (r.task === 'judge') return { checks: {} }
    if (r.task === 'news') {
      return { items: docs.filter((x) => x.kind === 'news').map((d) => ({ id: d.id, summary: 'Acme launches AI assistant' })).concat([{ id: 'D999', summary: 'made up' }]) }
    }
    if (r.task === 'social') return { keyPoint: 'product updates', items: docs.filter((x) => x.kind === 'social').map((d) => ({ id: d.id, summary: 'Acme shares a docs template' })) }
    return {}
  }
  return { fn, calls }
}

test('six-step pipeline: collects, verifies, catches bad facts, re-queries and organises', async () => {
  const cfg = testConfig()
  const db = freshDb()
  const recent = new Date(Date.now() - 3 * 86400000).toISOString()
  const search = mockSearch((q) => {
    if (q.includes('official website')) return [{ title: 'Acme Docs – official', url: `${acme.origin}/`, snippet: 'Acme Docs', position: 1 }]
    if (q === 'Acme pricing') return [{ title: 'Acme pricing', url: 'https://reviews.example/acme', snippet: 'Acme pricing: Pro from $8 per user', position: 1 }]
    if (q === 'site:linkedin.com/posts Acme')
      return [
        { title: 'Acme on LinkedIn: new template gallery', url: 'https://www.linkedin.com/posts/acme_templates-123', snippet: 'We just shipped…', position: 1, date: recent },
        { title: 'Unrelated', url: 'https://other.example/acme', snippet: '', position: 2 },
      ]
    if (q.startsWith('news:')) return [{ title: 'Acme launches AI assistant for docs', url: 'https://news.example/acme-ai', snippet: '', position: 1, date: recent }]
    return []
  })
  const llm = scriptedLlm()
  const p = testProviders(cfg, db, llm.fn, search)
  const events: RunEvent[] = []
  const intent: Intent = { type: 'named', query: 'Acme basic info', competitors: ['Acme'], timeRange: 'all', dimensions: ['name', 'region', 'features', 'pricing', 'contact', 'social', 'news'] }

  const res = await runResearch('run_test', intent, { llm: p.llm('en'), search: p.search('en'), fetcher: p.fetcher, social: p.social, lang: 'en', maxRequery: 2, emit: (e) => events.push(e) })

  const row = res.rows[0]
  assert.equal(row.domain, '127.0.0.1')
  assert.equal(row.cells.name?.status, 'verified')
  assert.equal(row.cells.region?.status, 'verified')
  assert.equal(row.cells.region?.value, 'Germany · Berlin')
  assert.equal(row.cells.features?.status, 'verified')
  // pricing came from a search snippet only → re-queried against the official pricing page
  assert.equal(row.cells.pricing?.status, 'requeried')
  assert.equal(row.cells.pricing?.value, 'Free / Pro / Enterprise, per seat')
  assert.equal(row.cells.pricing?.sources[0].url, `${acme.origin}/pricing`)
  // contact quoted text that is not on the page → re-queried
  assert.equal(row.cells.contact?.status, 'requeried')
  assert.match(row.cells.contact!.value, /sales@acme\.test/)
  // social: account links from the site footer plus a post found through search (off-host hits dropped)
  assert.equal(row.cells.social?.status, 'verified')
  assert.ok(row.cells.social!.sources.some((s) => s.url === 'https://x.com/acmehq'))
  assert.deepEqual(row.cells.social!.items?.map((i) => i.url), ['https://www.linkedin.com/posts/acme_templates-123'])
  assert.equal(row.cells.social!.items?.[0].label, 'LinkedIn')
  assert.match(row.cells.social!.value, /product updates/)
  // news: list items, each with its own link and date; made-up ids are ignored
  assert.equal(row.cells.news?.status, 'verified')
  assert.deepEqual(row.cells.news?.items?.map((i) => i.url), ['https://news.example/acme-ai'])
  assert.equal(row.cells.news?.date, recent.slice(0, 10))

  assert.equal(res.stats.requeried, 2)
  assert.equal(res.stats.checked, 7)
  assert.equal(res.stats.dropped, 0)
  assert.ok(events.some((e) => e.stage === 4 && e.kind === 'retry' && /search snippet only/.test(e.text)))
  assert.ok(events.some((e) => e.stage === 4 && e.kind === 'retry' && /quoted text not found/.test(e.text)))
  assert.ok(events.some((e) => e.stage === 5))
  assert.ok(!acme.hits.includes('/internal'))
  assert.ok(acme.hits.includes('/robots.txt'))
})

test('a fact that never verifies is dropped, not guessed', async () => {
  const cfg = testConfig()
  const db = freshDb()
  const search = mockSearch((q) => (q.includes('official website') ? [{ title: 'Acme', url: `${acme.origin}/`, snippet: '', position: 1 }] : []))
  const p = testProviders(
    cfg,
    db,
    (r) => (r.task === 'extract' ? { facts: { region: { value: 'Mars', evidence: [{ doc: 'D1', quote: 'headquartered on Mars' }] } } } : { checks: {} }),
    search,
  )
  const res = await runResearch('run_drop', { type: 'named', query: 'q', competitors: ['Acme'], timeRange: 'all', dimensions: ['name', 'region'] }, {
    llm: p.llm('en'),
    search: p.search('en'),
    fetcher: p.fetcher,
    social: p.social,
    lang: 'zh',
    maxRequery: 2,
    emit: () => {},
  })
  assert.equal(res.rows[0].cells.region?.status, 'missing')
  assert.equal(res.rows[0].cells.region?.value, '未找到可靠来源，已剔除')
  assert.equal(res.stats.dropped, 1)
})

test('judge can reject a verified fact, which then gets re-queried', async () => {
  const cfg = testConfig()
  const db = freshDb()
  const search = mockSearch((q) => (q.includes('official website') ? [{ title: 'Acme', url: `${acme.origin}/`, snippet: '', position: 1 }] : []))
  let judged = 0
  const p = testProviders(
    cfg,
    db,
    (r) => {
      if (r.task === 'extract') {
        const d = docsIn(r.user).find((x) => x.url.endsWith('/about'))
        return { facts: { region: d ? { value: 'Germany · Berlin', evidence: [{ doc: d.id, quote: 'headquartered in Berlin, Germany' }] } : null } }
      }
      if (r.task === 'judge') return judged++ === 0 ? { checks: { region: { ok: false, reason: 'conflict' } } } : { checks: { region: { ok: true } } }
      return {}
    },
    search,
  )
  const events: RunEvent[] = []
  const res = await runResearch('run_judge', { type: 'named', query: 'q', competitors: ['Acme'], timeRange: 'all', dimensions: ['name', 'region'] }, {
    llm: p.llm('en'),
    search: p.search('en'),
    fetcher: p.fetcher,
    social: p.social,
    lang: 'en',
    maxRequery: 2,
    emit: (e) => events.push(e),
  })
  assert.equal(res.rows[0].cells.region?.status, 'requeried')
  assert.ok(events.some((e) => /sources disagree/.test(e.text)))
})

test('custom fields: searched, read from third-party pages, verified and shown as their own columns', async () => {
  const wiki = await fakeSite({
    '/acme': { body: html('Acme - Wiki', '<p>Acme raised a 12 million euro Series A in 2022, led by Example Ventures.</p>') },
    '/robots.txt': { body: 'User-agent: *\nAllow: /', type: 'text/plain' },
  })
  try {
    const cfg = testConfig()
    const db = freshDb()
    const search = mockSearch((q) => {
      if (q.includes('official website')) return [{ title: 'Acme Docs', url: `${acme.origin}/`, snippet: 'Acme Docs', position: 1 }]
      // a different host from the official site (both fake servers listen on 127.0.0.1)
      if (q === 'Acme funding') return [{ title: 'Acme - Wiki', url: `${wiki.origin.replace('127.0.0.1', 'localhost')}/acme`, snippet: 'Acme raised…', position: 1 }]
      return []
    })
    const seen: string[] = []
    const p = testProviders(
      cfg,
      db,
      (r) => {
        if (r.task !== 'extract') return { checks: {} }
        seen.push(r.user)
        const d = docsIn(r.user).find((x) => x.kind === 'web')
        return { facts: { 'f:funding': d ? { value: 'Series A, €12M (2022)', evidence: [{ doc: d.id, quote: 'raised a 12 million euro Series A in 2022' }] } : null, 'f:mascot': null } }
      },
      search,
    )
    const intent: Intent = { type: 'named', query: 'Acme funding and mascot', competitors: ['Acme'], timeRange: 'all', dimensions: ['name'], fields: ['funding', 'mascot'] }
    const res = await runResearch('run_custom', intent, { llm: p.llm('en'), search: p.search('en'), fetcher: p.fetcher, social: p.social, lang: 'en', maxRequery: 1, emit: () => {} })
    const row = res.rows[0]
    assert.deepEqual(Object.keys(row.cells), ['name', 'f:funding', 'f:mascot'])
    assert.equal(row.cells['f:funding']?.status, 'verified')
    assert.equal(row.cells['f:funding']?.sources[0].kind, 'web')
    assert.equal(row.cells['f:mascot']?.status, 'missing')
    assert.equal(res.stats.checked, 3)
    assert.match(seen[0], /"f:funding": "funding"/)
  } finally {
    wiki.server.close()
  }
})
