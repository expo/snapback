import { createExternalSessionClient } from '@expo/snapback-client';

export const SUPERVISED_EXCHANGE_FORMAT = 'snapback.expo-supervised-exchange.v1';
export const SUPERVISED_EXCHANGE_PATH = supervisedExchangePath();

function supervisedExchangePath() {
  // @ref LLP 0181#package-contract — release exports must not retain the supervised
  // endpoint vocabulary; production builds prune this branch (LLP 0176 G4).
  if (process.env.NODE_ENV !== 'production') {
    return '/_snapback/expo/v1/bootstrap';
  }
  return '';
}

function freezeRecord(value) {
  return Object.freeze({ ...value });
}

function diagnostic(code, message, details = {}) {
  return Object.freeze({
    schemaVersion: 'snapback.client-diagnostic.v1',
    code,
    severity: 'error',
    message,
    details: freezeRecord(details),
  });
}

function remediation(kind, description, precondition = {}) {
  return Object.freeze({
    kind,
    riskClass: 'mechanical',
    machineApplicable: false,
    requiresApproval: false,
    authorityEffect: 'none',
    precondition: freezeRecord(precondition),
    description,
  });
}

function codedError(code, message, details = {}, remediations = []) {
  const error = new Error(message);
  error.code = code;
  error.diagnostic = diagnostic(code, message, details);
  error.remediations = Object.freeze([...remediations]);
  return error;
}

function exactObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function nonEmptyString(value) {
  return typeof value === 'string' && value.length > 0;
}

function deviceLocalHostname(hostname) {
  // @ref LLP 0181#package-contract — release exports must not retain the supervised
  // endpoint vocabulary; production builds prune this branch (LLP 0176 G4).
  if (process.env.NODE_ENV !== 'production') {
    return hostname === 'localhost'
      || hostname === '[::1]'
      || hostname === '::1'
      || hostname === '10.0.2.2'
      || /^127(?:\.[0-9]{1,3}){3}$/u.test(hostname);
  }
  return false;
}

function exchangeOriginFromRuntime() {
  // @ref LLP 0181#package-contract — release exports must not retain the supervised
  // endpoint vocabulary; production builds prune this branch (LLP 0176 G4).
  if (process.env.NODE_ENV !== 'production') {
    const installed = globalThis.__SNAPBACK_EXPO_SUPERVISOR_ORIGIN__;
    if (nonEmptyString(installed)) return installed;
    if (
      typeof process !== 'undefined'
      && nonEmptyString(process.env?.EXPO_PUBLIC_SNAPBACK_SUPERVISOR_ORIGIN)
    ) return process.env.EXPO_PUBLIC_SNAPBACK_SUPERVISOR_ORIGIN;
  }
  return null;
}

function normalizedExchangeOrigin(explicit) {
  const candidate = explicit ?? exchangeOriginFromRuntime();
  if (!nonEmptyString(candidate)) return null;
  let parsed;
  try {
    parsed = new URL(candidate);
  } catch {
    throw codedError(
      'SNAPBACK_EXPO_BOOTSTRAP_ORIGIN_INVALID',
      'The supervised Expo bootstrap origin is not an absolute HTTP URL.',
      { origin: candidate },
    );
  }
  if (parsed.protocol !== 'http:' || !deviceLocalHostname(parsed.hostname)
    || parsed.username || parsed.password
    || parsed.pathname !== '/' || parsed.search || parsed.hash) {
    throw codedError(
      'SNAPBACK_EXPO_BOOTSTRAP_ORIGIN_INVALID',
      'The supervised Expo bootstrap origin must be a credential-free loopback or Android-emulator-alias HTTP origin.',
      { origin: candidate },
    );
  }
  return parsed.origin;
}

function bindingKey(binding) {
  return [
    binding?.descriptorIdentity,
    binding?.provenance?.supervisorGeneration,
    binding?.target?.origin,
  ].join('\u0000');
}

function authorityRequired(exchange) {
  const source = exchange?.authority;
  if (source?.status !== 'authority-required') return null;
  const projected = exactObject(source.diagnostic)
    ? source.diagnostic
    : diagnostic(
        'SNAPBACK_AUTHORITY_REQUIRED',
        'The supervised runtime did not provide an ordinary application session.',
        { cause: 'ordinary-session-unavailable' },
      );
  return Object.freeze({
    status: 'authority-required',
    diagnostic: projected,
    remediations: Object.freeze([...(source.remediations ?? [])]),
  });
}

