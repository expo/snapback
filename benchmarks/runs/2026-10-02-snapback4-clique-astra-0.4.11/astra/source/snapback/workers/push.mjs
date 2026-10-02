import {runWorker} from 'snapback4/worker';
import {appendFileSync,mkdirSync,readFileSync} from 'node:fs';
const stop=new AbortController();process.once('SIGTERM',()=>stop.abort());
mkdirSync('evidence',{recursive:true});
let delivered=new Set();try{delivered=new Set(readFileSync('evidence/push-seam.jsonl','utf8').trim().split('\n').map(s=>JSON.parse(s).idempotencyKey))}catch{}
await runWorker({url:process.env.SNAPBACK_URL,token:process.env.SNAPBACK_SERVICE_TOKEN,ledger:true,signal:stop.signal,effects:{notify:async(payload,meta)=>{
 if(delivered.has(meta.idempotencyKey))return {providerId:meta.idempotencyKey};
 appendFileSync('evidence/push-seam.jsonl',JSON.stringify({at:Date.now(),idempotencyKey:meta.idempotencyKey,...payload})+'\n');
 delivered.add(meta.idempotencyKey);return {providerId:meta.idempotencyKey};
}}}).done;
