"""Post one forecast-based daily movement per SKU and keep the original close immutable."""

import hashlib
import json
from datetime import date, timedelta
from math import floor

from fastapi import HTTPException

from local_backend import checkout, inventory_forecast, storage as s
from local_backend.schemas import Snapshot

STORE = checkout.STORE
MODE = "forecast_auto"


def _inputs(db, day):
    """All prior snapshots are immutable. A historical import can still add missing dates."""
    rows = checkout.stock_rows(db, day)
    start = (date.fromisoformat(day) - timedelta(days=29)).isoformat()
    history_count = db.execute(
        "SELECT COUNT(*) FROM snapshots WHERE store_id=? AND snapshot_date>=? AND snapshot_date<?",
        (STORE, start, day),
    ).fetchone()[0]
    version = (history_count, [(row["product_id"], row["data"]) for row in rows])
    return rows, version


def _post(db, day, rows, forecasts):
    if set(forecasts) != {row["product_id"] for row in rows}:
        raise ValueError("Daily inventory needs forecasts for the entire store")
    items = []
    snapshots = []
    for row in rows:
        sku = row["product_id"]
        forecast = forecasts[sku]
        opening = s.row_data(row)["on_hand_quantity"]
        sold = min(forecast["forecast_units"], floor(opening))
        remaining = opening - sold
        received = inventory_forecast.recommended_restock(forecast["target_stock"], remaining)
        closing = remaining + received
        movement = {
            "opening_quantity": opening, "predicted_units_sold": forecast["forecast_units"],
            "units_sold": sold, "units_replenished": received,
            "target_stock": forecast["target_stock"], "forecast_source": forecast["forecast_source"],
            "model_version": forecast["model_version"], "input_cutoff": forecast["input_cutoff"],
            "input_reference": forecast["input_reference"],
            "horizon_days": forecast["horizon_days"],
            "predicted_demand_p50": forecast["predicted_demand_p50"],
            "predicted_demand_p90": forecast["predicted_demand_p90"],
        }
        items.append({"product_id": sku, "on_hand_quantity": closing, **movement})
        baseline = json.loads(row["baseline"])
        snapshot = {key: baseline[key] for key in Snapshot.model_fields}
        snapshot.update(
            movement, snapshot_date=day, inventory_level=closing, units_ordered=received,
            source_reference=f"{MODE}/{STORE}/{day}/{sku};context-from={baseline['id']}",
        )
        snapshots.append(snapshot)

    report = {
        "store_id": STORE, "business_date": day, "mode": MODE, "status": "closed",
        "closed_at": s.utcnow(), "items": items,
        "total_units_sold": sum(item["units_sold"] for item in items),
        "total_units_replenished": sum(item["units_replenished"] for item in items),
    }
    digest = hashlib.sha256(s.encode(snapshots).encode("utf-8")).hexdigest()
    s.ingest(db, snapshots, digest)
    db.execute("INSERT INTO sales_days(store_id,business_date,closed_at,summary) VALUES(?,?,?,?)",
               (STORE, day, report["closed_at"], s.encode(report)))
    s.event(db, "worker", "inventory", "inventory.forecast_posted",
            f"Posted {report['total_units_sold']} forecast sales and {report['total_units_replenished']} simulated receipts",
            context={"store_id": STORE, "business_date": day, "product_count": len(items),
                     "source_sha256": digest, "forecast_sources": sorted({item["forecast_source"] for item in items})})
    return report


def process_day(day: str, *, client=None):
    """Settle a due day. The scheduler owns the cutoff and calls this outside a transaction."""
    if date.fromisoformat(day) > checkout.store_now().date():
        raise HTTPException(409, "Cannot post a future business day")
    with s.connect() as db:
        if s.is_postgres():
            db.execute("SET TRANSACTION ISOLATION LEVEL REPEATABLE READ, READ ONLY")
        else:
            db.execute("BEGIN")
        stored = checkout.closed_summary(db, day)
        if stored:
            return stored
        active = checkout.open_day(db)
        if active and active != day:
            raise HTTPException(409, f"Close the outstanding business day {active} first")
        if not active:
            _, version = _inputs(db, day)
            forecasts = inventory_forecast.forecast_day(db, STORE, day, client=client)

    # Do not hold the store write lock while calling the model. Recheck the
    # immutable history and inventory after acquiring it, including other workers' closes.
    with s.connect() as db:
        checkout.lock_store(db)
        stored = checkout.closed_summary(db, day)
        if stored:
            return stored
        current_active = checkout.open_day(db)
        if current_active:
            if current_active != day:
                raise HTTPException(409, f"Close the outstanding business day {current_active} first")
            # Legacy scans already reduced stock. Preserve their actual ledger.
            return checkout.close(db, day, source="worker")
        rows, current_version = _inputs(db, day)
        if active or current_version != version:
            raise HTTPException(409, "Inventory changed while forecasting; retry the business day")
        return _post(db, day, rows, forecasts)
