import { createHttpClient } from './http-client.js';
import { ApiError } from './errors.js';
import { newRequestId } from './activity-log.js';

export const LOG_FILTERS = ['run_id', 'job_id', 'case_id', 'request_id', 'trace_id', 'level', 'service', 'stage', 'from', 'to', 'query'];
export function contract(ok, field) {
  if (!ok) {
    const error = new ApiError(`Backend log contract mismatch: ${field}.`, 502, 'CONTRACT_MISMATCH');
    error.field = field;
    throw error;
  }
}
const object = x => x !== null && typeof x === 'object' && !Array.isArray(x);
const text = x => typeof x === 'string' && x.trim().length > 0;
const date = x => typeof x === 'string' && /(?:Z|[+-]\d\d:\d\d)$/.test(x) && Number.isFinite(Date.parse(x));
const levels = ['DEBUG', 'INFO', 'WARNING', 'ERROR', 'CRITICAL'];

export function validateBackendLogPage(data, filters = {}) {
  contract(object(data), 'response');
  contract(Array.isArray(data.items), 'items');
  contract(Number.isSafeInteger(data.total) && data.total >= data.items.length, 'total');
  contract(text(data.snapshot_id), 'snapshot_id');
  contract(data.next_cursor === null || text(data.next_cursor), 'next_cursor');
  contract(data.order === 'desc', 'order');
  contract(date(data.generated_at), 'generated_at');
  if (filters.snapshot_id) contract(data.snapshot_id === filters.snapshot_id, 'snapshot_id changed during pagination');
  if (data.next_cursor !== null) contract(data.items.length > 0 && data.next_cursor !== filters.cursor, 'cursor did not advance');
  if (!filters.cursor && data.next_cursor === null) contract(data.items.length === data.total, 'first page count');
  if (filters.limit != null) contract(data.items.length <= filters.limit, 'page exceeds requested limit');
  contract(object(data.coverage) && ['complete', 'partial'].includes(data.coverage.status), 'coverage.status');
  contract(Array.isArray(data.coverage.services), 'coverage.services');
  contract(data.coverage.retained_from === null || date(data.coverage.retained_from), 'coverage.retained_from');
  for (const source of data.coverage.services) {
    contract(object(source) && text(source.name) && ['available', 'partial', 'unavailable'].includes(source.status), 'coverage.services');
    contract(source.message == null || typeof source.message === 'string', 'coverage.services.message');
  }
  if (data.coverage.status === 'complete') contract(data.coverage.services.length > 0 && data.coverage.services.every(x => x.status === 'available'), 'complete coverage requires available sources');
  const seen = new Set();
  let previous = Infinity;
  for (const [index, row] of data.items.entries()) {
    const p = `items[${index}]`;
    contract(object(row), p);
    for (const key of ['id', 'service', 'event', 'stage']) contract(text(row[key]), `${p}.${key}`);
    contract(typeof row.message === 'string', `${p}.message`);
    contract(date(row.timestamp), `${p}.timestamp`);
    if (filters.from) contract(Date.parse(row.timestamp) >= Date.parse(filters.from), `${p}.timestamp before filter`);
    if (filters.to) contract(Date.parse(row.timestamp) <= Date.parse(filters.to), `${p}.timestamp after filter`);
    contract(levels.includes(row.level), `${p}.level`);
    contract(Number.isSafeInteger(row.sequence) && row.sequence >= 0 && row.sequence < previous, `${p}.sequence`);
    contract(!seen.has(row.id), `${p}.id is duplicated`);
    seen.add(row.id); previous = row.sequence;
    for (const key of ['run_id', 'job_id', 'case_id', 'request_id', 'trace_id', 'product_id']) contract(row[key] == null || text(row[key]), `${p}.${key}`);
    for (const key of ['run_id', 'job_id', 'case_id', 'request_id', 'trace_id', 'level', 'service', 'stage']) if (filters[key]) contract(row[key] === filters[key], `${p}.${key} does not match filter`);
    contract(row.attempt == null || (Number.isSafeInteger(row.attempt) && row.attempt >= 1), `${p}.attempt`);
    contract(row.duration_ms == null || (Number.isFinite(row.duration_ms) && row.duration_ms >= 0), `${p}.duration_ms`);
    contract(row.context == null || object(row.context), `${p}.context`);
    if (row.error != null) {
      contract(object(row.error), `${p}.error`);
      for (const key of ['type', 'message', 'stack_trace']) contract(row.error[key] == null || typeof row.error[key] === 'string', `${p}.error.${key}`);
      contract(row.error.retryable == null || typeof row.error.retryable === 'boolean', `${p}.error.retryable`);
    }
  }
  return data;
}

export function appendBackendLogPage(current, page) {
  contract(current.snapshot_id === page.snapshot_id && current.total === page.total, 'snapshot changed during pagination');
  const ids = new Set(current.items.map(x => x.id));
  contract(page.items.every(x => !ids.has(x.id)), 'duplicate entries across pages');
  if (current.items.length && page.items.length) contract(page.items[0].sequence < current.items.at(-1).sequence, 'page order');
  const items = [...current.items, ...page.items];
  contract(items.length <= page.total && (page.next_cursor !== null || items.length === page.total), 'snapshot count');
  return {...page, items};
}

export function createBackendLogsApi({log, ...options}) {
  const request = createHttpClient(options);
  async function call(path, filters, {signal} = {}, exportFile = false) {
    const requestId = newRequestId(), start = Date.now();
    const meta = {mode: 'live', requestId, runId: filters.run_id, method: 'GET', endpoint: path, operation: exportFile ? 'exportBackendLogs' : 'getBackendLogs'};
    const record = row => { try { log?.append({...meta, ...row, durationMs: Date.now() - start}); } catch { /* Diagnostics cannot block log access. */ } };
    try {
      if (filters.cursor) contract(text(filters.snapshot_id), 'cursor requires snapshot_id');
      const allowed = [...LOG_FILTERS, 'snapshot_id', ...(exportFile ? [] : ['cursor', 'limit'])];
      const query = new URLSearchParams(allowed.filter(k => filters[k] != null && filters[k] !== '').map(k => [k, String(filters[k])]));
      const data = await request(`${path}?${query}`, {
        signal, requestId, responseType: exportFile ? 'ndjson' : 'json',
        onResponse: ({status, serverRequestId}) => {meta.httpStatus = status; meta.serverRequestId = serverRequestId;},
        validate: data => validateBackendLogPage(data, filters),
      });
      record({event: 'request.succeeded', level: 'info', recordCount: exportFile ? undefined : data.items.length});
      return data;
    } catch (error) {
      error.requestId = requestId;
      record({event: 'request.failed', level: error.code === 'CANCELLED' ? 'info' : 'error', errorCode: error.code, errorStatus: error.status, field: error.field});
      throw error;
    }
  }
  return {
    getLogs: (filters = {}, options) => call('/logs', {limit: 100, ...filters}, options),
    exportLogs: (filters = {}, options) => {contract(text(filters.snapshot_id), 'export requires snapshot_id'); return call('/logs/export', filters, options, true);},
  };
}
