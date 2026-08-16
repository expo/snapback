// Visibility-override and ordinary table-policy governance.
//
// @ref LLP 0234#d3--widening-requires-a-remotely-prior-artifact-closed-approval-receipt
//   — current-tree generation verifies content closure and signed separation;
//   Git predecessor ordering is deliberately owned by the admission comparator.
// @ref LLP 0234#d5--exact-ratchets-cover-overrides-and-ordinary-policy-widening
//   — baselines are exact sets and transition/quarantine history is retained as
//   digest-linked append-only chains rather than trusted authored labels.

import { createHash, createPublicKey, verify as verifySignature } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, isAbsolute, join, normalize, relative, resolve, sep } from 'node:path';

import { stableArtifactJson } from './review-surface.mjs';

export const GOVERNANCE_SCHEMA_VERSIONS = Object.freeze({
  overrideDeclaration: 'snapback.visibility-override-declaration.v1',
  approvalRecord: 'snapback.visibility-override-approval.v1',
  transitionRecord: 'snapback.table-visibility-policy-transition.v1',
  ownerMap: 'snapback.visibility-override-owner-map.v1',
  ownerBaseline: 'snapback.visibility-override-owner-baseline.v1',
  overrideBaseline: 'snapback.visibility-override-baseline.v1',
  policyBaseline: 'snapback.table-visibility-policy-baseline.v1',
  transitionLedger: 'snapback.table-visibility-policy-transition-ledger.v1',
  quarantineLedger: 'snapback.visibility-governance-quarantine-ledger.v1',
  quarantineVerdict: 'snapback.visibility-governance-quarantine-verdict.v1',
  observerKeys: 'snapback.visibility-governance-observer-keys.v1',
  separationReceipt: 'snapback.visibility-governance-separation-receipt.v1',
  governedUpdateVerdict: 'snapback.visibility-governance-update-verdict.v1',
  fixtureProfile: 'snapback.visibility-fixture-profile.v1',
  activation: 'snapback.visibility-governance-activation.v1',
  g1Closure: 'snapback.visibility-governance-g1-closure.v1',
});

export const GOVERNANCE_FILES = Object.freeze({
  ownerMap: 'visibility-override-owners.json',
  ownerBaseline: 'generated/visibility-override-owner-baseline.json',
  overrideBaseline: 'generated/visibility-override-baseline.json',
  policyBaseline: 'generated/table-visibility-policy-baseline.json',
  transitionLedger: 'generated/table-visibility-policy-transition-ledger.json',
  quarantineLedger: 'generated/visibility-governance-quarantine-ledger.json',
  elevatedReadBaseline: 'generated/elevated-read-site-baseline.json',
  observerKeys: 'visibility-governance-observer-keys.json',
  g1Closure: 'visibility-governance-g1-closure.json',
});

export const GOVERNED_REFS_DEFAULT = Object.freeze(['refs/heads/main']);
export const GOVERNANCE_COMPARATOR_VERSION = 'snapback.visibility-governance-comparator.v1';
export const GOVERNANCE_SCOPE_DIGEST_VERSION = 'snapback.visibility-scope.v1';
export const GOVERNANCE_DIGEST_ALGORITHM = 'sha256';

const SHA256 = /^sha256:[0-9a-f]{64}$/u;
const OID = /^[0-9a-f]{40}$/u;
const UTC_INSTANT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/u;
const UTC_DATE = /^\d{4}-\d{2}-\d{2}$/u;
const IDENT = /^[A-Za-z0-9][A-Za-z0-9._:@/-]*$/u;
const FIELD_IDENT = /^[A-Za-z_][A-Za-z0-9_]*$/u;
const ZERO_OID = '0'.repeat(40);
const MAX_GRANT_MS = 90 * 24 * 60 * 60 * 1000;
const MAX_ISSUED_SKEW_MS = 5 * 60 * 1000;
const WARNING_WINDOW_MS = 30 * 24 * 60 * 60 * 1000;

const compareText = (left, right) => (left < right ? -1 : left > right ? 1 : 0);

export class VisibilityGovernanceError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = 'VisibilityGovernanceError';
    this.code = code;
    this.details = details;
  }
}

function refuse(code, message, details = {}) {
  throw new VisibilityGovernanceError(code, message, details);
}

function object(value, label, code) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    refuse(code, `${label} must be an object`, { field: label });
  }
  return value;
}

function exactKeys(value, allowed, label, code, required = []) {
  object(value, label, code);
  for (const key of Object.keys(value)) {
    if (!allowed.includes(key)) refuse(code, `${label} has unknown field ${key}`, { field: key });
  }
  for (const key of required) {
    if (!Object.hasOwn(value, key)) refuse(code, `${label} requires ${key}`, { field: key });
  }
}

function nonEmpty(value, label, code) {
  if (typeof value !== 'string' || value.length === 0) {
    refuse(code, `${label} must be a non-empty string`, { field: label });
  }
  return value;
}

function identifier(value, label, code) {
  nonEmpty(value, label, code);
  if (!IDENT.test(value) || value.includes('..')) {
    refuse(code, `${label} is not a stable governance identifier`, { field: label, value });
  }
  return value;
}

function fieldIdentifier(value, label, code) {
  nonEmpty(value, label, code);
  if (!FIELD_IDENT.test(value)) {
    refuse(code, `${label} is not a stable schema field identifier`, { field: label, value });
  }
  return value;
}

function exactArray(value, label, code, { min = 0 } = {}) {
  if (!Array.isArray(value) || value.length < min) {
    refuse(code, `${label} must be an array with at least ${min} item(s)`, { field: label });
  }
  return value;
}

function sortedUniqueStrings(value, label, code, options = {}) {
  const values = exactArray(value, label, code, options).map((item, index) => (
    identifier(item, `${label}.${index}`, code)
  ));
  if (new Set(values).size !== values.length) {
    refuse(code, `${label} must not contain duplicates`, { field: label });
  }
  return [...values].sort(compareText);
}

export function canonicalGovernanceJson(value) {
  return stableArtifactJson(value);
}

export function governanceDigest(domain, value) {
  return `sha256:${createHash('sha256')
    .update(`${domain}\n${canonicalGovernanceJson(value)}`)
    .digest('hex')}`;
}

function verifyDigest(actual, expected, label, code) {
  if (!SHA256.test(expected) || actual !== expected) {
    refuse(code, `${label} digest does not match its canonical content`, {
      field: label,
      expected,
      actual,
    });
  }
}

function canonicalPolicyLeaf(policy, label, code) {
  object(policy, label, code);
  if (policy.kind === 'public-read') {
    exactKeys(policy, ['kind'], label, code, ['kind']);
    return { kind: 'public-read' };
  }
  if (policy.kind === 'owner') {
    exactKeys(policy, ['kind', 'field'], label, code, ['kind', 'field']);
    return { kind: 'owner', field: fieldIdentifier(policy.field, `${label}.field`, code) };
  }
  if (policy.kind === 'membership') {
    exactKeys(policy, ['kind', 'declaration', 'resourceField', 'roles'], label, code,
      ['kind', 'declaration', 'resourceField']);
    return {
      kind: 'membership',
      declaration: identifier(policy.declaration, `${label}.declaration`, code),
      resourceField: fieldIdentifier(policy.resourceField, `${label}.resourceField`, code),
      ...(policy.roles === undefined
        ? {}
        : { roles: sortedUniqueStrings(policy.roles, `${label}.roles`, code, { min: 1 }) }),
    };
  }
  refuse(code, `${label}.kind is not a closed visibility-policy kind`, { kind: policy.kind });
}

export function canonicalVisibilityPolicy(policy, label = 'policy', code = 'SNAPBACK_TABLE_VISIBILITY_POLICY_PROVENANCE_INVALID') {
  object(policy, label, code);
  if (policy.kind !== 'any-of') return canonicalPolicyLeaf(policy, label, code);
  exactKeys(policy, ['kind', 'arms'], label, code, ['kind', 'arms']);
  const arms = exactArray(policy.arms, `${label}.arms`, code, { min: 2 })
    .map((arm, index) => canonicalPolicyLeaf(arm, `${label}.arms.${index}`, code));
  if (arms.some(({ kind }) => kind === 'public-read' || kind === 'any-of')) {
    refuse(code, `${label}.arms may contain only owner or membership leaves`);
  }
  const keyed = arms.map((arm) => canonicalGovernanceJson(arm));
  if (new Set(keyed).size !== keyed.length) refuse(code, `${label}.arms repeat an authority arm`);
  return { kind: 'any-of', arms: arms.sort((a, b) => compareText(canonicalGovernanceJson(a), canonicalGovernanceJson(b))) };
}

function membershipDeclarationClosure(policy, tables, code) {
  const leaves = policy.kind === 'any-of' ? policy.arms : [policy];
  const declarations = new Map();
  for (const leaf of leaves) {
    if (leaf.kind !== 'membership') continue;
    const match = Object.entries(tables).find(([table, definition]) => (
      definition.membership && (definition.membership.id ?? table) === leaf.declaration
    ));
    if (!match) refuse(code, `membership declaration ${leaf.declaration} is not present`);
    const [membershipTable, definition] = match;
    const membership = definition.membership;
    const resourceField = definition.fields?.find(({ name }) => name === membership.resource);
    const resourceTable = membership.resourceTable
      ?? resourceField?.type?.Id?.table
      ?? resourceField?.fieldType?.Id?.table
      ?? null;
    const body = {
      id: membership.id ?? membershipTable,
      membershipTable,
      resourceTable,
      principalField: membership.principal,
      resourceField: membership.resource,
      roleField: membership.role,
      policyResourceField: leaf.resourceField,
      roles: [...(leaf.roles ?? membership.roles ?? [])].sort(compareText),
    };
    declarations.set(body.id, body);
  }
  return [...declarations.values()].sort((a, b) => compareText(a.id, b.id));
}

export function normalizePolicyBody(policy, tables = {}) {
  const normalizedPolicy = canonicalVisibilityPolicy(policy);
  const audienceDeclarationClosure = membershipDeclarationClosure(
    normalizedPolicy,
    tables,
    'SNAPBACK_TABLE_VISIBILITY_POLICY_PROVENANCE_INVALID',
  );
  return {
    policy: normalizedPolicy,
    audienceDeclarationClosure,
    audienceDeclarationClosureDigest: governanceDigest(
      'snapback:visibility-audience-closure:v1',
      audienceDeclarationClosure,
    ),
  };
}

function policyLeafSet(policy) {
  return new Set((policy.kind === 'any-of' ? policy.arms : [policy])
    .map((leaf) => canonicalGovernanceJson(leaf)));
}

// A deliberately conservative structural partial order. Anything not proved
// equal or set-subset is incomparable and therefore governed as growth.
export function compareVisibilityPolicies(predecessorBody, successorBody) {
  if (predecessorBody === null) {
    return successorBody.policy.kind === 'public-read' ? 'growth' : 'new-restricted';
  }
  const predecessor = canonicalGovernanceJson(predecessorBody);
  const successor = canonicalGovernanceJson(successorBody);
  if (predecessor === successor) return 'equal';
  if (predecessorBody.policy.kind === 'public-read') return 'narrowing';
  if (successorBody.policy.kind === 'public-read') return 'growth';
  const before = policyLeafSet(predecessorBody.policy);
  const after = policyLeafSet(successorBody.policy);
  if ([...after].every((arm) => before.has(arm))
    && successorBody.audienceDeclarationClosureDigest
      === predecessorBody.audienceDeclarationClosureDigest) return 'narrowing';
  return 'growth';
}

function canonicalAuthority(authority, label, code) {
  object(authority, label, code);
  if (authority.mode === 'principal') {
    exactKeys(authority, ['mode', 'operations', 'admissionPolicy'], label, code,
      ['mode', 'operations', 'admissionPolicy']);
    return {
      mode: 'principal',
      operations: sortedUniqueStrings(authority.operations, `${label}.operations`, code, { min: 1 }),
      admissionPolicy: canonicalVisibilityPolicy(authority.admissionPolicy, `${label}.admissionPolicy`, code),
    };
  }
  if (authority.mode === 'system') {
    exactKeys(authority, ['mode', 'entrypoint', 'calls'], label, code, ['mode', 'entrypoint']);
    return {
      mode: 'system',
      entrypoint: identifier(authority.entrypoint, `${label}.entrypoint`, code),
      calls: sortedUniqueStrings(authority.calls ?? [], `${label}.calls`, code),
    };
  }
  if (authority.mode === 'capturedGrant') {
    exactKeys(authority, ['mode', 'issuanceProfile', 'operations', 'maximumTtlMs'], label, code,
      ['mode', 'issuanceProfile', 'operations', 'maximumTtlMs']);
    if (!Number.isSafeInteger(authority.maximumTtlMs) || authority.maximumTtlMs <= 0) {
      refuse(code, `${label}.maximumTtlMs must be a positive safe integer`);
    }
    return {
      mode: 'capturedGrant',
      issuanceProfile: identifier(authority.issuanceProfile, `${label}.issuanceProfile`, code),
      operations: sortedUniqueStrings(authority.operations, `${label}.operations`, code, { min: 1 }),
      maximumTtlMs: authority.maximumTtlMs,
    };
  }
  refuse(code, `${label}.mode must be principal, system, or capturedGrant`);
}

function canonicalRowScope(scope, label, code) {
  object(scope, label, code);
  if (scope.allRows === true) {
    exactKeys(scope, ['allRows'], label, code, ['allRows']);
    return { allRows: true };
  }
  if (scope.kind) return canonicalVisibilityPolicy(scope, label, code);
  if (typeof scope.field === 'string' && scope.op === 'Eq' && scope.value !== undefined) {
    return { kind: 'argument-equality', field: scope.field, value: structuredClone(scope.value) };
  }
  refuse(code, `${label} must be allRows, a closed visibility policy, or argument equality`);
}

function canonicalFixtureProfile(profile, label, code) {
  exactKeys(profile, ['schemaVersion', 'id', 'digest', 'targetClassCeiling', 'principalClass', 'dataClassification'],
    label, code, ['schemaVersion', 'id', 'digest', 'targetClassCeiling', 'principalClass', 'dataClassification']);
  if (profile.schemaVersion !== GOVERNANCE_SCHEMA_VERSIONS.fixtureProfile) {
    refuse(code, `${label}.schemaVersion is unsupported`);
  }
  if (profile.principalClass !== 'synthetic' || profile.dataClassification !== 'fixture-owned') {
    refuse(code, `${label} must bind synthetic principals and fixture-owned data`);
  }
  const body = {
    schemaVersion: profile.schemaVersion,
    id: identifier(profile.id, `${label}.id`, code),
    targetClassCeiling: identifier(profile.targetClassCeiling, `${label}.targetClassCeiling`, code),
    principalClass: profile.principalClass,
    dataClassification: profile.dataClassification,
  };
  verifyDigest(governanceDigest('snapback:visibility-fixture-profile:v1', body), profile.digest,
    `${label}.digest`, code);
  return { ...body, digest: profile.digest };
}

function canonicalGovernedReads(readsValue, tables, label, code) {
  const reads = object(readsValue, label, code);
  const normalizedReads = Object.entries(reads).map(([table, scope]) => {
    identifier(table, `${label} table`, code);
    if (!Object.hasOwn(tables, table)) refuse(code, `${label} names unknown table ${table}`);
    const normalizedScope = canonicalRowScope(scope, `${label}.${table}`, code);
    const audienceDeclarationClosure = normalizedScope.kind
      && ['membership', 'any-of'].includes(normalizedScope.kind)
      ? membershipDeclarationClosure(normalizedScope, tables, code)
      : [];
    return {
      table,
      scope: normalizedScope,
      rowScopeDigest: governanceDigest('snapback:visibility-row-scope:v1', normalizedScope),
      audienceDeclarationClosure,
      audienceDeclarationClosureDigest: governanceDigest(
        'snapback:visibility-audience-closure:v1',
        audienceDeclarationClosure,
      ),
    };
  }).sort((a, b) => compareText(a.table, b.table));
  if (normalizedReads.length === 0) refuse(code, `${label} must not be empty`);
  return normalizedReads;
}

function canonicalPatternCeiling(value, tables, code) {
  exactKeys(value, ['authority', 'reads', 'operations', 'lifecycleClass', 'fixtureProfile'],
    'pattern approval.patternCeiling', code,
    ['authority', 'reads', 'operations', 'lifecycleClass']);
  const authority = canonicalAuthority(value.authority, 'pattern ceiling.authority', code);
  if (authority.mode === 'principal') {
    const audienceClosure = membershipDeclarationClosure(authority.admissionPolicy, tables, code);
    authority.admissionMembershipAudienceClosure = audienceClosure;
    authority.admissionMembershipAudienceClosureDigest = governanceDigest(
      'snapback:visibility-audience-closure:v1',
      audienceClosure,
    );
  }
  const operations = sortedUniqueStrings(value.operations,
    'pattern ceiling.operations', code, { min: 1 });
  if ((authority.mode === 'principal' || authority.mode === 'capturedGrant')
    && canonicalGovernanceJson(authority.operations) !== canonicalGovernanceJson(operations)) {
    refuse(code, 'pattern ceiling authority operations must cover its exact declared operation set');
  }
  if (authority.mode === 'system' && !operations.includes(authority.entrypoint)) {
    refuse(code, 'pattern ceiling system entrypoint must be among its operations');
  }
  const ceiling = {
    authority,
    reads: canonicalGovernedReads(value.reads, tables, 'pattern ceiling.reads', code),
    operations,
    lifecycleClass: value.lifecycleClass,
  };
  if (value.lifecycleClass === 'fixture') {
    ceiling.fixtureProfile = canonicalFixtureProfile(value.fixtureProfile,
      'pattern ceiling.fixtureProfile', code);
  } else if (value.lifecycleClass === 'production') {
    if (value.fixtureProfile !== undefined) refuse(code, 'production pattern ceiling forbids fixtureProfile');
  } else {
    refuse(code, 'pattern ceiling.lifecycleClass must be production or fixture');
  }
  return ceiling;
}

function rowScopeIsWithin(instance, ceiling, tables) {
  if (ceiling.allRows === true) return true;
  if (canonicalGovernanceJson(instance) === canonicalGovernanceJson(ceiling)) return true;
  if (instance.kind && ceiling.kind
    && instance.kind !== 'argument-equality' && ceiling.kind !== 'argument-equality') {
    return compareVisibilityPolicies(
      normalizePolicyBody(ceiling, tables),
      normalizePolicyBody(instance, tables),
    ) !== 'growth';
  }
  return false;
}

