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

const units = (value) => number(Number.isFinite(value) ? Math.ceil(value) : null);

function localToday() {
  const today = new Date();
  return [today.getFullYear(), String(today.getMonth() + 1).padStart(2, "0"), String(today.getDate()).padStart(2, "0")].join("-");
}

export default function AnalysisPage() {
  const { runId } = useParams();
  return <AnalysisWorkspace key={runId || "new"} runId={runId} />;
}
function AnalysisWorkspace({ runId }) {
  const { t } = useLanguage(),
    navigate = useNavigate();
  const monthlyRecommendationsAvailable = false;
  const [scenario, setScenario] = useState("success");
  const [mode, setMode] = useState("daily");
  const [run, setRun] = useState(null),
    [results, setResults] = useState(null),
    [error, setError] = useState(null),
    [createError, setCreateError] = useState(null),
    [busy, setBusy] = useState(false),
    [revision, setRevision] = useState(0);
  const analysisDate = run?.as_of_date || (config.mode === "mock" ? "2022-06-30" : localToday());
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
        if (r.run_type) setMode(r.run_type);
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
        run_type: mode,
        as_of_date: analysisDate,
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
        description={t("Run a Daily analysis for today or a Monthly forecast for the next 30 days. Past analyses are in Logs.")}
      />
      <div className="analysis-grid">
        <section className="panel request-panel">
          <div className="panel-heading">
            <h2>{t("Choose an analysis period")}</h2>
          </div>
          <form onSubmit={create}>
            <div className="analysis-mode-picker" role="group" aria-label={t("Analysis period")}>
              <button
                className={`analysis-mode-card${mode === "daily" ? " is-selected" : ""}`}
                type="button"
                aria-pressed={mode === "daily"}
                disabled={running || busy}
                onClick={() => setMode("daily")}
              >
                <span className="analysis-mode-card__title">{t("Daily")}</span>
                <span className="analysis-mode-card__summary">{t("Analyze today's demand and recommend replenishment")}</span>
                <span className="analysis-mode-card__detail">{t(config.mode === "mock" ? "Demo data date" : "Analysis date")}: <strong>{analysisDate}</strong></span>
              </button>
              <button
                className={`analysis-mode-card${mode === "monthly" ? " is-selected" : ""}`}
                type="button"
                aria-pressed={mode === "monthly"}
                disabled={running || busy || config.mode === "mock"}
                onClick={() => setMode("monthly")}
              >
                <span className="analysis-mode-card__title">{t("Monthly")}</span>
                <span className="analysis-mode-card__summary">{t("Forecast demand and recommendations for the next 30 days")}</span>
                <span className="analysis-mode-card__detail">{t("Forecast window")}: <strong>{t("Next 30 days")}</strong></span>
              </button>
            </div>
            {(config.mode === "mock" || !monthlyRecommendationsAvailable) && <p className="analysis-mode-note">{t("Monthly recommendations are not available yet. The current API monthly mode is a historical anomaly scan, so it will not be started here.")}</p>}
            <p className="analysis-data-note">{t("Daily analysis needs a complete snapshot for all products today and 29 days of history. If required data is missing, the API will reject the request.")}</p>
            <div className="request-fields">
              <label className="field-group">
                {t("Store")}
                <input className="field-value" disabled value="S001" />
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
              <button className="primary-button" disabled={running || busy || createError?.writeUncertain || (mode === "monthly" && !monthlyRecommendationsAvailable)}>
                {t(
                  busy
                    ? "Creating…"
                    : running
                      ? "Analysis in progress"
                      : mode === "monthly" ? "Monthly Forecast Coming Soon" : "Run Daily Analysis",
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
                    {run.run_type !== "monthly" && <p>
                      {t("Products processed")}: {number(run.processed_count)} /{" "}
                      {number(run.expected_count)}
                    </p>}
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
              <Link className="text-link" to={`/logs?${new URLSearchParams({source: 'backend', run_id: runId, ...(run?.job?.id ? {job_id: run.job.id} : {})})}`}>{t('View task logs')}</Link>
            )}
            {runId && (
              <Link className="text-link" to="/analysis">
                {t("Back to new analysis")}
              </Link>
            )}
          </div>
        </section>
      </div>
      {results?.diagnostics && <Diagnostics scan={results.diagnostics} />}
      {results && (run?.run_type !== "monthly" || results.status === "failed") &&
        <Results data={results} runId={runId} />}
    </>
  );
}
function Diagnostics({ scan }) {
  const { t } = useLanguage();
  const monthly = scan.mode === "monthly";
  const rows = Object.entries(scan.products);
  const flagged = rows.map(([product, findings]) => [
    product, Object.entries(findings).filter(([, finding]) => finding.status === "anomaly"),
  ]).filter(([, findings]) => findings.length);
  const count = (status) => rows.filter(([, findings]) =>
    Object.values(findings).some((finding) => finding.status === status)).length;
  const incomplete = count("insufficient_data");
  const limited = count("inventory_limited");

  return (
    <section className="panel inventory-panel">
      <div className="panel-heading">
        <h2>{t(monthly ? "Monthly full scan" : "Daily diagnostics")}</h2>
        <span>{flagged.length} / {rows.length} {t("SKUs flagged")}</span>
      </div>
      <div className="workflow-body diagnostic-body">
        {monthly && (
          <div className="diagnostic-context">
            <div>{t("Recent 28 days")}: {scan.recent_start} – {scan.as_of_date}</div>
            <div>{t("Previous 28 days")}: {scan.reference_start} – {scan.reference_end}</div>
          </div>
        )}
        {flagged.length ? (
          <ul className="diagnostic-alert-list">
            {flagged.map(([product, findings]) => (
              <li key={product}>
                <h3>{product}</h3>
                {findings.map(([signal, finding]) => (
                  <DiagnosticFinding key={signal} signal={signal} finding={finding} />
                ))}
              </li>
            ))}
          </ul>
        ) : <p>{t("No anomalies detected in available data.")}</p>}
        {(!!incomplete || !!limited) && (
          <div className="diagnostic-context">
            {!!incomplete && <div>{t("SKUs with incomplete checks")}: {incomplete}</div>}
            {!!limited && <div>{t("SKUs with stock-limited sales checks")}: {limited}</div>}
          </div>
        )}
      </div>
    </section>
  );
}

