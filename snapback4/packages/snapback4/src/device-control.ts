import type { StoreCapture } from "./local-types.ts";

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

export function coldReplyMatches(control: DeviceControlSnapshot, json: Record<string, unknown>): boolean {
  // Bypass answers never collect supplementary delivery manifests. Restore
  // and adoption run on the ordinary device path; a foreign or regressed
  // reply cannot publish while that path waits behind acquisition.
  delete json.delivery;
  const head = json.head ?? json.seq;
  const floor = Math.max(control.watermark, control.restore_watermark ?? control.transfer_watermark ?? 0, control.restore_images_at ?? 0);
  return json.store_id === (control.transfer_store_id ?? control.store_id) && Number.isSafeInteger(head) && Number(head) >= floor;
}

// @ref LLP 3000.007#20.4 — capture fences the page before asynchronous admission.
export class PageDeviceControl {
  private durable: DeviceControlSnapshot | undefined;
  private revision = 0;
  private readonly pendingAdmissions = new Set<string>();
  private barriers = 0;

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
  read(): DeviceControlSnapshot | undefined {
    if (!this.durable || this.barriers) return;
    return { ...this.durable, queuedRevision: this.revision,
      predictions: this.pendingAdmissions.size ? null : this.durable.predictions };
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
