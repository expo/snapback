import { failedAdmission } from "./admission.ts";
import type { Write } from "./contract.ts";

type Terminal = Exclude<Write, { state: "pending" }>;
interface Storage {
  read(): Promise<string | null>;
  save(value: string): Promise<void>;
}

export const WRITE_HISTORY_LIMIT = 256;

/** Same bounded wait as actions; undefined preserves the tier's default. */
export function mutationWaitSeconds(wait: number | undefined): number | undefined {
  return wait === undefined ? undefined : Math.max(0, Math.min(25, Math.floor(Number.isFinite(wait) ? wait : 25)));
}

type PendingWrite = Extract<Write, { state: "pending" }>;
interface Submission {
  key?: string;
  pending?: PendingWrite;
  running?: Promise<Write>;
}

function inputKey(op: string, args: unknown): string {
  const sorted = (value: unknown): unknown => Array.isArray(value) ? value.map(sorted)
    : value && typeof value === "object" ? Object.fromEntries(Object.entries(value).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0).map(([key, child]) => [key, sorted(child)])) : value;
  return JSON.stringify([op, sorted(args)]);
}

function refused(id: string, code: string, message: string): Extract<Write, { state: "failed" }> {
  return { state: "failed", id: typeof id === "string" ? id : "", why: { code, family: "input", message, guide: "writes" } };
}

/** Reservations are synchronous, so fresh web submissions reach the admission
 * journal before mutate returns. Only IDs survive receipt eviction; input
 * identities are bounded like receipts and historical results are never kept. */
export class MutationIds {
  private seen = new Set<string>();
  private submissions = new Map<string, Submission>();
  private terminal = new Set<string>();

  knows(id: string): boolean { return this.seen.has(id); }

  remember(id: string, op?: string, args?: unknown): void {
    if (this.seen.has(id)) return;
    this.seen.add(id);
    if (op !== undefined) this.submissions.set(id, { key: inputKey(op, args) });
  }

  finish(id: string): void {
    this.seen.add(id);
    const entry = this.submissions.get(id);
    if (entry) delete entry.pending;
    this.terminal.add(id);
    if (this.terminal.size > WRITE_HISTORY_LIMIT) {
      const oldest = this.terminal.values().next().value!;
      this.terminal.delete(oldest); this.submissions.delete(oldest);
    }
  }

  run<R>(id: string, op: string, args: unknown, recover: () => Promise<Write | undefined>, submit: (args: unknown, pending: PendingWrite) => Promise<Write<R>>): Promise<Write<R>> {
    if (typeof id !== "string" || !/^[0-7][0-9A-HJKMNP-TV-Z]{25}$/.test(id)) return failedAdmission<R>(id, refused(id, "E_WRITE_ID", "write id must be 26 uppercase Crockford base32 digits, starting with 0–7 (the mintId() form)").why);
    let snapshot: unknown, key: string;
    try { snapshot = JSON.parse(JSON.stringify(args)); key = inputKey(op, snapshot); }
    catch { return failedAdmission<R>(id, refused(id, "E_INPUT", "mutation arguments must be JSON-serializable").why); }
    let entry = this.submissions.get(id);
    if (entry?.key !== undefined && entry.key !== key) return failedAdmission<R>(id, refused(id, "E_WRITE_ID_REUSE", "write id already belongs to a different operation or arguments; retry the original input or use a new id").why);
    if (this.seen.has(id)) {
      if (!entry) { entry = {}; this.submissions.set(id, entry); }
      const held = entry;
      // Overlapping callers own this submission's result. A later invocation
      // uses receipt recovery; close cannot erase an already-shared outcome.
      if (held.running) return held.running as Promise<Write<R>>;
      return (async () => {
        const write = await recover();
        if (write?.state === "pending") return held.pending ??= write;
        if (write) { this.finish(id); return write; }
        this.submissions.delete(id);
        return refused(id, "E_WRITE_RECEIPT_EXPIRED", "this client already used the write id, but its receipt is no longer retained; reopen the client to ask the server for the original outcome");
      })() as Promise<Write<R>>;
    }
    this.seen.add(id);
    const pending: PendingWrite = { state: "pending", id };
    entry = { key, pending };
    this.submissions.set(id, entry);
    const held = entry;
    const running = submit(snapshot, pending);
    // Synchronous refusal happened before any custody or dispatch. Keeping
    // this reservation would make the documented same-id retry impossible.
    const immediate = running as Promise<Write<R>> & { state?: string; why?: { code: string } };
    if (immediate.state === "failed" && immediate.why?.code === "E_ADMISSION") {
      this.seen.delete(id); this.submissions.delete(id); this.terminal.delete(id);
      return running;
    }
    held.running = running;
    void running.then(write => {
      delete held.running;
      if (write.state === "failed" && write.why.code === "E_WRITE_ID_REUSE" && write.why.family === "input") {
        // Another owner won durable admission. This reservation never owned
        // the id; the next call must recover/compare the original input.
        this.seen.delete(id); this.submissions.delete(id);
      } else if (write.state !== "pending") this.finish(id);
    }, () => { delete held.running; });
    return running;
  }
}

