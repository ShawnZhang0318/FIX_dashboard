"""Load a trusted, versioned bundle once; never train during requests."""
import hashlib
import json
import math
from pathlib import Path

from ai.features import prepare_X
from ai.schemas import AnalyzeRequest, AnalyzeResponse

DEFAULT_ARTIFACT_DIR = Path(__file__).parent / "artifacts" / "s001-global-q-v1"


def calibrated_quantiles(p50, p90_raw, correction):
    values = [float(p50), float(p90_raw), float(correction)]
    if not all(math.isfinite(v) for v in values) or values[2] < 0:
        raise ValueError("Invalid model output or calibration")
    median = max(0.0, values[0])
    return median, max(median, max(0.0, values[1]) + values[2])


def verify_bundle(directory):
    directory = Path(directory)
    expected_files = {"model_p50.joblib", "model_p90.joblib", "calibration.json",
                      "manifest.json", "feature_schema_v1.json", "product_catalog_v1.csv"}
    checksums = json.loads((directory / "checksums.json").read_text(encoding="utf-8"))
    if set(checksums) != expected_files:
        raise ValueError("Incomplete bundle checksum manifest")
    for name, digest in checksums.items():
        if hashlib.sha256((directory / name).read_bytes()).hexdigest() != digest:
            raise ValueError(f"Artifact checksum mismatch: {name}")


class Predictor:
    def __init__(self, artifact_dir=DEFAULT_ARTIFACT_DIR):
        import joblib

        directory = Path(artifact_dir)
        verify_bundle(directory)
        self.manifest = json.loads((directory / "manifest.json").read_text())
        schema = json.loads((directory / "feature_schema_v1.json").read_text())
        self.calibration = json.loads((directory / "calibration.json").read_text())
        if schema["model_feature_columns"] != self.manifest["feature_columns_in_order"]:
            raise ValueError("Feature schema mismatch")
        if schema["version"] != self.manifest["feature_schema_version"]:
            raise ValueError("Feature version mismatch")
        self.p50 = joblib.load(directory / "model_p50.joblib")
        self.p90 = joblib.load(directory / "model_p90.joblib")
        for model in (self.p50, self.p90):
            if list(model.feature_name_) != self.manifest["feature_columns_in_order"]:
                raise ValueError("Model feature order mismatch")

    def predict(self, request):
        request = AnalyzeRequest.model_validate(request)
        if request.store_id != self.manifest["store_id"]:
            raise ValueError("Unsupported store")
        x = prepare_X(request, self.manifest)
        correction = self.calibration["correction_by_lead_time_days"][str(request.lead_time_days)]
        p50, p90 = calibrated_quantiles(self.p50.predict(x)[0], self.p90.predict(x)[0], correction)
        return AnalyzeResponse(store_id=request.store_id, product_id=request.product_id,
                               as_of_date=request.as_of_date, horizon_days=request.lead_time_days,
                               predicted_demand_p50=p50, predicted_demand_p90=p90,
                               model_version=self.manifest["model_version"],
                               feature_schema_version=request.feature_schema_version,
                               input_reference=request.input_reference)
