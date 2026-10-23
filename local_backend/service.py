"""Loopback integration API with SQLite and PostgreSQL persistence."""
from contextlib import asynccontextmanager
from datetime import date, datetime, timedelta
import json
import os
from time import perf_counter
from typing import Literal
from uuid import uuid4

from fastapi import FastAPI, HTTPException, Request, Query
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from local_backend import storage as s
from local_backend.schemas import SnapshotBatch, RunRequest, Review


@asynccontextmanager
async def lifespan(app):
    s.initialize()
    database = "PostgreSQL" if s.is_postgres() else "local SQLite"
    s.log("api", "startup", "api.started", f"{database} integration API started")
    yield


app = FastAPI(title="F.I.X. Local Integration API", lifespan=lifespan)
configured_origins = [
    origin.strip()
    for origin in os.environ.get("FIX_ALLOWED_ORIGINS", "").split(",")
    if origin.strip()
]
app.add_middleware(
    CORSMiddleware,
    allow_origins=configured_origins or [
        f"http://{host}:{port}"
        for host in ("127.0.0.1", "localhost")
        for port in (5173, 5174)
    ],
    allow_methods=["GET", "POST"], allow_headers=["Content-Type", "X-Request-ID"],
    expose_headers=["X-Request-ID"], allow_credentials=False,
)


@app.middleware("http")
async def trace_request(request: Request, call_next):
    start = perf_counter()
    supplied = request.headers.get("x-request-id", "")
    request.state.request_id = supplied if 0 < len(supplied) <= 100 and supplied.isascii() else str(uuid4())
    s.log("api", "http", "request.received", f"{request.method} request received",
          request_id=request.state.request_id)
    try:
        response = await call_next(request)
    except Exception as exc:
        s.log("api", "http", "request.failed", "Unhandled API failure", level="ERROR", error=exc,
              request_id=request.state.request_id)
        response = JSONResponse({"detail": "Internal API error; inspect correlated backend logs"}, status_code=500)
    # Log the route template, never reviewer text or submitted bodies.
    route = getattr(request.scope.get("route"), "path", request.url.path)
    context = {k: v for k, v in request.path_params.items() if k in ("run_id", "case_id")}
    if getattr(request.state, "run_id", None):
        context["run_id"] = request.state.run_id
    if context:
        with s.connect() as db:
            if context.get("case_id"):
                case = db.execute("SELECT run_id FROM cases WHERE id=?", (context["case_id"],)).fetchone()
                if case:
                    context["run_id"] = case[0]
            job = db.execute("SELECT id FROM jobs WHERE run_id=?", (context.get("run_id"),)).fetchone()
            if job:
                context["job_id"] = job[0]
    s.log("api", "http", "request.completed", f"{request.method} {route} → {response.status_code}",
          level="WARNING" if response.status_code >= 400 else "INFO",
          request_id=request.state.request_id, duration_ms=round((perf_counter()-start)*1000, 3), **context)
    response.headers["X-Request-ID"] = request.state.request_id
    return response


def require(value):
    if value is None:
        raise HTTPException(404, "Resource not found")
    return value


@app.get("/health/live")
def live():
    return {"service": "api", "status": "ok",
            "database": "PostgreSQL" if s.is_postgres() else "local SQLite"}


@app.get("/health/ready")
def ready():
    with s.connect() as db:
        db.execute("SELECT 1").fetchone()
        heartbeat = db.execute("SELECT value FROM metadata WHERE key='worker_heartbeat'").fetchone()
    available = bool(heartbeat and (datetime.fromisoformat(s.utcnow()) - datetime.fromisoformat(heartbeat[0])).total_seconds() < 30)
    return JSONResponse({"service": "api", "database": "available", "worker": "available" if available else "unavailable"},
                        status_code=200 if available else 503)


@app.get("/inventory")
def inventory(store_id: Literal["S001"] = "S001"):
    with s.connect() as db:
        return [s.row_data(r) for r in db.execute("SELECT data FROM inventory WHERE store_id=? ORDER BY product_id", (store_id,))]


@app.get("/inventory/{store_id}/{product_id}")
def inventory_item(store_id: Literal["S001"], product_id: str):
    with s.connect() as db:
        return require(s.row_data(db.execute("SELECT data FROM inventory WHERE store_id=? AND product_id=?", (store_id, product_id)).fetchone()))


