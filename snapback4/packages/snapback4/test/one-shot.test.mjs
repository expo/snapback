// @ref LLP 3000.023#11 — one-shot reads settle through the existing publication fences.
import test from 'node:test';
import assert from 'node:assert/strict';
import { setup, q, m, until } from './helpers/one-shot.mjs';
import { existence } from '../dist/contract.js';
import { answerObservation } from '../dist/read-observation.js';

const tiers = ['online', 'wasm', 'process', 'app-online', 'app-wasm', 'app-process'];
function record(t, read) { t.diagnostic(JSON.stringify(read)); return read; }
for (const tier of tiers) {
  test(`${tier}: online-only view settles with link up and refuses offline without a served answer`, async t => {
    const f = await setup(t, tier), { client } = f;
    const read = record(t, await client.query(q('insights'), {}));
    assert.equal(read.data, 1);
    assert.equal(existence(read), 'present');
    await f.offline();
    const remembered = record(t, await client.query(q('insights'), {}));
    if (tier.endsWith('online')) assert.equal(remembered.denied?.code, 'E_OFFLINE');
    else { assert.equal(remembered.data, 1); assert.equal(remembered.fresh, false); }
    // A different key has no remembered answer to recover.
    const offline = record(t, await client.query(q('profile'), {}));
    assert.equal(offline.denied?.code, 'E_OFFLINE');
  });
  test(`${tier}: concurrent write retires the final continuation and query rereads`, async t => {
    const f = await setup(t, tier), { client } = f;
    let fired = false;
    f.controls.boundary = async () => {
      if (fired) return; fired = true;
      const write = await client.mutate(m('edit'), { body: 'own-write' });
      assert.ok(['sent', 'pending'].includes(write.state));
    };
    const read = record(t, await client.query(q('item'), {}));
    assert.equal(fired, true);
    assert.equal(read.data?.body, 'own-write');
  });
  test(`${tier}: deadline crossed after evaluation rereads before return`, async t => {
    const realNow = Date.now; let offset = 0;
    t.mock.method(Date, 'now', () => realNow() + offset);
    let armed = false;
    const f = await setup(t, tier, { fetch: async (path, init, send) => {
      const response = await send();
      if (!armed || path !== '/q/profile') return response;
      const json = await response.json(); json.nextExpiry = Date.now() + 60_000;
      return Response.json(json);
    } });
    armed = true; let fired = false;
    f.controls.boundary = async result => {
      if (fired || !('data' in result.read)) return;
      fired = true; armed = false;
      offset = 120_000;
    };
    const read = record(t, await f.client.query(q('profile'), {}));
    assert.equal(fired, true);
    assert.equal(read.data?.name, 'Bob');
  });
}

for (const tier of ['wasm', 'process', 'app-wasm', 'app-process']) {
  test(`${tier}: an unavailable held online-only view refuses instead of returning loading`, async t => {
    const f = await setup(t, tier);
    const up = record(t, await f.client.query(q('heldInsights'), {}));
    assert.equal(up.denied?.code, 'E_QUERY_RETRY');
    await f.offline();
    const down = record(t, await f.client.query(q('heldInsights'), {}));
    assert.equal(down.denied?.code, 'E_OFFLINE');
  });
  for (const up of [true, false]) test(`${tier}: online-only view with an admitted unobserved write, link ${up ? 'up' : 'down'}`, async t => {
    const gate = Promise.withResolvers(); let held = false;
    t.after(() => gate.resolve());
    const f = await setup(t, tier, { fetch: async (path, init, send) => {
      if (held && path === '/m/send') await gate.promise;
      return send();
    } });
    if (!up) await f.offline();
    held = true;
    const write = await f.client.mutate(m('send'), { body: 'before-read' }, { waitSeconds: 0 });
    assert.equal(write.state, 'pending');
    t.diagnostic(JSON.stringify(await f.client.pendingWrites()));
    const read = record(t, await f.client.query(q('insights'), {}));
    assert.equal(read.denied?.code, up ? 'E_QUERY_RETRY' : 'E_OFFLINE');
    assert.equal(read.denied.retryable, true);
  });
}

for (const tier of tiers) test(`${tier}: a mounted answer's withdrawn deadline cannot return loading to a one-shot`, async t => {
  const realNow = Date.now; let offset = 0, withExpiry = true;
  t.mock.method(Date, 'now', () => realNow() + offset);
  const deadline = realNow() + 60_000;
  const f = await setup(t, tier, { fetch: async (path, init, send) => {
    const response = await send();
    if (!withExpiry || path !== '/q/profile') return response;
    const json = await response.json(); json.nextExpiry = deadline;
    return Response.json(json);
  } });
  const watch = f.client.observe(q('profile'), {}); watch.subscribe(() => {}); t.after(() => watch.close());
  await until(() => 'data' in watch.getSnapshot());
  const owner = answerObservation(watch.getSnapshot());
  let fired = false;
  f.controls.boundary = async () => {
    if (fired) return; fired = true;
    offset = 120_000; owner.read(null); offset = 0;
    assert.ok(owner.expiredServerDeadline >= deadline, 'a real expiry check latched the owner floor');
    withExpiry = false;
  };
  const read = record(t, await f.client.query(q('profile'), {}));
  assert.equal(fired, true); assert.equal(read.data?.name, 'Bob');
});

for (const tier of ['app-online', 'app-wasm', 'app-process']) test(`${tier}: a write during facade approval forces another read`, async t => {
  const f = await setup(t, tier); let evaluated = false, fired = false;
  f.controls.boundary = async () => { evaluated = true; };
  f.controls.authority = async raw => {
    if (!evaluated || fired) return; fired = true;
    assert.ok(['sent', 'pending'].includes((await raw.mutate(m('edit'), { body: 'approved-write' })).state));
  };
  const read = record(t, await f.client.query(q('item'), {}));
  assert.equal(fired, true); assert.equal(read.data?.body, 'approved-write');
});

for (const tier of tiers) test(`${tier}: mounted observations do not starve a one-shot`, async t => {
  let held = false, starts = 0;
  const gates = [], watches = [];
  t.after(() => { held = false; gates.forEach(g => g.resolve()); watches.forEach(w => w.close()); });
  const f = await setup(t, tier, { fetch: async (path, init, send) => {
    if (held && path === '/q/keyed') { starts++; const gate = Promise.withResolvers(); gates.push(gate); await gate.promise; }
    return send();
  }, device: core => ({ ...core, async call(request, commit) {
    if (held && request.op === 'query' && request.name === 'keyed') {
      starts++; const gate = Promise.withResolvers(); gates.push(gate); await gate.promise;
    }
    return core.call(request, commit);
  } }) });
  held = true;
  for (let n = 0; n < 32; n++) { const watch = f.client.observe(q('keyed'), { tag: n }); watch.subscribe(() => {}); watches.push(watch); }
  await until(() => starts >= 8);
  const read = record(t, await f.client.query(q('insights'), {}));
  assert.equal(read.data, 1);
});
