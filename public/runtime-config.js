// Public browser config. Never put passwords or model API keys here.
// Live backend: mode: 'live', apiBaseUrl: 'http://localhost:8000'
// Same-origin proxy: apiBaseUrl: '/api'. No automatic mock fallback.
// Set sendRequestId:true only after the backend allows/exposes X-Request-ID.
// Backend logs: null uses apiBaseUrl in live mode, or shows "not connected" in mock mode.
// Set an explicit URL (or '/api') to connect real backend logs independently.
// The local integration is selected only on loopback. Static hosting keeps the
// existing mock demo until the team configures a hosted public API.
const localIntegration = ['127.0.0.1', 'localhost'].includes(globalThis.location?.hostname);
globalThis.FIX_CONFIG=localIntegration
  ? {mode:'live',apiBaseUrl:'http://127.0.0.1:8000',sendRequestId:true,backendLogsBaseUrl:null,
     localIntegration:true,defaultAnalysisDate:'2023-11-15',minimumAnalysisDate:'2023-09-01'}
  : {mode:'mock',apiBaseUrl:'http://localhost:8000',sendRequestId:false,backendLogsBaseUrl:null};
