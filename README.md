# Project F.I.X. — Forecasting & Inventory Exceptions

**MAIE 6000C · Group 5**

Project F.I.X. helps inventory planners turn daily retail observations into demand forecasts, replenishment recommendations, and reviewable exceptions. The dashboard provides English and Simplified Chinese interfaces for inventory, analysis, forecast results, human review, and backend execution logs.

The current scope is one store, **S001**, and its 20 products. The system uses the supplied retail inventory dataset, with recorded sales as the demand proxy and simulated supplier lead times. The dataset's `Demand Forecast` column is retained as an offline reference and is excluded from model inputs.

Recommendations are advisory: approving a case records a planner's decision; it does not place a purchase order or change inventory. Current inventory is updated from newly accepted daily observations.

## Currently works: local integration

**The documented local demo uses real backend services and a trained model.** Running locally describes where the services run; it does not mean the API is mocked. With the startup instructions below, the dashboard calls FastAPI, a separate worker calls the LightGBM service, and SQLite stores the workflow records by default. A separate mock mode remains available for interface demonstrations.

- Import daily snapshots through the public API and retain their source references.
- Submit a Daily analysis request and follow its persisted Run and Job states.
- Run the versioned LightGBM model asynchronously through a separate worker.
- View cumulative lead-time P50/P90 forecasts, replenishment quantities, and result provenance.
- Review replenishment and unusual-demand cases, including combined cases.
- Query backend application logs by task, request, service, and time, and export matching records.

