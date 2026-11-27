import {useState} from 'react';
import {Link} from 'react-router';
import {useLanguage} from '../i18n.jsx';
import {number, casePath, queuePath} from '../workflow.js';
import {diagnosticSummary, relativeChange, sumKnown} from '../../frontend/reporting.js';
import {Metric} from './WorkflowUI.jsx';
import {BarChart, ChartCard, EmptyState} from './Charts.jsx';
import SnapshotTrend from './SnapshotTrend.jsx';

const decimal = value => Number.isFinite(value) ? value.toLocaleString(undefined, {maximumFractionDigits: 1}) : '—';
const units = value => number(Number.isFinite(value) ? Math.ceil(value) : null);
const signals = {persistent_high_sales: 'Sustained sales growth', persistent_low_sales: 'Sustained sales decline', long_stockout: 'Recurring stockouts', high_sales: 'Exceptionally high sales', persistent_zero_stock: 'Consecutive stockout days'};

export function MonthlyReport({scan}) {
  const {t} = useLanguage();
  const [filter, setFilter] = useState('flagged');
  const summary = diagnosticSummary(scan);
  const {rows, flagged, incomplete, limited, high, low, stockout} = summary;
  const groups = {all: rows, flagged, high, low, stockout, incomplete, limited};
  const comparison = flagged.filter(row => Number.isFinite(row.findings.persistent_high_sales?.reference_mean)).slice(0,6).map(row => {
    const f = row.findings.persistent_high_sales;
    const delta = relativeChange(f.reference_mean, f.recent_mean);
    return {label: row.product, before: f.reference_mean, after: f.recent_mean, note: delta === null ? t('From zero baseline') : `${delta > 0 ? '+' : ''}${decimal(delta)}%`};
  });
  return <>
    <section className="report-conclusion"><div><span className="eyebrow">{t('Monthly findings')}</span><h2>{flagged.length ? <>{flagged.length} {t('products deserve a closer look')}</> : t(incomplete.length || limited.length ? 'No anomalies in the checks that could be completed' : 'No persistent anomalies detected')} </h2><p>{rows.length} {t('products scanned')} · {t('Compare sustained sales changes and stockout patterns.')}</p></div><span className="conclusion-symbol" aria-hidden="true">▥</span></section>
    <div className="period-comparison"><span><i className="period-dot previous" />{t('Previous 28 days')}<strong>{scan.reference_start} — {scan.reference_end}</strong></span><span aria-hidden="true">→</span><span><i className="period-dot" />{t('Recent 28 days')}<strong>{scan.recent_start} — {scan.as_of_date}</strong></span></div>
    <div className="summary-grid report-metrics"><Metric label={t('Sustained sales growth')} value={high.length} hint={t('A demand signal to investigate')} /><Metric label={t('Sustained sales decline')} value={low.length} hint={t('Check demand and availability')} tone={low.length ? 'amber' : ''}/><Metric label={t('Recurring stockouts')} value={stockout.length} hint={t('Frequent or prolonged zero stock')} tone={stockout.length ? 'amber' : ''}/><Metric label={t('Checks needing more data')} value={new Set([...incomplete, ...limited].map(r => r.product)).size} hint={t('Missing history or stock-limited comparisons')} /></div>
    {!!comparison.length && <ChartCard title={t('How much have sales changed?')} description={t('Daily average on comparable, in-stock dates · units per day · up to 6 flagged products')}><BarChart label={t('Previous and recent daily sales averages')} rows={comparison} series={[{key: 'before', label: t('Previous 28 days')}, {key: 'after', label: t('Recent 28 days')}]} /></ChartCard>}
    {!!stockout.length && <ChartCard title={t('Has the stockout situation worsened?')} description={t('Zero-stock days in each 28-day period · up to 6 flagged products')}><BarChart label={t('Stockout days compared')} rows={stockout.slice(0,6).map(row => ({label: row.product, before: row.findings.long_stockout.reference?.zero_days, after: row.findings.long_stockout.recent?.zero_days}))} series={[{key: 'before', label: t('Previous 28 days')}, {key: 'after', label: t('Recent 28 days'), color: '#b87520'}]} /></ChartCard>}
    <ChartCard title={t('Product findings')} description={t('Select a group, then open a product for evidence and its daily sales chart.')}>
      <div className="filter-chips" role="group" aria-label={t('Filter product findings')}>{[['flagged', 'Needs attention'], ['high', 'Sales growth'], ['low', 'Sales decline'], ['stockout', 'Stockouts'], ['incomplete', 'Incomplete data'], ['limited', 'Stock-limited'], ['all', 'All products']].map(([key, label]) => <button type="button" key={key} className={filter === key ? 'is-active' : ''} aria-pressed={filter === key} onClick={() => setFilter(key)}>{t(label)}<span>{groups[key].length}</span></button>)}</div>
      <p className="chart-footnote">{t('A product can appear in more than one group. Missing or stock-limited checks are not counted as normal.')}</p>
      <div className="product-findings">{groups[filter].map(row => <ProductFinding key={row.product} row={row} scan={scan} />)}</div>
      {!groups[filter].length && <EmptyState title={t('No products in this group')} action={<button className="secondary-button" onClick={() => setFilter('all')}>{t('View all products')}</button>} />}
    </ChartCard>
    <details className="panel task-details"><summary>{t('How to read this analysis')}</summary><p>{t('Sales are compared on matched weekdays with stock available in both periods. Persistent change requires at least 3 comparable weeks, a 25% change and a minimum difference of 1 unit per day.')}</p><p>{t('A stockout alert means at least 7 zero-stock days or 3 stockout episodes in the recent 28 days. Growth is a signal to investigate, not automatically a problem.')}</p></details>
  </>;
}

