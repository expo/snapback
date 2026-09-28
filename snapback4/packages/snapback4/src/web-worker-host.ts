import type { Change, PersistenceClaim } from "./web.ts";
import type { DeviceOpening } from "./local-device.ts";
import type { JournalInvoke } from "./web-journal-execution.ts";
import { indexedDbStore } from "./web-idb.ts";
import { PageDeviceControl } from "./device-control.ts";

type Reply = Record<string, any>;
export type WorkerWasmSource = string | BufferSource | WebAssembly.Module;
export interface WorkerTransaction {
  readonly journal: readonly Change[];
  invoke: JournalInvoke;
  /** The marker and admission are in this one strict transaction. Returned
   * changes contain only journal acknowledgements and the store identity. */
  commit(extra?: Change[], durable?: () => void): Promise<Change[]>;
  commitIf(current: () => boolean): Promise<void>;
}
export class StaleWorkerCommit extends Error {}

// @ref LLP 3000.007#20.4 — the page claim outlives Worker termination and IDB writes.
// Internal foundation for the browser opener, not yet a public DeviceCore.
// The caller owns page capture/authority and must use transaction() for each
// complete call. No injected Persistence functions cross postMessage.
export class WebWorkerHost {
  readonly control = new PageDeviceControl();
  private activity = 0;
  get revision(): number { return this.activity; }
  invalidatePreparation(): void { this.activity++; }
  private worker: Worker | undefined;
  private lease: string | undefined;
  private attached = false;
  private sequence = 0;
  private readonly pending = new Map<number, { resolve(value: Reply): void; reject(error: Error): void }>();
  private chain: Promise<unknown> = Promise.resolve();
  private closing: Promise<void> | undefined;
  private readonly journal = new Map<string, Change>();
  private stopping: Promise<void> | undefined;
  private opened = false;
  private opening: Promise<Change[]> | undefined;
  private released: Promise<void> | undefined;

  constructor(private readonly claim: PersistenceClaim,
    private readonly createWorker = () => new Worker(new URL("./web-worker-entry.js", import.meta.url), { type: "module" })) {}

  open(backend: DeviceOpening | null = null, wasm?: WorkerWasmSource): Promise<Change[]> {
    if (this.opening || this.closing) return Promise.reject(new Error("the Worker host is already open or closed"));
    this.opening = (async () => {
      try { const saved = await this.start(backend, wasm); this.opened = true; return saved; }
      catch (error) {
        await this.stop();
        await this.release();
        this.closing ??= Promise.resolve();
        throw error;
      }
    })();
    this.chain = this.opening.catch(() => {});
    return this.opening;
  }

  private release(): Promise<void> { return this.released ??= this.claim.release(); }

  private wasm: WorkerWasmSource | undefined;
  private async start(backend: DeviceOpening | null, wasm = this.wasm): Promise<Change[]> {
    this.wasm = wasm;
    // A replacement Worker PAGE must wait too: navigation can release its store
    // claim before the old Worker's termination/IDB cleanup has completed.
    this.lease = `snapback4-worker:${encodeURIComponent(this.claim.name)}`;
    this.attached = false;
    const worker = this.worker = this.createWorker();
    worker.addEventListener("message", event => {
      if (this.worker !== worker) return;
      const reply = event.data, pending = this.pending.get(reply?.id);
      if (!pending) return;
      this.pending.delete(reply.id);
      if (reply.error) pending.reject(new Error(reply.error)); else pending.resolve(reply.ok);
    });
    const failed = () => {
      if (this.worker !== worker) return;
      // An error between RPCs invalidates the transaction too. Do not let a
      // later commit publish memory left by a failed Worker task.
      void this.stop().catch(() => {}); // Failure keeps the page claim held.
    };
    worker.addEventListener("error", failed);
    worker.addEventListener("messageerror", failed);
    await this.rpc({ action: "attach", lease: this.lease });
    this.attached = true;
    const reply = await this.rpc({ action: "open", name: this.claim.name, backend, ...(wasm ? { wasm } : {}) });
    this.journal.clear();
    this.remember(reply.journal);
    this.control.publish(reply.control);
    return [...this.journal.values()];
  }

  private remember(changes: Change[]): void {
    for (const change of changes) {
      const key = JSON.stringify([change.s, change.k]);
      if (change.v === null) this.journal.delete(key); else this.journal.set(key, change);
      if (change.s === "j" && change.v !== null && !change.k.startsWith("exit:")) this.control.admitted(change.k);
    }
  }

