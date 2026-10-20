// Manual UI contract test only. No real worker/model execution is claimed.
// Build first, then: node frontend/tests/log-viewer-server.mjs
import http from 'node:http';
import {readFile} from 'node:fs/promises';
import {resolve, extname, sep} from 'node:path';
const root=resolve('dist'), port=5185;
const timestamp=new Date().toISOString();
const entries=[
  {id:'fixture-error',sequence:2,timestamp,level:'ERROR',service:'worker',stage:'predicting',event:'test.fixture.failure',message:'测试样例：模型超时。此记录仅用于界面验收，并非真实模型执行。',run_id:'contract-test-run',job_id:'test-job',trace_id:'test-trace',request_id:'test-request',attempt:2,duration_ms:20000,error:{type:'TestTimeoutError',message:'TEST FIXTURE ONLY',stack_trace:'Traceback (test fixture only):\n  contract_test.py:42\nTestTimeoutError: simulated response',retryable:true},context:{fixture:true,model_version:'test-fixture-not-a-model'}},
  {id:'fixture-start',sequence:1,timestamp,level:'INFO',service:'worker',stage:'started',event:'test.fixture.started',message:'测试样例：worker 开始处理；用于验证历史分页。',run_id:'contract-test-run',job_id:'test-job',trace_id:'test-trace',request_id:'test-request',attempt:1,context:{fixture:true}},
];
const filters=['run_id','job_id','case_id','request_id','trace_id','level','service','stage'];
http.createServer(async(req,res)=>{
  const url=new URL(req.url,'http://127.0.0.1');
  try {
    if(url.pathname==='/FIX_dashboard/runtime-config.js') {
      res.setHeader('Content-Type','text/javascript');res.end("globalThis.FIX_CONFIG={mode:'mock',apiBaseUrl:'/api',backendLogsBaseUrl:'/api',sendRequestId:false};");return;
    }
    if(url.pathname==='/api/logs'||url.pathname==='/api/logs/export') {
      const rows=entries.filter(row=>filters.every(key=>!url.searchParams.get(key)||row[key]===url.searchParams.get(key))&&(!url.searchParams.get('query')||JSON.stringify(row).includes(url.searchParams.get('query'))));
      if(url.pathname.endsWith('/export')) {res.setHeader('Content-Type','application/x-ndjson');res.end(rows.map(row=>JSON.stringify(row)).join('\n')+'\n');return;}
      const offset=url.searchParams.get('cursor')?Number(url.searchParams.get('cursor')):0;
      res.setHeader('Content-Type','application/json');res.end(JSON.stringify({items:rows.slice(offset,offset+1),total:rows.length,next_cursor:offset+1<rows.length?String(offset+1):null,snapshot_id:'test-fixture-snapshot',generated_at:timestamp,order:'desc',coverage:{status:'partial',services:[{name:'contract-test-fixtures',status:'partial',message:'TEST FIXTURE ONLY — no real backend or model is connected.'}],retained_from:timestamp}}));return;
    }
    const relative=decodeURIComponent(url.pathname.replace(/^\/FIX_dashboard\/?/,''))||'index.html';
    const path=resolve(root,relative);
    if(!path.startsWith(root+sep)) {res.writeHead(403);res.end();return;}
    const content=await readFile(path);
    res.setHeader('Content-Type',({'.html':'text/html','.js':'text/javascript','.css':'text/css','.svg':'image/svg+xml'})[extname(path)]||'application/octet-stream');res.end(content);
  } catch {res.writeHead(404);res.end('Not found');}
}).listen(port,'127.0.0.1',()=>process.stdout.write(`TEST FIXTURES ONLY http://127.0.0.1:${port}/FIX_dashboard/#/logs?run_id=contract-test-run\n`));
