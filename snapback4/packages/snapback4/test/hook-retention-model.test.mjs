// @ref LLP 3000.029#7 — authorization, evidence delivery, replica apply and
// request completion are independently scheduled. The oracle owns only history.
import test from 'node:test';
import assert from 'node:assert/strict';
import { setImmediate as turn } from 'node:timers/promises';
import { ReadObservation, invalidateReadEvidence } from '../dist/read-observation.js';
import { EphemeralReads } from '../dist/ephemeral-reads.js';
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
  apply(cut) { const event = this.log.find(event => event.cut === cut); this.replica = { cut, grants: { ...event.grants } }; this.learn(cut); }
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
    if (event === 3) {
      // A sync page may publish an intermediate cut below evidence already
      // delivered by a read or changes poll. Never turn that into a full apply.
      model.epoch++; const cut = model.replica.cut + rand(model.cut - model.replica.cut + 1);
      model.apply(cut); reads.committed(watches, 'apply', ['members', 'secrets']); reads.applied(cut);
    }
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

test('finite dependency fence survives every intermediate apply for newly opened aliases', () => {
  for (let evidence = 3; evidence <= 50; evidence++) {
    const reads = new LocalReads(); reads.applied(1);
    reads.replacement('remote:{}', evidence, tables);
    for (let cut = 1; cut < evidence; cut++) {
      reads.applied(cut, true);
      assert.equal(reads.blocked(`newAlias${cut}:{}`, tables), true, `apply ${cut} is below evidence ${evidence}`);
      assert.equal(reads.blocked('notes:{}', new Set(['notes'])), false);
    }
    reads.applied(evidence);
    assert.equal(reads.blocked('finalAlias:{}', tables), false);
  }
});

// The ephemeral oracle owns server history and delivered revocations, never
// production floors. Its epoch changes independently of the durable cut.
class EphemeralHistory {
  incarnation = 1; epoch = 1; seq = 0;
  rows = { secrets: 1, signals: 1 };
  log = []; revoked = { secrets: 0, signals: 0 };
  change(table, grant) {
    this.epoch++;
    this.rows[table] = grant ? this.epoch : null;
    if (!grant) this.log.push({ table, epoch: this.epoch });
  }
  packet(deps) {
    return { seq: this.seq, version: { incarnation: String(this.incarnation), epoch: this.epoch },
      data: deps.flatMap(table => this.rows[table] === null ? [] : [{ table, grant: this.rows[table], incarnation: this.incarnation }]) };
  }
  learn(packet, deps) {
    if (packet.version.incarnation !== String(this.incarnation)) return;
    for (const event of this.log) if (deps.includes(event.table) && event.epoch <= packet.version.epoch)
      this.revoked[event.table] = Math.max(this.revoked[event.table], event.epoch);
  }
  restart() { this.incarnation++; this.epoch = 0; this.rows = { secrets: null, signals: null }; this.log = []; this.revoked = { secrets: 0, signals: 0 }; }
  assert(read, label) {
    const walk = value => {
      if (!value || typeof value !== 'object') return;
      if ('grant' in value) {
        assert.equal(value.incarnation, this.incarnation, label + ': retired incarnation');
        assert.ok(value.grant > this.revoked[value.table], `${label}: ${value.table} grant ${value.grant} <= learned revocation ${this.revoked[value.table]}`);
      }
      Object.values(value).forEach(walk);
    }; walk(read.data);
  }
}

