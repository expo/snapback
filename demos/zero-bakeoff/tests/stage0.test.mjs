import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import test from 'node:test';
import {resolve} from 'node:path';

const root = resolve(import.meta.dirname, '..');

test('LLP 0155 Stage 0 freezes identities, six manifests, and immutable LLP 0138 receipts', () => {
  const output = execFileSync(process.execPath, ['stage0/verify-stage0.mjs'], {
    cwd: root,
    encoding: 'utf8',
  });
  const receipt = JSON.parse(output);
  assert.equal(receipt.ok, true);
  assert.equal(receipt.manifests, 6);
  assert.equal(receipt.immutableReceipts, 15);
  assert.equal(receipt.clientBundleFiles, 38);
  assert.equal(receipt.freezeSourceCommit, '3c79fe69e19a60a3096e2aa858e843a692cbd191');
});
