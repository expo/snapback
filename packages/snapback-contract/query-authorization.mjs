// Live-only authorization invalidation state (LLP 0053 item 6).
//
// Retainable queries persist the same logical state in the client store once
// item 8 enables AuthorizedLease. This module owns the process-local form used
// by live materializations: exact instance identity, independent generations,
// per-scope revisions, owner-continuity cleanup, and commit-before-ACK output.
//
// @ref LLP 0053#invalidation-is-an-obligation-not-a-message — independent
//   level-triggered roots merge by exact scope and release only after proof.
// @ref LLP 0053#client-fences — never-reused instance ids and independent
//   generations reject delayed callbacks before state lookup.

import {
  effectiveDisposition,
  mergeResyncObligation,
  nextInvalidationGeneration,
  nextQueryInstanceId,
  resolutionSatisfies,
  scopeKey,
  validateAuthorizationVersion,
  validateCompositeWitness,
  validateIssuerId,
  validateIssuerRetirement,
  validateQueryNamespace,
  validateResolutionTicket,
  validateResyncObligation,
  validateScopeId,
  validateScopeRetirement,
} from './auth-invalidation.mjs';

const clone = (value) => value === undefined ? undefined : JSON.parse(JSON.stringify(value));
const same = (left, right) => JSON.stringify(left) === JSON.stringify(right);

function queryAuthorizationError(code, message, details = {}) {
  const error = new Error(`${code}: ${message}`);
  error.code = code;
  error.diagnostic = { code, message, details };
  return error;
}

function safeGeneration(value, field) {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new TypeError(`${field} must be a safe nonnegative integer`);
  }
  return value;
}

function assertSynchronousCommit(result) {
  if (result && typeof result.then === 'function') {
    throw new TypeError('query authorization boundary commit must be synchronous');
  }
}

function scopeNamespace(scope) {
  return scope.kind === 'connection' ? null : scope.namespace;
}

function scopeIssuer(scope) {
  return scope.kind === 'subscription' ? scope.issuerId : null;
}

function parsedScopeKey(key) {
  return JSON.parse(key);
}

function witnessCovers(actual, floor) {
  if (!same(actual.authorization, floor.authorization)) return false;
  if (floor.data === null) return true;
  return actual.data !== null
    && actual.data.versionStream === floor.data.versionStream
    && actual.data.minCommitVersion >= floor.data.minCommitVersion;
}

function replacementWitnessCovers(actual, floor) {
  if (same(actual.authorization, floor.authorization)) {
    return witnessCovers(actual, floor);
  }
  if (floor.data === null) return true;
  if (actual.data === null) return false;
  return actual.data.versionStream !== floor.data.versionStream
    || actual.data.minCommitVersion >= floor.data.minCommitVersion;
}

function validateSnapshot(value, expectedAuthorization, expectedVersionStream, path = 'snapshot') {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw queryAuthorizationError(
      'SNAPBACK_AUTH_INVALIDATION_SNAPSHOT_INVALID',
      `${path} must be an object`,
    );
  }
  if (!Array.isArray(value.rows) || !Number.isSafeInteger(value.version) || value.version < 0) {
    throw queryAuthorizationError(
      'SNAPBACK_AUTH_INVALIDATION_SNAPSHOT_INVALID',
      `${path} requires rows and a safe nonnegative version`,
    );
  }
  const witness = validateCompositeWitness(
    value.witness ?? {
      authorization: expectedAuthorization,
      data: { versionStream: expectedVersionStream, minCommitVersion: value.version },
    },
    `${path}.witness`,
  );
  if (
    !same(witness.authorization, expectedAuthorization)
    || witness.data === null
    || witness.data.versionStream !== expectedVersionStream
    || witness.data.minCommitVersion > value.version
  ) {
    throw queryAuthorizationError(
      'SNAPBACK_AUTH_INVALIDATION_SNAPSHOT_STALE',
      `${path} does not belong to the authenticated authorization/data stream`,
    );
  }
  return Object.freeze({ rows: clone(value.rows), version: value.version, witness: clone(witness) });
}

function pendingObligations(pendingByScope, { unresolvedOnly = false } = {}) {
  const obligations = {};
  for (const [key, entry] of Object.entries(pendingByScope)) {
    if (unresolvedOnly && entry.resolution?.applied === true) continue;
    obligations[key] = entry.obligation;
  }
  return obligations;
}

function unresolvedDisposition(state) {
  return effectiveDisposition(pendingObligations(state.pendingByScope, { unresolvedOnly: true }));
}

function fenceFor(state) {
  return Object.freeze({
    queryInstanceId: state.namespace.queryInstanceId,
    authorityGeneration: state.authorityGeneration,
    queryGeneration: state.queryGeneration,
    authorityInstanceId: state.authorityInstanceId,
  });
}

