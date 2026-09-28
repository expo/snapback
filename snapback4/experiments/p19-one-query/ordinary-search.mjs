// Independent current-scope subset qualification, not §7.2 mixed-host acceptance.
// @ref LLP 3000.028#3.3 — the device body and guarded control must remain intact.
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync, appendFileSync, existsSync, mkdirSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { createHash } from 'node:crypto';

const sb4 = resolve(import.meta.dirname, '../..');
const scaledFloor = process.env.OS_FLOOR_U0500 === '1';
const work = join(import.meta.dirname, scaledFloor ? '.work/os-u0500' : '.work/os');
const app = join(work, 'app');
const report = join(sb4, 'reports/20260928-os-ordinary-search', ...(scaledFloor ? ['u0500'] : []));
const evidence = process.env.P19_EVIDENCE ?? '/home/ccheever/sb4-intent/rg-evidence/lane';
const binary = join(sb4, 'target/debug/snapback4');
const { createClient, mintId } = await import(join(sb4, 'packages/snapback4/dist/client.js'));
const { createLocalClient } = await import(join(sb4, 'packages/snapback4/dist/local.js'));
const { processDevice } = await import(join(sb4, 'packages/snapback4/dist/native.js'));
const { webDevice, memoryPersistence } = await import(join(sb4, 'packages/snapback4/dist/web.js'));
const { login } = await import(join(sb4, 'packages/snapback4/dist/auth.js'));
const wasm = readFileSync(join(sb4, 'packages/snapback4/src/wasm/snapback4_device_bg.wasm'));
const q = name => ({kind: 'query', name}), m = name => ({kind: 'mutation', name});
const ids = read => { assert.ok(Array.isArray(read.data), JSON.stringify(read)); return read.data.map(r => r.id); };
const clients = [];
const records = [];
mkdirSync(report, {recursive: true});
function record(stage, value) {
  records.push({stage, ...value});
  writeFileSync(join(report, 'builder-search.jsonl'), records.map(r => JSON.stringify(r)).join('\n') + '\n');
  console.log(stage);
}
if (!existsSync(app)) {
  mkdirSync(join(app, 'snapback'), {recursive: true});
  writeFileSync(join(app, 'snapback/schema.q'), readFileSync(join(evidence, 'snapback/schema.q'), 'utf8') + `
use personas osowner, osreader
query osSearch(q: text <=100, c: cursor ?):
  return messages matching q where not .tombstone last 20 by .at after c
query osChat(conversation: conversations, q: text <=100, c: cursor ?):
  return messages[conversation = conversation] matching q where not .tombstone last 20 by .at after c
`);
  assert.equal(spawnSync('cp', ['-a', '--reflink=auto', join(evidence, 'scale-instance/.snapback4'), app]).status, 0);
  assert.equal(spawnSync('chmod', ['-R', 'u+w', app]).status, 0);
}
async function until(fn, name) {
  const deadline = Date.now() + 180000;
  while (Date.now() < deadline) { const value = await fn(); if (value) return value; await delay(25); }
  throw new Error(`timeout: ${name}`);
}
async function sent(client, name, args) {
  const result = await client.mutate(m(name), args);
  assert.equal(result.state, 'sent', JSON.stringify(result));
  return result.result;
}
let host, output = '';
try {
  record('runtime', {binarySha256: createHash('sha256').update(readFileSync(binary)).digest('hex'), wasmSha256: createHash('sha256').update(wasm).digest('hex')});
  host = spawn(binary, ['dev', '--port', '0', '--no-watch', '--replay'], {cwd: app, stdio: ['ignore','pipe','pipe']});
  for (const stream of [host.stdout, host.stderr]) stream.on('data', data => {output += data; appendFileSync(join(report, 'builder-server.log'), data);});
  const url = await until(() => { assert.equal(host.exitCode, null, output.slice(-2000)); return output.match(/http:\/\/127\.0\.0\.1:\d+/)?.[0]; }, 'server');
  const registration = readFileSync(join(evidence, 'instrument/fixtures/scale.log'), 'utf8').split('\n').find(line => / u0500 register /.test(line));
  const tokens = registration.match(/"(?:[^"\\]|\\.)*"|\S+/g).map(t => t.startsWith('"') ? JSON.parse(t) : t);
  const signed = await login(url, tokens[3], tokens[4]); assert.ok(signed.ok);
  const scaleOnline = createClient({url, session: signed.session}); clients.push(scaleOnline);
  const owner = createClient({url, persona: 'osowner'}), reader = createClient({url, persona: 'osreader'}); clients.push(owner, reader);
  for (const [client, handle] of [[owner, 'osowner'], [reader, 'osreader']]) {
    await sent(client, 'saveProfile', {displayName: handle, handle, bio: '', location: '', link: null});
  }
  const floorPrincipal = scaledFloor ? signed.session.principal : 'dev:osreader';
  const floorAuth = scaledFloor ? {session: signed.session} : {persona: 'osreader'};
  const conversation = mintId(), empty = mintId(), floor = [];
  await sent(owner, 'createGroup', {id: conversation, other: floorPrincipal, title: 'OS floor', description: ''});
  await sent(owner, 'createGroup', {id: empty, other: floorPrincipal, title: 'OS empty', description: ''});
  // Real builder mutations: exactly 503 messages, last 500 acquired. The full
  // acquisition key is (conversation, ordinal, id), not merely a timestamp.
  for (let n = 1; n <= 503; n++) {
    const id = mintId();
    const needle = n === 3 ? 'osfloorbelow' : n === 4 ? 'osfloorexact' : n === 5 ? 'osfloorabove' : `osbody ${n}`;
    const text = scaledFloor && n <= 27 ? `coffee ${needle}` : needle;
    await sent(owner, 'send', {id, conversation, text, quote: null});
    if (n >= 3 && n <= 5) floor.push({id, ordinal: n, text: needle});
  }
  const coffeeRows = [];
  if (scaledFloor) {
    let c;
    do {
      const page = await owner.query(q('history'), {conversation, c});
      assert.ok(page.complete);
      coffeeRows.push(...page.data.filter(row => row.text.startsWith('coffee ')));
      c = page.next;
    } while (c);
    coffeeRows.sort((a, b) => b.at - a.at || (a.id < b.id ? 1 : a.id > b.id ? -1 : 0));
    assert.equal(coffeeRows.length, 27);
  }
  record('floor-fixture', {conversation, empty, floor, acquiredRows: 500, totalRows: 503, scaledFloor, coffeeRows});
  async function coffeePages(local, stage, departed, on) {
    if (!scaledFloor) return;
    const expected = coffeeRows.filter(row => !departed && on || row.ordinal >= 4).map(row => row.id);
    const actual = [];
    let c;
    for (let page = 1; page <= 3; page++) {
      const result = await local.read(`${stage}-coffee-${page}`, 'osChat', {conversation, q: 'coffee', c});
      actual.push(...ids(result.read));
      if (departed || !on) { assert.equal(result.read.complete, false); assert.equal(result.paths.length, 0); }
      c = result.read.next;
      if (!c) break;
    }
    assert.deepEqual(actual, expected);
  }
  const locals = [];
  async function local(tier, name, auth) {
    let offline = false;
    const requests = [], observations = [];
    const opener = tier === 'wasm' ? webDevice({wasm, persist: memoryPersistence()}) : processDevice({binary, dir: join(work, `devices-${name}-${Date.now()}`)});
    const device = {async open(...args) {
      const handle = await opener.open(...args);
      return {close: () => handle.close(), async call(request) {
        const response = await handle.call(request);
        if (request.op === 'query') observations.push({name: request.name, complete: response.ok?.complete, unknown: response.ok?.unknown, retained: response.ok?.retained, next: response.ok?.next});
        return response;
      }};
    }};
    const client = await createLocalClient({url, ...auth, device, fetch: async (input, init) => {
      if (offline) throw new TypeError('OS offline');
      const path = new URL(input).pathname;
      requests.push(path);
      if (path === '/changes') return new Promise((_, reject) => {
        if (init?.signal?.aborted) return reject(init.signal.reason);
        init?.signal?.addEventListener('abort', () => reject(init.signal.reason), {once: true});
      });
      return fetch(input, init);
    }});
    clients.push(client);
    await client.sync();
    return {client, tier, async network(on) {
      offline = !on; await client.sync();
      if (on && client.link() !== 'online') {
        record(`${tier}-${name}-sync-recovery`, {link: client.link(), acquired: client.acquired});
        await until(async () => {await client.sync(); return client.link() === 'online';}, 'online sync before observation');
      }
    }, async read(stage, op, args) {
      const start = requests.length, seen = observations.length;
      const read = await client.query(q(op), args);
      const paths = requests.slice(start).filter(p => p.startsWith('/q/'));
      record(`${tier}-${name}-${stage}`, {op, read, link: client.link(), queryRequests: paths, device: observations.slice(seen)});
      return {read, paths};
    }};
  }
  for (const tier of ['process', 'wasm']) {
    const scale = await local(tier, 'u0500', {session: signed.session});
    let c, oracleCursor;
    for (let page = 0; page < 3; page++) {
      const expected = await scaleOnline.query(q('searchNewest'), {q: 'coffee', c: oracleCursor});
      const {read, paths} = await scale.read(`online-page-${page + 1}`, 'osSearch', {q: 'coffee', c});
      assert.deepEqual(ids(read), ids(expected)); assert.equal(read.complete, true);
      assert.equal(paths.length, 1);
      c = read.next; oracleCursor = expected.next;
      assert.ok(c && oracleCursor);
    }
    await scale.network(false);
    const held = await scale.read('held-offline', 'searchHeld', {q: 'coffee'});
    const ordinary = await scale.read('ordinary-offline', 'osSearch', {q: 'coffee'});
    assert.deepEqual(ids(ordinary.read), ids(held.read)); assert.equal(ordinary.read.complete, false); assert.equal(ordinary.paths.length, 0);
    const follow = await scale.read('server-cursor-offline', 'osSearch', {q: 'coffee', c});
    assert.ok(Array.isArray(follow.read.data)); assert.equal(follow.read.complete, false); assert.equal(follow.paths.length, 0);
    const retained = await local(tier, 'floor', floorAuth); locals.push(retained);
    for (const on of [true, false]) {
      await retained.network(on);
      await coffeePages(retained, `current-${on}`, false, on);
      for (const row of floor) {
        const {read, paths} = await retained.read(`current-${on ? 'online' : 'offline'}-${row.text}`, 'osChat', {conversation, q: row.text});
        assert.deepEqual(ids(read), on || row.ordinal >= 4 ? [row.id] : []);
        if (!on) { assert.equal(read.complete, false); assert.equal(paths.length, 0); }
      }
    }
    await retained.network(true);
  }
  await sent(owner, 'removeMember', {conversation, principal: floorPrincipal});
  await sent(owner, 'removeMember', {conversation: empty, principal: floorPrincipal});
  const later = mintId();
  await sent(owner, 'send', {id: later, conversation, text: scaledFloor ? 'coffee osfloorlater' : 'osfloorlater', quote: null});
  for (const retained of locals) {
    await retained.client.sync();
    for (const on of [true, false]) {
      await retained.network(on);
      await coffeePages(retained, `departed-${on}`, true, on);
      for (const row of [...floor, {id: later, ordinal: 504, text: 'osfloorlater'}]) {
        const {read, paths} = await retained.read(`departed-${on ? 'online' : 'offline'}-${row.text}`, 'osChat', {conversation, q: row.text});
        assert.deepEqual(ids(read), row.ordinal >= 4 && row.ordinal <= 5 ? [row.id] : []);
        assert.equal(read.complete, false); assert.equal(paths.length, 0);
      }
      const result = await retained.read(`departed-empty-${on}`, 'osChat', {conversation: empty, q: 'osfloor'});
      // Existing coverage limitation: this builder acquires by ordinal, while
      // search orders by at. Even an acquired empty Left group is incomplete.
      assert.deepEqual(ids(result.read), []); assert.equal(result.read.complete, false); assert.equal(result.paths.length, 0);
      const guard = await retained.read(`guarded-control-${on}`, 'searchIn', {conversation, q: 'osfloor'});
      assert.equal(guard.read.denied?.code, 'NOT_MEMBER');
      const explicit = await retained.read(`explicit-control-${on}`, 'searchNewest', {q: 'osfloor'});
      assert.deepEqual(ids(explicit.read), []);
    }
    await retained.network(true);
  }
  const guard = await (scaledFloor ? scaleOnline : reader).query(q('searchIn'), {conversation, q: 'osfloor'});
  assert.equal(guard.denied?.code, 'NOT_MEMBER'); record('unchanged-server-guard', {read: guard});
  await sent(owner, 'addMember', {conversation, principal: floorPrincipal});
  for (const retained of locals) {
    await retained.network(true);
    const {read} = await retained.read('rejoin-below-floor', 'osChat', {conversation, q: 'osfloorbelow'});
    assert.deepEqual(ids(read), [floor[0].id]);
  }
  record('finished', {pass: true, scope: 'current-scope server inference, original device scan, per-chat floor matrix; no mixed merge claim'});
} catch (error) {
  record('failure', {message: error.stack}); process.exitCode = 1;
} finally {
  for (const client of clients.reverse()) await client.close().catch(() => {});
  if (host?.exitCode === null) { const stopped = new Promise(r => host.once('exit', r)); host.kill('SIGTERM'); await stopped; }
}
