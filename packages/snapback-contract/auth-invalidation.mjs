// Item-6 authorization invalidation wire validation and merge semantics.
//
// This module is deliberately pure. Durable stores use the same functions
// inside their serialized transaction, while live-only surfaces can use them
// for an in-memory fence. No incoming frame allocates a query identity.
//
// @ref LLP 0053#invalidation-is-an-obligation-not-a-message — invalidation is
//   level-triggered state keyed by a complete, never-reused scope identity.

export const SNAPBACK_AUTH_INVALIDATION_PROTOCOL_VERSION = 1;
export const AUTH_INVALIDATION_REFIRE_MAX_MS = 5_000;

const MAX_SAFE = Number.MAX_SAFE_INTEGER;
const UUID_V7 = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const BASE64URL_128 = /^[A-Za-z0-9_-]{22}$/;
const BASE64URL_SHA256 = /^[A-Za-z0-9_-]{42}[AEIMQUYcgkosw048]$/;
const OPAQUE_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,255}$/;
const DISPOSITION_ORDER = Object.freeze({ retain: 0, quarantine: 1, delete: 2 });

const clone = (value) => value === undefined ? undefined : JSON.parse(JSON.stringify(value));

function invalidationError(code, message, details = {}) {
  const error = new Error(`${code}: ${message}`);
  error.code = code;
  error.diagnostic = { code, message, details };
  return error;
}

const corrupt = (message, details = {}) => invalidationError(
  'SNAPBACK_AUTH_INVALIDATION_CORRUPT',
  message,
  details,
);

function hasExactKeys(value, required, optional = []) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const keys = Reflect.ownKeys(value);
  const allowed = new Set([...required, ...optional]);
  return keys.length >= required.length
    && keys.length <= allowed.size
    && required.every((key) => Object.hasOwn(value, key))
    && keys.every((key) => typeof key === 'string' && allowed.has(key));
}

function exact(value, required, path, optional = []) {
  if (!hasExactKeys(value, required, optional)) {
    throw corrupt(`${path} has missing or unknown fields`, { field: path });
  }
}

function safeInteger(value, path, { positive = false } = {}) {
  if (!Number.isSafeInteger(value) || value < (positive ? 1 : 0)) {
    throw corrupt(`${path} must be a safe ${positive ? 'positive' : 'nonnegative'} integer`, {
      field: path,
    });
  }
  return value;
}

function opaque(value, path) {
  if (typeof value !== 'string' || !OPAQUE_ID.test(value)) {
    throw corrupt(`${path} must be a canonical opaque id`, { field: path });
  }
  return value;
}

function canonicalQueryKey(value, path = 'namespace.queryKey') {
  if (typeof value !== 'string' || value.length === 0 || value.length > 8_192) {
    throw corrupt(`${path} must be a non-empty bounded string`, { field: path });
  }
  return value;
}

export function validateAuthorizationVersion(value, path = 'authorization') {
  exact(value, ['incarnation', 'epoch'], path);
  if (!UUID_V7.test(value.incarnation ?? '')) {
    throw corrupt(`${path}.incarnation must be a canonical UUIDv7`, {
      field: `${path}.incarnation`,
    });
  }
  safeInteger(value.epoch, `${path}.epoch`);
  return Object.freeze({
    incarnation: value.incarnation,
    epoch: value.epoch,
  });
}

export function validateDataWitness(value, path = 'data') {
  if (value === null) return null;
  exact(value, ['versionStream', 'minCommitVersion'], path);
  opaque(value.versionStream, `${path}.versionStream`);
  safeInteger(value.minCommitVersion, `${path}.minCommitVersion`);
  return Object.freeze({
    versionStream: value.versionStream,
    minCommitVersion: value.minCommitVersion,
  });
}

export function validateCompositeWitness(value, path = 'witness') {
  exact(value, ['authorization', 'data'], path);
  return Object.freeze({
    authorization: validateAuthorizationVersion(value.authorization, `${path}.authorization`),
    data: validateDataWitness(value.data, `${path}.data`),
  });
}

