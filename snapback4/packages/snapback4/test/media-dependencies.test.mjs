// @ref LLP 3000.023#10 — disjoint media invalidations use the interpreter's full read footprint.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { MediaCache } from '../dist/local-assets.js';
import { createLocalClient } from '../dist/local.js';
import { createClient } from '../dist/client.js';
import { processDevice } from '../dist/native.js';
import { webDevice, memoryPersistence } from '../dist/web.js';
import { server, binary } from './helpers/app-server.mjs';

for (const boundary of ['unrelated', 'home', 'authorization', 'unknown', 'legacy', 'empty', 'malformed', 'expiry']) test(`retained media: ${boundary} footprint keeps authorization and revocation`, async t => {
  let now = 1000, valid = true, checks = 0;
  const bytes = new Map(), meta = new Map();
  const home = { store_id: 'store', table: 'photos', row: 'p', column: 'photo', generation: 1, expiresAt: 5000, type: 'image/png', tables: ['photos', 'parents', 'members'] };
  if (boundary === 'legacy') delete home.tables;
  if (boundary === 'empty') home.tables = [];
  if (boundary === 'malformed') home.tables = ['photos', 7];
  const core = { media: { read: async id => bytes.get(id), write: async (id, value) => { bytes.set(id, value); }, remove: async id => { bytes.delete(id); } }, async call(request) {
    if (request.op === 'asset_home') { checks++; return { ok: valid && now < 5000 ? { ...home } : null }; }
    if (request.op === 'meta') return { ok: meta.get(request.key) };
    if (request.op === 'set_meta') { meta.set(request.key, request.value); return { ok: null }; }
    throw Error(request.op);
  } };
  const cache = new MediaCache(core, 'bob', { keep: 'viewed', maxBytes: 10000 }, () => now);
  t.after(() => cache.close()); await cache.open();
  const handle = await cache.viewed('asset', new Blob(['photo'], { type: 'image/png' }), new Response('', { headers: { 'accept-ranges': 'bytes', 'x-snapback-asset-home': encodeURIComponent(JSON.stringify(home)) } }));
  assert.ok(handle?.url);
  checks = 0;
  const touched = boundary === 'home' ? ['photos'] : boundary === 'authorization' ? ['members'] : boundary === 'unknown' ? undefined : ['reactions'];
  if (boundary !== 'unrelated') valid = false;
  if (boundary === 'expiry') now = 5000;
  const pending = cache.reconcile(touched);
  // The serial queue must own its footprint; a caller cannot mutate it after scheduling.
  if (touched) touched.splice(0);
  await pending;
  if (boundary === 'unrelated') { assert.equal(checks, 0); assert.equal(await (await fetch(handle.url)).text(), 'photo'); }
  else { assert.equal(checks, 1); await assert.rejects(fetch(handle.url)); assert.equal(bytes.size, 0); }
});

const source = readFileSync(new URL('../../../reports/20260929-ll-live-latency/tools/fixture.q', import.meta.url), 'utf8')
  .replace('use identity password', 'use personas alice, bob')
  .replace('  update <- .principal = viewer\n  sync to members[.room]', '  update <- .principal = viewer\n  delete <- allow\n  sync to members[.room]') + `
mutation removeMember(): server
  delete members['bob']
`;
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=', 'base64');
for (const tier of ['process', 'wasm']) test(`${tier}: live asset-home dependencies preserve unrelated bytes and revoke on membership loss`, async t => {
  const { url, dir } = await server(t, '', source);
  const rows = [{ table: 'profiles', row: { id: 'alice', principal: 'dev:alice', name: 'Alice' } }, { table: 'rooms', row: { id: 'room', title: 'Room' } }, ...['alice', 'bob'].map(p => ({ table: 'members', row: { id: p, room: 'room', principal: 'dev:' + p } }))];
  assert.equal((await fetch(url + '/seed', { method: 'POST', body: JSON.stringify(rows) }).then(r => r.json())).seeded, rows.length);
  const sender = createClient({ url, persona: 'alice' }); t.after(() => sender.close());
  const upload = await sender.upload(png); assert.ok(upload.ok);
  assert.equal((await sender.mutate({ kind: 'mutation', name: 'send' }, { id: 'anchor', room: 'room', ordinal: 1, text: 'photo', photo: upload.asset })).state, 'sent');
  const underlying = tier === 'process' ? processDevice({ binary, dir: join(dir, 'device') }) : webDevice({ wasm: readFileSync(new URL('../src/wasm/snapback4_device_bg.wasm', import.meta.url)), persist: memoryPersistence() });
  const checks = [];
  const receiver = await createLocalClient({ url, persona: 'bob', assets: { keep: 'viewed', maxBytes: 10000 }, device: { async open(...args) {
    const core = await underlying.open(...args);
    return { ...core, async call(request, committed) { const reply = await core.call(request, committed); if (request.op === 'asset_home') checks.push(reply.ok); return reply; } };
  } }, fetch: (input, init) => new URL(input).pathname === '/changes' ? new Promise((_, reject) => init.signal.addEventListener('abort', () => reject(Error('closed')), { once: true })) : fetch(input, init) });
  t.after(() => receiver.close()); await receiver.sync();
  const handle = await receiver.asset(upload.asset.id); assert.ok(handle.url);
  assert.deepEqual(checks.at(-1).tables, ['members', 'messages']);
  for (const [name, args] of [['editProfile', { name: 'Changed' }], ['setReaction', { message: 'anchor', emoji: 'like' }]]) {
    checks.length = 0;
    assert.equal((await sender.mutate({ kind: 'mutation', name }, args)).state, 'sent');
    await receiver.sync();
    assert.equal(checks.length, 0, name + ' does not recheck disjoint media');
    assert.equal((await fetch(handle.url)).status, 200);
  }
  assert.equal((await sender.mutate({ kind: 'mutation', name: 'removeMember' }, {})).state, 'sent');
  await receiver.sync();
  assert.ok(checks.length > 0, 'authorization dependency forces a fresh home read');
  await assert.rejects(fetch(handle.url), 'membership loss revokes the live retained handle');
});
