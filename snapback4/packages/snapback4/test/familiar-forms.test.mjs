import { captureStdout } from './helpers/server-output.mjs';
import { hangBudget } from './helpers/wait.mjs';
// Compile Quarry through the real CLI; run its admitted IR on both device stores.
import test from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {setTimeout as delay} from 'node:timers/promises';
import {createLocalClient} from '../dist/local.js';
import {processDevice} from '../dist/native.js';
import {memoryPersistence, webDevice} from '../dist/web.js';

const root = fileURLToPath(new URL('../../../', import.meta.url));
const binary = process.env.SNAPBACK4_BIN ?? join(root, 'target/debug/snapback4');
const source = `use personas alice
 table members:
  conversation: id
  principal: principal
  active: bool
  unique conversation, principal
  cap 50 by conversation
  public
  insert <- allow
  sync public
 table privateNotes:
  conversation: id
  owner: principal
  body: text
  unique conversation, owner
  cap 10 by conversation, owner
  read <- .owner = viewer
  insert <- allow
  sync to .owner
 table predictedNotes:
  author: principal
  owner: principal
  value: int
  read <- .owner = viewer
  insert <- .author = viewer
  update <- .author = viewer
  sync to .owner
 query prediction(id: predictedNotes):
  return predictedNotes[id] { value }
 mutation predict(owner: principal, x: int) predicts:
  return insert predictedNotes { author: viewer, owner, value: m.twice(x) }
 mutation guarded(id: predictedNotes, x: int) predicts:
  return update predictedNotes[id] { value: 21 } if m.twice(x) = 14
 table tasks:
  due: time ?
  title: text <=80
  open: bool
  public
  insert <- allow
  sync public
 query present(c: cursor ?):
  return tasks where .due >= .due first 20 by .title after c { title }
 query presentLte(c: cursor ?):
  return tasks where .due <= .due first 20 by .title after c { title }
 query presentOrTitle(title: text <=80, c: cursor ?):
  return tasks where .due <= .due or .title = title first 20 by .title after c { title }
 query presenceKey(c: cursor ?):
  return tasks where exists tasks[open = (.due >= .due)] first 20 by .title after c { title }
 query roster(c: cursor ?):
  return members where .principal = viewer first 20 by .conversation after c { conversation, roster: members[conversation = .conversation], notes: privateNotes[conversation = .conversation, owner = viewer] { body } }
 query repeated(chat: id, c: cursor ?):
  return members where .conversation = chat where .active first 20 by .principal after c
 query conjunction(chat: id, c: cursor ?):
  return members where .conversation = chat and .active first 20 by .principal after c
 query safe(d: int):
  return count(members where d != 0 where 10 / d > 1)
 query qualified(x: int):
  return m.twice(x)
 query bare(x: int):
  return twice(x)
 query size(x: text):
  return count(x)
 query privateOne(chat: id, owner: principal):
  return m.note(chat, owner)
 query required(id: members):
  return m.label(members[id] ! else NOT_FOUND)
 mutation seed():
  insert tasks { due: 100, title: 'dated', open: true }
  insert tasks { title: 'undated', open: true }
  insert members { id: 'a', conversation: 'one', principal: viewer, active: true }
  insert members { id: 'b', conversation: 'one', principal: 'bob', active: false }
  insert members { id: 'c', conversation: 'two', principal: viewer, active: true }
  insert members { id: 'd', conversation: 'two', principal: 'carol', active: true }
  insert privateNotes { conversation: 'one', owner: viewer, body: 'visible one' }
  insert privateNotes { conversation: 'two', owner: viewer, body: 'visible two' }
  insert privateNotes { conversation: 'one', owner: 'bob', body: 'hidden' }
`.replace(/^ /gm, '');

