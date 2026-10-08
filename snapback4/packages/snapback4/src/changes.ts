// The link watchdog belongs to the transport, shared by both client tiers.
// A stalled fetch must not depend on the host eventually rejecting it.
import { sampleChanges } from "./clock.ts";
import type { EphemeralVersion } from "./ephemeral-reads.ts";
import type { Refusal } from "./contract.ts";
import { retryAfter } from "./http-response.ts";

const SILENCE_MS = 4000;
const HEARTBEAT_SECONDS = 2;
// @ref LLP 3000.036#6-idle-live-clients-must-not-cost-a-thread — a full long-wait bound degrades to unheld polls, never to offline.
/** After E_STREAMS, poll without holding for this long, at the server's Retry-After pace. */
const UNHELD_MS = 30_000;
interface Change { changes?: unknown; preserved?: unknown; ephemeral?: EphemeralVersion & { tables: string[] }; serverNow?: number; clockRevision?: string; seq: number; tables: string[]; generation?: number; store_id?: string; denied?: Refusal }

export function changeFeed(fetchNow: typeof fetch, base: string, lifetime: AbortSignal, offline: () => void, online: () => void) {
  const active = new Set<AbortController>();
  const abort = () => { for (const request of active) request.abort(); };
  const lost = () => { offline(); abort(); };
  const events = typeof globalThis.addEventListener === "function";
  if (events) {
    globalThis.addEventListener("offline", lost);
    globalThis.addEventListener("online", online);
  }
  const close = () => {
    abort();
    if (events) {
      globalThis.removeEventListener("offline", lost);
      globalThis.removeEventListener("online", online);
    }
  };
  lifetime.addEventListener("abort", close, { once: true });
  // E_STREAMS means the host (503) or this principal's share (429) has no
  // room for another held poll. The poll loop already waits Retry-After for
  // the retryable refusal; until UNHELD_MS passes, this feed then asks
  // without `wait` at that pace, so live queries keep learning of commits.
  let unheldUntil = 0, unheldEvery = 0, paceNext = false;
  // The pace is a delay before the request, inside the same fetch promise:
  // the call's own abort ends it, and its silence watchdog starts after it.
  let paced: { ms: number; started: () => void } | undefined;
  const doFetch = (input: string, init: RequestInit): Promise<Response> => {
    const pace = paced;
    paced = undefined;
    if (!pace) return fetchNow(input, init);
    return new Promise<void>(resolve => {
      const signal = init.signal;
      if (signal?.aborted) { resolve(); return; }
      const done = () => { clearTimeout(timer); signal?.removeEventListener("abort", done); resolve(); };
      const timer = setTimeout(done, pace.ms);
      signal?.addEventListener("abort", done, { once: true });
    }).then(() => { pace.started(); return fetchNow(input, init); });
  };
  return async (seq: number, wait: number, headers: Record<string, string>, storeIdentity?: string, ephemeral?: { epoch: number; incarnation: string; tables: string[] }, restart?: AbortSignal) => {
    const controller = new AbortController();
    active.add(controller);
    const reissue = () => controller.abort();
    restart?.addEventListener("abort", reissue, { once: true });
    let timer: ReturnType<typeof setTimeout> | undefined;
    let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
    const aborted = new Promise<never>((_, reject) => {
      controller.signal.addEventListener("abort", () => reject(controller.signal.reason), { once: true });
    });
    const arm = () => {
      clearTimeout(timer);
      timer = setTimeout(() => controller.abort(new Error("changes: no response bytes for 4000 ms")), SILENCE_MS);
    };
    // React Native fetch implementations without response streams buffer the
    // entire body. Use short polls there so a healthy idle link still speaks
    // within the same watchdog interval.
    const streaming = typeof ReadableStream !== "undefined" && typeof Response !== "undefined" && "body" in Response.prototype;
    const unheld = Date.now() < unheldUntil;
    const seconds = unheld ? 0 : streaming ? wait : Math.min(wait, HEARTBEAT_SECONDS);
    if (unheld && paceNext) paced = { ms: unheldEvery, started: arm };
    else arm();
    paceNext = false;
    try {
      if (lifetime.aborted || restart?.aborted) controller.abort();
      const parameters = ephemeral ? `&eph=${ephemeral.epoch}&ephi=${encodeURIComponent(ephemeral.incarnation)}&ephTables=${encodeURIComponent(ephemeral.tables.join(","))}` : "";
      const work = (async () => {
        const response = await doFetch(`${base}/changes?since=${seq}&wait=${seconds}${streaming ? "&heartbeat=1" : ""}${storeIdentity === undefined ? "" : `&store_id=${encodeURIComponent(storeIdentity)}`}${parameters}`, { headers, signal: controller.signal });
        if (controller.signal.aborted) throw controller.signal.reason;
        arm();
        let json: Change;
        if (response.body?.getReader) {
          reader = response.body.getReader();
          const decoder = new TextDecoder();
          let text = "";
          for (;;) {
            const { value, done } = await reader.read();
            if (controller.signal.aborted) throw controller.signal.reason;
            if (done) break;
            if (value.length) arm();
            text += decoder.decode(value, { stream: true });
            if (!text.trim()) text = ""; // discard whitespace heartbeat frames
            if (text.length > 16 * 1024 * 1024) throw new Error("changes: response exceeds 16 MiB");
          }
          json = JSON.parse(text + decoder.decode()) as Change;
        } else json = await response.json() as Change;
        sampleChanges(response, json);
        if (json.denied?.code === "E_STREAMS") {
          unheldUntil = Date.now() + UNHELD_MS;
          unheldEvery = Math.max(1000, retryAfter(response.headers.get("retry-after")));
        } else if (unheld) paceNext = true;
        return { response, json };
      })();
      return await Promise.race([work, aborted]);
    } finally {
      clearTimeout(timer);
      controller.abort();
      void reader?.cancel().catch(() => {});
      active.delete(controller);
      restart?.removeEventListener("abort", reissue);
    }
  };
}
