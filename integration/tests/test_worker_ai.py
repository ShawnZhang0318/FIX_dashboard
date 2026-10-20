from datetime import date, timedelta
import json

import httpx
import pytest

from integration.worker_ai import ModelCallError, WorkerAIClient


def history():
    return [{"store_id": "S001", "product_id": "P0001",
             "date": (date(2023, 11, 15) - timedelta(days=i)).isoformat(),
             "units_sold": 10, "demand_forecast_benchmark": 999999,
             "inventory_level": 500} for i in range(29)]


ARGS = dict(store_id="S001", product_id="P0001", as_of_date="2023-11-15",
            input_reference="test/frozen-manifest", run_id="run1", job_id="job1")


def output(request):
    body = json.loads(request.content)
    return {key: body[key] for key in ["store_id", "product_id", "as_of_date",
                                      "feature_schema_version", "input_reference"]} | {
        "horizon_days": 3, "forecast_mode": "quantile", "predicted_demand_p50": 30,
        "predicted_demand_p90": 40, "model_version": "s001-global-q-v1"}


def test_worker_transport_excludes_benchmark_stock_and_future_and_correlates_headers():
    calls = []
    def serve(request):
        calls.append(request)
        return httpx.Response(200, json=output(request))
    client = WorkerAIClient(transport=httpx.MockTransport(serve))
    try:
        rows = history() + [{"store_id": "S001", "product_id": "P0001",
                             "date": "2023-11-16", "units_sold": 999999}]
        result = client.predict(rows, **ARGS)
        body = json.loads(calls[0].content)
        assert result["predicted_demand_p90"] == 40
        assert body["features"]["units_sold_today"] == 10
        assert not any(key in str(body) for key in ["benchmark", "inventory_level", "999999"])
        assert calls[0].headers["X-Run-ID"] == "run1"
        assert calls[0].headers["X-Job-ID"] == "job1"
        assert calls[0].url.path == "/analyze"
    finally:
        client.close()


@pytest.mark.parametrize("changed", [
    {"store_id": "S002"}, {"product_id": "P0002"}, {"horizon_days": 7},
    {"model_version": "another-model"}, {"input_reference": "different-input"},
    {"predicted_demand_p50": 50, "predicted_demand_p90": 40},
])
def test_rejects_wrong_identity_horizon_version_and_invalid_quantiles(changed):
    client = WorkerAIClient(transport=httpx.MockTransport(
        lambda req: httpx.Response(200, json=output(req) | changed)))
    try:
        with pytest.raises(ModelCallError):
            client.predict(history(), **ARGS)
    finally:
        client.close()


def test_no_retry_no_fallback_and_no_in_sample_demo():
    calls = []
    def unavailable(request):
        calls.append(request)
        return httpx.Response(503, json={"detail": "Model unavailable"})
    client = WorkerAIClient(transport=httpx.MockTransport(unavailable))
    try:
        with pytest.raises(ModelCallError):
            client.predict(history(), **ARGS)
        assert len(calls) == 1
        with pytest.raises(ModelCallError, match="out-of-sample"):
            client.predict(history(), **(ARGS | {"as_of_date": "2022-06-30"}))
        assert len(calls) == 1
        with pytest.raises(ModelCallError, match="29|28"):
            client.predict(history()[:-1], **ARGS)
    finally:
        client.close()
