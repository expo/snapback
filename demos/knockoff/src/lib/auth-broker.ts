import type { EntryAdapter, IdentityProvider } from './auth-profile';

export type { IdentityProvider } from './auth-profile';

export type BrokerResponse = Readonly<{
  exchange: Readonly<{ challengeId: string; code: string }>;
  profile: Readonly<{
    displayName: string;
    handle: string;
    avatarUrl: string;
    provider: IdentityProvider;
  }>;
  entry: Readonly<{
    provider: IdentityProvider;
    adapter: EntryAdapter;
    identityRealm: 'rehearsal' | 'application';
    providerInstallationId: string;
    authProfileGeneration: string;
  }>;
}>;

export type SharedAuthStart = Readonly<{
  transactionId: string;
  state: string;
  authorizationPath: string;
  expiresAt: string;
}>;

type FetchLike = (input: string, init: RequestInit) => Promise<Response>;

export async function postIdentityBroker<Result = BrokerResponse>(
  origin: string,
  path: string,
  body: object,
  options: Readonly<{ fetchImpl?: FetchLike; timeoutMs?: number }> = {},
): Promise<Result> {
  const timeoutMs = options.timeoutMs ?? 15_000;
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs <= 0) {
    throw new TypeError('Identity broker timeout must be a positive safe integer');
  }
  const controller = new AbortController();
  const timeoutError = new Error(`Identity broker did not answer within ${timeoutMs} ms`);
  const timer = setTimeout(() => controller.abort(timeoutError), timeoutMs);
  try {
    const response = await (options.fetchImpl ?? fetch)(`${origin}${path}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    const result = await response.json() as {
      diagnostic?: { message?: string };
    };
    if (!response.ok) {
      const message = result?.diagnostic?.message ?? `Identity broker refused with HTTP ${response.status}`;
      throw new Error(message);
    }
    return result as Result;
  } catch (error) {
    if (controller.signal.aborted) throw timeoutError;
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

export function sharedAuthorizationUrl(origin: string, start: SharedAuthStart): string {
  const url = new URL(start.authorizationPath, origin);
  const expected = new URL(origin);
  if (url.origin !== expected.origin || !url.pathname.startsWith('/v1/shared/')) {
    throw new Error('Identity broker returned an invalid shared authorization URL');
  }
  return url.toString();
}

export function startSharedBrokerEntry(
  origin: string,
  input: Readonly<{
    appId: string;
    provider: IdentityProvider;
    returnTo: string;
    codeChallenge: string;
  }>,
  options: Readonly<{ fetchImpl?: FetchLike; timeoutMs?: number }> = {},
) {
  return postIdentityBroker<SharedAuthStart>(origin, '/v1/shared/start', input, options);
}

export function redeemSharedBrokerEntry(
  origin: string,
  input: Readonly<{ appId: string; code: string; verifier: string }>,
  options: Readonly<{ fetchImpl?: FetchLike; timeoutMs?: number }> = {},
) {
  return postIdentityBroker<BrokerResponse>(origin, '/v1/shared/redeem', input, options);
}
