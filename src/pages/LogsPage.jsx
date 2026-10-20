import { useState, useSyncExternalStore } from 'react';
import { Link, useSearchParams } from 'react-router';
import PageHeader from '../components/PageHeader.jsx';
import { Feedback, Metric } from '../components/WorkflowUI.jsx';
import { useLanguage } from '../i18n.jsx';
import { activityLog, LOG_LIMIT } from '../../frontend/activity-log.js';
import { api, config, runPath, casePath } from '../workflow.js';
import BackendLogsPage from './BackendLogsPage.jsx';

export default function LogsPage() {
  const {t} = useLanguage();
  const [params] = useSearchParams();
  const browser = params.get('source') === 'browser';
  return <><nav className="log-source-tabs" aria-label={t('Log source')}><Link className={browser ? 'secondary-button' : 'primary-button'} to="/logs" aria-current={!browser ? 'page' : undefined}>{t('Backend logs')}</Link><Link className={browser ? 'primary-button' : 'secondary-button'} to="/logs?source=browser" aria-current={browser ? 'page' : undefined}>{t('Browser diagnostics')}</Link></nav>{browser ? <BrowserLogs /> : <BackendLogsPage />}</>;
}
function BrowserLogs() {
  const {t, language} = useLanguage();
  const snapshot = useSyncExternalStore(activityLog.subscribe, activityLog.getSnapshot);
  const [params, setParams] = useSearchParams();
  const [confirm, setConfirm] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [notice, setNotice] = useState('');
  const level = params.get('level') || '', kind = params.get('kind') || '', search = params.get('q') || '';
  const runId = params.get('run_id'), requestId = params.get('request_id');
  const rows = snapshot.entries.filter(x =>
    (!level || x.level === level) && (!kind || (kind === 'requests' ? x.event.startsWith('request.') : !x.event.startsWith('request.'))) &&
    (!runId || x.runId === runId) && (!requestId || x.requestId === requestId) &&
    (!search || [x.requestId, x.runId, x.caseId, x.operation, x.errorCode, x.event].join(' ').toLowerCase().includes(search.toLowerCase())),
  );
  const requests = rows.filter(x => x.event.startsWith('request.'));
  function filter(key, value) {
    const next = new URLSearchParams(params);
    if (value) next.set(key, value); else next.delete(key);
    setParams(next, {replace: true});
  }
  function exportLogs() {
    const blob = new Blob([JSON.stringify({version: 1, exported_at: new Date().toISOString(), scope: 'browser-observations', filters: Object.fromEntries(params), entries: rows}, null, 2)], {type: 'application/json'});
    const url = URL.createObjectURL(blob), anchor = document.createElement('a');
    anchor.href = url; anchor.download = `fix-logs-${new Date().toISOString().replace(/[:.]/g, '-')}.json`;
    document.body.appendChild(anchor); anchor.click(); anchor.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  async function confirmAction() {
    setBusy(true); setError(null); setNotice('');
    try {
      if (confirm === 'logs') activityLog.clear(); else await api.reset();
      setNotice(confirm === 'logs' ? 'Local logs cleared.' : 'Demo data reset. Create a new analysis to continue.');
      setConfirm('');
    } catch (e) { setError(e); }
    finally { setBusy(false); }
  }
  return <>
    <PageHeader eyebrow={t('Workflow visibility')} title={t('Browser diagnostics')} description={t('Track requests and workflow events observed by this browser.')} />
    <p className="workflow-message">{t('These are browser observations, not backend execution or audit logs.')} {t('Latest entries retained')}: {LOG_LIMIT}. {t('Request bodies, reviewer names and reasons are not logged.')}</p>
    {(!snapshot.persistent || snapshot.warning) && <p className="workflow-message workflow-error" role="status">{t(snapshot.warning || 'Logs are available only in this tab because browser storage is unavailable.')}</p>}
    <div className="summary-grid">
      <Metric label={t('Matching entries')} value={rows.length} />
      <Metric label={t('Failed requests')} value={requests.filter(x => x.event === 'request.failed' && x.level === 'error').length} />
      <Metric label={t('Average request time')} value={requests.length ? `${Math.round(requests.reduce((sum, x) => sum + x.durationMs, 0) / requests.length)} ms` : '—'} />
    </div>
    <section className="panel logs-panel">
      <div className="panel-heading"><h2>{t('Activity and requests')}</h2><button className="secondary-button" onClick={exportLogs} disabled={!rows.length}>{t('Export filtered logs')}</button></div>
      <div className="table-toolbar logs-filters">
        <label className="field-group">{t('Level')}<select className="field-value" value={level} onChange={e => filter('level', e.target.value)}><option value="">{t('All levels')}</option><option value="error">{t('Errors')}</option><option value="info">{t('Information')}</option></select></label>
        <label className="field-group">{t('Event type')}<select className="field-value" value={kind} onChange={e => filter('kind', e.target.value)}><option value="">{t('All events')}</option><option value="requests">{t('API requests')}</option><option value="workflow">{t('Workflow events')}</option></select></label>
        <label className="field-group logs-search">{t('Search IDs or operation')}<input className="field-value" value={search} onChange={e => filter('q', e.target.value)} /></label>
        {params.size > 1 && <button className="secondary-button" onClick={() => setParams({source:'browser'})}>{t('Clear filters')}</button>}
      </div>
      {(runId || requestId) && <p className="workflow-id">{t(runId ? 'Run ID' : 'Request ID')}: {runId || requestId}</p>}
      <div className="table-scroll"><table className="data-table logs-table"><thead><tr>{['Time', 'Event', 'Request details', 'Related records'].map(label => <th key={label}>{t(label)}</th>)}</tr></thead>
        <tbody>{rows.map(row => <tr key={row.id}>
          <td><time dateTime={row.timestamp}>{new Date(row.timestamp).toLocaleString(language)}</time><small>{t(row.mode === 'mock' ? 'Mock demo' : 'Live API')}</small></td>
          <td><span className={`status-badge workflow-status-${row.level === 'error' ? 'failed' : 'completed'}`}>{t(row.event)}</span>{row.status && <small>{t(row.status)}</small>}{row.errorCode && <small>{row.errorCode}{row.errorStatus != null ? ` (${row.errorStatus})` : ''}</small>}</td>
          <td>{row.operation && <code>{row.operation}</code>}{row.event.startsWith('request.') && <>
            <small>{row.mode === 'mock' ? t('Local simulation; no HTTP request') : `${row.method} ${row.endpoint}`}</small>
            <small>{row.httpStatus ? `HTTP ${row.httpStatus} · ` : ''}{row.durationMs} ms</small>
          </>}{row.recordCount != null && <small>{t('Returned records')}: {row.recordCount}</small>}{row.field && <small>{t('Invalid field')}: {row.field}</small>}{row.writeUncertain && <small className="log-warning">{t('Write outcome unknown. Check server state before retrying.')}</small>}</td>
          <td>{row.runId && <Link to={runPath(row.runId)}>{t('Analysis run')}<small>{row.runId}</small></Link>}{row.caseId && <Link to={casePath(row.caseId)}>{t('Exception details')}<small>{row.caseId}</small></Link>}{row.requestId && <small>{t('Request ID')}: {row.requestId}</small>}{row.serverRequestId && <small>{t('Server request ID')}: {row.serverRequestId}</small>}</td>
        </tr>)}{!rows.length && <tr><td colSpan="4">{t('No matching log entries. Run an analysis or refresh inventory to generate entries.')}</td></tr>}</tbody>
      </table></div>
    </section>
    <section className="panel workflow-body">
      <h2>{t('Local data')}</h2><p>{t('Logs stay in this browser and are not shared with teammates. Export the relevant entries for integration troubleshooting.')}</p>
      <div className="log-actions"><button className="secondary-button" onClick={() => {setConfirm('logs'); setNotice('');}}>{t('Clear local logs')}</button>{config.mode === 'mock' && <button className="secondary-button" onClick={() => {setConfirm('demo'); setNotice('');}}>{t('Reset demo data')}</button>}</div>
      {confirm && <div className="workflow-message" role="group" aria-label={t('Confirm local cleanup')}><p>{t(confirm === 'logs' ? 'Clear all local log entries? Analysis and review records will remain.' : 'Delete this browser’s simulated tasks and reviews? Existing task links will stop working. Logs will remain.')}</p><div className="log-actions"><button className="primary-button" disabled={busy} onClick={confirmAction}>{t('Confirm')}</button><button className="secondary-button" disabled={busy} onClick={() => setConfirm('')}>{t('Cancel')}</button></div></div>}
      {notice && <p role="status" className="workflow-message">{t(notice)}</p>}<Feedback error={error} />
    </section>
  </>;
}