function patternInstanceIsWithin(declaration, ceiling, approval, tables) {
  if (declaration.lifecycleClass !== ceiling.lifecycleClass
    || declaration.authority.mode !== ceiling.authority.mode
    || !setSubset(ceiling.operations, declaration.operations)) return false;
  if (declaration.lifecycleClass === 'fixture'
    && canonicalGovernanceJson(declaration.fixtureProfile)
      !== canonicalGovernanceJson(ceiling.fixtureProfile)) return false;
  if (declaration.lifecycleClass === 'production'
    && declaration.expiresOn > approval.expiresOn) return false;
  const instanceAuthority = declaration.authority;
  const ceilingAuthority = ceiling.authority;
  if (instanceAuthority.mode === 'system'
    && (instanceAuthority.entrypoint !== ceilingAuthority.entrypoint
      || !setSubset(ceilingAuthority.calls, instanceAuthority.calls))) return false;
  if (instanceAuthority.mode === 'capturedGrant'
    && (instanceAuthority.issuanceProfile !== ceilingAuthority.issuanceProfile
      || instanceAuthority.maximumTtlMs > ceilingAuthority.maximumTtlMs
      || !setSubset(ceilingAuthority.operations, instanceAuthority.operations))) return false;
  if (instanceAuthority.mode === 'principal'
    && (!setSubset(ceilingAuthority.operations, instanceAuthority.operations)
      || compareVisibilityPolicies(
        normalizePolicyBody(ceilingAuthority.admissionPolicy, tables),
        normalizePolicyBody(instanceAuthority.admissionPolicy, tables),
      ) === 'growth')) return false;
  const ceilingReads = new Map(ceiling.reads.map((entry) => [entry.table, entry.scope]));
  return declaration.reads.every(({ table, scope }) => (
    ceilingReads.has(table) && rowScopeIsWithin(scope, ceilingReads.get(table), tables)
  ));
}

export function canonicalOverrideDeclaration(declaration, tables = {}) {
  const code = 'SNAPBACK_TABLE_VISIBILITY_OVERRIDE_APPROVAL_INVALID';
  exactKeys(declaration, [
    'schemaVersion', 'id', 'owner', 'authority', 'reads', 'operations', 'justification',
    'lifecycleClass', 'issuedOn', 'expiresOn', 'fixtureProfile', 'approval',
    'approvalSeparationReceipt', 'acceptance', 'patternDerivation', 'rekey',
  ], 'visibility override', code, [
    'schemaVersion', 'id', 'owner', 'authority', 'reads', 'operations', 'justification',
    'lifecycleClass', 'approval', 'approvalSeparationReceipt', 'acceptance',
  ]);
  if (declaration.schemaVersion !== GOVERNANCE_SCHEMA_VERSIONS.overrideDeclaration) {
    refuse(code, 'visibility override schemaVersion is unsupported');
  }
  // @ref LLP 0234#d3--widening-requires-a-remotely-prior-artifact-closed-approval-receipt
  // A derivation or re-key record is authority-bearing provenance. The v1
  // pattern record is closed below; re-keying remains unavailable until a
  // second retained canonicalizer can actually prove equality.
  if (declaration.rekey !== undefined) {
    refuse(code, 're-key provenance is not proved by the retained v1 canonicalizer; a fresh approval and author ruling are required');
  }
  const normalizedReads = canonicalGovernedReads(
    declaration.reads,
    tables,
    'visibility override.reads',
    code,
  );
  const authority = canonicalAuthority(declaration.authority, 'visibility override.authority', code);
  if (authority.mode === 'principal') {
    const audienceClosure = membershipDeclarationClosure(authority.admissionPolicy, tables, code);
    authority.admissionMembershipAudienceClosure = audienceClosure;
    authority.admissionMembershipAudienceClosureDigest = governanceDigest(
      'snapback:visibility-audience-closure:v1',
      audienceClosure,
    );
  }
  const operations = sortedUniqueStrings(declaration.operations, 'visibility override.operations', code, { min: 1 });
  if ((authority.mode === 'principal' || authority.mode === 'capturedGrant')
    && canonicalGovernanceJson(authority.operations) !== canonicalGovernanceJson(operations)) {
    refuse(code, `visibility override ${authority.mode} authority must bind the exact declared operations`);
  }
  if (authority.mode === 'system' && !operations.includes(authority.entrypoint)) {
    refuse(code, 'visibility override system entrypoint must be one of its declared operations');
  }
  const acceptance = declaration.acceptance;
  exactKeys(acceptance, ['id', 'path', 'resultDigest'], 'visibility override.acceptance', code,
    ['id', 'path', 'resultDigest']);
  const canonical = {
    schemaVersion: declaration.schemaVersion,
    id: identifier(declaration.id, 'visibility override.id', code),
    owner: identifier(declaration.owner, 'visibility override.owner', code),
    authority,
    reads: normalizedReads,
    operations,
    justificationDigest: governanceDigest('snapback:visibility-override-justification:v1', declaration.justification),
    lifecycleClass: declaration.lifecycleClass,
    acceptance: {
      id: identifier(acceptance.id, 'visibility override.acceptance.id', code),
      path: nonEmpty(acceptance.path, 'visibility override.acceptance.path', code),
      resultDigest: nonEmpty(acceptance.resultDigest, 'visibility override.acceptance.resultDigest', code),
    },
  };
  if (declaration.lifecycleClass === 'production') {
    if (!UTC_INSTANT.test(declaration.issuedOn ?? '') || !UTC_DATE.test(declaration.expiresOn ?? '')) {
      refuse(code, 'production override requires UTC issuedOn and expiresOn');
    }
    if (declaration.fixtureProfile !== undefined) refuse(code, 'production override forbids fixtureProfile');
    canonical.issuedOn = declaration.issuedOn;
    canonical.expiresOn = declaration.expiresOn;
  } else if (declaration.lifecycleClass === 'fixture') {
    if (declaration.issuedOn !== undefined || declaration.expiresOn !== undefined) {
      refuse(code, 'fixture override forbids issuedOn and expiresOn');
    }
    canonical.fixtureProfile = canonicalFixtureProfile(declaration.fixtureProfile,
      'visibility override.fixtureProfile', code);
  } else {
    refuse(code, 'visibility override.lifecycleClass must be production or fixture');
  }
  let patternDerivation;
  if (declaration.patternDerivation !== undefined) {
    exactKeys(declaration.patternDerivation, [
      'patternId', 'constructorVersion', 'constructorDigest', 'derivationDigest',
    ], 'visibility override.patternDerivation', code, [
      'patternId', 'constructorVersion', 'constructorDigest', 'derivationDigest',
    ]);
    patternDerivation = {
      patternId: identifier(declaration.patternDerivation.patternId,
        'visibility override.patternDerivation.patternId', code),
      constructorVersion: identifier(declaration.patternDerivation.constructorVersion,
        'visibility override.patternDerivation.constructorVersion', code),
      constructorDigest: nonEmpty(declaration.patternDerivation.constructorDigest,
        'visibility override.patternDerivation.constructorDigest', code),
      derivationDigest: nonEmpty(declaration.patternDerivation.derivationDigest,
        'visibility override.patternDerivation.derivationDigest', code),
    };
    if (!SHA256.test(patternDerivation.constructorDigest)
      || !SHA256.test(patternDerivation.derivationDigest)) {
      refuse(code, 'visibility override pattern derivation digests must be sha256');
    }
    canonical.patternDerivation = {
      patternId: patternDerivation.patternId,
      constructorVersion: patternDerivation.constructorVersion,
      constructorDigest: patternDerivation.constructorDigest,
    };
  }
  return {
    canonical,
    approvalPath: nonEmpty(declaration.approval, 'visibility override.approval', code),
    separationReceiptPath: nonEmpty(declaration.approvalSeparationReceipt,
      'visibility override.approvalSeparationReceipt', code),
    ...(patternDerivation === undefined ? {} : { patternDerivation }),
  };
}

export function overrideScopeDigest(canonical) {
  return governanceDigest('snapback:visibility-override-scope:v1', canonical);
}

function parseJsonFile(path, code, label) {
  try {
    return JSON.parse(readFileSync(path, 'utf8'));
  } catch (error) {
    refuse(code, `${label} is missing or malformed: ${error.message}`, { path });
  }
}

function resolveGovernancePath(backendRoot, pointer, code, label) {
  nonEmpty(pointer, label, code);
  if (isAbsolute(pointer)) refuse(code, `${label} must be repository-relative`, { path: pointer });
  const normalized = normalize(pointer);
  if (normalized.split(sep).includes('..')) refuse(code, `${label} escapes its backend`, { path: pointer });
  const root = resolve(backendRoot);
  const candidate = resolve(root, normalized);
  if (candidate !== root && !candidate.startsWith(`${root}${sep}`)) {
    refuse(code, `${label} escapes its backend`, { path: pointer });
  }
  return candidate;
}

export function canonicalOwnerMap(ownerMap) {
  const code = 'SNAPBACK_TABLE_VISIBILITY_OVERRIDE_APPROVAL_INVALID';
  exactKeys(ownerMap, ['schemaVersion', 'fallbackApprovalOwner', 'entries'], 'owner map', code,
    ['schemaVersion', 'fallbackApprovalOwner', 'entries']);
  if (ownerMap.schemaVersion !== GOVERNANCE_SCHEMA_VERSIONS.ownerMap) refuse(code, 'owner map schemaVersion is unsupported');
  const entries = exactArray(ownerMap.entries, 'owner map.entries', code).map((entry, index) => {
    exactKeys(entry, ['path', 'patternId', 'implementationOwner', 'approvalOwner', 'authorRuling', 'delegationRecord'],
      `owner map.entries.${index}`, code, ['implementationOwner', 'approvalOwner', 'authorRuling', 'delegationRecord']);
    if ((entry.path === undefined) === (entry.patternId === undefined)) {
      refuse(code, `owner map.entries.${index} requires exactly one of path or patternId`);
    }
    if (typeof entry.authorRuling !== 'string' || entry.authorRuling.length === 0
      || !entry.delegationRecord || typeof entry.delegationRecord !== 'object'
      || Array.isArray(entry.delegationRecord)) {
      refuse(code, `owner map.entries.${index} requires its exact author-ruling delegation closure`);
    }
    return {
      ...(entry.path === undefined ? {} : { path: nonEmpty(entry.path, `owner map.entries.${index}.path`, code) }),
      ...(entry.patternId === undefined ? {} : { patternId: identifier(entry.patternId, `owner map.entries.${index}.patternId`, code) }),
      implementationOwner: identifier(entry.implementationOwner, `owner map.entries.${index}.implementationOwner`, code),
      approvalOwner: identifier(entry.approvalOwner, `owner map.entries.${index}.approvalOwner`, code),
      authorRuling: entry.authorRuling,
      delegationRecord: structuredClone(entry.delegationRecord),
    };
  }).sort((a, b) => compareText(a.path ?? `~${a.patternId}`, b.path ?? `~${b.patternId}`));
  const ownerKeys = entries.map((entry) => entry.path ?? `pattern:${entry.patternId}`);
  if (new Set(ownerKeys).size !== ownerKeys.length) {
    refuse(code, 'owner map contains a duplicate governed path or pattern id');
  }
  return {
    schemaVersion: ownerMap.schemaVersion,
    fallbackApprovalOwner: identifier(ownerMap.fallbackApprovalOwner, 'owner map.fallbackApprovalOwner', code),
    entries,
  };
}

function validateOwnerMapArtifacts(ownerMap, backendRoot, code) {
  for (const entry of ownerMap.entries) {
    const ruling = parseJsonFile(
      resolveGovernancePath(backendRoot, entry.authorRuling, code, 'owner-map author ruling'),
      code,
      'owner-map author ruling',
    );
    if (canonicalGovernanceJson(ruling.delegationRecord)
      !== canonicalGovernanceJson(entry.delegationRecord)) {
      refuse(code, `owner-map delegation for ${entry.path ?? entry.patternId} does not deep-match its author ruling`);
    }
  }
}

function canonicalOwnerBaselineEntry(entry, label) {
  const code = 'SNAPBACK_TABLE_VISIBILITY_OVERRIDE_APPROVAL_INVALID';
  exactKeys(entry, [
    'path', 'patternId', 'implementationOwner', 'approvalOwner', 'authorRuling',
    'delegationRecord', 'delegationClosureDigest',
  ], label, code, [
    'implementationOwner', 'approvalOwner', 'authorRuling', 'delegationRecord',
    'delegationClosureDigest',
  ]);
  const { delegationClosureDigest, ...source } = entry;
  const normalized = canonicalOwnerMap({
    schemaVersion: GOVERNANCE_SCHEMA_VERSIONS.ownerMap,
    fallbackApprovalOwner: 'baseline-validation-only',
    entries: [source],
  }).entries[0];
  verifyDigest(
    governanceDigest('snapback:visibility-owner-delegation-closure:v1', {
      authorRuling: normalized.authorRuling,
      delegationRecord: normalized.delegationRecord,
    }),
    delegationClosureDigest,
    `${label}.delegationClosureDigest`,
    code,
  );
  return { ...normalized, delegationClosureDigest };
}

function ownerForDeclaration(ownerMap, declaration) {
  const match = ownerMap.entries.find((entry) => entry.path === declaration.acceptance.path)
    ?? ownerMap.entries.find((entry) => entry.patternId === declaration.patternDerivation?.patternId);
  return match ?? {
    implementationOwner: declaration.owner,
    approvalOwner: ownerMap.fallbackApprovalOwner,
    authorRuling: null,
    delegationRecord: null,
  };
}

function deepEqualRecord(pointerValue, repeated, recordField, code, label) {
  if (canonicalGovernanceJson(pointerValue?.[recordField]) !== canonicalGovernanceJson(repeated)) {
    refuse(code, `${label} ${recordField} does not deep-match its pointed artifact`, { field: recordField });
  }
}

function validateRetainedApprovalClosure(approval, ownerMap, backendRoot, code) {
  const ownerMapDigest = governanceDigest('snapback:visibility-owner-map:v1', ownerMap);
  if (approval.ownerMapDigest !== ownerMapDigest) refuse(code, 'approval ownerMapDigest is stale');
  for (const [pathField, recordField] of [
    ['reviewArtifact', 'reviewRecord'],
    ['approvalRuling', 'rulingRecord'],
    ['delegationRuling', 'delegationRecord'],
  ]) {
    const pointer = approval[pathField];
    const repeated = approval[recordField] ?? null;
    if (pointer === null || pointer === undefined) {
      if (repeated !== null) refuse(code, `${recordField} requires ${pathField}`);
      continue;
    }
    const artifact = parseJsonFile(resolveGovernancePath(backendRoot, pointer, code, pathField), code, pathField);
    deepEqualRecord(artifact, repeated, recordField, code, pathField);
  }
  return {
    ownerMapDigest,
    approvalClosureDigest: governanceDigest(
      'snapback:visibility-approval-closure:v1',
      { approval: structuredClone(approval), ownerMap },
    ),
  };
}

export function patternApprovalScopeDigest(approval, patternCeiling) {
  return governanceDigest('snapback:visibility-pattern-approval-scope:v1', {
    scopeDigestVersion: approval.scopeDigestVersion,
    digestAlgorithm: approval.digestAlgorithm,
    patternId: approval.patternId,
    constructorVersion: approval.constructorVersion,
    constructorDigest: approval.constructorDigest,
    patternCeiling,
    lifecycleClass: approval.lifecycleClass,
    issuedOn: approval.issuedOn,
    expiresOn: approval.expiresOn ?? null,
    justificationDigest: approval.justificationDigest,
    acceptanceId: approval.acceptanceId,
    acceptancePath: approval.acceptancePath,
    ownerMapDigest: approval.ownerMapDigest,
  });
}

