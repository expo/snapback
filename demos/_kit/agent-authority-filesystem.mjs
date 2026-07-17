// Secure Node/POSIX storage for AgentAuthorityFence durable custody.
//
// This module is intentionally not re-exported by client.mjs: importing the
// portable client arm must never pull node:fs, node:child_process, or a
// platform lock helper into a browser bundle.
//
// @ref LLP 0055#grant-backed-live-and-queued-replay — only the durable
// actor/credential-generation/grant tuple is persisted; scoped-token bearers
// and carrier ids remain process custody.
// @ref LLP 0059#cross-context-ownership — an OS advisory lock provides the
// cross-process owner and is never stolen on elapsed wall time.

import { AsyncLocalStorage } from 'node:async_hooks';
import {
  lstat,
  mkdir,
  realpath,
} from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { execFile, fork } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import {
  dirname,
  isAbsolute,
  join,
  normalize,
  parse,
  sep,
} from 'node:path';
import { canonicalAgentAuthorityKey } from '../../packages/snapback-contract/auth-coordinator.mjs';

const DIRECTORY_MODE = 0o700;
const SAFE_COUNTER_MAX = Number.MAX_SAFE_INTEGER;
const MAX_RECORD_BYTES = 64 * 1_024;
const PROCESS_OWNERSHIP = new Map();
const PROCESS_OWNERSHIP_CONTEXT = new AsyncLocalStorage();
const DIRECTORY_CAPABILITIES = new Map();
const MAX_RETAINED_DIRECTORY_CAPABILITIES = 32;
const DEFAULT_TERMINAL_BUCKET_COUNT = 64;
const DEFAULT_TERMINAL_BUCKET_CAPACITY = 64;
const MAX_TERMINAL_BUCKET_COUNT = 64;
const MAX_TERMINAL_BUCKET_CAPACITY = 64;
const CAPABILITY_HELPER = fileURLToPath(new URL('./agent-authority-filesystem-helper.mjs', import.meta.url));
const UUID_V7 = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const AUTHORITY_KEY = /^sha256:[a-f0-9]{64}$/u;
const TERMINAL_LEDGER_PREFIX = 'snapback.agent-terminal-ledger.v2:';
const TERMINAL_BUCKET_PREFIX = 'snapback.agent-terminal-bucket.v2:';
const RESERVED_LOGICAL_CUSTODY_PREFIXES = Object.freeze([
  'snapback.agent-custody-gate.v1:',
  'snapback.agent-terminal-witness.v1:',
  TERMINAL_LEDGER_PREFIX,
  TERMINAL_BUCKET_PREFIX,
]);
const PRIMARY_V1_FIELDS = Object.freeze([
  'formatVersion',
  'custodyId',
  'authorityEpoch',
  'revision',
  'phase',
  'status',
  'authorityKey',
  'authority',
  'transition',
]);
const PRIMARY_V2_FIELDS = Object.freeze([
  ...PRIMARY_V1_FIELDS,
  'terminalLedgerVersion',
]);
const TERMINAL_LEDGER_FIELDS = Object.freeze([
  'formatVersion',
  'recordType',
  'custodyId',
  'sourceCustodyId',
  'revision',
  'phase',
  'legacyCut',
  'bucketCount',
  'bucketCapacity',
]);
const TERMINAL_BUCKET_FIELDS = Object.freeze([
  'formatVersion',
  'recordType',
  'custodyId',
  'sourceCustodyId',
  'revision',
  'bucketIndex',
  'bucketCount',
  'bucketCapacity',
  'entries',
]);
const TERMINAL_BUCKET_ENTRY_FIELDS = Object.freeze([
  'authorityKey',
  'authority',
]);
const AUTHORITY_FIELDS = Object.freeze([
  'kind',
  'authMode',
  'actorUserId',
  'credentialId',
  'credentialGeneration',
  'grantId',
]);
const TRANSITION_FIELDS = Object.freeze([
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
]);
const execFileAsync = promisify(execFile);

export const AGENT_AUTHORITY_FILESYSTEM_DIAGNOSTICS = Object.freeze({
  unsupported: 'SNAPBACK_AUTH_CUSTODY_FILESYSTEM_UNSUPPORTED',
  directoryInsecure: 'SNAPBACK_AUTH_CUSTODY_DIRECTORY_INSECURE',
  fileInsecure: 'SNAPBACK_AUTH_CUSTODY_FILE_INSECURE',
  lockUnavailable: 'SNAPBACK_AUTH_CUSTODY_LOCK_UNAVAILABLE',
  lockLost: 'SNAPBACK_AUTH_CUSTODY_LOCK_LOST',
  operationOverlap: 'SNAPBACK_AUTH_CUSTODY_OPERATION_OVERLAP',
  ownershipReentrant: 'SNAPBACK_AUTH_CUSTODY_OWNERSHIP_REENTRANT',
  casStale: 'SNAPBACK_AUTH_CUSTODY_CAS_STALE',
  corrupt: 'SNAPBACK_AUTH_CUSTODY_CORRUPT',
  ioFailed: 'SNAPBACK_AUTH_CUSTODY_IO_FAILED',
  capabilityLimit: 'SNAPBACK_AUTH_CUSTODY_DIRECTORY_CAPABILITY_LIMIT',
  orphanLimit: 'SNAPBACK_AUTH_CUSTODY_ORPHAN_LIMIT',
  orphanCleanupFailed: 'SNAPBACK_AUTH_CUSTODY_ORPHAN_CLEANUP_FAILED',
  partitionScanLimit: 'SNAPBACK_AUTH_CUSTODY_PARTITION_SCAN_LIMIT',
  correlationExhausted: 'SNAPBACK_AUTH_CUSTODY_CORRELATION_EXHAUSTED',
});

const diagnostic = (code, message, details = undefined, cause = undefined) => {
  const error = new Error(`${code}: ${message}`, cause === undefined ? undefined : { cause });
  error.code = code;
  error.diagnostic = {
    code,
    message,
    ...(details === undefined ? {} : { details }),
  };
  return error;
};

const ioFailure = (operation, cause) => diagnostic(
  AGENT_AUTHORITY_FILESYSTEM_DIAGNOSTICS.ioFailed,
  'filesystem agent custody operation failed',
  {
    operation,
    ...(typeof cause?.code === 'string' ? { errno: cause.code } : {}),
  },
  cause,
);

const corrupt = (message, details = undefined, cause = undefined) => diagnostic(
  AGENT_AUTHORITY_FILESYSTEM_DIAGNOSTICS.corrupt,
  message,
  details,
  cause,
);

const clone = (value) => (value === null ? null : JSON.parse(JSON.stringify(value)));

const exactKeys = (value, expected, where) => {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw corrupt(`${where} must be an object`);
  }
  const actual = Object.keys(value).sort();
  const wanted = [...expected].sort();
  if (actual.length !== wanted.length || actual.some((field, index) => field !== wanted[index])) {
    throw corrupt(`${where} has an invalid field set`, { fields: actual });
  }
};

const normalizeCustodyId = (value) => {
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

const normalizeDuration = (value, name, { minimum = 1, maximum = 60_000 } = {}) => {
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum) {
    throw new TypeError(`${name} must be an integer from ${minimum} through ${maximum}`);
  }
  return value;
};

const assertSafeCounter = (value, name, { positive = false } = {}) => {
  if (!Number.isSafeInteger(value) || value < (positive ? 1 : 0)) {
    throw corrupt(`${name} must be a safe ${positive ? 'positive' : 'non-negative'} integer`);
  }
};

const assertUuid = (value, name) => {
  if (!UUID_V7.test(value ?? '')) throw corrupt(`${name} must be a canonical UUIDv7`);
};

