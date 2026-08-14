import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const root = new URL('../..', import.meta.url).pathname;
const source = (path) => readFileSync(new URL(path, `file://${root}/`), 'utf8');
const imports = (text) => [...text.matchAll(/from\s+['"]([^'"]+)['"]/gu)].map((match) => match[1]);

test('the headless tiny facade imports only existing canonical owners', () => {
  const text = source('packages/snapback-client/data-client.mjs');
  assert.deepEqual(imports(text).sort(), [
    './argument-normalization.mjs',
    './canonical-client-value.mjs',
    './rqs.mjs',
    '@expo/snapback-contract/client-store',
  ]);
  for (const owner of ['fetch(', 'WebSocket', 'createContext', 'IndexedDB', 'AsyncStorage']) {
    assert.equal(text.includes(owner), false, `headless facade must not own ${owner}`);
  }
  assert.equal(/class\s+\w*(?:Transport|Cache|Store|Outbox|Settlement|Policy|Auth)/u.test(text), false);
});

test('the React tiny facade is only hooks plus provider/headless delegation', () => {
  const text = source('packages/snapback-react/data.mjs');
  assert.deepEqual(imports(text).sort(), [
    './implementation.mjs',
    '@expo/snapback-client/data',
    'react',
  ]);
  for (const owner of ['fetch(', 'WebSocket', 'IndexedDB', 'AsyncStorage', 'createContext']) {
    assert.equal(text.includes(owner), false, `React facade must not own ${owner}`);
  }
  assert.equal(/new\s+(?:Map|WeakMap|Set)\s*\(/u.test(text), false, 'React facade must not create a runtime binding registry');
});

test('umbrella and Expo data entrypoints are exact reexports', () => {
  assert.equal(source('packages/snapback-umbrella/data.mjs'), "export { createDataClient } from '@expo/snapback-client/data';\n");
  assert.equal(source('packages/snapback-umbrella/react-data.mjs'), "export { db } from '@expo/snapback-react/data';\n");
  assert.equal(source('packages/snapback-expo/data.mjs'), "export { db } from '@expo/snapback-react/data';\n");
});
