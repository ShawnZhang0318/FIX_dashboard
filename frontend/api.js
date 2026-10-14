import {config} from './config.js';
import {createMockApi} from './mock-api.js';
import {createLiveApi} from './live-api.js';
export {ApiError} from './mock-api.js';
export const api=config.mode==='mock'?createMockApi({storage:localStorage}):createLiveApi(config);
