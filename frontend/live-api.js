import { createHttpClient } from './http-client.js';
import { normalizeResponseIds, validateResponse } from './contracts.js';
import { prepareFilters, prepareReview, prepareRun, prepareSnapshotBatch, resourceId } from './requests.js';

// Route and envelope adaptations belong here, never inside individual pages.
export function createLiveApi(options) {
  const request = createHttpClient(options), id = value => encodeURIComponent(resourceId(value));
  const query = values => new URLSearchParams(values).toString();
  const read = (operation, args, path, context, extra = {}) => request(path, {
    ...context, ...extra, validate: data => validateResponse(operation, normalizeResponseIds(data), args),
  });
  return {
    async ingestSnapshots(body, context) {
      const payload = prepareSnapshotBatch(body);
      return read('ingestSnapshots', [payload], '/snapshots', context, {method: 'POST', body: payload, expectedStatus: [200,201]});
    },
    async getSnapshots(filters = {}, context) {
      const selected = prepareFilters('snapshots', filters);
      return read('getSnapshots', [selected], '/snapshots?' + query(selected), context);
    },
    async getInventory(filters = {}, context) {
      const selected = prepareFilters('inventory', filters);
      return read('getInventory', [selected], '/inventory?' + query(selected), context);
    },
    async getInventoryItem(storeId, productId, context) {
      prepareFilters('inventory', {store_id: storeId});
      return read('getInventoryItem', [storeId, String(productId)], `/inventory/${id(storeId)}/${id(productId)}`, context);
    },
    async createAnalysisRun(body, context) {
      const payload = prepareRun(body);
      return read('createAnalysisRun', [payload], '/analysis-runs', context, {method: 'POST', body: payload, expectedStatus: 202});
    },
    getAnalysisRun: (runId, context) => read('getAnalysisRun', [resourceId(runId)], '/analysis-runs/' + id(runId), context),
    getAnalysisResults: (runId, context) => read('getAnalysisResults', [resourceId(runId)], '/analysis-runs/' + id(runId) + '/results', context),
    async getExceptions(filters = {}, context) {
      const selected = prepareFilters('exceptions', filters);
      return read('getExceptions', [selected], '/exceptions?' + query(selected), context);
    },
    getException: (caseId, context) => read('getException', [resourceId(caseId)], '/exceptions/' + id(caseId), context),
    async submitReview(caseId, body, context) {
      const payload = prepareReview(body);
      return read('submitReview', [resourceId(caseId), payload], '/exceptions/' + id(caseId) + '/review', context, {method: 'POST', body: payload});
    },
  };
}
