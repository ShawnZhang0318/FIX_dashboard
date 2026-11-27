import { useCallback, useState } from "react";
import { Link } from "react-router";
import PageHeader from "../components/PageHeader.jsx";
import { Feedback, Metric } from "../components/WorkflowUI.jsx";
import { useLanguage } from "../i18n.jsx";
import { useResource } from "../useResource.js";
import { api, number } from "../workflow.js";
import SnapshotTransferPanel from "../components/SnapshotTransferPanel.jsx";
import {InventorySchedule, useInventorySchedule} from "../components/InventorySchedule.jsx";
import { loadInventoryDay, localToday } from "../../frontend/daily-data.js";
import {BarChart, ChartCard} from '../components/Charts.jsx';

const isForecast = row => row.source_reference?.startsWith('forecast_auto/');
const isSimulated = row => isForecast(row) || row.source_reference?.startsWith('historical_simulation/') ||
  row.source_reference?.startsWith('synthetic-fixture/');

function forecastSource(row) {
  if (row.forecast_source === 'model') return 'Trained model';
  if (row.forecast_source === 'historical_baseline') return 'Historical sales baseline';
  return row.forecast_source || '—';
}

function total(rows, field) {
  return number(rows.length && rows.every(row => Number.isFinite(row[field]))
    ? rows.reduce((sum, row) => sum + row[field], 0) : null);
}

