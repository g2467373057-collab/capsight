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
    if (r.task === 'site') return { domains: ['127.0.0.1'], aliases: [] }
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
    if (q.startsWith('Acme pricing')) return [{ title: 'Acme pricing', url: 'https://reviews.example/acme', snippet: 'Acme pricing: Pro from $8 per user', position: 1 }]
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
  assert.equal(res.rows[0].cells.region?.value, '暂无公开信息')
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
      if (r.task === 'site') return { domains: ['127.0.0.1'], aliases: [] }
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

/* ---------- v2: the SaaS pricing template (design of 19 Oct 2026) ---------- */

test('v2 pricing template: each slot is quoted and checked on its own; unsupported slots show as "no public information"', async () => {
  const site = await fakeSite({
    '/': { body: html('Beta Boards', '<p>Beta Boards is a work management platform for teams.</p><a href="/pricing">Pricing</a>') },
    '/pricing': {
      body: html(
        'Beta pricing',
        '<p>Free $0 forever, up to 2 seats. Basic $9 per seat per month. Standard $12 per seat per month. Enterprise: contact sales.</p><p>Prices shown are billed annually. Monthly billing costs 18% more.</p><p>Minimum 3 seats on paid plans.</p>',
      ),
    },
    '/robots.txt': { body: 'User-agent: *\nAllow: /', type: 'text/plain' },
  })
  try {
    const cfg = testConfig()
    const db = freshDb()
    const search = mockSearch((q) => (q.includes('官网') ? [{ title: 'Beta Boards', url: `${site.origin}/`, snippet: '', position: 1 }] : []))
    let extracts = 0
    const p = testProviders(
      cfg,
      db,
      (r) => {
        if (r.task === 'site') return { domains: ['127.0.0.1'], aliases: [] }
        if (r.task === 'extract') {
          extracts++
          const d = docsIn(r.user).find((x) => x.url.endsWith('/pricing'))
          if (!d) return { facts: { pricing: null } }
          const q = (value: string, quote: string) => ({ value, evidence: [{ doc: d.id, quote }] })
          return {
            facts: {
              pricing: {
                plans: q('Free $0 / Basic $9 / Standard $12 / Enterprise contact sales', 'Basic $9 per seat per month. Standard $12 per seat per month.'),
                unit: q('Per seat per month, minimum 3 seats', 'Minimum 3 seats on paid plans.'),
                billing: q('Billed annually; monthly costs 18% more', 'Prices shown are billed annually. Monthly billing costs 18% more.'),
                free: q('Free forever, up to 2 seats', 'Free $0 forever, up to 2 seats.'),
                addons: q('AI credits $5 per month', 'AI credits cost $5 per month'), // not on the page → must not pass
                promo: null,
              },
            },
          }
        }
        if (r.task === 'judge') return { checks: {} }
        return {}
      },
      search,
    )
    const intent: Intent = { type: 'named', query: 'Beta pricing', competitors: ['Beta'], timeRange: 'all', dimensions: ['name', 'pricing'] }
    const res = await runResearch('run_pricing', intent, { llm: p.llm('zh'), search: p.search('zh'), fetcher: p.fetcher, social: p.social, lang: 'zh', maxRequery: 2, emit: () => {} })
    const cell = res.rows[0].cells.pricing!
    assert.equal(cell.status, 'verified')
    assert.equal(cell.value, 'Free $0 / Basic $9 / Standard $12 / Enterprise contact sales')
    assert.deepEqual(cell.items?.map((i) => i.label), ['计价单位', '计费方式', '免费策略'])
    assert.ok(cell.items?.every((i) => i.url.endsWith('/pricing')))
    // the made-up add-on cost is not on the page, so it is not shown; promo was not stated
    assert.deepEqual(cell.gaps, ['附加成本', '当前优惠'])
    assert.deepEqual(res.stats.pricingSlots, { filled: 4, total: 6 })
    // optional slots are never re-queried on their own: one extraction only
    assert.equal(extracts, 1)
  } finally {
    site.server.close()
  }
})

