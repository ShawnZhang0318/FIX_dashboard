# F.I.X. frontend integration contract

The primary dashboard is the React application in `src/`. It shares the API modules in `frontend/`; the older standalone HTML demo is retained as a reference. This repository does not yet provide the retail backend, worker or database. Generic `/cases` and `/jobs` endpoints from the original starter are not compatible retail endpoints.

**2026-10-20 W04 alignment:** [数据流核对与传输交接](data-flow-audit-zh.md) records the supplied architecture, audit, snapshot schema and backend responsibilities. The [original architecture](w04-reference/docs/architecture.md) is retained unchanged. This is a frontend integration contract, not evidence of a running retail backend.

Default mode is `mock`. Fixtures are six synthetic products, synthetic names/categories and fixed illustrative forecasts, not retail CSV records or trained model output. The mock saves runs/reviews in localStorage under `fix-demo-v1`. Time-based state simulation is not a real worker, and browser persistence is not PostgreSQL persistence. A fixture snapshot exists only for S001, 2022-06-30. All three scenarios share that fixture date. Running another date is intentionally rejected.

## Runtime

For React, use `npm ci` and `npm run dev`, or `npm run build` then `npm run preview`. Configure `public/runtime-config.js` (copied to `dist/runtime-config.js`); the entry point loads it before constructing the API. Missing configuration blocks startup. Routes are `#/inventory`, `#/analysis/:runId`, `#/exceptions/:caseId` and `#/logs`. The standalone reference still uses `frontend/runtime-config.js` and query parameters. Neither version should be opened with `file://`. Changing hostname, port or browser changes the storage context. Clearing browser data loses mock records. Cross-tab simultaneous mock writes are not transactionally protected; use one tab for the demo. Real concurrency and idempotency must be enforced by the server/database.

## Required live routes

Resource IDs may be nonempty strings or nonnegative safe integers; the adapter normalizes integers to strings for routing. IDs outside JavaScript's safe integer range must be serialized as strings. Dates are ISO calendar dates. Numerical quantities remain JSON numbers. GET list routes return complete bare arrays except the results route; no silent pagination/truncation is allowed. JSON errors use `{ "detail": "readable message" }`; FastAPI validation detail arrays are also displayed. Backend must allow the frontend origin through CORS (including OPTIONS for writes), or use a same-origin proxy. No credentials or authentication flow is assumed in this demo.

| Route | Required shape |
| --- | --- |
| `POST /snapshots` | `{source_file_sha256,snapshots:[...]}`, 1–100 mapped rows per atomic batch; HTTP 200/201 with `{inserted_count,snapshot_ids:[...]}` after commit. Full schema: [transfer contract](data-flow-audit-zh.md). |
| `GET /snapshots?store_id=S001&product_id=...&from=...&to=...` | Complete matching snapshot array. Product/date filters optional; ISO date bounds inclusive. |
| `GET /inventory?store_id=S001` | Array of `{product_id, store_id, on_hand_quantity, snapshot_date, source_snapshot_id, lead_time_days}`; `name`, `category` optional. |
| `GET /inventory/{store_id}/{product_id}` | One current inventory record with the same fields. |
| `POST /analysis-runs` | Body `{store_id, run_type: "daily", as_of_date}`. Return 202 `{analysis_run: {id, status: "queued"}, job: {id, status: "pending"}}`. Mock-only `scenario` is stripped by the live adapter. |
| `GET /analysis-runs/{id}` | `{id, store_id, as_of_date, status, job:{id,status}, processed_count, expected_count, partial, error, created_at, completed_at}`. Run states queued/processing/completed/failed map to Job pending/claimed/completed/failed. Error is an optional safe summary. |
| `GET /analysis-runs/{id}/results` | `{results: [ForecastResult], status, partial}`. Normal results must remain included. |
| `GET /exceptions?store_id=S001&run_id=...&status=...` | Array of ExceptionCase. Run/status filters optional; store and run associations are checked. |
| `GET /exceptions/{id}` | One ExceptionCase with supporting result. |
| `POST /exceptions/{id}/review` | Body `{decision, override_reason, reviewer_label}` plus quantity for modify, zero for reject, null for resolve; approve omits quantity. Return saved complete case. |

