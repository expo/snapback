import type { Refusal } from "./contract.ts";
import type { StoreCapture } from "./local-types.ts";

/** Internal host custody of a restore proved while the device is busy. */
export const deviceRestore = Symbol.for("snapback4.deviceRestore");
export interface RestoreEvidence { storeId: string; head: number; capture: StoreCapture }
export const restoreFloor = (capture: StoreCapture): number => Math.max(capture.watermark,
  capture.restore_watermark ?? capture.transfer_watermark ?? 0, capture.restore_images_at ?? 0);
export const restoreRefusal = (): Refusal => ({ code: "E_STORE_RESTORE", family: "store", guide: "sync",
  message: "the backend store was restored or shrank below this device's watermark; stop this client and use a fresh device store and outbox" });

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
