import { captureStdout } from './helpers/server-output.mjs';
import { waitFor, hangBudget } from './helpers/wait.mjs';
// POST /dev/reset against connected clients: a local device re-acquires the
// new store by itself; an online client halts with E_STORE_REPLACED.
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createLocalClient } from '../dist/local.js';
import { createClient } from '../dist/client.js';
import { memoryPersistence, webDevice } from '../dist/web.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '../../..');
const binary = process.env.SNAPBACK4_BIN ?? join(root, 'target/debug/snapback4');
const wasm = readFileSync(join(root, 'packages/snapback4/src/wasm/snapback4_device_bg.wasm'));
const source = `use personas alice
table lists:
  owner: principal
  title: text <=40
  immutable owner
  read <- .owner = viewer
  insert <- .owner = viewer
  sync to .owner
query mine():
  return lists where .owner = viewer first 100
mutation add(id: id, title: text <=40):
  return insert lists { id, owner: viewer, title }
`;
const mine = { kind: 'query', name: 'mine' };
const list = (id, title) => ({ table: 'lists', row: { id, owner: 'dev:alice', title } });
const titles = answer => answer.data?.map(row => row.title).join(',');

test('a reset reaches connected clients: local re-acquires, online halts', { timeout: hangBudget(15) }, async t => {
  const dir = mkdtempSync(join(tmpdir(), 'sb4-dev-reset-'));
  mkdirSync(join(dir, 'snapback'));
  writeFileSync(join(dir, 'snapback/schema.q'), source);
  const child = spawn(binary, ['dev', '--port', '0', '--fresh', '--no-watch'], { cwd: dir, stdio: ['ignore', 'pipe', 'pipe'] });
  const readStdout = captureStdout(child);
  const exit = once(child, 'exit');
  let log = '', url;
  const clients = [];
  child.stdout.on('data', d => { log += d; url ??= readStdout().match(/http:\/\/127\.0\.0\.1:\d+(?=\r?\n)/)?.[0]; });
  child.stderr.on('data', d => { log += d; });
  t.after(async () => {
    for (const client of clients) await client.close();
    if (child.exitCode == null && child.signalCode == null) child.kill('SIGTERM');
    await exit; rmSync(dir, { recursive: true, force: true });
  });
  await waitFor(() => { assert.equal(child.exitCode, null, log); return url; }, 'dev url');
  const post = async (path, body) => (await fetch(url + path, { method: 'POST', body: JSON.stringify(body) })).json();
  assert.equal((await post('/seed', [list('L1', 'Old')])).seeded, 1);

  const local = await createLocalClient({ url, persona: 'alice', device: webDevice({ wasm, persist: memoryPersistence() }), waitSeconds: 1 });
  clients.push(local);
  await local.sync();
  assert.equal(titles(await local.query(mine, {})), 'Old');
  const online = createClient({ url, persona: 'alice' });
  clients.push(online);
  assert.equal(titles(await online.query(mine, {})), 'Old');

  const reset = await post('/dev/reset', { seed: [list('L2', 'New')] });
  assert.equal(reset.reset, true, JSON.stringify(reset));
  assert.equal(reset.seeded, 1);

  // The device's own follow loop sees the new identity, drops the old
  // partition and acquires the reseeded one; no client call is needed.
  await waitFor(async () => titles(await local.query(mine, {})) === 'New', 'local re-acquisition', { diagnostics: () => log });
  const sent = await local.mutate({ kind: 'mutation', name: 'add' }, { id: 'L3', title: 'After' }, { waitSeconds: 5 });
  assert.equal(sent.state, 'sent', JSON.stringify(sent));
  assert.equal(titles(await local.query(mine, {})), 'New,After');

  // The online client halts on the replacement rather than mixing stores.
  await waitFor(async () => (await online.query(mine, {})).denied?.code === 'E_STORE_REPLACED', 'online replacement');
});
