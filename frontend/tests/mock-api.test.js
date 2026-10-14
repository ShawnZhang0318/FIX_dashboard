import test from 'node:test';
import assert from 'node:assert/strict';
import {createMockApi} from '../mock-api.js';
function setup(){let t=0,i=0;const m=new Map(),storage={getItem:k=>m.get(k),setItem:(k,v)=>m.set(k,v),removeItem:k=>m.delete(k)};return {storage,api:createMockApi({storage,now:()=>t,uuid:()=>`run-${++i}`}),tick:x=>t=x};}
const body={store_id:'S001',run_type:'daily',as_of_date:'2022-06-30'};
test('durable asynchronous run restores after adapter reload and keeps normal outputs',async()=>{
 const s=setup(),{analysis_run:r}=await s.api.createAnalysisRun(body);
 assert.equal((await s.api.getAnalysisRun(r.id)).status,'queued');s.tick(2000);assert.equal((await s.api.getAnalysisRun(r.id)).status,'processing');
 const reloaded=createMockApi({storage:s.storage,now:()=>6000});assert.equal((await reloaded.getAnalysisRun(r.id)).status,'completed');
 const data=await reloaded.getAnalysisResults(r.id);assert.equal(data.results.length,6);assert.equal(data.results.filter(x=>!x.case_id).length,3);
 assert.equal((await reloaded.getExceptions({run_id:r.id})).length,3);
});
test('review persists, rejects repeats, and never changes inventory',async()=>{
 const s=setup();const before=await s.api.getInventory();const {analysis_run:r}=await s.api.createAnalysisRun(body);s.tick(6000);
 const [c]=await s.api.getExceptions({run_id:r.id});
 await assert.rejects(s.api.submitReview(c.id,{decision:'modify',reviewer_order_quantity:-1,override_reason:'test',reviewer_label:'Zhou'}),e=>e.status===422);
 await s.api.submitReview(c.id,{decision:'modify',reviewer_order_quantity:120,override_reason:'Demo decision',reviewer_label:'Zhou'});
 const fresh=createMockApi({storage:s.storage,now:()=>6000});assert.equal((await fresh.getException(c.id)).reviewer_order_quantity,120);
 await assert.rejects(fresh.submitReview(c.id,{decision:'approve',reviewer_label:'Zhang'}),e=>e.status===409);
 assert.deepEqual(await fresh.getInventory(),before);
});
test('failed run exposes partial results and blocks review; empty run is successful',async()=>{
 const s=setup();const {analysis_run:r}=await s.api.createAnalysisRun({...body,scenario:'failure'});s.tick(6000);
 const data=await s.api.getAnalysisResults(r.id);assert.equal(data.partial,true);assert.equal(data.results.length,1);
 const [c]=await s.api.getExceptions({run_id:r.id});await assert.rejects(s.api.submitReview(c.id,{decision:'approve',reviewer_label:'Zhou'}),e=>e.status===409);
 const {analysis_run:empty}=await s.api.createAnalysisRun({...body,scenario:'empty'});s.tick(12000);assert.equal((await s.api.getAnalysisRun(empty.id)).status,'completed');assert.equal((await s.api.getAnalysisResults(empty.id)).results.length,0);
});
test('reject invalid requests, missing resources, and malformed storage',async()=>{
 const s=setup();for(const v of [{store_id:'S002'},{run_type:'monthly'},{as_of_date:'2022-07-01'},{scenario:'unknown'}])await assert.rejects(s.api.createAnalysisRun({...body,...v}),e=>e.status===422);
 await assert.rejects(s.api.getAnalysisRun('missing'),e=>e.status===404);
 s.storage.setItem('fix-demo-v1','broken');await assert.rejects(s.api.getExceptions(),/invalid/);
});
test('exception association isolates runs and anomaly resolution requires a note',async()=>{
 const s=setup();const {analysis_run:a}=await s.api.createAnalysisRun(body);const {analysis_run:b}=await s.api.createAnalysisRun(body);s.tick(6000);
 const cs=await s.api.getExceptions({run_id:a.id});assert.ok(cs.every(c=>c.analysis_run_id===a.id));assert.equal(cs.length,3);
 const anomaly=cs.find(c=>c.exception_type==='anomaly');await assert.rejects(s.api.submitReview(anomaly.id,{decision:'resolve',reviewer_label:'Zhou'}),e=>e.status===422);
 await s.api.submitReview(anomaly.id,{decision:'resolve',reviewer_label:'Zhou',override_reason:'Promotion reviewed'});
 assert.equal((await s.api.getExceptions({run_id:b.id,status:'pending_review'})).length,3);
});
