import { isDate, prepareSnapshotBatch, snapshotFields } from './requests.js';

export function localToday() {
  const now = new Date();
  return [now.getFullYear(), String(now.getMonth() + 1).padStart(2, '0'), String(now.getDate()).padStart(2, '0')].join('-');
}

export const latestDataDate = rows => rows.map(row => row.snapshot_date).sort().at(-1) || '';
export function nextDataDate(value) {
  if (!isDate(value)) return '';
  const date = new Date(`${value}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + 1);
  return date.toISOString().slice(0, 10);
}

// Read the actual observations for ONE date. Never reuse current stock as historical stock.
export async function loadInventoryDay(api, selectedDate, options) {
  const inventory = await api.getInventory({store_id: 'S001'}, options);
  const date = selectedDate || latestDataDate(inventory);
  const snapshots = date ? await api.getSnapshots({store_id: 'S001', from: date, to: date}, options) : [];
  return {date, inventory, snapshots};
}

export function dailyDraft(snapshots) {
  return snapshots.map(row => ({...Object.fromEntries(snapshotFields.map(key => [key, row[key]])),
    base_snapshot_id: row.id, base_date: row.snapshot_date,
    inventory_level: '', units_sold: '',
  }));
}

const numericFields = ['inventory_level', 'units_sold', 'units_ordered', 'price', 'discount_raw',
  'holiday_promotion', 'competitor_pricing', 'demand_forecast_benchmark'];

export async function manualSnapshotBatch(rows, date, today = localToday()) {
  if (!isDate(date) || date > today) throw new Error('Choose a valid data date that is not in the future.');
  const snapshots = rows.map(row => {
    const result = {...row, snapshot_date: date,
      source_reference: `manual-entry; template=${row.base_snapshot_id}; template_date=${row.base_date}`};
    for (const key of numericFields) {
      if (row[key] == null || String(row[key]).trim() === '' || !Number.isFinite(Number(row[key])))
        throw new Error('Complete every required value; enter 0 only when the observed value is zero.');
      result[key] = Number(row[key]);
    }
    if (!['inventory_level', 'units_sold'].every(key => Number.isSafeInteger(result[key]) && result[key] >= 0))
      throw new Error('Daily units sold and observed stock must be nonnegative whole numbers.');
    return result;
  });
  const clean = prepareSnapshotBatch({snapshots}, {validateSource: false}).snapshots;
  // Manual entries have no source file: hash the exact canonical row payload instead.
  const digest = await globalThis.crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify(clean)));
  return {source_file_sha256: Array.from(new Uint8Array(digest), b => b.toString(16).padStart(2, '0')).join(''), snapshots: clean};
}

export function savedBatchMatches(batch, saved) {
  return batch.snapshots.every(row => saved.some(item => item.store_id === row.store_id &&
    item.product_id === row.product_id && item.snapshot_date === row.snapshot_date &&
    item.source_file_sha256 === batch.source_file_sha256));
}