test('v2 official site that refuses the crawler: the domain is kept and its pricing is read from the search index', async () => {
  const site = await fakeSite({
    '/': { status: 403, body: 'Forbidden' },
    '/pricing': { status: 403, body: 'Forbidden' },
    '/robots.txt': { body: 'User-agent: *\nAllow: /', type: 'text/plain' },
  })
  try {
    const cfg = testConfig()
    const db = freshDb()
    const host = new URL(site.origin).host
    const search = mockSearch((q) => {
      if (q.includes('official website')) return [{ title: 'Gamma – project tool', url: `${site.origin}/`, snippet: '', position: 1 }]
      if (q.includes('pricing plans site:'))
        return [
          { title: 'Gamma Pricing | Plans', url: `http://${host}/pricing`, snippet: 'Starter $10 per user per month, Business $24 per user per month.', position: 1 },
          { title: 'Someone else', url: 'https://reviews.example/gamma', snippet: 'Gamma costs $5', position: 2 },
        ]
      return []
    })
    const p = testProviders(
      cfg,
      db,
      (r) => {
        if (r.task === 'site') return { domains: ['127.0.0.1'], aliases: [] }
        if (r.task === 'extract') {
          const d = docsIn(r.user).find((x) => x.kind === 'site' && x.url.endsWith('/pricing'))
          return { facts: { pricing: d ? { plans: { value: 'Starter $10 / Business $24 per user per month', evidence: [{ doc: d.id, quote: 'Starter $10 per user per month, Business $24 per user per month.' }] } } : null } }
        }
        if (r.task === 'judge') return { checks: {} }
        return {}
      },
      search,
    )
    const events: RunEvent[] = []
    const res = await runResearch('run_blocked', { type: 'named', query: 'q', competitors: ['Gamma'], timeRange: 'all', dimensions: ['name', 'pricing'] }, {
      llm: p.llm('en'),
      search: p.search('en'),
      fetcher: p.fetcher,
      social: p.social,
      lang: 'en',
      maxRequery: 2,
      emit: (e) => events.push(e),
    })
    assert.equal(res.rows[0].domain, '127.0.0.1')
    assert.ok(events.some((e) => /refused direct reading/.test(e.text)))
    const cell = res.rows[0].cells.pricing!
    assert.equal(cell.status, 'verified')
    assert.match(cell.sources[0].title, /via search index/)
    // only the official domain's own result is used, never the review site
    assert.ok(cell.sources.every((s) => s.url.includes(host)))
  } finally {
    site.server.close()
  }
})

/* ---------- v2.1: layered official-site sources, method recorded per company ---------- */

test('v2.1 official site: Chinese search shows only look-alikes, so Wikidata (cross-checked) decides, and the method is recorded', async () => {
  const site = await fakeSite({
    '/': { body: html('飞书', '<p>飞书，先进团队先用飞书。</p>') },
    '/robots.txt': { body: 'User-agent: *\nAllow: /', type: 'text/plain' },
  })
  try {
    const cfg = testConfig()
    const db = freshDb()
    const search = mockSearch((q) => (q.includes('官网') ? [{ title: '飞书官网下载', url: 'https://m.xitongzhijia.net/soft/1.html', snippet: '', position: 1 }] : []))
    const p = testProviders(
      cfg,
      db,
      (r) => (r.task === 'site' ? { domains: ['127.0.0.1'], aliases: ['Feishu'] } : r.task === 'judge' ? { checks: {} } : {}),
      search,
      { google: async () => ({ hits: [] }), wikidata: async () => [{ id: 'Q1', label: '飞书', website: `${site.origin}/` }] },
    )
    const events: RunEvent[] = []
    const res = await runResearch('run_wd', { type: 'named', query: 'q', competitors: ['飞书'], timeRange: 'all', dimensions: ['name'] }, {
      llm: p.llm('zh'), search: p.search('zh'), fetcher: p.fetcher, social: p.social, lang: 'zh', maxRequery: 2, emit: (e) => events.push(e),
    })
    assert.equal(res.rows[0].domain, '127.0.0.1')
    assert.equal(res.rows[0].siteMethod, 'wikidata')
    assert.ok(events.some((e) => /xitongzhijia.*不是官网/.test(e.text)))
    assert.ok(events.some((e) => /找到官网 127\.0\.0\.1（Wikidata）/.test(e.text)))
  } finally {
    site.server.close()
  }
})

test('v2.1 official site: an English brand in a Chinese run is found through Google\'s knowledge graph', async () => {
  const site = await fakeSite({
    '/': { body: html('Notion', '<p>Notion is the connected workspace.</p>') },
    '/robots.txt': { body: 'User-agent: *\nAllow: /', type: 'text/plain' },
  })
  try {
    const cfg = testConfig()
    const db = freshDb()
    const googled: string[] = []
    const search = mockSearch((q) => (q.includes('官网') ? [{ title: 'Notion官网 - 导航', url: 'https://hao.itotii.com/notion', snippet: '', position: 1 }] : []))
    const p = testProviders(cfg, db, (r) => (r.task === 'site' ? { domains: [], aliases: [] } : r.task === 'judge' ? { checks: {} } : {}), search, {
      google: async (q) => {
        googled.push(q)
        return { hits: [], website: `${site.origin}/`, title: 'Notion' }
      },
      wikidata: async () => {
        throw new Error('must not be needed')
      },
    })
    const res = await runResearch('run_kg', { type: 'named', query: 'q', competitors: ['Notion'], timeRange: 'all', dimensions: ['name'] }, {
      llm: p.llm('zh'), search: p.search('zh'), fetcher: p.fetcher, social: p.social, lang: 'zh', maxRequery: 2, emit: () => {},
    })
    assert.deepEqual(googled, ['Notion official website'])
    assert.equal(res.rows[0].siteMethod, 'google_kg')
    assert.equal(res.rows[0].domain, '127.0.0.1')
  } finally {
    site.server.close()
  }
})

