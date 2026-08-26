import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
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

  assert.equal([...fixture.matchAll(/SNAPBACK_[A-Z0-9_]+/gu)].length, 87);

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
      .map(({ match, kind, synthetic }) => ({ code: match[0], kind, synthetic })),
    [...nestedEmissionNames].map((code) => ({
      code,
      kind: 'emission',
      ...(code.startsWith('SNAPBACK_FIXTURE_MARKED_') || code.endsWith('_SYNTHETIC_DYNAMIC')
        ? { synthetic: true }
        : { synthetic: undefined }),
    })),
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
    ['SNAPBACK_FIXTURE_STAGE_SECRETS_WRITE', 'write'],
    ['SNAPBACK_FIXTURE_SET_SECRETS_WRITE', 'write'],
    ['SNAPBACK_FIXTURE_FLYCTL_SECRETS_WRITE', 'write'],
    ['SNAPBACK_FIXTURE_MARKED_ENV_WRITE', 'write'],
  ]);
  assert.deepEqual(
    environmentVariableSites(fixture, sourceOptions)
      .filter(({ match }) => environmentMutationKinds.has(match[0]))
      .map(({ match, kind }) => ({ name: match[0], kind })),
    [...environmentMutationKinds].map(([name, kind]) => ({ name, kind })),
  );

  const canonicalReadSites = new Map([
    ['SNAPBACK_FIXTURE_RUST_TRACE', 'if std::env::var_os("SNAPBACK_FIXTURE_RUST_TRACE").is_some() {'],
    ['SNAPBACK_FIXTURE_JS_TRACE', 'const trace = process.env.SNAPBACK_FIXTURE_JS_TRACE;'],
  ]);
  assert.deepEqual(
    environmentVariableSites(fixture, sourceOptions)
      .filter(({ match }) => canonicalReadSites.has(match[0]))
      .map(({ match, kind }) => ({
        name: match[0],
        line: fixture.slice(
          fixture.lastIndexOf('\n', match.index - 1) + 1,
          fixture.indexOf('\n', match.index),
        ),
        kind,
      })),
    [...canonicalReadSites].map(([name, line]) => ({ name, line, kind: 'read' })),
  );

  const helperArgumentEnvironmentNames = [
    'SNAPBACK_PACKAGED_STORE_QUALIFICATION_RECEIPT_FILE',
    'SNAPBACK_RUNTIME_LINUX_X64_QUALIFICATION_RECEIPT',
  ];
  assert.deepEqual(
    environmentVariableSites(fixture, sourceOptions)
      .filter(({ match }) => helperArgumentEnvironmentNames.includes(match[0]))
      .map(({ match, kind }) => ({ name: match[0], kind })),
    helperArgumentEnvironmentNames.map((name) => ({ name, kind: 'read' })),
  );
  assert.deepEqual(
    diagnosticSourceSites(fixture, sourceOptions)
      .filter(({ match }) => helperArgumentEnvironmentNames.includes(match[0])),
    [],
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
    'SNAPBACK_FIXTURE_JS_INCLUDES_REFERENCE',
    'SNAPBACK_FIXTURE_JS_INDEX_OF_REFERENCE',
    'SNAPBACK_FIXTURE_RUST_PREFIX',
    'SNAPBACK_FIXTURE_RUST_CONTAINS',
    'SNAPBACK_FIXTURE_SINGLETON_METADATA_REFERENCE',
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

test('JavaScript tokenizer skips regex literals but preserves division and template expressions', () => {
  const fixture = readFileSync(resolve(
    import.meta.dirname,
    '../tests/fixtures/diagnostics-registry/javascript-lexical-boundaries.mjs',
  ), 'utf8');
  assert.match(fixture, /const quote = \/\["\]\/[;] throw new Error\("SNAPBACK_FIXTURE_REAL"\);/u);
  assert.match(fixture, /const quotient = a \/ b \/ c;/u);
  assert.deepEqual(
    diagnosticSourceSites(fixture, { javascript: true })
      .map(({ match, kind }) => ({ code: match[0], kind })),
    [
      { code: 'SNAPBACK_FIXTURE_REAL', kind: 'emission' },
      { code: 'SNAPBACK_FIXTURE_DIVISION_REAL', kind: 'emission' },
      { code: 'SNAPBACK_FIXTURE_TEMPLATE_REAL', kind: 'emission' },
    ],
  );
});

test('environment-name tables end at their matching closing delimiter', () => {
  const fixture = readFileSync(resolve(
    import.meta.dirname,
    '../tests/fixtures/diagnostics-registry/environment-name-table-boundary.mjs',
  ), 'utf8');

  assert.deepEqual(
    environmentVariableSites(fixture, { javascript: true })
      .map(({ match, kind }) => ({ name: match[0], kind })),
    [{ name: 'SNAPBACK_FOO_ENV', kind: 'table-entry' }],
  );
  assert.deepEqual(
    diagnosticSourceSites(fixture, { javascript: true })
      .map(({ match, kind }) => ({ code: match[0], kind })),
    [{ code: 'SNAPBACK_REAL_FAILURE', kind: 'emission' }],
  );
});

test('Rust match-arm references scan an entire brace-bounded or-pattern', () => {
  const firstCode = 'SNAPBACK_FIXTURE_LONG_MATCH_ARM_FIRST';
  const longRustOrPatternFixture = [
    'let status = match code {',
    `  "${firstCode}"`,
    ...Array.from({ length: 256 }, (_, index) => (
      `  | "SNAPBACK_FIXTURE_LONG_MATCH_ARM_PADDING_${String(index).padStart(4, '0')}"`
    )),
    '  => StatusCode::BAD_REQUEST,',
    '};',
  ].join('\n');
  assert.ok(
    longRustOrPatternFixture.indexOf('=>') - longRustOrPatternFixture.indexOf(firstCode) > 8192,
  );
  assert.equal(
    diagnosticSourceSites(longRustOrPatternFixture)
      .some(({ match }) => match[0] === firstCode),
    false,
  );
});

test('generated registry retains target emitters and dynamic artifact-header emitters', () => {
  const registry = JSON.parse(readFileSync(resolve(
    import.meta.dirname,
    '../guide/reference/diagnostics-registry.json',
  ), 'utf8'));

  const cloudflareCodes = [
    'SNAPBACK_ACTION_STREAM_CANCELLED',
    'SNAPBACK_ACTION_REPLAY_DIVERGED',
    'SNAPBACK_CONNECTION_SESSION_REPLACED',
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
    assert.ok(
      sites.some((site) => site.kind === undefined),
      `${code} must retain an emission when the same target also receives it`,
    );
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
    assert.equal(sites[0].synthetic, true, `${code} must identify its dynamic site`);
    assert.notEqual(
      readFileSync(resolve(import.meta.dirname, '..', sites[0].file), 'utf8')
        .split('\n')[sites[0].line - 1]
        .trimStart()
        .startsWith('//'),
      true,
      `${code} must attach to code rather than the marker comment`,
    );
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

  for (const name of ['SNAPBACK_GENERATED_AT_MS', 'SNAPBACK_OUTBOUND_ACTIONS']) {
    assert.equal(registry.diagnostics[name], undefined, `${name} is not received diagnostics`);
    assert.ok(registry.environment[name], `${name} remains environment vocabulary`);
  }

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

  for (const [file, code] of [
    [
      'packages/snapback-expo-custody/ios/SnapbackExpoCustodyCore.swift',
      'SNAPBACK_AUTH_CUSTODY_EXTENSION_IO_OCCURRED',
    ],
    [
      'packages/snapback-expo-custody/android/src/main/java/expo/modules/snapbackcustody/SnapbackExpoCustodyModule.kt',
      'SNAPBACK_AUTH_CUSTODY_SECONDARY_PROCESS_IO_OCCURRED',
    ],
  ]) {
    assert.ok(
      registry.diagnostics[code]?.sites.some((site) => site.file === file),
      `${code} must retain its shipped native source ${file}`,
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
    'SNAPBACK_HOSTED_TARGET_TIGRIS_LOGS_PARTIAL',
  ];
  for (const code of tigrisRoleCodes) {
    assert.deepEqual(
      registry.diagnostics[code]?.sites.map(({ file, kind, synthetic }) => ({
        file,
        kind,
        synthetic,
      })),
      [{
        file: 'packages/snapback-hosted-supervisor/target-onboarding.mjs',
        kind: undefined,
        synthetic: true,
      }],
      `${code} must retain its finite dynamic-emission site`,
    );
    const [site] = registry.diagnostics[code].sites;
    assert.match(
      readFileSync(resolve(import.meta.dirname, '..', site.file), 'utf8')
        .split('\n')[site.line - 1],
      /^\s*throw new Error\(/u,
      `${code} must attach to the dynamic throw statement`,
    );
  }
  assert.equal(registry.diagnostics.SNAPBACK_HOSTED_TARGET_TIGRIS_CONTROL_STATE_PARTIAL, undefined);
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
    'SNAPBACK_ADMIN_SECRET_READ_MINT_DENIED',
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

  assert.ok(
    registry.diagnostics.SNAPBACK_OPERATION_CANCELLED?.sites.some((site) => (
      site.file === 'crates/snapback-types/src/error_tracking.rs'
      && site.kind === 'received'
    )),
    'SNAPBACK_OPERATION_CANCELLED must retain its cancellation-classifier receive table',
  );
  assert.equal(
    registry.diagnostics.SNAPBACK_OPERATION_CANCELLED.sites.some(
      (site) => site.kind === 'reserved',
    ),
    false,
    'SNAPBACK_OPERATION_CANCELLED is not an HTTP-table-only reservation',
  );

  assert.ok(
    registry.diagnostics.SNAPBACK_API_BUDGETS_UNAVAILABLE?.sites.some((site) => (
      site.file === 'packages/snapback-codegen/index.mjs'
      && site.kind === 'received'
    )),
    'SNAPBACK_API_BUDGETS_UNAVAILABLE must retain its shipped codegen receive table',
  );
  assert.equal(
    registry.diagnostics.SNAPBACK_API_BUDGETS_UNAVAILABLE.sites.some(
      (site) => site.kind === 'reserved',
    ),
    false,
    'SNAPBACK_API_BUDGETS_UNAVAILABLE is not an HTTP-table-only reservation',
  );

  for (const [name, file] of [
    [
      'SNAPBACK_PACKAGED_STORE_QUALIFICATION_RECEIPT_FILE',
      'packages/snapback-runtime-darwin-arm64/prepare-runtime.mjs',
    ],
    [
      'SNAPBACK_RUNTIME_LINUX_X64_QUALIFICATION_RECEIPT',
      'packages/snapback-runtime-linux-x64/prepare-runtime.mjs',
    ],
  ]) {
    assert.equal(registry.diagnostics[name], undefined, `${name} is not a diagnostic`);
    assert.ok(
      registry.environment[name]?.sites.some((site) => site.file === file && site.kind === 'read'),
      `${name} must retain its indirect helper-argument environment read`,
    );
  }

  assert.deepEqual(
    registry.diagnostics.SNAPBACK_INVALID_FLOAT?.sites.map(({ file, kind }) => ({ file, kind })),
    [{ file: 'crates/snapback-types/src/error_tracking.rs', kind: 'received' }],
  );
  assert.ok(
    registry.diagnostics.SNAPBACK_ARG_MISSING.sites.some(({ file, kind }) => (
      file === 'crates/snapback-types/src/value_expr.rs' && kind === undefined
    )),
  );

  assert.equal(registry.diagnostics.SNAPBACK_SHUTDOWN_CHECKPOINT_TIMEOUT_MS, undefined);
  assert.deepEqual(
    registry.environment.SNAPBACK_SHUTDOWN_CHECKPOINT_TIMEOUT_MS.sites
      .map(({ file, kind }) => ({ file, kind })),
    [{
      file: 'crates/snapback-cli/src/cli.rs',
      kind: 'read',
    }, {
      file: 'crates/snapback-server/src/server/api_error.rs',
      kind: 'mention',
    }],
  );

  assert.deepEqual(
    registry.diagnostics.SNAPBACK_HANDLER_AMBIENT_CAPABILITY_DENIED.sites
      .filter(({ file }) => /^targets\/[^/]+\/app\//u.test(file)),
    [],
    'target app bundles are application fixtures, not production framework emitters',
  );

  for (const name of [
    'SNAPBACK_SUPERVISOR_TARGET_CLIENT_KEY',
    'SNAPBACK_SUPERVISOR_TARGET_CLIENT_CERT',
    'SNAPBACK_SUPERVISOR_SERVER_CA',
  ]) {
    assert.equal(registry.diagnostics[name], undefined, `${name} is not a diagnostic`);
    assert.deepEqual(
      registry.environment[name].sites.map(({ file, kind }) => ({ file, kind })),
      [{ file: 'packages/snapback-hosted-supervisor/target-onboarding.mjs', kind: 'write' }],
    );
  }

  assert.deepEqual(
    Object.keys(registry.diagnostics).filter((code) => code.endsWith('_')),
    [],
  );
});

test('diagnostic source classifier retains explicit historical reservations', () => {
  const source = [
    '// diagnostics-registry: reserved SNAPBACK_FIXTURE_RETIRED',
    "const historicalCodes = ['SNAPBACK_FIXTURE_RETIRED', 'SNAPBACK_FIXTURE_UNRELATED'];",
  ].join('\n');

  assert.deepEqual(
    diagnosticSourceSites(source).map(({ match, kind }) => ({ code: match[0], kind })),
    [{ code: 'SNAPBACK_FIXTURE_RETIRED', kind: 'reserved' }],
  );
});

test('diagnostic source classifier retains explicitly marked received vocabulary', () => {
  const source = [
    '// diagnostics-registry: received SNAPBACK_FIXTURE_AMBIGUOUS_RECEIVED',
    "const ambiguousReceivedCode = 'SNAPBACK_FIXTURE_AMBIGUOUS_RECEIVED';",
  ].join('\n');

  assert.deepEqual(
    diagnosticSourceSites(source).map(({ match, kind }) => ({ code: match[0], kind })),
    [{ code: 'SNAPBACK_FIXTURE_AMBIGUOUS_RECEIVED', kind: 'received' }],
  );
});

test('received protocol classifier follows shipped membership-table idioms', () => {
  const source = [
    "const SET_CODES = new Set(['SNAPBACK_FIXTURE_RECEIVED_SET']);",
    'if (SET_CODES.has(receivedCode)) accept();',
    "const ARRAY_CODES = ['SNAPBACK_FIXTURE_RECEIVED_ARRAY'];",
    'if (ARRAY_CODES.includes(receivedCode)) accept();',
    "const MAP_CODES = new Map([['SNAPBACK_FIXTURE_RECEIVED_MAP', 'accepted']]);",
    'if (MAP_CODES.has(receivedCode)) accept();',
    "const OBJECT_CODES = Object.freeze({ SNAPBACK_FIXTURE_RECEIVED_OBJECT: 'accepted' });",
    'if (receivedCode in OBJECT_CODES) accept();',
    'private static let swiftCodes: Set<String> = [',
    '  "SNAPBACK_FIXTURE_RECEIVED_SWIFT",',
    ']',
    'if Self.swiftCodes.contains(receivedCode) { accept() }',
    'pub const RUST_HELPER_CODES: &[&str] = &[',
    '  "SNAPBACK_FIXTURE_RECEIVED_RUST_HELPER",',
    '];',
    'if is_code_member(code, RUST_HELPER_CODES) { accept(); }',
    'pub const RUST_BINARY_SEARCH_CODES: &[&str] = &[',
    '  "SNAPBACK_FIXTURE_RECEIVED_RUST_BINARY_SEARCH",',
    '];',
    'if RUST_BINARY_SEARCH_CODES.binary_search(&code).is_ok() { accept(); }',
  ].join('\n');

  assert.deepEqual(
    diagnosticSourceSites(source, { receivedProtocolVocabulary: true })
      .map(({ match, kind }) => ({ code: match[0], kind })),
    [
      { code: 'SNAPBACK_FIXTURE_RECEIVED_SET', kind: 'received' },
      { code: 'SNAPBACK_FIXTURE_RECEIVED_ARRAY', kind: 'received' },
      { code: 'SNAPBACK_FIXTURE_RECEIVED_MAP', kind: 'received' },
      { code: 'SNAPBACK_FIXTURE_RECEIVED_OBJECT', kind: 'received' },
      { code: 'SNAPBACK_FIXTURE_RECEIVED_SWIFT', kind: 'received' },
      { code: 'SNAPBACK_FIXTURE_RECEIVED_RUST_HELPER', kind: 'received' },
      { code: 'SNAPBACK_FIXTURE_RECEIVED_RUST_BINARY_SEARCH', kind: 'received' },
    ],
  );
});

test('same-line named markers retain only their target site', () => {
  for (const [marker, kind] of [
    ['emission', 'emission'],
    ['reserved', 'reserved'],
    ['received', 'received'],
  ]) {
    const code = `SNAPBACK_FIXTURE_SAME_LINE_${marker.toUpperCase()}`;
    const source = `const value = "${code}"; // diagnostics-registry: ${marker} ${code}`;
    const sites = diagnosticSourceSites(source);
    assert.deepEqual(
      sites.map(({ match, kind: siteKind }) => ({
        code: match[0],
        column: match.index + 1,
        kind: siteKind,
        synthetic: sites[0].synthetic,
      })),
      [{ code, column: source.indexOf(code) + 1, kind, synthetic: undefined }],
    );
  }
});

test('environment helper discovery rejects language keywords', () => {
  const fixture = [
    'if (name) { return process.env[name]; }',
    "if ('SNAPBACK_FIXTURE_KEYWORD_IF') {}",
    'while (name) { return process.env[name]; }',
    "while ('SNAPBACK_FIXTURE_KEYWORD_WHILE') {}",
    'for (name) { return process.env[name]; }',
    "for ('SNAPBACK_FIXTURE_KEYWORD_FOR') {}",
    'switch (name) { return process.env[name]; }',
    "switch ('SNAPBACK_FIXTURE_KEYWORD_SWITCH') {}",
    'catch (name) { return process.env[name]; }',
    "catch ('SNAPBACK_FIXTURE_KEYWORD_CATCH') {}",
    'return (name) => process.env[name];',
    "return ('SNAPBACK_FIXTURE_KEYWORD_RETURN');",
    'match (name) { return process.env[name]; }',
    "match ('SNAPBACK_FIXTURE_KEYWORD_MATCH') {}",
  ].join('\n');

  assert.deepEqual(environmentVariableSites(fixture), []);
});

test('synthetic emission markers attach to the following statement', () => {
  const fixture = [
    '// diagnostics-registry: emission SNAPBACK_FIXTURE_DYNAMIC_THROW',
    'throw new Error(dynamicCode);',
  ].join('\n');
  const [site] = diagnosticSourceSites(fixture);
  assert.equal(site.match[0], 'SNAPBACK_FIXTURE_DYNAMIC_THROW');
  assert.equal(site.match.index, fixture.indexOf('throw'));
  assert.equal(site.kind, 'emission');
  assert.equal(site.synthetic, true);
});

test('generated diagnostics registry projections are current', () => {
  const generator = resolve(import.meta.dirname, 'generate-diagnostics-registry.mjs');
  const output = execFileSync(process.execPath, [generator, '--check'], {
    cwd: resolve(import.meta.dirname, '..'),
    encoding: 'utf8',
  });
  assert.match(output, /^\[diagnostics-registry\] ok — /u);
});
