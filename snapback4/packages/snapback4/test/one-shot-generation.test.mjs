// @ref LLP 3000.023#11 — review reproduction: generation discovery at facade approval.
import test from 'node:test';
import assert from 'node:assert/strict';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { fixture, source, q, m, until, parked } from './helpers/answers-stay.mjs';
import { createClient } from '../dist/client.js';
import { guardClient } from '../dist/app-client.js';

test('discovery of a new generation fences a prior facade candidate and its old write summary', { timeout: 20000 }, async t => {
  const v1 = source.replace('  name: text\n  read <- allow', '  name: text\n  update <- allow\n  read <- allow') + `
mutation rename(name: text <=200): server
  update profiles['bob'] { name }
`;
  const v2 = v1.replace("update profiles['bob'] { name }", "update messages['item'] { body: name }");
  const f = await fixture(t, v1, { watch: true });
  const schema = () => fetch(f.url + '/schema', { headers: { 'x-snapback-persona': 'bob' } }).then(r => r.json());
  const before = await schema();
  assert.equal(typeof before.generation, 'number', JSON.stringify(before));
  const gate = Promise.withResolvers();
  let holdWrite = false, schemaReads = 0;
  t.after(() => gate.resolve());
  const raw = createClient({ url: f.url, persona: 'bob', fetch: async (url, init) => {
    const path = new URL(url).pathname;
    if (path === '/changes') return parked(init.signal);
    if (path === '/m/rename' && holdWrite) await gate.promise;
    if (path === '/schema') schemaReads++;
    return fetch(url, init);
  } });
  t.after(() => raw.close());
  let checks = 0;
  const { client } = guardClient(raw, async () => {
    if (++checks === 2) {
      writeFileSync(join(f.dir, 'snapback/schema.q'), v2);
      await until(async () => (await schema()).generation > before.generation, 'new generation');
      const next = await schema();
      console.log(JSON.stringify({ oldGeneration: before.generation, newGeneration: next.generation,
        oldWrites: before.programs.find(p => p.name === 'rename').settlement?.writes,
        newWrites: next.programs.find(p => p.name === 'rename').settlement?.writes }));
      assert.equal((await raw.query(q('profile'), {})).data?.name, 'Bob');
      if (!process.env.REVIEW_BASE_CLIENT) assert.equal(schemaReads, 2, 'the client has discovered both generations');
      holdWrite = true;
      assert.equal((await raw.mutate(m('rename'), { name: 'changed by v2' }, { waitSeconds: 0 })).state, 'pending');
    }
    return true;
  }, () => true, () => ({ code: 'E_SCOPE', family: 'client', message: 'expired' }));
  let done = false;
  const answer = client.query(q('item'), {}).then(r => { done = true; return r; });
  await until(() => done || holdWrite);
  await delay(100);
  console.log(JSON.stringify({ doneBeforeWrite: done, schemaReads, checks, pending: await raw.pendingWrites() }));
  const premature = done;
  gate.resolve();
  const read = await answer;
  console.log(JSON.stringify({ read }));
  assert.equal(premature, false, 'a newly relevant admitted write must block the old candidate');
  assert.equal(read.data?.body, 'changed by v2');
});

test('a late discovery response cannot replace newer generation facts', { timeout: 20000 }, async t => {
  const v1 = source.replace('  name: text\n  read <- allow', '  name: text\n  update <- allow\n  read <- allow') + "\nmutation rename(name: text <=200): server\n  update profiles['bob'] { name }\n";
  const v2 = v1.replace("update profiles['bob'] { name }", "update messages['item'] { body: name }");
  const f = await fixture(t, v1, { watch: true });
  const schema = () => fetch(f.url + '/schema', { headers: { 'x-snapback-persona': 'bob' } }).then(r => r.json());
  const before = await schema(), discovery = Promise.withResolvers(), write = Promise.withResolvers();
  let captured = false, discoveries = 0;
  t.after(() => { discovery.resolve(); write.resolve(); });
  const client = createClient({ url: f.url, persona: 'bob', fetch: async (url, init) => {
    const path = new URL(url).pathname;
    if (path === '/changes') return parked(init.signal);
    if (path === '/m/rename') await write.promise;
    const result = await fetch(url, init);
    if (path === '/schema' && ++discoveries === 1) { captured = true; await discovery.promise; }
    return result;
  } });
  t.after(() => client.close());
  let done = false;
  const reading = client.query(q('item'), {}).then(r => { done = true; return r; });
  await until(() => captured);
  writeFileSync(join(f.dir, 'snapback/schema.q'), v2);
  await until(async () => (await schema()).generation > before.generation);
  assert.equal((await client.query(q('profile'), {})).data?.name, 'Bob');
  await client.mutate(m('rename'), { name: 'new generation' }, { waitSeconds: 0 });
  discovery.resolve(); await delay(100); assert.equal(done, false);
  write.resolve(); assert.equal((await reading).data?.body, 'new generation');
  assert.equal(discoveries, 2, 'the stale discovery did not evict installed facts');
});
