// @ref LLP 3000.023#10 — a retry's queue wait never consumes its answer's remaining budget.
import test from 'node:test';
import assert from 'node:assert/strict';
import { ReadObservation } from '../dist/read-observation.js';
import { ReadWork } from '../dist/read-work.js';
import { ReadApprovals } from '../dist/read-approval.js';
const ready = data => ({ data, complete: true, cut: null, fresh: true });
const drain = async () => { for (let i = 0; i < 20; i++) await Promise.resolve(); };

for (const keep of [undefined, true]) test(`queued replacement preserves mounted history and facade, keep=${keep}`, async t => {
  t.mock.timers.enable({ apis: ['Date', 'setTimeout'], now: 1000 });
  const turns = [], reads = [], releases = [], work = new ReadWork(run => { turns.push(run); return turns.length; },
    (watch, state) => watch.queueEpisode?.(state === 'queued'));
  const history = new ReadObservation(keep), approvals = new ReadApprovals();
  t.after(() => { work.clear(); approvals.close(); history.retire(); });
  history.publish(ready(['old message'])); approvals.approve(history.snapshot);
  history.followers.add(() => () => reads.push(history.read(null)));
  const historyRun = async () => { history.reload(); };
  history.reload(true, { queued: true }); work.schedule(history, historyRun);
  await drain(); t.mock.timers.tick(100);
  // A new commit arrives after the first attempt became stale. Eight held slots
  // and 64 earlier observations force the history retry to wait for capacity.
  for (let i = 0; i < 72; i++) {
    const decoration = new ReadObservation();
    work.schedule(decoration, () => new Promise(resolve => releases.push(resolve)));
  }
  history.reload(true, { queued: true }); work.schedule(history, historyRun);
  while (turns.length) { turns.shift()(); await drain(); }
  assert.equal(releases.length, 8);
  t.mock.timers.tick(5000); await drain();
  assert.deepEqual(history.read(null).data, ['old message'], 'queued history must retain data');
  assert.deepEqual(approvals.get(history.snapshot).read().data, ['old message'], 'facade shares paused budget');
  assert.ok(reads.every(read => 'data' in read && read.data.length), 'no transient loading or empty publication');
  for (let wave = 0; wave < 9; wave++) {
    releases.splice(0).forEach(resolve => resolve()); await drain();
    while (turns.length) { turns.shift()(); await drain(); }
  }
  t.mock.timers.tick(899);
  assert.ok('data' in history.read(null), 'only 999 ms of budget consumed');
  t.mock.timers.tick(1);
  assert.ok('loading' in history.read(null), 'remaining budget expires without renewal');
});

test('inspection groups shared observations, measures queue/attempt time, and records bounded withdrawal causes', async t => {
  const { ObservationWork, forwardInspection } = await import('../dist/observation-work.js');
  const { inspect } = await import('../dist/inspection.js');
  t.mock.timers.enable({ apis: ['Date', 'setTimeout'], now: 1000 });
  let now = 0; t.mock.method(performance, 'now', () => now);
  const work = new ObservationWork(), watches = new Map(), release = [];
  const client = { observe() {} }, facade = { observe() {} }; let valid = true;
  work.bind(client, watches); forwardInspection(facade, client, () => valid);
  t.after(() => { work.clear(); for (const w of watches.values()) w.retire(); });
  for (let i = 0; i < 20; i++) {
    const watch = Object.assign(new ReadObservation(), { op: { name: i < 10 ? 'history' : 'reactionRows' }, subscribers: new Set([() => {}, () => {}]) });
    watch.publish(ready(['secret content'])); watch.reload(true, { queued: true }); watches.set(String(i), watch);
    work.schedule(watch, async () => { watch.reload(); await new Promise(resolve => release.push(resolve)); watch.publish(ready(['new'])); });
  }
  assert.deepEqual(inspect(client).totals, { observations: 20, subscribers: 40, queued: 20, inFlight: 0, revalidating: 20, withdrawn: 0, loading: 0 });
  await drain();
  const held = inspect(facade);
  assert.equal(held.totals.queued, 12); assert.equal(held.totals.inFlight, 8);
  assert.deepEqual(held.queries.map(q => [q.name,q.observations,q.queued,q.inFlight]), [['history',10,2,8],['reactionRows',10,10,0]]);
  now = 50; t.mock.timers.tick(50); release.splice(0).forEach(resolve => resolve()); await drain();
  assert.equal(inspect(client).latency.samples, 8);
  assert.deepEqual(inspect(client).latency.attemptMs, {p50:50,p95:50,max:50});
  assert.equal(inspect(client).totals.inFlight, 8);
  const victim = watches.get('19'); victim.expire()();
  assert.equal(inspect(client).totals.withdrawn, 1);
  assert.equal(inspect(client).recentWithdrawals.at(-1).cause, 'expiry');
  victim.publish(ready(['x'])); victim.reset({ denied: { code:'NOT_MEMBER', message:'no', family:'rule' } });
  assert.deepEqual(inspect(client).recentWithdrawals.at(-1), { at:1050, query:'reactionRows', cause:'denied', code:'NOT_MEMBER' });
  for (let i = 0; i < 80; i++) { victim.publish(ready(['x'])); victim.reset({loading:true}); }
  assert.equal(inspect(client).recentWithdrawals.length, 64);
  assert.ok(!JSON.stringify(inspect(client)).includes('secret content'));
  held.totals.queued = 999; assert.notEqual(inspect(client).totals.queued,999);
  now = 100; t.mock.timers.tick(50); release.splice(0).forEach(resolve => resolve()); await drain();
  assert.equal(inspect(client).latency.queueMs.p95,50);
  valid = false; assert.equal(inspect(facade).supported,false); assert.equal(inspect(facade).totals.observations,0);
});

for (const boundary of ['expiry','denial','reset']) test(`queued history immediately withdraws on ${boundary}`, async t => {
  t.mock.timers.enable({apis:['setTimeout','Date'],now:1000});
  const history = new ReadObservation(), approvals = new ReadApprovals();
  t.after(() => { history.retire(); approvals.close(); });
  history.publish(ready(['protected'])); approvals.approve(history.snapshot);
  history.reload(true,{queued:true}); history.queueEpisode(true);
  if (boundary === 'expiry') history.expire()();
  else if (boundary === 'denial') history.publish({denied:{code:'NOT_MEMBER',family:'rule',message:'removed'}});
  else history.reset({loading:true});
  assert.ok(!('data' in history.read(null))); assert.ok(!('data' in approvals.get(history.snapshot).read()));
});
