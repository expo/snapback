// Public-client orchestration helpers for the LLP 0157/0166 hydration seam.
// Generated application artifacts are the only activation source; mutable
// carrier state supplies lease custody and fragments, never trust roots.

import {
  authorizedLeaseActivationHash,
  authorizedLeaseHash,
  deriveAuthorizedLeaseCommit,
  validateAuthorizedLease,
} from '@expo/snapback-contract/authorized-lease';
import { snapbackAuthFingerprint } from '@expo/snapback-contract/client-store';

import { canonicalizeClientValueV1 } from './canonical-client-value.mjs';
import { deriveGeneratedLocalReadCoverageV1 } from './local-read-admission.mjs';
import {
  decodeMaterializationRecordV1,
  materializationAddressKey,
} from './materialization-store.mjs';
import { base64UrlNoPad, hex, jcsBytes, sha256 } from './rqs.mjs';

const utf8 = new TextEncoder();
const RETAINED_CLASSES = new Set([
  'opaque-authorized-snapshot-v1',
  'result-transform-snapshot-v1',
  'rqs-authority-independent-snapshot-v1',
]);
const AUTHORIZED_CLASSES = new Set([
  'opaque-authorized-snapshot-v1',
  'result-transform-snapshot-v1',
]);

const concat = (...parts) => {
  const bytes = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0));
  let offset = 0;
  for (const part of parts) {
    bytes.set(part, offset);
    offset += part.length;
  }
  return bytes;
};

const domainDigest = (domain, value) => (
  `sha256:${hex(sha256(concat(utf8.encode(domain), jcsBytes(value))))}`
);

const generatedFunctionIdentity = (ref) => ({
  artifactKind: ref.artifactKind,
  schemaVersion: ref.schemaVersion,
  appId: ref.appId,
  id: ref.id,
  name: ref.name,
  kind: ref.kind,
  implementationHash: ref.implementationHash,
  argsContractHash: ref.argsContractHash,
  resultContractHash: ref.resultContractHash,
  ...(ref.authoredSourceHash === undefined ? {} : {
    authoredSourceHash: ref.authoredSourceHash,
  }),
  expectedGeneration: structuredClone(ref.expectedGeneration),
});

const inputAuth = (userId) => ({
  principal: userId,
  session_id: null,
  user_id: userId,
});

// @ref LLP 0157#d2--plan-identity — AuthorityPartitionV1 is an owner-issued
// input to every qmk1 address. The client hashes the server-issued authority
// snapshot; callers never substitute the pre-Move-2 authority-independent
// sentinel or author a partition digest themselves.
export function deriveAuthorityPartitionDigestV1({
  userId = null,
  authorizationScope,
  session = null,
} = {}) {
  if (
    !authorizationScope?.principalScope
    || !authorizationScope?.authorityDescriptor
  ) return null;
  const invocationUserId = typeof userId === 'string' ? userId : null;
  const principalUserId = typeof authorizationScope.principalScope.userId === 'string'
    ? authorizationScope.principalScope.userId
    : null;
  const authorityPartition = {
    format: 'snapback.authority-partition.v1',
    principalDataScope: {
      authMode: authorizationScope.principalScope.authMode,
      userId: principalUserId,
      authorizationStreamIncarnation:
        authorizationScope.principalScope.authorizationStreamIncarnation,
    },
    authorityInstanceId: authorizationScope.authorityDescriptor.authorityInstanceId,
    authFingerprint: snapbackAuthFingerprint(inputAuth(invocationUserId)),
    tenantId: null,
    providerId: authorizationScope.principalScope.authMode === 'sessions'
      ? session?.provider?.key ?? null
      : null,
    delegation: null,
  };
  return domainDigest('snapback:authority-partition:v1:', authorityPartition);
}

const nodesFromPlan = (plan) => plan.nodes.map((entry) => ({
  position: entry.position,
  classId: entry.nodePlan.classId,
  classVersion: entry.nodePlan.classVersion,
  nodePlanHash: entry.nodePlanHash,
}));

