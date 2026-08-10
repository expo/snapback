// @ref LLP 0146#oq6-author-ruling--2026-08-10 — one decoder is shared by
// ControlCatalog, generated MCP tools, and hosted diagnostics.
export const REMEDIATION_SET_SCHEMA_VERSION = 'snapback.remediation-set.v1';
export const REMEDIATION_KIND_REGISTRY_VERSION = 'snapback.remediation-kinds.v1';
export const REMEDIATION_SET_MAX_ITEMS = 8;

// The decoder's versioned policy projection is the executable meaning of the
// global registry. It is intentionally independent of diagnostic/refusal code
// and is not copied into ControlCatalog.
const KIND_POLICIES = Object.freeze({
  fixTypo: Object.freeze({ riskClass: 'mechanical', machineApplicable: true, requiresApproval: false, authorityEffect: 'none', preconditionType: 'artifact-hash', actionType: 'replaceIdentifier' }),
  replaceIdentifier: Object.freeze({ riskClass: 'mechanical', machineApplicable: true, requiresApproval: false, authorityEffect: 'none', preconditionType: 'artifact-hash', actionType: 'replaceIdentifier' }),
  regenerateArtifacts: Object.freeze({ riskClass: 'mechanical', machineApplicable: true, requiresApproval: false, authorityEffect: 'none', preconditionType: 'artifact-hash', actionType: 'regenerateArtifacts' }),
  requestGrant: Object.freeze({ riskClass: 'authority-widening', machineApplicable: false, requiresApproval: true, authorityEffect: 'widens', preconditionType: 'grantable-scope', actionType: 'requestGrant' }),
  useDifferentPrincipal: Object.freeze({ riskClass: 'authority-sensitive', machineApplicable: false, requiresApproval: true, authorityEffect: 'changes-effective-principal', preconditionType: 'principal-available', actionType: 'useDifferentPrincipal' }),
});
const ARTIFACT_HASH_PATTERN = /^sha256:(?:[0-9a-f]{16}|[0-9a-f]{64})$/;

function object(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? value : null;
}

/**
 * Decode the optional carrier from Diagnostic.details. Unknown members are
 * ignored and unknown registry kinds are skipped. Unsupported nested versions
 * fail only this decoder; callers must keep the surrounding Diagnostic usable.
 */
export function decodeRemediationSet(details) {
  const raw = object(details)?.remediationSet;
  if (raw === undefined) return null;
  const carrier = object(raw);
  if (!carrier) throw new TypeError('remediationSet must be an object');
  if (carrier.schemaVersion !== REMEDIATION_SET_SCHEMA_VERSION) {
    throw new TypeError(`unsupported remediation schemaVersion: ${String(carrier.schemaVersion)}`);
  }
  if (carrier.registryVersion !== REMEDIATION_KIND_REGISTRY_VERSION) {
    throw new TypeError(`unsupported remediation registryVersion: ${String(carrier.registryVersion)}`);
  }
  if (!Array.isArray(carrier.items) || carrier.items.length > REMEDIATION_SET_MAX_ITEMS) {
    throw new TypeError(`remediation items must be an array of at most ${REMEDIATION_SET_MAX_ITEMS}`);
  }
  const artifactHash = typeof carrier.artifactHash === 'string' ? carrier.artifactHash : undefined;
  if (artifactHash !== undefined && !ARTIFACT_HASH_PATTERN.test(artifactHash)) {
    throw new TypeError('artifactHash must be a supported sha256 digest');
  }
  const items = [];
  for (const value of carrier.items) {
    const item = object(value);
    if (!item) continue;
    const policy = typeof item.kind === 'string' && Object.hasOwn(KIND_POLICIES, item.kind)
      ? KIND_POLICIES[item.kind]
      : null;
    if (!policy) continue;
    const precondition = object(item.precondition);
    const action = object(item.action);
    if (!precondition || !action) throw new TypeError(`invalid ${item.kind} remediation item`);
    if (item.riskClass !== policy.riskClass
      || item.machineApplicable !== policy.machineApplicable
      || item.requiresApproval !== policy.requiresApproval
      || item.authorityEffect !== policy.authorityEffect) {
      throw new TypeError(`${item.kind} remediation axes do not match the v1 registry`);
    }
    if (precondition.type !== policy.preconditionType || action.type !== policy.actionType) {
      throw new TypeError(`${item.kind} remediation action/precondition does not match the v1 registry`);
    }
    if (policy.preconditionType === 'artifact-hash'
      && (typeof precondition.artifactHash !== 'string'
        || precondition.artifactHash !== artifactHash)) {
      throw new TypeError('machine-applicable remediation is not bound to the carrier artifactHash');
    }
    if (item.kind === 'requestGrant' && precondition.grantableScope !== action.scope) {
      throw new TypeError('requestGrant remediation scope does not match its precondition');
    }
    if (item.kind === 'useDifferentPrincipal'
      && precondition.principalAvailable !== action.principal) {
      throw new TypeError('useDifferentPrincipal remediation principal does not match its precondition');
    }
    items.push(Object.freeze({
      kind: item.kind,
      riskClass: item.riskClass,
      machineApplicable: item.machineApplicable === true,
      requiresApproval: item.requiresApproval === true,
      authorityEffect: item.authorityEffect,
      precondition: Object.freeze({ ...precondition }),
      action: Object.freeze({ ...action }),
    }));
  }
  return Object.freeze({
    schemaVersion: REMEDIATION_SET_SCHEMA_VERSION,
    registryVersion: REMEDIATION_KIND_REGISTRY_VERSION,
    ...(artifactHash === undefined ? {} : { artifactHash }),
    items: Object.freeze(items),
  });
}

export function createIdentifierRemediationSet({ artifactHash, target, owner, replacements }) {
  if (typeof artifactHash !== 'string' || !ARTIFACT_HASH_PATTERN.test(artifactHash)) {
    throw new TypeError('artifactHash must be a supported sha256 digest');
  }
  const items = [...new Set(replacements)]
    .filter((replacement) => typeof replacement === 'string' && replacement.length > 0)
    .slice(0, REMEDIATION_SET_MAX_ITEMS)
    .map((replacement) => ({
      kind: 'fixTypo',
      riskClass: 'mechanical',
      machineApplicable: true,
      requiresApproval: false,
      authorityEffect: 'none',
      precondition: { type: 'artifact-hash', artifactHash },
      action: {
        type: 'replaceIdentifier',
        target,
        ...(owner === undefined ? {} : { owner }),
        replacement,
      },
    }));
  return {
    schemaVersion: REMEDIATION_SET_SCHEMA_VERSION,
    registryVersion: REMEDIATION_KIND_REGISTRY_VERSION,
    artifactHash,
    items,
  };
}

export const remediationControlCatalogProjection = Object.freeze({
  carrier: 'diagnostic.details.remediationSet',
  schemaVersion: REMEDIATION_SET_SCHEMA_VERSION,
  registryVersion: REMEDIATION_KIND_REGISTRY_VERSION,
  decoder: '@expo/snapback-client/remediation',
});
