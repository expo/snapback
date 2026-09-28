import assert from 'node:assert/strict';import{readFileSync,writeFileSync}from'node:fs';import{login}from'snapback4/auth';import{createClient,idFrom}from'snapback4/client';import{api}from'../snapback/generated/api.ts';import{parse}from'./replay.mjs';
const creds=new Map();for(const line of readFileSync('instrument/fixtures/scale.log','utf8').split('\n')){const[,a,v,...args]=parse(line);if(v==='register')creds.set(a,args)}
const results={};
for(const[tag,port]of[['published',49364],['main',49366],['fixed-guide',49370]]){
 const url=`http://127.0.0.1:${port}`,conversation=idFrom('g0001'),signed=await login(url,...creds.get('u0500'));assert.ok(signed.ok);const headers={'content-type':'application/json',authorization:'Bearer '+signed.session.token},owner=createClient({url,session:signed.session});
 const roster=await owner.query(api.roster,{conversation});const who=roster.data.find(x=>x.profile.handle!=='u0500').profile.handle;const peerSigned=await login(url,...creds.get(who));const peer=createClient({url,session:peerSigned.session});
 const raw=async()=>fetch(url+'/q/history',{method:'POST',headers,body:JSON.stringify({args:{conversation}})}).then(r=>r.json());const schema=await fetch(url+'/schema',{headers}).then(r=>r.json());
 const text='Isolated per-receipt wire '+Date.now();const sent=await owner.mutate(api.send,{id:idFrom(text),conversation,text,quote:null});assert.equal(sent.state,'sent',JSON.stringify(sent));let before=await raw();const message=before.data.find(x=>x.text===text);assert.ok(message);assert.equal((await peer.query(api.message,{id:message.id})).data.text,text);
 const records=[];
 for(const[op,args]of[[api.delivered,{conversation,from:message.ordinal,through:message.ordinal}],[api.seen,{conversation,through:message.ordinal}]]){
  before=await raw();const w=await peer.mutate(op,args);assert.equal(w.state,'sent');const start=performance.now();const res=await fetch(url+'/sync',{method:'POST',headers,body:JSON.stringify({generation:schema.generation,from:before.seq,store_id:before.store_id,limit:10000,pending:[],stream:true})});const body=await res.text(),j=JSON.parse(body);assert.ok(!j.denied,JSON.stringify(j.denied));const tables={};for(const e of j.events??[])tables[e.table]=(tables[e.table]??0)+1;
  records.push({op:op.name,from:before.seq,writeSeq:w.seq,watermark:j.watermark,bytes:Buffer.byteLength(body),rows:j.events?.length,tables,serverTiming:res.headers.get('server-timing'),roundTripMs:performance.now()-start,events:(j.events??[]).map(e=>({keys:Object.keys(e),table:e.table,seq:e.seq,bytes:Buffer.byteLength(JSON.stringify(e))}))});
 }
 results[tag]=records;await owner.close();await peer.close();
}
writeFileSync('../wire-receipts.json',JSON.stringify(results,null,2));console.log(JSON.stringify(results,null,2));
