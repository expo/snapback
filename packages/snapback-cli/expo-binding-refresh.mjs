const DEFAULT_BINDING_TTL_MS = 60 * 60 * 1_000;
const DEFAULT_BINDING_REFRESH_WINDOW_MS = 5 * 60 * 1_000;
const APP_BINDING_ROOT_KEYS = Object.freeze([
  'capabilities',
  'descriptorIdentity',
  'format',
  'integrity',
  'provenance',
  'source',
  'target',
]);

function diagnosticError(code, message, details = {}) {
  const diagnostic = Object.freeze({
    schemaVersion: 'snapback.client-diagnostic.v1',
    code,
    severity: 'error',
    message,
    details: Object.freeze({ ...details }),
  });
  const error = new Error(`${code}: ${message}`);
  error.code = code;
  error.diagnostic = diagnostic;
  return error;
}

function publicRefreshDiagnostic(error, predecessor, generation) {
  const code = error?.code === 'SNAPBACK_EXPO_BINDING_REFRESH_INVALID'
    ? error.code
    : 'SNAPBACK_EXPO_BINDING_REFRESH_FAILED';
  return Object.freeze({
    schemaVersion: 'snapback.client-diagnostic.v1',
    code,
    severity: 'error',
    message: 'the Expo supervisor could not refresh its expiring binding',
    // Never copy arbitrary issuer exception details into readiness. A future
    // issuer could carry private context even though AppBinding is bearer-free.
    details: Object.freeze({
      descriptorIdentity: predecessor.descriptorIdentity,
      supervisorGeneration: generation,
    }),
  });
}

function bindingFromDescriptor({ descriptor, origin, routing, generation, now, ttlMs }) {
  const offeredCapabilities = new Set(descriptor.capabilities.required);
  if (descriptor.authBootstrap?.entryMechanisms?.includes('password-v1')) {
    offeredCapabilities.add('auth.passwords');
  }
  if (descriptor.authBootstrap?.entryMechanisms?.includes('guest-v1')) {
    offeredCapabilities.add('auth.guest-sessions');
  }
  return Object.freeze({
    format: 'snapback.app-binding.v1',
    source: 'supervised-dev',
    descriptorIdentity: descriptor.identity.descriptor,
    target: Object.freeze({
      app: descriptor.identity.app,
      schema: descriptor.identity.schema,
      functions: descriptor.identity.functions,
      origin,
      routing,
    }),
    capabilities: Object.freeze({ offered: Object.freeze([...offeredCapabilities].sort()) }),
    provenance: Object.freeze({
      supervisorGeneration: generation,
      issuedAt: new Date(now).toISOString(),
      expiresAt: new Date(now + ttlMs).toISOString(),
    }),
    integrity: Object.freeze({ channel: 'local-supervised-ipc' }),
  });
}

function bindingRefreshWindowMs(ttlMs, configured) {
  if (!Number.isSafeInteger(ttlMs) || ttlMs < 2) {
    throw new TypeError('supervised binding TTL must be an integer of at least 2 milliseconds');
  }
  const selected = configured ?? Math.min(
    DEFAULT_BINDING_REFRESH_WINDOW_MS,
    Math.max(1, Math.floor(ttlMs / 4)),
  );
  if (!Number.isSafeInteger(selected) || selected < 1 || selected >= ttlMs) {
    throw new TypeError('supervised binding refresh window must be a positive integer smaller than the TTL');
  }
  return selected;
}

function refreshBindingIssuance(binding, { now, ttlMs }) {
  return Object.freeze({
    ...binding,
    provenance: Object.freeze({
      supervisorGeneration: binding.provenance.supervisorGeneration,
      issuedAt: new Date(now).toISOString(),
      expiresAt: new Date(now + ttlMs).toISOString(),
    }),
  });
}

function stableBindingFacts(binding) {
  return JSON.stringify({
    format: binding?.format,
    source: binding?.source,
    descriptorIdentity: binding?.descriptorIdentity,
    target: binding?.target,
    capabilities: binding?.capabilities,
    supervisorGeneration: binding?.provenance?.supervisorGeneration,
    integrity: binding?.integrity,
  });
}