// Generated composition bytes are transported through application code, but
// their identities are owner-defined. Reproduce every hash before consuming
// classification (especially retention): changing a protected plan's class
// or retention label without rotating its identities is a refusal, never an
// admission shortcut.
// @ref LLP 0157#d2--plan-identity — PlanHashV1 and NodePlanHashV1 bind the
// complete normalized plan and node plans consumed by the materialization.
function compositionIdentityReproduces(composition) {
  const plan = composition?.normalizedCompositePlan;
  if (
    plan === null
    || typeof plan !== 'object'
    || Array.isArray(plan)
    || !Array.isArray(plan.nodes)
    || plan.nodes.length === 0
  ) return false;
  for (let index = 0; index < plan.nodes.length; index += 1) {
    const entry = plan.nodes[index];
    if (
      entry?.position !== index
      || entry.nodePlan === null
      || typeof entry.nodePlan !== 'object'
      || Array.isArray(entry.nodePlan)
      || domainDigest('snapback:node-plan:v1:', entry.nodePlan) !== entry.nodePlanHash
    ) return false;
  }
  return domainDigest('snapback:plan-hash:v1:', plan) === composition.planHash;
}

const generatedInputs = (ref, args) => {
  const activation = ref?.artifacts?.trustedCompositionActivation ?? null;
  const composition = ref?.composition ?? null;
  if (
    activation === null
    || composition === null
    || !compositionIdentityReproduces(composition)
    || ref?.artifactKind !== 'functionReference'
    || ref?.kind !== 'LiveQuery'
  ) return null;
  const activationIdentity = activation.activation;
  // @ref LLP 0157#amendment--2026-08-10-toolchain-stable-activation-identity-ruled
  // — legacy references bind v1's exact generation; v2 references bind the
  // authored-byte identity and keep their current generation for transport.
  const v1Matches = activationIdentity?.format === 'snapback.composition-activation.v1'
    && JSON.stringify(activationIdentity.expectedGeneration) === JSON.stringify(ref.expectedGeneration);
  const v2Matches = activationIdentity?.format === 'snapback.composition-activation.v2'
    && activationIdentity.authoredSourceHash === ref.authoredSourceHash;
  if (
    activation.format !== 'snapback.trusted-composition-activation.v1'
    || (!v1Matches && !v2Matches)
    || ref.expectedGeneration?.appId !== ref.appId
  ) return null;
  const canonicalArgs = JSON.parse(canonicalizeClientValueV1(args));
  return {
    activation,
    composition,
    canonicalArgs,
    argsDigest: domainDigest('snapback:materialization-args:v1:', canonicalArgs),
  };
};

