import test from 'node:test';
import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
import { parked, until, q } from './helpers/answers-stay.mjs';
const sdk = process.env.RV_TEST_SDK ? pathToFileURL(resolve(process.env.RV_TEST_SDK) + '/') : new URL('../dist/', import.meta.url);
const { createClient } = await import(new URL('client.js', sdk));

// This runs the public watch path. Main ignores additive preservation evidence
// and fails the insert cases at the controlled one-second boundary.
for (const keep of [undefined, true]) for (const kind of ['insert', 'delete', 'legacy', 'malformed', 'opaque']) {
  test(`mounted history: ${kind}, keep=${keep}, replacement held beyond one second`, async t => {
    let now = 1000, reads = 0, polled = false;
    t.mock.method(Date, 'now', () => now);
    const change = Promise.withResolvers(), replacement = Promise.withResolvers();
    const client = createClient({ url: 'http://rv.test', persona: 'bob', fetch: async (input, init) => {
      const path = new URL(input).pathname;
      if (path === '/probe') return parked(init.signal);
      if (path === '/changes') {
        if (polled) return parked(init.signal);
        polled = true; await change.promise;
        return Response.json({ seq: 2, tables: ['messages'], ...(kind === 'legacy' ? {} : { preserved: kind === 'delete' ? [] : kind === 'malformed' ? 'messages' : ['messages'] }) });
      }
      assert.equal(path, '/q/history');
      if (++reads > 1) await replacement.promise;
      return Response.json({ data: [{ id: reads === 1 ? 'old' : 'new' }], complete: true, seq: reads === 1 ? 1 : 2, tables: ['messages'], ...(kind === 'opaque' ? {} : { scopes: { messages: [{}] } }) });
    } });
    t.after(async () => { change.resolve(); replacement.resolve(); await client.close(); });
    const watch = client.observe(q('history'), {} , { keep });
    await until(() => watch.getSnapshot().data?.[0].id === 'old');
    const publications = [];
    watch.subscribe(() => publications.push(watch.getSnapshot()));
    change.resolve(); await until(() => reads === 2);
    assert.equal(watch.getSnapshot().revalidating, true);
    now += 1001;
    const held = watch.getSnapshot();
    if (kind === 'insert') {
      assert.equal(held.data?.[0].id, 'old'); assert.equal(held.revalidating, true);
      assert.ok(publications.every(read => !read.loading));
    } else assert.equal(held.loading, true);
    replacement.resolve(); await until(() => watch.getSnapshot().data?.[0].id === 'new');
    assert.equal(watch.getSnapshot().revalidating, undefined);
  });
}

test('safe evidence retains through retry exhaustion; later revoking evidence still bounds it', async t => {
  const { ReadObservation } = await import(new URL('read-observation.js', sdk));
  const { readyRead } = await import(new URL('read-existence.js', sdk));
  let now = 1000; t.mock.method(Date, 'now', () => now);
  const watch = new ReadObservation(); t.after(() => watch.retire());
  watch.publish(readyRead({ data: ['row'], complete: true, fresh: true, cut: null }));
  watch.reload(false);
  await watch.fetch(async () => ({ read: watch.snapshot }), () => {}, { accept: () => false });
  now += 5000; assert.deepEqual(watch.read(null).data, ['row']); assert.equal(watch.snapshot.revalidating, true);
  watch.reload(true); now += 1001; assert.equal(watch.read(null).loading, true);
});

