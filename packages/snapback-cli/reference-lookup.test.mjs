import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { runCli } from './index.mjs';
import {
  formatGuideReferenceLookup,
  lookupGuideReference,
} from './reference-lookup.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const sharedCases = JSON.parse(readFileSync(
  resolve(root, 'tests/fixtures/guide-symbol-lookup-v1.json'),
  'utf8',
)).cases;

// @ref LLP 0194#design — the package and embedded-native lookup seams run the
// same exact/member/slice cases so neither projection invents its own dialect.
for (const fixture of sharedCases) {
  const result = lookupGuideReference(
    [fixture.query, ...(fixture.slice === 1 ? [] : ['--slice', String(fixture.slice)])],
    { projectRoot: root },
  );
  if (fixture.match === null) {
    assert.equal(result, null);
    continue;
  }
  assert.equal(result.schemaVersion, 'snapback.guide-symbol-lookup.v1');
  assert.equal(result.match, fixture.match);
  assert.equal(result.truncation?.truncated ?? false, fixture.truncated);
  if (fixture.nextCommand) assert.equal(result.truncation.nextCommand, fixture.nextCommand);
  if (fixture.signatureContains) assert.match(result.member.signature, new RegExp(fixture.signatureContains.replace(/[?]/gu, '\\?'), 'u'));
  assert.ok(Buffer.byteLength(JSON.stringify(result)) <= 16_384);
}

const member = lookupGuideReference(['SnapbackClient.query'], { projectRoot: root });
assert.equal(member.match, 'member');
assert.equal(member.symbol.module, '@expo/snapback-client');
assert.match(member.member.signature, /readonly args\?: FunctionArgs<Ref>/u);
assert.equal(member.truncation, null);
assert.match(member.identity.guideContentHash, /^[0-9a-f]{64}$/u);
assert.match(member.identity.registrySourceDigest, /^sha256:[0-9a-f]{64}$/u);

const diagnostic = lookupGuideReference(['SNAPBACK_AUTH_SESSION_EXPIRED'], { projectRoot: root });
assert.equal(diagnostic.match, 'diagnostic');
assert.equal(diagnostic.diagnostic.code, 'SNAPBACK_AUTH_SESSION_EXPIRED');
assert.equal(diagnostic.diagnostic.subsystem, 'auth');
assert.equal(diagnostic.diagnostic.httpStatus, 401);
assert.equal(diagnostic.diagnostic.sites, undefined);
assert.match(diagnostic.identity.diagnosticsSourceDigest, /^sha256:[0-9a-f]{64}$/u);
assert.ok(Buffer.byteLength(JSON.stringify(diagnostic)) <= 16_384);
const restoredPasswordDiagnostic = lookupGuideReference(
  ['SNAPBACK_AUTH_PASSWORD_ALREADY_SET'],
  { projectRoot: root },
);
assert.equal(restoredPasswordDiagnostic.match, 'diagnostic');
assert.equal(
  restoredPasswordDiagnostic.diagnostic.code,
  'SNAPBACK_AUTH_PASSWORD_ALREADY_SET',
);
assert.equal(restoredPasswordDiagnostic.diagnostic.httpStatus, 409);
const capabilityDiagnostic = lookupGuideReference(
  ['SNAPBACK_CAPABILITY_UNSUPPORTED'],
  { projectRoot: root },
);
assert.equal(capabilityDiagnostic.match, 'diagnostic');
assert.equal(capabilityDiagnostic.diagnostic.sites, undefined);
assert.equal(
  capabilityDiagnostic.diagnostic.guideAnchor,
  '/_snapback/guide/backend/streamed-actions.md#read-the-refusal-codes',
);
const internalDiagnostic = lookupGuideReference(
  ['SNAPBACK_AUTH_SESSION_EXPIRED'],
  { projectRoot: root, includeDiagnosticSites: true },
);
assert.ok(internalDiagnostic.diagnostic.sites.length > 0);
const declarationDiagnostic = lookupGuideReference(
  ['SNAPBACK_APP_READINESS_DECLARATION_INVALID'],
  { projectRoot: root, includeDiagnosticSites: true },
);
assert.match(
  formatGuideReferenceLookup(declarationDiagnostic),
  /Declaration sites:\n- crates\/snapback-activation\/src\/operational_readiness\.rs:/u,
);
const receivedDiagnostic = lookupGuideReference(
  ['SNAPBACK_INVALID_FLOAT'],
  { projectRoot: root, includeDiagnosticSites: true },
);
assert.match(
  formatGuideReferenceLookup(receivedDiagnostic),
  /Received sites:\n- crates\/snapback-types\/src\/error_tracking\.rs:/u,
);
assert.doesNotMatch(
  formatGuideReferenceLookup(receivedDiagnostic),
  /Emitting sites:/u,
);

