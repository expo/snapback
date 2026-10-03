// @ref LLP 3000.023#12 — retain certified rows, never unproven once cells.
import test from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { fixture, source, opener, open, q, m, until, parked } from './helpers/answers-stay.mjs';
import { Pages } from '../dist/react-pages.js';
import { ReadApprovals } from '../dist/read-approval.js';
import { episodeDeadline } from '../dist/read-episode.js';
import { createClient } from '../dist/client.js';
import { readyRead, pendingRead } from '../dist/read-existence.js';
import { withOnce } from '../dist/read-once.js';
import { ReadObservation } from '../dist/read-observation.js';

test('masking an empty partial page preserves the unblocked fact through reentrant reads', t => {
  const read = withOnce(readyRead({ data: [], complete: false, cut: null, next: null, fresh: false }, false),
    { table: 'messages', columns: ['photo'], many: true }, true);
  assert.equal(pendingRead(read), false);
  const owner = new ReadObservation(); t.after(() => owner.retire());
  owner.pending = () => false; owner.publish(read);
  let notifications = 0;
  owner.followers.add(() => () => { notifications++; owner.read(null); });
  const snapshot = owner.read(null);
  for (let n = 0; n < 10; n++) assert.equal(owner.read(null), snapshot);
  assert.equal(notifications, 0);
});

const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=', 'base64');
const program = source.replace('table messages:\n', 'table messages:\n  photo: image <=10000 once ?\n  photos: [image <=10000 once] <=4 ?\n') + `
mutation place(photo: image <=10000):
  update messages['item'] { photo }
mutation clearPhoto():
  update messages['item'] { photo: null }
query derived():
  row = messages['item']
  return row.body if row.photo != null else null
`;

for (const host of ['online', 'process', 'wasm']) for (const change of ['edit', 'revoked', 'viewed', 'erase', 'denied', 'sign-out']) {
  test(`${host}: once history masks immediately through ${change}`, async t => {
    const cleanup = [], local = { after: fn => cleanup.push(fn) }, gate = Promise.withResolvers();
    t.after(async () => { gate.resolve(); t.mock.restoreAll(); for (const f of cleanup.reverse()) await f(); });
    const f = await fixture(local, program);
    const upload = await fetch(f.url + '/assets', { method: 'POST', headers: { 'x-snapback-persona': 'alice' }, body: png }).then(r => r.json());
    assert.ok(upload.asset?.id);
    assert.equal((await f.post('/m/place', { id: 'place', args: { photo: { id: upload.asset.id } } })).state, 'sent');
    let hold = false, held = 0;
    const device = host === 'online' ? undefined : opener(host, join(f.dir, host));
    const client = await open(local, f, host, {
      ...(device ? { device: { async open(...args) {
        const core = await device.open(...args);
        return { ...core, async call(request, committed) {
          const reply = await core.call(request, committed);
          if (request.op === 'query' && request.name === 'history') {
            assert.ok(reply.ok.data?.every(row => row.photo === null && row.photos === null), 'device never restores a private ledger value');
            if (hold) { held++; await gate.promise; }
          }
          return reply;
        } };
      } } } : {}),
      fetch: async (input, init) => {
        const path = new URL(input).pathname;
        if (path === '/changes' || path === '/probe') return parked(init.signal);
        const response = await fetch(input, init);
        if (path === '/q/history') {
          const json = await response.json();
          if (hold) { held++; await Promise.race([gate.promise, parked(init.signal)]); }
          return Response.json(json, { status: response.status });
        }
        return response;
      },
    });
    const watch = client.observe(q('history'), { c: null });
    const pages = new Pages(client, q('history'), {}), stop = pages.subscribe(() => {}); cleanup.push(stop);
    await until(() => watch.getSnapshot().data?.[0].photo?.id === upload.asset.id && pages.getSnapshot().items[0]?.photo?.id === upload.asset.id);
    const approvals = new ReadApprovals(), approved = approvals.approve(watch.getSnapshot()); cleanup.push(() => approvals.close());
    if (change === 'viewed') {
      const first = await client.asset(upload.asset.id); assert.ok(first.url); first.revoke();
      assert.equal((await client.asset(upload.asset.id)).denied?.code, 'E_ASSET_VIEWED', 'second view remains refused');
    }
    hold = true;
    const started = Date.now(); let now = started; t.mock.method(Date, 'now', () => now);
    const mutation = change === 'revoked' ? 'clearPhoto' : change === 'erase' ? 'erase' : change === 'denied' ? 'remove' : 'edit';
    await client.mutate(m(mutation), mutation === 'edit' ? { body: 'edited' } : {}, { waitSeconds: 0 });
    if (client.sync) await client.sync();
    await until(() => held > 0 && (watch.getSnapshot().revalidating || !('data' in watch.getSnapshot())));
    if (['erase', 'denied'].includes(change)) {
      now += 1001;
      assert.ok(!('data' in watch.getSnapshot()), 'real removal/denial still withdraws');
      assert.equal(pages.getSnapshot().items.length, 0);
    } else {
      const masked = watch.getSnapshot();
      assert.equal(masked.data?.[0].photo, null, 'mask before the old one-second boundary');
      assert.equal(masked.data?.[0].photos, null, 'mask the entire nullable/list cell');
      assert.equal(approved.read().data?.[0].photo, null, 'facade-held copy masks too');
      assert.equal(pages.getSnapshot().items[0]?.photo, null, 'usePage never replays the old handle');
      now += 5000;
      assert.equal(watch.getSnapshot().data?.[0].id, 'item', 'row survives a slow replacement');
      assert.equal(episodeDeadline(watch.getSnapshot()), undefined);
      assert.equal(pages.getSnapshot().items.length, 1);
    }
    if (change === 'sign-out') {
      const signingOut = client.signOut();
      assert.ok(!('data' in watch.getSnapshot())); assert.equal(pages.getSnapshot().items.length, 0);
      assert.ok(!('data' in approved.read()));
      hold = false; gate.resolve(); await signingOut;
    }
    t.mock.restoreAll(); hold = false; gate.resolve();
    if (change === 'sign-out') return;
    if (change === 'denied') { await until(() => !watch.getSnapshot().data?.length); return; }
    if (change === 'erase') { await until(() => watch.getSnapshot().data?.length === 0); return; }
    await until(() => watch.getSnapshot().data?.length === 1 && !watch.getSnapshot().revalidating);
    if (change === 'edit') await until(() => watch.getSnapshot().data?.[0].photo?.id === upload.asset.id, 'live once authority is restored');
    assert.equal(watch.getSnapshot().data[0].photo?.id ?? null, change === 'edit' ? upload.asset.id : null);
    if (change === 'revoked') assert.equal((await client.asset(upload.asset.id)).denied?.code, 'E_ASSET_UNKNOWN');
  });
}

