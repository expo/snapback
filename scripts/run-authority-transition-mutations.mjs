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

const MUTATION_ENV = 'SNAPBACK_AUTHORITY_TRANSITION_MUTATIONS';

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
        [MUTATION_ENV]: cfgs.join(','),
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
  const prior = process.env[MUTATION_ENV];
  process.env[MUTATION_ENV] = 'snapback_authority_mutation_writer_raw_access';
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
    if (prior === undefined) delete process.env[MUTATION_ENV];
    else process.env[MUTATION_ENV] = prior;
  }
}

function expectWriterPolicyOwnershipMutationsKilled() {
  const prior = process.env[MUTATION_ENV];
  process.env[MUTATION_ENV] = [
    'snapback_authority_mutation_clone_writer_policy',
    'snapback_authority_mutation_expose_initialized_limbs',
  ].join(',');
  try {
    const ids = new Set([
      'clone-writer-policy',
      'swap-initialized-writer-policy',
    ]);
    const attacks = loadAttacks().filter(({ id }) => ids.has(id));
    const outcomes = runOwningCrateAttacks({ attacks, root, targetDir });
    if (outcomes.length !== 4
        || outcomes.some(({ passed, line }) => passed || !line.includes('attack compiled'))) {
      throw new Error(
        `writer-policy-ownership: defanged ownership did not make every exact attack compile\n${outcomes.map(({ line }) => line).join('\n')}`,
      );
    }
    process.stdout.write(
      '[authority-mutation] KILLED writer-policy-ownership: 4/4 feature-cell attacks compiled\n',
    );
  } finally {
    if (prior === undefined) delete process.env[MUTATION_ENV];
    else process.env[MUTATION_ENV] = prior;
  }
}

function expectGateMutationKilled() {
  const scratch = mkdtempSync(join(tmpdir(), 'snapback-authority-gate-mutation-'));
  try {
    const source = readFileSync(resolve(root, 'scripts/authority-runtime-output.mjs'), 'utf8');
    const mutated = source.replace(
      'const REQUIRE_PER_TEST_LIBTEST_JSON = true;',
      'const REQUIRE_PER_TEST_LIBTEST_JSON = false;',
    );
    if (mutated === source) throw new Error('gate mutation marker was absent');
    const modulePath = join(scratch, 'authority-runtime-output.mjs');
    const testPath = join(scratch, 'mutation.test.mjs');
    writeFileSync(modulePath, mutated);
    writeFileSync(testPath, [
      "import assert from 'node:assert/strict';",
      "import test from 'node:test';",
      `import { AUTHORITY_RUNTIME_TESTS, qualifiedAuthorityTestName, scoreAuthorityLibtestJson } from '${pathToFileURL(modulePath)}';`,
      "test('exact-looking fabricated output remains red', () => {",
      "  const output = AUTHORITY_RUNTIME_TESTS.flatMap(([name, id]) => [`test storage::authority_transition::core::evidence::tests::${name} ... ok`, `AUTHORITY_TRANSITION_RUNTIME_PROBE: ${id}`]).join('\\n');",
      "  const exactName = qualifiedAuthorityTestName(AUTHORITY_RUNTIME_TESTS[0][0]);",
      "  assert.equal(scoreAuthorityLibtestJson(output, 0, exactName).passed, false, 'FABRICATED_EXACT_OUTPUT_MUTATION passed fabricated output');",
      '});',
      '',
    ].join('\n'));
    const result = spawnSync(process.execPath, ['--test', testPath], {
      cwd: root,
      encoding: 'utf8',
    });
    const output = `${result.stdout}\n${result.stderr}`;
    if (result.status === 0 || !output.includes('FABRICATED_EXACT_OUTPUT_MUTATION')) {
      throw new Error(`fabricated exact-output gate mutation was not killed\n${output}`);
    }
    process.stdout.write(
      '[authority-mutation] KILLED fabricated-exact-output-gate: caller-authored lines turned the regression red\n',
    );
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
}

const runtimeMutations = [
  {
    id: 'scope-liveness-reset',
    cfgs: ['snapback_authority_mutation_retain_scope'],
    test: 'authority_transition_runtime_01_forgotten_scope_cannot_commit_or_outlive_wrapper',
    marker: 'FORGOTTEN_SCOPE_MUTATION',
  },
  {
    id: 'connection-state-ownership',
    cfgs: ['snapback_authority_mutation_share_connection_state'],
    test: 'authority_transition_runtime_02_scope_on_a_cannot_authorize_connection_b',
    marker: 'SHARED_CONNECTION_STATE_MUTATION',
  },
  {
    id: 'statement-cache-lifetime',
    cfgs: ['snapback_authority_mutation_statement_cache'],
    test: 'authority_transition_runtime_03_prepared_statement_cannot_execute_after_scope',
    marker: 'STATEMENT_CACHE_MUTATION',
  },
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
    id: 'scope-generation',
    cfgs: ['snapback_authority_mutation_ignore_scope_generation'],
    test: 'authority_transition_runtime_06_stale_generation_cannot_reactivate_scope',
    marker: 'SCOPE_GENERATION_MUTATION',
  },
  {
    id: 'unscoped-conflict-matrix',
    cfgs: ['snapback_authority_mutation_allow_unscoped_conflicts'],
    test: 'authority_transition_runtime_07_conflict_and_upsert_matrix_is_refused_unscoped',
    marker: 'UNSCOPED_CONFLICT_MUTATION',
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
    id: 'foreign-key-cascade',
    cfgs: ['snapback_authority_mutation_allow_fk_cascade'],
    test: 'authority_transition_runtime_10_foreign_key_cascade_into_protected_row_is_denied',
    marker: 'FK_CASCADE_MUTATION',
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
  {
    id: 'close-address-reuse-state',
    cfgs: ['snapback_authority_mutation_stale_reused_state'],
    test: 'authority_transition_runtime_13_close_and_address_reuse_gets_fresh_state',
    marker: 'ADDRESS_REUSE_STATE_MUTATION',
  },
  {
    id: 'resource-guard-effect-time-reread',
    cfgs: ['snapback_authority_mutation_skip_resource_guard_reread'],
    test: 'authority_transition_runtime_14_resource_guard_is_reread_inside_effect_transaction',
    marker: 'RESOURCE_GUARD_REREAD_MUTATION',
  },
  {
    id: 'second-handle-custody',
    cfgs: ['snapback_authority_mutation_allow_shared_file'],
    test: 'authority_transition_runtime_15_second_handle_cannot_author_trusted_facts_or_effects',
    marker: 'SECOND_HANDLE_CUSTODY_MUTATION',
  },
  {
    id: 'writer-policy-ownership',
    cfgs: ['snapback_authority_mutation_discard_owned_writer_policy'],
    test: 'authority_transition_runtime_16_writer_policy_limb_cannot_be_swapped_or_disarmed',
    marker: 'WRITER_POLICY_OWNERSHIP_MUTATION',
  },
];

try {
  for (const mutation of runtimeMutations) expectRuntimeMutationKilled(mutation);
  expectWriterPrivacyMutationKilled();
  expectWriterPolicyOwnershipMutationsKilled();
  expectGateMutationKilled();
  process.stdout.write(
    `[authority-mutation] PASS ${runtimeMutations.length + 3}/${runtimeMutations.length + 3} mutation families killed\n`,
  );
} catch (error) {
  process.stderr.write(`[authority-mutation] RED ${error.message}\n`);
  process.exitCode = 1;
}
