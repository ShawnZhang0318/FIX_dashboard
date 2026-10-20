import { ApiError } from './errors.js';
import { validateResponse } from './contracts.js';
import { newRequestId } from './activity-log.js';

const endpoints = {
  ingestSnapshots: ['POST', '/snapshots'],
  getSnapshots: ['GET', '/snapshots'],
  getInventoryItem: ['GET', '/inventory/:store_id/:product_id'],
  getInventory: ['GET', '/inventory'],
  createAnalysisRun: ['POST', '/analysis-runs'],
  getAnalysisRun: ['GET', '/analysis-runs/:id'],
  getAnalysisResults: ['GET', '/analysis-runs/:id/results'],
  getExceptions: ['GET', '/exceptions'],
  getException: ['GET', '/exceptions/:id'],
  submitReview: ['POST', '/exceptions/:id/review'],
  reset: ['LOCAL', 'demo/reset'],
};
export function createApiGateway(adapter, {log, mode, now = () => Date.now(), uuid = newRequestId}) {
  const record = row => { try { log.append(row); } catch { /* A saved write must not become a failure because logging failed. */ } };
  async function call(operation, args, options = {}) {
    const start = now(), requestId = uuid(), [method, endpoint] = endpoints[operation];
    const meta = {mode, operation, method, endpoint, requestId};
    if (['getAnalysisRun', 'getAnalysisResults'].includes(operation)) meta.runId = args[0];
    if (operation === 'getExceptions') meta.runId = args[0]?.run_id;
    if (['getException', 'submitReview'].includes(operation)) meta.caseId = args[0];
    const context = {...options, requestId, onResponse: response => {
      meta.httpStatus = response.status;
      meta.serverRequestId = response.serverRequestId;
    }};
    try {
      if (options.signal?.aborted) throw new ApiError('Request was cancelled.', 0, 'CANCELLED');
      const data = await adapter[operation](...args, context);
      // Live validation happens inside the transport so ambiguous writes retain
      // their HTTP status. Validate synthetic fixtures at this boundary too.
      if (mode === 'mock') validateResponse(operation, data, args);
      if (data?.analysis_run?.id) meta.runId = data.analysis_run.id;
      if (data?.analysis_run_id) meta.runId = data.analysis_run_id;
      if (data?.job?.id) meta.jobId = data.job.id;
      const count = Array.isArray(data) ? data.length : Array.isArray(data?.results) ? data.results.length : undefined;
      record({...meta, event: 'request.succeeded', level: 'info', durationMs: Math.max(0, now() - start), recordCount: count});
      if (operation === 'createAnalysisRun') record({...meta, event: 'analysis.created', level: 'info', status: data.analysis_run.status});
      if (operation === 'getAnalysisRun') {
        let previous;
        try { previous = log.getSnapshot().entries.find(x => x.mode === mode && x.runId === data.id && ['analysis.created', 'run.observed'].includes(x.event)); } catch { /* Logging is best-effort. */ }
        if (previous?.status !== data.status) record({...meta, event: 'run.observed', level: data.status === 'failed' ? 'error' : 'info', status: data.status});
      }
      if (operation === 'submitReview') record({...meta, event: 'review.saved', level: 'info', status: data.status});
      if (operation === 'reset') record({...meta, event: 'demo.reset', level: 'info'});
      return data;
    } catch (cause) {
      const error = cause instanceof ApiError ? cause : new ApiError('The request could not be completed.', 0, 'CLIENT_ERROR');
      error.requestId = requestId;
      record({...meta, event: 'request.failed', level: error.code === 'CANCELLED' ? 'info' : 'error', durationMs: Math.max(0, now() - start), errorCode: error.code, errorStatus: error.status, field: error.field, writeUncertain: error.writeUncertain});
      throw error;
    }
  }
  const api = {
    ingestSnapshots: (body, options) => call('ingestSnapshots', [body], options),
    getSnapshots: (filters = {}, options) => call('getSnapshots', [filters], options),
    getInventoryItem: (storeId, productId, options) => call('getInventoryItem', [storeId, productId], options),
    getInventory: (filters = {}, options) => call('getInventory', [filters], options),
    createAnalysisRun: (body, options) => call('createAnalysisRun', [body], options),
    getAnalysisRun: (id, options) => call('getAnalysisRun', [id], options),
    getAnalysisResults: (id, options) => call('getAnalysisResults', [id], options),
    getExceptions: (filters = {}, options) => call('getExceptions', [filters], options),
    getException: (id, options) => call('getException', [id], options),
    submitReview: (id, body, options) => call('submitReview', [id, body], options),
  };
  if (adapter.reset) api.reset = () => call('reset', []);
  return api;
}
