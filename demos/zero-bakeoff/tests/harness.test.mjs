import assert from 'node:assert/strict';
import test from 'node:test';
import {createArmSuite} from '../shared/harness.mjs';

test('arm harness makes short passes impossible and retains GAPs', async () => {
  const manifest = {expectedChecks: 2, checks: ['one', 'two']};
  const suite = createArmSuite({app: 'fixture', provider: 'fixture', manifest});
  await suite.pass('one', async () => true);
  await suite.gap('two', 'deliberately unsupported');
  const receipt = await suite.finish();
  assert.equal(receipt.ok, true);
  assert.deepEqual(receipt.counts, {pass: 1, gap: 1, fail: 0});
  assert.deepEqual(receipt.missing, []);
});

test('arm harness fails a short run', async () => {
  const manifest = {expectedChecks: 2, checks: ['one', 'two']};
  const suite = createArmSuite({app: 'fixture', provider: 'fixture', manifest});
  await suite.pass('one', async () => true);
  const receipt = await suite.finish();
  assert.equal(receipt.ok, false);
  assert.deepEqual(receipt.missing, ['two']);
});
