// Handoff schedules use the production SDK and devices; only the wire is modeled.
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setImmediate as tick } from 'node:timers/promises';
import { processDevice } from '../../dist/native.js';
import { nativeAdmission } from '../../dist/native-admission.js';
import { createLocalClient } from '../../dist/local.js';
import { prepareClient } from '../../dist/client-start.js';
import { mintId } from '../../dist/client.js';
import { modelBackend, modelPage, modelDevice } from './app-model-device.mjs';
import { binary } from '../../../../witness/lib.mjs';
const ok = r => { assert.ok(!r.denied, JSON.stringify(r)); return r.ok; };
const entry = () => ({ id: mintId(), op: 'write', args: { hiddenHandle: false, refuse: false }, viewer: 'dev:alice', seq: 1, now: 1, new_ids: [], predicted: [], predictable: false });
const page = (store = 'session-model-store') => ({ ...modelPage(0, { stream: true }), snapshot: false, store_id: store });
const until = async p => { for (let i = 0; i < 1000; i++) { if (await p()) return; await tick(); } assert.fail('handoff boundary not reached'); };
export async function identityPublicationSchedule(native, late, reopen = false) {
  const dir = mkdtempSync(join(tmpdir(), 'ea-identification-'));
  const opener = native ? processDevice({ dir, binary: binary() }) : modelDevice();
  const open = async () => { const raw = await opener.open('publication', { initial_backend: modelBackend }); return native ? nativeAdmission(raw) : raw; };
  let core = await open();
  const now = Date.now; let wall = now(); Date.now = () => wall;
  try {
    const first = entry(); ok(await core.call({ op: 'admit', entry: first, expected_store: 'session-model-store' }));
    wall += late ? 30_001 : 28_000;
    ok(await core.call({ op: 'apply', page: { ...page(), identity_at: wall } }));
    wall += 5_000;
    if (reopen) { await core.close(); core = await open(); }
    const queued = ok(await core.call({ op: 'queued' })).find(e => e.id === first.id);
    if (late) assert.equal(queued.admission_refusal?.code, 'E_ADMISSION_TIMEOUT', 'late identification remains unsent');
    else { assert.equal(queued.admission_refusal, undefined, 'publication before the deadline survives delayed admission'); assert.equal(queued.admission_waiting, undefined); }
  } finally { Date.now = now; await core.close(); rmSync(dir, { recursive: true, force: true }); }
}
export async function nativeHandoffSchedule(kind, variant = 0) {
  const dir = mkdtempSync(join(tmpdir(), 'ea-native-handoff-')), cores = [], release = Promise.withResolvers(), reached = Promise.withResolvers();
  const opener = processDevice({ dir, binary: binary() }), now = Date.now; let wall = now(); Date.now = () => wall;
  const backend = structuredClone(modelBackend);
  if (kind === 'receipt-conflict') backend.programs.push({ ...backend.programs[1], name: 'otherWrite' });
  const open = async () => { const raw = await opener.open('shared', { initial_backend: backend }); cores.push(raw); return raw; };
  try {
    const rawA = await open(), rawB = await open(), first = entry(); let paused = false;
    const a = nativeAdmission({ ...rawA, async call(req, committed) {
      if (kind === 'freeze' && req.op === 'admit' && req.identity_backend && !paused) { paused = true; reached.resolve(); await release.promise; }
      const reply = await rawA.call(req, committed);
      if (kind !== 'freeze' && req.op === 'next_submission' && !paused) { paused = true; reached.resolve(); await release.promise; }
      return reply;
    } }), b = nativeAdmission(rawB);
    const pending = a.call({ op: 'admit', entry: first, expected_store: 'session-model-store' });
    if (kind === 'freeze') {
      ok(await pending); ok(await rawA.call({ op: 'apply', page: page() }));
      const promoting = a.call({ op: 'queued' }); await reached.promise;
      wall += 30_001;
      const peer = ok(await b.call({ op: 'queued' }));
      assert.equal(peer.find(e => e.id === first.id)?.admission_refusal, undefined, 'peer cannot expire the frozen handoff');
      release.resolve(); ok(await promoting);
    } else {
      await reached.promise;
      ok(await rawB.call({ op: 'apply', page: page(kind === 'binding' ? 'replacement' : undefined) }));
      ok(await b.call({ op: 'sync_state' })); ok(await b.call({ op: 'sync_state' }));
      if (kind === 'expiry' || kind === 'receipt-conflict') {
        const peer = kind !== 'receipt-conflict' ? first : variant % 3 === 0 ? { ...first, args: { ...first.args, refuse: true } }
          : variant % 3 === 1 ? { ...first, viewer: 'dev:bob' } : { ...first, op: 'otherWrite' };
        ok(await b.call({ op: 'admit', entry: peer })); ok(await rawB.call({ op: 'begin_send', id: first.id }));
        if (kind === 'receipt-conflict' || variant % 2 === 0) {
          ok(await rawB.call({ op: 'keep_write', value: JSON.stringify({ state: 'sent', id: first.id, seq: 1 }) }));
          ok(await rawB.call({ op: 'settle', id: first.id, seq: 1 }));
          if (kind === 'receipt-conflict') ok(await rawB.call({ op: 'dequeue', id: first.id }));
        }
      }
      release.resolve();
      if (kind === 'receipt-conflict') {
        assert.equal((await pending).denied?.code, 'E_WRITE_ID_REUSE', 'a retired receipt cannot bless different input');
        await a.close(); await b.close();
        return;
      }
      ok(await pending);
      if (kind === 'expiry') wall += 30_001;
      if (kind === 'binding') {
        if (variant % 2) assert.equal((await rawB.call({ op: 'admit', entry: first })).denied?.code, 'E_ADMISSION_STORE', 'device admission independently enforces the captured store');
        else await b.call({ op: 'admit', entry: first });
        assert.equal(ok(await rawB.call({ op: 'queued' })).length, 0, 'replacement must not admit captured intent');
        const deferred = ok(await b.call({ op: 'queued' })).find(e => e.id === first.id);
        assert.equal(deferred.admission_refusal?.code, 'E_ADMISSION_STORE');
      } else if (kind === 'fifo') {
        const second = entry(); ok(await b.call({ op: 'admit', entry: second }));
        assert.deepEqual(ok(await b.call({ op: 'queued' })).map(e => e.id), [first.id, second.id]);
      } else {
        const entries = ok(await a.call({ op: 'queued' }));
        assert.ok(entries.every(e => !e.admission_refusal), JSON.stringify(entries));
        assert.equal(entries.filter(e => e.id === first.id).length, 1, 'one custody view per identity');
      }
    }
    await a.close(); await b.close();
  } finally { release.resolve(); Date.now = now; for (const core of cores) await core.close(); rmSync(dir, { recursive: true, force: true }); }
}

