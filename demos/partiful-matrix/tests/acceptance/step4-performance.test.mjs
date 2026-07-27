import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const here = dirname(fileURLToPath(import.meta.url));
const collector = resolve(here, 'step4-performance.mjs');

test('web performance validator checks authority without starting measurement', () => {
  const root = mkdtempSync(resolve(tmpdir(), 'partitime-performance-validator-test-'));
  try {
    const output = resolve(root, 'must-not-exist.json');
    const child = spawnSync(process.execPath, [
      collector,
      '--validate-only',
      '--out', output,
    ], { encoding: 'utf8' });
    assert.equal(child.status, 0, child.stderr);
    assert.equal(existsSync(output), false);
    assert.deepEqual(JSON.parse(child.stdout), {
      schemaVersion: 'partitime.step4-performance-validator.v1',
      ok: true,
      amendmentId: 'partitime-ws8-prospective-2026-07-21',
      amendmentStatus: 'ratified',
      invalidationId: 'partitime-ws8-web-instrument-v3-2026-07-23',
      invalidationStatus: 'ratified',
      methodId: 'partitime-ws8-performance-v3',
      thresholdSetId: 'partitime-ws8-performance-thresholds-v3',
    });
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
