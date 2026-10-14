import { useCallback, useState } from "react";
import { Link } from "react-router";
import PageHeader from "../components/PageHeader.jsx";
import { Feedback, Metric } from "../components/WorkflowUI.jsx";
import { useLanguage } from "../i18n.jsx";
import { useResource } from "../useResource.js";
import { api, number } from "../workflow.js";
export default function InventoryPage() {
  const { t } = useLanguage(),
    [search, setSearch] = useState("");
  const state = useResource(useCallback(() => api.getInventory(), []));
  const rows = state.data || [],
    filtered = rows.filter((x) =>
      (x.product_id + " " + (x.name || ""))
        .toLowerCase()
        .includes(search.toLowerCase()),
    );
  return (
    <>
      <PageHeader
        eyebrow={t("Store operations")}
        title={t("Inventory")}
        description={t(
          "Review the latest stock position for the selected store.",
        )}
        actions={
          <Link className="primary-button" to="/analysis">
            {t("Go to Analysis")}
          </Link>
        }
      />
      <Feedback {...state} />
      {state.data && (
        <>
          <div className="summary-grid">
            <Metric label={t("Tracked products")} value={rows.length} />
            <Metric
              label={t("On-hand units")}
              value={number(
                rows.every((x) => Number.isFinite(x.on_hand_quantity))
                  ? rows.reduce((s, x) => s + x.on_hand_quantity, 0)
                  : null,
              )}
            />
            <Metric label={t("Store")} value="S001" />
          </div>
          <section className="panel inventory-panel">
            <div className="panel-heading">
              <div>
                <h2>{t("Inventory records")}</h2>
                <p>
                  {t(
                    "Historical snapshots may not reflect today's live stock.",
                  )}
                </p>
              </div>
            </div>
            <div className="table-toolbar">
              <label className="field-group">
                {t("Search products")}
                <input
                  className="field-value"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                />
              </label>
              <button className="secondary-button" onClick={state.reload}>
                {t("Refresh")}
              </button>
            </div>
            <div className="table-scroll">
              <table className="data-table">
                <thead>
                  <tr>
                    {[
                      "Product ID",
                      "Category",
                      "On hand",
                      "Snapshot date",
                      "Lead time",
                    ].map((x) => (
                      <th key={x}>{t(x)}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((x) => (
                    <tr key={x.store_id + ":" + x.product_id}>
                      <td>{x.product_id}</td>
                      <td>{x.category || "—"}</td>
                      <td>{number(x.on_hand_quantity)}</td>
                      <td>{x.snapshot_date}</td>
                      <td>
                        {number(x.lead_time_days)} {t("days")}
                      </td>
                    </tr>
                  ))}
                  {!filtered.length && (
                    <tr>
                      <td colSpan="5">{t("No matching records.")}</td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </section>
        </>
      )}
    </>
  );
}
