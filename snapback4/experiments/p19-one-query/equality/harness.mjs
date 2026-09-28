// @ref LLP 3000.028#7.1 — public clients, isolated copies, real device publications.
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync, appendFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { createClient } from '../../../packages/snapback4/dist/client.js';
import { createLocalClient } from '../../../packages/snapback4/dist/local.js';
import { processDevice } from '../../../packages/snapback4/dist/native.js';
import { webDevice, memoryPersistence } from '../../../packages/snapback4/dist/web.js';
import { parkedChanges, syncControl } from '../../../packages/snapback4/test/helpers/sync-control.mjs';
export const root = resolve(import.meta.dirname, '../../..');
export const binary = join(root, 'target/debug/snapback4');
export const q = name => ({ kind: 'query', name });
export const evidence = process.env.EQ_EVIDENCE ?? '/home/ccheever/sb4-intent/rg-evidence/lane';
export const gate = () => { const ready = Promise.withResolvers(), released = Promise.withResolvers(); return { ready: ready.promise, entered: ready.resolve, wait: released.promise, release: released.resolve }; };
export async function until(fn, label, ms = 60000) {
  const end = Date.now() + ms;
  while (Date.now() < end) { const answer = await fn(); if (answer) return answer; await delay(10); }
  assert.fail(`timeout: ${label}`);
}
export async function sent(client, name, args) {
  const write = await client.mutate({ kind: 'mutation', name }, args);
  assert.equal(write.state, 'sent', JSON.stringify(write)); return write.result;
}
export const source = readFileSync(join(import.meta.dirname, 'builder.q'), 'utf8');
export const probes = `
use personas eqowner, eqreader
query historyBracket(conversation: conversations, c: cursor ?):
  return messages[conversation = conversation] last 20 by byHistory after c
query filteredWhere(conversation: conversations, c: cursor ?):
  return messages where .conversation = conversation and not .tombstone first 20 by byHistory after c
query filteredBracket(conversation: conversations, c: cursor ?):
  return messages[conversation = conversation] where not .tombstone first 20 by byHistory after c
query heldControl(conversation: conversations, c: cursor ?) held:
  return messages[conversation = conversation] last 20 by byHistory after c
`;
export async function host(t, { full = false, timestamp = false } = {}) {
  const work = join(root, 'experiments/p19-one-query/.work'); mkdirSync(work, { recursive: true });
  const dir = mkdtempSync(join(work, full ? 'eq-scale-' : 'eq-small-'));
  mkdirSync(join(dir, 'snapback'));
  if (full) {
    assert.equal(spawnSync('cp', ['-a', '--reflink=auto', join(evidence, 'scale-instance/.snapback4'), dir]).status, 0);
    assert.equal(spawnSync('chmod', ['-R', 'u+w', join(dir, '.snapback4')]).status, 0);
  }
  writeFileSync(join(dir, 'snapback/schema.q'), (timestamp ? source.replace('by byHistory: conversation, ordinal, id', 'by byHistory: conversation, at, id') : source) + probes);
  let output = '';
  const process = spawn(binary, ['dev', '--port', '0', '--no-watch', '--replay'], { cwd: dir, stdio: ['ignore', 'pipe', 'pipe'] });
  for (const stream of [process.stdout, process.stderr]) stream.on('data', data => { output += data; appendFileSync(join(dir, 'server.log'), data); });
  t.after(async () => { if (process.exitCode === null) { const end = new Promise(r => process.once('exit', r)); process.kill('SIGTERM'); await end; } });
  const url = await until(() => { assert.equal(process.exitCode, null, output.slice(-5000)); return output.match(/http:\/\/127\.0\.0\.1:\d+/)?.[0]; }, 'server', 180000);
  const clients = [], recordPath = join(dir, 'snapshots.jsonl');
  const online = auth => { const c = createClient({ url, ...auth }); clients.push(c); return c; };
  t.after(async () => { for (const c of clients) await c.close(); });
  const seed = async rows => { const r = await fetch(`${url}/seed`, { method: 'POST', body: JSON.stringify(rows) }).then(r => r.json()); assert.equal(r.seeded, rows.length, JSON.stringify(r)); };
  const record = (stage, answer) => appendFileSync(recordPath, JSON.stringify({ stage, ...answer }) + '\n');
  t.diagnostic(`evidence ${recordPath}`);
  return { url, dir, online, seed, record };
}
export async function replica(t, h, tier) {
  let mode = 'before', snapshots = 0, core, publication, saveGate;
  const clients = [], requests = [], requestBodies = [], observations = [], memory = memoryPersistence();
  const persist = { ...memory, async save(name, changes) {
    // This is the real host durability boundary, after wasm executes and
    // before the changed rows/coverage can be acknowledged to the client.
    if (saveGate && changes.some(c => c.s === 'm' && c.k === 'device:acquired-generation' && c.v !== null)) {
      const held = saveGate; saveGate = undefined; held.entered(); await held.wait;
    }
    return memory.save(name, changes);
  } };
  const opener = tier === 'wasm' ? webDevice({ wasm: readFileSync(join(root, 'packages/snapback4/src/wasm/snapback4_device_bg.wasm')), persist })
    : processDevice({ binary, dir: join(h.dir, `device-${tier}`) });
  const control = syncControl(t);
  const open = async () => {
    const client = await createLocalClient({ url: h.url, persona: 'eqreader', waitSeconds: 0,
      device: { async open(...args) {
        core = await opener.open(...args); const current = core;
        return { close: () => current.close(), async call(request, ...rest) {
          if (publication && request.op === 'apply' && request.page.snapshot_catchup && !request.page.more) {
            const held = publication; publication = undefined; held.entered(); await held.wait;
          }
          const reply = await current.call(request, ...rest);
          if (request.op === 'query') observations.push({ name: request.name, ...reply.ok });
          return reply;
        } };
      } }, fetch: async (input, init) => {
        const path = new URL(input).pathname;
        if (mode === 'offline') throw new TypeError('EQ disconnected');
        if (path === '/changes') return parkedChanges(init.signal);
        if (path === '/sync') {
          const body = JSON.parse(init.body);
          if (mode === 'before' || mode === 'staged' && snapshots > 0 || mode === 'catchup' && body.stream) throw new TypeError('EQ held acquisition');
          const response = await control.fetch(input, init), page = await response.clone().json();
          if (page.snapshot) snapshots++;
          return response;
        }
        if (path.startsWith('/q/')) { requests.push(path); requestBodies.push({ path, args: JSON.parse(init.body).args }); }
        return fetch(input, init);
      } });
    clients.push(client); return client;
  };
  t.after(async () => { publication?.release(); saveGate?.release(); for (const c of clients) await c.close(); });
  return { open, requests, requestBodies, observations, control, mode(value) { mode = value; },
    holdPublication() { return publication = gate(); }, holdSave() { return saveGate = gate(); },
    raw: async (name, args) => (await core.call({ op: 'query', name, args, viewer: 'dev:eqreader', now: Date.now() })).ok,
    state: async () => (await core.call({ op: 'sync_state', capture: false })).ok,
  };
}
export const ids = read => read.data?.map(row => row.id);
export async function pair(h, f, client, conversation, { c = [null, null], filtered = false, stage = '', retained, noFallback = false } = {}) {
  const names = filtered ? ['filteredWhere', 'filteredBracket'] : ['history', 'historyBracket'];
  const start = f.requests.length, reads = [], raw = [];
  for (let n = 0; n < 2; n++) {
    reads.push(await client.query(q(names[n]), { conversation, c: c[n] }));
    raw.push(await f.raw(names[n], { conversation, c: c[n] }));
  }
  h.record(stage, { conversation, reads, raw, requests: f.requests.slice(start), queryRequests: f.requestBodies.slice(start) });
  for (const key of ['data', 'complete', 'fresh', 'cut', 'loading', 'denied']) assert.deepEqual(reads[0][key], reads[1][key], `${stage} ${key}`);
  for (const key of ['data', 'complete', 'unknown', 'retained', 'speculative']) assert.deepEqual(raw[0][key], raw[1][key], `${stage} raw ${key}`);
  assert.equal(!!reads[0].next, !!reads[1].next);
  if (retained !== undefined) assert.equal(raw[0].retained, retained, `${stage} retained: ${JSON.stringify(raw[0])}`);
  if (noFallback) assert.deepEqual(f.requests.slice(start), [], `${stage} fallback`);
  return { read: reads[0], raw: raw[0], cursors: reads.map(r => r.next) };
}
