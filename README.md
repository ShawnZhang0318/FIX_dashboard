# Project F.I.X. Dashboard

The React + Vite dashboard prototype for Project F.I.X. It includes English and Simplified Chinese interfaces, with pages for Inventory, Analysis, and Exceptions, plus placeholders for run and exception details.

## Run locally

Requires Node.js 20.19 or newer.

```bash
npm ci
npm run dev
```

Open the local URL printed by Vite. The current pages are a UI scaffold: they do not call the project API, database, worker, or AI service yet.

## Routes

- `/#/inventory`
- `/#/analysis`
- `/#/analysis/:runId`
- `/#/exceptions`
- `/#/exceptions/:caseId`

## Publish

Pushing to the `main` branch builds the Vite app and deploys it to GitHub Pages using the workflow in `.github/workflows/deploy.yml`.


## Standalone workflow demo (Zhou)

The `frontend/` directory contains the completed dependency-free mock workflow demo. It is separate from the React/Vite scaffold in `src/`; the React routes do not yet use this adapter. This branch does not change the existing GitHub Pages deployment.

Run from the repository root:

```bash
python -m http.server 5173 --bind 127.0.0.1 --directory frontend
```

Open http://127.0.0.1:5173. The demo includes analysis creation, polling, forecast results, exception review and browser persistence, using explicitly synthetic fixtures. No real backend/model connection is claimed.

- [Demo guide](frontend/DEMO_GUIDE_ZH.md)
- [API contract](docs/frontend-api-contract.md)
- [Team integration and ownership](docs/team-integration-ZH.md)

Validate the mock and HTTP adapter with `node --test frontend/tests/*.test.js`.