@app.get("/snapshots")
def snapshots(store_id: Literal["S001"] = "S001", product_id: str | None = None,
              start: date | None = Query(None, alias="from"), end: date | None = Query(None, alias="to")):
    if start and end and start > end:
        raise HTTPException(422, "from must not exceed to")
    sql, params = "SELECT data FROM snapshots WHERE store_id=?", [store_id]
    for column, op, value in (("product_id", "=", product_id), ("snapshot_date", ">=", start), ("snapshot_date", "<=", end)):
        if value is not None:
            sql += f" AND {column}{op}?"
            params.append(str(value))
    with s.connect() as db:
        return [s.row_data(r) for r in db.execute(sql+" ORDER BY snapshot_date,product_id", params)]


@app.post("/snapshots", status_code=201)
def ingest(payload: SnapshotBatch, request: Request):
    try:
        with s.connect() as db:
            s.begin_write(db)
            result = s.ingest(db, [x.model_dump(mode="json") for x in payload.snapshots], payload.source_file_sha256.lower())
            s.event(db, "api", "ingestion", "snapshots.committed", f"Committed {result['inserted_count']} snapshots",
                    request_id=request.state.request_id, context={"source_sha256": payload.source_file_sha256})
            return result
    except s.integrity_errors() as exc:
        raise HTTPException(409, "Duplicate snapshot identity; entire batch rolled back") from exc


@app.post("/analysis-runs", status_code=202)
def create_run(payload: RunRequest, request: Request):
    cutoff = payload.as_of_date.isoformat()
    if cutoff < s.MANIFEST["earliest_honest_backtest_origin"]:
        raise HTTPException(422, "This trained/calibrated model requires a cutoff on or after 2023-09-01")
    with s.connect() as db:
        s.begin_write(db)
        current = list(db.execute("SELECT * FROM snapshots WHERE store_id=? AND snapshot_date=? ORDER BY product_id",
                                  (payload.store_id, cutoff)))
        if {r["product_id"] for r in current} != set(s.MANIFEST["product_id_categories"]):
            raise HTTPException(422, "Cutoff requires snapshots for all 20 products in S001")
        selected = []
        for row in current:
            data = s.row_data(row)
            previous = db.execute("SELECT data FROM snapshots WHERE store_id=? AND product_id=? AND snapshot_date=?",
                                  (payload.store_id, row["product_id"], str(payload.as_of_date-timedelta(days=1)))).fetchone()
            if data["units_sold"] == 0 and previous and data["inventory_level"] == s.row_data(previous)["inventory_level"]:
                continue
            history = list(db.execute("""SELECT id,snapshot_date,source_sha256 FROM snapshots
              WHERE store_id=? AND product_id=? AND snapshot_date BETWEEN ? AND ? ORDER BY snapshot_date""",
              (payload.store_id, row["product_id"], str(payload.as_of_date-timedelta(days=28)), cutoff)))
            expected = {str(payload.as_of_date-timedelta(days=n)) for n in range(29)}
            if {r["snapshot_date"] for r in history} != expected:
                raise HTTPException(422, f"{row['product_id']}: requires 29 consecutive daily snapshots; no cold-start fallback")
            selected.append({"product_id": row["product_id"], "snapshot_id": row["id"],
                             "history": [dict(h) for h in history]})
        run_id, job_id, now = str(uuid4()), str(uuid4()), s.utcnow()
        request.state.run_id = run_id
        ref = f"{'postgresql' if s.is_postgres() else 'sqlite'}:run/{run_id}/frozen-input"
        frozen = {"input_reference": ref, "store_id": payload.store_id, "as_of_date": cutoff,
                  "products": selected, "policy": s.POLICY, "model_version": s.MANIFEST["model_version"],
                  "feature_schema_version": s.MANIFEST["feature_schema_version"],
                  "model_manifest_sha256": s.hashlib.sha256((s.MODEL_DIR/"manifest.json").read_bytes()).hexdigest(),
                  "request_id": request.state.request_id}
        data = {"id": run_id, **payload.model_dump(mode="json"), "created_at": now, "started_at": None,
                "completed_at": None, "processed_count": 0, "expected_count": len(selected), "partial": False,
                "error": None, "input_reference": ref, "model_version": frozen["model_version"],
                "policy_version": s.POLICY["version"]}
        s.insert_run(db, run_id, job_id, payload, cutoff, ref, now, data, frozen)
        s.event(db, "api", "queue", "run.queued", f"Run and job committed; {len(selected)} selected products",
                run_id=run_id, job_id=job_id, request_id=request.state.request_id)
        return {"analysis_run": {"id": run_id, "status": "queued"}, "job": {"id": job_id, "status": "pending"}}


