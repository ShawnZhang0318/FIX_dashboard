"""Replay diagnostic rules on historical CSV data without training or database access."""
import argparse
from collections import Counter, defaultdict
import csv
from datetime import date, timedelta
import json
from pathlib import Path

from ai.diagnostics import POLICY_VERSION, ROSTER, diagnose
from ai.schemas import DiagnosticsRequest


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--source", type=Path, default=Path("data/raw/retail_store_inventory_data.csv"))
    parser.add_argument("--from", dest="start", type=date.fromisoformat, required=True)
    parser.add_argument("--to", dest="end", type=date.fromisoformat, required=True)
    parser.add_argument("--mode", choices=("daily", "monthly"), required=True)
    args = parser.parse_args()
    if args.start > args.end:
        parser.error("--from must be on or before --to")

    history = defaultdict(list)
    earliest = args.start - timedelta(days=55)
    with args.source.open(encoding="utf-8-sig", newline="") as source:
        for row in csv.DictReader(source):
            if row["Store ID"] != "S001":
                continue
            day = date.fromisoformat(row["Date"])
            if earliest <= day <= args.end:
                history[row["Product ID"]].append(
                    {"date": day, "units_sold": float(row["Units Sold"]),
                     "inventory_level": float(row["Inventory Level"])})

    cutoff = args.start
    while cutoff <= args.end:
        start = cutoff - timedelta(days=55 if args.mode == "monthly" else 28)
        request = DiagnosticsRequest(
            store_id="S001", as_of_date=cutoff, input_reference=f"offline-replay:{cutoff}",
            products={product: [row for row in history[product] if start <= row["date"] <= cutoff]
                      for product in ROSTER})
        result = diagnose(request, args.mode)
        counts = defaultdict(Counter)
        anomalies = defaultdict(list)
        for product, checks in result["products"].items():
            for signal, finding in checks.items():
                counts[signal][finding["status"]] += 1
                if finding["status"] == "anomaly":
                    anomalies[signal].append(product)
        print(json.dumps({"as_of_date": str(cutoff), "mode": args.mode, "policy_version": POLICY_VERSION,
                          "counts": counts, "anomaly_products": anomalies}))
        cutoff += timedelta(days=1)


if __name__ == "__main__":
    main()
