// @ref LLP 3000.008.002.000#6 — ranged downloads cannot consume a one-view grant.
import type { Refusal } from "./contract.ts";
import { invalidResponse, jitter, overloaded, refusal, retryAfter, transportRefusal } from "./http-response.ts";

const retryTimes = new WeakMap<Refusal, number>();
export const assetRetryAt = (why: Refusal): number => retryTimes.get(why) ?? 0;
export const assetError = (why: Refusal): boolean => ["E_OFFLINE", "E_HTTP_RESPONSE", "E_RATE_LIMIT", "E_CLIENT"].includes(why.code);
const stopped = (): Refusal => ({ code: "E_AUTH", family: "auth", message: "the client or session changed during download", retryable: false });
const timeout = () => new Error("asset download made no observable progress for 5000 ms");

/** Six transfers per client; waiting calls are abortable and never share URLs,
 * bytes, grants or outcomes. A permit spans response-body consumption. */
export function assetQueue() {
  let active = 0;
  const waiting: (() => void)[] = [];
  return async (signal: AbortSignal): Promise<(() => void) | undefined> => {
    if (signal.aborted) return;
    if (active >= 6) {
      const admitted = await new Promise<boolean>(resolve => {
        const enter = () => { signal.removeEventListener("abort", abort); resolve(true); };
        const abort = () => { const index = waiting.indexOf(enter); if (index >= 0) waiting.splice(index, 1); resolve(false); };
        waiting.push(enter); signal.addEventListener("abort", abort, { once: true });
      });
      if (!admitted) return;
    } else active++;
    return () => { const next = waiting.shift(); if (next) next(); else active--; };
  };
}
type Queue = ReturnType<typeof assetQueue>;

/** Also settles for custom/native fetch implementations that ignore abort.
 * Late responses are disposed and never become handles or retained bytes. */
function bounded<T>(promise: Promise<T>, signal: AbortSignal, dispose: (value: T) => void): Promise<T> {
  return new Promise((resolve, reject) => {
    const abort = () => reject(signal.reason ?? timeout());
    if (signal.aborted) abort(); else signal.addEventListener("abort", abort, { once: true });
    promise.then(value => {
      signal.removeEventListener("abort", abort);
      if (signal.aborted) dispose(value); else resolve(value);
    }, error => { signal.removeEventListener("abort", abort); reject(error); });
  });
}
const closeBlob = (blob: Blob) => { try { (blob as Blob & { close?(): void }).close?.(); } catch {} };
const closeResponse = (response: Response) => {
  try {
    if (response.body) void response.body.cancel().catch(() => {});
    // Native fetch may return already-buffered bytes without a stream. Take
    // ownership only to close them; never allocate a URL or retain this body.
    else void response.blob().then(closeBlob, () => {});
  } catch { /* A disposed response must not replace the caller's outcome. */ }
};
function pause(ms: number, signal: AbortSignal) {
  return new Promise<void>(resolve => {
    const done = () => { clearTimeout(timer); signal.removeEventListener("abort", done); resolve(); };
    const timer = setTimeout(done, ms);
    if (signal.aborted) done(); else signal.addEventListener("abort", done, { once: true });
  });
}

/** Streaming hosts report byte progress. Buffered native hosts expose only
 * the fetch/Blob completion, so their opaque waits retain the stall bound. */
