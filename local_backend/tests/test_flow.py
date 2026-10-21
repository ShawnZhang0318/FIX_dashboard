from datetime import date, timedelta
import json
import os
from concurrent.futures import ThreadPoolExecutor
import pytest
from fastapi.testclient import TestClient
from local_backend import storage as s, worker
from local_backend.service import app

CUTOFF = date(2023, 11, 15)


def snapshot(product="P0001", day=CUTOFF, stock=150, sales=10):
    return {"store_id": "S001", "product_id": product, "snapshot_date": str(day),
            "category_raw": "test", "region_raw": "test", "inventory_level": stock,
            "units_sold": sales, "units_ordered": 20, "price": 5, "discount_raw": 0,
            "weather_condition": "test", "holiday_promotion": 0, "competitor_pricing": 5,
            "seasonality_raw": "test", "demand_forecast_benchmark": -2, "source_reference": "test-fixture"}


@pytest.fixture
def api(tmp_path, monkeypatch):
    monkeypatch.setattr(s, "STATE", tmp_path)
    postgres_url = os.environ.get("FIX_TEST_POSTGRES_URL", "")
    if postgres_url:
        monkeypatch.setattr(s, "DATABASE_URL", postgres_url)
        s.initialize()
        with s.connect() as db:
            db.execute("""TRUNCATE TABLE metadata,log_queries,logs,cases,results,jobs,runs,
                          inventory,snapshots,transactions,products RESTART IDENTITY CASCADE""")
    else:
        monkeypatch.setattr(s, "DB_PATH", tmp_path/"test.sqlite3")
        monkeypatch.setattr(s, "DATABASE_URL", "")
    with TestClient(app) as client:
        yield client


def seed():
    rows = [snapshot(product, CUTOFF-timedelta(days=n), stock=500 if product=="P0001" else 150)
            for product in s.MANIFEST["product_id_categories"] for n in reversed(range(29))]
    with s.connect() as db:
        s.ingest(db, rows, "a"*64)


def create(api):
    response = api.post("/analysis-runs", json={"store_id": "S001", "run_type": "daily", "as_of_date": str(CUTOFF)},
                        headers={"X-Request-ID": "flow-test"})
    assert response.status_code == 202, response.text
    return response.json()["analysis_run"]["id"]


class StubAI:
    def __init__(self, fail_at=None):
        self.calls = []
        self.fail_at = fail_at

    def predict(self, history, **kwargs):
        self.calls.append((history, kwargs))
        if len(self.calls) == self.fail_at:
            raise RuntimeError("Injected unavailable private AI")
        return {"store_id": kwargs["store_id"], "product_id": kwargs["product_id"], "as_of_date": kwargs["as_of_date"],
                "horizon_days": s.MANIFEST["product_lead_times"][kwargs["product_id"]], "forecast_mode": "quantile",
                "predicted_demand_p50": 100.0, "predicted_demand_p90": 200.0,
                "model_version": s.MANIFEST["model_version"], "feature_schema_version": "features-v1",
                "input_reference": kwargs["input_reference"]}


@pytest.mark.skipif(not os.environ.get("FIX_TEST_POSTGRES_URL"),
                    reason="requires a dedicated PostgreSQL test database")
def test_postgresql_persists_normalized_workflow_fields(api):
    seed()
    run_id = create(api)
    worker.process(worker.claim(), StubAI())
    case = api.get("/exceptions", params={"run_id": run_id}).json()[0]
    decision = "resolve" if case["exception_type"] == "anomaly" else "approve"
    response = api.post(f"/exceptions/{case['id']}/review",
                        json={"decision": decision, "reviewer_label": "PG test",
                              "override_reason": "Verified normalized persistence"})
    assert response.status_code == 200, response.text

    with s.connect() as db:
        snapshot_row = db.execute("""SELECT inventory_level,units_sold,source_sha256
                                  FROM snapshots WHERE product_id='P0001' AND snapshot_date=?""",
                                  (str(CUTOFF),)).fetchone()
        inventory_row = db.execute("""SELECT initial_quantity,on_hand_quantity,default_shipping_method,
                                      lead_time_days,safety_stock FROM inventory WHERE product_id='P0001'""").fetchone()
        transaction_count = db.execute("SELECT COUNT(*) FROM transactions").fetchone()[0]
        run_row = db.execute("SELECT store_id,run_type,as_of_date,status,input_reference FROM runs WHERE id=?", (run_id,)).fetchone()
        job_row = db.execute("SELECT job_type,status,attempts FROM jobs WHERE run_id=?", (run_id,)).fetchone()
        result_row = db.execute("""SELECT horizon_days,predicted_demand_p50,predicted_demand_p90,
                                   anomaly_severity,model_version FROM results
                                   WHERE run_id=? AND product_id='P0001'""", (run_id,)).fetchone()
        case_row = db.execute("SELECT exception_type,status,reviewer_decision,reviewer_identity,reviewed_at FROM cases WHERE id=?", (case["id"],)).fetchone()

    assert snapshot_row["inventory_level"] == 500 and snapshot_row["units_sold"] == 10
    assert snapshot_row["source_sha256"] == "a" * 64
    assert inventory_row["initial_quantity"] == inventory_row["on_hand_quantity"] == 500
    assert inventory_row["default_shipping_method"] is None and inventory_row["lead_time_days"] == 3
    assert inventory_row["safety_stock"] is None
    assert transaction_count == 0
    assert run_row["store_id"] == "S001" and run_row["run_type"] == "daily"
    assert run_row["as_of_date"] == str(CUTOFF) and run_row["status"] == "completed"
    assert run_row["input_reference"].startswith("postgresql:")
    assert job_row["job_type"] == "forecast" and job_row["status"] == "completed" and job_row["attempts"] == 1
    assert result_row["horizon_days"] == 3 and result_row["predicted_demand_p90"] >= result_row["predicted_demand_p50"]
    assert result_row["anomaly_severity"] in (0,1)
    assert result_row["model_version"] == s.MANIFEST["model_version"]
    assert case_row["status"] in ("approved", "resolved") and case_row["reviewer_decision"] == decision
    assert case_row["reviewer_identity"] == "PG test" and case_row["reviewed_at"]


