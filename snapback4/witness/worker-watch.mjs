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
let queries = 0, failures = 0, held = false, restoring = false, restoreFault = false, sends = 0;
let secondWatch, stopSecond, reopenOptions, restoreReplies = [], heads = [];
let delayObserver = false, observerHeld = false, releaseObserver, syncFinished = false, hideControl = false;
window.Worker = class extends NativeWorker {
  constructor(...args) { super(...args); worker = this; this.addEventListener('message', e => { if (e.data?.test === 'held') held = true; }); }
};
const sleep = ms => new Promise(r => setTimeout(r, ms));
const until = async (f, label) => { const start = performance.now(); while (!f()) { if (performance.now() - start > 8000) throw Error(label + JSON.stringify({read: observed?.getSnapshot(), control: core?.[deviceControl]?.(), acquired: client?.acquired, queries, held, last: window.lastQuery, sent: window.sent})); await sleep(10); } };
const has = body => observed.getSnapshot().data?.some(row => row.body === body);
window.w = {
  async start(api, restore = false, observer = false) {
    restoring = restore; delayObserver = observer;
    const persona = observer ? 'alice' : 'bob';
    const gate = new Promise(r => releaseSync = r);
    const warm = await createLocalClient({ url: api, persona, device: window.webDevice() }); await warm.close();
    const opener = window.webDevice({ worker: true });
    const options = { url: api, persona, device: { async open(...args) {
      core = await opener.open(...args); await core.call({ op: 'clear_rows' });
      const readControl = core[deviceControl]; core[deviceControl] = () => hideControl ? undefined : readControl();
      const call = core.call.bind(core);
      core.call = async (...args) => {
        const reply = await call(...args);
        if (delayObserver && args[0].op === 'observe_store' && args[0].page?.watermark === 101 && !observerHeld) {
          observerHeld = true; await new Promise(r => releaseObserver = r);
        }
        return reply;
      };
      return core;
    } },
      async fetch(url, init) {
        const path = new URL(url).pathname;
        if (path.startsWith('/m/') || path.startsWith('/a/') || path.startsWith('/assets')) sends++;
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
        if (restoring && path === '/sync' && JSON.parse(init.body).stream) {
          const state = core[deviceControl]();
          return Response.json({ store_id: state.transfer_store_id ?? state.store_id, generation: state.generation,
            snapshot: false, watermark: 101, images_at: 101, more: false, events: [] });
        }
        const response = await fetch(url, init);
        if (restoring && (path === '/sync' || path === '/probe' || path.startsWith('/q/'))) {
          const json = await response.json();
          if (path === '/sync') { json.watermark = 100; json.images_at = 100; }
          else {
            const head = path.startsWith('/q/') && restoreFault ? await new Promise(r => restoreReplies.push(r)) : 100;
            json.head = head; json.seq = head; if (path.startsWith('/q/')) heads.push(head);
          }
          return Response.json(json, { status: response.status });
        }
        if (path.startsWith('/q/')) window.lastQuery = await response.clone().json(); return response;
      } };
    reopenOptions = { url: api, persona, device: window.webDevice({ worker: true }), fetch: async () => { throw Error('offline reopen'); } };
    const prepared = await prepareClient(options, () => createLocalClient(options)); client = prepared.client;
    done = prepared.start(); void done.then(() => syncFinished = true);
    observed = client.observe({ kind: 'query', name: 'thread' }, { conversationId: 'c000' }); stop = observed.subscribe(() => {});
    if (restoring) {
      secondWatch = client.observe({ kind: 'query', name: 'thread' }, { conversationId: 'c000' }, { keep: true });
      stopSecond = secondWatch.subscribe(() => {});
      await until(() => secondWatch.getSnapshot().data?.length >= 3, 'second server answer');
    }
    await until(() => observed.getSnapshot().data?.length >= 3 && core[deviceControl]()?.store_id, 'initial server answer');
    releaseSync(); await until(() => held || observerHeld, 'Worker apply or observation reply held');
  },
  async restore() {
    const capture = core[deviceControl](); restoreFault = true;
    await until(() => restoreReplies.length >= 2, 'two replies in flight');
    const pendingRead = client.query({ kind: 'query', name: 'thread' }, { conversationId: 'c000' });
    const pendingAdmission = client.mutate({ kind: 'mutation', name: 'send' },
      { conversationId: 'c000', body: 'captured before restore proof' }, { waitSeconds: 0 });
    const pendingBefore = core[deviceControl]().predictions === null;
    // Loss of the page's current snapshot (e.g. Worker stop) must not erase
    // captured proof. The host revalidates identity before persisting it.
    hideControl = delayObserver;
    restoreReplies.shift()(90);
    await until(() => observed.getSnapshot().denied?.code === 'E_STORE_RESTORE', 'restore must fence before Worker resumes');
    hideControl = false;
    const immediate = { read: observed.getSnapshot(), control: core[deviceControl](), held, observerHeld, acquired: client.acquired };
    restoreReplies.shift()(101);
    await until(() => heads.includes(101), 'refilled response delivered'); await sleep(100);
    const after = secondWatch.getSnapshot();
    const read = await client.query({ kind: 'query', name: 'thread' }, { conversationId: 'c000' });
    const write = await client.mutate({ kind: 'mutation', name: 'send' }, { conversationId: 'c000', body: 'must not send after restore' }, { waitSeconds: 0 });
    const upload = await client.upload(new Uint8Array([1, 2, 3]));
    const action = await client.act({ kind: 'action', name: 'mustNotDispatch' }, {});
    dispatchEvent(new PageTransitionEvent('pagehide')); const before = queries; await sleep(350);
    const stopped = queries === before;
    let afterObserver;
    if (delayObserver) {
      releaseObserver(); await until(() => syncFinished || held, 'completed observer handled');
      afterObserver = await client.act({ kind: 'action', name: 'mustNotDispatch' }, {});
    }
    worker.postMessage({ test: 'resume' }); await done;
    const admission = await pendingAdmission, delayedRead = await pendingRead;
    const durable = (await core.call({ op: 'sync_state', capture: false })).ok;
    stop(); stopSecond(); observed.close(); secondWatch.close(); await client.close();
    const reopened = await createLocalClient(reopenOptions);
    const offline = await reopened.query({ kind: 'query', name: 'thread' }, { conversationId: 'c000' }); await reopened.close();
    return { capture, pendingBefore, admission, delayedRead, upload, action, afterObserver, immediate, after, read, write, stopped, heads, sends, durable, offline };
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
  await witness.page.reload();
  await witness.page.waitForFunction(() => window.w);
  await witness.page.evaluate(api => w.start(api, true), witness.api);
  const restore = await witness.page.evaluate(() => w.restore());
  assert.equal(Math.max(restore.capture.watermark, restore.capture.restore_watermark, restore.capture.restore_images_at), 100);
  assert.equal(restore.immediate.held, true); assert.equal(restore.immediate.acquired, false);
  assert.equal(restore.immediate.control.restore_refusal.code, 'E_STORE_RESTORE');
  for (const read of [restore.immediate.read, restore.after, restore.read, restore.delayedRead, restore.offline]) assert.equal(read.denied?.code, 'E_STORE_RESTORE');
  assert.equal(restore.upload.why.code, 'E_STORE_RESTORE'); assert.equal(restore.action.denied.code, 'E_STORE_RESTORE');
  assert.equal(restore.pendingBefore, true); assert.equal(restore.admission.why.code, 'E_STORE_RESTORE');
  assert.equal(restore.write.why.code, 'E_STORE_RESTORE'); assert.equal(restore.sends, 0); assert.equal(restore.stopped, true);
  assert.equal(restore.durable.restore_refusal.code, 'E_STORE_RESTORE');
  assert.equal(restore.durable.watermark, 101, 'proof survives terminal publication overtaking its original capture');
  results.push({ case: '100 -> 90 -> 101 restore proof fences a blocked Worker and offline reopen', detail: restore });
  await witness.page.reload(); await witness.page.waitForFunction(() => window.w);
  await witness.page.evaluate(api => w.start(api, true, true), witness.api);
  const observer = await witness.page.evaluate(() => w.restore());
  assert.equal(observer.immediate.observerHeld, true);
  assert.equal(observer.afterObserver.denied?.code, 'E_STORE_RESTORE', 'an older observation reply cannot clear the sticky refusal');
  assert.equal(observer.sends, 0);
  assert.equal(observer.offline.denied?.code, 'E_STORE_RESTORE');
  results.push({ case: 'in-flight sync observation cannot clear a newer restore refusal', detail: observer });
  const result = { results, resumed, errors };
  if (process.argv[2]) writeFileSync(process.argv[2], JSON.stringify(result, null, 2));
  console.log(JSON.stringify(result));
} finally { await online.close(); await witness.close(); }
