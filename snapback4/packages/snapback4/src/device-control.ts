import type { StoreCapture } from "./local-types.ts";
import { restoreFloor, restoreRefusal } from "./device-restore.ts";

/** Internal page authority for server-answered cold-acquisition watches. */
export const deviceControl = Symbol.for("snapback4.deviceControl");
export interface DeviceControlSnapshot extends StoreCapture {
  generation: number;
  acquired: boolean;
  acquisition: number;
  queuedRevision: number;
  issuedFloor: number;
  /** null means unknown, never an empty footprint. */
  predictions: readonly string[] | null;
}
export interface ColdReadControl {
  current(): boolean;
  pending(tables: Set<string> | null): boolean;
}

export function coldSnapshot(read: (() => DeviceControlSnapshot | undefined) | undefined, eligible: boolean, generation: number) {
  const snapshot = eligible ? read?.() : undefined;
  if (!snapshot || snapshot.acquired || snapshot.backend_required || snapshot.restore_refusal
    || snapshot.generation !== generation || !(snapshot.transfer_store_id ?? snapshot.store_id)) return;
  return { snapshot, control: coldReadControl(() => read?.(), snapshot) };
}

export function coldReplyStatus(control: DeviceControlSnapshot, json: Record<string, unknown>): "match" | "unusable" | "restore" {
  // Bypass answers never collect supplementary delivery manifests. A proven
  // regression must survive even if the next reply's head has refilled.
  delete json.delivery;
  const head = json.head ?? json.seq;
  if (json.store_id !== (control.transfer_store_id ?? control.store_id) || !Number.isSafeInteger(head) || Number(head) < 0) return "unusable";
  return Number(head) < restoreFloor(control) ? "restore" : "match";
}

// @ref LLP 3000.007#20.4 — capture fences the page before asynchronous admission.
export class PageDeviceControl {
  private durable: DeviceControlSnapshot | undefined;
  private revision = 0;
  private readonly pendingAdmissions = new Set<string>();
  private barriers = 0;
  private restoredStore: string | undefined;

  publish(snapshot: DeviceControlSnapshot): void {
    if (snapshot.queuedRevision !== this.durable?.queuedRevision) this.revision++;
    this.durable = Object.freeze({ ...snapshot, predictions: snapshot.predictions === null ? null : Object.freeze([...snapshot.predictions]) });
  }
  capture(id: string): void { this.pendingAdmissions.add(id); this.revision++; }
  admitted(id: string): void { if (this.pendingAdmissions.delete(id)) this.revision++; }
  block(): () => void {
    this.barriers++; this.revision++;
    let ended = false;
    return () => { if (!ended) { ended = true; this.barriers--; this.revision++; } };
  }
  discard(): void { this.durable = undefined; this.revision++; }
  refuseRestore(storeId: string): void { this.restoredStore = storeId; this.revision++; }
  read(): DeviceControlSnapshot | undefined {
    if (!this.durable) return;
    return { ...this.durable, queuedRevision: this.revision,
      ...(this.restoredStore !== undefined && (this.durable.transfer_store_id ?? this.durable.store_id) === this.restoredStore ? { restore_refusal: restoreRefusal() } : {}),
      predictions: this.pendingAdmissions.size || this.barriers ? null : this.durable.predictions };
  }
}

/** A read is bound to this acquisition and queue, not to each staged page. */
export function coldReadControl(read: () => DeviceControlSnapshot | undefined, captured: DeviceControlSnapshot): ColdReadControl {
  return {
    current() {
      const now = read();
      return !!now && !now.acquired && !now.backend_required && !now.restore_refusal
        && now.store_id === captured.store_id && now.transfer_store_id === captured.transfer_store_id
        && now.generation === captured.generation && now.acquisition === captured.acquisition
        && now.queuedRevision === captured.queuedRevision && now.send_revision === captured.send_revision
        && now.issuedFloor === captured.issuedFloor;
    },
    pending(tables) { return captured.predictions === null || captured.predictions.some(table => tables === null || tables.has(table)); },
  };
}
