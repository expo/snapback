// Exact owning-crate runtime identities. Sentinels remain useful human
// diagnostics, but they do not contribute to the gate verdict: test bodies
// author their own stdout. The gate executes each fully qualified name in an
// isolated libtest process and consumes libtest's JSON records instead.
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
  ['authority_transition_runtime_15_second_handle_cannot_author_trusted_facts_or_effects', '15-second-handle-custody'],
  ['authority_transition_runtime_16_writer_policy_limb_cannot_be_swapped_or_disarmed', '16-writer-policy-ownership'],
];

export const AUTHORITY_TEST_MODULE = 'storage::authority_transition::core::evidence::tests';

// The mutation runner changes this literal and requires exact-looking
// caller-authored lines to turn its regression red.
const REQUIRE_PER_TEST_LIBTEST_JSON = true;

export function qualifiedAuthorityTestName(testName) {
  return `${AUTHORITY_TEST_MODULE}::${testName}`;
}

export function scoreAuthorityLibtestJson(output, status, exactName) {
  if (!REQUIRE_PER_TEST_LIBTEST_JSON) {
    return { passed: status === 0, reason: null, records: [] };
  }
  const records = [];
  for (const [index, line] of output.split('\n').entries()) {
    if (line.trim() === '') continue;
    try {
      records.push(JSON.parse(line));
    } catch {
      return {
        passed: false,
        reason: `non-JSON libtest output at line ${index + 1}`,
        records,
      };
    }
  }
  if (status !== 0) {
    return { passed: false, reason: `libtest exited ${status}`, records };
  }
  const allowed = records.every((record) =>
    record?.type === 'suite' || (record?.type === 'test' && record.name === exactName));
  const suiteStarted = records.filter((record) =>
    record?.type === 'suite' && record.event === 'started' && record.test_count === 1);
  const testStarted = records.filter((record) =>
    record?.type === 'test' && record.event === 'started' && record.name === exactName);
  const testOk = records.filter((record) =>
    record?.type === 'test' && record.event === 'ok' && record.name === exactName);
  const suiteOk = records.filter((record) =>
    record?.type === 'suite'
      && record.event === 'ok'
      && record.passed === 1
      && record.failed === 0
      && record.ignored === 0
      && record.measured === 0);
  const passed = allowed
    && records.length === 4
    && suiteStarted.length === 1
    && testStarted.length === 1
    && testOk.length === 1
    && suiteOk.length === 1;
  return {
    passed,
    reason: passed ? null : 'libtest JSON did not prove one exact started-and-ok test',
    records,
  };
}
