export type IdentityProvider = 'apple' | 'google';

export type BrokerResponse = Readonly<{
  exchange: Readonly<{ challengeId: string; code: string }>;
  profile: Readonly<{
    displayName: string;
    handle: string;
    avatarUrl: string;
    provider: IdentityProvider;
  }>;
}>;

type FetchLike = (input: string, init: RequestInit) => Promise<Response>;

export async function postIdentityBroker(
  origin: string,
  path: string,
  body: object,
  options: Readonly<{ fetchImpl?: FetchLike; timeoutMs?: number }> = {},
): Promise<BrokerResponse> {
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
    const result = await response.json();
    if (!response.ok) {
      const message = result?.diagnostic?.message ?? `Identity broker refused with HTTP ${response.status}`;
      throw new Error(message);
    }
    return result as BrokerResponse;
  } catch (error) {
    if (controller.signal.aborted) throw timeoutError;
    throw error;
  } finally {
    clearTimeout(timer);
  }
}