function validateApproval(approval, declaration, scopeDigest, ownerMap, backendRoot, tables, patternDerivation) {
  const code = 'SNAPBACK_TABLE_VISIBILITY_OVERRIDE_APPROVAL_INVALID';
  exactKeys(approval, [
    'schemaVersion', 'scopeDigestVersion', 'digestAlgorithm', 'approvalKind', 'id',
    'scopeDigest', 'patternId', 'constructorVersion', 'constructorDigest',
    'patternCeiling',
    'lifecycleClass', 'authorityAdmissionPolicy', 'authorityAdmissionPolicyDigest',
    'authorityAdmissionMembershipAudienceClosure',
    'authorityAdmissionMembershipAudienceClosureDigest',
    'fixtureProfileId', 'fixtureProfileDigest', 'fixtureTargetClassCeiling',
    'fixturePrincipalClass', 'fixtureDataClassification',
    'requestedBy', 'approvedBy', 'ownerMapDigest',
    'issuedOn', 'expiresOn', 'justificationDigest', 'acceptanceId', 'acceptancePath',
    'reviewArtifact', 'reviewRecord', 'approvalRuling', 'rulingRecord',
    'delegationRuling', 'delegationRecord',
  ], 'approval record', code, [
    'schemaVersion', 'scopeDigestVersion', 'digestAlgorithm', 'approvalKind', 'id',
    'scopeDigest', 'lifecycleClass', 'requestedBy', 'approvedBy', 'ownerMapDigest',
    'issuedOn', 'justificationDigest', 'acceptanceId', 'acceptancePath',
    'reviewArtifact', 'reviewRecord', 'approvalRuling', 'rulingRecord',
    'delegationRuling', 'delegationRecord',
  ]);
  if (approval.schemaVersion !== GOVERNANCE_SCHEMA_VERSIONS.approvalRecord
    || approval.scopeDigestVersion !== GOVERNANCE_SCOPE_DIGEST_VERSION
    || approval.digestAlgorithm !== GOVERNANCE_DIGEST_ALGORITHM
    || approval.lifecycleClass !== declaration.lifecycleClass
    || !UTC_INSTANT.test(approval.issuedOn ?? '')
    || !SHA256.test(approval.justificationDigest ?? '')) {
    refuse(code, `approval record does not bind override ${declaration.id}`, { approvalId: approval.id });
  }
  let approvalAuthority = declaration.authority;
  let approvalFixtureProfile = declaration.fixtureProfile;
  let normalizedPatternCeiling = null;
  if (patternDerivation === undefined) {
    if (approval.approvalKind !== 'custom'
      || approval.id !== declaration.id
      || approval.scopeDigest !== scopeDigest
      || approval.justificationDigest !== declaration.justificationDigest
      || approval.acceptanceId !== declaration.acceptance.id
      || approval.acceptancePath !== declaration.acceptance.path
      || (declaration.lifecycleClass === 'production'
        && approval.issuedOn !== declaration.issuedOn)
      || approval.expiresOn !== declaration.expiresOn
      || [approval.patternId, approval.constructorVersion, approval.constructorDigest,
        approval.patternCeiling].some((value) => value !== undefined)) {
      refuse(code, `custom approval record does not exactly bind override ${declaration.id}`);
    }
  } else {
    if (approval.approvalKind !== 'pattern'
      || approval.id !== patternDerivation.patternId
      || approval.patternId !== patternDerivation.patternId
      || approval.constructorVersion !== patternDerivation.constructorVersion
      || approval.constructorDigest !== patternDerivation.constructorDigest) {
      refuse(code, `pattern approval does not bind derivation for ${declaration.id}`);
    }
    const patternCeiling = canonicalPatternCeiling(approval.patternCeiling, tables, code);
    normalizedPatternCeiling = patternCeiling;
    const constructorDigest = governanceDigest(
      'snapback:visibility-pattern-constructor:v1',
      patternCeiling,
    );
    if (constructorDigest !== approval.constructorDigest
      || approval.scopeDigest !== patternApprovalScopeDigest(approval, patternCeiling)
      || !patternInstanceIsWithin(declaration, patternCeiling, approval, tables)) {
      refuse(code, `pattern instance ${declaration.id} is not a structural subset of its approved ceiling`);
    }
    const derivationDigest = governanceDigest('snapback:visibility-pattern-derivation:v1', {
      instanceId: declaration.id,
      instanceScopeDigest: scopeDigest,
      patternApprovalScopeDigest: approval.scopeDigest,
      patternId: patternDerivation.patternId,
      constructorVersion: patternDerivation.constructorVersion,
      constructorDigest: patternDerivation.constructorDigest,
    });
    if (patternDerivation.derivationDigest !== derivationDigest) {
      refuse(code, `pattern instance ${declaration.id} carries fabricated derivation provenance; an author ruling is required`);
    }
    if ((declaration.lifecycleClass === 'production'
      && (!UTC_DATE.test(approval.expiresOn ?? '')
        || declaration.expiresOn > approval.expiresOn))
      || (declaration.lifecycleClass === 'fixture' && approval.expiresOn !== undefined)) {
      refuse(code, `pattern approval lifetime does not contain instance ${declaration.id}`);
    }
    approvalAuthority = patternCeiling.authority;
    approvalFixtureProfile = patternCeiling.fixtureProfile;
  }
  for (const [field, label] of [
    ['requestedBy', 'approval requestedBy'],
    ['approvedBy', 'approval approvedBy'],
  ]) nonEmpty(approval[field], label, code);
  verifyDigest(approval.scopeDigest, approval.scopeDigest, 'approval scopeDigest', code);
  verifyDigest(approval.justificationDigest, approval.justificationDigest,
    'approval justificationDigest', code);
  const principalFields = {
    authorityAdmissionPolicy: approvalAuthority.mode === 'principal'
      ? approvalAuthority.admissionPolicy : undefined,
    authorityAdmissionPolicyDigest: approvalAuthority.mode === 'principal'
      ? governanceDigest(
          'snapback:visibility-principal-admission-policy:v1',
          approvalAuthority.admissionPolicy,
        ) : undefined,
    authorityAdmissionMembershipAudienceClosure: approvalAuthority.mode === 'principal'
      ? approvalAuthority.admissionMembershipAudienceClosure : undefined,
    authorityAdmissionMembershipAudienceClosureDigest: approvalAuthority.mode === 'principal'
      ? approvalAuthority.admissionMembershipAudienceClosureDigest : undefined,
  };
  const fixtureFields = {
    fixtureProfileId: approvalFixtureProfile?.id,
    fixtureProfileDigest: approvalFixtureProfile?.digest,
    fixtureTargetClassCeiling: approvalFixtureProfile?.targetClassCeiling,
    fixturePrincipalClass: approvalFixtureProfile?.principalClass,
    fixtureDataClassification: approvalFixtureProfile?.dataClassification,
  };
  for (const [field, expected] of Object.entries({ ...principalFields, ...fixtureFields })) {
    if (canonicalGovernanceJson(approval[field]) !== canonicalGovernanceJson(expected)) {
      refuse(code, `approval record ${field} does not deep-match override ${declaration.id}`, { field });
    }
  }
  const owner = ownerForDeclaration(ownerMap, declaration);
  if (approval.approvedBy !== owner.approvalOwner || declaration.owner !== owner.implementationOwner) {
    refuse(code, `override ${declaration.id} is not approved by its mapped owner`, {
      requiredApprovalOwner: owner.approvalOwner,
      requiredImplementationOwner: owner.implementationOwner,
    });
  }
  const closure = validateRetainedApprovalClosure(approval, ownerMap, backendRoot, code);
  if (owner.authorRuling === null) {
    if (approval.delegationRuling !== null || approval.delegationRecord !== null) {
      refuse(code, 'default author approval must not invent delegation closure');
    }
  } else if (approval.delegationRuling !== owner.authorRuling
    || canonicalGovernanceJson(approval.delegationRecord) !== canonicalGovernanceJson(owner.delegationRecord)) {
    refuse(code, 'approval delegation closure does not deep-match the owner map');
  }
  return {
    owner,
    ...closure,
    normalizedPatternCeiling,
  };
}

function canonicalReceiptPayload(receipt) {
  const { signature: _signature, ...payload } = receipt;
  return payload;
}

function validateObserverRegistry(registry, selectedEpoch = registry.activeEpoch) {
  const code = 'SNAPBACK_TABLE_VISIBILITY_OVERRIDE_REMOTE_SEPARATION_REQUIRED';
  exactKeys(registry, ['schemaVersion', 'activeEpoch', 'keys'], 'observer key registry', code,
    ['schemaVersion', 'activeEpoch', 'keys']);
  if (registry.schemaVersion !== GOVERNANCE_SCHEMA_VERSIONS.observerKeys) refuse(code, 'observer key registry schemaVersion is unsupported');
  const keys = exactArray(registry.keys, 'observer key registry.keys', code, { min: 1 });
  for (const [index, key] of keys.entries()) {
    exactKeys(key, ['epoch', 'publicKeyPem', 'keyDigest', 'revoked'],
      `observer key registry.keys.${index}`, code,
      ['epoch', 'publicKeyPem', 'keyDigest', 'revoked']);
  }
  if (new Set(keys.map(({ epoch }) => epoch)).size !== keys.length) {
    refuse(code, 'observer key registry repeats an epoch');
  }
  if (!keys.some(({ epoch }) => epoch === registry.activeEpoch)) {
    refuse(code, 'observer key registry activeEpoch is missing');
  }
  const selected = keys.find(({ epoch }) => epoch === selectedEpoch);
  if (!selected) refuse(code, `observer key epoch ${selectedEpoch} is not retained`);
  if (selected.revoked === true) refuse(code, `observer key epoch ${selectedEpoch} is revoked`);
  const keyDigest = governanceDigest('snapback:visibility-observer-key:v1', selected.publicKeyPem);
  if (selected.keyDigest !== keyDigest) refuse(code, 'observer key digest is invalid');
  return { selected, keyDigest };
}

function verifyObserverSignature(value, registry, code) {
  const { selected, keyDigest } = validateObserverRegistry(registry, value.observerKeyEpoch);
  if (value.observerKeyDigest !== keyDigest) refuse(code, 'observer key digest does not match the signed artifact');
  let signature;
  try {
    signature = Buffer.from(value.signature, 'base64');
  } catch {
    refuse(code, 'observer signature is malformed');
  }
  let verified = false;
  try {
    verified = verifySignature(
      null,
      Buffer.from(canonicalGovernanceJson(canonicalReceiptPayload(value)), 'utf8'),
      createPublicKey(selected.publicKeyPem),
      signature,
    );
  } catch {
    verified = false;
  }
  if (!verified) refuse(code, 'observer signature is untrusted');
  return { selected, keyDigest };
}

function validateSeparationReceipt(receipt, {
  approval,
  approvalClosureDigest,
  ownerMapDigest,
  backendRoot,
  targetObserverPin = null,
  policy = false,
}) {
  const code = policy
    ? 'SNAPBACK_TABLE_VISIBILITY_POLICY_REMOTE_SEPARATION_REQUIRED'
    : 'SNAPBACK_TABLE_VISIBILITY_OVERRIDE_REMOTE_SEPARATION_REQUIRED';
  object(receipt, 'separation receipt', code);
  exactKeys(receipt, [
    'schemaVersion', 'providerProfile', 'eventId', 'governedRef', 'eventInputDigest',
    'beforeOid', 'afterOid', 'observedAt', 'approvalKind', 'approvalId', 'scopeDigest',
    'approvalClosureDigest', 'predecessorOwnerMapDigest', 'comparatorVersion',
    'approvalOnly', 'observerKeyEpoch', 'observerKeyDigest', 'signature',
  ], 'separation receipt', code, [
    'schemaVersion', 'providerProfile', 'eventId', 'governedRef', 'eventInputDigest',
    'beforeOid', 'afterOid', 'observedAt', 'approvalKind', 'approvalId', 'scopeDigest',
    'approvalClosureDigest', 'predecessorOwnerMapDigest', 'comparatorVersion',
    'approvalOnly', 'observerKeyEpoch', 'observerKeyDigest', 'signature',
  ]);
  if (receipt.schemaVersion !== GOVERNANCE_SCHEMA_VERSIONS.separationReceipt
    || receipt.approvalOnly !== true
    || receipt.approvalKind !== approval.approvalKind
    || receipt.approvalId !== approval.id
    || receipt.scopeDigest !== approval.scopeDigest
    || receipt.approvalClosureDigest !== approvalClosureDigest
    || receipt.predecessorOwnerMapDigest !== ownerMapDigest
    || !OID.test(receipt.beforeOid ?? '')
    || !OID.test(receipt.afterOid ?? '')
    || receipt.beforeOid === receipt.afterOid
    || !['github-push-v1', 'atomic-push-envelope-v1'].includes(receipt.providerProfile)
    || !nonEmpty(receipt.eventId, 'separation receipt.eventId', code)
    || !SHA256.test(receipt.eventInputDigest ?? '')
    || !nonEmpty(receipt.governedRef, 'separation receipt.governedRef', code).startsWith('refs/')
    || receipt.comparatorVersion !== GOVERNANCE_COMPARATOR_VERSION
    || !UTC_INSTANT.test(receipt.observedAt ?? '')) {
    refuse(code, `separation receipt does not bind approval ${approval.id}`);
  }
  const registry = parseJsonFile(join(backendRoot, GOVERNANCE_FILES.observerKeys), code, 'observer key registry');
  const { selected, keyDigest } = verifyObserverSignature(receipt, registry, code);
  const { selected: active, keyDigest: activeKeyDigest } = validateObserverRegistry(registry);
  if (targetObserverPin && (targetObserverPin.epoch !== active.epoch || targetObserverPin.keyDigest !== activeKeyDigest)) {
    refuse(code, 'tree observer key does not deep-match the target-owned pin');
  }
  return {
    receiptDigest: governanceDigest('snapback:visibility-separation-receipt:v1', receipt),
    observedAt: receipt.observedAt,
    observerKeyEpoch: selected.epoch,
    observerKeyDigest: keyDigest,
  };
}

function expiryInstant(expiresOn) {
  return Date.parse(`${expiresOn}T00:00:00.000Z`) + 24 * 60 * 60 * 1000;
}

export function validateProductionOverrideTime(declaration, observedAt, now) {
  const issued = Date.parse(declaration.issuedOn);
  const admitted = Date.parse(observedAt);
  const expires = expiryInstant(declaration.expiresOn);
  if (!Number.isFinite(issued) || !Number.isFinite(admitted) || !Number.isFinite(expires)
    || issued > admitted + MAX_ISSUED_SKEW_MS
    || expires > issued + MAX_GRANT_MS
    || expires > admitted + MAX_GRANT_MS) {
    refuse(
      'SNAPBACK_TABLE_VISIBILITY_OVERRIDE_APPROVAL_TIME_INVALID',
      `table visibility override ${declaration.id} has an invalid approval interval`,
      { issuedOn: declaration.issuedOn, expiresOn: declaration.expiresOn, admittedAt: observedAt },
    );
  }
  if (now < issued) {
    refuse(
      'SNAPBACK_TABLE_VISIBILITY_OVERRIDE_NOT_YET_VALID',
      `table visibility override ${declaration.id} is not valid before ${declaration.issuedOn}`,
      { overrideId: declaration.id, issuedOn: declaration.issuedOn },
    );
  }
  if (now >= expires) {
    refuse(
      'SNAPBACK_TABLE_VISIBILITY_OVERRIDE_EXPIRED',
      `table visibility override ${declaration.id} expired on ${declaration.expiresOn}; remove it or push a separately approved renewal before using its authority`,
      { overrideId: declaration.id, expiresOn: declaration.expiresOn },
    );
  }
  return expires - now <= WARNING_WINDOW_MS;
}

export function visibilityOverrideBaselineEntry({
  declaration,
  scopeDigest,
  approvalPath,
  separationReceiptPath,
  approvalClosureDigest,
  receiptDigest,
  approvalKind = 'custom',
  patternDerivation = null,
  normalizedPatternCeiling = null,
}) {
  const rowScopeDigests = declaration.reads.map(({ rowScopeDigest }) => rowScopeDigest).sort(compareText);
  const audienceDeclarationClosureDigests = declaration.reads
    .map(({ audienceDeclarationClosureDigest }) => audienceDeclarationClosureDigest)
    .filter((digest, index, all) => all.indexOf(digest) === index)
    .sort(compareText);
  const principalAdmissionPolicy = declaration.authority.mode === 'principal'
    ? declaration.authority.admissionPolicy
    : null;
  return {
    id: declaration.id,
    scopeDigestVersion: GOVERNANCE_SCOPE_DIGEST_VERSION,
    scopeDigest,
    normalizedDeclaration: structuredClone(declaration),
    approvalKind,
    normalizedPatternCeiling: structuredClone(normalizedPatternCeiling),
    patternId: patternDerivation?.patternId ?? null,
    constructorVersion: patternDerivation?.constructorVersion ?? null,
    constructorDigest: patternDerivation?.constructorDigest ?? null,
    derivationDigest: patternDerivation?.derivationDigest ?? null,
    lifecycleClass: declaration.lifecycleClass,
    authorityMode: declaration.authority.mode,
    authorityAdmissionPolicy: principalAdmissionPolicy,
    authorityAdmissionPolicyDigest: principalAdmissionPolicy
      ? governanceDigest('snapback:visibility-principal-admission-policy:v1', principalAdmissionPolicy)
      : null,
    authorityAdmissionMembershipAudienceClosure:
      declaration.authority.admissionMembershipAudienceClosure ?? [],
    authorityAdmissionMembershipAudienceClosureDigest:
      declaration.authority.admissionMembershipAudienceClosureDigest
      ?? governanceDigest('snapback:visibility-audience-closure:v1', []),
    operations: declaration.operations,
    tables: declaration.reads.map(({ table }) => table).sort(compareText),
    rowScopeDigests,
    audienceDeclarationClosureDigests,
    owner: declaration.owner,
    approvalRecord: approvalPath,
    approvalClosureDigest,
    serverSeparationReceipt: separationReceiptPath,
    serverSeparationReceiptDigest: receiptDigest,
    fixtureProfileId: declaration.fixtureProfile?.id ?? null,
    fixtureProfileDigest: declaration.fixtureProfile?.digest ?? null,
    fixtureTargetClassCeiling: declaration.fixtureProfile?.targetClassCeiling ?? null,
    fixturePrincipalClass: declaration.fixtureProfile?.principalClass ?? null,
    fixtureDataClassification: declaration.fixtureProfile?.dataClassification ?? null,
    expiresOn: declaration.expiresOn ?? null,
    acceptanceId: declaration.acceptance.id,
  };
}

export function exactSetBaseline(entries, schemaVersion) {
  const sorted = [...entries].sort((a, b) => compareText(a.id ?? a.tableId, b.id ?? b.tableId));
  return {
    schemaVersion,
    entries: sorted,
    exactSetDigest: governanceDigest(`${schemaVersion}:exact-set`, sorted),
  };
}

function readOptional(path) {
  return existsSync(path) ? JSON.parse(readFileSync(path, 'utf8')) : null;
}

function requireExactBaseline(committed, expected, code, label) {
  if (committed === null || canonicalGovernanceJson(committed) !== canonicalGovernanceJson(expected)) {
    refuse(code, `${label} is stale or does not exactly match current declarations`, {
      expectedDigest: expected.exactSetDigest,
      actualDigest: committed?.exactSetDigest ?? null,
    });
  }
}

export function transitionNodeDigest(node) {
  const { recomputedClassification: _classification, ...canonical } = node;
  return governanceDigest('snapback:table-visibility-transition-node:v1', canonical);
}

export function transitionLedgerDigest(nodes, heads) {
  return governanceDigest('snapback:table-visibility-transition-ledger:v1', {
    nodes: nodes.map(({ recomputedClassification: _classification, ...node }) => node),
    heads,
  });
}

const APPROVAL_RECORD_KEYS = Object.freeze([
  'schemaVersion', 'scopeDigestVersion', 'digestAlgorithm', 'approvalKind', 'id',
  'scopeDigest', 'patternId', 'constructorVersion', 'constructorDigest',
  'patternCeiling',
  'lifecycleClass', 'authorityAdmissionPolicy', 'authorityAdmissionPolicyDigest',
  'authorityAdmissionMembershipAudienceClosure',
  'authorityAdmissionMembershipAudienceClosureDigest',
  'fixtureProfileId', 'fixtureProfileDigest', 'fixtureTargetClassCeiling',
  'fixturePrincipalClass', 'fixtureDataClassification',
  'requestedBy', 'approvedBy', 'ownerMapDigest',
  'issuedOn', 'expiresOn', 'justificationDigest', 'acceptanceId', 'acceptancePath',
  'reviewArtifact', 'reviewRecord', 'approvalRuling', 'rulingRecord',
  'delegationRuling', 'delegationRecord',
]);

const APPROVAL_RECORD_REQUIRED_KEYS = Object.freeze([
  'schemaVersion', 'scopeDigestVersion', 'digestAlgorithm', 'approvalKind', 'id',
  'scopeDigest', 'lifecycleClass', 'requestedBy', 'approvedBy', 'ownerMapDigest',
  'issuedOn', 'justificationDigest', 'acceptanceId', 'acceptancePath',
  'reviewArtifact', 'reviewRecord', 'approvalRuling', 'rulingRecord',
  'delegationRuling', 'delegationRecord',
]);

export function transitionApprovalScopeDigest(node, approval) {
  const { scopeDigest: _scopeDigest, ...approvalContent } = approval;
  return governanceDigest('snapback:table-visibility-policy-transition-scope:v1', {
    transition: {
      id: node.id,
      tableId: node.tableId,
      predecessorHeadId: node.predecessorHeadId,
      predecessorHeadDigest: node.predecessorHeadDigest,
      predecessorNormalizedPolicyBody: node.predecessorNormalizedPolicyBody,
      predecessorPolicyDigest: node.predecessorPolicyDigest,
      successorNormalizedPolicyBody: node.successorNormalizedPolicyBody,
      successorPolicyDigest: node.successorPolicyDigest,
      admissionKind: node.admissionKind,
    },
    approval: approvalContent,
  });
}

