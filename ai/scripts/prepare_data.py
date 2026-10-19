"""Recreate the clean handoff CSV only. No training, inference or DB writes.

Run from repository root: python -m ai.scripts.prepare_data --output-dir <new-directory>
"""
import argparse
import hashlib
import json
from pathlib import Path

import numpy as np
import pandas as pd

from ai.predictor import DEFAULT_ARTIFACT_DIR

ROOT = Path(__file__).resolve().parents[2]


def clean_source(raw, catalog):
    raw = raw.loc[raw["Store ID"].eq("S001")].copy()
    mapping = {"Date": "date", "Store ID": "store_id", "Product ID": "product_id",
               "Units Sold": "units_sold", "Units Ordered": "units_ordered",
               "Price": "price", "Discount": "discount", "Weather Condition": "weather_condition",
               "Holiday/Promotion": "holiday_promotion", "Competitor Pricing": "competitor_pricing",
               "Seasonality": "seasonality"}
    frame = raw.rename(columns=mapping)
    keys = ["store_id", "product_id", "date"]
    required = keys + ["units_sold", "units_ordered"]
    if frame.empty or not set(required).issubset(frame.columns):
        raise ValueError("Missing S001 data or required columns")
    frame["date"] = pd.to_datetime(frame.date, errors="raise")
    if frame[keys].isna().any().any() or frame.duplicated(keys).any():
        raise ValueError("Missing or duplicate identifiers")
    if not frame.date.eq(frame.date.dt.normalize()).all():
        raise ValueError("Expected daily dates")
    for col in ("units_sold", "units_ordered"):
        values = pd.to_numeric(frame[col], errors="raise")
        if not np.isfinite(values).all() or (values < 0).any() or (values % 1 != 0).any():
            raise ValueError(f"Invalid integer quantities: {col}")
        frame[col] = values.astype("int64")
    if set(frame.product_id) != set(catalog.product_id):
        raise ValueError("Source products differ from frozen model catalog")
    expected = pd.MultiIndex.from_product([["S001"], sorted(catalog.product_id),
                                          pd.date_range(frame.date.min(), frame.date.max())], names=keys)
    observed = pd.MultiIndex.from_frame(frame[keys])
    if len(expected.difference(observed)) or len(observed.difference(expected)):
        raise ValueError("Incomplete daily panel")
    optional = [v for v in list(mapping.values())[5:] if v in frame.columns]
    frame = frame[required + optional].merge(catalog, on=["store_id", "product_id"],
                                            how="left", validate="many_to_one")
    columns = keys + ["category", "lead_time_days", "units_sold", "units_ordered"] + optional
    return frame[columns].sort_values(keys).reset_index(drop=True)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--source", type=Path, default=ROOT / "data/raw/retail_store_inventory_data.csv")
    parser.add_argument("--output-dir", type=Path, required=True)
    args = parser.parse_args()
    manifest = json.loads((ROOT / "data/metadata/v1/preprocess_manifest_v1.json").read_text())
    if hashlib.sha256(args.source.read_bytes()).hexdigest() != manifest["source_sha256"]:
        raise ValueError("Source differs from v1; create a new dataset version")
    clean = clean_source(pd.read_csv(args.source),
                         pd.read_csv(DEFAULT_ARTIFACT_DIR / "product_catalog_v1.csv"))
    args.output_dir.mkdir(parents=True, exist_ok=True)
    with (args.output_dir / "s001_sales_clean_v1.csv").open("x", encoding="utf-8", newline="") as out:
        clean.to_csv(out, index=False, date_format="%Y-%m-%d", float_format="%.12g")


if __name__ == "__main__":
    main()
