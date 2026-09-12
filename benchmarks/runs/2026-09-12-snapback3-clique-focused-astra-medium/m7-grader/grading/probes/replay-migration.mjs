import fs from 'node:fs';
import {authenticate,pages} from '../../scripts/api-lib.mjs';
const url='http://127.0.0.1:54901';
const out={url,start:Date.now(),actors:[],attempts:[],errors:[]};
const seen=new Map();
for(const actor of ['alice','bob','carol','dave','erin','frank','grace','henry']){
  let client;
  try{
    ({client}=await authenticate({url,actor}));
    const {rows}=await pages(client,'conversations.inbox');
    out.actors.push({actor,conversations:rows.map(r=>r.id)});
    for(const c of rows){
      const before=(await client.watch('conversations.settings',{conversationId:c.id}).refresh()).data;
      if(seen.has(c.id)){
        // second attempt on already-migrated conversation (guard check)
        const op=client.mutate('conversations.backfillCount',{conversationId:c.id});
        let r; try{await op.durable; r=await op.settled;}catch(e){r={error:String(e)};}
        out.attempts.push({actor,id:c.id,kind:'repeat-guard',before,receipt:r&&r.state?{state:r.state,error:r.error??null,data:r.data??null}:r});
        continue;
      }
      const hist=await pages(client,'messages.page',{conversationId:c.id});
      const visible=hist.rows.filter(m=>!m.tombstone).length;
      const op=client.mutate('conversations.backfillCount',{conversationId:c.id});
      let r; try{await op.durable; r=await op.settled;}catch(e){r={error:String(e)};}
      out.attempts.push({actor,id:c.id,kind:'backfill',operationId:op.id,before,storedRows:hist.rows.length,visible,receipt:r});
      seen.set(c.id,r&&r.data?r.data.messageCount:null);
    }
  }catch(e){out.errors.push({actor,error:String(e)});}
  finally{ if(client) client.close(); }
}
out.migratedMap=Object.fromEntries(seen);
out.end=Date.now();
fs.writeFileSync(process.argv[2],JSON.stringify(out,null,1));
console.log(JSON.stringify({actors:out.actors,attempts:out.attempts.map(a=>({actor:a.actor,id:a.id,kind:a.kind,beforeCount:a.before?a.before.messageCount:null,visible:a.visible,state:a.receipt&&a.receipt.state,count:a.receipt&&a.receipt.data&&a.receipt.data.messageCount,err:(a.receipt&&(a.receipt.error||a.receipt.reason))??null})),errors:out.errors},null,1));
