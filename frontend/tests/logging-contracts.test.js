import test from 'node:test';
import assert from 'node:assert/strict';
import {createActivityLog, LOG_KEY} from '../activity-log.js';
import {createApiGateway} from '../api-gateway.js';
import {createLiveApi} from '../live-api.js';
import {createMockApi} from '../mock-api.js';
import {validateResponse} from '../contracts.js';
const body={store_id:'S001',run_type:'daily',as_of_date:'2022-06-30'};
function setup() {
  let time=0,seq=0;
  const values=new Map();
  const storage={getItem:k=>values.get(k),setItem:(k,v)=>values.set(k,v),removeItem:k=>values.delete(k)};
  const log=createActivityLog({storage,now:()=>time,uuid:()=>`event-${++seq}`});
  const mock=createMockApi({storage,now:()=>time,uuid:()=>`run-${++seq}`});
  const api=createApiGateway(mock,{log,mode:'mock',now:()=>time,uuid:()=>`request-${++seq}`});
  return {api,mock,log,storage,tick:t=>time=t};
}
test('workflow logs retain correlation, deduplicate observed states, and exclude review content',async()=>{
  const s=setup();const {analysis_run:r}=await s.api.createAnalysisRun(body);
  await s.api.getAnalysisRun(r.id);s.tick(2000);await s.api.getAnalysisRun(r.id);await s.api.getAnalysisRun(r.id);
  s.tick(6000);await s.api.getAnalysisRun(r.id);await s.api.getAnalysisResults(r.id);
  const [c]=await s.api.getExceptions({run_id:r.id});
  await s.api.submitReview(c.id,{decision:'modify',reviewer_order_quantity:123,reviewer_label:'PRIVATE_NAME',override_reason:'PRIVATE_REASON'});
  const entries=s.log.getSnapshot().entries;
  assert.deepEqual(entries.filter(x=>x.event==='run.observed').map(x=>x.status),['completed','processing']);
  const review=entries.find(x=>x.event==='review.saved');
  assert.equal(review.runId,r.id);assert.equal(review.caseId,c.id);
  assert.ok(entries.some(x=>x.event==='request.succeeded'&&x.requestId===review.requestId));
  assert.ok(!JSON.stringify(entries).includes('PRIVATE_'));
  assert.equal((await s.api.getException(c.id)).reviewer_order_quantity,123);
  assert.equal(createActivityLog({storage:s.storage}).getSnapshot().entries.length,s.log.getSnapshot().entries.length);
});
test('log retention, sanitization, clear, and unavailable storage do not affect saved tasks',async()=>{
  const s=setup(),log=createActivityLog({storage:s.storage,limit:2});
  for(let i=0;i<3;i++)log.append({event:'request.succeeded',body:{token:'SECRET'},headers:{Authorization:'SECRET'},reviewer_label:'SECRET'});
  assert.equal(log.getSnapshot().entries.length,2);assert.ok(!s.storage.getItem(LOG_KEY).includes('SECRET'));
  log.clear();assert.deepEqual(JSON.parse(s.storage.getItem(LOG_KEY)),[]);
  const blocked=createActivityLog({storage:{getItem(){throw Error();},setItem(){throw Error();}}});
  const api=createApiGateway(s.mock,{log:blocked,mode:'mock'});
  const created=await api.createAnalysisRun(body);
  assert.ok(created.analysis_run.id);assert.equal(blocked.getSnapshot().persistent,false);
  assert.equal(blocked.getSnapshot().entries.length,2);
});
test('live boundary rejects missing nested result and reports correlated, redacted contract failure',async()=>{
  const s=setup();
  const live=createLiveApi({sendRequestId:true,fetchImpl:async(url,options)=>{
    assert.equal(options.headers['X-Request-ID'],'request-contract');
    return new Response(JSON.stringify({id:'case',analysis_run_id:'run',parent_run_status:'completed',status:'pending_review',exception_type:'reorder',private:'DO_NOT_LOG'}),{headers:{'X-Request-ID':'server-123'}});
  }});
  const api=createApiGateway(live,{log:s.log,mode:'live',uuid:()=> 'request-contract'});
  await assert.rejects(api.getException('case'),e=>e.code==='CONTRACT_MISMATCH'&&e.requestId==='request-contract'&&e.field==='case.result');
  const [entry]=s.log.getSnapshot().entries;
  assert.equal(entry.event,'request.failed');assert.equal(entry.httpStatus,200);assert.equal(entry.serverRequestId,'server-123');
  assert.ok(!JSON.stringify(entry).includes('DO_NOT_LOG'));
});
test('corrupted log records recover without breaking task reads or persistence',async()=>{
  const s=setup();
  s.storage.setItem(LOG_KEY,JSON.stringify([{id:'broken',timestamp:new Date().toISOString()}]));
  const recovered=createActivityLog({storage:s.storage});
  assert.equal(recovered.getSnapshot().entries.length,0);assert.ok(recovered.getSnapshot().warning);
  const api=createApiGateway(s.mock,{log:recovered,mode:'mock'});
  const {analysis_run:r}=await api.createAnalysisRun(body);
  assert.ok(recovered.getSnapshot().persistent);assert.equal(recovered.getSnapshot().warning,'');
  const brokenLog={append(){throw Error('disk');},getSnapshot(){throw Error('disk');}};
  const guarded=createApiGateway(s.mock,{log:brokenLog,mode:'mock'});
  assert.equal((await guarded.getAnalysisRun(r.id)).status,'queued');
});
test('DTO checks reject cross-run data, unsafe nested types, numeric strings and inconsistent quantiles',async()=>{
  const s=setup();const {analysis_run:r}=await s.api.createAnalysisRun(body);s.tick(6000);
  const data=await s.api.getAnalysisResults(r.id),[c]=await s.api.getExceptions({run_id:r.id});
  const copy=()=>structuredClone(c);
  for(const mutate of [x=>x.result=null,x=>x.result.analysis_run_id='wrong',x=>x.result.case_id='wrong',x=>x.result.product_id={},x=>x.result.predicted_demand_p90=-1,x=>x.result.predicted_demand_p50='240',x=>x.result.predicted_demand_p50=1000,x=>x.status='unknown']) {
    const broken=copy();mutate(broken);assert.throws(()=>validateResponse('getException',broken,[c.id]),e=>e.code==='CONTRACT_MISMATCH');
  }
  assert.throws(()=>validateResponse('getAnalysisResults',data,['another-run']),/analysis_run_id/);
  const point=structuredClone(data);point.results[0].forecast_mode='point_buffer';point.results[0].predicted_demand_point=100;point.results[0].uncertainty_buffer=null;
  assert.throws(()=>validateResponse('getAnalysisResults',point,[r.id]),/uncertainty_buffer/);
  point.results[0].uncertainty_buffer=20;point.results[0].predicted_demand_p50=null;point.results[0].predicted_demand_p90=null;
  assert.equal(validateResponse('getAnalysisResults',point,[r.id]),point);
  const inventory=await s.api.getInventory();inventory[0].name={bad:true};assert.throws(()=>validateResponse('getInventory',inventory,[{}]),/name/);
});
test('ambiguous write outcomes are marked and never automatically resubmitted',async()=>{
  const s=setup();let calls=0;
  const live=createLiveApi({timeoutMs:10,fetchImpl:async(url,{signal})=>{calls++;return new Promise((resolve,reject)=>signal.addEventListener('abort',()=>reject(new DOMException('Aborted','AbortError')),{once:true}));}});
  const api=createApiGateway(live,{log:s.log,mode:'live'});
  await assert.rejects(api.createAnalysisRun(body),e=>e.code==='TIMEOUT'&&e.writeUncertain&&!!e.requestId);
  assert.equal(calls,1);assert.equal(s.log.getSnapshot().entries[0].writeUncertain,true);
  const invalid=createLiveApi({fetchImpl:async()=>new Response('{}')});
  await assert.rejects(invalid.createAnalysisRun(body),e=>e.code==='CONTRACT_MISMATCH'&&e.writeUncertain);
  const rejected=createLiveApi({fetchImpl:async()=>new Response('{"detail":"invalid"}',{status:422})});
  await assert.rejects(rejected.createAnalysisRun(body),e=>e.status===422&&!e.writeUncertain);
});
test('request headers remain compatible by default; navigation can cancel live reads',async()=>{
  const s=setup();let calls=0;
  const live=createLiveApi({fetchImpl:async(url,options)=>{calls++;assert.equal(options.headers['X-Request-ID'],undefined);return new Response('[]');}});
  const api=createApiGateway(live,{log:s.log,mode:'live'});await api.getInventory();
  const controller=new AbortController();controller.abort();
  await assert.rejects(api.getInventory({}, {signal:controller.signal}),e=>e.code==='CANCELLED');assert.equal(calls,1);
  assert.equal(s.log.getSnapshot().entries[0].level,'info');
});
