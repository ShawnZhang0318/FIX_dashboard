import { useEffect, useRef, useState } from 'react';
import { api, config, number } from '../workflow.js';
import { useLanguage } from '../i18n.jsx';
import { Feedback } from './WorkflowUI.jsx';

// An import client for the public API; no local inventory updates or AI calls.
export default function SnapshotTransferPanel({onImported}) {
  const {t} = useLanguage();
  const [product, setProduct] = useState(''), [from, setFrom] = useState(''), [to, setTo] = useState('');
  const [json, setJson] = useState(''), [rows, setRows] = useState(null);
  const [error, setError] = useState(null), [busy, setBusy] = useState(false), [receipt, setReceipt] = useState(null);
  const [uncertain, setUncertain] = useState(false);
  const lock = useRef(false), active = useRef(true), query = useRef(null);
  useEffect(() => {active.current = true; return () => {active.current = false; query.current?.abort();};}, []);
  async function search(event) {
    event.preventDefault();
    if (lock.current) return;
    lock.current = true; setBusy(true); setError(null); setRows(null);
    query.current = new AbortController();
    try {
      const data = await api.getSnapshots({store_id:'S001', product_id:product.trim(), from, to}, {signal:query.current.signal});
      if (active.current) setRows(data);
    } catch (cause) {if (active.current) setError(cause);}
    finally {lock.current = false; if (active.current) setBusy(false);}
  }
  async function ingest(event) {
    event.preventDefault();
    if (lock.current || uncertain || config.mode !== 'live') return;
    let body;
    try {body = JSON.parse(json);} catch {setError(new Error(t('Enter a valid snapshot batch in JSON format.'))); return;}
    lock.current = true; setBusy(true); setError(null); setReceipt(null);
    try {
      const data = await api.ingestSnapshots(body);
      if (active.current) {setReceipt(data); setRows(null); onImported();}
    } catch (cause) {
      if (active.current) {setError(cause); if (cause.writeUncertain) setUncertain(true);}
    } finally {lock.current = false; if (active.current) setBusy(false);}
  }
  return <details className="panel workflow-body">
    <summary>{t('Daily snapshot transfer')}</summary>
    <p>{t('Query historical observations or submit one atomic batch to the public API. Only a newer snapshot may refresh current inventory.')}</p>
    <form className="workflow-form" onSubmit={search}>
      <fieldset disabled={busy}>
        <label className="field-group">{t('Product ID')}<input className="field-value" value={product} onChange={e=>setProduct(e.target.value)} /></label>
        <label className="field-group">{t('From date')}<input className="field-value" type="date" value={from} onChange={e=>setFrom(e.target.value)} /></label>
        <label className="field-group">{t('To date')}<input className="field-value" type="date" value={to} onChange={e=>setTo(e.target.value)} /></label>
        <button className="secondary-button">{t('Query snapshots')}</button>
      </fieldset>
    </form>
    {rows && <div className="table-scroll"><table className="data-table">
      <thead><tr>{['Product ID','Snapshot date','On hand','Source snapshot'].map(label=><th key={label}>{t(label)}</th>)}</tr></thead>
      <tbody>{rows.map(row=><tr key={row.id}><td>{row.product_id}</td><td>{row.snapshot_date}</td><td>{number(row.inventory_level)}</td><td>{row.id}</td></tr>)}
        {!rows.length && <tr><td colSpan="4">{t('No matching records.')}</td></tr>}
      </tbody>
    </table></div>}
    <form className="workflow-form" onSubmit={ingest}>
      <fieldset disabled={busy || config.mode !== 'live' || uncertain}>
        <label className="field-group">{t('Snapshot batch JSON')}
          <textarea className="field-value" rows="8" required value={json} onChange={e=>setJson(e.target.value)} placeholder={'{"source_file_sha256": "...", "snapshots": [...]}'} />
        </label>
        <p>{t('Submit 1–100 mapped rows per batch. Duplicate or invalid rows must reject the entire batch. See the team transfer contract for fields.')}</p>
        <button className="primary-button">{t('Submit snapshot batch')}</button>
      </fieldset>
    </form>
    {config.mode !== 'live' && <p>{t('Snapshot upload is available after the real backend is connected. Mock snapshot queries return labeled synthetic fixtures.')}</p>}
    {uncertain && <p role="alert">{t('The write outcome is unknown. Query the submitted store/product/dates and ask the backend owner to confirm before reloading and submitting again.')}</p>}
    {receipt && <p role="status">{t('Snapshots accepted by API')}: {receipt.inserted_count} · {receipt.snapshot_ids.join(', ')}</p>}
    <Feedback loading={busy} error={error}/>
  </details>;
}
