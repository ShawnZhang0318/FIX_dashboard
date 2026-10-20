import test from 'node:test';
import assert from 'node:assert/strict';
import {createLiveApi} from '../live-api.js';
import {createHttpClient} from '../http-client.js';
import {createMockApi} from '../mock-api.js';

test('live adapter preserves prefix, encodes identities and strips mock-only inputs',async()=>{
 let saved;const mock=createMockApi({storage:{getItem:()=>saved,setItem:(k,v)=>saved=v},now:()=>0,uuid:()=> 'run'});
 await mock.createAnalysisRun({store_id:'S001',run_type:'daily',as_of_date:'2022-06-30'});
 const completed=createMockApi({storage:{getItem:()=>saved},now:()=>6000});
 const [sample]=await completed.getExceptions();
 const fixture=(id,review=false)=>({...sample,id,result:{...sample.result,case_id:id},...(review?{status:'rejected',reviewer_decision:'reject',reviewer_label:'Zhang',override_reason:'Checked',reviewed_at:new Date().toISOString(),reviewer_order_quantity:0}:{})});
 const calls=[];
 const api=createLiveApi({apiBaseUrl:'http://example.test/api/',fetchImpl:async(url,options)=>{
  calls.push({url,...options});
  const data=url.endsWith('/analysis-runs')?{analysis_run:{id:'run',status:'queued'},job:{id:'job-run',status:'pending'}}:url.includes('/inventory?')||url.includes('/exceptions?')?[]:url.endsWith('/review')?fixture('c1',true):fixture('run/one:case');
  return new Response(JSON.stringify(data),{status:url.endsWith('/analysis-runs')?202:200});
 }});
 await api.createAnalysisRun({store_id:'S001',run_type:'daily',as_of_date:'2022-06-30',scenario:'failure',extra:'not public'});
 assert.equal(calls[0].url,'http://example.test/api/analysis-runs');
 assert.deepEqual(JSON.parse(calls[0].body),{store_id:'S001',run_type:'daily',as_of_date:'2022-06-30'});
 await api.getException('run/one:case');assert.ok(calls[1].url.endsWith('/exceptions/run%2Fone%3Acase'));
 await api.getExceptions({run_id:'r & 1',status:'pending_review'});
 assert.equal(new URL(calls[2].url).searchParams.get('run_id'),'r & 1');
 await api.getInventory();assert.equal(calls[3].headers['Content-Type'],undefined);
 await api.submitReview('c1',{decision:'reject',override_reason:'Checked',reviewer_label:'Zhang'});
 assert.equal(calls[4].method,'POST');assert.equal(JSON.parse(calls[4].body).decision,'reject');
});

test('HTTP conflict and validation details survive; failed writes never auto-retry',async()=>{
 let count=0;
 const api=createLiveApi({fetchImpl:async()=>{count++;return new Response(JSON.stringify({detail:'Already reviewed'}),{status:409});}});
 await assert.rejects(api.submitReview('c',{decision:'approve',reviewer_label:'Zhou'}),e=>e.status===409&&e.message==='Already reviewed');assert.equal(count,1);
 const request=createHttpClient({fetchImpl:async()=>new Response(JSON.stringify({detail:[{loc:['body','date'],msg:'invalid'}]}),{status:422})});
 await assert.rejects(request('/test'),e=>e.status===422&&e.message.includes('invalid'));
});

test('wrong proxy response and incompatible list envelopes fail explicitly',async()=>{
 const request=createHttpClient({fetchImpl:async()=>new Response('<html>frontend</html>')});
 await assert.rejects(request('/inventory'),/non-JSON/);
 const api=createLiveApi({fetchImpl:async()=>new Response(JSON.stringify({items:[]}))});
 await assert.rejects(api.getInventory(),/Contract mismatch/);
});

test('timeout and caller cancellation reach the transport',async()=>{
 const fetchImpl=async(url,{signal})=>new Promise((resolve,reject)=>{
  const abort=()=>reject(new DOMException('Aborted','AbortError'));
  if(signal.aborted)abort();else signal.addEventListener('abort',abort,{once:true});
 });
 const request=createHttpClient({timeoutMs:10,fetchImpl});
 await assert.rejects(request('/write',{method:'POST',body:{}}),/may still have succeeded/);
 const controller=new AbortController();controller.abort();
 await assert.rejects(request('/read',{signal:controller.signal}),e=>e.status===0);
});
