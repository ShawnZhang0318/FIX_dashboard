"""Persist the next store closing to process, including across worker restarts."""
from datetime import date, datetime, timedelta
import json
import os

from fastapi import HTTPException

from local_backend import automatic_inventory, checkout, storage as s


SCHEDULE_KEY = "forecast_inventory_schedule/S001"


def load(db):
    row = db.execute("SELECT value FROM metadata WHERE key=?", (SCHEDULE_KEY,)).fetchone()
    return json.loads(row[0]) if row else None


def save(db, state):
    db.execute("""INSERT INTO metadata(key,value) VALUES(?,?)
                  ON CONFLICT(key) DO UPDATE SET value=excluded.value""", (SCHEDULE_KEY, s.encode(state)))


def initial_state(today):
    # Start on the day this worker is enabled. The original import may be years old.
    return {"next_day": today, "last_settled_date": None, "detail": None}


def pending_day(db, state):
    # Preserve a partly scanned day from installations upgraded during trading.
    legacy_day = checkout.open_day(db)
    return min(legacy_day, state["next_day"]) if legacy_day else state["next_day"]


def status(db):
    now = checkout.store_now()
    today = now.date().isoformat()
    cutoff = checkout.closing_time()
    state = load(db)
    detail = None
    due_at = None
    last_day = state["last_settled_date"] if state else None
    if cutoff is None:
        phase = "disabled"
    else:
        day = pending_day(db, state or initial_state(today))
        due_at = datetime.combine(date.fromisoformat(day), cutoff, tzinfo=now.tzinfo).isoformat()
        phase = "settled" if last_day == today else "scheduled"
        detail = state["detail"] if state else None
        if not detail:
            heartbeat = db.execute("SELECT value FROM metadata WHERE key='worker_heartbeat'").fetchone()
            if not heartbeat or (datetime.fromisoformat(s.utcnow()) - datetime.fromisoformat(heartbeat[0])).total_seconds() > 90:
                detail = "Inventory worker is offline. Start the worker to resume settlement."
            elif not state:
                detail = "Waiting for the inventory scheduler to start."
        if detail:
            phase = "blocked"
    return {"store_id": checkout.STORE, "business_date": today, "status": phase,
            "close_time": cutoff.isoformat(timespec="minutes") if cutoff else None,
            "timezone": os.environ.get("FIX_STORE_TIMEZONE", "Asia/Shanghai"),
            "last_settled_date": last_day, "next_settlement_at": due_at, "detail": detail}


def run_due(client):
    """Handle at most one due day per call, allowing the worker to stop between days."""
    now = checkout.store_now()
    cutoff = checkout.closing_time()
    if cutoff is None:
        return False
    today = now.date().isoformat()
    with s.connect() as db:
        checkout.lock_store(db)
        state = load(db)
        if state is None:
            state = initial_state(today)
            save(db, state)
        day = pending_day(db, state)
        if day > today or (day == today and now.time() < cutoff):
            return False
        # Preserve full days already imported through the existing data interface.
        count = db.execute("SELECT COUNT(*) FROM snapshots WHERE store_id=? AND snapshot_date=?",
                           (checkout.STORE, day)).fetchone()[0]
        recorded = count == len(s.MANIFEST["product_id_categories"]) and not checkout.open_day(db)
        if recorded:
            report = checkout.closed_summary(db, day)
            if not report:
                s.event(db, "worker", "inventory", "inventory.existing_day_preserved",
                        f"Kept existing inventory snapshots for {day}", context={"business_date": day})
            advance(db, state, day, settled=bool(report))
            return True
    try:
        automatic_inventory.process_day(day, client=client)
    except Exception as exc:
        detail = str(exc.detail) if isinstance(exc, HTTPException) else "Settlement failed. See the worker log. The worker will retry."
        with s.connect() as db:
            checkout.lock_store(db)
            current = load(db)
            if current == state and current["detail"] != detail:
                save(db, {**current, "detail": detail})
                s.event(db, "worker", "inventory", "inventory.settlement_blocked", detail, level="ERROR",
                        context={"business_date": day, "will_retry": True})
        raise
    with s.connect() as db:
        checkout.lock_store(db)
        current = load(db)
        if current["next_day"] == state["next_day"]:
            advance(db, current, day, settled=True)
    return True


def advance(db, state, day, *, settled):
    following = (date.fromisoformat(day) + timedelta(days=1)).isoformat()
    latest = max(filter(None, (day, state["last_settled_date"]))) if settled else state["last_settled_date"]
    save(db, {"next_day": max(following, state["next_day"]), "last_settled_date": latest, "detail": None})
