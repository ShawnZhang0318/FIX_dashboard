# Project F.I.X.

**Project F.I.X. — Forecasting & Inventory Exceptions** 
Demand Forecasting and Inventory Exception Manager  
MAIE 6000C · Group 5

Many multi-store retail chains have constant and manual human monitoring of sales, stock levels and more which can be overwhelming and resulting in expensive mistakes. Project F.I.X. aims to assist them to monitor, demand forecasts, provide replenishment recommedations and prioritize exceptions for human review. 

The project uses `retail_store_inventory_data.csv`. The first delivery operates on one selected store, with S001 proposed for the demonstration. `Units Sold` is the observed sales target and `Inventory Level` is the reported stock snapshot. Lead times are simulated. The source `Demand Forecast` column is reserved for offline comparison and excluded from model inputs.

## Documentation

- [Architecture and design](docs/architecture.md): primary workflow, service diagram, schema and ERD, states, APIs, AI processing, failure handling, and scope.
- [Week 4 proposal and project plan](submissions/week04/README.md): concise submission summary, milestones, team responsibilities, artifact index, and AI Use Statement.
- [Dataset profile and design implications](docs/dataset-profile.md): verified local-file observations and data limitations that inform the architecture.

## Delivery Scope

The proposed deployment uses a public API, Database, a polling worker, and a private AI service, with potentially SQLAlchemy, Alembic, and Docker Compose. The core is the Daily snapshot-to-forecast-to-review workflow. Monthly scanning follows after Daily processing is reliable.

The system is advisory. Forecasting and review do not place purchase orders or modify stock. Inventory is refreshed only by validated snapshot ingestion. Multi-store optimization, automatic procurement, ERP integration, and dynamic pricing are out of scope.

These are Week 4 design documents. Dataset profiling has been performed; application implementation, migration execution, and model-performance verification are later deliverables.

## Team Info & Responsibilities
| Member | Student ID | Responsibilities |
| --- | --- | --- |
| CAO, Jun | 21342592 | Demand forecasting and inventory anomaly model development. |
| SHAH, Pooja Zenit | 21320776 | Data cleaning, preprocessing, and database handling. |
| ZHANG, Yitong | 21340295 | Dashboard development, workflow handling, and connections between components. |
| ZHOU, Guanxu | 21313412 | Dashboard development, workflow handling, and connections between components. |
