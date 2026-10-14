// @ref LLP 3000.000.000.000#2-served-capabilities — stale replies and closed gates cannot strand compatibility.
import test from 'node:test';
import assert from 'node:assert/strict';
import { setTimeout as delay } from 'node:timers/promises';
import { servedRelease, operationAvailable } from '../dist/release.js';
import { createClient } from '../dist/client.js';
import { waitFor, hangBudget } from './helpers/wait.mjs';
const args = { text: { Text: { max: 100, min: 0, format: null } } };
const catalog = generation => ({ generation, ops: [{name:'edit',kind:'mutation',args}, ...(generation === 2 ? [{name:'newOnly',kind:'query',args:{}}] : [])], tables:[{name:'items',fields:{id:'Id',body:{Text:{max:100}}}}] });
const until = async fn => { await waitFor(fn, 'release capabilities'); };

test('catalog subscription follows v2 -> v1 -> v2 with monotone generation and no query watch', async t => {
  let generation = 1, activeRelease = 2;
  const release = servedRelease({url:'http://catalog',current:()=>true,headers:()=>({authorization:'Bearer token'}),
    fetch:async (url, init) => {
      assert.equal(url,'http://catalog/'); assert.equal(init.headers.authorization,'Bearer token');
      return Response.json({...catalog(activeRelease),generation});
    }});
  t.after(()=>release.close());
  const stop = release.subscribe(()=>{}); t.after(stop);
  await until(()=>release.getSnapshot().generation === 1);
  assert.equal(operationAvailable(release.getSnapshot(),'newOnly','query',{}),true);
  assert.equal(operationAvailable(release.getSnapshot(),'edit','mutation',{other:'Time'}),false);
  assert.ok(Object.isFrozen(release.getSnapshot().operations.edit.args.text));
  generation = 2; activeRelease = 1;
  release.hint(new Response(null,{headers:{'x-snapback-generation':'2'}}));
  assert.deepEqual(release.getSnapshot(),{loading:true});
  await until(()=>release.getSnapshot().generation === 2);
  assert.equal(operationAvailable(release.getSnapshot(),'newOnly','query',{}),false);
  generation = 3; activeRelease = 2;
  // Quiet server switches are detected without any other SDK traffic.
  await until(()=>release.getSnapshot().generation === 3);
  assert.equal(operationAvailable(release.getSnapshot(),'newOnly','query',{}),true);
});

test('late catalog cannot reinstall an old generation or another credential scope', async t => {
  let reply, token='one', calls=0;
  const release = servedRelease({url:'http://catalog',current:()=>true,headers:()=>({authorization:token}),fetch:async()=>{
    calls++; return new Promise(resolve=>{reply=resolve;});
  }});
  t.after(()=>release.close()); const stop=release.subscribe(()=>{}); t.after(stop);
  await until(()=>!!reply);
  release.hint(new Response(null,{headers:{'x-snapback-generation':'3'}}));
  reply(Response.json(catalog(2)));
  await delay(30); assert.deepEqual(release.getSnapshot(),{loading:true});
  await until(()=>calls===2); token='two'; release.invalidate(); reply(Response.json(catalog(3)));
  await delay(30); assert.deepEqual(release.getSnapshot(),{loading:true});
  await until(()=>calls===3); reply(Response.json({...catalog(2),generation:4}));
  await until(()=>release.getSnapshot().generation===4);
  release.close(); assert.deepEqual(release.getSnapshot(),{loading:true});
});

test('online client exposes authenticated release without mounting a query and withdraws on close', async t => {
  let queries=0;
  const client=createClient({url:'http://localhost:4400',persona:'alice',fetch:async (url,init)=>{
    if (url.endsWith('/')) { assert.equal(init.headers['x-snapback-persona'],'alice'); return Response.json(catalog(2)); }
    if (url.includes('/q/')) queries++;
    return Response.json({ok:true,seq:0,generation:2});
  }});
  t.after(()=>client.close()); const stop=client.release.subscribe(()=>{}); t.after(stop);
  await until(()=>client.release.getSnapshot().generation===2);
  assert.equal(queries,0); await client.close(); assert.deepEqual(client.release.getSnapshot(),{loading:true});
});

test('catalog auth refusals and failures are visible; legacy catalog never claims a capability', async t => {
  let response=Response.json({denied:{code:'E_AUTH',family:'auth',message:'expired'}},{status:401});
  const release=servedRelease({url:'http://catalog',current:()=>true,headers:()=>({}),fetch:async()=>response.clone()});
  t.after(()=>release.close()); const stop=release.subscribe(()=>{}); t.after(stop);
  await until(()=>release.getSnapshot().denied?.code==='E_AUTH');
  response=Response.json({generation:2,ops:[{name:'newOnly',kind:'query'}],tables:[]}); release.invalidate();
  await delay(50); assert.equal(operationAvailable(release.getSnapshot(),'newOnly','query',{}),false);
});