/* ---------- v2.2: dated third-party pricing when the official site shows none ---------- */

test('v2.2 no readable official price: a dated third-party pricing page is used and labelled; download sites and undated pages are not', async () => {
  const recent = new Date(Date.now() - 20 * 86400000).toISOString()
  const official = await fakeSite({
    '/': { body: html('Delta', '<p>Delta helps teams plan work. Talk to sales for a quote.</p>') },
    '/robots.txt': { body: 'User-agent: *\nAllow: /', type: 'text/plain' },
  })
  const review = await fakeSite({
    '/delta-pricing': { body: `<html><head><title>Delta pricing 2026</title><meta property="article:modified_time" content="${recent}"></head><body><p>Delta Team costs $15 per user per month, billed annually. Delta Free supports up to 3 users.</p></body></html>` },
    '/undated': { body: html('Delta price list', '<p>Delta Team costs $11 per user per month.</p>') },
    '/robots.txt': { body: 'User-agent: *\nAllow: /', type: 'text/plain' },
  })
  try {
    const cfg = testConfig()
    const db = freshDb()
    const reviewOrigin = review.origin.replace('127.0.0.1', 'localhost')
    const searched: string[] = []
    const search = mockSearch((q) => {
      searched.push(q)
      if (q.includes('official website')) return [{ title: 'Delta', url: `${official.origin}/`, snippet: '', position: 1 }]
      if (q.startsWith('Delta pricing plans per user'))
        return [
          { title: 'Delta 下载', url: 'https://www.onlinedown.net/delta', snippet: 'Delta $1', position: 1 },
          { title: 'Delta price list', url: `${reviewOrigin}/undated`, snippet: '', position: 2 },
          { title: 'Delta pricing 2026', url: `${reviewOrigin}/delta-pricing`, snippet: '', position: 3 },
        ]
      return []
    })
    const p = testProviders(
      cfg,
      db,
      (r) => {
        if (r.task === 'site') return { domains: ['127.0.0.1'], aliases: [] }
        if (r.task === 'extract') {
          const docs = docsIn(r.user)
          const dated = docs.find((d) => d.kind === 'web' && d.url.endsWith('/delta-pricing'))
          const undated = docs.find((d) => d.kind === 'web' && d.url.endsWith('/undated'))
          return {
            facts: {
              pricing: {
                plans: dated ? { value: 'Free (3 users) / Team $15 per user per month', evidence: [{ doc: dated.id, quote: 'Delta Team costs $15 per user per month, billed annually.' }] } : null,
                billing: undated ? { value: 'Team $11', evidence: [{ doc: undated.id, quote: 'Delta Team costs $11 per user per month.' }] } : null,
              },
            },
          }
        }
        if (r.task === 'judge') return { checks: {} }
        return {}
      },
      search,
    )
    const events: RunEvent[] = []
    const res = await runResearch('run_third', { type: 'named', query: 'q', competitors: ['Delta'], timeRange: 'all', dimensions: ['name', 'pricing'] }, {
      llm: p.llm('en'), search: p.search('en'), fetcher: p.fetcher, social: p.social, lang: 'en', maxRequery: 1, emit: (e) => events.push(e),
    })
    const cell = res.rows[0].cells.pricing!
    assert.equal(cell.status, 'verified')
    assert.equal(cell.thirdParty, true)
    assert.equal(cell.value, 'Free (3 users) / Team $15 per user per month')
    assert.match(cell.sources[0].title, /^Third party · \d{4}-\d\d-\d\d · Delta pricing 2026/)
    // the undated page's $11 never reaches the table; the download site is never read
    assert.ok(!cell.items?.some((i) => i.text.includes('$11')))
    assert.ok(cell.gaps?.includes('Billing'))
    assert.equal(res.stats.pricingThirdParty, 1)
    assert.ok(events.some((e) => /dated third-party pricing pages/.test(e.text)))
    assert.ok(searched.some((q) => q.startsWith('Delta pricing plans per user per month billed annually free plan')))
  } finally {
    official.server.close()
    review.server.close()
  }
})

/* ---------- v2.3: company information in branch A, and the details follow-up ---------- */

