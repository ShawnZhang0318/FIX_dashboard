python -m local_backend.import_csv --api http://127.0.0.1:8000# Project F.I.X. Dashboard

AI v1 source assets remain in [ai/README.md](ai/README.md), with the original [AI handoff](docs/ai-handoff-plan.md) and [model data handoff](docs/model-data-handoff.md). The current local integration is documented below.

The React + Vite dashboard for Project F.I.X. It includes English and Simplified Chinese interfaces for Inventory, Analysis, forecast results, Exceptions, human review and backend execution logs. Local integration connects the real `s001-global-q-v1` model through a public API, a separate worker, and configurable SQLite or PostgreSQL persistence.

**Database:** SQLite remains the default local demo database. Set `FIX_DATABASE_URL` to a PostgreSQL URL to use the normalized PostgreSQL schema and its versioned startup migrations. Supabase PostgreSQL works with its transaction pooler connection string; database connections stay server-side and never belong in the frontend. GitHub Pages displays mock data; real predictions require the local services.

**中文文档：[W04 数据流核对与接口传输](docs/data-flow-audit-zh.md) · [整合版改动说明](docs/changes-zh.md) · [后端日志接入约定](docs/backend-logs-contract.md) · [日志与接口传输](docs/dashboard-logging-zh.md) · [运行与验收](docs/react-integration.md) · [团队接入说明](docs/team-integration-ZH.md)**

## Run locally

The API must be running before the CSV importer can connect. For the Supabase setup, run the API in one terminal and the importer in another. Requires Python dependencies from `ai/requirements-dev.txt`.

**macOS/Linux — Terminal 1 (API):**

```sh
source .venv/bin/activate
export FIX_DATABASE_URL='postgresql://postgres.<project-ref>:<database-password>@<pooler-host>:6543/postgres?sslmode=require'
python -m uvicorn local_backend.service:app --host 127.0.0.1 --port 8000
```

Keep that terminal open. Wait until startup completes, then check in another terminal:

```sh
curl http://127.0.0.1:8000/health/live
```

The response should report `"database":"PostgreSQL"`. If it reports `local SQLite`, `FIX_DATABASE_URL` was not set in the API terminal; stop the API and start it again after exporting the Supabase URL.

**macOS/Linux — Terminal 2 (import):**

```sh
source .venv/bin/activate
python -m local_backend.import_csv --api http://127.0.0.1:8000
```

The importer sends 14,620 S001 observations through the public API in batches, one request at a time by default to avoid transaction-pooler contention. Each PostgreSQL batch is inserted with bulk SQL. It can run without the worker or AI service. For predictions, start the worker and AI service separately, with the same `FIX_DATABASE_URL` exported in the worker terminal.

On Windows, `.\\scripts\\start-local-demo.ps1` starts the local services; see [local integration guide](docs/local-integration-zh.md) for the Windows setup. The dashboard is optional for importing. By default, data persists in `.local-integration/fix.sqlite3`; when `FIX_DATABASE_URL` is set, it persists in PostgreSQL instead.

### Connect Supabase PostgreSQL and import the CSV

1. In Supabase, open **Project FIX → Connect** and copy the **Transaction pooler** connection string. Use the database password and retain `sslmode=require` if shown. Do not use a publishable/anon key as a database URL.
2. Set `FIX_DATABASE_URL` in the environment used to start both the API and worker. For example, on macOS/Linux:

   ```sh
   export FIX_DATABASE_URL='postgresql://postgres.<project-ref>:<database-password>@<pooler-host>:6543/postgres?sslmode=require'
   ```

   Replace the placeholders with the connection details from Supabase; do not commit the URL. URL-encode reserved characters in the password (for example, `@` becomes `%40`, `#` becomes `%23`, and `%` becomes `%25`) or the URI may parse incorrectly and fail DNS resolution. The pooler-safe psycopg configuration disables server-side prepared statements.
3. In separate terminals, start the API and worker with that environment. API startup applies the versioned schema migrations. Those migrations enable row-level security on the application tables; the trusted backend connects with the database role and the browser never connects directly to Postgres.

   ```sh
   python -m uvicorn local_backend.service:app --host 127.0.0.1 --port 8000
   python -m local_backend.worker
   ```

4. Once `http://127.0.0.1:8000/health/ready` is healthy, run:

   ```sh
   python -m local_backend.import_csv --api http://127.0.0.1:8000
   ```

   The importer verifies the source checksum, inserts the 14,620 S001 daily snapshots in batches through the API, and reports the inserted count. It skips identical existing rows and refuses to overwrite different data. It does not fabricate transaction-level records.

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
