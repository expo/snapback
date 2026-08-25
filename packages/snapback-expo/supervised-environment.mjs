import {
  SnapbackClient,
  createExternalSessionClient,
} from '@expo/snapback-client';
import {
  declaredDevCapabilityFromApp,
} from '@expo/snapback-client/app-client-internal';

import { createDefaultSupervisedBindingCache } from './supervised-binding-cache.mjs';
import {
  sanitizePublicDiagnostic,
  sanitizePublicRemediations,
} from './diagnostic-sanitization.mjs';
import {
  resolveDefaultExpoSqliteOperatingSystem,
  resolveDefaultExpoSqliteTarget,
} from './expo-sqlite-target.mjs';
import {
  supervisedRendezvousOriginFromRuntime,
} from './declared-dev-binding-internal.mjs';

export const SUPERVISED_EXCHANGE_FORMAT = 'snapback.expo-supervised-exchange.v1';
export const SUPERVISED_EXCHANGE_PATH = supervisedExchangePath();
export const SUPERVISED_DEV_IDENTITY_CHECKOUT_PATH = supervisedDevIdentityCheckoutPath();
export const SUPERVISED_DEV_IDENTITY_CHECKOUT_HEADER = supervisedDevIdentityCheckoutHeader();
export const SUPERVISED_DEV_IDENTITY_CHECKOUT_ENV = supervisedDevIdentityCheckoutEnvironment();

function supervisedExchangePath() {
  // @ref LLP 0181#package-contract — release exports must not retain the supervised
  // endpoint vocabulary; production builds prune this branch (LLP 0176 G4).
  if (process.env.NODE_ENV !== 'production') {
    return '/_snapback/expo/v1/bootstrap';
  }
  return '';
}

function supervisedDevIdentityCheckoutPath() {
  // @ref LLP 0262#d2-carriers-per-shipped-topology — production exports do
  // not retain the local native checkout endpoint vocabulary.
  if (process.env.NODE_ENV !== 'production') {
    return '/_snapback/expo/v1/dev-identity-checkout';
  }
  return '';
}

function supervisedDevIdentityCheckoutHeader() {
  if (process.env.NODE_ENV !== 'production') {
    return 'x-snapback-dev-identity-checkout';
  }
  return '';
}

