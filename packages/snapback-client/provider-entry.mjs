// Provider entry resolution: one Adapter, chosen before a sign-in attempt
// starts and frozen for its duration.
//
// The generated auth declaration says *which* providers exist and what
// credential policy each one carries. This module says which Adapter serves
// one attempt, by combining that declaration with the deployment profile, LLP
// 0036 configuration readiness, the installed client build's receipt, and
// (for previews) server-side owner authorization. It computes; it never
// performs a sign-in and never holds a credential.
//
// @ref LLP 0151#resolved-provider-entry — the projection carries no credential
// value, provider token, callback secret, user identity, or Snapback session
// credential, and one result is bound to the auth-profile generation before
// sign-in begins.

import { snapbackDiagnosticError } from './diagnostic-error.mjs';

export const RESOLVED_PROVIDER_ENTRY_FORMAT = 'snapback.resolved-provider-entry.v1';
export const AUTH_IDENTITY_PROVIDERS = Object.freeze(['apple', 'google']);
export const AUTH_ENTRY_ADAPTERS = Object.freeze([
  'synthetic',
  'snapback-shared-browser',
  'app-owned-browser',
  'app-owned-native',
]);
export const AUTH_DEPLOYMENT_PROFILES = Object.freeze([
  'test', 'development', 'preview', 'staging', 'production',
]);
export const AUTH_CLIENT_PLATFORMS = Object.freeze(['ios', 'android', 'web']);
export const AUTH_CREDENTIAL_MODES = Object.freeze(['auto', 'shared', 'app-owned']);

/// The shared development profile is capped at this many distinct rehearsal
/// users per app. The broker repeats the cap from server-held state; this
/// constant exists so the client-side status projection can name the same
/// number the broker enforces.
export const AUTH_SHARED_DEVELOPMENT_USER_LIMIT = 100;

const isRecord = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);

function refuseInput(message, details) {
  return snapbackDiagnosticError(
    'SNAPBACK_AUTH_PROVIDER_RESOLUTION_INPUT_INVALID',
    message,
    details,
    { operation: 'auth-provider-resolve', effectCommitted: false },
  );
}

function blockedEntry(input, code, nextAction) {
  return Object.freeze({
    format: RESOLVED_PROVIDER_ENTRY_FORMAT,
    provider: input.declaration.provider,
    providerInstallationId: `blocked:${input.declaration.provider}:${input.appId}`,
    adapter: input.platform === 'web' ? 'app-owned-browser' : 'app-owned-native',
    identityRealm: 'application',
    authProfileGeneration: `${input.deployment}:${input.declaration.provider}:blocked:v1`,
    readiness: 'blocked',
    diagnosticCode: code,
    nextAction,
  });
}

function readyEntry(input, adapter, identityRealm, nextAction) {
  const { provider } = input.declaration;
  const providerInstallationId = identityRealm === 'rehearsal'
    ? `shared-development:${input.appId}:${provider}:v1`
    : input.appOwned.installationId ?? `app-owned:${input.appId}:${provider}:v1`;
  const configGeneration = input.appOwned.configGeneration ?? null;
  const clientBuildReceipt = input.nativeBuild.receipt ?? null;
  // @ref LLP 0151#switching-to-app-owned-credentials — the generation binds the
  // installation, the configuration revision, and the build receipt, so
  // switching credential ownership produces a different generation and the
  // incompatible custody is signed out instead of silently reinterpreted.
  const authProfileGeneration = [
    input.deployment,
    provider,
    adapter,
    providerInstallationId,
    configGeneration ?? 'no-config',
    clientBuildReceipt ?? 'no-build',
  ].join(':');
  return Object.freeze({
    format: RESOLVED_PROVIDER_ENTRY_FORMAT,
    provider,
    providerInstallationId,
    adapter,
    identityRealm,
    authProfileGeneration,
    ...(configGeneration === null ? {} : { configGeneration }),
    ...(clientBuildReceipt === null ? {} : { clientBuildReceipt }),
    readiness: 'ready',
    ...(nextAction === undefined ? {} : { nextAction }),
  });
}

