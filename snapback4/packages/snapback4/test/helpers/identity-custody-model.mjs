// Controlled session-custody schedules over production clients and SQLite.
import assert from 'node:assert/strict';
import { mock } from 'node:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setImmediate as tick } from 'node:timers/promises';
import { processDevice } from '../../dist/native.js';
import { nativeAdmission } from '../../dist/native-admission.js';
import { createClient, mintId } from '../../dist/client.js';
import { onlineCustody } from '../../dist/app-online.js';
import { binary } from '../../../../witness/lib.mjs';
import { modelBackend, modelPage } from './app-model-device.mjs';
const gate = () => Promise.withResolvers();
const ok = reply => { assert.ok(!reply.denied, JSON.stringify(reply)); return reply.ok; };
const entry = (id = mintId()) => ({ id, op: 'write', args: { hiddenHandle: false, refuse: false }, seq: 1, viewer: 'dev:alice', now: 1, new_ids: [], predicted: [], predictable: false });
const until = async predicate => { for (let n = 0; n < 500; n++) { if (await predicate()) return; await tick(); } assert.fail('schedule did not reach its controlled boundary'); };
export async function nativeCustodySchedule(kind, variant = 0) {
  const dir = mkdtempSync(join(tmpdir(), 'sb4-ea-model-')), cores = [], release = gate(), reached = gate();
  const opener = processDevice({ dir, binary: binary() });
  const backend = structuredClone(modelBackend);
  if (kind === 'dedup' && variant % 3 === 2) backend.programs.push({ ...backend.programs[1], name: 'otherWrite' });
  const open = async () => { const core = await opener.open('shared', { initial_backend: backend }); cores.push(core); return core; };
  try {
    const rawA = await open(), rawB = await open(); let paused = false;
    const a = nativeAdmission({ ...rawA, async call(request, committed) {
      const reply = await rawA.call(request, committed);
      if (request.op === 'next_submission' && !paused) { paused = true; reached.resolve(); await release.promise; }
      return reply;
    } });
    ok(await a.call({ op: 'sync_state' })); // first read is protocol-only
    const b = nativeAdmission(rawB), first = entry(), second = entry();
    const pending = a.call({ op: 'admit', entry: first }); await reached.promise;
    if (kind === 'read-overlap') {
      ok(await b.call({ op: 'admit', entry: second }));
      for (let i = 0; i <= variant % 3; i++) ok(await a.call({ op: 'sync_state' }));
      release.resolve(); ok(await pending);
      const records = JSON.parse(ok(await rawB.call({ op: 'meta', key: 'identity-admissions' })));
      assert.deepEqual(new Set(records.map(r => r.entry.id)), new Set([first.id, second.id]), 'accepted custody must survive an unrelated state read');
      await a.close(); await b.close();
      const reopened = nativeAdmission(await open());
      assert.equal(ok(await reopened.call({ op: 'queued' })).length, 2, 'both owners survive reload'); await reopened.close();
    } else {
      const deferredFirst = Math.floor(variant / 3) % 2 === 1;
      if (deferredFirst) { release.resolve(); ok(await pending); }
      ok(await rawB.call({ op: 'apply', page: { ...modelPage(0, { stream: true }), snapshot: false } }));
      const other = { ...first, args: { ...first.args, refuse: true } };
      if (variant % 3 === 1) { other.args = first.args; other.viewer = 'dev:bob'; }
      if (variant % 3 === 2) {
        other.args = first.args; other.op = 'otherWrite';
      }
      const ordinary = await rawB.call({ op: 'admit', entry: other });
      if (!deferredFirst) ok(ordinary);
      release.resolve(); const losing = deferredFirst ? ordinary : await pending;
      assert.equal(losing.denied?.code, 'E_WRITE_ID_REUSE', 'deferred admission must reject input already owned by the ordinary outbox');
      const winner = deferredFirst ? first : other;
      // Exact repeats recover the winner, including its minted ids; key order is irrelevant.
      const replay = ok(await rawB.call({ op: 'admit', entry: { ...winner, args: Object.fromEntries(Object.entries(winner.args).reverse()), new_ids: [mintId()] } }));
      assert.deepEqual(replay.new_ids, winner.new_ids);
      assert.deepEqual(ok(await rawB.call({ op: 'queued' })).map(e => [e.id, e.op, e.args, e.viewer]), [[winner.id, winner.op, winner.args, winner.viewer]]);
      assert.equal(JSON.parse(ok(await rawB.call({ op: 'meta', key: 'identity-admissions' })) ?? '[]').length, deferredFirst ? 1 : 0);
      await a.close(); await b.close();
    }
  } finally { release.resolve(); for (const core of cores) await core.close(); rmSync(dir, { recursive: true, force: true }); }
}
export async function onlineExpirySchedule(settled = false, variant = 0, probeStore) {
  const values = new Map(), clients = [], aProbe = gate(), aReached = gate(), response = gate(), posts = [], outcomes = new Map(), events = [];
  const url = `https://ea-custody-${mintId()}.invalid`;
  const store = { async get(k) { return values.get(k) ?? null; }, async set(k, v) { values.set(k, v); }, async delete(k) { values.delete(k); } };
  const now = Date.now; let wall = now(); Date.now = () => wall;
  mock.timers.enable({ apis: ['setTimeout'] });
  const open = async owner => {
    const raw = createClient({ url, persona: 'alice', fetch: async (input, init) => {
      const path = new URL(input).pathname;
      if (path === '/probe') {
        if (owner === 'A') { aReached.resolve(); await aProbe.promise; if (probeStore) return Response.json({ ok: true, seq: outcomes.size, store_id: probeStore }); throw Error('identity unavailable to A'); }
        return Response.json({ ok: true, seq: outcomes.size, store_id: 'original-store' });
      }
      if (path.startsWith('/m/')) {
        const write = JSON.parse(init.body); posts.push(write);
        const result = outcomes.get(write.id) ?? { state: 'sent', id: write.id, seq: outcomes.size + 1 };
        outcomes.set(write.id, result); await response.promise; return Response.json(result);
      }
      if (path === '/changes') return Response.json({ seq: outcomes.size, store_id: 'original-store' });
      throw Error(`unexpected ${path}`);
    } });
    const custody = await onlineCustody(raw, url, store, error => { throw error; }, false);
    clients.push(custody.client); return custody;
  };
  try {
    const a = await open('A'); a.client.onWrite(write => events.push(write)); const id = mintId();
    assert.equal((await a.client.mutate({ kind: 'mutation', name: 'write' }, { value: variant }, { id, waitSeconds: 0 })).state, 'pending');
    await aReached.promise;
    const b = await open('B'); b.start(); await until(() => posts.length === 1);
    if (settled) { response.resolve(); await until(async () => (await b.client.write(id))?.state === 'sent'); }
    wall += 30_001; aProbe.resolve();
    for (let i = 0; i < 5; i++) { await tick(); mock.timers.tick(1000); await tick(); }
    assert.equal(posts.length, 1, 'a successful late probe cannot duplicate a peer dispatch');
    const current = await a.client.write(id);
    assert.equal(current.state, settled ? 'sent' : 'pending', 'an executed write can never expire as unsent');
    assert.ok(events.every(w => w.state === 'sent'), JSON.stringify(events));
    const journal = JSON.parse([...values.values()][0]);
    if (!settled) assert.equal(journal.pending.find(w => w.id === id)?.dispatched, true, 'in-flight custody stays durable');
    response.resolve(); await until(async () => (await a.client.write(id))?.state === 'sent');
    assert.equal(posts.length, 1); assert.equal(outcomes.size, 1);
    assert.equal((await a.client.write(id)).seq, outcomes.get(id).seq);
    assert.equal(events.length, 1, 'one truthful terminal notification');
  } finally { aProbe.resolve(); response.resolve(); Date.now = now; for (const c of clients) await c.close(); mock.timers.reset(); }
}
