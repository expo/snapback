// Browser fixture embedded by worker-protocol. The client, host, Worker and
// IndexedDB are real; the transport controls the two server store identities.
export const replacementWorker = sdk => `
import { WorkerRuntime, serveWorker } from '${sdk}/web-worker-runtime.js';
let pauseOpen = false, pauseCommit = false, resume;
addEventListener('message', e => {
  if (!e.data?.test) return;
  e.stopImmediatePropagation();
  if (e.data.test === 'arm') { pauseOpen = true; pauseCommit = e.data.commit; }
  if (e.data.test === 'resume') resume?.();
});
const execute = WorkerRuntime.prototype.execute;
WorkerRuntime.prototype.execute = async function(message) {
  if ((message.action === 'open' && pauseOpen) || (message.action === 'commit' && pauseCommit)) {
    if (message.action === 'open') pauseOpen = false; else pauseCommit = false;
    postMessage({ test: 'held', action: message.action });
    await new Promise(r => resume = r);
  }
  return execute.call(this, message);
};
serveWorker(globalThis);
`;

export const replacementEntry = sdk => `
import { createLocalClient } from '${sdk}/local.js';
import { prepareClient } from '${sdk}/client-start.js';
import { deviceRestore } from '${sdk}/device-restore.js';
window.replacementRestore = async (failValidation = false) => {
  const NativeWorker = window.Worker, validations = [];
  let worker, starts = 0, holdOpen = false, heldOpen = false, heldCommit = false;
  window.Worker = class {
    constructor() {
      const WrappedWorker = window.Worker;
      window.Worker = NativeWorker;
      try { worker = new Worker(new URL('./replacement-worker.js', import.meta.url), { type: 'module' }); }
      finally { window.Worker = WrappedWorker; }
      starts++;
      worker.addEventListener('message', e => {
        if (e.data?.test === 'held') {
          if (e.data.action === 'open') heldOpen = true; else heldCommit = true;
        }
      });
      if (holdOpen) { worker.postMessage({ test: 'arm', commit: failValidation }); holdOpen = false; }
      return worker;
    }
  };
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const until = async (f, label) => {
    for (let i = 0; i < 800; i++) { if (f()) return; await sleep(10); }
    throw Error(label);
  };
  const opener = webDevice({ worker: true });
  let core, client, watch, stop, store = 'A', holdQuery = false, releaseReply, releaseSync, actions = 0, stage = 'install A';
  const gate = new Promise(r => releaseSync = r);
  const query = { kind: 'query', name: 'thread' }, args = { conversationId: 'c1' };
  const options = { url: 'https://replacement.test', persona: 'alice', device: { async open(_name, opening) {
    core = await opener.open('replacement', opening);
    const fence = core[deviceRestore];
    core[deviceRestore] = (evidence, validated) => fence(evidence, outcome => { validations.push(outcome); validated(outcome); });
    return core;
  } }, fetch: async (url, init) => {
    const path = new URL(url).pathname;
    if (path === '/schema') return Response.json(backend);
    if (path === '/probe') return Response.json({ store_id: store, seq: 100 });
    if (path === '/changes') return new Promise((_, reject) => {
      if (init.signal.aborted) reject(Error('closed'));
      else init.signal.addEventListener('abort', () => reject(Error('closed')), { once: true });
    });
    if (path === '/sync') {
      const request = JSON.parse(init.body);
      if (store === 'A' && request.stream) await gate;
      return Response.json({ store_id: store, generation: 1, watermark: 100, images_at: 100,
        snapshot: !request.stream, more: false, events: request.stream ? [] : events });
    }
    if (path.startsWith('/q/')) {
      const capturedStore = store;
      let head = 100;
      if (holdQuery) { holdQuery = false; head = await new Promise(r => releaseReply = r); }
      return Response.json({ store_id: capturedStore, head, seq: head, complete: true, data: [{ id: 'server-' + capturedStore }] });
    }
    if (path.startsWith('/a/')) { actions++; return Response.json({ ok: true, result: 'replacement action' }); }
    throw Error('unexpected route ' + path);
  } };
  try {
    // Install A once, then clear its published rows so the client reacquires.
    core = await opener.open('replacement', backend);
    for (const request of [first, second, terminal]) {
      const result = await core.call({ ...request, page: { ...request.page, store_id: 'A', watermark: 100 } });
      ok(result);
    }
    ok(await core.call({ op: 'clear_rows' })); await core.close();
    stage = 'start cold A';
    const prepared = await prepareClient(options, () => createLocalClient(options)); client = prepared.client;
    const done = prepared.start();
    watch = client.observe(query, args); stop = watch.subscribe(() => {});
    await until(() => watch.getSnapshot().data?.[0]?.id === 'server-A' && core[deviceControl]()?.restore_images_at === 100, 'cold A answer at floor 100');
    holdQuery = true; await until(() => releaseReply, 'delayed cold A response');
    const capture = core[deviceControl]();
    stage = 'replace with B';
    store = 'B'; releaseSync(); await done;
    await until(() => client.acquired && core[deviceControl]()?.store_id === 'B', 'sync installs B');
    const before = (await core.call({ op: 'sync_state', capture: false })).ok;
    stage = 'fail Worker and deliver A';
    holdOpen = true;
    worker.dispatchEvent(new Event('error')); // Host termination, lifetime lock and IDB barrier.
    const unavailable = core[deviceControl]() === undefined;
    releaseReply(90);
    await until(() => heldOpen && watch.getSnapshot().denied?.code === 'E_STORE_RESTORE', 'provisional refusal during restart');
    const provisional = await client.query(query, args);
    const blockedAction = await client.act({ kind: 'action', name: 'test' }, {});
    const sentWhileProvisional = actions;
    stage = 'resume B';
    worker.postMessage({ test: 'resume' });
    if (failValidation) {
      await until(() => heldCommit, 'identity validation commit held');
      worker.dispatchEvent(new Event('error'));
      await core.call({ op: 'sync_state', capture: false });
    }
    await until(() => validations.length && client.acquired, 'obsolete evidence retired and B resynced');
    const after = (await core.call({ op: 'sync_state', capture: false })).ok;
    const read = await client.query(query, args);
    const action = await client.act({ kind: 'action', name: 'test' }, {});
    stage = 'close B';
    stop(); stop = undefined; watch.close(); await client.close(); client = undefined;
    const reopened = await createLocalClient({ ...options, fetch: async () => { throw Error('offline'); } });
    stage = 'offline B';
    const offline = await reopened.query(query, args); await reopened.close();
    return { capture, before, unavailable, provisional, blockedAction, sentWhileProvisional,
      validations, after, read, action, actions, offline, starts, failValidation };
  } catch (error) {
    throw Error(stage + ': ' + error.message + JSON.stringify({ control: core?.[deviceControl]?.(), read: watch?.getSnapshot(), validations, heldOpen, heldCommit }));
  } finally { stop?.(); watch?.close(); await client?.close().catch(() => {}); window.Worker = NativeWorker; }
};
`;