// @ref LLP 3000.007#17 — recovering by id confirms execution, never historical result values.
function receipt(write: Terminal): Terminal {
  return write.state === "sent"
    ? { state: "sent", id: write.id, seq: write.seq, replayed: true }
    : { state: "failed", id: write.id, why: { code: write.why.code, family: write.why.family, message: ["E_STORE_REPLACED", "E_STORE_RESTORE"].includes(write.why.code) ? `write refused: ${write.why.code}; whether it executed is unknown; do not retry automatically` : `write refused: ${write.why.code}` } };
}

/** Persist before retiring an outbox entry. Durable receipts are read straight
 * from the device; values holds only session outcomes (online/mock writes and
 * local refusals before admission). Server event ids follow the outbox. */
export class WriteHistory {
  private values = new Map<string, Write>();
  private unpersisted = new Map<string, Terminal>();
  private terminal = new Set<string>();
  private emitted = new Set<string>();
  constructor(private storage?: Storage) {}

  remember<T extends Write>(write: T): T {
    // Durable clients read pending from the outbox; another owner may retire it.
    if (this.storage && write.state === "pending") return write;
    if (write.state !== "pending" || !this.values.has(write.id)) this.values.set(write.id, write.state === "pending" ? write : receipt(write));
    if (write.state !== "pending") {
      this.terminal.add(write.id);
      if (this.terminal.size > WRITE_HISTORY_LIMIT) {
        const oldest = this.terminal.values().next().value!;
        this.terminal.delete(oldest); this.values.delete(oldest);
        if (!this.unpersisted.has(oldest)) this.emitted.delete(oldest);
      }
    }
    return write;
  }

  async keep(write: Terminal): Promise<void> {
    write = this.unpersisted.get(write.id) ?? write;
    if (this.storage) {
      this.unpersisted.set(write.id, receipt(write));
      await this.storage.save(JSON.stringify(receipt(write)));
      this.unpersisted.delete(write.id);
      this.values.delete(write.id); this.terminal.delete(write.id);
    } else this.remember(write);
  }

  hasUnpersisted(id?: string): boolean { return id === undefined ? this.unpersisted.size > 0 : this.unpersisted.has(id); }

  async acknowledged(id: string, seq: number): Promise<Terminal> {
    // A replacement refusal says execution is unknown. A correlated outbox
    // acknowledgement proves it; discard the speculative refusal before read
    // can retry its save. Older servers also acknowledged refused _ops rows;
    // that sequence must never override a known authored refusal.
    const pending = this.unpersisted.get(id);
    if (pending?.state === "failed" && pending.why.code === "E_STORE_REPLACED") this.unpersisted.delete(id);
    const known = await this.read(id, true);
    if (known?.state === "failed" && known.why.code !== "E_STORE_REPLACED") return known;
    const sent = { state: "sent" as const, id, seq, replayed: true as const };
    if (known?.state === "failed" && known.why.code === "E_STORE_REPLACED") await this.keep(sent);
    return sent;
  }

  // A known result is custody, even when its receipt transaction aborted.
  // Callers must cross this barrier before sync or another delivery can retire it.
  async persistPending(): Promise<void> {
    for (const write of this.unpersisted.values()) await this.keep(write);
  }

  async read(id: string, receiptsOnly = false): Promise<Write | undefined> {
    const known = this.unpersisted.get(id);
    if (known) {
      try { await this.keep(known); } catch { /* The known result survives failed receipt persistence. */ }
      return known;
    }
    const saved = await this.storage?.read();
    // @ref LLP 3000.007#20.4 — the device owns the receipt window; memory never retains a second server history.
    const durable = saved ? (JSON.parse(saved) as Terminal[]).find(write => write.id === id) : undefined;
    if (durable) { this.values.delete(id); this.terminal.delete(id); }
    // A local admission/storage error does not establish the server outcome;
    // its captured journal may still be recoverable and must not be retired.
    return durable ?? (receiptsOnly ? undefined : this.values.get(id));
  }

  retainEmissions(queued: Iterable<string>): void {
    const retained = new Set(queued);
    for (const id of this.values.keys()) retained.add(id);
    for (const id of this.unpersisted.keys()) retained.add(id);
    for (const id of this.emitted) if (!retained.has(id)) this.emitted.delete(id);
  }

  firstEmission(id: string): boolean {
    if (this.emitted.has(id)) return false;
    this.emitted.add(id);
    if (!this.storage && this.emitted.size > WRITE_HISTORY_LIMIT) this.emitted.delete(this.emitted.values().next().value!);
    return true;
  }
}
