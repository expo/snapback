import { hangBudget } from './helpers/wait.mjs';
// @ref LLP 3000.023#10 — real commits retire a real history attempt behind held device slots.
import test from 'node:test';
import assert from 'node:assert/strict';
import { setTimeout as delay } from 'node:timers/promises';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fixture, open, opener, source, q, until, parked, sdk } from './helpers/answers-stay.mjs';
const { answerObservation } = await import(new URL('read-observation.js', sdk));
const { ReadWork } = await import(new URL('read-work.js', sdk));

for (const tier of ['wasm','process']) for (const boundary of ['replacement','membership removal']) test(`${tier}: queued history ${boundary}`, {timeout:hangBudget(18)}, async t => {
  const f = await fixture(t, source + '\nquery decoration(id: int):\n  return messages[\'item\']\n');
  const raw = opener(tier, join(f.dir, 'pressure'));
  let hold = false, first = true, historyReached = false;
  const historyGate = Promise.withResolvers(), slots = Promise.withResolvers();
  t.after(() => { historyGate.resolve(); slots.resolve(); });
  const queues = new WeakMap(), schedule = ReadWork.prototype.schedule;
  t.mock.method(ReadWork.prototype, 'schedule', function(watch, run) { queues.set(watch,this); return schedule.call(this,watch,run); });
  const client = await open(t,f,tier,{ fetch:(input,init) => new URL(input).pathname === '/changes' ? parked(init.signal) : fetch(input,init), device:{async open(...args) {
    const core = await raw.open(...args);
    return {...core, async call(request,committed) {
      const result = await core.call(request,committed);
      if (hold && request.op === 'query') {
        if (request.name === 'history' && first) { first=false; historyReached=true; await historyGate.promise; }
        else if (request.name === 'decoration') await slots.promise;
      }
      return result;
    }};
  }}});
  const history = client.observe(q('history'),{c:null}), decorations = Array.from({length:80},(_,id) => client.observe(q('decoration'),{id}));
  const all = [history,...decorations]; all.forEach(w => w.subscribe(() => {})); t.after(() => all.forEach(w=>w.close()));
  await until(() => all.every(w => w.getSnapshot().data));
  const owner = answerObservation(history.getSnapshot()), work = queues.get(owner), events = [], samples = [], withdrawals = [], start = performance.now();
  const onWithdrawal = owner.onWithdrawal;
  owner.onWithdrawal = () => { withdrawals.push({at:performance.now()-start,cause:'change-timeout',queued:work.pending.has(owner),inFlight:work.active.has(owner)}); onWithdrawal(); };
  history.subscribe(() => events.push({at:performance.now()-start,read:structuredClone(history.getSnapshot())}));
  hold=true;
  assert.equal((await f.post('/m/edit',{id:'first-change',args:{body:'first'}})).state,'sent'); await client.sync();
  await until(() => historyReached && work.active.size===8);
  if (boundary === 'replacement') {
    assert.equal((await f.post('/m/edit',{id:'second-change',args:{body:'second'}})).state,'sent'); await client.sync();
    historyGate.resolve();
    await until(() => work.pending.has(owner) && !work.active.has(owner));
    for (let i=0;i<24;i++) { samples.push({at:performance.now()-start,queued:work.pending.size,inFlight:work.active.size,read:structuredClone(history.getSnapshot())}); await delay(50); }
    if (process.env.PR_EVIDENCE) writeFileSync(join(process.env.PR_EVIDENCE,`held-${process.env.PR_LABEL ?? 'current'}-${tier}.json`),JSON.stringify({events,samples,withdrawals},null,2));
    assert.ok(samples.every(s=>s.read.data?.length===1),'the mounted history remains throughout its 1.2 s queue wait');
    assert.ok(events.every(e=>e.read.data?.length===1),'no transient withdrawn or empty answer');
    assert.ok(samples.every(s=>s.inFlight===8 && s.queued>=72));
    hold=false; slots.resolve();
    await until(()=>history.getSnapshot().data?.[0].body==='second'&&!history.getSnapshot().revalidating);
  } else {
    assert.equal((await f.post('/m/remove',{id:'remove-bob',args:{}})).state,'sent'); await client.sync();
    assert.ok(!history.getSnapshot().data?.length,'scope removal hides protected history without waiting for a slot');
    hold=false; historyGate.resolve(); slots.resolve();
    await until(()=>history.getSnapshot().data?.length===0);
  }
});
