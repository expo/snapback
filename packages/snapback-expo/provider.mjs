import React, {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useSyncExternalStore,
} from 'react';

import {
  bindSnapbackAppLifecycle,
} from '@expo/snapback-client';
import {
  adoptSupervisedBootstrapAuthority,
  createProviderValidatedExpoNativePlatform,
  createSnapbackAppClientWithBootstrapObserver,
  declaredDevCapabilityFromApp,
} from '@expo/snapback-client/app-client-internal';
import { createAssetClient } from '@expo/snapback-client/assets';
import {
  SnapbackProvider,
  createSnapbackReactProvider,
} from '@expo/snapback-react';

import {
  admitAppBindingV1,
  isAppBindingDiagnostic,
  publicBindingFacts,
} from './app-binding.mjs';
import {
  createSupervisedExpoEnvironment,
} from './supervised-environment.mjs';
import {
  sanitizePublicDiagnostic,
  sanitizePublicRemediations,
} from './diagnostic-sanitization.mjs';
import {
  adaptExpoAssetSource,
  expoAssetFetch,
} from './asset-source.mjs';
import { resolveSnapbackExpoLifecycleSource } from './lifecycle-source.mjs';
import { acquireExpoSqliteDefaultRqsStore } from './expo-sqlite-carrier.mjs';
import {
  createExpoCryptoSha256DigestAdapter,
  expoCryptoDigestModuleUnavailable,
} from './expo-crypto-digest.mjs';
import {
  createDeclaredDevBindingCandidate,
  supervisedRendezvousConfiguredFromRuntime,
} from './declared-dev-binding-internal.mjs';

const bootContext = createContext(null);
const lifecycleContext = createContext(null);
let bootSequence = 0;

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

function normalizedDiagnostic(error, correlationId) {
  const source = error?.diagnostic;
  const base = source?.schemaVersion === 'snapback.client-diagnostic.v1'
    ? source
    : diagnostic(
        error?.code ?? 'SNAPBACK_EXPO_BOOT_FAILED',
        error instanceof Error ? error.message : String(error),
      );
  return sanitizePublicDiagnostic(base, {
    fallbackCode: 'SNAPBACK_EXPO_BOOT_FAILED',
    fallbackMessage: 'Expo application bootstrap failed.',
    correlationId,
  });
}

function productionCondition() {
  /* global __DEV__ */
  if (typeof __DEV__ === 'boolean') return __DEV__ === false;
  return typeof process !== 'undefined' && process.env?.NODE_ENV === 'production';
}

const APPLICATION_AUTH_BOOTSTRAP_FORMAT = 'snapback.application-auth-bootstrap.v1';
export const APPLICATION_AUTH_BOOTSTRAP_CAPABILITY = 'auth.application-bootstrap.v1';

// @ref LLP 0258#d3-custody-is-selected-by-capability-never-convenience-fallback
// — Android and iOS admission are frozen to the qualifying receipts at
// demos/native-custody-probes/evidence/20260816T214639Z-0a6c91ed-phase2-android;
// demos/native-custody-probes/evidence/20260817T023429Z-1c2624fb-phase2-ios.
const QUALIFIED_NATIVE_AUTH_CUSTODY_OSES = Object.freeze(['android', 'ios']);

const NATIVE_AUTH_CUSTODY_PACKAGE = '@expo/snapback-expo-custody';
const NATIVE_AUTH_CUSTODY_SENTINEL = Object.freeze({
  kind: 'expo-native-phase-2-evidence-required',
});

function causeCode(cause, fallback = null) {
  const observed = cause?.diagnostic?.code ?? cause?.code;
  return typeof observed === 'string' && observed.length > 0 ? observed : fallback;
}

function durableCustodyUnavailable(cause) {
  const error = new Error(
    'The generated policy requires native durable custody, but the optional custody module is unavailable.',
  );
  error.code = 'SNAPBACK_AUTH_CUSTODY_DURABLE_UNAVAILABLE';
  error.diagnostic = diagnostic(error.code, error.message, {
    package: NATIVE_AUTH_CUSTODY_PACKAGE,
    causeCode: causeCode(cause),
  });
  return error;
}

async function resolveNativeOperatingSystem(environment) {
  if (typeof environment.resolveNativeAuthCustodyOperatingSystem === 'function') {
    return environment.resolveNativeAuthCustodyOperatingSystem();
  }
  if (typeof require !== 'function') return 'unknown';
  try {
    // Expo's own optional DOM/webview loaders use a literal require inside a
    // try block. Expo Metro enables allowOptionalDependencies, so this shape
    // keeps an omitted peer out of non-native graphs while native app closures
    // resolve the peer they already ship.
    return require('react-native')?.Platform?.OS ?? 'unknown';
  } catch {
    return 'unknown';
  }
}

