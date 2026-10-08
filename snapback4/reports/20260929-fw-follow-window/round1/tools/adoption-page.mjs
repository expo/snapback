import { parkedChanges } from '../../../../packages/snapback4/test/helpers/sync-control.mjs';
import { createLocalClient } from '../../../../packages/snapback4/dist/local.js';
import { QueryCustody } from '../../../../packages/snapback4/dist/query-custody.js';
import { webDevice } from '../../../../packages/snapback4/dist/web.js';
const q = { kind: 'query', name: 'cards' };
const latch = () => { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; };
const good = (r, count) => r.data?.length === count && r.complete && r.fresh && !r.revalidating;
let client, watch, offline = false, gates;
const waits = new Map(), reads = [], wait = QueryCustody.prototype.wait;
QueryCustody.prototype.wait = function(name, ...args) {
  const waiting = wait.call(this, name, ...args);
  waits.get(name)?.resolve();
  return waiting;
};
const waitingFor = name => { const reached = latch(); waits.set(name, reached); return reached.promise; };
window.publications = [];
const realTimeout = window.setTimeout, realClear = window.clearTimeout;
let paused = false;
window.setTimeout = (callback, delay = 0, ...args) => realTimeout(() => { if (!paused || delay === 0) callback(...args); }, delay);
window.pauseTimers = () => { paused = true; };
window.implementation = () => String(createLocalClient).includes('followingIntents?.recovered');
window.openClient = async ({ url, worker }) => {
  const opener = webDevice({ worker, wasm: new URL('../../../../packages/snapback4/dist/wasm/snapback4_device_bg.wasm', import.meta.url).href });
  client = await createLocalClient({ url, persona: 'bob', device: { open: async (...args) => {
    const core = await opener.open(...args);
    return { ...core, onOutbox(listener) { return core.onOutbox((...args) => {
      if (gates && !window.custodyStarted) { window.custodyStarted = true; window.publications.length = 0; }
      listener(...args);
      if (gates && window.custodySnapshot === undefined) window.custodySnapshot = structuredClone(watch.getSnapshot());
    }); } };
  } }, fetch: async (input, init) => {
    const path = new URL(input).pathname;
    if (offline) throw Error('offline');
    if (path === '/changes') return parkedChanges(init.signal);
    const held = gates;
    if (path.startsWith('/m/') && held) { held.request.resolve(); await held.send.promise; }
    if (path === '/sync' && held) { held.sync.resolve(); await held.apply.promise; }
    return fetch(input, init);
  } });
  await client.sync();
  watch = client.observe(q, { c: null });
  watch.subscribe(() => window.publications.push(structuredClone(watch.getSnapshot())));
};
window.hold = () => { gates = { request: latch(), send: latch(), sync: latch(), apply: latch() }; reads.length = 0; window.publications.length = 0; window.custodyStarted = false; window.custodySnapshot = undefined; };
window.atRequest = () => gates.request.promise;
window.atSync = () => gates.sync.promise;
window.send = () => gates.send.resolve();
window.apply = () => gates.apply.resolve();
window.release = () => { gates?.send.resolve(); gates?.apply.resolve(); gates = undefined; };
window.snapshot = () => watch.getSnapshot();
window.pending = () => client.pendingWrites();
window.query = () => client.query(q, { c: null });
window.beginQuery = async () => {
  const cardsWaiting = waitingFor('cards'), stateWaiting = waitingFor('postState');
  const pair = {};
  pair.cards = window.query().then(read => { pair.direct = read; return read; });
  pair.state = window.disjoint().then(read => { pair.directState = read; return read; });
  if (!reads.length) { window.reading = pair.cards; window.stateReading = pair.state; }
  reads.push(pair);
  // The assertions run after each read has reached custody or returned early.
  await Promise.all([Promise.race([cardsWaiting, pair.cards]), Promise.race([stateWaiting, pair.state])]);
};
window.readStatus = () => reads.map(pair => ({ cards: pair.direct !== undefined, postState: pair.directState !== undefined }));
window.readResults = () => Promise.all(reads.map(async pair => ({ cards: await pair.cards, postState: await pair.state })));
window.disjoint = () => client.query({ kind: 'query', name: 'postState' }, { postId: 'first' });
window.sync = () => client.sync();
window.offline = async () => { offline = true; await client.sync(); };
window.write = (name, args) => client.mutate({ kind: 'mutation', name }, args, { waitSeconds: 0 });
window.ready = count => {
  if (good(watch.getSnapshot(), count)) return;
  return new Promise(resolve => { const stop = watch.subscribe(() => { if (good(watch.getSnapshot(), count)) { stop(); resolve(); } }); });
};
window.finish = async () => { paused = false; window.setTimeout = realTimeout; window.clearTimeout = realClear; window.release(); watch?.close(); await client?.close(); };
