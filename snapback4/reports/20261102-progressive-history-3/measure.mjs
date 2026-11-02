// @ref LLP 3000.001.001#102-performance-acceptance — development timings on the existing scale seed; not browser qualification.
import assert from 'node:assert/strict';
import { appendFileSync, closeSync, copyFileSync, existsSync, fsyncSync, mkdirSync, openSync, readFileSync, writeFileSync } from 'node:fs';
import { cpus, hostname, loadavg, platform, arch } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createLocalClient } from '../../packages/snapback4/dist/local.js';
import { prepareClient } from '../../packages/snapback4/dist/client-start.js';
import { memoryPersistence, webDevice } from '../../packages/snapback4/dist/web.js';
import { foregroundHint } from '../../packages/snapback4/dist/local-acquisition.js';
import { scaleSeed, devServer, binary, root } from '../../witness/lib.mjs';

const report = resolve(import.meta.dirname);
const work = join(root, 'target/progressive-history-3');
mkdirSync(work, { recursive: true });
process.env.TMPDIR = work; // All disposable fixture files stay inside this worktree's snapback4/.
const wasmPath = join(root, 'packages/snapback4/src/wasm/snapback4_device_bg.wasm');
const wasm = readFileSync(wasmPath);
const q = name => ({ kind: 'query', name });
const sha256 = value => createHash('sha256').update(value).digest('hex');

// Measurement host only: the shipped wasm device, with each persistence batch
// appended and fsynced before success. Reopen replays the saved batches; no
// browser/IndexedDB or power-loss atomicity claim is made for this adapter.
async function journalPersistence(path) {
  const base = memoryPersistence();
  if (existsSync(path)) for (const line of readFileSync(path, 'utf8').trim().split('\n').filter(Boolean)) {
    const { name, changes } = JSON.parse(line); await base.save(name, changes);
  }
  const save = async (name, changes) => {
    const fd = openSync(path, 'a');
    try { appendFileSync(fd, JSON.stringify({ name, changes }) + '\n'); fsyncSync(fd); }
    finally { closeSync(fd); }
    await base.save(name, changes);
  };
  return { ...base, save, async saveIfCurrent(name, changes, current) {
    if (!current()) return false;
    await save(name, changes); return true;
  } };
}
const offlineOptions = async (url, path) => ({ url, persona: 'bob', waitSeconds: 1,
  device: webDevice({ wasm, persist: await journalPersistence(path) }),
  fetch: async () => { throw new TypeError('offline measurement'); } });
