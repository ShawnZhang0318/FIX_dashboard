import hashlib
import json
import os
from pathlib import Path
import sqlite3
import traceback
from datetime import date, datetime, timezone
from uuid import uuid4
from contextlib import contextmanager

ROOT = Path(__file__).resolve().parents[1]
STATE = Path(os.environ.get("FIX_LOCAL_STATE", ROOT / ".local-integration")).resolve()
DB_PATH = STATE / "fix.sqlite3"
DATABASE_URL = os.environ.get("FIX_DATABASE_URL", "").strip()
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


class _HybridRow:
    def __init__(self, values, columns):
        self._values = values
        self._columns = columns

    def __getitem__(self, key):
        if isinstance(key, int):
            value = self._values[key]
        else:
            value = self._values[self._columns.index(key)]
        if isinstance(value, (date, datetime)):
            return value.isoformat()
        return value

    def keys(self):
        return self._columns


class _PostgresResult:
    def __init__(self, cursor):
        self._cursor = cursor
        self._columns = [column.name for column in cursor.description] if cursor.description else []

    def _row(self, values):
        return _HybridRow(values, self._columns) if values is not None else None

    def fetchone(self):
        return self._row(self._cursor.fetchone())

    def fetchall(self):
        return [self._row(row) for row in self._cursor.fetchall()]

    def __iter__(self):
        for values in self._cursor:
            yield self._row(values)


class _PostgresConnection:
    def __init__(self, connection):
        self._connection = connection

    def execute(self, statement, parameters=()):
        return _PostgresResult(self._connection.execute(statement.replace("?", "%s"), parameters))


def is_postgres():
    if not DATABASE_URL:
        return False
    if not DATABASE_URL.startswith(("postgresql://", "postgres://")):
        raise RuntimeError("FIX_DATABASE_URL must use a PostgreSQL URL (postgresql://) or be unset for SQLite")
    return True


def integrity_errors():
    if is_postgres():
        import psycopg
        return (psycopg.IntegrityError,)
    return (sqlite3.IntegrityError,)


def begin_write(db):
    db.execute("BEGIN" if is_postgres() else "BEGIN IMMEDIATE")


@contextmanager
def connect():
    if is_postgres():
        import psycopg
        from psycopg.rows import tuple_row

        url = DATABASE_URL.replace("postgres://", "postgresql://", 1)
        with psycopg.connect(url, row_factory=tuple_row) as connection:
            yield _PostgresConnection(connection)
        return
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
    if is_postgres():
        migrations_dir = ROOT / "local_backend" / "migrations"
        migrations = sorted(migrations_dir.glob("[0-9][0-9][0-9]_*.sql"))
        with connect() as db:
            db.execute("CREATE TABLE IF NOT EXISTS schema_migrations (version INTEGER PRIMARY KEY, applied_at TIMESTAMPTZ NOT NULL DEFAULT now())")
            db.execute("SELECT pg_advisory_xact_lock(843119027)")
            latest = int(migrations[-1].name.split("_", 1)[0]) if migrations else 0
            unsupported = db.execute("SELECT version FROM schema_migrations WHERE version > ?", (latest,)).fetchone()
            if unsupported:
                raise RuntimeError(f"Unsupported PostgreSQL schema revision: {unsupported[0]}")
            applied = {row[0] for row in db.execute("SELECT version FROM schema_migrations")}
            pending_versions = [int(path.name.split("_", 1)[0]) for path in migrations
                                if int(path.name.split("_", 1)[0]) not in applied]
            if pending_versions and any(version > pending_versions[0] for version in applied):
                raise RuntimeError("PostgreSQL schema migration history has a missing revision")
            for path in migrations:
                version = int(path.name.split("_", 1)[0])
                if version in applied:
                    continue
                for statement in path.read_text(encoding="utf-8").split(";"):
                    if statement.strip():
                        db.execute(statement)
                db.execute("INSERT INTO schema_migrations(version) VALUES(?)", (version,))
        return
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
    if is_postgres():
        job = db.execute("""SELECT id,status FROM jobs WHERE run_id=?
                            ORDER BY created_at DESC,id DESC LIMIT 1""", (run_id,)).fetchone()
    else:
        job = db.execute("SELECT id,status FROM jobs WHERE run_id=?", (run_id,)).fetchone()
    data["job"] = dict(job)
    return data