export function validateIssuerId(value, path = 'issuerId') {
  exact(value, ['authorizationIncarnation', 'bootSequence', 'bootNonce'], path);
  if (!UUID_V7.test(value.authorizationIncarnation ?? '')) {
    throw corrupt(`${path}.authorizationIncarnation must be a canonical UUIDv7`, {
      field: `${path}.authorizationIncarnation`,
    });
  }
  safeInteger(value.bootSequence, `${path}.bootSequence`, { positive: true });
  if (typeof value.bootNonce !== 'string' || !BASE64URL_128.test(value.bootNonce)) {
    throw corrupt(`${path}.bootNonce must be a canonical 128-bit base64url nonce`, {
      field: `${path}.bootNonce`,
    });
  }
  return Object.freeze({
    authorizationIncarnation: value.authorizationIncarnation,
    bootSequence: value.bootSequence,
    bootNonce: value.bootNonce,
  });
}

export function validateAuthenticatedBootIssuer(value, path = 'authenticatedIssuer') {
  exact(value, ['issuerId', 'keyId', 'mac'], path);
  opaque(value.keyId, `${path}.keyId`);
  if (typeof value.mac !== 'string' || !BASE64URL_SHA256.test(value.mac)) {
    throw corrupt(`${path}.mac must be a canonical SHA-256 base64url value`, {
      field: `${path}.mac`,
    });
  }
  return Object.freeze({
    issuerId: validateIssuerId(value.issuerId, `${path}.issuerId`),
    keyId: value.keyId,
    mac: value.mac,
  });
}

export function validateQueryNamespace(value, path = 'namespace') {
  exact(value, ['clientStoreId', 'queryKey', 'queryInstanceId'], path);
  return Object.freeze({
    clientStoreId: opaque(value.clientStoreId, `${path}.clientStoreId`),
    queryKey: canonicalQueryKey(value.queryKey, `${path}.queryKey`),
    queryInstanceId: safeInteger(value.queryInstanceId, `${path}.queryInstanceId`, {
      positive: true,
    }),
  });
}

export function validateScopeId(value, path = 'scopeId') {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw corrupt(`${path} must be an object`, { field: path });
  }
  if (value.kind === 'subscription') {
    exact(value, [
      'kind',
      'issuerId',
      'namespace',
      'scopeSequence',
      'connectionGeneration',
      'subscriptionId',
    ], path);
    return Object.freeze({
      kind: 'subscription',
      issuerId: validateIssuerId(value.issuerId, `${path}.issuerId`),
      namespace: validateQueryNamespace(value.namespace, `${path}.namespace`),
      scopeSequence: safeInteger(value.scopeSequence, `${path}.scopeSequence`, { positive: true }),
      connectionGeneration: safeInteger(
        value.connectionGeneration,
        `${path}.connectionGeneration`,
        { positive: true },
      ),
      subscriptionId: opaque(value.subscriptionId, `${path}.subscriptionId`),
    });
  }
  if (value.kind === 'connection') {
    exact(value, ['kind', 'issuerId', 'connectionGeneration'], path);
    return Object.freeze({
      kind: 'connection',
      issuerId: validateIssuerId(value.issuerId, `${path}.issuerId`),
      connectionGeneration: safeInteger(
        value.connectionGeneration,
        `${path}.connectionGeneration`,
        { positive: true },
      ),
    });
  }
  if (value.kind === 'clientQuery') {
    exact(value, ['kind', 'namespace'], path);
    return Object.freeze({
      kind: 'clientQuery',
      namespace: validateQueryNamespace(value.namespace, `${path}.namespace`),
    });
  }
  throw corrupt(`${path}.kind is invalid`, { field: `${path}.kind` });
}

export function validateScopeRetirement(value, path = 'scopeRetirement') {
  exact(value, [
    'issuerId',
    'namespace',
    'retireThroughScopeSequence',
    'authorizationExpectation',
    'mac',
  ], path);
  const issuerId = validateIssuerId(value.issuerId, `${path}.issuerId`);
  const authorizationExpectation = validateAuthorizationVersion(
    value.authorizationExpectation,
    `${path}.authorizationExpectation`,
  );
  if (authorizationExpectation.incarnation !== issuerId.authorizationIncarnation) {
    throw corrupt(`${path} crosses authorization incarnations`, { field: path });
  }
  if (typeof value.mac !== 'string' || !BASE64URL_SHA256.test(value.mac)) {
    throw corrupt(`${path}.mac must be a canonical SHA-256 base64url value`, {
      field: `${path}.mac`,
    });
  }
  return Object.freeze({
    issuerId,
    namespace: validateQueryNamespace(value.namespace, `${path}.namespace`),
    retireThroughScopeSequence: safeInteger(
      value.retireThroughScopeSequence,
      `${path}.retireThroughScopeSequence`,
      { positive: true },
    ),
    authorizationExpectation,
    mac: value.mac,
  });
}