def test_atomic_ingestion_duplicate_rollback_and_historical_current_view(api):
    def post(rows):
        return api.post("/snapshots", json={"source_file_sha256": "a"*64, "snapshots": rows})
    assert post([snapshot(stock=150)]).status_code == 201
    assert post([snapshot(day=CUTOFF-timedelta(days=1), stock=900)]).status_code == 201
    assert api.get("/inventory/S001/P0001").json()["on_hand_quantity"] == 150
    assert post([snapshot("P0002"), snapshot()]).status_code == 409
    assert api.get("/inventory/S001/P0002").status_code == 404
    assert len(api.get("/snapshots").json()) == 2
    invalid = snapshot()
    invalid["units_sold"] = -1
    assert post([invalid]).status_code == 422


def test_coverage_and_model_cutoff(api):
    assert api.post("/analysis-runs", json={"store_id": "S001", "run_type": "daily", "as_of_date": "2022-06-30"}).status_code == 422
    assert api.post("/analysis-runs", json={"store_id": "S001", "run_type": "monthly", "as_of_date": str(CUTOFF)}).status_code == 422
    assert api.post("/analysis-runs", json={"store_id": "S002", "run_type": "daily", "as_of_date": str(CUTOFF)}).status_code == 422
    assert api.post("/analysis-runs", json={"store_id": "S001", "run_type": "daily", "as_of_date": str(CUTOFF)}).status_code == 422
    seed()
    with s.connect() as db:
        db.execute("DELETE FROM snapshots WHERE product_id='P0001' AND snapshot_date=?", (str(CUTOFF-timedelta(days=10)),))
    assert api.post("/analysis-runs", json={"store_id": "S001", "run_type": "daily", "as_of_date": str(CUTOFF)}).status_code == 422


def test_durable_claim_freeze_and_normal_results(api):
    seed()
    run_id = create(api)
    queued = api.get(f"/analysis-runs/{run_id}").json()
    assert queued["status"] == "queued" and queued["job"]["status"] == "pending"
    # Later observations must not change the historical run.
    with s.connect() as db:
        s.ingest(db, [snapshot("P0002", CUTOFF+timedelta(days=1), stock=999, sales=900)], "b"*64)
    with ThreadPoolExecutor(2) as pool:
        claims = list(pool.map(lambda _: worker.claim(), range(2)))
    assert sum(job is not None for job in claims) == 1
    model = StubAI()
    worker.process(next(x for x in claims if x), model)
    run = api.get(f"/analysis-runs/{run_id}").json()
    assert run["status"] == "completed" and run["processed_count"] == run["expected_count"] == 20
    assert run["job"]["status"] == "completed" and run["partial"] is False
    results = api.get(f"/analysis-runs/{run_id}/results").json()["results"]
    assert len(results) == 20 and results[0]["case_id"] is None
    p2 = next(x for x in results if x["product_id"] == "P0002")
    assert p2["inventory_at_prediction"] == 150 and p2["recommended_order_quantity"] == 50
    assert len(model.calls[0][0]) == 29
    assert all(h["date"] <= str(CUTOFF) and set(h)=={"store_id","product_id","date","units_sold"}
               for history, _ in model.calls for h in history)
    assert len(api.get("/exceptions", params={"run_id": run_id}).json()) == 19


