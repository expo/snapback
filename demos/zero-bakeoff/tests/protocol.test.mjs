import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import test from 'node:test';
import {resolve} from 'node:path';

const root = resolve(import.meta.dirname, '..');

test('frozen protocol is complete and non-vacuous', () => {
  const output = execFileSync(process.execPath, ['scripts/verify-protocol.mjs'], {
    cwd: root,
    encoding: 'utf8'
  });
  const receipt = JSON.parse(output);
  assert.equal(receipt.ok, true);
  assert.equal(receipt.applications, 6);
  assert.equal(receipt.acceptanceManifests, 6);
  assert.equal(receipt.checks, 51);
  assert.deepEqual(receipt.providers, ['snapback', 'zero', 'replicache']);
});

