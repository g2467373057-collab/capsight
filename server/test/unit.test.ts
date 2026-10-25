import assert from 'node:assert/strict'
import { test } from 'node:test'
import { hashPassword, verifyPassword } from '../src/auth/crypto.ts'
import { parseJsonLoose } from '../src/llm/llm.ts'
import { toCsv } from '../src/pipeline/csv.ts'
import { pickOfficialSite } from '../src/pipeline/collect.ts'
import { quoteInText, verifyFact } from '../src/pipeline/facts.ts'
import { INTENT_EXAMPLES } from '../src/pipeline/intent-examples.ts'
import { normaliseIntent } from '../src/pipeline/intent.ts'
import { extractHtml } from '../src/sources/html.ts'
import { assertPublicUrl, baseDomain, isPrivateIp } from '../src/sources/net.ts'
import { isAllowed, parseRobots } from '../src/sources/robots.ts'
import { parseRss } from '../src/sources/search.ts'
import { detectAccounts } from '../src/sources/social.ts'

test('private IPs are recognised', () => {
  for (const ip of ['127.0.0.1', '10.1.2.3', '172.16.0.1', '192.168.1.1', '169.254.169.254', '100.64.0.1', '0.0.0.0', '::1', 'fd00::1', 'fe80::1', '::ffff:127.0.0.1'])
    assert.equal(isPrivateIp(ip), true, ip)
  for (const ip of ['8.8.8.8', '1.1.1.1', '172.32.0.1', '2606:4700::1111']) assert.equal(isPrivateIp(ip), false, ip)
})

test('SSRF guard rejects internal targets', async () => {
  await assert.rejects(assertPublicUrl('http://127.0.0.1/admin'), /private_host/)
  await assert.rejects(assertPublicUrl('http://localhost:80/'), /private_host/)
  await assert.rejects(assertPublicUrl('http://169.254.169.254/latest/meta-data'), /private_host/)
  await assert.rejects(assertPublicUrl('ftp://example.com/'), /bad_scheme/)
  await assert.rejects(assertPublicUrl('http://user:pw@example.com/'), /credentials_in_url/)
  await assert.rejects(assertPublicUrl('http://8.8.8.8:8080/'), /bad_port/)
})

test('base domain', () => {
  assert.equal(baseDomain('www.notion.com'), 'notion.com')
  assert.equal(baseDomain('app.example.co.uk'), 'example.co.uk')
  assert.equal(baseDomain('help.feishu.com.cn'), 'feishu.com.cn')
})

test('robots.txt rules', () => {
  const r = parseRobots('User-agent: *\nDisallow: /private\nAllow: /private/ok\nDisallow: /*.pdf$\n\nUser-agent: OtherBot\nDisallow: /', 'CapsightBot/1.0')
  assert.equal(isAllowed(r, '/pricing'), true)
  assert.equal(isAllowed(r, '/private/x'), false)
  assert.equal(isAllowed(r, '/private/ok'), true)
  assert.equal(isAllowed(r, '/a/b.pdf'), false)
  const own = parseRobots('User-agent: capsightbot\nDisallow: /\n\nUser-agent: *\nAllow: /', 'CapsightBot/1.0')
  assert.equal(isAllowed(own, '/'), false)
})

test('HTML extraction keeps text and links, drops scripts', () => {
  const ex = extractHtml(
    '<html lang="en"><head><title>Acme &amp; Co</title><meta name="description" content="Docs"></head><body><script>alert(1)</script><p>Pro &euro;10 per&nbsp;seat</p><a href="/pricing">Pricing</a><a href="mailto:sales@acme.io">Mail</a><a href="https://x.com/acme">X</a></body></html>',
    'https://acme.io/',
  )
  assert.equal(ex.title, 'Acme & Co')
  assert.equal(ex.description, 'Docs')
  assert.equal(ex.lang, 'en')
  assert.match(ex.text, /Pro €10 per seat/)
  assert.doesNotMatch(ex.text, /alert/)
  assert.deepEqual(ex.links.map((l) => l.url), ['https://acme.io/pricing', 'mailto:sales@acme.io', 'https://x.com/acme'])
})

test('quote matching: exact, whitespace/case, fuzzy, Chinese, and rejection', () => {
  const text = 'Plans: Free, Plus and Business.\nBusiness   includes SAML SSO — billed per member.'
  assert.equal(quoteInText('business includes saml sso', text), true)
  assert.equal(quoteInText('Business includes SAML SSO - billed per member', text), true)
  assert.equal(quoteInText('Plans: Free, Plus, and Business', text), true)
  assert.equal(quoteInText('Enterprise costs $99 per user', text), false)
  assert.equal(quoteInText('总部 位于 北京', '公司总部位于北京市海淀区'), true)
  assert.equal(quoteInText('总部位于上海', '公司总部位于北京市海淀区'), false)
})

