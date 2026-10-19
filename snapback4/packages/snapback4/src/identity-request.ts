// @ref LLP 3000.000.000.001#9-wave-19-identity-retry-and-local-production-lifecycle — retry only a delivered pre-admission identity refusal.
import { readResponse, refusal, retryAfter } from "./http-response.ts";
export interface IdentityRetryOptions {
  /** Whole sign-in deadline including rate-limit waits; default 180 seconds. */
  readonly timeoutMs?: number;
  /** Cancels the current request and any rate-limit wait. */
  readonly signal?: AbortSignal;
}
function pause(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const abort = () => { clearTimeout(timer); signal.removeEventListener("abort", abort); reject(signal.reason ?? new Error("identity request aborted")); };
    const timer = setTimeout(() => { signal.removeEventListener("abort", abort); resolve(); }, ms);
    signal.addEventListener("abort", abort, {once:true});
    if (signal.aborted) abort();
  });
}
/** Never retries a lost response, malformed envelope, non-429 or non-identity refusal. */
export async function identityRequest(url: string, init: RequestInit, fetcher: typeof fetch, options: IdentityRetryOptions = {}) {
  const timeout = options.timeoutMs ?? 180_000;
  if (!Number.isSafeInteger(timeout) || timeout < 1 || timeout > 2_147_483_647) throw new RangeError("identity timeoutMs must be an integer from 1 to 2147483647");
  const end = performance.now() + timeout, controller = new AbortController();
  const abort = () => controller.abort(options.signal?.reason);
  options.signal?.addEventListener("abort", abort, {once:true});
  if (options.signal?.aborted) abort();
  const timer = setTimeout(() => controller.abort(Object.assign(new Error("identity deadline exceeded"), {code:"E_IDENTITY_TIMEOUT"})), timeout);
  try {
    for (let attempt = 0; ; attempt++) {
      if (controller.signal.aborted) throw controller.signal.reason;
      const response = await fetcher(url, {...init, signal:controller.signal});
      const json = await readResponse(response), why = refusal(json.denied);
      if (response.status !== 429 || why?.code !== "E_RATE_LIMIT" || why.family !== "auth" || why.retryable === false || attempt === 3) return {response, json};
      const header = response.headers.get("retry-after")?.trim();
      const validHeader = header !== undefined && (/^\d+(?:\.\d+)?$/.test(header) || /^[A-Za-z]{3}, /.test(header) && Number.isFinite(Date.parse(header)));
      const delay = why.retryAfterMs ?? (validHeader ? retryAfter(header!) : 1000);
      if (delay >= end - performance.now()) return {response, json};
      await pause(Math.max(1, delay), controller.signal);
    }
  } finally {
    clearTimeout(timer); options.signal?.removeEventListener("abort", abort);
  }
}