export function deriveGeneratedMaterializationBridge({
  ref,
  args,
  userId = null,
  clientStoreId,
  authorizationScope,
  durableCarrier,
  persistResume,
  authorizedLeaseAvailable = false,
}) {
  const generated = generatedInputs(ref, args);
  if (
    generated === null
    || typeof clientStoreId !== 'string'
    || !authorizationScope?.principalScope
    || !authorizationScope?.authorityDescriptor
  ) return null;
  const { activation, composition, canonicalArgs, argsDigest } = generated;
  if (activation.activation.authMode !== authorizationScope.principalScope.authMode) return null;
  const session = authorizationScope.session ?? null;
  const authorityPartitionDigest = deriveAuthorityPartitionDigestV1({
    userId,
    authorizationScope,
    session,
  });
  const preimage = {
    format: 'snapback.query-materialization.v1',
    appId: ref.appId,
    databaseId: activation.activation.databaseId,
    deploymentId: activation.activation.deploymentId,
    targetProfileId: activation.activation.targetProfileId,
    activationHash: activation.activationHash,
    function: generatedFunctionIdentity(ref),
    planHash: composition.planHash,
    canonicalArgs,
    authorityPartitionDigest,
  };
  const materializationKey = `qmk1.${base64UrlNoPad(sha256(concat(
    utf8.encode('snapback:query-materialization:v1:'),
    jcsBytes(preimage),
  )))}`;
  const address = [
    'snapback:client-materialization-address:v1',
    clientStoreId,
    materializationKey,
  ];
  const retentionClass = composition.normalizedCompositePlan?.classification?.retention ?? 'none';
  const declaredRetained = RETAINED_CLASSES.has(retentionClass);
  const declaredAuthorized = AUTHORIZED_CLASSES.has(retentionClass);
  const retentionRequested = persistResume === true
    && durableCarrier === true
    && declaredRetained
    && (!declaredAuthorized || authorizedLeaseAvailable === true);
  const leaseRequired = retentionRequested && declaredAuthorized;
  const localReadCoverage = deriveGeneratedLocalReadCoverageV1({
    ref,
    materializationKey,
  });
  return Object.freeze({
    activation: structuredClone(activation),
    address: Object.freeze(address),
    addressKey: materializationAddressKey(address),
    argsDigest,
    authorityPartitionDigest,
    canonicalArgs,
    identities: {
      planHash: composition.planHash,
      activationHash: activation.activationHash,
      argsDigest,
      authorityPartitionDigest,
        storageProfile: retentionRequested ? 'durable-fragments-v1' : 'volatile-online-v1',
        authorityState: {
        query_instance_id: null,
        query_lifecycle: 'active',
        authority_generation: 0,
        query_generation: 0,
        authority_instance_id: authorizationScope.authorityDescriptor.authorityInstanceId,
        expected_boot_issuer: null,
        expected_authorization: {
          incarnation: authorizationScope.principalScope.authorizationStreamIncarnation,
          epoch: 0,
          version_stream: activation.activation.databaseId,
        },
        effective_disposition: 'retain',
        accepted: null,
        retired_issuer_frontier: null,
        retired_scope_frontier: null,
        pending_by_scope: {},
        scope_state: {},
      },
    },
    nodes: nodesFromPlan(composition.normalizedCompositePlan),
    resultContract: structuredClone(composition.resultContract),
    resultContractHash: ref.resultContractHash,
    localReadCoverage,
    retentionClass,
    retentionRequested,
    leaseRequired,
    leaseExpectation: leaseRequired ? {
      principalId: session?.authority?.userId ?? null,
      activationHash: authorizedLeaseActivationHash({
        schemaVersion: ref.expectedGeneration.schemaVersion,
        authMode: activation.activation.authMode,
        appId: ref.expectedGeneration.appId,
        schemaHash: ref.expectedGeneration.schemaHash,
        bundleHash: ref.expectedGeneration.bundleHash,
        inputsHash: ref.expectedGeneration.inputsHash,
      }),
      authorityInstanceId: authorizationScope.authorityDescriptor.authorityInstanceId,
    } : null,
  });
}

