import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import {
  parseArguments,
  validateRuntimeReceiptShape,
  waitForReadyFile,
} from './published-closure-boot-smoke.mjs';

test('argument parsing accepts exact versions and optional controls', () => {
  const parsed = parseArguments([
    '--version', '1.2.3',
    '--registry', 'https://registry.example.test/',
    '--out', 'receipt.json',
    '--keep',
  ]);
  assert.equal(parsed.version, '1.2.3');
  assert.equal(parsed.registry, 'https://registry.example.test');
  assert.equal(parsed.out.endsWith('/receipt.json'), true);
  assert.equal(parsed.keep, true);
  assert.throws(
    () => parseArguments(['--version', 'latest']),
    (error) => error.code === 'SNAPBACK_PUBLISHED_SMOKE_ARGUMENT_INVALID',
  );
  assert.throws(
    () => parseArguments(['--version', '01.2.3']),
    (error) => error.code === 'SNAPBACK_PUBLISHED_SMOKE_ARGUMENT_INVALID',
  );
  assert.throws(
    () => parseArguments([]),
    (error) => error.code === 'SNAPBACK_PUBLISHED_SMOKE_ARGUMENT_INVALID',
  );
});

test('runtime receipt shape requires v1 single_table_v1 qualification', () => {
  const valid = {
    schemaVersion: 'snapback.packaged-store-qualification.v1',
    capabilityId: 'single_table_v1',
  };
  assert.equal(validateRuntimeReceiptShape(valid), valid);
  for (const invalid of [
    { ...valid, schemaVersion: 'snapback.packaged-store-qualification.v2' },
    { ...valid, capabilityId: 'bounded_children_v1' },
    null,
  ]) {
    assert.throws(
      () => validateRuntimeReceiptShape(invalid),
      (error) => error.code === 'SNAPBACK_PUBLISHED_SMOKE_RECEIPT_ABSENT',
    );
  }
});

test('ready-file waiter admits a synthetic bounded ready file', async () => {
  const root = mkdtempSync(join(tmpdir(), 'published-smoke-ready-test-'));
  const readyFile = join(root, 'ready.json');
  try {
    const timer = setTimeout(() => {
      writeFileSync(readyFile, `${JSON.stringify({
        ready: true,
        serverUrl: 'http://127.0.0.1:1234',
      })}\n`);
    }, 20);
    const descriptor = await waitForReadyFile({
      readyFile,
      child: { exitCode: null },
      timeoutMs: 1_000,
      pollMs: 5,
    });
    clearTimeout(timer);
    assert.equal(descriptor.ready, true);
    assert.equal(descriptor.serverUrl, 'http://127.0.0.1:1234');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
