import { captureStdout } from './helpers/server-output.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { hangBudget } from './helpers/wait.mjs';
import { initSync, WebDevice } from '../src/wasm/snapback4_device.js';

const root = fileURLToPath(new URL('../../../', import.meta.url));
const binary = process.env.SNAPBACK4_BIN ?? join(root, 'target/debug/snapback4');
initSync({ module: readFileSync(new URL('../src/wasm/snapback4_device_bg.wasm', import.meta.url)) });

// @ref LLP 3000.015#3 — reconstruction keeps the contract's prediction metadata.
test('wasm reconstructed view preserves predicted identities, pending and member deadline', { timeout: hangBudget(5) }, async t => {
  const directory = mkdtempSync(join(root, 'target/bg-prediction-'));
  mkdirSync(join(directory, 'snapback'));
  const fixture = readFileSync(join(root, 'crates/snapback4-lang/tests/fixtures/row-keyed-view.q'), 'utf8');
  const source = 'use personas bob\n' + fixture.replace('  expire at .until\n', '')
    .replace('  joinedAt: int default 0', '  joinedAt: int default 0\n  until: time ?\n  expire at .until');
  writeFileSync(join(directory, 'snapback/schema.q'), source);
  const server = spawn(binary, ['dev', '--port', '0', '--no-watch', '--hold-schedules'], { cwd: directory, stdio: ['ignore', 'pipe', 'pipe'] });
  const readStdout = captureStdout(server);
  const exited = once(server, 'exit');
  let log = '';
  t.after(async () => {
    if (server.exitCode === null && server.signalCode === null) server.kill();
    await exited;
    rmSync(directory, { recursive: true, force: true });
  });
  server.stderr.on('data', b => { log += b; });
  const url = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(Error(log)), hangBudget());
    server.once('exit', () => { clearTimeout(timer); reject(Error(log)); });
    server.stdout.on('data', b => {
      log += b;
      const url = readStdout().match(/http:\/\/127\.0\.0\.1:\d+(?=\r?\n)/)?.[0];
      if (url) { clearTimeout(timer); resolve(url); }
    });
  });
  const response = await fetch(url + '/schema', { headers: { 'x-snapback-persona': 'bob' } });
  assert.equal(response.status, 200);
  const backend = await response.json();
  for (const population of [1, 2, 5]) {
    const device = new WebDevice(JSON.stringify(backend), '[]');
    const call = request => {
      const result = JSON.parse(device.call(JSON.stringify(request)));
      assert.ok(Object.hasOwn(result, 'ok'), JSON.stringify(result));
      return result.ok;
    };
    try {
      call({ op: 'apply', first: true, page: { snapshot: true, generation: backend.generation, watermark: 1, more: false,
        events: [
          ['members', { id: 'u0', conversationId: 'c', principal: 'dev:bob', readUpTo: 0, joinedAt: 0, until: 100 }],
          ['unread', { id: 'u0', member: 'u0', value: 0, recountPending: false }],
        ].map(([table, data]) => ({ table, id: data.id, kind: 'put', data })),
      } });
      const predicted = [];
      for (let n = 1; n <= population; n++) {
        const id = `m${n}`;
        const result = call({ op: 'predict', name: 'send', viewer: 'dev:bob', args: {
          id, conversationId: 'c', ordinal: n, senderId: 'dev:alice', until: null,
        }, now: 2, newIds: [id], entropy: n });
        assert.deepEqual([...result.predicted].sort(), [`messages/${id}`, 'unread/u0']);
        predicted.push(...result.predicted);
      }
      for (const now of [2, 99, 100, 9]) {
        const rows = call({ op: 'query', name: 'unreadRows', viewer: 'dev:bob', args: {}, now });
        assert.equal(rows.complete, true);
        assert.equal(rows.nextExpiry, now < 100 ? 100 : null);
        assert.equal(rows.data.length, now < 100 ? 1 : 0);
        if (now < 100) {
          assert.equal(rows.data[0].value, population);
          assert.equal(rows.data[0].pending, true, 'prediction metadata on reconstructed wasm row');
        }
      }
      call({ op: 'withdraw', predicted: [...new Set(predicted)] });
      const rows = call({ op: 'query', name: 'unreadRows', viewer: 'dev:bob', args: {}, now: 2 });
      assert.ok(rows.data.every(row => row.pending !== true));
    } finally { device.free(); }
  }
});
