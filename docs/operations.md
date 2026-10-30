# Project F.I.X. Operations Notes

**MAIE 6000C · Group 5**

Adapted from the [course operations template](https://github.com/aryansethi21052001/maie6000c/blob/main/docs/operations.md), using its six operational topics and commands supported by Project F.I.X.

**Implementation reference:** `61a015ff4094c15fb1333cd375d3daca0f41e830`, inspected on 2026-10-30. Commands use **Windows PowerShell from the repository root**. See the [root README](../README.md) for installation and [architecture](architecture.md) for design. Record actual demonstrations and evidence in [submissions/week07/README.md](../submissions/week07/README.md), which is still pending at this revision.

## Local startup

**Execution mode:** these steps run real FastAPI and AI services, a separate worker, and persistent storage. The integrated dashboard selects `live` mode on localhost/127.0.0.1 and calls `http://127.0.0.1:8000`; it does not switch to mock data if the backend is unavailable. Starting only the frontend is insufficient. The separate mock mode uses synthetic fixtures and browser storage.

**Verification scope:** the [README's current-status summary](../README.md#currently-works-local-integration) distinguishes historical local acceptance from hosted acceptance still to be recorded. Local success establishes the tested local path; cloud deployment requires its own recorded health, database, worker, result/review, and log checks.

### 1. Prepare the environment

Complete the [README prerequisites and installation](../README.md#quick-start-local-model-demo-on-windows): install frontend dependencies, create `.venv-model` using Python 3.12, and install `ai/requirements-dev.txt`.

The local demo uses PowerShell scripts and SQLite by default. It does not provide the template's Docker Compose stack or `.env.example` setup. Configure the current shell before starting:

| Setting | Use |
| --- | --- |
| `FIX_DATABASE_URL` | Leave unset for SQLite. For PostgreSQL, give API and worker the same PostgreSQL URL. Connection failure does not fall back to SQLite. |
| `FIX_AI_URL` | Worker-to-AI URL; default `http://127.0.0.1:8001`. |
| `VITE_BASE_PATH` | `/FIX_dashboard/` for the local URL below. |
| `FIX_ALLOWED_ORIGINS` | Optional comma-separated exact frontend origins. Defaults allow localhost/127.0.0.1 on ports 5173 and 5174. |

The startup script sets `FIX_LOCAL_STATE` to the repository's `.local-integration` directory. Do not assume a `.env` file configures these Python processes. Database credentials belong only in backend environments, never browser configuration or Git.

### 2. Start the services and check readiness

```powershell
$env:VITE_BASE_PATH = '/FIX_dashboard/'
.\scripts\start-local-demo.ps1
$apiBase = 'http://127.0.0.1:8000'
Invoke-RestMethod 'http://127.0.0.1:8001/health/ready'
Invoke-RestMethod "$apiBase/health/ready"
```

The script builds the dashboard and starts the public API, worker, private AI service, and frontend preview. Ports **8000**, **8001**, and **5174** must be free. It records process IDs/start times in `.local-integration/processes.json` and redirects console output to that directory.

Wait for both readiness checks to return HTTP 200 before importing or submitting work. Repeat checks during startup; inspect logs if they keep failing. Do not launch additional copies. Use `start-local-demo.ps1 -BackendOnly` only when a separately managed frontend is already available.

### 3. Load demo data

```powershell
.\.venv-model\Scripts\python.exe -m local_backend.import_csv
@(Invoke-RestMethod "$apiBase/inventory?store_id=S001").Count
@(Invoke-RestMethod "$apiBase/snapshots?store_id=S001&from=2023-11-15&to=2023-11-15").Count
```

The importer verifies the source CSV checksum and sends **14,620 S001 observations** through the public API in batches of up to 100. Both counts should be **20**. Re-running verifies and skips identical records; conflicts are rejected. Each batch is atomic, while earlier committed batches survive a later failure.

### 4. Submit an analysis

Open the [dashboard](http://127.0.0.1:5174/FIX_dashboard/#/analysis), choose **2023-11-15**, and select **Run Daily Analysis**. The [public API documentation](http://127.0.0.1:8000/docs) is also available.

Alternatively, this API request creates **one persisted analysis**, not a health check:

```powershell
$requestId = [guid]::NewGuid().ToString()
Write-Output "Creation request ID: $requestId"
$body = @{store_id='S001'; run_type='daily'; as_of_date='2023-11-15'} | ConvertTo-Json
$response = Invoke-WebRequest -UseBasicParsing -Method Post `
    -Uri "$apiBase/analysis-runs" -ContentType 'application/json' `
    -Headers @{'X-Request-ID'=$requestId} -Body $body
$response.StatusCode
$created = $response.Content | ConvertFrom-Json
$runId = $created.analysis_run.id
$jobId = $created.job.id
$created | ConvertTo-Json -Depth 4
```

Expect HTTP **202** and saved Run/Job IDs. Choose either the dashboard or API submission; using both creates two tasks. Supported inputs require S001, Daily mode, a cutoff on or after **2023-09-01**, all 20 cutoff-day snapshots, and 29 consecutive daily observations per product. Monthly analysis is not implemented.

### 5. Confirm worker processing and persisted output

Use the returned `$runId`, or set it to an ID copied from the dashboard:

```powershell
Invoke-RestMethod "$apiBase/analysis-runs/$runId" | ConvertTo-Json -Depth 6
Invoke-RestMethod "$apiBase/analysis-runs/$runId/results" | ConvertTo-Json -Depth 10
```

| Stage | Run status | Job status |
| --- | --- | --- |
| Accepted | `queued` | `pending` |
| Processing | `processing` | `claimed` |
| Successful completion | `completed` | `completed` |
| Handled execution failure | `failed` | `failed` |

For a successful full-store run, check `processed_count = expected_count = 20`, `partial = false`, and 20 persisted results. Intermediate states may finish before the next poll; correlated logs retain the processing events. Open an exception and save a review after completion. Reviews are advisory and do not change stock or place orders.

Hosted operation uses separate API, worker, AI, and PostgreSQL services; follow the [Railway guide](railway-deploy-zh.md) and [hosted verification checklist](../README.md#railway-verification-still-to-record). GitHub Pages uses mock mode under the default static configuration unless a hosted API URL is supplied. A loaded page or `Live API` badge alone does not establish backend readiness. Report the observed hosted status and log coverage, with its URL, tested commit, and date, separately from local acceptance.

## Health endpoints

| Check | Local URL | Meaning |
| --- | --- | --- |
| API live | `http://127.0.0.1:8000/health/live` | API responds and reports its selected database type. |
| API ready | `http://127.0.0.1:8000/health/ready` | A database query succeeds and worker heartbeat age is under 30 seconds. |
| AI live | `http://127.0.0.1:8001/health/live` | AI HTTP service responds. |
| AI ready | `http://127.0.0.1:8001/health/ready` | The model object has loaded. |

API readiness returns 503 for a missing/stale heartbeat; database errors can also prevent a successful response. It does not check AI readiness. AI readiness does not replace a prediction test. Inspect both services and a completed persisted run for end-to-end acceptance.

The worker updates its heartbeat while polling and after saving each product. Long inference can make it stale. The heartbeat is not a job lease and does not recover abandoned claims.

## Metrics

**Current status:** API/AI `/metrics`, Prometheus, and an `observability` Compose profile are **not implemented**. The template's metrics commands do not apply to this checkout.

Available signals are health responses, persisted task status, processed/expected counts, partial-result flags, timestamps, per-product `duration_ms`, and correlated backend logs. Use **View task logs** from an analysis or the dashboard's `#/logs` page. Filter by Run, Job, Request, Trace, Case, service, level, stage, or time. Event timestamps are UTC; browser diagnostics are separate from backend execution logs.

API/worker events and collected AI events are stored in the database. The AI wrapper appends application events to `.local-integration/ai-events.jsonl`; the API collects them when logs are queried. This requires the expected shared local state directory. Separate Railway containers do not share this file, so AI coverage is incomplete until a shared collector or protected event-ingestion service is implemented. Inspect the AI deployment console in the meantime.

Log `coverage` reports collected application sources, not every operating-system or library message. Queries use frozen snapshots for stable pagination/export; refresh to include newer events. No automatic retention or query-snapshot cleanup is implemented. Stop auto-refresh when finished, use focused filters, and monitor database growth. Prometheus instrumentation, alerts, and an agreed retention policy remain future work.

## Common useful commands

### Stop, restart, and inspect listeners

Pause submissions, let known work finish, and preserve required console logs before maintenance. Then stop recorded services:

```powershell
.\scripts\stop-local-demo.ps1
```

The script checks recorded process IDs/start times and relevant Python children. It does not drain jobs or manage every independently started process. Normal shutdown preserves the database and AI event file; restart using Local startup and recheck readiness. The next scripted start overwrites redirected stdout/stderr files.

To inspect occupied ports without terminating unrelated processes:

```powershell
Get-NetTCPConnection -State Listen -ErrorAction SilentlyContinue |
    Where-Object { $_.LocalPort -in 5174,8000,8001 } |
    Select-Object LocalAddress,LocalPort,OwningProcess
```

### Run tests and the local smoke check

For ordinary checks, leave `FIX_TEST_POSTGRES_URL` unset and use a fresh temporary directory:

```powershell
npm test
npm run build
New-Item -ItemType Directory -Path .local-integration -Force | Out-Null
$testTemp = Join-Path (Get-Location).Path ".local-integration/pytest-$([guid]::NewGuid().ToString('N'))"
.\.venv-model\Scripts\python.exe -m pytest ai/tests ai/integration_tests integration/tests local_backend/tests -q --basetemp=$testTemp
```

Pytest can clear its temporary directory; never use `.local-integration` itself as `--basetemp`. PostgreSQL tests use `FIX_TEST_POSTGRES_URL` and truncate workflow tables, so provide only a dedicated disposable test database. Without it, PostgreSQL-specific testing is skipped; report that distinction.

After the local stack is ready and data imported:

```powershell
node scripts/verify-local-demo.mjs
```

This targets `http://127.0.0.1:8000`, creates a real analysis and advisory review, checks reference predictions and unchanged inventory, validates local log pagination/export, and writes `.local-integration/verification.json`. It changes demo records. A polling timeout does not mark the server run failed; inspect that run before repeating. The starter's `tests/smoke` command is not available here.

### Apply migrations and seed data

API/worker startup initializes storage. PostgreSQL applies missing numbered SQL files in [local_backend/migrations](../local_backend/migrations), currently **001 and 002**, under an advisory lock and records versions in `schema_migrations`. SQLite initializes its own tables. This project does not use Alembic.

Inspect PostgreSQL versions from an authorized database client:

```sql
SELECT version, applied_at FROM schema_migrations ORDER BY version;
```

Seed observations using the virtual-environment importer command under Local startup. Switching to PostgreSQL does not copy SQLite runs, reviews, or logs. Preserve existing evidence before switching; do not edit applied migrations or their recorded versions.

### Inspect and export logs

```powershell
Get-Content -LiteralPath .local-integration/api-stderr.log -Tail 80
Get-Content -LiteralPath .local-integration/worker-stderr.log -Tail 80
Get-Content -LiteralPath .local-integration/ai-stderr.log -Tail 80
```

Also inspect matching stdout files. For a known `$runId`, with `$apiBase` set during startup:

```powershell
$encodedRun = [uri]::EscapeDataString($runId)
$logQuery = Invoke-RestMethod "$apiBase/logs?run_id=$encodedRun&limit=100"
$logQuery | Select-Object total, snapshot_id, coverage | ConvertTo-Json -Depth 5
$encodedSnapshot = [uri]::EscapeDataString($logQuery.snapshot_id)
$exportPath = Join-Path (Get-Location).Path ".local-integration/log-export-$([guid]::NewGuid().ToString('N')).ndjson"
Invoke-WebRequest -UseBasicParsing `
    -Uri "$apiBase/logs/export?run_id=$encodedRun&snapshot_id=$encodedSnapshot" `
    -OutFile $exportPath
Write-Output $exportPath
```

Export uses the same filters and `snapshot_id` and includes all matching events in that snapshot, not only the first 100. The output directory exists after local startup. Save needed evidence before a reset.

## Failure handling in Project F.I.X.

When the worker catches an AI/processing error and can persist the failure:

- The **Run and Job** become `failed`. The Run retains an error message and the worker records a correlated error event.
- PostgreSQL also stores the error in `jobs.error`. SQLite's job table has no error column; inspect the Run and logs.
- Previously committed product results remain available; the Run is `partial = true` if any were saved.
- Existing cases remain stored, but review is blocked unless the parent Run is completed and non-partial. Cases do not become `failed`, unlike the starter's case-centric example.

| Problem | Response |
| --- | --- |
| Service unavailable or readiness fails | Inspect process output, database connectivity, heartbeat, and private AI URL. API/worker must use the same database. |
| Analysis rejected with 422 | Check S001, Daily mode, cutoff date, all 20 products, and 29-day histories. Do not fabricate missing observations. |
| CSV checksum or conflict error | Verify trusted source bytes and existing records; resume with the importer without bypassing checks or overwriting conflicts. |
| Run stays queued | Confirm the worker is running against the API's database. Pending work can be claimed when it resumes. |
| Run stays processing after worker exit | Preserve IDs, counts, status, and logs; already claimed work is not automatically resumed. |
| Review rejected with 409/422 | Reload case/parent Run and check state, compatible action, required note, and quantity rules. |
| Mock data, missing assets, or CORS errors | Check runtime/API settings, base path, exact allowed origin, and HTTPS for hosted services. Rebuild after build-time setting changes. |
| AI events missing from logs | Check filters, snapshot freshness, coverage, and filesystem sharing; inspect the AI console separately. |

There is no automatic inference retry, lease expiry, cancellation endpoint, or stale-claim recovery. A hard stop or database outage can leave a task `processing/claimed`. Confirm the old worker is no longer executing, fix the cause, restore readiness, and deliberately create a new independent run if needed. Record old/new IDs together and keep the interrupted record. Do not manually mark it complete or requeue it without a safe recovery implementation.

For a submission timeout, inspect server logs using its Request ID and identify any saved Run before resubmitting. `X-Request-ID` is correlation metadata, not an idempotency guarantee; another submission can create a duplicate. Never replace failed model output with mock predictions.

For handoff, capture Git/model version, database mode, UTC time window, Run/Job/Request/Trace/Case IDs, health responses, logs, and actions already taken. Zhou coordinates dashboard/API/log integration; the relevant service owner investigates backend, model, database, or deployment faults.

## Resetting local state

**Normal restart does not require a reset.** Reset only when a fresh demo database is intended. Preserve original records first: the fresh instance will not contain previous runs, results, reviews, or log-query snapshots.

### SQLite: archive stopped state, then start fresh

Stop submissions, let known tasks finish, and run `scripts/stop-local-demo.ps1`. Confirm no independently started API, worker, or AI process still accesses the state directory. Then archive the entire directory, including any SQLite WAL files and AI events:

```powershell
$ErrorActionPreference = 'Stop'
if ($env:FIX_DATABASE_URL) { throw 'This reset procedure is for SQLite only.' }
$repoRoot = (Resolve-Path -LiteralPath '.').Path
if (-not (Test-Path -LiteralPath (Join-Path $repoRoot 'scripts/start-local-demo.ps1'))) {
    throw 'Run from the Project F.I.X. repository root.'
}
$stateDir = Join-Path $repoRoot '.local-integration'
$stateInfo = Get-Item -LiteralPath $stateDir
if ($stateInfo.Attributes -band [IO.FileAttributes]::ReparsePoint) {
    throw 'Do not reset a linked state directory with this procedure.'
}
$resolvedState = (Resolve-Path -LiteralPath $stateDir).Path
if ($resolvedState -ne [IO.Path]::GetFullPath($stateDir)) { throw 'Unexpected state path.' }
$backupRoot = [IO.Path]::GetFullPath((Join-Path (Split-Path -Parent $repoRoot) 'FIX_dashboard-backups'))
$archiveDir = Join-Path $backupRoot ((Get-Date -Format 'yyyyMMdd-HHmmss') + '-' + [guid]::NewGuid().ToString('N'))
if (-not ([IO.Path]::GetFullPath($archiveDir).StartsWith($backupRoot + '\'))) {
    throw 'Archive destination is outside the backup directory.'
}
New-Item -ItemType Directory -Path $backupRoot -Force | Out-Null
Move-Item -LiteralPath $resolvedState -Destination $archiveDir
git rev-parse HEAD | Set-Content -LiteralPath (Join-Path $archiveDir 'commit.txt') -Encoding utf8
Write-Output "Archived state: $archiveDir"
```

The unique archive is outside the repository. Keep a protected backup copy elsewhere when records matter; a same-disk archive does not protect against disk loss. Retain matching model/source artifacts and the recorded Git revision.

Repeat startup/readiness checks and the CSV import. Confirm the 20-product inventory and run a controlled analysis against the new database.

To restore, stop all users of the current state directory, archive it separately, and restore the selected backup into a clean `.local-integration` directory with matching code/model artifacts. Keep database, journal, and AI event files from the same backup together. Do not reuse archived `processes.json` as active process bookkeeping. Check SQLite integrity, readiness, and known saved results/reviews before use. In-progress claims retain the recovery limitations described above.

### PostgreSQL

For a fresh isolated demo, create a separate empty database, configure **both API and worker** with its URL, restart to apply migrations, and import observations. Preserve the old database or a verified provider/logical backup. Renaming `.local-integration` does not reset PostgreSQL; the template's `docker compose down -v --remove-orphans` command does not apply here.

Restore backups into a separate database first, verify migrations and known records, then test services in isolation. Keep tests that truncate tables away from restored evidence. There is no automatic down-migration; confirm schema compatibility before rolling back code. Record actual reset/restore outcomes and limitations in the Week 07 evidence document.
