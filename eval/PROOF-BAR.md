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
