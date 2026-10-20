# Retail Dataset Profile

This supporting artifact records checks performed `retail_store_inventory_data.csv`. It provides data evidence for the [architecture](architecture.md).

## File identity and coverage

| Check | Observed result |
| --- | --- |
| Rows and columns | 73,100 rows; 15 columns |
| Dates | 01/01/2022 - 01/01/2024; 731 distinct dates |
| Stores | 5: S001–S005 |
| Products | 20: P0001–P0020 |
| Store-product pairs | 100; each has 731 daily records |
| Rows per store | 14,620 |
| Missing or empty source values | 0 |
| Duplicate store-product-date keys | 0 |
| Zero-sales rows | 360 |

The date span has exactly 731 calendar days. With unique keys and 731 dates per store-product pair, this file contains a complete daily panel.


## Column mapping

| Source column | Stored or derived field | Intended use |
| --- | --- | --- |
| Date | `snapshot_date` | Business date and temporal cutoff |
| Store ID | `store_id` | Store isolation; v1 accepts the configured store |
| Product ID | `product_id` | Product identity within a store's series |
| Category | `category_raw` | Preserve row-level value; derive a separate frozen scenario category for lead times |
| Region | `region_raw` | Preserve source value; exclude from v1 model inputs pending clarification |
| Inventory Level | `inventory_level` | Stock snapshot at the agreed daily cutoff |
| Units Sold | `units_sold` | Realized sales target; historical lag/rolling features |
| Units Ordered | `units_ordered` | Historical replenishment signal; never assumed received stock |
| Demand Forecast | `demand_forecast_benchmark` | Offline comparison only; unavailable to model feature builders |
| Price | `price` | Historical covariate; currency is not specified by the CSV |
| Discount | `discount_raw` | Preserve source scale; percentage-point interpretation requires confirmation |
| Weather Condition | `weather_condition` | Historical categorical covariate |
| Holiday/Promotion | `holiday_promotion` | Combined binary indicator; do not split into separate observed labels |
| Competitor Pricing | `competitor_pricing` | Historical covariate; same currency assumption requires confirmation |
| Seasonality | `seasonality_raw` | Preserve source label; prefer calendar-derived features in v1 |

## Numeric checks

| Field | Minimum | Maximum |
| --- | ---: | ---: |
| Inventory Level | 50 | 500 |
| Units Sold | 0 | 499 |
| Units Ordered | 20 | 200 |
| Demand Forecast | -9.99 | 518.55 |
| Price | 10.00 | 100.00 |
| Discount | 0 | 20 |
| Holiday/Promotion | 0 | 1 |
| Competitor Pricing | 5.03 | 104.94 |

Discount values are 0, 5, 10, 15, and 20. The file does not include a unit definition or data dictionary. A nonnegative validation constraint must not be applied indiscriminately to every numeric source field: 673 source Demand Forecast values are negative.

