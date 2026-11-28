# Project F.I.X. | Week 13 final checkpoint

**Forecasting & Inventory Exceptions · MAIE 6000C · Group 5**

Cao Jun, Shah Pooja Zenit, Zhang Yitong and Zhou Guanxu

An inventory planner for store S001 needs to decide which products to replenish and which unusual sales patterns warrant investigation. F.I.X. turns daily stock and sales records for 20 products into a lead-time demand forecast, an exception queue and a saved human decision. The bilingual dashboard also offers a Monthly comparison and a separately scheduled inventory simulation.

**Demo readiness, 28 November 2026.** The local SQLite workflow passed an end-to-end check on application revision `9c0d3f6` with a public API, a separate worker and a private model service. The recommended demonstration uses this local stack. Railway/PostgreSQL acceptance remains partial.

## Reproduce the demonstration

Start from the repository root and complete sections 1 and 2 of the [operations guide](../../docs/operations.md). Both readiness checks should pass. Importing the supplied CSV loads 14,620 dated S001 observations. The following sequence lets a reviewer trace one planner decision from its source record to a saved result.

| Step | What to show | What the reviewer can verify |
| --- | --- | --- |
| 1. Inspect the input | Open **Overview**, then **Inventory**. Check the store, snapshot date and product count. | The API serves 20 products from the database. On the clean reference import, the latest snapshot and newest runnable cutoff are both `2024-01-01`. A later, incomplete history can move those dates apart. |
| 2. Submit a Daily analysis | In **Analysis**, select **Daily analysis** and use the cutoff shown. Open **Task details & logs**. | `POST /analysis-runs` returns HTTP 202 after saving a queued Run and pending Job. The Run keeps the cutoff, input snapshot references and model/policy versions. |
| 3. Inspect the prediction | Follow the Run to completion and open a product in the action list. | The worker claims the Job, builds features from 29 consecutive days of observations and calls the private LightGBM service. The report shows cutoff stock, median (P50) and upper (P90) demand over that product’s lead time, plus the suggested order. |
| 4. Record a decision | Open a pending case in **Review queue**, inspect the evidence, submit a decision and reload the case. | The saved review records the planner label, decision and applicable quantity. Record the Run and Case IDs to retrieve the same decision later. Stock changes follow the separate settlement workflow. |
| 5. Follow the execution | Select **View task logs** and export the matching events. | API, worker and AI events share identifiers. A frozen log query lets the reviewer compare the paged records with the NDJSON export. |

To reproduce the **specific numbers** below, use the fixed-date acceptance script after import. The script sends its fixed cutoff date directly to the local API and records one approval of a replenishment recommendation. Each execution generates its own IDs. The UI selects its date from stored coverage.

```powershell
node scripts/verify-local-demo.mjs
$proof = Get-Content -Raw .local-integration/verification.json | ConvertFrom-Json
"http://127.0.0.1:5174/FIX_dashboard/#/analysis/$($proof.run.id)"
```

## Recorded evidence

The 28 November replay used an isolated SQLite database and separate local processes. Alternate loopback ports kept the verification separate from the team's working database.

| Evidence | Result |
| --- | --- |
| Durable processing | Daily Run `3de6123d-7a83-4bd8-b504-c13fc5caa0d3` and Job `12c13b51-c5b1-4acd-ac99-a26eba318447` completed. All 20 eligible products had saved results. These identifiers belong to the verification database. |
| Model output and human review | P0001 had 82 units at the cutoff and a three-day lead time. P50 was 424.04 and P90 was 648.03 units. Rounding the positive P90 shortfall up gives **567 units**. The API returned the approval on a fresh read, and the inventory comparison before and after review matched. |
| Operational signal | The Daily replay retrieved **179** correlated API, worker and AI events, including 20 completed model forecasts. The exported event IDs matched the paged query. The event count can vary with polling. |
| Monthly workflow | At the same historical cutoff the backend completed diagnostics for all 20 products. For P0001, comparable daily sales averaged 145.79 units in the recent period and 129.14 in the preceding period. Only two of four weeks met the high-sales rule, below the three-week threshold. The scan produced zero forecast rows and zero review cases. |
| Missing-input check | In a separate database populated through `2023-11-15`, a Daily request for `2023-11-16` returned HTTP 422 and reported 0 of 20 cutoff products available. The operator can inspect `GET /snapshots/latest` and retry with a supported date. |
| Regression checks | **53 Python tests passed** across the AI, integration, backend and sales-script suites. The dedicated PostgreSQL check was skipped. **43 frontend tests passed** and the Vite production build succeeded. Commands are in the [operations guide](../../docs/operations.md). |

**Forecast quality.** On 2,040 held-out lead-time targets, the model's median forecast had 19.82% weighted absolute percentage error, compared with 21.26% for a 28-day rolling baseline. Actual sales fell at or below P90 in 93.58% of test cases overall and 83.33% of three-day cases. A planner considering a short-lead-time order should take that lower coverage into account. The target is recorded sales, which can understate demand when shelves are empty. [Model evaluation](../../ai/reports/s001-global-q-v1/evaluation_report.json)

## Inventory automation and operating limits

At **22:00 Asia/Shanghai**, the worker can post one simulated inventory settlement per business day. For each product it deducts forecast sales up to available stock, then credits the replenishment needed to reach the forecast stock target. The daily receipt and snapshots persist together. Inventory history identifies the source. A historical-sales estimate supplies settlement quantities when recent model history is insufficient. The fixed-date Daily acceptance above uses the trained model. [Settlement guide](../../docs/daily-data-entry-zh.md) · [Atomicity and concurrent-close tests](../../local_backend/tests/test_automatic_inventory.py)

Two boundaries matter during the demonstration. If the worker stops after claiming a Job, the Run can remain `processing` and the Job can remain `claimed`. The runbook explains how to inspect the original Run before deciding whether to start another. The worker can catch up missed inventory closings after restart, but gaps predating activation require a separate data import. The team kept missing historical observations open for real records. Reviews and simulated receipts do not send supplier orders.

## Milestone progression and artifacts

| Checkpoint | What changed and where to inspect it |
| --- | --- |
| Week 04 | The team specified a single-store snapshot → forecast → exception → review workflow and identified missing history and uncertainty in lead times as risks. [Proposal](../../docs/w04-reference/submissions/week04/README.md) |
| Week 07 | The team demonstrated a durable Daily Run, worker inference, persisted results and a human review at `w07-midterm`. [Midterm submission](../week07/README.md) · [Midterm slides](../week07/Week7_Midterm_Milestone.pptx) |
| Week 13 | The workspace adds an Overview, Monthly diagnostics, automatic selection of the newest runnable cutoff and scheduled simulated inventory settlement. [Overview screenshot](../../docs/images/overview.jpg) · [Monthly report screenshot](../../docs/images/monthly-analysis.jpg) |
| Design and operation | [Project README](../../README.md) · [Architecture and data flow](../../docs/architecture.md) · [Database decision](../../docs/adrs/001-database-choice.md) · [AI service decision](../../docs/adrs/003-ai-integration.md) · [Operations guide](../../docs/operations.md) · [Acceptance script](../../scripts/verify-local-demo.mjs) |
