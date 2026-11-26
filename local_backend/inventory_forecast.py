"""Forecast one simulated trading day using only information known before it."""
from collections import defaultdict, deque
from contextlib import ExitStack
from datetime import date, timedelta
from hashlib import sha256
from math import ceil, floor
import os

from integration.worker_ai import WorkerAIClient
from local_backend import storage
from scripts.generate_daily_sales import DEFAULT_HISTORY, estimate_units, load_history


def recommended_restock(target_stock, available_units):
    """Use whole units to bring the closing balance up to its lead-time target."""
    return ceil(max(0, target_stock - available_units))


def _baseline(observations, day, horizon):
    # Use the existing seasonal estimate for tomorrow, and observed cumulative
    # sales (not a one-day quantile times the horizon) to set lead-time cover.
    daily_units = estimate_units(observations, day)
    window = deque(maxlen=horizon)
    totals = []
    previous = None
    for observed_day in sorted(observations):
        if previous is not None and (observed_day - previous).days != 1:
            window.clear()
        window.append(observations[observed_day])
        if len(window) == horizon:
            totals.append(sum(window))
        previous = observed_day
    if not totals:
        raise ValueError(f"Historical inventory forecast requires a complete {horizon}-day window")
    totals.sort()
    p50 = daily_units * horizon
    p90 = max(p50, totals[ceil(0.9 * len(totals)) - 1])
    return {
        "forecast_units": daily_units, "target_stock": ceil(p90),
        "forecast_source": "historical_baseline", "model_version": "seasonal-history-v1",
        "horizon_days": horizon, "input_cutoff": previous.isoformat(),
        "predicted_demand_p50": p50, "predicted_demand_p90": p90,
    }


def forecast_day(db, store_id, day, *, client=None):
    """Return one forecast per SKU. No DB writes or fallback on model errors.

    The trained model predicts cumulative lead-time demand. Its P50 daily
    average supplies the simulated units, while its P90 sets the stock target.
    If 29 consecutive observations ending yesterday are unavailable, the
    historical estimator uses only CSV observations strictly before this day.
    """
    day = date.fromisoformat(str(day))
    manifest = storage.MANIFEST
    if store_id != manifest["store_id"]:
        raise ValueError("Inventory forecast requires the configured model store")
    cutoff = day - timedelta(days=1)
    start = cutoff - timedelta(days=28)
    history = defaultdict(list)
    for row in db.execute("""SELECT id, product_id, snapshot_date, data FROM snapshots
                             WHERE store_id=? AND snapshot_date>=? AND snapshot_date<=?
                             ORDER BY product_id,snapshot_date""", (store_id, start.isoformat(), cutoff.isoformat())):
        history[row["product_id"]].append({
            "store_id": store_id, "product_id": row["product_id"], "date": row["snapshot_date"],
            "units_sold": storage.row_data(row)["units_sold"], "id": row["id"],
        })
    earliest = date.fromisoformat(manifest["earliest_honest_backtest_origin"])
    forecasts = {}
    baseline_history = None
    with ExitStack() as stack:
        for sku, horizon in manifest["product_lead_times"].items():
            rows = history[sku]
            # The database enforces uniqueness for (store, SKU, date). Since
            # this query covers precisely 29 dates, 29 rows implies no gaps.
            if len(rows) != 29 or cutoff < earliest:
                if baseline_history is None:
                    baseline_history = load_history(DEFAULT_HISTORY, store_id, day)
                if sku not in baseline_history:
                    raise ValueError(f"No historical inventory forecast available for {sku}")
                forecast = _baseline(baseline_history[sku], day, horizon)
                forecast["input_reference"] = f"{DEFAULT_HISTORY.name}/{sku}/{forecast['input_cutoff']}"
            else:
                if client is None:
                    client = WorkerAIClient(os.environ.get("FIX_AI_URL", "http://127.0.0.1:8001"))
                    stack.callback(client.close)
                digest = sha256(storage.encode([r["id"] for r in rows]).encode()).hexdigest()
                reference = f"inventory-forecast/{store_id}/{day}/{sku}/{digest}"
                result = client.predict(rows, store_id=store_id, product_id=sku,
                                        as_of_date=cutoff.isoformat(), input_reference=reference)
                p50, p90 = result["predicted_demand_p50"], result["predicted_demand_p90"]
                forecast = {
                    "forecast_units": floor(p50 / horizon + 0.5), "target_stock": ceil(p90),
                    "forecast_source": "model", "model_version": result["model_version"],
                    "horizon_days": horizon, "input_cutoff": cutoff.isoformat(), "input_reference": reference,
                    "predicted_demand_p50": p50, "predicted_demand_p90": p90,
                }
            forecasts[sku] = forecast
    return forecasts
