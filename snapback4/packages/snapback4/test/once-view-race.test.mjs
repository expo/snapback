// @ref LLP 3000.023#12 — a completed view fences snapshots and in-flight answers.
import test from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { fixture, source, open, opener, q, until, parked } from './helpers/answers-stay.mjs';
import { Pages } from '../dist/react-pages.js';
import { ReadApprovals } from '../dist/read-approval.js';
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=', 'base64');
const program = source.replace('table messages:\n', 'table messages:\n  photo: image <=10000 once ?\n') + `
mutation place(photo: image <=10000):
  update messages['item'] { photo }
query derivedHandle():
  row = messages['item']
  return row.photo
query fact():
  row = messages['item']
  return row.photo.width if row.photo != null else null
`;
for (const host of ['online', 'process', 'wasm']) for (const outcome of ['success', 'E_ASSET_VIEWED']) test(`${host}: ${outcome} fences held replies, live pages and facade approvals`, async t => {
  const cleanup = [], scope = { after: fn => cleanup.push(fn) }, gate = Promise.withResolvers();
  t.after(async () => { gate.resolve(); for (const fn of cleanup.reverse()) await fn(); });
  const f = await fixture(scope, program);
  const upload = await fetch(f.url + '/assets', { method: 'POST', headers: { 'x-snapback-persona': 'alice' }, body: png }).then(r => r.json());
  assert.equal((await f.post('/m/place', { id: 'place', args: { photo: { id: upload.asset.id } } })).state, 'sent');
  let hold = false, held = 0;
  const device = host === 'online' ? undefined : opener(host, join(f.dir, 'race'));
  const c = await open(scope, f, host, {
    // The base has no once-server routing. Force a real fallback on every
    // revision so the held HTTP answer crosses the same device publication door.
    ...(device ? { device: { async open(...args) {
      const core = await device.open(...args);
      return { ...core, async call(request, committed) {
        const reply = await core.call(request, committed);
        return request.op === 'query' ? { ...reply, ok: { ...reply.ok, loading: true, unknown: true } } : reply;
      } };
    } } } : {}),
    fetch: async (input, init) => {
      const path = new URL(input).pathname;
      if (path === '/changes' || path === '/probe') return parked(init.signal);
      const response = await fetch(input, init);
      if (path.startsWith('/q/') && hold) {
        const json = await response.json(); held++;
        await Promise.race([gate.promise, parked(init.signal)]);
        return Response.json(json, { status: response.status });
      }
      return response;
    },
  });
  const watch = c.observe(q('history'), { c: null });
  const facts = c.observe(q('fact'), {});
  const pages = new Pages(c, q('history'), {}); cleanup.push(pages.subscribe(() => {}));
  await until(() => watch.getSnapshot().data?.[0].photo?.id === upload.asset.id && pages.getSnapshot().items[0]?.photo?.id === upload.asset.id && facts.getSnapshot().data === 1);
  const approvals = new ReadApprovals(), approved = approvals.approve(watch.getSnapshot()); cleanup.push(() => approvals.close());
  hold = true;
  const pending = ['history', 'derivedHandle', 'fact'].map(name => c.query(q(name), name === 'history' ? { c: null } : {}));
  await until(() => held === 3);
  if (outcome === 'success') {
    const first = await c.asset(upload.asset.id); assert.ok(first.url); first.revoke();
  } else {
    const first = await fetch(f.url + '/assets/' + upload.asset.id, { headers: { 'x-snapback-persona': 'bob' } });
    assert.equal(first.status, 200); await first.arrayBuffer();
    assert.equal((await c.asset(upload.asset.id)).denied?.code, 'E_ASSET_VIEWED');
  }
  assert.equal(watch.getSnapshot().data?.[0].photo, null, 'view alone masks the existing watch');
  assert.equal(pages.getSnapshot().items[0].photo, null, 'view alone masks pages');
  assert.equal(approved.read().data[0].photo, null, 'view alone masks facade approvals');
  assert.equal(facts.getSnapshot().loading, true, 'derived facts lose their proof with the view');
  hold = false; gate.resolve();
  const [rows, handle, fact] = await Promise.all(pending);
  assert.equal(rows.data?.[0].photo, null, 'held row response republished a consumed handle');
  for (const read of [handle, fact]) assert.ok(read.loading || read.data === null, 'held derived response republished handle facts');
});
