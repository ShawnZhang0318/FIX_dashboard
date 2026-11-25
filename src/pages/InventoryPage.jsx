import { useCallback, useState } from "react";
import { Link } from "react-router";
import PageHeader from "../components/PageHeader.jsx";
import { Feedback, Metric } from "../components/WorkflowUI.jsx";
import { useLanguage } from "../i18n.jsx";
import { useResource } from "../useResource.js";
import { api, config, number } from "../workflow.js";
import SnapshotTransferPanel from "../components/SnapshotTransferPanel.jsx";
<<<<<<< HEAD
import DailyUpdatePanel from "../components/DailyUpdatePanel.jsx";
=======
import DailyDataForm from "../components/DailyDataForm.jsx";
import { loadInventoryDay, localToday } from "../../frontend/daily-data.js";
>>>>>>> dcece0f0ba4daceb05d77eff1abd4365943f7a87
export default function InventoryPage() {
  const { t } = useLanguage(),
    [search, setSearch] = useState("");
  const [selectedDate, setSelectedDate] = useState(''), [editing, setEditing] = useState(false);
  const [saved, setSaved] = useState(null);
  const state = useResource(useCallback(options => loadInventoryDay(api, selectedDate, options), [selectedDate]));
  const rows = state.data?.snapshots || [], date = state.data?.date || '';
  const inventory = state.data?.inventory || [];
  const leadTimes = new Map(inventory.map(row => [row.product_id, row.lead_time_days]));
  const analysisLink = date ? `/analysis?${new URLSearchParams({as_of_date: date})}` : '/analysis';
  function onSaved(day, count) {
    setEditing(false); setSaved({date: day, count}); setSelectedDate(day); state.reload();
  }
  const filtered = rows.filter((x) =>
      (x.product_id + " " + (x.category_raw || ""))
        .toLowerCase()
        .includes(search.toLowerCase()),
    );
  return (
    <>
      <PageHeader
        eyebrow={t("Store operations")}
        title={t("Inventory")}
        description={t(
          "Review stock and daily sales by data date, or record a new day's observations.",
        )}
        actions={
          <Link className="primary-button" to={analysisLink}>
            {t("Analyze this date")}
          </Link>
        }
      />
      {saved && <p className="workflow-message" role="status">{t('Daily records saved')}: {saved.date} · {saved.count} {t('products')}.</p>}
      <div className="panel daily-date-toolbar">
        <label className="field-group">{t('Data date')}
          <input className="field-value" type="date" max={localToday()} value={selectedDate || date}
            disabled={editing} onChange={e => setSelectedDate(e.target.value)} />
        </label>
        <button className="secondary-button" disabled={editing || state.loading} onClick={() => {setSelectedDate(''); state.reload();}}>{t('Latest data')}</button>
        <button className="secondary-button" disabled={editing || state.loading} onClick={state.reload}>{t('Refresh')}</button>
        <button className="primary-button" disabled={editing || state.loading || !rows.length || config.mode !== 'live'}
          onClick={() => {setSaved(null); setEditing(true);}}>{t('Record daily sales and stock')}</button>
      </div>
      <Feedback {...state} />
      {state.data && (
        <>
          <div className="summary-grid daily-summary">
            <Metric label={t("Tracked products")} value={rows.length} />
            <Metric
              label={t("Total observed stock")}
              value={number(
                rows.length && rows.every((x) => Number.isFinite(x.inventory_level))
                  ? rows.reduce((s, x) => s + x.inventory_level, 0)
                  : null,
              )}
            />
            <Metric label={t('Total daily units sold')} value={rows.length ? number(rows.reduce((sum, row) => sum + row.units_sold, 0)) : '—'} />
            <Metric label={t('Data date')} value={date || '—'} />
          </div>
          {rows.length < inventory.length && <p className="workflow-message" role="status">{t('This date has incomplete product coverage. Add the missing observations before running Daily analysis.')} ({rows.length}/{inventory.length})</p>}
          {editing && <DailyDataForm key={date} snapshots={rows} date={date} onSaved={onSaved} onClose={() => setEditing(false)} />}
          <section className="panel inventory-panel">
            <div className="panel-heading">
              <div>
                <h2>{t("Inventory records")}</h2>
                <p>
                  {t(
                    "Stock and units sold below are saved observations for the selected data date.",
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
              <span>{t('Store')}: S001 · {t('Data date')}: {date || '—'}</span>
            </div>
            <div className="table-scroll">
              <table className="data-table daily-observations-table">
                <thead>
                  <tr>
                    {[
                      "Product ID",
                      "Observed stock",
                      "Daily units sold",
                      "Snapshot date",
                      "Category",
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
                      <td className="observed-value">{number(x.inventory_level)}</td>
                      <td className="observed-value">{number(x.units_sold)}</td>
                      <td>{x.snapshot_date}</td>
                      <td>{x.category_raw || "—"}</td>
                      <td>
                        {number(leadTimes.get(x.product_id))} {t("days")}
                      </td>
                    </tr>
                  ))}
                  {!filtered.length && (
                    <tr>
                      <td colSpan="6">{t("No matching records.")}</td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </section>
        </>
      )}
<<<<<<< HEAD
      <DailyUpdatePanel onImported={state.reload} />
      <SnapshotTransferPanel onImported={state.reload} />
=======
      {!editing && <SnapshotTransferPanel onImported={state.reload} />}
>>>>>>> dcece0f0ba4daceb05d77eff1abd4365943f7a87
    </>
  );
}
