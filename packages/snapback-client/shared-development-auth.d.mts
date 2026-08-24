export type SharedDevelopmentAuthProvider = 'apple' | 'google';

export declare const SHARED_DEVELOPMENT_AUTH_PROVIDERS: readonly SharedDevelopmentAuthProvider[];
export declare const SHARED_DEVELOPMENT_AUTH_USER_LIMIT: 100;
export declare const SHARED_DEVELOPMENT_AUTH_REFUSED_CODE: 'SNAPBACK_AUTH_SHARED_DEVELOPMENT_REFUSED';
export declare const SHARED_DEVELOPMENT_AUTH_ROUTES: Readonly<{
  start: '/v1/shared/start';
  authorize: '/v1/shared/authorize';
  complete: '/v1/shared/complete';
  redeem: '/v1/shared/redeem';
}>;

export interface SharedDevelopmentAuthError extends Error {
  readonly code: 'SNAPBACK_AUTH_SHARED_DEVELOPMENT_REFUSED';
  readonly reason: string;
  readonly diagnostic: Readonly<Record<string, unknown>>;
}

export declare function sharedDevelopmentAuthRefusal(
  reason: string,
  message: string,
  details?: Readonly<Record<string, unknown>>,
): SharedDevelopmentAuthError;

export declare function createSharedDevelopmentVerifier(
  cryptoObject?: Crypto,
): Promise<Readonly<{ verifier: string; codeChallenge: string }>>;

export type SharedDevelopmentAuthStart = Readonly<{
  transactionId: string;
  state: string;
  authorizationPath: string;
  expiresAt: string;
}>;

export declare function sharedDevelopmentAuthorizationUrl(
  origin: string,
  start: SharedDevelopmentAuthStart,
): string;

export declare function readSharedDevelopmentCallback(
  callbackUrl: string,
  start: SharedDevelopmentAuthStart,
): Readonly<{ code: string }>;

export type SharedDevelopmentAuthOptions = Readonly<{
  fetchImpl?: (input: string, init: RequestInit) => Promise<Response>;
  timeoutMs?: number;
}>;

export declare function startSharedDevelopmentAuth(
  origin: string,
  input: Readonly<{
    appId: string;
    provider: SharedDevelopmentAuthProvider;
    returnTo: string;
    codeChallenge: string;
  }>,
  options?: SharedDevelopmentAuthOptions,
): Promise<SharedDevelopmentAuthStart>;

export declare function redeemSharedDevelopmentAuth<Result = unknown>(
  origin: string,
  input: Readonly<{ appId: string; code: string; verifier: string }>,
  options?: SharedDevelopmentAuthOptions,
): Promise<Result>;
