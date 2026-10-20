"""Add correlated real application logs without changing the teammate's AI."""
from contextvars import ContextVar
from datetime import datetime, timezone
import json
import logging
import os
from pathlib import Path
from threading import Lock
from time import perf_counter
import traceback
from uuid import uuid4

from ai.service import create_app
from ai.predictor import Predictor

STATE = Path(os.environ.get("FIX_LOCAL_STATE", Path(__file__).resolve().parents[1]/".local-integration"))
STATE.mkdir(parents=True, exist_ok=True)
correlation = ContextVar("ai_log_context", default={})
lock = Lock()


def record(event, message, *, level="INFO", error=None, **extra):
    row = {"id": str(uuid4()), "timestamp": datetime.now(timezone.utc).isoformat(),
           "service": "ai", "stage": "inference", "event": event, "level": level,
           "message": message, **correlation.get(), **extra}
    if error:
        row["error"] = {"type": type(error).__name__, "message": str(error),
                        "stack_trace": "".join(traceback.format_exception(error)), "retryable": False}
    with lock, (STATE/"ai-events.jsonl").open("a", encoding="utf-8") as f:
        f.write(json.dumps(row, ensure_ascii=False, allow_nan=False)+"\n")
        f.flush()


class StructuredHandler(logging.Handler):
    def emit(self, item):
        record("model."+str(item.msg).split()[0], item.getMessage(), level=item.levelname,
               error=item.exc_info[1] if item.exc_info else None)


model_logger = logging.getLogger("ai.service")
model_logger.setLevel(logging.INFO)
model_logger.addHandler(StructuredHandler())
def load_local_model():
    model = Predictor()
    # Single-row local inference does not benefit from all-core OpenMP overhead.
    # Only execution parallelism changes; the frozen trees/calibration stay intact.
    model.p50.set_params(n_jobs=1)
    model.p90.set_params(n_jobs=1)
    record("ai.ready", "Verified model artifacts loaded; inference threads=1")
    return model


app = create_app(predictor_factory=load_local_model)
record("ai.starting", "Private AI process starting; model readiness checked separately")


@app.middleware("http")
async def correlated(request, call_next):
    fields = {name: request.headers[header][:100] for name, header in (
        ("run_id", "x-run-id"), ("job_id", "x-job-id"), ("request_id", "x-request-id"),
        ("product_id", "x-product-id"), ("trace_id", "x-trace-id")) if request.headers.get(header)}
    token = correlation.set(fields)
    start = perf_counter()
    try:
        if request.url.path == "/analyze":
            record("inference.received", "Private inference request received")
        response = await call_next(request)
        if request.url.path == "/analyze":
            record("inference.responded", f"Private inference returned HTTP {response.status_code}",
                   level="ERROR" if response.status_code >= 500 else "WARNING" if response.status_code >= 400 else "INFO",
                   duration_ms=round((perf_counter()-start)*1000, 3))
        return response
    except Exception as exc:
        record("inference.failed", "Unhandled private AI request error", level="ERROR", error=exc)
        raise
    finally:
        correlation.reset(token)
