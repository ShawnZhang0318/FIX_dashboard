"""Generate a simulated daily sales summary from the project's cleaned sales history.

    python scripts/generate_daily_sales.py --date 2026-11-26
    python scripts/generate_daily_sales.py --date 2026-11-26 --output daily-sales.json

Only observed dates before the target are eligible. Each SKU blends three
historical averages: the same month and weekday (50%), the last eight matching
weekdays (30%), and the last 28 observations (20%). If a group is empty its
weight is redistributed. Output is a simulation, never a checkout receipt.
"""

import argparse
import csv
import json
from collections import defaultdict
from datetime import date
from math import floor
from pathlib import Path
from statistics import mean


DEFAULT_HISTORY = Path(__file__).resolve().parents[1] / "data/processed/v1/s001_sales_clean_v1.csv"


def load_history(path, store, target):
    history = defaultdict(dict)
    with path.open(encoding="utf-8-sig", newline="") as source:
        reader = csv.DictReader(source)
        required = {"store_id", "product_id", "date", "units_sold"}
        if not required.issubset(reader.fieldnames or ()):
            raise ValueError("Expected columns: store_id, product_id, date, units_sold")
        for row in reader:
            if row["store_id"] != store:
                continue
            day = date.fromisoformat(row["date"])
            if day >= target:
                continue
            sku = (row["product_id"] or "").strip()
            units = int(row["units_sold"])
            if not sku or units < 0:
                raise ValueError(f"Invalid product or units sold at CSV line {reader.line_num}")
            if day in history[sku]:
                raise ValueError(f"Duplicate observation for {store}/{sku} on {day}")
            history[sku][day] = units
    if not history:
        raise ValueError(f"No sales history for {store} before {target}")
    return history


def estimate_units(observations, target):
    days = sorted(observations)
    matching_weekdays = [day for day in days if day.weekday() == target.weekday()]
    seasonal_days = [day for day in matching_weekdays if day.month == target.month]
    groups = ((seasonal_days, 5), (matching_weekdays[-8:], 3), (days[-28:], 2))
    weight_total = sum(weight for group, weight in groups if group)
    estimate = sum(
        weight * mean(observations[day] for day in group)
        for group, weight in groups if group
    ) / weight_total
    return floor(estimate + 0.5)


def daily_summary(path, store, target):
    history = load_history(path, store, target)
    items = [
        {"product_id": sku, "units_sold": estimate_units(observations, target)}
        for sku, observations in sorted(history.items())
    ]
    return {
        "source": "historical_simulation",
        "store_id": store,
        "business_date": target.isoformat(),
        "history_through": max(max(days) for days in history.values()).isoformat(),
        "total_units_sold": sum(item["units_sold"] for item in items),
        "items": items,
    }


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--date", type=date.fromisoformat, default=date.today(), help="business date (default: local today)")
    parser.add_argument("--store", default="S001")
    parser.add_argument("--history", type=Path, default=DEFAULT_HISTORY, help="cleaned sales history CSV")
    parser.add_argument("--output", type=Path, help="new JSON file (default: print to terminal)")
    args = parser.parse_args()
    try:
        summary = daily_summary(args.history, args.store, args.date)
        output = json.dumps(summary, indent=2) + "\n"
        if args.output is None:
            print(output, end="")
        else:
            with args.output.open("x", encoding="utf-8") as destination:
                destination.write(output)
    except (OSError, ValueError, csv.Error) as exc:
        parser.exit(2, f"Daily sales generation failed: {exc}\n")


if __name__ == "__main__":
    main()
