# Capsight · Proof bar v1

Set and dated **19 October 2026**, before Batch A was run. Not to be edited after any test result is seen.
Changes after this date go in a new section with their own date and the reason.

## Endpoint

On 30 November 2026 the market lead decides whether to adopt Capsight (胶囊AI), the SaaS competitor-research
Agent specified at Gate 1, for routine SaaS competitor fact collection. Adopt only if all thresholds below are met.

## Proof standard

| # | Measure | Who measures, how | Threshold (met) | Falsifier |
|---|---|---|---|---|
| 1 | Source correctness | Harper (Yisa) audits 5 kept facts per run (about 50 facts per batch). Each fact is correct only if all four hold: link opens; quoted text is on the page; source is the official site or a credible source and is labelled correctly; value matches the page. | ≥ 90% of audited facts correct | F1: < 80% |
| 2 | Entity identification | Harper checks the official domain the system picked for every company in every run. | 0 wrong official sites in 10 runs | F2: ≥ 1 wrong official site after the v2 fix |
| 3 | Coverage | From the run database: passed ÷ (passed + dropped). | ≥ 60% | F3: < 40% |
| 4 | Time saved | Harper researches 2 test questions by hand (timed), compared with run time + Harper's audit time for the same questions. | ≥ 50% less time | F4: run + audit time ≥ manual time |
| 5 | In-vivo usefulness | 3–5 classmates run their own SaaS competitor questions and answer: "Would you still need to redo this research by hand?" | Majority answer no | F5: half or more answer yes |

Cost is recorded for every run (model calls, tokens, seconds) but has no pass/fail threshold.

## Test set (fixed for Batch A and Batch B)

| ID | Lang | Question | Type |
|---|---|---|---|
| Q01 | zh | 我们是做在线协作文档的，帮我找竞品 | find competitors (repeat of pilot) |
| Q02 | zh | 查一下 Notion、Coda、ClickUp 的基本信息 | named list (repeat of pilot, Notion domain bug) |
| Q03 | en | Compare Asana, Monday.com and Trello pricing | named list |
| Q04 | zh | 我们做 CRM，帮我查 Salesforce、HubSpot、纷享销客 | named list |
| Q05 | en | Find competitors of Calendly | find competitors |
| Q06 | zh | 查飞书、钉钉、企业微信的定价和功能 | named list |
| Q07 | en | Zoom, Microsoft Teams, Google Meet: pricing and recent news | named list |
| Q08 | zh | 我们做 SaaS 客服系统，帮我找竞品 | find competitors |
| Q09 | en | Figma vs Canva vs Sketch | named list |
| Q10 | zh | 查 Linear、Jira 的定价和联系方式 | named list |

## Procedure

- Batch A: current version (v1), run as-is with `bash eval/run-batch.sh A`. Intent is used exactly as the system parses it, with no human editing.
- Audit Batch A, record failures, fix, then Batch B: same 10 questions, at least 12 hours later (cache expiry), `bash eval/run-batch.sh B`.
- Pilot runs of 10 Oct 2026 were before this bar and count only as pilot evidence.

---

## Amendment 1 · 19 October 2026, after Batch A, before Batch B

Written after Batch A results were seen (run 19 Oct 2026, 20:29–20:47 SGT). Thresholds 1, 3, 4 and 5 are unchanged. What changed and why:

**What Batch A showed (v1, n = 10 questions, 31 company look-ups):**
- Official site wrong for 9 of 31 look-ups (link directories, download sites, unrelated blogs: hao.itotii.com for Notion, m.xitongzhijia.net for 飞书, doodles.google for Doodle …) and missing for 5 (Asana, Salesforce, Google Meet, Freshworks, Linear). Measure 2 (0 wrong official sites) is missed.
- Coverage 124 / 164 = 75.6 %, but facts taken from a wrong "official" site still passed the automatic quote check. Coverage alone overstates quality; measure 1 (Harper's audit) is the one that catches this.
- Pricing came back as one short line (Q03: 1 of 3 companies priced). Harper's own check of monday.com/pricing showed five plans, annual billing, seat counts and a discount the system did not capture.

**Changes for v2 (design by Harper, eval/design-v2.md; implemented by AI):**
1. Branch A ("find competitors": Q01, Q05, Q08) now returns the competitor list with a basic introduction only, no pricing or news. For these three questions Batch A and B are compared on competitor identification, official sites and the introduction, not on pricing.
2. Branch B returns overview, region, features, pricing (template), social and news by default.
3. New measure 6, pricing template completeness, on the questions that ask for pricing (Q02, Q03, Q04, Q06, Q07, Q09, Q10): slots filled with verified facts out of 6 per company (plans, unit, billing, extra costs, free tier, current offer), from the run database (`stats.pricingSlots`), plus Harper's check against her own manual lookup for Q03.
   Threshold: ≥ 3.5 of 6 slots per company on average. Falsifier F6: < 2.5. The plans slot must match Harper's manual lookup for all three Q03 companies.

## Amendment 1a · 20 October 2026, still before Batch B

No threshold changes. After reviewing Batch A's official-site accuracy (17 / 31 correct, 55 %), Harper asked for more reliable sources of the official site. v2.1 adds, in this order: Google's knowledge-graph website, Wikidata's official-website property (P856), and an English Google search for every brand with a Latin-script name or alias. Each run now records how every official site was found (`siteMethod`), and the batch writes `sites.csv`, one row per company, for Harper to mark correct / wrong / none. Measure 2 is reported overall and per method.

## Amendment 1b · 20 October 2026, still before Batch B

No threshold changes. Harper decided (20 Oct, 16:33 SGT) that pricing may rest on a third-party page when no official page states it, on two conditions: the page shows an update date within the last 12 months, and the result is labelled 「第三方来源」 with that date. Directory and download sites never count, and features and the official site still need official sources. For measure 1, Harper audits every third-party pricing fact (not only the 5-fact sample), and Batch B reports the third-party share (`pricingThirdParty`) and its audit result separately from official sources. Pricing searches now name the template points (plans, per-user price, annual billing, free plan) and the user's own fields.

## Amendment 1c · 25 October 2026, still before Batch B

No threshold changes. Harper's product review of v2.2 (25 Oct, 22:27 SGT) changed two things:
1. Branch A ("find competitors": Q01, Q05, Q08) now returns, for each competitor found, the introduction plus country/region, company size and funding (from the official about page, web pages and news; every value quoted, with its year). Measure 1 (Harper's audit) covers these fields for Q01, Q05 and Q08; pricing is still not asked in branch A.
2. After a branch A run, one click carries the competitor list and their confirmed official sites into a branch B run ("look up details"). Official sites carried over are recorded as `given` in `sites.csv` and are not counted again for measure 2.
