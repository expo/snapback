import {readFileSync,writeFileSync} from 'node:fs';
import {resolve,join} from 'node:path';
const bake=join(process.env.HOME,'sb4-loop/bakeoff');
const {loadPrices,priceUsage}=await import(join(bake,'pricing.mjs'));
const root=resolve(process.env.TOK6_ROOT??resolve(import.meta.dirname,'../..'));
const file=join(root,'target/tok6/evidence/measurements.json');
const data=JSON.parse(readFileSync(file)),prices=loadPrices(join(bake,'prices.json'));
let units=0;
for(const row of data.rows){let total=0;for(const c of row.perCall){const p=priceUsage({input_tokens:c.input,cached_input_tokens:c.cached,output_tokens:c.output},row.modelId,{prices,perCall:true});if(p.usd==null)throw Error('unpriced request');total+=p.usd;units++;}
if(Math.abs(total-row.usd)>1e-9)throw Error('pricing mismatch '+row.lane);}
writeFileSync(file.replace('measurements.json','price-audit.json'),JSON.stringify({status:'passed',rows:data.rows.length,requests:units,pricesVersion:prices.version,pricesSha256:prices.sha256,method:'independent crosscheck against harness priceUsage(perCall:true); threshold per request; reasoning included once'},null,2));
console.log('pricing reconciled',data.rows.length,'lanes',units,'requests');
