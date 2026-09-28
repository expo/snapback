import type { Refusal } from "./contract.ts";
import type { StoreCapture } from "./local-types.ts";

/** Internal host custody of a restore proved while the device is busy. */
export const deviceRestore = Symbol.for("snapback4.deviceRestore");
export interface RestoreEvidence { storeId: string; head: number; capture: StoreCapture }
export type RestoreValidation = { status: "obsolete" } | { status: "refused"; denied: Refusal };
export type RestoreFence = (evidence: RestoreEvidence, validated: (outcome: RestoreValidation) => void) => Promise<void>;
export const restoreFloor = (capture: StoreCapture): number => Math.max(capture.watermark,
  capture.restore_watermark ?? capture.transfer_watermark ?? 0, capture.restore_images_at ?? 0);
export const restoreRefusal = (): Refusal => ({ code: "E_STORE_RESTORE", family: "store", guide: "sync",
  message: "the backend store was restored or shrank below this device's watermark; stop this client and use a fresh device store and outbox" });

// @ref LLP 3000.007#20.4 — unavailable identity fences provisionally until host validation.
export function coldRestoreWitness(fence: RestoreFence, current: () => Refusal | null,
  refuse: (denied: Refusal) => void, retire: () => void) {
  const pending = new Set<object>();
  let provisional: Refusal | undefined;
  return (evidence: RestoreEvidence, identityUnavailable: boolean): Promise<void> => {
    const token = {};
    pending.add(token);
    if (!identityUnavailable) {
      provisional = undefined;
      refuse(restoreRefusal());
    } else if (current()?.code !== "E_STORE_RESTORE") {
      provisional = restoreRefusal();
      refuse(provisional);
    }
    // The host retains this callback across a failed attempt and Worker restart.
    // An obsolete completion cannot clear another pending or confirmed refusal.
    return fence(evidence, outcome => {
      pending.delete(token);
      if (outcome.status === "refused") {
        provisional = undefined;
        refuse(outcome.denied);
      } else if (!pending.size && provisional && current() === provisional) {
        provisional = undefined;
        retire();
      }
    });
  };
}

export function restoreObservation(storeId: string, head: number, capture: StoreCapture, generation: number) {
  return { op: "observe_store", page: { snapshot: false, generation, events: [], watermark: head, more: false, store_id: storeId,
    requested_watermark: capture.restore_watermark ?? capture.transfer_watermark ?? capture.watermark,
    captured_restore_watermark: capture.restore_watermark, captured_restore_images_at: capture.restore_images_at,
    captured_watermark: capture.watermark, send_revision: capture.send_revision } };
}

// @ref LLP 3000.001#repair-b-never-install-a-confirmed-image-over-a-row-a-live-prediction-writes — observations keep their captured private progress and image heads.
export function restoreWitness(call: (request: Record<string, unknown>) => Promise<{ denied?: Refusal }>,
  generation: () => number, refuse: (denied?: Refusal) => void, available: () => void) {
  return async (storeId: unknown, head: unknown, capture: StoreCapture): Promise<boolean> => {
    if (!Number.isSafeInteger(head) || Number(head) < 0) return true;
    if (typeof storeId !== "string" || storeId !== (capture.transfer_store_id ?? capture.store_id)) return false;
    const observed = await call(restoreObservation(storeId, Number(head), capture, generation()));
    if (observed.denied) { refuse(observed.denied); return true; }
    available(); return false;
  };
}
