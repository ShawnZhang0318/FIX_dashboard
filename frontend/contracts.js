import { ApiError } from './errors.js';
import { STORE_ID, prepareSnapshotBatch } from './requests.js';

const runStates = ['queued', 'processing', 'completed', 'failed'];
const caseStates = ['pending_review', 'approved', 'modified', 'rejected', 'resolved'];
const jobStates = {queued: 'pending', processing: 'claimed', completed: 'completed', failed: 'failed'};
const idFields = new Set(['id', 'analysis_run_id', 'job_id', 'case_id', 'snapshot_id', 'source_snapshot_id', 'forecast_result_id']);
// W04 uses integer DB IDs; browser routes use strings. Never coerce quantities.
export function normalizeResponseIds(value) {
  if (Array.isArray(value)) return value.map(normalizeResponseIds);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.entries(value).map(([key, v]) => [key,
    key === 'snapshot_ids' && Array.isArray(v) ? v.map(id => Number.isSafeInteger(id) && id >= 0 ? String(id) : id) :
      idFields.has(key) && Number.isSafeInteger(v) && v >= 0 ? String(v) : normalizeResponseIds(v)]));
}
function check(ok, field) {
  if (!ok) {
    const error = new ApiError(`Contract mismatch: invalid or missing ${field}.`, 502, 'CONTRACT_MISMATCH');
    error.field = field;
    throw error;
  }
}
const object = (v, p) => check(v !== null && typeof v === 'object' && !Array.isArray(v), p);
const text = (v, p) => check(typeof v === 'string' && v.trim().length > 0, p);
const optionalText = (v, p) => check(v == null || typeof v === 'string', p);
const number = (v, p, integer = false) => check(v == null || (Number.isFinite(v) && v >= 0 && (!integer || Number.isInteger(v))), p);
const requiredNumber = (v, p, integer = false) => { check(v != null, p); number(v, p, integer); };
const member = (v, values, p) => check(values.includes(v), p);
function date(v, p) {
  check(typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) &&
    Number.isFinite(Date.parse(v)) && new Date(v).toISOString().slice(0, 10) === v, p);
}
function array(v, p, validate) {
  check(Array.isArray(v), p);
  v.forEach((row, i) => validate(row, `${p}[${i}]`));
}
function unique(rows, key, p) {
  check(new Set(rows.map(key)).size === rows.length, p);
}
function forecast(x, p, runId) {
  object(x, p);
  for (const key of ['id', 'analysis_run_id', 'store_id', 'product_id', 'snapshot_id', 'model_version', 'policy_version', 'input_reference']) text(x[key], `${p}.${key}`);
  check(x.store_id === STORE_ID, `${p}.store_id`);
  if (runId) check(x.analysis_run_id === runId, `${p}.analysis_run_id`);
  for (const key of ['name', 'explanation', 'anomaly_type', 'case_id']) optionalText(x[key], `${p}.${key}`);
  if (x.case_id != null) text(x.case_id, `${p}.case_id`);
  member(x.forecast_mode, ['quantile', 'point_buffer'], `${p}.forecast_mode`);
  number(x.horizon_days, `${p}.horizon_days`, true);
  check(x.horizon_days > 0, `${p}.horizon_days`);
  for (const key of ['inventory_at_prediction', 'safety_stock', 'recommended_order_quantity']) requiredNumber(x[key], `${p}.${key}`);
  if (x.forecast_mode === 'quantile') {
    requiredNumber(x.predicted_demand_p50, `${p}.predicted_demand_p50`);
    requiredNumber(x.predicted_demand_p90, `${p}.predicted_demand_p90`);
    check(x.predicted_demand_p90 >= x.predicted_demand_p50, `${p}.predicted_demand_p90`);
    check(x.predicted_demand_point == null && x.uncertainty_buffer == null, `${p}.forecast_mode (mixed values)`);
  } else {
    requiredNumber(x.predicted_demand_point, `${p}.predicted_demand_point`);
    requiredNumber(x.uncertainty_buffer, `${p}.uncertainty_buffer`);
    check(x.predicted_demand_p50 == null && x.predicted_demand_p90 == null, `${p}.forecast_mode (point estimates are not quantiles)`);
  }
  check(Number.isFinite(Date.parse(x.processed_at)), `${p}.processed_at`);
  requiredNumber(x.duration_ms, `${p}.duration_ms`);
}
function exception(x, p, id, runId) {
  object(x, p);
  text(x.id, `${p}.id`);
  text(x.analysis_run_id, `${p}.analysis_run_id`);
  if (id) check(x.id === id, `${p}.id`);
  if (runId) check(x.analysis_run_id === runId, `${p}.analysis_run_id`);
  member(x.parent_run_status, runStates, `${p}.parent_run_status`);
  member(x.status, caseStates, `${p}.status`);
  member(x.exception_type, ['reorder', 'anomaly', 'reorder_and_anomaly'], `${p}.exception_type`);
  forecast(x.result, `${p}.result`, x.analysis_run_id);
  check(x.result.case_id === x.id, `${p}.result.case_id`);
  check(typeof x.partial === 'boolean', `${p}.partial`);
  check(!(x.parent_run_status === 'completed' && x.partial), `${p}.partial`);
  for (const key of ['reviewer_label', 'reviewed_at', 'override_reason']) optionalText(x[key], `${p}.${key}`);
  number(x.reviewer_order_quantity, `${p}.reviewer_order_quantity`, true);
  if (x.status !== 'pending_review') {
    text(x.reviewer_label, `${p}.reviewer_label`);
    check(Number.isFinite(Date.parse(x.reviewed_at)), `${p}.reviewed_at`);
    member(x.reviewer_decision, ['approve', 'modify', 'reject', 'resolve'], `${p}.reviewer_decision`);
    check(({approve:'approved',modify:'modified',reject:'rejected',resolve:'resolved'})[x.reviewer_decision] === x.status, `${p}.reviewer_decision`);
    check(x.parent_run_status === 'completed' && !x.partial, `${p}.parent_run_status (reviewed incomplete run)`);
    check((x.exception_type === 'anomaly') === (x.reviewer_decision === 'resolve'), `${p}.reviewer_decision (case type)`);
    if (x.reviewer_decision !== 'approve' || x.exception_type === 'reorder_and_anomaly') text(x.override_reason, `${p}.override_reason`);
    if (x.reviewer_decision === 'approve') check(x.reviewer_order_quantity === x.result.recommended_order_quantity, `${p}.reviewer_order_quantity`);
    if (x.reviewer_decision === 'modify') requiredNumber(x.reviewer_order_quantity, `${p}.reviewer_order_quantity`, true);
    if (x.reviewer_decision === 'reject') check(x.reviewer_order_quantity === 0, `${p}.reviewer_order_quantity`);
    if (x.reviewer_decision === 'resolve') check(x.reviewer_order_quantity === null, `${p}.reviewer_order_quantity`);
  }
}
function inventoryItem(x, p, storeId = STORE_ID, productId) {
  object(x, p); text(x.product_id, `${p}.product_id`);
  check(x.store_id === storeId, `${p}.store_id`);
  if (productId) check(x.product_id === productId, `${p}.product_id`);
  date(x.snapshot_date, `${p}.snapshot_date`);
  text(x.source_snapshot_id, `${p}.source_snapshot_id`);
  requiredNumber(x.on_hand_quantity, `${p}.on_hand_quantity`);
  requiredNumber(x.lead_time_days, `${p}.lead_time_days`, true);
  check(x.lead_time_days > 0, `${p}.lead_time_days`);
  for (const key of ['name', 'category']) optionalText(x[key], `${p}.${key}`);
}
function snapshot(x, p, filters = {}) {
  object(x, p); text(x.id, `${p}.id`);
  try { prepareSnapshotBatch({snapshots: [x]}, {validateSource:false}); } catch (error) { check(false, `${p}.${error.field}`); }
  check(x.store_id === (filters.store_id || STORE_ID), `${p}.store_id`);
  if (filters.product_id) check(x.product_id === filters.product_id, `${p}.product_id`);
  if (filters.from) check(x.snapshot_date >= filters.from, `${p}.snapshot_date`);
  if (filters.to) check(x.snapshot_date <= filters.to, `${p}.snapshot_date`);
}