test('verifyFact needs a reachable document that contains the quote, and official evidence for pricing', () => {
  const docs = [
    { id: 'D1', kind: 'site' as const, url: 'https://a.io/pricing', title: '', text: 'Pro plan $10 per seat', status: 200 },
    { id: 'D2', kind: 'seo' as const, url: 'https://g.co', title: '', text: 'A pricing from $8', status: 200 },
    { id: 'D3', kind: 'site' as const, url: 'https://a.io/x', title: '', text: '', status: 404 },
  ]
  assert.equal(verifyFact('pricing', { value: 'Pro $10/seat', evidence: [{ doc: 'D1', quote: 'Pro plan $10 per seat' }] }, docs).ok, true)
  assert.equal(verifyFact('pricing', { value: 'from $8', evidence: [{ doc: 'D2', quote: 'pricing from $8' }] }, docs).reason, 'seo_only')
  assert.equal(verifyFact('region', { value: 'x', evidence: [{ doc: 'D1', quote: 'made up words here' }] }, docs).reason, 'quote_not_found')
  assert.equal(verifyFact('region', { value: 'x', evidence: [{ doc: 'D3', quote: 'anything' }] }, docs).reason, 'unreachable')
  assert.equal(verifyFact('region', null, docs).reason, 'not_found')
})

test('official site picking skips directories and review sites', () => {
  const hits = [
    { title: 'Notion - Wikipedia', url: 'https://en.wikipedia.org/wiki/Notion', snippet: '', position: 1 },
    { title: 'Notion reviews', url: 'https://www.g2.com/products/notion', snippet: '', position: 2 },
    { title: 'Notion – The all-in-one workspace', url: 'https://www.notion.com/product', snippet: '', position: 3 },
  ]
  assert.equal(pickOfficialSite('Notion', hits), 'https://www.notion.com')
  assert.equal(pickOfficialSite('monday.com', []), 'https://monday.com')
  assert.equal(pickOfficialSite('Nothing', hits.slice(0, 2)), undefined)
})

test('social accounts are detected from footer links', () => {
  const acc = detectAccounts([
    { url: 'https://twitter.com/NotionHQ', text: '' },
    { url: 'https://x.com/intent/tweet?text=hi', text: '' },
    { url: 'https://www.linkedin.com/company/notionhq/', text: '' },
    { url: 'https://www.youtube.com/@Notion', text: '' },
    { url: 'https://www.reddit.com/r/Notion/', text: '' },
    { url: 'https://weibo.com/u/123456', text: '' },
  ])
  assert.deepEqual(
    acc.map((a) => `${a.platform}:${a.handle}`),
    ['x:NotionHQ', 'linkedin:notionhq', 'youtube:Notion', 'reddit:r/Notion', 'weibo:123456'],
  )
})

test('RSS parsing', () => {
  const items = parseRss(
    '<rss><channel><item><title><![CDATA[Acme raises &amp; grows]]></title><link>https://n.example/a</link><pubDate>Mon, 05 Oct 2026 10:00:00 GMT</pubDate><source url="x">Daily</source></item></channel></rss>',
  )
  assert.equal(items[0].title, 'Acme raises & grows')
  assert.equal(items[0].url, 'https://n.example/a')
  assert.equal(items[0].date, '2026-10-05T10:00:00.000Z')
  assert.equal(items[0].source, 'Daily')
})

test('loose JSON parsing', () => {
  assert.deepEqual(parseJsonLoose('```json\n{"a":1}\n```'), { a: 1 })
  assert.deepEqual(parseJsonLoose('Sure! {"a":{"b":"}"}} trailing'), { a: { b: '}' } })
  assert.throws(() => parseJsonLoose('no json'))
})

test('passwords hash and verify', async () => {
  const h = await hashPassword('correct horse battery')
  assert.match(h, /^scrypt\$/)
  assert.equal(await verifyPassword('correct horse battery', h), true)
  assert.equal(await verifyPassword('wrong', h), false)
})

test('intent normalisation clamps and fills', () => {
  const i = normaliseIntent({ type: 'named', competitors: ['A', 'A', 'B', 'C', 'D', 'E', 'F'], timeRange: '30d', dimensions: ['pricing', 'bogus'] }, 'q', 5)
  assert.equal(i.type, 'named') // a time range alone never turns "named" into "timeframe"
  assert.deepEqual(i.competitors, ['A', 'B', 'C', 'D', 'E'])
  assert.deepEqual(i.dimensions, ['name', 'pricing'])
})

test('intent rules: every worked example survives normalisation unchanged', () => {
  for (const e of INTENT_EXAMPLES) {
    const raw = { ...e, competitors: e.competitors ?? ['X', 'Y'] }
    const i = normaliseIntent(raw, e.query, 5)
    assert.equal(i.type, e.type, e.query)
    assert.equal(i.timeRange, e.timeRange, e.query)
    assert.deepEqual(i.dimensions, e.dimensions, e.query)
    assert.equal(i.company ?? null, e.company, e.query)
    assert.deepEqual(i.fields ?? [], e.fields ?? [], e.query)
  }
})

