import type { Refusal } from "./contract.ts";
import type { DeviceCore } from "./local.ts";

/** Server acquisition markers, applied before events[at]. A missing floor
 * begins a group; completion carries "whole" or a delivered readable index key. */
export interface AcquisitionMarker {
  at: number;
  table: string;
  index: string;
  group: unknown[];
  floor?: string;
}
export interface SyncPage extends Record<string, unknown> {
  /** Pinned authoritative time, committed by the device with this page. */
  now?: number;
  images_at?: number;
  committed_above?: Record<string, number>;
  /** Cursor echoed by the server; the device validates snapshot continuity. */
  after?: string | null;
  acquisitions?: AcquisitionMarker[];
}

// 0.2.32 denies unknown SyncRequest fields, but hides serde's reason behind
// this exact input refusal. A successful stripped retry distinguishes an old
// parser from a bad cursor, limit or pending id with the same refusal.
export const legacyInputRefusal = { denied: { code: "E_INPUT", family: "input",
  message: "sync needs { from, limit, after, stream, pending }: nonnegative integers, a cursor or null, a boolean, and at most 256 ids of 1..128 UTF-8 bytes" } };

async function legacyInput(response: Response): Promise<boolean> {
  const reply = await response.clone().json().catch(() => null);
  return reply != null && Object.keys(reply).length === 1 && reply.denied != null
    && Object.keys(reply.denied).length === 3
    && Object.entries(legacyInputRefusal.denied).every(([key, value]) => reply.denied[key] === value);
}

export function syncTransport(doFetch: typeof fetch) {
  const legacyOrigins = new Set<string>();
  return async (url: string, init: RequestInit, body: Record<string, unknown>): Promise<Response> => {
    let origin = url;
    try {
      const base = globalThis.document?.baseURI ?? globalThis.location?.href;
      if (base) origin = new URL(url, base).origin;
    } catch { /* Without a usable base, discovery stays keyed by the caller's URL. */ }
    const { generation: _, ...withoutGeneration } = body;
    const attempt = legacyOrigins.has(origin) ? withoutGeneration : body;
    const sentGeneration = Object.hasOwn(attempt, "generation") && attempt.generation !== undefined;
    const response = await doFetch(url, { ...init, body: JSON.stringify(attempt) });
    if (sentGeneration && response.status === 400 && await legacyInput(response)) {
      const retry = await doFetch(url, { ...init, body: JSON.stringify(withoutGeneration) });
      if (retry.ok) legacyOrigins.add(origin);
      return retry;
    }
    return response;
  };
}

export async function requireSyncProtocol(core: DeviceCore): Promise<void> {
  // A JavaScript update can run inside an older Expo development build.
  // Probe without sending or changing an outbox entry, even when offline.
  const reply = await core.call({ op: "sync_state", capture: false });
  const denied = reply?.denied as Refusal | undefined;
  if (denied && typeof denied.code === "string" && denied.code !== "E_OP") throw new Error(`createLocalClient: ${denied.code}: native startup failed: ${denied.message}`);
  const state = reply?.ok as Record<string, unknown> | undefined;
  const uint = (value: unknown): value is number => typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
  if (denied || !state || typeof state.backend_required !== "boolean" || typeof state.acquired !== "boolean" || !(state.store_id === null || typeof state.store_id === "string") || !uint(state.watermark) || !uint(state.generation) || !uint(state.send_revision) || !uint(state.restore_watermark) || !uint(state.restore_images_at) || !state.adoption_capture || typeof state.adoption_capture !== "object" || Array.isArray(state.adoption_capture) || !Array.isArray(state.pending_ids) || state.pending_ids.length > 256 || !state.pending_ids.every((id) => typeof id === "string" && id.length > 0)) {
    throw new Error("createLocalClient: E_DEVICE_VERSION: the device lacks the sync receipt protocol this client speaks. Update the device to match the client: rebuild the app's native binary for snapback4-expo (reloading JavaScript does not update a native module), or serve the wasm this package version ships.");
  }
}
