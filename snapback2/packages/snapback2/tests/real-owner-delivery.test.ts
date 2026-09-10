import assert from 'node:assert/strict';
import { mkdtemp, readFile, readdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import { createClient, api } from '../dist/client.mjs';
import { fileRangeStore } from '../dist/test.mjs';
import { subscribe } from '../src/internal.js';
import { OfflineRuntime, drainOutbox } from '../dist/sqlite-test.mjs';
import { RealOwnerHarness } from './owner-harness.ts';

const fixture = fileURLToPath(new URL('../../compiler/fixtures/quarry-delivery/snapback',import.meta.url));
const bodies = (from:number, count=51) => Array.from({length:count},(_,n)=>`message ${from+n}`);

test('51 messages in one owner commit: only the accepted 50 acknowledge; two clients reopen, retry and compact real replay responses', async () => {
  const root=await mkdtemp(join(tmpdir(),'custody-pages-')), owner=await RealOwnerHarness.create({forceOwned:true,fixture});
  const observer=createClient({url:owner.url,persona:'alice'}), clients:any[]=[];
  const replies:any[]=[]; let dropped:any, drop=false;
  const open=async (name:string) => {
    const client=createClient({url:owner.url,persona:'alice',offline:{store:fileRangeStore(join(root,name))},fetch:async(input,init)=>{
      const response=await fetch(input,init), path=new URL(String(input)).pathname;
      const request=init?.body?JSON.parse(String(init.body)):undefined;
      if(path==='/api/mutation'&&request?.op==='_delivery.deliveries.ack') replies.push(await response.clone().json());
      if(drop&&path==='/api/query'&&request?.op==='messages.inbox'&&request.args.c) {
        dropped=await response.json(); throw new TypeError('dropped page two');
      }
      return response;
    }}); clients.push(client);await client.ready;return client;
  };
  try {
    await observer.ready;
    assert.equal((await observer.mutation(api.messages.join,{conversationId:'group'})).state,'committed');
    const sent:any=await observer.mutation(api.messages.batch,{conversationId:'group',bodies:bodies(0)});
    assert.equal(sent.state,'committed');
    let first=await open('first');
    const page:any=await first.query(api.messages.inbox,{c:null});
    assert.equal(page.data.length,50);assert(page.next);
    assert.deepEqual([...new Set(page.data.map((e:any)=>e.seq))],[sent.seq],'all 51 originate in one transaction');
    await first.online();
    await first.outbox.drain();
    drop=true;const lost:any=await first.query(api.messages.inbox,{c:page.next});drop=false;
    assert.notEqual(lost.live,true,'transport failure can serve only local custody');
    assert.equal(dropped.rows.filter((r:any)=>r.table==='messages').length,1);
    let receipts:any=await observer.query(api.messages.allReceipts,{});
    assert.equal(receipts.data.length,51);assert.equal(receipts.data.filter((r:any)=>r.received).length,50,
      JSON.stringify({status:await first.outbox.status(),entries:await first.outbox.entries(),replies}));
    const firstSeq=new Map(receipts.data.filter((r:any)=>r.received).map((r:any)=>[r.id,r.seq]));
    await first.close(); first=await open('first'); const second=await open('second');
    for(const client of [first,second]) {
      const head:any=await client.query(api.messages.inbox,{c:null});
      await client.query(api.messages.inbox,{c:head.next});await client.online();await client.outbox.drain();
      await client.query(api.messages.allReceipts,{});
      assert.equal((await client.outbox.entries()).filter((e:any)=>e.op==='_delivery.deliveries.ack').length,0,'real committed responses compact after their receipt rows arrive');
    }
    receipts=await observer.query(api.messages.allReceipts,{});
    assert.equal(receipts.data.filter((r:any)=>r.received).length,51);
    for(const row of receipts.data) if(firstSeq.has(row.id)) assert.equal(row.seq,firstSeq.get(row.id),'duplicate device acknowledgements keep the first commit seq');
    assert(replies.length>=3);assert(replies.every(r=>r.state==='committed'&&Array.isArray(r.effects)&&r.program?.planHash));
    await first.close();first=await open('first');
    const count=replies.length;await first.query(api.messages.inbox,{c:null});await first.outbox.drain();
    assert.equal(replies.length,count,'compacted marks survive another reopen and redelivery');
  } finally { for(const c of clients) await c.close();await observer.close();await owner.close();await rm(root,{recursive:true,force:true}); }
});

test('cold edit outside the live tail refreshes an unmounted thread and offline search without duplicate bubbles', async () => {
  const root=await mkdtemp(join(tmpdir(),'custody-edits-')),owner=await RealOwnerHarness.create({forceOwned:true,fixture});
  const writer=createClient({url:owner.url,persona:'alice'}); let client:any, sub:any; const reads:string[]=[];
  try {
    await writer.ready;await writer.mutation(api.messages.join,{conversationId:'group'});
    for(const from of [0,51,102]) assert.equal((await writer.mutation(api.messages.batch,{conversationId:'group',bodies:bodies(from)})).state,'committed');
    client=createClient({url:owner.url,persona:'alice',offline:{store:fileRangeStore(root)},fetch:async(input,init)=>{
      if(new URL(String(input)).pathname==='/api/query'&&init?.body) reads.push(JSON.parse(String(init.body)).op);
      return fetch(input,init);
    }});await client.ready;
    sub=subscribe(client,api.messages.inbox,{c:null},()=>{},{drain:true});await sub.until((v:any)=>v.live===true,10000);
    assert(!reads.includes('messages.thread'),'thread has never mounted');
    const early:any=await writer.query(api.messages.inbox,{c:null}),messageId=early.data[0].row;
    sub.close();sub=undefined;await client.offline();
    const edit:any=await writer.mutation(api.messages.edit,{messageId,body:'quasar refreshed'});assert.equal(edit.state,'committed');
    const authoritative:any=await writer.query(api.messages.search,{conversationId:'group',term:'quasar',c:null});
    await client.online();
    sub=subscribe(client,api.messages.inbox,{c:null},()=>{},{drain:true});await sub.until((v:any)=>v.live===true,10000);
    await client.outbox.drain();sub.close();sub=undefined;await client.offline();
    client=await client.restart();
    const before=reads.length,thread:any[]=[];let cursor:any=null;
    do { const page:any=await client.query(api.messages.thread,{conversationId:'group',c:cursor});thread.push(...page.data);cursor=page.next; } while(cursor);
    const bubble=thread.filter(e=>e.row===messageId);assert.equal(bubble.length,1);assert.equal(thread.length,153);
    assert.equal(bubble[0].message.body,'quasar refreshed');assert.equal(bubble[0].message.editedAt,authoritative.data[0].editedAt);
    const search:any=await client.query(api.messages.search,{conversationId:'group',term:'quasar',c:null});
    assert.deepEqual(search.data.map((r:any)=>r.id),[messageId]);assert.equal(search.data[0].editedAt,bubble[0].message.editedAt);
    assert.equal(reads.length,before,'thread and search use only cold custody');
  } finally { sub?.close();await client?.close();await writer.close();await owner.close();await rm(root,{recursive:true,force:true}); }
});

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


test('removing receipts in a real successor drops pending marks once and reopens without stranding product writes', async (t) => {
  const root=await mkdtemp(join(tmpdir(),'custody-remove-receipts-'));
  const owner=await RealOwnerHarness.create({forceOwned:true,fixture});
  const writer=createClient({url:owner.url,persona:'alice'});
  let runtime:any;const log=t.mock.method(console,'info',()=>{});
  const request=async(path:string, init?:any) => {
    if(path==='/api/program') path+='?generation='+(await request('/api/manifest')).programGeneration;
    const response=await fetch(owner.url+path,{...init,headers:{'X-Snapback-As':'alice','Content-Type':'application/json'}});
    const value=await response.json();assert(response.ok,JSON.stringify(value));return value;
  };
  try {
    await writer.ready;await writer.mutation(api.messages.join,{conversationId:'group'});
    await writer.mutation(api.messages.send,{conversationId:'group',body:'accepted'});
    runtime=new OfflineRuntime({store:fileRangeStore(root)});await runtime.open('dev:alice',true);
    await runtime.program(await request('/api/program'));
    const page=await request('/api/query?receipt=1',{method:'POST',body:JSON.stringify({op:'messages.inbox',args:{c:null}})});
    await runtime.commit('messages.inbox',{c:null},await runtime.accept('messages.inbox',{c:null},page));
    assert.equal((await runtime.outbox.pendingAcknowledgements()).length,1);
    const resumed=await request('/api/resume',{method:'POST',body:JSON.stringify(await runtime.resumeRequest([]))});
    runtime.noteGrant(resumed,'dev:alice');await runtime.adoptPendingGrant();
    const product=await runtime.outbox.enqueue({op:'messages.send',args:{conversationId:'group',body:'kept product'},issuedSeq:page.seq});
    assert.equal((await runtime.outbox.pendingAcknowledgements()).length,1);
    await writer.close();
    const schema=join(owner.root!,'snapback/schema.q'),ops=join(owner.root!,'snapback/messages.q');
    await writeFile(schema,(await readFile(schema,'utf8')).replace(' with receipts',''));
    await writeFile(ops,(await readFile(ops,'utf8')).replace(/query allReceipts\(\):[\s\S]*?\n\n/,'').replace(/\nquery receipts\([\s\S]*/,''));
    const info=JSON.parse(await readFile(join(owner.root!,'.snapback/owner.json'),'utf8'));
    let state:any, planFile:string|undefined;
    for(let n=0;n<200;n++) {
      state=await fetch(owner.url+'/control/status',{headers:{'x-snapback-control':info.secret}}).then(r=>r.json());
      planFile=(await readdir(join(owner.root!,'.snapback'))).find(name=>name.startsWith('migration-'));
      if(planFile) break;
      await new Promise(resolve=>setTimeout(resolve,25));
    }
    assert(planFile,JSON.stringify(state));
    const migration=JSON.parse(await readFile(join(owner.root!,'.snapback',planFile),'utf8'));
    const applied=await fetch(owner.url+'/control/migrate',{method:'POST',headers:{'x-snapback-control':info.secret,'Content-Type':'application/json'},body:JSON.stringify(migration)});
    assert(applied.ok,await applied.text());
    await runtime.program(await request('/api/program'));
    assert.equal((await runtime.outbox.pendingAcknowledgements()).length,0,'removed operation has no pending work');
    assert.equal(log.mock.calls.length,1,'one observable disposition');
    assert.match(log.mock.calls[0].arguments.join(' '),/acknowledgement.*removed/);
    assert.deepEqual(await runtime.store.outbox.get(product.intent),product,'adoption preserves product bytes');
    await runtime.close();runtime=new OfflineRuntime({store:fileRangeStore(root)});await runtime.open('dev:alice',true);
    await runtime.program(await request('/api/program'));
    const drained=await drainOutbox({runtime,json:request,shape:(m:string)=>new Error(m),failure:(e:Error)=>e});
    assert.equal(drained.remaining,0);assert.equal(log.mock.calls.length,1,'reopen does not repeat the log');
    const inbox:any=await request('/api/query',{method:'POST',body:JSON.stringify({op:'messages.inbox',args:{c:null}})});
    assert(inbox.data.some((e:any)=>e.message?.body==='kept product'),JSON.stringify(inbox));
  } finally {await runtime?.close();await writer.close();await owner.close();await rm(root,{recursive:true,force:true});}
});
