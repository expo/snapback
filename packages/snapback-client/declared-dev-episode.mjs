import {
  deploymentIdentitiesEqual,
  normalizeDeploymentIdentity,
} from './declared-dev-capability.mjs';

const IDENTITY_PATH = '/_snapback/api/app/identity';
const IDENTITY_FORMAT = 'snapback.app-identity.v1';
const ADMISSION_POSTURES = new Set(['loopback-any', 'explicit-list']);

const codedError = (code, message, details = {}, cause = undefined) => {
  const error = new Error(`${code}: ${message}`, cause === undefined ? undefined : { cause });
  error.code = code;
  error.diagnostic = Object.freeze({
    schemaVersion: 'snapback.client-diagnostic.v1',
    code,
    severity: 'error',
    subsystem: 'client',
    message,
    details: Object.freeze({ ...details }),
  });
  return error;
};

const malformedFactError = (reason, fact = null) => codedError(
  'SNAPBACK_APP_IDENTITY_FACT_INVALID',
  `The development application identity fact is malformed: ${reason}.`,
  { reason, fact },
);

const connectRefusal = (code, message, details = {}, cause = undefined) => codedError(
  code ?? 'SNAPBACK_APP_BINDING_UNAVAILABLE',
  message,
  details,
  cause,
);

const parseIdentityFact = (fact) => {
  if (fact === null || typeof fact !== 'object' || Array.isArray(fact)) {
    throw malformedFactError('fact-record-missing');
  }
  if (fact.formatVersion !== IDENTITY_FORMAT) {
    throw malformedFactError('formatVersion-wrong-or-missing', fact);
  }
  const deployment = normalizeDeploymentIdentity(fact.deployment);
  if (deployment === null) {
    throw malformedFactError('deployment-missing-or-digest-incomplete', fact);
  }
  if (!ADMISSION_POSTURES.has(fact.admissionPosture)) {
    throw malformedFactError('admissionPosture-missing-or-invalid', fact);
  }
  return Object.freeze({
    deployment,
    admissionPosture: fact.admissionPosture,
  });
};

async function fetchIdentityFact(origin, fetchImplementation, signal) {
  let response;
  try {
    response = await fetchImplementation(`${origin}${IDENTITY_PATH}`, {
      method: 'GET',
      cache: 'no-store',
      credentials: 'omit',
      redirect: 'manual',
      headers: { accept: 'application/json' },
      signal,
    });
  } catch (cause) {
    throw connectRefusal(
      'SNAPBACK_APP_BINDING_UNAVAILABLE',
      'The development application identity endpoint could not be reached.',
      { origin, identityPath: IDENTITY_PATH },
      cause,
    );
  }
  if (
    response?.type === 'opaqueredirect'
    || (Number.isInteger(response?.status) && response.status >= 300 && response.status < 400)
  ) {
    try { await response.body?.cancel?.(); } catch { /* refusal owns cleanup */ }
    throw connectRefusal(
      'SNAPBACK_APP_BINDING_UNAVAILABLE',
      'The development application identity endpoint redirected; redirects are refused.',
      { origin, status: response?.status ?? null, refusal: 'redirect' },
    );
  }
  if (!response?.ok) {
    let payload = null;
    try { payload = await response.json(); } catch { /* status owns refusal */ }
    const remoteCode = payload?.diagnostic?.code ?? payload?.code ?? 'SNAPBACK_APP_BINDING_UNAVAILABLE';
    throw connectRefusal(
      remoteCode,
      payload?.diagnostic?.message
        ?? payload?.message
        ?? `The development application identity endpoint refused with HTTP ${response?.status ?? 'unknown'}.`,
      { origin, status: response?.status ?? null, remoteCode },
    );
  }
  let fact;
  try {
    fact = await response.json();
  } catch (cause) {
    throw malformedFactError('response-is-not-json', { cause: cause?.message ?? null });
  }
  return parseIdentityFact(fact);
}

