// @ref LLP 3000.023#11 — priority observation uses the ordinary device fences.
import test from 'node:test';
import assert from 'node:assert/strict';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { setup, program, q, m, until } from './helpers/one-shot.mjs';
const { fixture } = await import('./helpers/answers-stay.mjs');
import { setTimeout as delay } from 'node:timers/promises';

const source = program.replace('mutation edit(body: text <=200):', 'mutation edit(body: text <=200): server') + `
table likes:
  owner: principal
  insert <- allow
  public
  sync public
mutation like(): server
  insert likes { owner: viewer }
mutation refuse(): server
  require false else OWN_REFUSAL
query likesCount():
  return likes first 100 by byId
`;
const tiers = ['wasm', 'process', 'app-wasm', 'app-process'];

for (const tier of tiers) for (const outcome of ['sent', 'failed']) {
  test(`${tier}: observation before the held POST reply preserves its own ${outcome} outcome`, async t => {
    const first = Promise.withResolvers(), tail = Promise.withResolvers();
    t.after(() => { first.resolve(); tail.resolve(); });
    let held = false, response, tailSending = false, syncs = 0;
    const operation = outcome === 'sent' ? 'like' : 'refuse';
    const f = await setup(t, tier, { program: source, fetch: async (path, init, send) => {
      if (held && path === '/m/edit') await first.promise;
      const result = await send();
      if (held && path === `/m/${operation}`) {
        response = await result.clone().json(); tailSending = true; await tail.promise;
      }
      if (tailSending && path === '/sync') syncs++;
      return result;
    } });
    const events = []; f.client.onWrite(w => events.push(w)); held = true;
    await f.client.mutate(m('edit'), { body: 'observed-first' }, { waitSeconds: 0 });
    const write = await f.client.mutate(m(operation), {}, { waitSeconds: 0 });
    first.resolve(); await until(() => tailSending);
    const read = await f.client.query(q('item'), {});
    assert.equal(read.data?.body, 'observed-first', JSON.stringify(read));
    assert.ok(syncs > 0, 'the one-shot acquired while the POST response was held');
    // This lookup adopts outcome-qualified sync evidence only. A refused POST
    // cannot acquire a fabricated success from an acknowledgement sequence.
    const before = await f.client.write(write.id);
    assert.equal(before.state, outcome === 'sent' ? 'sent' : 'pending');
    if (outcome === 'sent') assert.equal(before.seq, response.seq);
    tail.resolve();
    await until(() => events.some(w => w.id === write.id));
    await f.client.sync();
    const actual = await f.client.write(write.id);
    assert.equal(actual.state, outcome);
    if (outcome === 'sent') assert.equal(actual.seq, response.seq);
    else assert.equal(actual.why.code, response.why.code);
    assert.equal(events.filter(w => w.id === write.id).length, 1);
    assert.equal((await f.client.query(q('likesCount'), {})).data?.length, outcome === 'sent' ? 1 : 0);
    assert.equal((await f.client.pendingWrites()).length, 0);
  });
}

for (const tier of tiers) test(`${tier}: a new send invalidates an overlap page captured before its receipt`, async t => {
  const first = Promise.withResolvers(), tail = Promise.withResolvers(), page = Promise.withResolvers();
  t.after(() => { first.resolve(); tail.resolve(); page.resolve(); });
  let held = false, tailSending = false, captured = false, laterSending = false;
  const rejected = [];
  const f = await setup(t, tier, { program: source,
    device: core => ({ ...core, async call(request, commit) {
      const result = await core.call(request, commit);
      if (request.op === 'observe_store' && result.denied) rejected.push(result.denied);
      return result;
    } }), fetch: async (path, init, send) => {
      if (held && path === '/m/edit') await first.promise;
      if (held && path === '/m/like') { tailSending = true; await tail.promise; }
      if (held && path === '/m/refuse') laterSending = true;
      const result = await send();
      if (tailSending && path === '/sync' && !captured) { captured = true; await page.promise; }
      return result;
    } });
  held = true;
  await f.client.mutate(m('edit'), { body: 'observed-first' }, { waitSeconds: 0 });
  const write = await f.client.mutate(m('like'), {}, { waitSeconds: 0 });
  await f.client.mutate(m('refuse'), {}, { waitSeconds: 0 });
  first.resolve(); await until(() => tailSending);
  const reading = f.client.query(q('item'), {}); await until(() => captured);
  tail.resolve(); await until(() => laterSending); page.resolve();
  assert.equal((await reading).data?.body, 'observed-first');
  assert.ok(rejected.some(r => /mutation send overlapped/.test(r.message)), JSON.stringify(rejected));
  await f.client.sync();
  assert.equal((await f.client.write(write.id)).state, 'sent');
  assert.equal((await f.client.query(q('likesCount'), {})).data?.length, 1);
});