async function resolveNativeAuthDigestAdapter(environment) {
  let digestModule;
  try {
    if (typeof environment.resolveNativeAuthDigestModule === 'function') {
      digestModule = await environment.resolveNativeAuthDigestModule();
    } else if (typeof require === 'function') {
      // @ref LLP 0181#metro-and-package-closure — the literal guarded require
      // keeps Expo's native module in the packed Metro graph without making
      // the universal client package import an Expo-only dependency.
      digestModule = require('expo-crypto');
    } else {
      const error = new Error('native digest package resolution is unavailable');
      error.code = 'ERR_MODULE_NOT_FOUND';
      throw error;
    }
    return createExpoCryptoSha256DigestAdapter(digestModule);
  } catch (cause) {
    if (cause?.code === 'SNAPBACK_AUTH_BOOTSTRAP_DIGEST_MODULE_UNAVAILABLE') throw cause;
    throw expoCryptoDigestModuleUnavailable(cause);
  }
}

async function resolveExpoSqliteRuntimeKind(environment) {
  if (typeof environment.resolveExpoSqliteRuntimeKind === 'function') {
    const kind = await environment.resolveExpoSqliteRuntimeKind();
    return typeof kind === 'string' && kind.length > 0 ? kind : 'unsupported-host';
  }
  return 'main-app';
}

function firstPartyBootstrapOptIn(app) {
  // @ref LLP 0258#compatibility-and-migration — the v1 policy plus one ordinary
  // descriptor requirement is the least-invasive capability-gated opt-in.
  // Descriptors/bindings that do not require+offer this capability retain LLP
  // 0181's legacy supervised client byte-for-byte.
  return app?.authBootstrap?.format === APPLICATION_AUTH_BOOTSTRAP_FORMAT
    && app?.capabilities?.required?.includes(APPLICATION_AUTH_BOOTSTRAP_CAPABILITY);
}

async function resolveAppClientPlatform(environment, app) {
  if (typeof environment.resolveAppClientPlatform === 'function') {
    return environment.resolveAppClientPlatform({ app });
  }
  if (globalThis.indexedDB?.open) return Object.freeze({ kind: 'expo-web' });
  const operatingSystem = await resolveNativeOperatingSystem(environment);
  if (app.authBootstrap.custody === 'volatile-explicit') {
    return QUALIFIED_NATIVE_AUTH_CUSTODY_OSES.includes(operatingSystem)
      ? Object.freeze({
          kind: 'memory',
          digestAdapter: await resolveNativeAuthDigestAdapter(environment),
        })
      : Object.freeze({ kind: 'memory', cryptoObject: globalThis.crypto });
  }
  if (!QUALIFIED_NATIVE_AUTH_CUSTODY_OSES.includes(operatingSystem)) {
    return NATIVE_AUTH_CUSTODY_SENTINEL;
  }
  let authCustodyStorage;
  let authCustodyGrade;
  try {
    let custodyModule;
    if (typeof environment.resolveNativeAuthCustodyModule === 'function') {
      custodyModule = await environment.resolveNativeAuthCustodyModule();
    } else if (typeof require === 'function') {
      // Keep this literal in the same guarded shape: Metro can bundle when the
      // optional package is omitted, web never executes the native branch, and
      // Expo Go's installed JS package can fail below as a typed native-unlinked
      // refusal instead of crashing provider import.
      custodyModule = require('@expo/snapback-expo-custody');
    } else {
      const error = new Error('native custody package resolution is unavailable');
      error.code = 'ERR_MODULE_NOT_FOUND';
      throw error;
    }
    const createNativeAuthCustodyStorage = custodyModule?.createNativeAuthCustodyStorage
      ?? custodyModule?.default?.createNativeAuthCustodyStorage;
    if (typeof createNativeAuthCustodyStorage !== 'function') {
      const error = new TypeError(
        'The optional native custody module does not expose createNativeAuthCustodyStorage().',
      );
      error.code = 'SNAPBACK_AUTH_CUSTODY_MODULE_INVALID';
      throw error;
    }
    authCustodyStorage = createNativeAuthCustodyStorage();
    authCustodyGrade = await authCustodyStorage.platformGrade();
  } catch (cause) {
    throw durableCustodyUnavailable(cause);
  }
  if (
    authCustodyGrade?.os !== operatingSystem
    || !QUALIFIED_NATIVE_AUTH_CUSTODY_OSES.includes(authCustodyGrade.os)
    || authCustodyGrade?.grade !== 'single-runtime'
  ) return NATIVE_AUTH_CUSTODY_SENTINEL;
  const digestAdapter = await resolveNativeAuthDigestAdapter(environment);
  return createProviderValidatedExpoNativePlatform({
    authCustodyStorage,
    authCustodyGrade,
    digestAdapter,
  });
}

function canonicalJson(value) {
  return JSON.stringify(value, (_key, child) => (
    child && typeof child === 'object' && !Array.isArray(child)
      ? Object.fromEntries(Object.keys(child).sort().map((key) => [key, child[key]]))
      : child
  ));
}

