"""Stable, persisted log-query snapshots; exports never silently truncate."""
from datetime import datetime
import json
from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import Response
from local_backend import storage as s

router = APIRouter()
FILTERS = ("run_id", "job_id", "case_id", "request_id", "trace_id", "level", "service", "stage", "from", "to", "query")


def timestamp(value):
    try:
        dt = datetime.fromisoformat(value.replace("Z", "+00:00"))
        if dt.tzinfo is None:
            raise ValueError("Timezone missing")
        return dt
    except (ValueError, TypeError) as exc:
        raise HTTPException(422, "Log timestamps require an ISO timestamp with timezone") from exc


def snapshot(request, *, export=False):
    query = request.query_params
    if set(query) - set(FILTERS) - {"snapshot_id", "limit", "cursor"}:
        raise HTTPException(422, "Unsupported log filter")
    filters = {k: query[k] for k in FILTERS if query.get(k)}
    for key in ("from", "to"):
        if key in filters:
            timestamp(filters[key])
    if "from" in filters and "to" in filters and timestamp(filters["from"]) > timestamp(filters["to"]):
        raise HTTPException(422, "from must not exceed to")
    with s.connect() as db:
        db.execute("BEGIN IMMEDIATE")
        sid = query.get("snapshot_id")
        if sid:
            saved = db.execute("SELECT * FROM log_queries WHERE id=?", (sid,)).fetchone()
            if not saved:
                raise HTTPException(404, "Log snapshot not found")
            if json.loads(saved["filters"]) != filters:
                raise HTTPException(409, "Log filters differ from the frozen snapshot")
            return json.loads(saved["payload"])
        if export or query.get("cursor"):
            raise HTTPException(422, "Export and pagination require snapshot_id")
        ai_available = s.collect_ai_logs(db)
        rows = []
        for raw in db.execute("SELECT * FROM logs ORDER BY sequence DESC"):
            row = s.row_data(raw) | {"sequence": raw["sequence"]}
            if any(row.get(k) != v for k, v in filters.items() if k not in ("from", "to", "query")):
                continue
            if filters.get("from") and timestamp(row["timestamp"]) < timestamp(filters["from"]):
                continue
            if filters.get("to") and timestamp(row["timestamp"]) > timestamp(filters["to"]):
                continue
            if filters.get("query") and filters["query"].casefold() not in s.encode(row).casefold():
                continue
            rows.append(row)
        heartbeat = db.execute("SELECT value FROM metadata WHERE key='worker_heartbeat'").fetchone()
        worker_available = bool(heartbeat and (timestamp(s.utcnow())-timestamp(heartbeat[0])).total_seconds() < 30)
        services = [
            {"name": "api", "status": "available", "message": "Persisted API application events"},
            {"name": "worker", "status": "available" if worker_available else "partial",
             "message": "Persisted worker events; heartbeat " + ("current" if worker_available else "missing or stale")},
            {"name": "ai", "status": "available" if ai_available else "unavailable",
             "message": "Collected private AI application events; this is log coverage, not service liveness"},
        ]
        first = db.execute("SELECT data FROM logs ORDER BY sequence LIMIT 1").fetchone()
        payload = {"items": rows, "total": len(rows), "snapshot_id": str(s.uuid4()), "generated_at": s.utcnow(),
                   "order": "desc", "coverage": {
                       "status": "complete" if all(x["status"] == "available" for x in services) else "partial",
                       "services": services, "retained_from": s.row_data(first)["timestamp"] if first else None}}
        db.execute("INSERT INTO log_queries VALUES(?,?,?,?)",
                   (payload["snapshot_id"], payload["generated_at"], s.encode(filters), s.encode(payload)))
        return payload


@router.get("/logs")
def logs(request: Request):
    try:
        limit, offset = int(request.query_params.get("limit", 100)), int(request.query_params.get("cursor", 0))
    except ValueError as exc:
        raise HTTPException(422, "Invalid log page") from exc
    if not 1 <= limit <= 500 or offset < 0:
        raise HTTPException(422, "limit must be 1–500 and cursor nonnegative")
    payload = snapshot(request)
    if offset > payload["total"]:
        raise HTTPException(422, "Cursor exceeds frozen snapshot")
    end = offset+limit
    return payload | {"items": payload["items"][offset:end],
                      "next_cursor": str(end) if end < payload["total"] else None}


@router.get("/logs/export")
def export_logs(request: Request):
    payload = snapshot(request, export=True)
    return Response("".join(s.encode(x)+"\n" for x in payload["items"]), media_type="application/x-ndjson",
                    headers={"Content-Disposition": f'attachment; filename="fix-logs-{payload["snapshot_id"]}.ndjson"'})
