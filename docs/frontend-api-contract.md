# F.I.X. frontend integration contract

The new `frontend/` directory is a dependency-free ES-module frontend for Zhou's demo tasks. It extends this starter repository without changing the existing Python API, worker, migrations, or deployment. Existing `/cases` and `/jobs` are generic triage endpoints; **they are not compatible retail endpoints**.

Default mode is `mock`. Fixtures are six synthetic products, synthetic names/categories and fixed illustrative forecasts, not retail CSV records or trained model output. The mock saves runs/reviews in localStorage under `fix-demo-v1`. Time-based state simulation is not a real worker, and browser persistence is not PostgreSQL persistence. A fixture snapshot exists only for S001, 2022-06-30. All three scenarios share that fixture date. Running another date is intentionally rejected.

## Runtime

Serve `frontend/` over HTTP (Python `http.server` suffices). No npm install or framework build is needed. Do not open the HTML with `file://`. `frontend/runtime-config.js` sets mode, base URL, polling interval and request timeout. State restoration uses the URL's `run` and `case` parameters plus the same browser origin's localStorage. Changing hostname, port or browser changes the storage context. Clearing browser data loses mock records. Cross-tab simultaneous mock writes are not transactionally protected; use one tab for the demo. Real concurrency and idempotency must be enforced by the server/database.

## Required live routes

All identifiers may be strings; dates are ISO calendar dates. GET list routes return bare arrays except the results route. JSON errors use `{ "detail": "readable message" }`; FastAPI validation detail arrays are also displayed. Backend must allow the frontend origin through CORS (including OPTIONS for writes), or use a same-origin proxy. No credentials or authentication flow is assumed in this demo.

| Route | Required shape |
| --- | --- |
| `GET /inventory?store_id=S001` | Array of `{product_id, store_id, on_hand_quantity, snapshot_date, lead_time_days}`; `name`, `category` optional. |
| `POST /analysis-runs` | Body `{store_id, run_type: "daily", as_of_date}`. Return 202 `{analysis_run: {id, status: "queued"}, job: {id, status: "pending"}}`. Mock-only `scenario` is stripped by the live adapter. |
| `GET /analysis-runs/{id}` | `{id, store_id, as_of_date, status, processed_count, expected_count, partial, error, created_at, completed_at}`. Status is queued, processing, completed or failed. |
| `GET /analysis-runs/{id}/results` | `{results: [ForecastResult], status, partial}`. Normal results must remain included. |
| `GET /exceptions?run_id=...&status=...` | Array of ExceptionCase. Both filters optional; run association is required for correct navigation. |
| `GET /exceptions/{id}` | One ExceptionCase with supporting result. |
| `POST /exceptions/{id}/review` | Body `{decision, reviewer_order_quantity, override_reason, reviewer_label}`; return saved case. |

ForecastResult: `id`, `analysis_run_id`, `store_id`, `product_id`, optional `name`, `horizon_days`, `forecast_mode`, `inventory_at_prediction`, `safety_stock`, `recommended_order_quantity`, `anomaly_type`, `explanation`, `model_version`, `policy_version`, `input_reference`, nullable `case_id`. Quantile mode includes `predicted_demand_p50` and `predicted_demand_p90`; point_buffer mode includes `predicted_demand_point` and `uncertainty_buffer`. Missing numeric values display as unavailable, never zero. Live service must validate numerical and identity constraints.

ExceptionCase: `id`, `analysis_run_id`, `parent_run_status`, `exception_type` (`reorder` or `anomaly` in fixtures; combined reorder cases follow reorder review), `status`, `result` (ForecastResult), and persisted review fields. Review status is pending_review, approved, modified, rejected or resolved. Reorder supports approve/modify/reject; anomaly-only supports resolve. Modified quantities are nonnegative whole units. Modify/reject/resolve require a reason; reviewer name is required. The mock blocks reviews for failed/partial runs and repeat decisions. Approval never changes inventory.

Errors: 422 invalid input, 404 missing record, 409 duplicate review/state conflict. Writes are not automatically retried. Network timeout does not prove a write failed; check server state before repeating. Server constraints, authentication and authorization must be added for production.

## Team handoff

Zhou owns `api.js`, analysis creation, polling and results in `app.js`. Zhang owns `frontend/pages/review-pages.js`, containing `inventoryPage`, `exceptionsPage` and `detail`, retaining the public API function signatures and route parameters. The basic inventory/review screens in this demo are integration scaffolding, not a claim that Zhang's work is complete. Backend/worker ownership still needs explicit team assignment.

Use `node --test frontend/tests/*.test.js` from the repo root. Tests cover state restoration, review persistence, unchanged inventory, duplicate decisions, validation, partial/empty outcomes and run associations. These tests validate the mock contract, not the starter's PostgreSQL/AI stack.

## AI use

OpenAI Codex assisted implementation of this frontend, synthetic mock fixtures, integration contract and tests. No model training or retail backend implementation is claimed.

See [Chinese team handoff](team-integration-ZH.md) for ownership, model/data boundaries and staged acceptance. The HTTP client and live adapter are tested separately in `frontend/tests/live-api.test.js`; these tests use controlled responses, not a running retail backend.
