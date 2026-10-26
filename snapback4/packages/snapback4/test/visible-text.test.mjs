// Shared evidence validation through the actual native and Wasm device arms.
import test from 'node:test';
import assert from 'node:assert/strict';
import {server} from './helpers/read-through-server.mjs';
import {hangBudget} from './helpers/wait.mjs';
const source=`table docs:
  owner: principal
  reason: text 1..30
  reasons: [text 1..30] <=3 ?
  read <- allow
  insert <- .owner = viewer
  sync public
mutation typed(reason: text 1..30):
  return insert docs {owner:viewer,reason}
mutation stored(reason: text <=30,reasons: [text <=30] <=3 ?):
  return insert docs {owner:viewer,reason,reasons}
mutation trimmed(reason: text <=30):
  require trim(reason) != '' else EMPTY_REASON
  return insert docs {owner:viewer,reason}
`;
for(const tier of ['process','wasm'])test(`${tier}: invisible evidence fails online and in offline prediction`,{timeout:hangBudget(8)},async t=>{
 const host=await server(t,tier,source);const client=await host.open();let ordinal=0;
 for(const reason of ['\u200b','\ufeff','\u2060','\u00ad','\ufe0f','\u2066\u2069']){
  for(const [name,args] of [['typed',{reason}],['stored',{reason,reasons:null}],['stored',{reason:'visible',reasons:[reason]}],['trimmed',{reason}]]){
   const online=await host.post(`/m/${name}`,{id:`online-${++ordinal}`,args});assert.equal(online.state,'failed',JSON.stringify(online));
   const predicted=await host.core.call({op:'predict',name,viewer:'dev:bob',args,now:100,newIds:[`offline-${ordinal}`]});const denied=predicted.denied??predicted.ok?.denied;assert.ok(denied,JSON.stringify(predicted));assert.equal(denied.code,online.why.code);
   if(name==='typed')assert.equal(denied.code,'E_INPUT');if(name==='trimmed')assert.equal(denied.code,'EMPTY_REASON');
  }
 }
 for(const reason of ['❤️','同意',' a ']){const reply=await client.mutate({name:'typed',kind:'mutation',predicts:'eligible'},{reason});assert.equal(reply.state,'sent',JSON.stringify(reply));assert.equal(reply.result.reason,reason);}
});
