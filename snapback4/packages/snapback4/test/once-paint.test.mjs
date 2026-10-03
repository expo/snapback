// @ref LLP 3000.023#12 — all watches mask before the first synchronous observer.
import test from 'node:test';
import assert from 'node:assert/strict';
import { fixture, source, open, q, m, until, parked } from './helpers/answers-stay.mjs';
import { screen } from './helpers/once-screen.mjs';
import { Pages } from '../dist/react-pages.js';
const program = source.replace('table messages:\n', 'table messages:\n  photo: image <=10000 once ?\n') + `
mutation place(photo: image <=10000):
  update messages['item'] { photo }
query second(c: cursor?):
  return messages['room'] first 100 by byRoom after c
`;
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=', 'base64');
for (const host of ['online', 'process', 'wasm']) for (const event of ['mutation', 'changes']) test(`${host}: ${event} masks both pages before any synchronous paint`, async t => {
  const cleanup = [], scope = { after: fn => cleanup.push(fn) }, queries = Promise.withResolvers(), changes = Promise.withResolvers();
  t.after(async () => { queries.resolve(); changes.resolve(); for (const fn of cleanup.reverse()) await fn(); });
  const f = await fixture(scope, program);
  const asset = (await fetch(f.url + '/assets', { method: 'POST', headers: { 'x-snapback-persona': 'alice' }, body: png }).then(r => r.json())).asset;
  await f.post('/m/place', { id: 'place', args: { photo: { id: asset.id } } });
  let hold = false;
  const c = await open(scope, f, host, { fetch: async (input, init) => {
    const path = new URL(input).pathname;
    if (path === '/probe') return parked(init.signal);
    if (path === '/changes') { await Promise.race([changes.promise, parked(init.signal)]); }
    if (path.startsWith('/q/') && hold) await Promise.race([queries.promise, parked(init.signal)]);
    return fetch(input, init);
  } });
  const a = c.observe(q('history'), { c: null }), b = c.observe(q('second'), { c: null });
  const pages = [new Pages(c, q('history'), {}), new Pages(c, q('second'), {})];
  for (const p of pages) cleanup.push(p.subscribe(() => {}));
  await until(() => [a, b].every(w => w.getSnapshot().data?.[0].photo?.id === asset.id) && pages.every(p => p.getSnapshot().items[0]?.photo?.id === asset.id));
  const paints = [];
  cleanup.push(a.subscribe(() => {
    if (hold && a.getSnapshot().revalidating) paints.push({ other: b.getSnapshot().data?.[0].photo, pages: pages.map(p => p.getSnapshot().items[0]?.photo) });
  }));
  hold = true;
  if (event === 'mutation') await c.mutate(m('edit'), { body: 'edited' });
  else { await f.post('/m/edit', { id: 'edit', args: { body: 'edited' } }); changes.resolve(); }
  if (c.sync) await c.sync();
  await until(() => paints.length);
  await (await screen(t))(paints);
  for (const paint of paints) {
    assert.equal(paint.other, null, 'another watch still exposed its old handle during the first callback');
    assert.ok(paint.pages.every(photo => photo == null), 'page merger republished an old image');
  }
});