// @ref LLP 0302#3-the-standing-discovery-gate--transport-lifecycle-episodes
// — one gate is owned by one client/origin pair. Serialized stream establishment
// shares its epoch with handshake HTTP, then live sockets retain it; otherwise
// every transport-bearing operation receives its own slot automatically.
export function createDeclaredDevEpisodeGate({
  origin,
  expectedDeploymentIdentity,
  streamless = false,
  fetch: fetchImplementation = globalThis.fetch,
}) {
  const expected = normalizeDeploymentIdentity(expectedDeploymentIdentity);
  if (expected === null) throw new TypeError('declared-dev gate requires a complete DeploymentIdentity');
  if (typeof fetchImplementation !== 'function') throw new TypeError('declared-dev gate requires fetch');
  if (typeof streamless !== 'boolean') throw new TypeError('declared-dev streamless mode must be boolean');
  let generation = 0;
  let streamSequence = 0;
  let currentStreamToken = null;
  let beginTail = Promise.resolve();
  const standing = { verified: false, verification: null, revision: 0 };
  const streamTokens = new WeakMap();
  const liveStreams = new Set();

  const invalidateStanding = () => {
    generation += 1;
    standing.verified = false;
    standing.verification = null;
    standing.revision += 1;
  };

  const beginTopLevelOperation = (inherited = null) => {
    if (inherited !== null) return inherited;
    if (!streamless && (currentStreamToken !== null || liveStreams.size > 0)) {
      return Object.freeze({ slot: standing, streamSequence });
    }
    return Object.freeze({
      slot: { verified: false, verification: null, revision: 0 },
      streamSequence: null,
    });
  };

  const ownsCurrentStandingEpoch = (operation) => (
    operation?.slot === standing
    && operation.streamSequence === streamSequence
  );

  const invalidate = (operation) => {
    const slot = operation?.slot;
    if (slot === standing) {
      if (ownsCurrentStandingEpoch(operation)) invalidateStanding();
      return;
    }
    if (slot === null || typeof slot !== 'object') return;
    slot.verified = false;
    slot.verification = null;
    slot.revision += 1;
  };

  const verify = async (operation = beginTopLevelOperation(), signal = undefined) => {
    const slot = operation?.slot;
    if (slot === null || typeof slot !== 'object') {
      throw new TypeError('declared-dev verification requires an operation token');
    }
    if (slot === standing && !ownsCurrentStandingEpoch(operation)) {
      throw connectRefusal(
        'SNAPBACK_APP_BINDING_UNAVAILABLE',
        'The development application identity episode changed before verification.',
        { origin, reason: 'episode-changed' },
      );
    }
    if (slot.verified) return;
    if (slot.verification !== null) return slot.verification;
    const startedRevision = slot.revision;
    const verification = (async () => {
      const observed = await fetchIdentityFact(origin, fetchImplementation, signal);
      if (!deploymentIdentitiesEqual(expected, observed.deployment)) {
        throw codedError(
          'SNAPBACK_APP_BINDING_IDENTITY_MISMATCH',
          `Generated application identity ${JSON.stringify(expected)} does not match backend identity ${JSON.stringify(observed.deployment)}.`,
          {
            expectedIdentity: expected,
            observedIdentity: observed.deployment,
            admissionPosture: observed.admissionPosture,
          },
        );
      }
      if (
        startedRevision !== slot.revision
        || (slot === standing && !ownsCurrentStandingEpoch(operation))
      ) {
        throw connectRefusal(
          'SNAPBACK_APP_BINDING_UNAVAILABLE',
          'The development application identity episode changed during verification.',
          { origin, reason: 'episode-changed' },
        );
      }
      slot.verified = true;
    })();
    slot.verification = verification;
    try {
      await verification;
    } finally {
      if (slot.verification === verification) slot.verification = null;
    }
  };

  return Object.freeze({
    beginTopLevelOperation,
    ensureVerified: verify,
    invalidate,
    async beginStandingStreamEpisode(signal = undefined) {
      const predecessor = beginTail;
      let releaseReservation;
      const reservation = new Promise((resolve) => { releaseReservation = resolve; });
      beginTail = predecessor.then(() => reservation);
      await predecessor;

      streamSequence += 1;
      const token = Object.freeze({ sequence: streamSequence });
      const metadata = {
        registered: false,
        released: false,
        release() {
          if (metadata.released) return;
          metadata.released = true;
          releaseReservation();
        },
      };
      streamTokens.set(token, metadata);
      currentStreamToken = token;
      invalidateStanding();
      const operation = Object.freeze({ slot: standing, streamSequence });
      try {
        await verify(operation, signal);
        return token;
      } catch (error) {
        if (currentStreamToken === token) currentStreamToken = null;
        metadata.release();
        throw error;
      }
    },
    markStandingStreamOpen(token) {
      const metadata = streamTokens.get(token);
      if (
        metadata === undefined
        || currentStreamToken !== token
        || token.sequence !== streamSequence
        || standing.verified !== true
      ) return false;
      metadata.registered = true;
      liveStreams.add(token);
      metadata.release();
      return true;
    },
    endStandingStreamEpisode(token) {
      const metadata = streamTokens.get(token);
      if (metadata === undefined) return;
      if (metadata.registered) liveStreams.delete(token);
      if (currentStreamToken !== token || token.sequence !== streamSequence) return;
      currentStreamToken = null;
      metadata.release();
      // A token that never reached socket-open owns no standing liveness and
      // its cleanup cannot un-verify a sibling or a later epoch.
      if (!metadata.registered) return;
      invalidateStanding();
    },
    inspection() {
      return Object.freeze({
        origin,
        streamless,
        verified: !streamless && liveStreams.size > 0 && standing.verified,
        liveStreams: liveStreams.size,
        generation,
      });
    },
  });
}