function DiagnosticFinding({ signal, finding }) {
  const { t } = useLanguage();
  let evidence;
  if (signal === "high_sales") {
    evidence = [
      ["28-day daily average", units(finding.baseline)],
      ["Today’s sales", units(finding.observed)],
    ];
  } else if (signal === "persistent_zero_stock") {
    evidence = [["Consecutive zero-stock days",
      `${finding.lower_bound ? "≥ " : ""}${number(finding.observed)}`]];
  } else if (signal === "long_stockout") {
    evidence = [
      ["Zero-stock days (recent / previous)", `${number(finding.recent?.zero_days)} / ${number(finding.reference?.zero_days)}`],
      ["Recent stockout episodes", number(finding.recent?.periods)],
      ["Longest recent stockout (days)", number(finding.recent?.longest_streak)],
    ];
  } else {
    evidence = [
      ["Previous daily sales average", units(finding.reference_mean)],
      ["Recent daily sales average", units(finding.recent_mean)],
      ["Comparable weeks with this trend", `${number(finding.matching_weeks)} / ${number(finding.comparable_weeks)}`],
    ];
  }
  return (
    <div className="diagnostic-finding">
      <strong>{t(signal === "high_sales" ? "Exceptionally high sales" : signal)}</strong>
      {evidence.map(([label, value]) => <div key={label}>{t(label)}: {value}</div>)}
    </div>
  );
}
function Results({ data, runId }) {
  const { t } = useLanguage(),
    rows = data.results;
  const exceptions = rows.filter((x) => x.case_id);
  const total = exceptions.every((x) => Number.isFinite(x.recommended_order_quantity))
    ? exceptions.reduce((s, x) => s + Math.ceil(x.recommended_order_quantity), 0)
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
        <Metric label={t("Suggested quantity")} value={units(total)} />
        <Metric
          label={t("Exceptions")}
          value={exceptions.length}
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
                  "Demand forecast (P90)",
                  "Suggested quantity",
                  "Decision",
                ].map((x) => (
                  <th key={x}>{t(x)}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {exceptions.map((x) => (
                <tr key={x.id}>
                  <td>{x.product_id}</td>
                  <td>{units(x.inventory_at_prediction)}</td>
                  <td>
                    {number(x.horizon_days)} {t("days")}
                  </td>
                  <td>
                    {units(x.predicted_demand_p90)}
                  </td>
                  <td>{units(x.recommended_order_quantity)}</td>
                  <td>
                    <Link className="text-link analysis-inspect-link" to={casePath(x.case_id)}>
                      {t("Inspect")}
                    </Link>
                  </td>
                </tr>
              ))}
              {!exceptions.length && (
                <tr>
                  <td colSpan="6">
                    {t(data.partial || data.status === 'failed' ? 'No forecast exceptions were saved before this run stopped.' : 'No forecast exceptions.')}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>
      {!!exceptions.length && (
        <details className="panel workflow-body">
          <summary>{t("Result traceability")}</summary>
          {exceptions.map((x) => (
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
        </details>
      )}
    </>
  );
}
