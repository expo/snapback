// @ref LLP 3000.020#6 — the same replica cases run on wasm and both native stores.
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn, execFileSync } from 'node:child_process';
import { once } from 'node:events';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { initSync, WebDevice } from '../src/wasm/snapback4_device.js';
import { createLocalClient } from '../dist/local.js';
import { memoryPersistence, webDevice } from '../dist/web.js';

const root = fileURLToPath(new URL('../../../', import.meta.url));
const binary = process.env.SNAPBACK4_BIN ?? join(root, 'target/debug/snapback4');
const source = readFileSync(join(root, 'crates/snapback4-device/tests/unread_range/schema.q'), 'utf8');
const cases = JSON.parse(readFileSync(join(root, 'crates/snapback4-device/tests/unread_range/cases.json')));
const wasm = readFileSync(new URL('../src/wasm/snapback4_device_bg.wasm', import.meta.url));
initSync({ module: wasm });
const viewer = 'dev:bob';
const member = c => ({ id: 'b', conversationId: 'c', principal: viewer, readUpTo: 'mark' in c ? c.mark : 4, joinedAt: Object.hasOwn(c, 'joinedAt') ? c.joinedAt : 0 });
const message = n => ({ id: `m${String(n).padStart(2, '0')}`, conversationId: 'c', ordinal: n, at: n, senderId: 'dev:alice', tombstone: false, until: null });
const put = (table, data) => ({ table, id: data.id, kind: 'put', data });
async function serverFor(t, c) {
  const dir = mkdtempSync(join(tmpdir(), 'sb4-p5-'));
  mkdirSync(join(dir, 'snapback'));
  let text = c.program ?? source;
  for (const [before, after] of c.replace ?? []) text = text.replaceAll(before, after);
  writeFileSync(join(dir, 'snapback/schema.q'), 'use personas bob, alice\n' + text);
  const child = spawn(binary, ['dev', '--memory', '--port', '0', '--no-watch', '--hold-schedules'], { cwd: dir, stdio: ['ignore', 'pipe', 'pipe'] });
  const exited = once(child, 'exit');
  const close = async () => { if (child.exitCode === null && child.signalCode === null) child.kill(); await exited; rmSync(dir, { recursive: true, force: true }); };
  t.after(close);
  let log = '';
  child.stderr.on('data', b => { log += b; });
  const url = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(Error(log)), 60000);
    child.once('exit', () => { clearTimeout(timer); reject(Error(log)); });
    child.stdout.on('data', b => { log += b; const found = log.match(/http:\/\/127\.0\.0\.1:\d+/); if (found) { clearTimeout(timer); resolve(found[0]); } });
  });
  const post = async (path, body, persona = "bob") => {
    const r = await fetch(url + path, { method: 'POST', headers: { 'x-snapback-persona': persona, 'content-type': 'application/json' }, body: JSON.stringify(body) });
    const answer = await r.json(); assert.equal(r.status, 200, JSON.stringify(answer)); assert.ok(!answer.denied, JSON.stringify(answer)); return answer;
  };
  const backend = await (await fetch(url + '/schema', { headers: { 'x-snapback-persona': 'bob' } })).json();
  const rows = c.rows ?? [{ table: 'conversations', row: { id: 'c', title: 'chat' } }, { table: 'members', row: member(c) }];
  for (let i = 1; i <= (c.n ?? 6); i++) {
    const row = { ...message(i), ...(i <= (c.expireFirst ?? 0) ? { until: 4102444800000 } : {}), ...c.overrides?.[i] }; if (row.senderId === 'bob') row.senderId = viewer;
    if (text.includes("ordinal: sequence")) delete row.ordinal;
    rows.push({ table: 'messages', row });
  }
  for (const extra of c.extra ?? []) rows.push({ table: 'messages', row: { ...message(0), ...extra } });
  for (const seed of c.seed ?? []) rows.unshift({ table: seed.table, row: { ...seed.row, principal: seed.row.principal === 'bob' ? viewer : seed.row.principal } });
  if (text.includes('joinedAt: sequence')) for (const { table, row } of rows) if (table === 'members') delete row.joinedAt;
  assert.equal((await post('/seed', rows)).seeded, rows.length);
  return { backend, post, url, dir, close };
}
function check(call, c) {
  const result = call({ op: 'query', name: 'badge', viewer, args: { member: 'b' }, now: c.now ?? 1 });
  const q = result.ok;
  assert.equal(q?.complete, c.complete, JSON.stringify(result));
  assert.equal(q.unknown, c.unknown, JSON.stringify(result));
  assert.notEqual(q.speculative, true, JSON.stringify(result));
  if (c.nextExpiry) assert.equal(q.nextExpiry, c.nextExpiry);
  if (c.value === 'partial') assert.ok(q.data > 0 && q.data < 8300, JSON.stringify(result));
  else assert.equal(q.data, c.value, JSON.stringify(result));
  const rows = call({ op: 'query', name: 'badgeRows', viewer, now: c.now ?? 1 });
  assert.equal(rows.ok?.data?.[0]?.recountPending, !c.complete, JSON.stringify(rows));
}
for (const c of cases) test(`unread range wasm: ${c.name}`, { timeout: 120000 }, async t => {
  const s = await serverFor(t, c);
  let device = new WebDevice(JSON.stringify(s.backend), '[]'), kept = [];
  t.after(() => device.free());
  const call = request => JSON.parse(device.call(JSON.stringify(request)));
  const ok = request => { const result = call(request); assert.ok(Object.hasOwn(result, 'ok'), JSON.stringify(result)); return result.ok; };
  const reopen = () => { kept.push(...JSON.parse(device.drain())); device.free(); device = new WebDevice(undefined, JSON.stringify(kept)); };
  let after = null;
  do {
    const page = await s.post('/sync', { after, limit: 512 });
    if (c.omitBoundaries) page.acquisitions = [];
    ok({ op: 'apply', first: after === null, page }); after = page.next;
  } while (after);
  check(call, c); reopen(); check(call, c);
  if (c.complete) assert.equal((await s.post('/q/badge', { args: { member: 'b' } })).data, c.value);
  if (c.name === 'meter-cut') {
    let requests = 0;
    const client = await createLocalClient({ url: s.url, persona: 'bob', device: webDevice({ wasm, persist: memoryPersistence() }),
      fetch: async (input, init) => { if (new URL(input).pathname.startsWith('/q/')) requests++; return fetch(input, init); },
    });
    try {
      const partial = await client.query({ kind: 'query', name: 'badge' }, { member: 'b' });
      assert.ok(partial.data > 0 && partial.data < 8300); assert.equal(partial.complete, false); assert.equal(requests, 0);
    } finally { await client.close(); }
  }
  const m = member(c), horizon = s.backend.schema.tables.messages.sync.horizon.by;
  const page = (events, joined = {}, acquisitions = []) => {
    const from = ok({ op: 'sync_state', capture: false }).watermark;
    ok({ op: 'apply', page: { snapshot: false, generation: s.backend.generation, requested_watermark: from, images_at: from + 1, watermark: from + 1, more: false, events, joined, acquisitions } });
  };
  for (const [i, a] of (c.actions ?? []).entries()) {
    switch (a.kind) {
      case 'query': check(call, a); reopen(); check(call, a); break;
      case 'view': page([put('unread', { id: 'b', member: 'b', principal: viewer, value: a.value, recountPending: true })]); break;
      case 'member': m.readUpTo = a.readUpTo; page([put('members', m)]); break;
      case 'delete': page([{ table: a.table ?? 'messages', id: a.id, kind: 'del' }]); break;
      case 'message': page([put('messages', { ...message(a.ordinal), id: a.id })]); break;
      case 'predict': {
        const r = ok({ op: 'admit', entry: { id: `mark-${i}`, seq: i + 1, op: 'mark', viewer, args: { member: 'b', readUpTo: a.mark }, now: 1, predictable: true } });
        assert.equal(r.predictable, a.predictable, JSON.stringify(r)); if (!a.predictable) assert.deepEqual(r.predicted, []); break;
      }
      case 'send': case 'refuse': case 'succeed': {
        const send = a.kind === 'send';
        const r = ok({ op: 'admit', entry: { id: `intent-${i}`, seq: i + 1, op: send ? 'send' : a.kind === 'succeed' ? 'depend' : 'countThenRefuse', viewer, args: send ? { conversationId: 'c' } : { member: 'b' }, now: 1, new_ids: send ? ['pred'] : [], predictable: true } });
        assert.equal(r.predictable, a.kind !== 'refuse', JSON.stringify(r)); break;
      }
      case 'server-accept': {
        // Advance the server's sequence outside the selected .at suffix.
        await s.post('/seed', Array.from({ length: a.advance }, (_, n) => ({ table: 'messages', row: {
          id: `ahead-${n}`, conversationId: 'c', at: 0, senderId: 'dev:alice', tombstone: false, until: null,
        } })));
        const sent = await s.post('/m/send', { args: { conversationId: 'c' } });
        assert.equal(sent.state, 'sent', JSON.stringify(sent));
        assert.equal(sent.result.ordinal, 10007, JSON.stringify(sent));
        const accepted = await s.post('/m/countThenRefuse', { args: { member: 'b' } });
        assert.equal(accepted.state, 'sent', JSON.stringify(accepted));
        assert.equal(accepted.result, 1, JSON.stringify(accepted));
        break;
      }
      case 'acquiring': page([], {}, [{ at: 0, table: 'messages', index: horizon, group: ['c'] }]); break;
      case 'leave': page([{ table: 'messages', id: '', kind: 'scope', data: ['c'] }]); break;
      case 'rejoin': page([put('messages', message(6))], { messages: [['c']] }, [
        { at: 0, table: 'messages', index: horizon, group: ['c'] },
        { at: 1, table: 'messages', index: horizon, group: ['c'], floor: 'whole' },
      ]); break;
      default: assert.fail(a.kind);
    }
  }
});

