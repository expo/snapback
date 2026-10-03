// The link watchdog belongs to the transport, shared by both client tiers.
// A stalled fetch must not depend on the host eventually rejecting it.
import { sampleChanges } from "./clock.ts";
import type { EphemeralVersion } from "./ephemeral-reads.ts";
import type { Refusal } from "./contract.ts";

const SILENCE_MS = 4000;
const HEARTBEAT_SECONDS = 2;
interface Change { preserved?: unknown; ephemeral?: EphemeralVersion & { tables: string[] }; serverNow?: number; clockRevision?: string; seq: number; tables: string[]; generation?: number; store_id?: string; denied?: Refusal }

export function changeFeed(doFetch: typeof fetch, base: string, lifetime: AbortSignal, offline: () => void, online: () => void) {
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
    const seconds = streaming ? wait : Math.min(wait, HEARTBEAT_SECONDS);
    arm();
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
