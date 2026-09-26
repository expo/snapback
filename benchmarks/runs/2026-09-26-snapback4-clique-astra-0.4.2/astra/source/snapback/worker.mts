import {runWorker} from 'snapback4/worker';
import {appendFile,readFile} from 'node:fs/promises';
const path=process.env.CLIQUE_PUSH_LOG||'evidence/push.jsonl';
const seen=new Set<string>();try{for(const l of(await readFile(path,'utf8')).trim().split('\n'))if(l)seen.add(JSON.parse(l).id)}catch{}
runWorker({url:process.env.SNAPBACK_URL!,token:process.env.SNAPBACK_SERVICE_TOKEN!,effects:{notify:async(payload,meta)=>{if(!seen.has(meta.id)){await appendFile(path,JSON.stringify({id:meta.id,at:Date.now(),payload})+'\n');seen.add(meta.id)}return{providerId:meta.id}}}});
