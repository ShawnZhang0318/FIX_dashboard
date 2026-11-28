# Project F.I.X. operations guide

**Operator target** · One Windows machine, store `S001`, 20 products, real FastAPI services, trained LightGBM model and local SQLite. Run commands in PowerShell from the repository root. Open Overview for the latest stock and sales, Analysis for Daily forecasts or Monthly diagnostics, and Review queue for planner decisions. For the final demonstration and its evidence, see the [Week 13 checkpoint](../submissions/week13/README.md).

## 1. Local startup

Install Git, Node.js 22.12 or later in the Node 22 line (including npm), and Python 3.12 with the Windows `py` launcher. From a fresh clone of [the project repository](https://github.com/ShawnZhang0318/FIX_dashboard), open the directory containing `package.json`. Use the CSV and model artifacts from the same revision. Ports 5174, 8000 and 8001 must be available.

```powershell
npm ci
py -3.12 -m venv .venv-model
.\.venv-model\Scripts\python.exe -m pip install -r ai/requirements-dev.txt
$env:VITE_BASE_PATH = '/FIX_dashboard/'
$env:FIX_STORE_TIMEZONE = 'Asia/Shanghai'
$env:FIX_STORE_CLOSE_TIME = '22:00'
$apiBase = 'http://127.0.0.1:8000'
.\scripts\start-local-demo.ps1
```

Leave `FIX_DATABASE_URL` unset for this demo. The launcher builds the dashboard, runs the API on port 8000, starts the worker and private AI service (8001), and serves the dashboard on 5174. The processes share `.local-integration/`, including `fix.sqlite3`, backend logs and the process list. The browser uses the public API on loopback, where the demo has no login or authenticated reviewer identity. GitHub Pages serves sample data by default. A hosted build can use a public backend through `VITE_FIX_API_URL`. The connection badge identifies the selected mode. Verify the hosted services separately; Railway remains a fallback with partial acceptance. [Runtime configuration](../public/runtime-config.js) · [Railway deployment notes](railway-deploy-zh.md)

Once both readiness checks below return HTTP 200, import the historical dataset and confirm the reference date.

```powershell
.\.venv-model\Scripts\python.exe -m local_backend.import_csv
$stock = Invoke-RestMethod "$apiBase/inventory?store_id=S001"
$cutoffRows = Invoke-RestMethod "$apiBase/snapshots?store_id=S001&from=2023-11-15&to=2023-11-15"
$stock.Count
$cutoffRows.Count
```

Expect **20** for each count. The importer checks the CSV against the model manifest, selects 14,620 S001 rows, and sends batches of up to 100 through `POST /snapshots`. After an interruption, run the importer again. It verifies previously saved rows and submits the missing ones. A source mismatch requires investigation. [Importer](../local_backend/import_csv.py)

## 2. Health checks

```powershell
Invoke-RestMethod "$apiBase/health/live"
Invoke-RestMethod "$apiBase/health/ready"
Invoke-RestMethod 'http://127.0.0.1:8001/health/ready'
Invoke-RestMethod "$apiBase/inventory/automation?store_id=S001"
Invoke-RestMethod "$apiBase/snapshots/latest?store_id=S001"
```

| Signal | What the operator should see |
| --- | --- |
| API live | `status=ok` and the intended database type. |
| API ready | `database=available`, `worker=available`. Readiness runs a database query and checks for a heartbeat less than 30 seconds old. |
| AI ready | `service=ai`, `status=ok` once the predictor has loaded. AI HTTP liveness is also available at `/health/live` on port 8001. |
| Inventory automation | The store's business date, time zone, closing time, status, next scheduled close and last settled date. A newly enabled installation can have a null last settled date. |
| Snapshot coverage | `snapshot_date` is the latest stored date. `cutoff_date` is the latest model-eligible date with 29 complete S001 days. Gaps may put the usable cutoff earlier than the latest stock balance. |

If readiness is still starting, repeat the checks before submitting work. For a database, model or worker error, use section 5. [Local overview](http://127.0.0.1:5174/FIX_dashboard/#/overview) · [Public API explorer](http://127.0.0.1:8000/docs)

## 3. Run and verify the two workflows

### Run a planner analysis

Open **Analysis** and note the displayed cutoff. Both modes use the API's latest runnable Daily cutoff when available and otherwise try the latest snapshot date. **Run Daily Analysis** calculates replenishment forecasts for eligible products. **Run Monthly Analysis** compares two successive 28-day periods across the catalog and surfaces persistent sales changes and stockouts. Monthly results appear under `diagnostics` and need 56 consecutive observations per product for complete checks. The live UI supports both modes. Mock mode supports Daily only.

For the fixed historical regression, run the acceptance script against the local stack after import. It submits the script's fixed cutoff date, store `S001` and mode `daily` to `POST /analysis-runs`. Each invocation creates a persisted run and records an advisory review. Use a demo database and run outside the scheduled store close, because the check compares inventory before and after review.

```powershell
node scripts/verify-local-demo.mjs
if ($LASTEXITCODE -ne 0) { throw 'Acceptance check failed. Inspect the API and worker logs.' }
$proof = Get-Content -Raw -LiteralPath .local-integration/verification.json | ConvertFrom-Json
$runId = $proof.run.id
Invoke-RestMethod "$apiBase/analysis-runs/$runId" | Select-Object id,status,processed_count,expected_count,partial
"http://127.0.0.1:5174/FIX_dashboard/#/analysis/$runId"
```

The API persists the run and job before returning HTTP 202. The worker claims the job, sends cutoff-safe inputs to the private AI service, then saves product forecasts and any exception cases. Daily jobs progress from `queued/pending` to `processing/claimed`, then `completed/completed` or `failed/failed` (Run/Job). The reference run should return **20 of 20** products with `status=completed` and `partial=false`. For `P0001`, cutoff stock is 82 and the cumulative lead-time forecasts are approximately 424.04 (P50) and 648.03 (P90). The suggested order is 567 units. Open the displayed run URL or read `/analysis-runs/{run_id}/results` to inspect the saved output. The script reads back the approval and checks the correlated log export. Review decisions are advisory. [Acceptance script](../scripts/verify-local-demo.mjs)

### Inspect the daily inventory settlement

Every day at **22:00 Beijing time**, the worker computes and posts a **simulated** sale and replenishment for each product. With 29 consecutive snapshots through yesterday and a supported cutoff, it derives daily demand from the model's lead-time P50 and sets the stock target from P90. With insufficient recent history it uses the historical seasonal baseline and records that source. Model service errors block settlement and are retried. Sales are capped at opening stock, then forecast replenishment is credited as a simulated same-day receipt.

On the inventory page expand **Automatic settlement & schedule** to inspect the next close. Choose a completed date and check **closing stock = opening stock − units sold + replenishment received**. To inspect the last completed receipt and its snapshots from the API, use:

```powershell
$schedule = Invoke-RestMethod "$apiBase/inventory/automation?store_id=S001"
$day = $schedule.last_settled_date
if ($day) {
    Invoke-RestMethod "$apiBase/sales/day?business_date=$day" |
        Select-Object business_date,mode,total_units_sold,total_units_replenished
    $items = Invoke-RestMethod "$apiBase/snapshots?store_id=S001&from=$day&to=$day"
    $items | Select-Object product_id,opening_quantity,predicted_units_sold,units_sold,units_replenished,inventory_level,forecast_source
}
```

All products and the day's receipt commit together. Reprocessing a saved close leaves stock unchanged. The worker catches up dates missed **since activation** when it restarts. Gaps preceding activation remain visible. The case-review endpoint and the inventory worker have separate responsibilities. [Inventory guide](daily-data-entry-zh.md)

## 4. Metrics, logs and verification commands

Use `processed_count / expected_count`, `partial`, timestamps, per-result `duration_ms`, worker heartbeat and settlement status as operational signals. In **History & logs**, recent analyses come from this browser's retained activity. Open **Task details & logs** on a saved run or the backend log view to follow a Run, Job, Request or Case ID. Backend event timestamps are UTC. Current monitoring uses application logs and health endpoints; Prometheus instrumentation and alerting remain future work.

To export all events matching a known run, keep its filters and snapshot ID together. The first request freezes the matching events. A new query captures later events.

```powershell
$logSet = Invoke-RestMethod "$apiBase/logs?run_id=$runId&limit=25"
$logSet | Select-Object total,snapshot_id,coverage | ConvertTo-Json -Depth 5
$logFile = Join-Path '.local-integration' ("logs-" + $logSet.snapshot_id + ".ndjson")
Invoke-WebRequest -UseBasicParsing -Uri "$apiBase/logs/export?run_id=$runId&snapshot_id=$($logSet.snapshot_id)" -OutFile $logFile
```

The API and worker persist structured events in the database. The API collector reads `.local-integration/ai-events.jsonl` when logs are queried. In a deployment with separate filesystems, inspect the AI service console and check the returned `coverage` field. Captured service coverage may be partial. Log queries and exports can grow the database, which currently has no automatic retention policy. [Log API contract](backend-logs-contract.md)

Run the repeatable checks from the same checkout:

```powershell
npm test
npm run build
.\.venv-model\Scripts\python.exe -m pytest -q ai/tests ai/integration_tests integration/tests local_backend/tests scripts/tests
```

Use the default temporary SQLite databases for tests. Leave `FIX_TEST_POSTGRES_URL` unset unless it points to a **dedicated disposable database**. The PostgreSQL test fixture truncates workflow tables, and the PostgreSQL-specific test skips when the URL is absent. For the optional PostgreSQL runtime, the API and worker need the same `FIX_DATABASE_URL`; the worker also needs the private AI address in `FIX_AI_URL`. Startup applies numbered migrations under a database lock. Check `schema_migrations` for revisions 001 through 004 in this source version. [SQL migrations](../local_backend/migrations)

## 5. Failure handling

| Symptom | Operator action |
| --- | --- |
| Startup reports an occupied port or an existing demo | Check the listeners with `Get-NetTCPConnection -LocalPort 5174,8000,8001 -State Listen`. Reuse a healthy stack or stop the recorded project processes before starting again. |
| API readiness 503 or a run stays queued | Read `.local-integration/worker-stderr.log` and `api-stderr.log`. Confirm the worker and API use the same database. A long model call can delay the heartbeat. Check the AI readiness endpoint separately. |
| Daily request rejected with 422 | Verify the cutoff is on or after 2023-09-01 and has all 20 products. Each selected product needs 29 consecutive daily observations ending on the cutoff. Inspect `cutoff_date` and `snapshot_date` from `/snapshots/latest`. If `cutoff_date` is null, the UI can submit an incomplete date. Import the verified source data and use the historical replay in section 3. |
| Worker or AI fails mid-analysis | Read the run's `error`, `partial` flag and correlated logs. Earlier product results can survive. A failed or partial parent run cannot accept reviews. The worker retries transient polling errors after five seconds. A crash after claim may leave `processing/claimed` without an automatic lease or replay. Confirm the original worker has stopped, restore readiness, and record the original ID before intentionally creating a new run. |
| Submission timed out, or review returns 409/422 | Search by Request ID before resubmitting. Each new analysis POST can create a job. Reload the case and parent run before review. A completed, non-partial run and pending case are required. Check the reason, quantity and permitted action for that case. |
| Inventory settlement is blocked | Inspect `detail` from the automation endpoint and filter worker logs for `inventory.settlement_blocked`. Verify opening stock for all products, data conflicts and private AI readiness. The worker retries the same due day. An imported full date is preserved. A date without a posted receipt can return 404 from `/sales/day`. |
| Dashboard shows mock data or fails to reach the API | Use the local preview URL, check the public API health and exact frontend origin, and rebuild after changing `VITE_BASE_PATH`. For hosted use, verify its specific runtime API URL, CORS and health separately. |

Use `Get-Content .local-integration/worker-stderr.log -Tail 80` to inspect recent worker failures. Matching stdout and stderr files exist for `api`, `worker`, `ai` and `dashboard` after a full launch. Save the relevant UTC time, code revision and IDs when handing a failure to another teammate.

## 6. Stop, back up and restore

1. Allow known runs and any in-progress settlement to finish. Run `.\scripts\stop-local-demo.ps1`. It stops the recorded project processes and preserves persisted state. A subsequent scripted start replaces the redirected console logs.
2. For a SQLite backup, stop any other process using the same database, then copy the **whole** `.local-integration` directory, including any WAL files and AI events, to a new backup directory outside the checkout. Record `git rev-parse HEAD` with the copy. Keep the matching model and source CSV revision.
3. For a normal restart, use the original directory and repeat the startup and health checks. For a clean demonstration, use a fresh checkout and import the historical CSV. To restore an archive, stop the stack, preserve the current directory separately, copy the backup back as `.local-integration`, restart, and read back the saved run, inventory date and review.
4. When using PostgreSQL, back up and restore the database with its provider tools or PostgreSQL dump/restore tooling. Test restored rows and migration versions in a separate database before switching the API and worker. Each environment also needs its AI log capture if those logs are part of the evidence.
