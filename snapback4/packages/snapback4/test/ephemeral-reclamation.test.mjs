import test from 'node:test';
import assert from 'node:assert/strict';
import { createClient } from '../dist/client.js';
import { createLocalClient } from '../dist/local.js';
import { defaultFetch } from '../dist/node-fetch.js';
import { server, until } from './helpers/app-server.mjs';
import { device } from './helpers/ephemeral-server.mjs';

const source = `use identity
use personas bob, w0, w1, w2, w3, w4, w5, w6, w7, w8, w9
table ghosts:
  n: int
  owner: principal
  unique byN: n
  read <- .owner = viewer
  insert <- .owner = viewer
  ephemeral 60s
mutation fill(start: int):
  for i in range(0, 900):
    insert ghosts { n: start + i, owner: viewer }
mutation visible():
  insert ghosts { n: 10000, owner: viewer }
query seen():
  return ghosts first 1 by byN { n }
`;
for (const tier of ['online', 'wasm']) test(`${tier}: a real hidden prefix expires silently and incomplete polling reaches the visible row`, { timeout: 30000 }, async t => {
  const { url } = await server(t, undefined, source);
  const post = async (path, body, persona = 'bob') => {
    const response = await defaultFetch(url + path, { method: 'POST', headers: { 'content-type': 'application/json', 'x-snapback-persona': persona }, body: JSON.stringify(body) });
    const json = await response.json(); assert.equal(json.denied, undefined, JSON.stringify(json)); return json;
  };
  for (let i = 0; i < 10; i++) assert.equal((await post('/m/fill', { args: { start: i * 900 } }, `w${i}`)).state, 'sent');
  await post('/dev/clock/advance', { duration: '30s' });
  assert.equal((await post('/m/visible', { args: {} })).state, 'sent');
  const answers = [];
  let syncs = 0;
  const fetch = async (input, init) => {
    if (new URL(input).pathname === '/sync') syncs++;
    const response = await defaultFetch(input, init);
    if (new URL(input).pathname === '/q/seen') answers.push(await response.clone().json());
    return response;
  };
  const client = tier === 'online' ? createClient({ url, persona: 'bob', fetch })
    : await createLocalClient({ url, persona: 'bob', fetch, device: device() });
  t.after(() => client.close());
  if (client.sync) await client.sync();
  const watch = client.observe({ kind: 'query', name: 'seen', runs: 'server', ephemeralReads: ['ghosts'] }, {});
  t.after(() => watch.close());
  await until(() => 'data' in watch.getSnapshot());
  assert.equal(watch.getSnapshot().complete, false);
  assert.deepEqual(watch.getSnapshot().data, []);
  const before = answers.at(-1), count = syncs;
  assert.equal(before.nextExpiry, null, 'hidden deadlines are absent');
  await post('/dev/clock/advance', { duration: '30s' });
  await until(() => watch.getSnapshot().data?.[0]?.n === 10000, 'visible row after reclamation');
  const after = answers.at(-1);
  assert.equal(after.ephemeral.epoch, before.ephemeral.epoch);
  assert.equal(after.ephemeral.incarnation, before.ephemeral.incarnation);
  assert.equal(after.seq, before.seq);
  assert.equal(syncs, count);
});