const assertAuthority = (value, where) => {
  exactKeys(value, AUTHORITY_FIELDS, where);
  if (value.kind !== 'servicePrincipal' || value.authMode !== 'sessions') {
    throw corrupt(`${where} must be a sessions service principal`);
  }
  assertUuid(value.actorUserId, `${where}.actorUserId`);
  assertUuid(value.credentialId, `${where}.credentialId`);
  assertSafeCounter(value.credentialGeneration, `${where}.credentialGeneration`);
  assertUuid(value.grantId, `${where}.grantId`);
};

const assertNoSecretMaterial = (value, where) => {
  const pending = [value];
  while (pending.length > 0) {
    const current = pending.pop();
    if (current === null || typeof current !== 'object') continue;
    for (const [field, child] of Object.entries(current)) {
      if (/bearer|secret|tokenid|carrier/i.test(field)) {
        throw corrupt(`${where} refuses bearer or carrier material`, { field });
      }
      pending.push(child);
    }
  }
};

const sameAuthority = (left, right) => (
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

const assertTransition = (value, custodyId, where) => {
  exactKeys(value, TRANSITION_FIELDS, where);
  if (value.formatVersion !== 1) throw corrupt(`${where}.formatVersion must be 1`);
  if (typeof value.transitionId !== 'string' || !value.transitionId.startsWith('agent-transition-v1:')) {
    throw corrupt(`${where}.transitionId is invalid`);
  }
  if (value.expectedRevision === null) {
    for (const field of ['expectedEpoch', 'expectedAuthorityKey', 'previousStatus', 'previousAuthority']) {
      if (value[field] !== null) throw corrupt(`${where}.${field} must be null for fresh custody`);
    }
  } else {
    assertSafeCounter(value.expectedRevision, `${where}.expectedRevision`, { positive: true });
    assertSafeCounter(value.expectedEpoch, `${where}.expectedEpoch`);
    if (typeof value.expectedAuthorityKey !== 'string') {
      throw corrupt(`${where}.expectedAuthorityKey is invalid`);
    }
    if (value.previousStatus !== 'active' && value.previousStatus !== 'deleted') {
      throw corrupt(`${where}.previousStatus is invalid`);
    }
    assertAuthority(value.previousAuthority, `${where}.previousAuthority`);
    if (canonicalAgentAuthorityKey(value.previousAuthority) !== value.expectedAuthorityKey) {
      throw corrupt(`${where}.expectedAuthorityKey does not bind its predecessor`);
    }
  }
  assertSafeCounter(value.nextEpoch, `${where}.nextEpoch`);
  if (typeof value.nextAuthorityKey !== 'string') throw corrupt(`${where}.nextAuthorityKey is invalid`);
  if (value.nextStatus !== 'active' && value.nextStatus !== 'deleted') {
    throw corrupt(`${where}.nextStatus is invalid`);
  }
  assertAuthority(value.nextAuthority, `${where}.nextAuthority`);
  if (canonicalAgentAuthorityKey(value.nextAuthority) !== value.nextAuthorityKey) {
    throw corrupt(`${where}.nextAuthorityKey does not bind its successor`);
  }
  if (typeof value.reason !== 'string' || value.reason.length === 0) {
    throw corrupt(`${where}.reason is invalid`);
  }
  if (value.disposition !== 'retain' && value.disposition !== 'delete') {
    throw corrupt(`${where}.disposition is invalid`);
  }
  if (
    (value.expectedRevision === null && value.nextEpoch !== 0)
    || (
      value.expectedRevision !== null
      && (
        value.nextEpoch !== value.expectedEpoch + 1
        || !(
          (
            value.previousStatus === 'active'
            && value.nextStatus === 'deleted'
            && value.expectedAuthorityKey === value.nextAuthorityKey
          )
          || (
            value.nextStatus === 'active'
            && value.expectedAuthorityKey !== value.nextAuthorityKey
          )
        )
      )
    )
  ) {
    throw corrupt(`${where} is not a consecutive exact deletion or distinct replacement`);
  }
  if (value.transitionId !== transitionIdFor({ custodyId, ...value })) {
    throw corrupt(`${where}.transitionId does not bind its exact target`);
  }
};

const assertCustodyRecord = (value, expectedCustodyId) => {
  const fields = value?.formatVersion === 2 ? PRIMARY_V2_FIELDS : PRIMARY_V1_FIELDS;
  exactKeys(value, fields, 'filesystem agent custody record');
  if (value.formatVersion !== 1 && value.formatVersion !== 2) {
    throw corrupt('filesystem agent custody formatVersion must be 1 or 2');
  }
  if (value.formatVersion === 2 && value.terminalLedgerVersion !== 1) {
    throw corrupt('filesystem agent custody terminalLedgerVersion must be 1');
  }
  if (value.custodyId !== expectedCustodyId) {
    throw corrupt('filesystem agent custody record belongs to another partition');
  }
  assertSafeCounter(value.authorityEpoch, 'filesystem agent custody authorityEpoch');
  assertSafeCounter(value.revision, 'filesystem agent custody revision', { positive: true });
  if (
    value.phase !== 'settled'
    && value.phase !== 'clearing'
    && value.phase !== 'exhausted'
  ) {
    throw corrupt('filesystem agent custody phase is invalid');
  }
  if (value.status !== 'active' && value.status !== 'deleted') {
    throw corrupt('filesystem agent custody status is invalid');
  }
  if (!AUTHORITY_KEY.test(value.authorityKey ?? '')) {
    throw corrupt('filesystem agent custody authorityKey is invalid');
  }
  assertAuthority(value.authority, 'filesystem agent custody authority');
  if (canonicalAgentAuthorityKey(value.authority) !== value.authorityKey) {
    throw corrupt('filesystem agent custody authorityKey does not bind its durable tuple');
  }
  if (value.phase === 'clearing') {
    assertTransition(value.transition, expectedCustodyId, 'filesystem agent custody transition');
    if (
      value.transition.nextEpoch !== value.authorityEpoch
      || value.transition.nextStatus !== value.status
      || value.transition.nextAuthorityKey !== value.authorityKey
      || !sameAuthority(value.transition.nextAuthority, value.authority)
      || value.revision !== (
        value.transition.expectedRevision === null
          ? 1
          : value.transition.expectedRevision + 1
      )
    ) {
      throw corrupt('clearing filesystem agent custody does not match its transition successor');
    }
  } else if (value.transition !== null) {
    throw corrupt('non-clearing filesystem agent custody cannot retain a transition');
  }
  if (value.phase === 'exhausted' && value.status !== 'deleted') {
    throw corrupt('exhausted filesystem agent custody must be terminally deleted');
  }
  assertNoSecretMaterial(value, 'filesystem agent custody');
  return value;
};

const normalizeTerminalParameters = (value, where = 'terminalLedgerParameters') => {
  if (
    value === null
    || typeof value !== 'object'
    || Array.isArray(value)
    || Object.keys(value).length !== 2
    || !Object.hasOwn(value, 'bucketCount')
    || !Object.hasOwn(value, 'bucketCapacity')
  ) {
    throw new TypeError(`${where} must contain exactly bucketCount and bucketCapacity`);
  }
  if (
    !Number.isSafeInteger(value.bucketCount)
    || value.bucketCount < 1
    || value.bucketCount > MAX_TERMINAL_BUCKET_COUNT
  ) {
    throw new TypeError(`${where}.bucketCount must be an integer from 1 through ${MAX_TERMINAL_BUCKET_COUNT}`);
  }
  if (
    !Number.isSafeInteger(value.bucketCapacity)
    || value.bucketCapacity < 1
    || value.bucketCapacity > MAX_TERMINAL_BUCKET_CAPACITY
  ) {
    throw new TypeError(`${where}.bucketCapacity must be an integer from 1 through ${MAX_TERMINAL_BUCKET_CAPACITY}`);
  }
  return Object.freeze({
    bucketCount: value.bucketCount,
    bucketCapacity: value.bucketCapacity,
  });
};

const assertLogicalCustodyId = (value, where) => {
  if (
    typeof value !== 'string'
    || value.length === 0
    || value.length > 512
    || /[\u0000-\u001f\u007f-\u009f]/u.test(value)
    || RESERVED_LOGICAL_CUSTODY_PREFIXES.some((prefix) => value.startsWith(prefix))
  ) {
    throw corrupt(`${where} is not a valid logical custody id`);
  }
  return value;
};

const assertTerminalParameters = (value, where) => {
  if (
    !Number.isSafeInteger(value.bucketCount)
    || value.bucketCount < 1
    || value.bucketCount > MAX_TERMINAL_BUCKET_COUNT
    || !Number.isSafeInteger(value.bucketCapacity)
    || value.bucketCapacity < 1
    || value.bucketCapacity > MAX_TERMINAL_BUCKET_CAPACITY
  ) {
    throw corrupt(`${where} has invalid bucket parameters`);
  }
};

const terminalBucketIdentity = (custodyId) => {
  if (!custodyId.startsWith(TERMINAL_BUCKET_PREFIX)) return null;
  const remainder = custodyId.slice(TERMINAL_BUCKET_PREFIX.length);
  const separator = remainder.indexOf(':');
  if (separator <= 0) return null;
  const indexText = remainder.slice(0, separator);
  if (!/^(?:0|[1-9][0-9]*)$/u.test(indexText)) return null;
  const sourceCustodyId = remainder.slice(separator + 1);
  if (sourceCustodyId.length === 0) return null;
  const bucketIndex = Number(indexText);
  if (!Number.isSafeInteger(bucketIndex)) return null;
  return Object.freeze({ bucketIndex, sourceCustodyId });
};

const assertTerminalLedgerRecord = (value, expectedCustodyId) => {
  exactKeys(value, TERMINAL_LEDGER_FIELDS, 'filesystem agent terminal ledger root');
  if (value.formatVersion !== 1 || value.recordType !== 'agentTerminalLedger') {
    throw corrupt('filesystem agent terminal ledger root has an invalid format or record type');
  }
  const sourceCustodyId = expectedCustodyId.startsWith(TERMINAL_LEDGER_PREFIX)
    ? expectedCustodyId.slice(TERMINAL_LEDGER_PREFIX.length)
    : '';
  assertLogicalCustodyId(sourceCustodyId, 'filesystem agent terminal ledger sourceCustodyId');
  if (
    sourceCustodyId.length === 0
    || value.custodyId !== expectedCustodyId
    || value.sourceCustodyId !== sourceCustodyId
  ) {
    throw corrupt('filesystem agent terminal ledger root has an invalid partition identity');
  }
  assertSafeCounter(value.revision, 'filesystem agent terminal ledger root revision', { positive: true });
  if (value.phase !== 'preparing' && value.phase !== 'active' && value.phase !== 'closed') {
    throw corrupt('filesystem agent terminal ledger root phase is invalid');
  }
  if (typeof value.legacyCut !== 'boolean' || (value.phase === 'preparing' && value.legacyCut)) {
    throw corrupt('filesystem agent terminal ledger root legacyCut is invalid');
  }
  assertTerminalParameters(value, 'filesystem agent terminal ledger root');
  assertNoSecretMaterial(value, 'filesystem agent terminal ledger root');
  return value;
};

const assertTerminalBucketRecord = (value, expectedCustodyId) => {
  exactKeys(value, TERMINAL_BUCKET_FIELDS, 'filesystem agent terminal ledger bucket');
  if (value.formatVersion !== 1 || value.recordType !== 'agentTerminalBucket') {
    throw corrupt('filesystem agent terminal ledger bucket has an invalid format or record type');
  }
  const identity = terminalBucketIdentity(expectedCustodyId);
  if (identity !== null) {
    assertLogicalCustodyId(
      identity.sourceCustodyId,
      'filesystem agent terminal ledger bucket sourceCustodyId',
    );
  }
  if (
    identity === null
    || value.custodyId !== expectedCustodyId
    || value.sourceCustodyId !== identity.sourceCustodyId
    || value.bucketIndex !== identity.bucketIndex
  ) {
    throw corrupt('filesystem agent terminal ledger bucket has an invalid partition identity');
  }
  assertSafeCounter(value.revision, 'filesystem agent terminal ledger bucket revision', { positive: true });
  assertTerminalParameters(value, 'filesystem agent terminal ledger bucket');
  if (value.bucketIndex < 0 || value.bucketIndex >= value.bucketCount) {
    throw corrupt('filesystem agent terminal ledger bucket index is outside its declared range');
  }
  if (!Array.isArray(value.entries) || value.entries.length > value.bucketCapacity) {
    throw corrupt('filesystem agent terminal ledger bucket entries exceed capacity');
  }
  let previousKey = null;
  for (const [index, entry] of value.entries.entries()) {
    exactKeys(entry, TERMINAL_BUCKET_ENTRY_FIELDS, `filesystem agent terminal ledger bucket entry ${index}`);
    if (!AUTHORITY_KEY.test(entry.authorityKey ?? '')) {
      throw corrupt('filesystem agent terminal ledger bucket entry has an invalid authorityKey');
    }
    assertAuthority(entry.authority, `filesystem agent terminal ledger bucket entry ${index} authority`);
    if (canonicalAgentAuthorityKey(entry.authority) !== entry.authorityKey) {
      throw corrupt('filesystem agent terminal ledger bucket entry key does not bind its durable tuple');
    }
    if (previousKey !== null && entry.authorityKey <= previousKey) {
      throw corrupt('filesystem agent terminal ledger bucket entries must be strictly key-sorted and unique');
    }
    const bucketIndex = Number.parseInt(entry.authorityKey.slice('sha256:'.length, 'sha256:'.length + 8), 16)
      % value.bucketCount;
    if (bucketIndex !== value.bucketIndex) {
      throw corrupt('filesystem agent terminal ledger bucket entry belongs to another bucket');
    }
    previousKey = entry.authorityKey;
  }
  assertNoSecretMaterial(value, 'filesystem agent terminal ledger bucket');
  return value;
};

const assertPartitionRecord = (value, expectedCustodyId) => {
  if (expectedCustodyId.startsWith(TERMINAL_LEDGER_PREFIX)) {
    return assertTerminalLedgerRecord(value, expectedCustodyId);
  }
  if (expectedCustodyId.startsWith(TERMINAL_BUCKET_PREFIX)) {
    return assertTerminalBucketRecord(value, expectedCustodyId);
  }
  return assertCustodyRecord(value, expectedCustodyId);
};

const samePrimarySemantics = (left, right) => (
  left.custodyId === right.custodyId
  && left.authorityEpoch === right.authorityEpoch
  && left.phase === right.phase
  && left.status === right.status
  && left.authorityKey === right.authorityKey
  && sameAuthority(left.authority, right.authority)
  && JSON.stringify(left.transition) === JSON.stringify(right.transition)
);

const assertCustodyReplacement = (current, next) => {
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
      throw corrupt('fresh filesystem agent custody must initialize or begin a transition at epoch 0 and revision 1');
    }
    return;
  }
  if (current.formatVersion === 2 && next.formatVersion !== 2) {
    throw corrupt('filesystem agent custody format cannot regress from v2');
  }
  if (
    current.formatVersion === 1
    && next.formatVersion === 2
    && current.phase === 'settled'
    && next.revision === current.revision + 1
    && samePrimarySemantics(current, next)
  ) {
    return;
  }
  if (
    current.formatVersion === 1
    && next.formatVersion === 2
    && samePrimarySemantics(current, next)
  ) {
    if (
      current.phase !== 'settled'
      || next.revision !== current.revision + 1
    ) {
      throw corrupt('filesystem agent custody format-only v1-to-v2 migration requires one settled predecessor');
    }
  }
  if (current.revision === SAFE_COUNTER_MAX || next.revision !== current.revision + 1) {
    throw corrupt('filesystem agent custody replacement must advance revision exactly once');
  }
  if (current.phase === 'exhausted') {
    throw corrupt('exhausted filesystem agent custody cannot be replaced');
  }
  if (next.phase === 'exhausted') {
    if (
      next.status !== 'deleted'
      || next.authorityEpoch !== current.authorityEpoch
      || next.authorityKey !== current.authorityKey
      || !sameAuthority(next.authority, current.authority)
    ) {
      throw corrupt('filesystem agent custody exhaustion marker must tombstone its exact predecessor');
    }
    return;
  }
  if (current.phase === 'settled') {
    if (
      current.authorityEpoch === SAFE_COUNTER_MAX
      || next.phase !== 'clearing'
      || next.authorityEpoch !== current.authorityEpoch + 1
    ) {
      throw corrupt('settled filesystem agent custody must advance into the next clearing epoch');
    }
    const transition = next.transition;
    if (
      transition.expectedRevision !== current.revision
      || transition.expectedEpoch !== current.authorityEpoch
      || transition.expectedAuthorityKey !== current.authorityKey
      || transition.previousStatus !== current.status
      || !sameAuthority(transition.previousAuthority, current.authority)
    ) {
      throw corrupt('filesystem agent custody transition does not bind its exact predecessor');
    }
    if (
      current.status === 'deleted'
      && next.status === 'active'
      && current.authorityKey === next.authorityKey
    ) {
      throw corrupt('deleted filesystem agent custody cannot revive the same durable authority tuple');
    }
    return;
  }
  if (
    next.phase !== 'settled'
    || next.authorityEpoch !== current.authorityEpoch
    || next.status !== current.status
    || next.authorityKey !== current.authorityKey
    || !sameAuthority(next.authority, current.authority)
  ) {
    throw corrupt('clearing filesystem agent custody may only settle its exact successor');
  }
};

