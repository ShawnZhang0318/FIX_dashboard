# Project F.I.X. Operations Guide

**Maintained for:** MAIE 6000C · Group 5

**Code reference:** `c6ecbc4c9cb22f095abada8340bf0320ecffeae4` (`main`, inspected 2026-10-30)

This guide describes how to start, monitor, troubleshoot, stop, and recover the implemented system. Use the [root README](../README.md) for project setup and the [architecture document](architecture.md) for design and data flow. Record milestone-specific screenshots, run IDs, results, and actual test outcomes in [submissions/week07/README.md](../submissions/week07/README.md), not here. That milestone document is pending at the inspected revision.

These instructions were checked against source code. They do not certify a healthy Railway installation or a successful PostgreSQL restore. The previously demonstrated environment used local SQLite and the real model; PostgreSQL and hosted acceptance must be recorded separately.

## 1. Operating environments and service boundaries

| Environment | Operation |
| --- | --- |
| Local real-model demo | Windows scripts start the API, polling worker, private AI service, and dashboard preview. SQLite is the default database. |
| PostgreSQL integration | API and worker use the same `FIX_DATABASE_URL`; versioned SQL migrations run at startup. Existing SQLite records are not copied automatically. |
| GitHub Pages | Hosts the static dashboard. Under the current configuration it uses labelled mock data and does not run Python, a worker, or a database. |
| Railway | Separate frontend, API, worker, AI, and PostgreSQL services must be configured. Repository Dockerfiles are deployment inputs, not deployment evidence. |

| Local component | Address or execution model | Operational check |
| --- | --- | --- |
| Dashboard | `http://127.0.0.1:5174/FIX_dashboard/` with the base-path setting below | Page loads; an actual API request succeeds. |
| Public API | `http://127.0.0.1:8000` | `/health/live`, `/health/ready` |
| Private AI | `http://127.0.0.1:8001` | `/health/live`, `/health/ready` |
| Worker | Separate Python process; no HTTP port | Heartbeat, job transitions, and worker logs |
| SQLite | `.local-integration/fix.sqlite3` by default | Readiness query and persisted record retrieval |

The following local commands use **PowerShell from the repository root**. Application timestamps are UTC; a snapshot date is a business date, not a timestamp. Include the timezone when collecting incident evidence.

## 2. Configuration

| Setting | Consumer | Meaning |
| --- | --- | --- |
| `FIX_DATABASE_URL` | API and worker | Unset selects SQLite. A `postgresql://` or `postgres://` URL selects PostgreSQL; a failed connection does not fall back to SQLite. |
| `FIX_AI_URL` | Worker | Private AI base URL; default `http://127.0.0.1:8001`. |
| `FIX_ALLOWED_ORIGINS` | API | Comma-separated exact browser origins, including scheme and port where applicable. Defaults allow localhost/127.0.0.1 on ports 5173 and 5174. |
| `FIX_LOCAL_STATE` | API, worker, and AI wrapper | Directory for local state. The Windows startup script sets it to the repository's `.local-integration` directory. |
| `VITE_BASE_PATH` | Frontend build | `/FIX_dashboard/` for the local instructions below and GitHub Pages; `/` for a site served at a domain root. |
| `VITE_FIX_API_URL` | Hosted frontend build | Public API URL embedded at build time. Rebuild after changing it. Loopback integration settings take precedence. |
| `PORT` | API/AI Docker startup | Container listener port; Dockerfile defaults are 8000 and 8001 respectively. |
| `FIX_TEST_POSTGRES_URL` | Backend tests only | Dedicated disposable PostgreSQL test database. Tests truncate workflow tables in this database. |

Browser runtime settings are in [public/runtime-config.js](../public/runtime-config.js). Database credentials and internal secrets belong only in backend service environments. CORS is not authentication: the current API has no implemented login/access-control layer, and `reviewer_label` is an unverified label. Restrict hosted access to the intended demonstration audience using deployment-level controls until application access control is implemented.

The local UI still contains SQLite-specific wording even when the backend is configured for PostgreSQL. Confirm the database using the API's `/health/live` response, not the UI label. Likewise, a `Live API` badge indicates configuration, not service health.

