# Project F.I.X. Dashboard

AI v1 source assets remain in [ai/README.md](ai/README.md), with the original [AI handoff](docs/ai-handoff-plan.md) and [model data handoff](docs/model-data-handoff.md). The current local integration is documented below.

The React + Vite dashboard for Project F.I.X. It includes English and Simplified Chinese interfaces for Inventory, Analysis, forecast results, Exceptions, human review and backend execution logs. Local integration connects the real `s001-global-q-v1` model through a public API, a separate worker, and configurable SQLite or PostgreSQL persistence.

**2026-10-22 database update:** SQLite remains the default local demo database. Set `FIX_DATABASE_URL` to a PostgreSQL URL to use the normalized PostgreSQL schema and its versioned startup migration. GitHub Pages displays mock data; real predictions require the local services.

**中文文档：[W04 数据流核对与接口传输](docs/data-flow-audit-zh.md) · [整合版改动说明](docs/changes-zh.md) · [后端日志接入约定](docs/backend-logs-contract.md) · [日志与接口传输](docs/dashboard-logging-zh.md) · [运行与验收](docs/react-integration.md) · [团队接入说明](docs/team-integration-ZH.md)**

## Run locally

Requires Node.js 20.19 or newer and Python 3.12 for the verified local setup.

```bash
npm ci
python -m venv .venv-model
.\.venv-model\Scripts\python.exe -m pip install -r ai/requirements-dev.txt
.\scripts\start-local-demo.ps1
.\.venv-model\Scripts\python.exe -m local_backend.import_csv
```

Open `http://127.0.0.1:5174/FIX_dashboard/#/analysis` and use `2023-11-15`. Loopback pages select the local live API; static hosting retains mock mode. The CSV importer sends 14,620 S001 observations through the public API. By default, results and reviews persist in `.local-integration/fix.sqlite3`; when `FIX_DATABASE_URL` is set, they persist in PostgreSQL instead. See the Chinese guide for setup and stopping services.

## Routes

- `/#/inventory`
- `/#/analysis`
- `/#/analysis/:runId`
- `/#/exceptions`
- `/#/exceptions/:caseId`
- `/#/logs`

## Publish

Pushing to the `main` branch builds the Vite app and deploys it to GitHub Pages using the workflow in `.github/workflows/deploy.yml`.


## Standalone workflow demo (Zhou)

The React app in `src/` now imports the common API adapters from `frontend/`. The standalone HTML demo remains a reference; use the React app for the merged team demo. The existing deployment workflow builds the integrated React app when this branch is merged to main.

Run from the repository root:

```bash
python -m http.server 5173 --bind 127.0.0.1 --directory frontend
```

Open http://127.0.0.1:5173. The demo includes analysis creation, polling, forecast results, exception review and browser persistence, using explicitly synthetic fixtures. No real backend/model connection is claimed.

- [Demo guide](frontend/DEMO_GUIDE_ZH.md)
- [API contract](docs/frontend-api-contract.md)
- [Team integration and ownership](docs/team-integration-ZH.md)

Validate the mock and HTTP adapter with `node --test frontend/tests/*.test.js`.

## Integrated React demo

- `/#/analysis/:runId` shows persisted status and all forecast results.
- `/#/exceptions?run_id=...&status=pending_review` filters the queue.
- `/#/exceptions/:caseId` loads the exact case and persists approve/modify/reject/resolve decisions.
- Configure the React deployment in `public/runtime-config.js`; the built file is `dist/runtime-config.js`. The standalone reference uses `frontend/runtime-config.js`. Never add secrets to either file.
- The local API implements the retail contracts with SQLite by default and supports PostgreSQL through `FIX_DATABASE_URL`.
- Set `FIX_DATABASE_URL=postgresql://...` in both the API and worker environments to use PostgreSQL; leave it unset to use the local SQLite database. The API/worker apply the versioned migration at startup. Never commit connection credentials.
- See [integrated acceptance guide](docs/react-integration.md).
