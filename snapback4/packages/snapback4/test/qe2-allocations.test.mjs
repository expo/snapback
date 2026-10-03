import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { server, root } from './helpers/read-through-server.mjs';
import { hangBudget } from './helpers/wait.mjs';
for (const tier of ['wasm', 'process']) for (const [fixture, size] of [['empty-owned-default', 0], ['discarded-insert', 3_000_000], ['discarded-if-absent', 4_000_000]]) {
  test(`${tier}: ${fixture} stays within its heap ceiling`, {timeout: hangBudget(30)}, async t => {
    const source = readFileSync(join(root, `crates/snapback4-lang/tests/fixtures/qe2/${fixture}.q`), 'utf8');
    const host = await server(t, tier, source);
    await host.open(); host.pauseSync();
    const reply = await host.core.call({op: 'predict', name: size ? 'seed' : 'add', viewer: 'dev:bob', args: size ? {payload: 'x'.repeat(size)} : {}, now: 100, newIds: []});
    assert.equal(reply.denied, undefined, JSON.stringify(reply));
    assert.equal(reply.ok?.denied, undefined, JSON.stringify(reply));
    assert.equal(reply.ok.result, size ? true : 'r');
  });
}
