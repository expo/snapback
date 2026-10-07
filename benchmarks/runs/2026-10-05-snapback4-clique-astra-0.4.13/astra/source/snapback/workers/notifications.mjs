import {runWorker} from 'snapback4/worker';
import {mkdir,appendFile,readFile} from 'node:fs/promises';
import {join} from 'node:path';
const directory=join(process.env.SNAPBACK_PROJECT_DIR,'data');await mkdir(directory,{recursive:true});const file=join(directory,'push-log.jsonl');const logged=new Set();try{for(const line of(await readFile(file,'utf8')).trim().split('\n'))if(line)logged.add(JSON.parse(line).id)}catch(e){if(e.code!=='ENOENT')throw e}
const stop=new AbortController();process.once('SIGTERM',()=>stop.abort());process.once('SIGINT',()=>stop.abort());
await runWorker({url:process.env.SNAPBACK_URL,token:process.env.SNAPBACK_SERVICE_TOKEN,ledger:true,signal:stop.signal,effects:{notify:async(payload,meta)=>{if(!logged.has(meta.idempotencyKey)){await appendFile(file,JSON.stringify({id:meta.idempotencyKey,at:Date.now(),payload})+'\n');logged.add(meta.idempotencyKey)}return {logged:true,providerKey:meta.idempotencyKey}}}}).done;
