import { WebDevice } from "./wasm/snapback4_device.js";
import { cachedWasm, wasmMemoryBytes } from "./web-wasm.ts";
import { indexedDbStore } from "./web-idb.ts";
import { WebResidency } from "./web-residency.ts";
import type { Change } from "./web.ts";
import type { DeviceOpening } from "./local-device.ts";

export interface WorkerRequest {
  id: number;
  action: "open" | "invoke" | "commit";
  name?: string;
  backend?: DeviceOpening | null;
  wasm?: string;
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
      return { journal: [...this.journalChanges(saved), ...changes] };
    }
    if (!this.device || !this.name) throw new Error("the Worker device must be restored before another call");
    if (message.action === "invoke") {
      if (message.request?.op === "residency") return { ok: this.residency.snapshot(wasmMemoryBytes()) };
      return JSON.parse(this.device.call(JSON.stringify(message.request)));
    }
    if (message.action === "commit") return { journal: await this.commit(message.extra ?? []) };
    throw new Error("unknown Worker command");
  }

  private journalChanges(changes: Change[]): Change[] {
    return changes.filter(c => c.s === "j" || (c.s === "m" && c.k === "device:store_id"));
  }

  private async commit(extra: Change[]): Promise<Change[]> {
    // Only journal transfer/cleanup may be added by this page protocol. The
    // device itself produces every row, outbox and metadata change.
    if (extra.some(c => c.s !== "j")) throw new Error("only journal acknowledgements may accompany a Worker commit");
    const changes = [...JSON.parse(this.device!.drain()) as Change[], ...extra];
    if (changes.length) await this.persist.save(this.name!, changes);
    this.residency.apply(changes);
    return this.journalChanges(changes);
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
