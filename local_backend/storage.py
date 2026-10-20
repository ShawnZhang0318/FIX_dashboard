import hashlib
import json
import os
from pathlib import Path
import sqlite3
import traceback
from datetime import datetime, timezone
from uuid import uuid4
from contextlib import contextmanager

ROOT = Path(__file__).resolve().parents[1]
STATE = Path(os.environ.get("FIX_LOCAL_STATE", ROOT / ".local-integration")).resolve()
DB_PATH = STATE / "fix.sqlite3"
MODEL_DIR = ROOT / "ai/artifacts/s001-global-q-v1"
MANIFEST = json.loads((MODEL_DIR / "manifest.json").read_text(encoding="utf-8"))
POLICY = {
    "version": "local-integration-policy-v1",
    "lead_times": MANIFEST["product_lead_times"],
    "catalog_sha256": MANIFEST["product_catalog_sha256"],
    "unusual_sales_ratio": 2.0, "unusual_sales_minimum": 5,
    "note": "Frozen synthetic lead times; rule-based anomalies in worker, not AI output.",
}


def utcnow():
    return datetime.now(timezone.utc).isoformat()


def encode(value):
    return json.dumps(value, ensure_ascii=False, allow_nan=False, separators=(",", ":"))


@contextmanager
def connect():
    STATE.mkdir(parents=True, exist_ok=True)
    db = sqlite3.connect(DB_PATH, timeout=15)
    db.row_factory = sqlite3.Row
    db.execute("PRAGMA foreign_keys=ON")
    try:
        with db:
            yield db
    finally:
        db.close()


def initialize():
    with connect() as db:
        db.execute("PRAGMA journal_mode=WAL")
        version = db.execute("PRAGMA user_version").fetchone()[0]
        if version not in (0, 1):
            raise RuntimeError("Unsupported local schema revision")
        db.executescript("""
        CREATE TABLE IF NOT EXISTS products(id TEXT PRIMARY KEY);
        CREATE TABLE IF NOT EXISTS snapshots(
          id TEXT PRIMARY KEY, store_id TEXT NOT NULL CHECK(store_id='S001'),
          product_id TEXT NOT NULL REFERENCES products(id), snapshot_date TEXT NOT NULL,
          source_sha256 TEXT NOT NULL, data TEXT NOT NULL,
          UNIQUE(store_id,product_id,snapshot_date));
        CREATE TABLE IF NOT EXISTS inventory(
          store_id TEXT NOT NULL, product_id TEXT NOT NULL REFERENCES products(id),
          snapshot_id TEXT NOT NULL REFERENCES snapshots(id),
          snapshot_date TEXT NOT NULL, data TEXT NOT NULL, PRIMARY KEY(store_id,product_id));
        CREATE TABLE IF NOT EXISTS runs(
          id TEXT PRIMARY KEY, status TEXT NOT NULL CHECK(status IN ('queued','processing','completed','failed')),
          created_at TEXT NOT NULL, data TEXT NOT NULL, frozen_input TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS jobs(
          id TEXT PRIMARY KEY, run_id TEXT NOT NULL UNIQUE REFERENCES runs(id),
          status TEXT NOT NULL CHECK(status IN ('pending','claimed','completed','failed')));
        CREATE INDEX IF NOT EXISTS pending_jobs ON jobs(status);
        CREATE TABLE IF NOT EXISTS results(
          id TEXT PRIMARY KEY, run_id TEXT NOT NULL REFERENCES runs(id),
          product_id TEXT NOT NULL REFERENCES products(id), snapshot_id TEXT NOT NULL REFERENCES snapshots(id),
          data TEXT NOT NULL, UNIQUE(run_id,product_id));
        CREATE TABLE IF NOT EXISTS cases(
          id TEXT PRIMARY KEY, run_id TEXT NOT NULL REFERENCES runs(id),
          result_id TEXT NOT NULL UNIQUE REFERENCES results(id),
          status TEXT NOT NULL CHECK(status IN ('pending_review','approved','modified','rejected','resolved')),
          data TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS logs(
          sequence INTEGER PRIMARY KEY AUTOINCREMENT, id TEXT UNIQUE NOT NULL, data TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS log_queries(
          id TEXT PRIMARY KEY, created_at TEXT NOT NULL, filters TEXT NOT NULL, payload TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS metadata(key TEXT PRIMARY KEY,value TEXT NOT NULL);
        PRAGMA user_version=1;
        """)


