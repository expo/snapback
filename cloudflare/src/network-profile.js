// Cloudflare-arm network-condition profile model and deadline preparation.
//
// @ref LLP 0167#profile-model — keep the hosted JS arm byte-for-byte aligned
//   with the Rust arm's camelCase profile vocabulary and pinned built-ins.
// @ref LLP 0167#authority-one-activation-chokepoint — test deployments and
//   explicitly identified LLP 0158 derived deployments are the only classes
//   that may select a non-normal profile; missing or contradictory deployment
//   facts fail closed.

export const NETWORK_PROFILE_HEADER = 'snapback-network-profile';
export const NETWORK_PROFILE_DELAY_CEILING_MS = 30_000;
export const NETWORK_PROFILE_FORBIDDEN_CODE = 'SNAPBACK_NETWORK_PROFILE_FORBIDDEN';
export const NETWORK_PROFILE_INVALID_CODE = 'SNAPBACK_NETWORK_PROFILE_INVALID';
export const NETWORK_PROFILE_DELAY_CEILING_CODE = 'SNAPBACK_NETWORK_PROFILE_DELAY_CEILING';
export const DERIVED_INSTANCE_ID_BINDING = 'SNAPBACK_DERIVED_INSTANCE_ID';

const DERIVED_INSTANCE_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

const PROFILE_FIELDS = Object.freeze([
  'name',
  'mutationAckDelayMs',
  'liveDeltaDelayMs',
  'queryResponseDelayMs',
  'jitterMs',
]);

const BUILT_INS = Object.freeze({
  normal: Object.freeze({
    name: 'normal',
    mutationAckDelayMs: 0,
    liveDeltaDelayMs: 0,
    queryResponseDelayMs: 0,
    jitterMs: 0,
  }),
  optimistic: Object.freeze({
    name: 'optimistic',
    mutationAckDelayMs: 1_000,
    liveDeltaDelayMs: 1_000,
    queryResponseDelayMs: 0,
    jitterMs: 0,
  }),
  'demo-slow': Object.freeze({
    name: 'demo-slow',
    mutationAckDelayMs: 2_000,
    liveDeltaDelayMs: 2_000,
    queryResponseDelayMs: 2_000,
    jitterMs: 250,
  }),
});

export class NetworkProfileError extends Error {
  constructor(code, message, details = null) {
    super(message);
    this.name = 'NetworkProfileError';
    this.snapbackCode = code;
    this.snapbackDetails = details;
  }
}

function invalid(message, details = null) {
  throw new NetworkProfileError(NETWORK_PROFILE_INVALID_CODE, message, details);
}

function ceiling(message, details) {
  throw new NetworkProfileError(NETWORK_PROFILE_DELAY_CEILING_CODE, message, details);
}

function cloneProfile(profile) {
  return Object.freeze({ ...profile });
}

export function parseNetworkProfile(selection) {
  if (typeof selection === 'string') {
    const builtIn = BUILT_INS[selection];
    if (!builtIn) {
      invalid('unknown network condition profile name', { name: selection });
    }
    return cloneProfile(builtIn);
  }
  if (!selection || typeof selection !== 'object' || Array.isArray(selection)) {
    invalid('network profile must be a built-in name or inline object');
  }
  const unknown = Object.keys(selection).filter((key) => !PROFILE_FIELDS.includes(key));
  if (unknown.length > 0) {
    invalid('invalid inline network condition profile', { unknownFields: unknown.sort() });
  }
  for (const field of PROFILE_FIELDS.slice(0, 4)) {
    if (!Object.hasOwn(selection, field)) {
      invalid('invalid inline network condition profile', { missingField: field });
    }
  }
  const profile = {
    name: selection.name,
    mutationAckDelayMs: selection.mutationAckDelayMs,
    liveDeltaDelayMs: selection.liveDeltaDelayMs,
    queryResponseDelayMs: selection.queryResponseDelayMs,
    jitterMs: selection.jitterMs ?? 0,
  };
  if (
    typeof profile.name !== 'string' ||
    profile.name.length === 0 ||
    !/^[A-Za-z0-9._-]+$/.test(profile.name)
  ) {
    invalid("network profile name must contain only ASCII letters, digits, '.', '_' or '-'");
  }
  for (const field of PROFILE_FIELDS.slice(1)) {
    const value = profile[field];
    if (!Number.isSafeInteger(value) || value < 0) {
      invalid('invalid inline network condition profile', {
        field,
        reason: 'expected a non-negative safe integer',
      });
    }
    if (value > NETWORK_PROFILE_DELAY_CEILING_MS) {
      ceiling(
        `network profile field ${field} exceeds the ${NETWORK_PROFILE_DELAY_CEILING_MS} ms ceiling`,
        { field, valueMs: value, ceilingMs: NETWORK_PROFILE_DELAY_CEILING_MS },
      );
    }
  }
  const maxLaneDelayMs = Math.max(
    profile.mutationAckDelayMs,
    profile.liveDeltaDelayMs,
    profile.queryResponseDelayMs,
  );
  if (maxLaneDelayMs + profile.jitterMs > NETWORK_PROFILE_DELAY_CEILING_MS) {
    ceiling(
      `network profile lane delay plus jitter exceeds the ${NETWORK_PROFILE_DELAY_CEILING_MS} ms per-response ceiling`,
      { maxLaneDelayMs, jitterMs: profile.jitterMs, ceilingMs: NETWORK_PROFILE_DELAY_CEILING_MS },
    );
  }
  // A built-in name is a contract: an inline profile may reuse it only when
  // it is field-identical, so a marker naming "normal"/"optimistic" cannot
  // lie about the delays actually applied.
  const reserved = BUILT_INS[profile.name];
  if (reserved && PROFILE_FIELDS.slice(1).some((field) => profile[field] !== reserved[field])) {
    invalid('inline network profile reuses a built-in name with different fields', {
      name: profile.name,
    });
  }
  return cloneProfile(profile);
}