test('familiar forms preserve nested bindings, disclosure, helper semantics on wasm and native', {timeout: hangBudget(36)}, async t => {
  const directory = mkdtempSync(join(tmpdir(), 'sb4-familiar-'));
  mkdirSync(join(directory, 'snapback'));
  writeFileSync(join(directory, 'snapback/schema.q'), source);
  writeFileSync(join(directory, 'snapback/m.q'), 'fn twice(x: int): x + x\nfn label(row: members): row.principal\nfn note(chat: id, owner: principal): privateNotes[conversation = chat, owner = owner] { body }\n');
  const server = spawn(binary, ['dev', '--port', '0', '--no-watch', '--memory', '--hold-schedules'], {cwd: directory, stdio: ['ignore', 'pipe', 'pipe']});
  const readStdout = captureStdout(server);
  const exited = once(server, 'exit');
  let log = '', url;
  const clients = [];
  t.after(async () => {
    for (const client of clients) await client.close();
    if (server.exitCode == null && server.signalCode == null) server.kill();
    await exited;
    rmSync(directory, {recursive: true, force: true});
  });
  for (const stream of [server.stdout, server.stderr]) stream.on('data', bytes => { log += bytes; url ??= readStdout().match(/http:\/\/127\.0\.0\.1:\d+(?=\r?\n)/)?.[0]; });
  const deadline = performance.now() + hangBudget();
  while (!url) {
    assert.equal(server.exitCode, null, log);
    assert.ok(performance.now() < deadline, log);
    await delay(20);
  }
  const online = async (kind, name, args = {}) => {
    const response = await fetch(`${url}/${kind}/${name}`, {method: 'POST', headers: {'x-snapback-persona': 'alice', 'content-type': 'application/json'}, body: JSON.stringify({args}), signal: AbortSignal.timeout(hangBudget())});
    assert.equal(response.status, 200);
    const answer = await response.json();
    assert.equal(answer.denied, undefined, JSON.stringify(answer));
    return answer;
  };
  assert.equal((await online('m', 'seed')).state, 'sent');
  const repeatedOnline = await online('q', 'repeated', {chat: 'one', c: null});
  const conjunctionOnline = await online('q', 'conjunction', {chat: 'one', c: null});
  assert.ok(repeatedOnline.meter, 'loopback dev exposes measured server work');
  assert.deepEqual(repeatedOnline.meter, conjunctionOnline.meter);
  assert.equal((await online('q', 'privateOne', {chat: 'one', owner: 'bob'})).data, null, 'qualified helper cannot project a foreign-owned note');
  const expected = await online('q', 'roster', {c: null});
  assert.equal(expected.data.length, 2);
  for (const row of expected.data) {
    assert.equal(row.roster.length, 2);
    assert.ok(row.roster.every(member => member.conversation === row.conversation));
    assert.deepEqual(row.notes, {body: `visible ${row.conversation}`});
  }
  const openers = [
    ['wasm-memory', webDevice({wasm: readFileSync(new URL('../src/wasm/snapback4_device_bg.wasm', import.meta.url)), persist: memoryPersistence()})],
    ['native-sqlite', processDevice({binary, dir: join(directory, 'device')})],
  ];
  for (const [host, device] of openers) {
    let offline = false;
    let core;
    const captured = {open: async (...args) => (core = await device.open(...args))};
    const client = await createLocalClient({url, persona: 'alice', device: captured, fetch: (...args) => {
      if (offline) throw new TypeError('offline witness');
      return fetch(...args);
    }});
    clients.push(client);
    assert.equal(client.acquired, true, host);
    offline = true;
    const query = async (name, args = {}) => {
      const answer = await client.query({kind: 'query', name}, args);
      assert.equal(answer.denied, undefined, `${host}: ${JSON.stringify(answer)}`);
      assert.equal(answer.complete, true, `${host}: ${JSON.stringify(answer)}`);
      return answer;
    };
    assert.deepEqual((await query('roster', {c: null})).data, expected.data, host);
    const repeated = await query('repeated', {chat: 'one', c: null});
    const conjunction = await query('conjunction', {chat: 'one', c: null});
    assert.deepEqual(repeated.data, conjunction.data, host);
    assert.equal(repeated.data.length, 1);
    assert.equal((await query('safe', {d: 0})).data, 0);
    for (const op of ['qualified', 'bare']) assert.equal((await query(op, {x: 3})).data, 6);
    assert.equal((await query('size', {x: 'hello'})).data, 5);
    assert.equal((await query('required', {id: 'b'})).data, 'bob');
    assert.equal((await query('privateOne', {chat: 'one', owner: 'bob'})).data, null, host);
    assert.deepEqual((await query('privateOne', {chat: 'one', owner: 'dev:alice'})).data, {body: 'visible one'}, host);
    const missing = await client.query({kind: 'query', name: 'required'}, {id: 'missing'});
    assert.equal(missing.denied?.code, 'NOT_FOUND');
    for (const [name, args, titles] of [
      ['present', {c: null}, ['dated']],
      ['presentLte', {c: null}, ['dated']],
      ['presentOrTitle', {title: 'undated', c: null}, ['dated', 'undated']],
      ['presenceKey', {c: null}, ['dated']],
    ]) {
      const expected = titles.map(title => ({title}));
      assert.deepEqual((await query(name, args)).data, expected, `${host}: nullable ordering retains presence semantics`);
      assert.deepEqual((await online('q', name, args)).data, expected);
    }
    // A pending Write has no result field. Observe prediction through the
    // rule-filtered local query, and verify the outbox contains a predicted row.
    for (const [owner, x] of [['dev:alice', 7], ['bob', 9]]) {
      const write = await client.mutate({kind: 'mutation', name: 'predict'}, {owner, x});
      assert.equal(write.state, 'pending', `${host}: ${JSON.stringify(write)}`);
      assert.equal(write.reason, undefined, `${host}: must predict, not queue without a row`);
      const queued = (await core.call({op: 'queued'})).ok;
      const entry = queued.find(entry => entry.id === write.id);
      assert.equal(entry.predictable, true, host);
      assert.equal(entry.predicted.length, 1, host);
      assert.ok(entry.predicted[0].startsWith('predictedNotes/'));
      const id = entry.predicted[0].slice('predictedNotes/'.length);
      const local = await query('prediction', {id});
      assert.deepEqual(local.data, owner === 'dev:alice' ? {value: 14, pending: true} : null,
        `${host}: rules filter even a row present in the pending overlay`);
      assert.equal((await online('q', 'prediction', {id})).data, null, `${host}: offline write never reached server`);
      if (owner === 'dev:alice') {
        const guarded = await client.mutate({kind: 'mutation', name: 'guarded'}, {id, x: 7});
        assert.equal(guarded.state, 'pending', `${host}: ${JSON.stringify(guarded)}`);
        assert.equal(guarded.reason, undefined, `${host}: Write.condition must be normalized before prediction`);
        const update = (await core.call({op: 'queued'})).ok.find(entry => entry.id === guarded.id);
        assert.equal(update.predictable, true, host);
        assert.deepEqual(update.predicted, [`predictedNotes/${id}`], host);
        assert.deepEqual((await query('prediction', {id})).data, {value: 21, pending: true}, host);
        const rejected = await client.mutate({kind: 'mutation', name: 'guarded'}, {id, x: 6});
        assert.equal(rejected.state, 'failed', `${host}: false helper guard must not predict a write: ${JSON.stringify(rejected)}`);
        assert.deepEqual((await query('prediction', {id})).data, {value: 21, pending: true}, host);
        assert.equal((await online('q', 'prediction', {id})).data, null, `${host}: predicted update never reached server`);
      }
    }
    await client.close();
    clients.pop();
  }
});