  /** Called by the page's serialized ownership protocol. A failed transaction
   * rejects, even if its commit happened before a lost reply. The next call
   * first restores durable state under the same page claim. */
  transaction<T>(work: (transaction: WorkerTransaction) => Promise<T>): Promise<T> {
    this.activity++;
    if (this.closing || !this.opened) return Promise.reject(new Error("the device is closed or has not opened"));
    const result = this.chain.then(async () => {
      try { if (!this.worker) { await this.stopping; await this.start(null); } }
      catch (error) { await this.stop(); throw error; }
      let active = true, dirty = false;
      const unblock: (() => void)[] = [];
      const owner = this.worker;
      const journal = this.journal;
      const check = () => { if (!active || this.worker !== owner) throw new Error("the Worker transaction has ended"); };
      const transaction: WorkerTransaction = {
        get journal() { return [...journal.values()]; },
        invoke: async request => {
          check(); dirty = true;
          const state = this.control.read(), page = request.page as Record<string, unknown> | undefined;
          const staging = request.op === "apply" && state && !state.acquired && page?.store_id === (state.transfer_store_id ?? state.store_id)
            && page?.generation === state.generation;
          if (!staging && !["state", "sync_state", "query", "backend", "meta", "queued", "residency", "next_submission"].includes(String(request.op))) unblock.push(this.control.block());
          return this.rpc({ action: "invoke", request });
        },
        commit: async (extra = [], durable) => {
          check();
          const reply = await this.rpc({ action: "commit", extra });
          dirty = false;
          durable?.();
          this.remember(reply.journal);
          this.control.publish(reply.control);
          return reply.journal;
        },
        commitIf: async current => {
          check();
          const prepared = await this.rpc({ action: "prepare-conditional" });
          const persistence = indexedDbStore(async () => null);
          // @ref LLP 3000.022#4 — current() stays in its page realm and runs
          // inside the live IDB transaction immediately before explicit commit.
          // The Worker waits privately; abort/failure discards its mutated VM.
          if (!await persistence.saveIfCurrent!(this.claim.name, prepared.changes, current)) throw new StaleWorkerCommit();
          const reply = await this.rpc({ action: "finish-conditional" });
          dirty = false;
          this.control.publish(reply.control);
        },
      };
      try {
        const value = await work(transaction);
        check();
        if (dirty) throw new Error("a Worker transaction must commit before returning its result");
        return value;
      } catch (error) { await this.stop(); throw error; }
      finally { active = false; for (const done of unblock) done(); }
    });
    this.chain = result.catch(() => {});
    return result;
  }

  private rpc(message: Record<string, unknown>): Promise<any> {
    if (!this.worker) return Promise.reject(new Error("the device Worker is unavailable"));
    const id = ++this.sequence;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      try { this.worker!.postMessage({ ...message, id }); }
      catch (error) { this.pending.delete(id); reject(error); }
    });
  }

  private rejectPending(error: Error): void {
    for (const pending of this.pending.values()) pending.reject(error);
    this.pending.clear();
  }

  private stop(): Promise<void> {
    this.activity++;
    this.control.discard();
    if (this.stopping) return this.stopping;
    const worker = this.worker, lease = this.lease, attached = this.attached;
    this.worker = undefined;
    this.attached = false;
    worker?.terminate();
    this.rejectPending(new Error("the device Worker stopped"));
    // Terminate is a request, not an IDB durability acknowledgement. Wait for
    // the old realm's lifetime lock, then queue behind its outstanding writes.
    // A read transaction sees either the complete strict commit or its abort.
    const stopped = (async () => {
      if (!attached || !lease) return; // No open dispatched before attach.
      await navigator.locks.request(lease, async () => {
        const persist = indexedDbStore(async () => null);
        await persist.read!(this.claim.name, "m", "device:store_id");
        await persist.read!("snapback4-wasm", "url", typeof this.wasm === "string" ? this.wasm : "");
      });
    })().then(() => { this.stopping = undefined; });
    // Keep a failed barrier sticky. A later close/restore must not infer that
    // the old store is quiescent merely because the Worker reference is gone.
    this.stopping = stopped;
    return stopped;
  }

  /** Interrupt execution without releasing the page claim. Durable restore is
   * mandatory before the next transaction; the interrupted result rejects. */
  terminate(): Promise<void> { return this.stop(); }

  close(): Promise<void> {
    return this.closing ??= this.chain.then(async () => {
      // A failed/terminated owner keeps custody through durable restoration,
      // even when close is the next operation rather than another device call.
      if (this.opened && !this.worker) {
        await this.stopping;
        try { await this.start(null); }
        catch (error) { await this.stop(); throw error; }
      }
      await this.stop();
      await this.release();
    });
  }
}
