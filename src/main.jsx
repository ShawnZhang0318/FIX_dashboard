// Load deployment configuration before any module constructs the API adapter.
// A missing configuration must not silently select mock data on a live site.
async function start() {
  await import(/* @vite-ignore */ `${import.meta.env.BASE_URL}runtime-config.js`);
  const settings = globalThis.FIX_CONFIG;
  if (!settings || !['mock', 'live'].includes(settings.mode) || typeof settings.apiBaseUrl !== 'string') throw Error('Invalid FIX_CONFIG');

  // Railway builds the static frontend with this public API URL. Keep local
  // integration settings from runtime-config.js authoritative on loopback.
  const hostedApiUrl = import.meta.env.VITE_FIX_API_URL?.trim();
  if (hostedApiUrl && !settings.localIntegration) {
    settings.mode = 'live';
    settings.apiBaseUrl = hostedApiUrl.replace(/\/+$/, '');
    settings.sendRequestId = true;
    settings.backendLogsBaseUrl = null;
  }

  await import('./bootstrap.jsx');
}
start().catch(() => {
  const message = document.createElement('p');
  message.setAttribute('role', 'alert');
  message.textContent = 'Dashboard could not start. Check runtime-config.js and reload. / 无法启动，请检查 runtime-config.js 配置并刷新。';
  document.getElementById('root').replaceChildren(message);
});
