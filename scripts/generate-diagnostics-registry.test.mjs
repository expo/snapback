import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import test from 'node:test';

import {
  diagnosticCodeMatches,
  diagnosticSourceSites,
  environmentVariableSites,
} from './diagnostics-registry-source.mjs';

const root = resolve(import.meta.dirname, '..');
const generator = resolve(root, 'scripts/generate-diagnostics-registry.mjs');

function runFixture(name) {
  return spawnSync(
    process.execPath,
    [
      generator,
      '--check',
      '--guide-fixture-root',
      `scripts/fixtures/diagnostics-registry/${name}`,
    ],
    { cwd: root, encoding: 'utf8' },
  );
}

test('rejects a diagnostic-primary marker for an unknown code', () => {
  const result = runFixture('unknown-primary');
  assert.equal(result.status, 1, result.stderr || result.stdout);
  assert.match(
    result.stderr,
    /SNAPBACK_DIAGNOSTIC_PRIMARY_UNKNOWN_CODE/u,
  );
  assert.match(result.stderr, /SNAPBACK_NOT_A_PRODUCTION_DIAGNOSTIC/u);
});

test('rejects multiple diagnostic-primary markers for one diagnostic', () => {
  const result = runFixture('multiple-primary');
  assert.equal(result.status, 1, result.stderr || result.stdout);
  assert.match(
    result.stderr,
    /SNAPBACK_DIAGNOSTIC_PRIMARY_MULTIPLE/u,
  );
  assert.match(result.stderr, /SNAPBACK_AUTH_STALE_RESULT/u);
});

