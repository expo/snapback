import test from 'node:test';
import assert from 'node:assert/strict';
import { setup, q, m, ids } from './helpers/astra-search.mjs';
for(const tier of ['process','wasm']) test(`review needle change restarts the combined cursor ${tier}`,async t=>{
 const f=await setup(t,tier),first=await f.client.query(q,{q:'coffee'});
 assert.equal((await f.admin.mutate(m('move'),{id:'m000',text:'tea',at:3000})).state,'sent');
 const changed=await f.client.query(q,{q:'tea',c:first.next});
 assert.deepEqual(changed.data.map(r=>r.id),['m000']);
});
