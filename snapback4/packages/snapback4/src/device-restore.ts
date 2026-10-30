import type { Refusal } from "./contract.ts";
import type { StoreCapture } from "./local-types.ts";

/** Internal host custody of a restore proved while the device is busy. */
export const deviceRestore = Symbol.for("snapback4.deviceRestore");
export interface RestoreEvidence { storeId: string; head: number; capture: StoreCapture; bindUnidentified?: boolean }
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

/** Deliver an already-proved shrink using current device transaction guards. */
export async function persistRestoreObservation(call: (request: Record<string, unknown>) => Promise<{ ok?: unknown; denied?: Refusal }>, proof: RestoreEvidence): Promise<void> {
  const capture = async () => {
    const { ok, denied } = await call({ op: "sync_state", capture: false });
    if (denied || !ok) throw new Error("cannot persist the captured restore observation");
    return ok as StoreCapture & { generation: number; restore_refusal?: Refusal };
  };
  let state = await capture();
  if (proof.bindUnidentified && !(state.transfer_store_id ?? state.store_id)) {
    // First progressive sync: bind the authenticated store through the existing
    // observation operation before recording its proven shrink. No rows apply.
    const bound = await call(restoreObservation(proof.storeId, proof.head, state, state.generation));
    if (bound.denied) throw new Error(bound.denied.message);
    state = await capture();
  }
  if ((state.transfer_store_id ?? state.store_id) !== proof.storeId || state.restore_refusal) return;
  const rebound = { ...proof.capture, watermark: state.watermark, send_revision: state.send_revision,
    restore_watermark: restoreFloor(proof.capture) };
  const result = await call(restoreObservation(proof.storeId, proof.head, rebound, state.generation));
  if (result.denied?.code !== "E_STORE_RESTORE") throw new Error("the captured restore proof was not persisted");
}

// @ref LLP 3000.001#repair-b-never-install-a-confirmed-image-over-a-row-a-live-prediction-writes — observations keep their captured private progress and image heads.
export function restoreWitness(call: (request: Record<string, unknown>) => Promise<{ denied?: Refusal }>,
  generation: () => number, refuse: (denied?: Refusal) => void, available: () => void,
  persistOnline?: (evidence: RestoreEvidence) => Promise<void>) {
  return async (storeId: unknown, head: unknown, capture: StoreCapture, onlineHead?: number): Promise<boolean> => {
    if (!Number.isSafeInteger(head) || Number(head) < 0) return true;
    if (typeof storeId !== "string" || storeId !== (capture.transfer_store_id ?? capture.store_id)) return false;
    // Progressive reads already witnessed this same store before dispatch.
    // The witness must fence a proven shrink even before a device exists;
    // a fresh device's empty watermark cannot erase that evidence.
    if (onlineHead !== undefined && Number(head) < onlineHead) {
      refuse(restoreRefusal());
      await persistOnline?.({ storeId, head: Number(head), capture: { ...capture, restore_watermark: Math.max(restoreFloor(capture), onlineHead) }, bindUnidentified: true });
      return true;
    }
    const observed = await call(restoreObservation(storeId, Number(head), capture, generation()));
    if (observed.denied) { refuse(observed.denied); return true; }
    available(); return false;
  };
}
