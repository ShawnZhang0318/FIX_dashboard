"""Worker -> private AI transport. Never import this module in browser code."""
from datetime import date
import json
import math
from pathlib import Path

import httpx

from ai.features import build_request
from ai.predictor import DEFAULT_ARTIFACT_DIR
from ai.schemas import AnalyzeResponse


class ModelCallError(RuntimeError):
    """An explicit failed inference; callers must persist failure, not a fake forecast."""


class WorkerAIClient:
    def __init__(self, base_url="http://127.0.0.1:8001", *, timeout=30,
                 artifact_dir=DEFAULT_ARTIFACT_DIR, transport=None):
        self.manifest = json.loads((Path(artifact_dir) / "manifest.json").read_text(encoding="utf-8"))
        self.client = httpx.Client(base_url=base_url.rstrip("/"), timeout=timeout,
                                   transport=transport, trust_env=False)

    def close(self):
        self.client.close()

    def diagnostics(self, mode, request, *, policy_version, run_id, job_id, request_id):
        signals = ({"high_sales", "persistent_zero_stock"} if mode == "daily"
                   else {"persistent_high_sales", "persistent_low_sales", "long_stockout"})
        headers = {"X-Run-ID": run_id, "X-Job-ID": job_id,
                   "X-Request-ID": request_id, "X-Trace-ID": run_id}
        try:
            response = self.client.post(f"/diagnostics/{mode}", json=request, headers=headers)
            response.raise_for_status()
            result = response.json()
            expected = {key: request[key] for key in ("store_id", "as_of_date", "input_reference")}
            expected.update(mode=mode, policy_version=policy_version)
            if any(result.get(key) != value for key, value in expected.items()):
                raise ValueError("Diagnostics response identity or policy mismatch")
            if set(result["products"]) != set(self.manifest["product_id_categories"]):
                raise ValueError("Diagnostics response does not cover the model catalog")
            for findings in result["products"].values():
                if set(findings) != signals:
                    raise ValueError("Diagnostics response signals do not match the scan mode")
                for finding in findings.values():
                    if finding["status"] not in ("normal", "anomaly", "inventory_limited", "insufficient_data"):
                        raise ValueError("Invalid diagnostic finding status")
                high_sales = findings.get("high_sales")
                if high_sales and high_sales["status"] in ("normal", "anomaly"):
                    for key in ("baseline", "threshold"):
                        value = high_sales[key]
                        if type(value) not in (int, float) or not math.isfinite(value) or value < 0:
                            raise ValueError("Invalid daily sales diagnostic evidence")
            return result
        except (httpx.HTTPError, ValueError, KeyError, TypeError, AttributeError) as exc:
            raise ModelCallError(f"Private AI diagnostics failed: {exc}") from exc

    def predict(self, history, *, store_id, product_id, as_of_date, input_reference,
                run_id=None, job_id=None, request_id=None):
        cutoff = date.fromisoformat(str(as_of_date))
        if cutoff < date.fromisoformat(self.manifest["earliest_honest_backtest_origin"]):
            raise ModelCallError("This model requires an out-of-sample demo date on or after "
                                 + self.manifest["earliest_honest_backtest_origin"])
        if store_id != self.manifest["store_id"]:
            raise ModelCallError("Store does not match the loaded model")
        lead_time = self.manifest["product_lead_times"].get(product_id)
        if lead_time is None:
            raise ModelCallError("Product is not in the frozen model catalog")
        try:
            request = build_request(history, store_id=store_id, product_id=product_id,
                                    as_of_date=cutoff.isoformat(), lead_time_days=lead_time,
                                    input_reference=input_reference)
            # Correlation is metadata; do not add forbidden fields to the AI JSON schema.
            headers = {key: str(value) for key, value in {
                "X-Run-ID": run_id, "X-Job-ID": job_id, "X-Request-ID": request_id,
                "X-Product-ID": product_id,
                "X-Trace-ID": run_id,
            }.items() if value is not None}
            response = self.client.post("/analyze", json=request.model_dump(mode="json"), headers=headers)
            response.raise_for_status()
            result = AnalyzeResponse.model_validate(response.json())
            expected = {
                "store_id": store_id, "product_id": product_id,
                "as_of_date": cutoff, "horizon_days": lead_time,
                "model_version": self.manifest["model_version"],
                "feature_schema_version": self.manifest["feature_schema_version"],
                "input_reference": input_reference,
            }
            for field, value in expected.items():
                if getattr(result, field) != value:
                    raise ValueError(f"AI response mismatch: {field}")
            return result.model_dump(mode="json")
        except (httpx.HTTPError, ValueError) as exc:
            raise ModelCallError(f"Private AI call failed: {exc}") from exc
