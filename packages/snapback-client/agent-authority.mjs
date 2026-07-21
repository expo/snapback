// Headless agent credential custody and stale-work fencing.
//
// This is deliberately separate from AuthCoordinator: CLI and daemon agents
// own scoped-token custody, while AuthCoordinator owns interactive browser
// session custody and its cross-surface clearing barrier.
//
// @ref LLP 0055#grant-backed-live-and-queued-replay — durable queued work is
// keyed by the grant tuple while live publication is additionally fenced by
// the exact token carrier generation.

import {
  canonicalAgentAuthorityKey,
  deriveServiceAuthorityInstanceId,
} from '@snapback/contract/auth-coordinator';

const UUID_V7 = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

const requireUuid = (value, name) => {
  if (!UUID_V7.test(value ?? '')) throw new TypeError(`${name} must be a UUIDv7`);
  return value;
};

const requireGeneration = (value) => {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new TypeError('credentialGeneration must be a non-negative safe integer');
  }
  return value;
};

const requireBearer = (value) => {
  if (typeof value !== 'string' || value.length === 0) {
    throw new TypeError('bearerToken must be a non-empty string');
  }
  return value;
};

const durableAuthority = ({ actorUserId, credentialId, credentialGeneration, grantId }) => (
  Object.freeze({
    kind: 'servicePrincipal',
    authMode: 'sessions',
    actorUserId,
    credentialId,
    credentialGeneration,
    grantId,
  })
);

const authorityCapture = (authorityEpoch, authorityKey, carrierGeneration, tokenId) => (
  Object.freeze({ authorityEpoch, authorityKey, carrierGeneration, tokenId })
);

const sameAuthorityCapture = (left, right) => (
  left !== null
  && right !== null
  && left !== undefined
  && right !== undefined
  && left?.authorityEpoch === right?.authorityEpoch
  && left?.authorityKey === right?.authorityKey
  && left?.carrierGeneration === right?.carrierGeneration
  && left?.tokenId === right?.tokenId
);

const normalizeCredential = (value) => Object.freeze({
  actorUserId: requireUuid(value?.actorUserId, 'actorUserId'),
  credentialId: requireUuid(value?.credentialId, 'credentialId'),
  credentialGeneration: requireGeneration(value?.credentialGeneration),
  grantId: requireUuid(value?.grantId, 'grantId'),
  tokenId: requireUuid(value?.tokenId, 'tokenId'),
  bearerToken: requireBearer(value?.bearerToken),
});

const descriptorKey = (descriptor) => {
  if (
    descriptor?.descriptorVersion !== 1
    || !UUID_V7.test(descriptor?.authorityInstanceId ?? '')
    || descriptor?.sessionGeneration !== 0
  ) {
    throw new TypeError('agent authority descriptor must be a protocol-v1 service descriptor');
  }
  return descriptor.authorityInstanceId;
};

const fenceError = (code, message, details = undefined) => {
  const error = new Error(`${code}: ${message}`);
  error.code = code;
  error.diagnostic = {
    code,
    message,
    ...(details === undefined ? {} : { details }),
  };
  return error;
};

const stale = (message = 'the operation completed under a stale agent authority') => (
  fenceError('SNAPBACK_CLIENT_AUTHORITY_STALE', message)
);

const credentialValidationRequired = () => fenceError(
  'SNAPBACK_CLIENT_AGENT_CREDENTIAL_VALIDATION_REQUIRED',
  'an agent credential must complete a service-principal handshake before durable custody can initialize, adopt, recover, or replace it',
);

const custodyCorrupt = (message, details = undefined) => (
  fenceError('SNAPBACK_AUTH_CUSTODY_CORRUPT', message, details)
);

const participantReentrant = (operation) => fenceError(
  'SNAPBACK_AUTH_CUSTODY_PARTICIPANT_REENTRANT',
  `agent authority ${operation} cannot join its active durable participant callback`,
);

const durableCounterExhausted = (record) => fenceError(
  'SNAPBACK_AUTH_CUSTODY_COUNTER_EXHAUSTED',
  'durable agent custody is permanently closed because a monotonic counter is exhausted',
  {
    authorityEpoch: record?.authorityEpoch ?? null,
    revision: record?.revision ?? null,
  },
);

const isDurableCounterExhaustion = (error) => (
  error?.code === 'SNAPBACK_AUTH_CUSTODY_COUNTER_EXHAUSTED'
  || error?.code === 'SNAPBACK_AUTH_CUSTODY_REVISION_EXHAUSTED'
  || error?.code === 'SNAPBACK_AUTH_AUTHORITY_EPOCH_EXHAUSTED'
);

const durableCounterPoison = (record) => {
  if (record === null || record === undefined) return null;
  if (record.phase === 'exhausted') return durableCounterExhausted(record);
  // A legacy clearing record may already carry the final epoch/revision. Its
  // transition participant must replay before any terminal marker may discard
  // that intent, so clearing poison is handled by the recovery plans below.
  if (record.phase === 'clearing') return null;
  if (record.revision === Number.MAX_SAFE_INTEGER) {
    return fenceError(
      'SNAPBACK_AUTH_CUSTODY_REVISION_EXHAUSTED',
      'agent custody revision is exhausted and cannot admit durable publication',
    );
  }
  if (record.authorityEpoch === Number.MAX_SAFE_INTEGER) {
    return fenceError(
      'SNAPBACK_AUTH_AUTHORITY_EPOCH_EXHAUSTED',
      'agent authority epoch is exhausted and cannot admit durable publication',
    );
  }
  return null;
};

const clone = (value) => (value === null || value === undefined
  ? value
  : JSON.parse(JSON.stringify(value)));

const encodedJsonByteLength = (value) => new TextEncoder()
  .encode(`${JSON.stringify(value)}\n`).byteLength;

const exactKeys = (value, expected, where) => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw custodyCorrupt(`${where} must be an object`);
  }
  const actual = Object.keys(value).sort();
  const wanted = [...expected].sort();
  if (actual.length !== wanted.length || actual.some((key, index) => key !== wanted[index])) {
    throw custodyCorrupt(`${where} has an invalid field set`, { fields: actual });
  }
};

const INTERNAL_CUSTODY_PREFIXES = Object.freeze([
  'snapback.agent-custody-gate.v1:',
  'snapback.agent-terminal-witness.v1:',
  'snapback.agent-terminal-ledger.v2:',
  'snapback.agent-terminal-bucket.v2:',
]);

export const AGENT_CUSTODY_PARTITION_OWNERSHIP = 'partitioned-v2';

const TERMINAL_LEDGER_ROOT_PREFIX = 'snapback.agent-terminal-ledger.v2:';
const TERMINAL_LEDGER_BUCKET_PREFIX = 'snapback.agent-terminal-bucket.v2:';
const LEGACY_TERMINAL_WITNESS_PREFIX = 'snapback.agent-terminal-witness.v1:';
const TERMINAL_LEDGER_DEFAULT_BUCKET_COUNT = 64;
const TERMINAL_LEDGER_DEFAULT_BUCKET_CAPACITY = 64;
const TERMINAL_LEDGER_MAX_BUCKET_COUNT = 64;
const TERMINAL_LEDGER_MAX_BUCKET_CAPACITY = 64;
const TERMINAL_LEDGER_SCAN_PAGE = 128;
const TERMINAL_LEDGER_MAX_SCANNED_PARTITIONS = 4_096;
const TERMINAL_LEDGER_WARNING_NUMERATOR = 3;
const TERMINAL_LEDGER_WARNING_DENOMINATOR = 4;

const normalizeCustodyPartitionId = (value) => {
  if (
    typeof value !== 'string'
    || value.length === 0
    || value.length > 1_024
    || /[\u0000-\u001f\u007f-\u009f]/u.test(value)
  ) {
    throw new TypeError('custodyId must be a stable non-empty string without control characters');
  }
  return value;
};

const normalizeCustodyId = (value) => {
  normalizeCustodyPartitionId(value);
  if (
    value.length > 512
    || INTERNAL_CUSTODY_PREFIXES.some((prefix) => value.startsWith(prefix))
  ) {
    throw new TypeError('custodyId is too long or uses a reserved internal namespace');
  }
  return value;
};

const custodyGateIdFor = (custodyId) => normalizeCustodyPartitionId(
  `snapback.agent-custody-gate.v1:${custodyId}`,
);

const terminalWitnessIdFor = (custodyId, authorityKey) => normalizeCustodyPartitionId(
  `${LEGACY_TERMINAL_WITNESS_PREFIX}${authorityKey}:${custodyId}`,
);

const terminalLedgerRootIdFor = (custodyId) => normalizeCustodyPartitionId(
  `${TERMINAL_LEDGER_ROOT_PREFIX}${custodyId}`,
);

const terminalLedgerBucketIdFor = (custodyId, bucketIndex) => normalizeCustodyPartitionId(
  `${TERMINAL_LEDGER_BUCKET_PREFIX}${bucketIndex}:${custodyId}`,
);

const legacyTerminalWitnessKeyFromId = (partitionId, custodyId) => {
  const suffix = `:${custodyId}`;
  if (
    typeof partitionId !== 'string'
    || !partitionId.startsWith(LEGACY_TERMINAL_WITNESS_PREFIX)
    || !partitionId.endsWith(suffix)
  ) return null;
  const authorityKey = partitionId.slice(
    LEGACY_TERMINAL_WITNESS_PREFIX.length,
    -suffix.length,
  );
  return /^sha256:[a-f0-9]{64}$/u.test(authorityKey)
    && terminalWitnessIdFor(custodyId, authorityKey) === partitionId
    ? authorityKey
    : null;
};

const terminalLedgerBucketIndexFromId = (partitionId, custodyId) => {
  const suffix = `:${custodyId}`;
  if (
    typeof partitionId !== 'string'
    || !partitionId.startsWith(TERMINAL_LEDGER_BUCKET_PREFIX)
    || !partitionId.endsWith(suffix)
  ) return null;
  const encodedIndex = partitionId.slice(TERMINAL_LEDGER_BUCKET_PREFIX.length, -suffix.length);
  if (!/^(?:0|[1-9][0-9]*)$/u.test(encodedIndex)) return null;
  const bucketIndex = Number(encodedIndex);
  return Number.isSafeInteger(bucketIndex)
    && terminalLedgerBucketIdFor(custodyId, bucketIndex) === partitionId
    ? bucketIndex
    : null;
};

const terminalLedgerBucketIndexFor = (authorityKey, bucketCount) => {
  if (!/^sha256:[a-f0-9]{64}$/u.test(authorityKey ?? '')) {
    throw custodyCorrupt('agent terminal-ledger authorityKey is invalid');
  }
  return Number.parseInt(authorityKey.slice('sha256:'.length, 'sha256:'.length + 8), 16)
    % bucketCount;
};

const normalizeTerminalLedgerParameters = (value = null) => {
  const bucketCount = value?.bucketCount ?? TERMINAL_LEDGER_DEFAULT_BUCKET_COUNT;
  const bucketCapacity = value?.bucketCapacity ?? TERMINAL_LEDGER_DEFAULT_BUCKET_CAPACITY;
  if (
    !Number.isSafeInteger(bucketCount)
    || bucketCount < 1
    || bucketCount > TERMINAL_LEDGER_MAX_BUCKET_COUNT
    || !Number.isSafeInteger(bucketCapacity)
    || bucketCapacity < 1
    || bucketCapacity > TERMINAL_LEDGER_MAX_BUCKET_CAPACITY
  ) {
    throw new TypeError('terminalLedgerParameters must use positive bucket bounds no larger than 64');
  }
  return Object.freeze({ bucketCount, bucketCapacity });
};

const terminalLedgerScanLimit = () => fenceError(
  'SNAPBACK_AUTH_CUSTODY_PARTITION_SCAN_LIMIT',
  'agent custody partition scan exceeded its bounded migration budget',
  { maximumEntries: TERMINAL_LEDGER_MAX_SCANNED_PARTITIONS },
);

const normalizeDurableAuthority = (value) => {
  exactKeys(value, [
    'kind',
    'authMode',
    'actorUserId',
    'credentialId',
    'credentialGeneration',
    'grantId',
  ], 'agent custody authority');
  if (value.kind !== 'servicePrincipal' || value.authMode !== 'sessions') {
    throw custodyCorrupt('agent custody authority must be a sessions service principal');
  }
  return durableAuthority({
    actorUserId: requireUuid(value.actorUserId, 'actorUserId'),
    credentialId: requireUuid(value.credentialId, 'credentialId'),
    credentialGeneration: requireGeneration(value.credentialGeneration),
    grantId: requireUuid(value.grantId, 'grantId'),
  });
};

const sameDurableAuthority = (left, right) => (
  left?.kind === right?.kind
  && left?.authMode === right?.authMode
  && left?.actorUserId === right?.actorUserId
  && left?.credentialId === right?.credentialId
  && left?.credentialGeneration === right?.credentialGeneration
  && left?.grantId === right?.grantId
);

const transitionIdFor = ({
  custodyId,
  expectedRevision,
  expectedEpoch,
  expectedAuthorityKey,
  previousStatus,
  nextEpoch,
  nextAuthorityKey,
  nextStatus,
  reason,
  disposition,
}) => `agent-transition-v1:${JSON.stringify({
  custodyId,
  expectedRevision,
  expectedEpoch,
  expectedAuthorityKey,
  previousStatus,
  nextEpoch,
  nextAuthorityKey,
  nextStatus,
  reason,
  disposition,
})}`;

const validateTransition = (value, custodyId) => {
  exactKeys(value, [
    'formatVersion',
    'transitionId',
    'expectedRevision',
    'expectedEpoch',
    'expectedAuthorityKey',
    'previousStatus',
    'previousAuthority',
    'nextEpoch',
    'nextAuthorityKey',
    'nextStatus',
    'nextAuthority',
    'reason',
    'disposition',
  ], 'agent custody transition');
  if (value.formatVersion !== 1) {
    throw custodyCorrupt('agent custody transition formatVersion must be 1');
  }
  const hasPredecessor = value.expectedRevision !== null;
  if (hasPredecessor) {
    if (!Number.isSafeInteger(value.expectedRevision) || value.expectedRevision <= 0) {
      throw custodyCorrupt('agent custody transition expectedRevision must be positive or null');
    }
    if (!Number.isSafeInteger(value.expectedEpoch) || value.expectedEpoch < 0) {
      throw custodyCorrupt('agent custody transition expectedEpoch must be non-negative');
    }
    if (value.previousStatus !== 'active' && value.previousStatus !== 'deleted') {
      throw custodyCorrupt('agent custody transition previousStatus is invalid');
    }
  } else if (
    value.expectedEpoch !== null
    || value.expectedAuthorityKey !== null
    || value.previousStatus !== null
    || value.previousAuthority !== null
  ) {
    throw custodyCorrupt('fresh agent custody transition must have a null predecessor');
  }
  const previousAuthority = hasPredecessor
    ? normalizeDurableAuthority(value.previousAuthority)
    : null;
  if (
    hasPredecessor
    && canonicalAgentAuthorityKey(previousAuthority) !== value.expectedAuthorityKey
  ) {
    throw custodyCorrupt('agent custody transition predecessor key is inconsistent');
  }
  if (!Number.isSafeInteger(value.nextEpoch) || value.nextEpoch < 0) {
    throw custodyCorrupt('agent custody transition nextEpoch must be non-negative');
  }
  if (
    (hasPredecessor && value.nextEpoch !== value.expectedEpoch + 1)
    || (!hasPredecessor && value.nextEpoch !== 0)
  ) {
    throw custodyCorrupt('agent custody transition epochs must be consecutive (or begin at zero)');
  }
  if (value.nextStatus !== 'active' && value.nextStatus !== 'deleted') {
    throw custodyCorrupt('agent custody transition nextStatus is invalid');
  }
  const nextAuthority = normalizeDurableAuthority(value.nextAuthority);
  if (canonicalAgentAuthorityKey(nextAuthority) !== value.nextAuthorityKey) {
    throw custodyCorrupt('agent custody transition successor key is inconsistent');
  }
  if (hasPredecessor) {
    const validEnding = value.previousStatus === 'active'
      && value.nextStatus === 'deleted'
      && value.expectedAuthorityKey === value.nextAuthorityKey;
    const validReplacement = value.nextStatus === 'active'
      && value.expectedAuthorityKey !== value.nextAuthorityKey;
    if (!validEnding && !validReplacement) {
      throw custodyCorrupt('agent custody transition is neither an exact deletion nor a distinct tuple replacement');
    }
  }
  if (typeof value.reason !== 'string' || value.reason.length === 0) {
    throw custodyCorrupt('agent custody transition reason is missing');
  }
  if (value.disposition !== 'retain' && value.disposition !== 'delete') {
    throw custodyCorrupt('agent custody transition disposition is invalid');
  }
  const normalized = {
    formatVersion: 1,
    transitionId: value.transitionId,
    expectedRevision: value.expectedRevision,
    expectedEpoch: value.expectedEpoch,
    expectedAuthorityKey: value.expectedAuthorityKey,
    previousStatus: value.previousStatus,
    previousAuthority,
    nextEpoch: value.nextEpoch,
    nextAuthorityKey: value.nextAuthorityKey,
    nextStatus: value.nextStatus,
    nextAuthority,
    reason: value.reason,
    disposition: value.disposition,
  };
  if (value.transitionId !== transitionIdFor({ custodyId, ...normalized })) {
    throw custodyCorrupt('agent custody transitionId does not bind its exact target');
  }
  // Validate the partition here too, even though it is not repeated in the
  // intent. This keeps adapter errors attributed to the owning custody row.
  normalizeCustodyPartitionId(custodyId);
  return Object.freeze(normalized);
};

