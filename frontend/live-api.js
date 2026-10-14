import {createHttpClient} from './http-client.js';
import {ApiError} from './mock-api.js';
// Backend naming/envelope adaptations belong here, never inside pages.
export function createLiveApi(options){
 const request=createHttpClient(options),id=encodeURIComponent;
 const query=values=>new URLSearchParams(Object.entries(values).filter(([,v])=>v!==undefined&&v!==null&&v!=='')).toString();
 const list=async promise=>{const data=await promise;if(!Array.isArray(data))throw new ApiError('Contract mismatch: expected an array. See frontend-api-contract.md.',502);return data;};
 return {
 getInventory:({store_id='S001'}={})=>list(request('/inventory?'+query({store_id}))),
 createAnalysisRun:({store_id,run_type,as_of_date})=>request('/analysis-runs',{method:'POST',body:{store_id,run_type,as_of_date}}),
 getAnalysisRun:runId=>request('/analysis-runs/'+id(runId)),
 getAnalysisResults:runId=>request('/analysis-runs/'+id(runId)+'/results'),
 getExceptions:({run_id,status}={})=>list(request('/exceptions?'+query({run_id,status}))),
 getException:caseId=>request('/exceptions/'+id(caseId)),
 submitReview:(caseId,body)=>request('/exceptions/'+id(caseId)+'/review',{method:'POST',body})
 };
}
