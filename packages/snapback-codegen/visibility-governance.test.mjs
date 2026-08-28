import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import {
  generateKeyPairSync,
  sign as signBytes,
} from 'node:crypto';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import test from 'node:test';

import Ajv2020 from 'ajv/dist/2020.js';

import { generate } from './index.mjs';

import {
  GOVERNANCE_FILES,
  GOVERNANCE_SCHEMA_VERSIONS,
  canonicalGovernanceJson,
  canonicalOverrideDeclaration,
  canonicalOwnerMap,
  compareGovernanceSnapshots,
  currentTablePolicyBaseline,
  deepMatchGovernedVerdict,
  exactSetBaseline,
  g1ClosureReceiptDigest,
  g1ClosureSourceRevisionDigest,
  governanceDigest,
  installGovernanceNodeChildProcess,
  normalizePolicyBody,
  overrideScopeDigest,
  patternApprovalScopeDigest,
  transitionApprovalScopeDigest,
  transitionLedgerDigest,
  transitionNodeDigest,
  validateGovernedPushEnvelope,
  validateProductionOverrideTime,
  validateVisibilityGovernance,
  visibilityOverrideBaselineEntry,
} from './visibility-governance.mjs';
import { deriveWritePosture } from './write-policy.mjs';
import {
  runMissingEventReconciler,
  runPrePushAdmission,
  runProtectedObserver,
} from '../../scripts/check-visibility-governance.mjs';

installGovernanceNodeChildProcess({ execFileSync });

const packageRoot = dirname(fileURLToPath(import.meta.url));
const defineUrl = pathToFileURL(join(packageRoot, 'define.mjs')).href;
const tables = {
  records: {
    visibility: { kind: 'owner', field: 'ownerId' },
    fields: [{ name: 'ownerId', fieldType: { String: {} } }],
  },
};

test('ordinary-policy governance admits the shipped self-resource _id field', () => {
  const membershipTables = {
    rooms: {
      visibility: {
        kind: 'membership',
        declaration: 'room-members',
        resourceField: '_id',
        roles: ['member'],
      },
      fields: [],
    },
    roomMembers: {
      membership: {
        id: 'room-members',
        principal: 'userId',
        resource: 'roomId',
        resourceTable: 'rooms',
        role: 'role',
        roles: ['member'],
      },
      fields: [],
    },
  };
  assert.equal(
    normalizePolicyBody(membershipTables.rooms.visibility, membershipTables)
      .policy.resourceField,
    '_id',
  );
});

function writeJson(root, path, value) {
  const target = join(root, path);
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, `${canonicalGovernanceJson(value)}\n`);
}

function ownerArtifacts(root, entries = []) {
  const ownerMap = canonicalOwnerMap({
    schemaVersion: GOVERNANCE_SCHEMA_VERSIONS.ownerMap,
    fallbackApprovalOwner: 'project-author',
    entries,
  });
  const baselineEntries = ownerMap.entries.map((entry) => ({
    ...entry,
    delegationClosureDigest: governanceDigest(
      'snapback:visibility-owner-delegation-closure:v1',
      { authorRuling: entry.authorRuling, delegationRecord: entry.delegationRecord },
    ),
  }));
  const ownerBaseline = {
    schemaVersion: GOVERNANCE_SCHEMA_VERSIONS.ownerBaseline,
    entries: baselineEntries,
    retiredDelegations: [],
    exactSetDigest: governanceDigest(
      'snapback:visibility-override-owner-baseline:v1:exact-set',
      { entries: baselineEntries, retiredDelegations: [] },
    ),
  };
  writeJson(root, GOVERNANCE_FILES.ownerMap, ownerMap);
  writeJson(root, GOVERNANCE_FILES.ownerBaseline, ownerBaseline);
  return { ownerMap, ownerBaseline };
}

function policyArtifacts(root) {
  const successorNormalizedPolicyBody = normalizePolicyBody(
    tables.records.visibility,
    tables,
    deriveWritePosture('records', tables.records),
  );
  const node = {
    schemaVersion: GOVERNANCE_SCHEMA_VERSIONS.transitionRecord,
    id: 'records-root-v1',
    tableId: 'records',
    predecessorHeadId: null,
    predecessorHeadDigest: null,
    predecessorNormalizedPolicyBody: null,
    predecessorPolicyDigest: null,
    successorNormalizedPolicyBody,
    successorPolicyDigest: governanceDigest(
      'snapback:table-visibility-policy-body:v2',
      successorNormalizedPolicyBody,
    ),
    admissionKind: 'new-restricted',
    approvalPath: null,
    approvalClosureDigest: null,
    serverSeparationReceipt: null,
    serverSeparationReceiptDigest: null,
    quarantineVerdict: null,
  };
  const transitionLedger = {
    schemaVersion: GOVERNANCE_SCHEMA_VERSIONS.transitionLedger,
    nodes: [node],
    heads: { records: node.id },
    ledgerDigest: transitionLedgerDigest([node], { records: node.id }),
  };
  writeJson(root, GOVERNANCE_FILES.transitionLedger, transitionLedger);
  writeJson(root, GOVERNANCE_FILES.policyBaseline,
    currentTablePolicyBaseline(tables, transitionLedger));
  writeJson(root, GOVERNANCE_FILES.quarantineLedger, {
    schemaVersion: GOVERNANCE_SCHEMA_VERSIONS.quarantineLedger,
    records: [],
    retiredIds: [],
    headDigest: governanceDigest('snapback:visibility-quarantine-head:v1', []),
  });
  return transitionLedger;
}

// Frozen from origin/main:demos/todo/snapback/generated/* at 7c3669081.
// Keeping the committed digests here makes the predecessor-version test use a
// real G1 corpus shape rather than a helper regenerated under current code.
const REAL_TODO_V1_POLICY_BASELINE = Object.freeze({
  entries: [{
    normalizedPolicyBody: {
      audienceDeclarationClosure: [],
      audienceDeclarationClosureDigest:
        'sha256:a353a1e98819f5e861505c01a0a67e49699b43901106e79e5617d3165f6553d3',
      policy: { field: 'userId', kind: 'owner' },
    },
    policyDigest: 'sha256:a6318806aa090a5cb645e0afd23bb42c16e11f3b7cc98f7967d18c7b6a0b5b9d',
    provenanceHeadId: 'todos-g1-20260816-v1',
    tableId: 'todos',
  }],
  exactSetDigest: 'sha256:90a541457d056464c40c19c3c27bfe0cec46b0cd3feba5aeea7a9e807e4c7362',
  schemaVersion: 'snapback.table-visibility-policy-baseline.v1',
});

const REAL_TODO_V1_TRANSITION_LEDGER = Object.freeze({
  heads: { todos: 'todos-g1-20260816-v1' },
  ledgerDigest: 'sha256:8eb97a7c6f67b5a9894548211f687ef3eedf881275a91c633ff0b26996a2dd61',
  nodes: [{
    admissionKind: 'g1-migration',
    approvalClosureDigest: null,
    approvalPath: null,
    id: 'todos-g1-20260816-v1',
    predecessorHeadDigest: null,
    predecessorHeadId: null,
    predecessorNormalizedPolicyBody: null,
    predecessorPolicyDigest: null,
    quarantineVerdict: null,
    schemaVersion: 'snapback.table-visibility-policy-transition.v1',
    serverSeparationReceipt: null,
    serverSeparationReceiptDigest: null,
    successorNormalizedPolicyBody: {
      audienceDeclarationClosure: [],
      audienceDeclarationClosureDigest:
        'sha256:a353a1e98819f5e861505c01a0a67e49699b43901106e79e5617d3165f6553d3',
      policy: { field: 'userId', kind: 'owner' },
    },
    successorPolicyDigest:
      'sha256:a6318806aa090a5cb645e0afd23bb42c16e11f3b7cc98f7967d18c7b6a0b5b9d',
    tableId: 'todos',
  }],
  schemaVersion: 'snapback.table-visibility-policy-transition-ledger.v1',
});

function realTodoV2PolicyArtifacts(writePosture = undefined) {
  const table = {
    visibility: { kind: 'owner', field: 'userId' },
    fields: [],
  };
  const normalizedPolicyBody = normalizePolicyBody(
    table.visibility,
    { todos: table },
    writePosture ?? deriveWritePosture('todos', table),
  );
  const node = {
    ...structuredClone(REAL_TODO_V1_TRANSITION_LEDGER.nodes[0]),
    schemaVersion: GOVERNANCE_SCHEMA_VERSIONS.transitionRecord,
    successorNormalizedPolicyBody: normalizedPolicyBody,
    successorPolicyDigest: governanceDigest(
      'snapback:table-visibility-policy-body:v2',
      normalizedPolicyBody,
    ),
  };
  const ledger = {
    schemaVersion: GOVERNANCE_SCHEMA_VERSIONS.transitionLedger,
    nodes: [node],
    heads: structuredClone(REAL_TODO_V1_TRANSITION_LEDGER.heads),
    ledgerDigest: transitionLedgerDigest(
      [node],
      REAL_TODO_V1_TRANSITION_LEDGER.heads,
    ),
  };
  const baseline = exactSetBaseline([{
    tableId: 'todos',
    normalizedPolicyBody,
    policyDigest: node.successorPolicyDigest,
    provenanceHeadId: node.id,
  }], GOVERNANCE_SCHEMA_VERSIONS.policyBaseline);
  return { baseline, ledger };
}