function ProductFinding({row, scan}) {
  const {t} = useLanguage();
  const [open, setOpen] = useState(false);
  const entries = Object.entries(row.findings);
  const alerts = entries.filter(([, f]) => f.status === 'anomaly');
  const missing = entries.some(([, f]) => f.status === 'insufficient_data');
  const limited = entries.some(([, f]) => f.status === 'inventory_limited');
  const sales = row.findings.persistent_high_sales;
  const change = relativeChange(sales?.reference_mean, sales?.recent_mean);
  const stock = row.findings.long_stockout;
  return <details className="product-finding" onToggle={e => setOpen(e.currentTarget.open)}>
    <summary><div className="product-initial">{row.product.slice(-2)}</div><div className="product-finding-title"><strong>{row.product}</strong><div className="signal-tags">{alerts.map(([key]) => <span className={`signal-tag ${key === 'persistent_high_sales' ? 'signal-growth' : 'signal-warn'}`} key={key}>{t(signals[key])}</span>)}{missing && <span className="signal-tag">{t('Incomplete data')}</span>}{limited && <span className="signal-tag">{t('Stock-limited')}</span>}{!alerts.length && !missing && !limited && <span className="signal-tag">{t('Within thresholds')}</span>}</div></div><div className="product-change"><strong>{change === null ? '—' : `${change > 0 ? '+' : ''}${decimal(change)}%`}</strong><small>{t('Comparable daily sales')}</small></div><span className="expand-indicator" aria-hidden="true">+</span></summary>
    <div className="product-finding-content">
      {Number.isFinite(sales?.reference_mean) && <><p className="finding-sentence">{t('Comparable daily average')}: <strong>{decimal(sales.reference_mean)}</strong> → <strong>{decimal(sales.recent_mean)}</strong> {t('units')}. {t('Weeks meeting the change threshold')}: <strong>{number(alerts.find(([key]) => key.startsWith('persistent_'))?.[1].matching_weeks ?? Math.max(sales.matching_weeks || 0, row.findings.persistent_low_sales?.matching_weeks || 0))} / {number(sales.comparable_weeks)}</strong>.</p><BarChart label={`${row.product} · ${t('Comparable daily sales')}`} rows={[{label: row.product, before: sales.reference_mean, after: sales.recent_mean}]} series={[{key: 'before', label: t('Previous 28 days')}, {key: 'after', label: t('Recent 28 days')}]} /></>}
      {stock?.recent && <div className="finding-stockout"><span>{t('Zero-stock days (recent / previous)')}: <strong>{number(stock.recent.zero_days)} / {number(stock.reference?.zero_days)}</strong></span><span>{t('Recent stockout episodes')}: <strong>{number(stock.recent.periods)}</strong></span></div>}
      {(missing || limited) && <p className="data-quality-notice">{t(missing ? 'Some checks require 56 consecutive days of observations. Add missing records before drawing a conclusion.' : 'There are too few comparable in-stock days to judge the sales trend reliably.')}</p>}
      {open && <SnapshotTrend product={row.product} from={scan.recent_start} to={scan.as_of_date} />}
    </div>
  </details>;
}

