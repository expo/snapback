// Exact owning-crate runtime identities. A free-floating sentinel proves only
// that bytes appeared in Cargo output; the matching libtest `ok` line proves
// that the named test actually completed successfully in this invocation.
export const AUTHORITY_RUNTIME_TESTS = [
  ['authority_transition_runtime_01_forgotten_scope_cannot_commit_or_outlive_wrapper', '01-transaction-liveness'],
  ['authority_transition_runtime_02_scope_on_a_cannot_authorize_connection_b', '02-connection-ownership'],
  ['authority_transition_runtime_03_prepared_statement_cannot_execute_after_scope', '03-prepare-execution-lifetime'],
  ['authority_transition_runtime_04_schema_conflict_replace_cannot_replace_predecessor', '04-schema-conflict-abort'],
  ['authority_transition_runtime_05_write_key_and_subject_derive_from_credential_row', '05-row-derived-successor'],
  ['authority_transition_runtime_06_stale_generation_cannot_reactivate_scope', '06-wrapper-generation'],
  ['authority_transition_runtime_07_conflict_and_upsert_matrix_is_refused_unscoped', '07-conflict-upsert-matrix'],
  ['authority_transition_runtime_08_casefolded_trigger_attack_is_closed', '08-casefolded-trigger'],
  ['authority_transition_runtime_09_suppressing_trigger_cannot_report_success', '09-suppressing-trigger'],
  ['authority_transition_runtime_10_foreign_key_cascade_into_protected_row_is_denied', '10-foreign-key-cascade'],
  ['authority_transition_runtime_11_virtual_table_is_refused_before_activation', '11-virtual-table-preactivation'],
  ['authority_transition_runtime_12_existing_writer_policy_remains_composed', '12-policy-composition'],
  ['authority_transition_runtime_13_close_and_address_reuse_gets_fresh_state', '13-close-address-reuse'],
  ['authority_transition_runtime_14_resource_guard_is_reread_inside_effect_transaction', '14-resource-guard-reread'],
];

const TEST_MODULE = 'storage::authority_transition::core::evidence::tests';
// Mutation runner changes only this literal and requires the synthetic-output
// regression to turn red, preserving an executable proof of the old weakness.
const REQUIRE_EXACT_TEST_OK = true;

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
}

export function scoreAuthorityRuntimeOutput(output, status) {
  const observed = [];
  const missingSentinels = [];
  const missingOkTests = [];
  for (const [testName, sentinel] of AUTHORITY_RUNTIME_TESTS) {
    const sawSentinel = output.includes(`AUTHORITY_TRANSITION_RUNTIME_PROBE: ${sentinel}`);
    const exactOk = new RegExp(
      `^test ${escapeRegExp(`${TEST_MODULE}::${testName}`)} \\.\\.\\. ok$`,
      'mu',
    ).test(output);
    if (!sawSentinel) missingSentinels.push(sentinel);
    if (REQUIRE_EXACT_TEST_OK && !exactOk) missingOkTests.push(testName);
    if (sawSentinel && (!REQUIRE_EXACT_TEST_OK || exactOk)) observed.push(testName);
  }
  return {
    passed: status === 0 && missingSentinels.length === 0 && missingOkTests.length === 0,
    observed,
    missingSentinels,
    missingOkTests,
  };
}
