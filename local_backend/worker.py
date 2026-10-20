"""Durable single-job worker. Safe concurrent claims; no automatic write retries."""
import json
import math
import os
from time import perf_counter, sleep

from integration.worker_ai import WorkerAIClient
from local_backend import storage as s


def claim():
    with s.connect() as db:
        db.execute("BEGIN IMMEDIATE")
        db.execute("INSERT OR REPLACE INTO metadata VALUES('worker_heartbeat',?)", (s.utcnow(),))
        job = db.execute("""SELECT jobs.* FROM jobs JOIN runs ON runs.id=jobs.run_id
                         WHERE jobs.status='pending' AND runs.status='queued' ORDER BY runs.created_at LIMIT 1""").fetchone()
        if not job:
            return None
        run = s.run_data(db, job["run_id"])
        request_id = json.loads(db.execute("SELECT frozen_input FROM runs WHERE id=?", (job["run_id"],)).fetchone()[0])["request_id"]
        run["started_at"] = s.utcnow()
        run.pop("job", None)
        db.execute("UPDATE jobs SET status='claimed' WHERE id=? AND status='pending'", (job["id"],))
        db.execute("UPDATE runs SET status='processing',data=? WHERE id=?", (s.encode(run), job["run_id"]))
        s.event(db, "worker", "claim", "job.claimed", "Job claimed and committed before inference",
                run_id=job["run_id"], job_id=job["id"], request_id=request_id, attempt=1)
        return dict(job)


def process(job, client):
    run_id, job_id = job["run_id"], job["id"]
    try:
        with s.connect() as db:
            frozen = json.loads(db.execute("SELECT frozen_input FROM runs WHERE id=?", (run_id,)).fetchone()[0])
        if frozen["model_manifest_sha256"] != s.hashlib.sha256((s.MODEL_DIR/"manifest.json").read_bytes()).hexdigest():
            raise RuntimeError("Model manifest changed after input was frozen")
        for product in frozen["products"]:
            start = perf_counter()
            with s.connect() as db:
                history = []
                for ref in product["history"]:
                    row = db.execute("SELECT * FROM snapshots WHERE id=?", (ref["id"],)).fetchone()
                    if not row or row["source_sha256"] != ref["source_sha256"] or row["product_id"] != product["product_id"] or row["store_id"] != frozen["store_id"]:
                        raise RuntimeError("Frozen snapshot reference mismatch")
                    history.append(s.row_data(row))
                cutoff = next(x for x in history if x["id"] == product["snapshot_id"])
            context = {"run_id": run_id, "job_id": job_id, "product_id": product["product_id"],
                       "request_id": frozen["request_id"], "attempt": 1}
            s.log("worker", "features", "features.prepared", "29 frozen daily observations selected; benchmark excluded",
                  context={"snapshot_id": cutoff["id"], "from": history[0]["snapshot_date"],
                           "to": cutoff["snapshot_date"], "row_count": len(history),
                           "input_reference": frozen["input_reference"]}, **context)
            s.log("worker", "inference", "inference.requested", "Calling private AI with validated cutoff features",
                  context={"model_version": frozen["model_version"], "feature_schema_version": frozen["feature_schema_version"]}, **context)
            forecast = client.predict(
                [{"store_id": x["store_id"], "product_id": x["product_id"], "date": x["snapshot_date"],
                  "units_sold": x["units_sold"]} for x in history],
                store_id=frozen["store_id"], product_id=product["product_id"], as_of_date=frozen["as_of_date"],
                input_reference=frozen["input_reference"]+"/"+product["product_id"],
                run_id=run_id, job_id=job_id, request_id=frozen["request_id"])
            if forecast["model_version"] != frozen["model_version"] or forecast["horizon_days"] != frozen["policy"]["lead_times"][product["product_id"]]:
                raise RuntimeError("Forecast does not match frozen policy/model")
            s.log("worker", "inference", "inference.validated", "AI identity, horizon, versions and finite quantiles validated", **context)
            p50, p90 = forecast["predicted_demand_p50"], forecast["predicted_demand_p90"]
            quantity = math.ceil(max(0, p90-cutoff["inventory_level"]))
            baseline = sum(x["units_sold"] for x in history[:-1])/28
            threshold = max(frozen["policy"]["unusual_sales_minimum"], baseline*frozen["policy"]["unusual_sales_ratio"])
            unusual = cutoff["units_sold"] > threshold
            s.log("worker", "policy", "policy.applied", "Frozen inventory policy applied to cutoff stock",
                  context={"policy_version": frozen["policy"]["version"], "observed_stock": cutoff["inventory_level"],
                           "safety_stock": p90-p50, "recommended_order_quantity": quantity,
                           "unusual_sales_threshold": threshold, "unusual_sales_triggered": unusual}, **context)
            case_id = str(s.uuid4()) if quantity > 0 or unusual else None
            result_id = str(s.uuid4())
            result = {**forecast, "id": result_id, "analysis_run_id": run_id, "snapshot_id": cutoff["id"],
                      "snapshot_date": cutoff["snapshot_date"], "inventory_at_prediction": cutoff["inventory_level"],
                      "safety_stock": p90-p50, "recommended_order_quantity": quantity, "case_id": case_id,
                      "policy_version": frozen["policy"]["version"], "processed_at": s.utcnow(),
                      "duration_ms": round((perf_counter()-start)*1000, 3),
                      "anomaly_type": "unusual_demand" if unusual else None,
                      "anomaly_score": cutoff["units_sold"]/max(baseline, 1),
                      "anomaly_threshold": threshold, "anomaly_severity": 1 if unusual else 0,
                      "triggered_reasons": (["stockout_risk"] if quantity else [])+(["unusual_demand"] if unusual else []),
                      "explanation": f"Reorder = ceil(max(0, P90 − observed stock)). Worker unusual-sales rule: today's sales > {threshold:.2f}; no AI anomaly model."}
            with s.connect() as db:
                db.execute("BEGIN IMMEDIATE")
                db.execute("INSERT INTO results VALUES(?,?,?,?,?)", (result_id, run_id, product["product_id"], cutoff["id"], s.encode(result)))
                if case_id:
                    kind = "reorder_and_anomaly" if quantity and unusual else "reorder" if quantity else "anomaly"
                    case = {"id": case_id, "analysis_run_id": run_id, "forecast_result_id": result_id,
                            "exception_type": kind, "created_at": s.utcnow()}
                    db.execute("INSERT INTO cases VALUES(?,?,?,?,?)", (case_id, run_id, result_id, "pending_review", s.encode(case)))
                run = s.run_data(db, run_id)
                run.pop("job", None)
                run["processed_count"] += 1
                db.execute("UPDATE runs SET data=? WHERE id=?", (s.encode(run), run_id))
                db.execute("INSERT OR REPLACE INTO metadata VALUES('worker_heartbeat',?)", (s.utcnow(),))
                s.event(db, "worker", "persistence", "result.committed", "Forecast and optional case committed atomically",
                        case_id=case_id, duration_ms=result["duration_ms"], **context)
        finish(run_id, job_id)
    except Exception as exc:
        finish(run_id, job_id, exc)


