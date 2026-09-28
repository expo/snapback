// Embedded by worker-protocol: real client/Worker/IDB, controlled transport
// and delayed completed device replies. The containing entry supplies the
// ordinary chat backend, snapshot pages, webDevice and deviceControl.
export const adoptionEntry = sdk => `
import { createLocalClient as adoptionClient } from '${sdk}/local.js';
import { prepareClient as prepareAdoption } from '${sdk}/client-start.js';
window.adoptionRestore = async phase => {
  const opener = webDevice({ worker: true }), name = 'generation-restore';
  const nextBackend = { ...backend, generation: backend.generation + 1 };
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const until = async (f, label) => {
    for (let i = 0; i < 800; i++) { if (f()) return; await sleep(10); }
    throw Error(label);
  };
  let core = await opener.open(name, backend), client, watch, stop;
  for (const request of [first, second, terminal]) ok(await core.call({ ...request,
    page: { ...request.page, watermark: 100, images_at: 100 } }));
  ok(await core.call({ op: 'clear_rows' })); await core.close();
  let releaseSync, releaseReply, releaseObservation, releaseAdoption, releaseFollowup;
  let holdQuery = false, observationHeld = false, adoptionHeld = false, adopted;
  let adoptionReleased = false, followupHeld = false, finished = false, actions = 0;
  const syncGate = new Promise(r => releaseSync = r);
  const options = { url: 'https://adoption.test', persona: 'alice', device: { async open(_name, opening) {
    core = await opener.open(name, opening);
    const call = core.call.bind(core);
    core.call = async (...args) => {
      const request = args[0];
      // Keep subsequent observations from masking a cleared client latch.
      // The next action is checked at the adoption completion boundary.
      if (adoptionReleased && request.op === 'sync_state' && !followupHeld) {
        followupHeld = true; await new Promise(r => releaseFollowup = r);
      }
      const reply = await call(...args);
      if (request.op === 'observe_store' && request.page?.watermark === 101 && !observationHeld) {
        observationHeld = true; await new Promise(r => releaseObservation = r);
      }
      if (request.op === 'adopt' && phase === 'adoption') {
        adopted = reply; adoptionHeld = true; await new Promise(r => releaseAdoption = r);
      }
      return reply;
    };
    return core;
  } }, fetch: async (url, init) => {
    const path = new URL(url).pathname;
    if (path === '/schema') return Response.json(observationHeld ? nextBackend : backend);
    if (path === '/probe') return Response.json({ store_id: 'worker-store', seq: 100 });
    if (path === '/changes') return new Promise((_, reject) => {
      if (init.signal.aborted) reject(Error('closed'));
      else init.signal.addEventListener('abort', () => reject(Error('closed')), { once: true });
    });
    if (path === '/sync') {
      const request = JSON.parse(init.body);
      if (request.stream) await syncGate;
      return Response.json({ store_id: 'worker-store', generation: request.stream ? nextBackend.generation : backend.generation,
        watermark: request.stream ? 101 : 100, images_at: request.stream ? 101 : 100,
        snapshot: !request.stream, more: false, events: request.stream ? [] : events });
    }
    if (path.startsWith('/q/')) {
      let head = 100;
      if (holdQuery) { holdQuery = false; head = await new Promise(r => releaseReply = r); }
      return Response.json({ store_id: 'worker-store', head, seq: head, complete: true, data: [{ id: 'server' }] });
    }
    if (path.startsWith('/a/')) { actions++; return Response.json({ ok: true, result: 'must stay blocked' }); }
    throw Error('unexpected route ' + path);
  } };
  try {
    const prepared = await prepareAdoption(options, () => adoptionClient(options)); client = prepared.client;
    const done = prepared.start(); void done.then(() => finished = true);
    watch = client.observe({ kind: 'query', name: 'thread' }, { conversationId: 'c1' }); stop = watch.subscribe(() => {});
    await until(() => watch.getSnapshot().data?.[0]?.id === 'server' && core[deviceControl]()?.restore_images_at === 100, 'cold answer at floor 100');
    holdQuery = true; await until(() => releaseReply, 'head 90 response captured before adoption');
    const capture = core[deviceControl]();
    releaseSync(); await until(() => observationHeld, 'generation-changing observation held');
    if (phase === 'adoption') {
      releaseObservation(); await until(() => adoptionHeld, 'real adoption reply held');
    }
    releaseReply(90);
    await until(() => watch.getSnapshot().denied?.code === 'E_STORE_RESTORE', 'head 90 latches restore refusal');
    const before = await client.act({ kind: 'action', name: 'test' }, {});
    if (phase === 'adoption') { adoptionReleased = true; releaseAdoption(); }
    else releaseObservation();
    await until(() => finished || followupHeld, 'completion consumed before any following observation');
    const after = await client.act({ kind: 'action', name: 'test' }, {});
    releaseFollowup?.(); await done;
    return { capture, pageGeneration: nextBackend.generation, observationHeld, adoptionHeld,
      adopted, before, after, actions, followupHeld };
  } finally {
    releaseSync?.(); releaseReply?.(101); releaseObservation?.(); releaseAdoption?.(); releaseFollowup?.();
    stop?.(); watch?.close(); await client?.close();
  }
};
`;
