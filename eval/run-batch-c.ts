/**
 * Capsight · Batch C — layered evaluation (designed 25 Oct 2026, after Batch B).
 *   Layer 1  intent:  64 questions → is the branch right (A: find competitors / B: named), is the type right, are the named competitors right
 *   Layer 2  site:    48 products (+24 overseas products searched in Chinese) → is the official site the reference site
 *   Layer 3  content: 8 full runs sampled from layer 1 → tables for Harper's manual audit
 * Reference answers (official domains) live in eval/batch-C/catalog.json and are checked by Harper.
 * Scoring reads catalog.json when it runs, so a corrected reference can be re-scored without re-running:  … score <results folder>
 *
 * Usage (from the project folder):  bash eval/run-batch-c.sh            (all three layers, about 25 minutes)
 *                                   bash eval/run-batch-c.sh intent site (only some layers)
 *                                   bash eval/run-batch-c.sh score eval/batch-C/<folder>
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const args = process.argv.slice(2)

const { loadDotEnv, loadConfig } = await import('../server/src/config.ts')
loadDotEnv(join(here, '../server/.env'))
loadDotEnv(join(here, '../server/keys.env'))
const { openDb } = await import('../server/src/db/db.ts')
const { createProviders } = await import('../server/src/providers.ts')
const { parseIntent } = await import('../server/src/pipeline/intent.ts')
const { collect, hostMatches, isLookAlike } = await import('../server/src/pipeline/collect.ts')
const { runResearch } = await import('../server/src/pipeline/run.ts')
const { toCsv } = await import('../server/src/pipeline/csv.ts')

type Product = { id: string; scenario: string; scenario_zh: string; region: 'cn' | 'global'; name: string; official_domains: string[] }
type IntentQ = { id: string; scenario: string; kind: string; lang: 'zh' | 'en'; query: string; expected_type: string; expected_branch: 'A' | 'B'; expected_competitors: string[] | null; note: string }
const catalogPath = join(here, 'batch-C', 'catalog.json')
const catalog = () => JSON.parse(readFileSync(catalogPath, 'utf8')) as { products: Product[]; intents: IntentQ[] }

const esc = (v: unknown) => `"${String(v ?? '').replace(/"/g, '""')}"`
const csv = (head: string[], rows: unknown[][]) => '﻿' + [head.join(','), ...rows.map((r) => r.map(esc).join(','))].join('\n')
const norm = (s: string) => s.toLowerCase().normalize('NFKC').replace(/[\s.\-·_]/g, '')
const pct = (a: number, b: number) => (b ? `${a}/${b} (${Math.round((100 * a) / b)}%)` : '—')

/* ---------------- scoring (re-runnable) ---------------- */
function score(dir: string) {
  const { products, intents } = catalog()
  const lines: string[] = [`# Batch C · results`, ``, `Folder: ${dir}`, `Scored: ${new Date().toISOString()} · reference: eval/batch-C/catalog.json (verified by Harper: ${products.filter((p: any) => p.verified_by_harper).length}/${products.length})`, ``]

  if (existsSync(join(dir, 'intent.raw.json'))) {
    const raw = JSON.parse(readFileSync(join(dir, 'intent.raw.json'), 'utf8')) as Record<string, any>
    const rows: unknown[][] = []
    let branch = 0, type = 0, names = 0, namesN = 0, n = 0
    const byKind: Record<string, [number, number]> = {}
    for (const q of intents) {
      const r = raw[q.id]
      if (!r) continue
      n++
      const got = r.intent?.type ?? 'error'
      const gotBranch = got === 'own' ? 'A' : got === 'named' || got === 'timeframe' ? 'B' : '?'
      const bOk = gotBranch === q.expected_branch
      const tOk = got === q.expected_type
      let nOk: boolean | '' = ''
      if (q.expected_competitors) {
        namesN++
        const want = new Set(q.expected_competitors.map(norm))
        const have = new Set<string>((r.intent?.competitors ?? []).map(norm))
        nOk = want.size === have.size && [...want].every((w) => have.has(w))
        if (nOk) names++
      }
      if (bOk) branch++
      if (tOk) type++
      byKind[q.kind] ??= [0, 0]
      byKind[q.kind][1]++
      if (bOk) byKind[q.kind][0]++
      const found = (r.intent?.competitors ?? []) as string[]
      const inCatalog = q.expected_branch === 'A' ? found.filter((f) => products.some((p) => p.scenario === q.scenario && norm(p.name) === norm(f))).length : ''
      rows.push([q.id, q.scenario, q.kind, q.lang, q.query, q.expected_branch, gotBranch, bOk ? 'Y' : 'N', q.expected_type, got, tOk ? 'Y' : 'N', (q.expected_competitors ?? []).join(' / '), found.join(' / '), nOk === '' ? '' : nOk ? 'Y' : 'N', inCatalog, r.ms])
    }
    writeFileSync(join(dir, 'intent.csv'), csv(['id', 'scenario', 'kind', 'lang', 'query', 'expected_branch', 'got_branch', 'branch_ok', 'expected_type', 'got_type', 'type_ok', 'expected_competitors', 'got_competitors', 'competitors_ok', 'A: found in same-scenario catalog', 'ms'], rows))
    lines.push(`## Layer 1 · intent (n = ${n})`, ``, `| measure | result |`, `|---|---|`, `| branch right (A vs B) | ${pct(branch, n)} |`, `| type right (own / named / timeframe) | ${pct(type, n)} |`, `| named competitors extracted exactly (B) | ${pct(names, namesN)} |`)
    for (const [k, [ok, all]] of Object.entries(byKind)) lines.push(`| branch right · ${k} | ${pct(ok, all)} |`)
    lines.push('')
  }

  if (existsSync(join(dir, 'site.raw.json'))) {
    const raw = JSON.parse(readFileSync(join(dir, 'site.raw.json'), 'utf8')) as { id: string; lang: string; domain: string; method: string; ms: number }[]
    const rows: unknown[][] = []
    const tally = (filter: (x: any) => boolean) => {
      const xs = scored.filter(filter)
      return { n: xs.length, ok: xs.filter((x) => x.v === 'correct').length, wrong: xs.filter((x) => x.v === 'wrong').length, look: xs.filter((x) => x.v === 'look-alike').length, none: xs.filter((x) => x.v === 'none').length }
    }
    const scored = raw.map((r) => {
      const p = products.find((x) => x.id === r.id)!
      const v = !r.domain ? 'none' : hostMatches(r.domain, p.official_domains) ? 'correct' : isLookAlike(r.domain) ? 'look-alike' : 'wrong'
      const cross = (p.region === 'global' && r.lang === 'zh') || (p.region === 'cn' && r.lang === 'en')
      rows.push([p.id, p.scenario, p.region, p.name, r.lang, cross ? 'Y' : '', p.official_domains.join(' / '), r.domain || '—', r.method, v, r.ms])
      return { ...r, region: p.region, cross, v }
    })
    writeFileSync(join(dir, 'sites.csv'), csv(['id', 'scenario', 'region', 'product', 'search_lang', 'cross_language', 'reference_site', 'found_site', 'method', 'verdict', 'ms'], rows))
    const row = (label: string, t: ReturnType<typeof tally>) => `| ${label} | ${pct(t.ok, t.n)} | ${t.wrong} | ${t.look} | ${t.none} |`
    lines.push(`## Layer 2 · official site (n = ${raw.length} look-ups)`, ``, `| slice | correct | wrong | look-alike | none |`, `|---|---|---|---|---|`)
    lines.push(row('all', tally(() => true)), row('Chinese brands', tally((x) => x.region === 'cn')), row('overseas brands, English search', tally((x) => x.region === 'global' && !x.cross)), row('overseas brands, Chinese search', tally((x) => x.region === 'global' && x.cross)))
    for (const m of [...new Set(scored.map((x) => x.method || '(none)'))]) lines.push(row(`method: ${m}`, tally((x) => (x.method || '(none)') === m)))
    lines.push('')
  }

  if (existsSync(join(dir, 'content.raw.json'))) {
    const raw = JSON.parse(readFileSync(join(dir, 'content.raw.json'), 'utf8')) as Record<string, any>
    lines.push(`## Layer 3 · content sample (n = ${Object.keys(raw).length} runs) — for Harper's audit`, ``, `| id | query | seconds | checked / passed / dropped | pricing slots | third-party pricing | model calls |`, `|---|---|---|---|---|---|---|`)
    for (const [id, r] of Object.entries(raw)) {
      const s = r.result?.stats ?? {}
      lines.push(`| ${id} | ${r.query} | ${Math.round((r.ms ?? 0) / 1000)} | ${s.checked ?? '—'} / ${s.passed ?? '—'} / ${s.dropped ?? '—'} | ${s.pricingSlots ? `${s.pricingSlots.filled}/${s.pricingSlots.total}` : '—'} | ${s.pricingThirdParty ?? '—'} | ${r.usage?.calls ?? '—'} |`)
    }
    lines.push('')
  }
  writeFileSync(join(dir, 'summary.md'), lines.join('\n'))
  console.log('\n' + lines.join('\n'))
}

