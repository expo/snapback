import type { ResolvedProviderEntryV1 } from '@expo/snapback-client/provider-entry';
import type { SharedDevelopmentAuthError } from '@expo/snapback-client/shared-development-auth';

export type SharedDevelopmentAuthProjection = Readonly<{
  format: 'snapback.shared-development-auth-projection.v1';
  available: boolean;
  reason?: string;
  origin?: string;
  returnTargets?: readonly string[];
  identityRealm?: 'rehearsal';
  userLimit?: number;
  nonclaim?: string;
}>;

export declare function selectSharedAuthReturnTarget(
  projection: SharedDevelopmentAuthProjection,
  createdUrl: string | undefined,
): string;

export declare function createSharedBrowserAdapter(input: Readonly<{
  projection: SharedDevelopmentAuthProjection;
  appId: string;
  /** `WebBrowser.openAuthSessionAsync`. */
  openAuthSession: (url: string, returnTo: string) => Promise<{ type: string; url?: string }>;
  /** `Linking.createURL`. */
  createUrl: (path: string) => string;
  path?: string;
  timeoutMs?: number;
}>): (entry: ResolvedProviderEntryV1) => Promise<Readonly<{
  exchange: Readonly<{ challengeId: string; code: string }>;
}>>;

export declare function resolveExpoSharedBrowserModules(
  load?: (specifier: string) => Promise<unknown>,
): Promise<Readonly<{
  openAuthSession: (url: string, returnTo: string) => Promise<{ type: string; url?: string }>;
  createUrl: (path: string) => string;
}> | null>;

export type { SharedDevelopmentAuthError };