function exactKeys(value, expected) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
  const actual = Object.keys(value).sort();
  return actual.length === expected.length
    && actual.every((key, index) => key === expected[index]);
}

function canonicalRefreshSuccessor(predecessor, successor, ttlMs) {
  const issuedAt = Date.parse(successor?.provenance?.issuedAt);
  const expiresAt = Date.parse(successor?.provenance?.expiresAt);
  if (
    successor?.source !== 'supervised-dev'
    || !exactKeys(successor, APP_BINDING_ROOT_KEYS)
    || stableBindingFacts(successor) !== stableBindingFacts(predecessor)
    || !exactKeys(successor?.provenance, ['expiresAt', 'issuedAt', 'supervisorGeneration'])
    || !Number.isFinite(issuedAt)
    || !Number.isFinite(expiresAt)
    || issuedAt <= Date.parse(predecessor.provenance.issuedAt)
    || expiresAt - issuedAt !== ttlMs
  ) {
    throw diagnosticError(
      'SNAPBACK_EXPO_BINDING_REFRESH_INVALID',
      'the supervised binding refresh changed facts outside issuance and expiry',
      {
        descriptorIdentity: predecessor.descriptorIdentity,
        supervisorGeneration: predecessor.provenance.supervisorGeneration,
      },
    );
  }
  return Object.freeze({
    format: predecessor.format,
    source: predecessor.source,
    descriptorIdentity: predecessor.descriptorIdentity,
    target: Object.freeze({
      app: predecessor.target.app,
      schema: predecessor.target.schema,
      functions: predecessor.target.functions,
      origin: predecessor.target.origin,
      routing: predecessor.target.routing,
    }),
    capabilities: Object.freeze({
      offered: Object.freeze([...predecessor.capabilities.offered]),
    }),
    provenance: Object.freeze({
      supervisorGeneration: predecessor.provenance.supervisorGeneration,
      issuedAt: successor.provenance.issuedAt,
      expiresAt: successor.provenance.expiresAt,
    }),
    integrity: Object.freeze({ channel: predecessor.integrity.channel }),
  });
}