function installRealTodoGovernanceFixture(root) {
  const backendPath = 'demos/todo/snapback';
  const backendRoot = join(root, backendPath);
  ownerArtifacts(backendRoot);
  writeJson(backendRoot, GOVERNANCE_FILES.overrideBaseline,
    exactSetBaseline([], GOVERNANCE_SCHEMA_VERSIONS.overrideBaseline));
  writeJson(backendRoot, GOVERNANCE_FILES.quarantineLedger, {
    schemaVersion: GOVERNANCE_SCHEMA_VERSIONS.quarantineLedger,
    records: [],
    retiredIds: [],
    headDigest: governanceDigest('snapback:visibility-quarantine-head:v1', []),
  });
  writeJson(backendRoot, 'generated/normalized-definition.v1.json', {
    definition: {
      application: {
        schema: {
          tables: [{
            name: 'todos',
            visibility: { field: 'userId', kind: 'owner' },
          }],
        },
      },
      operations: [],
    },
  });
  writeJson(backendRoot, 'generated/authorization-review.json', {
    writePolicyChecks: [],
  });
  writeJson(backendRoot, GOVERNANCE_FILES.policyBaseline,
    REAL_TODO_V1_POLICY_BASELINE);
  writeJson(backendRoot, GOVERNANCE_FILES.transitionLedger,
    REAL_TODO_V1_TRANSITION_LEDGER);
  return { backendPath, backendRoot };
}

function initializeRealTodoGovernanceHistory(root) {
  git(root, 'init', '-q');
  git(root, 'branch', '-M', 'main');
  const fixture = installRealTodoGovernanceFixture(root);
  return { ...fixture, beforeOid: commitAll(root, 'real todo v1 predecessor') };
}

function writePolicyArtifacts(root, { baseline, ledger }) {
  writeJson(root, GOVERNANCE_FILES.policyBaseline, baseline);
  writeJson(root, GOVERNANCE_FILES.transitionLedger, ledger);
}

function fixtureDeclaration() {
  const profile = {
    schemaVersion: GOVERNANCE_SCHEMA_VERSIONS.fixtureProfile,
    id: 'repository-synthetic-v1',
    targetClassCeiling: 'repository-local',
    principalClass: 'synthetic',
    dataClassification: 'fixture-owned',
  };
  profile.digest = governanceDigest('snapback:visibility-fixture-profile:v1', profile);
  return {
    schemaVersion: GOVERNANCE_SCHEMA_VERSIONS.overrideDeclaration,
    id: 'system-record-census-v1',
    owner: 'fixture-owner',
    authority: { mode: 'system', entrypoint: 'census', calls: [] },
    reads: { records: { allRows: true } },
    operations: ['census'],
    justification: 'Exercise system-mode visibility without production authority.',
    lifecycleClass: 'fixture',
    fixtureProfile: profile,
    approval: 'visibility-override-approvals/system-record-census-v1.json',
    approvalSeparationReceipt: 'visibility-override-receipts/system-record-census-v1.json',
    acceptance: {
      id: 'system-record-census-acceptance-v1',
      path: 'tests/visibility-governance/system-record-census.json',
      resultDigest: governanceDigest('snapback:visibility-acceptance-result:v1', { passed: true }),
    },
  };
}

function completeFixture(root) {
  const { ownerMap } = ownerArtifacts(root);
  policyArtifacts(root);
  const declaration = fixtureDeclaration();
  const canonical = canonicalOverrideDeclaration(declaration, tables).canonical;
  const scopeDigest = overrideScopeDigest(canonical);
  const approval = {
    schemaVersion: GOVERNANCE_SCHEMA_VERSIONS.approvalRecord,
    scopeDigestVersion: 'snapback.visibility-scope.v1',
    digestAlgorithm: 'sha256',
    approvalKind: 'custom',
    id: canonical.id,
    scopeDigest,
    lifecycleClass: 'fixture',
    fixtureProfileId: canonical.fixtureProfile.id,
    fixtureProfileDigest: canonical.fixtureProfile.digest,
    fixtureTargetClassCeiling: canonical.fixtureProfile.targetClassCeiling,
    fixturePrincipalClass: canonical.fixtureProfile.principalClass,
    fixtureDataClassification: canonical.fixtureProfile.dataClassification,
    requestedBy: 'fixture-owner',
    approvedBy: 'project-author',
    ownerMapDigest: governanceDigest('snapback:visibility-owner-map:v1', ownerMap),
    issuedOn: '2026-08-15T18:00:00Z',
    justificationDigest: canonical.justificationDigest,
    acceptanceId: canonical.acceptance.id,
    acceptancePath: canonical.acceptance.path,
    reviewArtifact: null,
    reviewRecord: null,
    approvalRuling: null,
    rulingRecord: null,
    delegationRuling: null,
    delegationRecord: null,
  };
  writeJson(root, declaration.approval, approval);
  const approvalClosureDigest = governanceDigest(
    'snapback:visibility-approval-closure:v1',
    { approval, ownerMap },
  );
  const { privateKey, publicKey } = generateKeyPairSync('ed25519');
  const publicKeyPem = publicKey.export({ type: 'spki', format: 'pem' });
  const observerKeyDigest = governanceDigest('snapback:visibility-observer-key:v1', publicKeyPem);
  writeJson(root, GOVERNANCE_FILES.observerKeys, {
    schemaVersion: GOVERNANCE_SCHEMA_VERSIONS.observerKeys,
    activeEpoch: 'fixture-epoch-1',
    keys: [{
      epoch: 'fixture-epoch-1',
      keyDigest: observerKeyDigest,
      publicKeyPem,
      revoked: false,
    }],
  });
  const receiptPayload = {
    schemaVersion: GOVERNANCE_SCHEMA_VERSIONS.separationReceipt,
    providerProfile: 'github-push-v1',
    eventId: 'fixture-event-1',
    governedRef: 'refs/heads/main',
    eventInputDigest: governanceDigest('snapback:visibility-governance-event-input:v1', { fixture: 1 }),
    beforeOid: '1'.repeat(40),
    afterOid: '2'.repeat(40),
    observedAt: '2026-08-15T18:05:00Z',
    approvalKind: 'custom',
    approvalId: approval.id,
    scopeDigest,
    approvalClosureDigest,
    predecessorOwnerMapDigest: approval.ownerMapDigest,
    comparatorVersion: 'snapback.visibility-governance-comparator.v1',
    approvalOnly: true,
    observerKeyEpoch: 'fixture-epoch-1',
    observerKeyDigest,
  };
  const receipt = {
    ...receiptPayload,
    signature: signBytes(
      null,
      Buffer.from(canonicalGovernanceJson(receiptPayload)),
      privateKey,
    ).toString('base64'),
  };
  writeJson(root, declaration.approvalSeparationReceipt, receipt);
  const entry = visibilityOverrideBaselineEntry({
    declaration: canonical,
    scopeDigest,
    approvalPath: declaration.approval,
    separationReceiptPath: declaration.approvalSeparationReceipt,
    approvalClosureDigest,
    receiptDigest: governanceDigest('snapback:visibility-separation-receipt:v1', receipt),
  });
  writeJson(root, GOVERNANCE_FILES.overrideBaseline,
    exactSetBaseline([entry], GOVERNANCE_SCHEMA_VERSIONS.overrideBaseline));
  return { declaration, canonical, approval, receipt, privateKey };
}

function installQuarantine(root, privateKey, governedRecordId = 'retired-override-v1') {
  const registry = JSON.parse(readFileSync(join(root, GOVERNANCE_FILES.observerKeys), 'utf8'));
  const predecessorHead = governanceDigest('snapback:visibility-quarantine-head:v1', []);
  const quarantineId = 'quarantine-event-v1';
  const payload = {
    schemaVersion: GOVERNANCE_SCHEMA_VERSIONS.quarantineVerdict,
    quarantineId,
    governedRecordId,
    authorityKind: 'visibility-override',
    governedRef: 'refs/heads/main',
    beforeOid: '3'.repeat(40),
    afterOid: '4'.repeat(40),
    eventId: 'quarantine-event-v1',
    externalVerdictDigest: governanceDigest('snapback:visibility-governance-red-verdict:v1', { red: true }),
    offendingLedgerHead: null,
    violationSignature: governanceDigest('snapback:visibility-governance-violation:v1', { governedRecordId }),
    predecessorQuarantineHead: predecessorHead,
    successorExactSetDigest: governanceDigest(
      'snapback:visibility-quarantine-successor-exact-set:v1',
      { predecessorHead, quarantineId, governedRecordId },
    ),
    observedAt: '2026-08-15T19:00:00Z',
    observerKeyEpoch: registry.activeEpoch,
    observerKeyDigest: registry.keys[0].keyDigest,
  };
  const verdict = {
    ...payload,
    signature: signBytes(
      null,
      Buffer.from(canonicalGovernanceJson(payload)),
      privateKey,
    ).toString('base64'),
  };
  const path = `visibility-governance-quarantine/${quarantineId}.json`;
  writeJson(root, path, verdict);
  const digest = governanceDigest('snapback:visibility-quarantine-verdict:v1', verdict);
  const record = { quarantineId, governedRecordId, path, digest };
  writeJson(root, GOVERNANCE_FILES.quarantineLedger, {
    schemaVersion: GOVERNANCE_SCHEMA_VERSIONS.quarantineLedger,
    records: [record],
    retiredIds: [governedRecordId, quarantineId].sort(),
    headDigest: governanceDigest('snapback:visibility-quarantine-head:v1', {
      predecessorHead,
      quarantineId,
      governedRecordId,
      digest,
    }),
  });
  return { path, verdict };
}

test('every G0 governance schema compiles under draft 2020-12', () => {
  const ajv = new Ajv2020({
    allErrors: true,
    strict: false,
    allowUnionTypes: true,
    validateFormats: false,
  });
  const files = readdirSync(packageRoot).filter((name) => (
    (name.startsWith('visibility-') || name.startsWith('table-visibility-'))
    && name.endsWith('.schema.json')
  ));
  assert.equal(files.length, 17);
  const schemas = files.map((file) => JSON.parse(readFileSync(join(packageRoot, file))));
  for (const schema of schemas) ajv.addSchema(schema);
  for (const schema of schemas) assert.equal(typeof ajv.getSchema(schema.$id), 'function');
});

