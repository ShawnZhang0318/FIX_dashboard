import test from 'node:test';
import assert from 'node:assert/strict';
import {createBackendLogsApi, validateBackendLogPage, appendBackendLogPage} from '../backend-logs.js';
import {createActivityLog} from '../activity-log.js';

function record(sequence = 2) {
  return {id:`event-${sequence}`,sequence,timestamp:'2026-10-15T03:30:00.000Z',level:'ERROR',service:'worker',stage:'predicting',event:'model.request.failed',message:'Prediction failed\nDetailed backend explanation',run_id:'run / 1',job_id:'job-7',case_id:null,request_id:'req-1',trace_id:'trace-1',product_id:'P0001',attempt:2,duration_ms:20000,error:{type:'TimeoutError',message:'Model response exceeded deadline',stack_trace:'Traceback:\n  worker.py:10\nTimeoutError: model call',retryable:true},context:{model_version:'test-model',input_reference:'test-input'}};
}
function page(items = [record()], extra = {}) {
  return {items,total:items.length,next_cursor:null,snapshot_id:'snapshot-A',generated_at:'2026-10-15T03:31:00.000Z',order:'desc',coverage:{status:'partial',services:[{name:'worker',status:'available'},{name:'ai',status:'unavailable',message:'Collector offline'}],retained_from:'2026-10-01T00:00:00Z'},...extra};
}
test('backend log requests encode correlation filters and preserve full server detail',async()=>{
  const calls=[], log=createActivityLog();
  const api=createBackendLogsApi({apiBaseUrl:'https://logs.test/api',log,fetchImpl:async(url,options)=>{calls.push({url,options});return new Response(JSON.stringify(page()));}});
  const result=await api.getLogs({run_id:'run / 1',service:'worker',level:'ERROR',query:'failed & timeout',secret:'not-sent'});
  const url=new URL(calls[0].url);
  assert.equal(url.pathname,'/api/logs');assert.equal(url.searchParams.get('run_id'),'run / 1');assert.equal(url.searchParams.get('query'),'failed & timeout');assert.equal(url.searchParams.get('limit'),'100');assert.equal(url.searchParams.has('secret'),false);
  assert.equal(result.items[0].error.stack_trace,record().error.stack_trace);assert.equal(result.items[0].context.model_version,'test-model');
  assert.ok(!JSON.stringify(log.getSnapshot()).includes('Traceback'));
});
test('history pages keep one snapshot, stable ordering and complete counts',()=>{
  const first=page([record(3),record(2)],{total:3,next_cursor:'cursor-2'});
  const second=page([record(1)],{total:3});
  validateBackendLogPage(first);validateBackendLogPage(second,{cursor:'cursor-2',snapshot_id:'snapshot-A'});
  assert.deepEqual(appendBackendLogPage(first,second).items.map(x=>x.sequence),[3,2,1]);
  assert.throws(()=>appendBackendLogPage(first,page([record(2)],{total:3})),/duplicate/);
  assert.throws(()=>appendBackendLogPage(first,{...second,snapshot_id:'snapshot-B'}),/snapshot/);
  assert.throws(()=>appendBackendLogPage(first,page([],{total:3})),/count/);
});
test('malformed and misassociated backend logs fail at the boundary',()=>{
  const edits=[x=>delete x.items[0].message,x=>x.items[0].error.stack_trace={},x=>x.items[0].attempt=-1,x=>x.items[0].timestamp='2026-10-15 03:30:00',x=>x.coverage.status='complete',x=>x.next_cursor='same',x=>x.total=99];
  for(const edit of edits){const value=page();edit(value);assert.throws(()=>validateBackendLogPage(value,{cursor:edit===edits[5]?'same':undefined}),e=>e.code==='CONTRACT_MISMATCH');}
  assert.throws(()=>validateBackendLogPage(page(),{run_id:'wrong'}),/run_id/);
  assert.throws(()=>validateBackendLogPage(page(),{from:'2026-10-16T00:00:00Z'}),/timestamp/);
  assert.throws(()=>validateBackendLogPage(page(),{snapshot_id:'expired'}),/snapshot/);
  assert.throws(()=>validateBackendLogPage(page([record(1),record(2)])),/sequence/);
});
test('full export requests the server snapshot without a page limit',async()=>{
  let requested;const content=JSON.stringify(record())+'\n';
  const api=createBackendLogsApi({apiBaseUrl:'/api',fetchImpl:async(url)=>{requested=url;return new Response(content,{headers:{'Content-Type':'application/x-ndjson; charset=utf-8'}});}});
  const blob=await api.exportLogs({snapshot_id:'snapshot-A',run_id:'run / 1',limit:1,cursor:'cursor-2'});
  assert.equal(await blob.text(),content);
  const url=new URL(requested,'https://local.test');assert.equal(url.pathname,'/api/logs/export');assert.equal(url.searchParams.get('snapshot_id'),'snapshot-A');assert.equal(url.searchParams.get('run_id'),'run / 1');assert.equal(url.searchParams.has('limit'),false);assert.equal(url.searchParams.has('cursor'),false);
});
test('unavailable or unauthorized backend logs never fall back to browser data',async()=>{
  for(const status of [401,403,404,500]) {
    const api=createBackendLogsApi({fetchImpl:async()=>new Response('{"detail":"Backend unavailable"}',{status})});
    await assert.rejects(api.getLogs(),e=>e.status===status&&!!e.requestId);
  }
  const invalid=createBackendLogsApi({fetchImpl:async()=>new Response('<html>frontend</html>')});
  await assert.rejects(invalid.exportLogs({snapshot_id:'snapshot-A'}),e=>e.code==='CONTRACT_MISMATCH');
});
test('query cancellation reaches the log transport and emits only diagnostic metadata',async()=>{
  const controller=new AbortController(),log=createActivityLog();
  const api=createBackendLogsApi({log,fetchImpl:async(url,{signal})=>new Promise((resolve,reject)=>signal.addEventListener('abort',()=>reject(new DOMException('Aborted','AbortError')),{once:true}))});
  const pending=api.getLogs({}, {signal:controller.signal});controller.abort();
  await assert.rejects(pending,e=>e.code==='CANCELLED');assert.equal(log.getSnapshot().entries[0].level,'info');
});
