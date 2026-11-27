import {isDate} from './requests.js';

export function shiftDate(value, days) {
  if (!isDate(value)) return '';
  const date = new Date(`${value}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

// A missing product or observation makes the store total unknown, not zero.
export function dailySeries(rows, {from, to, products, field = 'units_sold'}) {
  if (!isDate(from) || !isDate(to) || from > to) return [];
  const roster = [...new Set(products)];
  const byDate = new Map();
  for (const row of rows) {
    if (!byDate.has(row.snapshot_date)) byDate.set(row.snapshot_date, new Map());
    byDate.get(row.snapshot_date).set(row.product_id, row);
  }
  const series = [];
  for (let date = from; date <= to; date = shiftDate(date, 1)) {
    const day = byDate.get(date);
    const observed = roster.map(id => day?.get(id)?.[field]);
    const complete = roster.length > 0 && observed.every(Number.isFinite);
    series.push({date, value: complete ? observed.reduce((sum, value) => sum + value, 0) : null,
      observed: observed.filter(Number.isFinite).length, expected: roster.length});
  }
  return series;
}

export function relativeChange(before, after) {
  if (!Number.isFinite(before) || !Number.isFinite(after) || before < 0) return null;
  if (before === 0) return after === 0 ? 0 : null;
  return (after - before) / before * 100;
}

export function diagnosticSummary(scan) {
  const rows = Object.entries(scan.products).map(([product, findings]) => ({product, findings}));
  const has = (row, status) => Object.values(row.findings).some(item => item.status === status);
  return {rows, flagged: rows.filter(row => has(row, 'anomaly')),
    incomplete: rows.filter(row => has(row, 'insufficient_data')),
    limited: rows.filter(row => has(row, 'inventory_limited')),
    high: rows.filter(row => row.findings.persistent_high_sales?.status === 'anomaly'),
    low: rows.filter(row => row.findings.persistent_low_sales?.status === 'anomaly'),
    stockout: rows.filter(row => row.findings.long_stockout?.status === 'anomaly')};
}

export const simulatedSnapshot = row => /^(forecast_auto\/|historical_simulation\/|synthetic-fixture\/)/.test(row.source_reference || '');
export function sumKnown(rows, field) {
  return rows.length && rows.every(row => Number.isFinite(row[field]))
    ? rows.reduce((sum, row) => sum + row[field], 0) : null;
}
