import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const script = fileURLToPath(new URL('../../../scripts/wasm-budget.mjs', import.meta.url));
test('wasm budget accepts a recorded limit and refuses missing, malformed or nonnumeric limits', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'wasm-budget-'));
  const file = path.join(dir, 'wasm-budget.json');
  const run = () => spawnSync(process.execPath, [script, file], { encoding: 'utf8' });
  try {
    assert.notEqual(run().status, 0);
    writeFileSync(file, '{'); assert.notEqual(run().status, 0);
    writeFileSync(file, JSON.stringify({ gzip: '1000', set: '2026-09-17', why: 'test' })); assert.notEqual(run().status, 0);
    writeFileSync(file, JSON.stringify({ gzip: 1000, set: '2026-09-17', why: 'test' }));
    const accepted = run(); assert.equal(accepted.status, 0, accepted.stderr); assert.equal(accepted.stdout.trim(), '1000');
    for (const [bytes, message] of [['999', '(budget 1000: ok)'], ['1001', '(budget 1000: OVER by 1 B — issues/20260913-snapback4-wasm-device-diet.md)']]) {
      const report = spawnSync(process.execPath, [script, file, bytes], { encoding: 'utf8' });
      assert.equal(report.status, 0, report.stderr); assert.equal(report.stdout.trim(), message);
    }
  } finally { rmSync(dir, { recursive: true }); }
});
