// @ref LLP 3000.029#10 — epochs fence aliases even when durable seq is unchanged.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createClient } from '../dist/client.js';
import { createLocalClient } from '../dist/local.js';
import { processDevice } from '../dist/native.js';
import { webDevice, memoryPersistence } from '../dist/web.js';
import { EphemeralReads } from '../dist/ephemeral-reads.js';
import { server, until, binary } from './helpers/app-server.mjs';

const q = name => ({ name, kind: 'query' });
const source = `use personas alice
table secrets:
  body: text <=40
  read <- allow
  insert <- allow
  delete <- allow
  ephemeral 60s
mutation put():
  insert secrets { id: 'S', body: 'secret' }
mutation erase():
  delete secrets['S']
query mounted():
  return secrets['S']
query shaped():
  return { row: secrets['S'] }
query evidence():
  return secrets['S']
query delayed():
  return secrets['S']
`;
for (const tier of ['online', 'process', 'wasm']) for (const mode of ['withdrawal', 'buffered direct reply']) {
  test(`round 4 ${tier}: ephemeral replacement fences ${mode} at equal durable cut`, { timeout: 20000 }, async t => {
    const f = await server(t, undefined, source), release = Promise.withResolvers(), buffered = Promise.withResolvers();
    const post = (path, body) => fetch(f.url + path, { method: 'POST', headers: { 'x-snapback-persona': 'alice' }, body: JSON.stringify(body) }).then(r => r.json());
    assert.equal((await post('/m/put', { args: {} })).state, 'sent');
    let hold = false, oldPacket, evidencePacket, checkCallbacks = false;
    const opts = { url: f.url, persona: 'alice', fetch: async (input, init) => {
      const path = new URL(input).pathname;
      if (path === '/changes') return new Promise((_, reject) => {
        const abort = () => reject(Error('closed'));
        if (init.signal.aborted) abort(); else init.signal.addEventListener('abort', abort, { once: true });
      });
      if (hold && ['/q/mounted', '/q/shaped', '/sync'].includes(path)) await release.promise;
      const response = await fetch(input, init);
      if (path === '/q/delayed' && !oldPacket) {
        oldPacket = await response.json(); await buffered.promise;
        return Response.json(oldPacket); // Buffered transport deliberately ignores later abort.
      }
      if (path === '/q/evidence') { evidencePacket = await response.json(); return Response.json(evidencePacket); }
      return response;
    } };
    const device = tier === 'process' ? processDevice({ dir: join(f.dir, 'device'), binary })
      : tier === 'wasm' ? webDevice({ wasm: readFileSync(new URL('../src/wasm/snapback4_device_bg.wasm', import.meta.url)), persist: memoryPersistence() }) : undefined;
    const client = tier === 'online' ? createClient(opts) : await createLocalClient({ ...opts, device });
    const watches = [client.observe(q('mounted'), {}), client.observe(q('shaped'), {}, { keep: true }), client.observe(q('mounted'), {}, { keep: false })];
    const disclosed = () => watches.some(w => w.getSnapshot().data?.body === 'secret' || w.getSnapshot().data?.row?.body === 'secret');
    const callbackDisclosure = [];
    watches.forEach(w => w.subscribe(() => { if (checkCallbacks) callbackDisclosure.push(disclosed()); }));
    t.after(async () => { checkCallbacks = false; hold = false; release.resolve(); buffered.resolve(); watches.forEach(w => w.close()); await client.close(); });
    if (tier !== 'online') await client.sync();
    await until(() => watches.every(w => 'data' in w.getSnapshot()), 'initial ephemeral owners');
    assert.equal(watches[0].getSnapshot().data.body, 'secret');
    hold = true;
    const delayed = client.query(q('delayed'), {});
    await until(() => oldPacket, 'epoch-1 reply buffered');
    assert.equal(oldPacket.seq, 0); assert.equal(oldPacket.ephemeral.epoch, 1);
    assert.deepEqual(oldPacket.tables, ['secrets']);
    assert.equal((await post('/m/erase', { args: {} })).state, 'sent');
    checkCallbacks = true;
    assert.equal((await client.query(q('evidence'), {})).data, null);
    assert.equal(evidencePacket.seq, 0); assert.equal(evidencePacket.ephemeral.epoch, 2);
    assert.deepEqual(evidencePacket.tables, ['secrets']);
    if (mode === 'withdrawal') {
      assert.equal(disclosed(), false, 'all overlapping owners withdraw before refresh');
      assert.ok(callbackDisclosure.length > 0, 'withdrawal notifies subscribers');
      assert.equal(callbackDisclosure.some(Boolean), false, 'all owners withdraw before the first callback');
    }
    buffered.resolve();
    const late = await delayed;
    assert.notEqual(late.data?.body, 'secret', 'direct replies without an owner meet dependency epoch floors');
    checkCallbacks = false; hold = false; release.resolve();
    await until(() => watches[0].getSnapshot().data === null, 'current epoch recovers');
  });
}

for (const tier of ['process', 'wasm']) test(`round 4 ${tier}: epoch evidence in the final publication continuation fences a direct reply`, async t => {
  const f = await server(t, undefined, source), release = Promise.withResolvers();
  const post = (path, body) => fetch(f.url + path, { method: 'POST', headers: { 'x-snapback-persona': 'alice' }, body: JSON.stringify(body) }).then(r => r.json());
  await post('/m/put', { args: {} });
  let packet, evidence, injected = false;
  const client = await createLocalClient({ url: f.url, persona: 'alice', device: tier === 'process'
    ? processDevice({ dir: join(f.dir, 'device'), binary })
    : webDevice({ wasm: readFileSync(new URL('../src/wasm/snapback4_device_bg.wasm', import.meta.url)), persist: memoryPersistence() }),
    fetch: async (input, init) => {
      if (new URL(input).pathname === '/changes') return new Promise((_, reject) => {
        const abort = () => reject(Error('closed'));
        if (init.signal.aborted) abort(); else init.signal.addEventListener('abort', abort, { once: true });
      });
      const response = await fetch(input, init);
      if (new URL(input).pathname === '/q/delayed' && !packet) { packet = await response.json(); await release.promise; return Response.json(packet); }
      return response;
    },
  });
  const accept = EphemeralReads.prototype.accept;
  t.after(async () => { EphemeralReads.prototype.accept = accept; release.resolve(); await client.close(); });
  await client.sync();
  assert.equal((await client.query(q('evidence'), {})).data.body, 'secret');
  const delayed = client.query(q('delayed'), {});
  await until(() => packet);
  await post('/m/erase', { args: {} });
  evidence = await post('/q/evidence', { args: {} });
  assert.equal(evidence.data, null); assert.equal(evidence.ephemeral.epoch, 2);
  // Deliver real server evidence precisely after evaluateLocal's synchronous
  // acceptance, before runLocal/query resumes. This tests the final gate itself.
  EphemeralReads.prototype.accept = function(request, version, ...args) {
    const accepted = accept.call(this, request, version, ...args);
    if (accepted && version?.epoch === 1 && !injected) {
      injected = true;
      queueMicrotask(() => accept.call(this, this.request(['secrets']), evidence.ephemeral));
    }
    return accepted;
  };
  release.resolve();
  assert.notEqual((await delayed).data?.body, 'secret', 'publication must recheck after asynchronous acceptance');
  assert.equal(injected, true);
});