export function validateIssuerRetirement(value, path = 'issuerRetirement') {
  exact(value, [
    'currentIssuer',
    'retireThroughBootSequence',
    'authorizationExpectation',
    'mac',
  ], path);
  const currentIssuer = validateAuthenticatedBootIssuer(
    value.currentIssuer,
    `${path}.currentIssuer`,
  );
  const retireThroughBootSequence = safeInteger(
    value.retireThroughBootSequence,
    `${path}.retireThroughBootSequence`,
    { positive: true },
  );
  if (retireThroughBootSequence >= currentIssuer.issuerId.bootSequence) {
    throw corrupt(`${path} must retire strictly older boot sequences`, {
      field: `${path}.retireThroughBootSequence`,
    });
  }
  const authorizationExpectation = validateAuthorizationVersion(
    value.authorizationExpectation,
    `${path}.authorizationExpectation`,
  );
  if (
    authorizationExpectation.incarnation
      !== currentIssuer.issuerId.authorizationIncarnation
  ) {
    throw corrupt(`${path} crosses authorization incarnations`, { field: path });
  }
  if (typeof value.mac !== 'string' || !BASE64URL_SHA256.test(value.mac)) {
    throw corrupt(`${path}.mac must be a canonical SHA-256 base64url value`, {
      field: `${path}.mac`,
    });
  }
  return Object.freeze({
    currentIssuer,
    retireThroughBootSequence,
    authorizationExpectation,
    mac: value.mac,
  });
}

export function validateAuthorizationInvalidationConnection(
  value,
  path = 'authorizationInvalidation',
) {
  exact(value, [
    'protocolVersion',
    'issuerId',
    'connectionGeneration',
    'authorization',
    'versionStream',
  ], path, [
    'issuerRetirement',
  ]);
  if (value.protocolVersion !== SNAPBACK_AUTH_INVALIDATION_PROTOCOL_VERSION) {
    throw invalidationError(
      'SNAPBACK_AUTH_INVALIDATION_CLIENT_UNSUPPORTED',
      'authorization invalidation connection protocol version is unsupported',
    );
  }
  const issuerId = validateIssuerId(value.issuerId, `${path}.issuerId`);
  const authorization = validateAuthorizationVersion(
    value.authorization,
    `${path}.authorization`,
  );
  if (authorization.incarnation !== issuerId.authorizationIncarnation) {
    throw corrupt(`${path} crosses authorization incarnations`, { field: path });
  }
  return Object.freeze({
    protocolVersion: SNAPBACK_AUTH_INVALIDATION_PROTOCOL_VERSION,
    issuerId,
    connectionGeneration: safeInteger(
      value.connectionGeneration,
      `${path}.connectionGeneration`,
      { positive: true },
    ),
    authorization,
    versionStream: opaque(value.versionStream, `${path}.versionStream`),
    ...(Object.hasOwn(value, 'issuerRetirement')
      ? {
          issuerRetirement: value.issuerRetirement === null
            ? null
            : validateIssuerRetirement(
                value.issuerRetirement,
                `${path}.issuerRetirement`,
              ),
        }
      : {}),
  });
}

export function scopeKey(scope) {
  return JSON.stringify(validateScopeId(scope));
}

export function validateResyncObligation(value, path = 'obligation') {
  exact(value, [
    'protocolVersion',
    'scopeId',
    'revision',
    'maxDisposition',
    'witness',
    'retryEpisodeId',
  ], path, ['ownerContinuityId']);
  if (value.protocolVersion !== SNAPBACK_AUTH_INVALIDATION_PROTOCOL_VERSION) {
    throw invalidationError(
      'SNAPBACK_AUTH_INVALIDATION_CLIENT_UNSUPPORTED',
      'authorization invalidation protocol version is unsupported',
      {
        received: value.protocolVersion ?? null,
        supported: SNAPBACK_AUTH_INVALIDATION_PROTOCOL_VERSION,
      },
    );
  }
  if (!Object.hasOwn(DISPOSITION_ORDER, value.maxDisposition)) {
    throw corrupt(`${path}.maxDisposition is invalid`, {
      field: `${path}.maxDisposition`,
    });
  }
  if (value.retryEpisodeId !== null) {
    opaque(value.retryEpisodeId, `${path}.retryEpisodeId`);
  }
  if (Object.hasOwn(value, 'ownerContinuityId')) {
    opaque(value.ownerContinuityId, `${path}.ownerContinuityId`);
  }
  const scopeId = validateScopeId(value.scopeId, `${path}.scopeId`);
  if (scopeId.kind === 'subscription' && !Object.hasOwn(value, 'ownerContinuityId')) {
    throw corrupt(`${path}.ownerContinuityId is required for subscription custody`, {
      field: `${path}.ownerContinuityId`,
    });
  }
  return Object.freeze({
    protocolVersion: SNAPBACK_AUTH_INVALIDATION_PROTOCOL_VERSION,
    scopeId,
    revision: safeInteger(value.revision, `${path}.revision`, { positive: true }),
    maxDisposition: value.maxDisposition,
    witness: validateCompositeWitness(value.witness, `${path}.witness`),
    retryEpisodeId: value.retryEpisodeId,
    ...(Object.hasOwn(value, 'ownerContinuityId')
      ? { ownerContinuityId: value.ownerContinuityId }
      : {}),
  });
}

