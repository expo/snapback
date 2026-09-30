import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fetch } from 'undici';
import { createLocalClient } from '../../../packages/snapback4/dist/local.js';
import { webDevice, memoryPersistence } from '../../../packages/snapback4/dist/web.js';
import { processDevice } from '../../../packages/snapback4/dist/native.js';
import { server, binary } from '../../../packages/snapback4/test/helpers/app-server.mjs';

const fixture = readFileSync(new URL('./fixture.q', import.meta.url), 'utf8').replace('use identity password', 'use personas alice, bob');
const q = { kind: 'query', name: 'cards' };
const latch = () => { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; };
const honest = read => read.loading || read.denied || !read.complete || read.revalidating;
function answer(watch, predicate) {
  if (predicate(watch.getSnapshot())) return Promise.resolve(watch.getSnapshot());
  return new Promise(resolve => {
    const stop = watch.subscribe(() => { const read = watch.getSnapshot(); if (predicate(read)) { stop(); resolve(read); } });
  });
}
async function causalTurns(t, run) {
  // One-shots have real bounded retry pauses. Network gates still decide when
  // writes execute and apply; freezing all positive timers would strand them.
  return run();
}
for (const tier of ['wasm', 'process']) for (const keep of [undefined, false]) for (const waitSeconds of [undefined, 0]) {
  test(`${tier} keep=${keep} wait=${waitSeconds}: own follow/unfollow stay honest across admission, settlement and apply`, { timeout: 30000 }, async t => {
    const { url, dir } = await server(t, '', fixture);
    const device = name => tier === 'process' ? processDevice({ binary, dir: join(dir, name) }) : webDevice({ wasm: readFileSync(new URL('../../../packages/snapback4/src/wasm/snapback4_device_bg.wasm', import.meta.url)), persist: memoryPersistence() });
    const alice = await createLocalClient({ url, persona: 'alice', device: device('alice') });
    t.after(() => alice.close()); await alice.sync();
    for (const postId of ['first', 'second', 'third']) assert.equal((await alice.mutate({ kind: 'mutation', name: 'post' }, { postId, parentId: null })).state, 'sent');
    assert.equal((await alice.mutate({ kind: 'mutation', name: 'repost' }, { postId: 'first' })).state, 'sent');
    let gates;
    const bob = await createLocalClient({ url, persona: 'bob', device: device('bob'), fetch: async (input, init) => {
      const path = new URL(input).pathname;
      // Owned write and stream releases control when Bob learns the change.
      if (path === '/changes') return new Promise((_, reject) => init.signal.addEventListener('abort', () => reject(Error('closed')), { once: true }));
      if (path.startsWith('/m/') && gates) { gates.request.resolve(); await gates.send.promise; }
      if (path === '/sync' && gates) { gates.sync.resolve(); await gates.apply.promise; }
      return fetch(input, init);
    } });
    t.after(() => { gates?.send.resolve(); gates?.apply.resolve(); return bob.close(); });
    await bob.sync();
    const watch = bob.observe(q, { c: null }, { keep });
    const publications = [];
    watch.subscribe(() => publications.push(structuredClone(watch.getSnapshot())));
    t.after(() => watch.close());
    await answer(watch, r => r.data?.length === 0 && r.complete && !r.revalidating);
    const disjoint = bob.observe({ kind: 'query', name: 'postState' }, { postId: 'first' });
    t.after(() => disjoint.close());
    await answer(disjoint, r => r.complete);
    await causalTurns(t, async () => {
    for (const op of ['follow', 'follow', 'unfollow']) {
      const stage = name => { if (process.env.FW_TRACE) console.error(tier, keep, waitSeconds, op, name); };
      stage('call');
      gates = { request: latch(), send: latch(), sync: latch(), apply: latch() };
      publications.length = 0;
      const terminal = latch(), stopWrite = bob.onWrite(terminal.resolve);
      const write = bob.mutate({ kind: 'mutation', name: op }, { actor: 'dev:alice' }, { waitSeconds });
      assert.ok(honest(watch.getSnapshot()), 'the call turn marks its mounted answer');
      await gates.request.promise;
      stage('admitted');
      assert.ok(honest(await bob.query(q, { c: null })), `${op}: queued direct answer is honest`);
      assert.ok(honest(watch.getSnapshot()), `${op}: mounted answer is honest before server execution`);
      assert.equal((await bob.pendingWrites()).length, 1);
      assert.equal((await bob.query({ kind: 'query', name: 'postState' }, { postId: 'first' })).denied?.code, 'E_QUERY_RETRY', 'one-shot waits for its admitted nonpredictable write');
      assert.equal(disjoint.getSnapshot().complete, true, 'disjoint observations retain completeness');
      gates.send.resolve();
      await gates.sync.promise; // HTTP settlement was durably saved; rows have not applied.
      stage('settled');
      assert.equal((await bob.pendingWrites()).length, 0, 'settlement is not row publication');
      assert.ok(honest(await bob.query(q, { c: null })), `${op}: sent but unobserved answer is honest`);
      assert.ok(honest(watch.getSnapshot()), `${op}: mounted answer stays honest before apply`);
      gates.apply.resolve();
      assert.equal((await write).state, waitSeconds === 0 ? 'pending' : 'sent');
      assert.equal((await terminal.promise).state, 'sent'); stopWrite();
      stage('applied');
      const count = op === 'follow' ? 4 : 0;
      const final = await answer(watch, r => r.data?.length === count && r.complete && r.fresh && !r.revalidating);
      stage('published');
      assert.equal(final.fresh, true);
      for (const r of publications) assert.ok(honest(r) || r.data?.length === count, `${op}: misleading publication ${JSON.stringify(r)}`);
      if (op === 'follow') {
        assert.equal(final.data.filter(r => r.repost).length, 1);
        assert.ok(final.data.every(r => r.actor === 'dev:alice' && r.card));
      }
      assert.equal((await bob.query(q, { c: null })).data.length, count, 'unfollow hides on the next read after observation');
      gates = undefined;
    }
    const refused = await bob.mutate({ kind: 'mutation', name: 'follow' }, { actor: 'dev:bob' });
    assert.equal(refused.state, 'failed');
    assert.equal(refused.why.code, 'FEED_CANNOT_FOLLOW_SELF');
    await answer(watch, r => r.data?.length === 0 && r.complete && !r.revalidating);
    });
  });
}