function publicAuthorityFacts(input) {
  if (
    input === null
    || typeof input !== 'object'
    || Array.isArray(input)
    || input.kind !== 'session'
    || typeof input.authMode !== 'string'
    || input.authMode.length === 0
  ) return null;
  const facts = {
    kind: 'session',
    authMode: input.authMode,
    sessionId: typeof input.sessionId === 'string' ? input.sessionId : null,
    userId: typeof input.userId === 'string' ? input.userId : null,
    authorizationStreamIncarnation:
      typeof input.authorizationStreamIncarnation === 'string'
        ? input.authorizationStreamIncarnation
        : null,
    authorityInstanceId:
      typeof input.authorityInstanceId === 'string' ? input.authorityInstanceId : null,
    sessionGeneration:
      Number.isSafeInteger(input.sessionGeneration) ? input.sessionGeneration : null,
  };
  return Object.freeze(facts);
}

function authorityRequiredState(error, correlationId, remediations = []) {
  const projected = normalizedDiagnostic(error, correlationId);
  const cause = projected.code === 'SNAPBACK_AUTH_POLICY_UNAVAILABLE'
    ? 'sessions-auth-mode-unavailable'
    : projected.details?.cause ?? 'ordinary-session-unavailable';
  return Object.freeze({
    status: 'authority-required',
    diagnostic: diagnostic(projected.code, projected.message, {
      ...projected.details,
      cause,
    }),
    remediations: sanitizePublicRemediations(remediations),
  });
}

function errorState(error, correlationId) {
  const value = normalizedDiagnostic(error, correlationId);
  const unsupportedCodes = new Set([
    'SNAPBACK_APP_BINDING_CAPABILITY_MISMATCH',
    'SNAPBACK_APP_BINDING_FORMAT_UNSUPPORTED',
    'SNAPBACK_APP_BINDING_SOURCE_UNSUPPORTED',
    'SNAPBACK_EXPO_COMPATIBILITY_UNSUPPORTED',
    'SNAPBACK_AUTH_BOOTSTRAP_DIGEST_MODULE_UNAVAILABLE',
  ]);
  return Object.freeze({
    status: unsupportedCodes.has(value.code) ? 'unsupported' : 'error',
    diagnostic: value,
    remediations: sanitizePublicRemediations(error?.remediations),
  });
}

export const defaultSnapbackExpoEnvironment = createSupervisedExpoEnvironment();

