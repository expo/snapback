// @ref LLP 3000.023#10 — every invalidated live answer needs replacement work, even without a change cut.
import test from 'node:test';
import assert from 'node:assert/strict';
import { setTimeout as delay } from 'node:timers/promises';
import { join } from 'node:path';
import { fixture, source, open, opener, q, until, parked, sdk } from './helpers/answers-stay.mjs';
const { inspect } = await import(new URL('inspection.js', sdk));

for (const tier of ['wasm', 'process']) for (const keep of [undefined, false, true]) {
  for (const footprint of ['empty', 'unknown', 'unrelated']) {
    test(`${tier}: no-op ${footprint} sync replaces out-of-horizon answer with keep=${keep}`, async t => {
      const f = await fixture(t, source.replace('online only', 'sync public last 1 by .id'));
      assert.equal((await f.post('/seed', [{ table: 'profiles', row: { id: 'zz', name: 'Zed' } }])).seeded, 1);
      const base = opener(tier, join(f.dir, 'device'));
      let queries = 0, measuring = false;
      const applies = [];
      const client = await open(t, f, tier, {
        fetch(input, init) {
          const path = new URL(input).pathname;
          if (path === '/changes') return parked(init.signal);
          if (path.startsWith('/q/')) queries++;
          return fetch(input, init);
        },
        device: { async open(...args) {
          const core = await base.open(...args);
          return { ...core, async call(req, commit) {
            const record = measuring && req.op === 'apply';
            const reported = result => record && result.ok ? { ...result, ok: { ...result.ok,
              touched: footprint === 'unknown' ? undefined : footprint === 'unrelated' ? ['messages'] : result.ok.touched,
            } } : result;
            const result = await core.call(req, value => commit?.(reported(value)));
            if (record) applies.push({ events: req.page.events.length, watermark: req.page.watermark,
              captured: req.page.captured_watermark, touched: result.ok?.touched });
            return reported(result);
          } };
        } },
      });
      const watch = client.observe(q('profile'), {}, keep === undefined ? {} : { keep });
      const snapshots = [];
      watch.subscribe(() => snapshots.push(watch.getSnapshot()));
      t.after(() => watch.close());
      const settled = () => watch.getSnapshot().data?.name === 'Bob' && !watch.getSnapshot().revalidating;
      await until(settled, 'authorized profile outside the horizon');
      await until(() => inspect(client).totals.inFlight === 0, 'initial read finishes');
      assert.equal(queries, 1, 'the initial answer requires exactly one server fallback');
      measuring = true;
      for (let round = 0; round < 2; round++) {
        const before = queries;
        await client.sync();
        // Beyond the withdrawal bound: a retained old answer cannot disguise missing work.
        await delay(1500);
        await until(() => queries > before, "invalidated owner dispatches replacement");
        const pressure = inspect(client);
        t.diagnostic(JSON.stringify({ tier, keep, footprint, round, before, queries, read: watch.getSnapshot(), pressure }));
        assert.ok(queries > before, 'every invalidated owner dispatches replacement work');
        await until(settled, 'replacement settles without remount or notification');
        await until(() => inspect(client).totals.inFlight === 0 && inspect(client).totals.queued === 0, 'replacement drains');
        assert.equal(watch.getSnapshot().fresh, true);
      }
      assert.ok(applies.length >= 2);
      assert.ok(applies.every(page => page.events === 0 && page.watermark === page.captured && page.touched?.length === 0),
        'real publications have no events, watermark advance or touched tables');
      assert.ok(snapshots.every(read => !('data' in read) || read.data?.name === 'Bob'));
    });
  }
}