for (let seed = 1; seed <= 40; seed++) test(`independent ephemeral epoch model seed ${seed}`, () => {
  const model = new EphemeralHistory(), stop = new AbortController(), ephemeral = new EphemeralReads(stop.signal), index = new ReadIndex();
  ephemeral.accept(ephemeral.request([]), model.packet([]).version);
  const requests = [], publications = [], watches = [], trace = [];
  let random = seed;
  const rand = n => { random = (Math.imul(random, 1664525) + 1013904223) >>> 0; return (random >>> 8) % n; };
  const descriptors = [
    { name: 'point', deps: ['secrets'] }, { name: 'alias', deps: ['secrets'] },
    { name: 'list', deps: ['secrets'] }, { name: 'other', deps: ['signals'] },
    { name: 'joined', deps: ['secrets', 'signals'] },
  ];
  const check = label => { for (const watch of watches) model.assert(watch.read(null), `${seed}:${label}:${trace.slice(-15)}`); };
  const mount = i => {
    const descriptor = descriptors[i % descriptors.length];
    const watch = Object.assign(new ReadObservation([undefined, true, false][i % 3]), {
      descriptor, op: { name: descriptor.name }, args: { subset: i % 2 }, tables: new Set(descriptor.deps), subscribers: new Set([() => check('callback')]),
    });
    watches[i] = watch; index.set(String(i), watch);
    ephemeral.add(watch, descriptor.deps, () => {
      const deliver = watch.reset({ loading: true }, true);
      return () => { deliver(); check('ephemeral callback'); };
    });
  };
  for (let i = 0; i < 10; i++) mount(i);
  const start = owner => {
    const descriptor = owner?.descriptor ?? descriptors[rand(descriptors.length)], args = owner?.args ?? { subset: rand(2) };
    const before = owner?.snapshot; owner?.reload();
    if (owner?.retain && before && 'data' in before) assert.equal(owner.snapshot.data, before.data, 'plain refresh retains');
    requests.push({ owner, descriptor, args, request: ephemeral.request(descriptor.deps), packet: model.packet(descriptor.deps) });
  };
  const receive = candidate => {
    const { packet, descriptor, request, owner } = candidate;
    // A retired request is never evidence, independent of the client's counter.
    if (packet.version.incarnation === String(model.incarnation)) model.learn(packet, descriptor.deps);
    if (ephemeral.accept(request, packet.version, owner)) publications.push(candidate);
    check('receive');
  };
  const publish = candidate => {
    const { packet, descriptor, args, request, owner } = candidate;
    if (owner && !watches.includes(owner)) return;
    if (!ephemeral.valid(request, packet.version)) return;
    const read = ready(descriptor.name === 'alias' ? { rows: packet.data } : packet.data);
    invalidateReadEvidence(index, { name: descriptor.name }, args, read, () => {}, owner, () => { owner?.publish(read); return true; }, new Set(descriptor.deps), packet.seq);
    model.assert(read, 'ownerless/completed answer'); check('publish');
  };
  try {
    for (let step = 0; step < 250; step++) {
      const event = rand(11), table = rand(2) ? 'secrets' : 'signals'; trace.push(event);
      if (event < 2) model.change(table, event === 1);
      if (event === 2) start(watches[rand(watches.length)]);
      if (event === 3) start(undefined);
      if (event === 4 && requests.length) receive(requests.splice(rand(requests.length), 1)[0]);
      if (event === 5 && publications.length) publish(publications.splice(rand(publications.length), 1)[0]);
      if (event === 6) {
        const packet = model.packet([table]); model.learn(packet, [table]);
        ephemeral.changed(ephemeral.pollRequest(), { ...packet.version, tables: [table] });
      }
      if (event === 7) { model.seq++; /* durable apply cannot release ephemeral evidence */ }
      if (event === 8) {
        const i = rand(watches.length); ephemeral.remove(watches[i]); index.delete(String(i)); watches[i].retire(); mount(i);
      }
      if (event === 9) {
        model.restart(); ephemeral.changed(ephemeral.pollRequest(), { ...model.packet([]).version, tables: ['secrets', 'signals'] });
      }
      if (event === 10) {
        while (requests.length) receive(requests.splice(rand(requests.length), 1)[0]);
        while (publications.length) publish(publications.splice(rand(publications.length), 1)[0]);
      }
      check(step);
    }
    while (requests.length) receive(requests.shift());
    while (publications.length) publish(publications.shift());
  } finally { stop.abort(); watches.forEach(w => w.retire()); }
});

