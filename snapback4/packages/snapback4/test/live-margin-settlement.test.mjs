// @ref LLP 3000.023#12 — unknown once authority still bounds settlement revalidation.
import test from 'node:test';
import assert from 'node:assert/strict';
import { writeFileSync } from 'node:fs';
import { marginFixture, marginSource } from './helpers/live-margin.mjs';
import { episodeDeadline } from '../dist/read-episode.js';
import { Pages } from '../dist/react-pages.js';
import { hangBudget } from './helpers/wait.mjs';

for (const host of ['process', 'wasm']) for (const once of [false, true]) {
  test(`${host}: two offline sends settle ${once ? 'with unknown once authority' : 'with certified preservation'}`, { timeout: hangBudget(30) }, async t => {
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
    gate = Promise.withResolvers();
    // Retire any pre-settlement attempt normally. Hold the actual replacement
    // once its evidence is attached, rather than accidentally holding a stale
    // attempt until the independent 30-second watchdog.
    for (const [i, x] of [f.a, f.b].entries()) x.state.queryHold = () =>
      (!once || episodeDeadline(histories[i].getSnapshot()) !== undefined) ? gate.promise : undefined;
    f.record('reconnect'); f.a.state.offline = f.b.state.offline = false;
    await Promise.all([f.a.client.sync(), f.b.client.sync()]);
    await f.until(() => histories.every(w => w.getSnapshot().revalidating && f.owner(w)?.running), 'settlement replacement held in both devices');
    if (once) await f.until(() => histories.every(w => episodeDeadline(w.getSnapshot()) !== undefined), 'unknown evidence has an episode');
    // Semantic clock advancement makes this deterministic. No host scheduling
    // speed or changed hang guard is used as the withdrawal oracle.
    const now = Date.now(); t.mock.method(Date, 'now', () => now + 1500);
    const during = histories.map(w => w.getSnapshot());
    if (once) {
      assert.ok(during.every(read => read.loading === true), 'unknown once evidence still withdraws after the existing budget');
      assert.ok(pages.every(page => page.getSnapshot().items.length === 0), 'the usePage accumulator drops the first page on source withdrawal');
    } else {
      assert.ok(during.every(read => read.data?.length === 2 && read.revalidating), 'certified insertion retains the previous complete answer');
      assert.ok(pages.every(page => page.getSnapshot().items.length === 2));
    }
    t.mock.restoreAll(); f.a.state.queryHold = f.b.state.queryHold = undefined; gate.resolve();
    await f.until(() => histories.every(w => w.getSnapshot().data?.length === 3 && !w.getSnapshot().revalidating), 'late replacement renders both messages');
    for (const w of histories) assert.equal(new Set(w.getSnapshot().data.map(row => row.id)).size, 3);
    if (process.env.LM_SETTLEMENT_OUT) writeFileSync(`${process.env.LM_SETTLEMENT_OUT}-${host}-${once}.json`, JSON.stringify({ once, during, events: f.events }));
  });
}