ForecastResult: `id`, `analysis_run_id`, `store_id`, `product_id`, `snapshot_id`, optional `snapshot_date`/`name`, `horizon_days`, `forecast_mode`, `inventory_at_prediction`, `safety_stock`, `recommended_order_quantity`, `anomaly_type`, `explanation`, `model_version`, `policy_version`, `input_reference`, `processed_at`, `duration_ms`, nullable `case_id`. Quantile mode requires finite nonnegative P50/P90 with P90 ≥ P50; point_buffer requires finite nonnegative point/buffer with P50/P90 null/absent. Do not mix modes. Required missing numbers are contract failures, never zero. Backend validates identity, horizon, model/version metadata and policy; frontend checks its DTO and displays stored values without recalculation.

ExceptionCase: `id`, `analysis_run_id`, `parent_run_status`, `partial` (boolean), `exception_type` (`reorder`, `anomaly`, `reorder_and_anomaly`), `status`, `result` and persisted review fields. Review status is pending_review, approved, modified, rejected or resolved. Reorder and combined cases support approve/modify/reject; anomaly-only supports resolve. Modified quantities are nonnegative whole units. Modify/reject/resolve require a reason; combined cases require a note even for approval. Reviewer label and reviewed timestamp must be persisted. Failed/partial runs and repeat decisions are blocked; backend must enforce these constraints transactionally. Approval never changes inventory.

Errors: 422 invalid input, 404 missing record, 409 duplicate review/state conflict. Writes are not automatically retried. Network timeout does not prove a write failed; check server state before repeating. Server constraints, authentication and authorization must be added for production.

## Team handoff

Zhou owns the shared API boundary, `src/pages/AnalysisPage.jsx` and `src/pages/LogsPage.jsx`. Zhang owns `src/pages/InventoryPage.jsx`, `src/pages/ExceptionsPage.jsx` and the page layout/review components. Both use `frontend/api.js`; adapt backend fields in `frontend/live-api.js`, with validation in `frontend/contracts.js`. Backend/worker ownership still needs explicit team assignment.

## Browser logs and request correlation

The default `#/logs` page queries **server execution logs** via `GET /logs` and `GET /logs/export`; see [后端日志接入约定](backend-logs-contract.md). It never falls back to browser events. The following browser diagnostics are a separate view at `#/logs?source=browser`. Backend collection, persistence and query endpoints still require team implementation/configuration.

See [日志与传输改动](dashboard-logging-zh.md). Browser observations are retained locally (latest 300 entries); they are not server audit or worker execution logs. Each call has a request ID, but no raw bodies, headers or reviewer content are logged. Set `sendRequestId: true` only after the backend permits `X-Request-ID` in CORS. Expose the response header to read the server's request ID. DTO validation checks nested values and requested record/run identities before rendering. Incompatible responses report `CONTRACT_MISMATCH`. An ambiguous write is marked `writeUncertain`; no automatic retries or server-side idempotency are implemented by the frontend.

Use `node --test frontend/tests/*.test.js` from the repo root. Tests cover state restoration, review persistence, unchanged inventory, duplicate decisions, validation, partial/empty outcomes and run associations. These tests validate the mock contract, not the starter's PostgreSQL/AI stack.

## AI use

OpenAI Codex assisted implementation of this frontend, synthetic mock fixtures, integration contract and tests. No model training or retail backend implementation is claimed.

See [Chinese team handoff](team-integration-ZH.md) for ownership, model/data boundaries and staged acceptance. The HTTP client and live adapter are tested separately in `frontend/tests/live-api.test.js`; these tests use controlled responses, not a running retail backend.
