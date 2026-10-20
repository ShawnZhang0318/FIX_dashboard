import { useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router';
import PageHeader from '../components/PageHeader.jsx';
import { Feedback, Metric } from '../components/WorkflowUI.jsx';
import { useLanguage } from '../i18n.jsx';
import { backendLogsApi } from '../backendLogs.js';
import { LOG_FILTERS, appendBackendLogPage } from '../../frontend/backend-logs.js';

function localDate(value) {
  if (!value || !Number.isFinite(Date.parse(value))) return '';
  const date = new Date(value);
  return new Date(date.getTime() - date.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
}
export default function BackendLogsPage() {
  const {t} = useLanguage();
  const [params, setParams] = useSearchParams();
  const key = JSON.stringify(LOG_FILTERS.map(name => [name, params.get(name) || '']));
  const filters = useMemo(() => Object.fromEntries(JSON.parse(key).filter(([,value]) => value)), [key]);
  const [filterError, setFilterError] = useState('');
  function search(event) {
    event.preventDefault();
    const data = new FormData(event.currentTarget), next = new URLSearchParams();
    for (const name of LOG_FILTERS) {
      const value = String(data.get(name) || '').trim();
      if (value) next.set(name, ['from', 'to'].includes(name) ? new Date(value).toISOString() : value);
    }
    if (next.has('from') && next.has('to') && Date.parse(next.get('from')) > Date.parse(next.get('to'))) {
      setFilterError('Start time must be before end time.'); return;
    }
    setFilterError(''); setParams(next);
  }
  return <>
    <PageHeader eyebrow={t('Server execution')} title={t('Backend logs')} description={t('Follow API, worker, model, persistence and review events recorded by the server.')} />
    {!backendLogsApi && <section className="panel workflow-body" role="status">
      <h2>{t('Backend logs are not connected')}</h2>
      <p>{t('No backend log endpoint has been configured. Browser events and simulated status changes will not appear as backend logs.')}</p>
      <p>{t('Connect the backend log API to view real messages, failures, retries and historical records.')}</p>
    </section>}
    <section className="panel workflow-body">
      <h2>{t('Find an execution')}</h2>
      <form key={key} className="backend-log-filters" onSubmit={search}>
        {[
          ['run_id', 'Run ID'], ['job_id', 'Job ID'], ['case_id', 'Case ID'],
          ['request_id', 'Request ID'], ['trace_id', 'Trace ID'], ['service', 'Service'], ['stage', 'Stage'],
        ].map(([name, label]) => <label className="field-group" key={name}>{t(label)}<input className="field-value" name={name} defaultValue={filters[name] || ''} /></label>)}
        <label className="field-group">{t('Level')}<select className="field-value" name="level" defaultValue={filters.level || ''}><option value="">{t('All levels')}</option>{['DEBUG', 'INFO', 'WARNING', 'ERROR', 'CRITICAL'].map(level => <option key={level}>{level}</option>)}</select></label>
        <label className="field-group">{t('From (local time)')}<input className="field-value" type="datetime-local" name="from" defaultValue={localDate(filters.from)} /></label>
        <label className="field-group">{t('To (local time)')}<input className="field-value" type="datetime-local" name="to" defaultValue={localDate(filters.to)} /></label>
        <label className="field-group">{t('Message or event search')}<input className="field-value" name="query" defaultValue={filters.query || ''} /></label>
        <div className="log-actions"><button className="primary-button" disabled={!backendLogsApi}>{t('Search server logs')}</button><button type="button" className="secondary-button" onClick={() => {setParams({}); setFilterError('');}}>{t('Clear filters')}</button></div>
      </form>
      {filterError && <p role="alert">{t(filterError)}</p>}
    </section>
    {backendLogsApi && <BackendLogFeed key={key} filters={filters} />}
  </>;
}

function BackendLogFeed({filters}) {
  const {t, language} = useLanguage();
  const [data, setData] = useState(null), [loading, setLoading] = useState(true), [error, setError] = useState(null);
  const [revision, setRevision] = useState(0), [auto, setAuto] = useState(false), [paging, setPaging] = useState(false), [exporting, setExporting] = useState(false);
  const session = useRef(null), moreLock = useRef(false), exportLock = useRef(false);
  useEffect(() => {
    const controller = new AbortController(); session.current = controller;
    setLoading(true); setError(null); setPaging(false); setExporting(false); moreLock.current = false; exportLock.current = false;
    backendLogsApi.getLogs(filters, {signal: controller.signal}).then(
      page => {if (!controller.signal.aborted) {setData(page); setLoading(false);}},
      failure => {if (!controller.signal.aborted) {setError(failure); setAuto(false); setLoading(false);}},
    );
    return () => controller.abort();
  }, [filters, revision]);
  useEffect(() => {
    if (!auto || loading || paging || exporting || error) return;
    const timer = setTimeout(() => setRevision(x => x + 1), 5000);
    return () => clearTimeout(timer);
  }, [auto, loading, paging, exporting, error, data]);
  async function more() {
    if (!data?.next_cursor || loading || moreLock.current || exporting) return;
    moreLock.current = true; setAuto(false); setPaging(true); setError(null);
    const controller = session.current;
    try {
      const page = await backendLogsApi.getLogs({...filters, cursor: data.next_cursor, snapshot_id: data.snapshot_id}, {signal: controller.signal});
      if (!controller.signal.aborted) setData(appendBackendLogPage(data, page));
    } catch (failure) {if (!controller.signal.aborted) setError(failure);}
    finally {if (session.current === controller) {moreLock.current = false; setPaging(false);}}
  }
  async function exportAll() {
    if (!data || loading || paging || exportLock.current) return;
    exportLock.current = true; setExporting(true); setAuto(false); setError(null);
    const controller = session.current;
    try {
      const blob = await backendLogsApi.exportLogs({...filters, snapshot_id: data.snapshot_id}, {signal: controller.signal});
      if (controller.signal.aborted) return;
      const url = URL.createObjectURL(blob), anchor = document.createElement('a');
      anchor.href = url; anchor.download = `fix-backend-logs-${Date.now()}.ndjson`;
      document.body.appendChild(anchor); anchor.click(); anchor.remove(); setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (failure) {if (!controller.signal.aborted) setError(failure);}
    finally {if (session.current === controller) {exportLock.current = false; setExporting(false);}}
  }
  return <>
    <div className="log-actions backend-log-actions">
      <button className="secondary-button" disabled={loading || paging || exporting} onClick={() => setRevision(x => x + 1)}>{t('Refresh latest')}</button>
      <label className="backend-log-auto"><input type="checkbox" checked={auto} disabled={paging || exporting} onChange={event => {setAuto(event.target.checked); if (event.target.checked) setRevision(x => x + 1);}} />{t('Auto refresh latest page (5 seconds)')}</label>
      <button className="secondary-button" disabled={!data || !data.total || loading || paging || exporting} onClick={exportAll}>{t(exporting ? 'Exporting…' : 'Export all matching server logs')}</button>
    </div>
    <p className="workflow-message">{t('Refresh starts a new snapshot. Loading older entries pauses auto refresh. Export includes all matching retained records in the current snapshot.')}</p>
    <Feedback error={error} reload={() => setRevision(x => x + 1)} />
    {loading && <p role="status">{t('Loading server logs…')}</p>}
    {data && <>
      <div className="summary-grid"><Metric label={t('Loaded records')} value={data.items.length} /><Metric label={t('Matching server records')} value={data.total} /><Metric label={t('Collection coverage')} value={t(data.coverage.status === 'complete' ? 'All declared sources available' : 'Some sources are missing')} /></div>
      <section className="panel workflow-body">
        <h2>{t('Log sources')}</h2>
        {data.coverage.status === 'partial' && <p role="alert" className="workflow-message workflow-error">{t('The server reports incomplete collection. An empty result does not prove that no events occurred.')}</p>}
        <ul>{data.coverage.services.map((source, i) => <li key={`${source.name}-${i}`}><strong>{source.name}</strong> · {t(source.status)}{source.message ? ` — ${source.message}` : ''}</li>)}</ul>
        <p>{t('Retained from')}: {data.coverage.retained_from ? new Date(data.coverage.retained_from).toLocaleString(language) : t('Not reported by server')}</p>
        <p>{t('Snapshot time')}: {new Date(data.generated_at).toLocaleString(language)}</p>
        <p>{t('Full log history means records retained and authorized by the backend. Secrets must be redacted by the server.')}</p>
      </section>
      <section className="panel workflow-body">
        <h2>{t('Execution log timeline')}</h2>
        <p>{t('Newest records first. Expand an event to inspect its full message, context and error stack.')}</p>
        {!data.items.length && <p>{t('No server logs match these filters.')}</p>}
        <ol className="backend-log-timeline">{data.items.map(row => <li key={row.id}>
          <details><summary>
            <span className={`status-badge workflow-status-${['ERROR', 'CRITICAL'].includes(row.level) ? 'failed' : row.level === 'WARNING' ? 'pending_review' : 'completed'}`}>{row.level}</span>
            <time dateTime={row.timestamp}>{new Date(row.timestamp).toLocaleString(language)}</time>
            <strong>{row.service} · {row.stage}</strong><span className="backend-log-event">{row.event}</span>
          </summary>
            <p className="backend-log-message">{row.message}</p>
            <dl className="backend-log-meta">{[['run_id','Run ID'],['job_id','Job ID'],['case_id','Case ID'],['request_id','Request ID'],['trace_id','Trace ID'],['product_id','Product ID'],['attempt','Attempt'],['duration_ms','Duration (ms)']].map(([key,label]) => row[key] != null && <div key={key}><dt>{t(label)}</dt><dd>{String(row[key])}</dd></div>)}</dl>
            {row.error && <div className="backend-log-error"><h3>{t('Error details')}</h3><p>{row.error.type}</p><p className="backend-log-message">{row.error.message}</p>{row.error.retryable != null && <p>{t('Retryable')}: {t(row.error.retryable ? 'Yes' : 'No')}</p>}{row.error.stack_trace && <pre>{row.error.stack_trace}</pre>}</div>}
            {row.context && <><h3>{t('Server context')}</h3><pre>{JSON.stringify(row.context,null,2)}</pre></>}
            <details><summary>{t('Full server record')}</summary><pre>{JSON.stringify(row,null,2)}</pre></details>
          </details>
        </li>)}</ol>
        {data.next_cursor ? <button className="secondary-button" disabled={loading || paging || exporting} onClick={more}>{t(paging ? 'Loading…' : 'Load older records')}</button> : <p role="status">{t('All matching records in this snapshot have been loaded.')}</p>}
      </section>
    </>}
  </>;
}
