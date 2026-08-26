import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import test from 'node:test';

import {
  diagnosticCodeMatches,
  diagnosticSourceSites,
  environmentVariableSites,
  indirectEnvironmentReadContracts,
  rustExternalTestModulePaths,
  sourceImportsOrQualifiesConstant,
  wholeStringDiagnosticDeclarations,
} from './diagnostics-registry-source.mjs';
import {
  codeRemovalProblems,
  registryRemovalProblems,
} from './diagnostics-registry-removals.mjs';

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

function sourceLinesContaining(repoPath, expression) {
  return readFileSync(resolve(import.meta.dirname, '..', repoPath), 'utf8')
    .split('\n')
    .flatMap((line, index) => line.includes(expression) ? [index + 1] : []);
}

test('diagnostic removal allowlist requires a classified, explained justification', () => {
  const previous = new Set(['SNAPBACK_FIXTURE_OLD_CODE']);
  const current = new Set();
  assert.deepEqual(
    codeRemovalProblems(previous, current, {
      schemaVersion: 'snapback-diagnostics-code-removals.v1',
      removals: {},
    }),
    ['SNAPBACK_FIXTURE_OLD_CODE: missing checked-in removal justification'],
  );
  assert.deepEqual(
    codeRemovalProblems(previous, current, {
      schemaVersion: 'snapback-diagnostics-code-removals.v1',
      removals: {
        SNAPBACK_FIXTURE_OLD_CODE: {
          reason: 'test-only',
          detail: 'The only emitter is compiled exclusively by #[cfg(test)].',
        },
      },
    }),
    [],
  );
  const existingJustification = {
    reason: 'test-only',
    detail: 'The only emitter is compiled exclusively by #[cfg(test)].',
  };
  assert.deepEqual(
    codeRemovalProblems(
      previous,
      current,
      {
        schemaVersion: 'snapback-diagnostics-code-removals.v1',
        removals: { SNAPBACK_FIXTURE_OLD_CODE: existingJustification },
      },
      { removals: { SNAPBACK_FIXTURE_OLD_CODE: existingJustification } },
    ),
    ['SNAPBACK_FIXTURE_OLD_CODE: removal justification was not added or revised with this change'],
  );
  assert.deepEqual(
    codeRemovalProblems(
      new Set(),
      new Set(['SNAPBACK_FIXTURE_NOT_REMOVED']),
      {
        schemaVersion: 'snapback-diagnostics-code-removals.v1',
        removals: {
          SNAPBACK_FIXTURE_NOT_REMOVED: {
            reason: 'environment',
            detail: 'This entry does not describe a historical diagnostic removal.',
          },
        },
      },
    ),
    ['SNAPBACK_FIXTURE_NOT_REMOVED: unused checked-in removal justification'],
  );
  assert.deepEqual(
    codeRemovalProblems(
      new Set(),
      new Set(),
      {
        schemaVersion: 'snapback-diagnostics-code-removals.v1',
        removals: {
          SNAPBACK_FIXTURE_NEVER_BASELINE_DIAGNOSTIC: {
            reason: 'reference-only',
            detail: 'This new ledger key never named a baseline diagnostic.',
          },
        },
      },
    ),
    ['SNAPBACK_FIXTURE_NEVER_BASELINE_DIAGNOSTIC: unused checked-in removal justification'],
  );
});

test('diagnostic removal reasons agree with classifier emitter regions', () => {
  const referenceCode = 'SNAPBACK_FIXTURE_REFERENCE_REASON';
  const testCode = 'SNAPBACK_FIXTURE_TEST_REASON';
  const fixture = [
    `fn production() { println!("${referenceCode}"); }`,
    '#[cfg(test)]',
    `fn test_only() { println!("${testCode}"); }`,
  ].join('\n');
  const production = new Set(diagnosticSourceSites(fixture, {
    excludeRustTestRegions: true,
    ordinaryMultiline: true,
  }).filter(({ kind }) => kind === 'emission')
    .map(({ match }) => `${match[0]}\0${match.index}`));
  const evidence = new Map([
    [referenceCode, { production: ['fixture.rs:1'], test: [] }],
    [testCode, {
      production: [],
      test: diagnosticSourceSites(fixture, { ordinaryMultiline: true })
        .filter(({ match, kind }) => (
          kind === 'emission'
          && match[0] === testCode
          && !production.has(`${match[0]}\0${match.index}`)
        ))
        .map(() => 'fixture.rs:3'),
    }],
  ]);
  const removal = (code, reason) => codeRemovalProblems(
    new Set([code]),
    new Set(),
    {
      schemaVersion: 'snapback-diagnostics-code-removals.v1',
      removals: {
        [code]: { reason, detail: `Classifier-backed ${reason} fixture reason.` },
      },
    },
    { removals: {} },
    evidence,
  );

  assert.deepEqual(removal(referenceCode, 'reference-only'), [
    `${referenceCode}: reference-only removal has a classified emitter at fixture.rs:1`,
  ]);
  assert.deepEqual(removal(testCode, 'test-only'), []);
  assert.deepEqual(removal(referenceCode, 'test-only'), [
    `${referenceCode}: test-only removal has no classified test-region emitter`,
  ]);

  const repoRoot = resolve(import.meta.dirname, '..');
  const sourcePath = 'crates/snapback-engine/src/local/authorization_acceptance.rs';
  const source = readFileSync(resolve(repoRoot, sourcePath), 'utf8');
  const codes = [
    'SNAPBACK_AUTH_ACCEPTANCE_SERVER_RECEIPT',
    'SNAPBACK_AUTH_ACCEPTANCE_SERVER_REPLAY',
  ];
  const productionSites = new Set(diagnosticSourceSites(source, {
    excludeRustTestRegions: true,
    ordinaryMultiline: true,
  }).filter(({ kind }) => kind === 'emission')
    .map(({ match }) => `${match[0]}\0${match.index}`));
  const actualEvidence = new Map(codes.map((code) => [code, { production: [], test: [] }]));
  for (const { match, kind } of diagnosticSourceSites(source, { ordinaryMultiline: true })) {
    if (kind !== 'emission' || !actualEvidence.has(match[0])) continue;
    const region = productionSites.has(`${match[0]}\0${match.index}`) ? 'production' : 'test';
    const line = source.slice(0, match.index).split('\n').length;
    actualEvidence.get(match[0])[region].push(`${sourcePath}:${line}`);
  }
  const ledger = JSON.parse(readFileSync(resolve(
    repoRoot,
    'scripts/diagnostics-registry-code-removals.json',
  ), 'utf8'));
  const removals = Object.fromEntries(codes.map((code) => [code, ledger.removals[code]]));
  assert.deepEqual(
    codeRemovalProblems(
      new Set(codes),
      new Set(),
      { schemaVersion: ledger.schemaVersion, removals },
      { removals: {} },
      actualEvidence,
    ),
    [],
  );
});

test('generated registry never silently loses a previously committed diagnostic code', () => {
  const repoRoot = resolve(import.meta.dirname, '..');
  const registryPath = 'guide/reference/diagnostics-registry.json';
  const allowlistPath = 'scripts/diagnostics-registry-code-removals.json';
  const problems = registryRemovalProblems(repoRoot, registryPath, allowlistPath);
  assert.deepEqual(
    problems,
    [],
    `diagnostic codes disappeared from the previous committed registry:\n${problems.join('\n')}`,
  );
});