const validateCustodyRecord = (value, expectedCustodyId) => {
  const formatVersion = value?.formatVersion;
  if (formatVersion !== 1 && formatVersion !== 2) {
    throw custodyCorrupt('agent custody formatVersion must be 1 or 2');
  }
  exactKeys(value, [
    'formatVersion',
    'custodyId',
    'authorityEpoch',
    'revision',
    'phase',
    'status',
    'authorityKey',
    'authority',
    'transition',
    ...(formatVersion === 2 ? ['terminalLedgerVersion'] : []),
  ], 'agent custody record');
  if (formatVersion === 2 && value.terminalLedgerVersion !== 1) {
    throw custodyCorrupt('agent custody terminalLedgerVersion must be 1');
  }
  const custodyId = normalizeCustodyPartitionId(value.custodyId);
  if (custodyId !== expectedCustodyId) {
    throw custodyCorrupt('agent custody record belongs to a different custodyId');
  }
  if (!Number.isSafeInteger(value.authorityEpoch) || value.authorityEpoch < 0) {
    throw custodyCorrupt('agent custody authorityEpoch must be a safe non-negative integer');
  }
  if (!Number.isSafeInteger(value.revision) || value.revision <= 0) {
    throw custodyCorrupt('agent custody revision must be a safe positive integer');
  }
  if (
    value.phase !== 'settled'
    && value.phase !== 'clearing'
    && value.phase !== 'exhausted'
  ) {
    throw custodyCorrupt('agent custody phase must be settled, clearing, or exhausted');
  }
  if (value.status !== 'active' && value.status !== 'deleted') {
    throw custodyCorrupt('agent custody status must be active or deleted');
  }
  const authority = normalizeDurableAuthority(value.authority);
  const authorityKey = canonicalAgentAuthorityKey(authority);
  if (value.authorityKey !== authorityKey) {
    throw custodyCorrupt('agent custody authorityKey does not bind its durable tuple');
  }
  const transition = value.phase === 'clearing'
    ? validateTransition(value.transition, custodyId)
    : value.transition;
  if (value.phase !== 'clearing' && transition !== null) {
    throw custodyCorrupt('non-clearing agent custody cannot retain a clearing transition');
  }
  if (value.phase === 'exhausted' && value.status !== 'deleted') {
    throw custodyCorrupt('exhausted agent custody must be terminally deleted');
  }
  if (value.phase === 'clearing') {
    if (
      transition.nextEpoch !== value.authorityEpoch
      || transition.nextStatus !== value.status
      || transition.nextAuthorityKey !== authorityKey
      || !sameDurableAuthority(transition.nextAuthority, authority)
    ) {
      throw custodyCorrupt('clearing agent custody does not match its transition successor');
    }
    const expectedRevision = transition.expectedRevision === null
      ? 1
      : transition.expectedRevision + 1;
    if (!Number.isSafeInteger(expectedRevision) || value.revision !== expectedRevision) {
      throw custodyCorrupt('clearing agent custody revision does not follow its predecessor');
    }
  }
  return Object.freeze({
    formatVersion,
    custodyId,
    authorityEpoch: value.authorityEpoch,
    revision: value.revision,
    phase: value.phase,
    status: value.status,
    authorityKey,
    authority,
    transition,
    ...(formatVersion === 2 ? { terminalLedgerVersion: 1 } : {}),
  });
};

const custodyRecord = ({
  formatVersion = 2,
  custodyId,
  authorityEpoch,
  revision,
  phase = 'settled',
  status,
  authority,
  transition = null,
}) => (
  validateCustodyRecord({
    formatVersion,
    custodyId,
    authorityEpoch,
    revision,
    phase,
    status,
    authorityKey: canonicalAgentAuthorityKey(authority),
    authority,
    transition,
    ...(formatVersion === 2 ? { terminalLedgerVersion: 1 } : {}),
  }, custodyId)
);

const sameCustodyRecord = (left, right) => (
  left === null || right === null
    ? left === right
    : left.formatVersion === right.formatVersion
      && left.custodyId === right.custodyId
      && left.authorityEpoch === right.authorityEpoch
      && left.revision === right.revision
      && left.phase === right.phase
      && left.status === right.status
      && left.authorityKey === right.authorityKey
      && sameDurableAuthority(left.authority, right.authority)
      && JSON.stringify(left.transition) === JSON.stringify(right.transition)
      && left.terminalLedgerVersion === right.terminalLedgerVersion
);

const custodyTransitionRecords = ({
  formatVersion = 2,
  custodyId,
  predecessor,
  nextEpoch,
  nextStatus,
  nextAuthority,
  reason,
  disposition,
}) => {
  const clearingRevision = predecessor === null
    ? 1
    : nextSafeCounter(
      predecessor.revision,
      'SNAPBACK_AUTH_CUSTODY_REVISION_EXHAUSTED',
      'agent custody revision',
    );
  const settledRevision = nextSafeCounter(
    clearingRevision,
    'SNAPBACK_AUTH_CUSTODY_REVISION_EXHAUSTED',
    'agent custody revision',
  );
  if (settledRevision === Number.MAX_SAFE_INTEGER) {
    throw fenceError(
      'SNAPBACK_AUTH_CUSTODY_REVISION_EXHAUSTED',
      'agent custody revision must reserve its final identity for a terminal marker',
    );
  }
  const nextAuthorityKey = canonicalAgentAuthorityKey(nextAuthority);
  const transition = Object.freeze({
    formatVersion: 1,
    transitionId: transitionIdFor({
      custodyId,
      expectedRevision: predecessor?.revision ?? null,
      expectedEpoch: predecessor?.authorityEpoch ?? null,
      expectedAuthorityKey: predecessor?.authorityKey ?? null,
      previousStatus: predecessor?.status ?? null,
      nextEpoch,
      nextAuthorityKey,
      nextStatus,
      reason,
      disposition,
    }),
    expectedRevision: predecessor?.revision ?? null,
    expectedEpoch: predecessor?.authorityEpoch ?? null,
    expectedAuthorityKey: predecessor?.authorityKey ?? null,
    previousStatus: predecessor?.status ?? null,
    previousAuthority: predecessor?.authority ?? null,
    nextEpoch,
    nextAuthorityKey,
    nextStatus,
    nextAuthority,
    reason,
    disposition,
  });
  const clearing = custodyRecord({
    formatVersion,
    custodyId,
    authorityEpoch: nextEpoch,
    revision: clearingRevision,
    phase: 'clearing',
    status: nextStatus,
    authority: nextAuthority,
    transition,
  });
  const settled = custodyRecord({
    formatVersion,
    custodyId,
    authorityEpoch: nextEpoch,
    revision: settledRevision,
    phase: 'settled',
    status: nextStatus,
    authority: nextAuthority,
  });
  return Object.freeze({ transition, clearing, settled });
};

const settledRecordForClearing = (record) => {
  if (record?.phase !== 'clearing') {
    throw custodyCorrupt('agent custody recovery requires a clearing record');
  }
  return custodyRecord({
    formatVersion: 2,
    custodyId: record.custodyId,
    authorityEpoch: record.authorityEpoch,
    revision: nextSafeCounter(
      record.revision,
      'SNAPBACK_AUTH_CUSTODY_REVISION_EXHAUSTED',
      'agent custody revision',
    ),
    phase: 'settled',
    status: record.status,
    authority: record.authority,
  });
};

const validateTerminalLedgerRoot = (value, expectedCustodyId) => {
  exactKeys(value, [
    'formatVersion',
    'recordType',
    'custodyId',
    'sourceCustodyId',
    'revision',
    'phase',
    'legacyCut',
    'bucketCount',
    'bucketCapacity',
  ], 'agent terminal-ledger root');
  if (value.formatVersion !== 1 || value.recordType !== 'agentTerminalLedger') {
    throw custodyCorrupt('agent terminal-ledger root has an invalid format');
  }
  const custodyId = normalizeCustodyPartitionId(value.custodyId);
  const sourceCustodyId = normalizeCustodyId(value.sourceCustodyId);
  if (
    custodyId !== expectedCustodyId
    || custodyId !== terminalLedgerRootIdFor(sourceCustodyId)
  ) {
    throw custodyCorrupt('agent terminal-ledger root belongs to another custody partition');
  }
  if (!Number.isSafeInteger(value.revision) || value.revision < 1) {
    throw custodyCorrupt('agent terminal-ledger root revision must be positive');
  }
  if (value.phase !== 'preparing' && value.phase !== 'active' && value.phase !== 'closed') {
    throw custodyCorrupt('agent terminal-ledger root phase is invalid');
  }
  const parameters = normalizeTerminalLedgerParameters(value);
  if (typeof value.legacyCut !== 'boolean' || (value.phase === 'preparing' && value.legacyCut)) {
    throw custodyCorrupt('agent terminal-ledger legacy cut is invalid');
  }
  return Object.freeze({
    formatVersion: 1,
    recordType: 'agentTerminalLedger',
    custodyId,
    sourceCustodyId,
    revision: value.revision,
    phase: value.phase,
    legacyCut: value.legacyCut,
    ...parameters,
  });
};

const normalizeTerminalLedgerEntry = (value) => {
  exactKeys(value, ['authorityKey', 'authority'], 'agent terminal-ledger entry');
  const authority = normalizeDurableAuthority(value.authority);
  const authorityKey = canonicalAgentAuthorityKey(authority);
  if (value.authorityKey !== authorityKey) {
    throw custodyCorrupt('agent terminal-ledger entry key does not bind its exact tuple');
  }
  return Object.freeze({ authorityKey, authority });
};

const validateTerminalLedgerBucket = (value, expectedCustodyId) => {
  exactKeys(value, [
    'formatVersion',
    'recordType',
    'custodyId',
    'sourceCustodyId',
    'revision',
    'bucketIndex',
    'bucketCount',
    'bucketCapacity',
    'entries',
  ], 'agent terminal-ledger bucket');
  if (value.formatVersion !== 1 || value.recordType !== 'agentTerminalBucket') {
    throw custodyCorrupt('agent terminal-ledger bucket has an invalid format');
  }
  const custodyId = normalizeCustodyPartitionId(value.custodyId);
  const sourceCustodyId = normalizeCustodyId(value.sourceCustodyId);
  const parameters = normalizeTerminalLedgerParameters(value);
  if (
    !Number.isSafeInteger(value.bucketIndex)
    || value.bucketIndex < 0
    || value.bucketIndex >= parameters.bucketCount
    || custodyId !== expectedCustodyId
    || custodyId !== terminalLedgerBucketIdFor(sourceCustodyId, value.bucketIndex)
  ) {
    throw custodyCorrupt('agent terminal-ledger bucket identity is invalid');
  }
  if (!Number.isSafeInteger(value.revision) || value.revision < 1) {
    throw custodyCorrupt('agent terminal-ledger bucket revision must be positive');
  }
  if (!Array.isArray(value.entries) || value.entries.length > parameters.bucketCapacity) {
    throw custodyCorrupt('agent terminal-ledger bucket exceeds its fixed capacity');
  }
  const entries = value.entries.map(normalizeTerminalLedgerEntry);
  for (let index = 0; index < entries.length; index += 1) {
    const entry = entries[index];
    if (
      terminalLedgerBucketIndexFor(entry.authorityKey, parameters.bucketCount)
        !== value.bucketIndex
      || (index > 0 && entries[index - 1].authorityKey >= entry.authorityKey)
    ) {
      throw custodyCorrupt('agent terminal-ledger bucket entries are unsorted or misplaced');
    }
  }
  return Object.freeze({
    formatVersion: 1,
    recordType: 'agentTerminalBucket',
    custodyId,
    sourceCustodyId,
    revision: value.revision,
    bucketIndex: value.bucketIndex,
    ...parameters,
    entries: Object.freeze(entries),
  });
};

const validateStoredCustodyRecord = (value, expectedCustodyId) => {
  if (expectedCustodyId.startsWith(TERMINAL_LEDGER_ROOT_PREFIX)) {
    return validateTerminalLedgerRoot(value, expectedCustodyId);
  }
  if (expectedCustodyId.startsWith(TERMINAL_LEDGER_BUCKET_PREFIX)) {
    return validateTerminalLedgerBucket(value, expectedCustodyId);
  }
  return validateCustodyRecord(value, expectedCustodyId);
};

const terminalLedgerRootRecord = ({
  custodyId,
  revision,
  phase,
  legacyCut = false,
  bucketCount,
  bucketCapacity,
}) => validateTerminalLedgerRoot({
  formatVersion: 1,
  recordType: 'agentTerminalLedger',
  custodyId: terminalLedgerRootIdFor(custodyId),
  sourceCustodyId: custodyId,
  revision,
  phase,
  legacyCut,
  bucketCount,
  bucketCapacity,
}, terminalLedgerRootIdFor(custodyId));

const terminalLedgerBucketRecord = ({
  custodyId,
  revision,
  bucketIndex,
  bucketCount,
  bucketCapacity,
  entries,
}) => validateTerminalLedgerBucket({
  formatVersion: 1,
  recordType: 'agentTerminalBucket',
  custodyId: terminalLedgerBucketIdFor(custodyId, bucketIndex),
  sourceCustodyId: custodyId,
  revision,
  bucketIndex,
  bucketCount,
  bucketCapacity,
  entries,
}, terminalLedgerBucketIdFor(custodyId, bucketIndex));

const sameTerminalLedgerEntry = (left, right) => (
  left.authorityKey === right.authorityKey
  && sameDurableAuthority(left.authority, right.authority)
);

const unionTerminalLedgerEntries = (left, right) => {
  const byKey = new Map();
  for (const entry of [...left, ...right]) {
    const normalized = normalizeTerminalLedgerEntry(entry);
    const previous = byKey.get(normalized.authorityKey);
    if (previous && !sameTerminalLedgerEntry(previous, normalized)) {
      throw custodyCorrupt('agent terminal-ledger key collides across distinct tuples');
    }
    byKey.set(normalized.authorityKey, normalized);
  }
  return Object.freeze([...byKey.values()].sort((a, b) => (
    a.authorityKey < b.authorityKey ? -1 : a.authorityKey > b.authorityKey ? 1 : 0
  )));
};

const isPrimaryFormatMigration = (current, next) => (
  current?.formatVersion === 1
  && next?.formatVersion === 2
  && current.phase === 'settled'
  && next.phase === current.phase
  && next.status === current.status
  && next.authorityEpoch === current.authorityEpoch
  && next.revision === current.revision + 1
  && next.authorityKey === current.authorityKey
  && sameDurableAuthority(next.authority, current.authority)
  && next.transition === null
);

const assertStoredReplacement = (current, next, custodyId) => {
  if (custodyId.startsWith(TERMINAL_LEDGER_ROOT_PREFIX)) {
    if (current === null) {
      if (next.revision !== 1 || next.phase !== 'preparing') {
        throw custodyCorrupt('fresh agent terminal ledger must begin preparing at revision 1');
      }
      return;
    }
    if (
      next.revision !== current.revision + 1
      || next.sourceCustodyId !== current.sourceCustodyId
      || next.bucketCount !== current.bucketCount
      || next.bucketCapacity !== current.bucketCapacity
      || (current.legacyCut && !next.legacyCut)
      || !(
        (
          current.phase === 'preparing'
          && !current.legacyCut
          && !next.legacyCut
          && (next.phase === 'active' || next.phase === 'closed')
        )
        || (
          (current.phase === 'active' || current.phase === 'closed')
          && next.phase === current.phase
          && !current.legacyCut
          && next.legacyCut
        )
        || (
          current.phase === 'active'
          && next.phase === 'closed'
          && next.legacyCut === current.legacyCut
        )
      )
    ) {
      throw custodyCorrupt('agent terminal-ledger root replacement is not monotonic');
    }
    return;
  }
  if (custodyId.startsWith(TERMINAL_LEDGER_BUCKET_PREFIX)) {
    if (current === null) {
      if (next.revision !== 1) {
        throw custodyCorrupt('fresh agent terminal-ledger bucket must begin at revision 1');
      }
      return;
    }
    if (
      next.revision !== current.revision + 1
      || next.sourceCustodyId !== current.sourceCustodyId
      || next.bucketIndex !== current.bucketIndex
      || next.bucketCount !== current.bucketCount
      || next.bucketCapacity !== current.bucketCapacity
    ) {
      throw custodyCorrupt('agent terminal-ledger bucket replacement changed its identity');
    }
    const union = unionTerminalLedgerEntries(current.entries, next.entries);
    if (
      union.length !== next.entries.length
      || union.some((entry, index) => !sameTerminalLedgerEntry(entry, next.entries[index]))
    ) {
      throw custodyCorrupt('agent terminal-ledger bucket replacement forgot an entry');
    }
    return;
  }

  if (current === null) {
    const validDirectInitialization = next.phase === 'settled'
      && next.status === 'active';
    const validFreshTransition = next.phase === 'clearing'
      && next.transition.expectedRevision === null;
    if (
      next.authorityEpoch !== 0
      || next.revision !== 1
      || (!validDirectInitialization && !validFreshTransition)
    ) {
      throw custodyCorrupt('fresh agent custody must initialize or begin a transition at epoch 0 and revision 1');
    }
    return;
  }
  if (
    current.revision === Number.MAX_SAFE_INTEGER
    || next.revision !== current.revision + 1
    || (current.formatVersion === 2 && next.formatVersion !== 2)
  ) {
    throw custodyCorrupt('agent custody replacement must advance revision exactly once without format downgrade');
  }
  if (isPrimaryFormatMigration(current, next)) return;
  if (current.phase === 'exhausted') {
    throw custodyCorrupt('exhausted agent custody cannot be replaced');
  }
  if (next.phase === 'exhausted') {
    if (
      next.status !== 'deleted'
      || next.authorityEpoch !== current.authorityEpoch
      || next.authorityKey !== current.authorityKey
      || !sameDurableAuthority(next.authority, current.authority)
    ) {
      throw custodyCorrupt('agent custody exhaustion marker must tombstone its exact predecessor');
    }
    return;
  }
  if (current.phase === 'settled') {
    if (
      next.phase !== 'clearing'
      || current.authorityEpoch === Number.MAX_SAFE_INTEGER
      || next.authorityEpoch !== current.authorityEpoch + 1
    ) {
      throw custodyCorrupt('settled agent custody must advance into the next clearing epoch');
    }
    if (
      next.transition.expectedRevision !== current.revision
      || next.transition.expectedEpoch !== current.authorityEpoch
      || next.transition.expectedAuthorityKey !== current.authorityKey
      || next.transition.previousStatus !== current.status
      || !sameDurableAuthority(next.transition.previousAuthority, current.authority)
    ) {
      throw custodyCorrupt('agent custody clearing transition does not bind its exact predecessor');
    }
    if (
      current.status === 'deleted'
      && next.status === 'active'
      && current.authorityKey === next.authorityKey
    ) {
      throw custodyCorrupt('deleted agent custody cannot revive the same durable authority tuple');
    }
    return;
  }
  if (
    next.phase !== 'settled'
    || next.authorityEpoch !== current.authorityEpoch
    || next.status !== current.status
    || next.authorityKey !== current.authorityKey
    || !sameDurableAuthority(next.authority, current.authority)
  ) {
    throw custodyCorrupt('clearing agent custody may only settle its exact successor');
  }
};

const nextSafeCounter = (
  value,
  code,
  label,
  ceiling = Number.MAX_SAFE_INTEGER,
) => {
  if (
    !Number.isSafeInteger(ceiling)
    || ceiling < 1
    || !Number.isSafeInteger(value)
    || value < 0
    || value >= ceiling
  ) {
    throw fenceError(code, `${label} cannot advance without losing comparison identity`);
  }
  return value + 1;
};

const nextDurableAuthorityEpoch = (value) => {
  if (
    !Number.isSafeInteger(value)
    || value < 0
    || value >= Number.MAX_SAFE_INTEGER - 1
  ) {
    throw fenceError(
      'SNAPBACK_AUTH_AUTHORITY_EPOCH_EXHAUSTED',
      'agent authority epoch cannot advance without consuming its terminal identity',
    );
  }
  return value + 1;
};

const memoryLocks = new WeakMap();
const MEMORY_OWNERSHIP_WAIT_MS = 250;

const memoryLockFor = (state, custodyId) => {
  let locks = memoryLocks.get(state);
  if (!locks) {
    locks = new Map();
    memoryLocks.set(state, locks);
  }
  let lock = locks.get(custodyId);
  if (!lock) {
    lock = { tail: Promise.resolve() };
    locks.set(custodyId, lock);
  }
  return lock;
};

/**
 * Deterministic transactional storage for tests and native/headless adapters.
 * Share the same `state` object across fixtures to model independent processes.
 */
