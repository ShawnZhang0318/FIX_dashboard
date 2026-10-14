import {createReviewPages} from './pages/review-pages.js';
import {api} from './api.js';
import {config} from './config.js';
const root=document.querySelector('#app');
const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const n=v=>typeof v==='number'&&Number.isFinite(v)?v.toLocaleString('en-US'):'Not provided';
const pretty=s=>String(s||'unknown').replaceAll('_',' ');
const pill=s=>`<span class="pill ${esc(s)}">${esc(pretty(s))}</span>`;
let epoch=0,timer=null,currentView='analysis',pollSequence=0;
const loading=()=>'<div class="empty" role="status">Loading saved records…</div>';
const errorHtml=e=>`<div class="error" role="alert">${esc(e.message||e)}</div>`;
const heading=(eyebrow,title,subtitle)=>`<div class="page-heading"><div><div class="eyebrow">${eyebrow}</div><h1>${title}</h1><p class="lede">${subtitle}</p></div><span class="date-chip">S001 &nbsp; / &nbsp; Daily workspace</span></div>`;
const empty=(title,desc)=>`<div class="empty"><span class="empty-icon">↗</span><strong>${title}</strong>${desc}</div>`;
function navigate(view,extra={}){const u=new URL(location.href);u.search='';u.searchParams.set('view',view);for(const[k,v]of Object.entries(extra))if(v)u.searchParams.set(k,v);history.pushState({},'',u);render();}
document.addEventListener('click',e=>{const a=e.target.closest('[data-route]');if(!a)return;e.preventDefault();navigate(a.dataset.route,{run:a.dataset.run,case:a.dataset.case});});
document.querySelectorAll('[data-nav]').forEach(a=>a.addEventListener('click',e=>{e.preventDefault();navigate(a.dataset.nav);}));
window.addEventListener('popstate',render);
window.addEventListener('pagehide',()=>{epoch++;clearTimeout(timer);});
document.querySelector('#reset').addEventListener('click',async()=>{
 if(!confirm('Delete only F.I.X. demo runs and reviews saved in this browser?'))return;
 try{await api.reset();navigate('analysis');}catch(e){alert(e.message);}
});
if(config.mode!=='mock'){
 document.querySelector('#mode-label').textContent='LIVE API';document.querySelector('#reset').hidden=true;
 document.querySelector('#disclosure').textContent='LIVE API · Connected to the configured backend. Retail endpoints must implement the documented contract.';
}
const {inventoryPage,exceptionsPage}=createReviewPages({api,config,root,esc,n,pretty,pill,loading,errorHtml,heading,empty,navigate,isActive:token=>token===epoch});
async function render(){
 const token=++epoch;clearTimeout(timer);timer=null;
 const params=new URLSearchParams(location.search);currentView=params.get('view')||'analysis';if(!['analysis','inventory','exceptions'].includes(currentView))currentView='analysis';
 const labels={analysis:'Daily analysis',inventory:'Inventory',exceptions:'Exception review'};
 document.querySelector('#breadcrumb').textContent=labels[currentView];
 document.querySelectorAll('[data-nav]').forEach(a=>{a.classList.toggle('active',a.dataset.nav===currentView);if(a.dataset.nav===currentView)a.setAttribute('aria-current','page');else a.removeAttribute('aria-current');});
 try{if(currentView==='analysis')await analysis(params,token);else if(currentView==='inventory')await inventoryPage(token);else await exceptionsPage(params,token);}
 catch(e){if(epoch===token)root.insertAdjacentHTML('beforeend',errorHtml(e));}
}
async function analysis(params,token){
 root.innerHTML=heading('PLAN WITH CONFIDENCE','Daily analysis','Turn a daily inventory snapshot into a clear, reviewable replenishment decision.')+
 `<section class="card"><div class="card-head"><div><h2>Start an analysis</h2><p>One store. One cutoff date. A traceable result.</p></div><span class="pill">Daily workflow</span></div>
 <form id="run-form"><div class="form-grid"><label>STORE<input value="S001 · Demo store" disabled></label><label>SNAPSHOT DATE<input id="as-of" type="date" value="2022-06-30" required ${config.mode==='mock'?'min="2022-06-30" max="2022-06-30"':''}></label>
 ${config.mode==='mock'?'<label>DEMO SCENARIO<select id="scenario"><option value="success">Successful analysis</option><option value="failure">AI failure · partial results</option><option value="empty">No eligible products</option></select></label>':'<label>ANALYSIS TYPE<input value="Daily" disabled></label>'}
 <button class="primary" id="run-button" type="submit">Run Daily Analysis &nbsp; ↗</button></div><div class="form-foot">${config.mode==='mock'?'Demo date: 30 Jun 2022. Six synthetic products; scenario selection simulates server behavior.':'Select a date with complete historical data.'}</div></form></section><div id="create-error"></div><div id="run-panel"></div><div id="results"></div>`;
 document.querySelector('#run-form').addEventListener('submit',async e=>{
  e.preventDefault();if(token!==epoch)return;const button=document.querySelector('#run-button');button.disabled=true;button.textContent='Creating run…';document.querySelector('#create-error').innerHTML='';
  try{const response=await api.createAnalysisRun({store_id:'S001',run_type:'daily',as_of_date:document.querySelector('#as-of').value,scenario:document.querySelector('#scenario')?.value});
   if(token!==epoch)return;if(!response?.analysis_run?.id)throw Error('API did not return analysis_run.id.');navigate('analysis',{run:response.analysis_run.id});
  }catch(err){if(token!==epoch)return;document.querySelector('#create-error').innerHTML=errorHtml(err);button.disabled=false;button.textContent='Run Daily Analysis ↗';}
 });
 const id=params.get('run');
 if(!id){document.querySelector('#run-panel').innerHTML=`<section class="card">${empty('Your next decision starts here','Choose the demo scenario above, then run an analysis. Results will appear here.')}</section>`;return;}
 document.querySelector('#run-panel').innerHTML=loading();await poll(id,token);
}
async function poll(id,token){
 if(token!==epoch||currentView!=='analysis')return;
 const sequence=++pollSequence;
 try{
  const r=await api.getAnalysisRun(id);if(token!==epoch||sequence!==pollSequence)return;
  if(!['queued','processing','completed','failed'].includes(r.status))throw Error(`Unsupported run status: ${r.status}`);
  const running=['queued','processing'].includes(r.status);document.querySelector('#run-button').disabled=running;
  document.querySelector('#run-button').textContent=running?'Analysis in progress…':'Run Daily Analysis ↗';
  document.querySelector('#as-of').value=r.as_of_date;
  const scenarioSelect=document.querySelector('#scenario');if(scenarioSelect){if(r.scenario)scenarioSelect.value=r.scenario;scenarioSelect.disabled=running;}
  const rank=({queued:0,processing:1,completed:2,failed:1})[r.status];
  document.querySelector('#run-panel').innerHTML=`<section class="card"><div class="card-head"><h2>${running?'Analysis in progress':r.status==='failed'?'Analysis interrupted':'Analysis complete'}</h2><span role="status" aria-live="polite">${pill(r.status)}</span></div><div class="run-body"><div class="run-meta">Run ${esc(r.id)} · ${esc(r.store_id)} · ${esc(r.as_of_date)}</div><div class="steps">${['Queued','Processing','Completed'].map((s,i)=>`<div class="step ${i<=rank?'on':''}">${i+1}. ${s}</div>`).join('')}</div>${r.error?errorHtml(r.error):`<div class="mini">${running?'Status updates automatically. You can safely refresh this page.':`${n(r.processed_count)} products processed. Results are retrieved from ${config.mode==='mock'?'browser demo storage':'the API'}.`}</div>`}<button id="refresh-status" class="text-button mini" style="margin-top:12px">Refresh status</button></div></section>`;
  document.querySelector('#refresh-status').onclick=()=>{clearTimeout(timer);poll(id,token);};
  if(running){timer=setTimeout(()=>poll(id,token),config.pollMs);return;}
  document.querySelector('#results').innerHTML=loading();
  const data=await api.getAnalysisResults(id);if(token!==epoch||sequence!==pollSequence)return;
  if(!Array.isArray(data.results))throw Error('Expected results API response: { results: [], status, partial }.');
  renderResults(data,id);
 }catch(e){if(token!==epoch||sequence!==pollSequence)return;document.querySelector('#run-button').disabled=false;document.querySelector('#run-button').textContent='Run Daily Analysis ↗';
  document.querySelector('#run-panel').innerHTML=errorHtml(e)+'<button class="secondary" id="retry-status">Retry status / results</button><p class="mini">A connection error does not mean the background job failed.</p>';
  document.querySelector('#retry-status').onclick=()=>poll(id,token);
 }
}
function renderResults(data,id){
 const rows=data.results,orders=rows.filter(x=>x.recommended_order_quantity>0),count=rows.filter(x=>x.case_id).length;
 const total=rows.every(x=>Number.isFinite(x.recommended_order_quantity))?rows.reduce((s,x)=>s+x.recommended_order_quantity,0):null;
 document.querySelector('#results').innerHTML=`${data.partial?errorHtml('PARTIAL RESULTS — This run failed. The rows below are not a complete scan, and review is disabled.'):''}
 <div class="metrics"><div class="metric"><label>PRODUCTS ANALYZED${data.partial?' · PARTIAL':''}</label><strong>${rows.length}</strong><small>Snapshot-based results</small></div><div class="metric accent"><label>RECOMMENDED UNITS${data.partial?' · PARTIAL':''}</label><strong>${n(total)}</strong><small>Across ${orders.length} replenishment recommendations</small></div><div class="metric"><label>EXCEPTIONS TO INSPECT</label><strong>${count}</strong><small>Includes replenishment and anomalies</small></div></div>
 <section class="card"><div class="card-head"><div><h2>Forecast results</h2><p>Lead-time demand, snapshot inventory and recommended action.</p></div><a class="secondary" data-route="exceptions" data-run="${esc(id)}" href="?view=exceptions&run=${encodeURIComponent(id)}">View exceptions ↗</a></div>
 ${rows.length?`<div class="table-scroll"><table><thead><tr><th>Product</th><th>Snapshot stock</th><th>Horizon</th><th>Demand forecast</th><th>Safety stock</th><th>Order qty</th><th>Action</th></tr></thead><tbody>${rows.map(x=>`<tr><td><strong>${esc(x.product_id)}</strong><small>${esc(x.name||'')}</small></td><td>${n(x.inventory_at_prediction)}</td><td>${n(x.horizon_days)} days</td><td>${x.forecast_mode==='point_buffer'?`Point ${n(x.predicted_demand_point)}<br><small>Buffer ${n(x.uncertainty_buffer)}</small>`:`P50 ${n(x.predicted_demand_p50)}<br><small>P90 ${n(x.predicted_demand_p90)}</small>`}</td><td>${n(x.safety_stock)}</td><td class="order">${n(x.recommended_order_quantity)}</td><td>${x.case_id?`<a data-route="exceptions" data-case="${esc(x.case_id)}" data-run="${esc(id)}" href="?view=exceptions&case=${encodeURIComponent(x.case_id)}&run=${encodeURIComponent(id)}">Inspect ↗</a>`:'<span class="pill">Normal</span>'}</td></tr>`).join('')}</tbody></table></div>`:empty('No eligible products','The run completed successfully with zero selected products. This is not a service failure.')}
 <div class="table-note">Forecasts are advisory. An approval does not create a purchase order or increase stock.</div></section>
 ${rows.length?`<section class="card"><div class="detail"><h2>Result traceability</h2><p>Review the explanation and versions behind each decision.</p>${rows.map(x=>`<details><summary>${esc(x.product_id)} · ${esc(x.model_version)}</summary><p>${esc(x.explanation)}</p><p>Policy: ${esc(x.policy_version)}<br>Input reference: ${esc(x.input_reference)}</p></details>`).join('')}</div></section>`:''}`;
}
render();