const sameTerminalParameters = (left, right) => (
  left.sourceCustodyId === right.sourceCustodyId
  && left.bucketCount === right.bucketCount
  && left.bucketCapacity === right.bucketCapacity
);

const assertTerminalLedgerReplacement = (current, next) => {
  if (current === null) {
    if (next.revision !== 1 || next.phase !== 'preparing' || next.legacyCut) {
      throw corrupt('fresh filesystem agent terminal ledger root must begin preparing before the legacy cut at revision 1');
    }
    return;
  }
  if (
    current.revision === SAFE_COUNTER_MAX
    || next.revision !== current.revision + 1
    || !sameTerminalParameters(current, next)
  ) {
    throw corrupt('filesystem agent terminal ledger root replacement must preserve parameters and advance once');
  }
  const validPreparingTransition = current.phase === 'preparing'
    && !current.legacyCut
    && !next.legacyCut
    && (next.phase === 'active' || next.phase === 'closed');
  const validLegacyCut = !current.legacyCut
    && next.legacyCut
    && current.phase === next.phase
    && (current.phase === 'active' || current.phase === 'closed');
  const validActiveClose = current.phase === 'active'
    && next.phase === 'closed'
    && current.legacyCut === next.legacyCut;
  if (!validPreparingTransition && !validLegacyCut && !validActiveClose) {
    throw corrupt('filesystem agent terminal ledger root phase transition is invalid');
  }
};

