import { createLocalClient } from '../../../../packages/snapback4/dist/local.js';
import { webDevice } from '../../../../packages/snapback4/dist/web.js';
const q = { kind: 'query', name: 'cards' };
const latch = () => { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; };
const good = (r, count) => r.data?.length === count && r.complete && r.fresh && !r.revalidating;
let client, watch, offline = false, gates;
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
    if (path === '/changes') return new Promise((_, reject) => init.signal.addEventListener('abort', () => reject(Error('closed')), { once: true }));
    const held = gates;
    if (path.startsWith('/m/') && held) { held.request.resolve(); await held.send.promise; }
    if (path === '/sync' && held) { held.sync.resolve(); await held.apply.promise; }
    return fetch(input, init);
  } });
  await client.sync();
  watch = client.observe(q, { c: null });
  watch.subscribe(() => window.publications.push(structuredClone(watch.getSnapshot())));
};
window.hold = () => { gates = { request: latch(), send: latch(), sync: latch(), apply: latch() }; window.publications.length = 0; window.custodyStarted = false; window.custodySnapshot = undefined; };
window.atRequest = () => gates.request.promise;
window.atSync = () => gates.sync.promise;
window.send = () => gates.send.resolve();
window.apply = () => gates.apply.resolve();
window.release = () => { gates?.send.resolve(); gates?.apply.resolve(); gates = undefined; };
window.snapshot = () => watch.getSnapshot();
window.pending = () => client.pendingWrites();
window.query = () => client.query(q, { c: null });
window.disjoint = () => client.query({ kind: 'query', name: 'postState' }, { postId: 'first' });
window.sync = () => client.sync();
window.offline = async () => { offline = true; await client.sync(); };
window.write = (name, args) => client.mutate({ kind: 'mutation', name }, args, { waitSeconds: 0 });
window.ready = count => {
  if (good(watch.getSnapshot(), count)) return;
  return new Promise(resolve => { const stop = watch.subscribe(() => { if (good(watch.getSnapshot(), count)) { stop(); resolve(); } }); });
};
window.finish = async () => { paused = false; window.setTimeout = realTimeout; window.clearTimeout = realClear; window.release(); watch?.close(); await client?.close(); };
