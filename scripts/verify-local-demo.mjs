// Run against the explicitly local, running integration stack after CSV import.
// Creates a genuine analysis and an advisory test review; never mutates stock.
import assert from 'node:assert/strict';
import {writeFile, mkdir} from 'node:fs/promises';
import {createLiveApi} from '../frontend/live-api.js';
import {createBackendLogsApi, appendBackendLogPage} from '../frontend/backend-logs.js';
import {validateRunResults} from '../frontend/contracts.js';

const options = {apiBaseUrl:'http://127.0.0.1:8000',sendRequestId:true,timeoutMs:10000};
const api = createLiveApi(options), logsApi = createBackendLogsApi(options);
const before = await api.getInventory();
assert.equal(before.length,20);
const created = await api.createAnalysisRun({store_id:'S001',run_type:'daily',as_of_date:'2023-11-15'});
const runId = created.analysis_run.id;
let run;
for (let n=0;n<300;n++) {
  run = await api.getAnalysisRun(runId);
  if (['completed','failed'].includes(run.status)) break;
  await new Promise(resolve=>setTimeout(resolve,200));
}
assert.equal(run.status,'completed',run.error || 'Worker did not complete within 60 seconds');
const results = validateRunResults(run,await api.getAnalysisResults(runId));
assert.equal(results.results.length,20);
const first = results.results.find(x=>x.product_id==='P0001');
assert.ok(Math.abs(first.predicted_demand_p50-424.03519375145015)<1e-5);
assert.ok(Math.abs(first.predicted_demand_p90-648.0340855078196)<1e-5);
assert.equal(first.inventory_at_prediction,82);
assert.equal(first.recommended_order_quantity,567);
const snapshot = await api.getSnapshots({product_id:'P0001',from:'2023-11-15',to:'2023-11-15'});
assert.equal(snapshot.length,1);
assert.equal(snapshot[0].id,first.snapshot_id);
const cases = await api.getExceptions({run_id:runId,status:'pending_review'});
const selected = cases.find(x=>x.id===first.case_id);
const reviewed = await api.submitReview(selected.id,{
  decision:'approve',reviewer_label:'Local integration acceptance',
  override_reason:'Verified actual forecast, source snapshot and persistent advisory review.',
});
assert.equal(reviewed.status,'approved');
assert.equal((await api.getException(selected.id)).status,'approved');
assert.deepEqual(await api.getInventory(),before);
let logs = await logsApi.getLogs({run_id:runId,job_id:run.job.id,limit:25});
const snapshotId=logs.snapshot_id;
while (logs.next_cursor) {
  logs = appendBackendLogPage(logs,await logsApi.getLogs({
    run_id:runId,job_id:run.job.id,limit:25,snapshot_id:snapshotId,cursor:logs.next_cursor,
  }));
}
assert.equal(logs.items.length,logs.total);
assert.deepEqual([...new Set(logs.items.map(x=>x.service))].sort(),['ai','api','worker']);
assert.equal(logs.items.filter(x=>x.event==='model.forecast_completed').length,20);
assert.ok(logs.items.some(x=>x.event==='review.committed'));
assert.ok(logs.items.filter(x=>x.service==='ai').every(x=>x.trace_id===runId));
const exported = await logsApi.exportLogs({run_id:runId,job_id:run.job.id,snapshot_id:snapshotId});
const lines=(await exported.text()).trim().split('\n').map(JSON.parse);
assert.deepEqual(lines.map(x=>x.id),logs.items.map(x=>x.id));
await mkdir('.local-integration',{recursive:true});
await writeFile('.local-integration/verification.json',JSON.stringify({verified_at:new Date().toISOString(),run,results,review:reviewed,logs},null,2));
console.log(JSON.stringify({run_id:runId,processed:run.processed_count,model:first.model_version,
  p50:first.predicted_demand_p50,p90:first.predicted_demand_p90,review:reviewed.status,
  logs:logs.total,coverage:logs.coverage.status,inventory_unchanged:true},null,2));