export function createMemoryAgentAuthorityCustodyStorage({
  state = { custody: Object.create(null) },
  terminalLedgerParameters = null,
  terminalLedgerCheckpoint = null,
} = {}) {
  if (!state || typeof state !== 'object' || Array.isArray(state)) {
    throw new TypeError('createMemoryAgentAuthorityCustodyStorage requires a shared state object');
  }
  if (!state.custody || typeof state.custody !== 'object' || Array.isArray(state.custody)) {
    state.custody = Object.create(null);
  }
  const normalizedTerminalLedgerParameters = normalizeTerminalLedgerParameters(
    terminalLedgerParameters,
  );
  if (terminalLedgerCheckpoint !== null && typeof terminalLedgerCheckpoint !== 'function') {
    throw new TypeError('terminalLedgerCheckpoint must be a function or null');
  }
  const withOwnership = async (rawCustodyId, operation) => {
      const custodyId = normalizeCustodyPartitionId(rawCustodyId);
      if (typeof operation !== 'function') {
        throw new TypeError('agent custody ownership requires an operation callback');
      }
      const lock = memoryLockFor(state, custodyId);
      let release;
      const prior = lock.tail;
      lock.tail = new Promise((resolve) => { release = resolve; });
      let waitTimer;
      try {
        await Promise.race([
          prior,
          new Promise((_, reject) => {
            waitTimer = setTimeout(() => reject(fenceError(
              'SNAPBACK_AUTH_CUSTODY_LOCK_UNAVAILABLE',
              'timed out waiting for in-memory agent custody ownership; ownership callbacks are non-reentrant',
              { timeoutMs: MEMORY_OWNERSHIP_WAIT_MS },
            )), MEMORY_OWNERSHIP_WAIT_MS);
          }),
        ]);
      } catch (error) {
        void prior.then(release, release);
        throw error;
      } finally {
        clearTimeout(waitTimer);
      }
      let active = true;
      let acceptingOwnerOperations = true;
      let retired = false;
      let ownerOperationActive = false;
      const ownerOperations = new Set();
      const assertOwnerActive = () => {
        if (!active || !acceptingOwnerOperations || retired) {
          throw fenceError(
            'SNAPBACK_AUTH_CUSTODY_LOCK_LOST',
            retired
              ? 'agent custody ownership was retired'
              : 'agent custody ownership was released',
          );
        }
      };
      const startOwnerOperation = (operationName, operationBody) => {
        try {
          assertOwnerActive();
        } catch (error) {
          const refused = Promise.reject(error);
          void refused.then(() => {}, () => {});
          return refused;
        }
        if (ownerOperationActive) {
          const refused = Promise.reject(fenceError(
            'SNAPBACK_AUTH_CUSTODY_OPERATION_OVERLAP',
            'agent custody owner operations must not overlap',
            { operation: operationName },
          ));
          void refused.then(() => {}, () => {});
          return refused;
        }
        ownerOperationActive = true;
        const task = (async () => {
          try {
            return await operationBody();
          } finally {
            ownerOperationActive = false;
          }
        })();
        ownerOperations.add(task);
        // Mark every child handled immediately. The ownership callback still
        // decides whether a child failure is expected, while the outer scope
        // retains and joins the exact promise before releasing its gate.
        void task.then(() => {}, () => {});
        return task;
      };
      const owner = Object.freeze({
        scanPartitions({ cursor = null, limit = TERMINAL_LEDGER_SCAN_PAGE } = {}) {
          return startOwnerOperation('scanPartitions', async () => {
          if (
            (cursor !== null && typeof cursor !== 'string')
            || !Number.isSafeInteger(limit)
            || limit < 1
            || limit > TERMINAL_LEDGER_SCAN_PAGE
          ) {
            throw new TypeError('agent custody partition scan cursor or limit is invalid');
          }
          const allIds = Object.keys(state.custody);
          if (allIds.length > TERMINAL_LEDGER_MAX_SCANNED_PARTITIONS) {
            throw terminalLedgerScanLimit();
          }
          const ids = allIds
            .sort()
            .filter((id) => cursor === null || id > cursor)
            .slice(0, limit);
          const records = ids.map((partitionId) => {
            // Scans carry minimally identified raw records. The gate consumer
            // classifies ownership from partitionId and strictly validates
            // only this custody's records, so corruption in an unrelated
            // custody cannot wedge migration or diagnostics.
            const value = clone(state.custody[partitionId]);
            return Object.freeze({
              partitionId,
              value,
              byteLength: encodedJsonByteLength(value),
            });
          });
          const hasMore = ids.length === limit
            && allIds.some((id) => id > ids[ids.length - 1]);
          return Object.freeze({
            records: Object.freeze(records),
            nextCursor: hasMore ? ids[ids.length - 1] : null,
          });
          });
        },
        withPartition(rawPartitionId, partitionOperation) {
          return startOwnerOperation('withPartition', async () => {
            const partitionId = normalizeCustodyPartitionId(rawPartitionId);
            if (partitionId === custodyId) {
              throw fenceError(
                'SNAPBACK_AUTH_CUSTODY_OWNERSHIP_REENTRANT',
                'agent custody ownership cannot reacquire its current partition',
                { custodyId },
              );
            }
            return withOwnership(partitionId, partitionOperation);
          });
        },
        read() {
          return startOwnerOperation('read', async () => {
            const raw = Object.hasOwn(state.custody, custodyId) ? state.custody[custodyId] : null;
            return raw === null ? null : clone(validateStoredCustodyRecord(raw, custodyId));
          });
        },
        replace(expectedRevision, nextValue) {
          return startOwnerOperation('replace', async () => {
            const currentRaw = Object.hasOwn(state.custody, custodyId) ? state.custody[custodyId] : null;
            const current = currentRaw === null
              ? null
              : validateStoredCustodyRecord(currentRaw, custodyId);
            const actualRevision = current?.revision ?? null;
            if (actualRevision !== expectedRevision) {
              throw fenceError(
                'SNAPBACK_AUTH_CUSTODY_CAS_STALE',
                'durable agent custody changed before compare-and-swap',
                { expectedRevision, actualRevision },
              );
            }
            const next = validateStoredCustodyRecord(nextValue, custodyId);
            assertStoredReplacement(current, next, custodyId);
            Object.defineProperty(state.custody, custodyId, {
              configurable: true,
              enumerable: true,
              writable: true,
              value: clone(next),
            });
            return clone(next);
          });
        },
        remove(expectedRevision) {
          return startOwnerOperation('remove', async () => {
            if (!Number.isSafeInteger(expectedRevision) || expectedRevision < 1) {
              throw new TypeError('agent custody removal requires a positive expectedRevision');
            }
            const currentRaw = Object.hasOwn(state.custody, custodyId) ? state.custody[custodyId] : null;
            const current = currentRaw === null
              ? null
              : validateStoredCustodyRecord(currentRaw, custodyId);
            const actualRevision = current?.revision ?? null;
            if (actualRevision !== expectedRevision) {
              throw fenceError(
                'SNAPBACK_AUTH_CUSTODY_CAS_STALE',
                'durable agent custody changed before removal',
                { expectedRevision, actualRevision },
              );
            }
            delete state.custody[custodyId];
            return true;
          });
        },
        retire(expectedRevision) {
          // Memory ownership has no separate advisory-lock carrier. Keep the
          // stronger protocol verb so durable adapters can retire both the
          // record and its physical lock under the universal gate.
          return startOwnerOperation('retire', async () => {
          if (
            expectedRevision !== null
            && (!Number.isSafeInteger(expectedRevision) || expectedRevision < 1)
          ) {
            throw new TypeError('agent custody retirement requires null or a positive expectedRevision');
          }
          if (!Object.hasOwn(state.custody, custodyId)) {
            if (expectedRevision !== null) {
              throw fenceError(
                'SNAPBACK_AUTH_CUSTODY_CAS_STALE',
                'durable agent custody changed before retirement',
                { expectedRevision, actualRevision: null },
              );
            }
            retired = true;
            return false;
          }
          if (expectedRevision === null) {
            throw fenceError(
              'SNAPBACK_AUTH_CUSTODY_CAS_STALE',
              'durable agent custody appeared before empty partition retirement',
            );
          }
          const current = validateStoredCustodyRecord(state.custody[custodyId], custodyId);
          if (current.revision !== expectedRevision) {
            throw fenceError(
              'SNAPBACK_AUTH_CUSTODY_CAS_STALE',
              'durable agent custody changed before retirement',
              { expectedRevision, actualRevision: current.revision },
            );
          }
          delete state.custody[custodyId];
          retired = true;
          return true;
          });
        },
      });
      let result;
      let operationFailed = false;
      let operationError = null;
      try {
        result = await operation(owner);
      } catch (error) {
        operationFailed = true;
        operationError = error;
      } finally {
        // Structured ownership closes the start boundary first, then joins
        // every child started while it was open. A hung unawaited child
        // therefore keeps this partition's outer gate closed.
        // @ref LLP 0055#grant-backed-live-and-queued-replay — the universal
        //   custody gate owns every operation started through its owner.
        acceptingOwnerOperations = false;
        await Promise.allSettled([...ownerOperations]);
        active = false;
        release();
      }
      if (operationFailed) throw operationError;
      return result;
  };
  return Object.freeze({
    partitionOwnership: AGENT_CUSTODY_PARTITION_OWNERSHIP,
    terminalLedgerParameters: normalizedTerminalLedgerParameters,
    async terminalLedgerCheckpoint(name, context) {
      if (terminalLedgerCheckpoint !== null) await terminalLedgerCheckpoint(name, context);
    },
    withOwnership,
    snapshot(rawCustodyId) {
      const custodyId = normalizeCustodyPartitionId(rawCustodyId);
      const raw = Object.hasOwn(state.custody, custodyId) ? state.custody[custodyId] : null;
      return raw === null ? null : clone(validateStoredCustodyRecord(raw, custodyId));
    },
  });
}

export class AgentAuthorityFence {
  #credential;
  #durableKey;
  #durableEpoch = 0;
  #durableRecord = null;
  #storage = null;
  #custodyId = null;
  #custodyGateId = null;
  #publicationOpen = true;
  #carrierGeneration = 0;
  #authorityDescriptor = null;
  #participants = [];
  #barrierGeneration = 0;
  #barrierActive = false;
  #barrierPhase = null;
  #barrierPromise = Promise.resolve();
  #barrierError = null;
  #terminated = false;
  #synchronizing = null;
  #inCommit = false;
  #carrierCounterCeiling;
  #barrierCounterCeiling;
  #handshakeOffers = new WeakSet();
  #terminalCapture = null;
  #terminalHandle = null;
  #terminalDisposition = null;
  #durableDeletionScheduled = false;

  constructor(credential, {
    storage = null,
    custodyId = null,
    volatileCounterCeiling = Number.MAX_SAFE_INTEGER,
    carrierCounterCeiling = volatileCounterCeiling,
    barrierCounterCeiling = volatileCounterCeiling,
  } = {}) {
    this.#credential = normalizeCredential(credential);
    this.#durableKey = canonicalAgentAuthorityKey(this.#credential);
    if (!Number.isSafeInteger(volatileCounterCeiling) || volatileCounterCeiling < 1) {
      throw new TypeError('volatileCounterCeiling must be a positive safe integer');
    }
    if (!Number.isSafeInteger(carrierCounterCeiling) || carrierCounterCeiling < 1) {
      throw new TypeError('carrierCounterCeiling must be a positive safe integer');
    }
    if (!Number.isSafeInteger(barrierCounterCeiling) || barrierCounterCeiling < 1) {
      throw new TypeError('barrierCounterCeiling must be a positive safe integer');
    }
    this.#carrierCounterCeiling = carrierCounterCeiling;
    this.#barrierCounterCeiling = barrierCounterCeiling;
    if (storage === null) {
      if (custodyId !== null) {
        throw new TypeError('custodyId requires transactional agent custody storage');
      }
      return;
    }
    if (typeof storage?.withOwnership !== 'function') {
      throw new TypeError('agent custody storage must provide withOwnership(custodyId, operation)');
    }
    if (storage.partitionOwnership !== AGENT_CUSTODY_PARTITION_OWNERSHIP) {
      throw fenceError(
        'SNAPBACK_AUTH_CUSTODY_PARTITION_OWNERSHIP_REQUIRED',
        'agent custody storage must support independently owned side-ledger partitions',
        { required: AGENT_CUSTODY_PARTITION_OWNERSHIP },
      );
    }
    this.#storage = storage;
    this.#custodyId = normalizeCustodyId(custodyId);
    this.#custodyGateId = custodyGateIdFor(this.#custodyId);
    // Durable configurations begin blank. The first synchronization owns
    // initialization/adoption and runs the full local publication barrier.
    this.#publicationOpen = false;
  }

  get hasDurableCustody() {
    return this.#storage !== null;
  }