// @ref LLP 0181#provider — the controller exposes exactly the RFC boot-state
// union. Binding, authority, and client preparation are distinct stages; no
// missing authority path is converted to anonymous success.
// @ref LLP 0176#one-owner-many-projections — client preparation and React
// provider construction call the existing package owners instead of creating
// an Expo cache, sync transport, or auth model.
export function createSnapbackExpoBoot(options = {}) {
  if (Object.hasOwn(options, 'declaredDev') || Object.hasOwn(options, 'declaredDevCapability')) {
    const error = new Error('The declared-dev capability is accepted only from the imported generated app object.');
    error.code = 'SNAPBACK_APP_BINDING_DECLARED_DEV_REFUSED';
    throw error;
  }
  const {
    app,
    binding: bindingOverride = null,
    url = undefined,
    rqsStore = undefined,
    environment = defaultSnapbackExpoEnvironment,
    createProvider = createSnapbackReactProvider,
    bindLifecycle = bindSnapbackAppLifecycle,
    createApplicationClient = createSnapbackAppClientWithBootstrapObserver,
    adoptSupervisedAuthority = adoptSupervisedBootstrapAuthority,
    acquireDefaultRqsStore = acquireExpoSqliteDefaultRqsStore,
    now = () => Date.now(),
  } = options;
  const correlationId = `snapback-expo-boot-${++bootSequence}`;
  let state = Object.freeze({ status: 'starting', stage: 'binding' });
  let started = false;
  let disposed = false;
  let startPromise = null;
  let reactProvider = null;
  let lifecycle = null;
  let lifecycleSource = null;
  let authorityDisposer = null;
  let applicationClient = null;
  let bootstrapUnsubscribe = null;
  let admittedBinding = null;
  let admittedBindingFacts = null;
  let authorityFacts = null;
  let preparation = null;
  let refreshPromise = null;
  let cleanupPromise = null;
  let disposePromise = null;
  let admittedBindingAdmission = null;
  let rqsStoreLease = null;
  let resolvedRqsStore = rqsStore;
  const listeners = new Set();
  const controller = new AbortController();

  const emitSourceDiagnostic = (message, details) => {
    try {
      environment.onDiagnostic?.(Object.freeze({
        schemaVersion: 'snapback.client-debug-event.v1',
        event: 'snapback.declared-dev-url-ignored',
        severity: 'debug',
        message,
        details: Object.freeze({ ...details }),
      }));
    } catch {
      // Source selection diagnostics are observational.
    }
  };

  const abortReason = () => controller.signal.reason
    ?? Object.assign(new Error('Expo application bootstrap was aborted.'), { name: 'AbortError' });

  const awaitBoundary = (value, disposeLateValue = null) => {
    if (controller.signal.aborted) return Promise.reject(abortReason());
    const pending = Promise.resolve(value);
    return new Promise((resolve, reject) => {
      let aborted = false;
      const onAbort = () => {
        aborted = true;
        controller.signal.removeEventListener('abort', onAbort);
        reject(abortReason());
      };
      controller.signal.addEventListener('abort', onAbort, { once: true });
      pending.then(
        (result) => {
          controller.signal.removeEventListener('abort', onAbort);
          if (aborted) {
            try { void Promise.resolve(disposeLateValue?.(result)).catch(() => {}); } catch { /* abort owns outcome */ }
            return;
          }
          resolve(result);
        },
        (error) => {
          controller.signal.removeEventListener('abort', onAbort);
          if (!aborted) reject(error);
        },
      );
    });
  };

  const admitBindingCandidate = (candidate, admission = {}, mode = 'resolved') => (
    admitAppBindingV1(candidate, app, {
      mode,
      now: now(),
      productionCondition:
        admission.productionCondition ?? productionCondition(),
      delivery: admission.delivery,
      generatedReleaseTargets: admission.generatedReleaseTargets,
      confirmSupervisedIssuance: admission.confirmSupervisedIssuance,
      verifySignedArtifact: admission.verifySignedArtifact,
      verifyBuildReceipt: admission.verifyBuildReceipt,
    })
  );

  const publish = (next) => {
    if (disposed) return;
    state = next;
    for (const listener of [...listeners]) {
      try { listener(); } catch { /* observation never owns boot */ }
    }
  };

  const cleanup = () => cleanupPromise ??= (async () => {
    try { lifecycle?.dispose?.(); } catch { /* diagnostics are already projected */ }
    lifecycle = null;
    if (reactProvider) {
      try { await reactProvider.dispose(); } catch { /* diagnostics are already projected */ }
      reactProvider = null;
    }
    if (authorityDisposer) {
      try { await authorityDisposer(); } catch { /* authority owner retains diagnostics */ }
      authorityDisposer = null;
    }
    bootstrapUnsubscribe?.();
    bootstrapUnsubscribe = null;
    if (applicationClient) {
      try { await applicationClient.dispose(); } catch { /* bootstrap owner retains diagnostics */ }
      applicationClient = null;
    }
    if (rqsStoreLease) {
      try { await rqsStoreLease.release(); } catch { /* store refusal is already reported */ }
      rqsStoreLease = null;
    }
  })();

  const projectApplicationBootstrap = () => {
    // @ref LLP 0258#d7-bootstrap-state-is-construction-truth-not-auth-truth — retain the
    // app owner's closed snapshot and add only LLP 0181 binding/preparation
    // facts to its ready arm.
    const bootstrap = applicationClient.bootstrapState();
    return bootstrap.status === 'ready'
      ? Object.freeze({
          ...bootstrap,
          binding: admittedBindingFacts,
          preparation,
        })
      : bootstrap;
  };

  const run = async () => {
    try {
      if (environment?.format !== 'snapback.expo-environment.v1'
        || typeof environment.resolveBinding !== 'function'
        || typeof environment.adoptAuthority !== 'function') {
        const error = new TypeError('environment must implement SnapbackExpoEnvironmentV1');
        error.code = 'SNAPBACK_EXPO_ENVIRONMENT_INVALID';
        throw error;
      }
      const declaredDevCapability = declaredDevCapabilityFromApp(app);
      if (app?.declaredDev !== undefined && app.declaredDev !== null && declaredDevCapability === null) {
        const error = new Error('The declared-dev capability is not installed on this exact generated app object.');
        error.code = 'SNAPBACK_APP_BINDING_DECLARED_DEV_REFUSED';
        throw error;
      }
      const rendezvousConfigured = declaredDevCapability !== null
        && supervisedRendezvousConfiguredFromRuntime();
      const hasRealUrl = url !== undefined && url !== null && url !== '';
      let resolution;
      if (
        bindingOverride === null
        && declaredDevCapability !== null
        && !rendezvousConfigured
        && hasRealUrl
      ) {
        resolution = Object.freeze({
          binding: createDeclaredDevBindingCandidate(app, url),
          admission: Object.freeze({ productionCondition: false }),
        });
      } else {
        if (declaredDevCapability === null && hasRealUrl) {
          emitSourceDiagnostic(
            'The generated app has no declared-dev capability; the url option is ignored for source selection.',
            { selectedSource: 'existing-binding-resolution', ignoredUrl: url },
          );
        }
        resolution = await awaitBoundary(environment.resolveBinding(Object.freeze({
          app,
          bindingOverride,
          signal: controller.signal,
          url,
        })));
        if (
          declaredDevCapability !== null
          && hasRealUrl
          && resolution?.binding?.source === 'supervised-dev'
        ) {
          emitSourceDiagnostic(
            'The supervised rendezvous completed; its binding is selected and the url option is ignored.',
            { selectedSource: 'supervised-dev', ignoredUrl: url },
          );
        }
      }
      if (!resolution || typeof resolution !== 'object' || !resolution.binding) {
        const error = new Error('binding resolver returned no AppBinding admission candidate');
        error.code = 'SNAPBACK_APP_BINDING_UNAVAILABLE';
        throw error;
      }
      if (
        bindingOverride !== null
        && canonicalJson(resolution.binding) !== canonicalJson(bindingOverride)
      ) {
        const error = new Error('binding resolver substituted a different binding for the explicit override');
        error.code = 'SNAPBACK_APP_BINDING_OVERRIDE_UNCONFIRMED';
        throw error;
      }
      const admission = resolution.admission ?? {};
      admittedBinding = await awaitBoundary(admitBindingCandidate(
        resolution.binding,
        admission,
        bindingOverride === null ? 'resolved' : 'override',
      ));
      admittedBindingAdmission = admission;
      if (disposed) return state;

      // Binding supplies the canonical origin. Acquire the provider default
      // only after that point and before either client-construction branch;
      // explicit stores (including null) bypass all native module loading.
      if (rqsStore === undefined) {
        const runtimeKind = await awaitBoundary(resolveExpoSqliteRuntimeKind(environment));
        rqsStoreLease = await awaitBoundary(acquireDefaultRqsStore({
          app,
          binding: admittedBinding,
          environment,
          runtimeKind,
        }), (lateLease) => lateLease?.release?.());
        resolvedRqsStore = rqsStoreLease.resolution;
      }
      if (disposed) {
        await cleanup();
        return state;
      }

      if (firstPartyBootstrapOptIn(app)) {
        const platform = await awaitBoundary(resolveAppClientPlatform(environment, app));
        applicationClient = await awaitBoundary(createApplicationClient(
          {
            app,
            ...(admittedBinding.source === 'declared-dev'
              ? { url: admittedBinding.target.origin }
              : { binding: admittedBinding }),
            platform,
            now,
            signal: controller.signal,
            rqsStore: resolvedRqsStore,
            ...(environment.onDiagnostic === undefined
              ? {}
              : { onDiagnostic: environment.onDiagnostic }),
          },
          (snapshot) => {
            if (!disposed && snapshot.status !== 'ready') publish(snapshot);
          },
        ), (lateAppClient) => lateAppClient?.dispose?.());
        if (disposed) {
          await cleanup();
          return state;
        }

        if (
          admittedBinding.source === 'supervised-dev'
          && typeof environment.resolveSupervisedAuthority === 'function'
        ) {
          const supervised = await awaitBoundary(environment.resolveSupervisedAuthority(Object.freeze({
            app,
            binding: admittedBinding,
            signal: controller.signal,
            refresh: false,
          })));
          if (disposed) {
            await cleanup();
            return state;
          }
          if (
            supervised?.status === 'authority-required'
            && supervised.diagnostic?.code === 'SNAPBACK_AUTH_POLICY_UNAVAILABLE'
          ) {
            publish(authorityRequiredState(
              Object.assign(new Error(supervised.diagnostic.message), {
                code: supervised.diagnostic.code,
                diagnostic: supervised.diagnostic,
              }),
              correlationId,
              supervised.remediations,
            ));
            return state;
          }
          if (supervised?.status === 'ready') {
            // @ref LLP 0262#d2-carriers-per-shipped-topology — the
            // checkout result crosses the internal adoption seam as client
            // configuration; older adopters intentionally ignore this field.
            await awaitBoundary(adoptSupervisedAuthority(applicationClient, {
              bearer: supervised.bearer,
              binding: admittedBinding,
              refreshAfterMs: supervised.refreshAfterMs,
              ...(supervised.clientOptions === undefined
                ? {}
                : { clientOptions: supervised.clientOptions }),
            }));
            if (disposed) {
              await cleanup();
              return state;
            }
          }
        }

        const prepared = await awaitBoundary(applicationClient.client.prepareReactBinding({
          generatedManifest: app,
          ...(environment.developmentSync === undefined
            ? {}
            : { developmentSync: environment.developmentSync }),
        }));
        preparation = Object.freeze({ source: prepared.source ?? 'deployment' });
        if (disposed) return state;
        reactProvider = createProvider(prepared, {
          assets: createAssetClient(applicationClient.client, { fetch: expoAssetFetch }),
          assetSourceAdapter: adaptExpoAssetSource,
        });
        reactProvider.start?.();
        lifecycleSource = await awaitBoundary(resolveSnapbackExpoLifecycleSource(environment));
        if (disposed) return state;
        lifecycle = bindLifecycle(lifecycleSource, reactProvider, {
          onError(error) {
            try { environment.onDiagnostic?.(normalizedDiagnostic(error, correlationId)); } catch { /* observational */ }
          },
        });
        admittedBindingFacts = publicBindingFacts(admittedBinding);
        bootstrapUnsubscribe = applicationClient.subscribeBootstrap(() => {
          if (disposed || preparation === null || admittedBindingFacts === null) return;
          publish(projectApplicationBootstrap());
        });
        publish(projectApplicationBootstrap());
        return state;
      }

      publish(Object.freeze({ status: 'starting', stage: 'authority' }));
      let adopted;
      try {
        adopted = await awaitBoundary(environment.adoptAuthority(Object.freeze({
          app,
          binding: admittedBinding,
          signal: controller.signal,
          rqsStore: resolvedRqsStore,
        })), (lateAdoption) => lateAdoption?.dispose?.());
      } catch (error) {
        if (
          error?.authorityRequired === true
          || error?.code === 'SNAPBACK_AUTH_POLICY_UNAVAILABLE'
          || error?.code === 'SNAPBACK_AUTHORITY_REQUIRED'
        ) {
          publish(authorityRequiredState(error, correlationId, error?.remediations));
          return state;
        }
        throw error;
      }
      if (adopted?.status === 'authority-required') {
        const error = new Error(
          adopted.diagnostic?.message ?? 'An ordinary application session is required.',
        );
        error.code = adopted.diagnostic?.code ?? 'SNAPBACK_AUTHORITY_REQUIRED';
        error.diagnostic = adopted.diagnostic ?? diagnostic(error.code, error.message);
        publish(authorityRequiredState(error, correlationId, adopted.remediations));
        return state;
      }
      authorityFacts = publicAuthorityFacts(adopted?.publicFacts);
      if (adopted?.status !== 'ready' || !adopted.client || authorityFacts === null) {
        const error = new Error('authority adoption did not return an ordinary session client');
        error.code = 'SNAPBACK_AUTHORITY_REQUIRED';
        publish(authorityRequiredState(error, correlationId));
        return state;
      }
      authorityDisposer = typeof adopted.dispose === 'function' ? adopted.dispose : null;
      if (disposed) {
        await cleanup();
        return state;
      }
      if (typeof adopted.client.prepareReactBinding !== 'function') {
        const error = new TypeError('adopted authority client cannot prepare the existing React binding');
        error.code = 'SNAPBACK_EXPO_ENVIRONMENT_INVALID';
        throw error;
      }

      publish(Object.freeze({ status: 'starting', stage: 'client' }));
      const prepared = await awaitBoundary(adopted.client.prepareReactBinding({
        generatedManifest: app,
        ...(environment.developmentSync === undefined
          ? {}
          : { developmentSync: environment.developmentSync }),
      }));
      preparation = Object.freeze({ source: prepared.source ?? 'deployment' });
      if (disposed) return state;
      reactProvider = createProvider(prepared, {
        // @ref LLP 0181#native-adapters — provider construction registers the
        // picker/content-URI and binary network adapters once on LLP 0114's
        // existing asset owner. Ordinary-session custody remains on adopted.client.
        assets: createAssetClient(adopted.client, { fetch: expoAssetFetch }),
        assetSourceAdapter: adaptExpoAssetSource,
      });
      reactProvider.start?.();
      lifecycleSource = await awaitBoundary(resolveSnapbackExpoLifecycleSource(environment));
      if (disposed) return state;
      lifecycle = bindLifecycle(lifecycleSource, reactProvider, {
        onError(error) {
          try { environment.onDiagnostic?.(normalizedDiagnostic(error, correlationId)); } catch { /* observational */ }
        },
      });
      admittedBindingFacts = publicBindingFacts(admittedBinding);
      publish(Object.freeze({
        status: 'ready',
        binding: admittedBindingFacts,
        authority: authorityFacts,
        preparation,
      }));
      return state;
    } catch (error) {
      if (!controller.signal.aborted) controller.abort(error);
      await cleanup();
      if (!disposed) publish(
        firstPartyBootstrapOptIn(app) && error?.bootstrapState
          ? error.bootstrapState
          : errorState(error, correlationId),
      );
      return state;
    }
  };

  return Object.freeze({
    getSnapshot: () => state,
    subscribe(listener) {
      if (typeof listener !== 'function') throw new TypeError('boot listener must be a function');
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    start() {
      if (!started) {
        started = true;
        startPromise = run();
      }
      return startPromise;
    },
    refreshAuthority() {
      if (refreshPromise !== null) return refreshPromise;
      refreshPromise = (async () => {
        if (disposed || state.status !== 'ready' || admittedBinding === null) return state;
        if (applicationClient !== null) {
          if (
            admittedBinding.source !== 'supervised-dev'
            || typeof environment.resolveSupervisedAuthority !== 'function'
          ) return state;
          try {
            const supervised = await awaitBoundary(environment.resolveSupervisedAuthority(Object.freeze({
              app,
              binding: admittedBinding,
              signal: controller.signal,
              refresh: true,
            })));
            let refreshedBinding = admittedBinding;
            if (supervised?.status === 'ready' || supervised?.status === 'authority-required') {
              if (!supervised.binding || typeof supervised.binding !== 'object') {
                const error = new Error(
                  'a refreshed supervised authority must carry its AppBinding admission candidate',
                );
                error.code = 'SNAPBACK_EXPO_ENVIRONMENT_INVALID';
                throw error;
              }
              refreshedBinding = await awaitBoundary(admitBindingCandidate(
                supervised.binding,
                supervised.admission ?? {},
              ));
            }
            if (supervised?.status === 'ready') {
              await awaitBoundary(adoptSupervisedAuthority(applicationClient, {
                bearer: supervised.bearer,
                binding: refreshedBinding,
                refreshAfterMs: supervised.refreshAfterMs,
                ...(supervised.clientOptions === undefined
                  ? {}
                  : { clientOptions: supervised.clientOptions }),
              }));
              admittedBinding = refreshedBinding;
              admittedBindingAdmission = supervised.admission ?? {};
              admittedBindingFacts = publicBindingFacts(admittedBinding);
            } else if (supervised?.status === 'authority-required') {
              admittedBinding = refreshedBinding;
              admittedBindingAdmission = supervised.admission ?? {};
              admittedBindingFacts = publicBindingFacts(admittedBinding);
              try {
                environment.onDiagnostic?.(normalizedDiagnostic(
                  Object.assign(new Error(supervised.diagnostic?.message), {
                    code: supervised.diagnostic?.code,
                    diagnostic: supervised.diagnostic,
                  }),
                  correlationId,
                ));
              } catch { /* observational */ }
            }
            publish(projectApplicationBootstrap());
          } catch (error) {
            try { environment.onDiagnostic?.(normalizedDiagnostic(error, correlationId)); } catch { /* observational */ }
            publish(projectApplicationBootstrap());
          }
          return state;
        }
        if (typeof environment.refreshAuthority !== 'function') {
          const error = new Error('the selected Expo environment cannot refresh ordinary authority');
          error.code = 'SNAPBACK_EXPO_ENVIRONMENT_INVALID';
          publish(errorState(error, correlationId));
          return state;
        }
        const resumeAfterRefresh = reactProvider?.inspection?.().hostPaused !== true;
        publish(Object.freeze({ status: 'starting', stage: 'authority' }));
        try {
          // Re-admit the current candidate at the refresh clock before even
          // pausing the live owner. The default supervised environment then
          // invokes the same callback for the exact remint it fetched before
          // touching bearer custody.
          await awaitBoundary(admitBindingCandidate(
            admittedBinding,
            admittedBindingAdmission ?? {},
          ));
          // The headless client's bearer barrier owns live-query handles, while
          // the canonical React provider owns presence rooms and publishers.
          // Quiescing that owner around replacement gives both resource
          // families one predecessor/successor cut without teaching Expo a
          // second subscription or room model.
          // @ref LLP 0114#provider-construction-and-ownership — authority replacement
          // crosses the existing provider owner and resumes that same owner.
          await awaitBoundary(reactProvider?.pause());
          let refreshedBinding = null;
          let refreshedAdmission = null;
          const replacement = await awaitBoundary(environment.refreshAuthority(Object.freeze({
            app,
            binding: admittedBinding,
            signal: controller.signal,
            async admitBinding(candidate, admission = {}) {
              const admitted = await awaitBoundary(admitBindingCandidate(candidate, admission));
              refreshedBinding = admitted;
              refreshedAdmission = admission;
              return admitted;
            },
          })));
          if (replacement?.binding && refreshedBinding === null) {
            refreshedAdmission = replacement.admission ?? {};
            refreshedBinding = await awaitBoundary(admitBindingCandidate(
              replacement.binding,
              refreshedAdmission,
            ));
          }
          if (replacement?.status === 'authority-required') {
            const error = new Error(
              replacement.diagnostic?.message ?? 'An ordinary application session is required.',
            );
            error.code = replacement.diagnostic?.code ?? 'SNAPBACK_AUTHORITY_REQUIRED';
            error.diagnostic = replacement.diagnostic ?? diagnostic(error.code, error.message);
            publish(authorityRequiredState(error, correlationId, replacement.remediations));
            return state;
          }
          const nextFacts = publicAuthorityFacts(replacement?.publicFacts);
          if (replacement?.status !== 'ready' || nextFacts === null) {
            const error = new Error('authority refresh did not return ordinary session facts');
            error.code = 'SNAPBACK_AUTHORITY_REQUIRED';
            publish(authorityRequiredState(error, correlationId));
            return state;
          }
          authorityFacts = nextFacts;
          if (refreshedBinding !== null) {
            admittedBinding = refreshedBinding;
            admittedBindingAdmission = refreshedAdmission;
            admittedBindingFacts = publicBindingFacts(admittedBinding);
          }
          if (resumeAfterRefresh) await awaitBoundary(reactProvider?.resume());
          publish(Object.freeze({
            status: 'ready',
            binding: admittedBindingFacts,
            authority: authorityFacts,
            preparation,
          }));
          return state;
        } catch (error) {
          if (resumeAfterRefresh && !controller.signal.aborted) {
            try { await reactProvider?.resume(); } catch { /* retain the refresh refusal */ }
          }
          if (
            error?.authorityRequired === true
            || error?.code === 'SNAPBACK_AUTH_POLICY_UNAVAILABLE'
            || error?.code === 'SNAPBACK_AUTHORITY_REQUIRED'
          ) publish(authorityRequiredState(error, correlationId, error?.remediations));
          else publish(errorState(error, correlationId));
          return state;
        }
      })().finally(() => { refreshPromise = null; });
      return refreshPromise;
    },
    reactProvider: () => reactProvider,
    appClient: () => applicationClient,
    lifecycleSource: () => lifecycleSource,
    dispose() {
      return disposePromise ??= (async () => {
        disposed = true;
        if (!controller.signal.aborted) controller.abort();
        listeners.clear();
        await Promise.allSettled([
          ...(startPromise === null ? [] : [startPromise]),
          ...(refreshPromise === null ? [] : [refreshPromise]),
        ]);
        await cleanup();
      })();
    },
  });
}

export function SnapbackExpoProvider(props) {
  if (Object.hasOwn(props, 'declaredDev') || Object.hasOwn(props, 'declaredDevCapability')) {
    const error = new Error('The declared-dev capability is accepted only from the imported generated app object.');
    error.code = 'SNAPBACK_APP_BINDING_DECLARED_DEV_REFUSED';
    throw error;
  }
  const {
    app,
    binding = null,
    url = undefined,
    environment = defaultSnapbackExpoEnvironment,
    rqsStore = undefined,
    fallback = null,
    children = null,
    outboxDrain = 'auto',
    outboxDrainOptions = undefined,
  } = props;
  const store = useMemo(() => {
    const listeners = new Set();
    let current = Object.freeze({
      state: Object.freeze({ status: 'starting', stage: 'binding' }),
      appClient: null,
      reactProvider: null,
      lifecycleSource: null,
    });
    return Object.freeze({
      getSnapshot: () => current,
      subscribe(listener) {
        listeners.add(listener);
        return () => listeners.delete(listener);
      },
      publish(next) {
        current = next;
        for (const listener of [...listeners]) listener();
      },
    });
  }, [app, binding, environment, rqsStore, url]);
  const active = useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot);
  useEffect(() => {
    const boot = createSnapbackExpoBoot({ app, binding, url, environment, rqsStore });
    let current = true;
    const sync = () => {
      if (!current) return;
      store.publish(Object.freeze({
        state: boot.getSnapshot(),
        appClient: boot.appClient(),
        reactProvider: boot.reactProvider(),
        lifecycleSource: boot.lifecycleSource(),
      }));
    };
    const unsubscribe = boot.subscribe(sync);
    sync();
    void boot.start();
    return () => {
      current = false;
      unsubscribe();
      void boot.dispose();
    };
  }, [app, binding, environment, rqsStore, store, url]);
  const state = active.state;
  const lifecycleValue = useMemo(() => Object.freeze({
    environment,
    source: active.lifecycleSource,
  }), [environment, active.lifecycleSource]);
  const content = state.status === 'ready'
    ? React.createElement(SnapbackProvider, {
        provider: active.reactProvider,
        __appClientProjection: active.appClient,
        outboxDrain,
        outboxDrainOptions,
      }, children)
    : (typeof fallback === 'function' ? fallback(state) : fallback);
  return React.createElement(
    bootContext.Provider,
    { value: state },
    React.createElement(lifecycleContext.Provider, { value: lifecycleValue }, content),
  );
}

// Internal bridge for the Expo activity wrapper and its focused lifecycle
// tests. It is deliberately not re-exported from the package facade.
export function SnapbackExpoLifecycleContextProvider({ value, children = null }) {
  return React.createElement(lifecycleContext.Provider, { value }, children);
}

export function useSnapbackExpoLifecycleContext() {
  return useContext(lifecycleContext);
}

export function useSnapbackExpoBootState() {
  const state = useContext(bootContext);
  if (state === null) {
    const error = new Error('useSnapbackExpoBootState requires SnapbackExpoProvider');
    error.code = 'SNAPBACK_EXPO_PROVIDER_REQUIRED';
    throw error;
  }
  return state;
}

export function isSnapbackExpoBootDiagnostic(error) {
  return isAppBindingDiagnostic(error)
    || error?.diagnostic?.schemaVersion === 'snapback.client-diagnostic.v1';
}