for (const tier of [...tiers, 'online', 'app-online']) test(`${tier}: custody wait wakes promptly when the link becomes offline`, async t => {
  const gate = Promise.withResolvers(); let held = false, evaluated = false;
  t.after(() => gate.resolve());
  const f = await setup(t, tier, { program: source, fetch: async (path, init, send) => {
    if (held && path === '/m/edit') await gate.promise;
    return send();
  } });
  held = true;
  await f.client.mutate(m('edit'), { body: 'unobserved' }, { waitSeconds: 0 });
  f.controls.boundary = () => { evaluated = true; };
  let done = false;
  const reading = f.client.query(q('item'), {}).then(r => { done = true; return r; });
  await until(() => evaluated); await delay(50); assert.equal(done, false);
  f.link(false);
  assert.equal((await f.client.query(q('profile'), {})).denied?.code, 'E_OFFLINE');
  const read = await Promise.race([reading, delay(1000).then(() => ({ timeout: true }))]);
  assert.equal(read.denied?.code, 'E_OFFLINE', JSON.stringify(read));
});

for (const tier of tiers) for (const change of ['store', 'generation']) {
  test(`${tier}: ${change} adoption during overlap preserves the old POST outcome`, async t => {
    const first = Promise.withResolvers(), tail = Promise.withResolvers();
    t.after(() => { first.resolve(); tail.resolve(); });
    let held = false, tailSending = false, replacement, response, changed = false, changedSync = false;
    const calls = [], events = [];
    const f = await setup(t, tier, { program: source, serverOptions: { watch: true },
      device: core => ({ ...core, async call(request, commit) {
        const result = await core.call(request, commit); calls.push({ request, result }); return result;
      } }), fetch: async (path, init, send) => {
        if (held && path === '/m/edit') await first.promise;
        const headers = new Headers(init.headers); headers.delete('authorization'); headers.set('x-snapback-persona', 'bob');
        const result = replacement ? await fetch(replacement.url + path, { ...init, headers }) : await send();
        if (changed && path === '/sync') changedSync = true;
        if (held && path === '/m/like') { response = await result.clone().json(); tailSending = true; await tail.promise; }
        return result;
      } });
    f.client.onWrite(w => events.push(w)); held = true;
    const head = await f.client.mutate(m('edit'), { body: 'observed-first' }, { waitSeconds: 0 });
    const write = await f.client.mutate(m('like'), {}, { waitSeconds: 0 });
    first.resolve(); await until(() => tailSending);
    if (change === 'store') {
      replacement = await fixture(t, source);
      await replacement.post('/m/edit', { id: 'replacement-image', args: { body: 'new-store' } });
    } else {
      const previous = await (await fetch(f.url + '/schema', { headers: { 'x-snapback-persona': 'bob' } })).json();
      writeFileSync(join(f.dir, 'snapback/schema.q'), source + '\nquery newGeneration():\n  return 2\n');
      await until(async () => (await (await fetch(f.url + '/schema', { headers: { 'x-snapback-persona': 'bob' } })).json()).generation > previous.generation);
    }
    changed = true;
    const reading = f.client.query(q('item'), {});
    await until(() => changedSync);
    assert.equal(calls.some(c => c.request.op === 'adopt'), false, 'adoption keeps FIFO with the outstanding POST');
    tail.resolve();
    const read = await reading;
    assert.equal(read.data?.body, change === 'store' ? 'new-store' : 'observed-first', JSON.stringify(read));
    await until(() => calls.some(c => c.request.op === 'adopt' && !c.result.denied));
    tail.resolve(); await until(() => events.some(w => w.id === write.id));
    await f.client.sync();
    for (const id of [head.id, write.id]) {
      const actual = await f.client.write(id);
      assert.equal(actual.state, 'sent', JSON.stringify(actual));
      assert.equal(events.filter(w => w.id === id).length, 1);
    }
    assert.equal((await f.client.write(write.id)).seq, response.seq);
    const finalRead = await f.client.query(q('likesCount'), {});
    assert.equal(finalRead.data?.length, change === 'store' ? 0 : 1, JSON.stringify({ finalRead, pending: await f.client.pendingWrites() }));
  });
}
