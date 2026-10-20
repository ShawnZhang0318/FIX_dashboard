import { useCallback, useEffect, useRef, useState } from "react";
import { Link, useParams, useSearchParams } from "react-router";
import PageHeader from "../components/PageHeader.jsx";
import { Feedback, Badge, Metric } from "../components/WorkflowUI.jsx";
import { useLanguage } from "../i18n.jsx";
import { useResource } from "../useResource.js";
import { api, number, casePath, runPath, queuePath } from "../workflow.js";
export default function ExceptionsPage() {
  const { caseId } = useParams();
  return caseId ? <ExceptionDetail key={caseId} caseId={caseId} /> : <Queue />;
}
function Queue() {
  const { t } = useLanguage(),
    [params, setParams] = useSearchParams();
  const runId = params.get("run_id") || "",
    status = params.get("status") || "";
  const state = useResource(
    useCallback(
      options => api.getExceptions({ store_id: "S001", run_id: runId, status }, options),
      [runId, status],
    ),
  );
  return (
    <>
      <PageHeader
        eyebrow={t("Planner review")}
        title={t("Exceptions")}
        description={t(
          "Open a case to understand its forecast and record a review decision.",
        )}
      />
      <section className="panel exceptions-panel">
        <div className="panel-heading">
          <h2>{t("Exception queue")}</h2>
          {runId && (
            <Link className="text-link" to={runPath(runId)}>
              {t("Analysis run")}
            </Link>
          )}
        </div>
        <div className="table-toolbar">
          <label className="field-group">
            {t("Status")}
            <select
              className="field-value"
              value={status}
              onChange={(e) => {
                const next = new URLSearchParams(params);
                if (e.target.value) next.set("status", e.target.value);
                else next.delete("status");
                setParams(next);
              }}
            >
              <option value="">{t("All cases")}</option>
              {[
                "pending_review",
                "approved",
                "modified",
                "rejected",
                "resolved",
              ].map((s) => (
                <option value={s} key={s}>
                  {t(s)}
                </option>
              ))}
            </select>
          </label>
          <button className="secondary-button" onClick={state.reload}>
            {t("Refresh")}
          </button>
          {runId && (
            <Link className="text-link" to="/exceptions">
              {t("All cases")}
            </Link>
          )}
        </div>
        <Feedback {...state} />
        {state.data && (
          <div className="table-scroll">
            <table className="data-table">
              <thead>
                <tr>
                  {[
                    "Product ID",
                    "Exception type",
                    "Status",
                    "Suggested quantity",
                    "Run",
                    "Decision",
                  ].map((s) => (
                    <th key={s}>{t(s)}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {state.data.map((c) => (
                  <tr key={c.id}>
                    <td>{c.result.product_id}</td>
                    <td>{t(c.exception_type)}</td>
                    <td>
                      <Badge status={c.status} />
                    </td>
                    <td>{number(c.result.recommended_order_quantity)}</td>
                    <td>
                      <Link
                        className="text-link"
                        to={runPath(c.analysis_run_id)}
                      >
                        {t(c.parent_run_status)}
                      </Link>
                    </td>
                    <td>
                      <Link className="text-link" to={casePath(c.id)}>
                        {t("Inspect")}
                      </Link>
                    </td>
                  </tr>
                ))}
                {!state.data.length && (
                  <tr>
                    <td colSpan="6">{t("No matching records.")}</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </>
  );
}
function ExceptionDetail({ caseId }) {
  const { t } = useLanguage(),
    state = useResource(useCallback(options => api.getException(caseId, options), [caseId]));
  const c = state.data,
    x = c?.result;
  return (
    <>
      <PageHeader
        eyebrow={t("Planner review")}
        title={t("Exception details")}
        description={t(
          "Review the supporting forecast before recording a decision.",
        )}
        actions={
          <Link
            className="secondary-button"
            to={c ? queuePath(c.analysis_run_id) : "/exceptions"}
          >
            {t("Back to queue")}
          </Link>
        }
      />
      <Feedback {...state} />
      {c && (
        <>
          <div className="summary-grid">
            <Metric label={t("Product ID")} value={x.product_id} />
            <Metric
              label={t("On hand")}
              value={number(x.inventory_at_prediction)}
            />
            <Metric
              label={t("Suggested quantity")}
              value={number(x.recommended_order_quantity)}
            />
          </div>
          <div className="detail-layout">
            <section className="panel case-detail-panel">
              <div className="panel-heading">
                <h2>{t("Exception case")}</h2>
                <Badge status={c.status} />
              </div>
              <div className="workflow-body">
                <p className="workflow-id">{caseId}</p>
                <p>
                  {t("Forecast horizon")}: {number(x.horizon_days)} {t("days")}
                </p>
                <p>{x.explanation}</p>
                <p>
                  {t("Model version")}: {x.model_version}
                </p>
                <p>
                  {t("Policy")}: {x.policy_version}
                </p>
                <p className="workflow-id">
                  {t("Input reference")}: {x.input_reference}
                </p>
                <p className="workflow-id">{t("Source snapshot")}: {x.snapshot_id}</p>
                <Link className="text-link" to={runPath(c.analysis_run_id)}>
                  {t("Analysis run")} · {t(c.parent_run_status)}
                </Link>
              </div>
            </section>
            <section className="panel review-panel">
              <div className="panel-heading">
                <h2>{t("Record review")}</h2>
              </div>
              {c.status !== "pending_review" ? (
                <div className="workflow-body" role="status">
                  <Badge status={c.status} />
                  <p>
                    {t("Reviewed quantity")}:{" "}
                    {number(c.reviewer_order_quantity)}
                  </p>
                  <p>
                    {t("Reviewer")}: {c.reviewer_label}
                  </p>
                  <p>
                    {t("Reason")}: {c.override_reason || "—"}
                  </p>
                  <p>{c.reviewed_at}</p>
                </div>
              ) : c.parent_run_status !== "completed" || c.partial ? (
                <p className="workflow-message workflow-error">
                  {t(
                    "Partial results. Review is disabled until a complete successful run.",
                  )}
                </p>
              ) : (
                <ReviewForm c={c} onSaved={state.reload} />
              )}
            </section>
          </div>
          <p className="workflow-message">
            {t(
              "Approve or modify a recommendation records a planner's decision. It does not place an order or change inventory.",
            )}
          </p>
        </>
      )}
    </>
  );
}
function ReviewForm({ c, onSaved }) {
  const { t } = useLanguage();
  const [decision, setDecision] = useState(
      c.exception_type === "anomaly" ? "resolve" : "approve",
    ),
    [quantity, setQuantity] = useState(
      String(c.result.recommended_order_quantity),
    ),
    [reviewer, setReviewer] = useState(""),
    [reason, setReason] = useState(""),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(null);
  const lock = useRef(false),
    active = useRef(true);
  const reasonRequired = decision !== "approve" || c.exception_type === "reorder_and_anomaly";
  useEffect(() => {
    active.current = true;
    return () => {
      active.current = false;
    };
  }, []);
  async function save(e) {
    e.preventDefault();
    if (lock.current) return;
    if (!reviewer.trim() || (reasonRequired && !reason.trim())) {
      setError(Error(t("Reviewer and a reason are required.")));
      return;
    }
    lock.current = true;
    setBusy(true);
    setError(null);
    try {
      await api.submitReview(c.id, {
        decision,
        reviewer_label: reviewer.trim(),
        ...(decision === "modify" ? {reviewer_order_quantity: Number(quantity)} : {}),
        override_reason: reason.trim(),
      });
      if (active.current) onSaved();
    } catch (e) {
      if (active.current) setError(e);
    } finally {
      lock.current = false;
      if (active.current) setBusy(false);
    }
  }
  return (
    <form className="workflow-body workflow-form" onSubmit={save}>
      <fieldset disabled={busy}>
        <label className="field-group">
          {t("Decision")}
          <select
            className="field-value"
            value={decision}
            onChange={(e) => setDecision(e.target.value)}
          >
            {(c.exception_type === "anomaly"
              ? ["resolve"]
              : ["approve", "modify", "reject"]
            ).map((s) => (
              <option value={s} key={s}>
                {t(s)}
              </option>
            ))}
          </select>
        </label>
        <label className="field-group">
          {t("Reviewer")}
          <input
            className="field-value"
            required
            maxLength="100"
            value={reviewer}
            onChange={(e) => setReviewer(e.target.value)}
          />
        </label>
        {decision === "modify" && (
          <label className="field-group">
            {t("Reviewed quantity")}
            <input
              className="field-value"
              type="number"
              required
              min="0"
              step="1"
              value={quantity}
              onChange={(e) => setQuantity(e.target.value)}
            />
          </label>
        )}
        <label className="field-group">
          {t("Reason")}
          <textarea
            className="field-value"
            required={reasonRequired}
            maxLength="1000"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
          />
        </label>
        {c.exception_type === "reorder_and_anomaly" && <p>{t("The review note must address both the anomaly and replenishment.")}</p>}
        <button
          className="primary-button"
          disabled={busy || error?.status === 409 || error?.writeUncertain}
        >
          {t(busy ? "Saving…" : "Save review")}
        </button>
      </fieldset>
      <Feedback error={error} />
      {error && (
        <button type="button" className="secondary-button" onClick={onSaved}>
          {t("Load latest case before retrying")}
        </button>
      )}
    </form>
  );
}