const environment = lookupGuideReference(
  ['SNAPBACK_GRAPH_DEMAND_IDENTITY_TRACE'],
  { projectRoot: root },
);
assert.equal(environment.match, 'environment');
assert.equal(environment.environment.name, 'SNAPBACK_GRAPH_DEMAND_IDENTITY_TRACE');
assert.deepEqual(
  environment.environment.sites.map(({ file, kind }) => ({ file, kind })),
  [{ file: 'crates/snapback-kernel/src/live_matcher.rs', kind: 'read' }],
);
assert.match(environment.identity.diagnosticsSourceDigest, /^sha256:[0-9a-f]{64}$/u);
assert.ok(Buffer.byteLength(JSON.stringify(environment)) <= 16_384);

const adminTokenEnvironment = lookupGuideReference(
  ['SNAPBACK_ADMIN_TOKEN'],
  { projectRoot: root },
);
assert.equal(adminTokenEnvironment.match, 'environment');
assert.equal(adminTokenEnvironment.environment.name, 'SNAPBACK_ADMIN_TOKEN');

const dualRole = lookupGuideReference(
  ['SNAPBACK_ACCEPTED_SOCKET_LIMIT'],
  { projectRoot: root },
);
assert.equal(dualRole.match, 'diagnostic-environment');
assert.equal(dualRole.diagnostic.code, 'SNAPBACK_ACCEPTED_SOCKET_LIMIT');
assert.equal(dualRole.diagnostic.sites, undefined);
assert.equal(dualRole.environment.name, 'SNAPBACK_ACCEPTED_SOCKET_LIMIT');
assert.deepEqual(
  dualRole.environment.sites.map(({ file, kind }) => ({ file, kind })),
  [{ file: 'targets/cloudflare/src/coordinator.js', kind: 'read' }],
);
assert.ok(Buffer.byteLength(JSON.stringify(dualRole)) <= 16_384);
assert.match(
  formatGuideReferenceLookup(dualRole),
  /snapback[^]*environment variable[^]*Environment sites:[^]*- read: targets\/cloudflare\/src\/coordinator\.js:/u,
);

const syntheticRoot = mkdtempSync(join(tmpdir(), 'snapback-reference-lookup-'));
try {
  const syntheticName = 'SNAPBACK_SYNTHETIC_DUAL_ROLE_PAGINATION';
  const sites = (owner, count) => Array.from({ length: count }, (_, index) => ({
    file: `synthetic/${owner}-${String(index + 1).padStart(2, '0')}.mjs`,
    line: index + 1,
    column: 1,
    ...(owner === 'environment' ? { kind: 'read' } : {}),
  }));
  const symbolRegistry = {
    schemaVersion: 'snapback-symbol-registry.v1',
    buildIdentity: { sourceDigest: 'sha256:synthetic-symbols' },
    limits: { lookupBytes: 16_384 },
    modules: [],
    symbols: [],
  };
  const diagnosticsRegistry = {
    schemaVersion: 'snapback-diagnostics-registry.v1',
    buildIdentity: { sourceDigest: 'sha256:synthetic-diagnostics' },
    diagnostics: {
      [syntheticName]: {
        code: syntheticName,
        subsystem: 'synthetic',
        sites: sites('diagnostic', 1),
        httpStatus: null,
        httpStatusClass: null,
        guideAnchor: null,
        guideAnchors: [],
      },
    },
    environment: {
      [syntheticName]: { name: syntheticName, sites: sites('environment', 25) },
    },
  };
  const symbolBytes = Buffer.from(`${JSON.stringify(symbolRegistry)}\n`);
  const diagnosticsBytes = Buffer.from(`${JSON.stringify(diagnosticsRegistry)}\n`);
  const digest = (bytes) => createHash('sha256').update(bytes).digest('hex');
  const manifest = {
    contentHash: 'synthetic-guide',
    buildIdentity: { commit: 'synthetic' },
    resources: {
      'reference.symbol-registry': {
        sha256: digest(symbolBytes),
        sourceDigest: symbolRegistry.buildIdentity.sourceDigest,
      },
      'reference.diagnostics-registry': {
        sha256: digest(diagnosticsBytes),
        sourceDigest: diagnosticsRegistry.buildIdentity.sourceDigest,
      },
    },
  };
  mkdirSync(join(syntheticRoot, 'guide', 'reference'), { recursive: true });
  writeFileSync(join(syntheticRoot, 'guide', 'reference', 'registry.json'), symbolBytes);
  writeFileSync(
    join(syntheticRoot, 'guide', 'reference', 'diagnostics-registry.json'),
    diagnosticsBytes,
  );
  writeFileSync(
    join(syntheticRoot, 'guide', 'guide-manifest.generated.json'),
    `${JSON.stringify(manifest)}\n`,
  );
  const pagedDualRole = lookupGuideReference([syntheticName], {
    projectRoot: syntheticRoot,
    includeDiagnosticSites: true,
    lookupBudgetBytes: 2_500,
  });
  assert.equal(pagedDualRole.match, 'diagnostic-environment-slice');
  const ownerKinds = (page) => [
    ...(page.diagnostic.sites.length > 0 ? ['diagnostic'] : []),
    ...(page.environment.sites.length > 0 ? ['environment'] : []),
  ];
  assert.deepEqual(ownerKinds(pagedDualRole), ['diagnostic', 'environment']);
  assert.ok(Buffer.byteLength(JSON.stringify(pagedDualRole)) <= 2_500);
  assert.equal(pagedDualRole.truncation.nextSlice, 2);
  const pagedDualRoleSecond = lookupGuideReference([syntheticName, '--slice', '2'], {
    projectRoot: syntheticRoot,
    includeDiagnosticSites: true,
    lookupBudgetBytes: 2_500,
  });
  assert.equal(pagedDualRoleSecond.match, 'diagnostic-environment-slice');
  assert.deepEqual(ownerKinds(pagedDualRoleSecond), ['environment']);
  assert.equal(pagedDualRoleSecond.truncation.nextSlice, null);
  assert.ok(Buffer.byteLength(JSON.stringify(pagedDualRoleSecond)) <= 2_500);
  assert.deepEqual(
    [pagedDualRole, pagedDualRoleSecond]
      .flatMap((page) => page.diagnostic.sites),
    sites('diagnostic', 1),
  );
  assert.deepEqual(
    [pagedDualRole, pagedDualRoleSecond]
      .flatMap((page) => page.environment.sites),
    sites('environment', 25),
  );

  const pagedDualRoleOutOfRange = lookupGuideReference(
    [syntheticName, '--slice', '99'],
    {
      projectRoot: syntheticRoot,
      includeDiagnosticSites: true,
      lookupBudgetBytes: 2_500,
    },
  );
  assert.equal(pagedDualRoleOutOfRange.match, 'diagnostic-environment-slice');
  assert.deepEqual(pagedDualRoleOutOfRange.diagnostic.sites, []);
  assert.deepEqual(pagedDualRoleOutOfRange.environment.sites, []);
  assert.equal(pagedDualRoleOutOfRange.truncation.nextSlice, null);
  assert.ok(
    Buffer.byteLength(JSON.stringify(pagedDualRoleOutOfRange)) <= 2_500,
  );
} finally {
  rmSync(syntheticRoot, { recursive: true, force: true });
}

