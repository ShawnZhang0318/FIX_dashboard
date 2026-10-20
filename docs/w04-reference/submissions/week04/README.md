# Week 4 Team Architecture Proposal and Project Plan

**Project F.I.X. — Forecasting & Inventory Exceptions**  
Demand Forecasting and Inventory Exception Manager  
MAIE 6000C · Group 5

## Problem 
A core issue faced by multi-store retail chains is constant human monitoring of sales, stock levels, promotions, weather, competitor pricing and seasonality across the stores containing thousands of SKU-store combinations with other manual operations that can cause costly results. A human can only handle so much where a lack of prioritized exceptions in a timely manner or improper forecast demands can overload the person. Hence, by automating this with the embedding of an AI function, managers are more aware of what requires more attention, such as Project F.I.X.  

## Proposal summary
Project F.I.X. helps inventory planners turn daily retail snapshots into lead-time sales forecasts, replenishment recommendations, and prioritized exceptions. Each result is linked to its input snapshot, model version, policy, and review decision. The first delivery supports one selected store; S001 is proposed for the demo. The full source dataset contains five stores and 20 products across 731 dates.

The project uses `retail_store_inventory_data.csv`: Units Sold is the sales target, Inventory Level is observed stock, and Units Ordered is a historical ordering signal. Lead times are simulated. Demand Forecast is an offline comparison field, never a model input. Forecasting and review are advisory and do not execute orders or change inventory.

## Primary workflow
The primary user is an inventory planner. On opening the system, the planner sees an exception queue sorted by severity. The Daily path is:
- Ingest — validate and persist daily snapshots; refresh current inventory atomically.
- Trigger — planner creates a Daily AnalysisRun; API commits a queued run and pending Job.
- Process — worker claims the job, builds cutoff-safe features, calls the private AI service, and persists ForecastResult plus optional ExceptionCase.
- Review — planner approves, modifies, rejects, or resolves each case through the API; the decision and reviewer are persisted.
- Normal results remain queryable without creating review work.

Monthly scanning extends coverage to inactive and zero-sales products after Daily is reliable. Detailed schema, APIs, diagrams, and failure behavior are in [architecture.md](../../docs/architecture.md).

## Milestone plan
| Milestone | Minimum credible outcome and evidence |
| --- | --- |
| Week 4 | Finalize the three required documents, architecture/ERD/state diagrams, data-profile findings, API draft, risks, and scope cuts. |
| Week 5 | Apply the first Alembic migration; verify atomic snapshot/current-inventory persistence, duplicate rejection, historical-date retrieval, and initial API contracts. Confirm category/lead-time policy and model feature allowlist. |
| Week 7 | Demonstrate Daily request → persisted run/job → worker → versioned AI → stored normal/exception results → human review, with health and correlated logs. |
| Week 9 | Deliver reproducible Docker deployment and versioned training/inference; add Monthly full scanning if Daily is stable. |
| Week 11 | Add and test bounded retry and stale-claim recovery; tune thresholds and improve operational measurements. |
| Week 12 | Verify the final workflow; complete baseline/model evaluation, demonstration materials, and final documentation. |

## Key risks and first scope cut
- **Weak forecast signal and sparse histories**
- **Potential data leakage**
- **Missed/noisy exceptions and processing failures** 

**First cut: automatic scheduling; keep manual API triggers.** Further cuts are advanced UI, sophisticated anomaly models, and extra Monthly analytics. Protect Daily persistence → worker → AI → exception → review. Automatic procurement, ERP integration, multi-warehouse routing, supplier optimization, dynamic pricing, and complex role management are outside scope.

## Artifact index
| Artifact | Location |
| --- | --- |
| Project entry point | [Root README](../../README.md) |
| Full technical proposal | [Architecture](../../docs/architecture.md) |
| Main workflow | [Primary workflow](../../docs/architecture.md#2-primary-workflow) |
| Service diagram and boundaries | [Architecture diagram](../../docs/architecture.md#3-architecture-and-boundaries) |
| Persistent entities and ERD | [Schema and ERD](../../docs/architecture.md#4-persistent-entities-and-erd) |
| Run/job/review state diagram | [State transitions](../../docs/architecture.md#5-state-transitions-and-review-semantics) |
| Public and private APIs | [API contracts](../../docs/architecture.md#6-api-and-service-contracts) |
| AI, inventory policy, and evaluation | [Processing plan](../../docs/architecture.md#7-worker-and-ai-processing-plan) |
| Failure and recovery | [Failure behavior](../../docs/architecture.md#8-failure-retries-and-observability) |
| Planned persistence acceptance evidence | [Verification plan](../../docs/architecture.md#9-persistence-evidence-and-acceptance-plan) |
| In-class design conclusions | [Keep adapt add and risk](../../docs/architecture.md#10-keep-adapt-add-and-risk-conclusions) |
| Completed data inspection | [Dataset profile](../../docs/dataset-profile.md) |

Diagrams are embedded in the architecture file as editable Mermaid blocks. The dataset profile is a supporting artifact; it does not duplicate the architecture.

## Tentative Milestones 
| Milestone | Minimum Credible Outcome |
| :--- | :--- |
| **Week 4** | Finalize problem, workflow, architecture, schema, API draft, state transitions, risk register, and scope cuts. |
| **Week 5** | Apply the first Alembic migration and establish transaction and inventory persistence plus the initial API contract. |
| **Week 7** | Demonstrate the Daily request -> database -> job -> worker -> AI -> result -> exception -> human review path. |
| **Week 9** | Deliver reproducible Docker deployment, versioned training and inference, and the Monthly full-scan path if Daily is stable. |
| **Week 11** | Improve reliability and observability through failure handling, retries, threshold tuning, and operational measurements. |
| **Week 12** | Verify the final workflow and prepare the demonstration, documentation, and model evaluation. |


## AI Use Statement

- Tool used: OpenAI Codex.
- Used for: drafting the repository README formatting, clarifying snapshot-based historical queries, and reviewing workflow descriptions for consistency.
- Team reviewed, changed, or rejected: The project concept, problem framing, primary workflow, risks, database schema, team roles, and milestone targets came from the team. Codex output was used as a starting point; the team reviewed the proposed schema, state names, lead-time assumptions, and scope cuts, and revised them before submission. No migration, model, or deployment was produced by AI.