// The oracle owns request order and values, not cache tickets, evidence floors,
// or observation internals. Evaluation and final publication can finish apart.
for (let seed = 1; seed <= 30; seed++) test(`pure local publication model seed ${seed}`, async () => {
  const reads = new LocalReads(), index = new ReadIndex(), pending = [], completed = [];
  const op = { kind: 'query', name: 'local' }, expected = new Map();
  const backend = { generation: 1, schema: { tables: {}, operations: { local: { reads: ['docs'], held: true } } },
    programs: [{ name: 'local', args: {}, body: [{ Return: { Get: { table: 'docs', index: 'id', key: [] } } }] }] };
  const watches = ['A', 'B'].flatMap(id => [undefined, true].map(keep => Object.assign(new ReadObservation(keep), {
    op, args: { id }, tables: new Set(['docs']), subscribers: new Set(), presenceRefresh: null,
  })));
  watches.forEach((watch, i) => index.set(String(i), watch));
  let serial = 0, random = seed;
  const rand = n => { random = (Math.imul(random, 1664525) + 1013904223) >>> 0; return (random >>> 8) % n; };
  const check = () => {
    for (const watch of watches) {
      const want = expected.get(watch.args.id), read = watch.read(null);
      if (!want) continue;
      assert.ok(!('loading' in read), `${seed}: purely local evaluation left ${watch.args.id} loading`);
      assert.equal('denied' in read ? Number(read.denied.message) : read.data.serial, want.serial, 'an older local answer cannot win');
      assert.equal('denied' in read, want.denied);
    }
    assert.equal(reads.serverAnswers.size, 0, 'local successes are not remembered server data');
  };
  const start = (id, denied, owner) => {
    const candidate = { serial: ++serial, id, denied, owner };
    let release;
    const body = new Promise(resolve => { release = resolve; });
    const env = {
      backend, partitionDenied: null, credentialRevision: 0, incarnation: 0, authority: 0,
      replicaBlocked: (key, deps) => reads.blocked(key, deps), evidenceMinimum: (key, deps) => reads.minimum(key, deps),
      refreshing: null, link: 'online', caughtUp: true, identityChecked: true, lastSyncAt: 0,
      principal: 'alice', partitionCurrent: true, nativeReady: true, signal: new AbortController().signal,
      unavailable: () => null, queued: async () => [], notify() {}, deviceNow: () => 1, serverNow: () => 1,
      serverAnswers: reads.serverAnswers.view(), call: () => body,
      post: () => assert.fail('a local evaluation must not use HTTP'),
    };
    const evaluation = evaluateLocal(env, op, { id }, 0, 0).then(result => { completed.push({ ...candidate, result }); });
    pending.push({ release: async () => {
      release({ ok: { ...(denied ? { denied: { code: 'APP_DENIED', family: 'app', message: String(candidate.serial) } }
        : { data: { serial: candidate.serial } }), complete: true, unknown: false, tables: ['docs'] } });
      await evaluation;
    } });
  };
  const publish = candidate => {
    const { id, serial, denied, result, owner } = candidate;
    const want = expected.get(id);
    if (!want || serial > want.serial) expected.set(id, { serial, denied });
    reconcileLocalRead(reads, index, backend, { ...result, op, args: { id }, evidenceSerial: reads.evidenceSerial },
      () => { owner?.update(result.read); return true; }, () => {}, owner);
    check();
  };
  try {
    for (const id of ['A', 'B']) { start(id, false); await pending.shift().release(); publish(completed.shift()); }
    for (let step = 0; step < 120; step++) {
      const event = rand(5);
      if (event < 3) {
        const id = rand(2) ? 'A' : 'B', owner = rand(2) ? watches.find(w => w.args.id === id) : undefined;
        start(id, !!rand(2), owner);
      } else if (event === 3 && pending.length) await pending.splice(rand(pending.length), 1)[0].release();
      else if (completed.length) publish(completed.splice(rand(completed.length), 1)[0]);
      check();
    }
    while (pending.length) await pending.splice(rand(pending.length), 1)[0].release();
    while (completed.length) publish(completed.splice(rand(completed.length), 1)[0]);
  } finally { watches.forEach(w => w.retire()); }
});