test('exported-tree validation refuses missing approval then missing signed receipt with exact codes', () => {
  const root = mkdtempSync(join(tmpdir(), 'snapback-visibility-governance-'));
  try {
    ownerArtifacts(root);
    policyArtifacts(root);
    const declaration = fixtureDeclaration();
    assert.throws(
      () => validateVisibilityGovernance({ root, backendRoot: root, schemaDef: { visibilityOverrides: [declaration] }, tables }),
      ({ code }) => code === 'SNAPBACK_TABLE_VISIBILITY_OVERRIDE_UNAPPROVED',
    );
    const full = completeFixture(root);
    rmSync(join(root, full.declaration.approvalSeparationReceipt));
    assert.throws(
      () => validateVisibilityGovernance({ backendRoot: root, schemaDef: { visibilityOverrides: [full.declaration] }, tables }),
      ({ code }) => code === 'SNAPBACK_TABLE_VISIBILITY_OVERRIDE_REMOTE_SEPARATION_REQUIRED',
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('complete fixture closure validates without Git and produces severable facts', () => {
  const root = mkdtempSync(join(tmpdir(), 'snapback-visibility-governance-'));
  try {
    const full = completeFixture(root);
    const result = validateVisibilityGovernance({
      backendRoot: root,
      schemaDef: { visibilityOverrides: [full.declaration] },
      tables,
      now: Date.parse('2030-01-01T00:00:00Z'),
    });
    assert.equal(result.visibilityOverrides.length, 1);
    assert.equal(result.visibilityOverrides[0].authority.mode, 'system');
    assert.equal(result.activation.fixtureProfiles[0].principalClass, 'synthetic');
    assert.match(result.generationInputsHash, /^sha256:[0-9a-f]{64}$/u);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('system, principal, and captured-grant fixture authorities have distinct closed scopes', () => {
  const membershipTables = {
    ...tables,
    organizationMemberships: {
      membership: {
        id: 'organization-membership',
        principal: 'userId',
        resource: 'organizationId',
        resourceTable: 'organizations',
        role: 'role',
        roles: ['member', 'moderator'],
      },
      fields: [],
    },
  };
  const system = canonicalOverrideDeclaration(fixtureDeclaration(), membershipTables).canonical;
  const principal = canonicalOverrideDeclaration({
    ...fixtureDeclaration(),
    id: 'principal-record-moderation-v1',
    authority: {
      mode: 'principal',
      operations: ['moderateRecords'],
      admissionPolicy: {
        kind: 'membership',
        declaration: 'organization-membership',
        resourceField: 'organizationId',
        roles: ['moderator'],
      },
    },
    operations: ['moderateRecords'],
  }, membershipTables).canonical;
  const capturedGrant = canonicalOverrideDeclaration({
    ...fixtureDeclaration(),
    id: 'captured-record-export-v1',
    authority: {
      mode: 'capturedGrant',
      issuanceProfile: 'fixture-export-grant-v1',
      operations: ['exportRecords'],
      maximumTtlMs: 60_000,
    },
    operations: ['exportRecords'],
  }, membershipTables).canonical;
  assert.deepEqual(
    principal.authority.admissionMembershipAudienceClosure,
    [{
      id: 'organization-membership',
      membershipTable: 'organizationMemberships',
      resourceTable: 'organizations',
      principalField: 'userId',
      resourceField: 'organizationId',
      roleField: 'role',
      policyResourceField: 'organizationId',
      roles: ['moderator'],
    }],
  );
  assert.equal(capturedGrant.authority.maximumTtlMs, 60_000);
  assert.equal(new Set([system, principal, capturedGrant].map(overrideScopeDigest)).size, 3);
  assert.throws(
    () => canonicalOverrideDeclaration({
      ...fixtureDeclaration(),
      patternDerivation: { patternId: 'fabricated-pattern-v1' },
    }, membershipTables),
    ({ code }) => code === 'SNAPBACK_TABLE_VISIBILITY_OVERRIDE_APPROVAL_INVALID',
  );
  assert.throws(
    () => canonicalOverrideDeclaration({
      ...fixtureDeclaration(),
      rekey: { predecessorDigest: 'sha256:'.padEnd(71, '0') },
    }, membershipTables),
    (error) => error.code === 'SNAPBACK_TABLE_VISIBILITY_OVERRIDE_APPROVAL_INVALID'
      && /author ruling/u.test(error.message),
  );
});

test('a closed fixture pattern admits only content-bound structural subsets', () => {
  const root = mkdtempSync(join(tmpdir(), 'snapback-visibility-pattern-'));
  try {
    const full = completeFixture(root);
    const ownerMap = JSON.parse(readFileSync(join(root, GOVERNANCE_FILES.ownerMap), 'utf8'));
    const base = fixtureDeclaration();
    const ceilingSource = {
      authority: base.authority,
      reads: base.reads,
      operations: base.operations,
      lifecycleClass: base.lifecycleClass,
      fixtureProfile: base.fixtureProfile,
    };
    const baseCanonical = canonicalOverrideDeclaration(base, tables).canonical;
    const canonicalCeiling = {
      authority: baseCanonical.authority,
      reads: baseCanonical.reads,
      operations: baseCanonical.operations,
      lifecycleClass: baseCanonical.lifecycleClass,
      fixtureProfile: baseCanonical.fixtureProfile,
    };
    const constructorDigest = governanceDigest(
      'snapback:visibility-pattern-constructor:v1',
      canonicalCeiling,
    );
    const declaration = {
      ...base,
      id: 'pattern-record-census-instance-v1',
      reads: {
        records: { field: 'ownerId', op: 'Eq', value: { arg: 'ownerId' } },
      },
      approval: 'visibility-override-approvals/system-census-pattern-v1.json',
      approvalSeparationReceipt:
        'visibility-override-receipts/system-census-pattern-v1.json',
      patternDerivation: {
        patternId: 'system-census-pattern-v1',
        constructorVersion: 'v1',
        constructorDigest,
        derivationDigest: `sha256:${'0'.repeat(64)}`,
      },
    };
    let parsed = canonicalOverrideDeclaration(declaration, tables);
    const instanceScopeDigest = overrideScopeDigest(parsed.canonical);
    const approval = {
      schemaVersion: GOVERNANCE_SCHEMA_VERSIONS.approvalRecord,
      scopeDigestVersion: 'snapback.visibility-scope.v1',
      digestAlgorithm: 'sha256',
      approvalKind: 'pattern',
      id: declaration.patternDerivation.patternId,
      scopeDigest: `sha256:${'0'.repeat(64)}`,
      patternId: declaration.patternDerivation.patternId,
      constructorVersion: declaration.patternDerivation.constructorVersion,
      constructorDigest,
      patternCeiling: ceilingSource,
      lifecycleClass: 'fixture',
      fixtureProfileId: base.fixtureProfile.id,
      fixtureProfileDigest: base.fixtureProfile.digest,
      fixtureTargetClassCeiling: base.fixtureProfile.targetClassCeiling,
      fixturePrincipalClass: base.fixtureProfile.principalClass,
      fixtureDataClassification: base.fixtureProfile.dataClassification,
      requestedBy: 'fixture-owner',
      approvedBy: 'project-author',
      ownerMapDigest: governanceDigest('snapback:visibility-owner-map:v1', ownerMap),
      issuedOn: '2026-08-15T18:00:00Z',
      justificationDigest: governanceDigest(
        'snapback:visibility-pattern-justification:v1',
        'Bounded synthetic census pattern.',
      ),
      acceptanceId: 'system-census-pattern-acceptance-v1',
      acceptancePath: 'tests/visibility-governance/system-census-pattern.json',
      reviewArtifact: null,
      reviewRecord: null,
      approvalRuling: null,
      rulingRecord: null,
      delegationRuling: null,
      delegationRecord: null,
    };
    approval.scopeDigest = patternApprovalScopeDigest(approval, canonicalCeiling);
    declaration.patternDerivation.derivationDigest = governanceDigest(
      'snapback:visibility-pattern-derivation:v1',
      {
        instanceId: declaration.id,
        instanceScopeDigest,
        patternApprovalScopeDigest: approval.scopeDigest,
        patternId: declaration.patternDerivation.patternId,
        constructorVersion: declaration.patternDerivation.constructorVersion,
        constructorDigest,
      },
    );
    parsed = canonicalOverrideDeclaration(declaration, tables);
    assert.equal(overrideScopeDigest(parsed.canonical), instanceScopeDigest);
    writeJson(root, declaration.approval, approval);
    const approvalClosureDigest = governanceDigest(
      'snapback:visibility-approval-closure:v1',
      { approval, ownerMap },
    );
    const registry = JSON.parse(readFileSync(join(root, GOVERNANCE_FILES.observerKeys), 'utf8'));
    const receiptPayload = {
      schemaVersion: GOVERNANCE_SCHEMA_VERSIONS.separationReceipt,
      providerProfile: 'github-push-v1',
      eventId: 'pattern-approval-event-v1',
      governedRef: 'refs/heads/main',
      eventInputDigest: governanceDigest(
        'snapback:visibility-governance-event-input:v1',
        { fixture: 'pattern' },
      ),
      beforeOid: '7'.repeat(40),
      afterOid: '8'.repeat(40),
      observedAt: '2026-08-15T18:05:00Z',
      approvalKind: 'pattern',
      approvalId: approval.id,
      scopeDigest: approval.scopeDigest,
      approvalClosureDigest,
      predecessorOwnerMapDigest: approval.ownerMapDigest,
      comparatorVersion: 'snapback.visibility-governance-comparator.v1',
      approvalOnly: true,
      observerKeyEpoch: registry.activeEpoch,
      observerKeyDigest: registry.keys[0].keyDigest,
    };
    const receipt = {
      ...receiptPayload,
      signature: signBytes(
        null,
        Buffer.from(canonicalGovernanceJson(receiptPayload)),
        full.privateKey,
      ).toString('base64'),
    };
    writeJson(root, declaration.approvalSeparationReceipt, receipt);
    writeJson(root, GOVERNANCE_FILES.overrideBaseline, exactSetBaseline([
      visibilityOverrideBaselineEntry({
        declaration: parsed.canonical,
        scopeDigest: instanceScopeDigest,
        approvalPath: declaration.approval,
        separationReceiptPath: declaration.approvalSeparationReceipt,
        approvalClosureDigest,
        receiptDigest: governanceDigest('snapback:visibility-separation-receipt:v1', receipt),
        approvalKind: 'pattern',
        patternDerivation: declaration.patternDerivation,
        normalizedPatternCeiling: canonicalCeiling,
      }),
    ], GOVERNANCE_SCHEMA_VERSIONS.overrideBaseline));
    const result = validateVisibilityGovernance({
      root,
      backendRoot: root,
      schemaDef: { visibilityOverrides: [declaration] },
      tables,
    });
    assert.equal(result.visibilityOverrides[0].approvalKind, 'pattern');

    declaration.patternDerivation.derivationDigest = `sha256:${'f'.repeat(64)}`;
    assert.throws(
      () => validateVisibilityGovernance({
        root,
        backendRoot: root,
        schemaDef: { visibilityOverrides: [declaration] },
        tables,
      }),
      (error) => error.code === 'SNAPBACK_TABLE_VISIBILITY_OVERRIDE_APPROVAL_INVALID'
        && /author ruling/u.test(error.message),
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('real codegen emits a system fixture projection and refuses one missing approval without replacing output', async () => {
  const root = mkdtempSync(join(tmpdir(), 'snapback-visibility-codegen-'));
  const app = join(root, 'app');
  const backend = join(app, 'snapback');
  try {
    mkdirSync(backend, { recursive: true });
    writeJson(app, 'demo.snapback.json', { id: 'visibility-system-fixture' });
    writeJson(backend, 'codegen.policy.json', {
      schemaVersion: 'snapback.codegen-policy.v1',
      committedProjections: [],
    });
    const fixture = completeFixture(backend);
    writeFileSync(join(backend, 'schema.mjs'), `
import { defineSchema, defineTable, defineVisibilityOverride, v } from ${JSON.stringify(defineUrl)};
const override = defineVisibilityOverride(${JSON.stringify(fixture.declaration)});
export default defineSchema({
  records: defineTable({ ownerId: v.string(), value: v.string() })
    .visibility({ kind: 'owner', field: 'ownerId' }),
}, { visibilityOverrides: [override] });
`);
    writeFileSync(join(backend, 'functions.mjs'), `
import { defineJsQuery, results } from ${JSON.stringify(defineUrl)};
export const census = defineJsQuery({
  auth: 'authenticated', args: {}, reads: ['records'], result: results.documents('records'),
  handler: async (ctx) => ctx.db.query('records').collect(),
});
`);
    const admitted = await generate(backend);
    assert.equal(admitted.ok, true, JSON.stringify(admitted.diagnostics));
    assert.equal(admitted.authorizationReview.visibilityOverrides.length, 1);
    assert.equal(admitted.authorizationReview.visibilityOverrides[0].authority.mode, 'system');
    assert.equal(admitted.authorizationReview.tablePolicyTransitions.length, 1);
    assert.equal(admitted.authorizationReview.quarantines.length, 0);
    assert.equal(admitted.schemaManifest.visibilityGovernance.required, true);

    const admittedReview = readFileSync(join(admitted.outDir, 'authorization-review.json'), 'utf8');
    rmSync(join(backend, fixture.declaration.approval));
    const refused = await generate(backend);
    assert.equal(refused.ok, false);
    assert.equal(
      refused.diagnostics.filter(({ code }) => code === 'SNAPBACK_TABLE_VISIBILITY_OVERRIDE_UNAPPROVED').length,
      1,
      JSON.stringify(refused.diagnostics),
    );
    assert.equal(existsSync(join(backend, 'generated')), true);
    assert.equal(
      readFileSync(join(admitted.outDir, 'authorization-review.json'), 'utf8'),
      admittedReview,
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('trusted time enforces future issuance, both 90-day caps, expiry, and warning', () => {
  const declaration = { id: 'production-window', issuedOn: '2026-08-16T00:00:00Z', expiresOn: '2026-09-01' };
  assert.throws(
    () => validateProductionOverrideTime(declaration, '2026-08-15T23:54:59Z', Date.parse('2026-08-15T23:59:59Z')),
    ({ code }) => code === 'SNAPBACK_TABLE_VISIBILITY_OVERRIDE_APPROVAL_TIME_INVALID',
  );
  assert.throws(
    () => validateProductionOverrideTime(declaration, '2026-08-16T00:00:00Z', Date.parse('2026-08-15T23:59:59Z')),
    ({ code }) => code === 'SNAPBACK_TABLE_VISIBILITY_OVERRIDE_NOT_YET_VALID',
  );
  assert.equal(validateProductionOverrideTime(
    declaration,
    '2026-08-16T00:00:00Z',
    Date.parse('2026-08-20T00:00:00Z'),
  ), true);
  assert.throws(
    () => validateProductionOverrideTime(declaration, '2026-08-16T00:00:00Z', Date.parse('2026-09-02T00:00:00Z')),
    ({ code }) => code === 'SNAPBACK_TABLE_VISIBILITY_OVERRIDE_EXPIRED',
  );
  const tooLong = { ...declaration, expiresOn: '2026-11-15' };
  assert.throws(
    () => validateProductionOverrideTime(tooLong, '2026-08-16T00:00:00Z', Date.parse('2026-08-20T00:00:00Z')),
    ({ code }) => code === 'SNAPBACK_TABLE_VISIBILITY_OVERRIDE_APPROVAL_TIME_INVALID',
  );
});

test('ordinary-policy growth needs one exact content-bound transition closure', () => {
  const root = mkdtempSync(join(tmpdir(), 'snapback-policy-transition-'));
  try {
    const { ownerMap } = ownerArtifacts(root);
    const initialLedger = policyArtifacts(root);
    writeJson(root, GOVERNANCE_FILES.overrideBaseline,
      exactSetBaseline([], GOVERNANCE_SCHEMA_VERSIONS.overrideBaseline));
    const widenedTables = {
      records: {
        ...tables.records,
        visibility: { kind: 'public-read' },
      },
    };
    assert.throws(
      () => validateVisibilityGovernance({
        root,
        backendRoot: root,
        schemaDef: { visibilityOverrides: [] },
        tables: widenedTables,
      }),
      ({ code }) => code === 'SNAPBACK_TABLE_VISIBILITY_POLICY_RATCHET_GROWTH',
    );

    const predecessor = initialLedger.nodes[0];
    const successorNormalizedPolicyBody = normalizePolicyBody(
      widenedTables.records.visibility,
      widenedTables,
      deriveWritePosture('records', widenedTables.records),
    );
    const approvalPath = 'table-visibility-policy-approvals/records-public-v1.json';
    const receiptPath = 'table-visibility-policy-receipts/records-public-v1.json';
    const node = {
      schemaVersion: GOVERNANCE_SCHEMA_VERSIONS.transitionRecord,
      id: 'records-public-v1',
      tableId: 'records',
      predecessorHeadId: predecessor.id,
      predecessorHeadDigest: transitionNodeDigest(predecessor),
      predecessorNormalizedPolicyBody: predecessor.successorNormalizedPolicyBody,
      predecessorPolicyDigest: predecessor.successorPolicyDigest,
      successorNormalizedPolicyBody,
      successorPolicyDigest: governanceDigest(
        'snapback:table-visibility-policy-body:v2',
        successorNormalizedPolicyBody,
      ),
      admissionKind: 'approved-transition',
      approvalPath,
      approvalClosureDigest: null,
      serverSeparationReceipt: receiptPath,
      serverSeparationReceiptDigest: null,
      quarantineVerdict: null,
    };
    const approval = {
      schemaVersion: GOVERNANCE_SCHEMA_VERSIONS.approvalRecord,
      scopeDigestVersion: 'snapback.visibility-scope.v1',
      digestAlgorithm: 'sha256',
      approvalKind: 'table-policy-transition',
      id: node.id,
      scopeDigest: `sha256:${'0'.repeat(64)}`,
      lifecycleClass: 'durable-policy',
      requestedBy: 'fixture-owner',
      approvedBy: 'project-author',
      ownerMapDigest: governanceDigest('snapback:visibility-owner-map:v1', ownerMap),
      issuedOn: '2026-08-15T18:00:00Z',
      justificationDigest: governanceDigest(
        'snapback:table-visibility-transition-justification:v1',
        'records are public in this isolated fixture',
      ),
      acceptanceId: 'records-public-acceptance-v1',
      acceptancePath: 'tests/visibility-governance/records-public.json',
      reviewArtifact: null,
      reviewRecord: null,
      approvalRuling: null,
      rulingRecord: null,
      delegationRuling: null,
      delegationRecord: null,
    };
    approval.scopeDigest = transitionApprovalScopeDigest(node, approval);
    writeJson(root, approvalPath, approval);
    node.approvalClosureDigest = governanceDigest(
      'snapback:visibility-approval-closure:v1',
      { approval, ownerMap },
    );
    const { privateKey, publicKey } = generateKeyPairSync('ed25519');
    const publicKeyPem = publicKey.export({ type: 'spki', format: 'pem' });
    const observerKeyDigest = governanceDigest('snapback:visibility-observer-key:v1', publicKeyPem);
    writeJson(root, GOVERNANCE_FILES.observerKeys, {
      schemaVersion: GOVERNANCE_SCHEMA_VERSIONS.observerKeys,
      activeEpoch: 'policy-epoch-1',
      keys: [{
        epoch: 'policy-epoch-1',
        keyDigest: observerKeyDigest,
        publicKeyPem,
        revoked: false,
      }],
    });
    const receiptPayload = {
      schemaVersion: GOVERNANCE_SCHEMA_VERSIONS.separationReceipt,
      providerProfile: 'github-push-v1',
      eventId: 'policy-approval-event-v1',
      governedRef: 'refs/heads/main',
      eventInputDigest: governanceDigest(
        'snapback:visibility-governance-event-input:v1',
        { fixture: 'policy' },
      ),
      beforeOid: '5'.repeat(40),
      afterOid: '6'.repeat(40),
      observedAt: '2026-08-15T18:05:00Z',
      approvalKind: approval.approvalKind,
      approvalId: approval.id,
      scopeDigest: approval.scopeDigest,
      approvalClosureDigest: node.approvalClosureDigest,
      predecessorOwnerMapDigest: approval.ownerMapDigest,
      comparatorVersion: 'snapback.visibility-governance-comparator.v2',
      approvalOnly: true,
      observerKeyEpoch: 'policy-epoch-1',
      observerKeyDigest,
    };
    const receipt = {
      ...receiptPayload,
      signature: signBytes(
        null,
        Buffer.from(canonicalGovernanceJson(receiptPayload)),
        privateKey,
      ).toString('base64'),
    };
    writeJson(root, receiptPath, receipt);
    node.serverSeparationReceiptDigest = governanceDigest(
      'snapback:visibility-separation-receipt:v1',
      receipt,
    );
    const transitionLedger = {
      schemaVersion: GOVERNANCE_SCHEMA_VERSIONS.transitionLedger,
      nodes: [predecessor, node],
      heads: { records: node.id },
      ledgerDigest: transitionLedgerDigest([predecessor, node], { records: node.id }),
    };
    writeJson(root, GOVERNANCE_FILES.transitionLedger, transitionLedger);
    writeJson(root, GOVERNANCE_FILES.policyBaseline,
      currentTablePolicyBaseline(widenedTables, transitionLedger));
    const result = validateVisibilityGovernance({
      root,
      backendRoot: root,
      schemaDef: { visibilityOverrides: [] },
      tables: widenedTables,
    });
    assert.equal(result.tablePolicyTransitions.length, 2);
    assert.equal(result.activation.required, true);

    writeJson(root, approvalPath, { ...approval, acceptanceId: 'rebound-acceptance' });
    assert.throws(
      () => validateVisibilityGovernance({
        root,
        backendRoot: root,
        schemaDef: { visibilityOverrides: [] },
        tables: widenedTables,
      }),
      ({ code }) => code === 'SNAPBACK_TABLE_VISIBILITY_POLICY_PROVENANCE_INVALID',
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('an installed policy cannot be removed or laundered back into omission', () => {
  const root = mkdtempSync(join(tmpdir(), 'snapback-policy-removal-'));
  try {
    ownerArtifacts(root);
    policyArtifacts(root);
    writeJson(root, GOVERNANCE_FILES.overrideBaseline,
      exactSetBaseline([], GOVERNANCE_SCHEMA_VERSIONS.overrideBaseline));
    assert.throws(
      () => validateVisibilityGovernance({
        root,
        backendRoot: root,
        schemaDef: { visibilityOverrides: [] },
        tables: { records: { ...tables.records, visibility: undefined } },
      }),
      ({ code, details }) => code === 'SNAPBACK_TABLE_WRITE_POLICY_REMOVAL_REFUSED'
        && details.tables[0] === 'records',
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('quarantine chain refuses verdict deletion, rebinding, and retired-id reuse', () => {
  const root = mkdtempSync(join(tmpdir(), 'snapback-visibility-quarantine-'));
  try {
    const full = completeFixture(root);
    const installed = installQuarantine(root, full.privateKey);
    assert.equal(validateVisibilityGovernance({
      backendRoot: root,
      schemaDef: { visibilityOverrides: [full.declaration] },
      tables,
    }).quarantine.records.length, 1);

    rmSync(join(root, installed.path));
    assert.throws(
      () => validateVisibilityGovernance({
        backendRoot: root,
        schemaDef: { visibilityOverrides: [full.declaration] },
        tables,
      }),
      ({ code }) => code === 'SNAPBACK_TABLE_VISIBILITY_POLICY_PROVENANCE_INVALID',
    );

    const rebound = installQuarantine(root, full.privateKey);
    writeJson(root, rebound.path, { ...rebound.verdict, governedRecordId: 'rebound-override-v1' });
    assert.throws(
      () => validateVisibilityGovernance({
        backendRoot: root,
        schemaDef: { visibilityOverrides: [full.declaration] },
        tables,
      }),
      ({ code }) => code === 'SNAPBACK_TABLE_VISIBILITY_POLICY_PROVENANCE_INVALID',
    );

    installQuarantine(root, full.privateKey, full.declaration.id);
    assert.throws(
      () => validateVisibilityGovernance({
        backendRoot: root,
        schemaDef: { visibilityOverrides: [full.declaration] },
        tables,
      }),
      ({ code }) => code === 'SNAPBACK_TABLE_VISIBILITY_POLICY_PROVENANCE_INVALID',
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('provider envelope refuses unauthenticated atomic, multi-ref, and unanchored creation', () => {
  const update = { ref: 'refs/heads/main', beforeOid: '1'.repeat(40), afterOid: '2'.repeat(40) };
  assert.throws(
    () => validateGovernedPushEnvelope({ commands: [update], providerProfile: 'atomic-push-envelope-v1' }),
    ({ code }) => code === 'SNAPBACK_TABLE_VISIBILITY_GOVERNANCE_PUSH_VIOLATION',
  );
  assert.throws(
    () => validateGovernedPushEnvelope({ commands: [update, update], providerProfile: 'github-push-v1' }),
    ({ code }) => code === 'SNAPBACK_TABLE_VISIBILITY_GOVERNANCE_PUSH_VIOLATION',
  );
  assert.throws(
    () => validateGovernedPushEnvelope({
      commands: [{ ...update, beforeOid: '0'.repeat(40) }],
      providerProfile: 'github-push-v1',
    }),
    ({ code }) => code === 'SNAPBACK_TABLE_VISIBILITY_GOVERNANCE_PUSH_VIOLATION',
  );
  assert.equal(validateGovernedPushEnvelope({
    commands: [update],
    providerProfile: 'atomic-push-envelope-v1',
    eventId: 'atomic-event',
  }).length, 1);
});

function git(root, ...args) {
  return execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim();
}

function commitAll(root, message) {
  git(root, 'add', '.');
  git(root, '-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid', 'commit', '-m', message);
  return git(root, 'rev-parse', 'HEAD');
}

test('history comparator admits the real todo v1-to-derived-v2 governance upgrade', () => {
  const root = mkdtempSync(join(tmpdir(), 'snapback-visibility-v1-v2-'));
  try {
    const { backendPath, backendRoot, beforeOid } = initializeRealTodoGovernanceHistory(root);
    const upgraded = realTodoV2PolicyArtifacts();
    assert.equal(upgraded.baseline.exactSetDigest,
      'sha256:e57dd6e9059676703805c18edae25bc8d8f50e7a658a660b369b5ebae0212c30');
    assert.equal(upgraded.ledger.ledgerDigest,
      'sha256:c79fa831b3aca6a7eba143e3c821c3fb82f532b34d7a130b98c6bc674be818a8');
    writePolicyArtifacts(backendRoot, upgraded);
    const afterOid = commitAll(root, 'derived v2 upgrade');
    assert.deepEqual(compareGovernanceSnapshots({
      root,
      beforeOid,
      afterOid,
      backendPaths: [backendPath],
    }).policyGrowth, []);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('history comparator always refuses a table-policy governance v2-to-v1 downgrade', () => {
  const root = mkdtempSync(join(tmpdir(), 'snapback-visibility-v2-v1-'));
  try {
    const { backendPath, backendRoot } = initializeRealTodoGovernanceHistory(root);
    writePolicyArtifacts(backendRoot, realTodoV2PolicyArtifacts());
    const beforeOid = commitAll(root, 'v2 predecessor');
    writePolicyArtifacts(backendRoot, {
      baseline: REAL_TODO_V1_POLICY_BASELINE,
      ledger: REAL_TODO_V1_TRANSITION_LEDGER,
    });
    const afterOid = commitAll(root, 'attempt v1 downgrade');
    assert.throws(
      () => compareGovernanceSnapshots({
        root,
        beforeOid,
        afterOid,
        backendPaths: [backendPath],
      }),
      ({ code, message }) => code === 'SNAPBACK_TABLE_VISIBILITY_POLICY_PROVENANCE_INVALID'
        && message.includes('downgrades ordinary table-policy governance from v2 to v1'),
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('history comparator refuses a v1-to-v2 posture altered beyond its derived default', () => {
  const root = mkdtempSync(join(tmpdir(), 'snapback-visibility-v1-altered-v2-'));
  try {
    const { backendPath, backendRoot, beforeOid } = initializeRealTodoGovernanceHistory(root);
    const table = { visibility: { kind: 'owner', field: 'userId' } };
    const alteredPosture = deriveWritePosture('todos', table);
    alteredPosture.dispositions.insert = 'refused';
    writePolicyArtifacts(backendRoot, realTodoV2PolicyArtifacts(alteredPosture));
    const assertRefused = (afterOid) => assert.throws(
      () => compareGovernanceSnapshots({
        root,
        beforeOid,
        afterOid,
        backendPaths: [backendPath],
      }),
      ({ code }) => code === 'SNAPBACK_TABLE_VISIBILITY_POLICY_PROVENANCE_INVALID',
    );
    assertRefused(commitAll(root, 'altered v2 disposition'));

    const disclosurePosture = deriveWritePosture('todos', table);
    disclosurePosture.globalUniqueDisclosures.push({
      table: 'todos',
      writeForm: 'insert',
      constraint: 'by_external_key',
      operations: ['createTodo'],
    });
    writePolicyArtifacts(backendRoot, realTodoV2PolicyArtifacts(disclosurePosture));
    assertRefused(commitAll(root, 'altered v2 disclosure'));

    const authorityClassPosture = deriveWritePosture('todos', {
      ...table,
      membership: {},
    });
    writePolicyArtifacts(backendRoot, realTodoV2PolicyArtifacts(authorityClassPosture));
    assertRefused(commitAll(root, 'altered v2 authority class'));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('G1 closure admits only the exact initial public-policy corpus once', () => {
  const root = mkdtempSync(join(tmpdir(), 'snapback-visibility-g1-'));
  const backendPath = 'app/snapback';
  const backendRoot = join(root, backendPath);
  try {
    git(root, 'init', '-q');
    git(root, 'branch', '-M', 'main');
    writeFileSync(join(root, 'README.md'), 'pre-G1\n');
    const predecessorOid = commitAll(root, 'before G1');

    const ownerMap = ownerArtifacts(backendRoot).ownerMap;
    const migrationTables = {
      records: {
        visibility: { kind: 'public-read' },
        fields: [],
      },
    };
    const successorNormalizedPolicyBody = normalizePolicyBody(
      migrationTables.records.visibility,
      migrationTables,
      deriveWritePosture('records', migrationTables.records),
    );
    const node = {
      schemaVersion: GOVERNANCE_SCHEMA_VERSIONS.transitionRecord,
      id: 'records-g1-v1',
      tableId: 'records',
      predecessorHeadId: null,
      predecessorHeadDigest: null,
      predecessorNormalizedPolicyBody: null,
      predecessorPolicyDigest: null,
      successorNormalizedPolicyBody,
      successorPolicyDigest: governanceDigest(
        'snapback:table-visibility-policy-body:v2',
        successorNormalizedPolicyBody,
      ),
      admissionKind: 'g1-migration',
      approvalPath: null,
      approvalClosureDigest: null,
      serverSeparationReceipt: null,
      serverSeparationReceiptDigest: null,
      quarantineVerdict: null,
    };
    const ledger = {
      schemaVersion: GOVERNANCE_SCHEMA_VERSIONS.transitionLedger,
      nodes: [node],
      heads: { records: node.id },
      ledgerDigest: transitionLedgerDigest([node], { records: node.id }),
    };
    const policy = currentTablePolicyBaseline(migrationTables, ledger);
    writeJson(backendRoot, GOVERNANCE_FILES.transitionLedger, ledger);
    writeJson(backendRoot, GOVERNANCE_FILES.policyBaseline, policy);
    writeJson(backendRoot, GOVERNANCE_FILES.overrideBaseline,
      exactSetBaseline([], GOVERNANCE_SCHEMA_VERSIONS.overrideBaseline));
    writeJson(backendRoot, GOVERNANCE_FILES.quarantineLedger, {
      schemaVersion: GOVERNANCE_SCHEMA_VERSIONS.quarantineLedger,
      records: [],
      retiredIds: [],
      headDigest: governanceDigest('snapback:visibility-quarantine-head:v1', []),
    });
    writeJson(backendRoot, 'generated/authorization-review.json', {
      inputsHash: 'snapback.g1-fixture.inputs.v1',
      tablePolicies: [{ table: 'records', origin: 'declared', policy: { kind: 'public-read' } }],
    });
    const codegenSource = 'export const G1_CODEGEN = true;\n';
    const completionTestSource = 'export const G1_COMPLETION = true;\n';
    mkdirSync(join(root, 'packages/snapback-codegen'), { recursive: true });
    writeFileSync(join(root, 'packages/snapback-codegen/index.mjs'), codegenSource);
    writeFileSync(
      join(root, 'packages/snapback-codegen/card-game-visibility-completion.test.mjs'),
      completionTestSource,
    );
    const receipt = {
      schemaVersion: GOVERNANCE_SCHEMA_VERSIONS.g1Closure,
      closureId: 'llp-0234-g1-g2-fixture',
      predecessorOid,
      phases: ['G1', 'G2'],
      approvedBy: 'project-author',
      approvedOn: '2026-08-16',
      ruling: 'Approve this exact initial public-policy fixture and no successor migration.',
      codegenSourceDigest: governanceDigest(
        'snapback:visibility-governance-g1-codegen-source:v1',
        codegenSource,
      ),
      completionTestSourceDigest: governanceDigest(
        'snapback:visibility-governance-g1-completion-test-source:v1',
        completionTestSource,
      ),
      backends: [{
        backendPath,
        authorizationReviewInputsHash: 'snapback.g1-fixture.inputs.v1',
        ownerMapDigest: governanceDigest('snapback:visibility-owner-map:v1', ownerMap),
        policyBaselineDigest: policy.exactSetDigest,
        transitionLedgerDigest: ledger.ledgerDigest,
      }],
      publicTables: [{ backendPath, tableId: 'records', policyDigest: node.successorPolicyDigest }],
      sourceRevisionDigest: null,
      receiptDigest: null,
    };
    receipt.sourceRevisionDigest = g1ClosureSourceRevisionDigest(receipt);
    receipt.receiptDigest = g1ClosureReceiptDigest(receipt);
    writeJson(root, GOVERNANCE_FILES.g1Closure, receipt);
    const afterOid = commitAll(root, 'exact G1 closure');
    assert.deepEqual(compareGovernanceSnapshots({
      root,
      beforeOid: predecessorOid,
      afterOid,
      backendPaths: [backendPath],
    }).policyGrowth, ['records']);

    const rebound = { ...receipt, ruling: 'Rebound ruling.' };
    rebound.receiptDigest = g1ClosureReceiptDigest(rebound);
    writeJson(root, GOVERNANCE_FILES.g1Closure, rebound);
    const reboundOid = commitAll(root, 'rebind G1 receipt');
    assert.throws(
      () => compareGovernanceSnapshots({
        root,
        beforeOid: afterOid,
        afterOid: reboundOid,
        backendPaths: [backendPath],
      }),
      ({ code }) => code === 'SNAPBACK_TABLE_VISIBILITY_POLICY_PROVENANCE_INVALID',
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('pre-push refuses an unavailable predecessor distinctly and allows it after fetch', () => {
  const sourceRoot = mkdtempSync(join(tmpdir(), 'snapback-visibility-predecessor-source-'));
  const cloneParent = mkdtempSync(join(tmpdir(), 'snapback-visibility-predecessor-clone-'));
  const cloneRoot = join(cloneParent, 'repository');
  try {
    git(sourceRoot, 'init', '-q');
    git(sourceRoot, 'branch', '-M', 'main');
    writeFileSync(
      join(sourceRoot, GOVERNANCE_FILES.g1Closure),
      readFileSync(join(packageRoot, '..', '..', GOVERNANCE_FILES.g1Closure)),
    );
    const predecessorOid = commitAll(sourceRoot, 'governed predecessor');
    writeFileSync(join(sourceRoot, 'README.md'), 'issues-only successor\n');
    const afterOid = commitAll(sourceRoot, 'issues-only successor');

    execFileSync('git', [
      'clone',
      '--depth',
      '1',
      pathToFileURL(sourceRoot).href,
      cloneRoot,
    ], { stdio: 'ignore' });
    assert.throws(
      () => execFileSync('git', ['cat-file', '-e', `${predecessorOid}^{commit}`], {
        cwd: cloneRoot,
        stdio: 'ignore',
      }),
    );

    const input = `HEAD ${afterOid} refs/heads/main ${predecessorOid}\n`;
    assert.throws(
      () => runPrePushAdmission({ input, root: cloneRoot, env: {} }),
      ({ code, message }) => (
        code === 'SNAPBACK_TABLE_VISIBILITY_GOVERNANCE_PREDECESSOR_UNAVAILABLE'
        && /git fetch/u.test(message)
        && /rebase/u.test(message)
      ),
    );
    assert.throws(
      () => runPrePushAdmission({
        input: `HEAD ${afterOid} refs/heads/main ${'0'.repeat(40)}\n`,
        root: cloneRoot,
        env: {},
      }),
      ({ code, message }) => (
        code === 'SNAPBACK_TABLE_VISIBILITY_GOVERNANCE_PUSH_VIOLATION'
        && /protected single-ref creation service/u.test(message)
      ),
    );

    git(cloneRoot, 'fetch', '--unshallow', 'origin');
    assert.deepEqual(
      runPrePushAdmission({ input, root: cloneRoot, env: {} }),
      { checked: 1, exempt: 0 },
    );
  } finally {
    rmSync(sourceRoot, { recursive: true, force: true });
    rmSync(cloneParent, { recursive: true, force: true });
  }
});

function protectedConfigEnv(root, config) {
  const path = join(root, 'protected-visibility-governance-config.json');
  writeJson(root, 'protected-visibility-governance-config.json', config);
  return {
    SNAPBACK_VISIBILITY_GOVERNANCE_PROTECTED_CONFIG: path,
    SNAPBACK_VISIBILITY_GOVERNANCE_PROTECTED_CONFIG_DIGEST:
      governanceDigest('snapback:visibility-governance-config:v1', config),
  };
}

test('history comparator rejects same-update approval consumption and quarantine deletion', () => {
  const root = mkdtempSync(join(tmpdir(), 'snapback-visibility-git-'));
  try {
    git(root, 'init', '-q');
    git(root, 'branch', '-M', 'main');
    ownerArtifacts(root);
    policyArtifacts(root);
    writeJson(root, GOVERNANCE_FILES.overrideBaseline,
      exactSetBaseline([], GOVERNANCE_SCHEMA_VERSIONS.overrideBaseline));
    const before = commitAll(root, 'before');
    const full = completeFixture(root);
    const after = commitAll(root, 'same push approval and widening');
    assert.throws(
      () => compareGovernanceSnapshots({ root, beforeOid: before, afterOid: after, backendPaths: [''] }),
      ({ code }) => code === 'SNAPBACK_TABLE_VISIBILITY_OVERRIDE_SELF_APPROVAL',
    );

    const originalBaseline = JSON.parse(readFileSync(
      join(root, GOVERNANCE_FILES.overrideBaseline),
      'utf8',
    ));
    const originalEntry = originalBaseline.entries[0];
    const reboundDeclaration = structuredClone(originalEntry.normalizedDeclaration);
    reboundDeclaration.fixtureProfile.id = 'rebound-synthetic-v1';
    const { digest: _oldDigest, ...profileBody } = reboundDeclaration.fixtureProfile;
    reboundDeclaration.fixtureProfile.digest = governanceDigest(
      'snapback:visibility-fixture-profile:v1',
      profileBody,
    );
    const reboundEntry = visibilityOverrideBaselineEntry({
      declaration: reboundDeclaration,
      scopeDigest: overrideScopeDigest(reboundDeclaration),
      approvalPath: originalEntry.approvalRecord,
      separationReceiptPath: originalEntry.serverSeparationReceipt,
      approvalClosureDigest: originalEntry.approvalClosureDigest,
      receiptDigest: originalEntry.serverSeparationReceiptDigest,
    });
    writeJson(root, GOVERNANCE_FILES.overrideBaseline,
      exactSetBaseline([reboundEntry], GOVERNANCE_SCHEMA_VERSIONS.overrideBaseline));
    const profileRebound = commitAll(root, 'rebind fixture profile without a new approval');
    assert.throws(
      () => compareGovernanceSnapshots({ root, beforeOid: after, afterOid: profileRebound, backendPaths: [''] }),
      ({ code }) => code === 'SNAPBACK_TABLE_VISIBILITY_OVERRIDE_APPROVAL_INVALID',
      'a recomputed baseline digest cannot launder a fixture-profile swap',
    );
    writeJson(root, GOVERNANCE_FILES.overrideBaseline, originalBaseline);

    installQuarantine(root, full.privateKey);
    const quarantined = commitAll(root, 'quarantine');
    writeJson(root, GOVERNANCE_FILES.quarantineLedger, {
      schemaVersion: GOVERNANCE_SCHEMA_VERSIONS.quarantineLedger,
      records: [],
      retiredIds: [],
      headDigest: governanceDigest('snapback:visibility-quarantine-head:v1', []),
    });
    const deleted = commitAll(root, 'delete quarantine');
    assert.throws(
      () => compareGovernanceSnapshots({ root, beforeOid: quarantined, afterOid: deleted, backendPaths: [''] }),
      ({ code }) => code === 'SNAPBACK_TABLE_VISIBILITY_POLICY_PROVENANCE_INVALID',
    );
    assert.equal(full.declaration.lifecycleClass, 'fixture');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('delegation and dependent approval cannot co-land', () => {
  const root = mkdtempSync(join(tmpdir(), 'snapback-visibility-delegation-'));
  try {
    git(root, 'init', '-q');
    ownerArtifacts(root);
    policyArtifacts(root);
    writeJson(root, GOVERNANCE_FILES.overrideBaseline,
      exactSetBaseline([], GOVERNANCE_SCHEMA_VERSIONS.overrideBaseline));
    const before = commitAll(root, 'before delegation');
    const delegationRecord = { approvalOwner: 'security-reviewer', path: 'tests/visibility-governance' };
    ownerArtifacts(root, [{
      path: 'tests/visibility-governance/system-record-census.json',
      implementationOwner: 'fixture-owner',
      approvalOwner: 'security-reviewer',
      authorRuling: 'rulings/delegation.json',
      delegationRecord,
    }]);
    writeJson(root, 'rulings/delegation.json', { delegationRecord });
    writeJson(root, 'visibility-override-approvals/dependent.json', {
      approvedBy: 'security-reviewer',
      delegationRuling: 'rulings/delegation.json',
      delegationRecord,
    });
    const after = commitAll(root, 'delegation and dependent approval');
    assert.throws(
      () => compareGovernanceSnapshots({ root, beforeOid: before, afterOid: after, backendPaths: [''] }),
      ({ code }) => code === 'SNAPBACK_TABLE_VISIBILITY_OVERRIDE_DELEGATION_NOT_PRIOR',
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('approval-only, receipt-publisher, then widening yields an exact-identity green verdict', () => {
  const root = mkdtempSync(join(tmpdir(), 'snapback-visibility-green-'));
  const keyRoot = mkdtempSync(join(tmpdir(), 'snapback-visibility-key-'));
  try {
    git(root, 'init', '-q');
    git(root, 'branch', '-M', 'main');
    const full = completeFixture(root);
    const approval = full.approval;
    rmSync(join(root, full.declaration.approval));
    rmSync(join(root, full.declaration.approvalSeparationReceipt));
    writeJson(root, GOVERNANCE_FILES.overrideBaseline,
      exactSetBaseline([], GOVERNANCE_SCHEMA_VERSIONS.overrideBaseline));
    const governanceConfig = {
      schemaVersion: 'snapback.visibility-governance-config.v1',
      providerProfile: 'github-push-v1',
      governedRefs: ['refs/heads/main'],
      backendPaths: [''],
      revokedObserverKeyEpochs: [],
      anchorWitness: null,
    };
    writeJson(root, 'visibility-governance.config.json', governanceConfig);
    const fixtureGovernance = {
      generationInputsHash: 'sha256:inputs-fixture',
      visibilityAuthorizationProgramDigest: 'sha256:program-fixture',
      quarantineHeadDigest: governanceDigest('snapback:visibility-quarantine-head:v1', []),
    };
    const fixtureActivationDigest = governanceDigest(
      'snapback:visibility-governance-activation-carrier:v1',
      fixtureGovernance,
    );
    writeJson(root, 'generated/schema.manifest.json', {
      appId: 'governed-fixture',
      schemaHash: 'sha256:schema-fixture',
      visibilityGovernance: fixtureGovernance,
    });
    writeJson(root, 'generated/functions.manifest.json', {
      bundleHash: 'sha256:functions-fixture',
    });
    const before = commitAll(root, 'governance before approval');
    writeJson(root, full.declaration.approval, approval);
    const approvalOid = commitAll(root, 'approval only');

    const registry = JSON.parse(readFileSync(join(root, GOVERNANCE_FILES.observerKeys), 'utf8'));
    const privateKeyPath = join(keyRoot, 'observer-private.pem');
    writeFileSync(privateKeyPath, full.privateKey.export({ type: 'pkcs8', format: 'pem' }));
    const env = {
      SNAPBACK_VISIBILITY_OBSERVER_PRIVATE_KEY: privateKeyPath,
      SNAPBACK_VISIBILITY_OBSERVER_KEY_EPOCH: registry.activeEpoch,
      SNAPBACK_VISIBILITY_OBSERVER_KEY_DIGEST: registry.keys[0].keyDigest,
      ...protectedConfigEnv(keyRoot, governanceConfig),
    };
    const approvalObservation = runProtectedObserver({
      root,
      outDir: join(root, 'approval-observer-output'),
      env,
      now: new Date('2026-08-15T20:00:00Z'),
      event: {
        providerProfile: 'github-push-v1',
        eventId: 'approval-only-event',
        repository: 'fixture/repository',
        authenticated: true,
        deliveredAt: '2026-08-15T20:00:00Z',
        commands: [{ ref: 'refs/heads/main', beforeOid: before, afterOid: approvalOid }],
      },
    });
    assert.equal(approvalObservation.red, 0);
    assert.equal(approvalObservation.receipts.length, 1);
    writeJson(root, full.declaration.approvalSeparationReceipt, approvalObservation.receipts[0]);
    const receiptOid = commitAll(root, 'protected receipt publisher');

    const ownerMap = JSON.parse(readFileSync(join(root, GOVERNANCE_FILES.ownerMap), 'utf8'));
    const approvalClosureDigest = governanceDigest(
      'snapback:visibility-approval-closure:v1',
      { approval, ownerMap },
    );
    writeJson(root, GOVERNANCE_FILES.overrideBaseline, exactSetBaseline([
      visibilityOverrideBaselineEntry({
        declaration: full.canonical,
        scopeDigest: overrideScopeDigest(full.canonical),
        approvalPath: full.declaration.approval,
        separationReceiptPath: full.declaration.approvalSeparationReceipt,
        approvalClosureDigest,
        receiptDigest: governanceDigest(
          'snapback:visibility-separation-receipt:v1',
          approvalObservation.receipts[0],
        ),
      }),
    ], GOVERNANCE_SCHEMA_VERSIONS.overrideBaseline));
    const wideningOid = commitAll(root, 'consume remotely prior approval');
    assert.deepEqual(compareGovernanceSnapshots({
      root,
      beforeOid: receiptOid,
      afterOid: wideningOid,
      backendPaths: [''],
    }).growth, [full.declaration.id]);

    const wideningObservation = runProtectedObserver({
      root,
      outDir: join(root, 'widening-observer-output'),
      env,
      now: new Date('2026-08-15T20:10:00Z'),
      event: {
        providerProfile: 'github-push-v1',
        eventId: 'widening-event',
        repository: 'fixture/repository',
        authenticated: true,
        deliveredAt: '2026-08-15T20:10:00Z',
        commands: [{ ref: 'refs/heads/main', beforeOid: receiptOid, afterOid: wideningOid }],
      },
    });
    assert.equal(wideningObservation.red, 0);
    assert.deepEqual(wideningObservation.verdicts[0].deploymentIdentities, [{
      backend: '',
      appId: 'governed-fixture',
      schemaHash: 'sha256:schema-fixture',
      functionBundleHash: 'sha256:functions-fixture',
      generationInputsHash: 'sha256:inputs-fixture',
      visibilityAuthorizationProgramDigest: 'sha256:program-fixture',
      visibilityGovernanceActivationDigest: fixtureActivationDigest,
      quarantineHeadDigest: governanceDigest('snapback:visibility-quarantine-head:v1', []),
    }]);
    const verdict = wideningObservation.verdicts[0];
    const expectedIdentity = {
      schemaHash: 'sha256:schema-fixture',
      functionBundleHash: 'sha256:functions-fixture',
      generationInputsHash: 'sha256:inputs-fixture',
      visibilityAuthorizationProgramDigest: 'sha256:program-fixture',
      visibilityGovernanceActivationDigest: fixtureActivationDigest,
    };
    assert.equal(deepMatchGovernedVerdict(verdict, expectedIdentity, {
      sourceOid: wideningOid,
      quarantineHeadDigest: verdict.quarantineHeadDigest,
    }), true);
    for (const field of Object.keys(expectedIdentity)) {
      assert.throws(
        () => deepMatchGovernedVerdict(verdict, {
          ...expectedIdentity,
          [field]: `${expectedIdentity[field]}-swapped`,
        }, {
          sourceOid: wideningOid,
          quarantineHeadDigest: verdict.quarantineHeadDigest,
        }),
        ({ code }) => code === 'SNAPBACK_TABLE_VISIBILITY_GOVERNANCE_DEPLOYMENT_IDENTITY_MISMATCH',
      );
    }
  } finally {
    rmSync(root, { recursive: true, force: true });
    rmSync(keyRoot, { recursive: true, force: true });
  }
});

test('tracked hook observes the drift bypass without granting authority and observer retains red evidence', () => {
  const root = mkdtempSync(join(tmpdir(), 'snapback-visibility-observer-'));
  try {
    git(root, 'init', '-q');
    git(root, 'branch', '-M', 'main');
    ownerArtifacts(root);
    policyArtifacts(root);
    writeJson(root, GOVERNANCE_FILES.overrideBaseline,
      exactSetBaseline([], GOVERNANCE_SCHEMA_VERSIONS.overrideBaseline));
    const governanceConfig = {
      schemaVersion: 'snapback.visibility-governance-config.v1',
      providerProfile: 'github-push-v1',
      governedRefs: ['refs/heads/main'],
      backendPaths: [''],
      revokedObserverKeyEpochs: [],
      anchorWitness: null,
    };
    writeJson(root, 'visibility-governance.config.json', governanceConfig);
    mkdirSync(join(root, '.github/workflows'), { recursive: true });
    writeFileSync(join(root, '.github/workflows/in-tree-audit.yml'), 'name: in-tree audit\n');
    const before = commitAll(root, 'before observed widening');
    completeFixture(root);
    rmSync(join(root, '.github/workflows/in-tree-audit.yml'));
    writeJson(root, 'visibility-governance.config.json', {
      ...governanceConfig,
      backendPaths: [],
    });
    const after = commitAll(root, 'same-update self approval');
    const input = `refs/heads/main ${after} refs/heads/main ${before}\n`;
    assert.throws(
      () => runPrePushAdmission({ input, root, env: { SNAPBACK_DRIFT_GATES_BYPASS: 'yes' } }),
      ({ code, message }) => code === 'SNAPBACK_TABLE_VISIBILITY_GOVERNANCE_PUSH_VIOLATION'
        && /must be exactly 1 when used/u.test(message),
    );
    const observed = [];
    const originalError = console.error;
    console.error = (...args) => observed.push(args.join(' '));
    try {
      assert.throws(
        () => runPrePushAdmission({ input, root, env: { SNAPBACK_DRIFT_GATES_BYPASS: '1' } }),
        ({ code }) => code === 'SNAPBACK_TABLE_VISIBILITY_OVERRIDE_SELF_APPROVAL',
      );
    } finally {
      console.error = originalError;
    }
    assert.match(
      observed.join('\n'),
      /COMPATIBILITY BYPASS OBSERVED: SNAPBACK_DRIFT_GATES_BYPASS=1.*synchronous visibility governance remains enforced/u,
    );

    const { privateKey, publicKey } = generateKeyPairSync('ed25519');
    const privateKeyPath = join(root, 'observer-private.pem');
    writeFileSync(privateKeyPath, privateKey.export({ type: 'pkcs8', format: 'pem' }));
    const protectedPublicKeyPem = publicKey.export({ type: 'spki', format: 'pem' });
    const protectedKeyDigest = governanceDigest(
      'snapback:visibility-observer-key:v1',
      protectedPublicKeyPem,
    );
    const outDir = join(root, 'observer-output');
    const result = runProtectedObserver({
      root,
      outDir,
      now: new Date('2026-08-15T20:00:00Z'),
      env: {
        SNAPBACK_VISIBILITY_OBSERVER_PRIVATE_KEY: privateKeyPath,
        SNAPBACK_VISIBILITY_OBSERVER_KEY_EPOCH: 'protected-epoch-1',
        SNAPBACK_VISIBILITY_OBSERVER_KEY_DIGEST: protectedKeyDigest,
        SNAPBACK_VISIBILITY_QUARANTINE_HEAD: governanceDigest('snapback:visibility-quarantine-head:v1', []),
        ...protectedConfigEnv(root, governanceConfig),
      },
      event: {
        providerProfile: 'github-push-v1',
        eventId: 'provider-event-1',
        repository: 'fixture/repository',
        authenticated: true,
        deliveredAt: '2026-08-15T20:00:00Z',
        commands: [{ ref: 'refs/heads/main', beforeOid: before, afterOid: after }],
      },
    });
    assert.equal(result.red, 1);
    assert.equal(
      git(root, 'ls-tree', '-r', '--name-only', after)
        .split('\n').includes('.github/workflows/in-tree-audit.yml'),
      false,
    );
    const verdict = JSON.parse(readFileSync(join(outDir, 'governed-update-verdicts.json')));
    assert.equal(verdict.verdicts[0].afterOid, after);
    assert.equal(verdict.verdicts[0].disposition, 'red');
    assert.equal(JSON.parse(readFileSync(join(outDir, 'quarantine-ticket-request.json'))).priority, 'P1');
    assert.equal(JSON.parse(readFileSync(join(outDir, 'quarantine-verdicts.json'))).verdicts.length, 1);
    const anchorPayload = {
      schemaVersion: 'snapback.visibility-governance-anchor-witness.v1',
      providerProfile: 'github-push-v1',
      governedRef: 'refs/heads/main',
      anchorOid: before,
      observedAt: '2026-08-15T19:55:00Z',
      observerKeyEpoch: 'protected-epoch-1',
      observerKeyDigest: protectedKeyDigest,
    };
    const anchorWitness = {
      ...anchorPayload,
      signature: signBytes(
        null,
        Buffer.from(canonicalGovernanceJson(anchorPayload)),
        privateKey,
      ).toString('base64'),
    };
    const protectedRegistry = {
      schemaVersion: GOVERNANCE_SCHEMA_VERSIONS.observerKeys,
      activeEpoch: 'protected-epoch-1',
      keys: [{
        epoch: 'protected-epoch-1',
        keyDigest: protectedKeyDigest,
        publicKeyPem: protectedPublicKeyPem,
        revoked: false,
      }],
    };
    const creationConfig = {
      ...governanceConfig,
      anchorWitness,
      protectedCreationService: 'externally-custodied-single-ref-v1',
      observerKeys: protectedRegistry,
    };
    const creationResult = runProtectedObserver({
      root,
      outDir: join(root, 'creation-observer-output'),
      now: new Date('2026-08-15T20:01:00Z'),
      env: {
        SNAPBACK_VISIBILITY_OBSERVER_PRIVATE_KEY: privateKeyPath,
        SNAPBACK_VISIBILITY_OBSERVER_KEY_EPOCH: 'protected-epoch-1',
        SNAPBACK_VISIBILITY_OBSERVER_KEY_DIGEST: protectedKeyDigest,
        SNAPBACK_VISIBILITY_QUARANTINE_HEAD:
          governanceDigest('snapback:visibility-quarantine-head:v1', []),
        ...protectedConfigEnv(root, creationConfig),
      },
      event: {
        providerProfile: 'github-push-v1',
        eventId: 'protected-creation-laundering-event',
        repository: 'fixture/repository',
        authenticated: true,
        deliveredAt: '2026-08-15T20:01:00Z',
        commands: [{
          ref: 'refs/heads/main',
          beforeOid: '0'.repeat(40),
          afterOid: after,
          creationService: 'protected-single-ref',
          mergeBaseOid: before,
        }],
      },
    });
    assert.equal(creationResult.red, 1,
      'approval-on-anchor plus widening-on-new-ref laundering must remain red');
    assert.throws(
      () => runMissingEventReconciler({
        root,
        env: protectedConfigEnv(root, {
          ...governanceConfig,
          observerKeys: protectedRegistry,
        }),
        ledger: {
          schemaVersion: 'snapback.visibility-governance-external-event-ledger.v1',
          externallyAttested: true,
          verdicts: [],
          ledgerHeadDigest: governanceDigest(
            'snapback:visibility-governance-external-event-ledger:v1',
            [],
          ),
        },
      }),
      ({ code }) => code === 'SNAPBACK_TABLE_VISIBILITY_GOVERNANCE_REMOTE_CUSTODY_UNAVAILABLE',
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
