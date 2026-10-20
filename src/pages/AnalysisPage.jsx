import { useEffect, useRef, useState } from "react";
import { Link, useNavigate, useParams } from "react-router";
import PageHeader from "../components/PageHeader.jsx";
import { Feedback, Badge, Metric } from "../components/WorkflowUI.jsx";
import { validateRunResults } from "../../frontend/contracts.js";
import { useLanguage } from "../i18n.jsx";
import {
  api,
  config,
  number,
  casePath,
  runPath,
  queuePath,
} from "../workflow.js";
export default function AnalysisPage() {
  const { runId } = useParams();
  return <AnalysisWorkspace key={runId || "new"} runId={runId} />;
}
function AnalysisWorkspace({ runId }) {
  const { t } = useLanguage(),
    navigate = useNavigate();
  const [date, setDate] = useState(config.mode === "mock" ? "2022-06-30" : config.defaultAnalysisDate || ""),
    [scenario, setScenario] = useState("success");
  const [run, setRun] = useState(null),
    [results, setResults] = useState(null),
    [error, setError] = useState(null),
    [createError, setCreateError] = useState(null),
    [busy, setBusy] = useState(false),
    [revision, setRevision] = useState(0);
  const active = useRef(true),
    submitting = useRef(false);
  useEffect(() => {
    active.current = true;
    return () => {
      active.current = false;
    };
  }, []);
  useEffect(() => {
    if (!runId) return;
    let cancelled = false,
      timer;
    const controller = new AbortController();
    setError(null);
    setResults(null);
    async function poll() {
      try {
        const r = await api.getAnalysisRun(runId, {signal: controller.signal});
        if (cancelled) return;
        if (!["queued", "processing", "completed", "failed"].includes(r.status))
          throw Error("Unsupported run status: " + r.status);
        setRun(r);
        setDate(r.as_of_date);
        if (r.scenario) setScenario(r.scenario);
        if (["queued", "processing"].includes(r.status)) {
          timer = setTimeout(poll, config.pollMs);
          return;
        }
        const data = await api.getAnalysisResults(runId, {signal: controller.signal});
        if (cancelled) return;
        if (!Array.isArray(data.results))
          throw Error("Invalid results response");
        setResults(validateRunResults(r, data));
      } catch (e) {
        if (!cancelled) setError(e);
      }
    }
    poll();
    return () => {
      cancelled = true;
      clearTimeout(timer);
      controller.abort();
    };
  }, [runId, revision]);
  const running =
    !!runId && (!run || ["queued", "processing"].includes(run.status));
  async function create(e) {
    e.preventDefault();
    if (submitting.current || createError?.writeUncertain) return;
    submitting.current = true;
    setBusy(true);
    setCreateError(null);
    try {
      const data = await api.createAnalysisRun({
        store_id: "S001",
        run_type: "daily",
        as_of_date: date,
        scenario,
      });
      if (!data?.analysis_run?.id) throw Error("Missing analysis_run.id");
      if (active.current) navigate(runPath(data.analysis_run.id));
    } catch (e) {
      if (active.current) setCreateError(e);
    } finally {
      submitting.current = false;
      if (active.current) setBusy(false);
    }
  }
  return (
    <>
      <PageHeader
        eyebrow={t("Daily demand planning")}
        title={t(runId ? "Analysis run" : "Analysis")}
        description={t(
          "Follow the status and results for this analysis request.",
        )}
      />
      <div className="analysis-grid">
        <section className="panel request-panel">
          <div className="panel-heading">
            <h2>{t("Run daily analysis")}</h2>
          </div>
          <form onSubmit={create}>
            <div className="request-fields">
              <label className="field-group">
                {t("Store")}
                <input className="field-value" disabled value="S001" />
              </label>
              <label className="field-group">
                {t("Analysis date")}
                <input
                  className="field-value"
                  type="date"
                  required
                  value={date}
                  disabled={running || busy}
                  min={config.mode === "mock" ? "2022-06-30" : config.minimumAnalysisDate}
                  max={config.mode === "mock" ? "2022-06-30" : undefined}
                  onChange={(e) => setDate(e.target.value)}
                />
              </label>
              {config.mode === "mock" && (
                <label className="field-group">
                  {t("Demo scenario")}
                  <select
                    className="field-value"
                    value={scenario}
                    disabled={running || busy}
                    onChange={(e) => setScenario(e.target.value)}
                  >
                    {["success", "failure", "empty"].map((s) => (
                      <option key={s} value={s}>
                        {t(s)}
                      </option>
                    ))}
                  </select>
                </label>
              )}
            </div>
            <div className="request-footer">
              <button className="primary-button" disabled={running || busy || createError?.writeUncertain}>
                {t(
                  busy
                    ? "Creating…"
                    : running
                      ? "Analysis in progress"
                      : "Run Daily Analysis",
                )}
              </button>
            </div>
          </form>
          <Feedback error={createError} />
        </section>
        <section className="panel run-status-panel">
          <div className="panel-heading">
            <h2>{t("Run status")}</h2>
            {run && <Badge status={run.status} />}
          </div>
          <div className="workflow-body">
            {runId ? (
              <>
                <p className="workflow-id">
                  {t("Run ID")}: {runId}
                </p>
                {run && (
                  <>
                    <p>
                      {run.as_of_date} · {run.store_id}
                    </p>
                    <p className="workflow-id">{t("Job ID")}: {run.job.id} · {t(run.job.status)}</p>
                    <p>
                      {t("Products processed")}: {number(run.processed_count)} /{" "}
                      {number(run.expected_count)}
                    </p>
                    {run.error && (
                      <p role="alert">
                        {typeof run.error === "string"
                          ? run.error
                          : JSON.stringify(run.error)}
                      </p>
                    )}
                  </>
                )}
              </>
            ) : (
              <p>{t("No run selected")}</p>
            )}
            <Feedback
              loading={!!runId && !run && !error}
              error={error}
              reload={() => setRevision((x) => x + 1)}
            />
            {runId && (
              <Link className="text-link" to={`/logs?${new URLSearchParams({run_id: runId, ...(run?.job?.id ? {job_id: run.job.id} : {})})}`}>{t('View task logs')}</Link>
            )}
            {runId && (
              <Link className="text-link" to="/analysis">
                {t("Back to new analysis")}
              </Link>
            )}
          </div>
        </section>
      </div>
      {results && <Results data={results} runId={runId} />}
    </>
  );
}
function Results({ data, runId }) {
  const { t } = useLanguage(),
    rows = data.results;
  const total = rows.every((x) => Number.isFinite(x.recommended_order_quantity))
    ? rows.reduce((s, x) => s + x.recommended_order_quantity, 0)
    : null;
  return (
    <>
      {(data.partial || data.status === "failed") && (
        <p className="workflow-message workflow-error" role="alert">
          {t(
            "Partial results. Review is disabled until a complete successful run.",
          )}
        </p>
      )}
      <div className="summary-grid">
        <Metric label={t("Products processed")} value={rows.length} />
        <Metric label={t("Suggested quantity")} value={number(total)} />
        <Metric
          label={t("Exceptions")}
          value={rows.filter((x) => x.case_id).length}
        />
      </div>
      <section className="panel inventory-panel">
        <div className="panel-heading">
          <h2>{t("Forecast results")}</h2>
          <Link className="secondary-button" to={queuePath(runId)}>
            {t("Review exceptions")}
          </Link>
        </div>
        <div className="table-scroll">
          <table className="data-table">
            <thead>
              <tr>
                {[
                  "Product ID",
                  "On hand",
                  "Forecast horizon",
                  "Demand forecast",
                  "Safety stock",
                  "Suggested quantity",
                  "Decision",
                ].map((x) => (
                  <th key={x}>{t(x)}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((x) => (
                <tr key={x.id}>
                  <td>{x.product_id}</td>
                  <td>{number(x.inventory_at_prediction)}</td>
                  <td>
                    {number(x.horizon_days)} {t("days")}
                  </td>
                  <td>
                    {x.forecast_mode === "point_buffer" ? (
                      <>
                        {t("Point")}: {number(x.predicted_demand_point)}
                        <br />
                        {t("Buffer")}: {number(x.uncertainty_buffer)}
                      </>
                    ) : (
                      <>
                        P50: {number(x.predicted_demand_p50)}
                        <br />
                        P90: {number(x.predicted_demand_p90)}
                      </>
                    )}
                  </td>
                  <td>{number(x.safety_stock)}</td>
                  <td>{number(x.recommended_order_quantity)}</td>
                  <td>
                    {x.case_id ? (
                      <Link className="text-link" to={casePath(x.case_id)}>
                        {t("Inspect")}
                      </Link>
                    ) : (
                      t("Normal")
                    )}
                  </td>
                </tr>
              ))}
              {!rows.length && (
                <tr>
                  <td colSpan="7">
                    {t(data.partial || data.status === 'failed' ? 'No usable results were returned. This run did not complete successfully.' : 'No eligible products. The run completed successfully.')}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>
      {!!rows.length && (
        <section className="panel workflow-body">
          <h2>{t("Result traceability")}</h2>
          {rows.map((x) => (
            <details key={x.id}>
              <summary>
                {x.product_id} · {x.model_version}
              </summary>
              <p>{x.explanation}</p>
              <p className="workflow-id">{t("Source snapshot")}: {x.snapshot_id}</p>
              <p>{t("Processed at")}: {x.processed_at} · {number(x.duration_ms)} ms</p>
              <p>
                {t("Policy")}: {x.policy_version}
              </p>
              <p className="workflow-id">
                {t("Input reference")}: {x.input_reference}
              </p>
            </details>
          ))}
        </section>
      )}
    </>
  );
}
