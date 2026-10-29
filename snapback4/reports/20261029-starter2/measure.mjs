import {priceLane,loadPrices} from '/home/ccheever/sb4-loop/bakeoff/pricing.mjs';
import {readFileSync,writeFileSync,existsSync} from 'node:fs';
const assignments=JSON.parse(readFileSync('/home/ccheever/sb4-loop/bakeoff/next38/wave34r3/assignments.json'));
const prices=loadPrices('/home/ccheever/sb4-loop/bakeoff/prices.json'),rows=[];
for(const phase of ['before','after'])for(const n of [5,23,36,39,19,32]){
 const a=assignments.find(a=>a.n===n),lane=`/tmp/starter2-replay/${phase}/${a.id}`,result=`/tmp/starter2-evidence/${phase}-${n}-result.json`;
 if(!existsSync(result))continue;
 const p=priceLane(lane,{prices});
 const nano={uncachedInput:0,cachedInput:0,output:0};
 for(const u of p.costPricing.units){
  const base=prices.models[u.model],rate=u.longContext?base.longContext:base;
  if(!rate)throw Error('unknown price model');
  nano.uncachedInput+=(u.inputTokens-u.cachedInputTokens)*Math.round(rate.input*1000);
  nano.cachedInput+=u.cachedInputTokens*Math.round(rate.cachedInput*1000);
  nano.output+=u.outputTokens*Math.round(rate.output*1000);
 }
 const costByPartUsd=Object.fromEntries(Object.entries(nano).map(([k,v])=>[k,v/1e9]));
 if(p.costUsd!==null&&Math.abs(Object.values(costByPartUsd).reduce((a,b)=>a+b,0)-p.costUsd)>1e-8)throw Error('price parts disagree with harness pricing');
 rows.push({phase,n,model:a.model,lane:a.id,result:JSON.parse(readFileSync(result)),costUsd:p.costUsd,costByPartUsd,basis:p.costBasis,complete:p.costPricing.costComplete,priceSha256:p.costPricing.priceSha256,
 usage:p.costPricing.usageTotals,modelEndpoints:p.costPricing.modelEndpoints,longContextRequests:p.costPricing.longContextRequests,longContextUncertain:p.costPricing.longContextUncertain,
 calls:p.costPricing.units.reduce((n,u)=>n+(u.basis==='per-call'?1:u.calls??0),0),coverage:p.costPricing.coverage});
}
writeFileSync('/tmp/starter2-evidence/pricing.json',JSON.stringify(rows,null,2));
console.log(rows.map(r=>[r.phase,r.n,r.costUsd,r.calls,r.complete]));
