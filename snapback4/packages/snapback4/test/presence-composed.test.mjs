// LLP 3000.017 §3.1: a composed local answer carries the server's refresh. Bob
// keeps a room's history after leaving it (retained on his device); a query
// that returns that history beside `exists connected[p]` is answered partly by
// the device and partly by the server, and must still refresh.
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { createClient } from '../dist/client.js';
import { createLocalClient } from '../dist/local.js';
import { processDevice } from '../dist/native.js';
import { memoryPersistence, webDevice } from '../dist/web.js';

const binary = process.env.SNAPBACK4_BIN ?? resolve(import.meta.dirname, '../../../target/debug/snapback4');
const wasm = readFileSync(new URL('../src/wasm/snapback4_device_bg.wasm', import.meta.url));
const until = async (check, message, ms = 10_000) => { const end = Date.now() + ms; while (Date.now() < end) { if (await check()) return; await delay(20); } assert.fail(message); };
const source = `use personas alice, bob
table members:
  room: text <=40
  principal: principal
  unique room, principal
  immutable room, principal
  read <- exists members[.room, viewer]
  delete <- exists members[.room, viewer]
  sync to members[.room]
table history:
  room: text <=40
  at: time
  body: text <=40
  read <- exists members[.room, viewer]
  retain delivered-history
  sync to members[.room] last 5 by .at
query kept(p: principal):
  held = history where .room = 'left' last 50 by .at
  return { history: held, online: exists connected[p] }
mutation leave(room: text <=40):
  delete members[room = room, principal = viewer]
`;

for (const tier of ['wasm', 'process'])
  test(`composed ${tier}: a retained field beside presence keeps refreshing`, { timeout: 60_000 }, async t => {
    const directory = mkdtempSync(join(tmpdir(), 'sb4-presence-composed-'));
    mkdirSync(join(directory, 'snapback'));
    writeFileSync(join(directory, 'snapback/schema.q'), source);
    const host = spawn(binary, ['dev', '--port', '0', '--no-watch'], { cwd: directory, stdio: ['ignore', 'pipe', 'pipe'] });
    const exit = once(host, 'exit');
    let log = '', bob, alice;
    host.stdout.on('data', b => { log += b; }); host.stderr.on('data', b => { log += b; });
    t.after(async () => { await alice?.close(); await bob?.close(); host.kill('SIGTERM'); await exit; rmSync(directory, { recursive: true, force: true }); });
    await until(() => { assert.equal(host.exitCode, null, log); return /http:\/\/127\.0\.0\.1:\d+/.test(log); }, 'server did not listen', 30_000);
    const url = log.match(/http:\/\/127\.0\.0\.1:\d+/)[0];
    const post = async (path, body, persona = 'alice') => (await fetch(url + path, { method: 'POST', headers: { 'x-snapback-persona': persona }, body: JSON.stringify(body) })).json();
    const rows = ['alice', 'bob'].map(person => ({ table: 'members', row: { id: `${person}-left`, room: 'left', principal: `dev:${person}` } }));
    rows.push(...[1, 2].map(at => ({ table: 'history', row: { id: `history-${at}`, room: 'left', at, body: 'retained' } })));
    assert.equal((await post('/seed', rows)).seeded, 4);
    const replies = [];
    const device = tier === 'wasm' ? webDevice({ wasm, persist: memoryPersistence() }) : processDevice({ dir: join(directory, 'device'), binary });
    bob = await createLocalClient({ url, persona: 'bob', device, fetch: async (input, init) => {
      const response = await fetch(input, init);
      if (new URL(input).pathname === '/q/kept') replies.push(await response.clone().json());
      return response;
    } });
    await bob.sync();
    // Bob leaves: the room's history stays on his device, retained.
    assert.equal((await bob.mutate({ kind: 'mutation', name: 'leave' }, { room: 'left' })).state, 'sent');
    await bob.sync();
    const watch = bob.observe({ kind: 'query', name: 'kept' }, { p: 'dev:alice' });
    t.after(() => watch.close());
    await until(() => watch.getSnapshot()?.data?.online === false, `the composed answer did not arrive: ${JSON.stringify(watch.getSnapshot())}`);
    assert.deepEqual(watch.getSnapshot().data.history.map(row => row.id).sort(), ['history-1', 'history-2'], 'the history is the retained copy');
    assert.ok(replies.length >= 1 && replies.every(reply => reply.refresh > 0), `the server answered its part with a refresh: ${JSON.stringify(replies.at(-1))}`);
    // Alice connects: the composed watch refreshes and turns.
    alice = createClient({ url, persona: 'alice', waitSeconds: 25 });
    const hers = alice.observe({ kind: 'query', name: 'kept' }, { p: 'dev:bob' });
    t.after(() => hers.close());
    await until(() => watch.getSnapshot()?.data?.online === true, `the composed mark stayed ${JSON.stringify(watch.getSnapshot())}`);
    assert.deepEqual(watch.getSnapshot().data.history.map(row => row.id).sort(), ['history-1', 'history-2'], 'the refresh kept the retained history');
  });