function validateExchange(value) {
  if (
    !exactObject(value)
    || value.format !== SUPERVISED_EXCHANGE_FORMAT
    || !nonEmptyString(value.correlationId)
    || !exactObject(value.binding)
    || !exactObject(value.authority)
  ) {
    throw codedError(
      'SNAPBACK_EXPO_BOOTSTRAP_INVALID',
      'The local supervisor returned an invalid Expo bootstrap exchange.',
    );
  }
  if (value.authority.status === 'ready') {
    if (
      value.authority.tokenType !== 'Bearer'
      || !nonEmptyString(value.authority.token)
    ) {
      throw codedError(
        'SNAPBACK_EXPO_BOOTSTRAP_INVALID',
        'The local supervisor returned an invalid ordinary-session carrier.',
      );
    }
  } else if (value.authority.status !== 'authority-required') {
    throw codedError(
      'SNAPBACK_EXPO_BOOTSTRAP_INVALID',
      'The local supervisor returned an unknown authority bootstrap state.',
      { status: value.authority.status ?? null },
    );
  }
  return value;
}

function publicAuthorityFacts(session) {
  const authority = session?.authority;
  const descriptor = session?.authorityDescriptor;
  if (
    session?.activeMode !== 'sessions'
    || authority?.kind !== 'humanSession'
    || !nonEmptyString(authority.sessionId)
    || !nonEmptyString(authority.userId)
  ) {
    throw codedError(
      'SNAPBACK_AUTH_POLICY_UNAVAILABLE',
      'The supervised ordinary session did not resolve to settled Sessions authority.',
      { cause: 'sessions-auth-mode-unavailable' },
    );
  }
  return Object.freeze({
    kind: 'session',
    authMode: session.activeMode,
    sessionId: authority.sessionId,
    userId: authority.userId,
    authorizationStreamIncarnation:
      nonEmptyString(session.authorizationStreamIncarnation)
        ? session.authorizationStreamIncarnation
        : null,
    authorityInstanceId:
      nonEmptyString(descriptor?.authorityInstanceId) ? descriptor.authorityInstanceId : null,
    sessionGeneration:
      Number.isSafeInteger(descriptor?.sessionGeneration) ? descriptor.sessionGeneration : null,
  });
}

