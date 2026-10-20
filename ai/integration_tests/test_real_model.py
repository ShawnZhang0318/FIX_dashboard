"""Real model smoke/regression test; no frontend, HTTP server or database needed.

Run explicitly: python -m pytest ai/integration_tests/test_real_model.py -v -s
Unlike ai/tests/, this test loads both joblib artifacts and runs actual inference.
"""
import json
import math
from time import perf_counter

import pytest

from ai.predictor import Predictor


def test_real_model_returns_required_fields_and_valid_forecast():
    # Fixed historical example from the v1 notebook; no frontend input required.
    request = {
        "store_id": "S001",
        "product_id": "P0001",
        "as_of_date": "2023-11-15",
        "lead_time_days": 3,
        "feature_schema_version": "features-v1",
        "input_reference": "S001/P0001/2023-11-15",
        "features": {
            "units_sold_today": 55.0,
            "lag_1": 56.0,
            "lag_7": 324.0,
            "lag_14": 15.0,
            "lag_28": 108.0,
            "rolling_mean_7": 129.714285714,
            "rolling_mean_28": 147.678571429,
            "rolling_std_28": 120.635678517,
        },
    }

    start = perf_counter()
    predictor = Predictor()  # Checksums + real joblib loading; no mock or fallback.
    loaded = perf_counter()
    response = predictor.predict(request).model_dump(mode="json")
    finished = perf_counter()

    required_fields = {
        "store_id", "product_id", "as_of_date", "horizon_days", "forecast_mode",
        "predicted_demand_p50", "predicted_demand_p90", "model_version",
        "feature_schema_version", "input_reference",
    }
    assert required_fields <= response.keys(), (
        f"Missing response fields: {required_fields - response.keys()}"
    )
    for field in ("store_id", "product_id", "as_of_date", "feature_schema_version", "input_reference"):
        assert response[field] == request[field], f"Response mismatch: {field}"
    assert type(response["horizon_days"]) is int
    assert response["horizon_days"] == 3
    assert response["forecast_mode"] == "quantile"
    assert response["model_version"] == "s001-global-q-v1"

    for field in ("predicted_demand_p50", "predicted_demand_p90"):
        value = response[field]
        assert type(value) in (int, float), f"{field} must be numeric"
        assert math.isfinite(value), f"{field} must be finite"
        assert value >= 0, f"{field} must be nonnegative"
    assert response["predicted_demand_p90"] >= response["predicted_demand_p50"]

    # Frozen notebook reference guards against plausible but incorrect predictions.
    # Allow small differences across supported numerical runtimes.
    assert response["predicted_demand_p50"] == pytest.approx(424.03519375145015, rel=1e-6, abs=1e-5)
    assert response["predicted_demand_p90"] == pytest.approx(648.0340855078196, rel=1e-6, abs=1e-5)
    serialized = json.dumps(response, ensure_ascii=False, allow_nan=False, indent=2)
    print("\nReal model response:\n" + serialized)
    print(f"Model load: {loaded - start:.3f}s; prediction: {finished - loaded:.3f}s")
