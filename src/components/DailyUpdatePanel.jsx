import {useEffect, useRef, useState} from 'react';
import {Link} from 'react-router';
import {api, config, number} from '../workflow.js';
import {useLanguage} from '../i18n.jsx';
import {Feedback} from './WorkflowUI.jsx';
import {isDate, snapshotFields} from '../../frontend/requests.js';

// Append-only daily entry: every row starts from a complete stored snapshot and
// only the daily operating numbers are editable. The identity fields
// (store/product/date) are never taken from the baseline date, so an existing
// (store, product, date) key can never be rewritten by this panel.
const EDITABLE_FIELDS = ['units_sold', 'inventory_level', 'units_ordered'];
const FIELD_LABELS = {
  units_sold: 'Units sold',
  inventory_level: 'Inventory level',
  units_ordered: 'Units ordered',
};
const ROSTER_SIZE = 20;
const STORE_ID = 'S001';

const addDays = (iso, delta) => {
  const value = new Date(`${iso}T00:00:00Z`);
  value.setUTCDate(value.getUTCDate() + delta);
  return value.toISOString().slice(0, 10);
};

function parseUnits(value) {
  const parsed = typeof value === 'string' && value.trim() !== '' ? Number(value) : value;
  return typeof parsed === 'number' && Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
}

async function sha256Hex(text) {
  if (!globalThis.crypto?.subtle) {
    throw new Error('Secure browser crypto is unavailable; open the dashboard on localhost or HTTPS.');
  }
  const digest = await globalThis.crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('');
}

