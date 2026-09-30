// @ref LLP 3000.023#10 — a previous local answer cannot fence the next server fallback or refusal.
import test from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { fetch } from 'undici';
import { createLocalClient } from '../dist/local.js';
import { answerObservation } from '../dist/read-observation.js';
import { fixture, source, opener, q, parked, until } from './helpers/answers-stay.mjs';

const program = source + `
query transition(cutoff: time):
  if now >= cutoff:
    require exists profiles['bob'] else MISSING
  return messages['item']
query emptyTransition(cutoff: time):
  if now >= cutoff:
    require exists profiles['bob'] else MISSING
    return messages['missing']
  return messages['item']
query presentTransition(cutoff: time):
  if now >= cutoff:
    require exists profiles['bob'] else MISSING
    return messages['item']
  return messages['missing']
query heldItem() held:
  return messages['item']
`;
async function turns(t, predicate, label) {
  const end = performance.now() + 5000;
  while (!predicate() && performance.now() < end) {
    t.mock.timers.tick(0);
    await new Promise(resolve => setImmediate(resolve));
  }
  assert.ok(predicate(), label);
}
for (const host of ['process', 'wasm']) for (const scenario of ['transition', 'emptyTransition', 'presentTransition', 'refusal', 'held-refusal']) {
  test(`${host}: pending cut preserves ${scenario} before sync publication`, async t => {
    const f = await fixture(t, program), device = opener(host, join(f.dir, host));
    const transition = ['transition', 'emptyTransition', 'presentTransition'].includes(scenario);
    const cutoff = Date.now() + 1000;
    let frozen = false, afterCutoff = false, deliver, holdSync = false, syncEntered = false, serverRequests = 0, localQueries = 0;
    const sync = Promise.withResolvers();
    const client = await createLocalClient({ url: f.url, persona: 'bob', device: { async open(...args) {
      const core = await device.open(...args);
      return { ...core, call(request, committed) {
        if (request.op === 'query') {
          localQueries++;
          // Advance only this query's device evaluation time across the branch.
          // The server is past the same cutoff by the time we deliver the change.
          if (transition && request.name === scenario) request = { ...request, now: afterCutoff ? cutoff : cutoff - 1 };
        }
        return core.call(request, committed);
      } };
    } }, fetch: async (input, init) => {
      const path = new URL(input).pathname;
      if (path === '/changes') return new Promise((resolve, reject) => {
        deliver = resolve;
        init.signal.addEventListener('abort', () => reject(init.signal.reason), { once: true });
      });
      if (path === '/probe' && holdSync) return parked(init.signal);
      if (path.startsWith('/q/')) serverRequests++;
      if (path === '/sync' && holdSync) {
        syncEntered = true;
        return Promise.race([sync.promise, parked(init.signal)]);
      }
      return fetch(input, init);
    } });
    t.after(async () => {
      const closing = client.close();
      // Drain the failed-follow sleep before restoring timers, even on a red.
      if (frozen) { t.mock.timers.tick(1000); t.mock.timers.reset(); }
      await closing;
    });
    await client.sync();
    const name = transition ? scenario : scenario === 'held-refusal' ? 'heldItem' : 'item';
    const args = transition ? { cutoff } : {};
    const watch = client.observe(q(name), args); watch.subscribe(() => {});
    t.after(() => watch.close());
    await until(() => (scenario === 'presentTransition' ? watch.getSnapshot().existence === 'absent' : watch.getSnapshot().data?.body === 'image-1') && deliver);
    assert.equal(watch.getSnapshot().existence, scenario === 'presentTransition' ? 'absent' : 'present');
    const publications = []; watch.subscribe(() => publications.push(watch.getSnapshot()));
    const owner = answerObservation(watch.getSnapshot());
    assert.equal(owner.serverRead, false, 'initial answer is local');
    assert.equal(serverRequests, 0);
    const head = await fetch(f.url + '/changes?since=0&wait=0', { headers: { 'x-snapback-persona': 'bob' } }).then(r => r.json());
    if (transition) await new Promise(resolve => setTimeout(resolve, Math.max(0, cutoff - Date.now() + 1)));
    const committed = await f.post('/m/edit', { id: crypto.randomUUID(), args: { body: 'image-2' } });
    assert.equal(committed.state, 'sent');
    const change = await fetch(f.url + '/changes?since=' + head.seq + '&wait=0', { headers: { 'x-snapback-persona': 'bob' } }).then(r => r.json());
    assert.ok(change.seq > head.seq);
    assert.ok(change.tables.includes('messages'));
    afterCutoff = true; holdSync = true;
    const before = localQueries;
    t.mock.timers.enable({ apis: ['setTimeout'] }); frozen = true;
    deliver(Response.json(change));
    await turns(t, () => syncEntered, 'notification starts sync');
    if (transition) {
      await turns(t, () => (scenario === 'emptyTransition' ? watch.getSnapshot().data === null : watch.getSnapshot().data?.body === 'image-2') && !watch.getSnapshot().revalidating,
        'new branch obtains a current whole-server answer while sync remains held');
      assert.equal(watch.getSnapshot().existence, scenario === 'emptyTransition' ? 'absent' : 'present',
        'fallback classifies its own value rather than the previous local answer');
      for (const read of publications) if ('data' in read) assert.equal(read.existence, read.data === null ? 'absent' : 'present');
      assert.ok(serverRequests > 0);
      assert.equal(owner.serverOnly, true);
      assert.equal(owner.changeCut, change.seq, 'server replacement does not erase the replica fence');
    } else {
      if (scenario === 'held-refusal') {
        await turns(t, () => owner.waitingForSync === true && !owner.running, 'held watch parks before refusal');
        assert.equal(localQueries, before, 'held fallback is statically forbidden');
      }
      const denied = { code: 'E_STORE', family: 'storage', message: 'terminal sync refusal', retryable: false };
      sync.resolve(Response.json({ denied }));
      await turns(t, () => watch.getSnapshot().denied?.code === 'E_STORE', 'mounted watch publishes terminal partition refusal');
      assert.deepEqual(watch.getSnapshot(), { denied });
      assert.equal('existence' in watch.getSnapshot(), false, 'terminal live-cut refusal drops the old discriminant');
      assert.deepEqual(await client.query(q(name), args), { denied }, 'direct and mounted reads agree');
    }
  });
}
