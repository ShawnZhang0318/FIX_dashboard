import {ApiError} from './mock-api.js';
export function createHttpClient({apiBaseUrl='',timeoutMs=10000,fetchImpl=globalThis.fetch}={}){
 return async function request(path,{method='GET',body,signal}={}){
  const controller=new AbortController(),abort=()=>controller.abort();
  signal?.addEventListener('abort',abort,{once:true});if(signal?.aborted)abort();
  const timer=setTimeout(abort,timeoutMs);
  try{
   const response=await fetchImpl(apiBaseUrl.replace(/\/$/,'')+path,{method,signal:controller.signal,headers:body===undefined?{Accept:'application/json'}:{Accept:'application/json','Content-Type':'application/json'},body:body===undefined?undefined:JSON.stringify(body)});
   const text=await response.text();let data;
   try{data=text?JSON.parse(text):null;}catch{throw new ApiError('API returned non-JSON content. Check the API URL or proxy.',response.status);}
   if(!response.ok){const detail=data?.detail??data?.message;throw new ApiError(typeof detail==='string'?detail:JSON.stringify(detail||('HTTP '+response.status)),response.status);}
   return data;
  }catch(e){if(e instanceof ApiError)throw e;throw new ApiError(e.name==='AbortError'?'Request timed out or was cancelled. A submitted write may still have succeeded; check before retrying.':'Cannot reach the API. Check its address, service status and CORS configuration.',0);}
  finally{clearTimeout(timer);signal?.removeEventListener('abort',abort);}
 };
}