// @ref LLP 0151#native-readiness-requires-both-halves — provider configuration
// alone never selects native auth; the installed build must also carry the
// matching native integration. Configuration that is ready while the build is
// not keeps local development on the shared browser Adapter.
function appOwnedAdapterFor(input) {
  if (input.appOwned.configReady !== true) return null;
  if (input.platform === 'web') {
    return input.appOwned.browserReady === false ? null : 'app-owned-browser';
  }
  return input.nativeBuild.ready === true ? 'app-owned-native' : null;
}

function previewWindowOpen(input, nowMs) {
  if (input.preview?.ownerAuthenticated !== true) return false;
  const expiresAt = Date.parse(input.preview.expiresAt ?? '');
  return Number.isFinite(expiresAt) && expiresAt > nowMs;
}

function normalizeInput(input) {
  if (!isRecord(input)) throw refuseInput('provider entry resolution expects an object', {});
  const { appId, declaration } = input;
  if (typeof appId !== 'string' || appId.length === 0) {
    throw refuseInput('provider entry resolution requires an app id', {});
  }
  if (!isRecord(declaration) || !AUTH_IDENTITY_PROVIDERS.includes(declaration.provider)) {
    throw refuseInput('provider entry resolution requires a declared provider', {
      allowed: AUTH_IDENTITY_PROVIDERS,
      provider: declaration?.provider ?? null,
    });
  }
  const credentials = declaration.credentials ?? 'auto';
  if (!AUTH_CREDENTIAL_MODES.includes(credentials)) {
    throw refuseInput('provider declaration carries an unsupported credential policy', {
      allowed: AUTH_CREDENTIAL_MODES,
      credentials,
    });
  }
  if (!AUTH_DEPLOYMENT_PROFILES.includes(input.deployment)) {
    throw refuseInput('provider entry resolution requires a known deployment profile', {
      allowed: AUTH_DEPLOYMENT_PROFILES,
      deployment: input.deployment ?? null,
    });
  }
  if (!AUTH_CLIENT_PLATFORMS.includes(input.platform)) {
    throw refuseInput('provider entry resolution requires a known client platform', {
      allowed: AUTH_CLIENT_PLATFORMS,
      platform: input.platform ?? null,
    });
  }
  return Object.freeze({
    appId,
    declaration: Object.freeze({ ...declaration, credentials }),
    deployment: input.deployment,
    platform: input.platform,
    sharedAvailable: input.sharedAvailable === true,
    appOwned: Object.freeze({ configReady: false, ...(isRecord(input.appOwned) ? input.appOwned : {}) }),
    nativeBuild: Object.freeze({ ready: false, ...(isRecord(input.nativeBuild) ? input.nativeBuild : {}) }),
    ...(isRecord(input.preview) ? { preview: Object.freeze({ ...input.preview }) } : {}),
  });
}

function appOwnedNextAction(input) {
  return input.appOwned.configReady === true
    ? 'Rebuild the client with the configured native provider integration.'
    : `Run snapback auth configure ${input.declaration.provider}.`;
}

/**
 * Resolve exactly one Adapter for one provider in one deployment.
 *
 * @ref LLP 0151#resolved-provider-entry — the selection rules are closed. A
 * caller that dislikes the result must stage a new auth-profile generation; it
 * cannot ask again with different inputs mid-attempt.
 */