@app.get("/analysis-runs/{run_id}")
def get_run(run_id: str):
    with s.connect() as db:
        return require(s.run_data(db, run_id))


@app.get("/analysis-runs/{run_id}/results")
def results(run_id: str):
    with s.connect() as db:
        db.execute("BEGIN")
        run = require(s.run_data(db, run_id))
        return {"status": run["status"], "partial": run["partial"],
                "results": [s.row_data(r) for r in db.execute("SELECT data FROM results WHERE run_id=? ORDER BY product_id", (run_id,))]}


@app.get("/exceptions")
def exceptions(store_id: Literal["S001"] = "S001", run_id: str | None = None,
               status: Literal["pending_review", "approved", "modified", "rejected", "resolved"] | None = None):
    sql, params = "SELECT id FROM cases WHERE 1=1", []
    for col, value in (("run_id", run_id), ("status", status)):
        if value:
            sql += f" AND {col}=?"
            params.append(value)
    with s.connect() as db:
        db.execute("BEGIN")
        order = "created_at DESC,id DESC" if s.is_postgres() else "rowid DESC"
        return [s.case_data(db, r[0]) for r in db.execute(sql+f" ORDER BY {order}", params)]


@app.get("/exceptions/{case_id}")
def exception(case_id: str):
    with s.connect() as db:
        return require(s.case_data(db, case_id))


@app.post("/exceptions/{case_id}/review")
def review(case_id: str, payload: Review, request: Request):
    with s.connect() as db:
        s.begin_write(db)
        if s.is_postgres():
            db.execute("SELECT id FROM cases WHERE id=? FOR UPDATE", (case_id,)).fetchone()
        case = require(s.case_data(db, case_id))
        if case["status"] != "pending_review" or case["parent_run_status"] != "completed" or case["partial"]:
            raise HTTPException(409, "Only pending cases from complete runs may be reviewed")
        decision = payload.decision
        if (case["exception_type"] == "anomaly") != (decision == "resolve"):
            raise HTTPException(422, "Decision is incompatible with this case type")
        if (decision != "approve" or case["exception_type"] == "reorder_and_anomaly") and not payload.override_reason:
            raise HTTPException(422, "A review reason is required")
        if decision == "modify" and payload.reviewer_order_quantity is None:
            raise HTTPException(422, "Modify requires an explicit nonnegative integer quantity")
        if decision in ("approve", "resolve") and payload.reviewer_order_quantity is not None:
            raise HTTPException(422, "Approve and resolve do not accept a submitted quantity")
        if decision == "reject" and payload.reviewer_order_quantity not in (None, 0):
            raise HTTPException(422, "Reject must record zero quantity")
        quantity = {"approve": case["result"]["recommended_order_quantity"], "modify": payload.reviewer_order_quantity,
                    "reject": 0, "resolve": None}[decision]
        state = {"approve": "approved", "modify": "modified", "reject": "rejected", "resolve": "resolved"}[decision]
        data = {k: v for k, v in case.items() if k not in ("result", "parent_run_status", "partial", "status")}
        data.update(reviewer_decision=decision, reviewer_order_quantity=quantity, reviewer_label=payload.reviewer_label,
                    override_reason=payload.override_reason, reviewed_at=s.utcnow())
        s.set_case_review(db, case_id, state, data)
        s.event(db, "api", "review", "review.committed", f"Advisory decision saved: {decision}; stock unchanged",
                case_id=case_id, run_id=case["analysis_run_id"],
                job_id=s.run_data(db, case["analysis_run_id"])["job"]["id"], request_id=request.state.request_id)
        return s.case_data(db, case_id)


# A snapshot freezes the matching log set for pagination and complete export.
from local_backend.log_api import router as log_router
app.include_router(log_router)
