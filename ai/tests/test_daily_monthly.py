from datetime import date, timedelta

import asyncio

import httpx

from ai.service import create_app


CUTOFF = date(2026, 1, 31)


def history(sales=20, stock=10, days=56):
    return [
        {"date": str(CUTOFF - timedelta(days=days - 1 - i)),
         "units_sold": sales, "inventory_level": stock}
        for i in range(days)
    ]


def payload(rows):
    return {"store_id": "S001", "as_of_date": str(CUTOFF),
            "input_reference": "frozen-snapshot", "products": {"P0001": rows}}


def post(path, request, predictor=None):
    app = create_app()
    app.state.predictor = predictor

    async def call():
        transport = httpx.ASGITransport(app=app)
        async with httpx.AsyncClient(transport=transport, base_url="http://test") as client:
            return await client.post(path, json=request)

    return asyncio.run(call())


def test_daily_uses_prior_sales_and_detects_persistent_stockout():
    rows = history()
    for row in rows[-5:]:
        row["inventory_level"] = 0
    rows[-1]["units_sold"] = 41
    response = post("/diagnostics/daily", payload(rows))
    assert response.status_code == 200
    checks = response.json()["products"]["P0001"]
    assert checks["high_sales"]["status"] == "anomaly"
    assert checks["high_sales"]["threshold"] == 40
    assert checks["persistent_zero_stock"]["observed"] == 5
    assert checks["persistent_zero_stock"]["lower_bound"] is False
    assert checks["persistent_zero_stock"]["status"] == "anomaly"


def test_monthly_scans_all_products_and_requires_persistence():
    rows = history()
    products = {f"P{i:04d}": history() for i in range(1, 21)}
    for row in products["P0001"][28:]:
        row["units_sold"] = 30
    for row in products["P0002"][28:]:
        row["units_sold"] = 10
    products["P0003"][-1]["units_sold"] = 2000
    for index in (30, 37, 44):
        products["P0004"][index].update(inventory_level=0, units_sold=0)
    products["P0005"] = rows[:-1]
    products["P0006"] = []
    for row in products["P0007"][28:]:
        row.update(inventory_level=0, units_sold=0)
    request = {**payload(rows), "products": products}
    response = post("/diagnostics/monthly", request)
    assert response.status_code == 200
    result = response.json()
    assert result["recent_start"] == "2026-01-04"
    assert result["reference_start"] == "2025-12-07"
    assert len(result["products"]) == 20
    checks = result["products"]
    assert checks["P0001"]["persistent_high_sales"]["status"] == "anomaly"
    assert checks["P0002"]["persistent_low_sales"]["status"] == "anomaly"
    assert checks["P0003"]["persistent_high_sales"]["status"] == "normal"
    assert checks["P0004"]["long_stockout"]["status"] == "anomaly"
    assert checks["P0005"]["long_stockout"]["status"] == "insufficient_data"
    assert checks["P0006"]["persistent_high_sales"]["status"] == "insufficient_data"
    assert checks["P0007"]["persistent_low_sales"]["status"] == "inventory_limited"


def test_closed_day_forecast_reports_coverage_and_rejects_stale_inputs():
    class Model:
        def predict(self, request):
            return {
                **request.model_dump(include={"store_id", "product_id", "as_of_date",
                                              "input_reference", "feature_schema_version"}),
                "horizon_days": request.lead_time_days, "model_version": "test",
                "predicted_demand_p50": 10, "predicted_demand_p90": 20,
            }

    request = {key: value for key, value in payload([]).items() if key != "products"}
    request.update(product_id="P0001", lead_time_days=3,
                   expected_closed_date=str(CUTOFF), history=history(days=29))
    response = post("/forecast/closed-day", request, Model())
    assert response.status_code == 200
    assert response.json()["forecast_start"] == "2026-02-01"
    assert response.json()["forecast_end"] == "2026-02-03"
    request["expected_closed_date"] = "2026-02-01"
    assert post("/forecast/closed-day", request, Model()).status_code == 422
    request["expected_closed_date"] = str(CUTOFF)
    request["history"].pop()
    assert post("/forecast/closed-day", request, Model()).status_code == 422