def insert_run(db, run_id, job_id, payload, cutoff, input_reference, now, data, frozen):
    if is_postgres():
        db.execute("""INSERT INTO runs(
                        id,store_id,run_type,as_of_date,status,input_reference,created_at,data,frozen_input
                      ) VALUES(?,?,?,?,?,?,?,?,?)""",
                   (run_id, payload.store_id, payload.run_type, cutoff, "queued", input_reference,
                    now, encode(data), encode(frozen)))
        db.execute("""INSERT INTO jobs(id,run_id,job_type,status,attempts,created_at)
                      VALUES(?,?,?,'pending',0,?)""", (job_id, run_id, "forecast", now))
    else:
        db.execute("INSERT INTO runs VALUES(?,?,?,?,?)", (run_id, "queued", now, encode(data), encode(frozen)))
        db.execute("INSERT INTO jobs VALUES(?,?,?)", (job_id, run_id, "pending"))


def set_run_state(db, run_id, status, data, *, started_at=None, completed_at=None):
    if is_postgres():
        db.execute("""UPDATE runs SET status=COALESCE(?,status),data=?,
                      started_at=COALESCE(?,started_at),completed_at=COALESCE(?,completed_at)
                      WHERE id=?""", (status, encode(data), started_at, completed_at, run_id))
    else:
        if status is None:
            db.execute("UPDATE runs SET data=? WHERE id=?", (encode(data), run_id))
        else:
            db.execute("UPDATE runs SET status=?,data=? WHERE id=?", (status, encode(data), run_id))


def set_job_state(db, job_id, status, *, claimed_at=None, completed_at=None, error=None):
    if is_postgres():
        db.execute("""UPDATE jobs SET status=?,claimed_at=COALESCE(?,claimed_at),
                      completed_at=COALESCE(?,completed_at),error=? WHERE id=?""",
                   (status, claimed_at, completed_at, str(error) if error else None, job_id))
    else:
        db.execute("UPDATE jobs SET status=? WHERE id=?", (status, job_id))


def insert_result(db, result, product_id, snapshot_id):
    if is_postgres():
        db.execute("""INSERT INTO results(
                        id,run_id,store_id,product_id,snapshot_id,horizon_days,predicted_demand_p50,
                        predicted_demand_p90,inventory_at_prediction,safety_stock,recommended_order_quantity,
                        anomaly_score,anomaly_type,anomaly_severity,anomaly_threshold,explanation,model_version,input_reference,
                        policy_version,processed_at,duration_ms,data
                      ) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)""",
                   (result["id"], result["analysis_run_id"], result["store_id"], product_id, snapshot_id,
                    result["horizon_days"], result["predicted_demand_p50"], result["predicted_demand_p90"],
                    result["inventory_at_prediction"], result["safety_stock"],
                    result["recommended_order_quantity"], result["anomaly_score"], result["anomaly_type"],
                    result["anomaly_severity"],
                    result["anomaly_threshold"], result["explanation"], result["model_version"],
                    result["input_reference"], result["policy_version"], result["processed_at"],
                    result["duration_ms"], encode(result)))
    else:
        db.execute("INSERT INTO results VALUES(?,?,?,?,?)",
                   (result["id"], result["analysis_run_id"], product_id, snapshot_id, encode(result)))


def insert_case(db, case, status):
    if is_postgres():
        db.execute("""INSERT INTO cases(
                        id,run_id,result_id,exception_type,status,created_at,data
                      ) VALUES(?,?,?,?,?,?,?)""",
                   (case["id"], case["analysis_run_id"], case["forecast_result_id"],
                    case["exception_type"], status, case["created_at"], encode(case)))
    else:
        db.execute("INSERT INTO cases VALUES(?,?,?,?,?)",
                   (case["id"], case["analysis_run_id"], case["forecast_result_id"], status, encode(case)))


