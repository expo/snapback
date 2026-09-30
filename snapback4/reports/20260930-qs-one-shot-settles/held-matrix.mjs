import test from 'node:test';
import assert from 'node:assert/strict';
import { setup, q } from '../../packages/snapback4/test/helpers/one-shot.mjs';
for (const tier of ['online', 'wasm', 'process', 'app-online', 'app-wasm', 'app-process']) {
  test(`${tier}: held online-only view, both link states recorded`, async t => {
    const f = await setup(t, tier);
    const up = await f.client.query(q('heldInsights'), {});
    await f.offline();
    const down = await f.client.query(q('heldInsights'), {});
    t.diagnostic(JSON.stringify({ up, down }));
    if (tier.endsWith('online')) assert.equal(up.denied?.code, 'E_QUERY_HELD');
    else assert.equal(up.denied?.code, 'E_QUERY_RETRY');
    assert.equal(down.denied?.code, 'E_OFFLINE');
  });
}
