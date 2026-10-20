import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {once} from 'node:events';
import {createHash} from 'node:crypto';
import {createLiveApi} from '../live-api.js';
import {createMockApi} from '../mock-api.js';
import {createApiGateway} from '../api-gateway.js';
import {normalizeResponseIds, validateResponse, validateRunResults} from '../contracts.js';

const body = {store_id:'S001', run_type:'daily', as_of_date:'2022-06-30'};
const batch = snapshots => ({source_file_sha256:createHash('sha256').update(JSON.stringify(snapshots)).digest('hex'),snapshots});
async function fixtures() {
  let saved, time = 0;
  const mock = createMockApi({storage:{getItem:()=>saved, setItem:(key,value)=>saved=value}, now:()=>time, uuid:()=> '101'});
  await mock.createAnalysisRun(body); time = 6000;
  return {mock, run:await mock.getAnalysisRun('101'), results:await mock.getAnalysisResults('101'), cases:await mock.getExceptions(), snapshots:await mock.getSnapshots(), inventory:await mock.getInventory()};
}
const json = (data, status=200) => new Response(JSON.stringify(data), {status, headers:{'Content-Type':'application/json'}});

test('W04 numeric resource IDs are adapted without changing numerical prediction values', async()=>{
  const api = createLiveApi({fetchImpl:async()=>json({analysis_run:{id:101,status:'queued'},job:{id:501,status:'pending'}},202)});
  const created = await api.createAnalysisRun(body);
  assert.equal(created.analysis_run.id,'101'); assert.equal(created.job.id,'501');
  assert.deepEqual(normalizeResponseIds({id:42,snapshot_ids:[1,2],inventory_at_prediction:180}),{id:'42',snapshot_ids:['1','2'],inventory_at_prediction:180});
});
test('analysis requires asynchronous acceptance and canonical run/job state pairs', async()=>{
  for(const [status,run,job] of [[200,'queued','pending'],[202,'completed','completed'],[202,'queued','running']]) {
    const api = createLiveApi({fetchImpl:async()=>json({analysis_run:{id:1,status:run},job:{id:2,status:job}},status)});
    await assert.rejects(api.createAnalysisRun(body),e=>e.code==='CONTRACT_MISMATCH'&&e.writeUncertain);
  }
  const {run} = await fixtures();
  assert.throws(()=>validateResponse('getAnalysisRun',{...run,job:{id:'501',status:'claimed'}},['101']),/job.status/);
});
test('snapshot upload preserves signed benchmark and raw fields, strips derived/model fields, rejects invalid batches before HTTP', async()=>{
  const {snapshots} = await fixtures(), calls = [];
  const api = createLiveApi({fetchImpl:async(url,options)=>{calls.push({url,...options});return json({inserted_count:1,snapshot_ids:[42]},201);}});
  const row = {...snapshots[0],demand_forecast_benchmark:-9.99,discount_raw:20,model_version:'not-client-owned',predicted_demand_p90:123};
  const receipt = await api.ingestSnapshots({...batch([row]),features:[1,2],status:'completed'});
  assert.equal(receipt.snapshot_ids[0],'42');
  const transmitted = JSON.parse(calls[0].body);
  assert.equal(transmitted.snapshots[0].demand_forecast_benchmark,-9.99);
  assert.equal(transmitted.snapshots[0].discount_raw,20);
  assert.equal(transmitted.snapshots[0].model_version,undefined);
  assert.equal(transmitted.snapshots[0].id,undefined);
  assert.equal(transmitted.features,undefined);
  assert.equal(transmitted.source_file_sha256,batch([row]).source_file_sha256);
  for(const rows of [[],[row,row],Array.from({length:101},()=>row),[{...row,inventory_level:-1}],[{...row,store_id:'S002'}],[{...row,holiday_promotion:2}]]) {
    await assert.rejects(api.ingestSnapshots(batch(rows)),e=>e.code==='INVALID_REQUEST'&&!e.writeUncertain);
  }
  await assert.rejects(api.ingestSnapshots({snapshots:[row]}),/source_file_sha256/);
  assert.equal(calls.length,1);
});
test('atomic receipt, duplicates and invalid snapshot requests cannot become partial success or an automatic retry', async()=>{
  const {snapshots} = await fixtures();
  let calls=0;
  for(const response of [()=>json({inserted_count:0,snapshot_ids:[]},201),()=>json({detail:'Duplicate snapshot'},409),()=>json({detail:'Missing coverage'},422)]) {
    const api=createLiveApi({fetchImpl:async()=>{calls++;return response();}});
    await assert.rejects(api.ingestSnapshots(batch([snapshots[0]])),e=>e.code==='CONTRACT_MISMATCH'||[409,422].includes(e.status));
  }
  assert.equal(calls,3);
});
test('store/date filters reach the public API and mismatched snapshot, inventory and exception identities fail', async()=>{
  const {snapshots,inventory,cases}=await fixtures(), urls=[];
  const api=createLiveApi({apiBaseUrl:'https://public.test/api',fetchImpl:async(url)=>{
    urls.push(new URL(url));
    return json(url.includes('/snapshots?')?[snapshots[0]]:url.includes('/exceptions?')?[cases[0]]:inventory[0]);
  }});
  await api.getSnapshots({store_id:'S001',product_id:'P0001',from:'2022-06-30',to:'2022-06-30'});
  await api.getInventoryItem('S001','P0001');
  await api.getExceptions({store_id:'S001',run_id:'101',status:'pending_review'});
  assert.equal(urls[0].searchParams.get('from'),'2022-06-30');
  assert.equal(urls[1].pathname,'/api/inventory/S001/P0001');
  assert.equal(urls[2].searchParams.get('store_id'),'S001');
  await assert.rejects(api.getSnapshots({to:'2022-06-29'}),/snapshot_date/);
  await assert.rejects(api.getInventoryItem('S001','P0002'),/product_id/);
  await assert.rejects(api.getExceptions({store_id:'S002'}),/store_id/);
  assert.throws(()=>validateResponse('getExceptions',[{...cases[0],result:{...cases[0].result,store_id:'S002'}}],[{}]),/store_id/);
});
test('complete normal, combined and anomaly cases stay distinct; combined approval requires a note',async()=>{
  const {mock,cases,results}=await fixtures(),combined=cases.find(x=>x.exception_type==='reorder_and_anomaly');
  assert.equal(results.results.filter(x=>!x.case_id).length,3);
  assert.ok(combined);
  validateResponse('getExceptions',cases,[{store_id:'S001'}]);
  await assert.rejects(mock.submitReview(combined.id,{decision:'approve',reviewer_label:'Zhou'}),/note/);
  const saved=await mock.submitReview(combined.id,{decision:'approve',reviewer_label:'Zhou',override_reason:'Anomaly checked; replenishment accepted'});
  validateResponse('submitReview',saved,[combined.id,{decision:'approve',reviewer_label:'Zhou',override_reason:'Anomaly checked; replenishment accepted'}]);
});
test('review transmission uses server quantity for approve, zero for reject, null for resolve and explicit quantity only for modify',async()=>{
  const {cases}=await fixtures();
  for(const decision of ['approve','modify','reject','resolve']) {
    const c=cases.find(x=>x.exception_type===(decision==='resolve'?'anomaly':'reorder'));
    let sent;
    const api=createLiveApi({fetchImpl:async(url,options)=>{
      sent=JSON.parse(options.body);
      return json({...c,status:({approve:'approved',modify:'modified',reject:'rejected',resolve:'resolved'})[decision],
        reviewer_decision:decision,reviewer_label:'Zhou',override_reason:'Checked',reviewed_at:new Date().toISOString(),
        reviewer_order_quantity:decision==='approve'?c.result.recommended_order_quantity:decision==='modify'?77:decision==='reject'?0:null});
    }});
    await api.submitReview(c.id,{decision,reviewer_label:'Zhou',override_reason:'Checked',reviewer_order_quantity:77,on_hand_quantity:999,status:'approved'});
    assert.equal(sent.reviewer_order_quantity,decision==='approve'?undefined:decision==='modify'?77:decision==='reject'?0:null);
    assert.equal(sent.on_hand_quantity,undefined);assert.equal(sent.status,undefined);
  }
});
test('missing predictions/provenance and inconsistent result counts fail, while failed empty output remains failed',async()=>{
  const {results,run}=await fixtures();
  for(const change of [x=>x.predicted_demand_p50=null,x=>x.snapshot_id=null,x=>x.store_id='S002',x=>x.forecast_mode='point_buffer']) {
    const broken=structuredClone(results);change(broken.results[0]);
    assert.throws(()=>validateResponse('getAnalysisResults',broken,['101']),e=>e.code==='CONTRACT_MISMATCH');
  }
  assert.throws(()=>validateRunResults(run,{...results,status:'processing'}),/run_state/);
  assert.throws(()=>validateRunResults(run,{...results,results:results.results.slice(0,1)}),/processed_count/);
  const failed={status:'failed',partial:false,results:[]};
  assert.equal(validateResponse('getAnalysisResults',failed,['101']).status,'failed');
});
test('old saved demo runs keep their original case classification and review records',async()=>{
  const saved=JSON.stringify({runs:{old:{id:'old',store_id:'S001',as_of_date:'2022-06-30',scenario:'success',created_ms:0}},
    reviews:{'old:2':{status:'approved',reviewer_decision:'approve',reviewer_order_quantity:135,reviewer_label:'Zhang',override_reason:'',reviewed_at:new Date(6000).toISOString()}}});
  const mock=createMockApi({storage:{getItem:()=>saved},now:()=>6000});
  const c=await mock.getException('old:2');
  assert.equal(c.exception_type,'reorder');validateResponse('getException',c,['old:2']);
});
test('real HTTP transport follows snapshot → public API → run/status/results → review without private service calls',async(t)=>{
  // A controlled HTTP fixture, not an implementation of PostgreSQL, worker or AI.
  const f=await fixtures(), requests=[];let reads=0,reviewed;
  const server=createServer(async(req,res)=>{
    let raw='';for await(const chunk of req)raw+=chunk;
    const path=new URL(req.url,'http://localhost');
    const input=raw?JSON.parse(raw):undefined;requests.push({method:req.method,path:path.pathname,input});
    let output, status=200;
    if(req.method==='POST'&&path.pathname==='/snapshots'){status=201;output={inserted_count:1,snapshot_ids:[1]};}
    else if(path.pathname==='/snapshots') output=[f.snapshots[0]];
    else if(path.pathname==='/inventory') output=f.inventory;
    else if(path.pathname==='/analysis-runs'){status=202;output={analysis_run:{id:101,status:'queued'},job:{id:501,status:'pending'}};}
    else if(path.pathname==='/analysis-runs/101') {
      output=++reads===1?{...f.run,id:101,status:'queued',processed_count:0,completed_at:null,job:{id:501,status:'pending'}}:{...f.run,id:101,job:{id:501,status:'completed'}};
    }
    else if(path.pathname==='/analysis-runs/101/results')output=f.results;
    else if(path.pathname==='/exceptions')output=f.cases;
    else if(path.pathname==='/exceptions/101%3A0/review'){
      reviewed={...f.cases[0],status:'modified',reviewer_decision:'modify',reviewer_order_quantity:input.reviewer_order_quantity,
        reviewer_label:input.reviewer_label,override_reason:input.override_reason,reviewed_at:new Date().toISOString()};
      output=reviewed;
    } else if(path.pathname==='/exceptions/101%3A0')output=reviewed||f.cases[0];
    else {status=404;output={detail:'Unexpected route'};}
    res.writeHead(status,{'Content-Type':'application/json'});res.end(JSON.stringify(output));
  });
  server.listen(0,'127.0.0.1');await once(server,'listening');
  t.after(()=>{server.closeAllConnections();return new Promise(resolve=>server.close(resolve));});
  const log={append(){},getSnapshot:()=>({entries:[]})};
  const api=createApiGateway(createLiveApi({apiBaseUrl:`http://127.0.0.1:${server.address().port}`}),{mode:'live',log});
  await api.ingestSnapshots(batch([f.snapshots[0]]));
  const inventory=await api.getInventory();
  const created=await api.createAnalysisRun({...body,features:['forbidden'],scenario:'failure'});
  assert.equal(created.job.id,'501');
  assert.equal((await api.getAnalysisRun(created.analysis_run.id)).status,'queued');
  const run=await api.getAnalysisRun('101'),results=await api.getAnalysisResults('101');validateRunResults(run,results);
  const [c]=await api.getExceptions({store_id:'S001',run_id:'101'});
  await api.getException(c.id);
  await api.submitReview(c.id,{decision:'modify',reviewer_order_quantity:88,reviewer_label:'Zhou',override_reason:'HTTP handoff check'});
  assert.equal((await api.getException(c.id)).reviewer_order_quantity,88);
  assert.deepEqual(await api.getInventory(),inventory);
  assert.equal((await api.getSnapshots({product_id:'P0001'})).length,1);
  assert.deepEqual(requests.find(x=>x.path==='/analysis-runs').input,body);
  assert.ok(requests.every(x=>!/(analyze|worker|database|purchase|train)/.test(x.path)));
  assert.deepEqual(requests.filter(x=>x.method==='POST').map(x=>x.path),['/snapshots','/analysis-runs','/exceptions/101%3A0/review']);
});
