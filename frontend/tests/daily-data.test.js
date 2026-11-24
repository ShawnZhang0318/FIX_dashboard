import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createMockApi } from '../mock-api.js';
import { createLiveApi } from '../live-api.js';
import { dailyDraft, latestDataDate, loadInventoryDay, manualSnapshotBatch, nextDataDate, savedBatchMatches } from '../daily-data.js';

async function fixture() {
  const api = createMockApi({storage: {getItem: () => null, setItem() {}}});
  return {api, snapshots: await api.getSnapshots()};
}

test('inventory reads sales and stock from the selected date rather than current inventory', async () => {
  const calls = [], signal = new AbortController().signal;
  const api = {
    getInventory: async () => [{product_id: 'P1', snapshot_date: '2024-01-01', on_hand_quantity: 800}],
    getSnapshots: async (filters, options) => {
      calls.push(filters); assert.equal(options.signal, signal);
      return [{product_id: 'P1', snapshot_date: filters.from, inventory_level: 50, units_sold: 9}];
    },
  };
  const old = await loadInventoryDay(api, '2023-11-15', {signal});
  assert.equal(old.date, '2023-11-15');
  assert.equal(old.snapshots[0].inventory_level, 50);
  assert.equal(old.snapshots[0].units_sold, 9);
  assert.deepEqual(calls[0], {store_id: 'S001', from: '2023-11-15', to: '2023-11-15'});
  assert.equal((await loadInventoryDay(api, '', {signal})).date, '2024-01-01');
  assert.equal(latestDataDate([]), '');
  assert.equal(nextDataDate('2024-02-28'), '2024-02-29');
  assert.equal(nextDataDate('2023-12-31'), '2024-01-01');
});

test('manual entries require observed values, preserve genuine zero, and never copy old sales', async () => {
  const {snapshots} = await fixture();
  const draft = dailyDraft([snapshots[0]]);
  assert.equal(draft[0].units_sold, ''); assert.equal(draft[0].inventory_level, '');
  await assert.rejects(manualSnapshotBatch(draft, '2022-07-01', '2022-07-01'), /required value/);
  const row = {...draft[0], units_sold: '0', inventory_level: '150', demand_forecast_benchmark: '-2'};
  const batch = await manualSnapshotBatch([row], '2022-07-01', '2022-07-01');
  assert.equal(batch.snapshots[0].units_sold, 0);
  assert.equal(batch.snapshots[0].inventory_level, 150);
  assert.equal(batch.snapshots[0].snapshot_date, '2022-07-01');
  assert.equal(batch.snapshots[0].demand_forecast_benchmark, -2);
  assert.match(batch.snapshots[0].source_reference, /manual-entry; template=/);
  assert.equal(batch.snapshots[0].id, undefined);
  assert.equal(batch.snapshots[0].base_snapshot_id, undefined);
  assert.equal(batch.source_file_sha256, createHash('sha256').update(JSON.stringify(batch.snapshots)).digest('hex'));
  assert.equal(snapshots[0].snapshot_date, '2022-06-30');
  assert.equal(snapshots[0].units_sold, 10);
  for (const units_sold of ['', ' ', '-1', '1.5', 'NaN', 'Infinity'])
    await assert.rejects(manualSnapshotBatch([{...row, units_sold}], '2022-07-01', '2022-07-01'));
  for (const date of ['', '2023-02-29', '2022-07-02'])
    await assert.rejects(manualSnapshotBatch([row], date, '2022-07-01'), /valid data date/);
});

test('manual batch uses the shared POST contract and uncertain reconciliation requires every exact payload hash', async () => {
  const {snapshots} = await fixture();
  const batch = await manualSnapshotBatch(dailyDraft(snapshots).map(row => ({...row, units_sold: '12', inventory_level: '80'})), '2022-07-01', '2022-07-01');
  let transmitted;
  const api = createLiveApi({fetchImpl: async (url, options) => {
    assert.equal(url, '/snapshots'); assert.equal(options.method, 'POST');
    transmitted = JSON.parse(options.body);
    return new Response(JSON.stringify({inserted_count: batch.snapshots.length, snapshot_ids: batch.snapshots.map((_, i) => String(i))}), {status: 201});
  }});
  await api.ingestSnapshots(batch);
  assert.deepEqual(transmitted, batch);
  const saved = batch.snapshots.map(row => ({...row, source_file_sha256: batch.source_file_sha256}));
  assert.equal(savedBatchMatches(batch, saved), true);
  assert.equal(savedBatchMatches(batch, saved.slice(1)), false);
  assert.equal(savedBatchMatches(batch, saved.map(row => ({...row, source_file_sha256: 'wrong'}))), false);
});
