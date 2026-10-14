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