function check(read, kind, groups, messages, finalGroup) {
  assert.ok(read && !read.unknown && read.complete && Array.isArray(read.data), JSON.stringify(read));
  const ids = read.data.map(row => kind === 'inbox' ? row.conversationId : row.id);
  const expected = kind === 'inbox'
    ? Array.from({ length: Math.min(groups, 50) }, (_, i) => `c${String(i).padStart(3, '0')}`)
    : Array.from({ length: Math.min(messages, 50) }, (_, i) => `${finalGroup}-msg${String(messages - 1 - i).padStart(5, '0')}`);
  assert.deepEqual(ids, expected);
  return { rows: ids.length, complete: read.complete, fresh: read.fresh, idsSha256: sha256(JSON.stringify(ids)) };
}
if (process.argv[2] === '--reopen') {
  const input = JSON.parse(readFileSync(process.argv[3], 'utf8'));
  const client = await createLocalClient(await offlineOptions(input.url, input.path));
  try {
    const read = await client.query(q(input.kind === 'inbox' ? 'media.progressiveInbox' : 'media.progressiveHistory'), input.kind === 'inbox' ? {} : { conversationId: input.finalGroup, c: null });
    const verified = check(read, input.kind, input.groups, input.messages, input.finalGroup);
    assert.equal(read.fresh, false);
    assert.equal(client.acquired, input.acquired);
    console.log(JSON.stringify({ ok: true, acquired: client.acquired, ...verified }));
  } finally { await client.close(); }
} else {
  const mode = process.argv[2], run = Number(process.argv[3]);
  assert.ok(['progressive', 'legacy'].includes(mode) && run >= 1 && run <= 3, 'measure.mjs progressive|legacy RUN');
  const groups = 40, messages = 500, members = 10;
  const finalGroup = `c${String(groups - 1).padStart(3, '0')}`;
  const seed = scaleSeed({ groups, messages, members });
  const directory = join(work, `${mode}-${run}-${Date.now()}`); mkdirSync(directory);
  const journal = join(directory, 'device.jsonl');
  const extraSource = `query progressiveInbox():
  return memberships[viewer] first 50 by byPrincipalConversation
    { conversationId, conversation: conversations[.conversationId] }
query progressiveHistory(conversationId: conversations, c: cursor ?):
  return messages[conversationId] after c last 50 by byConvTime
`;
  const out = { at: new Date().toISOString(), witness: 'progressive-history-node-wasm-scale', mode, run,
    measurement: 'first durably usable tier-1 inbox, foreground history, full acquisition; offline process reopen of checkpoint',
    development: true, qualification: false,
    host: { hostname: hostname(), platform: platform(), arch: arch(), cpu: cpus()[0]?.model, logicalCpus: cpus().length, node: process.version, loadBefore: loadavg() },
    sourceCommit: spawnSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).stdout.trim(),
    artifacts: Object.fromEntries([wasmPath, binary(), join(root, 'apps/chat/snapback/schema.q'), join(root, 'packages/snapback4/dist/local.js'), join(root, 'packages/snapback4/dist/local-acquisition.js'), import.meta.filename].map(path => [path.replace(root + '/', ''), sha256(readFileSync(path))])),
    fixture: { source: 'witness/lib.mjs scaleSeed; witness/scale.mjs default 40/500/10', groups, messages, members, rows: seed.length, seedSha256: sha256(JSON.stringify(seed)), extraSource, finalGroup },
    limits: 'Node wasm + fsynced append journal, debug server on loopback, no added network delay; added queries omit maintained count and require; no Chromium/IndexedDB, UI, native, cold-browser or power-loss qualification; seed/startup server time excluded',
    heapMeasurement: 'sampled Node JS heapUsed after device calls and at 20ms intervals; not wasm heap or exact peak',
    sync: { pages: 0, acquirePages: 0, snapshotPages: 0, bytes: 0 }, checkpoints: {}, ok: false };
  let server, client, stop, core, call, started, peakHeap = 0;
  const sample = () => { peakHeap = Math.max(peakHeap, process.memoryUsage().heapUsed); };
  let sampler;
  try {
    server = await devServer({ seed, extraSource });
    assert.equal(server.seeded, seed.length);
    out.serverSeedMs = server.seedMs;
    const backend = await fetch(`${server.api}/schema`, { headers: { 'x-snapback-persona': 'bob' } }).then(r => r.json());
    assert.deepEqual(foregroundHint(backend, 'media.progressiveHistory', { conversationId: finalGroup, c: null }), { table: 'messages', group: [finalGroup] }, JSON.stringify(backend.programs.filter(p => p.name.includes('progressive'))));
    assert.equal(foregroundHint(backend, 'thread', { conversationId: finalGroup, c: null }), undefined);
    const device = webDevice({ wasm, persist: await journalPersistence(journal) });
    const probe = async () => {
      const state = (await call({ op: 'sync_state', capture: false })).ok;
      for (const kind of ['inbox', 'foreground']) {
        if (out.checkpoints[kind]) continue;
        const name = kind === 'inbox' ? 'media.progressiveInbox' : 'media.progressiveHistory';
        const args = kind === 'inbox' ? {} : { conversationId: finalGroup, c: null };
        const read = (await call({ op: 'query', name, args, viewer: 'dev:bob', now: Date.now() })).ok;
        if (!read || read.unknown || !read.complete || !Array.isArray(read.data)) continue;
        const verified = check(read, kind, groups, messages, finalGroup);
        const ms = performance.now() - started;
        const path = join(directory, `${kind}.jsonl`); copyFileSync(journal, path);
        out.checkpoints[kind] = { ms, acquired: state.acquired, wholeTables: state.acquired_tables, flooredGroups: state.floored_groups, ...verified };
      }
    };
    const options = { url: server.api, persona: 'bob', waitSeconds: 1,
      device: { async open(...args) {
        core = await device.open(...args); call = core.call.bind(core);
        core.call = async (request, committed) => {
          const reply = await call(request, committed); sample();
          if (request.op === 'apply' && !reply.denied && reply.ok?.published !== false) await probe();
          return reply;
        };
        return core;
      } },
      async fetch(input, init) {
        const path = new URL(input).pathname;
        if (path === '/sync' && mode === 'legacy') assert.equal(Object.hasOwn(JSON.parse(init.body), 'acquire'), false);
        const response = await fetch(input, init);
        if (path === '/schema' || path === '/') {
          const body = await response.json();
          if (mode === 'legacy' && body.device_compatibility) delete body.device_compatibility.advertised;
          return Response.json(body, { status: response.status, headers: response.headers });
        }
        if (path === '/sync') {
          const text = await response.clone().text(), page = JSON.parse(text);
          out.sync.pages++; out.sync.bytes += Buffer.byteLength(text);
          if (page.acquire) { out.sync.acquirePages++; if (page.acquire.unit?.tier === 2 && !out.firstGroup) out.firstGroup = page.acquire.unit; }
          if (page.snapshot) out.sync.snapshotPages++;
        }
        return response;
      } };
    started = performance.now(); sampler = setInterval(sample, 20);
    const prepared = await prepareClient(options, () => createLocalClient(options)); client = prepared.client;
    const observation = client.observe(q('media.progressiveHistory'), { conversationId: finalGroup, c: null }, { keep: false });
    const unsubscribe = observation.subscribe(() => {}); stop = () => { unsubscribe(); observation.close(); };
    await prepared.commit(); await prepared.start(); await client.sync();
    assert.equal(client.acquired, true); out.fullAcquisitionMs = performance.now() - started;
    await probe();
    assert.ok(out.checkpoints.inbox && out.checkpoints.foreground);
    if (mode === 'progressive') {
      assert.ok(out.sync.acquirePages > 0); assert.equal(out.sync.snapshotPages, 0);
      assert.deepEqual(out.firstGroup.group, [finalGroup]);
      assert.equal(out.checkpoints.inbox.acquired, false); assert.equal(out.checkpoints.foreground.acquired, false);
    } else { assert.equal(out.sync.acquirePages, 0); assert.ok(out.sync.snapshotPages > 0); }
    sample(); clearInterval(sampler); sampler = undefined;
    stop(); stop = undefined; await client.close(); client = undefined;
    for (const kind of ['inbox', 'foreground']) {
      const input = join(directory, `${kind}-reopen.json`);
      writeFileSync(input, JSON.stringify({ url: server.api, path: join(directory, `${kind}.jsonl`), kind, groups, messages, finalGroup, acquired: out.checkpoints[kind].acquired }));
      const reopened = spawnSync(process.execPath, [import.meta.filename, '--reopen', input], { cwd: root, encoding: 'utf8', timeout: 120000 });
      assert.equal(reopened.status, 0, reopened.stderr + reopened.stdout);
      out.checkpoints[kind].offlineReopen = JSON.parse(reopened.stdout.trim());
    }
    out.ok = true;
  } catch (error) { out.error = { message: error.message, stack: error.stack }; }
  finally {
    clearInterval(sampler); stop?.(); await client?.close(); await server?.close();
    out.peakJsHeapBytes = peakHeap; out.host.loadAfter = loadavg();
    writeFileSync(join(report, `${mode}-${run}.json`), JSON.stringify(out, null, 2) + '\n');
    appendFileSync(join(root, 'metrics/witness.jsonl'), JSON.stringify(out) + '\n');
    console.log(JSON.stringify({ mode, run, ok: out.ok, inboxMs: out.checkpoints.inbox?.ms, foregroundMs: out.checkpoints.foreground?.ms, fullAcquisitionMs: out.fullAcquisitionMs, peakJsHeapBytes: peakHeap, error: out.error }));
  }
  process.exitCode = out.ok ? 0 : 1;
}