const assertTerminalBucketReplacement = (current, next) => {
  if (current === null) {
    if (next.revision !== 1) {
      throw corrupt('fresh filesystem agent terminal ledger bucket must begin at revision 1');
    }
    return;
  }
  if (
    current.revision === SAFE_COUNTER_MAX
    || next.revision !== current.revision + 1
    || current.bucketIndex !== next.bucketIndex
    || !sameTerminalParameters(current, next)
  ) {
    throw corrupt('filesystem agent terminal ledger bucket replacement must preserve identity and advance once');
  }
  const nextByKey = new Map(next.entries.map((entry) => [entry.authorityKey, entry]));
  for (const entry of current.entries) {
    const retained = nextByKey.get(entry.authorityKey);
    if (retained === undefined || !sameAuthority(retained.authority, entry.authority)) {
      throw corrupt('filesystem agent terminal ledger bucket replacement cannot forget or alter an entry');
    }
  }
};

const assertPartitionReplacement = (current, next, custodyId) => {
  if (custodyId.startsWith(TERMINAL_LEDGER_PREFIX)) {
    return assertTerminalLedgerReplacement(current, next);
  }
  if (custodyId.startsWith(TERMINAL_BUCKET_PREFIX)) {
    return assertTerminalBucketReplacement(current, next);
  }
  return assertCustodyReplacement(current, next);
};

const storageKey = (custodyId) => createHash('sha256')
  .update(`snapback.agent-authority-custody-file.v1\n${custodyId}`, 'utf8')
  .digest('hex');

const assertNoExtendedAccess = async (path, expectedType) => {
  let stdout;
  try {
    ({ stdout } = await execFileAsync(
      '/bin/ls',
      [process.platform === 'darwin' ? '-lde' : '-ld', path],
      {
      encoding: 'utf8',
      maxBuffer: 16 * 1_024,
      },
    ));
  } catch (error) {
    throw ioFailure('inspect-access-control', error);
  }
  const permissions = stdout.trimStart().split(/\s+/u)[0] ?? '';
  const expected = expectedType === 'directory' ? 'drwx------' : '-rw-------';
  const hasAcl = permissions.includes('+')
    || stdout.split('\n').some((line) => /^\s*\d+:/u.test(line));
  if (permissions.slice(0, expected.length) !== expected || hasAcl) {
    throw diagnostic(
      expectedType === 'directory'
        ? AGENT_AUTHORITY_FILESYSTEM_DIAGNOSTICS.directoryInsecure
        : AGENT_AUTHORITY_FILESYSTEM_DIAGNOSTICS.fileInsecure,
      `filesystem agent custody ${expectedType} cannot carry extended access controls`,
      { permissions },
    );
  }
};

const assertAncestorAclSafe = async (path) => {
  let stdout;
  try {
    ({ stdout } = await execFileAsync(
      '/bin/ls',
      [process.platform === 'darwin' ? '-lde' : '-ld', path],
      { encoding: 'utf8', maxBuffer: 16 * 1_024 },
    ));
  } catch (error) {
    throw ioFailure('inspect-ancestor-access-control', error);
  }
  const permissions = stdout.trimStart().split(/\s+/u)[0] ?? '';
  const unsafeMacAllow = stdout.split('\n').some((line) => (
    /\ballow\b/u.test(line)
    && /\b(add_file|add_subdirectory|delete|delete_child|write|writeattr|writeextattr|writesecurity|chown)\b/u.test(line)
  ));
  if ((permissions.includes('+') && process.platform !== 'darwin') || unsafeMacAllow) {
    throw diagnostic(
      AGENT_AUTHORITY_FILESYSTEM_DIAGNOSTICS.directoryInsecure,
      'filesystem agent custody ancestor grants unsafe extended write authority',
      { path },
    );
  }
};

const assertLexicalPathSafe = async (directory) => {
  const { root } = parse(directory);
  const relative = directory.slice(root.length);
  let cursor = root;
  for (const component of relative.split(sep).filter(Boolean)) {
    cursor = join(cursor, component);
    let info;
    try {
      info = await lstat(cursor);
    } catch (error) {
      if (error?.code === 'ENOENT') return;
      throw ioFailure('inspect-lexical-directory', error);
    }
    if (info.isSymbolicLink() && info.uid !== 0) {
      throw diagnostic(
        AGENT_AUTHORITY_FILESYSTEM_DIAGNOSTICS.directoryInsecure,
        'filesystem agent custody path cannot traverse an untrusted symbolic link',
        { path: cursor, uid: info.uid },
      );
    }
  }
};

