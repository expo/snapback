// Real client polling/fences while a Worker is held inside terminal apply.
// Test-only Worker transform; the shipped entry contains no fault hooks.
import assert from 'node:assert/strict';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { launch, root, scaleSeed } from './lib.mjs';
import { createClient } from '../packages/snapback4/dist/client.js';
const sdk = join(root, 'packages/snapback4/src');
const witness = await launch({ seed: scaleSeed({ groups: 1, messages: 3, members: 2 }), worker: true,
  sourceOverrides: { [join(sdk, 'web-worker-entry.js')]: `
import { WorkerRuntime, serveWorker } from './web-worker-runtime.ts';
let resume, held = false;
addEventListener('message', e => { if (e.data?.test === 'resume') { e.stopImmediatePropagation(); resume?.(); } });
const execute = WorkerRuntime.prototype.execute;
WorkerRuntime.prototype.execute = async function(message) {
  if (!held && message.action === 'invoke' && message.request?.op === 'apply' && message.request.page?.snapshot_catchup) {
    held = true; postMessage({ test: 'held' }); await new Promise(r => resume = r);
  }
  return execute.call(this, message);
};
serveWorker(globalThis);
` }, entrySource: `
import { prepareClient } from '${sdk}/client-start.ts';
import { createLocalClient } from '${sdk}/local.ts';
import { mintId } from '${sdk}/client.ts';
import { deviceControl } from '${sdk}/device-control.ts';
const NativeWorker = window.Worker;
let worker, core, client, observed, done, stop, releaseSync, fault;
let queries = 0, failures = 0, held = false;
window.Worker = class extends NativeWorker {
  constructor(...args) { super(...args); worker = this; this.addEventListener('message', e => { if (e.data?.test === 'held') held = true; }); }
};
const sleep = ms => new Promise(r => setTimeout(r, ms));
const until = async (f, label) => { const start = performance.now(); while (!f()) { if (performance.now() - start > 8000) throw Error(label + JSON.stringify({read: observed?.getSnapshot(), control: core?.[deviceControl]?.(), acquired: client?.acquired, queries, held, last: window.lastQuery, sent: window.sent})); await sleep(10); } };
const has = body => observed.getSnapshot().data?.some(row => row.body === body);
window.w = {
  async start(api) {
    const gate = new Promise(r => releaseSync = r);
    const warm = await createLocalClient({ url: api, persona: 'bob', device: window.webDevice() }); await warm.close();
    const opener = window.webDevice({ worker: true });
    const options = { url: api, persona: 'bob', device: { async open(...args) { core = await opener.open(...args); await core.call({ op: 'clear_rows' }); return core; } },
      async fetch(url, init) {
        const path = new URL(url).pathname;
        if (path === '/sync' && JSON.parse(init.body).stream) await gate;
        if (path.startsWith('/q/')) {
          queries++;
          if (fault) {
            const next = fault; fault = undefined; failures++;
            if (next === '503') return new Response('unavailable', { status: 503 });
            const response = await fetch(url, init);
            return Response.json({ ...await response.json(), nextExpiry: Date.now() - 1000 });
          }
        }
        const response = await fetch(url, init); if (path.startsWith('/q/')) window.lastQuery = await response.clone().json(); return response;
      } };
    const prepared = await prepareClient(options, () => createLocalClient(options)); client = prepared.client;
    done = prepared.start();
    observed = client.observe({ kind: 'query', name: 'thread' }, { conversationId: 'c000' }); stop = observed.subscribe(() => {});
    await until(() => observed.getSnapshot().data?.length === 3 && core[deviceControl]()?.store_id, 'initial server answer');
    releaseSync(); await until(() => held, 'Worker held in terminal apply');
  },
  async fault(next) {
    const before = observed.getSnapshot(), count = failures; fault = next;
    await until(() => failures > count, 'fault reached'); await sleep(100);
    const preserved = observed.getSnapshot() === before;
    const body = next + '-' + mintId();
    const sent = await window.sendPeer(body);
    window.sent = { sent, body }; await until(() => has(body), 'live answer after fault while Worker held');
    return { preserved, sent: sent.state, acquired: client.acquired, held, queries };
  },
  async admission() {
    const request = { op: 'admit', entry: { id: 'busy-admission', seq: 1, op: 'send',
      args: { conversationId: 'c000', body: 'busy-admission' }, viewer: 'dev:bob', now: Date.now(), new_ids: ['busy-admission-row'], predictable: true, predicted: [] } };
    const pending = core.call(request); window.admitting = pending;
    const unknown = core[deviceControl]().predictions === null;
    await sleep(100); const before = queries; await sleep(700);
    return { unknown, before, after: queries, acquired: client.acquired,
      captured: Object.keys(localStorage).some(k => k.includes('busy-admission')) };
  },
  async finish() {
    worker.postMessage({ test: 'resume' });
    await done; const admitted = await window.admitting;
    const acquired = client.acquired; stop(); observed.close(); await client.close(); return { admitted, acquired };
  },
};
` });
const errors = [], results = [];
const online = createClient({ url: witness.api, persona: 'alice' });
await witness.page.exposeFunction('sendPeer', body => online.mutate({ kind: 'mutation', name: 'send' }, { conversationId: 'c000', body }));
witness.page.on('pageerror', e => errors.push(e.message));
try {
  await witness.page.evaluate(api => w.start(api), witness.api);
  for (const fault of ['503', 'expiry']) {
    const detail = await witness.page.evaluate(fault => w.fault(fault), fault);
    assert.equal(detail.preserved, true); assert.equal(detail.sent, 'sent'); assert.equal(detail.acquired, false); assert.equal(detail.held, true);
    results.push({ case: fault, detail });
  }
  const detail = await witness.page.evaluate(() => w.admission());
  assert.equal(detail.unknown, true); assert.equal(detail.captured, true); assert.equal(detail.acquired, false); assert.equal(detail.after, detail.before);
  results.push({ case: 'synchronous pending prediction blocks dispatch before Worker transfer', detail });
  const resumed = await witness.page.evaluate(() => w.finish());
  assert.equal(resumed.admitted.denied, undefined); assert.equal(resumed.acquired, true); assert.deepEqual(errors, []);
  const result = { results, resumed, errors };
  if (process.argv[2]) writeFileSync(process.argv[2], JSON.stringify(result, null, 2));
  console.log(JSON.stringify(result));
} finally { await online.close(); await witness.close(); }