export default function DailyUpdatePanel({onImported}) {
  const {t} = useLanguage();
  const [date, setDate] = useState('');
  const [latestDate, setLatestDate] = useState(null);
  const [rows, setRows] = useState(null);
  const [baseline, setBaseline] = useState(null);
  const [reloadToken, setReloadToken] = useState(0);
  const [error, setError] = useState(null), [busy, setBusy] = useState(false);
  const [receipt, setReceipt] = useState(null), [uncertain, setUncertain] = useState(false);
  const lock = useRef(false), active = useRef(true), booted = useRef(false);

  useEffect(() => {
    active.current = true;
    return () => {active.current = false;};
  }, []);

  // Default to the day after the newest stored snapshot so the next append is one click.
  useEffect(() => {
    if (config.mode !== 'live' || booted.current) return;
    booted.current = true;
    api.getLatestSnapshot({store_id: STORE_ID})
      .then(latest => {
        if (!active.current) return;
        setLatestDate(latest?.snapshot_date || null);
        if (latest?.snapshot_date) setDate(current => current || addDays(latest.snapshot_date, 1));
      })
      .catch(cause => {if (active.current) setError(cause);});
  }, []);

  // Load a baseline whenever the target date changes: the target date itself if
  // it already exists (read-only preview), otherwise the previous day.
  useEffect(() => {
    if (config.mode !== 'live' || !isDate(date)) {
      setRows(null);
      setBaseline(null);
      return;
    }
    let cancelled = false;
    const controller = new AbortController();
    setError(null);
    (async () => {
      try {
        const found = await loadBaseline(date, controller.signal);
        if (cancelled || !active.current) return;
        setRows(found.rows);
        setBaseline(found);
      } catch (cause) {
        if (!cancelled && active.current && cause?.code !== 'CANCELLED') {
          setError(cause);
          setRows(null);
          setBaseline(null);
        }
      }
    })();
    return () => {cancelled = true; controller.abort();};
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [date, reloadToken]);

  async function loadBaseline(day, signal) {
    const options = {signal};
    const own = await api.getSnapshots({store_id: STORE_ID, from: day, to: day}, options);
    if (own.length) return {rows: own, baselineDate: day, existing: true};
    const previous = addDays(day, -1);
    const prior = await api.getSnapshots({store_id: STORE_ID, from: previous, to: previous}, options);
    if (prior.length) return {rows: prior, baselineDate: previous, existing: false};
    const latest = await api.getLatestSnapshot({store_id: STORE_ID}, options);
    if (!latest?.snapshot_date) return {rows: [], baselineDate: null, existing: false};
    const fallback = await api.getSnapshots({store_id: STORE_ID, from: latest.snapshot_date, to: latest.snapshot_date}, options);
    return {rows: fallback, baselineDate: latest.snapshot_date, existing: latest.snapshot_date === day};
  }

  function editCell(productId, field, value) {
    setRows(current => (current || []).map(row => row.product_id === productId ? {...row, [field]: value} : row));
  }

  const existingDate = !!baseline?.existing && baseline?.baselineDate === date;
  const contiguous = !!baseline?.baselineDate && baseline.baselineDate === addDays(date, -1);
  const complete = !!rows && rows.length === ROSTER_SIZE && new Set(rows.map(row => row.product_id)).size === ROSTER_SIZE;
  const invalidCells = rows ? rows.filter(row => EDITABLE_FIELDS.some(field => parseUnits(row[field]) === null)) : [];
  const canSubmit = config.mode === 'live' && isDate(date) && complete && !existingDate &&
    invalidCells.length === 0 && !busy && !uncertain;

  async function submit(event) {
    event.preventDefault();
    if (!canSubmit || lock.current) return;
    lock.current = true;
    setBusy(true);
    setError(null);
    setReceipt(null);
    try {
      const snapshots = rows.map(row => Object.fromEntries(snapshotFields.map(field => [
        field,
        field === 'snapshot_date' ? date
          : EDITABLE_FIELDS.includes(field) ? parseUnits(row[field])
          : field === 'source_reference' ? `dashboard-daily-update#${STORE_ID}#${date}`
          : row[field],
      ])));
      const body = {source_file_sha256: await sha256Hex(JSON.stringify(snapshots)), snapshots};
      const data = await api.ingestSnapshots(body);
      if (!active.current) return;
      setReceipt(data);
      setLatestDate(date);
      onImported?.();
      setReloadToken(token => token + 1);
    } catch (cause) {
      if (active.current) {
        setError(cause);
        if (cause.writeUncertain) setUncertain(true);
      }
    } finally {
      lock.current = false;
      if (active.current) setBusy(false);
    }
  }

  const headers = ['Product ID', ...EDITABLE_FIELDS.map(field => FIELD_LABELS[field]), 'Snapshot date'];
  return (
    <section className="panel inventory-panel">
      <div className="panel-heading">
        <div>
          <h2>{t('Daily sales update')}</h2>
          <p>{t('Append the next date through the public API. Every row starts from the previous complete snapshot; only the daily operating numbers below are editable, and existing dates are never overwritten.')}</p>
        </div>
      </div>
      <div className="table-toolbar">
        <label className="field-group">
          {t('Snapshot date')}
          <input
            className="field-value"
            type="date"
            value={date}
            disabled={busy || config.mode !== 'live'}
            onChange={e => {setReceipt(null); setDate(e.target.value);}}
          />
        </label>
        {latestDate && (
          <label className="field-group">
            {t('Latest stored snapshot')}
            <input className="field-value" disabled value={latestDate} />
          </label>
        )}
        {baseline?.baselineDate && (
          <label className="field-group">
            {t('Baseline date')}
            <input className="field-value" disabled value={`${baseline.baselineDate} · ${rows.length} ${t('products')}`} />
          </label>
        )}
        <button className="secondary-button" type="button" disabled={busy || !isDate(date)} onClick={() => setReloadToken(token => token + 1)}>
          {t('Reload baseline')}
        </button>
      </div>
      <form className="workflow-form" onSubmit={submit}>
        <fieldset disabled={busy || config.mode !== 'live' || uncertain}>
          {existingDate && <p className="analysis-mode-note" role="status">{t('Snapshots for this date already exist. Daily updates are append-only: choose a new date after the latest stored snapshot.')}</p>}
          {!existingDate && rows && !contiguous && <p className="analysis-mode-note" role="status">{t('The baseline is not the previous calendar day. A date gap blocks daily analysis for the following 29 days.')}</p>}
          {rows && !complete && <p className="analysis-mode-note" role="status">{t('A complete snapshot for all 20 products is required before the batch can be submitted and before daily analysis can run.')}</p>}
          {rows && complete && !existingDate && invalidCells.length > 0 && <p className="analysis-mode-note" role="status">{t('Daily sales, inventory and ordered units must be nonnegative numbers.')}</p>}
          {config.mode !== 'live' && <p className="analysis-mode-note">{t('Daily sales updates are available after the real backend is connected. Mock fixtures are read-only.')}</p>}
          {rows && complete && (
            <div className="table-scroll">
              <table className="data-table">
                <thead>
                  <tr>{headers.map(label => <th key={label}>{t(label)}</th>)}</tr>
                </thead>
                <tbody>
                  {rows.map(row => (
                    <tr key={row.product_id}>
                      <td>{row.product_id}</td>
                      {EDITABLE_FIELDS.map(field => (
                        <td key={field}>
                          {existingDate ? number(parseUnits(row[field])) : (
                            <input
                              className="field-value"
                              type="number"
                              min="0"
                              step="1"
                              size={6}
                              aria-label={`${row.product_id} ${t(FIELD_LABELS[field])}`}
                              value={row[field]}
                              onChange={e => editCell(row.product_id, field, e.target.value)}
                            />
                          )}
                        </td>
                      ))}
                      <td>{existingDate ? row.snapshot_date : date}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {isDate(date) && rows && complete && !existingDate && (
            <div className="request-footer">
              <button className="primary-button" disabled={!canSubmit}>
                {t(busy ? 'Submitting…' : 'Submit daily update')}
              </button>
            </div>
          )}
        </fieldset>
      </form>
      {uncertain && <p role="alert">{t('The write outcome is unknown. Query the submitted store/product/dates and ask the backend owner to confirm before reloading and submitting again.')}</p>}
      {receipt && (
        <p role="status">
          {t('Snapshots accepted by API')}: {receipt.inserted_count} · {t('Snapshot date')} {date}
          {' · '}
          <Link className="text-link" to="/analysis">{t('Go to Analysis')}</Link>
        </p>
      )}
      {!rows && isDate(date) && !error && config.mode === 'live' && <p>{t('Loading the baseline snapshot…')}</p>}
      <Feedback loading={busy} error={error} />
    </section>
  );
}