function supervisedDevIdentityCheckoutEnvironment() {
  if (process.env.NODE_ENV !== 'production') {
    return 'SNAPBACK_EXPO_DEV_IDENTITY_CHECKOUT_NONCE';
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

function inferredRuntimePlatform() {
  if (globalThis.navigator?.product === 'ReactNative') return 'native';
  return 'web';
}

// @ref LLP 0262#d2-carriers-per-shipped-topology — only a native runtime may
// consume the process-local hook installed by the first-party native launch
// reader. The explicit launch-environment input remains a unit/witness seam,
// after the actual hook, and web ignores both carriers.
export function resolveSupervisedDevIdentityCheckoutNonce({
  runtimePlatform = inferredRuntimePlatform(),
  nativeLaunchEnvironment = null,
} = {}) {
  if (process.env.NODE_ENV === 'production' || runtimePlatform !== 'native') return null;
  const installed = globalThis.__SNAPBACK_EXPO_DEV_IDENTITY_CHECKOUT_NONCE__;
  if (nonEmptyString(installed)) return installed;
  const explicitWitness = nativeLaunchEnvironment?.[SUPERVISED_DEV_IDENTITY_CHECKOUT_ENV];
  return nonEmptyString(explicitWitness) ? explicitWitness : null;
}

function normalizedExchangeOrigin(explicit) {
  const candidate = explicit ?? supervisedRendezvousOriginFromRuntime();
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

const supervisedAdmission = () => Object.freeze({
  productionCondition: false,
  delivery: Object.freeze({ channel: 'local-supervised-ipc' }),
});

function authorityRequired(exchange) {
  const source = exchange?.authority;
  if (source?.status !== 'authority-required') return null;
  const projected = sanitizePublicDiagnostic(exactObject(source.diagnostic)
    ? source.diagnostic
    : diagnostic(
        'SNAPBACK_AUTHORITY_REQUIRED',
        'The supervised runtime did not provide an ordinary application session.',
        { cause: 'ordinary-session-unavailable' },
      ), {
    fallbackCode: 'SNAPBACK_AUTHORITY_REQUIRED',
    fallbackMessage: 'The supervised runtime did not provide an ordinary application session.',
  });
  return Object.freeze({
    status: 'authority-required',
    diagnostic: projected,
    remediations: sanitizePublicRemediations(source.remediations),
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
  } else if (!['authority-required', 'unavailable'].includes(value.authority.status)) {
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

function validCachedBindingRecord(record, app) {
  if (
    !exactObject(record)
    || record.formatVersion !== 1
    || !Number.isFinite(record.savedAt)
    || !exactObject(record.binding)
    || record.binding.format !== 'snapback.app-binding.v1'
    || record.binding.source !== 'supervised-dev'
    || !exactObject(record.publicFacts)
    || record.publicFacts.kind !== 'session'
    || !nonEmptyString(record.publicFacts.authMode)
  ) return null;
  const descriptorIdentity = app?.identity?.descriptor;
  if (
    nonEmptyString(descriptorIdentity)
    && record.binding.descriptorIdentity !== descriptorIdentity
  ) return null;
  return record;
}

async function clearClientAuthority(client) {
  if (typeof client?.replaceBearerToken === 'function') {
    try { await client.replaceBearerToken(null); } catch { /* best-effort custody release */ }
  }
  if (typeof client?.closeAuth === 'function') {
    try { await client.closeAuth(); } catch { /* best-effort client release */ }
  }
}

// @ref LLP 0181#provider — the common-path provider resolves its non-secret
// rendezvous from supervised runtime injection, then receives the AppBinding
// through a transient no-store exchange. Neither the binding nor any optional
// ordinary session is persistent public configuration.
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
  runtimePlatform,
  nativeLaunchEnvironment,
  resolveExpoSqliteReactNativeModule,
  resolveExpoDeviceModule,
  bindingCache = createDefaultSupervisedBindingCache(),
  onDiagnostic,
} = {}) {
  const exchanges = new Map();
  const offlineFallbacks = new Map();
  // @ref LLP 0151#shared-development-browser-adapter — the credential-free
  // shared-auth projection is retained separately from the one-shot authority
  // exchange, because the client reads it whenever it builds a provider
  // Adapter, not only at the moment authority settles.
  const sharedAuthProjections = new Map();
  let adopted = null;
  let devIdentityCapability = undefined;
  let devIdentityCapabilityPromise = null;
  let devIdentityCheckoutWarningLogged = false;

  const retainExchange = (key, exchange, signal) => {
    exchanges.set(key, exchange);
    if (signal?.aborted === true) {
      if (exchanges.get(key) === exchange) exchanges.delete(key);
      return;
    }
    signal?.addEventListener?.('abort', () => {
      if (exchanges.get(key) === exchange) exchanges.delete(key);
    }, { once: true });
  };

  const loadCachedBinding = async (app) => {
    // @ref LLP 0114#offline-binding-receipt-dated-amendment-2026-08-01 — the
    // supervised fallback only gets boot to the existing digest-bound client
    // receipt owner; it does not replace that owner's complete admission.
    if (process.env.NODE_ENV !== 'production' && typeof bindingCache?.load === 'function') {
      try {
        return validCachedBindingRecord(await bindingCache.load(), app);
      } catch {
        return null;
      }
    }
    return null;
  };

  const saveCachedBinding = (binding, publicFacts) => {
    if (process.env.NODE_ENV !== 'production' && typeof bindingCache?.save === 'function') {
      let saving;
      try {
        saving = bindingCache.save(Object.freeze({
          formatVersion: 1,
          binding,
          publicFacts,
          savedAt: Date.now(),
        }));
      } catch {
        return;
      }
      void Promise.resolve(saving).catch(() => {});
    }
  };

  const fetchExchange = async (signal, { requestAuthority = false } = {}) => {
    const origin = normalizedExchangeOrigin(exchangeOrigin);
    if (origin === null) {
      throw codedError(
        'SNAPBACK_APP_BINDING_UNAVAILABLE',
        'No AppBinding delivery is installed. Start snapback dev --expo, pass the url option with a development-generated app, or use an admitted release build.',
        { seam: 'SnapbackExpoEnvironmentV1.resolveBinding', urlOption: 'url' },
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
      const exchangeUrl = requestAuthority
        ? `${origin}${SUPERVISED_EXCHANGE_PATH}?authority=mint`
        : `${origin}${SUPERVISED_EXCHANGE_PATH}`;
      response = await fetchImplementation(exchangeUrl, {
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

  const logConsumedCheckoutOnce = (status) => {
    if (devIdentityCheckoutWarningLogged) return;
    devIdentityCheckoutWarningLogged = true;
    const warning = Object.freeze({
      schemaVersion: 'snapback.client-diagnostic.v1',
      code: 'SNAPBACK_EXPO_NATIVE_CHECKOUT_UNAVAILABLE',
      severity: 'warning',
      message: 'Native dev-identity checkout was unavailable; continuing with the ordinary supervised session.',
      details: Object.freeze({
        cause: 'checkout-consumed-or-refused',
        status,
      }),
    });
    try {
      if (typeof onDiagnostic === 'function') onDiagnostic(warning);
      else globalThis.console?.warn?.(`[warning] ${warning.code}: ${warning.message}`);
    } catch {
      // Local diagnostics are observational and cannot disturb adoption.
    }
  };

  const resolveDevIdentityCapability = (signal) => {
    if (devIdentityCapability !== undefined) return Promise.resolve(devIdentityCapability);
    if (devIdentityCapabilityPromise !== null) return devIdentityCapabilityPromise;
    let resolvedCheckoutNonce;
    try {
      resolvedCheckoutNonce = resolveSupervisedDevIdentityCheckoutNonce({
        ...(runtimePlatform === undefined ? {} : { runtimePlatform }),
        ...(nativeLaunchEnvironment === undefined ? {} : { nativeLaunchEnvironment }),
      });
    } catch {
      // A malformed host bridge remains optional enrichment. Keep the slot
      // empty so a later lifecycle attempt can retry after host repair.
      return Promise.resolve(null);
    }
    if (resolvedCheckoutNonce === null) {
      devIdentityCapability = null;
      return Promise.resolve(null);
    }
    let checkoutNonce = resolvedCheckoutNonce;
    const attempt = (async () => {
      try {
        const origin = normalizedExchangeOrigin(exchangeOrigin);
        if (origin === null || typeof fetchImplementation !== 'function') return null;
        const response = await fetchImplementation(`${origin}${SUPERVISED_DEV_IDENTITY_CHECKOUT_PATH}`, {
          method: 'POST',
          cache: 'no-store',
          headers: {
            accept: 'application/json',
            [SUPERVISED_DEV_IDENTITY_CHECKOUT_HEADER]: checkoutNonce,
          },
          signal,
        });
        if (response.status === 403) {
          devIdentityCapability = null;
          logConsumedCheckoutOnce(response.status);
          return null;
        }
        if (!response.ok) return null;
        let payload;
        try {
          payload = await response.json();
        } catch {
          // A body-read abort/failure remains retryable. If the server already
          // consumed the one-shot, the retry will receive the definitive 403
          // handled above and become a permanent sessions-only result.
          return null;
        }
        if (
          payload?.ok === true
          && nonEmptyString(payload.devIdentityCapability)
          && payload.devIdentityCapability.startsWith('sbdev_')
        ) {
          devIdentityCapability = payload.devIdentityCapability;
          return devIdentityCapability;
        }
        // A successful checkout response with an invalid capability has
        // consumed the one-shot. Do not retry it for this JS boot; keep the
        // ordinary supervised session and report the local degradation once
        // without projecting nonce or bearer bytes.
        devIdentityCapability = null;
        logConsumedCheckoutOnce(response.status);
        return null;
      } catch {
        // Abort and transport failures cannot outrank the ordinary supervised
        // session. Leave the fulfilled cache unset so a later lifecycle call
        // may retry the same startup nonce.
        return null;
      } finally {
        checkoutNonce = null;
      }
    })();
    devIdentityCapabilityPromise = attempt;
    void attempt.then(() => {
      if (devIdentityCapabilityPromise === attempt) devIdentityCapabilityPromise = null;
    });
    return attempt;
  };

  const clientOptionsWithDevIdentity = async (signal) => {
    const capability = await resolveDevIdentityCapability(signal);
    return capability === null
      ? clientOptions
      : { ...clientOptions, devIdentityCapability: capability };
  };

  const environment = {
    format: 'snapback.expo-environment.v1',
    ...(appState === undefined ? {} : { appState }),
    ...(resolveAppState === undefined ? {} : { resolveAppState }),
    ...(developmentSync === undefined ? {} : { developmentSync }),
    ...(onDiagnostic === undefined ? {} : { onDiagnostic }),
    resolveExpoSqliteOperatingSystem() {
      return resolveDefaultExpoSqliteOperatingSystem({
        resolveReactNativeModule: resolveExpoSqliteReactNativeModule,
      });
    },
    async resolveExpoSqliteTarget() {
      const operatingSystem = await resolveDefaultExpoSqliteOperatingSystem({
        resolveReactNativeModule: resolveExpoSqliteReactNativeModule,
      });
      return resolveDefaultExpoSqliteTarget({
        operatingSystem,
        resolveReactNativeModule: resolveExpoSqliteReactNativeModule,
        resolveExpoDeviceModule,
      });
    },
    resolveDevIdentityCapability({ signal } = {}) {
      return resolveDevIdentityCapability(signal);
    },
    async resolveBinding({ app, signal }) {
      let exchange;
      try {
        exchange = await fetchExchange(signal);
      } catch (error) {
        if (error?.code !== 'SNAPBACK_EXPO_BOOTSTRAP_UNAVAILABLE') throw error;
        if (declaredDevCapabilityFromApp(app) !== null) throw error;
        const cached = await loadCachedBinding(app);
        if (cached === null) throw error;
        offlineFallbacks.set(bindingKey(cached.binding), cached);
        return Object.freeze({
          binding: cached.binding,
          admission: Object.freeze({
            productionCondition: false,
            delivery: Object.freeze({ channel: 'local-supervised-ipc' }),
          }),
        });
      }
      offlineFallbacks.delete(bindingKey(exchange.binding));
      retainExchange(bindingKey(exchange.binding), exchange, signal);
      if (exchange.sharedAuth !== undefined) {
        sharedAuthProjections.set(bindingKey(exchange.binding), exchange.sharedAuth);
      }
      return Object.freeze({
        binding: exchange.binding,
        admission: supervisedAdmission(),
      });
    },
    /**
     * The supervisor's shared development auth projection for one binding, or
     * null when this supervisor published none. Credential-free by
     * construction; a cached offline binding has no projection at all.
     */
    resolveSharedDevelopmentAuth({ binding }) {
      return sharedAuthProjections.get(bindingKey(binding)) ?? null;
    },
    async resolveSupervisedAuthority({ binding, signal, refresh = false }) {
      const key = bindingKey(binding);
      const cached = offlineFallbacks.get(key);
      if (cached !== undefined) {
        // A persisted binding receipt carries no bearer. LLP 0258 bootstrap
        // can still settle its own anonymous/restored authority and prepare
        // retained state; absence of an ambient mint is not boot failure.
        return Object.freeze({ status: 'unavailable' });
      }
      // @ref LLP 0300#p4--the-dev-session-becomes-explicit — the binding-only
      // exchange retains an unavailable marker; reaching this explicit
      // authority resolver is what asks the supervisor to mint on demand.
      const retained = exchanges.get(key);
      const exchange = refresh || retained?.authority?.status === 'unavailable'
        ? await fetchExchange(signal, { requestAuthority: true })
        : retained ?? await fetchExchange(signal, { requestAuthority: true });
      if (retained === exchange) exchanges.delete(key);
      if (bindingKey(exchange.binding) !== key) {
        throw codedError(
          refresh ? 'SNAPBACK_APP_BINDING_EXPIRED' : 'SNAPBACK_APP_BINDING_OVERRIDE_UNCONFIRMED',
          refresh
            ? 'The Expo supervisor generation changed; reload to admit its replacement binding.'
            : 'The authority exchange did not match the admitted supervised binding.',
        );
      }
      const required = authorityRequired(exchange);
      if (required) return Object.freeze({
        ...required,
        binding: exchange.binding,
        admission: supervisedAdmission(),
      });
      if (exchange.authority.status === 'unavailable') {
        return Object.freeze({ status: 'unavailable' });
      }
      const devIdentityCapability = await resolveDevIdentityCapability(signal);
      return Object.freeze({
        status: 'ready',
        bearer: exchange.authority.token,
        ...(devIdentityCapability === null
          ? {}
          : { clientOptions: Object.freeze({ devIdentityCapability }) }),
        binding: exchange.binding,
        admission: supervisedAdmission(),
        // Supervisor events own remint; this explicit custody fact means the
        // borrowed carrier remains current until that next event.
        refreshAfterMs: Number.MAX_SAFE_INTEGER,
      });
    },
    async adoptAuthority({ binding, signal, rqsStore }) {
      const key = bindingKey(binding);
      const storedExchange = exchanges.get(key);
      const cached = storedExchange === undefined ? offlineFallbacks.get(key) : null;
      if (cached !== null && cached !== undefined) {
        offlineFallbacks.delete(key);
        const client = new SnapbackClient(binding.target.origin, {
          ...clientOptions,
          bearerToken: null,
          clientStoreId: clientOptions.clientStoreId
            ?? `snapback-expo-${binding.provenance.supervisorGeneration}`,
          rqsStore: Object.hasOwn(clientOptions, 'rqsStore')
            ? clientOptions.rqsStore
            : rqsStore,
        });
        adopted = {
          binding,
          client,
          token: null,
          publicFacts: cached.publicFacts,
          offline: true,
        };
        return Object.freeze({
          status: 'ready',
          client,
          publicFacts: cached.publicFacts,
          offline: true,
          async dispose() {
            if (adopted?.client === client) adopted = null;
            await clearClientAuthority(client);
          },
        });
      }
      const exchange = storedExchange?.authority?.status === 'unavailable'
        ? await fetchExchange(signal, { requestAuthority: true })
        : storedExchange ?? await fetchExchange(signal, { requestAuthority: true });
      exchanges.delete(key);
      const required = authorityRequired(exchange);
      if (required) return required;
      if (bindingKey(exchange.binding) !== key) {
        throw codedError(
          'SNAPBACK_APP_BINDING_OVERRIDE_UNCONFIRMED',
          'The authority exchange did not match the admitted supervised binding.',
        );
      }
      const resolvedClientOptions = await clientOptionsWithDevIdentity(signal);
      const client = createExternalSessionClient(binding.target.origin, {
        ...resolvedClientOptions,
        bearerToken: exchange.authority.token,
        authorizedLeaseProtocol: 1,
        clientStoreId: resolvedClientOptions.clientStoreId
          ?? `snapback-expo-${binding.provenance.supervisorGeneration}`,
        rqsStore: Object.hasOwn(resolvedClientOptions, 'rqsStore')
          ? resolvedClientOptions.rqsStore
          : rqsStore,
      });
      let facts;
      try {
        const session = await client.authSession({ force: true });
        facts = publicAuthorityFacts(session);
      } catch (error) {
        await clearClientAuthority(client);
        throw error;
      }
      adopted = {
        binding,
        client,
        token: exchange.authority.token,
        publicFacts: facts,
        offline: false,
      };
      saveCachedBinding(exchange.binding, facts);
      return Object.freeze({
        status: 'ready',
        client,
        publicFacts: facts,
        async dispose() {
          if (adopted?.client === client) adopted = null;
          await clearClientAuthority(client);
        },
      });
    },
    async refreshAuthority({ binding, signal, admitBinding }) {
      if (adopted === null || adopted.client === null) {
        throw codedError(
          'SNAPBACK_AUTHORITY_REQUIRED',
          'No supervised ordinary-session client is available for replacement.',
          { cause: 'ordinary-session-unavailable' },
        );
      }
      const exchange = await fetchExchange(signal, { requestAuthority: true });
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
      if (typeof admitBinding !== 'function') {
        throw codedError(
          'SNAPBACK_EXPO_ENVIRONMENT_INVALID',
          'Supervised authority refresh requires the provider binding-admission callback.',
        );
      }
      const refreshedBinding = await admitBinding(exchange.binding, supervisedAdmission());
      const required = authorityRequired(exchange);
      if (required) {
        if (typeof adopted.client.replaceBearerToken === 'function') {
          await adopted.client.replaceBearerToken(null);
        }
        adopted.token = null;
        adopted.publicFacts = null;
        return required;
      }
      try {
        if (exchange.authority.token !== adopted.token) {
          if (typeof adopted.client.replaceBearerToken !== 'function') {
            throw codedError(
              'SNAPBACK_EXPO_COMPATIBILITY_UNSUPPORTED',
              'The adopted Snapback client cannot replace ordinary-session authority.',
            );
          }
          await adopted.client.replaceBearerToken(exchange.authority.token);
          adopted.token = exchange.authority.token;
        }
        const session = await adopted.client.authSession({ force: true });
        const facts = publicAuthorityFacts(session);
        adopted.binding = refreshedBinding;
        adopted.publicFacts = facts;
        adopted.offline = false;
        saveCachedBinding(refreshedBinding, facts);
        return Object.freeze({
          status: 'ready',
          publicFacts: facts,
          binding: refreshedBinding,
          admission: supervisedAdmission(),
        });
      } catch (error) {
        if (typeof adopted.client.replaceBearerToken === 'function') {
          try { await adopted.client.replaceBearerToken(null); } catch { /* preserve refresh error */ }
        }
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
