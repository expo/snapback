import {runWorker} from 'snapback4/worker';
import {mkdir,writeFile,appendFile} from 'node:fs/promises';
const stop=new AbortController();process.once('SIGTERM',()=>stop.abort());
await mkdir('evidence/push-provider',{recursive:true});
await appendFile('evidence/server-pids.txt',`${process.pid} push-worker\n`);
await appendFile('run-log.md',`${Math.floor(Date.now()/1000)} server PID=${process.pid} supervised-push-worker evidence=evidence/push.jsonl\n`);
await runWorker({url:process.env.SNAPBACK_URL,token:process.env.SNAPBACK_SERVICE_TOKEN,ledger:true,signal:stop.signal,effects:{notify:async(payload,meta)=>{
 const receipt={id:meta.idempotencyKey,at:Date.now(),payload};
 // The seam is a local idempotent provider. Its per-key durable file is authoritative;
 // the JSONL stream is a convenient operator log, never an emission authority.
 try{await writeFile(`evidence/push-provider/${meta.idempotencyKey}.json`,JSON.stringify(receipt),{flag:'wx'});await appendFile('evidence/push.jsonl',JSON.stringify(receipt)+'\n');}catch(e){if(e.code!=='EEXIST')throw e}
 return {providerId:meta.idempotencyKey};
}}}).done;