test('diagnostic source classifier excludes environment reads per site and retains emissions', () => {
  const fixture = readFileSync(resolve(
    import.meta.dirname,
    '../tests/fixtures/diagnostics-registry/non-emitting-reference-sites.txt',
  ), 'utf8');

  assert.equal([...fixture.matchAll(/SNAPBACK_[A-Z0-9_]+/gu)].length, 78);

  const sourceOptions = { ordinaryMultiline: true };
  assert.deepEqual(
    [...diagnosticCodeMatches(fixture, sourceOptions)].map((match) => match[0]),
    [
      'SNAPBACK_GRAPH_DEMAND_IDENTITY_MISMATCH',
      'SNAPBACK_FIXTURE_JS_EMITTED',
      'SNAPBACK_FIXTURE_JS_URL_EMITTED',
      'SNAPBACK_FIXTURE_JS_MESSAGE_OWNER',
      'SNAPBACK_FIXTURE_PREFIXED_CODE',
      'SNAPBACK_FIXTURE_LEADING_ERROR_CODE',
      'SNAPBACK_FIXTURE_GENERATED_JS_EMISSION',
      'SNAPBACK_FIXTURE_SQL_STORED_EMISSION',
      'SNAPBACK_FIXTURE_ESCAPED_POISON',
      'SNAPBACK_FIXTURE_WARNING_PREFIX',
      'SNAPBACK_FIXTURE_PRINTLN',
      'SNAPBACK_FIXTURE_TRACING',
      'SNAPBACK_FIXTURE_LOG',
      'SNAPBACK_FIXTURE_MARKED_EMISSION',
      'SNAPBACK_FIXTURE_SYNTHETIC_DYNAMIC',
      'SNAPBACK_FIXTURE_DUAL_ROLE',
      'SNAPBACK_FIXTURE_DUAL_ROLE',
    ],
  );

  const nestedEmissionNames = new Set([
    'SNAPBACK_FIXTURE_GENERATED_JS_EMISSION',
    'SNAPBACK_FIXTURE_SQL_STORED_EMISSION',
    'SNAPBACK_FIXTURE_ESCAPED_POISON',
    'SNAPBACK_FIXTURE_WARNING_PREFIX',
    'SNAPBACK_FIXTURE_PRINTLN',
    'SNAPBACK_FIXTURE_TRACING',
    'SNAPBACK_FIXTURE_LOG',
    'SNAPBACK_FIXTURE_MARKED_EMISSION',
    'SNAPBACK_FIXTURE_SYNTHETIC_DYNAMIC',
  ]);
  assert.deepEqual(
    diagnosticSourceSites(fixture, sourceOptions)
      .filter(({ match }) => nestedEmissionNames.has(match[0]))
      .map(({ match, kind }) => ({ code: match[0], kind })),
    [...nestedEmissionNames].map((code) => ({ code, kind: 'emission' })),
  );

  const dualRoleSites = diagnosticSourceSites(fixture, sourceOptions)
    .filter(({ match }) => match[0] === 'SNAPBACK_FIXTURE_DUAL_ROLE');
  assert.equal(dualRoleSites.length, 2);
  assert.ok(dualRoleSites.every(({ kind }) => kind === 'emission'));
  assert.deepEqual(
    dualRoleSites.map(({ match }) => fixture.slice(
      fixture.lastIndexOf('\n', match.index - 1) + 1,
      fixture.indexOf('\n', match.index),
    )),
    [
      "throw new Error('SNAPBACK_FIXTURE_DUAL_ROLE');",
      'eprintln!("SNAPBACK_FIXTURE_DUAL_ROLE: detail={detail}");',
    ],
  );

  const dualRoleEnvironmentSites = environmentVariableSites(fixture, sourceOptions)
    .filter(({ match }) => match[0] === 'SNAPBACK_FIXTURE_DUAL_ROLE');
  assert.deepEqual(
    dualRoleEnvironmentSites.map(({ match, kind }) => ({
      line: fixture.slice(
        fixture.lastIndexOf('\n', match.index - 1) + 1,
        fixture.indexOf('\n', match.index),
      ),
      kind,
    })),
    [{ line: "const dualRole = env('SNAPBACK_FIXTURE_DUAL_ROLE');", kind: 'read' }],
  );

  const environmentNameListSites = environmentVariableSites(fixture, sourceOptions)
    .filter(({ match }) => match[0].startsWith('SNAPBACK_FIXTURE_LIST_'));
  assert.deepEqual(
    environmentNameListSites.map(({ match, kind }) => ({ name: match[0], kind })),
    [
      { name: 'SNAPBACK_FIXTURE_LIST_ENV', kind: 'table-entry' },
      { name: 'SNAPBACK_FIXTURE_LIST_SECOND_ENV', kind: 'table-entry' },
    ],
  );

  assert.deepEqual(
    environmentVariableSites(fixture, sourceOptions)
      .filter(({ match }) => match[0] === 'SNAPBACK_FIXTURE_COMMENTED_ENV_ACCESS'),
    [],
  );
  assert.deepEqual(
    environmentVariableSites(fixture, sourceOptions)
      .filter(({ match }) => match[0] === 'SNAPBACK_FIXTURE_MULTILINE_COMMENTED_ENV'),
    [],
  );

  const environmentMutationKinds = new Map([
    ['SNAPBACK_FIXTURE_RUST_CHILD_WRITE', 'write'],
    ['SNAPBACK_FIXTURE_RUST_CHILD_REMOVE', 'remove'],
    ['SNAPBACK_FIXTURE_RUST_PROCESS_WRITE', 'write'],
    ['SNAPBACK_FIXTURE_RUST_PROCESS_REMOVE', 'remove'],
    ['SNAPBACK_FIXTURE_JS_WRITE', 'write'],
    ['SNAPBACK_FIXTURE_JS_REMOVE', 'remove'],
    ['SNAPBACK_FIXTURE_JS_SPAWN_WRITE', 'write'],
  ]);
  assert.deepEqual(
    environmentVariableSites(fixture, sourceOptions)
      .filter(({ match }) => environmentMutationKinds.has(match[0]))
      .map(({ match, kind }) => ({ name: match[0], kind })),
    [...environmentMutationKinds].map(([name, kind]) => ({ name, kind })),
  );

  assert.deepEqual(
    environmentVariableSites(fixture, sourceOptions)
      .filter(({ match }) => match[0] === 'SNAPBACK_FIXTURE_OPAQUE_INDIRECT_ENV')
      .map(({ match, kind }) => ({ name: match[0], kind })),
    [{ name: 'SNAPBACK_FIXTURE_OPAQUE_INDIRECT_ENV', kind: 'declaration' }],
  );
  assert.deepEqual(
    diagnosticSourceSites(fixture, sourceOptions)
      .filter(({ match }) => match[0] === 'SNAPBACK_FIXTURE_OPAQUE_INDIRECT_ENV'),
    [],
  );

  assert.deepEqual(
    diagnosticSourceSites(fixture, {
      ...sourceOptions,
      receivedProtocolVocabulary: true,
    })
      .filter(({ match }) => match[0].startsWith('SNAPBACK_FIXTURE_RECEIVED_PROTOCOL'))
      .map(({ match, kind }) => ({ code: match[0], kind })),
    [
      { code: 'SNAPBACK_FIXTURE_RECEIVED_PROTOCOL', kind: 'received' },
      { code: 'SNAPBACK_FIXTURE_RECEIVED_PROTOCOL_SECOND', kind: 'received' },
    ],
  );

  const workerBindingNames = [
    'SNAPBACK_FIXTURE_WORKER_BINDING',
    'SNAPBACK_FIXTURE_WORKER_OPTIONAL_BINDING',
    'SNAPBACK_FIXTURE_INJECTED_BINDING',
    'SNAPBACK_FIXTURE_INJECTED_OPTIONAL_BINDING',
    'SNAPBACK_FIXTURE_WORKER_ARROW_BINDING',
    'SNAPBACK_FIXTURE_WORKER_BARE_ARROW_BINDING',
  ];
  assert.deepEqual(
    environmentVariableSites(fixture, sourceOptions)
      .filter(({ match }) => workerBindingNames.includes(match[0]))
      .map(({ match, kind }) => ({ name: match[0], kind })),
    workerBindingNames.map((name) => ({ name, kind: 'read' })),
  );
  assert.deepEqual(
    diagnosticSourceSites(fixture, sourceOptions)
      .filter(({ match }) => workerBindingNames.includes(match[0])),
    [],
  );

  const nonEmittingMessageNames = new Set([
    'SNAPBACK_FIXTURE_JS_MESSAGE_ENV',
    'SNAPBACK_FIXTURE_PREFIXED_ENV',
    'SNAPBACK_FIXTURE_EXAMPLE_ENV',
    'SNAPBACK_FIXTURE_LIST_ENV',
    'SNAPBACK_FIXTURE_LIST_SECOND_ENV',
    'SNAPBACK_FIXTURE_PUBLICATION_PORT',
    'SNAPBACK_FIXTURE_MATCH_ARM_REFERENCE',
    'SNAPBACK_FIXTURE_MATCH_ARM_SECOND_REFERENCE',
    'SNAPBACK_FIXTURE_CATALOG_REFERENCE',
    'SNAPBACK_FIXTURE_CATALOG_SECOND_REFERENCE',
    'SNAPBACK_FIXTURE_MATCHES_REFERENCE',
    'SNAPBACK_FIXTURE_MATCHES_SECOND_REFERENCE',
    'SNAPBACK_FIXTURE_QUOTED_REFERENCE',
    'SNAPBACK_FIXTURE_JS_PREFIX',
    'SNAPBACK_FIXTURE_JS_SUFFIX',
    'SNAPBACK_FIXTURE_RUST_PREFIX',
    'SNAPBACK_FIXTURE_RUST_CONTAINS',
  ]);
  assert.deepEqual(
    diagnosticSourceSites(fixture, sourceOptions)
      .filter(({ match }) => nonEmittingMessageNames.has(match[0]))
      .map(({ match }) => match[0]),
    [],
  );

  const classifiedNames = [
    ...diagnosticSourceSites(fixture, sourceOptions),
    ...environmentVariableSites(fixture, sourceOptions),
  ].map(({ match }) => match[0]);
  assert.ok(!classifiedNames.includes('SNAPBACK_FIXTURE_NESTED__'));
  assert.ok(!classifiedNames.includes('SNAPBACK_FIXTURE_ORIGIN'));
  assert.ok(!classifiedNames.includes('SNAPBACK_FIXTURE_TRAILING_PREFIX_'));
});

