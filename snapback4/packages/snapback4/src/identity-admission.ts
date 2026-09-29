import type { BackendJson } from "./backend.ts";
import type { StoreCapture } from "./local-types.ts";
import type { PendingWrite, Refusal, Write } from "./contract.ts";

// @ref LLP 3000.007#20.4 — identification waits in memory; custody starts at ordinary admission.
export const IDENTITY_WAIT_MS = 15_000;
export const identityRefusal = (timeout: boolean): Refusal => ({
  code: timeout ? "E_ADMISSION_TIMEOUT" : "E_ADMISSION_STORE", family: "store", site: "client.mutate", guide: "writes",
  message: timeout ? "This write could not identify its backend within 15 seconds and was not admitted or sent. Reconnect, then submit a new attempt."
    : "The backend changed or could not be revalidated before admission. Review the current backend, then submit a new attempt.",
  rewrite: timeout ? "check the connection and backend URL, then submit with a new write id" : "reload the current backend and review the draft before submitting with a new write id",
});
const reason = "waiting for backend identification; not yet admitted";

/** This is caller state, never an outbox. The lane ends at ordinary admission,
 * so receipt waits cannot reorder later calls or hold their admission open. */
export class IdentityWait {
  private calls = new Map<string, PendingWrite>();
  private tail: Promise<void> = Promise.resolve();
  private admitting = false;
  private admissionListeners = new Set<() => void>();
  private stopped = new AbortController();
  constructor(private readonly notify: () => void) {}
  get size(): number { return this.calls.size; }
  pending(admitted: readonly PendingWrite[] = []): PendingWrite[] {
    return [...admitted, ...[...this.calls.values()].filter(e => !admitted.some(a => a.id === e.id))];
  }
  write(id: string): Promise<Write> | undefined {
    return this.calls.has(id) ? Promise.resolve({ state: "pending", id, reason }) : undefined;
  }
  visible(admitted: readonly PendingWrite[], available: boolean): PendingWrite[] { return available ? this.pending(admitted) : []; }
  close(why: Refusal = { code: "E_CLOSED", family: "client", message: "This client closed before the write was admitted; submit again on an open client." }): void {
    this.calls.clear(); this.stopped.abort(why);
  }
  run<R>(entry: { id: string; op: string; args: unknown }, check: () => Promise<boolean | Refusal>,
    admit: (release: () => void) => Promise<Write<R>>, refused: (why: Refusal) => Write<R>): Promise<Write<R>> {
    let deadline = Date.now() + IDENTITY_WAIT_MS;
    const previous = this.tail;
    let release!: () => void;
    let ordinary = false, released = false;
    const admitted = new Promise<void>(resolve => { release = () => {
      if (released) return;
      released = true;
      if (ordinary) {
        this.admitting = false;
        for (const changed of this.admissionListeners) changed();
      }
      this.calls.delete(entry.id); this.notify(); resolve();
    }; });
    this.tail = previous.then(() => admitted);
    this.calls.set(entry.id, { ...entry, args: JSON.parse(JSON.stringify(entry.args)), state: "held", predicted: [], reason });
    queueMicrotask(this.notify);
    return (async () => {
      let timer: ReturnType<typeof setTimeout> | undefined;
      let wake: ReturnType<typeof setTimeout> | undefined;
      let stop!: () => void;
      let interrupt!: (why: Refusal) => void;
      const interrupted = new Promise<Refusal>(resolve => {
        interrupt = resolve;
        timer = setTimeout(() => resolve(identityRefusal(true)), IDENTITY_WAIT_MS);
        stop = () => resolve(this.stopped.signal.reason as Refusal);
        this.stopped.signal.addEventListener("abort", stop, { once: true });
        if (this.stopped.signal.aborted) stop();
      });
      let waitingForTurn = false, pausedAt: number | undefined;
      const admissionChanged = () => {
        if (waitingForTurn && this.admitting) {
          if (pausedAt === undefined) { pausedAt = Date.now(); clearTimeout(timer); }
        } else if (pausedAt !== undefined) {
          deadline += Date.now() - pausedAt; pausedAt = undefined;
          timer = setTimeout(() => interrupt(identityRefusal(true)), Math.max(0, deadline - Date.now()));
        }
      };
      this.admissionListeners.add(admissionChanged);
      const clear = () => {
        clearTimeout(timer); clearTimeout(wake); this.admissionListeners.delete(admissionChanged);
        this.stopped.signal.removeEventListener("abort", stop);
      };
      try {
        for (;;) {
          const ready = await Promise.race([check().catch(() => false), interrupted]);
          if (typeof ready !== "boolean") return refused(ready);
          if (Date.now() >= deadline) return refused(identityRefusal(true));
          if (ready) {
            // The queue can contain identity reads as well as ordinary admissions.
            // Only the actual admission intervals pause a ready caller's budget.
            waitingForTurn = true; admissionChanged();
            const prior = await Promise.race([previous, interrupted]);
            waitingForTurn = false; admissionChanged();
            if (prior) return refused(prior);
            const current = await Promise.race([check().catch(() => identityRefusal(false)), interrupted]);
            if (Date.now() >= deadline) return refused(identityRefusal(true));
            if (typeof current !== "boolean") return refused(current);
            if (current) {
              clear(); ordinary = true; this.admitting = true;
              for (const changed of this.admissionListeners) changed();
              return await admit(release);
            }
          }
          const timeout = await Promise.race([new Promise<void>(resolve => { wake = setTimeout(resolve, 25); }), interrupted]);
          if (timeout) return refused(timeout);
        }
      } finally { clear(); release(); }
    })();
  }
}

export function checkLocalIdentity(state: StoreCapture | undefined, generation: number, expectedStore: string | undefined,
  changed: boolean, unavailable: Refusal | null): boolean | Refusal {
  if (unavailable) return unavailable.code === "E_STORE_RESTORE" ? identityRefusal(false) : unavailable;
  if (!state) return false;
  const actual = state.store_id ?? state.transfer_store_id;
  if (state.restore_refusal || changed || state.generation !== generation
    || (actual && expectedStore && actual !== expectedStore)) return identityRefusal(false);
  return !!state.store_id && !state.backend_required;
}

/** Pin the first successful read, even when the cached backend has no store id. */
export function localAdmissionIdentity(captured: BackendJson | null, generation: number) {
  // Native descriptors can be filled in after an offline open without replacing the backend.
  const key = (backend: BackendJson | null) => JSON.stringify([backend?.schema, backend?.programs]);
  const capturedKey = key(captured), expectedStore = captured?.store_id;
  let pinned: { store: string; backend: string | undefined } | undefined;
  return {
    fields: () => ({ expected_store: pinned?.store, expected_generation: generation, expected_backend: pinned?.backend }),
    check(state: StoreCapture | undefined, backend: BackendJson | null, currentGeneration: number, unavailable: Refusal | null) {
      const fingerprint = state?.adoption_capture?.["device:backend-identity"] ?? undefined;
      const ready = checkLocalIdentity(state, generation, pinned?.store ?? expectedStore,
        key(backend) !== capturedKey || currentGeneration !== generation || (pinned !== undefined && pinned.backend !== fingerprint), unavailable);
      if (ready === true) pinned ??= { store: state!.store_id!, backend: fingerprint };
      return ready;
    },
  };
}