def set_case_review(db, case_id, state, data):
    if is_postgres():
        db.execute("""UPDATE cases SET status=?,reviewer_decision=?,reviewer_order_quantity=?,
                      reviewer_identity=?,override_reason=?,reviewed_at=?,data=?
                      WHERE id=? AND status='pending_review'""",
                   (state, data["reviewer_decision"], data["reviewer_order_quantity"],
                    data["reviewer_label"], data["override_reason"], data["reviewed_at"],
                    encode(data), case_id))
    else:
        db.execute("UPDATE cases SET status=?,data=? WHERE id=? AND status='pending_review'",
                   (state, encode(data), case_id))


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
    affected_products = set()
    for item in snapshots:
        data = dict(item)
        affected_products.add(data["product_id"])
        sid = str(uuid4())
        data["id"] = sid
        data["created_at"] = utcnow()
        data["source_file_sha256"] = source_sha256
        if is_postgres():
            db.execute("""INSERT INTO products(id,name)
                          VALUES(?,?) ON CONFLICT(id) DO NOTHING""",
                       (data["product_id"], data["product_id"]))
            db.execute("""INSERT INTO snapshots(
                            id,store_id,product_id,snapshot_date,source_sha256,inventory_level,units_sold,
                            units_ordered,price,discount,weather_condition,holiday_promotion,competitor_pricing,
                            seasonality,demand_forecast_benchmark,source_reference,created_at,data
                          ) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)""",
                       (sid, data["store_id"], data["product_id"], data["snapshot_date"], source_sha256,
                        data["inventory_level"], data["units_sold"], data["units_ordered"], data["price"],
                        data["discount_raw"], data["weather_condition"], data["holiday_promotion"],
                        data["competitor_pricing"], data["seasonality_raw"], data["demand_forecast_benchmark"],
                        data["source_reference"], data["created_at"], encode(data)))
        else:
            db.execute("INSERT OR IGNORE INTO products(id) VALUES(?)", (data["product_id"],))
            db.execute("INSERT INTO snapshots VALUES(?,?,?,?,?,?)",
                       (sid, data["store_id"], data["product_id"], data["snapshot_date"], source_sha256, encode(data)))
        current = {"store_id": data["store_id"], "product_id": data["product_id"],
                   "on_hand_quantity": data["inventory_level"], "snapshot_date": data["snapshot_date"],
                   "source_snapshot_id": sid, "category": data["category_raw"],
                   "lead_time_days": POLICY["lead_times"][data["product_id"]],
                   "policy_version": POLICY["version"]}
        if is_postgres():
            db.execute("""INSERT INTO inventory(
                            product_id,store_id,snapshot_id,snapshot_date,initial_quantity,on_hand_quantity,
                            default_shipping_method,lead_time_days,safety_stock,updated_at,data
                          ) VALUES(?,?,?,?,?,?,NULL,?,NULL,?,?)
                          ON CONFLICT(product_id) DO UPDATE SET
                            snapshot_id=excluded.snapshot_id,snapshot_date=excluded.snapshot_date,
                            on_hand_quantity=excluded.on_hand_quantity,lead_time_days=excluded.lead_time_days,
                            updated_at=excluded.updated_at,data=excluded.data
                          WHERE excluded.snapshot_date > inventory.snapshot_date""",
                       (data["product_id"], data["store_id"], sid, data["snapshot_date"],
                        data["inventory_level"], data["inventory_level"], current["lead_time_days"],
                        data["created_at"], encode(current)))
        else:
            db.execute("""INSERT INTO inventory VALUES(?,?,?,?,?)
              ON CONFLICT(store_id,product_id) DO UPDATE SET snapshot_id=excluded.snapshot_id,
              snapshot_date=excluded.snapshot_date,data=excluded.data
              WHERE excluded.snapshot_date > inventory.snapshot_date""",
                       (data["store_id"], data["product_id"], sid, data["snapshot_date"], encode(current)))
        ids.append(sid)
    if is_postgres():
        for product_id in affected_products:
            first = db.execute("""SELECT inventory_level FROM snapshots
                                  WHERE store_id='S001' AND product_id=?
                                  ORDER BY snapshot_date,id LIMIT 1""", (product_id,)).fetchone()
            db.execute("UPDATE inventory SET initial_quantity=? WHERE product_id=?",
                       (first["inventory_level"], product_id))
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
            db.execute("INSERT INTO logs(id,data) VALUES(?,?) ON CONFLICT(id) DO NOTHING", (row["id"], encode(row)))
            offset = source.tell()
        db.execute("""INSERT INTO metadata(key,value) VALUES('ai_log_offset',?)
                      ON CONFLICT(key) DO UPDATE SET value=excluded.value""", (str(offset),))
    return True
