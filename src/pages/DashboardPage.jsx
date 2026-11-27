import {useCallback, useSyncExternalStore} from 'react';
import {Link} from 'react-router';
import PageHeader from '../components/PageHeader.jsx';
import {Badge, Feedback, Metric} from '../components/WorkflowUI.jsx';
import {BarChart, ChartCard, DonutChart, EmptyState, LineChart} from '../components/Charts.jsx';
import {useLanguage} from '../i18n.jsx';
import {useResource} from '../useResource.js';
import {api, config, number, casePath, runPath} from '../workflow.js';
import {loadInventoryDay} from '../../frontend/daily-data.js';
import {dailySeries, shiftDate, simulatedSnapshot, sumKnown, diagnosticSummary} from '../../frontend/reporting.js';
import {validateRunResults} from '../../frontend/contracts.js';
import {activityLog} from '../../frontend/activity-log.js';

export default function DashboardPage() {
  const {t} = useLanguage();
  const stock = useResource(useCallback(options => loadInventoryDay(api, '', options), []));
  const cases = useResource(useCallback(options => api.getExceptions({store_id: 'S001', status: 'pending_review'}, options), []));
  const span = useResource(useCallback(options => api.getLatestSnapshot({store_id: 'S001'}, options), []));
  const date = stock.data?.date;
  const history = useResource(useCallback(options => date ? api.getSnapshots({store_id: 'S001', from: shiftDate(date, -13), to: date}, options) : Promise.resolve(null), [date]));
  const rows = stock.data?.snapshots || [];
  const roster = stock.data?.inventory.map(row => row.product_id) || [];
  const pending = cases.data || [];
  const missing = roster.filter(id => !rows.some(row => row.product_id === id)).length;
  const zero = rows.filter(row => row.inventory_level === 0).length;
  const points = history.data ? dailySeries(history.data, {from: shiftDate(date, -13), to: date, products: roster}) : [];
  const simulated = rows.some(simulatedSnapshot);
  function refresh() {stock.reload(); cases.reload(); span.reload(); history.reload();}
  return <>
    <PageHeader eyebrow={t('Store S001 · Operations overview')} title={t('Overview')}
      description={t('Stock, sales and decisions — start with what needs attention.')}
      actions={<><button className="secondary-button" onClick={refresh}>{t('Refresh')}</button><Link className="primary-button" to="/analysis">{t('New analysis')} <span aria-hidden="true">↗</span></Link></>} />
    <div className="report-context"><span><i />{t('Data date')}: <strong>{date || '—'}</strong></span><span>{t('Store')}: <strong>S001</strong></span><span>{t(simulated ? 'Includes simulated records' : 'Saved inventory observations')}</span></div>
    <Feedback loading={stock.loading} error={stock.error} reload={stock.reload} />
    <Feedback error={span.error} reload={span.reload} />
    {span.data?.cutoff_date && date && span.data.cutoff_date !== date && <div className="data-quality-notice"><strong>{t('Analysis date differs from the latest record')}</strong><span>{t('Latest record')}: {date} · {t('Runnable daily analysis')}: {span.data.cutoff_date}. {t('Gaps in history can move the analysis cutoff back.')}</span><Link to="/inventory" className="text-link">{t('Check inventory history')} →</Link></div>}
    <div className="summary-grid report-metrics">
      <Metric label={t('Closing stock')} value={number(sumKnown(rows, 'inventory_level'))} hint={`${t('Recorded products')}: ${stock.data ? rows.length : '—'} / ${stock.data ? roster.length : '—'}`} />
      <Metric label={t('Total daily units sold')} value={number(sumKnown(rows, 'units_sold'))} hint={date || t('Awaiting inventory data')} />
      <Metric label={t('Products out of stock')} value={stock.data ? zero : '—'} tone={zero ? 'amber' : ''} hint={t('Zero closing stock on the data date')} />
      <Metric label={t('Awaiting review')} value={cases.data ? pending.length : '—'} tone={pending.length ? 'amber' : ''} hint={t('Recommendations awaiting a decision')} />
    </div>
    <div className="report-grid report-grid-wide">
      <ChartCard title={t('Sales over the last 14 days')} description={date ? `${shiftDate(date, -13)} — ${date} · ${t('All recorded products')}` : t('Awaiting inventory data')}>
        <Feedback loading={history.loading && !!date} error={history.error} reload={history.reload} />
        {history.data && <LineChart points={points} label={t('Store daily unit sales')} unit={t('units')} />}
        {!date && !stock.loading && <EmptyState title={t('No inventory data yet')} />}
      </ChartCard>
      <ChartCard title={t('Stock availability')} description={t('Product counts on the data date')}>
        <DonutChart label={t('Stock availability')} segments={[
          {label: t('In stock'), value: rows.filter(row => row.inventory_level > 0).length, color: '#087c72'},
          {label: t('Zero stock'), value: zero, color: '#bc7b24'},
          {label: t('Missing records'), value: missing, color: '#bac5cc'},
        ]} />
        <Link className="text-link card-bottom-link" to="/inventory">{t('View inventory')} →</Link>
      </ChartCard>
    </div>
    <div className="report-grid">
      <ChartCard title={t('Products to review')} description={t('Pending recommendations, highest suggested quantity first')} action={<Link className="text-link" to="/exceptions?status=pending_review">{t('View all')} →</Link>}>
        <Feedback {...cases} />
        {cases.data && (pending.length ? <div className="attention-list">{[...pending].sort((a,b) => (b.result.recommended_order_quantity || 0) - (a.result.recommended_order_quantity || 0)).slice(0, 5).map(c => <Link to={casePath(c.id)} key={c.id} className="attention-item"><div className="product-initial">{c.result.product_id.slice(-2)}</div><div><strong>{c.result.product_id}</strong><small>{t(c.exception_type)} · {t('Analysis date')}: {c.result.snapshot_date || '—'}</small></div><div className="attention-quantity"><strong>{number(c.result.recommended_order_quantity)}</strong><small>{t('Suggested quantity')}</small></div><span aria-hidden="true">↗</span></Link>)}</div> : <EmptyState title={t('No pending reviews')} description={t('New Daily analysis recommendations will appear here.')} action={<Link to="/analysis" className="text-link">{t('Go to Analysis')} →</Link>} />)}
      </ChartCard>
      <ChartCard title={t('Top selling products')} description={`${date || '—'} · ${t('Units sold, top 6')}`}>
        <BarChart label={t('Top selling products')} rows={[...rows].sort((a,b) => b.units_sold-a.units_sold).slice(0,6).map(row => ({label: row.product_id, sold: row.units_sold}))} series={[{key: 'sold', label: t('Daily units sold'), color: '#087c72'}]} />
      </ChartCard>
    </div>
    <RecentAnalyses />
  </>;
}

