export type IdentityProvider = 'apple' | 'google';
export type DeploymentProfile = 'test' | 'development' | 'preview' | 'staging' | 'production';
export type RequestedCredentialProfile = 'auto' | 'shared' | 'app-owned';
export type ClientPlatform = 'ios' | 'android' | 'web';
export type EntryAdapter =
  | 'synthetic'
  | 'snapback-shared-browser'
  | 'app-owned-browser'
  | 'app-owned-native';

export const AUTH_PROFILE_STORAGE_KEY = 'knockoff.auth-entry-profile.v1';

export type ResolvedProviderEntry = Readonly<{
  format: 'snapback.resolved-provider-entry.v1';
  provider: IdentityProvider;
  providerInstallationId: string;
  adapter: EntryAdapter;
  identityRealm: 'rehearsal' | 'application';
  authProfileGeneration: string;
  readiness: 'ready' | 'blocked';
  nextAction?: string;
  diagnosticCode?: string;
}>;

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

function blocked(input: ProviderProfileInput, code: string, nextAction: string): ResolvedProviderEntry {
  return Object.freeze({
    format: 'snapback.resolved-provider-entry.v1',
    provider: input.provider,
    providerInstallationId: `blocked:${input.provider}:${input.appId}`,
    adapter: input.platform === 'web' ? 'app-owned-browser' : 'app-owned-native',
    identityRealm: 'application',
    authProfileGeneration: `${input.deployment}:${input.provider}:blocked:v1`,
    readiness: 'blocked',
    diagnosticCode: code,
    nextAction,
  });
}

function ready(
  input: ProviderProfileInput,
  adapter: EntryAdapter,
  identityRealm: 'rehearsal' | 'application',
  nextAction?: string,
): ResolvedProviderEntry {
  const providerInstallationId = identityRealm === 'rehearsal'
    ? `shared-development:${input.appId}:${input.provider}:v1`
    : input.appOwned.installationId ?? `app-owned:${input.appId}:${input.provider}:v1`;
  const generationParts = [
    input.deployment,
    input.provider,
    adapter,
    providerInstallationId,
    input.appOwned.configGeneration ?? 'no-config',
    input.nativeBuild.receipt ?? 'no-build',
  ];
  return Object.freeze({
    format: 'snapback.resolved-provider-entry.v1',
    provider: input.provider,
    providerInstallationId,
    adapter,
    identityRealm,
    authProfileGeneration: generationParts.join(':'),
    readiness: 'ready',
    ...(nextAction ? { nextAction } : {}),
  });
}

function appOwnedAdapter(input: ProviderProfileInput): EntryAdapter | null {
  if (!input.appOwned.configReady) return null;
  if (input.platform === 'web') {
    return input.appOwned.browserReady === false ? null : 'app-owned-browser';
  }
  return input.nativeBuild.ready ? 'app-owned-native' : null;
}

function validPreview(input: ProviderProfileInput, nowMs: number): boolean {
  if (!input.preview?.ownerAuthenticated || typeof input.preview.expiresAt !== 'string') return false;
  const expiresAt = Date.parse(input.preview.expiresAt);
  return Number.isFinite(expiresAt) && expiresAt > nowMs;
}

// @ref LLP 0151#resolved-provider-entry — one resolver freezes the Adapter
// before sign-in. Clients never choose credentials or fall back after an
// Adapter starts.
export function resolveProviderEntry(input: ProviderProfileInput, nowMs = Date.now()): ResolvedProviderEntry {
  if (!input.appId || !['apple', 'google'].includes(input.provider)) {
    throw new TypeError('Knockoff auth profile requires an app id and supported provider');
  }
  if (input.deployment === 'test') return ready(input, 'synthetic', 'rehearsal');

  const owned = appOwnedAdapter(input);
  if (input.deployment === 'staging' || input.deployment === 'production') {
    if (input.requested === 'shared' || owned === null) {
      return blocked(
        input,
        'KNOCKOFF_AUTH_APP_OWNED_REQUIRED',
        input.appOwned.configReady
          ? 'Rebuild the client with the configured native provider integration.'
          : `Configure app-owned ${input.provider} credentials.`,
      );
    }
    return ready(input, owned, 'application');
  }

  if (input.deployment === 'preview' && !validPreview(input, nowMs)) {
    return blocked(
      input,
      'KNOCKOFF_AUTH_PREVIEW_REHEARSAL_REQUIRED',
      'Create an owner-authenticated preview with an unexpired rehearsal window.',
    );
  }

  if (input.requested === 'app-owned') {
    return owned === null
      ? blocked(
          input,
          'KNOCKOFF_AUTH_APP_OWNED_NOT_READY',
          input.appOwned.configReady
            ? 'Rebuild the client with the configured native provider integration.'
            : `Configure app-owned ${input.provider} credentials.`,
        )
      : ready(input, owned, 'application');
  }

  if (input.requested === 'auto' && owned !== null) return ready(input, owned, 'application');
  if (!input.sharedAvailable) {
    return blocked(
      input,
      'KNOCKOFF_AUTH_SHARED_PROFILE_UNAVAILABLE',
      `Start the Snapback development auth broker or configure app-owned ${input.provider} credentials.`,
    );
  }
  const nextAction = input.requested === 'auto' && input.appOwned.configReady && !input.nativeBuild.ready
    ? 'Rebuild the client to activate app-owned native auth.'
    : undefined;
  return ready(input, 'snapback-shared-browser', 'rehearsal', nextAction);
}

type AuthAdapters<Result> = Readonly<Record<EntryAdapter, (
  entry: ResolvedProviderEntry,
) => Promise<Result>>>;

// @ref LLP 0151#native-failures-never-fall-back — dispatch exactly the
// resolved Adapter once. An Adapter error is the operation result.
export function createAuthEntryController<Result>(
  entries: Readonly<Record<IdentityProvider, ResolvedProviderEntry>>,
  adapters: AuthAdapters<Result>,
) {
  return Object.freeze({
    entry(provider: IdentityProvider) {
      return entries[provider];
    },
    async signIn(provider: IdentityProvider): Promise<Result> {
      const entry = entries[provider];
      if (entry.readiness !== 'ready') {
        const error = new Error(entry.nextAction ?? `${provider} sign-in is not ready`);
        Object.assign(error, { code: entry.diagnosticCode });
        throw error;
      }
      return adapters[entry.adapter](entry);
    },
  });
}
