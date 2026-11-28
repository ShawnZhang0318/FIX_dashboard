# ADR 003 — Run LightGBM forecasts through a private AI service

## Status

Accepted

## Context

Inventory planners need forecasts of cumulative sales over each product's lead time. Replenishment recommendations use an upper quantile to reflect uncertainty. The forecasting input must be reconstructible from the daily snapshots available at the analysis cutoff.

## Decision

Use the versioned `s001-global-q-v1` bundle of pooled LightGBM quantile models for S001. Train offline in Colab. Serve P50 and lead-time-calibrated P90 through a private FastAPI service that loads and verifies the model bundle at startup. This keeps model loading and dependencies in the AI process and lets analysis and simulated settlement reuse the same inference interface.

The public API queues a durable analysis job with frozen input references. The worker builds features from 29 consecutive daily observations for each eligible Daily product, calls the AI service, and validates response identity, provenance and quantiles. It computes the replenishment recommendation and saves the forecast and any review case. The same private service exposes versioned statistical rules for Daily and Monthly diagnostics. Monthly runs save diagnostic findings only.

## Alternatives considered

- **Rolling-rate point forecasts.** The team evaluated 7-day and 28-day rolling sales rates scaled by lead time. These are simple benchmarks. On the stored validation split, the 28-day baseline had 25.03% WAPE versus 21.69% for the LightGBM P50. The rolling-rate forecasts do not provide a P90.
- **Point forecast with a residual buffer.** The Week 04 design documented this as a fallback when quantile modelling was infeasible. It could provide a stock buffer with a separate calibration step. The chosen model produces P50 and P90 over the lead-time horizon directly.

## Consequences

- Each forecast can be traced to its input snapshots, model, feature schema and policy versions. The worker can run inference independently of the public API request.
- The private service adds an HTTP dependency and requires artifact compatibility checks before deployment. Invalid or unavailable inference fails the analysis run, with previously committed results retained.
- The model predicts realized sales for one store and fixed simulated lead times. Sales can understate demand during stockouts, and quantile coverage can vary by lead time. Diagnostic thresholds also require continued validation.

See the [evaluation report](../../ai/reports/s001-global-q-v1/evaluation_report.json), the [Week 04 design](../w04-reference/docs/architecture.md), and the [current worker and AI workflow](../architecture.md#7-worker-and-ai-processing).