function sameJson(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
}

function maxDisposition(left, right) {
  return DISPOSITION_ORDER[left] >= DISPOSITION_ORDER[right] ? left : right;
}

function currentWitness(incoming, existing) {
  if (!existing) return incoming;
  const data = (() => {
    if (incoming.data === null) return existing.data;
    if (existing.data === null) return incoming.data;
    if (incoming.data.versionStream !== existing.data.versionStream) {
      throw corrupt('equal-scope obligation attempted to merge different version streams');
    }
    return {
      versionStream: incoming.data.versionStream,
      minCommitVersion: Math.max(
        incoming.data.minCommitVersion,
        existing.data.minCommitVersion,
      ),
    };
  })();
  return {
    authorization: incoming.authorization,
    data,
  };
}

function validateExpectation(expectation) {
  exact(expectation, ['authorization', 'versionStream', 'issuerId'], 'expectation');
  return Object.freeze({
    authorization: validateAuthorizationVersion(expectation.authorization, 'expectation.authorization'),
    versionStream: expectation.versionStream === null
      ? null
      : opaque(expectation.versionStream, 'expectation.versionStream'),
    issuerId: expectation.issuerId === null
      ? null
      : validateIssuerId(expectation.issuerId, 'expectation.issuerId'),
  });
}

function obligationMatchesExpectation(obligation, expectation) {
  if (!sameJson(obligation.witness.authorization, expectation.authorization)) return false;
  if (
    obligation.witness.data !== null
    && expectation.versionStream !== null
    && obligation.witness.data.versionStream !== expectation.versionStream
  ) return false;
  if (
    obligation.scopeId.kind !== 'clientQuery'
    && !sameJson(obligation.scopeId.issuerId, expectation.issuerId)
  ) return false;
  return true;
}

/**
 * Merge a received level-triggered obligation into one exact scope.
 *
 * Returns `{ status: 'accepted'|'duplicate'|'stale-expectation', obligation }`.
 * A caller must reject the frame before map lookup when its query instance is
 * not the current initialized instance; this function additionally refuses to
 * merge distinct complete scope ids.
 */
export function mergeResyncObligation(existingValue, incomingValue, expectationValue) {
  const incoming = validateResyncObligation(incomingValue);
  const expectation = validateExpectation(expectationValue);
  if (!obligationMatchesExpectation(incoming, expectation)) {
    return Object.freeze({ status: 'stale-expectation', obligation: clone(existingValue) ?? null });
  }
  if (existingValue === null || existingValue === undefined) {
    return Object.freeze({ status: 'accepted', obligation: clone(incoming) });
  }
  const existing = validateResyncObligation(existingValue, 'existingObligation');
  if (scopeKey(existing.scopeId) !== scopeKey(incoming.scopeId)) {
    throw corrupt('obligations from distinct scopes cannot share one map entry');
  }
  if (existing.ownerContinuityId !== incoming.ownerContinuityId) {
    throw corrupt('one scope was rebound to a different owner continuity');
  }
  if (incoming.revision < existing.revision) {
    return Object.freeze({ status: 'duplicate', obligation: clone(existing) });
  }
  if (incoming.revision === existing.revision) {
    if (!sameJson(incoming, existing)) {
      throw corrupt('one scope revision was reused for a different semantic obligation');
    }
    return Object.freeze({ status: 'duplicate', obligation: clone(existing) });
  }
  const merged = {
    ...incoming,
    maxDisposition: maxDisposition(existing.maxDisposition, incoming.maxDisposition),
    witness: currentWitness(incoming.witness, existing.witness),
  };
  return Object.freeze({ status: 'accepted', obligation: clone(merged) });
}