test('generated registry retains target emitters and dynamic artifact-header emitters', () => {
  const registry = JSON.parse(readFileSync(resolve(
    import.meta.dirname,
    '../guide/reference/diagnostics-registry.json',
  ), 'utf8'));

  const cloudflareCodes = [
    'SNAPBACK_ACTION_STREAM_CANCELLED',
    'SNAPBACK_ACTION_REPLAY_DIVERGED',
    'SNAPBACK_TEST_CRON_ACTION_INTERRUPTED',
    'SNAPBACK_HOST_FETCH_DESTINATION_INVALID',
    'SNAPBACK_HOST_FETCH_DESTINATION_REFUSED',
    'SNAPBACK_HOST_FETCH_REDIRECT_REFUSED',
  ];
  for (const code of cloudflareCodes) {
    const sites = registry.diagnostics[code]?.sites.filter(
      (site) => site.file.startsWith('targets/cloudflare/src/'),
    ) ?? [];
    assert.ok(sites.length > 0, `${code} must retain a Cloudflare production emitting site`);
    assert.ok(sites.every((site) => site.kind === undefined));
  }

  const artifactHeaderCodes = [
    'SNAPBACK_STALE_SCHEMA_ARTIFACT_KIND',
    'SNAPBACK_STALE_SCHEMA_ARTIFACT_VERSION',
    'SNAPBACK_STALE_FUNCTION_ARTIFACT_KIND',
    'SNAPBACK_STALE_FUNCTION_ARTIFACT_VERSION',
  ];
  for (const code of artifactHeaderCodes) {
    const sites = registry.diagnostics[code]?.sites.filter(
      (site) => site.file === 'crates/snapback-types/src/manifest/mod.rs',
    ) ?? [];
    assert.equal(sites.length, 1, `${code} must have one artifact-header emitting site`);
    assert.equal(sites[0].kind, undefined, `${code} must use the normal emission site kind`);
  }

  const demandMismatchSites = registry.diagnostics
    .SNAPBACK_GRAPH_DEMAND_IDENTITY_MISMATCH.sites.filter(
      (site) => site.file === 'crates/snapback-kernel/src/live_matcher.rs',
    );
  assert.equal(demandMismatchSites.length, 1);
  assert.equal(demandMismatchSites[0].kind, undefined);
  assert.equal(registry.diagnostics.SNAPBACK_GRAPH_DEMAND_IDENTITY_TRACE, undefined);
  assert.ok(registry.environment.SNAPBACK_GRAPH_DEMAND_IDENTITY_TRACE);

  assert.equal(registry.diagnostics.SNAPBACK_DERIVED_INSTANCE_ID, undefined);
  assert.deepEqual(
    registry.environment.SNAPBACK_DERIVED_INSTANCE_ID.sites.map(({ file, kind }) => ({ file, kind })),
    [{ file: 'targets/cloudflare/src/network-profile.js', kind: 'declaration' }],
  );

  for (const binding of [
    'SNAPBACK_SUBSCRIPTION_PER_CONNECTION_LIMIT',
    'SNAPBACK_SUBSCRIPTION_ARGS_BYTES',
    'SNAPBACK_SOCKETS_PER_CONNECTION_LIMIT',
  ]) {
    assert.equal(registry.diagnostics[binding], undefined, `${binding} is not a diagnostic`);
    assert.ok(registry.environment[binding], `${binding} is an environment variable`);
  }

  const acceptedSocketDiagnosticSites = registry.diagnostics
    .SNAPBACK_ACCEPTED_SOCKET_LIMIT.sites.filter(
      (site) => site.file === 'targets/cloudflare/src/coordinator.js',
    );
  assert.equal(acceptedSocketDiagnosticSites.length, 2);
  const coordinator = readFileSync(resolve(
    import.meta.dirname,
    '../targets/cloudflare/src/coordinator.js',
  ), 'utf8').split('\n');
  assert.ok(acceptedSocketDiagnosticSites.every((site) => (
    /\b(?:kitError|requestDiagnostic)\s*\(/u.test(
      coordinator.slice(Math.max(0, site.line - 3), site.line).join('\n'),
    )
  )));
  assert.equal(
    registry.environment.SNAPBACK_ACCEPTED_SOCKET_LIMIT.sites.filter(
      (site) => site.file === 'targets/cloudflare/src/coordinator.js',
    ).length,
    1,
  );

  for (const [file, code] of [
    ['packages/snapback-harness/allowlist-install.js', 'SNAPBACK_TEXT_DECODER_INSTALL_FAILED'],
    ['packages/snapback-expo/config-plugin.cjs', 'SNAPBACK_EXPO_DESCRIPTOR_PATH_INVALID'],
    ['targets/cloudflare/config-set.mjs', 'SNAPBACK_CONFIG_DEADLINE_EXCEEDED'],
    ['targets/cloudflare/locked-wrangler.mjs', 'SNAPBACK_WRANGLER_PRECHECK_FAILED'],
  ]) {
    assert.ok(
      registry.diagnostics[code]?.sites.some((site) => site.file === file),
      `${code} must retain its shipped source ${file}`,
    );
  }

  assert.deepEqual(
    registry.diagnostics.SNAPBACK_SEED_MEMBERSHIP_BOOTSTRAP_UNSUPPORTED.sites
      .filter((site) => site.kind === 'reserved')
      .map(({ file, kind }) => ({ file, kind })),
    [{ file: 'crates/snapback-kernel/src/storage/schema_seed.rs', kind: 'reserved' }],
  );

  const tigrisRoleCodes = [
    'SNAPBACK_HOSTED_TARGET_TIGRIS_ARTIFACT_PARTIAL',
    'SNAPBACK_HOSTED_TARGET_TIGRIS_AUDIT_PARTIAL',
    'SNAPBACK_HOSTED_TARGET_TIGRIS_BACKUP_PARTIAL',
    'SNAPBACK_HOSTED_TARGET_TIGRIS_CLEANUP_PARTIAL',
    'SNAPBACK_HOSTED_TARGET_TIGRIS_CONTROL_STATE_PARTIAL',
    'SNAPBACK_HOSTED_TARGET_TIGRIS_LOGS_PARTIAL',
  ];
  for (const code of tigrisRoleCodes) {
    assert.ok(registry.diagnostics[code], `${code} must be registered`);
  }
  assert.equal(
    registry.diagnostics['SNAPBACK_HOSTED_TARGET_TIGRIS_CONTROL-STATE_PARTIAL'],
    undefined,
  );

  for (const code of [
    'SNAPBACK_AUTH_SESSION_REVOKED',
    'SNAPBACK_AUTH_FAMILY_REVOKED',
    'SNAPBACK_CLIENT_UPGRADE_REQUIRED',
  ]) {
    assert.ok(
      registry.diagnostics[code]?.sites.some((site) => site.kind === 'received'),
      `${code} must retain a received protocol site`,
    );
  }

  for (const code of [
    'SNAPBACK_AUTH_MODE_CHANGED',
    'SNAPBACK_OPERATION_CANCELLED',
    'SNAPBACK_ADMIN_SECRET_READ_MINT_DENIED',
    'SNAPBACK_API_BUDGETS_UNAVAILABLE',
    'SNAPBACK_AUTHORITY_ROSTER_CURSOR_INVALID',
    'SNAPBACK_BRANCH_CAPTURE_ONLY_MISSING',
    'SNAPBACK_PROMOTION_EFFECT_INTENT_MISSING',
    'SNAPBACK_SCHEMA_UNIQUE_INDEX_OPTIONAL_FIELD',
    'SNAPBACK_UNSUPPORTED_BLOB',
  ]) {
    assert.ok(
      registry.diagnostics[code]?.sites.some((site) => (
        site.file === 'crates/snapback-server/src/server/api_error.rs'
        && site.kind === 'reserved'
      )),
      `${code} must retain its HTTP-table reservation`,
    );
  }

  assert.deepEqual(
    Object.keys(registry.diagnostics).filter((code) => code.endsWith('_')),
    [],
  );
});

test('diagnostic source classifier retains explicit historical reservations', () => {
  const source = [
    '// diagnostics-registry: reserved',
    '// `SNAPBACK_FIXTURE_RETIRED` is retained for historical records.',
  ].join('\n');

  assert.deepEqual(
    diagnosticSourceSites(source).map(({ match, kind }) => ({ code: match[0], kind })),
    [{ code: 'SNAPBACK_FIXTURE_RETIRED', kind: 'reserved' }],
  );
});

test('diagnostic source classifier retains explicitly marked received vocabulary', () => {
  const source = [
    '// diagnostics-registry: received',
    "const ambiguousReceivedCode = 'SNAPBACK_FIXTURE_AMBIGUOUS_RECEIVED';",
  ].join('\n');

  assert.deepEqual(
    diagnosticSourceSites(source).map(({ match, kind }) => ({ code: match[0], kind })),
    [{ code: 'SNAPBACK_FIXTURE_AMBIGUOUS_RECEIVED', kind: 'received' }],
  );
});
