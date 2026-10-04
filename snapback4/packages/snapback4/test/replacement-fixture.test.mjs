import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { devServer } from '../../../witness/lib.mjs';
import { replacementServer } from './helpers/replacement-server.mjs';
import { runFile } from '../../../scripts/run-client-tests.mjs';

async function original(t) {
  const dir = mkdtempSync(join(tmpdir(), 'sb4-replacement-regression-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  mkdirSync(join(dir, 'snapback'));
  writeFileSync(join(dir, 'snapback/schema.q'), 'use identity\nquery who():\n  return viewer\n');
  const options = { sourceDir: join(dir, 'snapback'), seed: [] };
  const server = await devServer(options);
  t.after(() => server.close());
  const { session } = await fetch(server.api + '/auth/guest', { method: 'POST', body: '{}' }).then(r => r.json());
  assert.ok(session?.token);
  return { dir, options, server, session };
}

test('replacement copy waits for a held writer, retaining real identity in a distinct store', async t => {
  const f = await original(t);
  let lock, busy = 0;
  t.after(() => lock?.close());
  const replacement = await replacementServer({ original: f.server, session: f.session, ...f.options,
    onBusy: error => {
      assert.ok([5, 6].includes(error.errcode & 255));
      busy++;
      if (lock) { lock.exec('ROLLBACK'); lock.close(); lock = undefined; }
    },
    start: async options => {
      const server = await devServer(options);
      try {
        lock = new DatabaseSync(join(server.app, '.snapback4/store.sqlite'));
        lock.exec('PRAGMA busy_timeout=5000; BEGIN IMMEDIATE');
      } catch (error) { await server.close(); throw error; }
      return server;
    },
  });
  t.after(() => replacement.close());
  assert.ok(busy >= 1, 'copy observed BUSY before the writer released');
  assert.equal(lock, undefined, 'copy could only succeed after the writer released');
  const result = await fetch(replacement.api + '/q/who', {
    method: 'POST', headers: { authorization: `Bearer ${f.session.token}` }, body: '{}',
  }).then(r => r.json());
  assert.equal(result.data, f.session.principal);
});

test('held replacement writer fails its test, closes its server and exits without hanging', { timeout: 30000 }, async t => {
  const f = await original(t), script = join(f.dir, 'held-lock.test.mjs'), record = join(f.dir, 'child.json');
  writeFileSync(script, `import test from 'node:test';
import {writeFileSync} from 'node:fs';
import {DatabaseSync} from 'node:sqlite';
import {devServer} from ${JSON.stringify(new URL('../../../witness/lib.mjs', import.meta.url).href)};
import {replacementServer} from ${JSON.stringify(new URL('./helpers/replacement-server.mjs', import.meta.url).href)};
test('injected writer lock', async t => {
  let lock;
  t.after(() => lock?.close());
  await replacementServer({
    ...${JSON.stringify({ original: { app: f.server.app, api: f.server.api }, session: f.session, ...f.options, copyTimeout: 150 })},
    start: async options => {
      const server = await devServer(options);
      writeFileSync(${JSON.stringify(record)}, JSON.stringify({pid:server.pid,app:server.app}));
      try {
        lock = new DatabaseSync(server.app+'/.snapback4/store.sqlite');
        lock.exec('PRAGMA busy_timeout=5000; BEGIN IMMEDIATE');
      } catch (error) { await server.close(); throw error; }
      return server;
    },
  });
});`);
  let output = '';
  // An independent watchdog contains a broken cleanup mutant, but invoking
  // that fallback must fail this regression: setup itself must reap the host.
  const result = await runFile(script, { timeout: 15000, onOutput: text => { output += text; } });
  assert.equal(result.reason, undefined, output);
  assert.equal(result.signal, null, output);
  assert.equal(result.code, 1, output);
  assert.match(output, /not ok 1 - injected writer lock/);
  assert.match(output, /TEST_REPLACEMENT_COPY: writer remained locked for 150 ms/);
  const { pid, app } = JSON.parse(readFileSync(record));
  assert.throws(() => process.kill(pid, 0), { code: 'ESRCH' }, 'setup failure must reap its server before rejection');
  assert.equal(existsSync(app), false, 'failed replacement removes its temporary project');
});

test('replacement also closes when its post-copy admission assertion fails', async t => {
  const f = await original(t);
  let replacement;
  await assert.rejects(replacementServer({ original: f.server, session: { token: 'invalid' }, ...f.options,
    start: async options => replacement = await devServer(options),
  }), { code: 'ERR_ASSERTION' });
  assert.throws(() => process.kill(replacement.pid, 0), { code: 'ESRCH' });
  assert.equal(existsSync(replacement.app), false);
});