// @ref LLP 0181#provider — the common-path provider resolves its non-secret
// rendezvous from supervised runtime injection, then receives the AppBinding
// and ordinary session through one transient no-store exchange. Neither value
// is a component prop or persistent public configuration.
// @ref LLP 0176#security-claims-follow-reachability — this E1 carrier accepts
// only the supervisor-provided loopback origin; it does not infer or open a
// LAN/tunnel address.
export function createSupervisedExpoEnvironment({
  exchangeOrigin = null,
  fetch: fetchImplementation = globalThis.fetch,
  appState,
  resolveAppState,
  developmentSync,
  clientOptions = {},
  onDiagnostic,
} = {}) {
  const exchanges = new Map();
  let adopted = null;

  const fetchExchange = async (signal) => {
    const origin = normalizedExchangeOrigin(exchangeOrigin);
    if (origin === null) {
      throw codedError(
        'SNAPBACK_APP_BINDING_UNAVAILABLE',
        'No AppBinding delivery is installed. Start snapback dev --expo or use an admitted release build.',
        { seam: 'SnapbackExpoEnvironmentV1.resolveBinding' },
        [remediation(
          'startExpoSupervisor',
          'Start the supervised Expo development runtime, or build with an admitted release binding.',
          { bindingSource: 'unavailable' },
        )],
      );
    }
    if (typeof fetchImplementation !== 'function') {
      throw codedError(
        'SNAPBACK_EXPO_COMPATIBILITY_UNSUPPORTED',
        'This Expo runtime does not provide fetch for the local bootstrap exchange.',
      );
    }
    let response;
    try {
      response = await fetchImplementation(`${origin}${SUPERVISED_EXCHANGE_PATH}`, {
        method: 'GET',
        cache: 'no-store',
        headers: { accept: 'application/json' },
        signal,
      });
    } catch (cause) {
      const error = codedError(
        'SNAPBACK_EXPO_BOOTSTRAP_UNAVAILABLE',
        'The supervised Expo bootstrap exchange is unavailable.',
        { origin },
        [remediation(
          'restartExpoSupervisor',
          'Restart snapback dev --expo and reload the application.',
          { origin },
        )],
      );
      error.cause = cause;
      throw error;
    }
    if (!response.ok) {
      throw codedError(
        'SNAPBACK_EXPO_BOOTSTRAP_UNAVAILABLE',
        'The supervised Expo bootstrap exchange refused the request.',
        { origin, status: response.status },
      );
    }
    return validateExchange(await response.json());
  };

  const environment = {
    format: 'snapback.expo-environment.v1',
    ...(appState === undefined ? {} : { appState }),
    ...(resolveAppState === undefined ? {} : { resolveAppState }),
    ...(developmentSync === undefined ? {} : { developmentSync }),
    ...(onDiagnostic === undefined ? {} : { onDiagnostic }),
    async resolveBinding({ signal }) {
      const exchange = await fetchExchange(signal);
      exchanges.set(bindingKey(exchange.binding), exchange);
      return Object.freeze({
        binding: exchange.binding,
        admission: Object.freeze({
          productionCondition: false,
          delivery: Object.freeze({ channel: 'local-supervised-ipc' }),
        }),
      });
    },
    async adoptAuthority({ binding, signal }) {
      const key = bindingKey(binding);
      const exchange = exchanges.get(key) ?? await fetchExchange(signal);
      exchanges.delete(key);
      const required = authorityRequired(exchange);
      if (required) return required;
      if (bindingKey(exchange.binding) !== key) {
        throw codedError(
          'SNAPBACK_APP_BINDING_OVERRIDE_UNCONFIRMED',
          'The authority exchange did not match the admitted supervised binding.',
        );
      }
      const client = createExternalSessionClient(binding.target.origin, {
        ...clientOptions,
        bearerToken: exchange.authority.token,
        authorizedLeaseProtocol: 1,
        clientStoreId: clientOptions.clientStoreId
          ?? `snapback-expo-${binding.provenance.supervisorGeneration}`,
      });
      let facts;
      try {
        const session = await client.authSession({ force: true });
        facts = publicAuthorityFacts(session);
      } catch (error) {
        await client.replaceBearerToken(null).catch(() => {});
        await client.closeAuth?.().catch(() => {});
        throw error;
      }
      adopted = {
        binding,
        client,
        token: exchange.authority.token,
        publicFacts: facts,
      };
      return Object.freeze({
        status: 'ready',
        client,
        publicFacts: facts,
        async dispose() {
          if (adopted?.client === client) adopted = null;
          await client.replaceBearerToken(null).catch(() => {});
          await client.closeAuth?.().catch(() => {});
        },
      });
    },
    async refreshAuthority({ binding, signal }) {
      if (adopted === null || adopted.client === null) {
        throw codedError(
          'SNAPBACK_AUTHORITY_REQUIRED',
          'No supervised ordinary-session client is available for replacement.',
          { cause: 'ordinary-session-unavailable' },
        );
      }
      const exchange = await fetchExchange(signal);
      if (bindingKey(exchange.binding) !== bindingKey(binding)) {
        throw codedError(
          'SNAPBACK_APP_BINDING_EXPIRED',
          'The Expo supervisor generation changed; reload to admit its replacement binding.',
          {
            expectedSupervisorGeneration: binding.provenance.supervisorGeneration,
            observedSupervisorGeneration: exchange.binding?.provenance?.supervisorGeneration ?? null,
          },
        );
      }
      const required = authorityRequired(exchange);
      if (required) {
        await adopted.client.replaceBearerToken(null);
        adopted.token = null;
        adopted.publicFacts = null;
        return required;
      }
      try {
        if (exchange.authority.token !== adopted.token) {
          await adopted.client.replaceBearerToken(exchange.authority.token);
          adopted.token = exchange.authority.token;
        }
        const session = await adopted.client.authSession({ force: true });
        const facts = publicAuthorityFacts(session);
        adopted.publicFacts = facts;
        return Object.freeze({ status: 'ready', publicFacts: facts });
      } catch (error) {
        await adopted.client.replaceBearerToken(null).catch(() => {});
        adopted.token = null;
        adopted.publicFacts = null;
        throw error;
      }
    },
  };
  return Object.freeze(environment);
}

export function resolveSupervisedExpoExchangeOrigin() {
  return normalizedExchangeOrigin(null);
}
