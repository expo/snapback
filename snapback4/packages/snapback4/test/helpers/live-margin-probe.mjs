import { writeFileSync } from 'node:fs';
import assert from 'node:assert/strict';
import { marginFixture } from './live-margin.mjs';
const cleanup = [], t = { after: fn => cleanup.push(fn) };
try {
  const f = await marginFixture(t, process.env.LM_HOST ?? 'wasm');
  const reactions = f.watch(f.b.client, 'bob', 'reactions');
  const history = f.watch(f.b.client, 'bob', 'history', { c: null });
  const decorations = Array.from({ length: Number(process.env.LM_PRESSURE ?? 0) }, (_, slot) => f.watch(f.b.client, 'bob', 'decoration', { slot }));
  await f.until(() => decorations.every(w => w.getSnapshot().data));
  await f.until(() => reactions.getSnapshot().data && history.getSnapshot().data);
  for (let n = 0; n < Number(process.env.LM_N ?? 3); n++) {
    for (const [name, args, expected] of [['setReaction', { emoji: 'heart' }, 'heart'], ['setReaction', { emoji: 'smile' }, 'smile'], ['clearReaction', {}, undefined]]) {
      f.record('trial', { n, name, args });
      const start = performance.now();
      const receipt = await f.a.client.mutate(f.m(name), args);
      assert.equal(receipt.state, 'sent');
      await f.until(() => 'data' in reactions.getSnapshot() && reactions.getSnapshot().data[0]?.emoji === expected && !reactions.getSnapshot().revalidating);
      console.log(n, name, expected, performance.now() - start);
    }
  }
  const histories = [f.watch(f.a.client, 'alice', 'history', { c: null }), history];
  await f.until(() => histories.every(w => w.getSnapshot().data?.length === 1));
  f.record('offline');
  f.a.state.offline = f.b.state.offline = true;
  await Promise.all([f.a.client.sync(), f.b.client.sync()]);
  await Promise.all([f.a, f.b].map((x, i) => x.client.mutate(f.m('send'), { body: 'offline-' + i }, { waitSeconds: 0 })));
  await f.until(() => histories.every(w => w.getSnapshot().data?.length === 2));
  f.record('reconnect'); f.a.state.offline = f.b.state.offline = false;
  await Promise.all([f.a.client.sync(), f.b.client.sync()]);
  await f.until(() => histories.every(w => w.getSnapshot().data?.length === 3 && !w.getSnapshot().revalidating));
  writeFileSync(process.env.LM_OUT ?? '/tmp/lm-probe.json', JSON.stringify(f.events, null, 2));
} finally { for (const fn of cleanup.reverse()) await fn(); }