function RecentAnalyses() {
  const {t} = useLanguage();
  const snapshot = useSyncExternalStore(activityLog.subscribe, activityLog.getSnapshot);
  const seen = new Set();
  const entries = snapshot.entries.filter(row => row.mode === config.mode && row.runId && ['analysis.created', 'run.observed'].includes(row.event) && !seen.has(row.runId) && seen.add(row.runId)).slice(0, 3);
  const ids = entries.map(row => row.runId).join(',');
  const state = useResource(useCallback(async options => Promise.all(ids ? ids.split(',').map(async id => {
    try {
      const run = await api.getAnalysisRun(id, options);
      if (run.status !== 'completed') return {id, run};
      try {return {id, run, results: validateRunResults(run, await api.getAnalysisResults(id, options))};}
      catch(resultError) {return {id, run, resultError};}
    } catch(error) {return {id, error};}
  }) : []), [ids]));
  return <ChartCard title={t('Recent analyses')} description={t('Runs opened or created in this browser; status checked with the current backend.')} action={<Link className="text-link" to="/logs">{t('Analysis history')} →</Link>}>
    <Feedback loading={state.loading} />
    {!!state.data?.length && <div className="recent-run-grid">{state.data.map(({id, run, results, error, resultError}) => <Link to={runPath(id)} className="recent-run" key={id}><span className="eyebrow">{t(run?.run_type === 'monthly' ? 'Monthly Analysis' : run ? 'Daily analysis' : 'Analysis run')}</span><strong>{run?.as_of_date || '—'}</strong>{error ? <span className="signal-tag signal-warn">{t('Run unavailable on this backend')}</span> : <Badge status={run.status} />}{results?.diagnostics?.mode === 'monthly' && <p className="recent-run-summary"><strong>{diagnosticSummary(results.diagnostics).flagged.length}</strong> {t('products deserve a closer look')}</p>}{results && run.run_type !== 'monthly' && <p className="recent-run-summary"><strong>{results.results.filter(row => row.case_id).length}</strong> {t('Review cases')}</p>}{resultError && <span className="signal-tag signal-warn">{t('Results could not be loaded')}</span>}<span className="text-link">{t('View results')} →</span></Link>)}</div>}
    {state.data?.length === 0 && <EmptyState title={t('No recent analyses in this browser')} action={<Link className="text-link" to="/analysis">{t('New analysis')} →</Link>} />}
  </ChartCard>;
}