test('unread range check names the chosen predicates, index and horizon', { timeout: 120000 }, async t => {
  const s = await serverFor(t, cases[0]);
  const checked = JSON.parse(execFileSync(binary, ['check', '--json', '--cost'], { cwd: s.dir, encoding: 'utf8' }));
  const range = checked.rowViews[0].range;
  assert.equal(range.column, 'ordinal'); assert.equal(range.index, '$view:conversationId:ordinal');
  assert.deepEqual(range.bounds, [{ column: 'ordinal', memberField: 'readUpTo', operator: '>' }]);
  assert.equal(range.horizon.last, 3); assert.ok(range.horizon.index);
  const plain = execFileSync(binary, ['check', '--cost'], { cwd: s.dir, encoding: 'utf8' });
  for (const text of ['device range:', '.ordinal > member.readUpTo', range.index, range.horizon.index, 'the walk is not metered']) assert.ok(plain.includes(text), text);
  const badge = checked.scale.find(c => c.operation === 'badge');
  assert.equal(badge.class, 'grows'); assert.ok(badge.bounds.rows_examined < 8192);
  assert.ok(!badge.growth_sites.some(g => g.reason.includes('unswept expired messages contributions')));
});

test('unread badge uses server fallback online and keeps its bound after cold offline reopen', { timeout: 120000 }, async t => {
  const s = await serverFor(t, { mark: 0 });
  const persistence = memoryPersistence(); let offline = false, requests = 0; const observed = [];
  const open = async () => {
    const opener = webDevice({ wasm, persist: persistence });
    return createLocalClient({ url: s.url, persona: 'bob', waitSeconds: 0,
      device: { open: async (...args) => {
        const core = await opener.open(...args);
        return { close: () => core.close(), call: async request => {
          const result = await core.call(request);
          if (request.op === 'query') observed.push(result.ok);
          return result;
        } };
      } },
      fetch: async (input, init) => { if (offline) throw new TypeError('offline'); if (new URL(input).pathname.startsWith('/q/')) requests++; return fetch(input, init); },
    });
  };
  let client = await open(); t.after(() => client.close());
  const badge = { kind: 'query', name: 'badge' };
  const remote = await client.query(badge, { member: 'b' });
  assert.equal(remote.data, 6); assert.equal(remote.complete, true); assert.ok(requests > 0);
  assert.ok(observed.some(q => q.data === 3 && q.complete === false && q.unknown === true));
  await client.close(); offline = true; client = await open();
  const lower = await client.query(badge, { member: 'b' });
  assert.equal(lower.data, 3); assert.equal(lower.complete, false);
});