test('facade-held A keeps its dependencies after source B changes tables', { skip: !!process.env.RV_TEST_SDK }, async t => {
  const { ReadObservation } = await import(new URL('read-observation.js', sdk));
  const { ReadApprovals } = await import(new URL('read-approval.js', sdk));
  const { readyRead } = await import(new URL('read-existence.js', sdk));
  const { watchCanRevoke, evidenceTouches } = await import(new URL('change-evidence.js', sdk));
  let now=1000;t.mock.method(Date,'now',()=>now);
  const w=Object.assign(new ReadObservation(),{tables:new Set(['old']),scopes:{old:[{}]}});
  w.dependencies=()=>({tables:w.tables,scopes:w.scopes});
  const approvals=new ReadApprovals();t.after(()=>{approvals.close();w.retire();});
  w.publish(readyRead({data:'A',complete:true,fresh:true,cut:null}));const approved=approvals.approve(w.snapshot);
  w.tables=new Set(['new']);w.scopes={new:[{}]};w.publish(readyRead({data:'B',complete:true,fresh:true,cut:null}));
  assert.equal(evidenceTouches(w,['old']),true);
  w.reload(watchCanRevoke(w,['old','new']));now+=1501;
  assert.equal(approved.read().data,'A');assert.equal(approved.read().revalidating,true);
  w.reload(watchCanRevoke(w,['new']));now+=1001;
  assert.equal(approved.read().loading,true);
});

for(const change of ['insert','delete','generation'])test(`mutation acknowledgement: ${change}`,async t=>{
  let now=1000,reads=0;t.mock.method(Date,'now',()=>now);
  const replacement=Promise.withResolvers();
  const client=createClient({url:'http://rv-ack.test',persona:'bob',fetch:async(input,init)=>{
    const path=new URL(input).pathname;
    if(path==='/changes'||path==='/probe')return parked(init.signal);
    if(path==='/m/send')return Response.json({state:'sent',id:JSON.parse(init.body).id,seq:2,generation:change==='generation'?2:1,preserved:change==='delete'?[]:['messages']});
    assert.equal(path,'/q/history');if(++reads>1)await replacement.promise;
    return Response.json({data:[{id:reads===1?'old':'new'}],complete:true,tables:['messages'],scopes:{messages:[{}]},seq:reads===1?1:2,generation:1});
  }});t.after(async()=>{replacement.resolve();await client.close();});
  const watch=client.observe(q('history'),{});await until(()=>watch.getSnapshot().data);
  await client.mutate({kind:'mutation',name:'send'},{});await until(()=>reads>1);
  if(change==='generation')assert.equal(watch.getSnapshot().loading,true);
  now+=1001;
  if(change==='insert'){assert.equal(watch.getSnapshot().data?.[0].id,'old');assert.equal(watch.getSnapshot().revalidating,true);}
  else assert.equal(watch.getSnapshot().loading,true);
});

test('a failed safe reread preserves the displayed answer dependency plan for the next safe event', async t => {
  let now=1000,reads=0,changes=[];t.mock.method(Date,'now',()=>now);
  const gate=Promise.withResolvers();
  const client=createClient({url:'http://rv-retry.test',persona:'bob',fetch:async(input,init)=>{
    const path=new URL(input).pathname;
    if(path==='/probe')return parked(init.signal);
    if(path==='/changes')return new Promise(resolve=>changes.push(json=>resolve(Response.json(json))));
    if(++reads===2)throw Error('controlled failed reread');
    if(reads>2)await gate.promise;
    return Response.json({data:[{id:'old'}],complete:true,seq:1,tables:['messages'],scopes:{messages:[{}]}});
  }});t.after(async()=>{gate.resolve();for(const done of changes)done({seq:1,tables:[]});await client.close();});
  const watch=client.observe(q('history'),{});await until(()=>watch.getSnapshot().data&&changes.length);
  changes.shift()({seq:2,tables:['messages'],preserved:['messages']});
  await until(()=>reads>=2&&changes.length);assert.equal(watch.getSnapshot().data?.[0].id,'old');
  changes.shift()({seq:3,tables:['messages'],preserved:['messages']});await until(()=>reads>=3);
  now+=2000;assert.equal(watch.getSnapshot().data?.[0].id,'old');assert.equal(watch.getSnapshot().revalidating,true);
});

