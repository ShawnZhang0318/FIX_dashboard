"""Verify delivered source/clean data and preprocessing without model inference."""
import hashlib
import json
from pathlib import Path

import pandas as pd

from ai.features import build_request
from ai.scripts.prepare_data import clean_source

ROOT = Path(__file__).resolve().parents[2]


def test_downloads_and_training_metadata_hashes():
    imports = json.loads((ROOT / "data/metadata/v1/import_manifest.json").read_text())
    for entry in imports["files"]:
        data = (ROOT / entry["path"]).read_bytes()
        assert len(data) == entry["size_bytes"]
        assert hashlib.sha256(data).hexdigest() == entry["sha256"]
    manifest = json.loads((ROOT / "ai/artifacts/s001-global-q-v1/manifest.json").read_text())
    for file, key in [("data/raw/retail_store_inventory_data.csv", "preprocess_source_sha256"),
                      ("ai/artifacts/s001-global-q-v1/feature_schema_v1.json", "feature_schema_sha256"),
                      ("ai/artifacts/s001-global-q-v1/product_catalog_v1.csv", "product_catalog_sha256")]:
        assert hashlib.sha256((ROOT / file).read_bytes()).hexdigest() == manifest[key]


def test_cleaning_matches_delivered_data():
    raw = pd.read_csv(ROOT / "data/raw/retail_store_inventory_data.csv")
    catalog = pd.read_csv(ROOT / "ai/artifacts/s001-global-q-v1/product_catalog_v1.csv")
    delivered = pd.read_csv(ROOT / "data/processed/v1/s001_sales_clean_v1.csv", parse_dates=["date"])
    pd.testing.assert_frame_equal(clean_source(raw, catalog), delivered)


def test_features_match_existing_request_without_prediction():
    delivered = pd.read_csv(ROOT / "data/processed/v1/s001_sales_clean_v1.csv")
    sample = json.loads((ROOT / "ai/examples/example_analyze_request.json").read_text())
    result = build_request(delivered.loc[delivered.product_id.eq(sample["product_id"])],
                           **{key: sample[key] for key in ["store_id", "product_id", "as_of_date",
                                                          "lead_time_days", "input_reference"]})
    import pytest
    assert result.features.model_dump() == pytest.approx(sample["features"], rel=1e-9)