// @ref LLP 0181#appbinding-v1 — the supervisor is the sole binding issuer;
// refresh preserves its exact generation/descriptor/route/capability cut.
// @ref LLP 0294#open-questions — resolved OQ7 chooses one lazy per-exchange
// publication point, not a background timer in either supervisor or app.
export function createSupervisedBindingPublisher({
  generation,
  now = Date.now,
  ttlMs = DEFAULT_BINDING_TTL_MS,
  refreshWindowMs,
  mintRefresh = refreshBindingIssuance,
  onEvent = () => {},
} = {}) {
  if (typeof generation !== 'string' || generation.length === 0) {
    throw new TypeError('supervised binding publisher requires a supervisor generation');
  }
  if (typeof now !== 'function' || typeof mintRefresh !== 'function' || typeof onEvent !== 'function') {
    throw new TypeError('supervised binding publisher callbacks must be functions');
  }
  const boundedRefreshWindowMs = bindingRefreshWindowMs(ttlMs, refreshWindowMs);
  let binding = null;
  let revision = 0;
  let lastIssuedAt = Number.NEGATIVE_INFINITY;
  let refresh = null;
  let closed = false;

  const nextIssuedAt = () => {
    const observed = now();
    if (!Number.isFinite(observed)) {
      throw new TypeError('supervised binding clock must return a finite timestamp');
    }
    const issuedAt = Math.max(Math.trunc(observed), lastIssuedAt + 1);
    // Validate the complete interval before reserving the monotone watermark.
    new Date(issuedAt).toISOString();
    new Date(issuedAt + ttlMs).toISOString();
    lastIssuedAt = issuedAt;
    return issuedAt;
  };

  const publish = (successor) => {
    if (closed) {
      throw diagnosticError(
        'SNAPBACK_EXPO_SUPERVISOR_CLOSED',
        'the Expo supervisor cannot publish a binding after cleanup',
      );
    }
    if (
      successor?.source !== 'supervised-dev'
      || successor?.provenance?.supervisorGeneration !== generation
    ) {
      throw diagnosticError(
        'SNAPBACK_EXPO_BINDING_PUBLICATION_INVALID',
        'the binding publisher accepts only bindings issued by its supervisor generation',
        { supervisorGeneration: generation },
      );
    }
    const successorIssuedAt = Date.parse(successor.provenance.issuedAt);
    const currentIssuedAt = Date.parse(binding?.provenance?.issuedAt);
    if (successor === binding) return binding;
    if (
      binding !== null
      && Number.isFinite(currentIssuedAt)
      && (!Number.isFinite(successorIssuedAt) || successorIssuedAt <= currentIssuedAt)
    ) {
      throw diagnosticError(
        'SNAPBACK_EXPO_BINDING_PUBLICATION_STALE',
        'an older supervised binding cannot replace the published successor',
        {
          supervisorGeneration: generation,
          publishedIssuedAt: binding.provenance.issuedAt,
          rejectedIssuedAt: successor.provenance.issuedAt,
        },
      );
    }
    binding = successor;
    revision += 1;
    if (Number.isFinite(successorIssuedAt)) {
      lastIssuedAt = Math.max(lastIssuedAt, successorIssuedAt);
    }
    return binding;
  };

  const issue = ({ descriptor, origin, routing }) => publish(bindingFromDescriptor({
    descriptor,
    origin,
    routing,
    generation,
    now: nextIssuedAt(),
    ttlMs,
  }));

  const bindingForExchange = () => {
    if (closed || binding === null) return Promise.resolve(null);
    let observedNow;
    try {
      observedNow = now();
      if (!Number.isFinite(observedNow)) {
        throw new TypeError('supervised binding clock must return a finite timestamp');
      }
    } catch (error) {
      return Promise.reject(error);
    }
    const remainingTtlMs = Date.parse(binding.provenance.expiresAt) - observedNow;
    if (remainingTtlMs > boundedRefreshWindowMs) return Promise.resolve(binding);
    if (refresh?.revision === revision) return refresh.promise;

    const predecessor = binding;
    const predecessorRevision = revision;
    let refreshRecord;
    const promise = Promise.resolve()
      .then(() => mintRefresh(predecessor, { now: nextIssuedAt(), ttlMs }))
      .then((successor) => {
        const canonicalSuccessor = canonicalRefreshSuccessor(predecessor, successor, ttlMs);
        if (closed) return null;
        if (revision !== predecessorRevision || binding !== predecessor) {
          return bindingForExchange();
        }
        publish(canonicalSuccessor);
        const publishedRevision = revision;
        onEvent(Object.freeze({
          ok: true,
          state: 'binding-refreshed',
          reason: 'expiry-window',
          descriptorIdentity: canonicalSuccessor.descriptorIdentity,
          supervisorGeneration: generation,
          previousIssuedAt: predecessor.provenance.issuedAt,
          issuedAt: canonicalSuccessor.provenance.issuedAt,
          expiresAt: canonicalSuccessor.provenance.expiresAt,
          refreshWindowMs: boundedRefreshWindowMs,
        }));
        if (revision !== publishedRevision || binding !== canonicalSuccessor) {
          return bindingForExchange();
        }
        return canonicalSuccessor;
      })
      .catch((error) => {
        if (closed) return null;
        if (revision !== predecessorRevision || binding !== predecessor) {
          return bindingForExchange();
        }
        onEvent(Object.freeze({
          ok: false,
          state: 'binding-refresh-failed',
          descriptorIdentity: predecessor.descriptorIdentity,
          supervisorGeneration: generation,
          expiresAt: predecessor.provenance.expiresAt,
          diagnostics: Object.freeze([
            publicRefreshDiagnostic(error, predecessor, generation),
          ]),
        }));
        throw error;
      })
      .finally(() => {
        if (refresh === refreshRecord) refresh = null;
      });
    refreshRecord = Object.freeze({ revision: predecessorRevision, promise });
    refresh = refreshRecord;
    return promise;
  };

  return Object.freeze({
    issue,
    publish,
    bindingForExchange,
    get current() { return binding; },
    get refreshWindowMs() { return boundedRefreshWindowMs; },
    close() {
      if (closed) return;
      closed = true;
      binding = null;
      revision += 1;
    },
  });
}
