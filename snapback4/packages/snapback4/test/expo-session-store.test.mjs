import test from 'node:test';
import assert from 'node:assert/strict';
import ts from 'typescript';
import {readFileSync} from 'node:fs';
const source = readFileSync(new URL('../../snapback4-expo/src/session-store.ts', import.meta.url), 'utf8');
const js = ts.transpileModule(source, {compilerOptions:{target:ts.ScriptTarget.ES2022, module:ts.ModuleKind.ESNext}}).outputText;
const {secureStoreSessionStore} = await import(`data:text/javascript;base64,${Buffer.from(js).toString('base64')}`);

test('SecureStore session adapter keeps colliding punctuation, Unicode and backend/session keys separate across reopen', async () => {
  const data = new Map();
  const native = {
    async getItemAsync(key) { assert.match(key,/^[\w.-]+$/); return data.get(key) ?? null; },
    async setItemAsync(key,value) { assert.match(key,/^[\w.-]+$/); data.set(key,value); },
    async deleteItemAsync(key) { data.delete(key); },
  };
  const keys = ['', 'https://a.test:4400/session', 'https___a.test_4400_session', 'https://a.test:4400/session.read', 'https://b.test:4400/session', '.', '_', '-', '\u0000', 'é', 'e\u0301', '\ud800', '\udc00', '😀'];
  const store = secureStoreSessionStore(native);
  for (const [i,key] of keys.entries()) await store.set(key, `session:${i}`);
  assert.equal(data.size, keys.length);
  const reopened = secureStoreSessionStore(native);
  for (const [i,key] of keys.entries()) assert.equal(await reopened.get(key), `session:${i}`);
  for (const key of keys) { await reopened.delete(key); assert.equal(await store.get(key),null); }
});

test('SecureStore failures propagate without claiming persistence', async () => {
  const error = new Error('keychain unavailable');
  const store = secureStoreSessionStore({ getItemAsync: async()=>{throw error;},setItemAsync: async()=>{throw error;},deleteItemAsync: async()=>{throw error;} });
  await assert.rejects(store.get('backend'), found=>found===error);
  await assert.rejects(store.set('backend','token'), found=>found===error);
  await assert.rejects(store.delete('backend'), found=>found===error);
  const index = readFileSync(new URL('../../snapback4-expo/src/index.ts',import.meta.url),'utf8');
  assert.match(index, /export \{ secureStoreSessionStore, type SecureStoreLike \} from "\.\/session-store"/);
});