// Reject incompatible DTOs before React reads nested values. Missing numerical
// predictions remain unavailable; never silently coerce them to zero.
export function validateResponse(operation, data, args = []) {
  const [first] = args;
  if (operation === 'getSnapshots') {
    array(data, 'snapshots', (x, p) => snapshot(x, p, first));
    unique(data, x => `${x.store_id}/${x.product_id}/${x.snapshot_date}`, 'snapshots (duplicate)');
  } else if (operation === 'ingestSnapshots') {
    object(data, 'ingestion');
    check(data.inserted_count === first.snapshots.length, 'ingestion.inserted_count (atomic batch)');
    check(Array.isArray(data.snapshot_ids) && data.snapshot_ids.length === first.snapshots.length, 'ingestion.snapshot_ids');
    data.snapshot_ids.forEach((v, i) => text(v, `ingestion.snapshot_ids[${i}]`));
    unique(data.snapshot_ids, x => x, 'ingestion.snapshot_ids (duplicate)');
  } else if (operation === 'getInventoryItem') {
    inventoryItem(data, 'inventory', first, args[1]);
  } else if (operation === 'getInventory') {
    array(data, 'inventory', (x, p) => inventoryItem(x, p, first?.store_id));
    unique(data, x => `${x.store_id}:${x.product_id}`, 'inventory.product_id (duplicate)');
  } else if (operation === 'createAnalysisRun') {
    object(data, 'response'); object(data.analysis_run, 'analysis_run'); object(data.job, 'job');
    text(data.analysis_run.id, 'analysis_run.id');
    check(data.analysis_run.status === 'queued', 'analysis_run.status');
    text(data.job.id, 'job.id'); check(data.job.status === 'pending', 'job.status');
  } else if (operation === 'getAnalysisRun') {
    object(data, 'run'); check(data.id === first, 'run.id');
    check(data.store_id === STORE_ID, 'run.store_id'); date(data.as_of_date, 'run.as_of_date');
    member(data.status, runStates, 'run.status');
    for (const key of ['processed_count', 'expected_count']) requiredNumber(data[key], `run.${key}`, true);
    check(data.processed_count <= data.expected_count, 'run.processed_count');
    check(typeof data.partial === 'boolean', 'run.partial');
    object(data.job, 'run.job'); text(data.job.id, 'run.job.id');
    check(data.job.status === jobStates[data.status], 'run.job.status');
    if (data.status === 'completed') check(!data.partial && data.processed_count === data.expected_count, 'run.completeness');
    if (data.status === 'failed' && data.processed_count > 0) check(data.partial, 'run.partial');
    check(Number.isFinite(Date.parse(data.created_at)), 'run.created_at');
    check(data.completed_at == null || Number.isFinite(Date.parse(data.completed_at)), 'run.completed_at');
    if (['completed', 'failed'].includes(data.status)) check(data.completed_at != null, 'run.completed_at');
  } else if (operation === 'getAnalysisResults') {
    object(data, 'results');
    member(data.status, runStates, 'results.status');
    check(typeof data.partial === 'boolean', 'results.partial');
    if (data.status === 'completed') check(!data.partial, 'results.partial');
    array(data.results, 'results.results', (x, p) => forecast(x, p, first));
    unique(data.results, x => x.id, 'results.id (duplicate)');
    unique(data.results, x => `${x.store_id}/${x.product_id}`, 'results.product_id (duplicate)');
    if (data.status === 'failed' && data.results.length) check(data.partial, 'results.partial');
  } else if (operation === 'getExceptions') {
    array(data, 'exceptions', (x, p) => {
      exception(x, p, null, first?.run_id);
      if (first?.status) check(x.status === first.status, `${p}.status`);
      check(x.result.store_id === (first?.store_id || STORE_ID), `${p}.result.store_id`);
    });
    unique(data, x => x.id, 'exceptions.id (duplicate)');
  } else if (operation === 'getException' || operation === 'submitReview') {
    exception(data, 'case', first);
    if (operation === 'submitReview') {
      check(data.reviewer_decision === args[1]?.decision && data.status !== 'pending_review', 'case.reviewer_decision');
      check(data.reviewer_label === args[1].reviewer_label.trim(), 'case.reviewer_label');
      check((data.override_reason || '') === (args[1].override_reason?.trim() || ''), 'case.override_reason');
      if (args[1].decision === 'modify') check(data.reviewer_order_quantity === args[1].reviewer_order_quantity, 'case.reviewer_order_quantity');
    }
  }
  return data;
}

// Status and results are separate reads; never label a stale/mixed response as a completed run.
export function validateRunResults(run, results) {
  check(results.status === run.status && results.partial === run.partial, 'results.run_state');
  check(results.results.length === run.processed_count, 'results.processed_count');
  for (const row of results.results) {
    check(row.analysis_run_id === run.id && row.store_id === run.store_id, 'results.run_identity');
    if (row.snapshot_date != null) check(row.snapshot_date === run.as_of_date, 'results.snapshot_date');
  }
  return results;
}
