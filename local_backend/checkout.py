"""Store clock, inventory lock and recovery of legacy scanned sales days."""
import hashlib
import json
import os
from datetime import datetime, time, timedelta, timezone
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from fastapi import HTTPException
from local_backend import storage as s
from local_backend.schemas import Snapshot

STORE = "S001"


def store_now():
    name = os.environ.get("FIX_STORE_TIMEZONE", "Asia/Shanghai")
    try:
        zone = ZoneInfo(name)
    except ZoneInfoNotFoundError:
        if name != "Asia/Shanghai":
            raise
        # Windows installations may have no IANA database. S001 trades at UTC+8.
        zone = timezone(timedelta(hours=8))
    return datetime.now(zone)


def closing_time():
    value = os.environ.get("FIX_STORE_CLOSE_TIME", "22:00").strip()
    if not value:
        return None
    cutoff = time.fromisoformat(value)
    if cutoff.tzinfo or cutoff.isoformat(timespec="minutes") != value:
        raise ValueError("FIX_STORE_CLOSE_TIME must be HH:MM in the store timezone")
    return cutoff


def lock_store(db, *, read=False):
    # All inventory writers use the same per-store transaction lock.
    if read:
        db.execute("BEGIN")
    else:
        s.begin_write(db)
    if s.is_postgres():
        lock = "pg_advisory_xact_lock_shared" if read else "pg_advisory_xact_lock"
        db.execute(f"SELECT {lock}(843119028)")


def open_day(db):
    row = db.execute("SELECT business_date FROM sales_days WHERE store_id=? AND closed_at IS NULL", (STORE,)).fetchone()
    return row[0] if row else None


def closed_summary(db, day):
    row = db.execute("SELECT summary FROM sales_days WHERE store_id=? AND business_date=?", (STORE, day)).fetchone()
    return json.loads(row[0]) if row and row[0] else None


def stock_rows(db, day):
    rows = list(db.execute("""SELECT i.product_id, i.snapshot_date, i.data, snap.data AS baseline
                             FROM inventory i JOIN snapshots snap ON i.snapshot_id=snap.id
                             WHERE i.store_id=? ORDER BY i.product_id""", (STORE,)))
    if {r["product_id"] for r in rows} != set(s.MANIFEST["product_id_categories"]):
        raise HTTPException(409, "Import opening inventory for all store products before settlement")
    if any(row["snapshot_date"] >= day for row in rows):
        raise HTTPException(409, "The settlement date must follow every product's latest inventory snapshot")
    return rows


def sales_counts(db, day):
    return {row[0]: row[1] for row in db.execute("""SELECT product_id, COUNT(*) FROM sales_scans
        WHERE store_id=? AND business_date=? GROUP BY product_id""", (STORE, day))}


def summary(day, rows, counts, *, closed_at=None):
    return {
        "store_id": STORE, "business_date": day, "status": "closed" if closed_at else "open",
        "closed_at": closed_at, "total_units_sold": sum(counts.values()),
        "items": [{"product_id": r["product_id"], "units_sold": counts.get(r["product_id"], 0),
                   "on_hand_quantity": s.row_data(r)["on_hand_quantity"]} for r in rows],
    }


def close(db, day, *, request_id=None, source="api"):
    stored = closed_summary(db, day)
    if stored:
        return stored
    if open_day(db) != day:
        raise HTTPException(409, "Legacy settlement requires an existing open sales day")
    rows = stock_rows(db, day)
    counts = sales_counts(db, day)
    report = summary(day, rows, counts, closed_at=s.utcnow())
    snapshots = []
    for row, item in zip(rows, report["items"]):
        baseline = json.loads(row["baseline"])
        snapshot = {k: baseline[k] for k in Snapshot.model_fields}
        snapshot.update(snapshot_date=day, inventory_level=item["on_hand_quantity"], units_sold=item["units_sold"],
                        units_ordered=0, source_reference=f"scan-close/{STORE}/{day};context-from={baseline['id']}")
        snapshots.append(snapshot)
    digest = hashlib.sha256(s.encode(snapshots).encode("utf-8")).hexdigest()
    s.ingest(db, snapshots, digest)
    db.execute("UPDATE sales_days SET closed_at=?,summary=? WHERE store_id=? AND business_date=?",
               (report["closed_at"], s.encode(report), STORE, day))
    s.event(db, source, "checkout", "sales.day_closed", f"Published {report['total_units_sold']} daily units sold",
            request_id=request_id, context={"business_date": day, "snapshot_count": len(snapshots)})
    return report
