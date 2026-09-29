import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { devServer, binary } from '../../../witness/lib.mjs';
import { prepareClient } from '../dist/client-start.js';
import { createLocalClient } from '../dist/local.js';
import { mintId } from '../dist/client.js';
import { processDevice } from '../dist/native.js';
import { until } from './helpers/app-server.mjs';
import { nativeHandoffSchedule, restoreHandoffSchedule } from './helpers/identity-handoffs.mjs';

const seed = [
  { table: 'conversations', row: { id: 'c1', title: 'General', creatorId: 'dev:alice' } },
  { table: 'memberships', row: { id: 'm1', conversationId: 'c1', principal: 'dev:alice', role: 'admin', joinedAt: 1 } },
];
const op = { kind: 'mutation', name: 'send' }, args = body => ({ conversationId: 'c1', body });
const ok = r => { assert.ok(!r.denied, JSON.stringify(r)); return r.ok; };
async function owners(t, holdA = false, pauseAtSave = false) {
  const server = await devServer({ seed }), replacement = await devServer({ seed });
  const dir = mkdtempSync(join(tmpdir(), 'ea-handoff-')), clients = [], posts = [];
  const reached = Promise.withResolvers(), release = Promise.withResolvers(), response = Promise.withResolvers(), queue = Promise.withResolvers();
  let paused = false, armed = false, destination = server.api, holdResponse = false;
  const opener = processDevice({ dir, binary: binary() });
  t.after(async () => { release.resolve(); response.resolve(); queue.resolve(); for (const c of clients) await c.close(); await server.close(); await replacement.close(); rmSync(dir, { recursive: true, force: true }); });
  const open = async owner => {
    let raw;
    const options = { url: server.api, persona: 'alice', device: { async open(...params) {
      raw = await opener.open(...params);
      return { ...raw, async call(request, committed) {
        if (armed && holdA && owner === 'A' && request.op === 'queued') await queue.promise;
        if (armed && pauseAtSave && owner === 'A' && request.op === 'compare_identity_admissions' && !paused) { paused = true; reached.resolve(); await release.promise; }
        const reply = await raw.call(request, committed);
        if (armed && !pauseAtSave && owner === 'A' && request.op === 'next_submission' && !paused) { paused = true; reached.resolve(); await release.promise; }
        return reply;
      } };
    } }, fetch: async (url, init) => {
      // No live poll can race a controlled handoff; explicit start/sync owns it.
      if (String(url).includes('/changes')) throw Error('held changes');
      if (owner === 'A' && !String(url).includes('/schema')) throw Error('A cannot identify');
      const r = await fetch(String(url).replace(server.api, destination), init);
      if (String(url).includes('/m/')) { posts.push(JSON.parse(init.body)); if (holdResponse) await response.promise; }
      return r;
    } };
    const p = await prepareClient(options, () => createLocalClient(options)); clients.push(p.client);
    return { ...p, raw };
  };
  const a = await open('A'), b = await open('B');
  armed = true;
  return { a, b, posts, reached: reached.promise, release: release.resolve, response: response.resolve,
    replace() { destination = replacement.api; }, hold() { holdResponse = true; } };
}

for (const replacement of [false, true]) test(`native cached empty cannot bypass ${replacement ? 'captured binding' : 'FIFO'}`, { timeout: 60_000 }, async t => {
  const h = await owners(t, true), id = mintId();
  const first = h.a.client.mutate(op, args('FIRST'), { id, waitSeconds: 0 }); await h.reached;
  if (replacement) h.replace();
  await h.b.start(); // observes identified + empty while A is paused
  h.release(); assert.equal((await first).state, 'pending');
  const result = await h.b.client.mutate(op, args(replacement ? 'FIRST' : 'SECOND'), { ...(replacement ? { id } : {}), waitSeconds: 0 });
  if (replacement) {
    await until(async () => ['failed', 'sent'].includes((await h.b.client.write(id))?.state), 'bound outcome');
    const outcome = await h.b.client.write(id);
    assert.equal(outcome.why?.code, 'E_ADMISSION_STORE', JSON.stringify({ outcome, posts: h.posts }));
    assert.equal(h.posts.length, 0, JSON.stringify(h.posts));
  } else {
    await until(() => h.posts.length >= 1, 'first POST');
    assert.equal(h.posts[0].id, id, 'deferred FIRST must precede SECOND');
    await until(() => h.posts.length === 2, 'both writes sent');
    assert.deepEqual(h.posts.map(p => p.id), [id, result.id]);
  }
});

for (const settled of [false, true]) test(`native late capture cannot expire a peer execution (settled=${settled})`, { timeout: 60_000 }, async t => {
  const h = await owners(t, false, true), id = mintId(), events = [];
  const now = Date.now; let wall = now(); Date.now = () => wall; t.after(() => { Date.now = now; });
  h.a.client.onWrite(w => events.push(w));
  const first = h.a.client.mutate(op, args('ONCE'), { id, waitSeconds: 0 }); await h.reached;
  await h.b.start(); if (!settled) h.hold();
  await h.b.client.mutate(op, args('ONCE'), { id, waitSeconds: 0 });
  await until(() => h.posts.length === 1, 'peer executed');
  if (settled) {
    await until(async () => (await h.b.client.write(id))?.state === 'sent', 'peer receipt');
    await until(async () => ok(await h.b.raw.call({ op: 'queued' })).length === 0, 'peer receipt retired from outbox');
  }
  wall += 30_001; h.release(); await first;
  await h.a.client.pendingWrites();
  assert.ok(events.every(w => w.state === 'sent'), JSON.stringify(events));
  assert.equal((await h.a.client.write(id)).state, settled ? 'sent' : 'pending');
  h.response(); await until(async () => (await h.b.client.write(id))?.state === 'sent', 'peer settled');
  await h.a.client.sync();
  if (settled) {
    await until(() => events.length === 1, 'truthful recovered notification');
    assert.deepEqual(events[0], await h.a.client.write(id));
  }
  assert.equal((await h.a.client.write(id)).state, 'sent');
  assert.ok(events.every(w => w.state === 'sent'), JSON.stringify(events)); assert.equal(h.posts.length, 1);
});

for (const kind of ['freeze', 'binding', 'fifo', 'expiry']) test(`native handoff model: ${kind}`, () => nativeHandoffSchedule(kind, 0));
test('native device checks deferred binding even without the SDK', () => nativeHandoffSchedule('binding', 1));
for (let variant = 0; variant < 3; variant++) test(`native retired receipts preserve exact input (${variant})`, () => nativeHandoffSchedule('receipt-conflict', variant));
test('restore custody stays visible until unsent refusal commits', () => restoreHandoffSchedule(0));