const large = lookupGuideReference(['SnapbackClient'], { projectRoot: root });
assert.equal(large.match, 'symbol-slice');
assert.equal(large.truncation.truncated, true);
assert.match(large.truncation.elided.join('\n'), /complete signature/u);
assert.equal(large.truncation.nextCommand, 'snapback guide SnapbackClient --slice 2');
assert.ok(Buffer.byteLength(JSON.stringify(large)) <= 16_384);

const moduleSlice = lookupGuideReference(['@expo/snapback-client'], { projectRoot: root });
assert.equal(moduleSlice.match, 'module-slice');
assert.equal(moduleSlice.truncation.truncated, true);
assert.match(moduleSlice.truncation.elided.join('\n'), /symbols 13-/u);
assert.equal(moduleSlice.truncation.nextCommand, 'snapback guide @expo/snapback-client --slice 2');
assert.ok(Buffer.byteLength(JSON.stringify(moduleSlice)) <= 16_384);

assert.equal(lookupGuideReference(['not-an-exact-symbol'], { projectRoot: root }), null);
const output = [];
const originalLog = console.log;
try {
  console.log = (...values) => output.push(values.join(' '));
  assert.equal(await runCli(['guide', 'SnapbackClient.query', '--json'], { projectRoot: root }), 0);
} finally {
  console.log = originalLog;
}
const cliResult = JSON.parse(output.join('\n'));
assert.equal(cliResult.schemaVersion, 'snapback.guide-search.v1');
assert.equal(cliResult.mode, 'exact-symbol');
assert.equal(cliResult.query, 'SnapbackClient.query');
assert.equal(cliResult.result.match, 'member');

output.length = 0;
try {
  console.log = (...values) => output.push(values.join(' '));
  assert.equal(await runCli(
    ['guide', 'SNAPBACK_ADMIN_TOKEN', '--json'],
    { projectRoot: root },
  ), 0);
} finally {
  console.log = originalLog;
}
const environmentCliResult = JSON.parse(output.join('\n'));
assert.equal(environmentCliResult.result.match, 'environment');
assert.equal(
  environmentCliResult.result.environment.name,
  'SNAPBACK_ADMIN_TOKEN',
);
console.log('reference-lookup.test.mjs: exact diagnostic/environment/dual-role/member, bounded symbol/module, identity, and fallback pass');
