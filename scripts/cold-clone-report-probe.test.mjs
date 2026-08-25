import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';

const root = resolve(import.meta.dirname, '..');
const checkScript = resolve(root, 'scripts/cold-clone-check.sh');

const runProbe = (logPath) => spawnSync('/bin/bash', [checkScript], {
  cwd: root,
  encoding: 'utf8',
  env: {
    ...process.env,
    SNAPBACK_COLD_CLONE_REPORT_PROBE_LOG: logPath,
  },
});

test('cold-clone report probe exits 1 and preserves marker plus JSON', () => {
  const directory = mkdtempSync(join(tmpdir(), 'snapback-cold-clone-report-'));
  try {
    const logPath = join(directory, 'acceptance.log');
    const report = '{"schemaVersion":"snapback.acceptance-report.v1","passed":33,"total":34}';
    writeFileSync(logPath, `human output\n--- machine-readable report ---\n${report}\n`);

    const result = runProbe(logPath);
    assert.equal(result.signal, null);
    assert.equal(result.status, 1);
    assert.match(result.stderr, /\[cold-clone\] machine-readable acceptance report:/u);
    assert.match(result.stderr, /^--- machine-readable report ---$/mu);
    assert.equal(result.stderr.includes(report), true);
    assert.match(result.stderr, /injected browser acceptance failure \(report probe\)/u);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test('cold-clone report probe exits 1 and names a missing marker', () => {
  const directory = mkdtempSync(join(tmpdir(), 'snapback-cold-clone-report-'));
  try {
    const logPath = join(directory, 'acceptance.log');
    writeFileSync(logPath, 'browser exited before producing its report\n');

    const result = runProbe(logPath);
    assert.equal(result.signal, null);
    assert.equal(result.status, 1);
    assert.match(
      result.stderr,
      /machine-readable acceptance report unavailable \(marker missing\)/u,
    );
    assert.doesNotMatch(result.stderr, /^--- machine-readable report ---$/mu);
    assert.match(result.stderr, /injected browser acceptance failure \(report probe\)/u);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
