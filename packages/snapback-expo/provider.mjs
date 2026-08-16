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
  createSnapbackAppClientWithBootstrapObserver,
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
import { createSupervisedExpoEnvironment } from './supervised-environment.mjs';
import {
  adaptExpoAssetSource,
  expoAssetFetch,
} from './asset-source.mjs';
import { resolveSnapbackExpoLifecycleSource } from './lifecycle-source.mjs';

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
  return diagnostic(base.code, base.message, {
    ...(base.details ?? {}),
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
  if (app.authBootstrap.custody === 'volatile-explicit') {
    return Object.freeze({ kind: 'memory' });
  }
  // @ref LLP 0258#d3-custody-is-selected-by-capability-never-convenience-fallback
  // — native durable-required remains refused until Phase 2 has per-OS
  // kill/relaunch and fencing evidence. Expo web uses IndexedDB above.
  return Object.freeze({ kind: 'expo-native-phase-2-evidence-required' });
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
    remediations: Object.freeze([...remediations]),
  });
}

function errorState(error, correlationId) {
  const value = normalizedDiagnostic(error, correlationId);
  const unsupportedCodes = new Set([
    'SNAPBACK_APP_BINDING_CAPABILITY_MISMATCH',
    'SNAPBACK_APP_BINDING_FORMAT_UNSUPPORTED',
    'SNAPBACK_APP_BINDING_SOURCE_UNSUPPORTED',
    'SNAPBACK_EXPO_COMPATIBILITY_UNSUPPORTED',
  ]);
  return Object.freeze({
    status: unsupportedCodes.has(value.code) ? 'unsupported' : 'error',
    diagnostic: value,
    remediations: Object.freeze([...(error?.remediations ?? [])]),
  });
}

export const defaultSnapbackExpoEnvironment = createSupervisedExpoEnvironment();

// @ref LLP 0181#provider — the controller exposes exactly the RFC boot-state
// union. Binding, authority, and client preparation are distinct stages; no
// missing authority path is converted to anonymous success.
// @ref LLP 0176#one-owner-many-projections — client preparation and React
// provider construction call the existing package owners instead of creating
// an Expo cache, sync transport, or auth model.
export function createSnapbackExpoBoot({
  app,
  binding: bindingOverride = null,
  environment = defaultSnapbackExpoEnvironment,
  createProvider = createSnapbackReactProvider,
  bindLifecycle = bindSnapbackAppLifecycle,
  createApplicationClient = createSnapbackAppClientWithBootstrapObserver,
  adoptSupervisedAuthority = adoptSupervisedBootstrapAuthority,
  now = () => Date.now(),
} = {}) {
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
  const listeners = new Set();
  const controller = new AbortController();

  const publish = (next) => {
    if (disposed) return;
    state = next;
    for (const listener of [...listeners]) {
      try { listener(); } catch { /* observation never owns boot */ }
    }
  };

  const cleanup = async () => {
    lifecycle?.dispose?.();
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
  };

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
      const resolution = await environment.resolveBinding(Object.freeze({
        app,
        bindingOverride,
        signal: controller.signal,
      }));
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
      admittedBinding = await admitAppBindingV1(resolution.binding, app, {
        mode: bindingOverride === null ? 'resolved' : 'override',
        now: now(),
        productionCondition:
          admission.productionCondition ?? productionCondition(),
        delivery: admission.delivery,
        generatedReleaseTargets: admission.generatedReleaseTargets,
        confirmSupervisedIssuance: admission.confirmSupervisedIssuance,
        verifySignedArtifact: admission.verifySignedArtifact,
        verifyBuildReceipt: admission.verifyBuildReceipt,
      });
      if (disposed) return state;

      if (firstPartyBootstrapOptIn(app)) {
        const platform = await resolveAppClientPlatform(environment, app);
        applicationClient = await createApplicationClient(
          {
            app,
            binding: admittedBinding,
            platform,
            now,
          },
          (snapshot) => {
            if (!disposed && snapshot.status !== 'ready') publish(snapshot);
          },
        );
        if (disposed) {
          await cleanup();
          return state;
        }

        if (
          admittedBinding.source === 'supervised-dev'
          && typeof environment.resolveSupervisedAuthority === 'function'
        ) {
          const supervised = await environment.resolveSupervisedAuthority(Object.freeze({
            app,
            binding: admittedBinding,
            signal: controller.signal,
            refresh: false,
          }));
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
            await adoptSupervisedAuthority(applicationClient, {
              bearer: supervised.bearer,
              binding: admittedBinding,
              refreshAfterMs: supervised.refreshAfterMs,
            });
            if (disposed) {
              await cleanup();
              return state;
            }
          }
        }

        const prepared = await applicationClient.client.prepareReactBinding({
          generatedManifest: app,
          ...(environment.developmentSync === undefined
            ? {}
            : { developmentSync: environment.developmentSync }),
        });
        preparation = Object.freeze({ source: prepared.source ?? 'deployment' });
        if (disposed) return state;
        reactProvider = createProvider(prepared, {
          assets: createAssetClient(applicationClient.client, { fetch: expoAssetFetch }),
          assetSourceAdapter: adaptExpoAssetSource,
        });
        reactProvider.start?.();
        lifecycleSource = await resolveSnapbackExpoLifecycleSource(environment);
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
        adopted = await environment.adoptAuthority(Object.freeze({
          app,
          binding: admittedBinding,
          signal: controller.signal,
        }));
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
      const prepared = await adopted.client.prepareReactBinding({
        generatedManifest: app,
        ...(environment.developmentSync === undefined
          ? {}
          : { developmentSync: environment.developmentSync }),
      });
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
      lifecycleSource = await resolveSnapbackExpoLifecycleSource(environment);
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
            const supervised = await environment.resolveSupervisedAuthority(Object.freeze({
              app,
              binding: admittedBinding,
              signal: controller.signal,
              refresh: true,
            }));
            if (supervised?.status === 'ready') {
              await adoptSupervisedAuthority(applicationClient, {
                bearer: supervised.bearer,
                binding: admittedBinding,
                refreshAfterMs: supervised.refreshAfterMs,
              });
            } else if (supervised?.status === 'authority-required') {
              try { environment.onDiagnostic?.(supervised.diagnostic); } catch { /* observational */ }
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
          // The headless client's bearer barrier owns live-query handles, while
          // the canonical React provider owns presence rooms and publishers.
          // Quiescing that owner around replacement gives both resource
          // families one predecessor/successor cut without teaching Expo a
          // second subscription or room model.
          // @ref LLP 0114#provider-construction-and-ownership — authority replacement
          // crosses the existing provider owner and resumes that same owner.
          await reactProvider?.pause();
          const replacement = await environment.refreshAuthority(Object.freeze({
            app,
            binding: admittedBinding,
            signal: controller.signal,
          }));
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
          if (resumeAfterRefresh) await reactProvider?.resume();
          publish(Object.freeze({
            status: 'ready',
            binding: admittedBindingFacts,
            authority: authorityFacts,
            preparation,
          }));
          return state;
        } catch (error) {
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
    async dispose() {
      if (disposed) return;
      disposed = true;
      controller.abort();
      listeners.clear();
      await cleanup();
    },
  });
}

export function SnapbackExpoProvider({
  app,
  binding = null,
  environment = defaultSnapbackExpoEnvironment,
  fallback = null,
  children = null,
  outboxDrain = 'auto',
  outboxDrainOptions = undefined,
}) {
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
  }, [app, binding, environment]);
  const active = useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot);
  useEffect(() => {
    const boot = createSnapbackExpoBoot({ app, binding, environment });
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
  }, [app, binding, environment, store]);
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