function fenceMatches(state, fence) {
  return state.lifecycle !== 'removed'
    && fence
    && fence.queryInstanceId === state.namespace.queryInstanceId
    && fence.authorityGeneration === state.authorityGeneration
    && fence.queryGeneration === state.queryGeneration
    && fence.authorityInstanceId === state.authorityInstanceId;
}

function assertFence(state, fence, operation, { active = true } = {}) {
  if (!fenceMatches(state, fence) || (active && state.lifecycle !== 'active')) {
    throw queryAuthorizationError(
      'SNAPBACK_AUTH_QUERY_FENCE_STALE',
      `${operation} belongs to a stale, retiring, or removed query instance`,
      { operation },
    );
  }
}

function assertNamespace(state, scope, operation) {
  const namespace = scopeNamespace(scope);
  if (namespace === null || !same(namespace, state.namespace)) {
    throw queryAuthorizationError(
      'SNAPBACK_AUTH_QUERY_FENCE_STALE',
      `${operation} names another or non-query scope`,
      { operation },
    );
  }
}

function assertCurrentIssuer(state, scope, operation) {
  const issuer = scopeIssuer(scope);
  if (issuer !== null && !same(issuer, state.expectedIssuerId)) {
    throw queryAuthorizationError(
      'SNAPBACK_AUTH_INVALIDATION_ISSUER_INVALID',
      `${operation} does not belong to the authenticated current boot issuer`,
      { operation },
    );
  }
}

function maxAcceptedSnapshot(current, incoming) {
  if (!current) return incoming;
  if (current.witness.data.versionStream !== incoming.witness.data.versionStream) return incoming;
  return incoming.version >= current.version ? incoming : current;
}

/** One scalar is sufficient: retired live query ids are never reused. */
export function createLiveQueryInstanceAllocator({ highWater = 0 } = {}) {
  safeGeneration(highWater, 'highWater');
  let current = highWater;
  return Object.freeze({
    allocate() {
      current = nextQueryInstanceId(current);
      return current;
    },
    highWater: () => current,
  });
}

/** Build the exact namespace that must be sent before auth-scoped admission. */
export function createLiveQueryNamespace({ clientStoreId, queryKey, queryInstanceId }) {
  return clone(validateQueryNamespace({ clientStoreId, queryKey, queryInstanceId }));
}

