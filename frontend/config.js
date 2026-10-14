const overrides=globalThis.FIX_CONFIG||{};
export const config=Object.freeze({mode:'mock',apiBaseUrl:'http://localhost:8000',pollMs:1500,timeoutMs:10000,...overrides});
if(!['mock','live'].includes(config.mode))throw new Error('FIX_CONFIG.mode must be mock or live.');
for(const key of ['pollMs','timeoutMs'])if(!Number.isFinite(config[key])||config[key]<100)throw new Error('Invalid FIX_CONFIG.'+key);
if(typeof config.apiBaseUrl!=='string')throw new Error('apiBaseUrl must be a string.');
