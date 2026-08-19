// LLP 0184 Phase 1: negative-fixture proof that
// scripts/generate-control-catalog.mjs's completeness checks are real gates,
// not comments. Each case copies the repo's control-catalog inputs into a
// scratch directory, introduces exactly one deliberate gap, and asserts the
// compiler exits non-zero with a message naming the broken rule. A
// companion positive case proves the unmodified repo inputs still compile
// cleanly, so a change to the checker itself cannot silently go permissive
// without a test noticing.
//
// @ref LLP 0184#3-completeness-and-parity-rules — rules exercised: rule 3
//   (packaged command coverage), rule 4 (task discovery metadata and Guide
//   anchors), rule 5 (deferral/recipe completeness), rule 6 (mediated handoff
//   custody), rule 8 (destructive approvalPosture), and rule 11
//   (hosted-adapter manifest vs the audited gateway fixture).

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
    'cloudflare/src/gateway.js',
    'guide',
    'packages/snapback-cli',
    'packages/snapback-client',
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

function runGit(repoDir, args) {
  return execFileSync('git', args, {
    cwd: repoDir,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
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

test('a committed carrier remains fresh after its source commit', () => {
  const dir = scratchRepo();
  try {
    runGit(dir, ['init', '--quiet']);
    runGit(dir, ['config', 'user.name', 'Control Catalog Fixture']);
    runGit(dir, ['config', 'user.email', 'control-catalog-fixture@example.invalid']);
    runGit(dir, ['add', '.']);
    runGit(dir, ['commit', '--quiet', '-m', 'source']);

    const generated = runCompiler(dir);
    assert.equal(generated.ok, true, generated.output);
    const sourceCommit = runGit(dir, ['rev-parse', 'HEAD']).trim();
    const carrier = JSON.parse(
      readFileSync(join(dir, 'control-catalog/generated/control-catalog.v1.json'), 'utf8'),
    );
    assert.equal(carrier.generatedAtCommit, sourceCommit);
    assert.equal(carrier.buildIdentity.sourceCommit, sourceCommit);

    runGit(dir, ['add', 'control-catalog/generated/control-catalog.v1.json']);
    runGit(dir, ['commit', '--quiet', '-m', 'carrier']);
    assert.notEqual(runGit(dir, ['rev-parse', 'HEAD']).trim(), sourceCommit);

    const checked = runCompiler(dir, ['--check']);
    assert.equal(
      checked.ok,
      true,
      `committed carrier must not invalidate itself:\n${checked.output}`,
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('ephemeral operator delete narrows availability and keeps projections honest', () => {
  const dir = scratchRepo();
  try {
    const result = runCompiler(dir);
    assert.equal(result.ok, true, `expected clean compile, got:\n${result.output}`);
    const catalog = JSON.parse(readFileSync(
      join(dir, 'control-catalog/generated/control-catalog.v1.json'),
      'utf8',
    ));
    const entry = catalog.entries.find((candidate) => candidate.operation === 'ephemeral.operatorDelete');
    assert.ok(entry, 'ephemeral.operatorDelete must be compiled from the live route registry');
    assert.equal(entry.operability, 'direct');
    assert.deepEqual(entry.availability, { targets: ['local'] });
    assert.equal(entry.surfaceAccess, 'native');
    assert.equal(entry.projections.cli, 'snapback ephemeral operator-delete');
    assert.equal(entry.projections.mcp, 'snapback_ephemeral_operator_delete');
    assert.equal(entry.projections.http, 'POST /_snapback/api/ephemeral/operator/delete');
    assert.equal(entry.projections.hostOps, null);
    assert.equal(entry.projections.adminClient, null);
    assert.equal(entry.projections.console, null);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('config.set compiles as CLI-only with a stdin/fd carrier and no MCP projection', () => {
  const dir = scratchRepo();
  try {
    const result = runCompiler(dir);
    assert.equal(result.ok, true, `expected clean compile, got:\n${result.output}`);
    const catalog = JSON.parse(readFileSync(
      join(dir, 'control-catalog/generated/control-catalog.v1.json'),
      'utf8',
    ));
    const entry = catalog.entries.find((candidate) => candidate.operation === 'config.set');
    assert.ok(entry, 'config.set must be compiled from the live admin route registry');
    assert.equal(entry.operability, 'direct');
    assert.equal(entry.surfaceAccess, 'cliOnly');
    assert.equal(
      entry.projections.cli,
      'snapback config set --entry <name> (--value-stdin|--value-fd N)',
    );
    assert.equal(entry.projections.mcp, null);
    assert.match(entry.mcpDeferralReason, /no MCP secret carrier/i);
    assert.deepEqual(entry.inputSchema.properties.valueCarrier.enum, ['stdin', 'fd']);
    assert.match(entry.inputSchema.properties.valueCarrier.description, /absent from argv/i);
    assert.match(entry.guide, /secrets-and-config\.md#set-an-agent-held-value/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('admin.link publishes the complete mediated handoff and negative witness', () => {
  const dir = scratchRepo();
  try {
    const result = runCompiler(dir);
    assert.equal(result.ok, true, `expected clean compile, got:\n${result.output}`);
    const catalog = JSON.parse(readFileSync(
      join(dir, 'control-catalog/generated/control-catalog.v1.json'),
      'utf8',
    ));
    const entries = catalog.entries.filter((entry) => entry.operation.startsWith('admin.link.'));
    assert.equal(entries.length, 4, 'all four route identities belong to one admin-link handoff');
    for (const entry of entries) {
      assert.equal(entry.operability, 'mediated');
      assert.equal(entry.surfaceAccess, 'cliOnly');
      for (const semantic of ['plan', 'initiate', 'status', 'resume']) {
        assert.equal(typeof entry.mediatedHandoff[semantic], 'string');
        assert.notEqual(entry.mediatedHandoff[semantic], '');
      }
      assert.match(entry.mediatedHandoff.protectedArtifact, /sbcc_/);
      assert.deepEqual(entry.mediatedHandoff.negativeLeakTests, [
        'tests/admin_claim_link_v0.rs::planted_claim_link_redeems_once_and_attached_cli_reports_it',
      ]);
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('check preserves the valid generation snapshot while recomputing catalog content', () => {
  const dir = scratchRepo();
  try {
    const generated = runCompiler(dir);
    assert.equal(generated.ok, true, `expected clean compile, got:\n${generated.output}`);

    const outputPath = join(dir, 'control-catalog/generated/control-catalog.v1.json');
    const output = JSON.parse(readFileSync(outputPath, 'utf8'));
    output.buildIdentity = {
      sourceCommit: '0123456789abcdef0123456789abcdef01234567',
      dirty: false,
    };
    output.generatedAtCommit = output.buildIdentity.sourceCommit;
    writeFileSync(outputPath, `${JSON.stringify(output, null, 2)}\n`);

    const checked = runCompiler(dir, ['--check']);
    assert.equal(
      checked.ok,
      true,
      `a later clean commit must not make its checked-in generation snapshot stale:\n${checked.output}`,
    );

    const manifestPath = join(dir, 'control-catalog/cli-only-operations.json');
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
    manifest.entries[0].intents.push('semantic drift after generation');
    writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));
    const stale = runCompiler(dir, ['--check']);
    assert.equal(stale.ok, false, 'the informational snapshot exception must not hide content drift');
    assert.match(
      stale.output,
      /generated CONTROL CATALOG INVENTORY table\/count is stale|control-catalog\/generated\/control-catalog\.v1\.json is stale/,
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('rule 9 fails when a generated Guide catalog count drifts', () => {
  const dir = scratchRepo();
  try {
    const generated = runCompiler(dir);
    assert.equal(generated.ok, true, `expected clean compile, got:\n${generated.output}`);
    const guidePath = join(dir, 'guide/operating/agent-controls.md');
    const guide = readFileSync(guidePath, 'utf8');
    const drifted = guide.replace(
      /The embedded build catalog contains \*\*(\d+) operations\*\*/,
      (_match, count) => `The embedded build catalog contains **${Number(count) + 1} operations**`,
    );
    assert.notEqual(drifted, guide, 'generated count fixture must be present');
    writeFileSync(guidePath, drifted);

    const result = runCompiler(dir, ['--check']);
    assert.equal(result.ok, false, 'stale generated Guide count must fail --check');
    assert.match(result.output, /generated CONTROL CATALOG INVENTORY table\/count is stale/);
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

test('rule 4 fails when authored task intents are empty', () => {
  const dir = scratchRepo();
  try {
    const manifestPath = join(dir, 'control-catalog/operability-overrides.json');
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
    manifest.discovery['host.restart'].intents = [];
    writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));

    const result = runCompiler(dir);
    assert.equal(result.ok, false);
    assert.match(result.output, /host\.restart: non-empty authored intents are required \(rule 4\)/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('rule 4 fails when a title repeats the operation identity', () => {
  const dir = scratchRepo();
  try {
    const manifestPath = join(dir, 'control-catalog/operability-overrides.json');
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
    manifest.discovery['host.restart'].title = 'host.restart';
    writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));

    const result = runCompiler(dir);
    assert.equal(result.ok, false);
    assert.match(result.output, /host\.restart: title must differ from operation \(rule 4\)/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('rule 4 mechanically rejects a missing Guide heading', () => {
  const dir = scratchRepo();
  try {
    const manifestPath = join(dir, 'control-catalog/operability-overrides.json');
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
    manifest.discovery['host.restart'].guide = 'operating/host-ops.md#not-a-real-heading';
    writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));

    const result = runCompiler(dir);
    assert.equal(result.ok, false);
    assert.match(result.output, /host\.restart: native requires a Guide path\/anchor that exists/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('rule 5 requires an apiOnly recipe heading or explicit CLI deferral', () => {
  const dir = scratchRepo();
  try {
    const manifestPath = join(dir, 'control-catalog/operability-overrides.json');
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
    manifest.discovery['auth.rescueCollidingTable'].guide = 'auth/sessions-and-principals.md';
    delete manifest.discovery['auth.rescueCollidingTable'].cliDeferralReason;
    writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));

    const result = runCompiler(dir);
    assert.equal(result.ok, false);
    assert.match(result.output, /auth\.rescueCollidingTable: apiOnly requires an authored Guide recipe anchor or cliDeferralReason/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('rule 3 requires every packaged CLI root verb to have a row or deferral', () => {
  const dir = scratchRepo();
  try {
    const manifestPath = join(dir, 'control-catalog/cli-only-operations.json');
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
    manifest.entries = manifest.entries.filter((entry) => entry.packagedCommand !== 'verify');
    writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));

    const result = runCompiler(dir);
    assert.equal(result.ok, false);
    assert.match(result.output, /packaged CLI command 'snapback verify' has no .* row or declared deferral/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('rule 6 fails when a mediated row loses its negative custody witness', () => {
  const dir = scratchRepo();
  try {
    const manifestPath = join(dir, 'control-catalog/operability-overrides.json');
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
    const entry = manifest.overrides['admin.link.mint'];
    assert.equal(entry.operability, 'mediated');
    delete entry.mediatedHandoff.negativeLeakTests;
    writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));

    const result = runCompiler(dir);
    assert.equal(result.ok, false, 'compiler must fail without the mediated negative witness');
    assert.match(result.output, /admin\.link\.mint: operability mediated requires .*negativeLeakTests.*\(rule 6\)/);
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

test('gateway source parity fails on an unlisted forwarded app-data path', () => {
  const dir = scratchRepo();
  try {
    const sourcePath = join(dir, 'cloudflare/src/gateway.js');
    const source = readFileSync(sourcePath, 'utf8').replace(
      "const FORWARDED_JSON_PATHS = new Set([",
      "const FORWARDED_JSON_PATHS = new Set(['/new-app-data-route', ",
    );
    writeFileSync(sourcePath, source);
    const result = runCompiler(dir);
    assert.equal(result.ok, false);
    assert.match(result.output, /FORWARDED_JSON_PATHS literals are unlisted/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('gateway source parity fails when KIT_ROUTE changes without the fixture', () => {
  const dir = scratchRepo();
  try {
    const sourcePath = join(dir, 'cloudflare/src/gateway.js');
    const source = readFileSync(sourcePath, 'utf8').replace(
      '(?:query|mutation|action)',
      '(?:query|mutation|action|command)',
    );
    writeFileSync(sourcePath, source);
    const result = runCompiler(dir);
    assert.equal(result.ok, false);
    assert.match(result.output, /KIT_ROUTE literal is unlisted/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('gateway source parity fails on an unlisted exact path comparison', () => {
  const dir = scratchRepo();
  try {
    const sourcePath = join(dir, 'cloudflare/src/gateway.js');
    const source = readFileSync(sourcePath, 'utf8').replace(
      "if (path === '/health')",
      "if (path === '/new-exact') return json(200, {});\n    if (path === '/health')",
    );
    writeFileSync(sourcePath, source);
    const result = runCompiler(dir);
    assert.equal(result.ok, false);
    assert.match(result.output, /exact path literals are unlisted/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
