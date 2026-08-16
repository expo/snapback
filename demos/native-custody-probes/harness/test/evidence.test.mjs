import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { EvidenceWriter, jsonlFrame, scanEvidenceForLeaks } from '../lib/evidence.mjs';

test('jsonl framing is canonical and exactly one line', () => {
  assert.equal(jsonlFrame({ z: 1, a: { y: 2, b: 3 } }), '{"a":{"b":3,"y":2},"z":1}\n');
});

test('evidence writer emits machine and human receipts', () => {
  const root = mkdtempSync(join(tmpdir(), 'custody-evidence-'));
  const writer = new EvidenceWriter({ root, platform: 'ios', date: '20260816' });
  writer.record('P1', 'bootstrap', {
    expected: { status: 'anonymous' }, observed: { status: 'anonymous' }, verdict: 'PASS',
  });
  const output = writer.finalize({ overallVerdict: 'PASS' });
  assert.match(output.jsonlPath, /20260816-phase2-ios\.jsonl$/u);
  assert.match(output.markdownPath, /20260816-phase2-ios\.md$/u);
  assert.equal(scanEvidenceForLeaks(root).ok, true);
});

test('leakage scan finds literals and secret-valued field names but permits bearerSha256', () => {
  const root = mkdtempSync(join(tmpdir(), 'custody-leakage-'));
  writeFileSync(join(root, 'safe.jsonl'), '{"bearerSha256":"abcd","recoveryCodeCount":8}\n');
  assert.equal(scanEvidenceForLeaks(root, { forbiddenLiterals: ['probe-password'] }).ok, true);
  writeFileSync(join(root, 'bad.json'), '{"bearer":"secret","password":"probe-password"}\n');
  const scan = scanEvidenceForLeaks(root, { forbiddenLiterals: ['probe-password'] });
  assert.equal(scan.ok, false);
  assert.ok(scan.findings.some((finding) => finding.kind === 'literal'));
  assert.ok(scan.findings.some((finding) => finding.field === 'bearer'));
});
