import { ApiError } from './errors.js';

export const STORE_ID = 'S001';
export const SNAPSHOT_BATCH_LIMIT = 100;
export const snapshotFields = [
  'store_id', 'product_id', 'snapshot_date', 'category_raw', 'region_raw',
  'inventory_level', 'units_sold', 'units_ordered', 'price', 'discount_raw',
  'weather_condition', 'holiday_promotion', 'competitor_pricing',
  'seasonality_raw', 'demand_forecast_benchmark', 'source_reference',
];
function requireValue(ok, field) {
  if (!ok) {
    const error = new ApiError(`Invalid request: ${field}.`, 422, 'INVALID_REQUEST');
    error.field = field;
    throw error;
  }
}
export const isDate = value => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) &&
  Number.isFinite(Date.parse(value)) && new Date(value).toISOString().slice(0, 10) === value;
const nonempty = value => typeof value === 'string' && value.trim().length > 0;
const pick = (body, fields) => Object.fromEntries(fields.filter(key => body[key] !== undefined).map(key => [key, body[key]]));
function store(value = STORE_ID) {
  requireValue(value === STORE_ID, 'store_id (configured v1 store: S001)');
  return value;
}
export function resourceId(value) {
  requireValue(nonempty(value) || (Number.isSafeInteger(value) && value >= 0), 'resource ID');
  return String(value);
}
export function prepareSnapshotBatch(body, {validateSource = true} = {}) {
  requireValue(body && Array.isArray(body.snapshots) && body.snapshots.length > 0 &&
    body.snapshots.length <= SNAPSHOT_BATCH_LIMIT, `snapshots (1–${SNAPSHOT_BATCH_LIMIT} rows per atomic batch)`);
  if (validateSource) requireValue(typeof body.source_file_sha256 === 'string' && /^[a-f0-9]{64}$/i.test(body.source_file_sha256), 'source_file_sha256');
  const keys = new Set();
  return {...(validateSource ? {source_file_sha256:body.source_file_sha256.toLowerCase()} : {}), snapshots: body.snapshots.map((row, index) => {
    const p = `snapshots[${index}]`;
    requireValue(row && typeof row === 'object' && !Array.isArray(row), p);
    requireValue(row.store_id === STORE_ID, `${p}.store_id`);
    requireValue(nonempty(row.product_id), `${p}.product_id`);
    requireValue(isDate(row.snapshot_date), `${p}.snapshot_date`);
    for (const key of ['inventory_level', 'units_sold', 'units_ordered', 'price', 'discount_raw', 'competitor_pricing'])
      requireValue(Number.isFinite(row[key]) && row[key] >= 0, `${p}.${key}`);
    // The source benchmark contains negative values. It is never sent to AI by the dashboard.
    requireValue(Number.isFinite(row.demand_forecast_benchmark), `${p}.demand_forecast_benchmark`);
    requireValue([0, 1].includes(row.holiday_promotion), `${p}.holiday_promotion`);
    for (const key of ['category_raw', 'region_raw', 'weather_condition', 'seasonality_raw', 'source_reference'])
      requireValue(nonempty(row[key]), `${p}.${key}`);
    const identity = `${row.store_id}/${row.product_id}/${row.snapshot_date}`;
    requireValue(!keys.has(identity), `${p} duplicate store/product/date`);
    keys.add(identity);
    return pick(row, snapshotFields);
  })};
}
export function prepareRun(body) {
  requireValue(body && typeof body === 'object', 'analysis request');
  requireValue(body.store_id === STORE_ID, 'store_id');
  requireValue(body.run_type === 'daily', 'run_type (Monthly is not implemented)');
  requireValue(isDate(body.as_of_date), 'as_of_date');
  // Frozen inputs, features, versions and predictions are owned by API/worker.
  return pick(body, ['store_id', 'run_type', 'as_of_date']);
}
export function prepareReview(body) {
  requireValue(body && typeof body === 'object', 'review');
  requireValue(['approve', 'modify', 'reject', 'resolve'].includes(body.decision), 'decision');
  requireValue(nonempty(body.reviewer_label) && body.reviewer_label.length <= 100, 'reviewer_label');
  requireValue(body.override_reason == null || typeof body.override_reason === 'string', 'override_reason');
  const reason = body.override_reason?.trim() || '';
  requireValue(reason.length <= 1000 && (body.decision === 'approve' || reason.length > 0), 'override_reason');
  const result = {decision: body.decision, reviewer_label: body.reviewer_label.trim(), override_reason: reason};
  if (body.decision === 'modify') {
    requireValue(Number.isSafeInteger(body.reviewer_order_quantity) && body.reviewer_order_quantity >= 0, 'reviewer_order_quantity');
    result.reviewer_order_quantity = body.reviewer_order_quantity;
  } else if (body.decision === 'reject') result.reviewer_order_quantity = 0;
  else if (body.decision === 'resolve') result.reviewer_order_quantity = null;
  // Approve asks the server to accept its persisted recommendation, not a client-supplied quantity.
  return result;
}
export function prepareFilters(kind, filters = {}) {
  const result = {store_id: store(filters.store_id)};
  if (kind === 'snapshots') {
    for (const key of ['product_id', 'from', 'to']) if (filters[key]) result[key] = filters[key];
    if (result.product_id) requireValue(nonempty(result.product_id), 'product_id');
    for (const key of ['from', 'to']) if (result[key]) requireValue(isDate(result[key]), key);
    requireValue(!result.from || !result.to || result.from <= result.to, 'from must not be after to');
  } else if (kind === 'exceptions') {
    if (filters.run_id) result.run_id = resourceId(filters.run_id);
    if (filters.status) {
      requireValue(['pending_review', 'approved', 'modified', 'rejected', 'resolved'].includes(filters.status), 'status');
      result.status = filters.status;
    }
  }
  return result;
}
