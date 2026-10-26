# Batch C · results

Folder: /Users/yisa/Desktop/我的项目/调研ai工具项目/eval/batch-C/2026-10-25T15-37-32
Scored: 2026-10-25T15:46:51.879Z · reference: eval/batch-C/catalog.json (verified by Harper: 0/48)

## Layer 1 · intent (n = 64)

| measure | result |
|---|---|
| branch right (A vs B) | 64/64 (100%) |
| type right (own / named / timeframe) | 64/64 (100%) |
| named competitors extracted exactly (B) | 40/40 (100%) |
| branch right · A-find | 16/16 (100%) |
| branch right · A-similar | 8/8 (100%) |
| branch right · B-pricing | 16/16 (100%) |
| branch right · B-mixed | 8/8 (100%) |
| branch right · B-basic | 8/8 (100%) |
| branch right · B-news | 8/8 (100%) |

## Layer 2 · official site (n = 72 look-ups)

| slice | correct | wrong | look-alike | none |
|---|---|---|---|---|
| all | 67/72 (93%) | 3 | 0 | 2 |
| Chinese brands | 21/24 (88%) | 1 | 0 | 2 |
| overseas brands, English search | 23/24 (96%) | 1 | 0 | 0 |
| overseas brands, Chinese search | 23/24 (96%) | 1 | 0 | 0 |
| method: wikidata | 27/29 (93%) | 2 | 0 | 0 |
| method: search_hint | 35/36 (97%) | 1 | 0 | 0 |
| method: (none) | 0/2 (0%) | 0 | 0 | 2 |
| method: hint_verified | 3/3 (100%) | 0 | 0 | 0 |
| method: search_domain | 2/2 (100%) | 0 | 0 | 0 |

## Layer 3 · content sample (n = 8 runs) — for Harper's audit

| id | query | seconds | checked / passed / dropped | pricing slots | third-party pricing | model calls |
|---|---|---|---|---|---|---|
| I01 | 我们是做在线协作文档的，帮我找竞品 | 89 | 15 / 12 / 3 | — | — | 18 |
| I17 | 我们是做CRM 客户管理的，帮我找竞品 | 40 | 20 / 17 / 3 | — | — | 19 |
| I34 | We build online forms and surveys software. Who are our competitors? | 77 | 20 / 19 / 1 | — | — | 19 |
| I57 | 我们是做人力资源 SaaS的，帮我找竞品 | 72 | 20 / 14 / 6 | — | — | 29 |
| I13 | Compare Asana and ClickUp pricing | 15 | 4 / 4 / 0 | 12/12 | 0 | 7 |
| I29 | Compare Zendesk and Intercom pricing | 81 | 4 / 3 / 1 | 8/12 | 1 | 12 |
| I52 | 查一下MasterGo、墨刀的定价 | 35 | 4 / 4 / 0 | 12/12 | 0 | 7 |
| I44 | 查一下小鱼易连、钉钉的定价 | 17 | 4 / 2 / 2 | 0/12 | 0 | 9 |