for (const host of ['online', 'process', 'wasm']) test(`${host}: a derived once predicate still withdraws the whole answer`, async t => {
  const cleanup = [], local = { after: fn => cleanup.push(fn) }, gate = Promise.withResolvers();
  t.after(async () => { gate.resolve(); t.mock.restoreAll(); for (const f of cleanup.reverse()) await f(); });
  const f = await fixture(local, program);
  const upload = await fetch(f.url + '/assets', { method: 'POST', headers: { 'x-snapback-persona': 'alice' }, body: png }).then(r => r.json());
  await f.post('/m/place', { id: 'place', args: { photo: { id: upload.asset.id } } });
  let hold = false, held = 0;
  const device = host === 'online' ? undefined : opener(host, join(f.dir, host));
  const client = await open(local, f, host, {
    ...(device ? { device: { async open(...args) {
      const core = await device.open(...args);
      return { ...core, async call(request, committed) {
        const reply = await core.call(request, committed);
        if (request.op === 'query' && hold) { held++; await gate.promise; }
        return reply;
      } };
    } } } : {}),
    fetch: async (input, init) => {
      const path = new URL(input).pathname;
      if (path === '/changes' || path === '/probe') return parked(init.signal);
      const response = await fetch(input, init);
      if (path.startsWith('/q/') && hold) { held++; await Promise.race([gate.promise, parked(init.signal)]); }
      return response;
    },
  });
  const watch = client.observe(q('derived'), {});
  await until(() => watch.getSnapshot().data === 'image-1');
  let now = Date.now(); t.mock.method(Date, 'now', () => now); hold = true;
  await client.mutate(m('edit'), { body: 'edited' }, { waitSeconds: 0 });
  if (client.sync) await client.sync();
  await until(() => held > 0 && episodeDeadline(watch.getSnapshot()) !== undefined);
  now += 1001;
  assert.equal(watch.getSnapshot().loading, true, 'a value-derived existence decision has no cell mask proof');
});

test('a malformed point proof on a page cannot accept the conditional certificate', async t => {
  let now = 1000, reads = 0; t.mock.method(Date, 'now', () => now);
  const gate = Promise.withResolvers();
  const client = createClient({ url: 'http://once.test', persona: 'bob', fetch: async (input, init) => {
    const path = new URL(input).pathname;
    if (path === '/probe' || path === '/changes') return parked(init.signal);
    if (path === '/m/edit') return Response.json({ id: JSON.parse(init.body).id, state: 'sent', seq: 2, generation: 1, preserved: ['~once:messages'] });
    if (++reads > 1) await Promise.race([gate.promise, parked(init.signal)]);
    return Response.json({ data: [{ id: 'row', photo: { id: 'must-not-be-retained' } }], complete: true, seq: 1, generation: 1,
      tables: ['messages'], scopes: { messages: [{}] }, once: { table: 'messages', columns: ['photo'], many: false } });
  } });
  t.after(async () => { gate.resolve(); await client.close(); });
  const watch = client.observe(q('history'), {});
  await until(() => watch.getSnapshot().data);
  await client.mutate(m('edit'), {}); await until(() => reads > 1);
  now += 1001; assert.equal(watch.getSnapshot().loading, true);
});
