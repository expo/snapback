import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn, execFileSync } from 'node:child_process';
import { once } from 'node:events';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync, rmSync, appendFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { initSync, WebDevice } from '../src/wasm/snapback4_device.js';

const root = fileURLToPath(new URL('../../../', import.meta.url));
const binary = process.env.SNAPBACK4_BIN ?? join(root, 'target/debug/snapback4');
const fixture = readFileSync(join(root, 'crates/snapback4-lang/tests/fixtures/row-keyed-view.q'), 'utf8');
initSync({ module: readFileSync(new URL('../src/wasm/snapback4_device_bg.wasm', import.meta.url)) });

test('row-key check JSON and rebuilt wasm carry the actual E_VIEW_KEY envelope', { timeout: 90000 }, async t => {
  const directory = mkdtempSync(join(root, 'target/b3-wire-'));
  mkdirSync(join(directory, 'snapback'));
  const source = 'use personas bob\n' + fixture + '\nmutation depend(member: members):\n  n = unread[member]\n  update members[member] { readUpTo: n }\n';
  writeFileSync(join(directory, 'snapback/schema.q'), source);
  const checked = JSON.parse(execFileSync(binary, ['check', '--json'], { cwd: directory, encoding: 'utf8' }));
  assert.deepEqual(checked.rowViews, [{ view: 'unread', source: 'messages', sourceKey: 'conversationId', member: 'members', memberKey: 'conversationId', fanout: 100, writerRecount: 1024, recountChunk: 256 }]);
  const server = spawn(binary, ['dev', '--port', '0', '--no-watch', '--hold-schedules'], { cwd: directory, stdio: ['ignore', 'pipe', 'pipe'] });
  appendFileSync(join(root, 'target/b3-r1-server-pids.log'), `${server.pid}\n`);
  const exited = once(server, 'exit');
  let log = '', device;
  t.after(async () => {
    device?.free();
    if (server.exitCode === null && server.signalCode === null) server.kill();
    await exited;
    rmSync(directory, { recursive: true, force: true });
  });
  server.stderr.on('data', b => { log += b; });
  const url = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(Error(log)), 60000);
    server.once('exit', () => { clearTimeout(timer); reject(Error(log)); });
    server.stdout.on('data', b => { log += b; const url = log.match(/http:\/\/127\.0\.0\.1:\d+/)?.[0]; if (url) { clearTimeout(timer); resolve(url); } });
  });
  const response = await fetch(url + '/schema', { headers: { 'x-snapback-persona': 'bob' } });
  assert.equal(response.status, 200);
  const backend = await response.json();
  device = new WebDevice(JSON.stringify(backend), '[]');
  const call = request => JSON.parse(device.call(JSON.stringify(request)));
  const applied = call({ op: 'apply', first: true, page: {
    snapshot: true, generation: backend.generation, watermark: 1, more: false,
    events: [
      { table: 'members', id: 'b', kind: 'put', data: { id: 'b', conversationId: 'c', principal: 'dev:bob', readUpTo: 10000, joinedAt: 0 } },
      { table: 'unread', id: 'b', kind: 'put', data: { id: 'b', member: 'b', value: 10000, recountPending: true } },
    ],
  } });
  assert.ok(Object.hasOwn(applied, 'ok'), JSON.stringify(applied));
  const query = call({ op: 'query', name: 'unreadFor', viewer: 'dev:bob', args: { member: 'b' }, now: 1 });
  assert.equal(query.ok.complete, false);
  const prediction = call({ op: 'predict', name: 'depend', viewer: 'dev:bob', args: { member: 'b' }, now: 1 });
  assert.equal(prediction.ok?.denied?.code, 'E_VIEW_KEY', JSON.stringify(prediction));
  assert.equal(prediction.ok.denied.guide, 'maintains');
  assert.match(prediction.ok.denied.rewrite, /retry after recount settlement and expiry sweeping/);

  const member = { id: 'b', conversationId: 'c', principal: 'dev:bob', readUpTo: 0, joinedAt: 0 };
  const message = (id, until) => ({ id, conversationId: 'c', senderId: 'dev:alice', ordinal: 1, tombstone: false, until });
  const put = (table, data) => ({ table, id: data.id, kind: 'put', data });
  const view = value => put('unread', { id: 'b', member: 'b', value, recountPending: false });
  const outcomes = [];
  for (const scenario of ['spanning', 'excluded', 'catchup']) {
    // The same wire replay is exercised on Rust memory/SQLite in row_view_expiry.
    // This goes through the rebuilt wasm dispatch and its actual JSON envelopes.
    const worlds = [];
    for (const hiddenExpiredContribution of [0, 1]) {
      const replica = new WebDevice(JSON.stringify(backend), '[]');
      const invoke = request => JSON.parse(replica.call(JSON.stringify(request)));
      try {
        const apply = (events, watermark, snapshot, first = false, more = false) => {
          const response = invoke({ op: 'apply', first, page: {
            generation: backend.generation, snapshot, watermark, more,
            ...(snapshot ? { after: first ? null : 'view-page', next: more ? 'view-page' : null } : { requested_watermark: watermark - 1, images_at: watermark }),
            events,
          } });
          assert.ok(Object.hasOwn(response, 'ok'), JSON.stringify(response));
        };
        if (scenario === 'spanning') {
          apply([put('members', member), put('messages', message('expired', 10))], 1, true, true, true);
          // Message page at 9, view page at 11: the wire count is already live.
          apply([view(0)], 1, true);
        } else {
          apply([put('members', member), put('messages', message('live', null)),
            ...(scenario === 'catchup' ? [put('messages', message('expired', 10))] : []),
            view(scenario === 'catchup' ? 2 : 1)], 1, true, true);
          apply([put('messages', message('second-live', null)),
            { table: 'messages', id: 'missed', kind: 'del' }, view(2)], 2, false);
          // Replaying a legacy raw image must not turn an undelivered expired
          // contribution into a locally certified number either.
          apply([view(2 + hiddenExpiredContribution)], 3, false);
        }
        const count = () => invoke({ op: 'query', name: 'unreadFor', viewer: 'dev:bob', args: { member: 'b' }, now: 11 });
        const before = count();
        assert.equal(before.ok.complete, true, JSON.stringify(before));
        assert.equal(before.ok.data, scenario === 'spanning' ? 0 : 2);
        const sent = invoke({ op: 'predict', name: 'send', viewer: 'dev:bob', args: {
          id: 'pred', conversationId: 'c', ordinal: 2, senderId: 'dev:alice', until: null,
        }, now: 11, newIds: ['pred'], entropy: 1 });
        assert.ok(sent.ok && !sent.ok.denied, JSON.stringify(sent));
        const after = count();
        assert.equal(after.ok.complete, true, JSON.stringify(after));
        assert.equal(after.ok.data, scenario === 'spanning' ? 1 : 3);
        worlds.push(JSON.stringify({ before, after }));
      } finally { replica.free(); }
    }
    assert.equal(worlds[0], worlds[1], `${scenario}: hidden expired input changed a certified result`);
    outcomes.push(scenario);
  }
  assert.deepEqual(outcomes, ['spanning', 'excluded', 'catchup']);
});