if (args[0] === 'score') {
  score(args[1])
  process.exit(0)
}

/* ---------------- running ---------------- */
const layers = args.length ? args : ['intent', 'site', 'content']
const cfg = loadConfig()
const db = openDb(cfg.dbPath)
const providers = createProviders(cfg, db)
const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)
const outDir = join(here, 'batch-C', stamp)
mkdirSync(outDir, { recursive: true })
const { products, intents } = catalog()
console.log(`\nCapsight Batch C · layers: ${layers.join(', ')} · saving to eval/batch-C/${stamp}\n`)

async function pool<T>(items: T[], n: number, fn: (t: T) => Promise<void>) {
  let i = 0
  await Promise.all(Array.from({ length: n }, async () => {
    while (i < items.length) await fn(items[i++])
  }))
}

if (layers.includes('intent')) {
  console.log(`Layer 1 · intent · ${intents.length} questions`)
  const raw: Record<string, unknown> = {}
  await pool(intents, 3, async (q) => {
    const t0 = Date.now()
    try {
      const intent = await parseIntent(providers.llm(q.lang), providers.search(q.lang), q.query, q.lang, cfg.limits.maxCompetitors)
      raw[q.id] = { intent, ms: Date.now() - t0 }
      console.log(`  ${q.id} ${intent.type.padEnd(9)} ${intent.competitors.join(' / ')}`)
    } catch (e) {
      raw[q.id] = { error: String((e as Error).message || e), ms: Date.now() - t0 }
      console.log(`  ${q.id} ERROR ${(e as Error).message}`)
    }
    writeFileSync(join(outDir, 'intent.raw.json'), JSON.stringify(raw, null, 1))
  })
}