// Offline relaunch cannot discover current session authority from a dead
// server. Select only the unique retained record already bound to this exact
// generated activation, plan, canonical arguments, and store identity. The
// subsequent custody and L2 proof checks still validate the full qmk1 record;
// ambiguity is unknown, never "pick the newest".
// @ref LLP 0166#d4--completeness-honest-local-answers — retained launch is authoritative only after the same proof/lease validation as a connected read.
export async function findRetainedGeneratedMaterializationBridge({
  ref,
  args,
  clientStoreId,
  storeHandle,
  durableCarrier,
  persistResume,
}) {
  const generated = generatedInputs(ref, args);
  if (
    generated === null
    || durableCarrier !== true
    || persistResume !== true
    || typeof storeHandle?.materializationTransaction !== 'function'
  ) return null;
  const { activation, composition, canonicalArgs, argsDigest } = generated;
  const retentionClass = composition.normalizedCompositePlan?.classification?.retention ?? 'none';
  if (!RETAINED_CLASSES.has(retentionClass)) return null;
  const candidates = await storeHandle.materializationTransaction('readonly', (view) => (
    [...view.materializations.values()]
      .map(decodeMaterializationRecordV1)
      .filter((record) => (
        record !== null
        && record.address[1] === clientStoreId
        && record.address[2].startsWith('qmk1.')
        && record.activationHash === activation.activationHash
        && record.planHash === composition.planHash
        && record.argsDigest === argsDigest
        && record.storageProfile === 'durable-fragments-v1'
        && record.productState.freshness === 'retained'
      ))
  ));
  if (candidates.length !== 1) return null;
  const record = candidates[0];
  const address = [...record.address];
  const custody = await storeHandle.materializationTransaction('readonly', (view) => (
    view.storeMeta.materializationLeaseCustody[materializationAddressKey(address)] ?? null
  ));
  const leaseRequired = AUTHORIZED_CLASSES.has(retentionClass);
  const localReadCoverage = deriveGeneratedLocalReadCoverageV1({
    ref,
    materializationKey: address[2],
  });
  return Object.freeze({
    activation: structuredClone(activation),
    address: Object.freeze(address),
    addressKey: materializationAddressKey(address),
    argsDigest,
    authorityPartitionDigest: record.authorityPartitionDigest,
    canonicalArgs,
    identities: {
      planHash: record.planHash,
      activationHash: record.activationHash,
      argsDigest: record.argsDigest,
      authorityPartitionDigest: record.authorityPartitionDigest,
      storageProfile: record.storageProfile,
      authorityState: structuredClone(record.authorityState),
    },
    nodes: nodesFromPlan(composition.normalizedCompositePlan),
    resultContract: structuredClone(composition.resultContract),
    resultContractHash: ref.resultContractHash,
    localReadCoverage,
    retentionClass,
    retentionRequested: true,
    leaseRequired,
    leaseExpectation: leaseRequired ? {
      principalId: custody?.lease?.principalId ?? null,
      activationHash: authorizedLeaseActivationHash({
        schemaVersion: ref.expectedGeneration.schemaVersion,
        authMode: activation.activation.authMode,
        appId: ref.expectedGeneration.appId,
        schemaHash: ref.expectedGeneration.schemaHash,
        bundleHash: ref.expectedGeneration.bundleHash,
        inputsHash: ref.expectedGeneration.inputsHash,
      }),
      authorityInstanceId: record.authorityState.authority_instance_id,
    } : null,
  });
}

const custodyValidShape = (value) => (
  value?.format === 'snapback.materialization-lease-custody.v1'
  && value.lease
  && typeof value.leaseHash === 'string'
  && Number.isSafeInteger(value.clientDeadlineMs)
  && Number.isSafeInteger(value.clockHighWaterMs)
  && value.witness?.format === 'snapback.authorization-witness.v1'
  && Number.isSafeInteger(value.witness.queryInstanceId)
  && typeof value.witness.compositeWitness?.authorization?.incarnation === 'string'
  && Number.isSafeInteger(value.witness.compositeWitness.authorization.epoch)
  && typeof value.witness.compositeWitness?.data?.versionStream === 'string'
  && Number.isSafeInteger(value.witness.compositeWitness.data.minCommitVersion)
);