export function parseNetworkProfileEnv(raw) {
  const trimmed = String(raw).trim();
  if (trimmed.startsWith('{') || trimmed.startsWith('"')) {
    let parsed;
    try {
      parsed = JSON.parse(trimmed);
    } catch (error) {
      invalid('invalid SNAPBACK_NETWORK_PROFILE JSON', { cause: String(error?.message || error) });
    }
    return parseNetworkProfile(parsed);
  }
  return parseNetworkProfile(trimmed);
}

function isNormal(profile) {
  const normal = BUILT_INS.normal;
  return PROFILE_FIELDS.every((field) => profile[field] === normal[field]);
}

function deploymentPermitsPerturbation(env) {
  const testing = env.SNAPBACK_TESTING;
  const derivedInstanceId = env[DERIVED_INSTANCE_ID_BINDING];
  const hasDerivedFact = derivedInstanceId !== undefined && derivedInstanceId !== null;
  const validDerivedIdentity = typeof derivedInstanceId === 'string'
    && DERIVED_INSTANCE_ID.test(derivedInstanceId);

  // SNAPBACK_TESTING remains the existing non-hosted test class, but it must
  // not also claim to be a hosted derived deployment. A hosted deployment may
  // omit the testing binding (the production config convention) or set its
  // exact false value; no other spelling is authoritative.
  const testingDeployment = testing === '1' && !hasDerivedFact;
  const hostedDerivedDeployment = (testing == null || testing === '0')
    && validDerivedIdentity;
  return Object.freeze({
    allowed: testingDeployment || hostedDerivedDeployment,
    testingClassification: testing == null ? 'missing' : String(testing),
    derivedIdentityClassification: !hasDerivedFact
      ? 'missing'
      : validDerivedIdentity ? 'valid' : 'invalid',
  });
}

function sampleJitterMs(maximumMs) {
  if (maximumMs === 0) return 0;
  // Rejection sampling avoids modulo bias while keeping one sample shared by
  // every ack and live frame in the commit group.
  const range = maximumMs + 1;
  const limit = Math.floor(0x1_0000_0000 / range) * range;
  const values = new Uint32Array(1);
  do {
    crypto.getRandomValues(values);
  } while (values[0] >= limit);
  return values[0] % range;
}

function delayForLane(profile, lane) {
  switch (lane) {
    case 'mutationAck': return profile.mutationAckDelayMs;
    case 'liveDelta': return profile.liveDeltaDelayMs;
    case 'queryResponse': return profile.queryResponseDelayMs;
    default: throw new Error(`unknown network-profile egress lane ${lane}`);
  }
}

function activeSnapshot(profile, source, principal = null, activatedAtMs = Date.now()) {
  return Object.freeze({
    profile,
    provenance: Object.freeze({
      source,
      ...(principal == null ? {} : { principal }),
      activatedAtMs,
    }),
  });
}

function preparedEgress(snapshot, basisMs, lane, jitterMs) {
  return Object.freeze({
    snapshot,
    releaseAtMs: basisMs + delayForLane(snapshot.profile, lane) + jitterMs,
  });
}