test('v2.3 branch A: country, size and funding come from the about page, web pages and news, each quoted', async () => {
  const site = await fakeSite({
    '/': { body: html('Echo', '<p>Echo is a meeting notes tool.</p><a href="/about">About</a>') },
    '/about': { body: html('About Echo', '<p>Echo is headquartered in Singapore. We are a team of about 120 people (2026).</p>') },
    '/robots.txt': { body: 'User-agent: *\nAllow: /', type: 'text/plain' },
  })
  const press = await fakeSite({
    '/echo-series-b': { body: html('Echo raises Series B', '<p>Echo raised a 30 million dollar Series B in March 2026, led by Example Ventures.</p>') },
    '/robots.txt': { body: 'User-agent: *\nAllow: /', type: 'text/plain' },
  })
  try {
    const cfg = testConfig()
    const db = freshDb()
    const pressUrl = `${press.origin.replace('127.0.0.1', 'localhost')}/echo-series-b`
    const search = mockSearch((q) => {
      if (q.includes('official website')) return [{ title: 'Echo', url: `${site.origin}/`, snippet: '', position: 1 }]
      if (q.startsWith('Echo funding round')) return [{ title: 'Echo raises Series B', url: pressUrl, snippet: 'Echo raised a 30 million dollar Series B', position: 1 }]
      return []
    })
    const p = testProviders(
      cfg,
      db,
      (r) => {
        if (r.task === 'site') return { domains: ['127.0.0.1'], aliases: [] }
        if (r.task === 'extract') {
          const docs = docsIn(r.user)
          const about = docs.find((d) => d.kind === 'site' && d.url.endsWith('/about'))
          const news = docs.find((d) => d.kind === 'web' && d.url.endsWith('/echo-series-b'))
          return {
            facts: {
              overview: about ? { value: 'Meeting notes tool', evidence: [{ doc: about.id, quote: 'Echo is headquartered in Singapore.' }] } : null,
              region: about ? { value: 'Singapore', evidence: [{ doc: about.id, quote: 'Echo is headquartered in Singapore.' }] } : null,
              size: about ? { value: 'About 120 people (2026)', evidence: [{ doc: about.id, quote: 'We are a team of about 120 people (2026).' }] } : null,
              funding: news ? { value: 'Series B, $30M, March 2026, led by Example Ventures', evidence: [{ doc: news.id, quote: 'Echo raised a 30 million dollar Series B in March 2026, led by Example Ventures.' }] } : null,
            },
          }
        }
        if (r.task === 'judge') return { checks: {} }
        return {}
      },
      search,
    )
    const intent = (await import('../src/pipeline/intent.ts')).normaliseIntent({ type: 'own', competitors: ['Echo'], timeRange: 'all', dimensions: ['name'] }, 'q', 5)
    assert.deepEqual(intent.dimensions, ['name', 'overview', 'region', 'size', 'funding'])
    const res = await runResearch('run_info', intent, { llm: p.llm('en'), search: p.search('en'), fetcher: p.fetcher, social: p.social, lang: 'en', maxRequery: 1, emit: () => {} })
    const c = res.rows[0].cells
    assert.equal(c.region?.value, 'Singapore')
    assert.equal(c.size?.value, 'About 120 people (2026)')
    assert.equal(c.funding?.status, 'verified')
    assert.equal(c.funding?.sources[0].url, pressUrl)
    assert.equal(c.pricing, undefined) // branch A: no pricing unless asked
  } finally {
    site.server.close()
    press.server.close()
  }
})

test('v2.3 details follow-up: an official site carried over from the "find competitors" run is used as is, with no new search for it', async () => {
  const site = await fakeSite({
    '/': { body: html('Foxtrot', '<p>Foxtrot builds forms.</p>') },
    '/robots.txt': { body: 'User-agent: *\nAllow: /', type: 'text/plain' },
  })
  try {
    const cfg = testConfig()
    const db = freshDb()
    const searched: string[] = []
    const tasks: string[] = []
    const search = mockSearch((q) => {
      searched.push(q)
      return []
    })
    const p = testProviders(cfg, db, (r) => {
      tasks.push(r.task)
      return r.task === 'judge' ? { checks: {} } : {}
    }, search)
    const host = new URL(site.origin).host
    const intent = (await import('../src/pipeline/intent.ts')).validateIntent({ type: 'named', query: 'q', competitors: ['Foxtrot'], timeRange: 'all', dimensions: ['name'], sites: { Foxtrot: host } }, 5)!
    const res = await runResearch('run_given', intent, { llm: p.llm('en'), search: p.search('en'), fetcher: p.fetcher, social: p.social, lang: 'en', maxRequery: 1, emit: () => {} })
    assert.equal(res.rows[0].siteMethod, 'given')
    assert.equal(res.rows[0].domain, '127.0.0.1')
    assert.ok(!tasks.includes('site'))
    assert.ok(!searched.some((q) => q.includes('official website')))
  } finally {
    site.server.close()
  }
})
