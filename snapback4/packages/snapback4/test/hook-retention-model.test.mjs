// @ref LLP 3000.029#7 — authorization, evidence delivery, replica apply and
// request completion are independently scheduled. The oracle owns only history.
import test from 'node:test';
import assert from 'node:assert/strict';
import { setImmediate as turn } from 'node:timers/promises';
import { ReadObservation, invalidateReadEvidence } from '../dist/read-observation.js';
import { LocalReads } from '../dist/local-reads.js';
import { evaluateLocal } from '../dist/local-query.js';
import { AssetLifetime, assetEvidence } from '../dist/asset-lifetime.js';
const op = { name: 'secret', kind: 'query' }, key = 'secret:{}';
const tables = new Set(['secrets', 'members']);
const ready = data => ({ data, complete: true, fresh: true, cut: null });

// No imports from production in this reference state machine. Advancing the
// server is distinct from learning of its revocation or applying it locally.
class AuthorityHistory {
  epoch = 0; cut = 1; grant = 1; revokedThrough = 0; replica = { cut: 1, grant: 1 };
  log = [{ cut: 1, grant: 1 }];
  change(allow) { this.log.push({ cut: ++this.cut, grant: this.grant = allow ? this.cut : null }); }
  learn(cut) { for (const event of this.log) if (event.cut <= cut && event.grant === null) this.revokedThrough = Math.max(this.revokedThrough, event.cut); }
  apply() { this.replica = { cut: this.cut, grant: this.grant }; this.learn(this.cut); }
  assert(read, label) { if (read.data) assert.ok(read.data.grant > this.revokedThrough, `${label}: disclosed grant ${read.data.grant} after evidence ${this.revokedThrough}`); }
}

for (const seed of Array.from({ length: 40 }, (_, i) => i + 1)) test(`independent fence model seed ${seed}`, async () => {
  const model = new AuthorityHistory(), reads = new LocalReads(); reads.applied(1);
  const watches = [undefined, false, true].map(keep => Object.assign(new ReadObservation(keep), {
    op, args: {}, tables: new Set(tables), subscribers: new Set(), presenceRefresh: null,
  }));
  const requests = [], evaluations = new Set(), trace = [];
  let random = seed;
  const rand = n => { random = (Math.imul(random, 1664525) + 1013904223) >>> 0; return (random >>> 8) % n; };
  const check = label => { for (const watch of watches) model.assert(watch.read(null), `${seed}:${label}; ${trace.slice(-12).join(',')}`); };
  const start = watch => {
    watch?.reload();
    const authority = reads.revision, epoch = model.epoch;
    const env = {
      backend: { generation: 1, schema: { tables: {} }, programs: [{ name: 'secret', body: [{ Return: { Get: { table: 'secrets' } } }, { table: 'members' }] }] },
      partitionDenied: null, credentialRevision: 0, incarnation: 0, get authority() { return reads.revision; },
      evidenceMinimum: (key, deps) => reads.minimum(key, deps), replicaBlocked: (key, deps) => reads.blocked(key, deps),
      refreshing: null, link: 'online', caughtUp: true, identityChecked: true, lastSyncAt: 0,
      principal: 'bob', partitionCurrent: true, nativeReady: true, signal: new AbortController().signal,
      unavailable: () => null, queued: async () => [], installNative: async () => false, notify: () => {},
      deviceNow: () => 1000, serverNow: () => 1000, offline: () => ({ code: 'E_OFFLINE' }), serverAnswers: reads.serverAnswers.view(),
      call: async () => {
        const grant = model.replica.grant;
        return new Promise(resolve => requests.push({ origin: 'replica', complete: () => resolve({ ok: { data: grant ? { grant } : null, complete: true, unknown: false, tables: [...tables] } }) }));
      },
      post: async () => {
        const cut = model.cut, grant = model.grant;
        return new Promise(resolve => requests.push({ origin: 'server', complete: () => {
          // Receipt of an authoritative null is independently observed evidence.
          // Older delivered replies cannot undo any already learned revocation.
          if (!grant && epoch === model.epoch) model.learn(cut);
          resolve({ ok: true, obsoleteAuth: false, json: { data: grant ? { grant } : null, seq: cut, tables: [...tables] } });
        } }));
      },
    };
    const evaluation = evaluateLocal(env, op, {}, 0, authority).then(result => {
      if (authority !== reads.revision) return;
      if (result.invalidated) {
        reads.replacement(key, result.seq);
        invalidateReadEvidence(watches, op, {}, result.read);
      }
      if (watch && (!reads.blocked(key, tables) || result.serverOnly || 'loading' in result.read)) watch.update(result.read);
      model.assert(result.read, 'direct completion'); check('completion');
    });
    evaluations.add(evaluation); evaluation.finally(() => evaluations.delete(evaluation));
  };
  for (let step = 0; step < 160; step++) {
    const event = rand(8); trace.push(event);
    if (event === 0) model.change(false);
    if (event === 1) model.change(true);
    if (event === 2) { model.epoch++; model.learn(model.cut); reads.changed(watches, ['members', 'secrets'], model.cut); }
    if (event === 3) { model.epoch++; model.apply(); reads.committed(watches, 'apply', ['members', 'secrets']); reads.applied(model.cut); }
    if (event === 4) start(watches[rand(3)]);
    if (event === 5) start(undefined);
    if (event === 6 && requests.length) requests.splice(rand(requests.length), 1)[0].complete();
    if (event === 7) { // an unrelated prediction cannot apply authority evidence
      model.epoch++;
      const before = watches.map(w => w.snapshot);
      reads.committed(watches, 'admit', ['notes']);
      for (let i = 0; i < 3; i++) if (i !== 1 && 'data' in before[i]) assert.equal(watches[i].snapshot.data, before[i].data, 'plain revalidation has no loading flash');
    }
    await turn(); check(step);
  }
  while (requests.length || evaluations.size) { for (const request of requests.splice(0)) request.complete(); await turn(); }
  for (const watch of watches) watch.retire();
});

test('Grok: every next-sequence asset revocation retires the previous grant', () => {
  for (let grant = 0; grant < 100; grant++) for (const delta of [-1, 0, 1, 2]) {
    const lifetime = new AssetLifetime();
    const handle = lifetime.own(assetEvidence({ url: 'blob:secret', type: 'image/png', bytes: 1, revoke() {} }, { seq: grant }));
    lifetime.invalidate(grant + delta);
    assert.equal(handle.url === '', delta > 0, `grant=${grant} event=${grant + delta}`); handle.revoke();
  }
});

test('an already requested sync cannot discharge a later unknown-cut replacement', () => {
  const reads = new LocalReads(), beforeRequest = reads.evidenceSerial;
  reads.replacement(key);
  reads.applied(10, true, beforeRequest);
  assert.equal(reads.blocked(key, tables), true);
  reads.applied(10, true, reads.evidenceSerial);
  assert.equal(reads.blocked(key, tables), false);
});
