// @ref LLP 3000.029#7 — authorization, evidence delivery, replica apply and
// request completion are independently scheduled. The oracle owns only history.
import test from 'node:test';
import assert from 'node:assert/strict';
import { setImmediate as turn } from 'node:timers/promises';
import { ReadObservation } from '../dist/read-observation.js';
import { ReadIndex } from '../dist/read-index.js';
import { reconcileLocalRead } from '../dist/local-read-publication.js';
import { LocalReads } from '../dist/local-reads.js';
import { evaluateLocal } from '../dist/local-query.js';
import { AssetLifetime, assetEvidence } from '../dist/asset-lifetime.js';
const op = { name: 'secret', kind: 'query' }, key = 'secret:{}';
const queries = ['secret', 'alias', 'list', 'remoteSecret'].map(name => ({ name, kind: 'query' }));
const shape = (name, grants, args) => {
  const row = id => grants[id] === null ? null : { id, grant: grants[id] };
  return name === 'alias' ? { row: row('A') } : name === 'list'
    ? (args.only ? ['B'] : ['A', 'B']).map(row).filter(Boolean) : row('A');
};
const tables = new Set(['secrets', 'members']);
const ready = data => ({ data, complete: true, fresh: true, cut: null });

// No imports from production in this reference state machine. Advancing the
// server is distinct from learning of its revocation or applying it locally.
class AuthorityHistory {
  epoch = 0; cut = 1; grants = { A: 1, B: 1 }; revokedThrough = { A: 0, B: 0 };
  replica = { cut: 1, grants: { A: 1, B: 1 } };
  log = [{ cut: 1, grants: { A: 1, B: 1 } }];
  change(allow, row) { this.cut++; this.grants = { ...this.grants, [row]: allow ? this.cut : null }; this.log.push({ cut: this.cut, grants: { ...this.grants } }); }
  learn(cut) { for (const event of this.log) if (event.cut <= cut) for (const row of ['A', 'B']) if (event.grants[row] === null) this.revokedThrough[row] = Math.max(this.revokedThrough[row], event.cut); }
  apply() { this.replica = { cut: this.cut, grants: { ...this.grants } }; this.learn(this.cut); }
  assert(read, label) {
    const inspect = value => {
      if (!value || typeof value !== 'object') return;
      if ('grant' in value) assert.ok(value.grant > this.revokedThrough[value.id], `${label}: disclosed ${value.id} grant ${value.grant} after evidence ${this.revokedThrough[value.id]}`);
      for (const child of Object.values(value)) inspect(child);
    }; inspect(read.data);
  }
}