export default function InventoryPage() {
  const { t } = useLanguage(),
    [search, setSearch] = useState("");
  const [stockFilter, setStockFilter] = useState('all');
  const [selectedDate, setSelectedDate] = useState('');
  const schedule = useInventorySchedule();
  const latestSettlement = schedule.data?.last_settled_date;
  const state = useResource(useCallback(options => loadInventoryDay(api, selectedDate, options), [selectedDate, latestSettlement]));
  const rows = state.data?.snapshots || [], date = state.data?.date || '';
  const inventory = state.data?.inventory || [];
  const simulatedCount = rows.filter(isSimulated).length;
  const forecastRows = rows.filter(isForecast);
  const hasForecast = forecastRows.length > 0;
  const mixedSources = simulatedCount > 0 && simulatedCount < rows.length;
  const leadTimes = new Map(inventory.map(row => [row.product_id, row.lead_time_days]));
  const filtered = rows.filter((x) =>
      (x.product_id + " " + (x.category_raw || ""))
        .toLowerCase()
        .includes(search.toLowerCase()) && (stockFilter !== 'zero' || x.inventory_level === 0),
    );
  return (
    <>
      <PageHeader
        eyebrow={t("Store operations")}
        title={t("Inventory")}
        description={t(
          "Track daily sales, replenishment and closing stock by product.",
        )}
        actions={
          <Link className="primary-button" to="/analysis">
            {t("Go to Analysis")}
          </Link>
        }
      />
      <div className="report-context"><span>{t('Store')}: <strong>S001</strong></span><span>{t('Data date')}: <strong>{date || '—'}</strong></span><span>{t(simulatedCount ? 'Includes simulated records' : 'Saved inventory observations')}</span></div>
      <div className="panel daily-date-toolbar">
        <label className="field-group">{t('Data date')}
          <input className="field-value" type="date" max={schedule.data?.business_date || localToday()} value={selectedDate || date}
            onChange={e => setSelectedDate(e.target.value)} />
        </label>
        <button className="secondary-button" disabled={state.loading} onClick={() => {setSelectedDate(''); state.reload();}}>{t('Latest data')}</button>
        <button className="secondary-button" disabled={state.loading} onClick={state.reload}>{t('Refresh')}</button>
      </div>
      <Feedback {...state} />
      {state.data && (
        <>
          {simulatedCount > 0 && <p className="workflow-message" role="status">
            {t(mixedSources ? 'Totals include both simulated and observed records.' : hasForecast ? 'Forecast-based inventory settlement' : 'Simulated sales and inventory for this date.')}
          </p>}
          <div className="summary-grid daily-summary">
            {hasForecast ? <>
              <Metric label={t('Opening stock')} value={total(rows, 'opening_quantity')} />
              <Metric label={t('Total daily units sold')} value={total(rows, 'units_sold')} />
              <Metric label={t('Forecast replenishment received')} value={total(forecastRows, 'units_ordered')} />
              <Metric label={t('Closing stock')} value={total(rows, 'inventory_level')} />
            </> : <>
              <Metric label={t("Tracked products")} value={rows.length} />
              <Metric label={t(simulatedCount ? 'Total stock' : 'Total observed stock')} value={total(rows, 'inventory_level')} />
              <Metric label={t('Total daily units sold')} value={total(rows, 'units_sold')} />
              <Metric label={t('Data date')} value={date || '—'} />
            </>}
          </div>
          {rows.length < inventory.length && <p className="workflow-message" role="status">{t(rows.length ? 'Only part of the inventory is recorded for this date.' : 'No inventory has been recorded for this date.')} ({rows.length}/{inventory.length})</p>}
          <ChartCard title={t('Stock & sales by product')} description={t('6 products with the lowest closing stock. Stock alone does not determine replenishment needs.')}>
            <BarChart label={t('Stock & sales by product')} rows={[...rows].sort((a,b) => a.inventory_level-b.inventory_level).slice(0,6).map(row => ({label: row.product_id, stock: row.inventory_level, sales: row.units_sold}))} series={[{key: 'stock', label: t('Closing stock')}, {key: 'sales', label: t('Daily units sold')}]} />
          </ChartCard>
          <section className="panel inventory-panel">
            <div className="panel-heading">
              <div>
                <h2>{t("Inventory records")}</h2>
                <p>
                  {t(simulatedCount ? 'Sales and closing stock by product.' : 'Stock and units sold below are saved observations for the selected data date.')}
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
              <div className="filter-chips" role="group" aria-label={t('Stock filter')}><button className={stockFilter === 'all' ? 'is-active' : ''} aria-pressed={stockFilter === 'all'} onClick={() => setStockFilter('all')}>{t('All products')}<span>{rows.length}</span></button><button className={stockFilter === 'zero' ? 'is-active' : ''} aria-pressed={stockFilter === 'zero'} onClick={() => setStockFilter('zero')}>{t('Zero stock')}<span>{rows.filter(row => row.inventory_level === 0).length}</span></button></div>
            </div>
            <div className="table-scroll">
              <table className="data-table daily-observations-table">
                <thead>
                  <tr>
                    {[
                      "Product ID",
                      ...(hasForecast ? ['Opening stock', 'Forecast unit sales'] : []),
                      "Daily units sold",
                      ...(hasForecast ? ['Forecast replenishment received'] : []),
                      simulatedCount ? "Closing stock" : "Observed stock",
                      ...(hasForecast ? ['Forecast source'] : ["Snapshot date"]),
                      "Category",
                      "Lead time",
                      ...(mixedSources ? ['Record source'] : []),
                    ].map((x) => (
                      <th key={x}>{t(x)}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((x) => (
                    <tr key={x.store_id + ":" + x.product_id}>
                      <td>{x.product_id}</td>
                      {hasForecast && <><td>{number(x.opening_quantity)}</td><td>{number(x.predicted_units_sold)}</td></>}
                      <td className="observed-value">{number(x.units_sold)}</td>
                      {hasForecast && <td>{isForecast(x) ? number(x.units_ordered) : '—'}</td>}
                      <td className="observed-value">{number(x.inventory_level)}</td>
                      <td>{hasForecast ? t(forecastSource(x)) : x.snapshot_date}</td>
                      <td>{x.category_raw || "—"}</td>
                      <td>
                        {number(leadTimes.get(x.product_id))} {t("days")}
                      </td>
                      {mixedSources && <td>{t(isSimulated(x) ? 'Simulated' : 'Observed')}</td>}
                    </tr>
                  ))}
                  {!filtered.length && (
                    <tr>
                      <td colSpan={6 + (hasForecast ? 3 : 0) + (mixedSources ? 1 : 0)}>{t("No matching records.")}</td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </section>
        </>
      )}
      <details className="panel task-details"><summary>{t('Automatic settlement & schedule')}</summary><InventorySchedule state={schedule} /></details>
      <SnapshotTransferPanel />
    </>
  );
}