// Both round-0 counterexamples use real mutations and real wire certificates.
// Only replacement delivery and the client wall clock are controlled.
for (const schema of ['docs', 'messages']) for (const channel of ['ack', 'changes']) {
  test(`private-field transfer: real ${schema} via ${channel} withdraws disclosure`, async t => {
    const { server } = await import('./helpers/app-server.mjs');
    const member = schema === 'messages';
    const owner = member ? 'author' : 'owner', field = member ? 'note' : 'secret', value = member ? 'private note' : 42;
    const source = `use personas alice, bob
${member ? `table members:
  room: text <=40
  principal: principal
  unique room, principal
  immutable room, principal
  read <- exists members[.room, viewer]
  sync to members[.room]
` : ''}table ${schema}:
  ${owner}: principal
  ${field}: ${member ? 'text default ""' : 'int default 0'} written by .${owner}
${member ? '  room: text <=40\n  body: text\n  read <- exists members[.room, viewer]\n  sync to members[.room]' : '  public\n  sync public'}
  update <- allow
query row():
  return ${schema}['row1']
query selected():
  row = ${schema}['row1']
  return row if row.${field} = ${JSON.stringify(value)} else null
mutation transfer():
  update ${schema}['row1'] { ${owner}: 'dev:bob' }
`;
    const f = await server(t, undefined, source);
    const headers = { 'x-snapback-persona': 'alice' };
    const post = async (path, body) => {
      const reply = await fetch(f.url+path,{ method:'POST', headers, body:JSON.stringify(body) });
      assert.equal(reply.status,200); return reply.json();
    };
    const rows = [{table:schema,row:{id:'row1',[owner]:'dev:alice',[field]:value,...(member?{room:'room',body:'public body'}:{})}},
      ...(member?['alice','bob'].map(p=>({table:'members',row:{id:p,room:'room',principal:`dev:${p}`}})):[])];
    assert.equal((await post('/seed',rows)).seeded,rows.length);
    const before = await post('/q/row',{args:{}});
    let now=Date.now(), hold=false, held=0, delivered=false, evidence, ack;
    t.mock.method(Date,'now',()=>now);
    const gate=Promise.withResolvers(),change=Promise.withResolvers();
    const client=createClient({url:f.url,persona:'alice',fetch:async(input,init)=>{
      const path=new URL(input).pathname;
      if(path==='/probe')return parked(init.signal);
      if(path==='/changes') {
        if(channel==='ack'||delivered)return parked(init.signal);
        await Promise.race([change.promise,parked(init.signal)]); delivered=true;
        return Response.json(evidence);
      }
      const response=await fetch(input,init),json=await response.json();
      if(path.startsWith('/m/'))ack=json;
      if(hold&&path.startsWith('/q/')) { held++; await Promise.race([gate.promise,parked(init.signal)]); }
      return Response.json(json,{status:response.status});
    }});
    t.after(async()=>{gate.resolve();change.resolve();await client.close();});
    const watches=['row','selected'].map(name=>client.observe(q(name),{}));
    await until(()=>watches.every(w=>w.getSnapshot().data?.[field]===value));
    hold=true;
    if(channel==='ack')await client.mutate({kind:'mutation',name:'transfer'},{});
    else ack=await post('/m/transfer',{id:'transfer',args:{}});
    evidence=await fetch(`${f.url}/changes?since=${before.seq}&wait=0`,{headers}).then(r=>r.json());
    assert.equal(ack.state,'sent');
    change.resolve();
    await until(()=>held>=2);
    now+=1600;
    for(const watch of watches) {
      assert.equal(watch.getSnapshot().loading,true,'previously disclosed private field must withdraw');
      assert.equal(watch.getSnapshot().data,undefined);
    }
    assert.ok(!ack.preserved.includes(schema),'acknowledgement must classify field revocation');
    assert.ok(!evidence.preserved.includes(schema),'changes must classify field revocation');
    const fresh=await post('/q/row',{args:{}});
    assert.equal(Object.hasOwn(fresh.data,field),false);
    assert.equal((await post('/q/selected',{args:{}})).data,null);
    hold=false;gate.resolve();
    await until(()=>watches[0].getSnapshot().data?.[owner]==='dev:bob'&&watches[1].getSnapshot().data===null);
    assert.equal(Object.hasOwn(watches[0].getSnapshot().data,field),false);
  });
}