The [recorded local acceptance](docs/local-integration-zh.md#本次验证证据) includes a real-model run on **2026-10-20** with **20/20 saved product results**, a persisted approval, unchanged inventory after review, and **175 correlated API/worker/AI log events** checked through pagination and export. These are historical local results, not a new test of today's checkout or a Railway/PostgreSQL acceptance result. Reproduce the flow against the Week 07 checkpoint and record that evidence in its milestone document.

The dashboard communicates with the public API. The worker calls the private AI service and saves results for subsequent retrieval. Detailed component boundaries and data flow belong in the architecture document linked below.

## Documentation

Each required document has a separate purpose; this README is the project entry point and setup guide.

| Document | Purpose |
| --- | --- |
| [System architecture](docs/architecture.md) | Components, architecture diagrams, data flow, and design decisions. |
| [Operations guide](docs/operations.md) | Running, monitoring, troubleshooting, and operating the system. |
| [Week 07 milestone](submissions/week07/README.md) | Demonstrated system path, milestone evidence, current status, remaining work, risks, and reproduction instructions. |

Existing supporting documentation:

- [Local integration and startup guide — Chinese](docs/local-integration-zh.md)
- [Railway deployment guide — Chinese](docs/railway-deploy-zh.md)
- [Public API contract](docs/frontend-api-contract.md) and [backend logs contract](docs/backend-logs-contract.md)
- [AI model documentation](ai/README.md)
- [Original Week 04 architecture reference](docs/w04-reference/docs/architecture.md)

## Technology overview

| Layer | Implementation |
| --- | --- |
| Dashboard | React, Vite, and hash-based routing |
| Public API | Python and FastAPI |
| Background processing | Separate polling worker |
| Forecasting | LightGBM quantile model, `s001-global-q-v1` |
| Persistence | SQLite by default; PostgreSQL adapter and versioned SQL migrations available |
| Deployment | GitHub Pages for the static frontend; Dockerfiles and Railway configuration guidance for backend services |

## Quick start: local model demo on Windows

### Prerequisites

- Git.
- Node.js 22.12 or newer in the Node 22 release line, with npm.
- Python 3.12 and the Windows Python launcher (`py`). Python 3.12.10 was used for the local integration checks.
- Windows PowerShell, with ports **5174**, **8000**, and **8001** available.

The following commands start the real local stack and use the default SQLite database. Leave `FIX_DATABASE_URL` unset for this setup. The API, worker, and AI service must all be running; opening only the frontend does not start them. The supplied start/stop scripts are Windows-specific; hosted deployment is documented separately.

**Week 07 demonstration baseline:** use `http://127.0.0.1:5174/FIX_dashboard/`, store **S001**, and analysis date **2023-11-15**, matching the presentation and recorded local results. The public API is on port **8000** and the private AI service on **8001**. Alternate addresses or ports from an individual test session require their own configuration notes; they do not replace this standard startup procedure. Validate input coverage and saved results before using a different demonstration date.

### 1. Get the repository and install dependencies

```powershell
git clone https://github.com/ShawnZhang0318/FIX_dashboard.git
cd FIX_dashboard
npm ci
py -3.12 -m venv .venv-model
.\.venv-model\Scripts\python.exe -m pip install -r ai/requirements-dev.txt
```

The repository includes the model artifacts and source CSV required for the demo. Keep their original bytes intact because the importer and model loader verify checksums.

### 2. Start the services

```powershell
$env:VITE_BASE_PATH = '/FIX_dashboard/'
.\scripts\start-local-demo.ps1
```

Setting the base path keeps the local preview URL consistent with the startup script. The script builds the dashboard and starts the public API, private AI service, worker, and frontend preview.

Confirm readiness before importing data:

```powershell
Invoke-RestMethod http://127.0.0.1:8001/health/ready
Invoke-RestMethod http://127.0.0.1:8000/health/ready
```

Both requests should succeed. The API readiness check also requires a current worker heartbeat. If a service is still starting, wait and repeat the checks; a process launch message alone does not confirm readiness.

### 3. Import the data

```powershell
.\.venv-model\Scripts\python.exe -m local_backend.import_csv
```

The importer sends **14,620 S001 observations** through the public API in bounded batches. Re-running it verifies and skips identical existing observations; conflicting records are rejected rather than overwritten.

### 4. Open the dashboard

Open [the local analysis page](http://127.0.0.1:5174/FIX_dashboard/#/analysis), select **2023-11-15**, and choose **Run Daily Analysis**. Follow the task status, inspect saved predictions, open an exception, and record a review. Use **View task logs** to inspect the associated backend events.

The model requires 29 consecutive daily observations for each selected product and an analysis cutoff on or after **2023-09-01**. Monthly analysis is not currently implemented.

By default, business records and collected application logs persist in `.local-integration/fix.sqlite3`. Stopping and restarting the services preserves them. Runtime data and local environments are excluded from Git.

### 5. Stop or restart

```powershell
.\scripts\stop-local-demo.ps1
```

To restart, repeat step 2 in the project directory. Do not start a second copy while the recorded services are running. Data import is only needed for a new database or missing source records.

## Local, hosted, and mock modes

| Mode | Data and processing | Verification status |
| --- | --- | --- |
| Local real-model integration | Actual HTTP API, separate worker, trained LightGBM model, and SQLite persistence by default | Historical local acceptance is recorded above. Re-run against the checkpoint revision for milestone evidence. |
| Mock interface demo / default static preview | Synthetic fixtures and browser storage; no model inference or server database | Useful for interface/workflow previews; not backend integration evidence. |
| Railway online fallback / hosted integration | Intended hosted path: frontend to public API, shared PostgreSQL for API/worker, and worker to private AI | Listed as an online fallback in the milestone. Cloud acceptance is partial; deployment availability does not establish a verified end-to-end hosted workflow. |

The [GitHub Pages preview](https://shawnzhang0318.github.io/FIX_dashboard/) uses mock mode with the repository's default static configuration unless a hosted API URL is supplied. GitHub Pages itself hosts no Python services or database.

The integrated dashboard's [runtime configuration](public/runtime-config.js) selects `live` mode and `http://127.0.0.1:8000` when opened on `127.0.0.1` or `localhost`. If that API is unavailable, requests fail; the app does not automatically substitute mock predictions. For a hosted frontend, set `VITE_FIX_API_URL` at build time or configure a hosted public API URL in the runtime settings. A `Live API` badge indicates the selected mode, not successful service execution.

Backend settings such as `FIX_DATABASE_URL`, `FIX_AI_URL`, and `FIX_ALLOWED_ORIGINS` belong in the relevant service environments; database credentials must never be placed in browser configuration.

### Railway fallback and partial cloud acceptance

The team lists [the Railway site](https://fixdashboard-production.up.railway.app/) as an **online fallback** in the milestone document. Report **partial cloud acceptance**: the existence of a deployed frontend or URL does not confirm that PostgreSQL persistence, worker execution, model inference, review retrieval, and log collection all passed together. A fallback showing mock data is evidence of the interface only. This documentation review did not perform a new hosted acceptance run.

Follow the [Railway guide](docs/railway-deploy-zh.md) and record the tested Git SHA, test date, service configuration, and evidence of:

- API and AI readiness, with a current worker heartbeat.
- An accepted request creating persisted Run/Job records in PostgreSQL.
- The worker completing real inference and saving results.
- A saved review that can be retrieved again, without changing inventory.
- Correlated execution logs and the actual coverage of each service.

The current file-based AI log collector does not span separate Railway service filesystems. Report that coverage gap until a shared collection mechanism is implemented and verified. Add hosted results to `submissions/week07/README.md` and update this summary after acceptance; preserve local reproduction instructions as a separate way to run the project.

## Repository guide

| Location | Contents |
| --- | --- |
| `src/` | Integrated React pages, components, routing, and translations |
| `frontend/` | Shared API adapters, request/response validation, browser diagnostics, and tests; also contains the older standalone demo |
| `local_backend/` | Public API, persistence adapters, worker, application logging, and database migrations |
| `integration/` | Worker-to-model client and its tests |
| `ai/` | Model service, feature preparation, versioned artifacts, evaluation reports, and tests |
| `data/` | Original and processed data, with provenance metadata |
| `scripts/` | Local startup, shutdown, and end-to-end verification helpers |
| `deploy/` | Dockerfiles for API, worker, and AI services |
| `docs/` | Design, interface, deployment, and operational documentation |
| `submissions/week07/` | Existing Week 07 milestone README and evidence index; screenshot and slide links still need finalization |

## Development checks

Run the frontend checks from the repository root:

```powershell
npm test
npm run build
```

Python tests are located in `ai/tests/`, `ai/integration_tests/`, `integration/tests/`, and `local_backend/tests/`. The [local integration guide](docs/local-integration-zh.md) describes their execution and the dedicated database requirement for PostgreSQL tests. Run tests against disposable test storage, not shared demonstration or production data.

Use `src/` for the integrated team dashboard; the standalone HTML demo under `frontend/` is retained as a reference. See the [Week 07 milestone document](submissions/week07/README.md) for checkpoint evidence. Use the standard address, ports, and date in this quick start for reproduction, and align the milestone's demo sequence with these settings before submission.
