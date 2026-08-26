// @ref LLP 0111#durable-spend-cleanup-and-credential-custody — partial
// credentials fail closed through the exact code for the closed target role.
const TARGET_TIGRIS_PARTIAL_CREDENTIAL_CODES = Object.freeze({
  // diagnostics-registry: reference-only
  artifact: 'SNAPBACK_HOSTED_TARGET_TIGRIS_ARTIFACT_PARTIAL',
  // diagnostics-registry: reference-only
  backup: 'SNAPBACK_HOSTED_TARGET_TIGRIS_BACKUP_PARTIAL',
  // diagnostics-registry: reference-only
  'control-state': 'SNAPBACK_HOSTED_TARGET_TIGRIS_CONTROL_STATE_PARTIAL',
  // diagnostics-registry: reference-only
  audit: 'SNAPBACK_HOSTED_TARGET_TIGRIS_AUDIT_PARTIAL',
  // diagnostics-registry: reference-only
  logs: 'SNAPBACK_HOSTED_TARGET_TIGRIS_LOGS_PARTIAL',
  // diagnostics-registry: reference-only
  cleanup: 'SNAPBACK_HOSTED_TARGET_TIGRIS_CLEANUP_PARTIAL',
});

export function assertTargetTigrisCredentialPair(role, {
  accessKeyId = null,
  secretAccessKey = null,
} = {}) {
  if (!Object.hasOwn(TARGET_TIGRIS_PARTIAL_CREDENTIAL_CODES, role)) {
    throw new Error('SNAPBACK_HOSTED_TARGET_TIGRIS_BOOTSTRAP_INVALID');
  }
  if (Boolean(accessKeyId) !== Boolean(secretAccessKey)) {
    // diagnostics-registry: emission SNAPBACK_HOSTED_TARGET_TIGRIS_ARTIFACT_PARTIAL
    // diagnostics-registry: emission SNAPBACK_HOSTED_TARGET_TIGRIS_AUDIT_PARTIAL
    // diagnostics-registry: emission SNAPBACK_HOSTED_TARGET_TIGRIS_BACKUP_PARTIAL
    // diagnostics-registry: emission SNAPBACK_HOSTED_TARGET_TIGRIS_CLEANUP_PARTIAL
    // diagnostics-registry: emission SNAPBACK_HOSTED_TARGET_TIGRIS_CONTROL_STATE_PARTIAL
    // diagnostics-registry: emission SNAPBACK_HOSTED_TARGET_TIGRIS_LOGS_PARTIAL
    throw new Error(TARGET_TIGRIS_PARTIAL_CREDENTIAL_CODES[role]);
  }
}
