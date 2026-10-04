import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { server, root } from './helpers/read-through-server.mjs';
import { hangBudget } from './helpers/wait.mjs';
const ceiling = 16_777_216;
const cases = [
  ['empty-owned-default', 0, 1_621, 'add', 'r'],
  ['bound-insert', 2_400_000, 14_401_017, 'add', null],
  ['discarded-insert', 3_000_000, 12_000_421, 'seed', true],
  ['discarded-if-absent', 4_000_000, 16_000_421, 'seed', true],
];
for (const tier of ['wasm', 'process']) for (const [fixture, size, heap, name, result] of cases) {
  test(`${tier}: ${fixture} costs exactly ${heap} heap bytes`, {timeout: hangBudget(60)}, async t => {
    const source = readFileSync(join(root, `crates/snapback4-lang/tests/fixtures/qe2/${fixture}.q`), 'utf8');
    // The unused argument adds exactly its byte length at runner entry. Both
    // sides of the production ceiling pin the private meter without a test API.
    const mutation = source.slice(source.indexOf('mutation ')).replace(
      `mutation ${name}(`, 'mutation metered(probe: text <=16777216, ').replace(', ):', '):');
    const host = await server(t, tier, `${source}\n${mutation}`);
    await host.open(); host.pauseSync();
    const args = size ? {payload: 'x'.repeat(size)} : {};
    const predict = (name, args) => host.core.call({op: 'predict', name, viewer: 'alice', args, now: 100, newIds: []});
    const success = async reply => {
      assert.equal(reply.denied, undefined, JSON.stringify(reply));
      assert.equal(reply.ok?.denied, undefined, JSON.stringify(reply));
      assert.equal(reply.ok.result, result);
      const withdrawn = await host.core.call({op: 'withdraw', predicted: reply.ok.predicted});
      assert.equal(withdrawn.denied, undefined, JSON.stringify(withdrawn));
    };
    await success(await predict(name, args));
    await success(await predict('metered', {...args, probe: 'x'.repeat(ceiling - heap)}));
    const denied = await predict('metered', {...args, probe: 'x'.repeat(ceiling - heap + 1)});
    const refusal = denied.denied ?? denied.ok?.denied;
    assert.equal(refusal?.code, 'E_BOUND', JSON.stringify(denied));
    assert.match(refusal.message, /heap bytes reached the ceiling 16777216/);
  });
}
