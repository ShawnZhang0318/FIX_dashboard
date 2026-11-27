import {useCallback, useEffect, useRef, useState} from 'react';
import {Link, useNavigate, useParams, useSearchParams} from 'react-router';
import PageHeader from '../components/PageHeader.jsx';
import {Feedback, Badge} from '../components/WorkflowUI.jsx';
import {DailyReport, MonthlyReport, Diagnostics} from '../components/AnalysisReport.jsx';
import {validateRunResults} from '../../frontend/contracts.js';
import {useLanguage} from '../i18n.jsx';
import {useResource} from '../useResource.js';
import {isDate} from '../../frontend/requests.js';
import {api, config, number, runPath} from '../workflow.js';

export default function AnalysisPage() {
  const {runId} = useParams();
  return <AnalysisWorkspace key={runId || 'new'} runId={runId} />;
}
function AnalysisWorkspace({runId}) {
  const {t} = useLanguage(), navigate = useNavigate();
  const [params] = useSearchParams();
  const [mode, setMode] = useState(params.get('period') === 'monthly' && config.mode === 'live' ? 'monthly' : 'daily');
  const [scenario, setScenario] = useState('success');
  const [run, setRun] = useState(null), [results, setResults] = useState(null);
  const [error, setError] = useState(null), [createError, setCreateError] = useState(null);
  const [busy, setBusy] = useState(false), [revision, setRevision] = useState(0);
  const active = useRef(true), submitting = useRef(false);
  const span = useResource(useCallback(options => config.mode === 'live' && !runId
    ? api.getLatestSnapshot({store_id: 'S001'}, options) : Promise.resolve(null), [runId]));
  // Preserve the API's runnable cutoff and the original date of stored runs.
  const analysisDate = runId ? run?.as_of_date || '' : config.mode === 'mock' ? '2022-06-30' : span.data?.cutoff_date || span.data?.snapshot_date || '';
  useEffect(() => {active.current = true; return () => {active.current = false;};}, []);
  useEffect(() => {
    if (!runId) return;
    let cancelled = false, timer;
    const controller = new AbortController();
    setError(null); setResults(null);
    async function poll() {
      try {
        const r = await api.getAnalysisRun(runId, {signal: controller.signal});
        if (cancelled) return;
        if (!['queued', 'processing', 'completed', 'failed'].includes(r.status)) throw Error('Unsupported run status: ' + r.status);
        setRun(r);
        if (r.run_type) setMode(r.run_type);
        if (r.scenario) setScenario(r.scenario);
        if (['queued', 'processing'].includes(r.status)) {timer = setTimeout(poll, config.pollMs); return;}
        const data = await api.getAnalysisResults(runId, {signal: controller.signal});
        if (!cancelled) setResults(validateRunResults(r, data));
      } catch(e) {if (!cancelled) setError(e);}
    }
    poll();
    return () => {cancelled = true; clearTimeout(timer); controller.abort();};
  }, [runId, revision]);
  async function create(e) {
    e.preventDefault();
    if (runId || submitting.current || createError?.writeUncertain || !isDate(analysisDate)) return;
    submitting.current = true; setBusy(true); setCreateError(null);
    try {
      const data = await api.createAnalysisRun({store_id: 'S001', run_type: mode, as_of_date: analysisDate, scenario});
      if (!data?.analysis_run?.id) throw Error('Missing analysis_run.id');
      if (active.current) navigate(runPath(data.analysis_run.id));
    } catch(e) {if (active.current) setCreateError(e);}
    finally {submitting.current = false; if (active.current) setBusy(false);}
  }
  const running = !!runId && (!run || ['queued', 'processing'].includes(run.status));
  const monthly = mode === 'monthly';
  return <>
    <PageHeader eyebrow={t(runId ? 'Analysis results' : 'Demand & inventory planning')}
      title={t(runId ? monthly ? 'Monthly Analysis' : 'Daily analysis' : 'Analysis')}
      description={t(runId ? monthly ? 'Understand sustained sales changes and recurring stockouts.' : 'See demand coverage and the products that may need replenishment.' : 'Choose a question. We will turn stored data into a clear action list.')}
      actions={runId ? <Link className="primary-button" to="/analysis">{t('New analysis')} ↗</Link> : <Link className="secondary-button" to="/logs">{t('Analysis history')}</Link>} />
    {runId ? <>
      <div className="report-context"><span>{t('Store')}: <strong>{run?.store_id || 'S001'}</strong></span><span>{t('Analysis date')}: <strong>{analysisDate || '—'}</strong></span>{run && <Badge status={run.status} />}</div>
      {running && !error && <div className="run-progress panel" role="status"><span className="progress-spinner" /><div><strong>{t(run?.status === 'processing' ? 'Analysing store data…' : 'Waiting for analysis…')}</strong><p>{t('Results will appear here automatically. You can leave and return to this task.')}</p>{run && !monthly && <small>{t('Products processed')}: {number(run.processed_count)} / {number(run.expected_count)}</small>}</div></div>}
      {run?.status === 'failed' && <div className="workflow-message workflow-error" role="alert"><strong>{t('Analysis could not finish')}</strong><p>{t('Check the task details below before starting another analysis.')}</p>{run.error && <p>{typeof run.error === 'string' ? run.error : JSON.stringify(run.error)}</p>}</div>}
      <Feedback error={error} reload={() => setRevision(x => x+1)} />
      {results && monthly && results.diagnostics && <MonthlyReport scan={results.diagnostics} />}
      {results && !monthly && <DailyReport data={results} runId={runId} />}
      {results?.diagnostics && !monthly && <Diagnostics scan={results.diagnostics} />}
      <details className="panel task-details"><summary>{t('Task details & logs')}</summary><dl className="metadata-grid"><div><dt>{t('Run ID')}</dt><dd>{runId}</dd></div><div><dt>{t('Job ID')}</dt><dd>{run?.job?.id || '—'}</dd></div><div><dt>{t('Analysis date')}</dt><dd>{analysisDate || '—'}</dd></div><div><dt>{t('Status')}</dt><dd>{run ? t(run.status) : '—'}</dd></div></dl><Link className="text-link" to={`/logs?${new URLSearchParams({source: 'backend', run_id: runId, ...(run?.job?.id ? {job_id: run.job.id} : {})})}`}>{t('View task logs')} →</Link><p className="chart-footnote">{t('Saved results retain their original analysis date.')}</p></details>
    </> : <div className="analysis-start-grid">
      <section className="panel report-card analysis-start"><div className="report-card-heading"><div><span className="eyebrow">{t('01 · Choose your analysis')}</span><h2>{t('What would you like to understand?')}</h2></div></div>
        <form onSubmit={create}>
          <div className="analysis-mode-picker" role="group" aria-label={t('Analysis period')}>
            {[{key: 'daily', title: 'Daily analysis', question: 'What needs replenishment?', copy: 'Compare stock with predicted demand over each product’s lead time.', icon: '↗'}, {key: 'monthly', title: 'Monthly Analysis', question: 'What has changed this month?', copy: 'Compare the recent 28 days with the previous 28 days to find persistent sales changes and stockouts.', icon: '▥'}].map(item => <button key={item.key} type="button" className={`analysis-mode-card${mode === item.key ? ' is-selected' : ''}`} aria-pressed={mode === item.key} disabled={busy || !!createError?.writeUncertain || (item.key === 'monthly' && config.mode === 'mock')} onClick={() => {setMode(item.key); setCreateError(null);}}><span className="mode-icon" aria-hidden="true">{item.icon}</span><span className="analysis-mode-card__title">{t(item.title)}</span><strong className="mode-question">{t(item.question)}</strong><span className="analysis-mode-card__summary">{t(item.copy)}</span><span className="mode-selected">{t(mode === item.key ? 'Selected' : 'Select analysis')} {mode === item.key ? '✓' : '→'}</span></button>)}
          </div>
          {config.mode === 'mock' && <p className="analysis-mode-note">{t('Monthly analysis requires a live backend. The synthetic demo supports Daily only.')}</p>}
          <div className="analysis-input-context"><div><span>{t('Store')}</span><strong>S001</strong></div><div><span>{t('Analysis date')}</span><strong>{analysisDate || '—'}</strong></div><span className="signal-tag">{t('Automatically selected from stored data')}</span></div>
          <Feedback loading={span.loading && config.mode === 'live'} error={span.error} reload={span.reload} />
          {span.data?.snapshot_date && span.data.snapshot_date !== analysisDate && <p className="data-quality-notice">{t('Latest record')}: {span.data.snapshot_date}. {t('The analysis uses the newest runnable cutoff. Gaps in history can move it back.')}</p>}
          {config.mode === 'mock' && <label className="field-group">{t('Demo scenario')}<select className="field-value" value={scenario} disabled={busy || !!createError?.writeUncertain} onChange={e => setScenario(e.target.value)}>{['success', 'failure', 'empty'].map(s => <option key={s} value={s}>{t(s)}</option>)}</select></label>}
          <div className="request-footer"><button className="primary-button" disabled={busy || !!createError?.writeUncertain || !isDate(analysisDate) || (monthly && config.mode === 'mock')}>{t(busy ? 'Creating…' : monthly ? 'Run Monthly Analysis' : 'Run Daily Analysis')} <span aria-hidden="true">→</span></button><span className="chart-footnote">{t('Analysis does not change inventory or place orders.')}</span></div>
          <Feedback error={createError} />
        </form>
      </section>
      <aside className="panel report-card analysis-guide"><span className="eyebrow">{t('02 · What you will get')}</span><h2>{t(monthly ? 'A clearer view of change' : 'A replenishment action list')}</h2><ol className="guide-steps"><li><strong>{t(monthly ? 'Spot persistent changes' : 'Check stock coverage')}</strong><p>{t(monthly ? 'Find products with sustained sales growth or decline.' : 'See saved stock alongside expected demand for each lead time.')}</p></li><li><strong>{t(monthly ? 'Understand the evidence' : 'Review suggested quantities')}</strong><p>{t(monthly ? 'Compare daily averages, weekly consistency and stockout days.' : 'Identify products needing attention and inspect the recommendation.')}</p></li><li><strong>{t(monthly ? 'Explore each product' : 'Record a decision')}</strong><p>{t(monthly ? 'Open a product to inspect its recorded daily sales.' : 'Approve, adjust or reject a recommendation in the review queue.')}</p></li></ol><details className="method-note"><summary>{t('Data requirements & method')}</summary><p>{t(monthly ? 'Monthly checks need 56 consecutive observations per product. Sales comparisons use matched weekdays with positive stock in both periods. Missing data is reported separately.' : 'Daily analysis needs all 20 products and 29 consecutive dates. P50 is the median cumulative demand; P90 is the higher coverage estimate over the product’s lead time.')}</p></details></aside>
    </div>}
  </>;
}
