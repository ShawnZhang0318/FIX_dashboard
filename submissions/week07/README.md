# Week 7 Submission — Midterm Milestone Demo

## Team Information

- Team name: Group 5
- Repository: https://github.com/ShawnZhang0318/FIX_dashboard
- Checkpoint tag: `w07-midterm`
- Team members:
  - CAO, Jun 21342592
  - SHAH, Pooja Zenit 21320776
  - ZHANG, Yitong 21340295
  - ZHOU, Guanxu 21313412

## 1. What Currently Works

The local demo implements an end-to-end advisory workflow for store S001 and its 20 products. The CSV importer verifies the source file and submits 14620 S001 observations through the public API. The API persists snapshots and current inventory, creates durable analysis Runs and Jobs, and serves saved results and review cases. A separate worker calls the private LightGBM service and persists forecasts and exceptions.

The dashboard provides Inventory, Analysis, Exceptions, snapshot transfer, and backend log pages in English and Simplified Chinese. A planner can inspect forecasts and provenance, record a review decision, and retrieve that decision later. Reviewing a case does not update inventory or place a purchase order.

The model forecasts cumulative realized sales over each product's simulated supplier lead time. `Demand Forecast` from the source CSV is excluded from model inputs. 

## 2. Live Demo Sequence

The current local demo is available at:
- [Analysis page](http://127.0.0.1:5174/#/analysis)
- [Inventory page](http://127.0.0.1:5174/#/inventory)

**Online fallback:** If the local demo cannot be started or accessed, view the version deployed on our server at [fixdashboard-production.up.railway.app](https://fixdashboard-production.up.railway.app/).

1. Open Inventory and show the 20 S001 products loaded from the local SQLite database.
2. Open Analysis, select `2023-11-15`, and choose **Run Daily Analysis**.
3. Follow the saved Run and Job status until the analysis completes. Inspect the forecast results, cutoff snapshots, model version, and input references.
4. Open an exception case, submit a review, and reload the case to confirm the decision was saved.
5. Confirm that inventory is unchanged after the review.
6. Open the task logs and filter by Run ID or Job ID to inspect API, worker, and AI events.

## 3. Current Implementation Status

### Implemented

- Integrated React dashboard with English and Simplified Chinese interfaces.
- Public API for daily snapshot ingestion, inventory and snapshot queries, analysis Runs, saved results, exception review, and backend logs.
- CSV importer with source-hash verification and bounded batches; identical rows can be skipped on re-import, while conflicting rows are rejected.
- SQLite persistence for snapshots, current inventory, Runs, Jobs, results, cases, reviews, and application logs.
- Separate polling worker that claims persisted jobs, calls the AI service, validates responses, and saves results and optional cases.
- Versioned `s001-global-q-v1` LightGBM quantile model with checksum verification.
- Versioned worker-side replenishment and unusual-demand rules. The AI model provides forecasts; it is not an anomaly model.
- Backend log filters, stable pagination, and NDJSON export.
- Local start and stop scripts, plus a live-flow verification helper.

### Partially Implemented

- A PostgreSQL adapter and numbered SQL migrations are present, but the demonstrated local workflow uses SQLite. PostgreSQL deployment and acceptance are separate work.
- Local AI application logs can be collected from the shared local filesystem. Collection from separate hosted service filesystems requires a shared logging mechanism.
- Health endpoints, worker heartbeat, persisted run state, and correlated logs are available. There is no metrics endpoint, automated alerting, or measured availability target.

### Not Yet Implemented

- Monthly analysis and multi-store analysis.
- Authentication, authorization, and verified reviewer identity.
- Automatic job retries and safe recovery of jobs left claimed after a worker interruption.
- Automatic purchasing, scheduled analysis, transaction ingestion, ERP integration, and cross-store optimization.
- Production log retention, backup, and recovery policies.

## 4. Architecture Status

The Week 4 proposal centered on PostgreSQL, SQLAlchemy, Alembic, and a later Monthly workflow. The current implementation delivers the local Daily vertical slice with a public FastAPI API, SQLite persistence, a polling worker, a private FastAPI model service, and the React dashboard.

The database is the durable job queue; Redis and Celery are not used. The API validates snapshot coverage, freezes input references and model/policy versions, and commits a queued Run and pending Job. The worker claims work before making the model request, validates the response, applies inventory rules, and persists results. The dashboard reads saved results through the public API.

The current local database defaults to `.local-integration/fix.sqlite3`. PostgreSQL support uses a direct SQL adapter and numbered SQL migrations. The local pipeline supports only manually triggered Daily analysis for S001. Lead times are simulated and fixed by the model catalog.

## 5. Current Evidence of Integration

- **Database write path:** The importer verified the source CSV and reported `14620` verified rows and `14620` inserted rows. The inventory API returns 20 S001 products.
- **API path:** The dashboard's live adapter calls the public API. In the current session, the API is running on `http://127.0.0.1:8002`; a browser-origin request from `http://127.0.0.1:5174` returned HTTP 200 with the configured CORS origin.
- **Worker path:** API readiness reports the database available and worker available.
- **AI path:** The private AI service on port `8001` reports readiness `ok` with the versioned model loaded.
- **Dashboard path:** The local Vite preview returned HTTP 200 at `http://127.0.0.1:5174/`.
- **Persistence and logs:** Local business records are stored in `.local-integration/fix.sqlite3`; application and process logs are written under `.local-integration/`.

## 6. Testing / Verification Performed

### Current session

- Installed the locked frontend dependencies and completed a Vite production build.
- Started the API, worker, private AI service, and Dashboard preview.
- Confirmed API readiness (`database: available`, `worker: available`) and AI readiness (`status: ok`).
- Imported all 14620 S001 observations and confirmed that the inventory endpoint returns 20 products.
- Confirmed that the Dashboard preview returns HTTP 200 and that the API responds to the configured Dashboard origin.

### Previously recorded local acceptance

The [local integration guide](../../docs/local-integration-zh.md) records 38 Python checks, 32 frontend tests, and a successful Vite production build. It also records a real-model Daily run that processed 20 of 20 products and a review that remained retrievable after service restart without changing inventory.

For S001/P0001 at `2023-11-15`, the recorded result was P50 `424.03519375145015`, P90 `648.0340855078196`, cutoff inventory `82`, and recommended quantity `567`. A subsequent live-adapter acceptance recorded 175 Run/Job-associated API, worker, and AI log events; pagination and NDJSON export matched the frozen query snapshot. These are historical acceptance records and are not a new Run created in the current session.

The repository includes `scripts/verify-local-demo.mjs` for a live-flow acceptance run after the standard ports are available and data is imported. It creates a real analysis Run and review; it is not a read-only health check.

## 7. Risks and Revised Scope

- **Biggest current risk:** A worker interrupted after claiming a job can leave it in `claimed` / `processing`. There is no automatic retry, job lease, or stale-claim recovery.
- **Forecasting limitation:** `Units Sold` is realized sales used as a demand proxy. The source does not establish stock measurement timing, and lead times are simulated. Forecasts do not establish unconstrained demand or proven inventory savings.
- **Data requirement:** A selected product needs 29 consecutive observations; missing history is rejected rather than filled with zero. The model supports cutoffs on or after `2023-09-01`.
- **Access-control risk:** The local API has no authentication or authorization. A reviewer label is not a verified identity.
- **Largest scope cut already made:** The milestone protects manual Daily analysis for one store and excludes Monthly scanning, multi-store support, advanced anomaly models, and automatic purchasing.
- **Further scope cut if needed:** Defer additional UI features and deployment work while preserving the snapshot-to-forecast-to-review path.

## 8. Plan from Week 7 to Week 13

1. Capture the local demo evidence: health responses, a completed Run, result and review pages, correlated logs, and the code revision.
2. Verify the workflow from a clean checkout using the documented Python version and the standard startup ports.
3. Evaluate forecast quality against temporal baselines and assess the unusual-demand rule without making unsupported business-impact claims.
4. Complete a separate PostgreSQL integration and hosted-service acceptance when the team environment is selected.
5. Add access control, verified reviewer identity, safe worker recovery, shared AI log collection, and agreed backup and retention policies.
6. Consider Monthly analysis only after the Daily workflow is stable.

## 9. Artifact Index

- Project setup and local quick start: [root README](../../README.md)
- Architecture, data flow, and design decisions: [architecture](../../docs/architecture.md)
- Startup, monitoring, and troubleshooting: [operations guide](../../docs/operations.md)
- Local integration details and historical acceptance: [local integration guide](../../docs/local-integration-zh.md)
- API contracts: [frontend API contract](../../docs/frontend-api-contract.md) and [backend logs contract](../../docs/backend-logs-contract.md)
- Screenshot: temp path(waiting!!!!)
- Slides: temp path(waiting!!!!)

## 10. AI Use Statement

OpenAI Codex was used to inspect the project code and documentation, start the local demo services, and draft this milestone summary. 
