import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
import { setTimeout as delay } from 'node:timers/promises';
import { memorySessionStore, keepSession } from '../../dist/auth.js';
import { webDevice, memoryPersistence } from '../../dist/web.js';
import { DeliveryQueue } from '../../dist/delivery.js';
import { deliveryCommit } from '../../dist/local-device.js';
import { wasm } from './delivery-fixture.mjs';
import { server, until } from './app-server.mjs';

// Hold only facade checks, AFTER real createApp session authority has run.
// Its serialized session store stays free for independent HTTP requests. This
// lets the tests control peer check order and supersession without replacing
// either client, publication, approval, queue, or device implementation.
const hookKey = Symbol.for('snapback4.test.deliveryAuthority');
const hooks = registerHooks({ load(url, context, next) {
  const loaded = next(url, context);
  if (url.endsWith('/dist/app-client.js')) {
    const source = String(loaded.source), marker = '    let active = true;';
    assert.equal(source.split(marker).length, 2);
    return { ...loaded, source: source.replace(marker, `
    const authority = check;
    check = async () => {
      const allowed = await authority();
      return globalThis[Symbol.for('snapback4.test.deliveryAuthority')]?.(raw, allowed) ?? allowed;
    };
${marker}`) };
  }
  return loaded;
} });
const { createApp } = await import('../../dist/app.js');
hooks.deregister();

export const op = { kind: 'query', name: 'fallback' };
export const manifest = positions => [{ table: 'messages', mutation: 'delivered',
  args: ['conversation', 'from', 'through'], fingerprint: 'fixture:messages', rows: positions.map(n => ['c', n]) }];
export const answer = (positions = [41], extra = {}) => ({ data: positions.map(ordinal => ({ ordinal, text: `row ${ordinal}` })),
  complete: true, tables: ['messages'], delivery: manifest(positions), ...extra });
const source = `use personas alice
table messages:
  room: text <=100
  ordinal: int
  text: text <=100
  unique room, ordinal
  read <- allow
  insert <- allow
  online only
query fallback():
  return messages first 20 by .id
`;
export async function fixture(t, tier = 'online', { collect } = {}) {
  const { url } = await server(t, '', source), memory = memorySessionStore();
  const session = { kind: 'user', token: 'fixture', principal: 'dev:alice', expiresAt: Date.now() + 86400000 };
  await keepSession(url, session, memory);
  let held = false, storageError = false, observing = false, raw, queries = 0, onAnswer = () => answer();
  const pending = [], reports = [], collections = [], watches = [], persist = memoryPersistence();
  const changesStarted = Promise.withResolvers();
  const check = (client, allowed) => {
    raw = client;
    if (!held) return allowed;
    const gate = Promise.withResolvers(); pending.push(gate); return gate.promise;
  };
  globalThis[hookKey] = check;
  const original = DeliveryQueue.prototype.accept;
  t.mock.method(DeliveryQueue.prototype, 'accept', function(value, ...rest) {
    if (Array.isArray(value) && value.some(binding => binding.rows.length)) collections.push(structuredClone(value));
    return original.call(this, value, ...rest);
  });
  const personaFetch = (input, init) => {
    const headers = new Headers(init?.headers); headers.delete('authorization'); headers.set('x-snapback-persona', 'alice');
    return fetch(input, { ...init, headers });
  };
  const device = webDevice({ wasm, persist });
  const localDevice = collect ? { async open(...args) {
    const core = await device.open(...args);
    return { ...core, [deliveryCommit](request, current) {
      // Delay outside the device chain so reads can supersede the answer while
      // its collection waits. The real conditional commit still owns the write.
      return collect(() => core[deliveryCommit](request, current), request, current);
    } };
  } } : device;
  const head = await personaFetch(url + '/probe').then(r => r.json());
  const options = { url, sessionStore: { ...memory, async get(key) {
    if (storageError) throw Error('session storage temporarily unavailable');
    return memory.get(key);
  } }, fetch: async (input, init) => {
    const path = new URL(input).pathname;
    if (path === '/auth/refresh') return Response.json({ ok: true, session });
    if (path === '/auth/logout') return Response.json({ ok: true });
    if (path === '/changes') return new Promise((_, reject) => {
      changesStarted.resolve();
      if (init.signal.aborted) reject(Error('closed'));
      else init.signal.addEventListener('abort', () => reject(Error('closed')), { once: true });
    });
    if (path === '/schema') {
      const backend = await personaFetch(input, init).then(r => r.json());
      backend.schema.delivery = [{ ...manifest([])[0], rows: undefined, group: 'room', position: 'ordinal' }];
      return Response.json(backend);
    }
    if (path === '/q/fallback') {
      if (tier === 'online' && observing) await changesStarted.promise;
      const value = await onAnswer(++queries);
      return Response.json({ seq: head.seq, head: head.seq, store_id: head.store_id, ...value });
    }
    if (path === '/m/delivered') {
      reports.push(JSON.parse(init.body));
      return Response.json({ state: 'sent', head: head.seq, seq: head.seq, store_id: head.store_id });
    }
    return personaFetch(input, init);
  }, ...(tier === 'local' ? { device: localDevice, waitSeconds: 1 } : {}) };
  const app = createApp(options);
  t.after(async () => {
    held = false; storageError = false; pending.forEach(gate => gate.resolve(true));
    watches.forEach(watch => watch.close()); await app.close(); delete globalThis[hookKey];
  });
  assert.equal((await app.ready).ok, true);
  const client = app.client;
  // Capture the raw implementation without publishing any data.
  await client.residency();
  return { app, client, raw, pending, reports, collections,
    get queries() { return queries; },
    onAnswer(fn) { onAnswer = fn; }, hold() { held = true; }, release() { held = false; pending.forEach(gate => gate.resolve(true)); },
    failStorage(value) { storageError = value; },
    observe(options) { observing = true; const watch = client.observe(op, {}, options); watches.push(watch); return watch; },
    debt() { return [...persist.stores.values()].flatMap(store => [...store.values()])
      .filter(cell => cell.s === 'm' && cell.k.startsWith('device:delivery:') && cell.v)
      .flatMap(cell => Object.values(JSON.parse(cell.v).groups)); },
  };
}
export async function silent(h, label = 'unapproved answer') {
  await delay(320);
  assert.deepEqual(h.collections, [], `${label}: no collection`);
  assert.deepEqual(h.reports, [], `${label}: no report after debounce`);
  assert.deepEqual(h.debt(), [], `${label}: no persisted debt`);
}
export { until, delay };
