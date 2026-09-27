// SDK-level scale witness. Serve a private copy of calibration #23's store first.
// node witness/sync-scale.mjs URL OUTPUT [memory|idb] [cold|during]
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { performance } from 'node:perf_hooks';
import { login } from '../packages/snapback4/dist/auth.js';
import { createClient, mintId } from '../packages/snapback4/dist/client.js';
import { createLocalClient } from '../packages/snapback4/dist/local.js';
import { prepareClient } from '../packages/snapback4/dist/client-start.js';
import { memoryPersistence, webDevice } from '../packages/snapback4/dist/web.js';
import { indexedDbStore } from '../packages/snapback4/dist/web-idb.js';

const [url = 'http://127.0.0.1:49371', output = 'target/lane-ss-evidence/probe.json', persistence = 'memory', mode = 'cold'] = process.argv.slice(2);
assert.ok(['memory', 'idb'].includes(persistence), 'persistence must be memory or idb');
assert.ok(['cold', 'during'].includes(mode), 'mode must be cold or during');
const q = name => ({ kind: 'query', name });
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const now = () => performance.now();
const out = { url, persistence, mode, node: process.version, pages: [], calls: {}, callTimeline: [], saves: [], requests: [], live: [], watches: [] };
const start = now();
let peakHeap = 0, peakExternal = 0, peakRss = 0, client, reader, writer, stop, lastResponse = start;
let lastResponseLoop = performance.eventLoopUtilization();
const sampleHeap = () => {
  const memory = process.memoryUsage();
  peakHeap = Math.max(peakHeap, memory.heapUsed);
  peakExternal = Math.max(peakExternal, memory.external);
  peakRss = Math.max(peakRss, memory.rss);
};
const sampler = setInterval(sampleHeap, 20);
const account = async handle => {
  const result = await login(url, `${handle}@example.com`, 'CliqueScale!20260808');
  assert.ok(result.ok, JSON.stringify(result));
  return result.session;
};
try {
  const signed = now(), session = await account('u0500');
  out.loginMs = now() - signed;
  reader = createClient({ url, session });
  const group = await reader.query(q('messaging.groupByTitle'), { title: 'Busy Group 0001' });
  assert.ok(group.data?.id, JSON.stringify(group));
  const conversation = group.data.id;
  const roster = await reader.query(q('messaging.roster'), { conversation });
  const peer = roster.data.find(row => row.principal !== session.principal && row.profile?.handle?.startsWith('u'));
  assert.ok(peer, JSON.stringify(roster));
  writer = createClient({ url, session: await account(peer.profile.handle) });
  out.peer = peer.profile.handle;
  await reader.close(); reader = undefined;
  const memory = memoryPersistence();
  if (persistence === 'idb') {
    const { indexedDB } = await import('fake-indexeddb');
    globalThis.indexedDB = indexedDB;
  }
  const base = persistence === 'idb' ? indexedDbStore(memory.claim) : memory;
  const persist = { ...base, async save(name, changes) {
    const at = now();
    await base.save(name, changes);
    out.saves.push({ at: at - start, ms: now() - at, changes: changes.length });
  } };
  const device = webDevice({ wasm: readFileSync(new URL('../packages/snapback4/src/wasm/snapback4_device_bg.wasm', import.meta.url)), persist });
  const options = { url, session, waitSeconds: 25,
    device: { async open(...args) {
      const core = await device.open(...args);
      return { ...core, async call(request, committed) {
        const at = now(), saveAt = out.saves.length;
        try { return await core.call(request, committed); }
        finally {
          const metric = out.calls[request.op] ??= { calls: 0, totalMs: 0, maxMs: 0, persistenceMs: 0 };
          const ms = now() - at;
          metric.calls++; metric.totalMs += ms; metric.maxMs = Math.max(metric.maxMs, ms);
          const persistenceMs = out.saves.slice(saveAt).reduce((sum, save) => sum + save.ms, 0);
          metric.persistenceMs += persistenceMs;
          out.callTimeline.push({ op: request.op, at: at - start, ms, persistenceMs });
          sampleHeap();
        }
      } };
    } },
    async fetch(input, init) {
      const path = new URL(input).pathname, at = now();
      const gapLoop = performance.eventLoopUtilization(lastResponseLoop);
      const response = await fetch(input, init);
      const headersMs = now() - at;
      // Preserve streaming whitespace heartbeats and the client's watchdog.
      if (path === '/changes') return response;
      const body = await response.text(), end = now();
      const receivedLoop = performance.eventLoopUtilization();
      out.requests.push({ path, at: at - start, ms: end - at, bytes: Buffer.byteLength(body), status: response.status });
      if (path === '/sync') {
        const page = JSON.parse(body);
        out.pages.push({ at: at - start, ms: end - at, headersMs, bodyMs: end - at - headersMs, gapMs: at - lastResponse,
          idleGapMs: gapLoop.idle, activeGapMs: gapLoop.active,
          bytes: Buffer.byteLength(body), snapshot: !!page.snapshot, more: page.more,
          rows: page.events?.length ?? 0, tables: Object.fromEntries([...new Set(page.events?.map(e => e.table))].map(t => [t, page.events.filter(e => e.table === t).length])), denied: page.denied });
        lastResponse = end;
        lastResponseLoop = receivedLoop;
        console.log(JSON.stringify({ page: out.pages.length, ms: end - at, rows: page.events?.length, snapshot: page.snapshot, more: page.more }));
      }
      return new Response(body, { status: response.status, headers: response.headers });
    }
  };
  const acquiredAt = now();
  let acquisition;
  if (mode === 'during') {
    const prepared = await prepareClient(options, () => createLocalClient(options));
    client = prepared.client;
    acquisition = prepared.start();
  } else {
    client = await createLocalClient(options);
    acquisition = Promise.resolve();
  }
  let acquired = false;
  const finished = acquisition.then(() => {
    acquired = client.acquired;
    out.acquisitionMs = now() - acquiredAt;
    out.acquisitionPages = out.pages.length;
    out.acquisitionCalls = structuredClone(out.calls);
    out.acquisitionSaves = out.saves.length;
    out.heapAfterAcquisition = process.memoryUsage().heapUsed;
  });
  const watch = client.observe(q('messaging.history'), { conversation });
  const seen = new Map();
  stop = watch.subscribe(() => {
    const read = watch.getSnapshot();
    out.watches.push({ at: now() - start, data: read.data?.length, fresh: read.fresh, complete: read.complete, denied: read.denied, loading: read.loading });
    for (const row of read.data ?? []) if (!seen.has(row.id)) seen.set(row.id, now());
  });
  const send = async phase => {
    const id = mintId(), at = now(), acquiredAtSend = acquired;
    const write = await writer.mutate({ kind: 'mutation', name: 'messaging.send' }, { id, conversation, text: `SS scale ${id}` });
    assert.equal(write.state, 'sent', JSON.stringify(write));
    const committed = now();
    while (!seen.has(id) && now() - at < 31000) await sleep(5);
    const ms = seen.has(id) ? seen.get(id) - at : null;
    out.live.push({ phase, ms, commitMs: committed - at, acquiredAtSend, timedOut: ms === null });
    console.log(JSON.stringify({ phase, ms, acquired, pages: out.pages.length }));
    return ms !== null;
  };
  if (mode === 'during') for (let n = 0; n < 5 && !acquired; n++) if (!await send('during')) break;
  await finished;
  assert.ok(acquired, 'acquisition did not complete');
  for (let n = 0; n < Number(process.env.SS_SAMPLES ?? 23); n++) if (!await send(n < 3 ? 'warmup' : 'after')) break;
  out.ok = out.live.every(sample => !sample.timedOut);
} catch (error) {
  out.error = { message: error.message, stack: error.stack };
  out.ok = false;
} finally {
  sampleHeap(); clearInterval(sampler); stop?.();
  await Promise.allSettled([client?.close(), reader?.close(), writer?.close()]);
  out.peakHeap = peakHeap; out.peakExternal = peakExternal; out.peakRss = peakRss;
  out.elapsedMs = now() - start;
  const measured = out.live.filter(s => s.phase === 'after' && s.ms !== null).map(s => s.ms).sort((a, b) => a - b);
  out.liveP95 = measured.length ? measured[Math.ceil(measured.length * .95) - 1] : null;
  writeFileSync(output, JSON.stringify(out, null, 2));
  console.log(JSON.stringify({ output, ok: out.ok, acquisitionMs: out.acquisitionMs, acquisitionPages: out.acquisitionPages, peakHeap, liveP95: out.liveP95, error: out.error }));
}
process.exitCode = out.ok ? 0 : 1;
