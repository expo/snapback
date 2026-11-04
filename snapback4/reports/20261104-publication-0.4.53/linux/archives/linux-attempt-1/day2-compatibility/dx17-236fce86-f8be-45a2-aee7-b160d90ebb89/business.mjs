
import assert from'node:assert/strict';import{readFileSync,writeFileSync}from'node:fs';
import{startServe,rollback,snapshotAll,uniqueName}from'snapback4/proof';import{createClient}from'snapback4/client';
let expected=JSON.parse(readFileSync('expected.json','utf8'));
const host=await startServe('./deploy',{provisionUsers:{roles:{member:2,admin:2},provision:{kind:'mutation',name:'provision'}}});
try{
 await rollback('./deploy',1);
 for(const stage of ['v1','v2']){
  if(stage==='v2')await rollback('./deploy','latest');
  const account=host.sessions.member[0],client=createClient({url:host.url,session:account});
  try{const w=await client.mutate({kind:'mutation',name:'add'},{body:uniqueName(stage)});assert.equal(w.state,'sent');}finally{client.close();}
 }
 const after=await snapshotAll('notes',{release:'./deploy'});for(const old of expected)assert.ok(after.some(r=>r.id===old.id&&r.body===old.body));
 for(const row of after)assert.equal(row.label,'new');
 expected=after;writeFileSync('expected.json',JSON.stringify(after));
 await rollback('./deploy',1);assert.deepEqual(await snapshotAll('notes',{release:'./deploy'}),expected);
 await rollback('./deploy','latest');assert.deepEqual(await snapshotAll('notes',{release:'./deploy'}),expected);
 writeFileSync('day2-proof.json',JSON.stringify({ok:true,recordsCheckedAfterV2:expected.length}));
}finally{await host.stop();}
