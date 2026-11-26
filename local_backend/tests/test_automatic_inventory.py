from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timedelta

import pytest
from fastapi import HTTPException

from local_backend import automatic_inventory as auto, checkout, inventory_forecast, storage as s
from local_backend.tests.test_flow import CUTOFF, snapshot

DAY = str(CUTOFF + timedelta(days=1))


@pytest.fixture
def store(tmp_path, monkeypatch):
    monkeypatch.setattr(s, "STATE", tmp_path)
    monkeypatch.setattr(s, "DB_PATH", tmp_path / "inventory.sqlite3")
    monkeypatch.setattr(s, "DATABASE_URL", "")
    monkeypatch.setattr(checkout, "store_now", lambda: datetime.fromisoformat(DAY + "T22:00"))
    s.initialize()
    skus = list(s.MANIFEST["product_id_categories"])
    with s.connect() as db:
        s.ingest(db, [snapshot(sku, stock=2 if sku == skus[0] else 100) for sku in skus], "a" * 64)
    values = {sku: {"forecast_units": 3, "target_stock": 8, "predicted_demand_p50": 6,
                    "predicted_demand_p90": 8, "forecast_source": "model", "model_version": "test",
                    "input_reference": sku, "horizon_days": 2, "input_cutoff": str(CUTOFF)} for sku in skus}
    monkeypatch.setattr(inventory_forecast, "forecast_day", lambda *_args, **_kwargs: values)
    return skus


def test_concurrent_close_caps_sales_and_posts_stock_once(store):
    with ThreadPoolExecutor(2) as pool:
        first, second = pool.map(auto.process_day, [DAY, DAY])
    assert first == second
    items = {item["product_id"]: item for item in first["items"]}
    limited, covered = items[store[0]], items[store[1]]
    assert (limited["units_sold"], limited["units_replenished"], limited["on_hand_quantity"]) == (2, 8, 8)
    assert (covered["units_sold"], covered["units_replenished"], covered["on_hand_quantity"]) == (3, 0, 97)
    assert first["total_units_sold"] == 2 + 3 * (len(store) - 1)
    assert first["total_units_replenished"] == 8
    with s.connect() as db:
        snapshots = [s.row_data(r) for r in db.execute("SELECT data FROM snapshots WHERE snapshot_date=?", (DAY,))]
        assert len(snapshots) == len(store)
        for item in snapshots:
            assert item["inventory_level"] == item["opening_quantity"] - item["units_sold"] + item["units_ordered"]
            assert item["source_reference"].startswith("forecast_auto/")
        assert db.execute("SELECT COUNT(*) FROM sales_days").fetchone()[0] == 1
        assert db.execute("SELECT COUNT(*) FROM logs").fetchone()[0] == 1


def test_partial_failure_leaves_no_movements(store, monkeypatch):
    ingest = s.ingest

    def fail_midway(db, snapshots, digest):
        ingest(db, snapshots[:1], digest)
        raise RuntimeError("injected failure")

    monkeypatch.setattr(s, "ingest", fail_midway)
    with pytest.raises(RuntimeError, match="injected failure"):
        auto.process_day(DAY)
    with s.connect() as db:
        assert db.execute("SELECT COUNT(*) FROM sales_days").fetchone()[0] == 0
        assert db.execute("SELECT COUNT(*) FROM snapshots WHERE snapshot_date=?", (DAY,)).fetchone()[0] == 0
        assert db.execute("SELECT MAX(snapshot_date) FROM inventory").fetchone()[0] == str(CUTOFF)


def test_historical_import_during_forecast_requires_fresh_inputs(store, monkeypatch):
    forecast = inventory_forecast.forecast_day

    def import_during_forecast(*args, **kwargs):
        result = forecast(*args, **kwargs)
        with s.connect() as db:
            s.ingest(db, [snapshot(store[0], day=CUTOFF - timedelta(days=1))], "b" * 64)
        return result

    monkeypatch.setattr(inventory_forecast, "forecast_day", import_during_forecast)
    with pytest.raises(HTTPException, match="Inventory changed"):
        auto.process_day(DAY)
    monkeypatch.setattr(inventory_forecast, "forecast_day", forecast)
    assert auto.process_day(DAY)["status"] == "closed"
