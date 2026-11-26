import json
import sqlite3
from datetime import date, timedelta
from unittest.mock import Mock

import pytest

from local_backend import inventory_forecast as forecast


@pytest.fixture
def inventory_db(monkeypatch):
    monkeypatch.setattr(forecast.storage, "MANIFEST", {
        "store_id": "S001", "product_lead_times": {"P0001": 3},
        "earliest_honest_backtest_origin": "2023-09-01",
    })
    with sqlite3.connect(":memory:") as db:
        db.row_factory = sqlite3.Row
        db.execute("CREATE TABLE snapshots(id, store_id, product_id, snapshot_date, data)")
        yield db


def test_complete_history_uses_previous_cutoff_and_converts_horizon(inventory_db):
    day = date(2026, 11, 26)
    for age in range(30):  # Include today's row to verify it cannot affect the forecast.
        inventory_db.execute("INSERT INTO snapshots VALUES(?, 'S001', 'P0001', ?, ?)",
                             (str(age), (day - timedelta(days=age)).isoformat(),
                              json.dumps({"units_sold": 100 if age else 99999})))
    ai = Mock()
    ai.predict.return_value = {
        "model_version": "test", "predicted_demand_p50": 31.5, "predicted_demand_p90": 52.2,
    }
    item = forecast.forecast_day(inventory_db, "S001", day, client=ai)["P0001"]
    rows, = ai.predict.call_args.args
    assert len(rows) == 29
    assert max(r["date"] for r in rows) == ai.predict.call_args.kwargs["as_of_date"] == "2026-11-25"
    assert item["forecast_source"] == "model"
    assert item["forecast_units"] == 11
    assert item["target_stock"] == 53
    assert forecast.recommended_restock(item["target_stock"], 52.5) == 1
    assert forecast.recommended_restock(item["target_stock"], 75) == 0

    ai.predict.side_effect = RuntimeError("model unavailable")
    with pytest.raises(RuntimeError, match="model unavailable"):
        forecast.forecast_day(inventory_db, "S001", day, client=ai)


def test_gap_uses_observed_historical_sales_and_complete_windows_only(inventory_db, tmp_path, monkeypatch):
    csv = tmp_path / "sales.csv"
    csv.write_text(
        "store_id,product_id,date,units_sold\n"
        "S001,P0001,2026-11-01,3\nS001,P0001,2026-11-02,4\nS001,P0001,2026-11-03,5\n"
        "S001,P0001,2026-11-25,20\nS001,P0001,2026-11-26,99999\n",
        encoding="utf-8",
    )
    monkeypatch.setattr(forecast, "DEFAULT_HISTORY", csv)
    ai = Mock()
    item = forecast.forecast_day(inventory_db, "S001", "2026-11-26", client=ai)["P0001"]
    ai.predict.assert_not_called()
    assert item["forecast_source"] == "historical_baseline"
    assert item["forecast_units"] == 8
    assert item["target_stock"] == 24
    assert item["input_cutoff"] == "2026-11-25"