  async inspectCustody() {
    this.#assertNotInCommit('agent custody inspection is forbidden inside compareAndCommit');
    if (this.#storage === null) {
      throw new TypeError('agent custody inspection requires durable custody storage');
    }
    return this.#withCustodyGate((gateOwner) => (
      this.#inspectTerminalLedgerUnderGate(gateOwner)
    ));
  }

  get authority() {
    return durableAuthority(this.#credential);
  }

  get authorityDescriptor() {
    return this.#authorityDescriptor === null
      ? null
      : Object.freeze({ ...this.#authorityDescriptor });
  }

  capture() {
    this.#assertNotInCommit('agent custody operations are forbidden inside compareAndCommit');
    if (
      !this.#publicationOpen
      || this.#barrierActive
      || this.#barrierError !== null
      || this.#terminated
    ) {
      throw stale('agent authority custody is not synchronized for publication');
    }
    return this.#captureUnchecked();
  }

  #captureUnchecked() {
    return authorityCapture(
      this.#durableEpoch,
      this.#durableKey,
      this.#carrierGeneration,
      this.#credential.tokenId,
    );
  }

  async synchronize() {
    return this.#synchronizeWithValidation(null);
  }

  async #synchronizeWithValidation(validatedAuthorityInstanceId) {
    this.#assertNotInCommit('agent custody synchronization is forbidden inside compareAndCommit');
    if (
      this.#barrierActive
      && (
        this.#barrierPhase === 'committing-durable'
        || this.#barrierPhase === 'committing-terminal-local'
        || this.#barrierPhase === 'resuming'
      )
    ) {
      throw participantReentrant('synchronization');
    }
    if (this.#synchronizing !== null) {
      const active = this.#synchronizing;
      try {
        return await active;
      } catch (error) {
        if (
          validatedAuthorityInstanceId === null
          || error?.code !== 'SNAPBACK_CLIENT_AGENT_CREDENTIAL_VALIDATION_REQUIRED'
        ) {
          throw error;
        }
        // A validated caller may have joined an unvalidated first-sync read.
        // That read is side-effect free on this diagnostic, so retry it with
        // the caller's service descriptor proof instead of making callers
        // race the internal promise cleanup.
        if (this.#synchronizing === active) this.#synchronizing = null;
      }
    }
    const pending = this.#synchronizeInternal(validatedAuthorityInstanceId);
    this.#synchronizing = pending;
    try {
      return await pending;
    } finally {
      if (this.#synchronizing === pending) this.#synchronizing = null;
    }
  }

  isCurrent(capture) {
    return !this.#terminated
      && this.#publicationOpen
      && !this.#barrierActive
      && this.#barrierError === null
      && capture?.authorityEpoch === this.#durableEpoch
      && capture?.authorityKey === this.#durableKey
      && capture?.carrierGeneration === this.#carrierGeneration
      && capture?.tokenId === this.#credential.tokenId;
  }

  credentialFor(capture) {
    if (!this.isCurrent(capture)) throw stale();
    return Object.freeze({
      bearer: this.#credential.bearerToken,
      tokenId: this.#credential.tokenId,
    });
  }

  credentialOfferForHandshake() {
    this.#assertNotInCommit('agent credential offers are forbidden inside compareAndCommit');
    if (
      this.#terminated
      || this.#barrierActive
      || this.#barrierError !== null
    ) {
      throw stale('agent credential is unavailable during a custody transition');
    }
    if (this.#storage === null && !this.#publicationOpen) {
      throw stale('agent credential is unavailable while publication is closed');
    }
    // @ref LLP 0059#durable-custody-record — this is a narrowly scoped carrier
    // offer for /auth/session validation. It deliberately returns neither an
    // authority capture nor publication permission, and never reads or writes
    // the durable custody record.
    const offer = Object.freeze({
      bearer: this.#credential.bearerToken,
      tokenId: this.#credential.tokenId,
    });
    this.#handshakeOffers.add(offer);
    return offer;
  }

  credentialOfferForReplacement(credential) {
    this.#assertNotInCommit('agent credential replacement offers are forbidden inside compareAndCommit');
    const next = normalizeCredential(credential);
    const previousCapture = this.capture();
    // This is a validation-only carrier offer. It grants no publication or
    // custody mutation authority; replaceCredentialValidated binds the server
    // proof back to this exact predecessor before it can enter a barrier.
    return Object.freeze({
      previousCapture,
      bearer: next.bearerToken,
      tokenId: next.tokenId,
    });
  }

  async synchronizeValidated(descriptor) {
    this.#assertNotInCommit('agent custody synchronization is forbidden inside compareAndCommit');
    const authorityInstanceId = descriptorKey(descriptor);
    if (authorityInstanceId !== deriveServiceAuthorityInstanceId(this.#credential)) {
      throw stale('agent handshake descriptor does not match the configured credential');
    }
    return this.#synchronizeWithValidation(authorityInstanceId);
  }

  bindHandshake(capture, descriptor) {
    this.#assertNotInCommit('agent handshake binding is forbidden inside compareAndCommit');
    if (!this.isCurrent(capture)) throw stale();
    const authorityInstanceId = descriptorKey(descriptor);
    if (authorityInstanceId !== deriveServiceAuthorityInstanceId(this.#credential)) {
      throw stale('agent handshake descriptor does not match durable credential/grant custody');
    }
    if (
      this.#authorityDescriptor !== null
      && this.#authorityDescriptor.authorityInstanceId !== authorityInstanceId
    ) {
      throw stale();
    }
    this.#authorityDescriptor = Object.freeze({ ...descriptor });
    return this.capture();
  }

  replaceCredential() {
    this.#assertNotInCommit('agent credential replacement is forbidden inside compareAndCommit');
    throw credentialValidationRequired();
  }

  replaceCredentialValidated(expected, credential, descriptor) {
    this.#assertNotInCommit('agent credential replacement is forbidden inside compareAndCommit');
    const next = normalizeCredential(credential);
    const authorityInstanceId = descriptorKey(descriptor);
    if (authorityInstanceId !== deriveServiceAuthorityInstanceId(next)) {
      throw stale('agent handshake descriptor does not match the proposed credential');
    }
    if (!this.isCurrent(expected)) {
      throw stale('agent authority changed while its replacement carrier was validating');
    }
    return this.#replaceCredentialValidated(next, descriptor);
  }

  #replaceCredentialValidated(next, descriptor) {
    if (
      !this.#publicationOpen
      || this.#barrierActive
      || this.#barrierError
      || this.#terminated
    ) {
      throw stale('agent authority is clearing and cannot replace its credential');
    }
    const nextDurableKey = canonicalAgentAuthorityKey(next);
    const previousCapture = this.#captureUnchecked();
    const previousAuthority = this.authority;
    const durableChanged = nextDurableKey !== this.#durableKey;
    let nextEpoch = this.#durableEpoch;
    let nextCarrierGeneration;
    let targetRecord = this.#durableRecord;
    let durableTransition = null;
    try {
      nextCarrierGeneration = nextSafeCounter(
        this.#carrierGeneration,
        'SNAPBACK_CLIENT_AUTH_CARRIER_GENERATION_EXHAUSTED',
        'agent carrier generation',
        this.#carrierCounterCeiling,
      );
      if (durableChanged) {
        nextEpoch = this.#storage === null
          ? nextSafeCounter(
            this.#durableEpoch,
            'SNAPBACK_AUTH_AUTHORITY_EPOCH_EXHAUSTED',
            'agent authority epoch',
          )
          : nextDurableAuthorityEpoch(this.#durableEpoch);
        if (this.#storage !== null) {
          if (
            this.#durableRecord === null
            || this.#durableRecord.phase !== 'settled'
            || this.#durableRecord.status !== 'active'
          ) {
            throw stale('durable agent custody must synchronize before tuple replacement');
          }
          durableTransition = custodyTransitionRecords({
            custodyId: this.#custodyId,
            predecessor: this.#durableRecord,
            nextEpoch,
            nextStatus: 'active',
            nextAuthority: durableAuthority(next),
            reason: 'agent_authority_changed',
            disposition: 'delete',
          });
          targetRecord = durableTransition.settled;
        }
      }
    } catch (error) {
      this.#wedgeSync(error, {
        reason: error?.code === 'SNAPBACK_CLIENT_AUTH_CARRIER_GENERATION_EXHAUSTED'
          ? 'agent_carrier_generation_exhausted'
          : error?.code === 'SNAPBACK_AUTH_CUSTODY_REVISION_EXHAUSTED'
            ? 'agent_custody_revision_exhausted'
            : error?.code === 'SNAPBACK_AUTH_AUTHORITY_EPOCH_EXHAUSTED'
              ? 'agent_authority_epoch_exhausted'
              : 'agent_authority_transition_failed',
        disposition: 'delete',
        authorityDisposition: 'durableDelete',
        previousAuthority,
        nextAuthority: null,
        previousCapture,
        capture: previousCapture,
        expectedEpoch: previousCapture.authorityEpoch,
        nextEpoch: previousCapture.authorityEpoch,
        nextAuthorityKey: previousCapture.authorityKey,
      });
      if (
        this.#storage !== null
        && this.#durableRecord !== null
        && isDurableCounterExhaustion(error)
      ) {
        return this.#persistDurableCounterExhaustion(
          error,
          this.#durableRecord,
          durableAuthority(next),
        )
          .then(() => { throw error; })
          .catch((persistenceError) => {
            if (persistenceError === error) throw error;
            this.#wedgeSync(persistenceError, {
              reason: 'agent_custody_counter_exhaustion_persist_failed',
              disposition: 'delete',
              previousAuthority,
              nextAuthority: null,
              previousCapture,
              capture: previousCapture,
              expectedEpoch: previousCapture.authorityEpoch,
              nextEpoch: previousCapture.authorityEpoch,
              nextAuthorityKey: previousCapture.authorityKey,
            });
            throw persistenceError;
          });
      }
      throw error;
    }
    const capture = authorityCapture(
      nextEpoch,
      nextDurableKey,
      nextCarrierGeneration,
      next.tokenId,
    );
    const nextAuthority = durableAuthority(next);
    const context = Object.freeze({
      capture,
      authority: nextAuthority,
      previousAuthority,
      nextAuthority,
      previousCapture,
      expectedEpoch: previousCapture.authorityEpoch,
      nextEpoch,
      nextAuthorityKey: nextDurableKey,
      disposition: durableChanged ? 'delete' : 'retain',
      ...(durableTransition ? { transitionId: durableTransition.transition.transitionId } : {}),
      reason: durableChanged ? 'agent_authority_changed' : 'agent_token_rotated',
    });
    const barrier = this.#beginBarrier({ clearMemory: durableChanged, context });
    // The visibility cut above happens before either the staged in-memory
    // successor or the asynchronous durable CAS can become observable.
    this.#carrierGeneration = nextCarrierGeneration;
    this.#durableEpoch = nextEpoch;
    this.#durableKey = nextDurableKey;
    this.#authorityDescriptor = Object.freeze({ ...descriptor });
    this.#credential = next;
    this.#terminated = false;
    const prepare = async () => {
      if (this.#storage === null) return null;
      const confirmed = durableChanged
        ? await this.#replaceDurableExact(this.#durableRecord, durableTransition.clearing)
        : await this.#confirmDurableExact(this.#durableRecord);
      this.#installDurableRecord(confirmed);
      return confirmed;
    };
    const settle = async (prepared) => {
      if (this.#storage === null || !durableChanged) return prepared;
      const confirmed = await this.#replaceDurableExact(
        durableTransition.clearing,
        targetRecord,
      );
      this.#installDurableRecord(confirmed);
      return confirmed;
    };
    if (this.#storage === null && barrier.entries.length === 0) {
      this.#completeBarrierImmediate(barrier, { open: true });
    } else {
      this.#finishBarrier(barrier, context, {
        prepare,
        settle,
        commitDurable: durableChanged,
        resume: true,
        open: true,
      });
    }
    return this.#awaitBarrierCapture(capture);
  }

  terminateValidatedCredential(offer, disposition = {}) {
    this.#assertNotInCommit('agent credential termination is forbidden inside compareAndCommit');
    const authorityDisposition = typeof disposition === 'string'
      ? disposition
      : disposition?.authorityDisposition ?? 'carrier';
    const terminalError = typeof disposition === 'object'
      ? disposition?.terminalError ?? null
      : null;
    if (authorityDisposition !== 'carrier' && authorityDisposition !== 'durableDelete') {
      throw new TypeError('validated closed-custody termination requires carrier or durableDelete');
    }
    if (
      !this.#handshakeOffers.has(offer)
      || offer?.bearer !== this.#credential.bearerToken
      || offer?.tokenId !== this.#credential.tokenId
    ) {
      throw stale('the classified terminal result does not bind the current credential offer');
    }
    if (authorityDisposition === 'durableDelete' && this.#storage === null) {
      throw stale('validated closed-custody termination requires durable custody');
    }
    if (this.#terminalHandle !== null) {
      if (
        authorityDisposition === 'durableDelete'
        && this.#terminalDisposition === 'carrier'
      ) {
        return this.#scheduleDurableDeletion({ previousCapture: null, terminalError });
      }
      return authorityDisposition === this.#terminalDisposition
        ? this.#terminalHandle
        : false;
    }
    if (this.#publicationOpen && !this.#barrierActive && this.#barrierError === null) {
      return this.terminate(this.#captureUnchecked(), { authorityDisposition, terminalError });
    }
    this.#publicationOpen = false;
    this.#terminated = true;
    this.#authorityDescriptor = null;
    const settlement = (async () => {
      await this.#barrierPromise;
      if (this.#barrierError) throw this.#barrierError;
    })();
    void settlement.catch(() => {});
    this.#terminalDisposition = 'carrier';
    this.#terminalHandle = Object.freeze({
      accepted: true,
      authorityDisposition: 'carrier',
      settlement,
    });
    if (authorityDisposition === 'carrier') return this.#terminalHandle;
    return this.#scheduleDurableDeletion({
      previousCapture: null,
      terminalError,
    });
  }

  terminate(capture, disposition = 'carrier') {
    this.#assertNotInCommit('agent credential termination is forbidden inside compareAndCommit');
    const authorityDisposition = typeof disposition === 'string'
      ? disposition
      : disposition?.authorityDisposition ?? 'carrier';
    const terminalError = typeof disposition === 'object'
      ? disposition?.terminalError ?? null
      : null;
    if (authorityDisposition !== 'carrier' && authorityDisposition !== 'durableDelete') {
      throw new TypeError('agent termination authorityDisposition must be carrier or durableDelete');
    }
    if (sameAuthorityCapture(capture, this.#terminalCapture)) {
      if (
        authorityDisposition === 'durableDelete'
        && this.#terminalDisposition === 'carrier'
      ) {
        return this.#scheduleDurableDeletion({ previousCapture: capture, terminalError });
      }
      return authorityDisposition === this.#terminalDisposition
        ? this.#terminalHandle ?? false
        : false;
    }
    if (!this.isCurrent(capture)) return false;
    // A terminal invocation owns this mandatory participant set even if its
    // first local barrier attempt fails. Synchronous callbacks may unregister
    // themselves; a terminal-only retry must still use the original snapshot.
    const terminalEntries = authorityDisposition === 'durableDelete'
      ? this.#participants.filter((entry) => !entry.removed)
      : null;
    // @ref LLP 0055#ending-authority-revocation-expiry-deactivation — a
    // carrier result retires only the exact token generation. A durableDelete
    // additionally advances and tombstones the durable tuple so restart cannot
    // re-admit queued authority under the same grant.
    let nextCarrierGeneration;
    let nextEpoch = this.#durableEpoch;
    let targetRecord = this.#durableRecord;
    let durableTransition = null;
    try {
      nextCarrierGeneration = nextSafeCounter(
        this.#carrierGeneration,
        'SNAPBACK_CLIENT_AUTH_CARRIER_GENERATION_EXHAUSTED',
        'agent carrier generation',
        this.#carrierCounterCeiling,
      );
      if (authorityDisposition === 'durableDelete') {
        nextEpoch = this.#storage === null
          ? nextSafeCounter(
            this.#durableEpoch,
            'SNAPBACK_AUTH_AUTHORITY_EPOCH_EXHAUSTED',
            'agent authority epoch',
          )
          : nextDurableAuthorityEpoch(this.#durableEpoch);
        if (this.#storage !== null) {
          durableTransition = custodyTransitionRecords({
            custodyId: this.#custodyId,
            predecessor: this.#durableRecord,
            nextEpoch,
            nextStatus: 'deleted',
            nextAuthority: this.#durableRecord.authority,
            reason: 'agent_durable_authority_deleted',
            disposition: 'delete',
          });
          targetRecord = durableTransition.settled;
        }
      }
    } catch (error) {
      this.#wedgeSync(error, {
        reason: error?.code === 'SNAPBACK_CLIENT_AUTH_CARRIER_GENERATION_EXHAUSTED'
          ? 'agent_carrier_generation_exhausted'
          : error?.code === 'SNAPBACK_AUTH_CUSTODY_REVISION_EXHAUSTED'
            ? 'agent_custody_revision_exhausted'
            : error?.code === 'SNAPBACK_AUTH_AUTHORITY_EPOCH_EXHAUSTED'
              ? 'agent_authority_epoch_exhausted'
              : 'agent_authority_termination_failed',
        disposition: authorityDisposition === 'carrier' ? 'retain' : 'delete',
        authorityDisposition,
        previousAuthority: this.authority,
        nextAuthority: authorityDisposition === 'carrier' ? this.authority : null,
        previousCapture: capture,
        capture,
        expectedEpoch: capture.authorityEpoch,
        nextEpoch: capture.authorityEpoch,
        nextAuthorityKey: capture.authorityKey,
      });
      this.#rememberTerminalFailure(capture, authorityDisposition, error);
      if (authorityDisposition === 'durableDelete') {
        return this.#scheduleDurableDeletion({
          previousCapture: capture,
          terminalError,
          terminalEntries,
        });
      }
      throw error;
    }
    const nextCapture = authorityCapture(
      nextEpoch,
      this.#durableKey,
      nextCarrierGeneration,
      this.#credential.tokenId,
    );
    const previousAuthority = this.authority;
    const context = Object.freeze({
      capture: nextCapture,
      authority: authorityDisposition === 'carrier' ? previousAuthority : null,
      previousAuthority,
      nextAuthority: authorityDisposition === 'carrier' ? previousAuthority : null,
      previousCapture: capture,
      expectedEpoch: capture.authorityEpoch,
      nextEpoch,
      nextAuthorityKey: capture.authorityKey,
      disposition: authorityDisposition === 'carrier' ? 'retain' : 'delete',
      authorityDisposition,
      ...(terminalError ? { terminalError } : {}),
      ...(durableTransition ? { transitionId: durableTransition.transition.transitionId } : {}),
      reason: authorityDisposition === 'carrier'
        ? 'agent_carrier_terminated'
        : 'agent_durable_authority_deleted',
    });
    let barrier;
    try {
      barrier = this.#beginBarrier({
        clearMemory: true,
        context,
        deferSyncError: true,
      });
    } catch (error) {
      this.#rememberTerminalFailure(capture, authorityDisposition, error);
      if (authorityDisposition === 'durableDelete') {
        return this.#scheduleDurableDeletion({
          previousCapture: capture,
          terminalError,
          terminalEntries,
        });
      }
      throw error;
    }
    this.#carrierGeneration = nextCapture.carrierGeneration;
    this.#durableEpoch = nextEpoch;
    this.#authorityDescriptor = null;
    this.#terminated = true;
    let terminalPrimaryPreserved = false;
    let terminalPrimaryAlreadyTerminal = false;
    let terminalSettlementRecord = targetRecord;
    const prepare = async () => {
      if (this.#storage === null) return null;
      if (authorityDisposition === 'durableDelete') {
        let terminalOutcome;
        let terminalError;
        try {
          // The universal gate persists the tuple witness and either installs
          // B's clearing row or observes a distinct primary successor in one
          // ownership interval. There is no witness-to-CAS race.
          terminalOutcome = await this.#replaceTerminalDurableExact(
            this.#durableRecord,
            durableTransition.clearing,
          );
        } catch (error) {
          terminalError = error;
        }
        // Once the terminal witness is attempted, purge exact local B before
        // reporting any primary-CAS outcome. This keeps a C winner from
        // preserving B's physical-store residue.
        await this.#commitTerminalLocal(context, barrier.entries);
        if (terminalError) throw terminalError;
        if (terminalOutcome.preservePrimary) {
          terminalPrimaryPreserved = true;
          terminalSettlementRecord = null;
          this.#durableRecord = null;
          return null;
        }
        if (terminalOutcome.alreadyTerminal) {
          const poison = durableCounterPoison(terminalOutcome.record);
          if (poison !== null) throw poison;
          terminalPrimaryAlreadyTerminal = true;
          terminalSettlementRecord = terminalOutcome.record;
        }
        const confirmed = terminalOutcome.record;
        this.#installDurableRecord(confirmed);
        this.#terminated = true;
        return confirmed;
      }
      const confirmed = await this.#confirmDurableExact(this.#durableRecord);
      this.#installDurableRecord(confirmed);
      this.#terminated = true;
      return confirmed;
    };
    const settle = async (prepared) => {
      if (this.#storage === null || authorityDisposition !== 'durableDelete') return prepared;
      if (terminalPrimaryPreserved) return null;
      if (terminalPrimaryAlreadyTerminal) return prepared;
      const confirmed = await this.#replaceDurableExact(
        durableTransition.clearing,
        targetRecord,
      );
      this.#installDurableRecord(confirmed);
      this.#terminated = true;
      return confirmed;
    };
    if (
      this.#storage === null
      && barrier.entries.length === 0
      && barrier.syncError === null
    ) {
      this.#completeBarrierImmediate(barrier, { open: false });
    } else {
      this.#finishBarrier(barrier, context, {
        prepare,
        settle,
        commitDurable: authorityDisposition === 'durableDelete',
        terminalLocalCommitted: authorityDisposition === 'durableDelete',
        resume: false,
        open: false,
        allowTerminalWitness: authorityDisposition === 'durableDelete',
      });
    }
    const barrierPromise = this.#barrierPromise;
    const settlement = this.#awaitTerminationSettlement({
      barrier,
      barrierPromise,
      expectedRecord: () => terminalSettlementRecord,
    });
    // WebSocket terminal handling is deliberately best-effort and may ignore
    // the handle after the synchronous confidentiality cut. Mark the Promise
    // observed without changing what an HTTP caller receives when it awaits.
    void settlement.catch(() => {});
    const handle = Object.freeze({
      accepted: true,
      authorityDisposition,
      settlement,
    });
    this.#terminalCapture = capture;
    this.#terminalDisposition = authorityDisposition;
    if (authorityDisposition === 'durableDelete') this.#durableDeletionScheduled = true;
    this.#terminalHandle = handle;
    return handle;
  }

  #rememberTerminalFailure(capture, authorityDisposition, error) {
    const settlement = Promise.reject(error);
    void settlement.catch(() => {});
    const handle = Object.freeze({
      accepted: true,
      authorityDisposition,
      settlement,
    });
    this.#publicationOpen = false;
    this.#terminated = true;
    this.#authorityDescriptor = null;
    this.#terminalCapture = capture;
    this.#terminalDisposition = authorityDisposition;
    this.#terminalHandle = handle;
    return handle;
  }

  #scheduleDurableDeletion({ previousCapture, terminalError, terminalEntries = null }) {
    if (this.#durableDeletionScheduled && this.#terminalHandle) {
      return this.#terminalHandle;
    }
    const predecessorSettlement = this.#terminalHandle?.settlement ?? Promise.resolve();
    // The synchronous terminal cut owns this exact mandatory participant set.
    // A caller may unregister while the async predecessor settlement yields,
    // but cannot remove an entry from the already-accepted purge barrier.
    const scheduledTerminalEntries = terminalEntries
      ?? this.#participants.filter((entry) => !entry.removed);
    const settlement = (async () => {
      let predecessorError = null;
      try {
        await predecessorSettlement;
      } catch (error) {
        predecessorError = error;
      }
      // A failed carrier cut is already permanently closed. Preserve its
      // eventual public error, but do not let that local callback failure veto
      // a later exact server-classified durable tombstone.
      if (this.#barrierError !== null) {
        this.#barrierError = null;
        this.#barrierActive = false;
        this.#barrierPhase = null;
      }
      await this.#deleteConfiguredDurableAuthority({
        previousCapture,
        terminalError,
        terminalEntries: scheduledTerminalEntries,
      });
      if (predecessorError) throw predecessorError;
    })();
    void settlement.catch(() => {});
    const handle = Object.freeze({
      accepted: true,
      authorityDisposition: 'durableDelete',
      settlement,
    });
    if (previousCapture !== null && this.#terminalCapture === null) {
      this.#terminalCapture = previousCapture;
    }
    this.#durableDeletionScheduled = true;
    this.#terminalDisposition = 'durableDelete';
    this.#terminalHandle = handle;
    return handle;
  }

  async #deleteConfiguredDurableAuthority({
    previousCapture,
    terminalError,
    terminalEntries = null,
    terminalLocalCommitted = false,
  }) {
    if (this.#storage === null) return;
    let exclusion = null;
    let witnessError = null;
    try {
      exclusion = await this.#recordTerminalWitness();
    } catch (error) {
      witnessError = error;
    }
    if (!terminalLocalCommitted) {
      // The server-classified exact tuple owns this confidentiality cut even
      // when witness I/O or primary counter planning fails. Run it once before
      // any branch that can reject, then thread that fact through retries.
      const expectedEpoch = this.#durableRecord?.authorityEpoch
        ?? previousCapture?.authorityEpoch
        ?? null;
      await this.#commitTerminalLocal(Object.freeze({
        capture: previousCapture,
        authority: null,
        previousAuthority: this.authority,
        nextAuthority: null,
        previousCapture,
        expectedEpoch,
        nextEpoch: expectedEpoch ?? this.#durableEpoch,
        nextAuthorityKey: this.#durableKey,
        disposition: 'delete',
        authorityDisposition: 'durableDelete',
        ...(terminalError ? { terminalError } : {}),
        reason: 'agent_durable_authority_terminal_precommit',
      }), terminalEntries);
      terminalLocalCommitted = true;
    }
    if (witnessError !== null) {
      this.#failTerminalDurable(witnessError);
      throw witnessError;
    }
    let observed = exclusion.observed;
    if (exclusion.preservePrimary) {
      this.#durableRecord = null;
      this.#publicationOpen = false;
      this.#terminated = true;
      this.#authorityDescriptor = null;
      return;
    }
    if (observed === null) {
      const transition = custodyTransitionRecords({
        custodyId: this.#custodyId,
        predecessor: null,
        nextEpoch: 0,
        nextStatus: 'deleted',
        nextAuthority: this.authority,
        reason: 'agent_durable_authority_deleted_before_initialization',
        disposition: 'delete',
      });
      const context = Object.freeze({
        capture: previousCapture,
        authority: null,
        previousAuthority: this.authority,
        nextAuthority: null,
        previousCapture,
        expectedEpoch: null,
        nextEpoch: 0,
        nextAuthorityKey: transition.settled.authorityKey,
        disposition: 'delete',
        authorityDisposition: 'durableDelete',
        ...(terminalError ? { terminalError } : {}),
        transitionId: transition.transition.transitionId,
        reason: transition.transition.reason,
      });
      try {
        await this.#runTerminalDurableTransition({
          observed: null,
          clearing: transition.clearing,
          target: transition.settled,
          context,
          terminalEntries,
        });
        return;
      } catch (error) {
        if (error?.code !== 'SNAPBACK_CLIENT_AUTHORITY_STALE') throw error;
        // A validated initializer may have won the null CAS. Re-read under a
        // new ownership interval and delete that exact durable predecessor;
        // never report terminal settlement merely because the first read was
        // empty.
        observed = await this.#readDurable();
        if (observed === null) throw error;
        // Re-enter through the gate-backed exclusion check. The winning row
        // may belong to another tuple, in which case this terminal verdict
        // must preserve it byte-for-byte rather than treating it as B's
        // predecessor merely because B lost the fresh null CAS.
        return this.#deleteConfiguredDurableAuthority({
          previousCapture,
          terminalError,
          terminalEntries,
          terminalLocalCommitted,
        });
      }
    }
    const observedMatchesConfigured = observed.authorityKey === this.#durableKey
      && sameDurableAuthority(observed.authority, this.authority);
    this.#durableRecord = observedMatchesConfigured ? observed : null;
    this.#durableEpoch = observed.authorityEpoch;
    this.#publicationOpen = false;
    this.#terminated = true;
    this.#authorityDescriptor = null;
    const observedPoison = durableCounterPoison(observed);
    if (observedPoison !== null) {
      let terminal;
      try {
        terminal = await this.#persistDurableCounterExhaustion(observedPoison, observed);
      } catch (persistenceError) {
        this.#failTerminalDurable(persistenceError);
        throw persistenceError;
      }
      const error = terminal?.phase === 'exhausted'
        ? durableCounterExhausted(terminal)
        : observedPoison;
      this.#failTerminalDurable(error);
      throw error;
    }
    if (
      observedMatchesConfigured
      && observed.phase === 'settled'
      && observed.status === 'deleted'
    ) return;

    if (observed.phase === 'clearing' && observed.status === 'active') {
      let recovered;
      let settlementError = null;
      try {
        recovered = settledRecordForClearing(observed);
      } catch (error) {
        if (!isDurableCounterExhaustion(error)) {
          this.#failTerminalDurable(error);
          throw error;
        }
        recovered = observed;
        settlementError = error;
      }
      const transition = observed.transition;
      // This intent already replaced its predecessor. Replaying its exact
      // durable participant is required before another transition may use the
      // successor as a CAS predecessor. Publication remains permanently closed
      // throughout; recovery does not resurrect the classified credential.
      const recoveryContext = Object.freeze({
        capture: authorityCapture(
          recovered.authorityEpoch,
          recovered.authorityKey,
          this.#carrierGeneration,
          this.#credential.tokenId,
        ),
        authority: transition.nextAuthority,
        previousAuthority: transition.previousAuthority,
        nextAuthority: transition.nextAuthority,
        previousCapture,
        expectedEpoch: transition.expectedEpoch,
        nextEpoch: transition.nextEpoch,
        nextAuthorityKey: transition.nextAuthorityKey,
        disposition: transition.disposition,
        transitionId: transition.transitionId,
        reason: transition.reason,
      });
      try {
        await this.#runTerminalDurableTransition({
          observed,
          clearing: observed,
          target: recovered,
          context: recoveryContext,
          settlementError,
          targetPoison: settlementError === null ? durableCounterPoison(recovered) : null,
          terminalEntries,
        });
      } catch (recoveryError) {
        // Ordinary recovery may have rebound the physical store to B before a
        // later participant or settlement failed. Re-apply the exact terminal
        // cut before preserving that error; otherwise a failed recovery could
        // make the scheduled deletion less confidential than its first cut.
        await this.#commitTerminalLocal(Object.freeze({
          capture: previousCapture,
          authority: null,
          previousAuthority: this.authority,
          nextAuthority: null,
          previousCapture,
          expectedEpoch: recovered.authorityEpoch,
          nextEpoch: recovered.authorityEpoch,
          nextAuthorityKey: this.#durableKey,
          disposition: 'delete',
          authorityDisposition: 'durableDelete',
          ...(terminalError ? { terminalError } : {}),
          reason: 'agent_terminal_recovery_failed_after_rebind',
        }), terminalEntries);
        throw recoveryError;
      }
      return this.#deleteConfiguredDurableAuthority({
        previousCapture,
        terminalError,
        terminalEntries,
        // Replaying the active clearing intent invokes ordinary commitDurable
        // and may repopulate B after the early terminal purge. The recursive
        // terminal pass must therefore cut B again before deletion settles.
        terminalLocalCommitted: false,
      });
    }

    let clearing;
    let target;
    let settlementError = null;
    let targetPoison = null;
    if (observed.phase === 'clearing') {
      try {
        target = settledRecordForClearing(observed);
      } catch (error) {
        if (!isDurableCounterExhaustion(error)) {
          this.#failTerminalDurable(error);
          throw error;
        }
        target = observed;
        settlementError = error;
      }
      clearing = observed;
      if (settlementError === null) targetPoison = durableCounterPoison(target);
    } else if (observed.phase === 'settled') {
      try {
        const nextEpoch = nextDurableAuthorityEpoch(observed.authorityEpoch);
        const transition = custodyTransitionRecords({
          custodyId: this.#custodyId,
          predecessor: observed,
          nextEpoch,
          nextStatus: 'deleted',
          nextAuthority: observed.authority,
          reason: 'agent_durable_authority_deleted_after_validation',
          disposition: 'delete',
        });
        clearing = transition.clearing;
        target = transition.settled;
      } catch (error) {
        this.#failTerminalDurable(error);
        if (isDurableCounterExhaustion(error)) {
          try {
            await this.#persistDurableCounterExhaustion(error, observed);
          } catch (persistenceError) {
            this.#failTerminalDurable(persistenceError);
            throw persistenceError;
          }
        }
        throw error;
      }
    } else {
      throw stale('classified durable deletion found an invalid durable status');
    }

    const transition = clearing.transition;
    const context = Object.freeze({
      capture: previousCapture,
      authority: null,
      previousAuthority: transition.previousAuthority,
      nextAuthority: null,
      previousCapture,
      expectedEpoch: transition.expectedEpoch,
      nextEpoch: transition.nextEpoch,
      nextAuthorityKey: transition.nextAuthorityKey,
      disposition: transition.disposition,
      authorityDisposition: 'durableDelete',
      ...(terminalError ? { terminalError } : {}),
      transitionId: transition.transitionId,
      reason: transition.reason,
    });
    await this.#runTerminalDurableTransition({
      observed,
      clearing,
      target,
      context,
      settlementError,
      targetPoison,
      terminalEntries,
    });
  }

  async #runTerminalDurableTransition({
    observed,
    clearing,
    target,
    context,
    install = true,
    settlementError = null,
    targetPoison = null,
    terminalEntries = null,
  }) {
    const barrier = this.#beginBarrier({
      clearMemory: false,
      context,
      deferSyncError: true,
      skipLocalPhases: true,
      entriesOverride: terminalEntries,
    });
    let preservePrimary = false;
    let alreadyTerminal = false;
    let settlementRecord = target;
    const prepare = async () => {
      let outcome;
      let terminalError;
      try {
        outcome = await this.#replaceTerminalDurableExact(observed, clearing);
      } catch (error) {
        terminalError = error;
      }
      if (terminalError) throw terminalError;
      if (outcome.preservePrimary) {
        preservePrimary = true;
        settlementRecord = null;
        this.#durableRecord = null;
        return null;
      }
      if (outcome.alreadyTerminal) {
        const poison = durableCounterPoison(outcome.record);
        if (poison !== null) throw poison;
        alreadyTerminal = true;
        settlementRecord = outcome.record;
      }
      const confirmed = outcome.record;
      if (install) this.#installDurableRecord(confirmed);
      this.#terminated = true;
      return confirmed;
    };
    const settle = async () => {
      if (preservePrimary) return null;
      if (alreadyTerminal) return settlementRecord;
      if (settlementError !== null) throw settlementError;
      const confirmed = await this.#replaceDurableExact(
        clearing,
        target,
        { allowTerminalWitness: true },
      );
      if (install) this.#installDurableRecord(confirmed);
      this.#terminated = true;
      if (targetPoison !== null) {
        const terminal = await this.#persistDurableCounterExhaustion(
          targetPoison,
          confirmed,
        );
        throw terminal?.phase === 'exhausted'
          ? durableCounterExhausted(terminal)
          : targetPoison;
      }
      return confirmed;
    };
    this.#finishBarrier(barrier, context, {
      prepare,
      settle,
      commitDurable: true,
      terminalLocalCommitted: true,
      resume: false,
      open: false,
      allowTerminalWitness: true,
    });
    await this.#awaitTerminationSettlement({
      barrier,
      barrierPromise: this.#barrierPromise,
      expectedRecord: () => settlementRecord,
      allowTerminalWitness: true,
    });
  }

  async #commitTerminalLocal(context, terminalEntries = null) {
    const entries = terminalEntries ?? this.#participants.filter((entry) => !entry.removed);
    const previousBarrierActive = this.#barrierActive;
    const previousBarrierPhase = this.#barrierPhase;
    this.#barrierActive = true;
    this.#publicationOpen = false;
    this.#barrierPhase = 'committing-terminal-local';
    let firstError = null;
    try {
      // Snapshot the mandatory set before callbacks. Reentrant unregister is
      // refused while this phase is active and cannot make a later entry skip
      // its exact-key purge.
      for (const entry of entries) {
        try {
          await entry.participant.commitTerminalDurable?.(context);
        } catch (error) {
          firstError ??= error;
        }
      }
      if (firstError !== null) throw firstError;
    } catch (error) {
      this.#failTerminalDurable(error);
      throw error;
    }
    this.#barrierActive = previousBarrierActive;
    this.#barrierPhase = previousBarrierPhase;
  }

  #failTerminalDurable(error) {
    this.#publicationOpen = false;
    this.#terminated = true;
    this.#authorityDescriptor = null;
    this.#barrierActive = true;
    this.#barrierPhase = 'failed';
    this.#barrierError = error;
    this.#barrierPromise = Promise.resolve();
  }

  compareAndCommit(capture, commit) {
    this.#assertNotInCommit('nested agent publication commits are forbidden inside compareAndCommit');
    if (typeof commit !== 'function') {
      throw new TypeError('compareAndCommit requires a commit callback');
    }
    if (!this.isCurrent(capture)) return Promise.resolve({ committed: false });
    if (this.#storage === null) {
      this.#inCommit = true;
      try {
        const value = commit(Object.freeze({
          ...capture,
          authorityDescriptor: this.authorityDescriptor,
        }));
        if (value && typeof value.then === 'function') {
          throw new TypeError('compareAndCommit callback must be synchronous');
        }
        return Promise.resolve({ committed: true, value });
      } finally {
        this.#inCommit = false;
      }
    }
    return this.#compareAndCommitDurable(capture, commit);
  }

  registerParticipant(participant) {
    this.#assertNotInCommit('agent participant registration is forbidden inside compareAndCommit');
    if (!participant || typeof participant !== 'object') {
      throw new TypeError('participant must be an object');
    }
    if (this.#barrierActive || this.#barrierError || this.#terminated) {
      throw stale('agent authority is unavailable for participant registration');
    }
    // Agent replacement and terminal loss are synchronous carrier cuts. Their
    // local participants must therefore finish quiescence before this method
    // can synchronously blank every boundary. Browser AuthCoordinator retains
    // the broader awaited participant contract for cross-context transitions.
    for (const method of ['quiesce', 'blank', 'clearMemory']) {
      if (participant[method]?.constructor?.name === 'AsyncFunction') {
        throw new TypeError(`agent authority participant ${method}() must be synchronous`);
      }
    }
    const entry = { participant, removed: false };
    this.#participants.push(entry);
    if (!this.#publicationOpen && this.#storage !== null && this.#durableRecord === null) {
      let firstError = null;
      for (const method of ['quiesce', 'blank', 'clearMemory']) {
        try {
          this.#invokeSyncParticipant(participant, method, Object.freeze({
            reason: 'agent_custody_initializing',
            disposition: 'retain',
            authorityDisposition: 'carrier',
          }));
        } catch (error) {
          firstError ??= error;
        }
      }
      if (firstError) {
        this.#barrierError = firstError;
        this.#barrierPhase = 'failed';
        throw firstError;
      }
    }
    return () => {
      this.#assertNotInCommit('agent participant removal is forbidden inside compareAndCommit');
      if (
        this.#barrierActive
        && (
          this.#barrierPhase === 'committing-durable'
          || this.#barrierPhase === 'committing-terminal-local'
          || this.#barrierPhase === 'resuming'
        )
      ) {
        return Promise.reject(participantReentrant('participant removal'));
      }
      entry.removed = true;
      // Synchronous quiesce/blank/clear callbacks run before #finishBarrier
      // and the terminal handle are installed. Defer the ownership choice one
      // microtask: the current barrier already snapshotted this entry, and the
      // completed terminate() stack will have published the settlement that
      // unregister must await. This preserves supported synchronous teardown
      // without allowing removal to resolve ahead of a future callback.
      return Promise.resolve().then(async () => {
        const terminalSettlement = this.#terminalDisposition === 'durableDelete'
          ? this.#terminalHandle?.settlement ?? null
          : null;
        if (terminalSettlement !== null) {
          // A scheduled closed-custody deletion snapshots participants before
          // its async work begins. Unregistration may mark this entry removed,
          // but cannot resolve until that mandatory final callback has either
          // completed or failed; after resolution no future callback can run.
          try { await terminalSettlement; } catch { /* removal is cleanup, not settlement */ }
        } else {
          await this.#barrierPromise;
        }
        this.#participants = this.#participants.filter((candidate) => candidate !== entry);
      });
    };
  }

  #beginBarrier({
    clearMemory,
    context,
    deferSyncError = false,
    skipLocalPhases = false,
    entriesOverride = null,
  }) {
    if (this.#barrierActive) {
      throw stale('an agent authority transition is already active');
    }
    const entries = entriesOverride ?? this.#participants.filter((entry) => !entry.removed);
    if (skipLocalPhases) {
      if (!this.#terminated || this.#publicationOpen) {
        throw stale('a terminal-only durable barrier requires permanently closed publication');
      }
      // The exact durable transitionId/CAS predecessor is the identity for
      // this closed-custody operation. It must remain available even after the
      // volatile local barrier counter is exhausted; no local phase can be
      // admitted or replayed through this path.
      this.#barrierActive = true;
      this.#publicationOpen = false;
      this.#barrierPhase = 'preparing-durable';
      return {
        entries,
        generation: null,
        syncError: null,
        terminalOnly: true,
      };
    }
    try {
      this.#barrierGeneration = nextSafeCounter(
        this.#barrierGeneration,
        'SNAPBACK_CLIENT_AUTH_BARRIER_GENERATION_EXHAUSTED',
        'agent barrier generation',
        this.#barrierCounterCeiling,
      );
    } catch (error) {
      // An exhausted barrier id cannot be reused, but confidentiality still
      // requires an immediate visibility cut. There is no successor barrier
      // to resume: close publication permanently and attempt every local
      // quiesce/blank/clear callback before surfacing the stable diagnostic.
      this.#barrierActive = true;
      this.#publicationOpen = false;
      this.#barrierPhase = 'quiescing';
      for (const { participant } of entries) {
        try { this.#invokeSyncParticipant(participant, 'quiesce', context); } catch { /* preserve counter failure */ }
      }
      this.#barrierPhase = 'blanking';
      for (const { participant } of entries) {
        try { this.#invokeSyncParticipant(participant, 'blank', context); } catch { /* preserve counter failure */ }
      }
      if (clearMemory) {
        this.#barrierPhase = 'clearing-memory';
        for (const { participant } of entries) {
          try { this.#invokeSyncParticipant(participant, 'clearMemory', context); } catch { /* preserve counter failure */ }
        }
      }
      this.#barrierError = error;
      this.#barrierPhase = 'failed';
      this.#barrierPromise = Promise.resolve();
      throw error;
    }
    const generation = this.#barrierGeneration;
    this.#barrierActive = true;
    this.#publicationOpen = false;
    this.#barrierPhase = 'quiescing';
    // @ref LLP 0059#transition-barrier — even this local carrier-only owner
    // completes quiescence before synchronous blanking; otherwise an in-flight
    // callback could repopulate a boundary after the terminal cut returned.
    let firstError = null;
    const invoke = (participant, method) => {
      try {
        return this.#invokeSyncParticipant(participant, method, context);
      } catch (error) {
        firstError ??= error;
        return undefined;
      }
    };
    for (const { participant } of entries) {
      invoke(participant, 'quiesce');
    }
    // A throwing participant cannot veto confidentiality for every surface.
    // The active fence already rejects new publication; continue through all
    // synchronous blank/clear callbacks, then wedge and surface the first
    // failure without changing the credential.
    this.#barrierPhase = 'blanking';
    for (const { participant } of entries) invoke(participant, 'blank');
    if (clearMemory) {
      this.#barrierPhase = 'clearing-memory';
      for (const { participant } of entries) invoke(participant, 'clearMemory');
    }
    if (firstError) {
      if (!deferSyncError) {
        this.#barrierError = firstError;
        this.#barrierPhase = 'failed';
        throw firstError;
      }
    }
    return { entries, generation, syncError: firstError };
  }

  #finishBarrier(barrier, context, {
    prepare,
    settle = async (record) => record,
    commitDurable,
    terminalLocalCommitted = false,
    resume,
    open,
    allowTerminalWitness = false,
  }) {
    const frozenContext = Object.freeze({ ...context });
    const ownsBarrier = () => barrier.terminalOnly === true
      ? this.#barrierActive
      : barrier.generation === this.#barrierGeneration;
    const complete = async () => {
      let durableRecord = await prepare();
      if (commitDurable) {
        this.#barrierPhase = 'committing-durable';
        for (const { participant } of barrier.entries) {
          if (
            frozenContext.authorityDisposition === 'durableDelete'
            && typeof participant.commitTerminalDurable === 'function'
          ) {
            if (!terminalLocalCommitted) {
              await participant.commitTerminalDurable(frozenContext);
            }
          } else {
            await participant.commitDurable?.(frozenContext);
          }
        }
      }
      this.#barrierPhase = 'settling-durable';
      durableRecord = await settle(durableRecord);
      if (resume && this.#terminalDisposition === null) {
        this.#barrierPhase = 'resuming';
        for (const { participant } of [...barrier.entries].reverse()) {
          await participant.resume?.(frozenContext);
        }
      }
      if (this.#storage !== null && durableRecord !== null) {
        this.#barrierPhase = 'confirming-durable';
        await this.#confirmDurableExact(durableRecord, { allowTerminalWitness });
      }
      // Terminal deletion deliberately continues through its durable phases
      // after a synchronous participant failure. The tombstone may settle,
      // but the public settlement must still reject so callers never mistake
      // a partially failed local cut for a clean terminal transition.
      if (barrier.syncError) throw barrier.syncError;
      if (ownsBarrier()) {
        this.#barrierActive = false;
        this.#barrierPhase = null;
        this.#publicationOpen = open && !this.#terminated;
      }
    };
    this.#barrierPromise = complete().catch((error) => {
      if (ownsBarrier()) {
        this.#barrierError = error;
        this.#barrierActive = true;
        this.#publicationOpen = false;
        this.#barrierPhase = 'failed';
        if (barrier.terminalOnly !== true) {
          for (const { participant } of barrier.entries) {
            try { this.#invokeSyncParticipant(participant, 'blank', frozenContext); } catch { /* preserve first failure */ }
          }
        }
      }
    });
  }

  #completeBarrierImmediate(barrier, { open }) {
    if (barrier.generation !== this.#barrierGeneration) return;
    this.#barrierActive = false;
    this.#barrierPhase = null;
    this.#publicationOpen = open && !this.#terminated;
    this.#barrierPromise = Promise.resolve();
  }

  async #awaitBarrierCapture(expected) {
    await this.#barrierPromise;
    if (this.#barrierError) throw this.#barrierError;
    if (this.#terminated || !this.isCurrent(expected)) {
      throw stale('agent authority transition did not settle on its exact successor');
    }
    return this.#captureUnchecked();
  }

  async #awaitTerminationSettlement({
    barrier,
    barrierPromise,
    expectedRecord,
    allowTerminalWitness = false,
  }) {
    await barrierPromise;
    if (this.#barrierError) throw this.#barrierError;
    if (
      (barrier.terminalOnly !== true && barrier.generation !== this.#barrierGeneration)
      || this.#barrierActive
      || !this.#terminated
      || this.#publicationOpen
    ) {
      throw stale('agent terminal authority did not complete its exact local barrier');
    }
    // The barrier already confirms its final durable state under ownership.
    // Reread once more at the public settlement boundary so a resolved handle
    // is an exact statement about the tombstone/retained record, rather than
    // merely an observation that participant callbacks stopped running.
    const finalExpectedRecord = typeof expectedRecord === 'function'
      ? expectedRecord()
      : expectedRecord;
    if (this.#storage !== null && finalExpectedRecord !== null) {
      await this.#confirmDurableExact(finalExpectedRecord, { allowTerminalWitness });
    }
  }

  #invokeSyncParticipant(participant, method, context) {
    if (typeof participant?.[method] !== 'function') return undefined;
    const result = participant[method](context);
    if (result && typeof result.then === 'function') {
      void Promise.resolve(result).catch(() => {});
      throw new TypeError(`agent authority participant ${method}() must be synchronous`);
    }
    return result;
  }

  #assertNotInCommit(message) {
    if (this.#inCommit) {
      throw fenceError('SNAPBACK_CLIENT_AUTH_COMMIT_REENTRANT', message);
    }
  }

  #wedgeSync(error, context) {
    if (!this.#barrierActive) {
      try {
        this.#beginBarrier({ clearMemory: true, context: Object.freeze({ ...context }) });
      } catch {
        // The original counter/custody failure owns the stable diagnosis.
      }
    }
    this.#publicationOpen = false;
    this.#barrierActive = true;
    this.#barrierPhase = 'failed';
    this.#barrierError = error;
    this.#barrierPromise = Promise.resolve();
  }

  async #synchronizeInternal(validatedAuthorityInstanceId) {
    if (this.#barrierActive) {
      await this.#barrierPromise;
      if (this.#barrierError) throw this.#barrierError;
      if (this.#terminated) throw stale('durable agent authority has terminated');
      return this.capture();
    }
    if (this.#barrierError) throw this.#barrierError;
    if (this.#terminated) throw stale('agent authority has terminated');
    if (this.#storage === null) {
      return this.capture();
    }

    let observed;
    try {
      observed = await this.#readDurable();
    } catch (error) {
      this.#wedgeSync(error, {
        reason: 'agent_custody_read_failed',
        disposition: 'delete',
        previousAuthority: this.authority,
        nextAuthority: null,
        previousCapture: this.#captureUnchecked(),
        capture: this.#captureUnchecked(),
        expectedEpoch: this.#durableEpoch,
        nextEpoch: this.#durableEpoch,
        nextAuthorityKey: this.#durableKey,
      });
      throw error;
    }

    // A terminal carrier/durable-delete cut may race an awaited storage read.
    // The durable CAS below is still the cross-process linearization point,
    // but this local gate prevents a retired fence from planning or beginning
    // a fresh active initialization after the cut already returned.
    if (
      this.#terminated
      || this.#terminalDisposition !== null
      || this.#barrierActive
      || this.#barrierError !== null
    ) {
      throw stale('agent authority terminated while durable custody was being read');
    }

    let terminalWitness;
    try {
      terminalWitness = await this.#readTerminalWitness(this.authority);
    } catch (error) {
      this.#wedgeSync(error, {
        reason: 'agent_terminal_witness_read_failed',
        disposition: 'delete',
        previousAuthority: this.authority,
        nextAuthority: null,
        previousCapture: this.#captureUnchecked(),
        capture: this.#captureUnchecked(),
        expectedEpoch: observed?.authorityEpoch ?? this.#durableEpoch,
        nextEpoch: observed?.authorityEpoch ?? this.#durableEpoch,
        nextAuthorityKey: observed?.authorityKey ?? this.#durableKey,
      });
      throw error;
    }
    if (terminalWitness !== null) {
      const terminalError = stale(
        'durable agent authority was terminally rejected before installation',
      );
      if (
        this.#publicationOpen
        && !this.#barrierActive
        && this.#barrierError === null
        && !this.#terminated
      ) {
        const terminal = this.terminate(this.#captureUnchecked(), {
          authorityDisposition: 'durableDelete',
          terminalError,
        });
        if (terminal && typeof terminal === 'object') await terminal.settlement;
      } else {
        this.#publicationOpen = false;
        this.#terminated = true;
        this.#authorityDescriptor = null;
        await this.#deleteConfiguredDurableAuthority({
          previousCapture: null,
          terminalError,
        });
      }
      throw terminalError;
    }

    const observedPoison = durableCounterPoison(observed);
    if (observedPoison !== null) {
      const context = {
        reason: 'agent_custody_counter_exhausted_on_read',
        disposition: 'delete',
        previousAuthority: observed?.authority ?? this.authority,
        nextAuthority: null,
        previousCapture: this.#captureUnchecked(),
        capture: this.#captureUnchecked(),
        expectedEpoch: observed?.authorityEpoch ?? this.#durableEpoch,
        nextEpoch: observed?.authorityEpoch ?? this.#durableEpoch,
        nextAuthorityKey: observed?.authorityKey ?? this.#durableKey,
      };
      this.#wedgeSync(observedPoison, context);
      let terminal;
      try {
        terminal = await this.#persistDurableCounterExhaustion(observedPoison, observed);
      } catch (persistenceError) {
        this.#wedgeSync(persistenceError, context);
        throw persistenceError;
      }
      const error = terminal?.phase === 'exhausted'
        ? durableCounterExhausted(terminal)
        : observedPoison;
      this.#wedgeSync(error, context);
      throw error;
    }

    if (
      this.#durableRecord !== null
      && this.#publicationOpen
      && sameCustodyRecord(observed, this.#durableRecord)
    ) {
      if (observed.phase !== 'settled' || observed.status === 'deleted') {
        this.#terminated = true;
        this.#publicationOpen = false;
        throw stale('durable agent authority is not settled and active');
      }
      return this.#captureUnchecked();
    }

    let plan;
    try {
      plan = this.#synchronizationPlan(observed, validatedAuthorityInstanceId);
    } catch (error) {
      if (error?.code === 'SNAPBACK_CLIENT_AGENT_CREDENTIAL_VALIDATION_REQUIRED') {
        // The configured bearer remains usable only for the narrow handshake
        // offer. Publication stays closed and, critically, settled predecessor
        // custody remains byte-for-byte untouched.
        this.#publicationOpen = false;
        throw error;
      }
      this.#wedgeSync(error, {
        reason: 'agent_custody_synchronization_failed',
        disposition: 'delete',
        previousAuthority: this.authority,
        nextAuthority: null,
        previousCapture: this.#captureUnchecked(),
        capture: this.#captureUnchecked(),
        expectedEpoch: this.#durableEpoch,
        nextEpoch: this.#durableEpoch,
        nextAuthorityKey: this.#durableKey,
      });
      if (isDurableCounterExhaustion(error) && observed !== null) {
        try {
          await this.#persistDurableCounterExhaustion(error, observed);
        } catch (persistenceError) {
          this.#wedgeSync(persistenceError, {
            reason: 'agent_custody_counter_exhaustion_persist_failed',
            disposition: 'delete',
            previousAuthority: observed.authority,
            nextAuthority: null,
            previousCapture: this.#captureUnchecked(),
            capture: this.#captureUnchecked(),
            expectedEpoch: observed.authorityEpoch,
            nextEpoch: observed.authorityEpoch,
            nextAuthorityKey: observed.authorityKey,
          });
          throw persistenceError;
        }
      }
      throw error;
    }
    await this.#executeSynchronizationPlan(plan);
    if (this.#barrierError) throw this.#barrierError;
    if (this.#terminated) throw stale('durable agent authority is deleted');
    return this.capture();
  }

  #synchronizationPlan(observed, validatedAuthorityInstanceId) {
    const desiredAuthority = this.authority;
    const desiredKey = this.#durableKey;
    const desiredIsValidated = validatedAuthorityInstanceId
      === deriveServiceAuthorityInstanceId(this.#credential);
    const desiredMatches = observed !== null
      && observed.authorityKey === desiredKey
      && sameDurableAuthority(observed.authority, desiredAuthority);

    // A process with no locally established durable record has no authority
    // to initialize, adopt, recover, or replace custody until the exact bearer
    // has completed a protocol-v1 service-principal handshake. Merely knowing
    // the durable tuple is not proof that its current carrier is valid.
    if (this.#durableRecord === null && !desiredIsValidated) {
      throw credentialValidationRequired();
    }

    if (observed?.phase === 'clearing') {
      if (!desiredMatches) {
        return {
          observed,
          target: observed,
          reason: 'agent_custody_clearing_mismatch',
          disposition: 'delete',
          error: stale('durable agent custody is clearing toward a tuple unavailable in this process'),
        };
      }
      let target;
      let settlementError = null;
      try {
        target = settledRecordForClearing(observed);
      } catch (error) {
        if (!isDurableCounterExhaustion(error)) throw error;
        target = observed;
        settlementError = error;
      }
      return {
        observed,
        clearing: observed,
        target,
        writeClearing: false,
        commitDurable: true,
        transition: observed.transition,
        settlementError,
        targetPoison: settlementError === null ? durableCounterPoison(target) : null,
        reason: observed.transition.reason,
        disposition: observed.transition.disposition,
      };
    }

    if (this.#durableRecord === null) {
      if (observed === null) {
        return {
          observed,
          target: custodyRecord({
            custodyId: this.#custodyId,
            authorityEpoch: 0,
            revision: 1,
            phase: 'settled',
            status: 'active',
            authority: desiredAuthority,
          }),
          writeDirect: true,
          commitDurable: false,
          reason: 'agent_custody_initialized',
          disposition: 'retain',
        };
      }
      if (desiredMatches) {
        return {
          observed,
          target: observed,
          commitDurable: false,
          reason: observed.status === 'deleted'
            ? 'agent_custody_deleted_restart'
            : 'agent_custody_restart_adopted',
          disposition: observed.status === 'deleted' ? 'delete' : 'retain',
        };
      }
      const nextEpoch = nextDurableAuthorityEpoch(observed.authorityEpoch);
      const transition = custodyTransitionRecords({
        custodyId: this.#custodyId,
        predecessor: observed,
        nextEpoch,
        nextStatus: 'active',
        nextAuthority: desiredAuthority,
        reason: 'agent_custody_restart_replaced',
        disposition: 'delete',
      });
      return {
        observed,
        clearing: transition.clearing,
        target: transition.settled,
        writeClearing: true,
        commitDurable: true,
        transition: transition.transition,
        reason: 'agent_custody_restart_replaced',
        disposition: 'delete',
      };
    }

    if (desiredMatches) {
      return {
        observed,
        target: observed,
        commitDurable: !sameCustodyRecord(observed, this.#durableRecord),
        reason: observed.status === 'deleted'
          ? 'agent_custody_peer_deleted'
          : 'agent_custody_peer_adopted',
        disposition: observed.status === 'deleted' ? 'delete' : 'delete',
      };
    }

    return {
      observed,
      target: observed,
      write: false,
      reason: 'agent_custody_peer_mismatch',
      disposition: 'delete',
      error: stale('durable agent custody changed to a tuple unavailable in this process'),
    };
  }

  async #executeSynchronizationPlan(plan) {
    if (this.#terminated || this.#terminalDisposition !== null) {
      throw stale('agent authority terminated before durable custody could be written');
    }
    const previousRecord = this.#durableRecord;
    const contextPredecessor = previousRecord ?? plan.observed;
    const target = plan.target;
    const targetEpoch = target?.authorityEpoch ?? this.#durableEpoch;
    const targetKey = target?.authorityKey ?? this.#durableKey;
    const targetIsDesired = target !== null
      && target.authorityKey === this.#durableKey
      && sameDurableAuthority(target.authority, this.authority);
    const nextAuthority = targetIsDesired && target.status === 'active' ? this.authority : null;
    const context = Object.freeze({
      capture: authorityCapture(
        targetEpoch,
        targetKey,
        this.#carrierGeneration,
        this.#credential.tokenId,
      ),
      authority: nextAuthority,
      previousAuthority: plan.transition
        ? plan.transition.previousAuthority
        : contextPredecessor?.status === 'active'
          ? contextPredecessor.authority
          : null,
      nextAuthority,
      previousCapture: this.#captureUnchecked(),
      expectedEpoch: plan.transition
        ? plan.transition.expectedEpoch
        : previousRecord?.authorityEpoch
          ?? plan.observed?.authorityEpoch
          ?? targetEpoch,
      nextEpoch: targetEpoch,
      nextAuthorityKey: targetKey,
      disposition: plan.disposition,
      ...(plan.transition ? { transitionId: plan.transition.transitionId } : {}),
      ...(target?.status === 'deleted' ? { authorityDisposition: 'durableDelete' } : {}),
      reason: plan.reason,
    });
    const barrier = this.#beginBarrier({ clearMemory: true, context });
    const prepare = async () => {
      if (plan.error) throw plan.error;
      const confirmed = plan.clearing
        ? plan.writeClearing
          ? await this.#replaceDurableExact(plan.observed, plan.clearing)
          : await this.#confirmDurableExact(plan.clearing)
        : plan.writeDirect
          ? await this.#replaceDurableExact(plan.observed, target)
          : await this.#confirmDurableExact(target);
      this.#installDurableRecord(confirmed);
      return confirmed;
    };
    const settle = async (prepared) => {
      if (plan.settlementError !== null && plan.settlementError !== undefined) {
        throw plan.settlementError;
      }
      if (!plan.clearing) return prepared;
      const confirmed = await this.#replaceDurableExact(plan.clearing, target);
      this.#installDurableRecord(confirmed);
      if (plan.targetPoison) {
        const terminal = await this.#persistDurableCounterExhaustion(
          plan.targetPoison,
          confirmed,
        );
        this.#terminated = true;
        throw terminal?.phase === 'exhausted'
          ? durableCounterExhausted(terminal)
          : plan.targetPoison;
      }
      return confirmed;
    };
    this.#finishBarrier(barrier, context, {
      prepare,
      settle,
      commitDurable: plan.commitDurable === true,
      resume: target?.status === 'active'
        && !plan.error
        && !plan.settlementError
        && !plan.targetPoison,
      open: target?.status === 'active'
        && !plan.error
        && !plan.settlementError
        && !plan.targetPoison,
    });
    await this.#barrierPromise;
  }

  async #readDurable() {
    return this.#withCustodyGate((gateOwner) => (
      this.#readPrimaryForSynchronizationUnderGate(gateOwner)
    ));
  }

  async #withCustodyGate(operation, {
    terminalAuthorities = [],
    onTerminalAuthoritiesEnsured = null,
  } = {}) {
    return this.#storage.withOwnership(this.#custodyGateId, async (gateOwner) => {
      if (
        typeof gateOwner?.withPartition !== 'function'
        || typeof gateOwner?.scanPartitions !== 'function'
        || typeof gateOwner?.remove !== 'function'
        || typeof gateOwner?.retire !== 'function'
      ) {
        throw fenceError(
          'SNAPBACK_AUTH_CUSTODY_PARTITION_OWNERSHIP_REQUIRED',
          'agent custody gate owner cannot access, enumerate, remove, and retire independently owned partitions',
        );
      }
      const migration = await this.#ensureTerminalLedgerUnderGate(
        gateOwner,
        terminalAuthorities,
        onTerminalAuthoritiesEnsured,
      );
      const result = await operation(gateOwner);
      await this.#finalizeTerminalLedgerCutUnderGate(
        gateOwner,
        migration.legacyWitnesses,
      );
      return result;
    });
  }

  async #checkpointTerminalLedger(name, context = {}) {
    if (typeof this.#storage?.terminalLedgerCheckpoint === 'function') {
      await this.#storage.terminalLedgerCheckpoint(name, Object.freeze({
        custodyId: this.#custodyId,
        ...context,
      }));
    }
  }

  async #readTerminalLedgerRootUnderGate(gateOwner) {
    const custodyId = terminalLedgerRootIdFor(this.#custodyId);
    return gateOwner.withPartition(custodyId, async (owner) => {
      const value = await owner.read();
      return value === null ? null : validateTerminalLedgerRoot(value, custodyId);
    });
  }

  async #inspectTerminalLedgerUnderGate(gateOwner) {
    const root = await this.#readTerminalLedgerRootUnderGate(gateOwner);
    if (root === null || root.phase === 'preparing') {
      throw custodyCorrupt('agent terminal ledger is unavailable for inspection');
    }
    const entries = new Map();
    let witnessBytes = encodedJsonByteLength(root);
    let largestBucket = 0;
    // The root fixes the complete v2 namespace. Diagnostics therefore read at
    // most 64 deterministic buckets and never discover unrelated partitions.
    for (let bucketIndex = 0; bucketIndex < root.bucketCount; bucketIndex += 1) {
      const bucket = await this.#readTerminalLedgerBucketUnderGate(
        gateOwner,
        root,
        bucketIndex,
      );
      if (bucket === null) continue;
      witnessBytes += encodedJsonByteLength(bucket);
      largestBucket = Math.max(largestBucket, bucket.entries.length);
      for (const entry of bucket.entries) {
        const previous = entries.get(entry.authorityKey);
        if (previous && !sameTerminalLedgerEntry(previous, entry)) {
          throw custodyCorrupt('agent terminal-ledger diagnostics found a key collision');
        }
        entries.set(entry.authorityKey, entry);
      }
    }
    const capacity = root.bucketCount * root.bucketCapacity;
    const warningThreshold = Math.ceil(
      capacity * TERMINAL_LEDGER_WARNING_NUMERATOR / TERMINAL_LEDGER_WARNING_DENOMINATOR,
    );
    const bucketWarningThreshold = Math.ceil(
      root.bucketCapacity
        * TERMINAL_LEDGER_WARNING_NUMERATOR
        / TERMINAL_LEDGER_WARNING_DENOMINATOR,
    );
    return Object.freeze({
      ledgerFormat: 'bucket-v2',
      state: root.phase,
      witnessCount: entries.size,
      witnessBytes,
      capacity,
      warningThreshold,
      bucketCapacity: root.bucketCapacity,
      bucketWarningThreshold,
      largestBucketCount: largestBucket,
      warning: root.phase === 'closed'
        || entries.size >= warningThreshold
        || largestBucket >= bucketWarningThreshold,
    });
  }

  async #replaceTerminalLedgerRootUnderGate(gateOwner, expected, next) {
    return gateOwner.withPartition(next.custodyId, async (owner) => {
      const replaced = await owner.replace(expected?.revision ?? null, clone(next));
      return validateTerminalLedgerRoot(replaced, next.custodyId);
    });
  }

  async #scanLegacyTerminalWitnessesUnderGate(gateOwner) {
    const witnesses = [];
    const seenPartitions = new Set();
    let scannedPartitions = 0;
    let scannedPages = 0;
    let cursor = null;
    for (;;) {
      const page = await gateOwner.scanPartitions({
        cursor,
        limit: TERMINAL_LEDGER_SCAN_PAGE,
      });
      exactKeys(page, ['records', 'nextCursor'], 'agent custody partition scan page');
      if (
        !Array.isArray(page.records)
        || page.records.length > TERMINAL_LEDGER_SCAN_PAGE
      ) {
        throw custodyCorrupt('agent custody partition scan records must be an array');
      }
      scannedPages += 1;
      scannedPartitions += page.records.length;
      if (
        scannedPages > TERMINAL_LEDGER_MAX_SCANNED_PARTITIONS
        || scannedPartitions > TERMINAL_LEDGER_MAX_SCANNED_PARTITIONS
      ) {
        throw terminalLedgerScanLimit();
      }
      for (const scanned of page.records) {
        exactKeys(
          scanned,
          ['partitionId', 'value', 'byteLength'],
          'agent custody partition scan record',
        );
        if (
          typeof scanned.partitionId !== 'string'
          || !Number.isSafeInteger(scanned.byteLength)
          || scanned.byteLength < 0
        ) {
          throw custodyCorrupt('agent custody partition scan record metadata is invalid');
        }
        if (seenPartitions.has(scanned.partitionId)) {
          throw custodyCorrupt('agent custody partition scan returned a duplicate record');
        }
        seenPartitions.add(scanned.partitionId);
        if (
          legacyTerminalWitnessKeyFromId(scanned.partitionId, this.#custodyId) === null
        ) continue;
        const witness = validateCustodyRecord(scanned.value, scanned.partitionId);
        if (terminalWitnessIdFor(this.#custodyId, witness.authorityKey) !== scanned.partitionId) {
          throw custodyCorrupt('legacy agent terminal witness identity is inconsistent');
        }
        if (
          witness.formatVersion !== 1
          || witness.status !== 'deleted'
          || (witness.phase !== 'clearing' && witness.phase !== 'settled')
        ) {
          throw custodyCorrupt('legacy agent terminal witness has an invalid exclusion shape');
        }
        witnesses.push(Object.freeze({
          partitionId: scanned.partitionId,
          revision: witness.revision,
          byteLength: scanned.byteLength,
          entry: Object.freeze({
            authorityKey: witness.authorityKey,
            authority: witness.authority,
          }),
        }));
      }
      if (page.nextCursor === null) break;
      if (
        typeof page.nextCursor !== 'string'
        || page.nextCursor === cursor
      ) {
        throw custodyCorrupt('agent custody partition scan cursor did not advance');
      }
      cursor = page.nextCursor;
    }
    return Object.freeze(witnesses);
  }

  async #readTerminalLedgerBucketUnderGate(gateOwner, root, bucketIndex) {
    const custodyId = terminalLedgerBucketIdFor(this.#custodyId, bucketIndex);
    return gateOwner.withPartition(custodyId, async (owner) => {
      const value = await owner.read();
      if (value === null) return null;
      const bucket = validateTerminalLedgerBucket(value, custodyId);
      if (
        bucket.bucketCount !== root.bucketCount
        || bucket.bucketCapacity !== root.bucketCapacity
      ) {
        throw custodyCorrupt('agent terminal-ledger bucket parameters disagree with its root');
      }
      return bucket;
    });
  }

  async #closeTerminalLedgerUnderGate(gateOwner, root) {
    if (root.phase === 'closed') return root;
    if (!root.legacyCut) {
      // Root closure is a global refusal for v2 readers. Before making that
      // state durable beside a still-v1 primary, also exclude the current
      // exact tuple in the representation understood by a v1 process. A
      // crash may lose availability, but cannot let the old reader publish
      // through the closed-ledger cut.
      const primary = await this.#readRecordAt(this.#custodyId, gateOwner);
      if (primary?.formatVersion === 1 && primary.phase !== 'exhausted') {
        await this.#ensureLegacyTerminalWitnessUnderGate(
          primary.authority,
          'agent_terminal_ledger_closed_during_v1_cut',
          gateOwner,
        );
        await this.#checkpointTerminalLedger('afterLegacyWitnessWrite', {
          authorityKey: primary.authorityKey,
          reason: 'ledger_close_v1_primary',
        });
      }
    }
    const closed = terminalLedgerRootRecord({
      custodyId: this.#custodyId,
      revision: nextSafeCounter(
        root.revision,
        'SNAPBACK_AUTH_CUSTODY_REVISION_EXHAUSTED',
        'agent terminal-ledger revision',
      ),
      phase: 'closed',
      legacyCut: root.legacyCut,
      bucketCount: root.bucketCount,
      bucketCapacity: root.bucketCapacity,
    });
    const replaced = await this.#replaceTerminalLedgerRootUnderGate(gateOwner, root, closed);
    await this.#checkpointTerminalLedger('afterLedgerClosed');
    return replaced;
  }

  async #insertTerminalLedgerEntryUnderGate(gateOwner, root, rawEntry) {
    const entry = normalizeTerminalLedgerEntry(rawEntry);
    if (root.phase === 'closed') return root;
    const bucketIndex = terminalLedgerBucketIndexFor(entry.authorityKey, root.bucketCount);
    const custodyId = terminalLedgerBucketIdFor(this.#custodyId, bucketIndex);
    const bucket = await this.#readTerminalLedgerBucketUnderGate(
      gateOwner,
      root,
      bucketIndex,
    );
    const existing = bucket?.entries.find((candidate) => candidate.authorityKey === entry.authorityKey);
    if (existing !== undefined) {
      if (!sameTerminalLedgerEntry(existing, entry)) {
        throw custodyCorrupt('agent terminal-ledger key collides across distinct tuples');
      }
      return root;
    }
    if ((bucket?.entries.length ?? 0) >= root.bucketCapacity) {
      return this.#closeTerminalLedgerUnderGate(gateOwner, root);
    }
    const next = terminalLedgerBucketRecord({
      custodyId: this.#custodyId,
      revision: (bucket?.revision ?? 0) + 1,
      bucketIndex,
      bucketCount: root.bucketCount,
      bucketCapacity: root.bucketCapacity,
      entries: unionTerminalLedgerEntries(bucket?.entries ?? [], [entry]),
    });
    await gateOwner.withPartition(custodyId, async (owner) => {
      const replaced = await owner.replace(bucket?.revision ?? null, clone(next));
      validateTerminalLedgerBucket(replaced, custodyId);
    });
    return root;
  }

  async #ensureTerminalLedgerUnderGate(
    gateOwner,
    terminalAuthorities,
    onTerminalAuthoritiesEnsured = null,
  ) {
    let root = await this.#readTerminalLedgerRootUnderGate(gateOwner);
    if (root === null) {
      const parameters = normalizeTerminalLedgerParameters(
        this.#storage?.terminalLedgerParameters,
      );
      root = await this.#replaceTerminalLedgerRootUnderGate(
        gateOwner,
        null,
        terminalLedgerRootRecord({
          custodyId: this.#custodyId,
          revision: 1,
          phase: 'preparing',
          bucketCount: parameters.bucketCount,
          bucketCapacity: parameters.bucketCapacity,
        }),
      );
      await this.#checkpointTerminalLedger('afterLedgerPreparing');
    }

    const terminalEntries = terminalAuthorities.map((authority) => Object.freeze({
      authorityKey: canonicalAgentAuthorityKey(authority),
      authority: normalizeDurableAuthority(authority),
    }));
    if (!root.legacyCut) {
      // The v1 witness is the compatibility journal. It must settle before
      // the v2 bucket write: after a crash, a v1 reader sees the exclusion and
      // v2 recovery can always rebuild the bucket by scanning that witness.
      for (const authority of terminalAuthorities) {
        await this.#ensureLegacyTerminalWitnessUnderGate(
          authority,
          'agent_durable_authority_rejected_before_installation',
          gateOwner,
        );
        await this.#checkpointTerminalLedger('afterLegacyWitnessWrite', {
          authorityKey: canonicalAgentAuthorityKey(authority),
          reason: 'terminal_authority_dual_write',
        });
      }
    }
    // Global discovery is confined to the pre-cut migration. Once the cut is
    // durable, candidate tuples absorb their deterministic v1 journal
    // partition by exact lookup instead of walking unrelated custodies.
    const legacyWitnesses = root.legacyCut
      ? Object.freeze([])
      : await this.#scanLegacyTerminalWitnessesUnderGate(gateOwner);
    if (root.legacyCut) {
      for (const authority of terminalAuthorities) {
        root = await this.#absorbLegacyTerminalWitnessUnderGate(
          gateOwner,
          root,
          authority,
        );
      }
    }
    const entries = unionTerminalLedgerEntries(
      legacyWitnesses.map((witness) => witness.entry),
      terminalEntries,
    );
    for (const entry of entries) {
      root = await this.#insertTerminalLedgerEntryUnderGate(gateOwner, root, entry);
      if (root.phase === 'closed') break;
    }
    if (root.phase === 'preparing') {
      await this.#checkpointTerminalLedger('afterLedgerBuckets', {
        migratedWitnessCount: legacyWitnesses.length,
      });
      const active = terminalLedgerRootRecord({
        custodyId: this.#custodyId,
        revision: nextSafeCounter(
          root.revision,
          'SNAPBACK_AUTH_CUSTODY_REVISION_EXHAUSTED',
          'agent terminal-ledger revision',
        ),
        phase: 'active',
        bucketCount: root.bucketCount,
        bucketCapacity: root.bucketCapacity,
      });
      root = await this.#replaceTerminalLedgerRootUnderGate(gateOwner, root, active);
      await this.#checkpointTerminalLedger('afterLedgerActive');
    }

    // A direct terminal CAS still needs to distinguish primary corruption
    // found after its exclusion became durable from corruption that prevented
    // the exclusion itself. Report that boundary before consulting/migrating
    // the primary row below.
    onTerminalAuthoritiesEnsured?.();

    // Complete a settled v1 primary cut on every gate, not only on explicit
    // synchronization. Otherwise a stream of terminal verdicts for distinct
    // tuples could leave the compatibility journal growing even though the
    // bounded ledger is already active or closed.
    await this.#readPrimaryForSynchronizationUnderGate(gateOwner);
    return Object.freeze({ root, legacyWitnesses });
  }

  async #finalizeTerminalLedgerCutUnderGate(gateOwner, legacyWitnesses) {
    let root = await this.#readTerminalLedgerRootUnderGate(gateOwner);
    const primary = await this.#readRecordAt(this.#custodyId, gateOwner);
    const cutIsDurable = primary?.formatVersion === 2 || primary?.phase === 'exhausted';
    if (!cutIsDurable) return;
    if (root.legacyCut) return;
    await this.#checkpointTerminalLedger('afterPrimaryV2');
    for (let index = 0; index < legacyWitnesses.length; index += 1) {
      const witness = legacyWitnesses[index];
      await this.#retireLegacyTerminalWitnessUnderGate(gateOwner, witness);
      await this.#checkpointTerminalLedger('afterLegacyWitnessRemove', {
        remainingWitnessCount: legacyWitnesses.length - index - 1,
      });
    }
    // The cut is the cleanup seal. It is written last: a crash before it
    // rescans the remaining v1 journal, while a reader that observes it knows
    // the initial journal has already been compacted and physically retired.
    const cut = terminalLedgerRootRecord({
      custodyId: this.#custodyId,
      revision: nextSafeCounter(
        root.revision,
        'SNAPBACK_AUTH_CUSTODY_REVISION_EXHAUSTED',
        'agent terminal-ledger revision',
      ),
      phase: root.phase,
      legacyCut: true,
      bucketCount: root.bucketCount,
      bucketCapacity: root.bucketCapacity,
    });
    root = await this.#replaceTerminalLedgerRootUnderGate(gateOwner, root, cut);
  }

  async #readPrimaryForSynchronizationUnderGate(gateOwner) {
    let observed = await this.#readRecordAt(this.#custodyId, gateOwner);
    if (
      observed?.formatVersion !== 1
      || observed.phase !== 'settled'
    ) {
      return observed;
    }
    if (observed.revision >= Number.MAX_SAFE_INTEGER - 1) {
      const root = await this.#readTerminalLedgerRootUnderGate(gateOwner);
      if (
        observed.revision !== Number.MAX_SAFE_INTEGER - 1
        || root?.phase !== 'closed'
      ) return observed;
      // A closed ledger is already a permanent refusal. Consuming the final
      // primary revision for the format cut makes old readers reject the row
      // and lets v2 reclaim the compatibility journal; the resulting MAX
      // record is itself durable counter poison and can never publish.
    }
    const rootBeforePrimaryCut = await this.#readTerminalLedgerRootUnderGate(gateOwner);
    const retireLegacyPrimaryWitness = observed.status === 'deleted'
      || rootBeforePrimaryCut?.phase === 'closed';
    if (retireLegacyPrimaryWitness) {
      await this.#ensureTerminalWitnessUnderGate(
        observed.authority,
        'agent_legacy_durable_tombstone_backfilled',
        gateOwner,
      );
    }
    const migrated = custodyRecord({
      formatVersion: 2,
      custodyId: observed.custodyId,
      authorityEpoch: observed.authorityEpoch,
      revision: nextSafeCounter(
        observed.revision,
        'SNAPBACK_AUTH_CUSTODY_REVISION_EXHAUSTED',
        'agent custody revision',
      ),
      phase: observed.phase,
      status: observed.status,
      authority: observed.authority,
    });
    observed = await gateOwner.withPartition(this.#custodyId, async (owner) => {
      const replaced = await owner.replace(observed.revision, clone(migrated));
      return validateCustodyRecord(replaced, this.#custodyId);
    });
    if (retireLegacyPrimaryWitness) {
      const witness = await this.#readLegacyTerminalWitnessExactUnderGate(
        observed.authority,
        gateOwner,
      );
      if (witness !== null) {
        await this.#retireLegacyTerminalWitnessUnderGate(gateOwner, witness);
        await this.#checkpointTerminalLedger('afterLegacyWitnessRemove', {
          remainingWitnessCount: 0,
          primaryTombstone: true,
        });
      }
    }
    return observed;
  }

  async #readRecordAt(custodyId, gateOwner) {
    return gateOwner.withPartition(custodyId, async (owner) => {
      if (!owner || typeof owner.read !== 'function' || typeof owner.replace !== 'function') {
        throw new TypeError('agent custody owner must provide read() and replace()');
      }
      const value = await owner.read();
      return value === null ? null : validateCustodyRecord(value, custodyId);
    });
  }

  #terminalWitnessId(authority = this.authority) {
    return terminalWitnessIdFor(
      this.#custodyId,
      canonicalAgentAuthorityKey(authority),
    );
  }

  async #readLegacyTerminalWitnessExactUnderGate(authority, gateOwner) {
    const entry = normalizeTerminalLedgerEntry({
      authorityKey: canonicalAgentAuthorityKey(authority),
      authority,
    });
    const partitionId = terminalWitnessIdFor(this.#custodyId, entry.authorityKey);
    return gateOwner.withPartition(partitionId, async (owner) => {
      const value = await owner.read();
      if (value === null) {
        if (typeof owner.retire !== 'function') {
          throw fenceError(
            'SNAPBACK_AUTH_CUSTODY_PARTITION_OWNERSHIP_REQUIRED',
            'agent custody partition owner cannot retire an empty legacy lock carrier',
          );
        }
        await owner.retire(null);
        return null;
      }
      const witness = validateCustodyRecord(value, partitionId);
      if (
        witness.formatVersion !== 1
        || witness.status !== 'deleted'
        || (witness.phase !== 'clearing' && witness.phase !== 'settled')
        || witness.authorityKey !== entry.authorityKey
        || !sameDurableAuthority(witness.authority, entry.authority)
      ) {
        throw custodyCorrupt('legacy agent terminal witness conflicts with its exact tuple');
      }
      return Object.freeze({
        partitionId,
        revision: witness.revision,
        byteLength: encodedJsonByteLength(witness),
        entry,
      });
    });
  }

  async #retireLegacyTerminalWitnessUnderGate(gateOwner, witness) {
    await gateOwner.withPartition(witness.partitionId, async (owner) => {
      if (typeof owner.retire !== 'function') {
        throw fenceError(
          'SNAPBACK_AUTH_CUSTODY_PARTITION_OWNERSHIP_REQUIRED',
          'agent custody partition owner cannot retire compacted terminal witness files',
        );
      }
      // Recovery may have retired this scanned witness earlier in the same
      // universal-gate interval (for example while cutting a closed v1
      // primary). Re-read under the exact partition owner so missing retires
      // its carrier with a null CAS, while a present record uses its current
      // exact revision. Never turn a positive expected revision into an
      // idempotent wildcard at the adapter boundary.
      const currentValue = await owner.read();
      if (currentValue === null) {
        await owner.retire(null);
        return;
      }
      const current = validateCustodyRecord(currentValue, witness.partitionId);
      if (
        current.formatVersion !== 1
        || current.status !== 'deleted'
        || (current.phase !== 'clearing' && current.phase !== 'settled')
        || current.authorityKey !== witness.entry.authorityKey
        || !sameDurableAuthority(current.authority, witness.entry.authority)
      ) {
        throw custodyCorrupt('legacy agent terminal witness changed before retirement');
      }
      await owner.retire(current.revision);
    });
  }

  async #absorbLegacyTerminalWitnessUnderGate(gateOwner, root, authority) {
    const witness = await this.#readLegacyTerminalWitnessExactUnderGate(
      authority,
      gateOwner,
    );
    if (witness === null) return root;
    const nextRoot = await this.#insertTerminalLedgerEntryUnderGate(
      gateOwner,
      root,
      witness.entry,
    );
    // A true cut means the format-2 primary already made every conforming v1
    // reader fail closed. The same universal gate excludes a v1 writer until
    // both physical witness files have been retired.
    if (nextRoot.legacyCut) {
      await this.#retireLegacyTerminalWitnessUnderGate(gateOwner, witness);
      await this.#checkpointTerminalLedger('afterLegacyWitnessRemove', {
        remainingWitnessCount: 0,
        postCutExact: true,
      });
    }
    return nextRoot;
  }

  async #readTerminalWitnessUnderGate(authority = this.authority, gateOwner) {
    let root = await this.#readTerminalLedgerRootUnderGate(gateOwner);
    if (root === null || root.phase === 'preparing') {
      throw custodyCorrupt('agent terminal ledger is unavailable for exclusion');
    }
    const entry = normalizeTerminalLedgerEntry({
      authorityKey: canonicalAgentAuthorityKey(authority),
      authority,
    });
    if (root.legacyCut) {
      root = await this.#absorbLegacyTerminalWitnessUnderGate(
        gateOwner,
        root,
        authority,
      );
    }
    if (root.phase === 'closed') {
      return Object.freeze({ ...entry, terminalLedgerClosed: true });
    }
    const bucketIndex = terminalLedgerBucketIndexFor(entry.authorityKey, root.bucketCount);
    const bucket = await this.#readTerminalLedgerBucketUnderGate(
      gateOwner,
      root,
      bucketIndex,
    );
    return bucket?.entries.find((candidate) => sameTerminalLedgerEntry(candidate, entry)) ?? null;
  }

  async #readTerminalWitness(authority = this.authority) {
    return this.#withCustodyGate((gateOwner) => (
      this.#readTerminalWitnessUnderGate(authority, gateOwner)
    ));
  }

  async #ensureLegacyTerminalWitnessUnderGate(
    authority,
    reason = 'agent_durable_authority_rejected_before_installation',
    gateOwner,
  ) {
    const authorityKey = canonicalAgentAuthorityKey(authority);
    const custodyId = this.#terminalWitnessId(authority);
    await gateOwner.withPartition(custodyId, async (owner) => {
      const existingValue = await owner.read();
      const existing = existingValue === null
        ? null
        : validateCustodyRecord(existingValue, custodyId);
      if (existing !== null) {
        if (
          existing.status !== 'deleted'
          || existing.authorityKey !== authorityKey
          || !sameDurableAuthority(existing.authority, authority)
        ) {
          throw custodyCorrupt('agent terminal witness conflicts with its exact tuple');
        }
        return;
      }
      const transition = custodyTransitionRecords({
        formatVersion: 1,
        custodyId,
        predecessor: null,
        nextEpoch: 0,
        nextStatus: 'deleted',
        nextAuthority: authority,
        reason,
        disposition: 'delete',
      });
      const clearing = await owner.replace(null, clone(transition.clearing));
      const validatedClearing = validateCustodyRecord(clearing, custodyId);
      if (!sameCustodyRecord(validatedClearing, transition.clearing)) {
        throw custodyCorrupt('agent terminal witness CAS returned an unexpected clearing record');
      }
      const settled = await owner.replace(
        transition.clearing.revision,
        clone(transition.settled),
      );
      const validatedSettled = validateCustodyRecord(settled, custodyId);
      if (!sameCustodyRecord(validatedSettled, transition.settled)) {
        throw custodyCorrupt('agent terminal witness CAS returned an unexpected settled record');
      }
    });
  }

  async #ensureTerminalWitnessUnderGate(
    authority,
    reason = 'agent_durable_authority_rejected_before_installation',
    gateOwner,
  ) {
    let root = await this.#readTerminalLedgerRootUnderGate(gateOwner);
    if (!root.legacyCut) {
      await this.#ensureLegacyTerminalWitnessUnderGate(authority, reason, gateOwner);
      await this.#checkpointTerminalLedger('afterLegacyWitnessWrite', {
        authorityKey: canonicalAgentAuthorityKey(authority),
        reason,
      });
    }
    root = await this.#insertTerminalLedgerEntryUnderGate(gateOwner, root, {
      authorityKey: canonicalAgentAuthorityKey(authority),
      authority,
    });
    if (!root.legacyCut) {
      const primary = await this.#readRecordAt(this.#custodyId, gateOwner);
      if (primary?.formatVersion === 2 || primary?.phase === 'exhausted') {
        const witness = await this.#readLegacyTerminalWitnessExactUnderGate(
          authority,
          gateOwner,
        );
        if (witness !== null) {
          await this.#retireLegacyTerminalWitnessUnderGate(gateOwner, witness);
          await this.#checkpointTerminalLedger('afterLegacyWitnessRemove', {
            remainingWitnessCount: 0,
            preCutExact: true,
          });
        }
      }
    }
  }

  async #recordTerminalWitness() {
    return this.#withCustodyGate(async (gateOwner) => {
      // The witness is independent irreversible evidence. Establish it before
      // interpreting the primary row so malformed primary bytes cannot veto
      // terminal exclusion and later reopen after operator repair.
      const observed = await this.#readRecordAt(this.#custodyId, gateOwner);
      const matchesConfigured = observed !== null
        && observed.authorityKey === this.#durableKey
        && sameDurableAuthority(observed.authority, this.authority);
      return {
        observed,
        preservePrimary: observed !== null && !matchesConfigured,
      };
    }, { terminalAuthorities: [this.authority] });
  }

  async #confirmDurableExact(expected, { allowTerminalWitness = false } = {}) {
    if (expected === null) {
      throw custodyCorrupt('agent custody confirmation requires an exact target record');
    }
    return this.#withCustodyGate(async (gateOwner) => {
      if (!allowTerminalWitness && expected.status === 'active') {
        const witness = await this.#readTerminalWitnessUnderGate(
          expected.authority,
          gateOwner,
        );
        if (witness !== null) {
          throw stale('durable agent authority was terminally rejected before confirmation');
        }
      }
      return gateOwner.withPartition(this.#custodyId, async (owner) => {
      const currentValue = await owner.read();
      const current = currentValue === null
        ? null
        : validateCustodyRecord(currentValue, this.#custodyId);
      if (!sameCustodyRecord(current, expected)) {
        throw stale('durable agent custody changed before exact confirmation');
      }
      return current;
      });
    });
  }

  async #replaceTerminalDurableExact(expected, target) {
    let firstError;
    let witnessEnsured = false;
    let primaryCasStarted = false;
    try {
      return await this.#withCustodyGate(async (gateOwner) => {
        const observed = await this.#readRecordAt(this.#custodyId, gateOwner);
        const observedMatchesConfigured = observed !== null
          && observed.authorityKey === this.#durableKey
          && sameDurableAuthority(observed.authority, this.authority);
        if (sameCustodyRecord(observed, target)) {
          return { record: observed, preservePrimary: false, alreadyTerminal: false };
        }
        if (
          observedMatchesConfigured
          && (
            (observed.phase === 'settled' && observed.status === 'deleted')
            || observed.phase === 'exhausted'
          )
        ) {
          return { record: observed, preservePrimary: false, alreadyTerminal: true };
        }
        if (!sameCustodyRecord(observed, expected)) {
          if (observed !== null && !observedMatchesConfigured) {
            return { record: observed, preservePrimary: true, alreadyTerminal: false };
          }
          throw stale('durable agent custody no longer matches the exact terminal CAS predecessor');
        }
        return gateOwner.withPartition(this.#custodyId, async (owner) => {
          const currentValue = await owner.read();
          const current = currentValue === null
            ? null
            : validateCustodyRecord(currentValue, this.#custodyId);
          if (!sameCustodyRecord(current, expected)) {
            throw stale('durable agent custody changed inside the terminal ownership interval');
          }
          primaryCasStarted = true;
          const replaced = await owner.replace(expected?.revision ?? null, clone(target));
          const validated = validateCustodyRecord(replaced, this.#custodyId);
          if (!sameCustodyRecord(validated, target)) {
            throw custodyCorrupt('agent terminal custody CAS returned an unexpected target');
          }
          return { record: validated, preservePrimary: false, alreadyTerminal: false };
        });
      }, {
        terminalAuthorities: [this.authority],
        onTerminalAuthoritiesEnsured() {
          witnessEnsured = true;
        },
      });
    } catch (error) {
      firstError = error;
    }

    // No primary CAS can have committed when validation failed before replace.
    // The terminal witness is already durable, so preserve the precise corrupt
    // diagnosis rather than obscuring it as an ambiguous write outcome.
    if (
      witnessEnsured
      && !primaryCasStarted
      && firstError?.code === 'SNAPBACK_AUTH_CUSTODY_CORRUPT'
    ) throw firstError;

    // Reconcile both throw-after-write and a distinct successor that won by
    // bypassing or preceding this ownership interval. The terminal witness is
    // permanent either way; only the exact configured primary may be changed.
    try {
      return await this.#withCustodyGate(async (gateOwner) => {
        const observed = await this.#readRecordAt(this.#custodyId, gateOwner);
        if (sameCustodyRecord(observed, target)) {
          return { record: observed, preservePrimary: false, alreadyTerminal: false };
        }
        const observedMatchesConfigured = observed !== null
          && observed.authorityKey === this.#durableKey
          && sameDurableAuthority(observed.authority, this.authority);
        if (observed !== null && !observedMatchesConfigured) {
          const witness = await this.#readTerminalWitnessUnderGate(this.authority, gateOwner);
          if (witness !== null) {
            return { record: observed, preservePrimary: true, alreadyTerminal: false };
          }
        }
        if (
          observedMatchesConfigured
          && (
            (observed.phase === 'settled' && observed.status === 'deleted')
            || observed.phase === 'exhausted'
          )
        ) {
          return { record: observed, preservePrimary: false, alreadyTerminal: true };
        }
        throw firstError;
      });
    } catch (reconciliationError) {
      if (reconciliationError === firstError) throw firstError;
      throw fenceError(
        'SNAPBACK_AUTH_CUSTODY_AMBIGUOUS',
        'agent terminal custody CAS failed and could not be reconciled',
        {
          causeCode: firstError?.code ?? null,
          reconciliationCode: reconciliationError?.code ?? null,
        },
      );
    }
  }

  async #replaceDurableExact(
    expected,
    target,
    { allowTerminalWitness = false } = {},
  ) {
    let firstError;
    try {
      return await this.#withCustodyGate(async (gateOwner) => {
        if (!allowTerminalWitness && target.status === 'active') {
          const witness = await this.#readTerminalWitnessUnderGate(
            target.authority,
            gateOwner,
          );
          if (witness !== null) {
            throw stale('durable agent authority was terminally rejected before installation');
          }
          if (
            expected?.status === 'deleted'
            && (
              expected.authorityKey !== target.authorityKey
              || !sameDurableAuthority(expected.authority, target.authority)
            )
          ) {
            // Pre-side-ledger tombstones carry their terminal evidence only in
            // the primary row. Materialize that evidence before replacing the
            // row so an old validated descriptor can never resurrect it.
            await this.#ensureTerminalWitnessUnderGate(
              expected.authority,
              'agent_legacy_durable_tombstone_backfilled',
              gateOwner,
            );
          }
        }
        return gateOwner.withPartition(this.#custodyId, async (owner) => {
        const currentValue = await owner.read();
        const current = currentValue === null
          ? null
          : validateCustodyRecord(currentValue, this.#custodyId);
        if (sameCustodyRecord(current, target)) return current;
        if (!sameCustodyRecord(current, expected)) {
          throw stale('durable agent custody no longer matches the exact CAS predecessor');
        }
        const replaced = await owner.replace(expected?.revision ?? null, clone(target));
        const validated = validateCustodyRecord(replaced, this.#custodyId);
        if (!sameCustodyRecord(validated, target)) {
          throw custodyCorrupt('agent custody CAS returned a record other than its exact target');
        }
        return validated;
        });
      });
    } catch (error) {
      firstError = error;
    }

    // A storage adapter may throw after its transaction committed but before
    // the response reached this process. Only an exact target reread converts
    // that ambiguous outcome to success; every other shape preserves failure.
    try {
      const confirmed = await this.#confirmDurableExact(target, { allowTerminalWitness });
      if (sameCustodyRecord(confirmed, target)) return confirmed;
    } catch (confirmationError) {
      if (confirmationError?.code !== 'SNAPBACK_CLIENT_AUTHORITY_STALE') {
        throw fenceError(
          'SNAPBACK_AUTH_CUSTODY_AMBIGUOUS',
          'agent custody CAS failed and its exact target could not be confirmed',
          {
            causeCode: firstError?.code ?? null,
            confirmationCode: confirmationError?.code ?? null,
          },
        );
      }
    }
    throw firstError;
  }

  async #persistDurableCounterExhaustion(
    error,
    observed,
    proposedAuthority = this.authority,
  ) {
    if (
      this.#storage === null
      || observed === null
      || !isDurableCounterExhaustion(error)
    ) {
      return observed;
    }
    const predecessor = validateCustodyRecord(observed, this.#custodyId);
    return this.#withCustodyGate(async (gateOwner) => {
      const proposedKey = canonicalAgentAuthorityKey(proposedAuthority);
      const predecessorIsProposed = predecessor.authorityKey === proposedKey
        && sameDurableAuthority(predecessor.authority, proposedAuthority);
      if (!predecessorIsProposed) {
        const witness = await this.#readTerminalWitnessUnderGate(
          proposedAuthority,
          gateOwner,
        );
        if (witness !== null) {
          throw stale('terminally rejected proposed authority cannot exhaust its predecessor');
        }
      }
      return gateOwner.withPartition(this.#custodyId, async (owner) => {
        const currentValue = await owner.read();
        const current = currentValue === null
          ? null
          : validateCustodyRecord(currentValue, this.#custodyId);
        if (!sameCustodyRecord(current, predecessor)) {
          throw stale('agent custody changed before counter exhaustion could be persisted');
        }
        if (current.phase === 'exhausted') return current;
        if (current.revision === Number.MAX_SAFE_INTEGER) {
          // Legacy records may already have consumed the last revision. They
          // cannot be rewritten, so every read treats the exact persisted
          // value as poison instead of reopening publication after restart.
          return current;
        }
        const marker = custodyRecord({
          custodyId: current.custodyId,
          authorityEpoch: current.authorityEpoch,
          revision: nextSafeCounter(
            current.revision,
            'SNAPBACK_AUTH_CUSTODY_REVISION_EXHAUSTED',
            'agent custody revision',
          ),
          phase: 'exhausted',
          status: 'deleted',
          authority: current.authority,
        });
        const replaced = await owner.replace(current.revision, clone(marker));
        const validated = validateCustodyRecord(replaced, this.#custodyId);
        if (!sameCustodyRecord(validated, marker)) {
          throw custodyCorrupt('counter exhaustion CAS returned an unexpected marker');
        }
        return validated;
      });
    });
  }

  #installDurableRecord(record) {
    const validated = validateCustodyRecord(record, this.#custodyId);
    if (
      validated.authorityKey !== this.#durableKey
      || !sameDurableAuthority(validated.authority, this.authority)
    ) {
      throw stale('durable agent custody does not match the process credential tuple');
    }
    this.#durableRecord = validated;
    this.#durableEpoch = validated.authorityEpoch;
    this.#durableKey = validated.authorityKey;
    if (validated.phase === 'clearing') this.#authorityDescriptor = null;
    if (validated.status === 'deleted') {
      this.#authorityDescriptor = null;
      this.#terminated = true;
    } else if (this.#terminalDisposition === null) {
      this.#terminated = false;
    }
  }

  async #compareAndCommitDurable(capture, commit) {
    let durableMismatch = false;
    let observedMismatch = null;
    let callbackInvoked = false;
    try {
      const result = await this.#withCustodyGate(async (gateOwner) => {
        const witness = await this.#readTerminalWitnessUnderGate(
          this.authority,
          gateOwner,
        );
        if (witness !== null) {
          durableMismatch = true;
          observedMismatch = witness;
          return { committed: false };
        }
        return gateOwner.withPartition(this.#custodyId, async (owner) => {
        const currentValue = await owner.read();
        const current = currentValue === null
          ? null
          : validateCustodyRecord(currentValue, this.#custodyId);
        if (
          !sameCustodyRecord(current, this.#durableRecord)
          || current?.phase !== 'settled'
          || current?.status !== 'active'
        ) {
          durableMismatch = true;
          observedMismatch = current;
          return { committed: false };
        }
        if (!this.isCurrent(capture)) return { committed: false };
        callbackInvoked = true;
        this.#inCommit = true;
        try {
          const value = commit(Object.freeze({
            ...capture,
            authorityDescriptor: this.authorityDescriptor,
          }));
          if (value && typeof value.then === 'function') {
            throw new TypeError('compareAndCommit callback must be synchronous');
          }
          return { committed: true, value };
        } finally {
          this.#inCommit = false;
        }
        });
      });
      if (durableMismatch) {
        this.#wedgeSync(
          stale('durable agent custody changed before publication'),
          {
            reason: 'agent_custody_missed_wakeup',
            disposition: 'delete',
            previousAuthority: this.authority,
            nextAuthority: null,
            previousCapture: capture,
            capture,
            expectedEpoch: capture.authorityEpoch,
            nextEpoch: observedMismatch?.authorityEpoch ?? capture.authorityEpoch,
            nextAuthorityKey: observedMismatch?.authorityKey ?? capture.authorityKey,
          },
        );
      }
      return result;
    } catch (error) {
      this.#inCommit = false;
      if (!callbackInvoked) {
        this.#wedgeSync(error, {
          reason: 'agent_custody_compare_failed',
          disposition: 'delete',
          previousAuthority: this.authority,
          nextAuthority: null,
          previousCapture: capture,
          capture,
          expectedEpoch: capture.authorityEpoch,
          nextEpoch: capture.authorityEpoch,
          nextAuthorityKey: capture.authorityKey,
        });
      }
      throw error;
    }
  }
}
