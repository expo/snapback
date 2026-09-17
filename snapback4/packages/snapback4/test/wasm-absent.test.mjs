import { test } from 'node:test';
import assert from 'node:assert/strict';
import { checkAbsent } from '../../../scripts/attribute-wasm.mjs';

const row = name => ({ name, shallow_size: 1 });
test('web absence guard accepts required device accounting and reports each forbidden retaining path', () => {
  checkAbsent([row('snapback4_core::partition::account_row_change'), row('snapback4_core::engine::local::predict')], () => { throw new Error('unexpected path lookup'); });
  for (const name of ['snapback4_core[0123456789abcdef]::engine::pages::prefetch::walk', '<alloc::vec::Vec<snapback4_core::engine::admission::Origin>>::drop', 'snapback4_core::partition::row_changed', 'snapback4_core::partition::log_events::put']) {
    let lookedUp;
    assert.throws(() => checkAbsent([row(name)], symbol => { lookedUp = symbol; return 'WebDevice::call -> Runner::run -> retained'; }), error => error.message.includes(name) && error.message.includes('WebDevice::call -> Runner::run -> retained'));
    assert.equal(lookedUp, name);
  }
});

test('web absence guard refuses an empty census or a retaining-path failure', () => {
  assert.throws(() => checkAbsent([], () => ''), /empty/);
  assert.throws(() => checkAbsent([row('snapback4_core::partition::row_changed')], () => { throw new Error('twiggy failed'); }), /twiggy failed/);
  assert.throws(() => checkAbsent([row('snapback4_core::partition::row_changed')], () => ''), /retaining path/);
});
