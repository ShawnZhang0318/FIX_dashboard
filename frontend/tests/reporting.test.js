import test from 'node:test';
import assert from 'node:assert/strict';
import {dailySeries, shiftDate, relativeChange, diagnosticSummary, sumKnown} from '../reporting.js';

test('store chart totals leave partial days and absent dates unknown, preserving genuine zero sales', () => {
  const points = dailySeries([
    {product_id: 'A', snapshot_date: '2026-11-23', units_sold: 8},
    {product_id: 'B', snapshot_date: '2026-11-23', units_sold: 2},
    {product_id: 'A', snapshot_date: '2026-11-24', units_sold: 5},
    {product_id: 'A', snapshot_date: '2026-11-26', units_sold: 0},
    {product_id: 'B', snapshot_date: '2026-11-26', units_sold: 0},
  ], {from: '2026-11-23', to: '2026-11-26', products: ['A', 'B']});
  assert.deepEqual(points.map(p => p.value), [10, null, null, 0]);
  assert.equal(points[1].observed, 1);
  assert.equal(points[2].observed, 0);
  assert.equal(points[3].expected, 2);
  assert.equal(dailySeries([], {from: '2026-11-26', to: '2026-11-26', products: []})[0].value, null);
});

test('date windows are calendar-based across leap days and year boundaries', () => {
  assert.equal(shiftDate('2024-03-01', -1), '2024-02-29');
  assert.equal(shiftDate('2024-01-01', -27), '2023-12-05');
  assert.equal(shiftDate('2026-12-31', 1), '2027-01-01');
  assert.equal(shiftDate('invalid', -1), '');
});

test('zero or absent baselines do not produce misleading growth percentages', () => {
  assert.equal(relativeChange(0, 10), null);
  assert.equal(relativeChange(null, 10), null);
  assert.equal(relativeChange(0, 0), 0);
  assert.equal(relativeChange(100, 59), -41);
  assert.equal(sumKnown([{n: 5}, {n: null}], 'n'), null);
  assert.equal(sumKnown([], 'n'), null);
});

test('monthly grouping counts each flagged product once and keeps overlapping and incomplete checks visible', () => {
  const scan = {products: {
    A: {persistent_high_sales: {status: 'anomaly'}, long_stockout: {status: 'anomaly'}},
    B: {persistent_low_sales: {status: 'insufficient_data'}, long_stockout: {status: 'normal'}},
    C: {persistent_high_sales: {status: 'inventory_limited'}, long_stockout: {status: 'anomaly'}},
  }};
  const result = diagnosticSummary(scan);
  assert.equal(result.rows.length, 3);
  assert.equal(result.flagged.length, 2);
  assert.equal(result.high.length, 1);
  assert.equal(result.stockout.length, 2);
  assert.equal(result.incomplete.length, 1);
  assert.equal(result.limited.length, 1);
});