test('the guide Clique program certifies and expires on wasm after reopen', { timeout: 120000 }, async t => {
  const guide = readFileSync(join(root, 'crates/snapback4-lang/src/guide/maintains.md'), 'utf8');
  const program = guide.split('## A value per member: Clique unread')[1].split('```quarry\n')[1].split('```')[0];
  const s = await serverFor(t, { program, n: 0, rows: [
    { table: 'conversations', row: { id: 'c', title: 'Chat', timer: 1000000 } },
    { table: 'members', row: { id: 'b', conversationId: 'c', principal: viewer, readUpTo: 501 } },
    { table: 'members', row: { id: 'a', conversationId: 'c', principal: 'dev:alice', readUpTo: 0 } },
  ] });
  for (let i = 0; i < 503; i++) assert.equal((await s.post('/m/send', { args: { conversationId: 'c' } }, 'alice')).state, 'sent');
  let d = new WebDevice(JSON.stringify(s.backend), '[]'); t.after(() => d.free());
  const call = r => JSON.parse(d.call(JSON.stringify(r)));
  let after = null;
  do { const page = await s.post('/sync', { after, limit: 512 }); assert.ok(Object.hasOwn(call({ op: 'apply', first: after === null, page }), 'ok')); after = page.next; } while (after);
  const read = now => call({ op: 'query', name: 'myUnread', viewer, args: { member: 'b' }, now }).ok;
  assert.equal(read(Date.now()).data, 2);
  const kept = d.drain(); d.free(); d = new WebDevice(undefined, kept);
  const q = read(Date.now()); assert.equal(q.data, 2); assert.equal(q.complete, true); assert.ok(q.nextExpiry);
  const expired = read(q.nextExpiry + 1000); assert.equal(expired.data, 0); assert.equal(expired.complete, true);
});