if (layers.includes('site')) {
  // every product in its own language, and every overseas product again in Chinese (Batch A's weakest case)
  const jobs = [...products.map((p) => ({ p, lang: (p.region === 'cn' ? 'zh' : 'en') as 'zh' | 'en' })), ...products.filter((p) => p.region === 'global').map((p) => ({ p, lang: 'zh' as const }))]
  console.log(`\nLayer 2 · official site · ${jobs.length} look-ups`)
  const raw: { id: string; lang: string; domain: string; method: string; ms: number }[] = []
  await pool(jobs, 3, async ({ p, lang }) => {
    const t0 = Date.now()
    try {
      const b = await collect({ fetcher: providers.fetcher, search: providers.search(lang), social: providers.social, llm: providers.llm(lang), topic: p.scenario_zh, lang }, p.name, ['name'], 'all')
      raw.push({ id: p.id, lang, domain: b.domain, method: b.siteMethod ?? '', ms: Date.now() - t0 })
      console.log(`  ${p.id.padEnd(10)} ${lang} ${p.name.padEnd(16)} → ${b.domain || '—'} ${b.siteMethod ?? ''}`)
    } catch (e) {
      raw.push({ id: p.id, lang, domain: '', method: 'error', ms: Date.now() - t0 })
      console.log(`  ${p.id} ERROR ${(e as Error).message}`)
    }
    writeFileSync(join(outDir, 'site.raw.json'), JSON.stringify(raw, null, 1))
  })
}

if (layers.includes('content')) {
  // 8 full runs: branch A in four scenarios, branch B pricing in four scenarios
  const pick = (scenario: string, kind: string, lang: string) => intents.find((q) => q.scenario === scenario && q.kind === kind && q.lang === lang)!
  const sample = [pick('docs', 'A-find', 'zh'), pick('crm', 'A-find', 'zh'), pick('forms', 'A-find', 'en'), pick('hr', 'A-find', 'zh'), pick('pm', 'B-pricing', 'en'), pick('support', 'B-pricing', 'en'), pick('design', 'B-pricing', 'zh'), pick('meeting', 'B-pricing', 'zh')]
  console.log(`\nLayer 3 · content · ${sample.length} full runs`)
  const raw: Record<string, unknown> = {}
  for (const q of sample) {
    const t0 = Date.now()
    const llm = providers.llm(q.lang)
    const before = { ...llm.usage }
    try {
      const intent = await parseIntent(llm, providers.search(q.lang), q.query, q.lang, cfg.limits.maxCompetitors)
      const result = await runResearch(`batchC_${q.id}`, intent, { llm, search: providers.search(q.lang), fetcher: providers.fetcher, social: providers.social, lang: q.lang, maxRequery: cfg.limits.maxRequery, emit: () => {} })
      const usage = { calls: llm.usage.calls - before.calls, inputTokens: llm.usage.inputTokens - before.inputTokens, outputTokens: llm.usage.outputTokens - before.outputTokens }
      raw[q.id] = { query: q.query, ms: Date.now() - t0, usage, result }
      writeFileSync(join(outDir, `${q.id}.csv`), toCsv(result, q.lang))
      console.log(`  ${q.id} done · ${Math.round((Date.now() - t0) / 1000)}s · ${result.rows.map((r) => `${r.competitor} (${r.domain || '—'})`).join('; ')}`)
    } catch (e) {
      raw[q.id] = { query: q.query, ms: Date.now() - t0, error: String((e as Error).message || e) }
      console.log(`  ${q.id} ERROR ${(e as Error).message}`)
    }
    writeFileSync(join(outDir, 'content.raw.json'), JSON.stringify(raw, null, 1))
  }
}

score(outDir)
console.log(`\nDone. Results: eval/batch-C/${stamp}/  (summary.md, intent.csv, sites.csv, content CSVs)\n`)
db.close()
process.exit(0)
