# ADR 001 — PostgreSQL for hosted storage and SQLite for local development

## Status

Accepted

## Context

F.I.X. needs to retain inventory snapshots, analysis runs and jobs, forecasts, reviews, and operational logs across process restarts. In hosted deployments the API and worker run separately and need to coordinate updates against the same database. The local demo needs a setup that teammates can reproduce with minimal dependencies.

## Decision

Use PostgreSQL as the shared relational database for the hosted API and worker. Point both processes at the same database through `FIX_DATABASE_URL`. Use numbered SQL migrations, database constraints, and a connection pool per process. The API creates a run and its pending job in one transaction. The worker uses `FOR UPDATE SKIP LOCKED` to claim one pending job safely when several workers are polling.

Keep file-backed SQLite as the default when `FIX_DATABASE_URL` is unset. It allows the local API and worker to share persistent state on one machine without provisioning a database server. Both database modes support the same public workflow.

## Alternatives considered

- **SQLite everywhere.** The original local implementation demonstrated that SQLite can persist the full workflow on one machine. Separate hosted containers would need a shared database file and coordination around file access. A shared PostgreSQL service fits that deployment topology.
- **PostgreSQL everywhere.** One database engine would simplify parity testing. Every local demo would then need a running PostgreSQL instance and connection setup.

## Consequences

- Hosted deployments need a provisioned database, credentials, backups, and migration and connection-pool checks.
- SQLite and PostgreSQL use different schemas and locking strategies. Hosted database behavior needs separate verification, including concurrent claims and migrations.
- Each environment has its own data. A move from SQLite to PostgreSQL requires an explicit import or migration.

See [persistence and schema details](../architecture.md#4-persistent-entities-and-erd) and the [deployment guide](../railway-deploy-zh.md).