test('diagnostic removal guard accepts its historical ledger after HEAD lands on origin/main', (t) => {
  const repoRoot = mkdtempSync(resolve(tmpdir(), 'snapback-diagnostics-landed-history-'));
  const registryPath = 'guide/reference/diagnostics-registry.json';
  const allowlistPath = 'scripts/diagnostics-registry-code-removals.json';
  const registryFile = resolve(repoRoot, registryPath);
  const allowlistFile = resolve(repoRoot, allowlistPath);
  const git = (...args) => execFileSync('git', args, {
    cwd: repoRoot,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  }).trim();
  try {
    git('init', '-b', 'main');
    git('config', 'user.name', 'Diagnostics Registry Test');
    git('config', 'user.email', 'diagnostics-registry@example.invalid');
    mkdirSync(resolve(repoRoot, 'guide/reference'), { recursive: true });
    mkdirSync(resolve(repoRoot, 'scripts'), { recursive: true });
    writeFileSync(registryFile, `${JSON.stringify({ diagnostics: {
      SNAPBACK_FIXTURE_HISTORICAL_REMOVAL: {},
    } })}\n`);
    writeFileSync(allowlistFile, `${JSON.stringify({
      schemaVersion: 'snapback-diagnostics-code-removals.v1',
      removals: {},
    })}\n`);
    git('add', '.');
    git('commit', '-m', 'baseline registry');

    writeFileSync(registryFile, `${JSON.stringify({ diagnostics: {} })}\n`);
    writeFileSync(allowlistFile, `${JSON.stringify({
      schemaVersion: 'snapback-diagnostics-code-removals.v1',
      removals: {
        SNAPBACK_FIXTURE_HISTORICAL_REMOVAL: {
          reason: 'test-only',
          detail: 'The historical emitter was compiled exclusively by #[cfg(test)].',
        },
      },
    })}\n`);
    git('add', '.');
    git('commit', '-m', 'remove diagnostic with justification');
    const landedHead = git('rev-parse', 'HEAD');
    git('update-ref', 'refs/remotes/origin/main', landedHead);
    assert.equal(git('merge-base', 'HEAD', 'origin/main'), landedHead);

    assert.deepEqual(
      registryRemovalProblems(repoRoot, registryPath, allowlistPath),
      [],
    );
    t.diagnostic('simulated HEAD == origin/main — 0 removal problems');
  } finally {
    rmSync(repoRoot, { recursive: true, force: true });
  }
});

