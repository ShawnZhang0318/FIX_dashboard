import { ApiError } from './errors.js';

export function createHttpClient({apiBaseUrl = '', timeoutMs = 10000, fetchImpl = globalThis.fetch, sendRequestId = false} = {}) {
  return async function request(path, {method = 'GET', body, signal, requestId, onResponse, validate, responseType = 'json', expectedStatus} = {}) {
    const controller = new AbortController();
    let timedOut = false, responseStatus;
    const abort = () => controller.abort();
    signal?.addEventListener('abort', abort, {once: true});
    if (signal?.aborted) abort();
    const timer = setTimeout(() => { timedOut = true; abort(); }, timeoutMs);
    try {
      const headers = {Accept: 'application/json'};
      if (body !== undefined) headers['Content-Type'] = 'application/json';
      // Opt-in: the backend must allow X-Request-ID through its CORS policy.
      if (sendRequestId && requestId) headers['X-Request-ID'] = requestId;
      const response = await fetchImpl(apiBaseUrl.replace(/\/$/, '') + path, {
        method, signal: controller.signal, headers,
        body: body === undefined ? undefined : JSON.stringify(body),
      });
      responseStatus = response.status;
      onResponse?.({status: response.status, serverRequestId: response.headers.get('X-Request-ID')});
      if (response.ok && responseType === 'ndjson') {
        if (!response.headers.get('Content-Type')?.toLowerCase().startsWith('application/x-ndjson')) throw new ApiError('Log export must return application/x-ndjson.', 502, 'CONTRACT_MISMATCH');
        return await response.blob();
      }
      const raw = await response.text();
      let data;
      try { data = raw ? JSON.parse(raw) : null; }
      catch { throw new ApiError('API returned non-JSON content. Check the API URL or proxy.', response.status, 'INVALID_JSON'); }
      if (!response.ok) {
        const detail = data?.detail ?? data?.message;
        throw new ApiError(typeof detail === 'string' ? detail : JSON.stringify(detail || `HTTP ${response.status}`), response.status, 'HTTP_ERROR');
      }
      if (expectedStatus !== undefined && !(Array.isArray(expectedStatus) ? expectedStatus : [expectedStatus]).includes(response.status))
        throw new ApiError(`Expected HTTP ${expectedStatus}, received ${response.status}.`, 502, 'CONTRACT_MISMATCH');
      return validate ? validate(data) : data;
    } catch (cause) {
      const error = cause instanceof ApiError ? cause : new ApiError(
        timedOut ? 'Request timed out. A submitted write may still have succeeded; check before retrying.' :
          signal?.aborted ? 'Request was cancelled.' : 'Cannot reach the API. Check its address, service status and CORS configuration.',
        0, timedOut ? 'TIMEOUT' : signal?.aborted ? 'CANCELLED' : 'NETWORK_ERROR',
      );
      error.requestId = requestId;
      error.httpStatus = responseStatus;
      error.writeUncertain = method !== 'GET' && method !== 'HEAD' &&
        (responseStatus == null || responseStatus >= 500 || (responseStatus >= 200 && responseStatus < 300));
      throw error;
    } finally {
      clearTimeout(timer);
      signal?.removeEventListener('abort', abort);
    }
  };
}