export async function restoreHandoffSchedule(variant = 0) {
  const opener = modelDevice(), events = [], posts = [], reached = Promise.withResolvers(), release = Promise.withResolvers();
  let raw, fail = true, held = false, client;
  const now = Date.now; let wall = now(); Date.now = () => wall;
  const options = { url: `https://restore-${mintId()}.invalid`, persona: 'alice', device: { async open(...args) {
    raw = await opener.open(...args);
    return { ...raw, async call(req, committed) {
      if (req.op === 'keep_write' && fail) {
        if (!held) { held = true; reached.resolve(); await release.promise; }
        if (fail) throw Error('controlled receipt storage failure');
      }
      return raw.call(req, committed);
    } };
  } }, fetch: async (url, init) => {
    const path = new URL(url).pathname;
    if (path === '/schema') return Response.json({ ...modelBackend, store_id: 'session-model-store' });
    if (path === '/sync') return Response.json(modelPage(0, JSON.parse(init.body)));
    if (path.startsWith('/m/')) { posts.push(JSON.parse(init.body)); throw Error('restore must not send'); }
    throw Error('offline');
  } };
  try {
    const prepared = await prepareClient(options, () => createLocalClient(options)); client = prepared.client;
    const head = 10 + variant % 7;
    ok(await raw.call({ op: 'apply', first: true, page: { ...modelPage(head, {}), more: true, next: 'held-page' } }));
    client.onWrite(w => events.push(w));
    const w = await client.mutate({ kind: 'mutation', name: 'write' }, { hiddenHandle: false, refuse: false }, { waitSeconds: 0 });
    assert.equal(w.state, 'pending'); await prepared.start(); wall += 30_001;
    // pendingWrites itself must expose durable custody even with the restore fence.
    assert.equal((await client.pendingWrites()).find(e => e.id === w.id)?.state, 'queued');
    await until(() => held);
    assert.equal(events.length, 0); assert.equal(ok(await raw.call({ op: 'meta', key: 'write-history' })), null); assert.equal(posts.length, 0);
    fail = false; release.resolve();
    await client.sync(); await until(() => events.length === 1);
    assert.equal(events[0].why.code, 'E_ADMISSION_STORE'); assert.deepEqual(await client.write(w.id), events[0]);
    assert.equal((await client.pendingWrites()).length, 0); assert.equal(posts.length, 0);
  } finally { fail = false; release.resolve(); Date.now = now; await client?.close(); }
}

export async function nativePublicationOverlapSchedule() {
  const dir = mkdtempSync(join(tmpdir(), 'ea-publication-overlap-')), opener = processDevice({ dir, binary: binary() });
  const a = await opener.open('shared', { initial_backend: modelBackend }), b = await opener.open('shared', { initial_backend: modelBackend });
  const reached = Promise.withResolvers(), release = Promise.withResolvers(); let held = false;
  const core = nativeAdmission({ ...a, async call(req, committed) {
    const reply = await a.call(req, committed);
    if (req.op === 'meta' && req.key === 'identity-established' && !held) { held = true; reached.resolve(); await release.promise; }
    return reply;
  } });
  const now = Date.now; let wall = now(); Date.now = () => wall;
  try {
    const first = entry(); ok(await core.call({ op: 'admit', entry: first, expected_store: 'session-model-store' }));
    wall += 28_000; const pending = core.call({ op: 'queued' }); await reached.promise;
    ok(await b.call({ op: 'apply', page: { ...page(), identity_at: wall } }));
    wall += 5_000; release.resolve();
    const queued = ok(await pending).find(e => e.id === first.id);
    assert.equal(queued.admission_refusal, undefined, 'expiry commit rechecks the peer publication under custody lock');
  } finally { release.resolve(); Date.now = now; await core.close(); await b.close(); rmSync(dir, { recursive: true, force: true }); }
}
