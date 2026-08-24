import {
  canonicalDeclaredDevOrigin,
  declaredDevCapabilityFromApp,
  stampedDeclaredDevIdentity,
} from '@expo/snapback-client/app-client-internal';

const candidateStamps = new WeakMap();

const nonEmptyString = (value) => typeof value === 'string' && value.length > 0;

// Provider/environment shared precedence seam. Presence, not successful URL
// parsing, makes rendezvous configured; the resolver owns any typed refusal.
// This module has no package export, so the signal reader is not public API.
export function supervisedRendezvousOriginFromRuntime() {
  // @ref LLP 0302#1-structural-gating-one-stable-module-two-generated-variants
  // — NODE_ENV is never the authorization boundary. The provider calls this
  // reader only when the generated app carries the structural dev capability.
  const installed = globalThis.__SNAPBACK_EXPO_SUPERVISOR_ORIGIN__;
  if (nonEmptyString(installed)) return installed;
  if (
    typeof process !== 'undefined'
    && nonEmptyString(process.env?.EXPO_PUBLIC_SNAPBACK_SUPERVISOR_ORIGIN)
  ) return process.env.EXPO_PUBLIC_SNAPBACK_SUPERVISOR_ORIGIN;
  return null;
}

export function supervisedRendezvousConfiguredFromRuntime() {
  return supervisedRendezvousOriginFromRuntime() !== null;
}

const deepFreeze = (value) => {
  if (value !== null && typeof value === 'object' && !Object.isFrozen(value)) {
    for (const child of Object.values(value)) deepFreeze(child);
    Object.freeze(value);
  }
  return value;
};

// Provider-only constructor. This module has no package export, so application
// code cannot turn raw public deployment facts into an admitted candidate.
export function createDeclaredDevBindingCandidate(app, url) {
  const capability = declaredDevCapabilityFromApp(app);
  const deploymentIdentity = stampedDeclaredDevIdentity(capability);
  if (deploymentIdentity === null) return null;
  const canonical = canonicalDeclaredDevOrigin(url);
  const offered = new Set(app.capabilities.required);
  if (app.authBootstrap?.entryMechanisms?.includes('password-v1')) offered.add('auth.passwords');
  if (app.authBootstrap?.entryMechanisms?.includes('guest-v1')) offered.add('auth.guest-sessions');
  const candidate = deepFreeze({
    format: 'snapback.app-binding.v1',
    source: 'declared-dev',
    descriptorIdentity: app.identity.descriptor,
    target: {
      app: app.identity.app,
      schema: app.identity.schema,
      functions: app.identity.functions,
      origin: canonical.ok ? canonical.origin : String(url ?? ''),
      routing: 'declared-dev',
    },
    capabilities: {
      offered: [...offered],
    },
    provenance: {
      deploymentIdentity: { ...deploymentIdentity },
    },
    integrity: {
      channel: 'generated-declared-dev',
    },
  });
  candidateStamps.set(candidate, Object.freeze({
    deploymentIdentity,
    url,
  }));
  return candidate;
}

export function declaredDevCandidateStamp(candidate) {
  return candidateStamps.get(candidate) ?? null;
}
