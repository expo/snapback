// @ref LLP 3000.023#12 — once authority masks cells without withdrawing certified rows.
import test from 'node:test';
import assert from 'node:assert/strict';
import { writeFileSync } from 'node:fs';
import { marginFixture, marginSource } from './helpers/live-margin.mjs';
import { episodeDeadline } from '../dist/read-episode.js';
import { Pages } from '../dist/react-pages.js';
import { hangBudget } from './helpers/wait.mjs';

const rows = items => items.map(({ id, body }) => [id, body]).sort(([a], [b]) => a.localeCompare(b));

for (const host of ['process', 'wasm']) for (const once of [false, true]) {
  test(`${host}: two offline sends settle ${once ? 'with masked once authority' : 'with certified preservation'}`, { timeout: hangBudget(30) }, async t => {
    const cleanup = [], local = { after: fn => cleanup.push(fn) };
    let gate;
    t.after(async () => { gate?.resolve(); t.mock.restoreAll(); for (const fn of cleanup.reverse()) await fn(); });
    const source = once ? marginSource.replace('table messages:\n', 'table messages:\n  photo: image <=1000000 once ?\n') : marginSource;
    const f = await marginFixture(local, host, source);
    const histories = [f.watch(f.a.client, 'alice', 'history', { c: null }), f.watch(f.b.client, 'bob', 'history', { c: null })];
    const pages = [f.a, f.b].map(x => new Pages(x.client, f.q('history'), {}));
    const stops = pages.map(page => page.subscribe(() => {})); cleanup.push(() => stops.forEach(stop => stop()));
    await f.until(() => histories.every(w => w.getSnapshot().data?.length === 1));
    f.a.state.offline = f.b.state.offline = true;
    await Promise.all([f.a.client.sync(), f.b.client.sync()]);
    await Promise.all([f.a, f.b].map((x, i) => x.client.mutate(f.m('send'), { body: 'offline-' + i }, { waitSeconds: 0 })));
    await f.until(() => histories.every(w => w.getSnapshot().data?.length === 2 && !w.getSnapshot().revalidating));
    const retained = histories.map(w => rows(w.getSnapshot().data));
    const expected = rows([{ id: 'item', body: 'image-1' }, ...histories.map((w, i) =>
      w.getSnapshot().data.find(row => row.body === 'offline-' + i))]);
    gate = Promise.withResolvers();
    // Retire any pre-settlement attempt normally. Hold the actual replacement
    // once its evidence is attached, rather than accidentally holding a stale
    // attempt until the independent 30-second watchdog.
    for (const x of [f.a, f.b]) x.state.queryHold = () => gate.promise;
    // Freeze before any settlement evidence can start the episode. The oracle
    // uses the specified 1000 ms, independently of the implementation's budget.
    const started = Date.now(); let now = started;
    t.mock.method(Date, 'now', () => now);
    f.record('reconnect'); f.a.state.offline = f.b.state.offline = false;
    await Promise.all([f.a.client.sync(), f.b.client.sync()]);
    await f.until(() => histories.every(w => w.getSnapshot().revalidating && f.owner(w)?.running), 'settlement replacement held in both devices');
    for (const w of histories) assert.equal(episodeDeadline(w.getSnapshot()), undefined);
    now = started + 999;
    for (const [i, w] of histories.entries()) {
      assert.deepEqual(rows(w.getSnapshot().data), retained[i], 'history remains visible for the full episode');
      assert.equal(w.getSnapshot().revalidating, true);
      assert.deepEqual(rows(pages[i].getSnapshot().items), retained[i], 'Pages retains rows before the deadline');
    }
    now = started + 1000;
    const during = histories.map(w => w.getSnapshot());
    assert.ok(during.every(read => read.data?.length === 2 && read.revalidating), 'certified rows survive beyond the old withdrawal deadline');
    assert.ok(pages.every(page => page.getSnapshot().items.length === 2));
    if (once) assert.ok(during.every(read => read.data.every(row => row.photo === null)), 'unproven once cells are masked');
    t.mock.restoreAll(); f.a.state.queryHold = f.b.state.queryHold = undefined; gate.resolve();
    await f.until(() => histories.every(w => w.getSnapshot().data?.length === 3 && !w.getSnapshot().revalidating), 'late replacement renders both messages');
    for (const [i, w] of histories.entries()) {
      assert.deepEqual(rows(w.getSnapshot().data), expected, 'history contains the original and both sends exactly once');
      assert.deepEqual(rows(pages[i].getSnapshot().items), expected, 'Pages contains the original and both sends exactly once');
    }
    if (process.env.LM_SETTLEMENT_OUT) writeFileSync(`${process.env.LM_SETTLEMENT_OUT}-${host}-${once}.json`, JSON.stringify({ once, during, events: f.events }));
  });
}