def event(db, service, stage, name, message, *, level="INFO", error=None, **context):
    row = {"id": str(uuid4()), "timestamp": utcnow(), "level": level, "service": service,
           "stage": stage, "event": name, "message": message}
    row.update({k: v for k, v in context.items() if v is not None})
    if row.get("run_id") or row.get("request_id"):
        row.setdefault("trace_id", row.get("run_id") or row["request_id"])
    if error:
        row["error"] = {"type": type(error).__name__, "message": str(error),
                        "stack_trace": "".join(traceback.format_exception(error)), "retryable": False}
    db.execute("INSERT INTO logs(id,data) VALUES(?,?)", (row["id"], encode(row)))


def log(service, stage, name, message, **context):
    with connect() as db:
        event(db, service, stage, name, message, **context)


def row_data(row):
    return json.loads(row["data"]) if row else None


def run_data(db, run_id):
    row = db.execute("SELECT * FROM runs WHERE id=?", (run_id,)).fetchone()
    if not row:
        return None
    data = row_data(row)
    data["status"] = row["status"]
    job = db.execute("SELECT id,status FROM jobs WHERE run_id=?", (run_id,)).fetchone()
    data["job"] = dict(job)
    return data


def case_data(db, case_id):
    row = db.execute("SELECT * FROM cases WHERE id=?", (case_id,)).fetchone()
    if not row:
        return None
    run = run_data(db, row["run_id"])
    return row_data(row) | {"status": row["status"], "parent_run_status": run["status"],
                           "partial": run["partial"],
                           "result": row_data(db.execute("SELECT data FROM results WHERE id=?", (row["result_id"],)).fetchone())}


def ingest(db, snapshots, source_sha256):
    ids = []
    for item in snapshots:
        data = dict(item)
        sid = str(uuid4())
        data["id"] = sid
        data["created_at"] = utcnow()
        data["source_file_sha256"] = source_sha256
        db.execute("INSERT OR IGNORE INTO products(id) VALUES(?)", (data["product_id"],))
        db.execute("INSERT INTO snapshots VALUES(?,?,?,?,?,?)",
                   (sid, data["store_id"], data["product_id"], data["snapshot_date"], source_sha256, encode(data)))
        current = {"store_id": data["store_id"], "product_id": data["product_id"],
                   "on_hand_quantity": data["inventory_level"], "snapshot_date": data["snapshot_date"],
                   "source_snapshot_id": sid, "category": data["category_raw"],
                   "lead_time_days": POLICY["lead_times"][data["product_id"]],
                   "policy_version": POLICY["version"]}
        db.execute("""INSERT INTO inventory VALUES(?,?,?,?,?)
          ON CONFLICT(store_id,product_id) DO UPDATE SET snapshot_id=excluded.snapshot_id,
          snapshot_date=excluded.snapshot_date,data=excluded.data
          WHERE excluded.snapshot_date > inventory.snapshot_date""",
                   (data["store_id"], data["product_id"], sid, data["snapshot_date"], encode(current)))
        ids.append(sid)
    return {"inserted_count": len(ids), "snapshot_ids": ids}


def collect_ai_logs(db):
    """AI writes a local log file; only the collector accesses the application DB."""
    path = STATE / "ai-events.jsonl"
    if not path.exists():
        return False
    with path.open("rb") as source:
        saved = db.execute("SELECT value FROM metadata WHERE key='ai_log_offset'").fetchone()
        offset = int(saved[0]) if saved else 0
        if path.stat().st_size < offset:
            offset = 0
        source.seek(offset)
        while line := source.readline():
            if not line.endswith(b"\n"):
                break
            row = json.loads(line)
            db.execute("INSERT OR IGNORE INTO logs(id,data) VALUES(?,?)", (row["id"], encode(row)))
            offset = source.tell()
        db.execute("INSERT OR REPLACE INTO metadata VALUES('ai_log_offset',?)", (str(offset),))
    return True
