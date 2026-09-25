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
  const source = 'use personas bob\n' + fixture.replace('  expire at .until\n', '') + '\nmutation depend(member: members):\n  n = unread[member]\n  update members[member] { readUpTo: n }\n';
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
  assert.match(prediction.ok.denied.rewrite, /wait for complete/);
});
