import {priceLane,loadPrices} from '/home/ccheever/sb4-loop/bakeoff/pricing.mjs';
import {readFileSync,writeFileSync,existsSync} from 'node:fs';
const assignments=JSON.parse(readFileSync('/home/ccheever/sb4-loop/bakeoff/next38/wave34r3/assignments.json'));
const prices=loadPrices('/home/ccheever/sb4-loop/bakeoff/prices.json'),rows=[];
for(const phase of ['before','after'])for(const n of [5,23,36,39,19,32]){
 const a=assignments.find(a=>a.n===n),lane=`/tmp/starter2-replay/${phase}/${a.id}`,result=`/tmp/starter2-evidence/${phase}-${n}-result.json`;
 if(!existsSync(result))continue;
 const p=priceLane(lane,{prices});
 rows.push({phase,n,model:a.model,lane:a.id,result:JSON.parse(readFileSync(result)),costUsd:p.costUsd,basis:p.costBasis,complete:p.costPricing.costComplete,priceSha256:p.costPricing.priceSha256,
 usage:p.costPricing.usageTotals,modelEndpoints:p.costPricing.modelEndpoints,longContextRequests:p.costPricing.longContextRequests,longContextUncertain:p.costPricing.longContextUncertain,
 calls:p.costPricing.units.reduce((n,u)=>n+(u.basis==='per-call'?1:u.calls??0),0),coverage:p.costPricing.coverage});
}
writeFileSync('/tmp/starter2-evidence/pricing.json',JSON.stringify(rows,null,2));
console.log(rows.map(r=>[r.phase,r.n,r.costUsd,r.calls,r.complete]));
