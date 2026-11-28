# ADR 002 — Process analysis jobs with a database-backed polling worker

## Status

Accepted

## Context

A planner can request an analysis for up to 20 products at store S001. Model calls take time, and the planner may leave the dashboard before they finish. The API needs to acknowledge the request promptly and give the planner an ID that will still identify the same job, input snapshots and results after a restart.

## Decision

Use the relational `jobs` table as the work queue and run a separate Python worker. In one transaction, `POST /analysis-runs` saves the frozen input references, a `queued` Run and a `pending` Job. After commit, the API returns HTTP 202 with both IDs. Keeping the queue alongside the Run lets the database commit both records together.

The worker polls for the oldest eligible Job. It marks the Job `claimed` and its Run `processing` in one transaction, then commits before calling the private AI service. SQLite serializes claims with `BEGIN IMMEDIATE`. PostgreSQL uses `FOR UPDATE OF jobs SKIP LOCKED` so another worker can claim a different Job. For Daily analysis, the worker commits each product’s forecast, any review case and the progress count together. For Monthly analysis, it saves the historical diagnostics on the Run.

## Alternatives considered

- **Run analysis inside the HTTP request.** This simplifies the service layout, but the client would have to wait through the model calls. A timeout would leave the planner unsure whether processing finished.
- **Use a task framework with a separate broker, such as Celery with Redis.** This would provide queue management and retry features. For one store, it would also add a service to operate and a second write to coordinate with the database whenever the API accepts a Run.

## Consequences

- Pending work survives API and worker restarts. The dashboard can retrieve progress and saved results by Run ID, and operators can trace the same execution using Run and Job IDs in the logs.
- Polling adds database traffic even when the queue is empty. Each worker processes one analysis Job at a time.
- A caught inference error marks the Run and Job failed. Earlier product results remain available for inspection, and review is blocked. The worker retries transient polling failures. A crash after the claim commits can leave a Job `claimed` indefinitely because claims have no expiry. An operator checks the original worker and logs before starting a new Run.

See the [worker implementation](../../local_backend/worker.py), [claim and failure tests](../../local_backend/tests/test_flow.py), and [operations guide](../operations.md).
