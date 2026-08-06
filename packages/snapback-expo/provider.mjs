import React, {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useSyncExternalStore,
} from 'react';

import { bindSnapbackAppLifecycle } from '@expo/snapback-client';
import {
  SnapbackProvider,
  createSnapbackReactProvider,
} from '@expo/snapback-react';

import {
  admitAppBindingV1,
  isAppBindingDiagnostic,
  publicBindingFacts,
} from './app-binding.mjs';

const bootContext = createContext(null);
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

function remediation(kind, description, precondition, {
  riskClass = 'mechanical',
  machineApplicable = false,
  requiresApproval = false,
  authorityEffect = 'none',
} = {}) {
  return Object.freeze({
    kind,
    riskClass,
    machineApplicable,
    requiresApproval,
    authorityEffect,
    precondition: freezeRecord(precondition),
    description,
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

const DEFAULT_BINDING_REMEDIATIONS = Object.freeze([
  remediation(
    'startExpoSupervisor',
    'Start the supervised Expo development runtime, or build with an admitted release binding.',
    { bindingSource: 'unavailable' },
  ),
]);

export const defaultSnapbackExpoEnvironment = Object.freeze({
  format: 'snapback.expo-environment.v1',
  async resolveBinding() {
    const error = new Error(
      'No AppBinding delivery is installed. E0 defines this admission seam; '
      + 'snapback dev --expo supplies it in E1 and release builds supply it in E3.',
    );
    error.code = 'SNAPBACK_APP_BINDING_UNAVAILABLE';
    error.diagnostic = diagnostic(error.code, error.message, {
      seam: 'SnapbackExpoEnvironmentV1.resolveBinding',
    });
    error.remediations = DEFAULT_BINDING_REMEDIATIONS;
    throw error;
  },
  async adoptAuthority() {
    return Object.freeze({
      status: 'authority-required',
      diagnostic: diagnostic(
        'SNAPBACK_AUTHORITY_REQUIRED',
        'An ordinary application session is required before Snapback can prepare the client.',
        { cause: 'ordinary-session-unavailable' },
      ),
      remediations: Object.freeze([]),
    });
  },
});

async function appStateFor(environment) {
  if (environment?.appState?.addEventListener) return environment.appState;
  if (typeof environment?.resolveAppState === 'function') {
    const resolved = await environment.resolveAppState();
    if (resolved?.addEventListener) return resolved;
  }
  const native = await import('react-native');
  if (!native.AppState?.addEventListener) {
    const error = new Error('react-native did not provide an AppState-compatible lifecycle source');
    error.code = 'SNAPBACK_EXPO_COMPATIBILITY_UNSUPPORTED';
    throw error;
  }
  return native.AppState;
}

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
  now = () => Date.now(),
} = {}) {
  const correlationId = `snapback-expo-boot-${++bootSequence}`;
  let state = Object.freeze({ status: 'starting', stage: 'binding' });
  let started = false;
  let disposed = false;
  let startPromise = null;
  let reactProvider = null;
  let lifecycle = null;
  let authorityDisposer = null;
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
      const admittedBinding = await admitAppBindingV1(resolution.binding, app, {
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
      const authorityFacts = publicAuthorityFacts(adopted?.publicFacts);
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
      if (disposed) return state;
      reactProvider = createProvider(prepared);
      const appState = await appStateFor(environment);
      if (disposed) return state;
      lifecycle = bindLifecycle(appState, reactProvider, {
        onError(error) {
          try { environment.onDiagnostic?.(normalizedDiagnostic(error, correlationId)); } catch { /* observational */ }
        },
      });
      publish(Object.freeze({
        status: 'ready',
        binding: publicBindingFacts(admittedBinding),
        authority: authorityFacts,
      }));
      return state;
    } catch (error) {
      await cleanup();
      if (!disposed) publish(errorState(error, correlationId));
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
    reactProvider: () => reactProvider,
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
}) {
  const boot = useMemo(
    () => createSnapbackExpoBoot({ app, binding, environment }),
    [app, binding, environment],
  );
  const state = useSyncExternalStore(boot.subscribe, boot.getSnapshot, boot.getSnapshot);
  useEffect(() => {
    void boot.start();
    return () => { void boot.dispose(); };
  }, [boot]);
  const content = state.status === 'ready'
    ? React.createElement(SnapbackProvider, { provider: boot.reactProvider() }, children)
    : (typeof fallback === 'function' ? fallback(state) : fallback);
  return React.createElement(bootContext.Provider, { value: state }, content);
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