async function readBlob(response: Response, signal: AbortSignal, progress: () => void): Promise<Blob> {
  if (!response.body) return bounded(response.blob(), signal, closeBlob);
  const reader = response.body.getReader(), chunks: Uint8Array<ArrayBuffer>[] = [];
  let complete = false;
  try {
    for (;;) {
      const { done, value } = await bounded(reader.read(), signal, () => {});
      if (done) { complete = true; break; }
      if (value.byteLength) { chunks.push(value as Uint8Array<ArrayBuffer>); progress(); }
    }
    return new Blob(chunks, { type: response.headers.get("content-type") ?? "" });
  } finally {
    if (!complete) void reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}

export async function downloadAsset(source: { uri: string; headers: Record<string, string> }, doFetch: typeof fetch,
  signal?: AbortSignal, current: () => boolean = () => true, queue?: Queue,
): Promise<{ blob: Blob; response: Response } | { denied: Refusal }> {
  const lifetime = new AbortController();
  const end = () => lifetime.abort(signal?.reason);
  signal?.addEventListener("abort", end, { once: true });
  if (signal?.aborted) end();
  // Bound admission/backoff without imposing a total duration on healthy
  // streams. Every nonempty body chunk renews this inactivity deadline.
  let deadline: ReturnType<typeof setTimeout>;
  const progress = () => {
    clearTimeout(deadline);
    deadline = setTimeout(() => lifetime.abort(new Error("asset download made no byte progress for 30000 ms including queue wait")), 30_000);
  };
  progress();
  let ranged = true, waited = 0;
  let previous: Refusal | undefined;
  try {
    for (let attempt = 0; ; attempt++) {
      if (!current() || signal?.aborted) return { denied: previous ?? stopped() };
      const release = queue ? await queue(lifetime.signal) : () => {};
      let why: Refusal | undefined, retryAt = 0, transient = false;
      const request = new AbortController();
      const abort = () => request.abort(lifetime.signal.reason);
      lifetime.signal.addEventListener("abort", abort, { once: true });
      if (lifetime.signal.aborted) abort();
      let timer: ReturnType<typeof setTimeout>;
      const activity = () => { clearTimeout(timer); timer = setTimeout(() => request.abort(timeout()), 5000); };
      activity();
      let response: Response | undefined, bodyStarted = false;
      try {
        if (!current() || signal?.aborted) return { denied: previous ?? stopped() };
        if (request.signal.aborted || !release) throw request.signal.reason ?? timeout();
        response = await bounded(doFetch(source.uri, { headers: { ...source.headers, ...(ranged ? { range: "bytes=0-" } : {}) }, signal: request.signal }), request.signal, closeResponse);
        activity();
        if (response.ok) {
          bodyStarted = true;
          const blob = await readBlob(response, request.signal, () => { activity(); progress(); });
          return { blob, response };
        }
        // Headers survive a missing/stalled refusal body. An HTTP status alone
        // does not prove a non-range one-view request was refused at admission.
        retryAt = Date.now() + retryAfter(response.headers.get("retry-after"));
        why = invalidResponse(response.status, "download");
        transient = [408, 429, 500, 502, 503, 504].includes(response.status);
        bodyStarted = true;
        const json = response.body
          ? JSON.parse(await (await readBlob(response, request.signal, () => {})).text()) as { denied?: unknown } | null
          : await bounded(response.json(), request.signal, () => {}) as { denied?: unknown } | null;
        const explicit = refusal(json?.denied);
        why = explicit ?? invalidResponse(response.status, "download");
        if (ranged && why.code === "E_ASSET_RANGE") {
          // The server has proved no once bytes were delivered. Exactly one
          // non-range transfer follows; only admission refusals may replay it.
          ranged = false; attempt--; continue;
        }
        transient = overloaded(why) || (!explicit && [408, 429, 500, 502, 503, 504].includes(response.status));
      } catch (error) {
        if (!why) { why = transportRefusal(error); transient = true; }
      } finally {
        clearTimeout(timer!); lifetime.signal.removeEventListener("abort", abort);
        if (request.signal.aborted && response && !bodyStarted) closeResponse(response);
        release?.();
      }
      if (!transient && !assetError(why)) return { denied: why };
      const safe = transient && (ranged || overloaded(why));
      why = { ...why, retryable: safe };
      if (!ranged && !overloaded(why) && assetError(why)) why = { ...why, message: why.message + "; a one-view response may have been consumed; it will not be retried automatically" };
      const delay = jitter(Math.max(250 * 2 ** attempt, retryAt - Date.now()));
      retryTimes.set(why, retryAt);
      previous = why;
      if (!safe || attempt >= 3 || waited + delay > 10_000 || lifetime.signal.aborted || !current()) return { denied: why };
      await pause(delay, lifetime.signal); waited += delay;
    }
  } finally { clearTimeout(deadline!); signal?.removeEventListener("abort", end); }
}
