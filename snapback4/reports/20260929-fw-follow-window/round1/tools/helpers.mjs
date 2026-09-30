import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fetch } from 'undici';
const { createLocalClient } = await import(process.env.FW_LOCAL_MODULE ?? new URL('../../../../packages/snapback4/dist/local.js', import.meta.url));
import { webDevice, memoryPersistence } from '../../../../packages/snapback4/dist/web.js';
import { processDevice } from '../../../../packages/snapback4/dist/native.js';
import { server, binary } from '../../../../packages/snapback4/test/helpers/app-server.mjs';
export { createLocalClient, server };
export const fixture = readFileSync(new URL('../../tools/fixture.q', import.meta.url), 'utf8').replace('use identity password', 'use personas alice, bob, carol') + '\nmutation like(postId: posts):\n  insert likes { postId, principal: viewer, at: now } if absent\n';
export const q = { kind: 'query', name: 'cards' };
export const latch = () => { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; };
export const honest = r => r.loading || r.denied || !r.complete || r.revalidating;
export const complete = (r, n) => r.data?.length === n && r.complete && r.fresh && !r.revalidating;
export function answer(watch, predicate) {
  if (predicate(watch.getSnapshot())) return Promise.resolve(watch.getSnapshot());
  return new Promise(resolve => { const stop = watch.subscribe(() => { const r = watch.getSnapshot(); if (predicate(r)) { stop(); resolve(r); } }); });
}
export function transport() {
  let offline = false, gates;
  return {
    set offline(value) { offline = value; },
    hold() { gates = { request: latch(), send: latch(), sync: latch(), apply: latch() }; return gates; },
    release() { gates?.send.resolve(); gates?.apply.resolve(); gates = undefined; },
    async fetch(input, init) {
      const path = new URL(input).pathname;
      if (offline) throw new TypeError('offline');
      if (path === '/changes') return new Promise((_, reject) => init.signal.addEventListener('abort', () => reject(Error('closed')), { once: true }));
      const held = gates;
      if (path.startsWith('/m/') && held) { held.request.resolve(); await held.send.promise; }
      if (path === '/sync' && held) { held.sync.resolve(); await held.apply.promise; }
      return fetch(input, init);
    },
  };
}
export async function setup(t, tier, seed = true) {
  const { url, dir } = await server(t, '', fixture);
  const stores = new Map(), cores = new Map();
  let loseOutboxReply = false;
  const device = name => {
    if (!stores.has(name)) stores.set(name, memoryPersistence());
    const opener = tier === 'process' ? processDevice({ binary, dir: join(dir, name) }) : webDevice({ wasm: readFileSync(new URL('../../../../packages/snapback4/src/wasm/snapback4_device_bg.wasm', import.meta.url)), persist: { ...stores.get(name), async save(store, changes) {
      await stores.get(name).save(store, changes);
      if (name === 'bob' && loseOutboxReply && changes.some(c => c.s === 'o' && c.v !== null)) {
        loseOutboxReply = false; throw Error('lost outbox commit reply');
      }
    } } });
    // Deliberately reuse the same backing store for the account-switch probe.
    return { open: async (_name, backend) => { const core = await opener.open(name, backend); cores.set(name, core); return core; } };
  };
  const alice = await createLocalClient({ url, persona: 'alice', device: device('alice') });
  t.after(() => alice.close()); await alice.sync();
  if (seed) assert.equal((await alice.mutate({ kind: 'mutation', name: 'post' }, { postId: 'first', parentId: null })).state, 'sent');
  const wire = transport();
  const bob = await createLocalClient({ url, persona: 'bob', device: device('bob'), fetch: wire.fetch });
  t.after(() => { wire.release(); return bob.close(); }); await bob.sync();
  const watch = bob.observe(q, { c: null });
  t.after(() => watch.close());
  const publications = [];
  watch.subscribe(() => publications.push(structuredClone(watch.getSnapshot())));
  if (process.env.FW_TRACE) console.error('setup', tier, watch.getSnapshot());
  await answer(watch, r => complete(r, 0));
  if (process.env.FW_TRACE) console.error('ready', tier);
  return { url, device, bob, wire, watch, publications, cores, loseOutboxReply() { loseOutboxReply = true; } };
}
export async function causal(t, run) {
  let timer;
  const guard = new Promise((_, reject) => { timer = setTimeout(() => reject(Error('causal probe exceeded its deadlock guard')), 15000); });
  try { return await Promise.race([run(), guard]); }
  finally { clearTimeout(timer); }
}