@pytest.mark.parametrize("decision,quantity,status", [("approve",None,"approved"), ("modify",17,"modified"), ("reject",0,"rejected")])
def test_review_persisted_once_without_stock_change(api, decision, quantity, status):
    seed()
    run_id = create(api)
    worker.process(worker.claim(), StubAI())
    before = api.get("/inventory").json()
    case = api.get("/exceptions", params={"run_id": run_id}).json()[0]
    body = {"decision": decision, "reviewer_label": "Test planner", "override_reason": "Checked fixture"}
    if quantity is not None:
        body["reviewer_order_quantity"] = quantity
    result = api.post(f"/exceptions/{case['id']}/review", json=body)
    assert result.status_code == 200, result.text
    assert result.json()["status"] == status
    assert api.post(f"/exceptions/{case['id']}/review", json=body).status_code == 409
    assert api.get(f"/exceptions/{case['id']}").json()["status"] == status
    assert api.get("/inventory").json() == before


@pytest.mark.parametrize("fail_at,partial,count", [(1,False,0),(3,True,2)])
def test_model_failure_preserves_partial_and_blocks_review(api, fail_at, partial, count):
    seed()
    run_id = create(api)
    worker.process(worker.claim(), StubAI(fail_at))
    run = api.get(f"/analysis-runs/{run_id}").json()
    assert run["status"] == run["job"]["status"] == "failed"
    assert run["partial"] == partial and run["processed_count"] == count
    assert len(api.get(f"/analysis-runs/{run_id}/results").json()["results"]) == count
    for case in api.get("/exceptions", params={"run_id": run_id}).json():
        assert api.post(f"/exceptions/{case['id']}/review", json={"decision":"approve","reviewer_label":"test"}).status_code == 409
    logs = api.get("/logs", params={"run_id":run_id,"level":"ERROR"}).json()
    assert "Injected unavailable" in logs["items"][0]["error"]["stack_trace"]


def test_log_pagination_export_stable_and_correlated(api):
    seed()
    run_id = create(api)
    worker.process(worker.claim(), StubAI())
    first = api.get("/logs", params={"run_id":run_id,"limit":3}).json()
    assert first["coverage"]["status"] == "partial"  # no AI server log in this fixture
    s.log("worker","test","later.event","after snapshot",run_id=run_id)
    items, cursor = first["items"], first["next_cursor"]
    while cursor:
        page = api.get("/logs",params={"run_id":run_id,"limit":3,"snapshot_id":first["snapshot_id"],"cursor":cursor}).json()
        items += page["items"]
        cursor = page["next_cursor"]
    assert len(items) == first["total"] == len({x["id"] for x in items})
    assert all(x["run_id"] == run_id and x["event"] != "later.event" for x in items)
    exported = api.get("/logs/export",params={"run_id":run_id,"snapshot_id":first["snapshot_id"]})
    assert exported.headers["content-type"].startswith("application/x-ndjson")
    assert [json.loads(x)["id"] for x in exported.text.splitlines()] == [x["id"] for x in items]
    assert api.get("/logs",params={"run_id":"other","snapshot_id":first["snapshot_id"]}).status_code == 409


def test_zero_daily_selection_is_success_without_model_call(api):
    rows = [snapshot(product, day, stock=100, sales=0) for product in s.MANIFEST["product_id_categories"]
            for day in (CUTOFF-timedelta(days=1), CUTOFF)]
    with s.connect() as db:
        s.ingest(db, rows, "a"*64)
    run_id = create(api)
    model = StubAI()
    worker.process(worker.claim(), model)
    run = api.get(f"/analysis-runs/{run_id}").json()
    assert run["status"] == "completed" and run["expected_count"] == run["processed_count"] == 0
    assert model.calls == []


@pytest.mark.parametrize("stock,kind,decision", [(150,"reorder_and_anomaly","approve"), (500,"anomaly","resolve")])
def test_worker_anomaly_rule_and_required_review_note(api, stock, kind, decision):
    rows = [snapshot(product, CUTOFF-timedelta(days=n), stock=stock,
                     sales=500 if n==0 else 10) for product in s.MANIFEST["product_id_categories"] for n in reversed(range(29))]
    with s.connect() as db:
        s.ingest(db, rows, "a"*64)
    run_id = create(api)
    worker.process(worker.claim(), StubAI())
    case = api.get("/exceptions",params={"run_id":run_id}).json()[0]
    assert case["exception_type"] == kind
    body = {"decision":decision,"reviewer_label":"Test planner"}
    assert api.post(f"/exceptions/{case['id']}/review",json=body).status_code == 422
    body["override_reason"] = "Checked unusual sales"
    assert api.post(f"/exceptions/{case['id']}/review",json=body).status_code == 200
    job = api.get(f"/analysis-runs/{run_id}").json()["job"]["id"]
    logs = api.get("/logs",params={"run_id":run_id,"job_id":job,"stage":"review"}).json()
    assert any(row["event"]=="review.committed" for row in logs["items"])
