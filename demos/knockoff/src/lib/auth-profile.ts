// Knockoff consumes the first-party provider-entry resolver.
//
// This file used to carry its own copy of the LLP 0151 selection table. That
// copy is now `@expo/snapback-client/provider-entry`; what remains here is a
// thin adapter from Knockoff's own input shape (which names `provider` and
// `requested` directly) to the first-party declaration shape, plus the demo's
// `KNOCKOFF_*` diagnostic vocabulary.
//
// @ref LLP 0151#resolved-provider-entry — one resolver. The demo is a consumer
// of it, not a second implementation that could disagree with the shipped one.

import {
  createProviderEntryDispatch,
  resolveProviderEntry as resolveFirstPartyProviderEntry,
} from '@expo/snapback-client/provider-entry';
import type {
  AuthClientPlatform,
  AuthDeploymentProfile,
  AuthEntryAdapter,
  AuthIdentityProvider,
  ResolvedProviderEntryV1,
} from '@expo/snapback-client/provider-entry';

export type IdentityProvider = AuthIdentityProvider;
export type DeploymentProfile = AuthDeploymentProfile;
export type RequestedCredentialProfile = 'auto' | 'shared' | 'app-owned';
export type ClientPlatform = AuthClientPlatform;
export type EntryAdapter = AuthEntryAdapter;

export const AUTH_PROFILE_STORAGE_KEY = 'knockoff.auth-entry-profile.v1';

export type ResolvedProviderEntry = ResolvedProviderEntryV1;

export type ProviderProfileInput = Readonly<{
  appId: string;
  provider: IdentityProvider;
  deployment: DeploymentProfile;
  requested: RequestedCredentialProfile;
  platform: ClientPlatform;
  sharedAvailable: boolean;
  appOwned: Readonly<{
    configReady: boolean;
    browserReady?: boolean;
    configGeneration?: string;
    installationId?: string;
  }>;
  nativeBuild: Readonly<{
    ready: boolean;
    receipt?: string;
  }>;
  preview?: Readonly<{
    ownerAuthenticated: boolean;
    expiresAt?: string;
  }>;
}>;

// The demo's UI reads `KNOCKOFF_*` codes. Map the shipped codes onto them here
// rather than teaching the package about a demo's vocabulary.
const KNOCKOFF_DIAGNOSTIC_CODES: Readonly<Record<string, string>> = Object.freeze({
  SNAPBACK_AUTH_PROVIDER_APP_OWNED_REQUIRED: 'KNOCKOFF_AUTH_APP_OWNED_REQUIRED',
  SNAPBACK_AUTH_PROVIDER_APP_OWNED_NOT_READY: 'KNOCKOFF_AUTH_APP_OWNED_NOT_READY',
  SNAPBACK_AUTH_PROVIDER_PREVIEW_UNAUTHORIZED: 'KNOCKOFF_AUTH_PREVIEW_REHEARSAL_REQUIRED',
  SNAPBACK_AUTH_PROVIDER_SHARED_UNAVAILABLE: 'KNOCKOFF_AUTH_SHARED_PROFILE_UNAVAILABLE',
});

export function resolveProviderEntry(
  input: ProviderProfileInput,
  nowMs = Date.now(),
): ResolvedProviderEntry {
  const entry = resolveFirstPartyProviderEntry({
    appId: input.appId,
    declaration: input.provider === 'apple'
      ? { provider: 'apple', kind: 'apple', credentials: input.requested }
      : { provider: 'google', kind: 'oidc', preset: 'google', credentials: input.requested },
    deployment: input.deployment,
    platform: input.platform,
    sharedAvailable: input.sharedAvailable,
    appOwned: input.appOwned,
    nativeBuild: input.nativeBuild,
    ...(input.preview === undefined ? {} : { preview: input.preview }),
  }, nowMs);
  if (entry.diagnosticCode === undefined) return entry;
  return Object.freeze({
    ...entry,
    diagnosticCode: KNOCKOFF_DIAGNOSTIC_CODES[entry.diagnosticCode] ?? entry.diagnosticCode,
  });
}

type AuthAdapters<Result> = Readonly<Record<EntryAdapter, (
  entry: ResolvedProviderEntry,
) => Promise<Result>>>;

// @ref LLP 0151#native-failures-never-fall-back — dispatch exactly the resolved
// Adapter once. An Adapter error is the operation result.
export function createAuthEntryController<Result>(
  entries: Readonly<Record<IdentityProvider, ResolvedProviderEntry>>,
  adapters: AuthAdapters<Result>,
) {
  const dispatch = createProviderEntryDispatch<Result>(entries, adapters);
  return Object.freeze({
    entry(provider: IdentityProvider) {
      return entries[provider];
    },
    signIn(provider: IdentityProvider): Promise<Result> {
      return dispatch.signIn(provider);
    },
  });
}
