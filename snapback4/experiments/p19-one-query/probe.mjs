// Research harness only: public clients, real process devices and copied stores.
// @ref LLP 3000.028#2 — distinguish historical reports from fresh observations.
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync, appendFileSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { createHash } from 'node:crypto';

const here = import.meta.dirname, sb4 = resolve(here, '../..');
const version = process.argv[2];
assert.ok(['published', 'main'].includes(version));
const work = join(here, '.work', version), app = join(work, 'app');
const pkg = version === 'published' ? join(work, 'node_modules/snapback4') : join(sb4, 'packages/snapback4');
const binary = version === 'published' ? join(work, 'node_modules/snapback4-linux-x64/snapback4') : join(sb4, 'target/debug/snapback4');
const { createClient, mintId, idFrom } = await import(join(pkg, 'dist/client.js'));
const { createLocalClient } = await import(join(pkg, 'dist/local.js'));
const { processDevice } = await import(join(pkg, 'dist/native.js'));
const { login } = await import(join(pkg, 'dist/auth.js'));
const q = name => ({ kind: 'query', name }), m = name => ({ kind: 'mutation', name });
const result = { version, sourceCommit: spawnSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8', cwd: sb4 }).stdout.trim(), binarySha256: createHash('sha256').update(readFileSync(binary)).digest('hex'), observations: [] };
function record(stage, value) {
  result.observations.push({ stage, ...value });
  const { observations, ...identity } = result;
  writeFileSync(join(here, 'results', `${version}.jsonl`), [identity, ...observations].map(x => JSON.stringify(x)).join('\n') + '\n');
  console.log(stage);
}
let output = '', host, clients = [];
const serverLog = join(work, 'server.log');
async function until(fn, label, ms = 180000) {
  const deadline = Date.now() + ms;
  while (Date.now() < deadline) { const value = await fn(); if (value) return value; await delay(30); }
  throw new Error(`Timeout: ${label}`);
}
async function sent(c, name, args) { const r = await c.mutate(m(name), args); assert.equal(r.state, 'sent', JSON.stringify(r)); return r.result; }
function compact(read) {
  const out = { ...read };
  if (Array.isArray(out.data)) out.data = out.data.map(row => ({ id: row.id, conversation: row.conversation, ordinal: row.ordinal, text: row.text }));
  return out;
}
try {
  host = spawn(binary, ['dev', '--port', '0', '--no-watch', '--replay'], { cwd: app, stdio: ['ignore', 'pipe', 'pipe'] });
  record('server-start', { pid: host.pid });
  for (const stream of [host.stdout, host.stderr]) stream.on('data', b => { output += b; appendFileSync(serverLog, b); });
  const url = await until(() => { assert.equal(host.exitCode, null, output.slice(-4000)); return output.match(/http:\/\/127\.0\.0\.1:\d+/)?.[0]; }, 'server');
  const owner = createClient({ url, persona: 'p19owner' }), reader = createClient({ url, persona: 'p19reader' });
  clients.push(owner, reader);
  for (const [client, handle] of [[owner, 'p19owner'], [reader, 'p19reader']]) await sent(client, 'saveProfile', { displayName: handle, handle, bio: '', location: '', link: null });
  const conversation = mintId(), before = mintId(), after = mintId();
  await sent(owner, 'createGroup', { id: conversation, other: 'dev:p19reader', title: 'P19 retention', description: '' });
  await sent(owner, 'send', { id: before, conversation, text: 'p19retained coffee', quote: null });
  async function local(name, auth) {
    let offline = false, core;
    const requests = [], observed = [];
    const opener = processDevice({ binary, dir: join(work, 'devices', name), spawn: (...args) => { const child = spawn(...args); record('device-start', { name, pid: child.pid }); return child; } });
    const device = { async open(...args) { core = await opener.open(...args); return { close: () => core.close(), async call(req) { const r = await core.call(req); if (req.op === 'query') observed.push({ name: req.name, answer: compact(r.ok ?? r) }); return r; } }; } };
    const client = await createLocalClient({ url, ...auth, device, fetch: async (input, init) => {
      if (offline) throw new TypeError('P19 offline');
      requests.push(new URL(input).pathname);
      if (new URL(input).pathname === '/changes') return new Promise((_, reject) => {
        if (init?.signal?.aborted) return reject(init.signal.reason);
        init?.signal?.addEventListener('abort', () => reject(init.signal.reason), { once: true });
      });
      return fetch(input, init);
    } });
    clients.push(client);
    const start = performance.now(); await client.sync(); await client.sync();
    record('acquired', { name, acquired: client.acquired, explicitSyncMs: performance.now() - start, residency: await client.residency() });
    return { client, requests, observed, async network(on) { offline = !on; await client.sync(); },
      async read(stage, op, args) { const n = requests.length, k = observed.length; const r = await client.query(q(op), args); record(stage, { op, read: compact(r), requests: requests.slice(n), device: observed.slice(k) }); return r; },
      async raw(op, args, viewer) { return core.call({ op: 'query', name: op, args, viewer, now: Date.now() }); } };
  }
  const held = await local('retention', { persona: 'p19reader' });
  await held.read('history-before-leave', 'history', { conversation });
  await sent(owner, 'removeMember', { conversation, principal: 'dev:p19reader' });
  await held.client.sync(); await held.client.sync();
  record('history-server-after-leave', { read: compact(await reader.query(q('history'), { conversation })), guarded: await reader.query(q('progress'), { conversation }) });
  await held.read('history-local-online-after-leave', 'history', { conversation });
  await held.read('history-held-online-after-leave', 'historyHeld', { conversation });
  await sent(owner, 'send', { id: after, conversation, text: 'p19later coffee', quote: null });
  await held.client.sync(); await held.client.sync();
  await held.network(false);
  for (const op of ['history', 'historyHeld']) await held.read('history-offline-after-leave-' + op, op, { conversation });
  for (const op of ['searchNewest', 'searchHeld', 'p19SearchOrdinary']) await held.read('retained-search-offline-' + op, op, { q: 'p19retained' });
  await held.network(true);
  await sent(owner, 'addMember', { conversation, principal: 'dev:p19reader' });
  await held.client.sync(); await held.client.sync();
  await held.read('history-rejoined', 'history', { conversation });
  // A present and an absent own key in windowed public relations.
  const post = mintId();
  await sent(owner, 'publish', { id: post, text: 'P19 absence', parent: null, images: null, video: null });
  await held.client.sync(); await held.client.sync();
  for (const op of ['p19RawState', 'postState']) await held.read('absence-online-' + op, op, { post });
  await held.network(false);
  for (const op of ['p19RawState', 'postState']) await held.read('absence-offline-' + op, op, { post });
  await held.read('composed-absence-offline', 'p19RawPost', { id: post });
  record('absence-no-pending', { pending: await held.client.pendingWrites() });
  await held.network(true);
  await sent(reader, 'setLike', { post, active: true });
  await sent(reader, 'setRepost', { post, active: true });
  await held.client.sync(); await held.client.sync(); await held.network(false);
  await held.read('present-own-keys-offline', 'p19RawState', { post });
  // Existing scale identity, with credentials parsed but never recorded.
  const evidence = process.env.P19_EVIDENCE ?? '/home/ccheever/sb4-intent/rg-evidence/lane';
  const registration = readFileSync(join(evidence, 'instrument/fixtures/scale.log'), 'utf8').split('\n').find(line => / u0500 register /.test(line));
  const tokens = registration.match(/"(?:[^"\\]|\\.)*"|\S+/g).map(t => t.startsWith('"') ? JSON.parse(t) : t);
  const signed = await login(url, tokens[3], tokens[4]); assert.ok(signed.ok);
  const onlineScale = createClient({ url, session: signed.session }); clients.push(onlineScale);
  const scale = await local('u0500', { session: signed.session });
  for (const op of ['searchNewest', 'searchHeld', 'p19SearchOrdinary']) {
    record('scale-server-' + op, { read: compact(await onlineScale.query(q(op), { q: 'coffee' })) });
    await scale.read('scale-online-' + op, op, { q: 'coffee' });
  }
  await scale.network(false);
  for (const op of ['searchNewest', 'searchHeld', 'p19SearchOrdinary']) await scale.read('scale-offline-' + op, op, { q: 'coffee' });
  // The busy group's prefix is truncated at 500; ordinary reads beyond it
  // must fetch online but return an honest partial answer offline.
  await scale.read('scale-history-offline', 'history', { conversation: idFrom('g0001') });
  record('finished', { pass: true });
} catch (error) {
  record('failure', { message: error.stack }); process.exitCode = 1;
} finally {
  for (const client of clients.reverse()) await client.close().catch(() => {});
  if (host?.exitCode === null) { const closed = new Promise(r => host.once('exit', r)); host.kill('SIGTERM'); await closed; }
}
