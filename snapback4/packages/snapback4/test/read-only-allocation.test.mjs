// @ref LLP 3000.033#1.4 — detect even unused write machinery allocated by a read-only app.
import test from 'node:test';
import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
import { server } from './helpers/app-server.mjs';

// Wrap the real constructors/factories at module load. Counting their calls
// catches allocate-then-discard mutations that traffic assertions cannot see.
// The full-session control proves each instrumented entry point is exercised.
const entries = {
  'writes.js': ['WriteHistory', 'MutationIds'],
  'pending-items.js': ['OnlineIntentPresentation'],
  'delivery.js': ['DeliveryQueue'],
  'ephemeral.js': ['ephemeralLane'],
  'app-online.js': ['onlineCustody'],
};
const counts = Object.fromEntries(Object.values(entries).flat().map(name => [name, 0]));
const loadedNames = new Set();
globalThis[Symbol.for('snapback4.test.writeAllocations')] = name => { counts[name]++; };
const hooks = registerHooks({ load(url, context, next) {
  const loaded = next(url, context);
  if (!url.includes('/dist/')) return loaded;
  const names = entries[url.split('/').at(-1)];
  if (!names) return loaded;
  let source = String(loaded.source);
  for (const name of names) {
    const declaration = new RegExp(`export ((?:async )?function|class) ${name}\\b`);
    assert.match(source, declaration);
    source = source.replace(declaration, `$1 ${name}`);
    source += `\nconst counted${name} = new Proxy(${name}, {
      construct(target, args, receiver) {
        globalThis[Symbol.for('snapback4.test.writeAllocations')]('${name}');
        return Reflect.construct(target, args, receiver);
      },
      apply(target, receiver, args) {
        globalThis[Symbol.for('snapback4.test.writeAllocations')]('${name}');
        return Reflect.apply(target, receiver, args);
      }
    }); export { counted${name} as ${name} };\n`;
    loadedNames.add(name);
  }
  return { ...loaded, source };
} });
const { createApp } = await import('../dist/app.js');
hooks.deregister();

test('read-only apps allocate no write owners, including unused WriteHistory', { timeout: 15000 }, async t => {
  assert.deepEqual([...loadedNames].sort(), Object.keys(counts).sort());
  const { url } = await server(t, undefined, 'use identity\nquery who():\n  return viewer\n');
  const { memorySessionStore } = await import('../dist/auth.js');
  const sessionStore = memorySessionStore(), password = 'allocation-test-password';
  const app = createApp({ url, sessionStore, readOnly: true });
  t.after(() => app.close());
  assert.equal((await app.ready).ok, true);
  assert.equal((await app.auth.signup('reader@example.test', password)).ok, true);
  assert.equal((await app.client.query({ kind: 'query', name: 'who' }, {})).data, app.auth.viewer);
  assert.equal((await app.client.refreshSession()).why.code, 'E_READ_ONLY_REFRESH');
  await app.close();
  const restored = createApp({ url, sessionStore, readOnly: true });
  t.after(() => restored.close());
  assert.equal((await restored.ready).ok, true);
  assert.equal(restored.auth.state, 'signed-in');
  assert.equal((await restored.auth.logout()).ok, true);
  await restored.close();
  assert.deepEqual(counts, Object.fromEntries(Object.keys(counts).map(name => [name, 0])));

  const full = createApp({ url });
  t.after(() => full.close());
  assert.equal((await full.ready).ok, true);
  assert.equal((await full.auth.signup('writer@example.test', password)).ok, true);
  await full.close();
  for (const [name, count] of Object.entries(counts)) assert.ok(count > 0, `${name} full-session control`);
});
