// @ref LLP 3000.028#7.1 — paired bodies across acquisition and membership epochs.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { mintId, idFrom } from '../../../packages/snapback4/dist/client.js';
import { login } from '../../../packages/snapback4/dist/auth.js';
import { host, replica, evidence, q, sent, pair, ids, until } from './harness.mjs';

const full = process.env.EQ_FULL_STORE === '1';
const variants = full ? ['calibration'] : ['ordinal', 'timestamp'];
for (const variant of variants) test(`${variant}: paired history, acquisition floor and membership lifecycle`, { timeout: 240000 }, async t => {
  const h = await host(t, { full, timestamp: variant === 'timestamp' });
  let owner;
  if (full) {
    const line = readFileSync(join(evidence, 'instrument/fixtures/scale.log'), 'utf8').split('\n').find(line => / u0001 register /.test(line));
    const tokens = line.match(/"(?:[^"\\]|\\.)*"|\S+/g).map(t => t.startsWith('"') ? JSON.parse(t) : t);
    const signed = await login(h.url, tokens[3], tokens[4]); assert.ok(signed.ok);
    owner = h.online({ session: signed.session });
  } else {
    owner = h.online({ persona: 'eqowner' });
    await sent(owner, 'saveProfile', { displayName: 'EQ owner', handle: 'eqowner', bio: '', location: '', link: null });
  }
  const http = h.online({ persona: 'eqreader' });
  await sent(http, 'saveProfile', { displayName: 'EQ reader', handle: 'eqreader', bio: '', location: '', link: null });
  const empty = mintId(), small = mintId();
  for (const id of [empty, small]) await sent(owner, 'createGroup', { id, other: 'dev:eqreader', title: 'EQ history', description: '' });
  const before = mintId(); await sent(owner, 'send', { id: before, conversation: small, text: 'retained text', quote: null });
  const png = new Blob([Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aN1cAAAAASUVORK5CYII=', 'base64')], { type: 'image/png' });
  const upload = await owner.upload(png); assert.equal(upload.ok, true);
  const media = mintId(); await sent(owner, 'sendMedia', { id: media, conversation: small, text: 'retained media text', photo: { id: upload.asset.id }, video: null, oncePhoto: null });
  let large;
  if (full) {
    large = idFrom('g0001');
    const roster = await owner.query(q('roster'), { conversation: large });
    const spare = roster.data.find(m => m.role !== 'admin'); assert.ok(spare);
    await sent(owner, 'removeMember', { conversation: large, principal: spare.principal });
    await sent(owner, 'addMember', { conversation: large, principal: 'dev:eqreader' });
  } else {
    large = mintId();
    await sent(owner, 'createGroup', { id: large, other: 'dev:eqreader', title: 'EQ 10000', description: '' });
    const chat = (await owner.query(q('conversationScreen'), { conversation: large })).data;
    await h.seed([{ table: 'conversations', row: { ...chat, lastOrdinal: 10000 } }]);
    for (let start = 0; start < 10000; start += 500) await h.seed(Array.from({ length: 500 }, (_, offset) => {
      const n = start + offset;
      return { table: 'messages', row: { id: idFrom(`eq-${n}`), conversation: large, sender: 'dev:eqowner', ordinal: n + 1, recipients: 1, text: `message ${n}`, at: Math.floor(n / 1000), tombstone: n === 9999 || n === 9501 } };
    }));
  }
  // Independent server oracle, including the first never-acquired page.
  const oracle = [], oracleCursors = []; let cursor = null;
  for (let page = 0; page < 26; page++) {
    oracleCursors.push(cursor);
    const r = await owner.query(q('historyBracket'), { conversation: large, c: cursor });
    assert.equal(r.complete, true); oracle.push(...r.data); cursor = r.next;
  }
  assert.equal(oracle.length, 520); const acquired = oracle.slice(0, 500);
  if (variant === 'timestamp') assert.equal(acquired.at(-1).at, oracle[500].at, 'the floor splits a timestamp tie');
  h.record('oracle', { variant, count: 10000, acquired: acquired.map(r => r.id), floor: acquired.at(-1), below: oracle[500] });
  const devices = [];
  for (const tier of ['process', 'wasm']) {
    const f = await replica(t, h, tier); let client = await f.open();
    f.mode('offline'); await client.sync();
    for (const conversation of [empty, large]) {
      const r = await pair(h, f, client, conversation, { stage: `${tier}:before`, noFallback: true });
      assert.equal(r.read.loading, true); assert.equal(r.raw.unknown, true);
      if (conversation === large) for (const c of oracleCursors.slice(24)) assert.equal((await pair(h, f, client, large, { c: [c, c], stage: `${tier}:before-floor` })).read.loading, true);
    }
    f.mode('staged'); await client.sync(); assert.equal(client.acquired, false);
    f.mode('offline'); await client.sync();
    for (const conversation of [empty, large]) assert.equal((await pair(h, f, client, conversation, { stage: `${tier}:staged` })).read.loading, true);
    await client.close(); client = await f.open();
    assert.equal(client.acquired, false, 'offline reopen cannot publish staged coverage');
    f.mode('catchup'); await client.sync(); assert.equal(client.acquired, false);
    f.mode('offline'); await client.sync();
    for (const conversation of [empty, large]) assert.equal((await pair(h, f, client, conversation, { stage: `${tier}:before-catchup` })).read.loading, true);
    const watches = [empty, large].flatMap(conversation => [null, ...oracleCursors.slice(24)].flatMap(c => ['history', 'historyBracket'].map(name => client.observe(q(name), { conversation, c: conversation === large ? c : null }))));
    const stops = watches.map(w => w.subscribe(() => h.record(`${tier}:publication-watch`, { read: w.getSnapshot() })));
    const held = f.holdPublication(); f.mode('online'); const syncing = client.sync(); await held.ready;
    assert.equal(client.acquired, false);
    for (const watch of watches) assert.equal(watch.getSnapshot().loading, true);
    let saved;
    if (tier === 'wasm') saved = f.holdSave();
    held.release();
    if (saved) {
      await saved.ready; assert.equal(client.acquired, false, 'coverage waits for durable save');
      for (const watch of watches) assert.equal(watch.getSnapshot().loading, true);
      saved.release();
    }
    await syncing; assert.equal(client.acquired, true);
    // Below-floor watches legitimately fetch older rows after publication.
    // Drain those observations before attributing requests to the next query.
    await until(() => watches.every((w, n) => w.getSnapshot().complete === true && w.getSnapshot().data?.length === (n < 6 ? 0 : 20)), 'publication watches settled');
    stops.forEach(stop => stop()); watches.forEach(w => w.close());
    const first = await pair(h, f, client, large, { stage: `${tier}:acquired`, noFallback: true });
    assert.deepEqual(ids(first.read), acquired.slice(0, 20).map(r => r.id));
    const floor = await pair(h, f, client, large, { c: [oracleCursors[24], oracleCursors[24]], stage: `${tier}:published-floor`, noFallback: true });
    assert.deepEqual(ids(floor.read), acquired.slice(480).map(r => r.id)); assert.equal(floor.read.complete, true);
    const below = await pair(h, f, client, large, { c: [oracleCursors[25], oracleCursors[25]], stage: `${tier}:published-below-floor` });
    assert.deepEqual(ids(below.read), oracle.slice(500).map(r => r.id)); assert.equal(below.raw.complete, false);
    assert.equal(below.raw.unknown, true, 'current membership can fall back for an unacquired range');
    const e = await pair(h, f, client, empty, { stage: `${tier}:empty-acquired`, noFallback: true });
    assert.deepEqual(e.read.data, []); assert.equal(e.read.complete, true);
    devices.push({ tier, f, client });
  }
  // Keep each exact ordinary observation mounted while the actual leave
  // reply is held; separately mounted route/decorations cannot select history.
  const mounted = [];
  for (const { tier, f, client } of devices) {
    const watches = ['history', 'historyBracket'].map(name => client.observe(q(name), { conversation: small }, { keep: true }));
    const snapshots = [];
    const stops = watches.map((w, n) => w.subscribe(() => { const read = w.getSnapshot(); snapshots.push({ name: n, read }); h.record(`${tier}:mounted`, { name: n, read }); }));
    await until(() => watches.every(w => w.getSnapshot().data?.length === 2), 'mounted history');
    mounted.push({ watches, stops, snapshots });
  }
  for (const conversation of [empty, small, large]) await sent(owner, 'removeMember', { conversation, principal: 'dev:eqreader' });
  for (let i = 0; i < devices.length; i++) {
    const { tier, f, client } = devices[i], mountedRead = mounted[i];
    const held = f.control.hold(), sync = client.sync(); await held.ready;
    for (const w of mountedRead.watches) assert.deepEqual(ids(w.getSnapshot()), [media, before]);
    held.release(); await sync;
    const r = await pair(h, f, client, small, { stage: `${tier}:left`, retained: true, noFallback: true });
    assert.deepEqual(ids(r.read), [media, before]);
    for (const snapshot of mountedRead.snapshots.filter(s => s.read.data)) assert.deepEqual(ids(snapshot.read), [media, before]);
  }
  const postLeave = mintId(); await sent(owner, 'send', { id: postLeave, conversation: small, text: 'not delivered after departure', quote: null });
  for (const conversation of [empty, small, large]) {
    assert.deepEqual((await http.query(q('history'), { conversation })).data, []);
    assert.equal((await http.query(q('progress'), { conversation })).denied.code, 'NOT_MEMBER');
  }
  assert.ok('denied' in await http.asset(upload.asset.id), 'retained image grants no server media access');
  assert.equal((await http.query(q('heldControl'), { conversation: small })).denied.code, 'E_QUERY_HELD');
  for (let i = 0; i < devices.length; i++) {
    let { tier, f, client } = devices[i];
    for (const online of [true, false]) {
      f.mode(online ? 'online' : 'offline'); await client.sync();
      const from = f.requests.length;
      assert.deepEqual(ids((await pair(h, f, client, small, { stage: `${tier}:left-${online}`, retained: true, noFallback: true })).read), [media, before]);
      const e = await pair(h, f, client, empty, { stage: `${tier}:empty-left-${online}`, retained: true, noFallback: true });
      assert.deepEqual(e.read.data, []); assert.equal(e.read.complete, true);
      let cursors = [null, null]; const seen = [];
      for (let page = 0; page < 26; page++) {
        const r = await pair(h, f, client, large, { c: cursors, stage: `${tier}:left-${online}-page-${page}`, retained: true, noFallback: true });
        assert.deepEqual(ids(r.read), acquired.slice(page * 20, (page + 1) * 20).map(r => r.id));
        if (page <= 24) assert.equal(r.read.complete, true);
        if (page === 25) assert.equal(r.read.complete, false, 'below the floor is unknown, never complete empty');
        seen.push(...r.read.data); cursors = r.cursors;
        if (!cursors[0]) { assert.equal(r.read.complete, false, 'unacquired history has no proof of exhaustion'); break; }
      }
      assert.deepEqual(seen.map(r => r.id), acquired.map(r => r.id)); assert.equal(new Set(seen.map(r => r.id)).size, 500);
      const filtered = await pair(h, f, client, small, { filtered: true, stage: `${tier}:residual-order-${online}`, retained: true, noFallback: true });
      assert.deepEqual(ids(filtered.read), [before, media]);
      const residual = await pair(h, f, client, large, { filtered: true, stage: `${tier}:residual-floor-${online}`, retained: true, noFallback: true });
      assert.deepEqual(ids(residual.read), acquired.toReversed().filter(r => !r.tombstone).slice(0, 20).map(r => r.id)); assert.equal(residual.read.complete, false);
      await client.query(q('heldControl'), { conversation: large }); assert.equal(f.requests.length, from);
    }
    mounted[i].stops.forEach(stop => stop()); mounted[i].watches.forEach(w => w.close());
    const remount = client.observe(q('history'), { conversation: small }); const stop = remount.subscribe(() => {});
    await until(() => ids(remount.getSnapshot())?.join() === [media, before].join(), 'remount retained history'); stop(); remount.close();
    await client.close(); client = await f.open();
    assert.deepEqual(ids((await pair(h, f, client, small, { stage: `${tier}:offline-reopen`, retained: true, noFallback: true })).read), [media, before]);
    const below = await pair(h, f, client, large, { c: [oracleCursors[25], oracleCursors[25]], stage: `${tier}:reopen-below-floor`, retained: true, noFallback: true });
    assert.deepEqual(below.read.data, []); assert.equal(below.read.complete, false);
    devices[i].client = client;
    f.mode('online'); await client.sync();
  }
  for (const conversation of [empty, small, large]) await sent(owner, 'addMember', { conversation, principal: 'dev:eqreader' });
  for (const { tier, f, client } of devices) {
    await client.sync(); const r = await pair(h, f, client, small, { stage: `${tier}:rejoin` });
    assert.deepEqual(ids(r.read), [postLeave, media, before]); assert.equal(r.raw.retained, false);
    f.mode('offline'); await client.sync();
    const r2 = await pair(h, f, client, large, { stage: `${tier}:rejoin-offline`, filtered: true });
    assert.equal(r2.read.complete, false, 'rejoin does not manufacture earlier acquisition');
  }
});