const assertCanonicalAncestors = async (directory, expectedAncestors = null) => {
  let cursor = directory;
  const ancestors = [];
  const effectiveUid = process.geteuid();
  for (;;) {
    let info;
    try {
      info = await lstat(cursor);
    } catch (error) {
      throw ioFailure('inspect-directory-ancestor', error);
    }
    if (!info.isDirectory() || info.isSymbolicLink()) {
      throw diagnostic(
        AGENT_AUTHORITY_FILESYSTEM_DIAGNOSTICS.directoryInsecure,
        'filesystem agent custody path cannot traverse symbolic or non-directory ancestors',
        { path: cursor },
      );
    }
    if (info.uid !== 0 && info.uid !== effectiveUid) {
      throw diagnostic(
        AGENT_AUTHORITY_FILESYSTEM_DIAGNOSTICS.directoryInsecure,
        'filesystem agent custody path has an untrusted ancestor owner',
        { path: cursor, uid: info.uid },
      );
    }
    if (
      cursor !== directory
      && (info.mode & 0o022) !== 0
      && (info.mode & 0o1000) === 0
    ) {
      throw diagnostic(
        AGENT_AUTHORITY_FILESYSTEM_DIAGNOSTICS.directoryInsecure,
        'filesystem agent custody path cannot traverse a replaceable ancestor',
        { path: cursor },
      );
    }
    const identity = Object.freeze({
      path: cursor,
      dev: info.dev,
      ino: info.ino,
      uid: info.uid,
      mode: info.mode & 0o7777,
    });
    const expected = expectedAncestors?.[ancestors.length] ?? null;
    if (
      expected !== null
      && (
        identity.path !== expected.path
        || identity.dev !== expected.dev
        || identity.ino !== expected.ino
        || identity.uid !== expected.uid
        || identity.mode !== expected.mode
      )
    ) {
      throw diagnostic(
        AGENT_AUTHORITY_FILESYSTEM_DIAGNOSTICS.directoryInsecure,
        'filesystem agent custody ancestor identity changed while owned',
        { path: cursor },
      );
    }
    if (expectedAncestors === null) await assertAncestorAclSafe(cursor);
    ancestors.push(identity);
    const parent = dirname(cursor);
    if (parent === cursor) break;
    cursor = parent;
  }
  if (expectedAncestors !== null && ancestors.length !== expectedAncestors.length) {
    throw diagnostic(
      AGENT_AUTHORITY_FILESYSTEM_DIAGNOSTICS.directoryInsecure,
      'filesystem agent custody ancestor chain changed while owned',
    );
  }
  return Object.freeze(ancestors);
};

const assertPrivateDirectory = async (directory, expectedIdentity = null) => {
  await assertLexicalPathSafe(directory);
  let info;
  try {
    info = await lstat(directory);
  } catch (error) {
    if (error?.code !== 'ENOENT' || expectedIdentity !== null) {
      if (error?.code === 'ENOENT' && expectedIdentity !== null) {
        throw diagnostic(
          AGENT_AUTHORITY_FILESYSTEM_DIAGNOSTICS.directoryInsecure,
          'filesystem agent custody directory disappeared while owned',
        );
      }
      throw ioFailure('inspect-directory', error);
    }
    try {
      await mkdir(directory, { recursive: true, mode: DIRECTORY_MODE });
      await assertLexicalPathSafe(directory);
      info = await lstat(directory);
    } catch (createError) {
      throw ioFailure('create-directory', createError);
    }
  }
  const effectiveUid = process.geteuid();
  if (
    !info.isDirectory()
    || info.isSymbolicLink()
    || (info.mode & 0o7777) !== DIRECTORY_MODE
    || info.uid !== effectiveUid
  ) {
    throw diagnostic(
      AGENT_AUTHORITY_FILESYSTEM_DIAGNOSTICS.directoryInsecure,
      'filesystem agent custody directory must be an owned real 0700 directory',
    );
  }
  let resolved;
  try {
    resolved = await realpath(directory);
  } catch (error) {
    throw ioFailure('resolve-directory', error);
  }
  let resolvedInfo;
  try {
    resolvedInfo = await lstat(resolved);
  } catch (error) {
    throw ioFailure('inspect-resolved-directory', error);
  }
  if (resolvedInfo.dev !== info.dev || resolvedInfo.ino !== info.ino) {
    throw diagnostic(
      AGENT_AUTHORITY_FILESYSTEM_DIAGNOSTICS.directoryInsecure,
      'filesystem agent custody path changed while resolving its canonical identity',
    );
  }
  const ancestors = await assertCanonicalAncestors(
    resolved,
    expectedIdentity?.ancestors ?? null,
  );
  if (expectedIdentity === null) await assertNoExtendedAccess(resolved, 'directory');
  const identity = Object.freeze({
    dev: info.dev,
    ino: info.ino,
    uid: info.uid,
    resolved,
    ancestors,
  });
  if (
    expectedIdentity !== null
    && (
      identity.dev !== expectedIdentity.dev
      || identity.ino !== expectedIdentity.ino
      || identity.uid !== expectedIdentity.uid
      || identity.resolved !== expectedIdentity.resolved
    )
  ) {
    throw diagnostic(
      AGENT_AUTHORITY_FILESYSTEM_DIAGNOSTICS.directoryInsecure,
      'filesystem agent custody directory identity changed while owned',
    );
  }
  return identity;
};

const remoteError = (value) => {
  const error = new Error(value?.message ?? 'filesystem custody capability helper failed');
  if (typeof value?.code === 'string') error.code = value.code;
  if (value?.diagnostic && typeof value.diagnostic === 'object') {
    error.diagnostic = value.diagnostic;
  }
  return error;
};

const serializeHookError = (error) => ({
  code: typeof error?.code === 'string' ? error.code : null,
  message: error?.message ?? String(error),
  diagnostic: error?.diagnostic ?? null,
});

class RetainedDirectoryCapability {
  #child;
  #closed = false;
  #hooks = new Map();
  #nextRequestId;
  #nextSessionId;
  #pending = new Map();
  #stderr = '';
  #terminalError = null;