for (const seed of Array.from({ length: 40 }, (_, i) => i + 1)) test(`independent fence model seed ${seed}`, async () => {
  const model = new AuthorityHistory(), reads = new LocalReads(); reads.applied(1);
  const watches = Array.from({ length: 8 }, (_, i) => Object.assign(new ReadObservation([undefined, false, true][i % 3]), {
    op: queries[i % 4], args: i % 4 === 2 ? { only: i > 3 } : {}, tables: new Set(tables), subscribers: new Set(), presenceRefresh: null,
  }));
  const index = new ReadIndex(); watches.forEach((watch, i) => index.set(String(i), watch));
  const requests = [], evaluations = new Set(), trace = [];
  let random = seed;
  const rand = n => { random = (Math.imul(random, 1664525) + 1013904223) >>> 0; return (random >>> 8) % n; };
  const check = label => { for (const watch of watches) model.assert(watch.read(null), `${seed}:${label}; ${trace.slice(-12).join(',')}`); };
  const start = watch => {
    const op = watch?.op ?? queries[rand(queries.length)], args = watch?.args ?? { only: !!rand(2) };
    const evidenceSerial = reads.evidenceSerial;
    watch?.reload();
    const authority = reads.revision, epoch = model.epoch;
    const env = {
      backend: { generation: 1, schema: { tables: {} }, programs: queries.filter(op => op.name !== 'remoteSecret').map(op => ({ name: op.name, runs: op.name === 'remoteSecret' ? 'server' : 'device', body: [{ Return: { Get: { table: 'secrets' } } }, { table: 'members' }] })) },
      partitionDenied: null, credentialRevision: 0, incarnation: 0, get authority() { return reads.revision; },
      evidenceMinimum: (key, deps) => reads.minimum(key, deps), replicaBlocked: (key, deps) => reads.blocked(key, deps),
      refreshing: null, link: 'online', caughtUp: true, identityChecked: true, lastSyncAt: 0,
      principal: 'bob', partitionCurrent: true, nativeReady: true, signal: new AbortController().signal,
      unavailable: () => null, queued: async () => [], installNative: async () => false, notify: () => {},
      deviceNow: () => 1000, serverNow: () => 1000, offline: () => ({ code: 'E_OFFLINE' }), serverAnswers: reads.serverAnswers.view(),
      call: async () => {
        const grants = { ...model.replica.grants };
        return new Promise(resolve => requests.push({ origin: 'replica', complete: () => resolve({ ok: { data: shape(op.name, grants, args), complete: true, unknown: false, tables: [...tables] } }) }));
      },
      post: async () => {
        const cut = model.cut, grants = { ...model.grants };
        return new Promise(resolve => requests.push({ origin: 'server', complete: () => {
          // Receipt of an authoritative cut is independently observed evidence.
          // Older delivered replies cannot undo any already learned revocation.
          if (epoch === model.epoch) model.learn(cut);
          resolve({ ok: true, obsoleteAuth: false, json: { data: shape(op.name, grants, args), seq: cut, tables: [...tables] } });
        } }));
      },
    };
    const evaluation = evaluateLocal(env, op, args, 0, authority).then(result => {
      if (authority !== reads.revision) return;
      const accepted = reconcileLocalRead(reads, index, env.backend, { ...result, op, args, evidenceSerial }, () => {
        watch?.update(result.read); return true;
      }, () => {}, watch);
      if (accepted) model.assert(result.read, `direct completion ${op.name} seq=${result.seq} server=${result.serverOnly} applied=${JSON.stringify(model.replica)} history=${JSON.stringify(model.log.slice(-8))} trace=${trace.slice(-20)}`); check('completion');
    });
    evaluations.add(evaluation); evaluation.finally(() => evaluations.delete(evaluation));
  };
  for (let step = 0; step < 160; step++) {
    const event = rand(10); trace.push(event);
    if (event === 0) model.change(false, rand(2) ? 'A' : 'B');
    if (event === 1) model.change(true, rand(2) ? 'A' : 'B');
    if (event === 2) { model.epoch++; model.learn(model.cut); reads.changed(watches, ['members', 'secrets'], model.cut); }
    if (event === 3) { model.epoch++; model.apply(); reads.committed(watches, 'apply', ['members', 'secrets']); reads.applied(model.cut); }
    if (event === 4) start(watches[rand(watches.length)]);
    if (event === 5) start(undefined);
    if (event === 6 && requests.length) requests.splice(rand(requests.length), 1)[0].complete();
    if (event === 7) { // an unrelated prediction cannot apply authority evidence
      model.epoch++;
      const before = watches.map(w => w.snapshot);
      reads.committed(watches, 'admit', ['notes']);
      for (let i = 0; i < watches.length; i++) if (watches[i].retain && 'data' in before[i]) assert.equal(watches[i].snapshot.data, before[i].data, 'plain revalidation has no loading flash');
    }
    if (event === 8 || event === 9) {
      if (event === 9) start(watches[rand(watches.length)]);
      while (requests.length || evaluations.size) { if (requests.length) requests.splice(rand(requests.length), 1)[0].complete(); await turn(); }
    }
    await turn(); check(step);
  }
  while (requests.length || evaluations.size) { if (requests.length) requests.shift().complete(); await turn(); }
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
