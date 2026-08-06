// LLP 0184 Phase 1: negative-fixture proof that
// scripts/generate-control-catalog.mjs's completeness checks are real gates,
// not comments. Each case copies the repo's control-catalog inputs into a
// scratch directory, introduces exactly one deliberate gap, and asserts the
// compiler exits non-zero with a message naming the broken rule. A
// companion positive case proves the unmodified repo inputs still compile
// cleanly, so a change to the checker itself cannot silently go permissive
// without a test noticing.
//
// @ref LLP 0184#3-completeness-and-parity-rules — rules exercised: rule 8
//   (destructive requires approvalPosture), rule 5 (cliOnly requires
//   mcpDeferralReason), and rule 11 (hosted-adapter manifest vs the audited
//   gateway-paths.inventory.json fixture).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

function scratchRepo() {
  const dir = mkdtempSync(join(tmpdir(), 'control-catalog-negative-'));
  for (const relative of [
    'schemas',
    'scripts/generate-control-catalog.mjs',
    'control-catalog',
    'cloudflare/hosted-adapter-manifest.json',
    'cloudflare/gateway-paths.inventory.json',
    'packages/snapback-cli',
    'node_modules/ajv',
  ]) {
    const source = join(ROOT, relative);
    const destination = join(dir, relative);
    cpSync(source, destination, { recursive: true });
  }
  return dir;
}

function runCompiler(repoDir, extraArgs = []) {
  try {
    const output = execFileSync(
      process.execPath,
      [join(repoDir, 'scripts/generate-control-catalog.mjs'), ...extraArgs],
      { cwd: repoDir, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] },
    );
    return { ok: true, output };
  } catch (error) {
    return { ok: false, output: `${error.stdout ?? ''}${error.stderr ?? ''}` };
  }
}

test('unmodified inputs compile cleanly (positive control)', () => {
  const dir = scratchRepo();
  try {
    const result = runCompiler(dir);
    assert.equal(result.ok, true, `expected clean compile, got:\n${result.output}`);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('rule 8 fails when a destructive CLI-only row loses its approvalPosture', () => {
  const dir = scratchRepo();
  try {
    const manifestPath = join(dir, 'control-catalog/cli-only-operations.json');
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
    const dropEntry = manifest.entries.find((entry) => entry.operation === 'cli.fork.drop');
    assert.ok(dropEntry, 'fixture entry cli.fork.drop must exist for this test to be meaningful');
    assert.equal(dropEntry.behavior.destructive, true);
    delete dropEntry.behavior.approvalPosture;
    writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));

    const result = runCompiler(dir);
    assert.equal(result.ok, false, 'compiler must fail when a destructive row has no approvalPosture');
    assert.match(result.output, /destructive:true requires a non-null approvalPosture/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('rule 5 fails when a cliOnly row loses its mcpDeferralReason', () => {
  const dir = scratchRepo();
  try {
    const manifestPath = join(dir, 'control-catalog/cli-only-operations.json');
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
    const entry = manifest.entries.find((candidate) => candidate.operation === 'cli.buildIdentity');
    assert.ok(entry, 'fixture entry cli.buildIdentity must exist for this test to be meaningful');
    delete entry.mcpDeferralReason;
    writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));

    const result = runCompiler(dir);
    assert.equal(result.ok, false, 'compiler must fail when a cliOnly row has no mcpDeferralReason');
    assert.match(result.output, /surfaceAccess cliOnly requires mcpDeferralReason/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('rule 11 fails when a hosted-adapter manifest entry drifts from the audited fixture', () => {
  const dir = scratchRepo();
  try {
    const manifestPath = join(dir, 'cloudflare/hosted-adapter-manifest.json');
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
    // Introduce a brand-new hand-routed case with no counterpart in the
    // audited gateway-paths.inventory.json fixture.
    manifest.entries.push({
      methods: ['POST'],
      path: '/_snapback/api/never-audited',
      operation: 'never.audited',
      title: 'A gateway.js case invented for this test, absent from the audit',
      intents: [],
      surfaceAccess: 'apiOnly',
      operability: 'direct',
      policy: { authority: 'operator', effect: 'none', responseSensitivity: 'OperatorMetadata' },
      behavior: { readOnly: false, destructive: false, idempotent: false, openWorld: false, persistsAcrossRestart: false },
      sources: ['test fixture'],
    });
    writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));

    const result = runCompiler(dir);
    assert.equal(result.ok, false, 'compiler must fail when a manifest entry has no audited-fixture match');
    assert.match(result.output, /no matching \(path, operation\) case in the audited/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('rule 11 fails when an audited fixture entry has no manifest counterpart', () => {
  const dir = scratchRepo();
  try {
    const fixturePath = join(dir, 'cloudflare/gateway-paths.inventory.json');
    const fixture = JSON.parse(readFileSync(fixturePath, 'utf8'));
    fixture.entries.push({
      methods: ['POST'],
      path: '/_snapback/api/audited-but-unmanifested',
      operation: 'audited.unmanifested',
      registrationStyle: 'exact-path',
      gate: 'test fixture',
      description: 'A gateway.js case the audit found but the manifest never declared.',
    });
    writeFileSync(fixturePath, JSON.stringify(fixture, null, 2));

    const result = runCompiler(dir);
    assert.equal(result.ok, false, 'compiler must fail when an audited fixture entry has no manifest entry');
    assert.match(result.output, /has no hosted-adapter-manifest\.json entry/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
