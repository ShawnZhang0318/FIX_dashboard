"""Import verified source rows THROUGH the public API, never directly to its DB."""
import argparse
from concurrent.futures import ThreadPoolExecutor, as_completed
import csv
import hashlib
import json
from pathlib import Path
import sys
import httpx

ROOT = Path(__file__).resolve().parents[1]


def source_rows(path):
    digest = hashlib.sha256(path.read_bytes()).hexdigest()
    manifest = json.loads((ROOT/"ai/artifacts/s001-global-q-v1/manifest.json").read_text(encoding="utf-8"))
    if digest != manifest["preprocess_source_sha256"]:
        raise ValueError("CSV checksum does not match the delivered model's source")
    rows = []
    with path.open(newline="", encoding="utf-8-sig") as f:
        for line, raw in enumerate(csv.DictReader(f), 2):
            if raw["Store ID"] != "S001":
                continue
            item = {"store_id": "S001", "product_id": raw["Product ID"], "snapshot_date": raw["Date"],
                    "source_reference": f"{path.name}#row={line}"}
            for key, col in {"category_raw": "Category", "region_raw": "Region", "weather_condition": "Weather Condition",
                             "seasonality_raw": "Seasonality"}.items():
                item[key] = raw[col]
            for key, col in {"inventory_level": "Inventory Level", "units_sold": "Units Sold", "units_ordered": "Units Ordered",
                             "price": "Price", "discount_raw": "Discount", "competitor_pricing": "Competitor Pricing",
                             "demand_forecast_benchmark": "Demand Forecast"}.items():
                item[key] = float(raw[col])
            item["holiday_promotion"] = int(raw["Holiday/Promotion"])
            rows.append(item)
    return digest, rows


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--api", default="http://127.0.0.1:8000")
    parser.add_argument("--concurrency", type=int, default=1)
    parser.add_argument("--timeout", type=float, default=300)
    args = parser.parse_args()
    if args.concurrency < 1:
        parser.error("--concurrency must be at least 1")
    if args.timeout <= 0:
        parser.error("--timeout must be positive")
    digest, rows = source_rows(ROOT/"data/raw/retail_store_inventory_data.csv")
    with httpx.Client(base_url=args.api, timeout=args.timeout, trust_env=False) as client:
        response = client.get("/snapshots", params={"store_id": "S001"})
        response.raise_for_status()
        existing = {(x["product_id"], x["snapshot_date"]): x for x in response.json()}
        pending = []
        for row in rows:
            old = existing.get((row["product_id"], row["snapshot_date"]))
            if old:
                if old.get("source_file_sha256") != digest or any(old.get(k) != v for k, v in row.items()):
                    raise ValueError("Existing source differs; refusing to overwrite observations")
            else:
                pending.append(row)

    pending_by_product = {}
    for row in pending:
        pending_by_product.setdefault(row["product_id"], []).append(row)

    def post_product(product_rows):
        inserted = 0
        for index in range(0, len(product_rows), 100):
            batch = product_rows[index:index+100]
            with httpx.Client(base_url=args.api, timeout=args.timeout, trust_env=False) as client:
                response = client.post("/snapshots", json={"source_file_sha256": digest, "snapshots": batch})
                response.raise_for_status()
                count = response.json()["inserted_count"]
                if count != len(batch):
                    raise RuntimeError("Incomplete ingestion acknowledgement")
                inserted += count
        return inserted

    inserted = 0
    with ThreadPoolExecutor(max_workers=args.concurrency) as executor:
        futures = [executor.submit(post_product, product_rows)
                   for product_rows in pending_by_product.values()]
        for future in as_completed(futures):
            inserted += future.result()
            print(f"Imported {inserted}/{len(pending)} pending rows", file=sys.stderr, flush=True)

    print(json.dumps({"source_sha256": digest, "verified_rows": len(rows), "inserted_rows": inserted}))


if __name__ == "__main__":
    main()
