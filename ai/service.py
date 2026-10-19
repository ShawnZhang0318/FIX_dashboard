"""Private FastAPI service, following the starter's worker -> AI pattern."""
from contextlib import asynccontextmanager
import logging
import os
from time import perf_counter

from fastapi import FastAPI, HTTPException

from ai.predictor import DEFAULT_ARTIFACT_DIR, Predictor
from ai.schemas import AnalyzeRequest, AnalyzeResponse

logger = logging.getLogger(__name__)


def create_app(predictor_factory=None):
    @asynccontextmanager
    async def lifespan(app):
        factory = predictor_factory or (lambda: Predictor(
            os.environ.get("FIX_MODEL_DIR", DEFAULT_ARTIFACT_DIR)))
        app.state.predictor = factory()
        yield
        app.state.predictor = None

    app = FastAPI(title="F.I.X. AI Forecast Service", version="1.0.0", lifespan=lifespan)

    @app.get("/health/live")
    def live():
        return {"service": "ai", "status": "ok"}

    @app.get("/health/ready")
    def ready():
        if getattr(app.state, "predictor", None) is None:
            raise HTTPException(503, "Model not loaded")
        return {"service": "ai", "status": "ok"}

    @app.post("/analyze", response_model=AnalyzeResponse)
    def analyze(payload: AnalyzeRequest):
        predictor = getattr(app.state, "predictor", None)
        if predictor is None:
            raise HTTPException(503, "Model not loaded")
        start = perf_counter()
        try:
            result = predictor.predict(payload)
        except ValueError as exc:
            raise HTTPException(422, str(exc)) from exc
        except Exception as exc:
            logger.exception("forecast_failed")
            raise HTTPException(500, "Model inference failed") from exc
        logger.info("forecast_completed store=%s product=%s duration_seconds=%.6f",
                    payload.store_id, payload.product_id, perf_counter() - start)
        return result

    return app


app = create_app()
