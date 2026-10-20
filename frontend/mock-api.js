import {ApiError} from './errors.js';
import {prepareFilters, prepareReview, prepareSnapshotBatch} from './requests.js';
export {ApiError} from './errors.js';
// Deliberately synthetic fixtures. These are not CSV rows or model predictions.
export const inventory = [
  {product_id:'P0001',name:'Pantry essentials',category:'Groceries',stock:180,horizon:3,p50:240,p90:310},
  {product_id:'P0002',name:'Everyday play',category:'Toys',stock:420,horizon:7,p50:190,p90:260},
  {product_id:'P0003',name:'Core apparel',category:'Clothing',stock:95,horizon:10,p50:170,p90:230,anomaly:true},
  {product_id:'P0004',name:'Home technology',category:'Electronics',stock:260,horizon:14,p50:160,p90:220},
  {product_id:'P0005',name:'Living collection',category:'Furniture',stock:360,horizon:21,p50:210,p90:290},
  {product_id:'P0006',name:'Seasonal pantry',category:'Groceries',stock:300,horizon:3,p50:140,p90:200,anomaly:true}
];
export function createMockApi({storage,now=()=>Date.now(),uuid=()=>crypto.randomUUID()}={}){
 const snapshots=()=>inventory.map(p=>({
  id:`synthetic-S001-${p.product_id}-2022-06-30`,store_id:'S001',product_id:p.product_id,snapshot_date:'2022-06-30',
  category_raw:p.category,region_raw:'Synthetic region',inventory_level:p.stock,units_sold:10,units_ordered:20,
  price:10,discount_raw:0,weather_condition:'Synthetic',holiday_promotion:0,competitor_pricing:10,
  seasonality_raw:'Synthetic',demand_forecast_benchmark:-1,source_reference:`synthetic-fixture/${p.product_id}`,
 }));
 const key='fix-demo-v1';
 const read=()=>{
  let raw;try{raw=storage.getItem(key);}catch{throw new ApiError('Browser storage is unavailable. Enable local storage to use the demo.');}
  if(!raw)return {runs:{},reviews:{}};
  try{const d=JSON.parse(raw);if(!d.runs||!d.reviews)throw Error();return d;}
  catch{throw new ApiError('Saved demo data is invalid. Use Reset demo data in the sidebar.');}
 };
 const save=d=>{try{storage.setItem(key,JSON.stringify(d));}catch{throw new ApiError('Could not save demo data. Check browser storage permissions or space.');}};
 const runOf=(d,id)=>{if(!d.runs[id])throw new ApiError('Analysis run not found in this browser.',404);return d.runs[id];};
 const status=r=>now()-r.created_ms<1200?'queued':now()-r.created_ms<5200?'processing':r.scenario==='failure'?'failed':'completed';
 const list=r=>{
  const s=status(r);if(s==='queued'||s==='processing'||r.scenario==='empty')return [];
  return (s==='failed'?inventory.slice(0,1):inventory).map((p,i)=>{
   const anomaly=p.anomaly&&(p.product_id!=='P0003'||r.fixture_version===2);
   const order=Math.max(0,p.p90-p.stock),alert=order>0||anomaly;
   return {id:`${r.id}:${p.product_id}`,analysis_run_id:r.id,store_id:r.store_id,product_id:p.product_id,name:p.name,
    horizon_days:p.horizon,forecast_mode:'quantile',predicted_demand_p50:p.p50,predicted_demand_p90:p.p90,
    inventory_at_prediction:p.stock,safety_stock:p.p90-p.p50,recommended_order_quantity:order,
    anomaly_type:anomaly?'unusual_demand':order?'stockout_risk':null,
    explanation:anomaly?'Synthetic fixture: a sales spike exceeded the demonstration threshold.':order?`Horizon P90 (${p.p90}) exceeds snapshot stock (${p.stock}) by ${order} units.`:'Snapshot stock covers the simulated lead-time P90 demand.',
    snapshot_id:`synthetic-S001-${p.product_id}-${r.as_of_date}`,snapshot_date:r.as_of_date,
    processed_at:new Date(r.created_ms+5200).toISOString(),duration_ms:100,
    model_version:'mock-fixture-v1 (not a trained model)',policy_version:'demo-policy-v1',input_reference:`synthetic/${r.as_of_date}/${p.product_id}`,
    case_id:alert?`${r.id}:${i}`:null};
  });
 };
 const cases=d=>Object.values(d.runs).flatMap(r=>list(r).filter(x=>x.case_id).map(x=>({id:x.case_id,analysis_run_id:r.id,
  parent_run_status:status(r),partial:status(r)==='failed',
  exception_type:x.recommended_order_quantity>0?(x.anomaly_type==='unusual_demand'?'reorder_and_anomaly':'reorder'):'anomaly',status:'pending_review',result:x,...d.reviews[x.case_id]})));
 return {
  async ingestSnapshots(body){prepareSnapshotBatch(body);throw new ApiError('Snapshot ingestion requires the real public API. Mock fixtures are read-only.',503,'BACKEND_NOT_CONNECTED');},
  async getSnapshots(filters={}){
   const f=prepareFilters('snapshots',filters);
   return snapshots().filter(x=>(!f.product_id||x.product_id===f.product_id)&&(!f.from||x.snapshot_date>=f.from)&&(!f.to||x.snapshot_date<=f.to));
  },
  async getInventory(filters={}){prepareFilters('inventory',filters);return inventory.map(p=>({product_id:p.product_id,name:p.name,category:p.category,store_id:'S001',on_hand_quantity:p.stock,lead_time_days:p.horizon,snapshot_date:'2022-06-30',source_snapshot_id:`synthetic-S001-${p.product_id}-2022-06-30`}));},
  async getInventoryItem(storeId,productId){
   const rows=await this.getInventory({store_id:storeId}),row=rows.find(x=>x.product_id===productId);
   if(!row)throw new ApiError('Inventory item not found.',404);return row;
  },
  async createAnalysisRun(payload){
   if(payload.store_id!=='S001'||payload.run_type!=='daily')throw new ApiError('Demo supports S001 and Daily only.',422);
   if(payload.as_of_date!=='2022-06-30')throw new ApiError('Synthetic fixtures are available only for 2022-06-30.',422);
   const scenario=payload.scenario||'success';if(!['success','failure','empty'].includes(scenario))throw new ApiError('Invalid demo scenario.',422);
   const d=read(),id=uuid();d.runs[id]={id,fixture_version:2,store_id:'S001',as_of_date:payload.as_of_date,run_type:'daily',scenario,created_ms:now()};save(d);
   return {analysis_run:{id,status:'queued'},job:{id:`job-${id}`,status:'pending'}};
  },
  async getAnalysisRun(id){const r=runOf(read(),id),s=status(r);return {...r,status:s,created_at:new Date(r.created_ms).toISOString(),completed_at:['completed','failed'].includes(s)?new Date(r.created_ms+5200).toISOString():null,
   job:{id:`job-${r.id}`,status:({queued:'pending',processing:'claimed',completed:'completed',failed:'failed'})[s]},
   processed_count:list(r).length,expected_count:r.scenario==='empty'?0:inventory.length,partial:s==='failed',error:s==='failed'?'Simulated AI timeout after one product. This is a deliberately incomplete run.':null};},
  async getAnalysisResults(id){const r=runOf(read(),id);return {results:list(r),status:status(r),partial:status(r)==='failed'};},
  async getExceptions(filters={}){const {run_id,status:filter}=prepareFilters('exceptions',filters);return cases(read()).filter(c=>(!run_id||c.analysis_run_id===run_id)&&(!filter||c.status===filter));},
  async getException(id){const c=cases(read()).find(x=>x.id===id);if(!c)throw new ApiError('Exception not found.',404);return c;},
  async submitReview(id,payload){
   const d=read(),c=cases(d).find(x=>x.id===id);if(!c)throw new ApiError('Exception not found.',404);
   if(c.parent_run_status!=='completed')throw new ApiError('Partial results from failed runs cannot be reviewed.',409);
   if(c.status!=='pending_review')throw new ApiError('This case was already reviewed. Reload its latest decision.',409);
   const {decision,reviewer_order_quantity,override_reason,reviewer_label}=prepareReview(payload);
   if(!['approve','modify','reject','resolve'].includes(decision))throw new ApiError('Invalid decision.',422);
   if((c.exception_type==='anomaly')!==(decision==='resolve'))throw new ApiError('Choose a decision appropriate for this case.',422);
   if(!reviewer_label?.trim())throw new ApiError('Reviewer name is required.',422);
   if(['modify','reject','resolve'].includes(decision)&&!override_reason?.trim())throw new ApiError('A review reason is required.',422);
   if(c.exception_type==='reorder_and_anomaly'&&!override_reason?.trim())throw new ApiError('Combined cases require a note addressing the anomaly and replenishment.',422);
   if(decision==='modify'&&(!Number.isInteger(reviewer_order_quantity)||reviewer_order_quantity<0))throw new ApiError('Enter a nonnegative whole-unit quantity.',422);
   const review={status:({approve:'approved',modify:'modified',reject:'rejected',resolve:'resolved'})[decision],reviewer_decision:decision,
    reviewer_order_quantity:decision==='approve'?c.result.recommended_order_quantity:decision==='modify'?reviewer_order_quantity:decision==='reject'?0:null,
    reviewer_label:reviewer_label.trim(),override_reason:override_reason?.trim()||'',reviewed_at:new Date(now()).toISOString()};
   d.reviews[id]=review;save(d);return {...c,...review};
  },
  async reset(){storage.removeItem(key);}
 };
}