export function createLiveQueryAuthorizationFence({
  namespace,
  authorityGeneration,
  authorityInstanceId = null,
  issuerId,
  authorizationScope = null,
  connectionGeneration = null,
  authorization,
  versionStream,
  initialSnapshot,
}) {
  const normalizedNamespace = validateQueryNamespace(namespace);
  const normalizedIssuer = validateIssuerId(issuerId);
  const normalizedAuthorization = validateAuthorizationVersion(authorization);
  safeGeneration(authorityGeneration, 'authorityGeneration');
  if (authorityInstanceId !== null && (
    typeof authorityInstanceId !== 'string'
    || !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,255}$/.test(authorityInstanceId)
  )) {
    throw new TypeError('authorityInstanceId must be null or a canonical opaque id');
  }
  if (typeof versionStream !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,255}$/.test(versionStream)) {
    throw new TypeError('versionStream must be a canonical opaque id');
  }
  if (normalizedAuthorization.incarnation !== normalizedIssuer.authorizationIncarnation) {
    throw queryAuthorizationError(
      'SNAPBACK_AUTH_INVALIDATION_ISSUER_INVALID',
      'issuer and authorization expectation cross incarnations',
    );
  }
  const normalizedAuthorizationScope = authorizationScope === null
    ? null
    : validateScopeId(authorizationScope, 'authorizationScope');
  if (
    normalizedAuthorizationScope !== null
    && (
      normalizedAuthorizationScope.kind !== 'subscription'
      || !same(normalizedAuthorizationScope.namespace, normalizedNamespace)
      || !same(normalizedAuthorizationScope.issuerId, normalizedIssuer)
      || (
        connectionGeneration !== null
        && normalizedAuthorizationScope.connectionGeneration !== connectionGeneration
      )
    )
  ) {
    throw queryAuthorizationError(
      'SNAPBACK_AUTH_INVALIDATION_CORRUPT',
      'authorization scope does not match the authenticated query/connection expectation',
    );
  }
  if (
    connectionGeneration !== null
    && (!Number.isSafeInteger(connectionGeneration) || connectionGeneration < 1)
  ) {
    throw new TypeError('connectionGeneration must be null or a safe positive integer');
  }
  const initial = validateSnapshot(
    initialSnapshot,
    normalizedAuthorization,
    versionStream,
    'initialSnapshot',
  );
  const state = {
    namespace: clone(normalizedNamespace),
    lifecycle: 'active',
    authorityGeneration,
    queryGeneration: 0,
    authorityInstanceId,
    expectedIssuerId: clone(normalizedIssuer),
    expectedAuthorizationScope: clone(normalizedAuthorizationScope),
    expectedConnectionGeneration: connectionGeneration,
    expectedAuthorization: clone(normalizedAuthorization),
    expectedVersionStream: versionStream,
    effectiveDisposition: 'retain',
    terminalDeleted: false,
    accepted: clone(initial),
    retiredIssuerFrontier: {
      incarnation: normalizedAuthorization.incarnation,
      bootSequence: 0,
    },
    retiredScopeFrontier: null,
    pendingByScope: {},
    scopeState: {},
  };

  const advance = () => {
    state.queryGeneration = nextInvalidationGeneration(state.queryGeneration);
    return fenceFor(state);
  };

  const recomputeDisposition = () => {
    const pending = unresolvedDisposition(state);
    if (state.terminalDeleted) {
      state.effectiveDisposition = 'delete';
      return 'delete';
    }
    state.effectiveDisposition = pending;
    return pending;
  };

  const rootState = (key) => state.scopeState[key] ?? null;

  const scopeIsRetiredByFrontier = (candidate) => {
    if (candidate.kind !== 'subscription') return false;
    const issuerFrontier = state.retiredIssuerFrontier;
    if (
      candidate.issuerId.authorizationIncarnation === issuerFrontier.incarnation
      && candidate.issuerId.bootSequence <= issuerFrontier.bootSequence
    ) return true;
    const scopeFrontier = state.retiredScopeFrontier;
    return scopeFrontier !== null
      && same(candidate.issuerId, scopeFrontier.issuerId)
      && same(candidate.namespace, scopeFrontier.namespace)
      && candidate.scopeSequence <= scopeFrontier.scopeSequence;
  };

  const receiveObligation = (value, { commit = null, deferCommit = false } = {}) => {
    if (typeof deferCommit !== 'boolean') {
      throw new TypeError('deferCommit must be a boolean');
    }
    const obligation = validateResyncObligation(value);
    if (state.lifecycle !== 'active') {
      throw queryAuthorizationError(
        'SNAPBACK_AUTH_QUERY_FENCE_STALE',
        'retiring or removed query cannot receive an ordinary obligation',
      );
    }
    if (
      state.expectedAuthorizationScope !== null
      && !same(obligation.scopeId, state.expectedAuthorizationScope)
    ) {
      throw queryAuthorizationError(
        'SNAPBACK_AUTH_INVALIDATION_SCOPE_INVALID',
        'query invalidation does not name the exact held subscription scope',
      );
    }
    assertNamespace(state, obligation.scopeId, 'query invalidation');
    if (scopeIsRetiredByFrontier(obligation.scopeId)) {
      return clone({ status: 'retired', fence: fenceFor(state) });
    }
    const incomingIssuer = scopeIssuer(obligation.scopeId);
    if (incomingIssuer !== null && !same(incomingIssuer, state.expectedIssuerId)) {
      return clone({ status: 'stale-expectation', fence: fenceFor(state) });
    }
    const incomingAuthorization = obligation.witness.authorization;
    const advancesAuthorization = (
      incomingAuthorization.incarnation === state.expectedAuthorization.incarnation
      && incomingAuthorization.epoch > state.expectedAuthorization.epoch
    );
    if (
      !same(incomingAuthorization, state.expectedAuthorization)
      && !advancesAuthorization
    ) {
      return clone({ status: 'stale-expectation', fence: fenceFor(state) });
    }
    if (
      obligation.witness.data !== null
      && obligation.witness.data.versionStream !== state.expectedVersionStream
    ) {
      return clone({ status: 'stale-expectation', fence: fenceFor(state) });
    }
    const key = scopeKey(obligation.scopeId);
    const known = rootState(key);
    if (known?.lifecycle !== undefined && known.lifecycle !== 'active') {
      return clone({ status: 'retired', fence: fenceFor(state) });
    }
    if (known?.ownerContinuityId !== undefined
      && known.ownerContinuityId !== obligation.ownerContinuityId) {
      throw queryAuthorizationError(
        'SNAPBACK_AUTH_INVALIDATION_CORRUPT',
        'one scope was rebound to another owner continuity',
      );
    }
    const pending = state.pendingByScope[key] ?? null;
    if (!pending && obligation.revision <= (known?.revisionHighWater ?? 0)) {
      return clone({
        status: known?.lastAckToken ? 'acknowledged' : 'duplicate',
        ackToken: known?.lastAckToken ?? null,
        fence: fenceFor(state),
      });
    }
    const merged = mergeResyncObligation(
      pending?.obligation ?? null,
      obligation,
      {
        authorization: advancesAuthorization
          ? incomingAuthorization
          : state.expectedAuthorization,
        versionStream: state.expectedVersionStream,
        issuerId: obligation.scopeId.kind === 'clientQuery' ? null : state.expectedIssuerId,
      },
    );
    if (merged.status !== 'accepted') {
      return clone({
        status: pending?.resolution?.applied ? 'applied' : merged.status,
        ackToken: pending?.resolution?.ticket?.ackToken ?? null,
        fence: fenceFor(state),
      });
    }
    const before = clone(state);
    try {
      // @ref LLP 0053#invalidation-is-an-obligation-not-a-message — within
      // one incarnation a greater authorization epoch is current; only an
      // incarnation or version-stream change requires a replacement
      // bootstrap expectation. The exact current issuer/scope and the
      // transport authority fence authenticate this monotone advance.
      if (advancesAuthorization) {
        state.expectedAuthorization = clone(incomingAuthorization);
      }
      state.pendingByScope[key] = {
        obligation: clone(merged.obligation),
        resolution: null,
      };
      state.scopeState[key] = {
        revisionHighWater: Math.max(known?.revisionHighWater ?? 0, obligation.revision),
        lifecycle: 'active',
        ...(obligation.ownerContinuityId
          ? { ownerContinuityId: obligation.ownerContinuityId }
          : {}),
        ...(known?.lastAckToken ? { lastAckToken: known.lastAckToken } : {}),
      };
      state.effectiveDisposition = effectiveDisposition(pendingObligations(state.pendingByScope));
      if (state.effectiveDisposition === 'delete') state.accepted = null;
      const fence = advance();
      if (!deferCommit && typeof commit === 'function') {
        const outcome = commit({
          kind: state.effectiveDisposition,
          fence,
        });
        assertSynchronousCommit(outcome);
      }
      return clone({
        status: 'accepted',
        disposition: state.effectiveDisposition,
        fence,
      });
    } catch (error) {
      Object.assign(state, before);
      throw error;
    }
  };

  // @ref LLP 0200#24-the-authorization-lane-splits-in-two--by-declared-classification
  // — a same-envelope resolution may defer only the render-boundary commit.
  // Repair validates the exact current generation so an older deferred receipt
  // cannot publish its disposition over a newer fence.
  const commitCurrentDisposition = ({ fence, commit }) => {
    assertFence(state, fence, 'query invalidation disposition commit', { active: false });
    if (typeof commit !== 'function') {
      throw new TypeError('query invalidation disposition commit requires a commit callback');
    }
    const outcome = commit({ kind: state.effectiveDisposition, fence: fenceFor(state) });
    assertSynchronousCommit(outcome);
  };

  const applyResolution = ({ fence, resolution: value, snapshot = null, commit }) => {
    const resolution = validateResolutionTicket(value);
    assertFence(state, fence, 'query invalidation resolution', {
      active: state.lifecycle !== 'retiring',
    });
    assertNamespace(state, resolution.scopeId, 'query invalidation resolution');
    assertCurrentIssuer(state, resolution.scopeId, 'query invalidation resolution');
    const key = scopeKey(resolution.scopeId);
    const entry = state.pendingByScope[key];
    if (!entry || !resolutionSatisfies(entry.obligation, resolution)) {
      throw queryAuthorizationError(
        'SNAPBACK_AUTH_INVALIDATION_RESOLUTION_STALE',
        'resolution does not satisfy the current exact query obligation',
      );
    }
    if (entry.resolution?.applied) {
      if (!same(entry.resolution.ticket, resolution)) {
        throw queryAuthorizationError(
          'SNAPBACK_AUTH_INVALIDATION_RESOLUTION_STALE',
          'one scope revision acquired conflicting resolution tickets',
        );
      }
      return clone({
        status: 'duplicate',
        ackToken: resolution.ackToken,
        fence: fenceFor(state),
        disposition: state.effectiveDisposition,
      });
    }
    const snapshotPresent = snapshot !== null && snapshot !== undefined;
    if (
      (resolution.kind === 'snapshot' && !snapshotPresent)
      || (resolution.kind === 'terminalDelete' && snapshotPresent)
    ) {
      throw queryAuthorizationError(
        'SNAPBACK_AUTH_INVALIDATION_CORRUPT',
        'resolution kind and snapshot presence disagree',
      );
    }
    const destructive = resolution.kind === 'terminalDelete'
      || resolution.maxDisposition === 'delete';
    if (state.lifecycle === 'retiring' && resolution.kind !== 'terminalDelete') {
      throw queryAuthorizationError(
        'SNAPBACK_AUTH_QUERY_RETIREMENT_PENDING',
        'retirement cannot synthesize or apply a snapshot resolution',
      );
    }
    const normalizedSnapshot = resolution.kind === 'terminalDelete'
      ? null
      : validateSnapshot(
          snapshot,
          state.expectedAuthorization,
          state.expectedVersionStream,
          'resolution.snapshot',
        );
    if (
      normalizedSnapshot !== null
      && (
        !witnessCovers(normalizedSnapshot.witness, entry.obligation.witness)
        || !witnessCovers(normalizedSnapshot.witness, resolution.witness)
      )
    ) {
      throw queryAuthorizationError(
        'SNAPBACK_AUTH_INVALIDATION_RESOLUTION_STALE',
        'resolution snapshot does not cover the obligation and resolution witnesses',
      );
    }
    if (
      normalizedSnapshot !== null
      && state.accepted !== null
      && state.accepted.witness.data.versionStream === normalizedSnapshot.witness.data.versionStream
      && normalizedSnapshot.version < state.accepted.version
    ) {
      throw queryAuthorizationError(
        'SNAPBACK_AUTH_INVALIDATION_RESOLUTION_STALE',
        'resolution snapshot moves backward in the held data stream',
      );
    }

    const before = clone(state);
    try {
      entry.resolution = { ticket: clone(resolution), applied: true };
      if (destructive) {
        state.accepted = null;
        state.terminalDeleted = true;
        state.effectiveDisposition = 'delete';
      } else {
        state.accepted = clone(maxAcceptedSnapshot(state.accepted, normalizedSnapshot));
        state.effectiveDisposition = unresolvedDisposition(state);
      }
      const nextFence = advance();
      if (typeof commit === 'function' && state.lifecycle !== 'retiring') {
        const outcome = destructive
          ? commit({ kind: 'delete', fence: nextFence, ackToken: resolution.ackToken })
          : state.effectiveDisposition === 'retain'
            ? commit({
                kind: 'snapshot',
                rows: clone(state.accepted.rows),
                version: state.accepted.version,
                fence: nextFence,
                ackToken: resolution.ackToken,
              })
            : commit({
                kind: 'quarantine',
                fence: nextFence,
                ackToken: resolution.ackToken,
              });
        assertSynchronousCommit(outcome);
      }
      return clone({
        status: 'applied',
        ackToken: resolution.ackToken,
        disposition: state.effectiveDisposition,
        fence: nextFence,
      });
    } catch (error) {
      Object.assign(state, before);
      throw error;
    }
  };

  const acknowledge = (ackToken) => {
    for (const [key, entry] of Object.entries(state.pendingByScope)) {
      if (entry.resolution?.applied && entry.resolution.ticket.ackToken === ackToken) {
        const scope = state.scopeState[key];
        scope.lastAckToken = ackToken;
        delete state.pendingByScope[key];
        recomputeDisposition();
        return clone({ status: 'acknowledged', fence: advance() });
      }
    }
    if (Object.values(state.scopeState).some((entry) => entry.lastAckToken === ackToken)) {
      return clone({ status: 'duplicate', fence: fenceFor(state) });
    }
    return clone({ status: 'stale', fence: fenceFor(state) });
  };

  const rejectAcknowledgement = (ackToken, { commit = null } = {}) => {
    for (const [key, entry] of Object.entries(state.pendingByScope)) {
      if (entry.resolution?.applied && entry.resolution.ticket.ackToken === ackToken) {
        const before = clone(state);
        try {
          entry.resolution = null;
          state.effectiveDisposition = effectiveDisposition(
            pendingObligations(state.pendingByScope),
          );
          if (state.effectiveDisposition === 'delete') {
            state.accepted = null;
          }
          const nextFence = advance();
          if (typeof commit === 'function') {
            const outcome = commit({ kind: state.effectiveDisposition, fence: nextFence });
            assertSynchronousCommit(outcome);
          }
          return clone({
            status: 'rejected',
            obligation: entry.obligation,
            disposition: state.effectiveDisposition,
            fence: nextFence,
          });
        } catch (error) {
          Object.assign(state, before);
          throw error;
        }
      }
    }
    return clone({ status: 'stale', fence: fenceFor(state) });
  };

  const applyLiveSnapshot = ({ fence, snapshot, commit }) => {
    assertFence(state, fence, 'live snapshot callback');
    if (unresolvedDisposition(state) !== 'retain' || state.effectiveDisposition !== 'retain') {
      throw queryAuthorizationError(
        'SNAPBACK_AUTH_QUERY_QUARANTINED',
        'ordinary live callbacks cannot publish while invalidation is unresolved',
      );
    }
    const normalized = validateSnapshot(
      snapshot,
      state.expectedAuthorization,
      state.expectedVersionStream,
      'liveSnapshot',
    );
    if (state.accepted && normalized.version < state.accepted.version) {
      throw queryAuthorizationError(
        'SNAPBACK_AUTH_QUERY_VERSION_STALE',
        'live snapshot version moved backward in one version stream',
      );
    }
    const outcome = commit?.({
      kind: 'snapshot',
      rows: clone(normalized.rows),
      version: normalized.version,
      fence: fenceFor(state),
    });
    assertSynchronousCommit(outcome);
    state.accepted = clone(normalized);
    return clone({ status: 'applied', fence: fenceFor(state) });
  };

  // A reconnect/server restart installs a new expectation only from the
  // authenticated connection handshake. Existing roots survive until an
  // authenticated retirement plus a fresh snapshot closes their continuity.
  const replaceAuthenticatedExpectation = ({
    issuerId: nextIssuerValue,
    authorizationScope: nextAuthorizationScopeValue = null,
    connectionGeneration: nextConnectionGeneration = null,
    authorization: nextAuthorizationValue,
    versionStream: nextVersionStream,
    snapshot,
    commit = null,
  }) => {
    if (state.lifecycle !== 'active') {
      throw queryAuthorizationError(
        'SNAPBACK_AUTH_QUERY_FENCE_STALE',
        'retiring or removed query cannot replace its authenticated expectation',
      );
    }
    if (state.terminalDeleted) {
      throw queryAuthorizationError(
        'SNAPBACK_AUTH_QUERY_FENCE_STALE',
        'a terminally deleted query instance cannot install another authenticated expectation',
      );
    }
    const nextIssuer = validateIssuerId(nextIssuerValue);
    const nextAuthorization = validateAuthorizationVersion(nextAuthorizationValue);
    const nextAuthorizationScope = nextAuthorizationScopeValue === null
      ? null
      : validateScopeId(nextAuthorizationScopeValue, 'replacement.authorizationScope');
    if (
      nextIssuer.authorizationIncarnation !== nextAuthorization.incarnation
      || (
        nextAuthorizationScope !== null
        && (
          nextAuthorizationScope.kind !== 'subscription'
          || !same(nextAuthorizationScope.namespace, state.namespace)
          || !same(nextAuthorizationScope.issuerId, nextIssuer)
          || (
            nextConnectionGeneration !== null
            && nextAuthorizationScope.connectionGeneration !== nextConnectionGeneration
          )
        )
      )
      || (
        nextConnectionGeneration !== null
        && (!Number.isSafeInteger(nextConnectionGeneration) || nextConnectionGeneration < 1)
      )
      || typeof nextVersionStream !== 'string'
      || !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,255}$/.test(nextVersionStream)
    ) {
      throw queryAuthorizationError(
        'SNAPBACK_AUTH_INVALIDATION_ISSUER_INVALID',
        'replacement expectation has an invalid issuer/authorization/data binding',
      );
    }
    const normalizedSnapshot = validateSnapshot(
      snapshot,
      nextAuthorization,
      nextVersionStream,
      'replacement.snapshot',
    );
    const sameIncarnation = nextAuthorization.incarnation
      === state.expectedAuthorization.incarnation;
    const sameStream = nextVersionStream === state.expectedVersionStream;
    const destructiveTransition = !sameIncarnation || !sameStream;
    const before = clone(state);
    try {
      if (!sameIncarnation) {
        state.pendingByScope = {};
        state.scopeState = {};
        state.retiredScopeFrontier = null;
        state.retiredIssuerFrontier = {
          incarnation: nextAuthorization.incarnation,
          bootSequence: 0,
        };
      }
      state.expectedIssuerId = clone(nextIssuer);
      state.expectedAuthorizationScope = clone(nextAuthorizationScope);
      state.expectedConnectionGeneration = nextConnectionGeneration;
      state.expectedAuthorization = clone(nextAuthorization);
      state.expectedVersionStream = nextVersionStream;
      if (destructiveTransition) {
        state.accepted = null;
        state.terminalDeleted = true;
        state.effectiveDisposition = 'delete';
      } else {
        state.accepted = clone(normalizedSnapshot);
      }
      if (!destructiveTransition && Object.keys(state.pendingByScope).length === 0) {
        state.effectiveDisposition = 'retain';
      } else if (!destructiveTransition) {
        state.effectiveDisposition = unresolvedDisposition(state);
      }
      const nextFence = advance();
      if (typeof commit === 'function') {
        const outcome = state.effectiveDisposition === 'retain'
          ? commit({
              kind: 'snapshot',
              rows: clone(normalizedSnapshot.rows),
              version: normalizedSnapshot.version,
              fence: nextFence,
            })
          : commit({ kind: state.effectiveDisposition, fence: nextFence });
        assertSynchronousCommit(outcome);
      }
      return clone({
        status: 'replaced',
        fence: nextFence,
        disposition: state.effectiveDisposition,
      });
    } catch (error) {
      Object.assign(state, before);
      throw error;
    }
  };

  const retireMatching = ({ matches, freshSnapshot, commit, proofKind }) => {
    const keys = Object.keys(state.scopeState).filter((key) => matches(parsedScopeKey(key)));
    const pendingKeys = keys.filter((key) => Object.hasOwn(state.pendingByScope, key));
    const snapshot = freshSnapshot === null || freshSnapshot === undefined
      ? null
      : validateSnapshot(
          freshSnapshot,
          state.expectedAuthorization,
          state.expectedVersionStream,
          `${proofKind}.freshSnapshot`,
        );
    const allPendingRemovable = pendingKeys.every((key) => {
      const entry = state.pendingByScope[key];
      if (state.lifecycle === 'retiring') return true;
      if (
        entry.resolution?.applied
        && entry.resolution.ticket.kind === 'terminalDelete'
      ) return true;
      if (snapshot === null) return false;
      return proofKind === 'issuerRetirement'
        ? replacementWitnessCovers(snapshot.witness, entry.obligation.witness)
        : witnessCovers(snapshot.witness, entry.obligation.witness);
    });
    const retired = keys.map((key) => ({
      scopeId: parsedScopeKey(key),
      revision: state.scopeState[key]?.revisionHighWater ?? null,
    }));
    if (!allPendingRemovable) {
      for (const key of keys) state.scopeState[key].lifecycle = 'retirementPending';
      const nextFence = advance();
      if (typeof commit === 'function') {
        const outcome = commit({ kind: state.effectiveDisposition, fence: nextFence });
        assertSynchronousCommit(outcome);
      }
      return clone({
        status: 'pending-fresh-snapshot',
        fence: nextFence,
        retired: [],
      });
    }
    for (const key of keys) {
      delete state.pendingByScope[key];
      delete state.scopeState[key];
    }
    if (snapshot && state.lifecycle === 'active' && !state.terminalDeleted) {
      state.accepted = clone(maxAcceptedSnapshot(state.accepted, snapshot));
    }
    state.effectiveDisposition = state.lifecycle === 'retiring' || state.terminalDeleted
      ? 'delete'
      : unresolvedDisposition(state);
    const nextFence = advance();
    if (typeof commit === 'function') {
      const outcome = state.lifecycle === 'retiring' || state.terminalDeleted
        ? commit({ kind: 'delete', fence: nextFence })
        : state.effectiveDisposition === 'retain' && state.accepted
        ? commit({
            kind: 'snapshot',
            rows: clone(state.accepted.rows),
            version: state.accepted.version,
            fence: nextFence,
          })
        : commit({ kind: 'quarantine', fence: nextFence });
      assertSynchronousCommit(outcome);
    }
    return clone({
      status: 'retired',
      fence: nextFence,
      retired,
    });
  };

  const retireScopes = ({ retirement: value, freshSnapshot = null, commit = null }) => {
    const retirement = validateScopeRetirement(value);
    if (
      !same(retirement.issuerId, state.expectedIssuerId)
      || !same(retirement.namespace, state.namespace)
      || !same(retirement.authorizationExpectation, state.expectedAuthorization)
    ) {
      throw queryAuthorizationError(
        'SNAPBACK_AUTH_INVALIDATION_RETIREMENT_STALE',
        'scope retirement does not match the authenticated query expectation',
      );
    }
    const previous = state.retiredScopeFrontier?.scopeSequence ?? 0;
    if (retirement.retireThroughScopeSequence <= previous) {
      return clone({ status: 'duplicate', fence: fenceFor(state), retired: [] });
    }
    const before = clone(state);
    try {
      const result = retireMatching({
        matches: (scope) => scope.kind === 'subscription'
          && same(scope.issuerId, retirement.issuerId)
          && same(scope.namespace, retirement.namespace)
          && scope.scopeSequence <= retirement.retireThroughScopeSequence,
        freshSnapshot,
        commit,
        proofKind: 'scopeRetirement',
      });
      if (result.status === 'retired') {
        state.retiredScopeFrontier = {
          issuerId: clone(retirement.issuerId),
          namespace: clone(retirement.namespace),
          scopeSequence: retirement.retireThroughScopeSequence,
        };
      }
      return result;
    } catch (error) {
      Object.assign(state, before);
      throw error;
    }
  };

  const retireIssuer = ({ retirement: value, freshSnapshot = null, commit = null }) => {
    const retirement = validateIssuerRetirement(value);
    if (
      !same(retirement.currentIssuer.issuerId, state.expectedIssuerId)
      || !same(retirement.authorizationExpectation, state.expectedAuthorization)
    ) {
      throw queryAuthorizationError(
        'SNAPBACK_AUTH_INVALIDATION_RETIREMENT_STALE',
        'issuer retirement does not match the authenticated current issuer',
      );
    }
    if (retirement.retireThroughBootSequence <= state.retiredIssuerFrontier.bootSequence) {
      return clone({ status: 'duplicate', fence: fenceFor(state), retired: [] });
    }
    const before = clone(state);
    try {
      const result = retireMatching({
        matches: (scope) => scope.kind === 'subscription'
          && scope.issuerId.authorizationIncarnation === state.expectedAuthorization.incarnation
          && scope.issuerId.bootSequence <= retirement.retireThroughBootSequence,
        freshSnapshot,
        commit,
        proofKind: 'issuerRetirement',
      });
      if (result.status === 'retired') {
        state.retiredIssuerFrontier = {
          incarnation: state.expectedAuthorization.incarnation,
          bootSequence: retirement.retireThroughBootSequence,
        };
      }
      return result;
    } catch (error) {
      Object.assign(state, before);
      throw error;
    }
  };

  const previewRetirement = (operation) => {
    const before = clone(state);
    try {
      return operation();
    } finally {
      Object.assign(state, before);
    }
  };

  const previewRetireScopes = ({ retirement, freshSnapshot = null }) => (
    previewRetirement(() => retireScopes({ retirement, freshSnapshot }))
  );

  const previewRetireIssuer = ({ retirement, freshSnapshot = null }) => (
    previewRetirement(() => retireIssuer({ retirement, freshSnapshot }))
  );

  const beginRetirement = ({ fence, commit = null }) => {
    assertFence(state, fence, 'query instance retirement');
    const before = clone(state);
    try {
      state.lifecycle = 'retiring';
      state.terminalDeleted = true;
      state.effectiveDisposition = 'delete';
      state.accepted = null;
      const nextFence = advance();
      const outcome = commit?.({ kind: 'delete', fence: nextFence });
      assertSynchronousCommit(outcome);
      return clone({
        queryInstanceId: state.namespace.queryInstanceId,
        fence: nextFence,
        pendingOwnerContinuities: Object.values(state.pendingByScope)
          .map((entry) => entry.obligation.ownerContinuityId)
          .filter(Boolean),
      });
    } catch (error) {
      Object.assign(state, before);
      throw error;
    }
  };

  const finishRetirement = () => {
    if (state.lifecycle !== 'retiring') {
      throw queryAuthorizationError(
        'SNAPBACK_AUTH_QUERY_FENCE_STALE',
        'only a retiring query instance can finalize',
      );
    }
    const blockers = Object.values(state.pendingByScope).filter((entry) => !(
      entry.resolution?.applied
      && entry.resolution.ticket.kind === 'terminalDelete'
    ));
    if (blockers.length > 0) {
      throw queryAuthorizationError(
        'SNAPBACK_AUTH_QUERY_RETIREMENT_PENDING',
        'query retirement is waiting for exact owner continuity to end',
        { pending: blockers.length },
      );
    }
    state.pendingByScope = {};
    state.scopeState = {};
    state.lifecycle = 'removed';
    advance();
    return true;
  };

  return Object.freeze({
    receiveObligation,
    commitCurrentDisposition,
    applyResolution,
    acknowledge,
    rejectAcknowledgement,
    applyLiveSnapshot,
    replaceAuthenticatedExpectation,
    previewRetireScopes,
    previewRetireIssuer,
    retireScopes,
    retireIssuer,
    beginRetirement,
    finishRetirement,
    capture: () => clone(fenceFor(state)),
    namespace: () => clone(state.namespace),
    disposition: () => state.effectiveDisposition,
    isRenderable: (fence = fenceFor(state)) => (
      fenceMatches(state, fence)
      && state.lifecycle === 'active'
      && state.effectiveDisposition === 'retain'
      && unresolvedDisposition(state) === 'retain'
      && state.accepted !== null
    ),
    snapshot: () => clone({
      ...state,
      accepted: state.accepted === null
        ? null
        : { witness: state.accepted.witness, version: state.accepted.version },
    }),
  });
}
