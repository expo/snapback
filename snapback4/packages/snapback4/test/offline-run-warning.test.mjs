import test from 'node:test';
import assert from 'node:assert/strict';
import { settleMutation, OFFLINE_RUN_WARNING_MS } from '../dist/write-settlement.js';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
test('development offline run warns once, resets on reconnect and keeps settlement alive', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const previous = globalThis.__DEV__; globalThis.__DEV__ = true; t.after(() => { globalThis.__DEV__ = previous; });
  const warnings = []; t.mock.method(console, 'warn', message => warnings.push(message));
  let writeObserver, linkObserver, stopped = 0, link = 'offline';
  const client = { onWrite: f => { writeObserver = f; return () => stopped++; }, onLink: f => { linkObserver = f; return () => stopped++; }, link: () => link, mutate: async (_op, _args, options) => ({ state: 'pending', id: options.id }) };
  const promise = settleMutation(client, { kind: 'mutation', name: 'archive' }, {}, { id: 'call' }); await Promise.resolve();
  t.mock.timers.tick(OFFLINE_RUN_WARNING_MS - 1); assert.equal(warnings.length, 0);
  link = 'online'; linkObserver(link); t.mock.timers.tick(1); assert.equal(warnings.length, 0);
  link = 'offline'; linkObserver(link); t.mock.timers.tick(OFFLINE_RUN_WARNING_MS);
  assert.equal(warnings.length, 1); assert.match(warnings[0], /archive.*offline for 10 seconds/); assert.match(warnings[0], /waitSeconds: 0/);
  t.mock.timers.tick(OFFLINE_RUN_WARNING_MS * 2); assert.equal(warnings.length, 1);
  writeObserver({ state: 'sent', id: 'call', seq: 1, result: 'kept' }); assert.equal((await promise).result, 'kept'); assert.equal(stopped, 2);
  globalThis.__DEV__ = false;
  const silent = settleMutation(client, { name: 'archive' }, {}, { id: 'prod' }); await Promise.resolve(); t.mock.timers.tick(OFFLINE_RUN_WARNING_MS * 2); assert.equal(warnings.length, 1);
  writeObserver({ state: 'failed', id: 'prod', why: { code: 'E_RULE' } }); assert.equal((await silent).state, 'failed');
  globalThis.__DEV__ = true;
  assert.equal((await settleMutation(client, { name: 'archive' }, {}, { id: 'custody', waitSeconds: 0 })).state, 'pending'); t.mock.timers.tick(OFFLINE_RUN_WARNING_MS * 2); assert.equal(warnings.length, 1);
  const duplicate = settleMutation(client, { name: 'archive' }, {}, { id: 'duplicate' }); await Promise.resolve();
  t.mock.timers.tick(OFFLINE_RUN_WARNING_MS - 1); linkObserver('offline'); t.mock.timers.tick(1); assert.equal(warnings.length, 2);
  writeObserver({ state: 'sent', id: 'duplicate', seq: 2 }); await duplicate;
  const short = settleMutation(client, { name: 'archive' }, {}, { id: 'short' }); await Promise.resolve();
  writeObserver({ state: 'failed', id: 'short', why: { code: 'E_RULE' } }); await short;
  t.mock.timers.tick(OFFLINE_RUN_WARNING_MS); assert.equal(warnings.length, 2, 'terminal settlement clears its pending timer');
});

test('the warning ships through the Expo Hermes Babel preset without additional app configuration', () => {
  const require = createRequire(import.meta.url);
  const { transformSync } = require('@babel/core');
  const source = readFileSync(new URL('../dist/write-settlement.js', import.meta.url), 'utf8');
  const output = transformSync(source, { filename: 'write-settlement.js', babelrc: false, configFile: false,
    caller: { name: 'metro', platform: 'ios', engine: 'hermes', isDev: true, supportsStaticESM: true },
    presets: [require.resolve('babel-preset-expo')] });
  assert.ok(output.code.includes('waitSeconds'), 'the actual settlement implementation was transformed');
});
