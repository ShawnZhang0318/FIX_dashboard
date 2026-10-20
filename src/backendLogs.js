import { config } from '../frontend/config.js';
import { activityLog } from '../frontend/activity-log.js';
import { createBackendLogsApi } from '../frontend/backend-logs.js';

export const backendLogsBaseUrl = config.backendLogsBaseUrl ?? (config.mode === 'live' ? config.apiBaseUrl : null);
export const backendLogsApi = backendLogsBaseUrl === null ? null : createBackendLogsApi({
  apiBaseUrl: backendLogsBaseUrl, timeoutMs: config.timeoutMs,
  sendRequestId: config.sendRequestId, log: activityLog,
});
