import { useEffect, useRef, useState } from 'react';
import { api, number } from '../workflow.js';
import { useLanguage } from '../i18n.jsx';
import { Feedback } from './WorkflowUI.jsx';

export default function SnapshotTransferPanel() {
  const {t} = useLanguage();
  const [product, setProduct] = useState(''), [from, setFrom] = useState(''), [to, setTo] = useState('');
  const [rows, setRows] = useState(null);
  const [error, setError] = useState(null), [busy, setBusy] = useState(false);
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
  return <details className="panel workflow-body">
    <summary>{t('Search saved inventory by date range')}</summary>
    <form className="workflow-form" onSubmit={search}>
      <fieldset disabled={busy}>
        <label className="field-group">{t('Product ID')}<input className="field-value" value={product} onChange={e=>setProduct(e.target.value)} /></label>
        <label className="field-group">{t('From date')}<input className="field-value" type="date" value={from} onChange={e=>setFrom(e.target.value)} /></label>
        <label className="field-group">{t('To date')}<input className="field-value" type="date" value={to} onChange={e=>setTo(e.target.value)} /></label>
        <button className="secondary-button">{t('Query snapshots')}</button>
      </fieldset>
    </form>
    {rows && <div className="table-scroll"><table className="data-table">
      <thead><tr>{['Product ID','Snapshot date','Closing stock','Daily units sold','Source snapshot'].map(label=><th key={label}>{t(label)}</th>)}</tr></thead>
      <tbody>{rows.map(row=><tr key={row.id}><td>{row.product_id}</td><td>{row.snapshot_date}</td><td>{number(row.inventory_level)}</td><td>{number(row.units_sold)}</td><td>{row.id}</td></tr>)}
        {!rows.length && <tr><td colSpan="5">{t('No matching records.')}</td></tr>}
      </tbody>
    </table></div>}
    <Feedback loading={busy} error={error}/>
  </details>;
}