export function resolveProviderEntry(rawInput, nowMs = Date.now()) {
  const input = normalizeInput(rawInput);
  const { credentials } = input.declaration;
  if (input.deployment === 'test') return readyEntry(input, 'synthetic', 'rehearsal');

  const appOwned = appOwnedAdapterFor(input);

  // @ref LLP 0151#switching-to-app-owned-credentials — staging and production
  // refuse shared credentials outright rather than degrading into a rehearsal
  // identity realm.
  if (input.deployment === 'staging' || input.deployment === 'production') {
    if (credentials === 'shared' || appOwned === null) {
      return blockedEntry(
        input,
        'SNAPBACK_AUTH_PROVIDER_APP_OWNED_REQUIRED',
        credentials === 'shared'
          ? `Declare ${input.declaration.provider} credentials as auto or app-owned before ${input.deployment}.`
          : appOwnedNextAction(input),
      );
    }
    return readyEntry(input, appOwned, 'application');
  }

  if (credentials === 'app-owned') {
    return appOwned === null
      ? blockedEntry(input, 'SNAPBACK_AUTH_PROVIDER_APP_OWNED_NOT_READY', appOwnedNextAction(input))
      : readyEntry(input, appOwned, 'application');
  }

  if (credentials === 'auto' && appOwned !== null) return readyEntry(input, appOwned, 'application');

  // Everything below serves the shared development profile, which is a
  // rehearsal identity realm.
  if (input.deployment === 'preview' && !previewWindowOpen(input, nowMs)) {
    return blockedEntry(
      input,
      'SNAPBACK_AUTH_PROVIDER_PREVIEW_UNAUTHORIZED',
      'Authorize this preview as its owner and set an unexpired shared rehearsal window.',
    );
  }
  if (!input.sharedAvailable) {
    return blockedEntry(
      input,
      'SNAPBACK_AUTH_PROVIDER_SHARED_UNAVAILABLE',
      `Start snapback dev --expo, or run snapback auth configure ${input.declaration.provider}.`,
    );
  }
  return readyEntry(
    input,
    'snapback-shared-browser',
    'rehearsal',
    credentials === 'auto' && input.appOwned.configReady === true && input.nativeBuild.ready !== true
      ? 'Rebuild the client to activate app-owned native auth.'
      : undefined,
  );
}

/**
 * Resolve every declared provider once, keyed by provider name. Callers hold
 * the result for the life of one auth-profile generation.
 */
export function resolveDeclaredProviderEntries(declaredProviders, context, nowMs = Date.now()) {
  const entries = {};
  for (const declaration of declaredProviders ?? []) {
    entries[declaration.provider] = resolveProviderEntry(
      { ...context, declaration },
      nowMs,
    );
  }
  return Object.freeze(entries);
}

/**
 * Dispatch exactly the resolved Adapter, exactly once.
 *
 * @ref LLP 0151#native-failures-never-fall-back — an Adapter's cancellation,
 * timeout, `invalid_client`, or token refusal *is* the operation result. This
 * dispatcher has no second attempt and no second Adapter, because a silent
 * retry would change the consent brand, the provider installation, and
 * possibly the identity realm behind the caller's back.
 */
export function createProviderEntryDispatch(entries, adapters) {
  if (!isRecord(entries)) throw refuseInput('provider dispatch requires resolved entries', {});
  if (!isRecord(adapters)) throw refuseInput('provider dispatch requires an adapter map', {});
  return Object.freeze({
    entry(provider) {
      return entries[provider] ?? null;
    },
    providers() {
      return Object.freeze(Object.keys(entries).sort());
    },
    async signIn(provider) {
      const entry = entries[provider];
      if (entry === undefined) {
        throw snapbackDiagnosticError(
          'SNAPBACK_AUTH_PROVIDER_UNDECLARED',
          `This app's auth declaration does not name the provider ${JSON.stringify(provider)}.`,
          { provider, declared: Object.keys(entries).sort() },
          { operation: 'auth-provider-sign-in', effectCommitted: false },
        );
      }
      if (entry.readiness !== 'ready') {
        throw snapbackDiagnosticError(
          entry.diagnosticCode,
          entry.nextAction ?? `${provider} sign-in is not ready.`,
          {
            provider,
            adapter: entry.adapter,
            identityRealm: entry.identityRealm,
            authProfileGeneration: entry.authProfileGeneration,
            nextAction: entry.nextAction ?? null,
          },
          { operation: 'auth-provider-sign-in', effectCommitted: false },
        );
      }
      const adapter = adapters[entry.adapter];
      if (typeof adapter !== 'function') {
        throw snapbackDiagnosticError(
          'SNAPBACK_AUTH_PROVIDER_ADAPTER_UNAVAILABLE',
          `This client carries no ${entry.adapter} Adapter for ${provider}.`,
          { provider, adapter: entry.adapter, available: Object.keys(adapters).sort() },
          { operation: 'auth-provider-sign-in', effectCommitted: false },
        );
      }
      return adapter(entry);
    },
  });
}
