import { useEffect, useRef, useState } from 'react';
import { dailyDraft, localToday, manualSnapshotBatch, nextDataDate, savedBatchMatches } from '../../frontend/daily-data.js';
import { api, config, number } from '../workflow.js';
import { useLanguage } from '../i18n.jsx';
import { Feedback } from './WorkflowUI.jsx';

const extraFields = [
  ['category_raw', 'Category', 'text'], ['region_raw', 'Region', 'text'],
  ['units_ordered', 'Units ordered', 'number'], ['price', 'Price', 'number'],
  ['discount_raw', 'Discount (source value)', 'number'], ['weather_condition', 'Weather', 'text'],
  ['holiday_promotion', 'Holiday / promotion (0 or 1)', 'number'],
  ['competitor_pricing', 'Competitor price', 'number'], ['seasonality_raw', 'Seasonality', 'text'],
  ['demand_forecast_benchmark', 'Source demand benchmark', 'number'],
];

export default function DailyDataForm({snapshots, date, onSaved, onClose}) {
  const {t} = useLanguage();
  const [rows, setRows] = useState(() => dailyDraft(snapshots));
  const [targetDate, setTargetDate] = useState(() => nextDataDate(date));
  const [confirmed, setConfirmed] = useState(false), [busy, setBusy] = useState(false);
  const [error, setError] = useState(null), [uncertain, setUncertain] = useState(null);
  const lock = useRef(false), active = useRef(true);
  useEffect(() => {active.current = true; return () => {active.current = false;};}, []);
  const setField = (index, key, value) => {
    setRows(current => current.map((row, i) => i === index ? {...row, [key]: value} : row));
    setConfirmed(false);
  };
  async function save(event) {
    event.preventDefault();
    if (lock.current || uncertain || !confirmed || config.mode !== 'live') return;
    lock.current = true; setBusy(true); setError(null);
    let batch;
    try {
      batch = await manualSnapshotBatch(rows, targetDate);
      const receipt = await api.ingestSnapshots(batch);
      if (active.current) onSaved(targetDate, receipt.inserted_count);
    } catch (cause) {
      if (active.current) {setError(cause); if (cause.writeUncertain) setUncertain(batch);}
    } finally {lock.current = false; if (active.current) setBusy(false);}
  }
  async function checkSaved() {
    if (lock.current || !uncertain) return;
    lock.current = true; setBusy(true); setError(null);
    try {
      const saved = await api.getSnapshots({store_id: 'S001', from: targetDate, to: targetDate});
      if (active.current && savedBatchMatches(uncertain, saved)) onSaved(targetDate, uncertain.snapshots.length);
      else if (active.current) setError(new Error(t('The complete batch is not confirmed. Check the backend logs before submitting again.')));
    } catch (cause) {if (active.current) setError(cause);}
    finally {lock.current = false; if (active.current) setBusy(false);}
  }
  return <section className="panel workflow-body daily-data-panel" aria-label={t('Record daily sales and stock')}>
    <div className="panel-heading"><h2>{t('Record daily sales and stock')}</h2>
      <button className="secondary-button" type="button" disabled={busy} onClick={onClose}>{t('Close without saving')}</button>
    </div>
    <p>{t('Enter the actual units sold and observed stock for each product. Saving adds daily records; it does not subtract sales from stock again.')}</p>
    <p className="workflow-message">{t('Other fields are copied from the displayed date as a template. Expand each product to check or edit them before saving.')}
      {' '}{t('Template date')}: <strong>{date}</strong></p>
    <p>{t('Saved values shown below belong to the template date. Enter the new date’s actual observations in the empty fields.')}</p>
    <form className="workflow-form" onSubmit={save}>
      <fieldset disabled={busy || !!uncertain}>
        <label className="field-group daily-date-field">{t('New data date')}
          <input className="field-value" type="date" required max={localToday()} value={targetDate}
            onChange={e => {setTargetDate(e.target.value); setConfirmed(false); setError(null);}} />
        </label>
        {targetDate > nextDataDate(date) && <p className="workflow-message">{t('There is a gap after the template date. Daily prediction requires 29 consecutive dates, including the analysis date.')}</p>}
        <div className="table-scroll"><table className="data-table daily-entry-table">
          <thead><tr>{['Product ID', 'Observed stock', 'Daily units sold', 'Other fields'].map(label => <th key={label}>{t(label)}</th>)}</tr></thead>
          <tbody>{rows.map((row, index) => <tr key={row.product_id}>
            <td><strong>{row.product_id}</strong></td>
            {['inventory_level', 'units_sold'].map(key => <td key={key}>
              <span className="daily-saved-value">{t('Saved value')}: <strong>{number(snapshots[index][key])}</strong></span>
              <input className="field-value" type="number" required min="0" step="1" value={row[key]}
                aria-label={`${row.product_id} ${t(key === 'units_sold' ? 'Daily units sold' : 'Observed stock')}`}
                onChange={e => setField(index, key, e.target.value)} />
            </td>)}
            <td><details><summary>{t('Check other fields')}</summary><div className="daily-extra-fields">
              {extraFields.map(([key, label, type]) => <label className="field-group" key={key}>{t(label)}
                <input className="field-value" type={type} required value={row[key]}
                  min={type === 'number' && key !== 'demand_forecast_benchmark' ? 0 : undefined}
                  max={key === 'holiday_promotion' ? 1 : undefined} step={key === 'holiday_promotion' ? 1 : 'any'}
                  aria-label={`${row.product_id} ${t(label)}`} onChange={e => setField(index, key, e.target.value)} />
              </label>)}
            </div></details></td>
          </tr>)}</tbody>
        </table></div>
        <label className="daily-confirm"><input type="checkbox" required checked={confirmed} onChange={e => setConfirmed(e.target.checked)} />
          <span>{t('I have checked the date, sales, stock and all template fields for this batch.')}</span>
        </label>
        <p>{t('Existing records for the same store, product and date cannot be overwritten. The batch is saved together or rejected together.')}</p>
        <button className="primary-button daily-save" disabled={!confirmed || !rows.length}>{t(busy ? 'Saving…' : 'Save daily records')} ({rows.length})</button>
      </fieldset>
    </form>
    {error?.status === 409 && <p role="alert" className="workflow-message">{t('Records already exist for this date. Choose another date or inspect the saved records; nothing was overwritten.')}</p>}
    {uncertain && <div className="workflow-message" role="alert"><p>{t('Write outcome unknown. Check server state before retrying.')}</p>
      <button className="secondary-button" disabled={busy} onClick={checkSaved}>{t('Check saved records')}</button></div>}
    <Feedback loading={busy} error={error && {...error, message: t(error.message)}} />
  </section>;
}