export function networkProfileClockNowMs() {
  return globalThis.performance?.now?.() ?? Date.now();
}

export class NetworkProfileState {
  constructor(env) {
    this.env = env;
    this.activeSnapshot = activeSnapshot(cloneProfile(BUILT_INS.normal), 'env');
    this.startupError = null;
    try {
      const selected = env.SNAPBACK_NETWORK_PROFILE == null || env.SNAPBACK_NETWORK_PROFILE === ''
        ? cloneProfile(BUILT_INS.normal)
        : parseNetworkProfileEnv(env.SNAPBACK_NETWORK_PROFILE);
      this.activate(selected, 'env');
      if (!isNormal(selected)) {
        console.info(`snapback network profile active: ${selected.name} (source=env)`);
      }
    } catch (error) {
      this.startupError = error;
    }
  }

  active() {
    return this.activeSnapshot;
  }

  // The one activation chokepoint for env and runtime selectors.
  activate(profile, source, principal = null) {
    const validated = parseNetworkProfile(profile);
    const deployment = deploymentPermitsPerturbation(this.env);
    if (!isNormal(validated) && !deployment.allowed) {
      throw new NetworkProfileError(
        NETWORK_PROFILE_FORBIDDEN_CODE,
        'non-normal network profiles require a classified test deployment or an explicitly identified hosted derived instance',
        {
          testingClassification: deployment.testingClassification,
          derivedIdentityClassification: deployment.derivedIdentityClassification,
        },
      );
    }
    this.activeSnapshot = activeSnapshot(validated, source, principal);
    return this.activeSnapshot;
  }

  admitResult(lane, readyAtMs = networkProfileClockNowMs()) {
    const snapshot = this.activeSnapshot;
    if (isNormal(snapshot.profile)) return null;
    return preparedEgress(snapshot, readyAtMs, lane, sampleJitterMs(snapshot.profile.jitterMs));
  }

  admitCommit(committedAtMs) {
    const snapshot = this.activeSnapshot;
    if (isNormal(snapshot.profile)) return null;
    const jitterMs = sampleJitterMs(snapshot.profile.jitterMs);
    return Object.freeze({
      snapshot,
      committedAtMs,
      jitterMs,
      forLane: (lane) => preparedEgress(snapshot, committedAtMs, lane, jitterMs),
    });
  }

  // OQ4 proposed ruling, folded leg: the legacy subscription-stage binding
  // remains a SNAPBACK_TESTING-only compatibility input, but it now creates a
  // live-delta-lane deadline through this same model. Its historical 1,000 ms
  // clamp remains the seam convention expected by existing tests. The caller
  // releases the subscribe response outside runExclusive.
  admitTestSubscriptionStage(readyAtMs = networkProfileClockNowMs()) {
    if (this.env.SNAPBACK_TESTING !== '1') return null;
    const requested = Number(this.env.SNAPBACK_TEST_SUBSCRIPTION_STAGE_DELAY_MS);
    if (!Number.isFinite(requested) || requested <= 0) return null;
    const delayMs = Math.min(Math.floor(requested), 1_000);
    const snapshot = activeSnapshot(
      parseNetworkProfile({
        name: 'test-subscription-stage',
        mutationAckDelayMs: 0,
        liveDeltaDelayMs: delayMs,
        queryResponseDelayMs: 0,
        jitterMs: 0,
      }),
      'env',
    );
    return preparedEgress(snapshot, readyAtMs, 'liveDelta', 0);
  }
}

export function networkProfileStartupDiagnostic(error) {
  return {
    ok: false,
    code: error.snapbackCode || NETWORK_PROFILE_INVALID_CODE,
    message: String(error.message || error),
    ...(error.snapbackDetails ? { details: error.snapbackDetails } : {}),
  };
}

export function networkProfileStatus(error) {
  return error?.snapbackCode === NETWORK_PROFILE_FORBIDDEN_CODE ? 403 : 400;
}

export function markProfiledResponse(response, prepared) {
  if (!prepared) return response;
  const headers = new Headers(response.headers);
  headers.set(NETWORK_PROFILE_HEADER, prepared.snapshot.profile.name);
  const exposed = new Set(
    (headers.get('access-control-expose-headers') || '')
      .split(',')
      .map((value) => value.trim().toLowerCase())
      .filter(Boolean),
  );
  exposed.add(NETWORK_PROFILE_HEADER);
  headers.set('access-control-expose-headers', [...exposed].join(', '));
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
}