test('intent rules: edge cases', () => {
  // "timeframe" without a period falls back to a plain lookup
  assert.equal(normaliseIntent({ type: 'timeframe', competitors: ['A'], timeRange: 'all', dimensions: ['news'] }, 'q', 5).type, 'named')
  // a timeframe question with no fields named looks at news and social only
  assert.deepEqual(normaliseIntent({ type: 'timeframe', competitors: ['A'], timeRange: '7d', dimensions: [] }, 'q', 5).dimensions, ['name', 'social', 'news'])
  // a named lookup with no fields named gets everything
  assert.equal(normaliseIntent({ type: 'named', competitors: ['A'], timeRange: 'all' }, 'q', 5).dimensions.length, 7)
  // unknown type → named
  assert.equal(normaliseIntent({ type: 'weird', competitors: ['A'] }, 'q', 5).type, 'named')
})

test('CSV export neutralises spreadsheet formulas', () => {
  const csv = toCsv(
    {
      runId: 'r',
      finishedAt: '',
      stats: { sources: 0, checked: 0, requeried: 0, passed: 0, dropped: 0 },
      intent: { type: 'named', query: 'q', competitors: ['A'], timeRange: 'all', dimensions: ['name', 'pricing'] },
      rows: [{ competitor: 'A', domain: 'a.io', cells: { name: { value: '=HYPERLINK("x")', sources: [], status: 'verified' }, pricing: { value: 'Free, Pro', sources: [{ kind: 'site', url: 'https://a.io/p', title: '' }], status: 'requeried' } } }],
    },
    'en',
  )
  assert.ok(csv.startsWith('﻿Name,Name_source,Pricing,Pricing_source,check'))
  assert.match(csv, /"'=HYPERLINK\(""x""\)"/)
  assert.match(csv, /"Free, Pro",https:\/\/a\.io\/p,passed after re-query/)
})

test('CSV export writes list cells one item per line, with every item URL', () => {
  const csv = toCsv(
    {
      runId: 'r',
      finishedAt: '',
      stats: { sources: 0, checked: 0, requeried: 0, passed: 0, dropped: 0 },
      intent: { type: 'named', query: 'q', competitors: ['A'], timeRange: 'all', dimensions: ['news'] },
      rows: [
        {
          competitor: 'A',
          domain: 'a.io',
          cells: {
            news: {
              value: '2 recent updates',
              sources: [],
              status: 'verified',
              items: [
                { text: 'Launched v2', url: 'https://n.example/1', date: '2026-10-01', label: 'n.example' },
                { text: 'Raised a round', url: 'https://n.example/2', date: '2026-09-20' },
              ],
            },
          },
        },
      ],
    },
    'en',
  )
  assert.match(csv, /"2026-10-01 \[n\.example\] Launched v2\n2026-09-20 Raised a round",https:\/\/n\.example\/1 \| https:\/\/n\.example\/2/)
})

test('intent "own": competitors come from a search on what the product does, and must appear in the results', async () => {
  const { parseIntent } = await import('../src/pipeline/intent.ts')
  const searched: string[] = []
  const search = {
    web: async (q: string) => {
      searched.push(q)
      return q.includes('跨境电商 ERP')
        ? [{ title: '2026 跨境电商 ERP 对比：店小秘、马帮、积加', url: 'https://x.example/a', snippet: '店小秘和马帮都支持多平台订单管理', position: 1 }]
        : []
    },
  }
  const llm = {
    json: async (r: { task: string }) =>
      r.task === 'intent'
        ? { type: 'own', company: null, product: '跨境电商 ERP', competitors: ['<suggest up to 4>', 'Made Up Inc'], timeRange: 'all', dimensions: ['name', 'region', 'features', 'pricing', 'contact'] }
        : { competitors: ['店小秘', '马帮', '幻想公司'] },
  }
  const i = await parseIntent(llm as never, search as never, '我是一家做跨境电商 ERP 的公司，查竞品都有哪些，附带他们的基本信息', 'zh', 5)
  assert.equal(i.type, 'own')
  assert.deepEqual(i.dimensions, ['name', 'region', 'features', 'pricing', 'contact'])
  assert.ok(searched.some((q) => q.startsWith('跨境电商 ERP')), searched.join(' | '))
  assert.deepEqual(i.competitors, ['店小秘', '马帮']) // "幻想公司" is not in any result, so it is dropped
})

test('intent rules: custom fields', () => {
  // non-company subjects: only name + the asked fields; built-in synonyms are mapped back to dimensions
  const i = normaliseIntent({ type: 'named', competitors: ['NUS', 'NTU'], timeRange: 'all', dimensions: ['name'], fields: ['学费', '学制', '定价', '学费', ' '], topic: '大学' }, 'q', 5)
  assert.deepEqual(i.fields, ['学费', '学制'])
  assert.deepEqual(i.dimensions, ['name', 'pricing'])
  assert.equal(i.topic, '大学')
  // no fields and no dimensions → everything, as before
  assert.equal(normaliseIntent({ type: 'named', competitors: ['A'], fields: [] }, 'q', 5).dimensions.length, 7)
  // at most 6 custom fields
  assert.equal(normaliseIntent({ type: 'named', competitors: ['A'], fields: ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'] }, 'q', 5).fields?.length, 6)
})