  constructor(directory, counterSeeds = null) {
    this.directory = directory;
    this.#nextRequestId = counterSeeds?.requestId ?? 1;
    this.#nextSessionId = counterSeeds?.sessionId ?? 1;
    this.#child = fork(CAPABILITY_HELPER, [], {
      execArgv: [],
      stdio: ['ignore', 'ignore', 'pipe', 'ipc'],
      serialization: 'advanced',
    });
    this.#child.stderr.setEncoding('utf8');
    this.#child.stderr.on('data', (chunk) => {
      this.#stderr = `${this.#stderr}${chunk}`.slice(-16 * 1_024);
    });
    this.#child.stderr.unref?.();
    this.#child.on('message', (message) => this.#onMessage(message));
    this.#child.once('error', (error) => this.#fail(diagnostic(
      AGENT_AUTHORITY_FILESYSTEM_DIAGNOSTICS.lockLost,
      'filesystem agent custody directory capability helper failed',
      typeof error?.code === 'string' ? { errno: error.code } : undefined,
      error,
    )));
    this.#child.once('exit', (code, signal) => {
      this.#fail(diagnostic(
        AGENT_AUTHORITY_FILESYSTEM_DIAGNOSTICS.lockLost,
        'filesystem agent custody directory capability helper exited',
        {
          code,
          signal,
          ...(this.#stderr.length === 0 ? {} : { helperStderr: this.#stderr }),
        },
      ));
    });
    this.#unref();
  }

  async initialize(identity, helperHookId = null) {
    return this.#request('initialize', {
      directory: this.directory,
      expectedIdentity: {
        dev: identity.dev,
        ino: identity.ino,
        uid: identity.uid,
      },
      testNextHookId: helperHookId,
    });
  }

  nextSessionId() {
    if (this.#nextSessionId === null) {
      const error = this.#correlationExhausted('session');
      this.#retireForCorrelationExhaustion(error);
      throw error;
    }
    const sequence = this.#nextSessionId;
    this.#nextSessionId = sequence === Number.MAX_SAFE_INTEGER ? null : sequence + 1;
    const id = `${process.pid}:${sequence}`;
    return id;
  }

  async begin(sessionId, lockName, recordName, timeoutMs, hooks) {
    this.#hooks.set(sessionId, hooks ?? null);
    try {
      return await this.#request('begin', { sessionId, lockName, recordName, timeoutMs });
    } catch (error) {
      this.#hooks.delete(sessionId);
      throw error;
    }
  }

  read(sessionId, recordName) {
    return this.#request('read', { sessionId, recordName });
  }

  replace(sessionId, recordName, expectedRevision, encoded) {
    return this.#request('replace', {
      sessionId,
      recordName,
      expectedRevision,
      encoded,
    });
  }

  remove(sessionId, recordName, expectedRevision) {
    return this.#request('remove', {
      sessionId,
      recordName,
      expectedRevision,
    });
  }

  retire(sessionId, recordName, expectedRevision) {
    return this.#request('retire', {
      sessionId,
      recordName,
      expectedRevision,
    });
  }

  scan(sessionId, cursor, limit) {
    return this.#request('scan', { sessionId, cursor, limit });
  }

  async release(sessionId) {
    try {
      await this.#request('release', { sessionId });
    } finally {
      this.#hooks.delete(sessionId);
    }
  }

  retireAfterInitializationFailure() {
    if (this.#closed) return;
    this.#closed = true;
    for (const pending of this.#pending.values()) {
      pending.reject(diagnostic(
        AGENT_AUTHORITY_FILESYSTEM_DIAGNOSTICS.lockLost,
        'filesystem agent custody directory capability initialization failed',
      ));
    }
    this.#pending.clear();
    this.#hooks.clear();
    this.#child.kill('SIGTERM');
  }

  #request(command, fields) {
    if (this.#closed || !this.#child.connected) {
      const refused = Promise.reject(this.#terminalError ?? diagnostic(
        AGENT_AUTHORITY_FILESYSTEM_DIAGNOSTICS.lockLost,
        'filesystem agent custody directory capability is unavailable',
      ));
      void refused.then(() => {}, () => {});
      return refused;
    }
    if (this.#nextRequestId === null) {
      const error = this.#correlationExhausted('request');
      this.#retireForCorrelationExhaustion(error);
      const refused = Promise.reject(error);
      void refused.then(() => {}, () => {});
      return refused;
    }
    const requestId = this.#nextRequestId;
    this.#nextRequestId = requestId === Number.MAX_SAFE_INTEGER ? null : requestId + 1;
    this.#ref();
    return new Promise((resolve, reject) => {
      this.#pending.set(requestId, { resolve, reject });
      try {
        this.#child.send({ kind: 'request', requestId, command, ...fields }, (error) => {
          if (error == null) return;
          const pending = this.#pending.get(requestId);
          if (pending === undefined) return;
          this.#pending.delete(requestId);
          pending.reject(ioFailure('send-capability-command', error));
          this.#unrefIfIdle();
        });
      } catch (error) {
        this.#pending.delete(requestId);
        reject(ioFailure('send-capability-command', error));
        this.#unrefIfIdle();
      }
    });
  }

  #onMessage(message) {
    if (message?.kind === 'response') {
      const pending = this.#pending.get(message.requestId);
      if (pending === undefined) return;
      this.#pending.delete(message.requestId);
      if (message.ok) pending.resolve(message.value);
      else {
        const error = remoteError(message.error);
        if (error.code === AGENT_AUTHORITY_FILESYSTEM_DIAGNOSTICS.correlationExhausted) {
          this.#retireForCorrelationExhaustion(error);
        }
        pending.reject(error);
      }
      this.#unrefIfIdle();
      return;
    }
    if (message?.kind !== 'hook') return;
    const hook = this.#hooks.get(message.sessionId)?.[message.name];
    Promise.resolve()
      .then(() => (typeof hook === 'function' ? hook(message.context) : undefined))
      .then(
        () => this.#sendHookResult(message.hookId, true),
        (error) => this.#sendHookResult(message.hookId, false, serializeHookError(error)),
      );
  }

  #sendHookResult(hookId, ok, error = undefined) {
    if (this.#closed || !this.#child.connected) return;
    try {
      this.#child.send({ kind: 'hookResult', hookId, ok, error });
    } catch {
      // Child exit rejects the owning request and is the authoritative error.
    }
  }

  #fail(error) {
    if (this.#closed) return;
    this.#closed = true;
    for (const pending of this.#pending.values()) pending.reject(error);
    this.#pending.clear();
    this.#hooks.clear();
  }

  #correlationExhausted(axis) {
    return this.#terminalError ?? diagnostic(
      AGENT_AUTHORITY_FILESYSTEM_DIAGNOSTICS.correlationExhausted,
      'filesystem agent custody capability correlation space is exhausted',
      { axis, maximum: Number.MAX_SAFE_INTEGER },
    );
  }

  #retireForCorrelationExhaustion(error) {
    if (this.#terminalError !== null) return;
    this.#terminalError = error;
    this.#closed = true;
    for (const pending of this.#pending.values()) pending.reject(error);
    this.#pending.clear();
    this.#hooks.clear();
    this.#child.kill('SIGTERM');
  }

  #ref() {
    this.#child.ref();
    this.#child.channel?.ref?.();
  }

  #unref() {
    this.#child.unref();
    this.#child.channel?.unref?.();
  }

  #unrefIfIdle() {
    if (this.#pending.size === 0) this.#unref();
  }
}

const retainedDirectoryCapability = async (directory, counterSeeds = null) => {
  let capability = DIRECTORY_CAPABILITIES.get(directory);
  if (capability !== undefined) return capability;
  // Retained capabilities deliberately survive for the process lifetime: an
  // idle eviction followed by pathname re-resolution would reopen the ABA this
  // adapter exists to close. Bound distinct configured directories instead.
  // A helper that dies remains a closed capability until process restart; it
  // is never silently recreated from a potentially replaced pathname.
  if (DIRECTORY_CAPABILITIES.size >= MAX_RETAINED_DIRECTORY_CAPABILITIES) {
    throw diagnostic(
      AGENT_AUTHORITY_FILESYSTEM_DIAGNOSTICS.capabilityLimit,
      'filesystem agent custody retained-directory capacity is exhausted',
      { maximumDirectories: MAX_RETAINED_DIRECTORY_CAPABILITIES },
    );
  }
  capability = (async () => {
    const identity = await assertPrivateDirectory(directory);
    const retained = new RetainedDirectoryCapability(directory, counterSeeds);
    try {
      await retained.initialize(identity, counterSeeds?.hookId ?? null);
      return retained;
    } catch (error) {
      retained.retireAfterInitializationFailure();
      throw error;
    }
  })();
  DIRECTORY_CAPABILITIES.set(directory, capability);
  try {
    return await capability;
  } catch (error) {
    if (DIRECTORY_CAPABILITIES.get(directory) === capability) {
      DIRECTORY_CAPABILITIES.delete(directory);
    }
    throw error;
  }
};

const withProcessOwnership = async (key, operation) => {
  const held = PROCESS_OWNERSHIP_CONTEXT.getStore();
  if (held?.has(key)) {
    throw diagnostic(
      AGENT_AUTHORITY_FILESYSTEM_DIAGNOSTICS.ownershipReentrant,
      'filesystem agent custody ownership callbacks are non-reentrant',
      { key },
    );
  }
  const previous = PROCESS_OWNERSHIP.get(key) ?? Promise.resolve();
  let release;
  const current = new Promise((resolve) => { release = resolve; });
  PROCESS_OWNERSHIP.set(key, current);
  await previous.catch(() => {});
  try {
    return await PROCESS_OWNERSHIP_CONTEXT.run(
      new Set([...(held ?? []), key]),
      operation,
    );
  } finally {
    release();
    if (PROCESS_OWNERSHIP.get(key) === current) PROCESS_OWNERSHIP.delete(key);
  }
};