for (const fence of ['held', 'prediction']) test(`unread fallback respects ${fence}`, { timeout: 120000 }, async t => {
  const s = await serverFor(t, { mark: 0,
    replace: fence === 'held' ? [['query badge(member: members):', 'query badge(member: members) held:']] : [],
    rows: [
      { table: 'conversations', row: { id: 'c', title: 'chat' } },
      { table: 'conversations', row: { id: 'other', title: 'other' } },
      { table: 'members', row: member({ mark: 0 }) },
      { table: 'members', row: { ...member({ mark: 0 }), id: 'other-member', conversationId: 'other' } },
    ],
  });
  let requests = 0, predicted = false;
  const opener = webDevice({ wasm, persist: memoryPersistence() });
  const client = await createLocalClient({ url: s.url, persona: 'bob', waitSeconds: 0,
    device: { open: async (...args) => {
      const core = await opener.open(...args);
      return { close: () => core.close(), call: async request => {
        const result = await core.call(request);
        if (request.op === 'admit') predicted = result.ok?.predictable === true;
        return result;
      } };
    } },
    fetch: async (input, init) => {
      const path = new URL(input).pathname;
      if (path.startsWith('/q/')) requests++;
      if (path === '/m/mark') return new Promise((resolve, reject) => {
        if (init.signal.aborted) reject(init.signal.reason);
        else init.signal.addEventListener('abort', () => reject(init.signal.reason), { once: true });
      });
      return fetch(input, init);
    },
  });
  t.after(() => client.close());
  if (fence === 'prediction') {
    const pending = await client.mutate({ kind: 'mutation', name: 'mark' }, { member: 'other-member', readUpTo: 1 });
    assert.equal(pending.state, 'pending'); assert.equal(predicted, true);
  }
  const q = await client.query({ kind: 'query', name: 'badge' }, { member: 'b' });
  assert.equal(q.data, 3); assert.equal(q.complete, false); assert.equal(requests, 0);
});

test('several wasm badges share one request allowance', { timeout: 120000 }, async t => {
  const s = await serverFor(t, { n: 20000, mark: 16000,
    replace: [['last 3 by .ordinal', 'last 19999 by .ordinal']],
    program: source + '\nquery many(member: members):\n  a = unread[member]\n  b = unread[member]\n  c = unread[member]\n  return { a, b, c }\n',
  });
  const d = new WebDevice(JSON.stringify(s.backend), '[]'); t.after(() => d.free());
  const call = r => JSON.parse(d.call(JSON.stringify(r)));
  let after = null;
  do { const page = await s.post('/sync', { after, limit: 512 }); assert.ok(call({ op: 'apply', first: after === null, page }).ok); after = page.next; } while (after);
  const q = call({ op: 'query', name: 'many', viewer, args: { member: 'b' }, now: 1 }).ok;
  assert.equal(q.complete, false); assert.equal(q.unknown, false); assert.notEqual(q.speculative, true);
  assert.deepEqual(q.data, { a: 4000, b: 4000, c: 168 });
});

test('check enumerates every range candidate and its fallback in text and JSON', { timeout: 120000 }, async t => {
  const s = await serverFor(t, cases.find(c => c.name === 'strongest-bound'));
  const checked = JSON.parse(execFileSync(binary, ['check', '--json'], { cwd: s.dir, encoding: 'utf8' }));
  const r = checked.rowViews[0].range;
  assert.deepEqual(r.bounds, [
    { column: 'ordinal', operator: '>', memberField: 'readUpTo' },
    { column: 'ordinal', operator: '>', memberField: 'joinedAt' },
  ]);
  assert.match(r.selection, /greatest encoded lower bound.*strict.*null is weakest/);
  assert.match(r.fallback, /every range operand is null/);
  const text = execFileSync(binary, ['check'], { cwd: s.dir, encoding: 'utf8' });
  for (const part of [r.index, r.horizon.index, r.selection, r.fallback, '.ordinal > member.joinedAt']) assert.ok(text.includes(part), part);
});
