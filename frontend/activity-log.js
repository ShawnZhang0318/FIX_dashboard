export const LOG_KEY = 'fix-dashboard-log-v1';
export const LOG_LIMIT = 300;
export const newRequestId = () => globalThis.crypto?.randomUUID?.() || `req-${Date.now()}-${Math.random().toString(36).slice(2)}`;
const textFields = ['id', 'timestamp', 'event', 'level', 'mode', 'operation', 'method', 'endpoint', 'requestId', 'serverRequestId', 'runId', 'jobId', 'caseId', 'status', 'errorCode', 'field'];
function clean(value) {
  const row = {};
  // Explicit allowlist: no body, response, headers, reviewer names or reasons.
  for (const key of textFields) if (typeof value[key] === 'string') row[key] = value[key].replace(/[\r\n\t]/g, ' ').slice(0, 200);
  for (const key of ['durationMs', 'httpStatus', 'errorStatus', 'recordCount']) if (Number.isFinite(value[key])) row[key] = value[key];
  if (value.writeUncertain === true) row.writeUncertain = true;
  return row;
}
export function createActivityLog({storage, now = () => Date.now(), uuid = newRequestId, limit = LOG_LIMIT} = {}) {
  let snapshot = {entries: [], persistent: !!storage, warning: ''};
  const listeners = new Set();
  function restore() {
    try {
      const raw = storage?.getItem(LOG_KEY);
      const entries = raw ? JSON.parse(raw) : [];
      if (!Array.isArray(entries) || entries.some(x => !x || typeof x.id !== 'string' || typeof x.event !== 'string' || !['info', 'error'].includes(x.level) || !['mock', 'live'].includes(x.mode) || !Number.isFinite(Date.parse(x.timestamp)))) throw Error('invalid logs');
      snapshot = {...snapshot, entries: entries.slice(0, limit).map(clean)};
    } catch {
      snapshot = {...snapshot, persistent: false, warning: 'Saved logs could not be read. New entries remain available in this tab.'};
    }
  }
  restore();
  function notify() { for (const fn of listeners) { try { fn(); } catch { /* Logging must not interrupt business operations. */ } } }
  function persist(entries) {
    snapshot = {...snapshot, entries};
    try {
      if (!storage) throw Error('no storage');
      storage.setItem(LOG_KEY, JSON.stringify(entries));
      snapshot = {...snapshot, persistent: true, warning: ''};
    } catch {
      snapshot = {...snapshot, persistent: false, warning: 'Logs are available only in this tab because browser storage is unavailable.'};
    }
    notify();
  }
  return {
    getSnapshot: () => snapshot,
    subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn); },
    append(event) {
      const row = clean({...event, id: uuid(), timestamp: new Date(now()).toISOString()});
      persist([row, ...snapshot.entries].slice(0, limit));
      return row;
    },
    clear() { persist([]); },
    refresh() { restore(); notify(); },
  };
}
let browserStorage;
try { browserStorage = globalThis.localStorage; } catch { /* Memory-only logging. */ }
export const activityLog = createActivityLog({storage: browserStorage});
globalThis.addEventListener?.('storage', event => {
  if (event.key === LOG_KEY || event.key === null) activityLog.refresh();
});
