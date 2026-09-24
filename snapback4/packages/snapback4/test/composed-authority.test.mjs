import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { createLocalClient } from '../dist/local.js';
import { processDevice } from '../dist/native.js';
import { memoryPersistence, webDevice } from '../dist/web.js';

const binary = process.env.SNAPBACK4_BIN ?? resolve(import.meta.dirname, '../../../target/debug/snapback4');
const wasm = readFileSync(new URL('../src/wasm/snapback4_device_bg.wasm', import.meta.url));
const deferred = () => { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; };
const until = async (check, message) => { for (let n = 0; n < 500; n++) { if (await check()) return; await delay(10); } assert.fail(message); };
const blocked = signal => new Promise((_, reject) => { if (signal.aborted) reject(Error('closed')); else signal.addEventListener('abort', () => reject(Error('closed')), { once: true }); });
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
  sync to members[.room] last 1 by .at
table secrets:
  room: text <=40
  at: time
  body: text <=40
  read <- exists members[.room, viewer]
  retain until-revoked
  sync to members[.room] last 1 by .at
query mixed():
  kept = history where .room = 'left' last 50 by .at
  current = secrets where .room = 'private' last 50 by .at
  return {history: kept, private: current}
mutation revoke(room: text <=40):
  delete members[room = room, principal = 'dev:bob']
`;

for (const tier of ['wasm', 'process']) for (const observation of [true, false])
  test(`composed ${observation ? 'watch' : 'query'} ${tier}: revocation during the second local read fences pre-revocation server fields`, { timeout: 30_000 }, async t => {
    const directory = mkdtempSync(join(tmpdir(), 'sb4-composed-authority-'));
    mkdirSync(join(directory, 'snapback'));
    writeFileSync(join(directory, 'snapback/schema.q'), source);
    const host = spawn(binary, ['dev', '--port', '0', '--no-watch'], { cwd: directory, stdio: ['ignore', 'pipe', 'pipe'] });
    const exit = once(host, 'exit'), second = deferred(), release = deferred();
    let log = '', client, core, locals = 0, remotes = 0, remoteData;
    host.stdout.on('data', b => { log += b; }); host.stderr.on('data', b => { log += b; });
    t.after(async () => { release.resolve(); await client?.close(); host.kill('SIGTERM'); await exit; rmSync(directory, { recursive: true, force: true }); });
    await until(() => { assert.equal(host.exitCode, null, log); return /http:\/\/127\.0\.0\.1:\d+/.test(log); }, 'server did not listen');
    const url = log.match(/http:\/\/127\.0\.0\.1:\d+/)[0];
    const post = async (path, body, persona = 'alice') => (await fetch(url + path, { method: 'POST', headers: { 'x-snapback-persona': persona }, body: JSON.stringify(body) })).json();
    const rows = ['left', 'private'].flatMap(room => ['alice', 'bob'].map(person => ({ table: 'members', row: { id: `${person}-${room}`, room, principal: `dev:${person}` } })));
    rows.push(...['history', 'secrets'].flatMap(table => [1, 2].map(at => ({ table, row: { id: `${table}-${at}`, room: table === 'history' ? 'left' : 'private', at, body: table === 'history' ? 'retained' : 'private' } }))));
    assert.equal((await post('/seed', rows)).seeded, 8);
    const device = tier === 'wasm' ? webDevice({ wasm, persist: memoryPersistence() }) : processDevice({ dir: join(directory, 'device'), binary });
    client = await createLocalClient({ url, persona: 'bob', device: { async open(...args) {
      core = await device.open(...args);
      return { close: () => core.close(), async call(request, committed) {
        const reply = await core.call(request, committed);
        if (request.op === 'query' && request.name === 'mixed' && ++locals === 2) {
          // HTTP has already settled and server() has checked its authority.
          // Hold the old second device result while a real sync withdraws rows.
          second.resolve(reply); await release.promise;
        }
        return reply;
      } };
    } }, fetch: async (input, init) => {
      const path = new URL(input).pathname;
      if (path === '/changes') return blocked(init.signal);
      const response = await fetch(input, init);
      if (path === '/q/mixed') { remotes++; remoteData = (await response.clone().json()).data; }
      return response;
    } });
    await client.sync();
    assert.equal((await post('/m/revoke', { id: 'leave-left', args: { room: 'left' } })).state, 'sent');
    await client.sync();
    const state = (await core.call({ op: 'sync_state', capture: false })).ok;
    const op = { kind: 'query', name: 'mixed' }, publications = [];
    const watch = observation ? client.observe(op, {}) : null;
    watch?.subscribe(() => publications.push(watch.getSnapshot()));
    const pending = observation ? null : client.query(op, {});
    const old = (await second.promise).ok;
    assert.equal(remotes, 1, 'the hold is after the single server fallback');
    assert.equal(old.components.history.retained, true);
    assert.equal(old.components.private.unknown, true);
    assert.deepEqual(old.data.private.map(row => row.id), ['secrets-2']);
    assert.deepEqual(remoteData.private.map(row => row.id), ['secrets-2', 'secrets-1'], 'server fields include an undelivered private row');
    assert.equal((await post('/m/revoke', { id: 'revoke-private', args: { room: 'private' } })).state, 'sent');
    await client.sync();
    const after = (await core.call({ op: 'sync_state', capture: false })).ok;
    assert.equal(after.store_id, state.store_id); assert.equal(after.generation, state.generation);
    const authorized = (await core.call({ op: 'query', name: 'mixed', args: {}, viewer: 'dev:bob', now: Date.now() })).ok;
    assert.deepEqual(authorized.data.private, [], 'the device has applied the actual revocation');
    if (watch) assert.deepEqual(watch.getSnapshot(), { loading: true });
    release.resolve();
    if (watch) await until(() => watch.getSnapshot().data?.private.length === 0, 'watch did not rerun under the new authority');
    else publications.push(await pending);
    const answers = publications.filter(read => 'data' in read);
    assert.ok(answers.length > 0);
    for (const read of answers) {
      assert.deepEqual(read.data.private, [], 'no pre-revocation server field may publish, even transiently');
      assert.deepEqual(read.data.history.map(row => row.id), ['history-2'], 'authorized retained history stays visible');
    }
    assert.ok(locals >= 3, 'a local read reran after its authority changed');
    watch?.close();
  });
