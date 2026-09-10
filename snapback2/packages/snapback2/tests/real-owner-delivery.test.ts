import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import { createClient, api } from '../dist/client.mjs';
import { fileRangeStore } from '../dist/test.mjs';
import { subscribe } from '../src/internal.js';
import { RealOwnerHarness } from './owner-harness.ts';

test('real derived inbox predicts an offline send and acknowledges the drained server event once', async () => {
  const root = await mkdtemp(join(tmpdir(),'custody-client-'));
  const owner = await RealOwnerHarness.create({ forceOwned:true, fixture:fileURLToPath(new URL('../../compiler/fixtures/quarry-delivery/snapback',import.meta.url)) });
  const writes: any[] = [];
  const client = createClient({url:owner.url,persona:'alice',offline:{store:fileRangeStore(root)},fetch:async (input,init) => {
    if(new URL(String(input)).pathname==='/api/mutation') writes.push(JSON.parse(String(init?.body)));
    return fetch(input,init);
  }});
  let sub: any;
  try {
    await client.ready;
    assert.equal((await client.mutation(api.messages.join,{conversationId:'group'})).state,'committed');
    assert.equal((await client.mutation(api.messages.send,{conversationId:'group',body:'first'})).state,'committed');
    sub=subscribe(client,api.messages.inbox,{c:null},()=>{},{drain:true});
    await sub.until((v:any)=>v.live===true,5000);
    await client.outbox.drain();
    const inbox:any=await client.query(api.messages.inbox,{c:null});
    assert.equal(inbox.data.length,1);
    const messageId=inbox.data[0].row;
    const receipts:any=await client.query(api.messages.receipts,{messageId});
    assert.deepEqual(receipts.data.map((r:any)=>r.received),[true]);
    await client.offline();
    const send=await client.mutation(api.messages.send,{conversationId:'group',body:'offline'});
    assert.equal(send.state,'queued');
    const predicted:any=await client.query(api.messages.thread,{conversationId:'group',c:null});
    assert(predicted.data.some((r:any)=>r.message?.body==='offline'),JSON.stringify(predicted));
    await client.online();await client.outbox.drain();
    const after:any=await client.query(api.messages.inbox,{c:null});
    assert.equal(after.data.filter((r:any)=>r.message?.body==='offline').length,1);
    assert(writes.some(w=>w.op==='_delivery.deliveries.ack'&&w.replay?.intent),'acknowledgement is an ordinary replay envelope');
  } finally { sub?.close(); await client.close(); await owner.close(); await rm(root,{recursive:true,force:true}); }
});