test('diagnostic removal guard keeps its merge-base after an unrelated commit', () => {
  const repoRoot = mkdtempSync(resolve(tmpdir(), 'snapback-diagnostics-history-'));
  const registryPath = 'guide/reference/diagnostics-registry.json';
  const allowlistPath = 'scripts/diagnostics-registry-code-removals.json';
  const registryFile = resolve(repoRoot, registryPath);
  const allowlistFile = resolve(repoRoot, allowlistPath);
  const git = (...args) => execFileSync('git', args, {
    cwd: repoRoot,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  }).trim();
  try {
    git('init', '-b', 'main');
    git('config', 'user.name', 'Diagnostics Registry Test');
    git('config', 'user.email', 'diagnostics-registry@example.invalid');
    mkdirSync(resolve(repoRoot, 'guide/reference'), { recursive: true });
    mkdirSync(resolve(repoRoot, 'scripts'), { recursive: true });
    writeFileSync(registryFile, `${JSON.stringify({
      diagnostics: { SNAPBACK_FIXTURE_REMOVED: {} },
    })}\n`);
    writeFileSync(allowlistFile, `${JSON.stringify({
      schemaVersion: 'snapback-diagnostics-code-removals.v1',
      removals: {},
    })}\n`);
    git('add', '.');
    git('commit', '-m', 'baseline registry');
    const baseline = git('rev-parse', 'HEAD');
    git('update-ref', 'refs/remotes/origin/main', baseline);

    writeFileSync(registryFile, `${JSON.stringify({ diagnostics: {
      SNAPBACK_FIXTURE_REMOVED: {},
      SNAPBACK_FIXTURE_TRANSIENT: {},
    } })}\n`);
    git('add', registryPath);
    git('commit', '-m', 'add transient diagnostic');
    writeFileSync(registryFile, `${JSON.stringify({ diagnostics: {} })}\n`);
    git('add', registryPath);
    git('commit', '-m', 'remove diagnostic without justification');
    writeFileSync(resolve(repoRoot, 'unrelated.txt'), 'unrelated\n');
    git('add', 'unrelated.txt');
    git('commit', '-m', 'unrelated follow-up');

    assert.deepEqual(
      registryRemovalProblems(repoRoot, registryPath, allowlistPath),
      [
        'SNAPBACK_FIXTURE_REMOVED: missing checked-in removal justification',
      ],
    );
    git('update-ref', '-d', 'refs/remotes/origin/main');
    assert.deepEqual(
      registryRemovalProblems(repoRoot, registryPath, allowlistPath),
      [
        'SNAPBACK_FIXTURE_REMOVED: missing checked-in removal justification',
        'SNAPBACK_FIXTURE_TRANSIENT: missing checked-in removal justification',
      ],
    );
  } finally {
    rmSync(repoRoot, { recursive: true, force: true });
  }
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

  const genericEnvironmentMutationFixture = [
    'const childEnv = { ...process.env };',
    'delete childEnv.SNAPBACK_CLIENT_RQS_DIR;',
    'const delegatedEnvironment = { ...process.env };',
    'delegatedEnvironment.SNAPBACK_ADMIN_TOKEN = readToken();',
  ].join('\n');
  assert.deepEqual(
    environmentVariableSites(genericEnvironmentMutationFixture, { javascript: true })
      .map(({ match, kind }) => ({ name: match[0], kind })),
    [
      { name: 'SNAPBACK_CLIENT_RQS_DIR', kind: 'remove' },
      { name: 'SNAPBACK_ADMIN_TOKEN', kind: 'write' },
    ],
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
    'SNAPBACK_FIXTURE_LEADING_ERROR_CODE',
    'SNAPBACK_FIXTURE_PUBLICATION_PORT',
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

test('environment-name tables classify direct strings without swallowing nested emissions', () => {
  const fixture = readFileSync(resolve(
    import.meta.dirname,
    '../tests/fixtures/diagnostics-registry/environment-name-table-boundary.mjs',
  ), 'utf8');

  assert.deepEqual(
    environmentVariableSites(fixture, { javascript: true })
      .map(({ match, kind }) => ({ name: match[0], kind })),
    [
      { name: 'SNAPBACK_FOO_ENV', kind: 'table-entry' },
      { name: 'SNAPBACK_COMMENT_BRACE_ENV', kind: 'table-entry' },
      { name: 'SNAPBACK_STRING_BRACE_ENV', kind: 'table-entry' },
      { name: 'SNAPBACK_REGEX_BRACE_ENV', kind: 'table-entry' },
      { name: 'SNAPBACK_AFTER_NESTED_VALUE_ENV', kind: 'table-entry' },
      { name: 'SNAPBACK_STRING_KEY_ENV', kind: 'table-entry' },
      { name: 'SNAPBACK_OBJECT_BEFORE_STRING_BRACE', kind: 'write' },
      { name: 'SNAPBACK_OBJECT_AFTER_STRING_BRACE', kind: 'write' },
    ],
  );
  assert.deepEqual(
    diagnosticSourceSites(fixture, { javascript: true })
      .map(({ match, kind }) => ({ code: match[0], kind })),
    [
      { code: 'SNAPBACK_REAL_FAILURE', kind: 'emission' },
      { code: 'SNAPBACK_APP_BINDING_EXPIRED', kind: 'emission' },
      { code: 'SNAPBACK_APP_BINDING_EXPIRED', kind: 'emission' },
    ],
  );
});

test('direct environment access takes precedence over enclosing throw syntax', () => {
  const fixture = 'throw new Error(process.env["SNAPBACK_FIXTURE_ENV"])';

  assert.deepEqual(
    environmentVariableSites(fixture, { javascript: true })
      .map(({ match, kind }) => ({ name: match[0], kind })),
    [{ name: 'SNAPBACK_FIXTURE_ENV', kind: 'read' }],
  );
  assert.deepEqual(diagnosticSourceSites(fixture, { javascript: true }), []);
});

test('leading environment names in error prose remain environment vocabulary', () => {
  const fixture = [
    "throw new Error('SNAPBACK_FIXTURE_ENV is required to continue');",
    'process.env.SNAPBACK_FIXTURE_ENV;',
  ].join('\n');

  assert.deepEqual(
    environmentVariableSites(fixture, { javascript: true })
      .map(({ match, kind }) => ({ name: match[0], kind })),
    [
      { name: 'SNAPBACK_FIXTURE_ENV', kind: 'mention' },
      { name: 'SNAPBACK_FIXTURE_ENV', kind: 'read' },
    ],
  );
  assert.deepEqual(diagnosticSourceSites(fixture, { javascript: true }), []);
});

test('shell classifier retains operator emissions and environment reads only', () => {
  const fixture = [
    'app="${SNAPBACK_FIXTURE_SHELL_APP:-notes}"',
    'token="$SNAPBACK_FIXTURE_SHELL_TOKEN"',
    "literal='$SNAPBACK_FIXTURE_SHELL_LITERAL'",
    'deploy_fail SNAPBACK_FIXTURE_SHELL_DEPLOY_FAILED 2 "failed"',
    'echo "SNAPBACK_FIXTURE_SHELL_ECHO_FAILED field=value" >&2',
    "printf '%s\\n' SNAPBACK_FIXTURE_SHELL_PRINTF_FAILED >&2",
    'value="SNAPBACK_FIXTURE_SHELL_REFERENCE"',
    '# echo SNAPBACK_FIXTURE_SHELL_COMMENTED_FAILED',
  ].join('\n');

  assert.deepEqual(
    environmentVariableSites(fixture, { shell: true })
      .map(({ match, kind }) => ({ name: match[0], kind })),
    [
      { name: 'SNAPBACK_FIXTURE_SHELL_APP', kind: 'read' },
      { name: 'SNAPBACK_FIXTURE_SHELL_TOKEN', kind: 'read' },
    ],
  );
  assert.deepEqual(
    diagnosticSourceSites(fixture, { shell: true })
      .map(({ match, kind }) => ({ code: match[0], kind })),
    [
      { code: 'SNAPBACK_FIXTURE_SHELL_DEPLOY_FAILED', kind: 'emission' },
      { code: 'SNAPBACK_FIXTURE_SHELL_ECHO_FAILED', kind: 'emission' },
      { code: 'SNAPBACK_FIXTURE_SHELL_PRINTF_FAILED', kind: 'emission' },
    ],
  );
});

test('shell classifier recognizes environment assignment writes only in command syntax', () => {
  const fixture = [
    'SNAPBACK_FIXTURE_SHELL_PREFIX=value command',
    'export SNAPBACK_FIXTURE_SHELL_EXPORT=value',
    'env SNAPBACK_FIXTURE_SHELL_ENV=value command',
    'echo "SNAPBACK_FIXTURE_SHELL_QUOTED=value"',
    '# SNAPBACK_FIXTURE_SHELL_COMMENTED=value command',
  ].join('\n');

  assert.deepEqual(
    environmentVariableSites(fixture, { shell: true })
      .map(({ match, kind }) => ({ name: match[0], kind })),
    [
      { name: 'SNAPBACK_FIXTURE_SHELL_PREFIX', kind: 'write' },
      { name: 'SNAPBACK_FIXTURE_SHELL_EXPORT', kind: 'write' },
      { name: 'SNAPBACK_FIXTURE_SHELL_ENV', kind: 'write' },
    ],
  );
});

test('leading diagnostic tokens emit only from proven print and log arguments', () => {
  const rustFixture = [
    'println!("SNAPBACK_FIXTURE_PRINTLN field={field}");',
    'eprintln!("SNAPBACK_FIXTURE_EPRINTLN field={field}");',
    'tracing::warn!("SNAPBACK_FIXTURE_TRACING field={field}");',
    'log::error!("SNAPBACK_FIXTURE_LOG field={field}");',
  ].join('\n');
  assert.deepEqual(
    diagnosticSourceSites(rustFixture, { ordinaryMultiline: true })
      .map(({ match, kind }) => ({ code: match[0], kind })),
    [
      { code: 'SNAPBACK_FIXTURE_PRINTLN', kind: 'emission' },
      { code: 'SNAPBACK_FIXTURE_EPRINTLN', kind: 'emission' },
      { code: 'SNAPBACK_FIXTURE_TRACING', kind: 'emission' },
      { code: 'SNAPBACK_FIXTURE_LOG', kind: 'emission' },
    ],
  );

  const javascriptFixture = [
    "console.error('SNAPBACK_FIXTURE_CONSOLE_ERROR field=%s', field);",
    "console.warn('SNAPBACK_FIXTURE_CONSOLE_WARN field=%s', field);",
    "console.error(prefix, 'SNAPBACK_FIXTURE_CONSOLE_SECOND_ARGUMENT field=%s');",
    "throw new Error('SNAPBACK_FIXTURE_PRINT_PROSE_ENV is required to continue');",
    'process.env.SNAPBACK_FIXTURE_PRINT_PROSE_ENV;',
  ].join('\n');
  assert.deepEqual(
    diagnosticSourceSites(javascriptFixture, { javascript: true })
      .map(({ match, kind }) => ({ code: match[0], kind })),
    [
      { code: 'SNAPBACK_FIXTURE_CONSOLE_ERROR', kind: 'emission' },
      { code: 'SNAPBACK_FIXTURE_CONSOLE_WARN', kind: 'emission' },
    ],
  );
  assert.deepEqual(
    environmentVariableSites(javascriptFixture, { javascript: true })
      .filter(({ match }) => match[0] === 'SNAPBACK_FIXTURE_PRINT_PROSE_ENV')
      .map(({ kind }) => kind),
    ['mention', 'read'],
  );
});

test('Rust production classification excludes inline test-gated regions', () => {
  const fixture = [
    'struct FixtureFields {',
    '    #[cfg(test)]',
    '    test_only: bool,',
    '    production: bool,',
    '}',
    'pub fn production() {',
    '    let _ = std::env::var("SNAPBACK_FIXTURE_PRODUCTION_ENV");',
    '}',
    '#[cfg(test)]',
    'mod tests {',
    '    fn helper() {',
    '        let _ = std::env::var("SNAPBACK_FIXTURE_CFG_TEST_ENV");',
    '    }',
    '',
    '    #[test]',
    '    fn inline_test() {',
    '        panic!("SNAPBACK_FIXTURE_INLINE_TEST_FAILURE");',
    '    }',
    '}',
    '#[test]',
    '// @ref LLP 0053#acceptance — comments may separate the attribute and item.',
    '/// The production classifier must skip this doc comment too.',
    'fn top_level_test() {',
    '    let _ = std::env::var("SNAPBACK_FIXTURE_TOP_LEVEL_TEST_ENV");',
    '}',
    '#[cfg(test)]',
    '// A cfg(test) function is test-only even though it is not a module.',
    'fn cfg_test_function() {',
    '    panic!("SNAPBACK_FIXTURE_CFG_TEST_FUNCTION_FAILURE");',
    '}',
    'pub fn cfg_gated_statements() {',
    '    #[cfg(test)]',
    '    let fail_rebind = true;',
    '    #[cfg(test)]',
    '    if fail_rebind {',
    '        panic!("SNAPBACK_FIXTURE_CFG_TEST_STATEMENT_FAILURE");',
    '    }',
    '    match "production" {',
    '        #[cfg(test)]',
    '        "test" => panic!("SNAPBACK_FIXTURE_CFG_TEST_ARM_FAILURE"),',
    '        _ => panic!("SNAPBACK_FIXTURE_AFTER_CFG_PRODUCTION_FAILURE"),',
    '    }',
    '    let _ = std::env::var("SNAPBACK_FIXTURE_AFTER_CFG_ENV");',
    '}',
  ].join('\n');
  const options = { ordinaryMultiline: true, excludeRustTestRegions: true };

  assert.deepEqual(
    environmentVariableSites(fixture, options)
      .map(({ match, kind }) => ({ name: match[0], kind })),
    [
      { name: 'SNAPBACK_FIXTURE_PRODUCTION_ENV', kind: 'read' },
      { name: 'SNAPBACK_FIXTURE_AFTER_CFG_ENV', kind: 'read' },
    ],
  );
  assert.deepEqual(
    diagnosticSourceSites(fixture, options)
      .map(({ match, kind }) => ({ code: match[0], kind })),
    [{ code: 'SNAPBACK_FIXTURE_AFTER_CFG_PRODUCTION_FAILURE', kind: 'emission' }],
  );
});

test('Rust production classification excludes compound cfg(test) regions', () => {
  const fixture = [
    '#[cfg(all(test, feature = "fixture"))]',
    'fn all_test_fixture() { panic!("SNAPBACK_FIXTURE_CFG_ALL_TEST_FAILURE"); }',
    '#[cfg(test, feature = "fixture")]',
    'fn comma_test_fixture() { panic!("SNAPBACK_FIXTURE_CFG_COMMA_TEST_FAILURE"); }',
    '#[cfg(any(test, feature = "fixture"))]',
    'fn any_test_fixture() { panic!("SNAPBACK_FIXTURE_CFG_ANY_TEST_FAILURE"); }',
    '#[cfg(any(all(test, feature = "a"), all(test, feature = "b")))]',
    'fn every_branch_test_fixture() { panic!("SNAPBACK_FIXTURE_CFG_EVERY_BRANCH_TEST_FAILURE"); }',
    '#[cfg(all(any(test, feature = "fixture"), target_os = "linux"))]',
    'fn production_feature_branch() { panic!("SNAPBACK_FIXTURE_CFG_FEATURE_BRANCH_FAILURE"); }',
    '#[cfg(any(test, not(target_os = "linux")))]',
    'fn production_target_branch() { panic!("SNAPBACK_FIXTURE_CFG_TARGET_BRANCH_FAILURE"); }',
    'fn production_fixture() { panic!("SNAPBACK_FIXTURE_CFG_PRODUCTION_FAILURE"); }',
  ].join('\n');

  assert.deepEqual(
    diagnosticSourceSites(fixture, {
      ordinaryMultiline: true,
      excludeRustTestRegions: true,
    }).map(({ match, kind }) => ({ code: match[0], kind })),
    [
      { code: 'SNAPBACK_FIXTURE_CFG_ANY_TEST_FAILURE', kind: 'emission' },
      { code: 'SNAPBACK_FIXTURE_CFG_FEATURE_BRANCH_FAILURE', kind: 'emission' },
      { code: 'SNAPBACK_FIXTURE_CFG_TARGET_BRANCH_FAILURE', kind: 'emission' },
      { code: 'SNAPBACK_FIXTURE_CFG_PRODUCTION_FAILURE', kind: 'emission' },
    ],
  );
});

test('Rust test-attributed final match arms stop at the depth-zero closing brace', () => {
  const fixture = [
    'pub fn production_after_test_arm() {',
    '    match "test" {',
    '        #[cfg(test)]',
    '        "test" => panic!("SNAPBACK_FIXTURE_CFG_TEST_FINAL_ARM_FAILURE")',
    '    }',
    '    eprintln!("SNAPBACK_FIXTURE_AFTER_CFG_FINAL_ARM_FAILURE");',
    '}',
  ].join('\n');

  assert.deepEqual(
    diagnosticSourceSites(fixture, {
      ordinaryMultiline: true,
      excludeRustTestRegions: true,
    }).map(({ match, kind }) => ({ code: match[0], kind })),
    [{ code: 'SNAPBACK_FIXTURE_AFTER_CFG_FINAL_ARM_FAILURE', kind: 'emission' }],
  );
});

test('Rust zero-hash raw strings do not swallow following diagnostics', () => {
  const fixture = String.raw`let raw = r"ends with a backslash \";
SnapbackError::error("SNAPBACK_AFTER_RAW_STRING", "real diagnostic");
let raw_bytes = br"bytes ending with a backslash \";
SnapbackError::error("SNAPBACK_AFTER_RAW_BYTE_STRING", "real diagnostic");`;

  assert.deepEqual(
    diagnosticSourceSites(fixture, { ordinaryMultiline: true })
      .map(({ match, kind }) => ({ code: match[0], kind })),
    [
      { code: 'SNAPBACK_AFTER_RAW_STRING', kind: 'emission' },
      { code: 'SNAPBACK_AFTER_RAW_BYTE_STRING', kind: 'emission' },
    ],
  );
});

test('Rust production discovery excludes external cfg(test) modules transitively', () => {
  const fixture = 'tests/fixtures/diagnostics-registry/external-test-modules.rs';
  const fixtureRoot = resolve(import.meta.dirname, '..');

  assert.deepEqual(
    rustExternalTestModulePaths([fixture], {
      pathExists: (path) => existsSync(resolve(fixtureRoot, path)),
      readSource: (path) => readFileSync(resolve(fixtureRoot, path), 'utf8'),
    }),
    [
      'tests/fixtures/diagnostics-registry/external-test-modules/path_tests.rs',
      'tests/fixtures/diagnostics-registry/external-test-modules/tests/mod.rs',
      'tests/fixtures/diagnostics-registry/external-test-modules/tests/nested.rs',
    ],
  );
});

test('whole-string constants declare codes and flow to real diagnostic call sites', () => {
  const fixture = [
    'const CODE: &str = "SNAPBACK_FIXTURE_CONST_FLOW";',
    'const UNRESOLVED: &str = "SNAPBACK_FIXTURE_CONST_UNRESOLVED";',
    'fn refusal() -> SnapbackError {',
    '    SnapbackError::error(CODE, "fixture", "failed")',
    '}',
    'fn reference() -> &\'static str { UNRESOLVED }',
  ].join('\n');

  assert.deepEqual(
    diagnosticSourceSites(fixture, { ordinaryMultiline: true })
      .map(({ match, kind }) => ({
        code: match[0],
        line: fixture.slice(0, match.index).split('\n').length,
        kind,
      })),
    [
      { code: 'SNAPBACK_FIXTURE_CONST_FLOW', line: 1, kind: 'declaration' },
      { code: 'SNAPBACK_FIXTURE_CONST_UNRESOLVED', line: 2, kind: 'declaration' },
      { code: 'SNAPBACK_FIXTURE_CONST_FLOW', line: 4, kind: 'emission' },
    ],
  );
});

test('identifier flow excludes membership and comparison consumers', () => {
  const fixture = [
    "const LOCAL_CODE = 'SNAPBACK_FIXTURE_CONST_MEMBERSHIP';",
    'if (allowed.includes(LOCAL_CODE)) accept();',
    'if (allowed.has(LOCAL_CODE)) accept();',
    'if (allowed.contains(LOCAL_CODE)) accept();',
    'if (received === LOCAL_CODE) accept();',
    'match received { LOCAL_CODE => accept(), _ => reject() }',
    'throw codedError(LOCAL_CODE);',
  ].join('\n');

  assert.deepEqual(
    diagnosticSourceSites(fixture, { javascript: true })
      .map(({ match, kind }) => ({
        code: match[0],
        line: fixture.slice(0, match.index).split('\n').length,
        kind,
      })),
    [
      { code: 'SNAPBACK_FIXTURE_CONST_MEMBERSHIP', line: 1, kind: 'declaration' },
      { code: 'SNAPBACK_FIXTURE_CONST_MEMBERSHIP', line: 7, kind: 'emission' },
    ],
  );
});

test('identifier flow recognizes multiline throw arguments', () => {
  const fixture = [
    "const CODE = 'SNAPBACK_FIXTURE_MULTILINE_THROW';",
    'throw helper(',
    '  CODE,',
    "  'fixture detail',",
    ');',
  ].join('\n');

  assert.deepEqual(
    diagnosticSourceSites(fixture, { javascript: true })
      .map(({ match, kind }) => ({
        code: match[0],
        line: fixture.slice(0, match.index).split('\n').length,
        kind,
      })),
    [
      { code: 'SNAPBACK_FIXTURE_MULTILINE_THROW', line: 1, kind: 'declaration' },
      { code: 'SNAPBACK_FIXTURE_MULTILINE_THROW', line: 3, kind: 'emission' },
    ],
  );
});

test('identifier flow stops a semicolon-less throw at its complete expression newline', () => {
  const fixture = [
    "const ALLOWED_CODE = 'SNAPBACK_FIXTURE_THROW_ASI_REFERENCE';",
    'throw helper()',
    'values.includes(ALLOWED_CODE);',
  ].join('\n');

  assert.deepEqual(
    diagnosticSourceSites(fixture, { javascript: true })
      .map(({ match, kind }) => ({
        code: match[0],
        line: fixture.slice(0, match.index).split('\n').length,
        kind,
      })),
    [{ code: 'SNAPBACK_FIXTURE_THROW_ASI_REFERENCE', line: 1, kind: 'declaration' }],
  );
});

test('Rust identifier flow recognizes error-producing combinators but not matches references', () => {
  const fixture = [
    'pub const ENTRY_INVALID: &str = "SNAPBACK_FIXTURE_ERR_RETURN";',
    'pub const OK_OR: &str = "SNAPBACK_FIXTURE_OK_OR";',
    'pub const OK_OR_ELSE: &str = "SNAPBACK_FIXTURE_OK_OR_ELSE";',
    'pub const MAP_ERR: &str = "SNAPBACK_FIXTURE_MAP_ERR";',
    'pub const UNWRAP_ERR: &str = "SNAPBACK_FIXTURE_UNWRAP_ERR";',
    'pub const CONTEXT: &str = "SNAPBACK_FIXTURE_CONTEXT";',
    'pub const MATCH_ONLY: &str = "SNAPBACK_FIXTURE_ERR_MATCH_REFERENCE";',
    'fn refuse() -> Result<(), &\'static str> {',
    '    return Err(code::ENTRY_INVALID);',
    '    value.ok_or(code::OK_OR)?;',
    '    value.ok_or_else(|| code::OK_OR_ELSE)?;',
    '    value.map_err(|_| code::MAP_ERR)?;',
    '    value.unwrap_or_else(|_| Err(code::UNWRAP_ERR))?;',
    '    value.context(code::CONTEXT)?;',
    '}',
    'fn inspect(value: Result<(), &\'static str>) -> bool {',
    '    matches!(value, Err(code::MATCH_ONLY))',
    '}',
  ].join('\n');

  assert.deepEqual(
    diagnosticSourceSites(fixture, { ordinaryMultiline: true })
      .map(({ match, kind }) => ({
        code: match[0],
        line: fixture.slice(0, match.index).split('\n').length,
        kind,
      })),
    [
      { code: 'SNAPBACK_FIXTURE_ERR_RETURN', line: 1, kind: 'declaration' },
      { code: 'SNAPBACK_FIXTURE_OK_OR', line: 2, kind: 'declaration' },
      { code: 'SNAPBACK_FIXTURE_OK_OR_ELSE', line: 3, kind: 'declaration' },
      { code: 'SNAPBACK_FIXTURE_MAP_ERR', line: 4, kind: 'declaration' },
      { code: 'SNAPBACK_FIXTURE_UNWRAP_ERR', line: 5, kind: 'declaration' },
      { code: 'SNAPBACK_FIXTURE_CONTEXT', line: 6, kind: 'declaration' },
      { code: 'SNAPBACK_FIXTURE_ERR_MATCH_REFERENCE', line: 7, kind: 'declaration' },
      { code: 'SNAPBACK_FIXTURE_ERR_RETURN', line: 9, kind: 'emission' },
      { code: 'SNAPBACK_FIXTURE_OK_OR', line: 10, kind: 'emission' },
      { code: 'SNAPBACK_FIXTURE_OK_OR_ELSE', line: 11, kind: 'emission' },
      { code: 'SNAPBACK_FIXTURE_MAP_ERR', line: 12, kind: 'emission' },
      { code: 'SNAPBACK_FIXTURE_UNWRAP_ERR', line: 13, kind: 'emission' },
      { code: 'SNAPBACK_FIXTURE_CONTEXT', line: 14, kind: 'emission' },
    ],
  );
});

test('Rust identifier flow recognizes generic error helpers and interpolated bail codes', () => {
  const fixture = [
    'pub const VECTOR_CODE: &str = "SNAPBACK_FIXTURE_VECTOR_ERROR";',
    'pub const FORK_CODE: &str = "SNAPBACK_FIXTURE_FORK_ERROR";',
    'pub const BAIL_CODE: &str = "SNAPBACK_FIXTURE_BAIL_ERROR";',
    'fn refuse() -> anyhow::Result<()> {',
    '    vector_error(code::VECTOR_CODE, "invalid vector");',
    '    fork_error(FORK_CODE, "invalid fork");',
    '    anyhow::bail!("{BAIL_CODE}: invalid package");',
    '}',
  ].join('\n');

  assert.deepEqual(
    diagnosticSourceSites(fixture, { ordinaryMultiline: true })
      .map(({ match, kind }) => ({
        code: match[0],
        line: fixture.slice(0, match.index).split('\n').length,
        kind,
      })),
    [
      { code: 'SNAPBACK_FIXTURE_VECTOR_ERROR', line: 1, kind: 'declaration' },
      { code: 'SNAPBACK_FIXTURE_FORK_ERROR', line: 2, kind: 'declaration' },
      { code: 'SNAPBACK_FIXTURE_BAIL_ERROR', line: 3, kind: 'declaration' },
      { code: 'SNAPBACK_FIXTURE_VECTOR_ERROR', line: 5, kind: 'emission' },
      { code: 'SNAPBACK_FIXTURE_FORK_ERROR', line: 6, kind: 'emission' },
      { code: 'SNAPBACK_FIXTURE_BAIL_ERROR', line: 7, kind: 'emission' },
    ],
  );
});

test('identifier flow follows unambiguous whole-string constants across files', () => {
  const fixture = [
    'use crate::contract::WRITER_COVERAGE_GAP_CODE;',
    'fn imported() { fork_error(WRITER_COVERAGE_GAP_CODE, "gap"); }',
    'fn qualified() {',
    '    SnapbackError::error(crate::instance_fork::WRITER_COVERAGE_GAP_CODE, "fork", "gap");',
    '}',
  ].join('\n');

  assert.deepEqual(
    diagnosticSourceSites(fixture, {
      ordinaryMultiline: true,
      externalWholeStringDeclarations: [{
        code: 'SNAPBACK_FORK_WRITER_COVERAGE_GAP',
        identifier: 'WRITER_COVERAGE_GAP_CODE',
      }],
    }).map(({ match, kind }) => ({
      code: match[0],
      line: fixture.slice(0, match.index).split('\n').length,
      kind,
    })),
    [
      { code: 'SNAPBACK_FORK_WRITER_COVERAGE_GAP', line: 2, kind: 'emission' },
      { code: 'SNAPBACK_FORK_WRITER_COVERAGE_GAP', line: 4, kind: 'emission' },
    ],
  );
});

test('imported diagnostic rule tables classify declarations and follow consuming uses', () => {
  const declarationSource = readFileSync(resolve(
    import.meta.dirname,
    '../tests/fixtures/diagnostics-registry/imported-rule-table.mjs',
  ), 'utf8');
  const consumerSource = readFileSync(resolve(
    import.meta.dirname,
    '../tests/fixtures/diagnostics-registry/imported-rule-table-consumer.mjs',
  ), 'utf8');
  const declarations = wholeStringDiagnosticDeclarations(declarationSource, {
    javascript: true,
  });

  assert.deepEqual(
    diagnosticSourceSites(declarationSource, { javascript: true })
      .map(({ match, kind }) => ({ code: match[0], kind })),
    [
      { code: 'SNAPBACK_FIXTURE_IMPORTED_RULE_DIRECT', kind: 'declaration' },
      { code: 'SNAPBACK_FIXTURE_IMPORTED_RULE_INDEXED', kind: 'declaration' },
      { code: 'SNAPBACK_FIXTURE_IMPORTED_RULE_NAMED', kind: 'declaration' },
      { code: 'SNAPBACK_FIXTURE_IMPORTED_RULE_ITERATED', kind: 'declaration' },
      { code: 'SNAPBACK_FIXTURE_IMPORTED_RULE_DYNAMIC', kind: 'declaration' },
    ],
  );
  assert.deepEqual(
    diagnosticSourceSites(consumerSource, {
      externalWholeStringDeclarations: declarations,
      javascript: true,
    }).map(({ match, kind }) => ({
      code: match[0],
      kind,
      line: consumerSource.slice(0, match.index).split('\n').length,
    })),
    [
      { code: 'SNAPBACK_FIXTURE_IMPORTED_RULE_DIRECT', kind: 'emission', line: 3 },
      { code: 'SNAPBACK_FIXTURE_IMPORTED_RULE_INDEXED', kind: 'emission', line: 4 },
      { code: 'SNAPBACK_FIXTURE_IMPORTED_RULE_NAMED', kind: 'emission', line: 5 },
      { code: 'SNAPBACK_FIXTURE_IMPORTED_RULE_ITERATED', kind: 'emission', line: 7 },
      { code: 'SNAPBACK_FIXTURE_IMPORTED_RULE_DYNAMIC', kind: 'emission', line: 9 },
    ],
  );
  assert.deepEqual(
    new Set([
      ...diagnosticSourceSites(declarationSource, { javascript: true }),
      ...diagnosticSourceSites(consumerSource, {
        externalWholeStringDeclarations: declarations,
        javascript: true,
      }),
    ].map(({ match }) => match[0])),
    new Set([
      'SNAPBACK_FIXTURE_IMPORTED_RULE_DIRECT',
      'SNAPBACK_FIXTURE_IMPORTED_RULE_INDEXED',
      'SNAPBACK_FIXTURE_IMPORTED_RULE_NAMED',
      'SNAPBACK_FIXTURE_IMPORTED_RULE_ITERATED',
      'SNAPBACK_FIXTURE_IMPORTED_RULE_DYNAMIC',
    ]),
  );
});

test('cross-file constant flow ignores unrelated Rust glob imports', () => {
  const declaration = {
    code: 'SNAPBACK_FIXTURE_GLOB_IMPORT',
    identifier: 'GLOB_IMPORT_CODE',
  };
  const sites = (source) => diagnosticSourceSites(source, {
    ordinaryMultiline: true,
    externalWholeStringDeclarations: sourceImportsOrQualifiesConstant(
      source,
      declaration.identifier,
    ) ? [declaration] : [],
  }).map(({ match, kind }) => ({ code: match[0], kind }));

  assert.deepEqual(sites([
    'use crate::unrelated::*;',
    'fn false_site() { fork_error(GLOB_IMPORT_CODE, "gap"); }',
  ].join('\n')), []);
  assert.deepEqual(sites([
    'use crate::contract::GLOB_IMPORT_CODE;',
    'fn imported() { fork_error(GLOB_IMPORT_CODE, "gap"); }',
  ].join('\n')), [
    { code: 'SNAPBACK_FIXTURE_GLOB_IMPORT', kind: 'emission' },
  ]);
});

test('environment helper discovery requires environment to be a full identifier segment', () => {
  const fixture = [
    '// loadEnvironmentConfig and its case-folded twin are configuration helpers, not env objects.',
    'function loadReceipt({ receiptName, loadenvironmentConfig }) {',
    '  return loadenvironmentConfig[receiptName];',
    '}',
  ].join('\n');

  assert.deepEqual(indirectEnvironmentReadContracts(fixture), []);
});

test('Rust matches references do not swallow emissions after lifetime and char literals', () => {
  const fixture = [
    "fn inspect<'a>(value: char) {",
    '    outer(|| {',
    '        wrapper(|| {',
    '            let _ = matches!(',
    "                (value == ')', std::marker::PhantomData::<&'a str>),",
    '                (true, _),',
    '            );',
    '            SnapbackError::error(',
    '                "SNAPBACK_FIXTURE_AFTER_MATCHES_LITERALS",',
    '                "real diagnostic",',
    '                "fix",',
    '            );',
    "            let _: &'static str = \"still real code\";",
    '        });',
    '    });',
    '}',
  ].join('\n');

  assert.deepEqual(
    diagnosticSourceSites(fixture, { ordinaryMultiline: true })
      .map(({ match, kind }) => ({ code: match[0], kind })),
    [{ code: 'SNAPBACK_FIXTURE_AFTER_MATCHES_LITERALS', kind: 'emission' }],
  );
});

test('dual-role spellings classify each identifier, receive, and environment site independently', () => {
  const fixture = [
    "const DUAL_ROLE_CODE = 'SNAPBACK_FIXTURE_DUAL_ROLE_ENV_FLOW';",
    'const configured = process.env.SNAPBACK_FIXTURE_DUAL_ROLE_ENV_FLOW;',
    'const RECEIVED_CODES = [',
    "  'SNAPBACK_FIXTURE_DUAL_ROLE_ENV_FLOW',",
    '];',
    'if (RECEIVED_CODES.includes(receivedCode)) accept();',
    'match received {',
    '  "SNAPBACK_FIXTURE_DUAL_ROLE_ENV_FLOW" => accept(),',
    '  _ => reject(),',
    '}',
    'throw codedError(DUAL_ROLE_CODE);',
  ].join('\n');
  const options = {
    javascript: true,
    ordinaryMultiline: true,
    receivedProtocolVocabulary: true,
  };

  assert.deepEqual(
    diagnosticSourceSites(fixture, options)
      .map(({ match, kind }) => ({
        line: fixture.slice(0, match.index).split('\n').length,
        kind,
      })),
    [
      { line: 1, kind: 'declaration' },
      { line: 4, kind: 'received' },
      { line: 11, kind: 'emission' },
    ],
  );
  assert.deepEqual(
    environmentVariableSites(fixture, options)
      .map(({ match, kind }) => ({
        line: fixture.slice(0, match.index).split('\n').length,
        kind,
      })),
    [{ line: 2, kind: 'read' }],
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
  const diagnosticTypes = readFileSync(resolve(
    import.meta.dirname,
    '../packages/snapback-client/diagnostic-codes.d.mts',
  ), 'utf8');
  const codegenSource = readFileSync(resolve(
    import.meta.dirname,
    '../packages/snapback-codegen/index.mjs',
  ), 'utf8');
  const lineAt = (offset) => codegenSource.slice(0, offset).split('\n').length;
  const graphOrderStart = codegenSource.indexOf('const GRAPH_SOURCE_FAULT_ORDER');
  const graphOrderEnd = codegenSource.indexOf(']);', graphOrderStart) + 3;
  const graphReceiverStart = codegenSource.indexOf(
    'const DEFINITION_EVALUATION_DIAGNOSTIC_CODES',
  );
  const graphReceiverEnd = codegenSource.indexOf(']);', graphReceiverStart) + 3;
  for (const code of [
    'SNAPBACK_GRAPH_CLIENT_AST_FORBIDDEN',
    'SNAPBACK_GRAPH_CODE_FORBIDDEN',
    'SNAPBACK_GRAPH_RECURSION_FORBIDDEN',
    'SNAPBACK_GRAPH_DYNAMIC_CONSTRUCTION',
  ]) {
    const receivedSites = registry.diagnostics[code].sites.filter(({ file, kind }) => (
      file === 'packages/snapback-codegen/index.mjs' && kind === 'received'
    ));
    assert.equal(
      receivedSites.some(({ line }) => (
        lineAt(graphOrderStart) <= line && line <= lineAt(graphOrderEnd)
      )),
      false,
      `${code} sorting-table key must not be received vocabulary`,
    );
    assert.ok(
      receivedSites.some(({ line }) => (
        lineAt(graphReceiverStart) <= line && line <= lineAt(graphReceiverEnd)
      )),
      `${code} must retain its real definition-evaluation receiver`,
    );
  }

  const duplicateSourceSites = Object.entries(registry.diagnostics).flatMap(([code, record]) => {
    const seen = new Set();
    return record.sites.flatMap(({ file, line }) => {
      const key = `${code}@${file}:${line}`;
      if (seen.has(key)) return [key];
      seen.add(key);
      return [];
    });
  });
  assert.deepEqual(duplicateSourceSites, [], 'generated source sites are unique by code@file:line');

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

  const cloudflareDeployCodes = [
    'SNAPBACK_CF_DEPLOY_APP_UNKNOWN',
    'SNAPBACK_CF_DEPLOY_CREDENTIAL_MISSING',
    'SNAPBACK_CF_DEPLOY_HEALTH_REFUSED',
  ];
  for (const code of cloudflareDeployCodes) {
    assert.ok(
      registry.diagnostics[code]?.sites.some((site) => (
        site.file === 'targets/cloudflare/deploy.sh' && site.kind === undefined
      )),
      `${code} must retain its shell deploy_fail emission`,
    );
  }

  for (const [code, file] of [
    [
      'SNAPBACK_ADMIN_LAN_TARGET_INVALID',
      'crates/snapback-server/src/admin_link.rs',
    ],
    [
      'SNAPBACK_ADMIN_TAILSCALE_TARGET_UNSUPPORTED',
      'crates/snapback-server/src/admin_link.rs',
    ],
    [
      'SNAPBACK_PROFILE_FORBIDS',
      'crates/snapback-cli/src/cli.rs',
    ],
    [
      'SNAPBACK_ADMIN_CLAIM_URL_BASE_INVALID',
      'crates/snapback-cli/src/cli.rs',
    ],
  ]) {
    assert.deepEqual(
      registry.diagnostics[code]?.sites
        .filter((site) => site.file === file)
        .map(({ line, kind }) => ({ line, kind })),
      sourceLinesContaining(file, code).map((line) => ({ line, kind: undefined })),
      `${code} must retain every emitter surrounding a completed matches! call`,
    );
  }

  for (const name of [
    'SNAPBACK_S3_TEST_ENDPOINT',
    'SNAPBACK_S3_TEST_SECRET_ACCESS_KEY',
  ]) {
    assert.equal(registry.environment[name], undefined, `${name} is test-only`);
  }

  for (const file of [
    'crates/snapback-engine/src/local/admission_fence_tests.rs',
    'crates/snapback-engine/src/local/auth_room_kick_acceptance.rs',
  ]) {
    assert.equal(
      Object.values(registry.diagnostics).some((record) => (
        record.sites.some((site) => site.file === file)
      )),
      false,
      `${file} is an external cfg(test) module`,
    );
  }

  const readinessFile = 'crates/snapback-activation/src/operational_readiness.rs';
  assert.deepEqual(
    registry.diagnostics.SNAPBACK_APP_READINESS_DECLARATION_INVALID.sites
      .filter(({ file }) => file === readinessFile)
      .map(({ line, kind }) => ({ line, kind })),
    [
      ...sourceLinesContaining(
        readinessFile,
        'pub const READINESS_DECLARATION_INVALID_CODE',
      ).map((line) => ({ line, kind: 'declaration' })),
      ...sourceLinesContaining(
        readinessFile,
        'SnapbackError::error(READINESS_DECLARATION_INVALID_CODE',
      ).map((line) => ({ line, kind: undefined })),
    ],
  );
  assert.equal(
    Object.values(registry.diagnostics).every((record) => (
      record.sites.some((site) => site.kind !== 'declaration')
    )),
    true,
    'declarations alone never retain a public diagnostic code',
  );

  for (const code of [
    'SNAPBACK_AUTHORIZED_LEASE_STATE_CORRUPT',
    'SNAPBACK_AUTH_IDENTITY_COLLISION',
    'SNAPBACK_AUTH_PASSWORD_ALREADY_SET',
    'SNAPBACK_FORK_WRITER_COVERAGE_GAP',
    'SNAPBACK_OPERATION_COVERAGE_INVALID',
    'SNAPBACK_TELEMETRY_TEST_CONFIG_FAILED',
    'SNAPBACK_TEST_FIXTURE_INVALID',
    'SNAPBACK_TEST_OPERATION_CRASH_CUT',
  ]) {
    assert.ok(registry.diagnostics[code], `${code} must remain in the generated registry`);
    assert.match(
      diagnosticTypes,
      new RegExp(`^  (?:\\| )?'${code}'$`, 'mu'),
      `${code} must remain in SnapbackDiagnosticCode`,
    );
  }
  const forkGapSites = registry.diagnostics.SNAPBACK_FORK_WRITER_COVERAGE_GAP.sites;
  assert.ok(
    forkGapSites.some(({ file, kind }) => (
      file === 'crates/snapback-types/src/instance_fork/contract.rs'
      && kind === 'declaration'
    )),
    'fork writer-coverage gap retains its whole-string declaration',
  );
  for (const file of [
    'crates/snapback-services/src/instance_fork/service.rs',
    'crates/snapback-kernel/src/storage/connections.rs',
  ]) {
    assert.ok(
      forkGapSites.some((site) => site.file === file && site.kind === undefined),
      `fork writer-coverage gap follows its cross-file constant into ${file}`,
    );
  }
  for (const [code, file] of [
    ['SNAPBACK_IBEX_CARGO_NOT_FOUND', 'scripts/runtime-link-smoke.mjs'],
    ['SNAPBACK_RESUME_JOURNAL_FLOOR', 'crates/snapback-engine/src/local/engine.rs'],
    ['SNAPBACK_RESUME_POLICY_REPLACED', 'crates/snapback-engine/src/local/engine.rs'],
    ['SNAPBACK_RESUME_WITNESS_REPLAY_DIVERGED', 'crates/snapback-engine/src/local/engine.rs'],
    ['SNAPBACK_RESUME_WITNESS_ROOT_MISMATCH', 'crates/snapback-engine/src/local/engine.rs'],
  ]) {
    assert.ok(
      registry.diagnostics[code]?.sites.some((site) => (
        site.file === file && site.kind === undefined && site.synthetic !== true
      )),
      `${code} follows its imported whole-string constant without a marker`,
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
  assert.deepEqual(
    demandMismatchSites.map(({ file, line, kind }) => ({ file, line, kind })),
    [{
      file: 'crates/snapback-kernel/src/live_matcher.rs',
      line: 215,
      kind: undefined,
    }],
  );
  assert.ok(registry.diagnostics.SNAPBACK_GRAPH_DEMAND_IDENTITY_MISMATCH);
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

  for (const name of [
    'SNAPBACK_GRAPH_EXEC_DISABLED',
    'SNAPBACK_VERIFY_PROFILE_TIMEOUT',
    'SNAPBACK_TEST_CRON_STOP_AFTER_TERMINAL_UPDATE',
  ]) {
    assert.ok(
      registry.diagnostics[name]?.sites.some((site) => site.kind === undefined),
      `${name} retains its explicit code-bearing emitter`,
    );
    assert.ok(registry.environment[name], `${name} retains its environment role`);
  }

  assert.ok(
    registry.environment.SNAPBACK_CLIENT_RQS_DIR.sites.some((site) => (
      site.file === 'packages/snapback-cli/expo-dev.mjs' && site.kind === 'remove'
    )),
    'delete childEnv.SNAPBACK_CLIENT_RQS_DIR must be classified as a removal',
  );
  assert.ok(
    registry.environment.SNAPBACK_ADMIN_TOKEN.sites.some((site) => (
      site.file === 'packages/snapback-cli/index.mjs' && site.kind === 'write'
    )),
    'delegatedEnvironment.SNAPBACK_ADMIN_TOKEN assignment must be classified as a write',
  );

  const proseOnlyEnvironmentNames = [
    'SNAPBACK_ADMIN_TOKEN',
    'SNAPBACK_PUBLICATION_AUTHORITY_INSTALLATION_ID',
    'SNAPBACK_PUBLICATION_AUTHORITY_ORIGIN',
    'SNAPBACK_PUBLICATION_AUTHORITY_PORT',
  ];
  const diagnosticType = diagnosticTypes.slice(
    diagnosticTypes.indexOf('export type SnapbackDiagnosticCode ='),
  );
  assert.doesNotMatch(
    diagnosticTypes,
    /SnapbackEnvironmentVariable/u,
    'environment names stay in the Guide registry without adding public client surface',
  );
  for (const name of [
    'SNAPBACK_ALL_ABOARD_API',
    'SNAPBACK_ALL_ABOARD_TARGET_PROFILE',
  ]) {
    assert.ok(
      registry.environment[name]?.sites.some((site) => (
        site.file === 'targets/cloudflare/deploy.sh' && site.kind === 'write'
      )),
      `${name} must retain its deploy.sh prefix-assignment write`,
    );
  }
  for (const name of proseOnlyEnvironmentNames) {
    assert.equal(registry.diagnostics[name], undefined, `${name} is not a diagnostic`);
    assert.ok(registry.environment[name], `${name} remains environment vocabulary`);
    assert.doesNotMatch(
      diagnosticType,
      new RegExp(`^  (?:\\| )?'${name}'$`, 'mu'),
      `${name} must be absent from SnapbackDiagnosticCode`,
    );
  }

  assert.deepEqual(
    registry.diagnostics.SNAPBACK_APP_BINDING_EXPIRED.sites
      .map(({ file, line, kind }) => ({ file, line, kind })),
    [
      { file: 'packages/snapback-expo/app-binding.mjs', line: 586, kind: undefined },
      { file: 'packages/snapback-expo/supervised-environment.mjs', line: 595, kind: undefined },
      { file: 'packages/snapback-expo/supervised-environment.mjs', line: 712, kind: undefined },
    ],
  );
  const falselyClassifiedEnvironmentNames = [
    'SNAPBACK_APP_BINDING_EXPIRED',
    'SNAPBACK_APP_BINDING_OVERRIDE_UNCONFIRMED',
    'SNAPBACK_AUTHORITY_REQUIRED',
    'SNAPBACK_EXPO_BOOTSTRAP_UNAVAILABLE',
    'SNAPBACK_EXPO_COMPATIBILITY_UNSUPPORTED',
    'SNAPBACK_EXPO_ENVIRONMENT_INVALID',
  ];
  for (const name of falselyClassifiedEnvironmentNames) {
    assert.equal(registry.environment[name], undefined, `${name} is not environment vocabulary`);
  }

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
    'SNAPBACK_HOSTED_TARGET_TIGRIS_CONTROL_STATE_PARTIAL',
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
        file: 'packages/snapback-hosted-supervisor/internal/target-tigris-credentials.mjs',
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
  const invalidControlStateSpelling = [
    'SNAPBACK_HOSTED_TARGET_TIGRIS_CONTROL',
    'STATE_PARTIAL',
  ].join('-');
  assert.equal(registry.diagnostics[invalidControlStateSpelling], undefined);

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

  const resultCoreSource = readFileSync(resolve(
    import.meta.dirname,
    '../packages/snapback-app-cli/result-core.mjs',
  ), 'utf8');
  const exactCodeExitTable = resultCoreSource.slice(
    resultCoreSource.indexOf('const EXACT_CODE_EXITS'),
    resultCoreSource.indexOf('const AUTH_FAMILY'),
  );
  const exactCodeExitCodes = [...exactCodeExitTable.matchAll(
    /\['(SNAPBACK_[A-Z0-9_]+)'/gu,
  )].map((match) => match[1]);
  assert.equal(exactCodeExitCodes.length, 34);
  for (const code of exactCodeExitCodes) {
    const sites = registry.diagnostics[code]?.sites.filter((site) => (
      site.file === 'packages/snapback-app-cli/result-core.mjs'
    )) ?? [];
    assert.ok(sites.length > 0, `${code} must retain its EXACT_CODE_EXITS receive site`);
    assert.ok(
      sites.every((site) => site.kind === 'received'),
      `${code} must classify EXACT_CODE_EXITS Map.get lookup vocabulary as received`,
    );
  }

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

  for (const code of [
    'SNAPBACK_PACKAGED_STORE_QUALIFICATION_RECEIPT_UNREADABLE',
    'SNAPBACK_PACKAGED_STORE_QUALIFICATION_RECEIPT_INSTALL_FAILED',
  ]) {
    assert.ok(
      registry.diagnostics[code]?.sites.some(({ file, kind }) => (
        file === 'scripts/runtime-package-authority.mjs' && kind === undefined
      )),
      `${code} must retain its package-preparation helper emission`,
    );
    assert.match(diagnosticTypes, new RegExp(`'${code}'`, 'u'));
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

test('resume budget reservation is recorded on its spelling line', () => {
  const registry = JSON.parse(readFileSync(resolve(
    import.meta.dirname,
    '../guide/reference/diagnostics-registry.json',
  ), 'utf8'));
  const file = 'crates/snapback-sync/src/rqs.rs';
  const reservedLines = registry.diagnostics.SNAPBACK_RESUME_BUDGET_EXCEEDED.sites
    .filter((site) => site.file === file && site.kind === 'reserved')
    .map((site) => site.line);

  assert.deepEqual(reservedLines, sourceLinesContaining(file, 'pub const BUDGET_EXCEEDED'));
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
    "const MAP_CODES = new Map([['POST /fixture 409 SNAPBACK_FIXTURE_RECEIVED_MAP', { code: 'SNAPBACK_FIXTURE_MAP_VALUE_EMISSION' }]]);",
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
      { code: 'SNAPBACK_FIXTURE_MAP_VALUE_EMISSION', kind: 'emission' },
      { code: 'SNAPBACK_FIXTURE_RECEIVED_OBJECT', kind: 'received' },
      { code: 'SNAPBACK_FIXTURE_RECEIVED_SWIFT', kind: 'received' },
      { code: 'SNAPBACK_FIXTURE_RECEIVED_RUST_HELPER', kind: 'received' },
      { code: 'SNAPBACK_FIXTURE_RECEIVED_RUST_BINARY_SEARCH', kind: 'received' },
    ],
  );
});

test('received protocol classifier recognizes the production EXACT_CODE_EXITS Map.get idiom', () => {
  const source = [
    'const EXACT_CODE_EXITS = new Map([',
    "  ['SNAPBACK_APP_CLI_USAGE', EXIT.USAGE],",
    "  ['SNAPBACK_APP_CLI_AUTH_REFUSED', EXIT.AUTH_REFUSED],",
    ']);',
    'export function classifyDiagnosticExit(record) {',
    '  const exact = EXACT_CODE_EXITS.get(record.code);',
    '  if (exact !== undefined) return exact;',
    '  return EXIT.FUNCTION_ERROR;',
    '}',
  ].join('\n');

  assert.deepEqual(
    diagnosticSourceSites(source, {
      javascript: true,
      receivedProtocolVocabulary: true,
    }).map(({ match, kind }) => ({ code: match[0], kind })),
    [
      { code: 'SNAPBACK_APP_CLI_USAGE', kind: 'received' },
      { code: 'SNAPBACK_APP_CLI_AUTH_REFUSED', kind: 'received' },
    ],
  );
});

test('received Map.get tables require an inbound diagnostic key', () => {
  const source = [
    'const GRAPH_SOURCE_FAULT_ORDER = new Map([',
    "  ['SNAPBACK_GRAPH_CLIENT_AST_FORBIDDEN', 1],",
    "  ['SNAPBACK_GRAPH_CODE_FORBIDDEN', 2],",
    "  ['SNAPBACK_GRAPH_RECURSION_FORBIDDEN', 3],",
    "  ['SNAPBACK_GRAPH_DYNAMIC_CONSTRUCTION', 4],",
    ']);',
    'faults.sort((left, right) => (',
    '  (GRAPH_SOURCE_FAULT_ORDER.get(left.code) ?? 255)',
    '    - (GRAPH_SOURCE_FAULT_ORDER.get(right.code) ?? 255)',
    '));',
    'const LOCAL_ISSUER_FAILURES = new Map([',
    "  ['POST /auth/exchange 401 SNAPBACK_AUTH_CODE_INVALID', { message: 'invalid' }],",
    ']);',
    'const localIssuerFailure = (method, path, status, value) => {',
    '  const responseCode = value?.diagnostic?.code;',
    '  return LOCAL_ISSUER_FAILURES.get(`${method} ${path} ${status} ${responseCode}`);',
    '};',
    'const EXACT_CODE_EXITS = new Map([',
    "  ['SNAPBACK_APP_CLI_USAGE', EXIT.USAGE],",
    ']);',
    'export function classifyDiagnosticExit(record) {',
    '  return EXACT_CODE_EXITS.get(record.code);',
    '}',
  ].join('\n');

  assert.deepEqual(
    diagnosticSourceSites(source, {
      javascript: true,
      receivedProtocolVocabulary: true,
    }).map(({ match, kind }) => ({ code: match[0], kind })),
    [
      { code: 'SNAPBACK_AUTH_CODE_INVALID', kind: 'received' },
      { code: 'SNAPBACK_APP_CLI_USAGE', kind: 'received' },
    ],
  );
});

test('environment allowlists remain environment tables rather than received diagnostics', () => {
  const source = [
    "const allowed = new Set(['SNAPBACK_FIXTURE_ENV_ALLOWLIST']);",
    'for (const [key, value] of Object.entries(process.env)) {',
    '  if (allowed.has(key.toUpperCase())) environment[key] = value;',
    '}',
  ].join('\n');
  const options = { javascript: true, receivedProtocolVocabulary: true };

  assert.deepEqual(
    environmentVariableSites(source, options)
      .map(({ match, kind }) => ({ name: match[0], kind })),
    [{ name: 'SNAPBACK_FIXTURE_ENV_ALLOWLIST', kind: 'table-entry' }],
  );
  assert.deepEqual(diagnosticSourceSites(source, options), []);
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

test('environment helper discovery ignores closing braces in helper strings', () => {
  const fixture = [
    'function readEnv(name) {',
    '  const marker = "}";',
    '  return process.env[name];',
    '}',
    'throw new Error(readEnv("SNAPBACK_WRAPPED_ENV"));',
  ].join('\n');

  assert.deepEqual(
    environmentVariableSites(fixture, { javascript: true })
      .map(({ match, kind }) => ({ name: match[0], kind })),
    [{ name: 'SNAPBACK_WRAPPED_ENV', kind: 'read' }],
  );
  assert.deepEqual(
    diagnosticSourceSites(fixture, { javascript: true })
      .filter(({ match }) => match[0] === 'SNAPBACK_WRAPPED_ENV'),
    [],
  );
});

test('environment helper discovery ignores closing braces in JavaScript regex literals', () => {
  const fixture = [
    'function readEnv(name) { const marker = /}/; return process.env[name]; }',
    'throw new Error(readEnv("SNAPBACK_WRAPPED_REGEX_ENV"));',
  ].join('\n');

  assert.deepEqual(
    environmentVariableSites(fixture, { javascript: true })
      .map(({ match, kind }) => ({ name: match[0], kind })),
    [{ name: 'SNAPBACK_WRAPPED_REGEX_ENV', kind: 'read' }],
  );
  assert.deepEqual(
    diagnosticSourceSites(fixture, { javascript: true })
      .filter(({ match }) => match[0] === 'SNAPBACK_WRAPPED_REGEX_ENV'),
    [],
  );
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