function validateTransitionApproval(approval, node, ownerMap, backendRoot, code) {
  exactKeys(approval, APPROVAL_RECORD_KEYS, 'transition approval', code,
    APPROVAL_RECORD_REQUIRED_KEYS);
  const forbidden = [
    'patternId', 'constructorVersion', 'constructorDigest',
    'patternCeiling',
    'authorityAdmissionPolicy', 'authorityAdmissionPolicyDigest',
    'authorityAdmissionMembershipAudienceClosure',
    'authorityAdmissionMembershipAudienceClosureDigest',
    'fixtureProfileId', 'fixtureProfileDigest', 'fixtureTargetClassCeiling',
    'fixturePrincipalClass', 'fixtureDataClassification', 'expiresOn',
  ];
  if (approval.schemaVersion !== GOVERNANCE_SCHEMA_VERSIONS.approvalRecord
    || approval.scopeDigestVersion !== GOVERNANCE_SCOPE_DIGEST_VERSION
    || approval.digestAlgorithm !== GOVERNANCE_DIGEST_ALGORITHM
    || approval.approvalKind !== 'table-policy-transition'
    || approval.lifecycleClass !== 'durable-policy'
    || approval.id !== node.id
    || !UTC_INSTANT.test(approval.issuedOn ?? '')
    || forbidden.some((field) => approval[field] !== undefined)) {
    refuse(code, `transition approval does not exactly bind ${node.id}`);
  }
  for (const [field, label] of [
    ['requestedBy', 'transition approval.requestedBy'],
    ['approvedBy', 'transition approval.approvedBy'],
    ['acceptanceId', 'transition approval.acceptanceId'],
    ['acceptancePath', 'transition approval.acceptancePath'],
  ]) nonEmpty(approval[field], label, code);
  verifyDigest(approval.justificationDigest, approval.justificationDigest,
    'transition approval.justificationDigest', code);
  const owner = ownerMap.entries.find((entry) => entry.path === approval.acceptancePath)
    ?? { approvalOwner: ownerMap.fallbackApprovalOwner };
  if (approval.approvedBy !== owner.approvalOwner) {
    refuse(code, `transition approval ${node.id} is not signed by its mapped approval owner`);
  }
  const closure = validateRetainedApprovalClosure(approval, ownerMap, backendRoot, code);
  const scopeDigest = transitionApprovalScopeDigest(node, approval);
  if (approval.scopeDigest !== scopeDigest) {
    refuse(code, `transition approval ${node.id} does not bind its complete predecessor and successor closure`);
  }
  return closure;
}

function validateTransitionLedger(ledger, tables, backendRoot, quarantine = null) {
  const code = 'SNAPBACK_TABLE_VISIBILITY_POLICY_PROVENANCE_INVALID';
  if (ledger === null) return { nodes: [], heads: {}, artifact: null };
  exactKeys(ledger, ['schemaVersion', 'nodes', 'heads', 'ledgerDigest'], 'transition ledger', code,
    ['schemaVersion', 'nodes', 'heads', 'ledgerDigest']);
  if (ledger.schemaVersion !== GOVERNANCE_SCHEMA_VERSIONS.transitionLedger) refuse(code, 'transition ledger schemaVersion is unsupported');
  const nodes = new Map();
  for (const node of exactArray(ledger.nodes, 'transition ledger.nodes', code)) {
    exactKeys(node, [
      'schemaVersion', 'id', 'tableId', 'predecessorHeadId', 'predecessorHeadDigest',
      'predecessorNormalizedPolicyBody', 'predecessorPolicyDigest',
      'successorNormalizedPolicyBody', 'successorPolicyDigest', 'admissionKind',
      'approvalPath', 'approvalClosureDigest', 'serverSeparationReceipt',
      'serverSeparationReceiptDigest', 'quarantineVerdict',
    ], 'transition ledger node', code, [
      'schemaVersion', 'id', 'tableId', 'predecessorHeadId', 'predecessorHeadDigest',
      'predecessorNormalizedPolicyBody', 'predecessorPolicyDigest',
      'successorNormalizedPolicyBody', 'successorPolicyDigest', 'admissionKind',
      'approvalPath', 'approvalClosureDigest', 'serverSeparationReceipt',
      'serverSeparationReceiptDigest', 'quarantineVerdict',
    ]);
    if (node.schemaVersion !== GOVERNANCE_SCHEMA_VERSIONS.transitionRecord) {
      refuse(code, `transition ${node.id ?? '<unknown>'} schemaVersion is unsupported`);
    }
    identifier(node.id, 'transition ledger node.id', code);
    identifier(node.tableId, `transition ${node.id}.tableId`, code);
    if (!Object.hasOwn(tables, node.tableId)) refuse(code, `transition ${node.id} names unknown table ${node.tableId}`);
    if (nodes.has(node.id)) refuse(code, `transition ledger reuses node id ${node.id}`);
    const predecessorBody = node.predecessorNormalizedPolicyBody === null
      ? null
      : normalizePolicyBody(node.predecessorNormalizedPolicyBody.policy, tables);
    const successorBody = normalizePolicyBody(node.successorNormalizedPolicyBody.policy, tables);
    if (canonicalGovernanceJson(predecessorBody) !== canonicalGovernanceJson(node.predecessorNormalizedPolicyBody)
      || canonicalGovernanceJson(successorBody) !== canonicalGovernanceJson(node.successorNormalizedPolicyBody)) {
      refuse(code, `transition ${node.id} carries a non-canonical policy body`);
    }
    if (predecessorBody !== null) {
      verifyDigest(
        governanceDigest('snapback:table-visibility-policy-body:v1', predecessorBody),
        node.predecessorPolicyDigest,
        `transition ${node.id} predecessor`,
        code,
      );
    } else if (node.predecessorPolicyDigest !== null) {
      refuse(code, `transition root ${node.id} carries a predecessor policy digest`);
    }
    verifyDigest(
      governanceDigest('snapback:table-visibility-policy-body:v1', successorBody),
      node.successorPolicyDigest,
      `transition ${node.id} successor`,
      code,
    );
    const classification = compareVisibilityPolicies(predecessorBody, successorBody);
    const expectedKind = classification === 'new-restricted'
      ? 'new-restricted'
      : classification === 'narrowing' || classification === 'equal'
        ? 'narrowing'
        : 'approved-transition';
    if (node.admissionKind === 'quarantined-reversal') {
      if (!node.quarantineVerdict || node.approvalPath !== null || node.approvalClosureDigest !== null
        || node.serverSeparationReceipt !== null || node.serverSeparationReceiptDigest !== null
        || classification === 'growth') refuse(code, `quarantined reversal ${node.id} can confer no authority`);
      const quarantineRecord = quarantine?.records.find(({ path }) => path === node.quarantineVerdict);
      if (!quarantineRecord || quarantineRecord.governedRecordId !== node.predecessorHeadId) {
        refuse(code, `quarantined reversal ${node.id} does not name the signed quarantine for its bad head`);
      }
    } else if (node.admissionKind !== expectedKind && node.admissionKind !== 'g1-migration') {
      refuse(code, `transition ${node.id} authored ${node.admissionKind} but recomputes ${expectedKind}`);
    }
    if (node.admissionKind === 'approved-transition') {
      if (!node.approvalPath || !node.approvalClosureDigest || !node.serverSeparationReceipt
        || !node.serverSeparationReceiptDigest) refuse(code, `approved transition ${node.id} lacks its retained closure`);
      const ownerMap = canonicalOwnerMap(parseJsonFile(
        join(backendRoot, GOVERNANCE_FILES.ownerMap),
        code,
        'visibility override owner map',
      ));
      const approval = parseJsonFile(
        resolveGovernancePath(backendRoot, node.approvalPath, code, 'transition approval'),
        code,
        'transition approval',
      );
      const closure = validateTransitionApproval(approval, node, ownerMap, backendRoot, code);
      if (closure.approvalClosureDigest !== node.approvalClosureDigest) {
        refuse(code, `transition ${node.id} approval closure digest is stale`);
      }
      const receipt = parseJsonFile(
        resolveGovernancePath(backendRoot, node.serverSeparationReceipt, code, 'transition receipt'),
        code,
        'transition receipt',
      );
      const separation = validateSeparationReceipt(receipt, {
        approval,
        approvalClosureDigest: closure.approvalClosureDigest,
        ownerMapDigest: closure.ownerMapDigest,
        backendRoot,
        policy: true,
      });
      if (separation.receiptDigest !== node.serverSeparationReceiptDigest) {
        refuse(code, `transition ${node.id} receipt digest is stale`);
      }
    } else {
      const authorityArtifacts = [
        node.approvalPath,
        node.approvalClosureDigest,
        node.serverSeparationReceipt,
        node.serverSeparationReceiptDigest,
        node.quarantineVerdict,
      ];
      if (authorityArtifacts.some((value) => value !== null)) {
        refuse(code, `non-widening transition ${node.id} must not carry authority artifacts`);
      }
      if (node.admissionKind === 'g1-migration' && node.predecessorHeadId !== null) {
        refuse(code, `G1 migration transition ${node.id} must be a root`);
      }
    }
    nodes.set(node.id, { ...node, recomputedClassification: classification });
  }
  for (const [id, node] of nodes) {
    if (node.predecessorHeadId === null) {
      if (node.predecessorHeadDigest !== null || node.predecessorNormalizedPolicyBody !== null) {
        refuse(code, `transition root ${id} carries predecessor material`);
      }
      continue;
    }
    const predecessor = nodes.get(node.predecessorHeadId);
    if (!predecessor) refuse(code, `transition ${id} has missing predecessor ${node.predecessorHeadId}`);
    const predecessorDigest = transitionNodeDigest(predecessor);
    if (node.predecessorHeadDigest !== predecessorDigest
      || canonicalGovernanceJson(node.predecessorNormalizedPolicyBody)
        !== canonicalGovernanceJson(predecessor.successorNormalizedPolicyBody)) {
      refuse(code, `transition ${id} is rebound from its predecessor`);
    }
  }
  for (const [tableId, headId] of Object.entries(ledger.heads)) {
    const head = nodes.get(headId);
    if (!head || head.tableId !== tableId) refuse(code, `table ${tableId} names stale ledger head ${headId}`);
  }
  const reachable = new Set();
  for (const [tableId, headId] of Object.entries(ledger.heads)) {
    const chain = new Set();
    let cursor = headId;
    while (cursor !== null) {
      if (chain.has(cursor)) refuse(code, `table ${tableId} transition ledger contains a cycle`);
      const node = nodes.get(cursor);
      if (!node || node.tableId !== tableId) {
        refuse(code, `table ${tableId} transition chain crosses a missing or foreign node ${cursor}`);
      }
      chain.add(cursor);
      reachable.add(cursor);
      cursor = node.predecessorHeadId;
    }
  }
  if (reachable.size !== nodes.size) {
    refuse(code, 'transition ledger contains an orphaned or forked retained node');
  }
  verifyDigest(
    transitionLedgerDigest([...nodes.values()], ledger.heads),
    ledger.ledgerDigest,
    'transition ledger',
    code,
  );
  return { nodes: [...nodes.values()], heads: structuredClone(ledger.heads), artifact: structuredClone(ledger) };
}

function validateQuarantineLedger(ledger, backendRoot) {
  const code = 'SNAPBACK_TABLE_VISIBILITY_POLICY_PROVENANCE_INVALID';
  if (ledger === null) return { records: [], retiredIds: [], headDigest: governanceDigest('snapback:visibility-quarantine-head:v1', []), artifact: null };
  exactKeys(ledger, ['schemaVersion', 'records', 'retiredIds', 'headDigest'], 'quarantine ledger', code,
    ['schemaVersion', 'records', 'retiredIds', 'headDigest']);
  if (ledger.schemaVersion !== GOVERNANCE_SCHEMA_VERSIONS.quarantineLedger) refuse(code, 'quarantine ledger schemaVersion is unsupported');
  const retired = sortedUniqueStrings(ledger.retiredIds, 'quarantine ledger.retiredIds', code);
  const registry = ledger.records.length === 0
    ? null
    : parseJsonFile(join(backendRoot, GOVERNANCE_FILES.observerKeys), code,
        'observer key registry');
  const records = [];
  const quarantineIds = new Set();
  const governedRecordIds = new Set();
  let predecessorHead = governanceDigest('snapback:visibility-quarantine-head:v1', []);
  for (const [index, entry] of exactArray(ledger.records, 'quarantine ledger.records', code).entries()) {
    exactKeys(entry, ['quarantineId', 'governedRecordId', 'path', 'digest'],
      `quarantine ledger.records.${index}`, code,
      ['quarantineId', 'governedRecordId', 'path', 'digest']);
    if (quarantineIds.has(entry.quarantineId) || governedRecordIds.has(entry.governedRecordId)) {
      refuse(code, `quarantine ledger record ${index} reuses a quarantined id`);
    }
    quarantineIds.add(entry.quarantineId);
    governedRecordIds.add(entry.governedRecordId);
    const verdict = parseJsonFile(resolveGovernancePath(backendRoot, entry.path, code, 'quarantine verdict'), code, 'quarantine verdict');
    exactKeys(verdict, [
      'schemaVersion', 'quarantineId', 'governedRecordId', 'authorityKind',
      'governedRef', 'beforeOid', 'afterOid', 'eventId', 'externalVerdictDigest',
      'offendingLedgerHead', 'violationSignature', 'predecessorQuarantineHead',
      'successorExactSetDigest', 'observedAt', 'observerKeyEpoch',
      'observerKeyDigest', 'signature',
    ], `quarantine verdict ${entry.path}`, code, [
      'schemaVersion', 'quarantineId', 'governedRecordId', 'authorityKind',
      'governedRef', 'beforeOid', 'afterOid', 'eventId', 'externalVerdictDigest',
      'offendingLedgerHead', 'violationSignature', 'predecessorQuarantineHead',
      'successorExactSetDigest', 'observedAt', 'observerKeyEpoch',
      'observerKeyDigest', 'signature',
    ]);
    if (verdict.schemaVersion !== GOVERNANCE_SCHEMA_VERSIONS.quarantineVerdict) {
      refuse(code, `quarantine verdict ${entry.path} has an unsupported schema`);
    }
    identifier(verdict.quarantineId, 'quarantine verdict.quarantineId', code);
    identifier(verdict.governedRecordId, 'quarantine verdict.governedRecordId', code);
    if (!['visibility-override', 'delegation', 'table-policy-transition', 'governance-record']
      .includes(verdict.authorityKind)
      || !nonEmpty(verdict.governedRef, 'quarantine verdict.governedRef', code).startsWith('refs/')
      || !OID.test(verdict.beforeOid ?? '') || !OID.test(verdict.afterOid ?? '')
      || verdict.beforeOid === verdict.afterOid
      || !nonEmpty(verdict.eventId, 'quarantine verdict.eventId', code)
      || !SHA256.test(verdict.externalVerdictDigest ?? '')
      || (verdict.offendingLedgerHead !== null
        && !SHA256.test(verdict.offendingLedgerHead ?? ''))
      || !SHA256.test(verdict.violationSignature ?? '')
      || !SHA256.test(verdict.predecessorQuarantineHead ?? '')
      || !SHA256.test(verdict.successorExactSetDigest ?? '')
      || !UTC_INSTANT.test(verdict.observedAt ?? '')) {
      refuse(code, `quarantine verdict ${entry.path} is malformed or not content-bound`);
    }
    verifyObserverSignature(verdict, registry, code);
    const digest = governanceDigest('snapback:visibility-quarantine-verdict:v1', verdict);
    const successorExactSetDigest = governanceDigest(
      'snapback:visibility-quarantine-successor-exact-set:v1',
      {
        predecessorHead,
        quarantineId: entry.quarantineId,
        governedRecordId: entry.governedRecordId,
      },
    );
    if (entry.digest !== digest || verdict.predecessorQuarantineHead !== predecessorHead
      || verdict.quarantineId !== entry.quarantineId || verdict.governedRecordId !== entry.governedRecordId
      || verdict.successorExactSetDigest !== successorExactSetDigest) {
      refuse(code, `quarantine ledger record ${index} is deleted, rebound, or rolled back`);
    }
    predecessorHead = governanceDigest('snapback:visibility-quarantine-head:v1', {
      predecessorHead,
      quarantineId: entry.quarantineId,
      governedRecordId: entry.governedRecordId,
      digest,
    });
    records.push({ ...entry, verdict });
  }
  if (ledger.headDigest !== predecessorHead) refuse(code, 'quarantine ledger head is stale or rebound');
  const requiredRetired = records.flatMap(({ quarantineId, governedRecordId }) => [quarantineId, governedRecordId]).sort(compareText);
  if (canonicalGovernanceJson(retired) !== canonicalGovernanceJson([...new Set(requiredRetired)].sort(compareText))) {
    refuse(code, 'quarantine exact set omits or rebinds a retired id');
  }
  return { records, retiredIds: retired, headDigest: predecessorHead, artifact: structuredClone(ledger) };
}

export function currentTablePolicyBaseline(tables, transitionLedger) {
  const entries = Object.entries(tables).map(([tableId, definition]) => {
    const normalizedPolicyBody = normalizePolicyBody(definition.visibility ?? { kind: 'public-read' }, tables);
    return {
      tableId,
      normalizedPolicyBody,
      policyDigest: governanceDigest('snapback:table-visibility-policy-body:v1', normalizedPolicyBody),
      provenanceHeadId: transitionLedger.heads[tableId] ?? null,
    };
  }).sort((a, b) => compareText(a.tableId, b.tableId));
  return exactSetBaseline(entries, GOVERNANCE_SCHEMA_VERSIONS.policyBaseline);
}

function projectionOverride(entry, declaration, approval, receipt, owner, patternDerivation) {
  return {
    ...entry,
    normalizedReads: declaration.reads,
    breadth: declaration.reads.some(({ scope }) => scope.allRows === true) ? 'all' : 'bounded',
    authority: declaration.authority,
    issuedOn: declaration.issuedOn ?? null,
    approvalKind: approval.approvalKind,
    patternDerivation: patternDerivation ?? null,
    patternCeiling: approval.patternCeiling ?? null,
    approvalOwner: owner.approvalOwner,
    approvalArtifacts: {
      reviewArtifact: approval.reviewArtifact,
      reviewRecord: approval.reviewRecord,
      approvalRuling: approval.approvalRuling,
      rulingRecord: approval.rulingRecord,
      delegationRuling: approval.delegationRuling,
      delegationRecord: approval.delegationRecord,
    },
    separationReceipt: {
      eventId: receipt.eventId,
      governedRef: receipt.governedRef,
      beforeOid: receipt.beforeOid,
      afterOid: receipt.afterOid,
      observedAt: receipt.observedAt,
      observerKeyEpoch: receipt.observerKeyEpoch,
      observerKeyDigest: receipt.observerKeyDigest,
    },
    acceptance: declaration.acceptance,
  };
}

