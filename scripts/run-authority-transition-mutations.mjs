#!/usr/bin/env node

// @ref LLP 0303#claim-discipline-this-ruling-does-not-grant — every Landing A
// attack regression is paired with an executable defanged build. A mutation is
// killed only by the named test failing at runtime (or, for writer privacy, by
// the exact compile-fail expression becoming compilable).

import { spawnSync } from 'node:child_process';
import {
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import {
  loadAttacks,
  runOwningCrateAttacks,
} from './check-security-boundaries.mjs';

const root = resolve(import.meta.dirname, '..');
const targetDir = resolve(root, 'target');

function rustflags(cfgs) {
  return [
    process.env.RUSTFLAGS,
    ...cfgs.flatMap((cfg) => [`--cfg ${cfg}`, `--check-cfg=cfg(${cfg})`]),
  ].filter(Boolean).join(' ');
}

function expectRuntimeMutationKilled({ id, cfgs, test, marker }) {
  const result = spawnSync(
    'cargo',
    [
      'test',
      '--offline',
      '--locked',
      '--package', 'snapback-kernel',
      '--lib',
      test,
      '--', '--show-output', '--test-threads=1',
    ],
    {
      cwd: root,
      env: {
        ...process.env,
        CARGO_TARGET_DIR: targetDir,
        RUSTFLAGS: rustflags(cfgs),
      },
      encoding: 'utf8',
      maxBuffer: 128 * 1024 * 1024,
    },
  );
  if (result.error || result.status === null) {
    throw new Error(`${id}: Cargo infrastructure failure: ${result.error?.message ?? 'no status'}`);
  }
  const output = `${result.stdout}\n${result.stderr}`;
  if (result.status === 0
      || !output.includes(`test storage::authority_transition::core::evidence::tests::${test} ... FAILED`)
      || !output.includes(marker)) {
    throw new Error(`${id}: mutation was not killed by the exact runtime assertion\n${output}`);
  }
  process.stdout.write(`[authority-mutation] KILLED ${id}: ${test} failed at ${marker}\n`);
}

function expectWriterPrivacyMutationKilled() {
  const prior = process.env.RUSTFLAGS;
  process.env.RUSTFLAGS = rustflags(['snapback_authority_mutation_writer_raw_access']);
  try {
    const ids = new Set([
      'raw-protected-tx-connection-field',
      'writer-replace-authorizer',
      'writer-mutate-authorizer-state',
    ]);
    const attacks = loadAttacks().filter(({ id }) => ids.has(id));
    const outcomes = runOwningCrateAttacks({ attacks, root, targetDir });
    if (outcomes.length !== 6
        || outcomes.some(({ passed, line }) => passed || !line.includes('attack compiled'))) {
      throw new Error(
        `writer-raw-access: defanged fields did not make every exact attack compile\n${outcomes.map(({ line }) => line).join('\n')}`,
      );
    }
    process.stdout.write(
      '[authority-mutation] KILLED writer-raw-access: 6/6 feature-cell attacks compiled\n',
    );
  } finally {
    if (prior === undefined) delete process.env.RUSTFLAGS;
    else process.env.RUSTFLAGS = prior;
  }
}

function expectGateMutationKilled() {
  const scratch = mkdtempSync(join(tmpdir(), 'snapback-authority-gate-mutation-'));
  try {
    const source = readFileSync(resolve(root, 'scripts/authority-runtime-output.mjs'), 'utf8');
    const mutated = source.replace(
      'const REQUIRE_EXACT_TEST_OK = true;',
      'const REQUIRE_EXACT_TEST_OK = false;',
    );
    if (mutated === source) throw new Error('gate mutation marker was absent');
    const modulePath = join(scratch, 'authority-runtime-output.mjs');
    const testPath = join(scratch, 'mutation.test.mjs');
    writeFileSync(modulePath, mutated);
    writeFileSync(testPath, [
      "import assert from 'node:assert/strict';",
      "import test from 'node:test';",
      `import { AUTHORITY_RUNTIME_TESTS, scoreAuthorityRuntimeOutput } from '${pathToFileURL(modulePath)}';`,
      "test('sentinel-only output remains red', () => {",
      "  const output = AUTHORITY_RUNTIME_TESTS.map(([, id]) => `AUTHORITY_TRANSITION_RUNTIME_PROBE: ${id}`).join('\\n');",
      "  assert.equal(scoreAuthorityRuntimeOutput(output, 0).passed, false, 'SENTINEL_ONLY_GATE_MUTATION passed fabricated output');",
      '});',
      '',
    ].join('\n'));
    const result = spawnSync(process.execPath, ['--test', testPath], {
      cwd: root,
      encoding: 'utf8',
    });
    const output = `${result.stdout}\n${result.stderr}`;
    if (result.status === 0 || !output.includes('SENTINEL_ONLY_GATE_MUTATION')) {
      throw new Error(`sentinel-only gate mutation was not killed\n${output}`);
    }
    process.stdout.write(
      '[authority-mutation] KILLED sentinel-only-gate: fabricated output turned the regression red\n',
    );
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
}

const runtimeMutations = [
  {
    id: 'casefold-and-schema-validation',
    cfgs: ['snapback_authority_mutation_casefold_schema'],
    test: 'authority_transition_runtime_08_casefolded_trigger_attack_is_closed',
    marker: 'CASEFOLD_SCHEMA_MUTATION',
  },
  {
    id: 'schema-conflict-abort',
    cfgs: ['snapback_authority_mutation_schema_conflict_replace'],
    test: 'authority_transition_runtime_04_schema_conflict_replace_cannot_replace_predecessor',
    marker: 'SCHEMA_CONFLICT_REPLACE_MUTATION',
  },
  {
    id: 'row-derived-successor',
    cfgs: ['snapback_authority_mutation_supply_selector'],
    test: 'authority_transition_runtime_05_write_key_and_subject_derive_from_credential_row',
    marker: 'SUPPLIED_SELECTOR_MUTATION',
  },
  {
    id: 'suppressing-trigger-schema-validation',
    cfgs: ['snapback_authority_mutation_accept_suppressing_trigger'],
    test: 'authority_transition_runtime_09_suppressing_trigger_cannot_report_success',
    marker: 'SUPPRESSING_TRIGGER_SCHEMA_MUTATION',
  },
  {
    id: 'suppressing-trigger-row-count',
    cfgs: ['snapback_authority_mutation_ignore_write_count'],
    test: 'authority_transition_runtime_09_suppressing_trigger_cannot_report_success',
    marker: 'SUPPRESSING_TRIGGER_COUNT_MUTATION',
  },
  {
    id: 'virtual-table-preactivation',
    cfgs: ['snapback_authority_mutation_allow_virtual_table'],
    test: 'authority_transition_runtime_11_virtual_table_is_refused_before_activation',
    marker: 'VIRTUAL_TABLE_MUTATION',
  },
  {
    id: 'writer-policy-composition',
    cfgs: ['snapback_authority_mutation_discard_writer_policy'],
    test: 'authority_transition_runtime_12_existing_writer_policy_remains_composed',
    marker: 'DISCARDED_WRITER_POLICY_MUTATION',
  },
];

try {
  for (const mutation of runtimeMutations) expectRuntimeMutationKilled(mutation);
  expectWriterPrivacyMutationKilled();
  expectGateMutationKilled();
  process.stdout.write(
    `[authority-mutation] PASS ${runtimeMutations.length + 2}/${runtimeMutations.length + 2} mutation families killed\n`,
  );
} catch (error) {
  process.stderr.write(`[authority-mutation] RED ${error.message}\n`);
  process.exitCode = 1;
}
