// Run from any directory after scripts/test.sh has built the native host and SDK.
// Calibration #28's M8 data, real HTTP host, persisted worker ledger, SIGTERM restart.
import assert from 'node:assert/strict';
import { spawn, execFileSync } from 'node:child_process';
import { once } from 'node:events';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runWorker } from '../../packages/snapback4/dist/worker.js';

const root = fileURLToPath(new URL('../../../', import.meta.url));
const binary = resolve(root, 'snapback4/target/debug/snapback4');
const archive = resolve(root, 'benchmarks/runs/2026-10-01-snapback4-clique-astra-0.4.10/astra/source/snapback');
const original = readFileSync(join(archive, 'schema.q'), 'utf8');
const start = original.indexOf('    for member in members where .principal = p.principal:');
const end = original.indexOf('    if newFollowers > 0', start);
assert.ok(start > 0 && end > start);
const modern = original.slice(0, start) + `    as p.principal:
      for chat in all(unreadPreview(periodStart, periodEnd, null)):
        if chat.unread > 0:
          unreadMessages = unreadMessages + chat.unread
          unreadChats = unreadChats + 1
` + original.slice(end) + `
query unreadPreview(start: time, end: time, c: cursor ?):
  return members where .principal = viewer first 2 by .conversation after c { conversation, unread: digestUnread(.conversation, viewer, .seenOrdinal, start, end) }
`;
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
async function until(read, label) {
  const deadline = Date.now() + 20000;
  while (Date.now() < deadline) { if (await read()) return; await pause(30); }
  throw Error(`timed out: ${label}`);
}
const outcomes = [];
for (const [tag, source] of [['legacy', original], ['viewer', modern]]) {
  const dir = mkdtempSync(join(tmpdir(), 'jv-host-'));
  mkdirSync(join(dir, 'snapback'));
  writeFileSync(join(dir, 'snapback/schema.q'), 'use personas d1, d2, d3, d4, d5\n' + source);
  for (const name of ['config.q', 'digest.q']) writeFileSync(join(dir, 'snapback', name), readFileSync(join(archive, name)));
  let child, api, worker, stop, log = '', token;
  const deliveries = new Map(), invocations = [];
  async function launch(time) {
    const offset = time - Date.now();
    child = spawn(binary, ['dev', '--no-watch', '--port', '0', '--clock-offset', `${offset}ms`], { cwd: dir, stdio: ['ignore', 'pipe', 'pipe'] });
    child.stderr.on('data', data => { log += data; });
    let output = '';
    child.stdout.on('data', data => { output += data; });
    await until(() => { api = output.match(/http:\/\/[^\s]+/)?.[0]; return api; }, `${tag} listener: ${log}`);
    return child.pid;
  }
  async function request(path, body, principal = 'd1', service = false) {
    const response = await fetch(api + path, { method: body === undefined ? 'GET' : 'POST', headers: {
      'content-type': 'application/json', connection: 'close',
      ...(service ? { authorization: `Bearer ${token}` } : { 'x-snapback-persona': principal }),
    }, body: body === undefined ? undefined : JSON.stringify(body) });
    const data = await response.json();
    assert.ok(response.ok && !data.denied, `${path}: ${JSON.stringify(data)}`);
    return { data, now: Number(response.headers.get('x-snapback-time')) };
  }
  async function mutate(name, args, p) {
    const { data } = await request('/m/' + name, { id: `${tag}-${name}-${crypto.randomUUID()}`, args }, p);
    assert.equal(data.state, 'sent', JSON.stringify(data));
  }
  async function advanceTo(time) {
    const { now } = await request('/probe');
    assert.ok(time > now, `${time} > ${now}`);
    await request('/dev/clock/advance', { duration: `${time - now}ms` });
  }
  function startWorker() {
    stop = new AbortController();
    worker = runWorker({ url: api, token, ledger: join(dir, 'worker.sqlite'), signal: stop.signal, effects: { push: async (payload, meta) => {
      invocations.push(meta.idempotencyKey);
      deliveries.set(meta.idempotencyKey, payload);
      return { logged: meta.idempotencyKey };
    } } });
  }
  async function shutdown() {
    if (worker) { stop.abort(); await worker.done; worker = undefined; }
    if (child && child.exitCode === null) { child.kill('SIGTERM'); await once(child, 'exit'); }
  }
  try {
    const firstPid = await launch(1201000);
    token = execFileSync(binary, ['token', '--service', 'push'], { cwd: dir, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
    startWorker();
    for (let n = 1; n <= 5; n++) await mutate('saveProfile', { displayName: `D${n}`, handle: `person${n}`, bio: '', location: '', link: null }, `d${n}`);
    await mutate('setFollow', { principal: 'dev:d1', enabled: true }, 'd3');
    for (let n = 1; n <= 2; n++) await mutate('publish', { id: `post${n}`, text: 'A post', parent: null, images: [], video: null }, 'd1');
    await mutate('openDirect', { id: 'direct', other: 'dev:d3' }, 'd1');
    for (let n = 1; n <= 3; n++) await mutate('send', { id: `dm${n}`, conversation: 'direct', text: 'DM', quote: null }, 'd1');
    await mutate('createGroup', { id: 'outsiders', title: 'Outsiders', description: '', other: 'dev:d5' }, 'd4');
    for (let n = 1; n <= 5; n++) await mutate('send', { id: `group${n}`, conversation: 'outsiders', text: 'Group', quote: null }, 'd4');
    // All application requests used Connection: close; no client/poll remains.
    await advanceTo(1260000);
    assert.equal([...deliveries.values()].filter(p => p.kind === 'digest').length, 0);
    await shutdown();
    const secondPid = await launch(1260000);
    assert.notEqual(firstPid, secondPid);
    startWorker();
    await advanceTo(1320010);
    await until(() => [...deliveries.values()].filter(p => p.kind === 'digest').length === 3, `${tag} digest deliveries`);
    const digests = [...deliveries.values()].filter(p => p.kind === 'digest').sort((a, b) => a.targetUserId.localeCompare(b.targetUserId));
    const counts = digests.map(p => [p.targetUserId, p.newFollowers, p.newPostsInFollowing, p.unreadMessages, p.unreadChats]);
    assert.deepEqual(counts, [['dev:d1', 1, 2, 0, 0], ['dev:d3', 0, 2, 3, 1], ['dev:d5', 0, 0, 5, 1]]);
    assert.ok(digests.every(p => p.periodStart === 1200000 && p.periodEnd === 1320000));
    await advanceTo(1440010);
    await until(async () => {
      const { data } = await request('/effects?state=queued', undefined, undefined, true);
      return data.effects.length === 0;
    }, `${tag} worker drained`);
    const { data: sent } = await request('/effects?state=sent', undefined, undefined, true);
    assert.equal(sent.effects.filter(e => e.payload.kind === 'digest').length, 3, 'idle period emits no digest');
    assert.equal(new Set(invocations).size, invocations.length, 'no duplicate worker idempotency keys across restart');
    outcomes.push(digests);
    console.log(JSON.stringify({ tag, firstPid, secondPid, counts, closedClients: true, idleDigests: 0, duplicateKeys: 0, workerDeliveries: invocations.length }));
  } catch (error) { console.error(log); throw error; }
  finally { await shutdown(); rmSync(dir, { recursive: true, force: true }); }
}
assert.deepEqual(outcomes[0], outcomes[1]);
console.log('host replay: PASS — legacy and viewer digest payloads match; closed clients, SIGTERM restart, idle period, durable worker ledger');