export function validateVisibilityGovernance({
  backendRoot,
  schemaDef,
  tables,
  now = Date.now(),
  targetObserverPin = null,
}) {
  const declarations = schemaDef.visibilityOverrides ?? [];
  if (!Array.isArray(declarations)) {
    refuse('SNAPBACK_TABLE_VISIBILITY_OVERRIDE_APPROVAL_INVALID',
      'schema visibilityOverrides must be an exact ordered declaration set');
  }
  const declarationIds = declarations.map((declaration) => declaration?.id);
  if (new Set(declarationIds).size !== declarationIds.length) {
    refuse('SNAPBACK_TABLE_VISIBILITY_OVERRIDE_APPROVAL_INVALID',
      'schema visibilityOverrides contains a duplicate authority id');
  }
  const governancePresent = declarations.length > 0
    || Object.entries(GOVERNANCE_FILES)
      .filter(([key]) => key !== 'elevatedReadBaseline')
      .some(([, path]) => existsSync(join(backendRoot, path)));
  if (!governancePresent) return null;
  const ownerMapPath = join(backendRoot, GOVERNANCE_FILES.ownerMap);
  const ownerMap = canonicalOwnerMap(parseJsonFile(
    ownerMapPath,
    'SNAPBACK_TABLE_VISIBILITY_OVERRIDE_APPROVAL_INVALID',
    'visibility override owner map',
  ));
  validateOwnerMapArtifacts(
    ownerMap,
    backendRoot,
    'SNAPBACK_TABLE_VISIBILITY_OVERRIDE_APPROVAL_INVALID',
  );
  const ownerEntries = ownerMap.entries.map((entry) => ({
    ...entry,
    delegationClosureDigest: governanceDigest(
      'snapback:visibility-owner-delegation-closure:v1',
      { authorRuling: entry.authorRuling, delegationRecord: entry.delegationRecord },
    ),
  }));
  const committedOwnerBaseline = readOptional(join(backendRoot, GOVERNANCE_FILES.ownerBaseline));
  const retiredDelegations = (committedOwnerBaseline?.retiredDelegations ?? [])
    .map((entry, index) => canonicalOwnerBaselineEntry(
      entry,
      `visibility override owner baseline.retiredDelegations.${index}`,
    ));
  validateOwnerMapArtifacts({ entries: retiredDelegations }, backendRoot,
    'SNAPBACK_TABLE_VISIBILITY_OVERRIDE_APPROVAL_INVALID');
  const retainedDelegationDigests = [
    ...ownerEntries,
    ...retiredDelegations,
  ].map(({ delegationClosureDigest }) => delegationClosureDigest);
  if (new Set(retainedDelegationDigests).size !== retainedDelegationDigests.length) {
    refuse('SNAPBACK_TABLE_VISIBILITY_OVERRIDE_APPROVAL_INVALID',
      'active and retired delegation provenance must be exact and non-overlapping');
  }
  const ownerBaseline = {
    schemaVersion: GOVERNANCE_SCHEMA_VERSIONS.ownerBaseline,
    entries: ownerEntries,
    retiredDelegations,
    exactSetDigest: governanceDigest(
      'snapback:visibility-override-owner-baseline:v1:exact-set',
      { entries: ownerEntries, retiredDelegations },
    ),
  };
  requireExactBaseline(
    committedOwnerBaseline,
    ownerBaseline,
    'SNAPBACK_TABLE_VISIBILITY_OVERRIDE_APPROVAL_INVALID',
    'visibility override owner baseline',
  );
  const quarantine = validateQuarantineLedger(
    readOptional(join(backendRoot, GOVERNANCE_FILES.quarantineLedger)),
    backendRoot,
  );
  const retired = new Set(quarantine.retiredIds);
  const active = [];
  const projections = [];
  const warnings = [];
  for (const source of declarations) {
    const parsed = canonicalOverrideDeclaration(source, tables);
    const declaration = parsed.canonical;
    if (retired.has(declaration.id)) {
      refuse('SNAPBACK_TABLE_VISIBILITY_POLICY_PROVENANCE_INVALID',
        `quarantined visibility authority id ${declaration.id} cannot be reused`, { overrideId: declaration.id });
    }
    const scopeDigest = overrideScopeDigest(declaration);
    const approvalPath = resolveGovernancePath(backendRoot, parsed.approvalPath,
      'SNAPBACK_TABLE_VISIBILITY_OVERRIDE_UNAPPROVED', 'approval path');
    const approval = parseJsonFile(approvalPath, 'SNAPBACK_TABLE_VISIBILITY_OVERRIDE_UNAPPROVED',
      `approval for ${declaration.id}`);
    const closure = validateApproval(
      approval,
      declaration,
      scopeDigest,
      ownerMap,
      backendRoot,
      tables,
      parsed.patternDerivation,
    );
    const receiptPath = resolveGovernancePath(backendRoot, parsed.separationReceiptPath,
      'SNAPBACK_TABLE_VISIBILITY_OVERRIDE_REMOTE_SEPARATION_REQUIRED', 'separation receipt path');
    const receipt = parseJsonFile(receiptPath,
      'SNAPBACK_TABLE_VISIBILITY_OVERRIDE_REMOTE_SEPARATION_REQUIRED',
      `separation receipt for ${declaration.id}`);
    const separation = validateSeparationReceipt(receipt, {
      approval,
      approvalClosureDigest: closure.approvalClosureDigest,
      ownerMapDigest: closure.ownerMapDigest,
      backendRoot,
      targetObserverPin,
    });
    const approvalIssuedAt = Date.parse(approval.issuedOn);
    const separationObservedAt = Date.parse(separation.observedAt);
    if (!Number.isFinite(approvalIssuedAt) || !Number.isFinite(separationObservedAt)
      || approvalIssuedAt > separationObservedAt + MAX_ISSUED_SKEW_MS
      || separationObservedAt > now + MAX_ISSUED_SKEW_MS) {
      refuse('SNAPBACK_TABLE_VISIBILITY_OVERRIDE_APPROVAL_TIME_INVALID',
        `override ${declaration.id} approval or separation receipt is future-dated against trusted generator time`);
    }
    if (declaration.lifecycleClass === 'production'
      && validateProductionOverrideTime(declaration, separation.observedAt, now)) {
      warnings.push({
        code: 'SNAPBACK_TABLE_VISIBILITY_OVERRIDE_EXPIRING',
        severity: 'warning',
        subsystem: 'auth',
        message: `table visibility override ${declaration.id} owned by ${declaration.owner} expires on ${declaration.expiresOn}; renew its approval and separation receipt before the boundary`,
        details: {
          overrideId: declaration.id,
          owner: declaration.owner,
          expiresOn: declaration.expiresOn,
          operations: declaration.operations,
          tables: declaration.reads.map(({ table }) => table),
          renewalCommand: `snapback governance propose-renewal ${declaration.id}`,
        },
      });
    }
    const entry = visibilityOverrideBaselineEntry({
      declaration,
      scopeDigest,
      approvalPath: parsed.approvalPath,
      separationReceiptPath: parsed.separationReceiptPath,
      approvalClosureDigest: closure.approvalClosureDigest,
      receiptDigest: separation.receiptDigest,
      approvalKind: approval.approvalKind,
      patternDerivation: parsed.patternDerivation ?? null,
      normalizedPatternCeiling: closure.normalizedPatternCeiling,
    });
    active.push(entry);
    projections.push(projectionOverride(
      entry,
      declaration,
      approval,
      receipt,
      closure.owner,
      parsed.patternDerivation,
    ));
  }
  const overrideBaseline = exactSetBaseline(active, GOVERNANCE_SCHEMA_VERSIONS.overrideBaseline);
  requireExactBaseline(
    readOptional(join(backendRoot, GOVERNANCE_FILES.overrideBaseline)),
    overrideBaseline,
    'SNAPBACK_TABLE_VISIBILITY_OVERRIDE_RATCHET_GROWTH',
    'visibility override exact-set baseline',
  );
  const transitionLedger = validateTransitionLedger(
    readOptional(join(backendRoot, GOVERNANCE_FILES.transitionLedger)),
    tables,
    backendRoot,
    quarantine,
  );
  const policyBaseline = currentTablePolicyBaseline(tables, transitionLedger);
  const committedPolicyBaseline = readOptional(join(backendRoot, GOVERNANCE_FILES.policyBaseline));
  if (committedPolicyBaseline !== null
    && canonicalGovernanceJson(committedPolicyBaseline) !== canonicalGovernanceJson(policyBaseline)) {
    const prior = new Map((committedPolicyBaseline.entries ?? [])
      .map((entry) => [entry.tableId, entry]));
    const widens = policyBaseline.entries.some((entry) => {
      const predecessor = prior.get(entry.tableId);
      if (!predecessor) return entry.normalizedPolicyBody.policy.kind === 'public-read';
      return compareVisibilityPolicies(
        predecessor.normalizedPolicyBody,
        entry.normalizedPolicyBody,
      ) === 'growth';
    });
    if (widens) {
      refuse('SNAPBACK_TABLE_VISIBILITY_POLICY_RATCHET_GROWTH',
        'ordinary table visibility policy widens without its admitted transition record');
    }
  }
  requireExactBaseline(committedPolicyBaseline, policyBaseline,
    'SNAPBACK_TABLE_VISIBILITY_POLICY_PROVENANCE_INVALID',
    'ordinary table-policy exact-set baseline');
  for (const entry of policyBaseline.entries) {
    if (entry.provenanceHeadId === null) {
      refuse('SNAPBACK_TABLE_VISIBILITY_POLICY_PROVENANCE_INVALID',
        `table ${entry.tableId} lacks an admission-provenance ledger head`);
    }
    const node = transitionLedger.nodes.find(({ id }) => id === entry.provenanceHeadId);
    if (!node || node.successorPolicyDigest !== entry.policyDigest) {
      refuse('SNAPBACK_TABLE_VISIBILITY_POLICY_PROVENANCE_INVALID',
        `table ${entry.tableId} has a stale or rebound ledger head`);
    }
  }
  const generationInputsHash = governanceDigest('snapback:visibility-governance-inputs:v1', {
    ownerMap,
    ownerBaseline,
    overrideBaseline,
    policyBaseline,
    transitionLedger: transitionLedger.nodes,
    quarantineHeadDigest: quarantine.headDigest,
  });
  const visibilityAuthorizationProgramDigest = governanceDigest(
    'snapback:visibility-authorization-program:v1',
    { active, policyBaseline, quarantineHeadDigest: quarantine.headDigest },
  );
  return {
    ownerMap,
    ownerBaseline,
    overrideBaseline,
    policyBaseline,
    transitionLedger,
    quarantine,
    visibilityOverrides: projections.sort((a, b) => compareText(a.id, b.id)),
    tablePolicyTransitions: transitionLedger.nodes.sort((a, b) => compareText(a.id, b.id)),
    warnings,
    generationInputsHash,
    visibilityAuthorizationProgramDigest,
    activation: {
      schemaVersion: GOVERNANCE_SCHEMA_VERSIONS.activation,
      required: active.length > 0 || transitionLedger.nodes.some(({ admissionKind }) => admissionKind === 'approved-transition'),
      generationInputsHash,
      visibilityAuthorizationProgramDigest,
      overrideBaselineDigest: overrideBaseline.exactSetDigest,
      tablePolicyBaselineDigest: policyBaseline.exactSetDigest,
      quarantineHeadDigest: quarantine.headDigest,
      fixtureProfiles: projections
        .filter(({ lifecycleClass }) => lifecycleClass === 'fixture')
        .map(({ id, fixtureProfileId, fixtureProfileDigest, fixtureTargetClassCeiling, fixturePrincipalClass, fixtureDataClassification }) => ({
          overrideId: id,
          id: fixtureProfileId,
          digest: fixtureProfileDigest,
          targetClassCeiling: fixtureTargetClassCeiling,
          principalClass: fixturePrincipalClass,
          dataClassification: fixtureDataClassification,
        })),
      productionWindows: projections
        .filter(({ lifecycleClass }) => lifecycleClass === 'production')
        .map(({ id, issuedOn, expiresOn }) => ({ overrideId: id, issuedOn, expiresOn })),
    },
  };
}

function comparableOverride(entry) {
  return {
    approvalKind: entry.approvalKind,
    patternId: entry.patternId,
    constructorVersion: entry.constructorVersion,
    constructorDigest: entry.constructorDigest,
    derivationDigest: entry.derivationDigest,
    lifecycleClass: entry.lifecycleClass,
    authorityMode: entry.authorityMode,
    operations: entry.operations,
    tables: entry.tables,
    rowScopeDigests: entry.rowScopeDigests,
    audienceDeclarationClosureDigests: entry.audienceDeclarationClosureDigests,
    authorityAdmissionPolicyDigest: entry.authorityAdmissionPolicyDigest,
    fixtureProfileDigest: entry.fixtureProfileDigest,
    fixtureTargetClassCeiling: entry.fixtureTargetClassCeiling,
    fixturePrincipalClass: entry.fixturePrincipalClass,
    fixtureDataClassification: entry.fixtureDataClassification,
    expiresOn: entry.expiresOn,
  };
}

function setSubset(before, after) {
  const prior = new Set(before);
  return after.every((value) => prior.has(value));
}

function overrideIsNarrowerOrEqual(before, after) {
  if (before.lifecycleClass !== after.lifecycleClass || before.authorityMode !== after.authorityMode
    || before.approvalKind !== after.approvalKind
    || before.patternId !== after.patternId
    || before.constructorVersion !== after.constructorVersion
    || before.constructorDigest !== after.constructorDigest
    || before.derivationDigest !== after.derivationDigest) return false;
  if (!setSubset(before.operations, after.operations) || !setSubset(before.tables, after.tables)) return false;
  if (!setSubset(before.rowScopeDigests, after.rowScopeDigests)
    || !setSubset(before.audienceDeclarationClosureDigests, after.audienceDeclarationClosureDigests)) return false;
  if (before.authorityAdmissionPolicyDigest !== after.authorityAdmissionPolicyDigest) return false;
  if (before.fixtureProfileDigest !== after.fixtureProfileDigest
    || before.fixtureTargetClassCeiling !== after.fixtureTargetClassCeiling
    || before.fixturePrincipalClass !== after.fixturePrincipalClass
    || before.fixtureDataClassification !== after.fixtureDataClassification) return false;
  if (before.expiresOn !== null && after.expiresOn !== null && after.expiresOn > before.expiresOn) return false;
  return true;
}