## 3. Start and stop the local system

### 3.1 Prepare the checkout

Follow the [README prerequisites and installation](../README.md#quick-start-local-model-demo-on-windows): install Node/npm, create `.venv-model` using Python 3.12, and install `ai/requirements-dev.txt`. Use the intended commit and record it with:

```powershell
git rev-parse HEAD
git status --short
```

For the SQLite workflow, ensure `FIX_DATABASE_URL` is unset in this shell. For PostgreSQL, use section 7 before starting. Do not update code or replace model artifacts during an active analysis; each run freezes its model and input references.

### 3.2 Launch

```powershell
$env:VITE_BASE_PATH = '/FIX_dashboard/'
.\scripts\start-local-demo.ps1
```

The script builds the frontend, checks for previously recorded processes and occupied ports, and starts hidden processes with console output redirected to `.local-integration/`. It records process IDs and start times in `processes.json`. A launch message means processes were started; readiness must still be checked.

If a frontend is already running independently on an allowed port, use `start-local-demo.ps1 -BackendOnly`. Keep the independent frontend's base path and URL consistent. The stop script manages only processes recorded by the startup script.

```powershell
$apiBase = 'http://127.0.0.1:8000'
Invoke-RestMethod "$apiBase/health/live"
Invoke-RestMethod 'http://127.0.0.1:8001/health/ready'
Invoke-RestMethod "$apiBase/health/ready"
```

Wait for both readiness endpoints to return HTTP 200 before importing or submitting work. Inspect startup logs if they do not become ready; do not repeatedly launch additional copies.

### 3.3 Import or resume verified data

```powershell
.\.venv-model\Scripts\python.exe -m local_backend.import_csv
```

The importer checks the source CSV hash, selects 14,620 S001 observations, and submits batches of up to 100 records through the API. It verifies and skips identical existing observations, so an interrupted import can be resumed. It rejects mismatched records rather than overwriting them. Atomicity applies to each batch, not to the whole CSV.

After the import completes:

```powershell
@(Invoke-RestMethod "$apiBase/inventory?store_id=S001").Count
@(Invoke-RestMethod "$apiBase/snapshots?store_id=S001&from=2023-11-15&to=2023-11-15").Count
```

For the supplied dataset, both counts should be **20**. Keep the import summary; do not substitute fabricated rows to make a demonstration pass.

### 3.4 Operate an analysis

Open [the local analysis page](http://127.0.0.1:5174/FIX_dashboard/#/analysis), choose **2023-11-15**, and submit one Daily analysis. Save its Run ID and Job ID. The supported input is S001 with a complete cutoff-day roster and 29 consecutive days of history for each selected product. Dates earlier than 2023-09-01, unsupported stores, and Monthly requests are rejected.

For an API smoke check instead of using the page, the following creates **one real persisted task**. Do not run it as a harmless health probe:

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

Expect HTTP **202** with queued Run and pending Job identifiers. If the request fails or times out, investigate its Request ID before submitting again; failure to receive a response does not establish that the write failed.

Query the returned run, or set `$runId` to an ID copied from the dashboard:

```powershell
Invoke-RestMethod "$apiBase/analysis-runs/$runId" | ConvertTo-Json -Depth 6
Invoke-RestMethod "$apiBase/analysis-runs/$runId/results" | ConvertTo-Json -Depth 10
```

The expected pairs are `queued/pending`, `processing/claimed`, and then `completed/completed` or `failed/failed`. Only a completed, non-partial run permits case review. An approved/modified/rejected/resolved case is a saved advisory decision; inventory and purchase orders are unaffected.

### 3.5 Planned shutdown and restart

Ask users to stop submitting work and let known queued/processing runs finish before maintenance. Preserve required console logs before the next start, which overwrites the redirected console files.

```powershell
.\scripts\stop-local-demo.ps1
```

The script checks recorded process IDs and start times before stopping them and relevant Python service children. It retains database records and the append-only AI application event file. It **does not drain jobs**. Stopping a worker during execution can leave a durable `claimed/processing` task.

Restart with section 3.2, recheck readiness, and retrieve a previously recorded run and review. Re-importing is unnecessary when the same database already contains the verified observations.

## 4. Monitoring and health interpretation

| Signal | What it establishes | What it does not establish |
| --- | --- | --- |
| API `/health/live` | API responds; reports selected database type | Current DB availability or AI readiness |
| API `/health/ready` | A DB query succeeds and worker heartbeat age is under 30 seconds | End-to-end model execution or recovery of a particular task |
| AI `/health/ready` | Model object loaded in the AI service | A successful prediction for every valid input |
| Run status and counts | Persisted processing progress and outcome | Completion of human review |
| Log `coverage` | Reported application-event collection sources | AI process liveness or collection of every OS/library message |

The worker updates its heartbeat while polling and after saving each product. A long or stalled inference can make it stale; a missing heartbeat warrants investigation, not an automatic conclusion that a process is dead. The heartbeat is not a job lease and does not recover abandoned claims.

There is currently **no implemented `/metrics` endpoint**, automated alerting, or measured availability target. Use health responses, saved run states/counts, timestamps, per-product durations, and correlated logs as current operational signals. Do not describe planned metrics as already available.

## 5. Logs, diagnosis, and export

### 5.1 Log sources

| Location | Contents and lifetime |
| --- | --- |
| Database `logs` | API/worker events and collected AI events; retained across normal restarts |
| Database `log_queries` | Full frozen query results used for stable pagination/export |
| `.local-integration/ai-events.jsonl` | AI wrapper's actual application events; appended locally and imported when logs are queried |
| `.local-integration/*-stdout.log`, `*-stderr.log` | Per-process console output; overwritten by a subsequent scripted start |
| Browser diagnostics tab | Browser request/interaction observations; not backend execution evidence |

Open `#/logs` or choose **View task logs** from an analysis. Filter by Run/Job/Case/Request/Trace ID, service, level, stage, time, or keyword. Expand events to inspect context and error stacks. Before a Run exists, the creation request's Request ID can locate the initial API events.

To read recent local console output:

```powershell
Get-Content -LiteralPath .local-integration/api-stderr.log -Tail 80
Get-Content -LiteralPath .local-integration/worker-stderr.log -Tail 80
Get-Content -LiteralPath .local-integration/ai-stderr.log -Tail 80
```

Check matching stdout files as well; severity and output stream are not equivalent. For hosted services, use that service's deployment console when dashboard collection is missing.

### 5.2 Stable query and complete export

The first `/logs` request creates a frozen query snapshot. Later pages and export must use its `snapshot_id` and the same filters. Refreshing creates a new snapshot; it does not append to the old one. `sequence` is collection order, while `timestamp` retains the original event time.

With `$apiBase` and `$runId` set as above:

```powershell
$encodedRun = [uri]::EscapeDataString($runId)
$logQuery = Invoke-RestMethod "$apiBase/logs?run_id=$encodedRun&limit=100"
$logQuery | Select-Object total, snapshot_id, next_cursor, coverage | ConvertTo-Json -Depth 5
$encodedSnapshot = [uri]::EscapeDataString($logQuery.snapshot_id)
$exportPath = Join-Path (Get-Location).Path ".local-integration/log-export-$([guid]::NewGuid().ToString('N')).ndjson"
Invoke-WebRequest -UseBasicParsing `
    -Uri "$apiBase/logs/export?run_id=$encodedRun&snapshot_id=$encodedSnapshot" `
    -OutFile $exportPath
Write-Output $exportPath
```

The export includes all matching records in that snapshot, not just the first 100. These commands assume the local state directory exists after startup. Use the UI export for a remote-only operator, or choose an existing local download directory.

AI, API, and worker must share the expected local state directory for file-based AI collection. In separate Railway containers, the API cannot read the AI container's file: AI coverage remains incomplete until a shared collector or protected event-ingestion service is implemented. Do not treat successful forecasting as proof of complete log collection.

No automatic log retention or query-snapshot cleanup is implemented. Repeated broad queries and five-second auto-refresh can grow stored query payloads. Disable auto-refresh when finished, use focused filters, monitor database/disk growth, and arrange an agreed retention policy before sustained operation. Do not delete business or audit records merely to clear the display.

## 6. Troubleshooting and task recovery

| Symptom | Checks and response |
| --- | --- |
| Cannot reach port 5174 | Confirm the preview process started and the build succeeded. Read dashboard console files; check the listener. |
| Blank page or missing assets | Confirm `VITE_BASE_PATH`, the URL subpath, and availability of `runtime-config.js`. Rebuild after build-time configuration changes. |
| Startup reports an occupied port or existing demo | Inspect the owner. Stop this project's recorded services using its stop script; do not terminate an unrelated process. |
| API readiness returns 503 | Check worker process/output, heartbeat freshness, database configuration agreement, and current inference activity. Check AI separately. |
| API startup/database connection fails | Check connectivity, backend-only credentials, supported URL scheme, migration output, and schema revision. There is no SQLite fallback after selecting PostgreSQL. |
| Browser CORS or mixed-content error | Set the exact frontend HTTPS origin in API `FIX_ALLOWED_ORIGINS` and use HTTPS for a hosted public API. Rebuild if changing `VITE_FIX_API_URL`. |
| Page remains in mock mode | Confirm hosted API build/runtime configuration. GitHub Pages defaults to mock; inspect an actual network request before claiming live integration. |
| CSV checksum mismatch | Verify checkout/artifact provenance and Git line-ending handling. Restore the correct trusted source bytes; do not bypass or edit the expected checksum. |
| Import fails with a duplicate/conflict | Use the supplied importer to verify and resume identical data. A direct duplicate batch returns 409 and rolls back that batch; earlier committed batches remain. Investigate differing source records rather than overwriting them. |
| Analysis returns 422 | Check S001/Daily, cutoff on or after 2023-09-01, all 20 cutoff snapshots, and continuous 29-day histories. Do not fabricate missing days as zero sales. |
| Run stays queued | Check worker availability and whether API/worker point to the same database. Pending work is eligible for claim when the worker resumes. |
| Run stays processing | Inspect the specific run/job, worker activity, private AI connectivity, and logs. Follow the recovery procedure below. |
| Run failed with partial results | Inspect the first relevant error; preserve committed outputs. Failed-run cases are intentionally not reviewable. |
| Review returns 409/422 | Re-read the case and parent run. Confirm pending review, completed/non-partial run, compatible action, required note, and quantity rules. Do not repeatedly resubmit. |
| Logs are empty or coverage is partial | Check filters/timezone, refresh the query snapshot, inspect each source, and consider container filesystem isolation. Empty logs do not prove that no execution occurred. |
| Model load or inference fails | Inspect AI readiness, pinned dependencies, trusted artifact checksums and version compatibility. Fix the cause; never replace a failed prediction with mock output. |

Listener inspection is read-only:

```powershell
Get-NetTCPConnection -State Listen -ErrorAction SilentlyContinue |
    Where-Object { $_.LocalPort -in 5174,8000,8001 } |
    Select-Object LocalAddress,LocalPort,OwningProcess
```

**Uncertain submissions:** Save the Request ID, inspect correlated server logs, and retrieve any identified Run/Case before deciding on another write. The current API has neither a dedicated run-history endpoint nor an idempotent-create/recovery endpoint. Operator inspection may be necessary; a Request ID is correlation metadata, not a deduplication guarantee.

**Interrupted worker:** Capture run/job IDs, status, processed count, and logs. Confirm the original worker is no longer executing the affected work before replacing processes. Fix the dependency problem and restore service readiness. Previously completed/failed records remain queryable, and pending jobs can be claimed; already claimed jobs are not automatically resumed. If needed, deliberately create a new independent run and record its relationship to the interrupted one in the incident note. Keep the original record and reviews. Do not change database statuses to pretend completion or manually requeue a claim without a safe recovery implementation.

No automatic bounded inference retry, lease expiry, cancellation endpoint, or stale-claim recovery is currently implemented. Repeated independent runs can produce repeated cases; cross-run alert suppression is not implemented either.

## 7. PostgreSQL and Railway operation

### 7.1 PostgreSQL selection and migrations

Create the intended database and supply `FIX_DATABASE_URL` securely to **both API and worker** before startup. Stop the old processes first; changing a variable in a shell does not reconfigure a running process. Confirm `/health/live` reports PostgreSQL and `/health/ready` succeeds.

Startup applies missing numbered SQL files under [local_backend/migrations](../local_backend/migrations), currently **001 and 002**, and records versions in `schema_migrations`. An advisory lock serializes migration application. This implementation uses direct SQL migrations, not Alembic. Do not edit already applied migrations or manually change their recorded versions.

From an authorized database client, a read-only check is:

```sql
SELECT version, applied_at FROM schema_migrations ORDER BY version;
```

A new PostgreSQL database is empty. Re-import the source observations through the API; this does not migrate SQLite runs, reviews, or logs. Preserve any SQLite milestone evidence before switching. The `transactions` table has no supplied per-transaction input source; do not generate transaction records from daily summaries just to populate it.

### 7.2 Hosted services

Use the [Railway deployment guide](railway-deploy-zh.md) for service creation and reference-variable syntax. Configure:

| Service | Deployment/configuration |
| --- | --- |
| API | `deploy/Dockerfile.api`; PostgreSQL URL; allowed frontend origin; public HTTPS endpoint |
| Worker | `deploy/Dockerfile.worker`; same PostgreSQL URL; `FIX_AI_URL` pointing to private AI host/port |
| AI | `deploy/Dockerfile.ai`; private networking; `PORT=8001` for the documented worker URL |
| Frontend | Build with `VITE_BASE_PATH=/` and `VITE_FIX_API_URL` set to the public API URL; redeploy after changes |

The backend images use Python 3.13 and Railway requirements. Validate model loading and regression output in that environment; prior Python 3.12 local success does not replace that check. No Docker Compose file is supplied.

Initialize PostgreSQL, start AI, and start API/worker with matching configuration. The API may report not ready until the worker updates its heartbeat. Check AI readiness from a service with private-network access; do not expose AI publicly just to make that check convenient. Import through the public API using the importer's `--api` option, then verify one complete analysis and review through the hosted dashboard.

Capture service revisions, migration versions, health responses, task IDs, saved results/review and actual log coverage. Hosted setup is accepted only after these checks; full AI log coverage requires the collection change described in section 5.

## 8. Persistence, backup, and restore

### 8.1 What must be retained

Retain the database, model/feature/policy artifacts matching saved runs, source data/metadata, and any AI event file not fully collected into the database. Record the Git SHA, migration revision, database mode, and backup time. Credentials must be handled separately from shared evidence files.

SQLite uses WAL. Do not copy only a live `fix.sqlite3` file and assume it is a consistent backup. Use an offline state-directory copy as below, or a separately validated SQLite backup procedure.

### 8.2 Offline local backup

First drain known work, stop this project's services, and verify no independently started process still accesses the state directory. This procedure is for the default local SQLite layout; it does not back up a PostgreSQL database.

```powershell
$backupRoot = Join-Path (Split-Path -Parent (Get-Location).Path) 'FIX_dashboard-backups'
$backupDir = Join-Path $backupRoot ((Get-Date -Format 'yyyyMMdd-HHmmss') + '-' + [guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $backupDir | Out-Null
Copy-Item -LiteralPath .local-integration -Destination $backupDir -Recurse
git rev-parse HEAD | Set-Content -LiteralPath (Join-Path $backupDir 'commit.txt') -Encoding utf8
Write-Output $backupDir
```

The destination is outside the repository, and includes any remaining WAL files together with the AI event file and collector-related database state. Keep a separate protected copy on an approved backup location; a folder on the same disk alone does not protect against disk loss.

For restoration, preserve the current stopped state as a separate backup first. Restore the selected database and associated journal/event files into a **clean state directory**, with matching code and model artifacts; do not mix files from different backups or retain unrelated WAL files. Old `processes.json` is process bookkeeping, not recoverable service state; do not reuse it as an active process record. The startup script always uses the repository's `.local-integration`, so a custom restore directory requires separately configured service launch commands.

Before returning to use, run an integrity check on the restored SQLite database, start the matching services, verify health, and retrieve previously known task/results/review IDs. Re-export a known log query and check coverage. If a backup contains an in-progress claim, the recovery limitations in section 6 still apply.

### 8.3 PostgreSQL backup and restoration

Use an authorized provider backup or a consistent logical database backup, and retain matching model/source artifacts and any uncollected AI logs separately. Agree the backup schedule and acceptable data-loss/recovery window with the database owner; these targets have not been established by this implementation.

Restore first into a separate database. Verify migration versions and relational constraints, compare retained task/result/review records, then test API/worker against that restored database in an isolated environment. Do not point tests that truncate tables at the restored evidence database. Switch the intended API and worker together only after verification. Preserve the previous database until the team accepts the recovery.

## 9. Verification, upgrades, and rollback

### 9.1 Automated checks

For ordinary local checks, ensure `FIX_TEST_POSTGRES_URL` is unset. Use a fresh dedicated pytest directory:

```powershell
npm test
npm run build
New-Item -ItemType Directory -Path .local-integration -Force | Out-Null
$testTemp = Join-Path (Get-Location).Path ".local-integration/pytest-$([guid]::NewGuid().ToString('N'))"
.\.venv-model\Scripts\python.exe -m pytest ai/tests ai/integration_tests integration/tests local_backend/tests -q --basetemp=$testTemp
```

Pytest may clear its designated temporary directory. Never set `--basetemp` to `.local-integration` itself or to a directory containing records to preserve. PostgreSQL tests require `FIX_TEST_POSTGRES_URL` pointing to a dedicated disposable test database and intentionally truncate its workflow tables. Without it, the PostgreSQL-specific test is skipped; record that distinction in evidence.

After the local real stack is ready and data is imported:

```powershell
node scripts/verify-local-demo.mjs
```

This script targets `http://127.0.0.1:8000`, creates a real analysis and an advisory test review, checks the reference predictions, unchanged inventory, and complete local log pagination/export, and writes `.local-integration/verification.json`. It is not a read-only health check or a hosted acceptance script. A timeout in its polling window does not itself mark the server's run failed; inspect the recorded run before another execution.

### 9.2 Upgrade and rollback procedure

1. Record the current Git SHA, model version, database type and migration versions. Preserve needed logs and take a verified backup.
2. Pause submissions and let known work reach terminal states. Stop the services; do not hot-swap model artifacts used by active runs.
3. Deploy the reviewed code/artifacts and matching dependencies. Keep API and worker on compatible revisions and the same database.
4. Check migrations, readiness, a controlled analysis/review, prior-record retrieval, and declared log coverage before normal use.
5. If acceptance fails, preserve failure evidence. Revert the frontend independently only when its API contract remains compatible. For backend rollback, verify schema compatibility first; an older revision may reject newer migration versions. There is no implemented automatic down-migration. Use a tested restore into a separate database when required rather than dropping tables or changing migration history.

## 10. Incident handoff and milestone evidence

Include the following when asking another team member to investigate:

- Environment, Git SHA, model version, database type, and migration revision.
- UTC time window, operation performed, expected behavior, actual response/status, and whether a write outcome is uncertain.
- Run, Job, Request, Trace and Case IDs when available.
- Health responses, processed/expected counts, partial-result flag, and relevant application/console logs.
- Actions already taken, affected persisted records, and the next proposed recovery action.

Zhou coordinates dashboard/API/log-display integration; Zhang handles inventory and review interfaces. Backend, database, model, and deployment owners investigate their respective services. Record the responsible operator for each incident rather than treating coordination as ownership of every backend component.

For Week 07, select necessary screenshots and sanitized log excerpts for `submissions/week07/assets/`, and explain the demonstrated path and reproduction steps in its README. Keep the source of each artifact, environment, actual IDs, and limitations explicit. Never substitute mock screenshots for live persistence/model evidence or claim a hosted/PostgreSQL test that was not run.