def finish(run_id, job_id, error=None):
    with s.connect() as db:
        db.execute("BEGIN IMMEDIATE")
        run = s.run_data(db, run_id)
        run.pop("job", None)
        if not error and run["processed_count"] != run["expected_count"]:
            error = RuntimeError("Result count differs from the frozen product set")
        status = "failed" if error else "completed"
        request_id = json.loads(db.execute("SELECT frozen_input FROM runs WHERE id=?", (run_id,)).fetchone()[0])["request_id"]
        run.update(completed_at=s.utcnow(), partial=bool(error and run["processed_count"]),
                   error=str(error) if error else None)
        db.execute("UPDATE runs SET status=?,data=? WHERE id=?", (status, s.encode(run), run_id))
        db.execute("UPDATE jobs SET status=? WHERE id=?", (status, job_id))
        s.event(db, "worker", "completion", f"job.{status}", f"Run {status}; {run['processed_count']}/{run['expected_count']} saved",
                level="ERROR" if error else "INFO", error=error, run_id=run_id, job_id=job_id, request_id=request_id)


def main():
    s.initialize()
    s.log("worker", "startup", "worker.started", "Polling worker started; no automatic replay of claimed jobs")
    client = WorkerAIClient(os.environ.get("FIX_AI_URL", "http://127.0.0.1:8001"))
    try:
        while True:
            job = claim()
            if job:
                process(job, client)
            sleep(0.5)
    finally:
        client.close()


if __name__ == "__main__":
    main()