export async function loadMaterializationLeaseCustody(storeHandle, bridge, now = Date.now()) {
  if (!bridge.leaseRequired || !storeHandle?.materializationTransaction) {
    return { leaseStatus: 'not-required', authorizedLeaseHash: null, witness: null };
  }
  return storeHandle.materializationTransaction('readwrite', (view) => {
    const custody = view.storeMeta.materializationLeaseCustody[bridge.addressKey] ?? null;
    const record = decodeMaterializationRecordV1(view.materializations.get(bridge.addressKey));
    const invalidate = () => {
      delete view.storeMeta.materializationLeaseCustody[bridge.addressKey];
      return { leaseStatus: 'invalid', authorizedLeaseHash: null, witness: null };
    };
    if (!custodyValidShape(custody) || record === null) return invalidate();
    let lease;
    try { lease = validateAuthorizedLease(custody.lease); } catch { return invalidate(); }
    if (
      authorizedLeaseHash(lease) !== custody.leaseHash
      || lease.clientStoreId !== bridge.address[1]
      || lease.queryKey !== bridge.address[2]
      || lease.queryInstanceId !== record.queryInstanceId
      || lease.principalId !== bridge.leaseExpectation.principalId
      || lease.activationHash !== bridge.leaseExpectation.activationHash
      || lease.authorityInstanceId !== bridge.leaseExpectation.authorityInstanceId
      || custody.witness.queryInstanceId !== record.queryInstanceId
      || custody.witness.compositeWitness.authorization.incarnation
        !== lease.authorization.incarnation
      || custody.witness.compositeWitness.authorization.epoch !== lease.authorization.epoch
      || custody.witness.compositeWitness.data.versionStream !== lease.data.versionStream
      || custody.witness.compositeWitness.data.minCommitVersion
        !== lease.data.snapshotCommitVersion
      || now < custody.clockHighWaterMs
      || now >= custody.clientDeadlineMs
    ) return invalidate();
    custody.clockHighWaterMs = now;
    view.storeMeta.materializationLeaseCustody[bridge.addressKey] = custody;
    return {
      leaseStatus: 'valid',
      authorizedLeaseHash: custody.leaseHash,
      witness: structuredClone(custody.witness),
    };
  });
}

export async function commitMaterializationLeaseCustody({
  storeHandle,
  bridge,
  record,
  witness,
  lease,
  leaseRequestId,
  startedClientMs,
  clientNowMs,
}) {
  const authorization = witness.compositeWitness.authorization;
  const data = witness.compositeWitness.data;
  const derived = deriveAuthorizedLeaseCommit({
    lease,
    request: {
      leaseRequestId,
      queryInstanceId: record.queryInstanceId,
      queryGeneration: record.authorityState.query_generation,
      startedClientMs,
    },
    expected: {
      clientStoreId: bridge.address[1],
      queryKey: bridge.address[2],
      queryInstanceId: record.queryInstanceId,
      principalId: bridge.leaseExpectation.principalId,
      authorization,
      versionStream: data.versionStream,
      activationHash: bridge.leaseExpectation.activationHash,
      authorityInstanceId: bridge.leaseExpectation.authorityInstanceId,
    },
    clientNowMs,
  });
  await storeHandle.materializationTransaction('readwrite', (view) => {
    view.storeMeta.materializationLeaseCustody[bridge.addressKey] = {
      format: 'snapback.materialization-lease-custody.v1',
      lease: structuredClone(derived.lease),
      leaseHash: derived.leaseHash,
      clientDeadlineMs: derived.clientDeadlineMs,
      clockHighWaterMs: clientNowMs,
      witness: structuredClone(witness),
    };
  });
  return Object.freeze({
    leaseStatus: 'valid',
    authorizedLeaseHash: derived.leaseHash,
    witness: structuredClone(witness),
  });
}

export function materializationFence(record) {
  return {
    queryInstanceId: record.queryInstanceId,
    authorityGeneration: record.authorityState.authority_generation,
    queryGeneration: record.authorityState.query_generation,
  };
}

export function authorityStateForWitness(record, witness) {
  return {
    ...structuredClone(record.authorityState),
    query_generation: record.authorityState.query_generation + 1,
    expected_authorization: {
      incarnation: witness.compositeWitness.authorization.incarnation,
      epoch: witness.compositeWitness.authorization.epoch,
      version_stream: witness.compositeWitness.data.versionStream,
    },
  };
}

export function retainedFailureTransition(reason, record) {
  const disposition = reason === 'witness-newer-epoch' ? 'quarantine' : 'delete';
  return {
    authorityState: {
      ...structuredClone(record.authorityState),
      query_generation: record.authorityState.query_generation + 1,
      effective_disposition: disposition,
    },
    ...(disposition === 'delete' ? {
      tombstone: {
        format: 'snapback.materialization-owner-tombstone.v1',
        reason,
        queryInstanceId: record.queryInstanceId,
      },
    } : {}),
  };
}
