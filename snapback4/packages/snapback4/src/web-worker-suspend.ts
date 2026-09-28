import { afterStoreLock } from "./app-storage.ts";
import type { PendingSend } from "./local-exit.ts";
import { successSequence } from "./local-receipts.ts";
import type { Queued } from "./local-types.ts";
import type { DeviceControlSnapshot } from "./device-control.ts";
import { AdmissionJournal, journalStoreBinding } from "./web-journal.ts";
import { WebWorkerHost } from "./web-worker-host.ts";

type Prepared = { entry: PendingSend; revision: number; control: DeviceControlSnapshot };

// @ref LLP 3000.007#20.4 — prepare the send fence durably before teardown.
// No device call (including a new sync capture) may start after preparation.
// Thus every older sync has the preceding send_revision; a newer capture
// synchronously cancels this permission before it can reach the Worker.
export class WebWorkerSuspend {
  private prepared: Prepared | undefined;
  private stopped = false;
  private readonly listeners = new Set<() => void>();
  private readonly stops = new Set<() => void>();
  constructor(private readonly host: WebWorkerHost, private readonly journal: AdmissionJournal) {}

  /** Called after outbox changes, not after every sync capture (which would
   * continually invalidate acquisition). An unprepared head stays durable. */
  async prepare(): Promise<void> {
    this.prepared = undefined;
    if (this.stopped) return;
    const work = this.host.transaction(async tx => {
      this.journal.load([...tx.journal]);
      const state = (await tx.invoke({ op: "sync_state", capture: false })).ok;
      const entries = (await tx.invoke({ op: "queued" })).ok as Queued[];
      const head = entries.filter(e => successSequence(e) == null).sort((a, b) => a.seq - b.seq)[0];
      if (!head || state?.backend_required || state?.restore_refusal
        || journalStoreBinding(this.journal.boundStore(head.id), state?.store_id) !== "allow") {
        await tx.commit(); return;
      }
      const started = await tx.invoke({ op: "begin_send", id: head.id });
      this.journal.remember(await tx.commit());
      if (started.denied) return;
      return { id: head.id, op: head.op, args: head.args, newIds: head.new_ids,
        store_id: head.receipt_store?.id ?? this.journal.boundStore(head.id) } satisfies PendingSend;
    });
    const revision = this.host.revision;
    const entry = await work, control = this.host.control.read();
    if (this.stopped || !entry || !control || this.host.revision !== revision) return;
    this.prepared = { entry, control, revision };
    afterStoreLock(this.journal.authority?.capture().key, () => { for (const notify of this.listeners) notify(); });
  }

  private current(prepared: Prepared): boolean {
    const now = this.host.control.read(), old = prepared.control;
    return !this.stopped && this.host.revision === prepared.revision && !!now
      && now.store_id === old.store_id && now.transfer_store_id === old.transfer_store_id
      && now.generation === old.generation && now.acquisition === old.acquisition
      && now.queuedRevision === old.queuedRevision && now.send_revision === old.send_revision
      && now.issuedFloor === old.issuedFloor && !now.backend_required && !now.restore_refusal;
  }

  dispatch(flush: (entries: readonly PendingSend[], beginSend: () => boolean) => void): void {
    const prepared = this.prepared;
    if (!prepared || !this.current(prepared)) return;
    flush([prepared.entry], () => {
      if (this.prepared !== prepared || !this.current(prepared)) return false;
      // The client checks live credentials in this same stack. The exit
      // record precedes transport; the Worker already committed begin_send.
      if (!this.journal.captureExit(prepared.entry.id)) return false;
      this.prepared = undefined;
      return true;
    });
  }

  onSuspend(flush: (entries: readonly PendingSend[], beginSend: () => boolean) => void): () => void {
    let suspended = document.visibilityState === "hidden";
    const dispatch = () => { if (suspended) this.dispatch(flush); };
    const hide = () => { suspended = true; dispatch(); };
    const show = () => { suspended = false; };
    const visibility = () => { if (document.visibilityState === "hidden") hide(); else show(); };
    const stop = () => {
      window.removeEventListener("pagehide", hide); window.removeEventListener("pageshow", show);
      document.removeEventListener("visibilitychange", visibility);
      this.listeners.delete(dispatch); this.stops.delete(stop);
    };
    window.addEventListener("pagehide", hide); window.addEventListener("pageshow", show);
    document.addEventListener("visibilitychange", visibility);
    this.listeners.add(dispatch); this.stops.add(stop); dispatch();
    return stop;
  }
  close(): void { this.stopped = true; this.prepared = undefined; for (const stop of this.stops) stop(); }
}
