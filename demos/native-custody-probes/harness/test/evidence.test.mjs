import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { EvidenceWriter, jsonlFrame, scanEvidenceForLeaks } from '../lib/evidence.mjs';

test('jsonl framing is canonical and exactly one line', () => {
  assert.equal(jsonlFrame({ z: 1, a: { y: 2, b: 3 } }), '{"a":{"b":3,"y":2},"z":1}\n');
});

test('evidence writer emits machine and human receipts', () => {
  const root = mkdtempSync(join(tmpdir(), 'custody-evidence-'));
  const writer = new EvidenceWriter({
    root,
    platform: 'ios',
    now: new Date('2026-08-16T12:34:56.789Z'),
    runId: 'ab12cd',
  });
  writer.record('P1', 'bootstrap', {
    expected: { status: 'anonymous' }, observed: { status: 'anonymous' }, verdict: 'PASS',
  });
  const output = writer.finalize({ overallVerdict: 'PASS' });
  assert.match(output.jsonlPath, /20260816T123456Z-ab12cd-phase2-ios\/.*\.jsonl$/u);
  assert.match(output.markdownPath, /20260816T123456Z-ab12cd-phase2-ios\/.*\.md$/u);
  assert.equal(scanEvidenceForLeaks(writer.directory).ok, true);
  assert.equal(existsSync(output.markdownPath), true);
});

test('evidence run identity is exclusive and never truncates a prior run', () => {
  const root = mkdtempSync(join(tmpdir(), 'custody-evidence-exclusive-'));
  const identity = {
    root,
    platform: 'android',
    now: new Date('2026-08-16T01:02:03Z'),
    runId: 'run42',
  };
  const writer = new EvidenceWriter(identity);
  writer.record('P0', 'first', { expected: {}, observed: {}, verdict: 'PASS' });
  assert.throws(() => new EvidenceWriter(identity), /EEXIST/u);
});

test('leakage scan covers the complete in-memory secret set and raw binary artifacts', () => {
  const root = mkdtempSync(join(tmpdir(), 'custody-leakage-'));
  writeFileSync(join(root, 'safe.jsonl'), '{"bearerSha256":"abcd","recoveryCodeCount":8}\n');
  const secrets = ['probe-password', 'literal-bearer', 'literal-recovery-code'];
  assert.equal(scanEvidenceForLeaks(root, { forbiddenLiterals: secrets }).ok, true);
  writeFileSync(join(root, 'screen.png'), Buffer.from(`png\0${secrets[1]}\0${secrets[2]}`));
  writeFileSync(join(root, 'bad.json'), `{"password":"${secrets[0]}"}\n`);
  const scan = scanEvidenceForLeaks(root, {
    forbiddenLiterals: secrets,
    virtualFiles: [{ name: 'candidate.md', bytes: 'safe receipt' }],
  });
  assert.equal(scan.ok, false);
  for (const file of ['screen.png', 'bad.json']) {
    assert.ok(scan.findings.some((finding) => finding.file === file && finding.kind === 'literal'));
  }
  assert.ok(scan.findings.some((finding) => finding.field === 'password'));
});