/**
 * Create Node/POSIX durable custody for AgentAuthorityFence.
 *
 * `directory` is required and absolute. It is created as 0700 when absent;
 * an existing directory or record with broader permissions is refused rather
 * than silently trusted. Record names are domain-separated custody-id hashes.
 */
export function createFilesystemAgentAuthorityCustodyStorage({
  directory,
  lockTimeoutMs = 5_000,
  testHooks = null,
  testCounterSeeds = null,
  terminalLedgerParameters = Object.freeze({
    bucketCount: DEFAULT_TERMINAL_BUCKET_COUNT,
    bucketCapacity: DEFAULT_TERMINAL_BUCKET_CAPACITY,
  }),
  terminalLedgerCheckpoint = null,
} = {}) {
  if (process.platform === 'win32') {
    throw diagnostic(
      AGENT_AUTHORITY_FILESYSTEM_DIAGNOSTICS.unsupported,
      'filesystem agent custody cannot prove POSIX mode or lock semantics on this platform',
    );
  }
  if (typeof directory !== 'string' || directory.length === 0 || !isAbsolute(directory)) {
    throw new TypeError('filesystem agent custody directory must be an absolute path');
  }
  const root = parse(directory).root;
  if (
    normalize(directory) !== directory
    || (directory.length > root.length && directory.endsWith(sep))
  ) {
    throw new TypeError('filesystem agent custody directory must be a normalized path without a trailing separator');
  }
  normalizeDuration(lockTimeoutMs, 'lockTimeoutMs');
  if (
    testCounterSeeds !== null
    && (
      typeof testCounterSeeds !== 'object'
      || Array.isArray(testCounterSeeds)
      || Object.keys(testCounterSeeds).some(
        (name) => !['requestId', 'sessionId', 'hookId'].includes(name),
      )
      || Object.values(testCounterSeeds).some(
        (value) => !Number.isSafeInteger(value) || value < 1,
      )
    )
  ) {
    throw new TypeError('filesystem agent custody testCounterSeeds are invalid');
  }
  const normalizedTestCounterSeeds = testCounterSeeds === null
    ? null
    : Object.freeze({ ...testCounterSeeds });
  const normalizedTerminalLedgerParameters = normalizeTerminalParameters(terminalLedgerParameters);
  if (terminalLedgerCheckpoint !== null && typeof terminalLedgerCheckpoint !== 'function') {
    throw new TypeError('filesystem agent custody terminalLedgerCheckpoint must be a function or null');
  }
  const capabilityTestHookNames = [
    'beforeLock',
    'beforeOrphanCleanup',
    'beforeOrphanUnlink',
    'beforeTemporaryCreate',
    'afterTemporaryCreate',
    'beforeRecordRename',
    'afterRecordRename',
    'beforeRecordRemove',
    'afterRecordUnlink',
    'afterRecordRemove',
    'beforeLockRetire',
    'beforeLockClose',
    'afterLockClose',
    'afterLockUnlink',
    'afterLockRetireSync',
  ];
  const terminalLedgerCheckpointNames = [
    'afterLedgerPreparing',
    'afterLegacyWitnessWrite',
    'afterLedgerBuckets',
    'afterLedgerActive',
    'afterLedgerClosed',
    'afterPrimaryV2',
    'afterLegacyWitnessRemove',
  ];
  const testHookNames = [
    ...capabilityTestHookNames,
    ...terminalLedgerCheckpointNames,
  ];
  if (
    testHooks !== null
    && (
      typeof testHooks !== 'object'
      || Array.isArray(testHooks)
      || Object.keys(testHooks).some((name) => !testHookNames.includes(name))
      || testHookNames.some(
        (name) => testHooks[name] !== undefined && typeof testHooks[name] !== 'function',
      )
    )
  ) {
    throw new TypeError('filesystem agent custody testHooks are invalid');
  }

  const pathsFor = (rawCustodyId) => {
    const custodyId = normalizeCustodyId(rawCustodyId);
    const key = storageKey(custodyId);
    return Object.freeze({
      custodyId,
      recordName: `${key}.json`,
      lockName: `${key}.lock`,
    });
  };

  let lastMaintenance = Object.freeze({
    scannedEntries: 0,
    orphanCount: 0,
    orphanBytes: 0,
    removedCount: 0,
  });

  const withOwnership = async (rawCustodyId, operation) => {
    if (typeof operation !== 'function') {
      throw new TypeError('filesystem agent custody ownership requires an operation callback');
    }
    const { custodyId, recordName, lockName } = pathsFor(rawCustodyId);
    return withProcessOwnership(`${directory}\u0000${lockName}`, async () => {
      const capability = await retainedDirectoryCapability(directory, normalizedTestCounterSeeds);
      const sessionId = capability.nextSessionId();
      const boundHooks = testHooks === null ? null : Object.fromEntries(
        capabilityTestHookNames
          .filter((name) => typeof testHooks[name] === 'function')
          .map((name) => [name, (context) => testHooks[name](Object.freeze({
            custodyId,
            ...context,
          }))]),
      );
      lastMaintenance = Object.freeze(await capability.begin(
        sessionId,
        lockName,
        recordName,
        lockTimeoutMs,
        boundHooks,
      ));
      let active = true;
      let acceptingOwnerOperations = true;
      let retired = false;
      let ownerOperationActive = false;
      const ownerOperations = new Set();
      const runOwnerOperation = (operationName, operationBody) => {
        if (!active || !acceptingOwnerOperations || retired) {
          const refused = Promise.reject(diagnostic(
            AGENT_AUTHORITY_FILESYSTEM_DIAGNOSTICS.lockLost,
            retired
              ? 'filesystem agent custody ownership was retired'
              : 'filesystem agent custody ownership was released',
          ));
          void refused.then(() => {}, () => {});
          return refused;
        }
        if (ownerOperationActive) {
          const refused = Promise.reject(diagnostic(
            AGENT_AUTHORITY_FILESYSTEM_DIAGNOSTICS.operationOverlap,
            'filesystem agent custody owner operations must not overlap',
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
        // Attach a rejection observer immediately while retaining the exact
        // task for the ownership scope's mandatory join.
        void task.then(() => {}, () => {});
        return task;
      };
      const owner = Object.freeze({
        withPartition(rawPartitionId, partitionOperation) {
          return runOwnerOperation('withPartition', async () => {
          const partitionId = normalizeCustodyId(rawPartitionId);
          if (partitionId === custodyId) {
            throw diagnostic(
              AGENT_AUTHORITY_FILESYSTEM_DIAGNOSTICS.ownershipReentrant,
              'filesystem agent custody ownership cannot reacquire its current partition',
              { custodyId },
            );
          }
          return withOwnership(partitionId, partitionOperation);
          });
        },
        read() {
          return runOwnerOperation('read', async () => {
            const bytes = await capability.read(sessionId, recordName);
            if (bytes === null) return null;
            let parsed;
            try {
              parsed = JSON.parse(bytes);
            } catch (error) {
              throw corrupt('filesystem agent custody record is not valid JSON', undefined, error);
            }
            return clone(assertPartitionRecord(parsed, custodyId));
          });
        },
        replace(expectedRevision, nextValue) {
          return runOwnerOperation('replace', async () => {
            if (expectedRevision !== null) {
              assertSafeCounter(expectedRevision, 'filesystem agent custody expectedRevision', {
                positive: true,
              });
            }
            const currentBytes = await capability.read(sessionId, recordName);
            let current = null;
            if (currentBytes !== null) {
              try {
                current = clone(assertPartitionRecord(JSON.parse(currentBytes), custodyId));
              } catch (error) {
                if (error?.code?.startsWith?.('SNAPBACK_')) throw error;
                throw corrupt('filesystem agent custody record is not valid JSON', undefined, error);
              }
            }
            const actualRevision = current?.revision ?? null;
            if (actualRevision !== expectedRevision) {
              throw diagnostic(
                AGENT_AUTHORITY_FILESYSTEM_DIAGNOSTICS.casStale,
                'durable filesystem agent custody changed before compare-and-swap',
                { expectedRevision, actualRevision },
              );
            }
            const next = clone(assertPartitionRecord(clone(nextValue), custodyId));
            assertPartitionReplacement(current, next, custodyId);
            const encoded = `${JSON.stringify(next)}\n`;
            if (Buffer.byteLength(encoded, 'utf8') > MAX_RECORD_BYTES) {
              throw diagnostic(
                AGENT_AUTHORITY_FILESYSTEM_DIAGNOSTICS.fileInsecure,
                'filesystem agent custody record exceeds its bounded envelope',
                { maximumBytes: MAX_RECORD_BYTES },
              );
            }
            await capability.replace(sessionId, recordName, expectedRevision, encoded);
            return clone(next);
          });
        },
        remove(expectedRevision) {
          return runOwnerOperation('remove', async () => {
            assertSafeCounter(expectedRevision, 'filesystem agent custody expectedRevision', {
              positive: true,
            });
            const currentBytes = await capability.read(sessionId, recordName);
            let current = null;
            if (currentBytes !== null) {
              try {
                current = clone(assertPartitionRecord(JSON.parse(currentBytes), custodyId));
              } catch (error) {
                if (error?.code?.startsWith?.('SNAPBACK_')) throw error;
                throw corrupt('filesystem agent custody record is not valid JSON', undefined, error);
              }
            }
            const actualRevision = current?.revision ?? null;
            if (actualRevision !== expectedRevision) {
              throw diagnostic(
                AGENT_AUTHORITY_FILESYSTEM_DIAGNOSTICS.casStale,
                'durable filesystem agent custody changed before compare-and-remove',
                { expectedRevision, actualRevision },
              );
            }
            await capability.remove(sessionId, recordName, expectedRevision);
            return true;
          });
        },
        retire(expectedRevision) {
          return runOwnerOperation('retire', async () => {
            if (expectedRevision !== null) {
              assertSafeCounter(expectedRevision, 'filesystem agent custody expectedRevision', {
                positive: true,
              });
            }
            const currentBytes = await capability.read(sessionId, recordName);
            if (currentBytes !== null) {
              let current;
              try {
                current = clone(assertPartitionRecord(JSON.parse(currentBytes), custodyId));
              } catch (error) {
                if (error?.code?.startsWith?.('SNAPBACK_')) throw error;
                throw corrupt('filesystem agent custody record is not valid JSON', undefined, error);
              }
              if (current.revision !== expectedRevision) {
                throw diagnostic(
                  AGENT_AUTHORITY_FILESYSTEM_DIAGNOSTICS.casStale,
                  'durable filesystem agent custody changed before compare-and-retire',
                  { expectedRevision, actualRevision: current.revision },
                );
              }
            } else if (expectedRevision !== null) {
              // Let the helper repeat the exact null-versus-positive CAS
              // against its relative snapshot. Once dispatched, this owner is
              // consumed even when that exact-CAS refusal prevents retirement.
              try {
                return await capability.retire(sessionId, recordName, expectedRevision);
              } finally {
                retired = true;
              }
            }
            try {
              return await capability.retire(sessionId, recordName, expectedRevision);
            } finally {
              retired = true;
            }
          });
        },
        scanPartitions(options = undefined) {
          return runOwnerOperation('scanPartitions', async () => {
            if (
              options === null
              || typeof options !== 'object'
              || Array.isArray(options)
              || Object.keys(options).length !== 2
              || !Object.hasOwn(options, 'cursor')
              || !Object.hasOwn(options, 'limit')
            ) {
              throw new TypeError('filesystem agent custody scan requires exactly cursor and limit');
            }
            const { cursor, limit } = options;
            if (cursor !== null && typeof cursor !== 'string') {
              throw new TypeError('filesystem agent custody scan cursor must be null or a string');
            }
            if (!Number.isSafeInteger(limit) || limit < 1 || limit > 128) {
              throw new TypeError('filesystem agent custody scan limit must be an integer from 1 through 128');
            }
            const page = await capability.scan(sessionId, cursor, limit);
            const records = page.records.flatMap(({ recordName: scannedName, bytes, byteLength }) => {
              let parsed;
              try {
                parsed = JSON.parse(bytes);
              } catch {
                return [];
              }
              let partitionId;
              try {
                partitionId = normalizeCustodyId(parsed?.custodyId);
              } catch {
                return [];
              }
              const expectedName = pathsFor(partitionId).recordName;
              if (scannedName !== expectedName) {
                return [];
              }
              // The adapter authenticates the partition identity and secret
              // envelope here, but leaves schema validation to the gate
              // consumer after it structurally classifies ownership. That
              // prevents an unrelated custody's malformed record shape from
              // wedging this custody's migration or diagnostics.
              try {
                assertNoSecretMaterial(parsed, 'filesystem agent custody scanned record');
              } catch {
                return [];
              }
              const value = clone(parsed);
              if (!Number.isSafeInteger(byteLength) || byteLength < 1 || byteLength > MAX_RECORD_BYTES) {
                return [];
              }
              return [Object.freeze({ partitionId, value, byteLength })];
            });
            if (page.nextCursor !== null && typeof page.nextCursor !== 'string') {
              throw corrupt('filesystem agent custody scan returned an invalid cursor');
            }
            return Object.freeze({
              records: Object.freeze(records),
              nextCursor: page.nextCursor,
            });
          });
        },
      });
      let operationResult;
      let operationFailed = false;
      let operationError = null;
      let releaseFailed = false;
      let releaseFailure = null;
      try {
        operationResult = await operation(owner);
      } catch (error) {
        operationFailed = true;
        operationError = error;
      } finally {
        // Close the public start boundary before joining. Existing work keeps
        // its capability alive; captured owners and continuations cannot add
        // late work while teardown is draining the task set.
        // @ref LLP 0055#grant-backed-live-and-queued-replay — physical release
        //   follows settlement of every operation started by this owner.
        acceptingOwnerOperations = false;
        await Promise.allSettled([...ownerOperations]);
        active = false;
        try {
          await capability.release(sessionId);
        } catch (releaseError) {
          releaseFailed = true;
          releaseFailure = releaseError;
        }
      }
      if (operationFailed) throw operationError;
      if (releaseFailed) throw releaseFailure;
      return operationResult;
    });
  };

  return Object.freeze({
    partitionOwnership: 'partitioned-v2',
    terminalLedgerParameters: normalizedTerminalLedgerParameters,
    withOwnership,
    async terminalLedgerCheckpoint(name, context = Object.freeze({})) {
      if (!terminalLedgerCheckpointNames.includes(name)) {
        throw new TypeError('filesystem agent custody terminal-ledger checkpoint is invalid');
      }
      const frozenContext = Object.freeze(clone(context));
      if (terminalLedgerCheckpoint !== null) {
        await terminalLedgerCheckpoint(name, frozenContext);
      }
      const hook = testHooks?.[name];
      if (typeof hook === 'function') await hook(frozenContext);
    },
    maintenanceSnapshot() {
      return clone(lastMaintenance);
    },
    async snapshot(rawCustodyId) {
      return withOwnership(rawCustodyId, (owner) => owner.read());
    },
  });
}
