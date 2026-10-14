# Project F.I.X. Dashboard

The React + Vite dashboard for Project F.I.X. It includes English and Simplified Chinese interfaces and an integrated mock workflow for Inventory, Analysis, forecast results, Exceptions and human review.

**中文文档：[整合版改动说明](docs/changes-zh.md) · [运行与验收](docs/react-integration.md) · [团队接入说明](docs/team-integration-ZH.md)**

## Run locally

Requires Node.js 20.19 or newer.

```bash
npm ci
npm run dev
```

Open the local URL printed by Vite. The React pages now share the mock API: inventory → analysis → status/results → exceptions → review. Refresh restores records in the same browser. Fixtures are synthetic; no real worker, database or trained model is connected.

## Routes

- `/#/inventory`
- `/#/analysis`
- `/#/analysis/:runId`
- `/#/exceptions`
- `/#/exceptions/:caseId`

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
- The backend API and model are still pending; `live` requires the documented retail endpoints.
- See [integrated acceptance guide](docs/react-integration.md).
