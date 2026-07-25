#!/usr/bin/env node

import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { measureSourceInventory } from './step4-closure-helpers.mjs';

// @ref LLP 0063#workstream-6--reduce-snapbacks-declaration-and-runtime-tax
// @ref LLP 0065#6-acceptance
//
// This witness intentionally separates a passing implementation candidate
// from the executable conformance gate. Accepted LLP 0065 authorizes this
// implementation, but cannot promote the cumulative
// STEP5.DECLARATION_REDUCTION claim until its conformance suite and frozen
// source-volume row pass.

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, '..', '..', '..', '..');
const option = (name, fallback = null) => {
  const at = process.argv.indexOf(`--${name}`);
  return at < 0 ? fallback : process.argv[at + 1];
};
const output = resolve(repoRoot, option(
  'out',
  'demos/partiful-matrix/acceptance/results/step5-declaration-reduction-candidate.json',
));
const requirePass = process.argv.includes('--require-pass');
const scratch = mkdtempSync(resolve(tmpdir(), 'snapback-step5-declaration-'));
const serverReceiptPath = resolve(scratch, 'standard-patterns-real-server.json');
const readJson = (path) => JSON.parse(readFileSync(resolve(repoRoot, path), 'utf8'));
const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');
const identity = (path) => ({ path, sha256: sha256(readFileSync(resolve(repoRoot, path))) });
const run = (command, args) => {
  const result = spawnSync(command, args, { cwd: repoRoot, encoding: 'utf8' });
  assert.equal(result.status, 0, `${command} ${args.join(' ')} failed:\n${result.stderr || result.stdout}`);
  return {
    command: [command, ...args].join(' ').replaceAll(scratch, '<scratch>'),
    exitCode: result.status,
  };
};

try {
  const protocolPath = 'demos/partiful-matrix/acceptance/comparison-protocol.v1.json';
  const baselinePath = 'demos/partiful-matrix/acceptance/results/step0-attribution.json';
  const authorityPath = 'llp/0065-generated-data-pattern-soundness.rfc.md';
  const protocol = readJson(protocolPath);
  const baseline = readJson(baselinePath);
  const authorityText = readFileSync(resolve(repoRoot, authorityPath), 'utf8');
  const authorityStatus = /^\*\*Status:\*\*\s+(.+)$/m.exec(authorityText)?.[1]?.trim() ?? null;
  assert.ok(authorityStatus, 'LLP 0065 status is missing');
  assert.equal(
    protocol.thresholdFormulas.snapbackBackendLines,
    'floor(partitime_snapback_backend_baseline_lines * 0.80)',
  );
  assert.equal(baseline.thresholdId, 'partitime-thresholds-v1-sha256-343dcc1429e20e07');

  const executions = [
    run('node', ['packages/snapback-codegen/standard-patterns.test.mjs']),
    run('./node_modules/.bin/tsc', [
      '--noEmit', '--strict', '--target', 'es2022', '--module', 'esnext',
      '--moduleResolution', 'bundler',
      'packages/snapback-codegen/standard-patterns-types.fixture.ts',
    ]),
    run('node', [
      'tests/acceptance/standard-patterns-v1.mjs',
      '--receipt', serverReceiptPath,
    ]),
  ];
  const serverReceipt = JSON.parse(readFileSync(serverReceiptPath, 'utf8'));
  assert.equal(serverReceipt.ok, true);

  const sourcePaths = [
    'demos/partiful-matrix/snapback/schema.mjs',
    'demos/partiful-matrix/snapback/functions.mjs',
    'demos/partiful-matrix/snapback/seed.json',
  ];
  const sourceInventory = measureSourceInventory(sourcePaths);
  const threshold = baseline.thresholds.snapbackBackendLines;
  const sourcePass = sourceInventory.totalLines <= threshold;
  const implementationCandidatePass = sourcePass && serverReceipt.ok;
  const authorityAccepted = ['Accepted', 'Implemented'].includes(authorityStatus);
  const gatePass = implementationCandidatePass && authorityAccepted;

  const report = {
    schemaVersion: 'partitime.step5-declaration-reduction-candidate.v1',
    claimId: 'STEP5.DECLARATION_REDUCTION',
    ok: gatePass,
    disposition: gatePass ? 'pass' : 'candidate-pass-authority-pending',
    claimStatus: gatePass ? 'passing' : 'pending',
    implementationCandidatePass,
    authority: {
      ...identity(authorityPath),
      status: authorityStatus,
      acceptedForGate: authorityAccepted,
      rule: 'LLP 0065 must be Accepted or Implemented before this candidate may promote the cumulative claim.',
    },
    sourceVolume: {
      actualLines: sourceInventory.totalLines,
      thresholdLines: threshold,
      marginLines: threshold - sourceInventory.totalLines,
      pass: sourcePass,
      formula: protocol.thresholdFormulas.snapbackBackendLines,
      thresholdId: baseline.thresholdId,
      inventory: sourceInventory,
    },
    standardPatterns: {
      receipt: serverReceipt,
      receiptSha256: sha256(readFileSync(serverReceiptPath)),
      executions,
      inputs: [
        identity('packages/snapback-codegen/standard-patterns.mjs'),
        identity('packages/snapback-codegen/standard-patterns.d.ts'),
        identity('packages/snapback-codegen/standard-patterns.test.mjs'),
        identity('packages/snapback-codegen/standard-patterns-types.fixture.ts'),
        identity('tests/acceptance/standard-patterns-v1.mjs'),
      ],
    },
    frozenInputs: {
      protocol: identity(protocolPath),
      baseline: identity(baselinePath),
    },
    limitations: [
      'This receipt proves the owned CRUD, unique-lookup, and keyset-pagination candidate only.',
      'It does not claim joins, maintained projections, or migrations governed by Draft LLP 0074/0075.',
      'It does not replace the separate released-package and LLP 0041 external-loop gates.',
    ],
  };
  mkdirSync(dirname(output), { recursive: true });
  writeFileSync(output, `${JSON.stringify(report, null, 2)}\n`);
  console.log(JSON.stringify(report));
  if (requirePass && !gatePass) process.exitCode = 1;
} finally {
  rmSync(scratch, { recursive: true, force: true });
}
