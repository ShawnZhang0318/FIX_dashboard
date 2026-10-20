"""Contract/packaging checks only: never load joblib or call a trained model."""
import json
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from ai.features import prepare_X
from ai.predictor import DEFAULT_ARTIFACT_DIR, calibrated_quantiles, verify_bundle
from ai.schemas import AnalyzeRequest, AnalyzeResponse
from ai.service import create_app

AI = Path(__file__).resolve().parents[1]


def sample():
    return json.loads((AI / "examples/example_analyze_request.json").read_text())


def test_bundle_integrity_without_deserialization():
    verify_bundle(DEFAULT_ARTIFACT_DIR)


def test_contract_and_feature_order():
    manifest = json.loads((DEFAULT_ARTIFACT_DIR / "manifest.json").read_text())
    request = AnalyzeRequest.model_validate(sample())
    x = prepare_X(request, manifest)
    assert list(x.columns) == manifest["feature_columns_in_order"]
    assert list(x.product_id.cat.categories) == manifest["product_id_categories"]
    assert x.day_of_week.iloc[0] == 2
    assert x.month.iloc[0] == 11
    with pytest.raises(ValueError, match="Lead time"):
        prepare_X(request.model_copy(update={"lead_time_days": 7}), manifest)


@pytest.mark.parametrize("field,value", [("store_id", "S002"), ("product_id", "P0021"),
                                          ("lead_time_days", True), ("feature_schema_version", "v2")])
def test_bad_request(field, value):
    payload = sample()
    payload[field] = value
    with pytest.raises(ValueError):
        AnalyzeRequest.model_validate(payload)


def test_calibration_formula_and_finite_checks():
    assert calibrated_quantiles(-2, -3, 5) == (0, 5)
    assert calibrated_quantiles(10, 3, 2) == (10, 10)
    assert calibrated_quantiles(10, 12, 2) == (10, 14)
    with pytest.raises(ValueError):
        calibrated_quantiles(float("nan"), 2, 0)
    payload = sample()
    payload["features"]["lag_1"] = float("inf")
    with pytest.raises(ValueError):
        AnalyzeRequest.model_validate(payload)


def test_http_contract_with_stub_only():
    class Stub:
        def predict(self, req):
            return AnalyzeResponse(store_id=req.store_id, product_id=req.product_id,
                                   as_of_date=req.as_of_date, horizon_days=req.lead_time_days,
                                   predicted_demand_p50=1, predicted_demand_p90=2,
                                   model_version="test-stub", feature_schema_version="features-v1",
                                   input_reference=req.input_reference)

    with TestClient(create_app(Stub)) as client:
        assert client.get("/health/ready").status_code == 200
        result = client.post("/analyze", json=sample())
        assert result.status_code == 200
        assert result.json()["model_version"] == "test-stub"
        assert client.post("/analyze", json={}).status_code == 422