export function DailyReport({data, runId}) {
  const {t} = useLanguage();
  const rows = data.results, exceptions = rows.filter(row => row.case_id);
  const partial = data.partial || data.status === 'failed';
  const sorted = [...rows].sort((a,b) => (b.recommended_order_quantity || 0) - (a.recommended_order_quantity || 0));
  return <>
    {partial && <p className="workflow-message workflow-error" role="alert">{t('Partial results. Review is disabled until a complete successful run.')}</p>}
    <section className="report-conclusion"><div><span className="eyebrow">{t(partial ? 'Saved partial findings' : 'Daily findings')}</span><h2>{exceptions.length} {t('products generated review cases')}</h2><p>{t('Compare saved stock with demand over each product’s lead time, then review the suggested action.')}</p></div>{!!exceptions.length && <Link className="primary-button" to={queuePath(runId)}>{t('View review cases')} →</Link>}</section>
    <div className="summary-grid"><Metric label={t('Products processed')} value={rows.length} /><Metric label={t('Suggested quantity')} value={units(sumKnown(rows, 'recommended_order_quantity'))} hint={t('Total across saved results; not an order')} /><Metric label={t('Review cases')} value={exceptions.length} hint={t('Open the queue to see current review status')} /></div>
    <ChartCard title={t('Stock versus demand coverage')} description={t('Top 6 by suggested quantity. Each product has its own lead-time horizon; these are cumulative quantities.')}><BarChart label={t('Stock versus demand coverage')} rows={sorted.slice(0,6).map(row => ({label: row.product_id, stock: row.inventory_at_prediction, demand: row.predicted_demand_p90, note: `${number(row.horizon_days)} ${t('days')}`}))} series={[{key: 'stock', label: t('On hand')}, {key: 'demand', label: t('Higher coverage estimate (P90)')}]} /></ChartCard>
    <ChartCard title={t('Product action list')} description={t('P50 is typical cumulative demand; P90 is a higher coverage estimate. Review decisions do not place orders.')}>
      <div className="table-scroll"><table className="data-table"><thead><tr>{['Product ID', 'On hand', 'Forecast horizon', 'Typical demand (P50)', 'Higher coverage (P90)', 'Suggested quantity', 'Next step'].map(label => <th key={label}>{t(label)}</th>)}</tr></thead><tbody>{sorted.map(row => <tr key={row.product_id}><td><strong>{row.product_id}</strong></td><td>{units(row.inventory_at_prediction)}</td><td>{number(row.horizon_days)} {t('days')}</td><td>{units(row.predicted_demand_p50 ?? row.predicted_demand_point)}</td><td>{units(row.predicted_demand_p90)}</td><td><strong>{units(row.recommended_order_quantity)}</strong></td><td>{row.case_id ? <Link className="text-link" to={casePath(row.case_id)}>{t('Review')} →</Link> : '—'}</td></tr>)}{!rows.length && <tr><td colSpan="7">{t('No forecast results were saved for this run.')}</td></tr>}</tbody></table></div>
    </ChartCard>
    {!!rows.length && <details className="panel task-details"><summary>{t('Model evidence & traceability')}</summary>{rows.map(row => <details className="trace-item" key={row.product_id}><summary>{row.product_id} · {row.model_version}</summary><p>{row.explanation}</p><dl className="metadata-grid"><div><dt>{t('Source snapshot')}</dt><dd>{row.snapshot_id}</dd></div><div><dt>{t('Policy')}</dt><dd>{row.policy_version}</dd></div><div><dt>{t('Input reference')}</dt><dd>{row.input_reference}</dd></div><div><dt>{t('Processed at')}</dt><dd>{row.processed_at}</dd></div></dl></details>)}</details>}
  </>;
}

export function Diagnostics({scan}) {
  const {t} = useLanguage();
  const {rows, flagged, incomplete, limited} = diagnosticSummary(scan);
  return <details className="panel task-details"><summary>{t('Daily anomaly checks')} · {flagged.length} / {rows.length} {t('products flagged')}</summary>
    {flagged.map(row => <div className="daily-finding" key={row.product}><strong>{row.product}</strong>{Object.entries(row.findings).filter(([, f]) => f.status === 'anomaly').map(([key, f]) => <p key={key}>{t(signals[key])}: {key === 'high_sales' ? `${t('Today’s sales')} ${decimal(f.observed)} · ${t('28-day daily average')} ${decimal(f.baseline)}` : `${f.lower_bound ? '≥ ' : ''}${number(f.observed)} ${t('days')}`}</p>)}</div>)}
    {!flagged.length && <p>{t('No anomalies detected in available data.')}</p>}
    {(incomplete.length > 0 || limited.length > 0) && <p className="data-quality-notice">{t('Incomplete data')}: {incomplete.length} · {t('Stock-limited')}: {limited.length}</p>}
  </details>;
}
