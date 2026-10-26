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
import { DEFAULT_DIMS_NAMED } from '../src/types.ts'

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
  // branch B: a named lookup with no fields named gets the full module set (no contact unless asked)
  assert.deepEqual(normaliseIntent({ type: 'named', competitors: ['A'], timeRange: 'all' }, 'q', 5).dimensions, DEFAULT_DIMS_NAMED)
  // branch A: finding competitors gives a list with basic company information (introduction, country, size, funding)
  assert.deepEqual(normaliseIntent({ type: 'own', competitors: ['A'], timeRange: 'all', dimensions: ['name'] }, 'q', 5).dimensions, ['name', 'overview', 'region', 'size', 'funding'])
  // branch A keeps what the user explicitly asked for, on top of the basic information
  assert.deepEqual(normaliseIntent({ type: 'own', competitors: ['A'], timeRange: 'all', dimensions: ['name', 'pricing'] }, 'q', 5).dimensions, ['name', 'overview', 'region', 'size', 'funding', 'pricing'])
  // "公司规模" and "融资情况" written as fields are the built-in size and funding
  assert.deepEqual(normaliseIntent({ type: 'named', competitors: ['A'], dimensions: ['name'], fields: ['公司规模', '融资情况'] }, 'q', 5).dimensions, ['name', 'size', 'funding'])
  // "公司介绍" written as a field is the built-in overview
  assert.deepEqual(normaliseIntent({ type: 'named', competitors: ['A'], dimensions: ['name'], fields: ['公司介绍'] }, 'q', 5).dimensions, ['name', 'overview'])
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
  assert.deepEqual(i.dimensions, ['name', 'overview', 'region', 'size', 'funding', 'features', 'pricing', 'contact'])
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
  assert.deepEqual(normaliseIntent({ type: 'named', competitors: ['A'], fields: [] }, 'q', 5).dimensions, DEFAULT_DIMS_NAMED)
  // at most 6 custom fields
  assert.equal(normaliseIntent({ type: 'named', competitors: ['A'], fields: ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'] }, 'q', 5).fields?.length, 6)
})

/* ---------- v2: official-site detection, replayed on the real Batch A search results (19 Oct 2026) ---------- */
import { readFileSync } from 'node:fs'
import { hostMatches, scoreOfficial } from '../src/pipeline/collect.ts'

const BATCH_A_SEARCHES = JSON.parse(readFileSync(new URL('./fixtures-official-site.json', import.meta.url), 'utf8')) as Record<string, { title: string; url: string; snippet: string; position: number }[]>
/** What the model is expected to suggest as official domains (hints are checked, never trusted on their own). */
const HINTS: Record<string, { domains: string[]; aliases: string[]; official?: string }> = {
  石墨文档: { domains: ['shimo.im'], aliases: ['Shimo'], official: 'https://shimo.im' },
  腾讯文档: { domains: ['docs.qq.com'], aliases: ['Tencent Docs'] },
  金山文档: { domains: ['kdocs.cn'], aliases: ['KDocs', 'WPS'], official: 'https://www.kdocs.cn' },
  Coda: { domains: ['coda.io'], aliases: [] },
  Notion: { domains: ['notion.so', 'notion.com'], aliases: [] },
  ClickUp: { domains: ['clickup.com'], aliases: [] },
  'Monday.com': { domains: ['monday.com'], aliases: ['monday'], official: 'https://monday.com' },
  Asana: { domains: ['asana.com'], aliases: [] },
  Trello: { domains: ['trello.com'], aliases: [], official: 'https://trello.com' },
  Salesforce: { domains: ['salesforce.com'], aliases: [] },
  HubSpot: { domains: ['hubspot.com'], aliases: [], official: 'http://www.hubspot.com' },
  纷享销客: { domains: ['fxiaoke.com'], aliases: ['Fxiaoke', 'ShareCRM'], official: 'http://www.fxiaoke.com' },
  SavvyCal: { domains: ['savvycal.com'], aliases: [], official: 'https://savvycal.com' },
  'Cal.com': { domains: ['cal.com'], aliases: [], official: 'https://cal.com' },
  Doodle: { domains: ['doodle.com'], aliases: [], official: 'https://doodle.com' },
  'Acuity Scheduling': { domains: ['acuityscheduling.com'], aliases: ['Acuity'], official: 'https://acuityscheduling.com' },
  钉钉: { domains: ['dingtalk.com'], aliases: ['DingTalk'], official: 'https://dingtalk.com' },
  飞书: { domains: ['feishu.cn', 'larksuite.com'], aliases: ['Feishu', 'Lark'], official: 'https://www.feishu.cn' },
  企业微信: { domains: ['work.weixin.qq.com'], aliases: ['WeCom', 'WeChat Work'], official: 'https://work.weixin.qq.com' },
  'Microsoft Teams': { domains: ['microsoft.com/microsoft-teams'], aliases: ['Teams'], official: 'https://www.microsoft.com' },
  Zoom: { domains: ['zoom.us', 'zoom.com'], aliases: [], official: 'https://zoom.us' },
  'Google Meet': { domains: ['meet.google.com'], aliases: [], official: 'https://meet.google.com' },
  Zendesk: { domains: ['zendesk.com'], aliases: [] },
  Intercom: { domains: ['intercom.com'], aliases: [] },
  Freshworks: { domains: ['freshworks.com'], aliases: ['Freshdesk'], official: 'https://www.freshworks.com' },
  Canva: { domains: ['canva.com'], aliases: [], official: 'https://www.canva.com' },
  Figma: { domains: ['figma.com'], aliases: [], official: 'https://www.figma.com' },
  Sketch: { domains: ['sketch.com'], aliases: [], official: 'https://www.sketch.com' },
  Jira: { domains: ['atlassian.com/software/jira'], aliases: [], official: 'https://www.atlassian.com' },
}
/** The wrong "official sites" Batch A picked. None may ever be picked again. */
const BATCH_A_WRONG = ['hao.itotii.com', 'codacomms.com', 'tripowerdesign.com', 'chinaubuntu.com', 'm.xitongzhijia.net', 'gamege.com', 'eday360.com.cn', 'doodles.google', 'wbolt.com', 'marketingforindustry.com']

test('v2 official site: with checked hints, every Batch A company gets its real site or none (never a look-alike)', () => {
  for (const [name, hits] of Object.entries(BATCH_A_SEARCHES)) {
    const h = HINTS[name]
    assert.ok(h, `hint missing for ${name}`)
    const got = pickOfficialSite(name, hits, h, 5, true)
    // official site present in the results → picked (on one of its official domains); absent → nothing picked here (the domain is then checked directly)
    if (h.official) assert.ok(got && hostMatches(new URL(got).hostname, h.domains), `${name} → ${got}`)
    else assert.equal(got, undefined, name)
  }
})

test('v2 official site: without any hints, no look-alike from Batch A is ever picked', () => {
  for (const [name, hits] of Object.entries(BATCH_A_SEARCHES)) {
    const got = pickOfficialSite(name, hits, { domains: [], aliases: [] }, 4)
    if (got) assert.ok(!BATCH_A_WRONG.includes(new URL(got).hostname), `${name} → ${got}`)
  }
})

test('v2 official site: directories, download sites and big-platform pages score as never official', () => {
  const hit = (url: string, title = 'Notion 官网') => ({ title, url, snippet: '', position: 1 })
  assert.equal(scoreOfficial('Notion', hit('https://hao.itotii.com/notion')), -1)
  assert.equal(scoreOfficial('飞书', hit('https://m.xitongzhijia.net/soft/1.html', '飞书官网下载')), -1)
  assert.equal(scoreOfficial('腾讯文档', hit('https://pc.qq.com/detail/1.html', '腾讯文档')), -1)
  // …but the exact product sub-site of a platform is fine once hinted
  assert.ok(scoreOfficial('腾讯文档', hit('https://docs.qq.com/', '腾讯文档'), { domains: ['docs.qq.com'], aliases: [] }) >= 5)
})

test('v2 CSV: a pricing template cell exports plans, each slot and the slots with no public information', () => {
  const csv = toCsv(
    {
      runId: 'r',
      finishedAt: '',
      stats: { sources: 0, checked: 1, requeried: 0, passed: 1, dropped: 0 },
      intent: { type: 'named', query: 'q', competitors: ['A'], timeRange: 'all', dimensions: ['name', 'pricing'] },
      rows: [{ competitor: 'A', domain: 'a.io', cells: { name: { value: 'A', sources: [], status: 'verified' }, pricing: { value: 'Free / Pro $10', sources: [{ kind: 'site', url: 'https://a.io/pricing', title: '' }], status: 'verified', items: [{ label: '计费方式', text: '按年计费', url: 'https://a.io/pricing' }], gaps: ['附加成本'] } } }],
    },
    'zh',
  )
  assert.match(csv, /"Free \/ Pro \$10\n计费方式：按年计费\n暂无公开信息：附加成本"/)
})

/* ---------- v2.1: Google knowledge graph and Wikidata as official-site sources (20 Oct 2026) ---------- */
import { panelMatches, wikidataAgrees } from '../src/pipeline/collect.ts'
import { wikidataSites, type WdEntity } from '../src/sources/search.ts'

test('v2.1 Wikidata: only an entity whose label or alias is the name counts, deprecated websites are skipped', () => {
  const entities: WdEntity[] = [
    { id: 'Q1', labels: { en: { value: 'Notion (concept)' } }, claims: { P856: [{ mainsnak: { datavalue: { value: 'https://wrong.example' } } }] } },
    { id: 'Q2', labels: { zh: { value: '飞书' } }, aliases: { en: [{ value: 'Lark' }] }, claims: { P856: [{ rank: 'deprecated', mainsnak: { datavalue: { value: 'https://old.example' } } }, { mainsnak: { datavalue: { value: 'https://www.feishu.cn/' } } }] } },
    { id: 'Q3', labels: { en: { value: 'Lark' } } },
  ]
  assert.deepEqual(wikidataSites(entities, ['飞书', 'Feishu']), [{ id: 'Q2', label: '飞书', website: 'https://www.feishu.cn/' }])
  assert.deepEqual(wikidataSites(entities, ['Notion']), [])
})

test('v2.1 knowledge graph and Wikidata answers are cross-checked before use', () => {
  assert.equal(panelMatches('Notion', ['Notion']), true)
  assert.equal(panelMatches('Notion Labs', ['Notion']), true)
  assert.equal(panelMatches('Doodle', ['Google Doodle']), false)
  assert.equal(panelMatches(undefined, ['Notion']), false)
  const hints = { domains: ['feishu.cn', 'larksuite.com'], aliases: ['Feishu', 'Lark'] }
  assert.equal(wikidataAgrees('https://www.feishu.cn/', '飞书', hints), true)
  assert.equal(wikidataAgrees('https://m.xitongzhijia.net/feishu', '飞书', hints), false)
  assert.equal(wikidataAgrees('https://unrelated.example', '飞书', hints), false)
  // no hints to disagree with: a curated Wikidata site is accepted, unless it is a directory or review site
  assert.equal(wikidataAgrees('https://www.dingtalk.com', '钉钉', { domains: [], aliases: [] }), true)
  assert.equal(wikidataAgrees('https://www.g2.com/x', '钉钉', { domains: [], aliases: [] }), false)
  // Batch C: Wikidata's Hungarian "Intercom" (intercom.hu) is not the support product at intercom.com
  const ic = { domains: ['intercom.com'], aliases: ['Intercom'] }
  assert.equal(wikidataAgrees('https://www.intercom.hu/', 'Intercom', ic), false)
  assert.equal(wikidataAgrees('https://www.intercom.com/', 'Intercom', ic), true)
  assert.equal(wikidataAgrees('https://www.notion.so/', 'Notion', { domains: ['notion.com'], aliases: ['Notion'] }), true)
})

/* ---------- v2.2: specific pricing searches and dated third-party sources (20 Oct 2026) ---------- */
import { pageDate } from '../src/sources/html.ts'
import { pricingQuery } from '../src/pipeline/collect.ts'

test('v2.2 page dates: modified beats published; meta, JSON-LD, <time> and "Updated:" lines are read', () => {
  assert.equal(pageDate('<meta property="article:modified_time" content="2026-09-12T08:00:00Z"><meta property="article:published_time" content="2025-01-01">'), '2026-09-12')
  assert.equal(pageDate('<script type="application/ld+json">{"datePublished":"2025-03-01","dateModified":"2026-08-30"}</script>'), '2026-08-30')
  assert.equal(pageDate('<time datetime="2026-07-01">July</time>'), '2026-07-01')
  assert.equal(pageDate('', 'Kapwing pricing — Last updated: September 3, 2026'), '2026-09-03')
  assert.equal(pageDate('', '石墨文档价格 更新于 2026年9月20日'), '2026-09-20')
  assert.equal(pageDate('<p>no date here</p>', 'no date here'), undefined)
})

test('v2.2 pricing searches name the template points and what the user cares about', () => {
  assert.equal(pricingQuery('Kapwing', 'en', ['watermark', 'subtitles']), 'Kapwing pricing plans per user per month billed annually free plan watermark subtitles')
  assert.match(pricingQuery('飞书', 'zh'), /^飞书 定价 套餐 价格 每人每月 年付 免费版$/)
})

test('v2.2 pricing may rest on a third-party page only if it is dated within 12 months; features still need the official site', () => {
  const recent = new Date(Date.now() - 40 * 86400000).toISOString().slice(0, 10)
  const docs = [
    { id: 'W1', kind: 'web' as const, url: 'https://review.example/x-pricing', title: 'X pricing', text: 'X Pro costs $12 per user per month', status: 200, date: recent },
    { id: 'W2', kind: 'web' as const, url: 'https://old.example/x', title: 'X pricing 2023', text: 'X Pro costs $8 per user per month', status: 200, date: '2023-05-01' },
    { id: 'W3', kind: 'web' as const, url: 'https://nodate.example/x', title: 'X pricing', text: 'X Pro costs $9 per user per month', status: 200 },
  ]
  const fresh = verifyFact('pricing.plans', { value: 'Pro $12', evidence: [{ doc: 'W1', quote: 'X Pro costs $12 per user per month' }] }, docs)
  assert.equal(fresh.ok, true)
  assert.equal(fresh.thirdParty, true)
  assert.equal(verifyFact('pricing.plans', { value: 'Pro $8', evidence: [{ doc: 'W2', quote: 'X Pro costs $8 per user per month' }] }, docs).reason, 'stale')
  assert.equal(verifyFact('pricing.plans', { value: 'Pro $9', evidence: [{ doc: 'W3', quote: 'X Pro costs $9 per user per month' }] }, docs).reason, 'stale')
  assert.equal(verifyFact('features', { value: 'Pro', evidence: [{ doc: 'W1', quote: 'X Pro costs $12 per user per month' }] }, docs).reason, 'seo_only')
})

/* ---------- v2.3: carrying confirmed official sites into the follow-up run (25 Oct 2026) ---------- */
import { validateIntent } from '../src/pipeline/intent.ts'

test('v2.3 a follow-up intent keeps carried-over official sites only for its own subjects and only as plain host names', () => {
  const i = validateIntent(
    {
      type: 'named',
      query: 'q',
      competitors: ['石墨文档', '腾讯文档'],
      timeRange: 'all',
      dimensions: ['name', 'pricing'],
      sites: { 石墨文档: 'https://shimo.im/', 腾讯文档: 'javascript:alert(1)', 金山文档: 'kdocs.cn' },
    },
    5,
  )
  assert.deepEqual(i?.sites, { 石墨文档: 'shimo.im' })
})

/* ---------- v2.4: fixes found in Batch B and live use (25 Oct 2026) ---------- */
import { hasPrice } from '../src/pipeline/collect.ts'

test('v2.4 a page "has a price" only with a real amount; JavaScript pricing pages without numbers do not count', () => {
  // what typeform.com/pricing returned before its scripts ran: plan names and "/mo", no numbers
  assert.equal(hasPrice('Basic  /mo  Plus  /mo  Business  /mo  Billed monthly  per month  Enterprise contact sales'), false)
  assert.equal(hasPrice('Free $0 forever'), false)
  assert.equal(hasPrice('Grow $24 USD per month billed yearly'), true)
  assert.equal(hasPrice('Basic $9 per seat'), true)
  assert.equal(hasPrice('企业版 360 元/人/年'), true)
  assert.equal(hasPrice('个人版 108元/年'), true)
  assert.equal(hasPrice('Team 15 per user per month'), true)
  assert.equal(hasPrice('支持按月付费，每人每月计费'), false)
})