function artifactAtRevision(root, revision, path) {
  try {
    const { execFileSync } = requireNodeChildProcess();
    return execFileSync('git', ['show', `${revision}:${path}`], {
      cwd: root,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
  } catch {
    return null;
  }
}

// Kept behind a helper so browser/package consumers of this module do not
// eagerly acquire child-process capability. Node admission scripts install it.
let nodeChildProcess = null;
export function installGovernanceNodeChildProcess(value) {
  nodeChildProcess = value;
}
function requireNodeChildProcess() {
  if (!nodeChildProcess) throw new Error('visibility governance Git adapter is not installed');
  return nodeChildProcess;
}

function parseRevisionJson(root, revision, path) {
  const source = artifactAtRevision(root, revision, path);
  return source === null ? null : JSON.parse(source);
}

function backendGovernancePath(backendPath, path) {
  return backendPath ? `${backendPath.replace(/\/$/u, '')}/${path}` : path;
}

function approvalClosurePaths(root, revision, approvalPath, backendPath) {
  const repositoryPath = backendGovernancePath(backendPath, approvalPath);
  const approval = parseRevisionJson(root, revision, repositoryPath);
  if (!approval) return [repositoryPath];
  return [
    repositoryPath,
    approval.reviewArtifact,
    approval.approvalRuling,
    approval.delegationRuling,
  ].filter(Boolean).map((path) => (
    path === repositoryPath ? path : backendGovernancePath(backendPath, path)
  ));
}

function requirePriorUnchangedClosure({ root, beforeOid, afterOid, paths, code, message, details }) {
  for (const path of paths) {
    const predecessor = artifactAtRevision(root, beforeOid, path);
    const successor = artifactAtRevision(root, afterOid, path);
    if (predecessor === null || successor === null || predecessor !== successor) {
      refuse(code, message, { ...details, path, beforeOid, afterOid });
    }
  }
}

function baselineExactSetValid(baseline) {
  if (!baseline?.schemaVersion || !Array.isArray(baseline.entries)) return false;
  return baseline.exactSetDigest === governanceDigest(
    `${baseline.schemaVersion}:exact-set`,
    [...baseline.entries].sort((a, b) => compareText(a.id ?? a.tableId, b.id ?? b.tableId)),
  );
}

export function approvalClosureAtRevision({ root, revision, backendPath, approvalPath }) {
  const code = 'SNAPBACK_TABLE_VISIBILITY_OVERRIDE_APPROVAL_INVALID';
  const repositoryPath = backendGovernancePath(backendPath, approvalPath);
  const approval = parseRevisionJson(root, revision, repositoryPath);
  if (!approval) refuse(code, `approval closure member ${repositoryPath} is missing`);
  exactKeys(approval, APPROVAL_RECORD_KEYS, 'approval record', code, [
    'schemaVersion', 'scopeDigestVersion', 'digestAlgorithm', 'approvalKind', 'id',
    'scopeDigest', 'lifecycleClass', 'requestedBy', 'approvedBy', 'ownerMapDigest',
    'issuedOn', 'justificationDigest', 'acceptanceId', 'acceptancePath',
    'reviewArtifact', 'reviewRecord', 'approvalRuling', 'rulingRecord',
    'delegationRuling', 'delegationRecord',
  ]);
  if (approval.schemaVersion !== GOVERNANCE_SCHEMA_VERSIONS.approvalRecord
    || approval.scopeDigestVersion !== GOVERNANCE_SCOPE_DIGEST_VERSION
    || approval.digestAlgorithm !== GOVERNANCE_DIGEST_ALGORITHM
    || !['custom', 'pattern', 'table-policy-transition'].includes(approval.approvalKind)
    || !SHA256.test(approval.scopeDigest ?? '')
    || !SHA256.test(approval.justificationDigest ?? '')
    || !UTC_INSTANT.test(approval.issuedOn ?? '')) {
    refuse(code, `approval closure member ${repositoryPath} is malformed or unbound`);
  }
  for (const field of ['id', 'requestedBy', 'approvedBy', 'acceptanceId', 'acceptancePath']) {
    nonEmpty(approval[field], `approval record.${field}`, code);
  }
  const ownerMapPath = backendGovernancePath(backendPath, GOVERNANCE_FILES.ownerMap);
  const ownerMapSource = parseRevisionJson(root, revision, ownerMapPath);
  if (!ownerMapSource) refuse(code, `approval closure lacks owner map ${ownerMapPath}`);
  const ownerMap = canonicalOwnerMap(ownerMapSource);
  const ownerMapDigest = governanceDigest('snapback:visibility-owner-map:v1', ownerMap);
  if (approval.ownerMapDigest !== ownerMapDigest) refuse(code, 'approval ownerMapDigest is stale');
  for (const [pathField, recordField] of [
    ['reviewArtifact', 'reviewRecord'],
    ['approvalRuling', 'rulingRecord'],
    ['delegationRuling', 'delegationRecord'],
  ]) {
    const pointer = approval[pathField];
    const repeated = approval[recordField] ?? null;
    if (pointer === null || pointer === undefined) {
      if (repeated !== null) refuse(code, `${recordField} requires ${pathField}`);
      continue;
    }
    const pointed = parseRevisionJson(
      root,
      revision,
      backendGovernancePath(backendPath, pointer),
    );
    if (!pointed || canonicalGovernanceJson(pointed[recordField])
      !== canonicalGovernanceJson(repeated)) {
      refuse(code, `${pathField} does not deep-match ${recordField}`);
    }
  }
  const owner = ownerMap.entries.find((entry) => entry.path === approval.acceptancePath)
    ?? ownerMap.entries.find((entry) => entry.patternId === approval.patternId)
    ?? {
      approvalOwner: ownerMap.fallbackApprovalOwner,
      authorRuling: null,
      delegationRecord: null,
    };
  if (approval.approvedBy !== owner.approvalOwner
    || approval.delegationRuling !== owner.authorRuling
    || canonicalGovernanceJson(approval.delegationRecord ?? null)
      !== canonicalGovernanceJson(owner.delegationRecord ?? null)) {
    refuse(code, `approval ${approval.id} does not deep-match its mapped owner closure`);
  }
  return {
    approval,
    ownerMap,
    ownerMapDigest,
    approvalClosureDigest: governanceDigest(
      'snapback:visibility-approval-closure:v1',
      { approval, ownerMap },
    ),
  };
}

function separationReceiptAtRevision({
  root,
  revision,
  backendPath,
  receiptPath,
  closure,
  policy = false,
}) {
  const code = policy
    ? 'SNAPBACK_TABLE_VISIBILITY_POLICY_REMOTE_SEPARATION_REQUIRED'
    : 'SNAPBACK_TABLE_VISIBILITY_OVERRIDE_REMOTE_SEPARATION_REQUIRED';
  const repositoryPath = backendGovernancePath(backendPath, receiptPath);
  const receipt = parseRevisionJson(root, revision, repositoryPath);
  if (!receipt) refuse(code, `separation receipt ${repositoryPath} is missing`);
  exactKeys(receipt, [
    'schemaVersion', 'providerProfile', 'eventId', 'governedRef', 'eventInputDigest',
    'beforeOid', 'afterOid', 'observedAt', 'approvalKind', 'approvalId', 'scopeDigest',
    'approvalClosureDigest', 'predecessorOwnerMapDigest', 'comparatorVersion',
    'approvalOnly', 'observerKeyEpoch', 'observerKeyDigest', 'signature',
  ], 'separation receipt', code, [
    'schemaVersion', 'providerProfile', 'eventId', 'governedRef', 'eventInputDigest',
    'beforeOid', 'afterOid', 'observedAt', 'approvalKind', 'approvalId', 'scopeDigest',
    'approvalClosureDigest', 'predecessorOwnerMapDigest', 'comparatorVersion',
    'approvalOnly', 'observerKeyEpoch', 'observerKeyDigest', 'signature',
  ]);
  const { approval, approvalClosureDigest, ownerMapDigest } = closure;
  if (receipt.schemaVersion !== GOVERNANCE_SCHEMA_VERSIONS.separationReceipt
    || receipt.approvalOnly !== true
    || receipt.approvalKind !== approval.approvalKind
    || receipt.approvalId !== approval.id
    || receipt.scopeDigest !== approval.scopeDigest
    || receipt.approvalClosureDigest !== approvalClosureDigest
    || receipt.predecessorOwnerMapDigest !== ownerMapDigest
    || !OID.test(receipt.beforeOid ?? '') || !OID.test(receipt.afterOid ?? '')
    || receipt.beforeOid === receipt.afterOid
    || !['github-push-v1', 'atomic-push-envelope-v1'].includes(receipt.providerProfile)
    || !SHA256.test(receipt.eventInputDigest ?? '')
    || !UTC_INSTANT.test(receipt.observedAt ?? '')
    || receipt.comparatorVersion !== GOVERNANCE_COMPARATOR_VERSION) {
    refuse(code, `separation receipt ${repositoryPath} does not bind approval ${approval.id}`);
  }
  const registryPath = backendGovernancePath(backendPath, GOVERNANCE_FILES.observerKeys);
  const registry = parseRevisionJson(root, revision, registryPath);
  if (!registry) refuse(code, `observer key registry ${registryPath} is missing`);
  verifyObserverSignature(receipt, registry, code);
  return {
    receipt,
    receiptDigest: governanceDigest('snapback:visibility-separation-receipt:v1', receipt),
  };
}

function validateOverrideBaselineAtRevision({ root, revision, backendPath, baseline }) {
  const code = 'SNAPBACK_TABLE_VISIBILITY_OVERRIDE_APPROVAL_INVALID';
  if (!baselineExactSetValid(baseline)) {
    refuse('SNAPBACK_TABLE_VISIBILITY_OVERRIDE_RATCHET_GROWTH',
      'visibility override exact-set baseline digest is stale or rebound');
  }
  for (const entry of baseline.entries) {
    const declaration = object(entry.normalizedDeclaration,
      `override baseline ${entry.id}.normalizedDeclaration`, code);
    const scopeDigest = overrideScopeDigest(declaration);
    if (scopeDigest !== entry.scopeDigest) {
      refuse(code, `override baseline ${entry.id} is not bound to its canonical scope preimage`);
    }
    const patternDerivation = entry.approvalKind === 'pattern'
      ? {
          patternId: entry.patternId,
          constructorVersion: entry.constructorVersion,
          constructorDigest: entry.constructorDigest,
          derivationDigest: entry.derivationDigest,
        }
      : null;
    const expected = visibilityOverrideBaselineEntry({
      declaration,
      scopeDigest,
      approvalPath: entry.approvalRecord,
      separationReceiptPath: entry.serverSeparationReceipt,
      approvalClosureDigest: entry.approvalClosureDigest,
      receiptDigest: entry.serverSeparationReceiptDigest,
      approvalKind: entry.approvalKind,
      patternDerivation,
      normalizedPatternCeiling: entry.normalizedPatternCeiling,
    });
    if (canonicalGovernanceJson(expected) !== canonicalGovernanceJson(entry)) {
      refuse(code, `override baseline ${entry.id} contains a rebound authority field`);
    }
    const closure = approvalClosureAtRevision({
      root,
      revision,
      backendPath,
      approvalPath: entry.approvalRecord,
    });
    const approval = closure.approval;
    const owner = ownerForDeclaration(closure.ownerMap, declaration);
    if (closure.approvalClosureDigest !== entry.approvalClosureDigest
      || approval.approvalKind !== entry.approvalKind
      || approval.lifecycleClass !== declaration.lifecycleClass
      || declaration.owner !== owner.implementationOwner) {
      refuse(code, `override baseline ${entry.id} does not bind its approval closure`);
    }
    if (entry.approvalKind === 'custom') {
      if (approval.id !== entry.id || approval.scopeDigest !== entry.scopeDigest
        || approval.justificationDigest !== declaration.justificationDigest
        || approval.acceptanceId !== declaration.acceptance.id
        || approval.acceptancePath !== declaration.acceptance.path) {
        refuse(code, `custom override baseline ${entry.id} reuses an approval for another scope`);
      }
    } else {
      const ceiling = entry.normalizedPatternCeiling;
      const expectedDerivation = governanceDigest('snapback:visibility-pattern-derivation:v1', {
        instanceId: entry.id,
        instanceScopeDigest: entry.scopeDigest,
        patternApprovalScopeDigest: approval.scopeDigest,
        patternId: entry.patternId,
        constructorVersion: entry.constructorVersion,
        constructorDigest: entry.constructorDigest,
      });
      if (!ceiling || approval.id !== entry.patternId || approval.patternId !== entry.patternId
        || approval.constructorVersion !== entry.constructorVersion
        || approval.constructorDigest !== entry.constructorDigest
        || governanceDigest('snapback:visibility-pattern-constructor:v1', ceiling)
          !== entry.constructorDigest
        || patternApprovalScopeDigest(approval, ceiling) !== approval.scopeDigest
        || !normalizedPatternInstanceIsWithin(declaration, ceiling, approval)
        || expectedDerivation !== entry.derivationDigest) {
        refuse(code, `pattern override baseline ${entry.id} carries fabricated derivation provenance`);
      }
    }
    const separation = separationReceiptAtRevision({
      root,
      revision,
      backendPath,
      receiptPath: entry.serverSeparationReceipt,
      closure,
    });
    if (separation.receiptDigest !== entry.serverSeparationReceiptDigest) {
      refuse(code, `override baseline ${entry.id} has a rebound separation receipt`);
    }
  }
}

function normalizedPolicyBody(policy, owner) {
  return {
    policy,
    audienceDeclarationClosure: owner.audienceDeclarationClosure ?? [],
    audienceDeclarationClosureDigest: owner.audienceDeclarationClosureDigest
      ?? governanceDigest('snapback:visibility-audience-closure:v1', []),
  };
}

function normalizedPatternInstanceIsWithin(declaration, ceiling, approval) {
  if (declaration.lifecycleClass !== ceiling.lifecycleClass
    || declaration.authority.mode !== ceiling.authority.mode
    || !setSubset(ceiling.operations, declaration.operations)) return false;
  if (declaration.lifecycleClass === 'fixture'
    && canonicalGovernanceJson(declaration.fixtureProfile)
      !== canonicalGovernanceJson(ceiling.fixtureProfile)) return false;
  if (declaration.lifecycleClass === 'production'
    && declaration.expiresOn > approval.expiresOn) return false;
  const instanceAuthority = declaration.authority;
  const ceilingAuthority = ceiling.authority;
  if (instanceAuthority.mode === 'system'
    && (instanceAuthority.entrypoint !== ceilingAuthority.entrypoint
      || !setSubset(ceilingAuthority.calls, instanceAuthority.calls))) return false;
  if (instanceAuthority.mode === 'capturedGrant'
    && (instanceAuthority.issuanceProfile !== ceilingAuthority.issuanceProfile
      || instanceAuthority.maximumTtlMs > ceilingAuthority.maximumTtlMs
      || !setSubset(ceilingAuthority.operations, instanceAuthority.operations))) return false;
  if (instanceAuthority.mode === 'principal'
    && (!setSubset(ceilingAuthority.operations, instanceAuthority.operations)
      || compareVisibilityPolicies(
        normalizedPolicyBody(ceilingAuthority.admissionPolicy, {
          audienceDeclarationClosure:
            ceilingAuthority.admissionMembershipAudienceClosure,
          audienceDeclarationClosureDigest:
            ceilingAuthority.admissionMembershipAudienceClosureDigest,
        }),
        normalizedPolicyBody(instanceAuthority.admissionPolicy, {
          audienceDeclarationClosure:
            instanceAuthority.admissionMembershipAudienceClosure,
          audienceDeclarationClosureDigest:
            instanceAuthority.admissionMembershipAudienceClosureDigest,
        }),
      ) === 'growth')) return false;
  const ceilingReads = new Map(ceiling.reads.map((entry) => [entry.table, entry]));
  return declaration.reads.every((instanceRead) => {
    const ceilingRead = ceilingReads.get(instanceRead.table);
    if (!ceilingRead) return false;
    if (ceilingRead.scope.allRows === true) return true;
    if (canonicalGovernanceJson(instanceRead.scope)
      === canonicalGovernanceJson(ceilingRead.scope)) return true;
    if (!instanceRead.scope.kind || !ceilingRead.scope.kind
      || instanceRead.scope.kind === 'argument-equality'
      || ceilingRead.scope.kind === 'argument-equality') return false;
    return compareVisibilityPolicies(
      normalizedPolicyBody(ceilingRead.scope, ceilingRead),
      normalizedPolicyBody(instanceRead.scope, instanceRead),
    ) !== 'growth';
  });
}

function validateStoredPolicyBody(body, label) {
  const code = 'SNAPBACK_TABLE_VISIBILITY_POLICY_PROVENANCE_INVALID';
  exactKeys(body, [
    'policy', 'audienceDeclarationClosure', 'audienceDeclarationClosureDigest',
  ], label, code, [
    'policy', 'audienceDeclarationClosure', 'audienceDeclarationClosureDigest',
  ]);
  const policy = canonicalVisibilityPolicy(body.policy, `${label}.policy`, code);
  if (canonicalGovernanceJson(policy) !== canonicalGovernanceJson(body.policy)
    || !Array.isArray(body.audienceDeclarationClosure)
    || governanceDigest(
      'snapback:visibility-audience-closure:v1',
      body.audienceDeclarationClosure,
    ) !== body.audienceDeclarationClosureDigest) {
    refuse(code, `${label} is non-canonical or has a rebound audience closure`);
  }
  return body;
}

function validatePolicyLedgerAtRevision({ root, revision, backendPath, ledger, baseline }) {
  const code = 'SNAPBACK_TABLE_VISIBILITY_POLICY_PROVENANCE_INVALID';
  if (!baselineExactSetValid(baseline)) {
    refuse(code, 'ordinary table-policy exact-set baseline digest is stale or rebound');
  }
  exactKeys(ledger, ['schemaVersion', 'nodes', 'heads', 'ledgerDigest'],
    'transition ledger', code, ['schemaVersion', 'nodes', 'heads', 'ledgerDigest']);
  if (ledger.schemaVersion !== GOVERNANCE_SCHEMA_VERSIONS.transitionLedger
    || !Array.isArray(ledger.nodes) || !ledger.heads || typeof ledger.heads !== 'object'
    || Array.isArray(ledger.heads)) {
    refuse(code, 'ordinary table-policy transition ledger is malformed');
  }
  const nodes = new Map();
  for (const node of ledger.nodes) {
    exactKeys(node, [
      'schemaVersion', 'id', 'tableId', 'predecessorHeadId', 'predecessorHeadDigest',
      'predecessorNormalizedPolicyBody', 'predecessorPolicyDigest',
      'successorNormalizedPolicyBody', 'successorPolicyDigest', 'admissionKind',
      'approvalPath', 'approvalClosureDigest', 'serverSeparationReceipt',
      'serverSeparationReceiptDigest', 'quarantineVerdict',
    ], 'transition ledger node', code, [
      'schemaVersion', 'id', 'tableId', 'predecessorHeadId', 'predecessorHeadDigest',
      'predecessorNormalizedPolicyBody', 'predecessorPolicyDigest',
      'successorNormalizedPolicyBody', 'successorPolicyDigest', 'admissionKind',
      'approvalPath', 'approvalClosureDigest', 'serverSeparationReceipt',
      'serverSeparationReceiptDigest', 'quarantineVerdict',
    ]);
    if (node.schemaVersion !== GOVERNANCE_SCHEMA_VERSIONS.transitionRecord
      || nodes.has(node.id)) refuse(code, `transition ledger reuses or malforms node ${node.id}`);
    const predecessorBody = node.predecessorNormalizedPolicyBody === null
      ? null
      : validateStoredPolicyBody(
          node.predecessorNormalizedPolicyBody,
          `transition ${node.id} predecessor`,
        );
    const successorBody = validateStoredPolicyBody(
      node.successorNormalizedPolicyBody,
      `transition ${node.id} successor`,
    );
    if ((predecessorBody === null && node.predecessorPolicyDigest !== null)
      || (predecessorBody !== null && governanceDigest(
        'snapback:table-visibility-policy-body:v1',
        predecessorBody,
      ) !== node.predecessorPolicyDigest)
      || governanceDigest(
        'snapback:table-visibility-policy-body:v1',
        successorBody,
      ) !== node.successorPolicyDigest) {
      refuse(code, `transition ${node.id} carries a rebound policy body`);
    }
    const classification = compareVisibilityPolicies(predecessorBody, successorBody);
    const expectedKind = classification === 'new-restricted'
      ? 'new-restricted'
      : classification === 'narrowing' || classification === 'equal'
        ? 'narrowing'
        : 'approved-transition';
    if (node.admissionKind === 'approved-transition') {
      const closure = approvalClosureAtRevision({
        root,
        revision,
        backendPath,
        approvalPath: node.approvalPath,
      });
      if (closure.approval.approvalKind !== 'table-policy-transition'
        || closure.approval.lifecycleClass !== 'durable-policy'
        || closure.approval.id !== node.id
        || closure.approval.scopeDigest !== transitionApprovalScopeDigest(node, closure.approval)
        || closure.approvalClosureDigest !== node.approvalClosureDigest) {
        refuse(code, `transition ${node.id} does not bind its remotely approved closure`);
      }
      const separation = separationReceiptAtRevision({
        root,
        revision,
        backendPath,
        receiptPath: node.serverSeparationReceipt,
        closure,
        policy: true,
      });
      if (separation.receiptDigest !== node.serverSeparationReceiptDigest) {
        refuse(code, `transition ${node.id} has a rebound separation receipt`);
      }
    } else if (node.admissionKind === 'quarantined-reversal') {
      if (classification === 'growth' || node.quarantineVerdict === null
        || [node.approvalPath, node.approvalClosureDigest, node.serverSeparationReceipt,
          node.serverSeparationReceiptDigest].some((value) => value !== null)) {
        refuse(code, `quarantined reversal ${node.id} can confer no authority`);
      }
      const quarantineLedger = parseRevisionJson(
        root,
        revision,
        backendGovernancePath(backendPath, GOVERNANCE_FILES.quarantineLedger),
      );
      if (!quarantineLedger) {
        refuse(code, `quarantined reversal ${node.id} lacks the permanent quarantine ledger`);
      }
      validateQuarantineLedgerAtRevision({
        root,
        revision,
        backendPath,
        ledger: quarantineLedger,
      });
      const quarantineRecord = quarantineLedger.records.find(({ path }) => (
        path === node.quarantineVerdict
      ));
      if (!quarantineRecord || quarantineRecord.governedRecordId !== node.predecessorHeadId) {
        refuse(code, `quarantined reversal ${node.id} does not name its bad predecessor head`);
      }
    } else if (node.admissionKind !== expectedKind && node.admissionKind !== 'g1-migration') {
      refuse(code, `transition ${node.id} authored ${node.admissionKind} but recomputes ${expectedKind}`);
    } else {
      const authorityArtifacts = [
        node.approvalPath,
        node.approvalClosureDigest,
        node.serverSeparationReceipt,
        node.serverSeparationReceiptDigest,
        node.quarantineVerdict,
      ];
      if (authorityArtifacts.some((value) => value !== null)) {
        refuse(code, `non-widening transition ${node.id} carries authority artifacts`);
      }
      if (node.admissionKind === 'g1-migration' && node.predecessorHeadId !== null) {
        refuse(code, `G1 migration transition ${node.id} must be a root`);
      }
    }
    nodes.set(node.id, node);
  }
  for (const [id, node] of nodes) {
    if (node.predecessorHeadId === null) {
      if (node.predecessorHeadDigest !== null || node.predecessorNormalizedPolicyBody !== null) {
        refuse(code, `transition root ${id} carries predecessor material`);
      }
      continue;
    }
    const predecessor = nodes.get(node.predecessorHeadId);
    if (!predecessor || predecessor.tableId !== node.tableId
      || node.predecessorHeadDigest !== transitionNodeDigest(predecessor)
      || canonicalGovernanceJson(node.predecessorNormalizedPolicyBody)
        !== canonicalGovernanceJson(predecessor.successorNormalizedPolicyBody)) {
      refuse(code, `transition ${id} has a stale or rebound predecessor`);
    }
  }
  const reachable = new Set();
  for (const [tableId, headId] of Object.entries(ledger.heads)) {
    const chain = new Set();
    let cursor = headId;
    while (cursor !== null) {
      const node = nodes.get(cursor);
      if (!node || node.tableId !== tableId || chain.has(cursor)) {
        refuse(code, `table ${tableId} has a missing, foreign, or cyclic ledger head`);
      }
      chain.add(cursor);
      reachable.add(cursor);
      cursor = node.predecessorHeadId;
    }
  }
  if (reachable.size !== nodes.size
    || transitionLedgerDigest(ledger.nodes, ledger.heads) !== ledger.ledgerDigest) {
    refuse(code, 'transition ledger is forked, orphaned, or rebound');
  }
  for (const entry of baseline.entries) {
    const head = nodes.get(entry.provenanceHeadId);
    if (!head || head.tableId !== entry.tableId
      || head.successorPolicyDigest !== entry.policyDigest
      || canonicalGovernanceJson(head.successorNormalizedPolicyBody)
        !== canonicalGovernanceJson(entry.normalizedPolicyBody)) {
      refuse(code, `table ${entry.tableId} names a stale or rebound policy head`);
    }
  }
}

function validateQuarantineLedgerAtRevision({ root, revision, backendPath, ledger }) {
  const code = 'SNAPBACK_TABLE_VISIBILITY_POLICY_PROVENANCE_INVALID';
  exactKeys(ledger, ['schemaVersion', 'records', 'retiredIds', 'headDigest'],
    'quarantine ledger', code, ['schemaVersion', 'records', 'retiredIds', 'headDigest']);
  if (ledger.schemaVersion !== GOVERNANCE_SCHEMA_VERSIONS.quarantineLedger) {
    refuse(code, 'quarantine ledger schemaVersion is unsupported');
  }
  const records = exactArray(ledger.records, 'quarantine ledger.records', code);
  const retired = sortedUniqueStrings(ledger.retiredIds, 'quarantine ledger.retiredIds', code);
  const registryPath = backendGovernancePath(backendPath, GOVERNANCE_FILES.observerKeys);
  const registry = records.length === 0 ? null : parseRevisionJson(root, revision, registryPath);
  if (records.length > 0 && !registry) refuse(code, `observer key registry ${registryPath} is missing`);
  const quarantineIds = new Set();
  const governedRecordIds = new Set();
  let predecessorHead = governanceDigest('snapback:visibility-quarantine-head:v1', []);
  for (const [index, entry] of records.entries()) {
    exactKeys(entry, ['quarantineId', 'governedRecordId', 'path', 'digest'],
      `quarantine ledger.records.${index}`, code,
      ['quarantineId', 'governedRecordId', 'path', 'digest']);
    if (quarantineIds.has(entry.quarantineId) || governedRecordIds.has(entry.governedRecordId)) {
      refuse(code, `quarantine ledger record ${index} reuses a retired id`);
    }
    quarantineIds.add(entry.quarantineId);
    governedRecordIds.add(entry.governedRecordId);
    const verdictPath = backendGovernancePath(backendPath, entry.path);
    const verdict = parseRevisionJson(root, revision, verdictPath);
    if (!verdict) refuse(code, `quarantine verdict ${verdictPath} is missing`);
    exactKeys(verdict, [
      'schemaVersion', 'quarantineId', 'governedRecordId', 'authorityKind',
      'governedRef', 'beforeOid', 'afterOid', 'eventId', 'externalVerdictDigest',
      'offendingLedgerHead', 'violationSignature', 'predecessorQuarantineHead',
      'successorExactSetDigest', 'observedAt', 'observerKeyEpoch',
      'observerKeyDigest', 'signature',
    ], `quarantine verdict ${entry.path}`, code, [
      'schemaVersion', 'quarantineId', 'governedRecordId', 'authorityKind',
      'governedRef', 'beforeOid', 'afterOid', 'eventId', 'externalVerdictDigest',
      'offendingLedgerHead', 'violationSignature', 'predecessorQuarantineHead',
      'successorExactSetDigest', 'observedAt', 'observerKeyEpoch',
      'observerKeyDigest', 'signature',
    ]);
    if (verdict.schemaVersion !== GOVERNANCE_SCHEMA_VERSIONS.quarantineVerdict
      || !['visibility-override', 'delegation', 'table-policy-transition', 'governance-record']
        .includes(verdict.authorityKind)
      || !OID.test(verdict.beforeOid ?? '') || !OID.test(verdict.afterOid ?? '')
      || verdict.beforeOid === verdict.afterOid
      || !SHA256.test(verdict.externalVerdictDigest ?? '')
      || !SHA256.test(verdict.violationSignature ?? '')
      || !SHA256.test(verdict.predecessorQuarantineHead ?? '')
      || !SHA256.test(verdict.successorExactSetDigest ?? '')
      || !UTC_INSTANT.test(verdict.observedAt ?? '')) {
      refuse(code, `quarantine verdict ${entry.path} is malformed or unbound`);
    }
    verifyObserverSignature(verdict, registry, code);
    const digest = governanceDigest('snapback:visibility-quarantine-verdict:v1', verdict);
    const successorExactSetDigest = governanceDigest(
      'snapback:visibility-quarantine-successor-exact-set:v1',
      {
        predecessorHead,
        quarantineId: entry.quarantineId,
        governedRecordId: entry.governedRecordId,
      },
    );
    if (entry.digest !== digest || verdict.predecessorQuarantineHead !== predecessorHead
      || verdict.quarantineId !== entry.quarantineId
      || verdict.governedRecordId !== entry.governedRecordId
      || verdict.successorExactSetDigest !== successorExactSetDigest) {
      refuse(code, `quarantine ledger record ${index} is deleted, rebound, or rolled back`);
    }
    predecessorHead = governanceDigest('snapback:visibility-quarantine-head:v1', {
      predecessorHead,
      quarantineId: entry.quarantineId,
      governedRecordId: entry.governedRecordId,
      digest,
    });
  }
  const requiredRetired = records
    .flatMap(({ quarantineId, governedRecordId }) => [quarantineId, governedRecordId])
    .sort(compareText);
  if (ledger.headDigest !== predecessorHead
    || canonicalGovernanceJson(retired)
      !== canonicalGovernanceJson([...new Set(requiredRetired)].sort(compareText))) {
    refuse(code, 'quarantine exact set or append-only head is stale or rebound');
  }
}

function revisionChangedPaths(root, beforeOid, afterOid) {
  try {
    const { execFileSync } = requireNodeChildProcess();
    return execFileSync('git', ['diff', '--name-only', '--diff-filter=ACMRT', beforeOid, afterOid], {
      cwd: root,
      encoding: 'utf8',
    }).trim().split(/\r?\n/u).filter(Boolean);
  } catch {
    return [];
  }
}

function validateOwnerBaselineAtRevision({ root, revision, backendPath }) {
  const ownerMapPath = backendGovernancePath(backendPath, GOVERNANCE_FILES.ownerMap);
  const baselinePath = backendGovernancePath(backendPath, GOVERNANCE_FILES.ownerBaseline);
  const sourceMap = parseRevisionJson(root, revision, ownerMapPath);
  const baseline = parseRevisionJson(root, revision, baselinePath);
  if (!sourceMap && !baseline) return null;
  if (!sourceMap || !baseline) {
    refuse('SNAPBACK_TABLE_VISIBILITY_OVERRIDE_APPROVAL_INVALID',
      'owner map and owner exact-set baseline must exist together');
  }
  const ownerMap = canonicalOwnerMap(sourceMap);
  for (const entry of ownerMap.entries) {
    const rulingPath = backendGovernancePath(backendPath, entry.authorRuling);
    const ruling = parseRevisionJson(root, revision, rulingPath);
    if (!ruling || canonicalGovernanceJson(ruling.delegationRecord)
      !== canonicalGovernanceJson(entry.delegationRecord)) {
      refuse('SNAPBACK_TABLE_VISIBILITY_OVERRIDE_APPROVAL_INVALID',
        `owner-map delegation ${rulingPath} is missing or does not deep-match its author ruling`);
    }
  }
  const entries = ownerMap.entries.map((entry) => ({
    ...entry,
    delegationClosureDigest: governanceDigest(
      'snapback:visibility-owner-delegation-closure:v1',
      { authorRuling: entry.authorRuling, delegationRecord: entry.delegationRecord },
    ),
  }));
  const retiredDelegations = (baseline.retiredDelegations ?? [])
    .map((entry, index) => canonicalOwnerBaselineEntry(
      entry,
      `visibility override owner baseline.retiredDelegations.${index}`,
    ));
  for (const entry of retiredDelegations) {
    const rulingPath = backendGovernancePath(backendPath, entry.authorRuling);
    const ruling = parseRevisionJson(root, revision, rulingPath);
    if (!ruling || canonicalGovernanceJson(ruling.delegationRecord)
      !== canonicalGovernanceJson(entry.delegationRecord)) {
      refuse('SNAPBACK_TABLE_VISIBILITY_OVERRIDE_APPROVAL_INVALID',
        `retired owner-map delegation ${rulingPath} is missing or rebound`);
    }
  }
  const retainedDelegationDigests = [...entries, ...retiredDelegations]
    .map(({ delegationClosureDigest }) => delegationClosureDigest);
  if (new Set(retainedDelegationDigests).size !== retainedDelegationDigests.length) {
    refuse('SNAPBACK_TABLE_VISIBILITY_OVERRIDE_APPROVAL_INVALID',
      'active and retired delegation provenance overlaps');
  }
  const expected = {
    schemaVersion: GOVERNANCE_SCHEMA_VERSIONS.ownerBaseline,
    entries,
    retiredDelegations,
    exactSetDigest: governanceDigest(
      'snapback:visibility-override-owner-baseline:v1:exact-set',
      { entries, retiredDelegations },
    ),
  };
  if (canonicalGovernanceJson(expected) !== canonicalGovernanceJson(baseline)) {
    refuse('SNAPBACK_TABLE_VISIBILITY_OVERRIDE_APPROVAL_INVALID',
      'visibility override owner-map baseline was laundered or is stale');
  }
  return baseline;
}

function validateDelegationOrdering({ root, beforeOid, afterOid, backendPath }) {
  const approvalDirectory = backendGovernancePath(backendPath, 'visibility-override-approvals/');
  const changedApprovals = revisionChangedPaths(root, beforeOid, afterOid)
    .filter((path) => path.startsWith(approvalDirectory) && path.endsWith('.json'));
  if (changedApprovals.length === 0) return;
  const predecessor = validateOwnerBaselineAtRevision({ root, revision: beforeOid, backendPath });
  for (const path of changedApprovals) {
    const approval = parseRevisionJson(root, afterOid, path);
    if (!approval?.delegationRuling) continue;
    const prior = predecessor?.entries?.find((entry) => (
      entry.approvalOwner === approval.approvedBy
      && entry.authorRuling === approval.delegationRuling
      && canonicalGovernanceJson(entry.delegationRecord)
        === canonicalGovernanceJson(approval.delegationRecord)
    ));
    if (!prior) {
      refuse('SNAPBACK_TABLE_VISIBILITY_OVERRIDE_DELEGATION_NOT_PRIOR',
        `delegation consumed by ${path} was not present in the governed predecessor`,
        { path, beforeOid, afterOid });
    }
  }
}

const G1_CODEGEN_SOURCE = 'packages/snapback-codegen/index.mjs';
const G1_COMPLETION_TEST_SOURCE = 'packages/snapback-codegen/card-game-visibility-completion.test.mjs';

function g1ClosureSourcePreimage(receipt) {
  return {
    predecessorOid: receipt.predecessorOid,
    phases: receipt.phases,
    codegenSourceDigest: receipt.codegenSourceDigest,
    completionTestSourceDigest: receipt.completionTestSourceDigest,
    backends: receipt.backends,
    publicTables: receipt.publicTables,
  };
}

export function g1ClosureSourceRevisionDigest(receipt) {
  return governanceDigest(
    'snapback:visibility-governance-g1-source-revision:v1',
    g1ClosureSourcePreimage(receipt),
  );
}

export function g1ClosureReceiptDigest(receipt) {
  const { receiptDigest: _receiptDigest, ...payload } = receipt;
  return governanceDigest('snapback:visibility-governance-g1-closure-receipt:v1', payload);
}

function validateG1ClosureReceiptShape(receipt) {
  const code = 'SNAPBACK_TABLE_VISIBILITY_POLICY_PROVENANCE_INVALID';
  exactKeys(receipt, [
    'schemaVersion', 'closureId', 'predecessorOid', 'phases', 'approvedBy',
    'approvedOn', 'ruling', 'codegenSourceDigest', 'completionTestSourceDigest',
    'backends', 'publicTables', 'sourceRevisionDigest', 'receiptDigest',
  ], 'G1 migration closure receipt', code, [
    'schemaVersion', 'closureId', 'predecessorOid', 'phases', 'approvedBy',
    'approvedOn', 'ruling', 'codegenSourceDigest', 'completionTestSourceDigest',
    'backends', 'publicTables', 'sourceRevisionDigest', 'receiptDigest',
  ]);
  if (receipt.schemaVersion !== GOVERNANCE_SCHEMA_VERSIONS.g1Closure
    || !OID.test(receipt.predecessorOid ?? '')
    || canonicalGovernanceJson(receipt.phases) !== canonicalGovernanceJson(['G1', 'G2'])
    || !UTC_DATE.test(receipt.approvedOn ?? '')
    || !SHA256.test(receipt.codegenSourceDigest ?? '')
    || !SHA256.test(receipt.completionTestSourceDigest ?? '')) {
    refuse(code, 'G1 migration closure receipt identity or source binding is malformed');
  }
  for (const field of ['closureId', 'approvedBy', 'ruling']) {
    nonEmpty(receipt[field], `G1 migration closure receipt.${field}`, code);
  }
  const backends = exactArray(receipt.backends, 'G1 migration closure receipt.backends', code);
  for (const [index, entry] of backends.entries()) {
    exactKeys(entry, [
      'backendPath', 'authorizationReviewInputsHash', 'ownerMapDigest',
      'policyBaselineDigest', 'transitionLedgerDigest',
    ], `G1 migration closure receipt.backends.${index}`, code, [
      'backendPath', 'authorizationReviewInputsHash', 'ownerMapDigest',
      'policyBaselineDigest', 'transitionLedgerDigest',
    ]);
    nonEmpty(entry.backendPath, `G1 migration closure receipt.backends.${index}.backendPath`, code);
    nonEmpty(entry.authorizationReviewInputsHash,
      `G1 migration closure receipt.backends.${index}.authorizationReviewInputsHash`, code);
    for (const field of ['ownerMapDigest', 'policyBaselineDigest', 'transitionLedgerDigest']) {
      if (!SHA256.test(entry[field] ?? '')) {
        refuse(code, `G1 migration closure receipt.backends.${index}.${field} is not a digest`);
      }
    }
  }
  const sortedBackends = [...backends].sort((left, right) => compareText(left.backendPath, right.backendPath));
  if (new Set(backends.map(({ backendPath }) => backendPath)).size !== backends.length
    || canonicalGovernanceJson(sortedBackends) !== canonicalGovernanceJson(backends)) {
    refuse(code, 'G1 migration closure backend set must be unique and sorted');
  }
  const publicTables = exactArray(
    receipt.publicTables,
    'G1 migration closure receipt.publicTables',
    code,
  );
  for (const [index, entry] of publicTables.entries()) {
    exactKeys(entry, ['backendPath', 'tableId', 'policyDigest'],
      `G1 migration closure receipt.publicTables.${index}`, code,
      ['backendPath', 'tableId', 'policyDigest']);
    nonEmpty(entry.backendPath, `G1 migration closure receipt.publicTables.${index}.backendPath`, code);
    nonEmpty(entry.tableId, `G1 migration closure receipt.publicTables.${index}.tableId`, code);
    if (!SHA256.test(entry.policyDigest ?? '')) {
      refuse(code, `G1 migration closure receipt.publicTables.${index}.policyDigest is not a digest`);
    }
  }
  const publicKey = ({ backendPath, tableId }) => `${backendPath}\u0000${tableId}`;
  const sortedPublic = [...publicTables].sort((left, right) => compareText(publicKey(left), publicKey(right)));
  if (new Set(publicTables.map(publicKey)).size !== publicTables.length
    || canonicalGovernanceJson(sortedPublic) !== canonicalGovernanceJson(publicTables)) {
    refuse(code, 'G1 migration closure public-table set must be unique and sorted');
  }
  if (receipt.sourceRevisionDigest !== g1ClosureSourceRevisionDigest(receipt)
    || receipt.receiptDigest !== g1ClosureReceiptDigest(receipt)) {
    refuse(code, 'G1 migration closure receipt digest is stale or rebound');
  }
  return receipt;
}

function sourceDigestAtRevision(root, revision, path, domain) {
  const source = artifactAtRevision(root, revision, path);
  if (source === null) {
    refuse('SNAPBACK_TABLE_VISIBILITY_POLICY_PROVENANCE_INVALID',
      `G1 migration closure source ${path} is missing`);
  }
  return governanceDigest(domain, source);
}

function validateG1ClosureIntroduction({ root, revision, predecessorOid, backendPaths, receipt }) {
  const code = 'SNAPBACK_TABLE_VISIBILITY_POLICY_PROVENANCE_INVALID';
  validateG1ClosureReceiptShape(receipt);
  if (receipt.predecessorOid !== predecessorOid) {
    refuse(code, 'G1 migration closure receipt does not bind the governed predecessor');
  }
  const expectedPaths = [...new Set(backendPaths)].sort(compareText);
  if (canonicalGovernanceJson(receipt.backends.map(({ backendPath }) => backendPath))
    !== canonicalGovernanceJson(expectedPaths)) {
    refuse(code, 'G1 migration closure receipt does not cover the exact governed backend set');
  }
  const codegenSourceDigest = sourceDigestAtRevision(
    root,
    revision,
    G1_CODEGEN_SOURCE,
    'snapback:visibility-governance-g1-codegen-source:v1',
  );
  const completionTestSourceDigest = sourceDigestAtRevision(
    root,
    revision,
    G1_COMPLETION_TEST_SOURCE,
    'snapback:visibility-governance-g1-completion-test-source:v1',
  );
  if (receipt.codegenSourceDigest !== codegenSourceDigest
    || receipt.completionTestSourceDigest !== completionTestSourceDigest) {
    refuse(code, 'G1 migration closure receipt does not bind the enforcing code and completion test');
  }
  const actualBackends = [];
  const actualPublicTables = [];
  for (const backendPath of expectedPaths) {
    const policy = parseRevisionJson(root, revision,
      backendGovernancePath(backendPath, GOVERNANCE_FILES.policyBaseline));
    const ledger = parseRevisionJson(root, revision,
      backendGovernancePath(backendPath, GOVERNANCE_FILES.transitionLedger));
    const review = parseRevisionJson(root, revision,
      backendGovernancePath(backendPath, 'generated/authorization-review.json'));
    const ownerMapSource = parseRevisionJson(root, revision,
      backendGovernancePath(backendPath, GOVERNANCE_FILES.ownerMap));
    if (!policy || !ledger || !review || !ownerMapSource) {
      refuse(code, `G1 migration closure backend ${backendPath} lacks a required corpus artifact`);
    }
    validatePolicyLedgerAtRevision({ root, revision, backendPath, ledger, baseline: policy });
    const ownerMap = canonicalOwnerMap(ownerMapSource);
    if (ownerMap.fallbackApprovalOwner !== receipt.approvedBy) {
      refuse(code, `G1 migration closure backend ${backendPath} is not ruled by ${receipt.approvedBy}`);
    }
    if (!Array.isArray(review.tablePolicies)
      || review.tablePolicies.length !== policy.entries.length
      || review.tablePolicies.some(({ origin }) => origin !== 'declared')) {
      refuse(code, `G1 migration closure backend ${backendPath} is not corpus-closed`);
    }
    if (ledger.nodes.some((node) => (
      node.admissionKind !== 'g1-migration'
      || node.predecessorHeadId !== null
      || [node.approvalPath, node.approvalClosureDigest, node.serverSeparationReceipt,
        node.serverSeparationReceiptDigest, node.quarantineVerdict].some((value) => value !== null)
    ))) {
      refuse(code, `G1 migration closure backend ${backendPath} contains a non-root or authority-bearing migration node`);
    }
    actualBackends.push({
      backendPath,
      authorizationReviewInputsHash: review.inputsHash,
      ownerMapDigest: governanceDigest('snapback:visibility-owner-map:v1', ownerMap),
      policyBaselineDigest: policy.exactSetDigest,
      transitionLedgerDigest: ledger.ledgerDigest,
    });
    for (const entry of policy.entries) {
      if (entry.normalizedPolicyBody.policy.kind === 'public-read') {
        actualPublicTables.push({ backendPath, tableId: entry.tableId, policyDigest: entry.policyDigest });
      }
    }
  }
  actualPublicTables.sort((left, right) => compareText(
    `${left.backendPath}\u0000${left.tableId}`,
    `${right.backendPath}\u0000${right.tableId}`,
  ));
  if (canonicalGovernanceJson(receipt.backends) !== canonicalGovernanceJson(actualBackends)
    || canonicalGovernanceJson(receipt.publicTables) !== canonicalGovernanceJson(actualPublicTables)) {
    refuse(code, 'G1 migration closure receipt does not exactly bind the generated corpus');
  }
  return {
    backendPaths: new Set(actualBackends.map(({ backendPath }) => backendPath)),
    publicTables: new Set(actualPublicTables.map(({ backendPath, tableId }) => `${backendPath}\u0000${tableId}`)),
  };
}

function compareGovernanceBackend({ root, beforeOid, afterOid, backendPath, g1Introduction }) {
  const file = (key) => backendGovernancePath(backendPath, GOVERNANCE_FILES[key]);
  const beforeOwners = validateOwnerBaselineAtRevision({ root, revision: beforeOid, backendPath });
  const afterOwners = validateOwnerBaselineAtRevision({ root, revision: afterOid, backendPath });
  if (beforeOwners && afterOwners) {
    for (const entry of beforeOwners.entries) {
      const stillActive = afterOwners.entries.some((candidate) => (
        canonicalGovernanceJson(candidate) === canonicalGovernanceJson(entry)
      ));
      const retired = afterOwners.retiredDelegations.some((candidate) => (
        candidate.delegationClosureDigest === entry.delegationClosureDigest
      ));
      if (!stillActive && !retired) {
        refuse('SNAPBACK_TABLE_VISIBILITY_OVERRIDE_APPROVAL_INVALID',
          'owner-map update dropped delegated approval provenance instead of retiring it');
      }
    }
  }
  validateDelegationOrdering({ root, beforeOid, afterOid, backendPath });
  const beforeOverrideArtifact = parseRevisionJson(root, beforeOid, file('overrideBaseline'));
  const afterOverrideArtifact = parseRevisionJson(root, afterOid, file('overrideBaseline'));
  const beforeOverrides = beforeOverrideArtifact ?? { entries: [] };
  const afterOverrides = afterOverrideArtifact ?? { entries: [] };
  if (beforeOverrideArtifact) validateOverrideBaselineAtRevision({
    root,
    revision: beforeOid,
    backendPath,
    baseline: beforeOverrideArtifact,
  });
  if (afterOverrideArtifact) validateOverrideBaselineAtRevision({
    root,
    revision: afterOid,
    backendPath,
    baseline: afterOverrideArtifact,
  });
  const beforeById = new Map(beforeOverrides.entries.map((entry) => [entry.id, entry]));
  const growth = [];
  for (const entry of afterOverrides.entries) {
    const before = beforeById.get(entry.id);
    if (!before || !overrideIsNarrowerOrEqual(comparableOverride(before), comparableOverride(entry))) {
      growth.push(entry);
    }
  }
  for (const entry of growth) {
    const approvalPaths = approvalClosurePaths(
      root,
      afterOid,
      entry.approvalRecord,
      backendPath,
    );
    const receiptPath = backendGovernancePath(backendPath, entry.serverSeparationReceipt);
    requirePriorUnchangedClosure({
      root,
      beforeOid,
      afterOid,
      paths: [...approvalPaths, receiptPath],
      code: 'SNAPBACK_TABLE_VISIBILITY_OVERRIDE_SELF_APPROVAL',
      message: `override ${entry.id} consumes a closure that was not unchanged at the governed predecessor`,
      details: { overrideId: entry.id },
    });
  }
  const beforePolicyArtifact = parseRevisionJson(root, beforeOid, file('policyBaseline'));
  const afterPolicyArtifact = parseRevisionJson(root, afterOid, file('policyBaseline'));
  const beforeLedgerArtifact = parseRevisionJson(root, beforeOid, file('transitionLedger'));
  const afterLedgerArtifact = parseRevisionJson(root, afterOid, file('transitionLedger'));
  if ((beforePolicyArtifact === null) !== (beforeLedgerArtifact === null)
    || (afterPolicyArtifact === null) !== (afterLedgerArtifact === null)) {
    refuse('SNAPBACK_TABLE_VISIBILITY_POLICY_PROVENANCE_INVALID',
      'ordinary table-policy baseline and transition ledger must exist together');
  }
  const beforePolicy = beforePolicyArtifact ?? { entries: [] };
  const afterPolicy = afterPolicyArtifact ?? { entries: [] };
  if (beforePolicyArtifact) validatePolicyLedgerAtRevision({
    root,
    revision: beforeOid,
    backendPath,
    ledger: beforeLedgerArtifact,
    baseline: beforePolicyArtifact,
  });
  if (afterPolicyArtifact) validatePolicyLedgerAtRevision({
    root,
    revision: afterOid,
    backendPath,
    ledger: afterLedgerArtifact,
    baseline: afterPolicyArtifact,
  });
  const beforePolicies = new Map(beforePolicy.entries.map((entry) => [entry.tableId, entry]));
  const beforeLedger = beforeLedgerArtifact ?? { nodes: [] };
  const afterLedger = afterLedgerArtifact ?? { nodes: [] };
  const beforeNodes = new Map(beforeLedger.nodes.map((node) => [node.id, canonicalGovernanceJson(node)]));
  for (const node of beforeLedger.nodes) {
    const after = afterLedger.nodes.find(({ id }) => id === node.id);
    if (!after || canonicalGovernanceJson(after) !== beforeNodes.get(node.id)) {
      refuse('SNAPBACK_TABLE_VISIBILITY_POLICY_PROVENANCE_INVALID',
        `transition ledger removes or rebinds retained node ${node.id}`);
    }
  }
  const introducedMigrationNodes = afterLedger.nodes.filter((node) => (
    node.admissionKind === 'g1-migration' && !beforeNodes.has(node.id)
  ));
  if (introducedMigrationNodes.length > 0
    && !g1Introduction?.backendPaths.has(backendPath)) {
    refuse('SNAPBACK_TABLE_VISIBILITY_POLICY_PROVENANCE_INVALID',
      `backend ${backendPath} introduces G1 migration roots without the one-time closure receipt`);
  }
  const policyGrowth = [];
  for (const entry of afterPolicy.entries) {
    const before = beforePolicies.get(entry.tableId);
    if (!before) {
      if (entry.normalizedPolicyBody.policy.kind === 'public-read') policyGrowth.push(entry);
      continue;
    }
    if (compareVisibilityPolicies(before.normalizedPolicyBody, entry.normalizedPolicyBody) === 'growth') {
      policyGrowth.push(entry);
    }
  }
  for (const entry of policyGrowth) {
    const node = afterLedger.nodes.find(({ id }) => id === entry.provenanceHeadId);
    if (node?.admissionKind === 'g1-migration'
      && g1Introduction?.publicTables.has(`${backendPath}\u0000${entry.tableId}`)) {
      continue;
    }
    if (!node || node.admissionKind !== 'approved-transition'
      || node.successorPolicyDigest !== entry.policyDigest) {
      refuse('SNAPBACK_TABLE_VISIBILITY_POLICY_RATCHET_GROWTH',
        `table visibility policy adds or widens public authority: ${entry.tableId}`);
    }
    const approvalPaths = approvalClosurePaths(root, afterOid, node.approvalPath, backendPath);
    requirePriorUnchangedClosure({
      root,
      beforeOid,
      afterOid,
      paths: [
        ...approvalPaths,
        backendGovernancePath(backendPath, node.serverSeparationReceipt),
      ],
      code: 'SNAPBACK_TABLE_VISIBILITY_POLICY_RATCHET_GROWTH',
      message: `table ${entry.tableId} transition closure was not remotely prior`,
      details: { tableId: entry.tableId },
    });
  }
  const beforeQuarantineArtifact = parseRevisionJson(root, beforeOid, file('quarantineLedger'));
  const afterQuarantineArtifact = parseRevisionJson(root, afterOid, file('quarantineLedger'));
  const beforeQuarantine = beforeQuarantineArtifact ?? { records: [], retiredIds: [] };
  const afterQuarantine = afterQuarantineArtifact ?? { records: [], retiredIds: [] };
  if (beforeQuarantineArtifact) validateQuarantineLedgerAtRevision({
    root,
    revision: beforeOid,
    backendPath,
    ledger: beforeQuarantineArtifact,
  });
  if (afterQuarantineArtifact) validateQuarantineLedgerAtRevision({
    root,
    revision: afterOid,
    backendPath,
    ledger: afterQuarantineArtifact,
  });
  for (const [index, entry] of beforeQuarantine.records.entries()) {
    if (canonicalGovernanceJson(afterQuarantine.records[index]) !== canonicalGovernanceJson(entry)) {
      refuse('SNAPBACK_TABLE_VISIBILITY_POLICY_PROVENANCE_INVALID',
        `quarantine ledger deletes or rebinds record ${entry.quarantineId}`);
    }
  }
  if (!setSubset(afterQuarantine.retiredIds, beforeQuarantine.retiredIds)) {
    refuse('SNAPBACK_TABLE_VISIBILITY_POLICY_PROVENANCE_INVALID', 'quarantine retired-id set shrank');
  }
  return {
    backendPath,
    growth: growth.map(({ id }) => id),
    policyGrowth: policyGrowth.map(({ tableId }) => tableId),
  };
}

function governanceBackendPathsAtRevision(root, revision) {
  let paths;
  try {
    const { execFileSync } = requireNodeChildProcess();
    paths = execFileSync('git', ['ls-tree', '-r', '--name-only', revision], {
      cwd: root,
      encoding: 'utf8',
    }).split(/\r?\n/u);
  } catch {
    return [];
  }
  const suffix = `/${GOVERNANCE_FILES.overrideBaseline}`;
  return paths.flatMap((path) => {
    if (path === GOVERNANCE_FILES.overrideBaseline) return [''];
    return path.endsWith(suffix) ? [path.slice(0, -suffix.length)] : [];
  });
}

export function compareGovernanceSnapshots({ root, beforeOid, afterOid, backendPaths = [] }) {
  const paths = [...new Set([
    ...backendPaths,
    ...governanceBackendPathsAtRevision(root, beforeOid),
    ...governanceBackendPathsAtRevision(root, afterOid),
  ])].sort(compareText);
  const beforeG1Closure = parseRevisionJson(root, beforeOid, GOVERNANCE_FILES.g1Closure);
  const afterG1Closure = parseRevisionJson(root, afterOid, GOVERNANCE_FILES.g1Closure);
  let g1Introduction = null;
  if (beforeG1Closure === null && afterG1Closure !== null) {
    g1Introduction = validateG1ClosureIntroduction({
      root,
      revision: afterOid,
      predecessorOid: beforeOid,
      backendPaths: paths,
      receipt: afterG1Closure,
    });
  } else if (beforeG1Closure !== null) {
    validateG1ClosureReceiptShape(beforeG1Closure);
    if (afterG1Closure === null
      || canonicalGovernanceJson(beforeG1Closure) !== canonicalGovernanceJson(afterG1Closure)) {
      refuse('SNAPBACK_TABLE_VISIBILITY_POLICY_PROVENANCE_INVALID',
        'the one-time G1 migration closure receipt was removed or rebound');
    }
  }
  const comparisons = paths.map((backendPath) => compareGovernanceBackend({
    root,
    beforeOid,
    afterOid,
    backendPath,
    g1Introduction,
  }));
  return {
    growth: comparisons.flatMap(({ growth }) => growth),
    policyGrowth: comparisons.flatMap(({ policyGrowth }) => policyGrowth),
    backends: comparisons,
  };
}

export function isGovernedRef(ref, governedRefs = GOVERNED_REFS_DEFAULT) {
  return governedRefs.includes(ref);
}

export function validateGovernedPushEnvelope({
  commands,
  governedRefs = GOVERNED_REFS_DEFAULT,
  providerProfile,
  anchorWitness = null,
  verifyAnchorWitness = null,
  eventId = null,
}) {
  const governed = commands.filter(({ ref }) => isGovernedRef(ref, governedRefs));
  if (providerProfile === 'github-push-v1') {
    const creations = governed.filter(({ beforeOid, afterOid }) => (
      beforeOid === ZERO_OID && afterOid !== ZERO_OID
    ));
    if (creations.length > 0) {
      if (commands.length !== 1 || creations.length !== 1 || creations[0].creationService !== 'protected-single-ref') {
        refuse('SNAPBACK_TABLE_VISIBILITY_GOVERNANCE_PUSH_VIOLATION',
          'new governed refs require the protected single-ref creation service');
      }
      if (!anchorWitness || anchorWitness.anchorOid !== creations[0].mergeBaseOid
        || !OID.test(anchorWitness.anchorOid ?? '')
        || typeof verifyAnchorWitness !== 'function'
        || verifyAnchorWitness(anchorWitness, creations[0]) !== true) {
        refuse('SNAPBACK_TABLE_VISIBILITY_GOVERNANCE_PUSH_VIOLATION',
          'new governed ref lacks a current notarized anchor and merge base');
      }
    }
    if (governed.length > 1) {
      refuse('SNAPBACK_TABLE_VISIBILITY_GOVERNANCE_PUSH_VIOLATION',
        'GitHub push events do not provide a verified atomic multi-ref envelope');
    }
  } else if (providerProfile === 'atomic-push-envelope-v1') {
    if (!eventId || commands.some(({ beforeOid, afterOid }) => !OID.test(beforeOid) || !OID.test(afterOid))) {
      refuse('SNAPBACK_TABLE_VISIBILITY_GOVERNANCE_PUSH_VIOLATION', 'atomic push envelope is unauthenticated or incomplete');
    }
  } else {
    refuse('SNAPBACK_TABLE_VISIBILITY_GOVERNANCE_REMOTE_CUSTODY_UNAVAILABLE',
      'no supported protected observer provider profile is configured');
  }
  return governed;
}

export function deploymentIdentityFromGenerated({ schemaManifest, functionManifest, governance }) {
  return {
    schemaHash: schemaManifest.schemaHash,
    functionBundleHash: functionManifest.bundleHash,
    generationInputsHash: governance.generationInputsHash,
    visibilityAuthorizationProgramDigest: governance.visibilityAuthorizationProgramDigest,
    visibilityGovernanceActivationDigest: governanceDigest(
      'snapback:visibility-governance-activation-carrier:v1',
      governance,
    ),
  };
}

export function deepMatchGovernedVerdict(verdict, expected, { sourceOid, quarantineHeadDigest }) {
  if (!verdict) {
    refuse('SNAPBACK_TABLE_VISIBILITY_GOVERNANCE_REMOTE_CUSTODY_UNAVAILABLE',
      'visibility governance has no protected observer verdict');
  }
  if (verdict.schemaVersion !== GOVERNANCE_SCHEMA_VERSIONS.governedUpdateVerdict
    || verdict.disposition !== 'green' || verdict.afterOid !== sourceOid
    || verdict.quarantineHeadDigest !== quarantineHeadDigest) {
    refuse('SNAPBACK_TABLE_VISIBILITY_GOVERNANCE_PUSH_VIOLATION',
      'visibility governance verdict is red, stale, rolled back, or quarantined');
  }
  const candidates = Array.isArray(verdict.deploymentIdentities)
    ? verdict.deploymentIdentities
    : verdict.deploymentIdentity ? [verdict.deploymentIdentity] : [];
  const selected = candidates.find((candidate) => (
    (expected.backend === undefined || candidate.backend === expected.backend)
    && (expected.appId === undefined || candidate.appId === expected.appId)
  ));
  const identityFields = [
    'schemaHash',
    'functionBundleHash',
    'generationInputsHash',
    'visibilityAuthorizationProgramDigest',
    'visibilityGovernanceActivationDigest',
  ];
  const observed = selected === undefined ? null : Object.fromEntries(
    identityFields.map((field) => [field, selected[field]]),
  );
  const required = Object.fromEntries(identityFields.map((field) => [field, expected[field]]));
  if (canonicalGovernanceJson(observed) !== canonicalGovernanceJson(required)) {
    refuse('SNAPBACK_TABLE_VISIBILITY_GOVERNANCE_DEPLOYMENT_IDENTITY_MISMATCH',
      'staged authorization artifacts do not deep-match the protected verdict deployment identity',
      { expected: required, observed });
  }
  return true;
}

export function relativeGovernancePath(root, path) {
  return relative(root, path).split(sep).join('/');
}
