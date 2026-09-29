import { WebDevice } from "./wasm/snapback4_device.js";
import { cachedWasm, wasmMemoryBytes } from "./web-wasm.ts";
import { indexedDbStore } from "./web-idb.ts";
import { WebResidency } from "./web-residency.ts";
import type { Change } from "./web.ts";
import type { DeviceOpening } from "./local-device.ts";
import type { DeviceControlSnapshot } from "./device-control.ts";
import type { Queued } from "./local-types.ts";
import type { WorkerWasmSource } from "./web-worker-host.ts";

export interface WorkerRequest {
  id: number;
  action: "open" | "invoke" | "commit" | "prepare-conditional" | "finish-conditional";
  name?: string;
  backend?: DeviceOpening | null;
  wasm?: WorkerWasmSource;
  request?: Record<string, unknown>;
  extra?: Change[];
}

// Internal execution primitive, deliberately not a DeviceCore. An invoke is
// private until commit completes; the page's host must not publish it early.
// @ref LLP 3000.008.004#3 — a failed strict save discards the uncommitted VM.
export class WorkerRuntime {
  private readonly persist = indexedDbStore(async () => { throw new Error("only the page may claim a device store"); });
  private readonly residency = new WebResidency();
  private device: WebDevice | undefined;
  private name: string | undefined;
  private acquisition = 0;
  private queuedRevision = 0;
  private control: DeviceControlSnapshot | undefined;
  private conditional: Change[] | undefined;

  async execute(message: WorkerRequest): Promise<unknown> {
    if (message.action === "open") {
      if (this.name || !message.name) throw new Error("the Worker opens exactly one claimed store");
      this.name = message.name;
      await cachedWasm(message.wasm ?? new URL("./wasm/snapback4_device_bg.wasm", import.meta.url), this.persist);
      const saved = await this.persist.load(this.name);
      this.device = new WebDevice(message.backend ? JSON.stringify(message.backend) : null, JSON.stringify(saved.filter(c => c.s !== "j")));
      this.residency.reset(saved);
      const changes = await this.commit([]);
      // No row images, staging or large change vector reaches the page.
      return { journal: [...this.journalChanges(saved), ...changes], control: this.control };
    }
    if (!this.device || !this.name) throw new Error("the Worker device must be restored before another call");
    if (message.action === "finish-conditional") {
      if (!this.conditional) throw new Error("no conditional commit was prepared");
      this.residency.apply(this.conditional); this.conditional = undefined;
      this.updateControl();
      return { journal: [], control: this.control };
    }
    if (this.conditional) throw new Error("a conditional commit must finish before another Worker operation");
    if (message.action === "prepare-conditional") {
      const changes = JSON.parse(this.device.drain()) as Change[];
      // Only a delivery CAS can use the page's current() closure. Full row,
      // staging and outbox vectors always stay in this realm.
      if (changes.some(c => c.s !== "m" || !c.k.startsWith("device:delivery:"))) throw new Error("conditional Worker commit contains non-delivery changes");
      this.conditional = changes;
      return { changes };
    }
    if (message.action === "invoke") {
      if (message.request?.op === "residency") return { ok: this.residency.snapshot(wasmMemoryBytes()) };
      return JSON.parse(this.device.call(JSON.stringify(message.request)));
    }
    if (message.action === "commit") {
      const journal = await this.commit(message.extra ?? []);
      return { journal, control: this.control };
    }
    throw new Error("unknown Worker command");
  }

  private journalChanges(changes: Change[]): Change[] {
    return changes.filter(c => c.s === "j" || c.s === "o" || (c.s === "m" && ["device:store_id", "device:deferred:identity", "device:backend-identity", "client:identity-admissions"].includes(c.k)));
  }

  private async commit(extra: Change[]): Promise<Change[]> {
    // Only journal transfer/cleanup may be added by this page protocol. The
    // device itself produces every row, outbox and metadata change.
    if (extra.some(c => c.s !== "j")) throw new Error("only journal acknowledgements may accompany a Worker commit");
    const changes = [...JSON.parse(this.device!.drain()) as Change[], ...extra];
    if (changes.length) await this.persist.save(this.name!, changes);
    this.residency.apply(changes);
    if (changes.some(c => c.s === "o")) this.queuedRevision++;
    this.updateControl();
    return this.journalChanges(changes);
  }

  private updateControl(): void {
    const invoke = (request: Record<string, unknown>) => JSON.parse(this.device!.call(JSON.stringify(request))).ok;
    const state = invoke({ op: "sync_state", capture: false });
    const entries = invoke({ op: "queued" }) as Queued[];
    const predictions = new Set<string>();
    let unknown = false;
    for (const entry of entries) if (entry.predictable === true && entry.observed_seq == null) {
      if (!Array.isArray(entry.predicted)) unknown = true;
      else for (const row of entry.predicted) {
        const slash = row.indexOf("/");
        if (slash <= 0) unknown = true; else predictions.add(row.slice(0, slash));
      }
    }
    if (!this.control || state.store_id !== this.control.store_id || state.transfer_store_id !== this.control.transfer_store_id
      || state.generation !== this.control.generation || state.acquired !== this.control.acquired) this.acquisition++;
    const { store_id, transfer_store_id, generation, acquired, backend_required, restore_refusal,
      watermark, transfer_watermark, restore_watermark, restore_images_at, send_revision } = state;
    this.control = { store_id, transfer_store_id, generation, acquired, backend_required, restore_refusal,
      watermark, transfer_watermark, restore_watermark, restore_images_at, send_revision,
      acquisition: this.acquisition, queuedRevision: this.queuedRevision,
      issuedFloor: Number(invoke({ op: "meta", key: "server-clock-floor" }) ?? 0), predictions: unknown ? null : [...predictions] };
  }

  discard(): void { this.device?.free(); this.device = undefined; }
}

/** The entry does no persistence before the page receives the lifetime-lock
 * acknowledgement and explicitly opens its claimed store. */
export function serveWorker(scope: Pick<Worker, "postMessage" | "addEventListener">): void {
  let attached = false;
  let owned = false;
  const runtime = new WorkerRuntime();
  let chain = Promise.resolve();
  scope.addEventListener("message", (event: MessageEvent) => {
    const message = event.data;
    if (!attached) {
      if (message?.action !== "attach" || typeof message.lease !== "string") return;
      attached = true;
      void navigator.locks.request(message.lease, async () => {
        owned = true;
        scope.postMessage({ id: message.id, ok: true });
        // The page terminates this Worker. It must observe this lock release
        // before passing the IndexedDB barrier or releasing its store claim.
        await new Promise(() => {});
      });
      return;
    }
    if (!owned) return;
    chain = chain.then(async () => {
      try { scope.postMessage({ id: message.id, ok: await runtime.execute(message) }); }
      catch (error) {
        runtime.discard();
        scope.postMessage({ id: message.id, error: String((error as Error)?.message ?? error) });
      }
    });
  });
}
