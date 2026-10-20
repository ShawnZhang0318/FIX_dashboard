import {config} from './config.js';
import {createMockApi} from './mock-api.js';
import {createLiveApi} from './live-api.js';
import {createApiGateway} from './api-gateway.js';
import {activityLog} from './activity-log.js';
export {ApiError} from './mock-api.js';
// Access storage lazily so a blocked browser store does not prevent app startup.
const storage={getItem:key=>globalThis.localStorage.getItem(key),setItem:(key,value)=>globalThis.localStorage.setItem(key,value),removeItem:key=>globalThis.localStorage.removeItem(key)};
const adapter=config.mode==='mock'?createMockApi({storage}):createLiveApi(config);
export const api=createApiGateway(adapter,{log:activityLog,mode:config.mode});