export function validateResolutionTicket(value, path = 'resolution') {
  exact(value, [
    'protocolVersion',
    'kind',
    'scopeId',
    'revision',
    'witness',
    'maxDisposition',
    'ackToken',
  ], path, ['ownerContinuityId']);
  if (value.protocolVersion !== SNAPBACK_AUTH_INVALIDATION_PROTOCOL_VERSION) {
    throw invalidationError(
      'SNAPBACK_AUTH_INVALIDATION_CLIENT_UNSUPPORTED',
      'authorization invalidation resolution protocol version is unsupported',
    );
  }
  if (value.kind !== 'snapshot' && value.kind !== 'terminalDelete') {
    throw corrupt(`${path}.kind is invalid`, { field: `${path}.kind` });
  }
  if (!Object.hasOwn(DISPOSITION_ORDER, value.maxDisposition)) {
    throw corrupt(`${path}.maxDisposition is invalid`, { field: `${path}.maxDisposition` });
  }
  const scopeId = validateScopeId(value.scopeId, `${path}.scopeId`);
  if (Object.hasOwn(value, 'ownerContinuityId')) {
    opaque(value.ownerContinuityId, `${path}.ownerContinuityId`);
  }
  if (scopeId.kind === 'subscription' && !Object.hasOwn(value, 'ownerContinuityId')) {
    throw corrupt(`${path}.ownerContinuityId is required for subscription custody`, {
      field: `${path}.ownerContinuityId`,
    });
  }
  return Object.freeze({
    protocolVersion: SNAPBACK_AUTH_INVALIDATION_PROTOCOL_VERSION,
    kind: value.kind,
    scopeId,
    revision: safeInteger(value.revision, `${path}.revision`, { positive: true }),
    witness: validateCompositeWitness(value.witness, `${path}.witness`),
    maxDisposition: value.maxDisposition,
    ackToken: opaque(value.ackToken, `${path}.ackToken`),
    ...(Object.hasOwn(value, 'ownerContinuityId')
      ? { ownerContinuityId: value.ownerContinuityId }
      : {}),
  });
}

export function resolutionSatisfies(obligationValue, resolutionValue) {
  const obligation = validateResyncObligation(obligationValue);
  const resolution = validateResolutionTicket(resolutionValue);
  if (scopeKey(obligation.scopeId) !== scopeKey(resolution.scopeId)) return false;
  if (resolution.revision !== obligation.revision) return false;
  if (!sameJson(resolution.witness.authorization, obligation.witness.authorization)) return false;
  if (resolution.maxDisposition !== obligation.maxDisposition) return false;
  if (resolution.ownerContinuityId !== obligation.ownerContinuityId) return false;
  if (obligation.witness.data !== null) {
    if (resolution.witness.data === null) return false;
    if (resolution.witness.data.versionStream !== obligation.witness.data.versionStream) return false;
    if (resolution.witness.data.minCommitVersion < obligation.witness.data.minCommitVersion) {
      return false;
    }
  }
  return resolution.kind === 'terminalDelete' || resolution.kind === 'snapshot';
}

export function effectiveDisposition(pendingByScope) {
  let result = 'retain';
  for (const obligation of Object.values(pendingByScope ?? {})) {
    const validated = validateResyncObligation(obligation);
    result = maxDisposition(result, validated.maxDisposition);
  }
  return result;
}

export function nextQueryInstanceId(highWater) {
  safeInteger(highWater, 'queryInstanceHighWater');
  if (highWater === MAX_SAFE) {
    throw invalidationError(
      'SNAPBACK_AUTH_QUERY_INSTANCE_EXHAUSTED',
      'query instance allocator is exhausted and the client store must be replaced',
      { highWater },
    );
  }
  return highWater + 1;
}

export function nextInvalidationGeneration(generation, field = 'queryGeneration') {
  safeInteger(generation, field);
  if (generation === MAX_SAFE) {
    throw invalidationError(
      'SNAPBACK_AUTH_INVALIDATION_GENERATION_EXHAUSTED',
      `${field} is exhausted and the client store must be replaced`,
      { field },
    );
  }
  return generation + 1;
}
