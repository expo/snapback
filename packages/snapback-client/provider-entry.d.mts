import type { AuthCredentialMode, AuthDeclaredProviderV1, AuthIdentityProvider } from './app-client.d.mts';

export type { AuthCredentialMode, AuthDeclaredProviderV1, AuthIdentityProvider };

export type AuthEntryAdapter =
  | 'synthetic'
  | 'snapback-shared-browser'
  | 'app-owned-browser'
  | 'app-owned-native';
export type AuthDeploymentProfile = 'test' | 'development' | 'preview' | 'staging' | 'production';
export type AuthClientPlatform = 'ios' | 'android' | 'web';

export declare const RESOLVED_PROVIDER_ENTRY_FORMAT: 'snapback.resolved-provider-entry.v1';
export declare const AUTH_IDENTITY_PROVIDERS: readonly AuthIdentityProvider[];
export declare const AUTH_ENTRY_ADAPTERS: readonly AuthEntryAdapter[];
export declare const AUTH_DEPLOYMENT_PROFILES: readonly AuthDeploymentProfile[];
export declare const AUTH_CLIENT_PLATFORMS: readonly AuthClientPlatform[];
export declare const AUTH_CREDENTIAL_MODES: readonly AuthCredentialMode[];
export declare const AUTH_SHARED_DEVELOPMENT_USER_LIMIT: 100;

/**
 * One resolved Adapter selection. Carries no credential value, provider token,
 * callback secret, user identity, or Snapback session credential.
 */
export type ResolvedProviderEntryV1 = Readonly<{
  format: 'snapback.resolved-provider-entry.v1';
  provider: AuthIdentityProvider;
  providerInstallationId: string;
  adapter: AuthEntryAdapter;
  identityRealm: 'rehearsal' | 'application';
  authProfileGeneration: string;
  configGeneration?: string;
  clientBuildReceipt?: string;
  readiness: 'ready' | 'blocked';
  nextAction?: string;
  diagnosticCode?: string;
}>;

export type ProviderEntryContext = Readonly<{
  appId: string;
  deployment: AuthDeploymentProfile;
  platform: AuthClientPlatform;
  /** Whether a shared development broker is reachable for this client. */
  sharedAvailable?: boolean;
  appOwned?: Readonly<{
    configReady: boolean;
    /** Web-only: whether the app-owned browser callback verified. */
    browserReady?: boolean;
    configGeneration?: string;
    installationId?: string;
  }>;
  nativeBuild?: Readonly<{ ready: boolean; receipt?: string }>;
  preview?: Readonly<{ ownerAuthenticated: boolean; expiresAt?: string }>;
}>;

export type ProviderEntryInput = ProviderEntryContext & Readonly<{
  declaration: AuthDeclaredProviderV1;
}>;

export declare function resolveProviderEntry(
  input: ProviderEntryInput,
  nowMs?: number,
): ResolvedProviderEntryV1;

export declare function resolveDeclaredProviderEntries(
  declaredProviders: readonly AuthDeclaredProviderV1[] | undefined,
  context: ProviderEntryContext,
  nowMs?: number,
): Readonly<Partial<Record<AuthIdentityProvider, ResolvedProviderEntryV1>>>;

export interface ProviderEntryDispatch<Result> {
  entry(provider: AuthIdentityProvider): ResolvedProviderEntryV1 | null;
  providers(): readonly string[];
  signIn(provider: AuthIdentityProvider): Promise<Result>;
}

export declare function createProviderEntryDispatch<Result>(
  entries: Readonly<Partial<Record<AuthIdentityProvider, ResolvedProviderEntryV1>>>,
  adapters: Readonly<Partial<Record<AuthEntryAdapter, (entry: ResolvedProviderEntryV1) => Promise<Result>>>>,
): ProviderEntryDispatch<Result>;
