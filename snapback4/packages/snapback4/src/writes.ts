import type { Write } from "./contract.ts";

type Terminal = Exclude<Write, { state: "pending" }>;
interface Storage {
  read(): Promise<string | null>;
  save(value: string): Promise<void>;
}

export const WRITE_HISTORY_LIMIT = 256;

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

function refused(id: string, code: string, message: string): Write {
  return { state: "failed", id: typeof id === "string" ? id : "", why: { code, family: "input", message, guide: "writes" } };
}

/** Reservations are synchronous, so fresh web submissions reach the admission
 * journal before mutate returns. Only IDs survive receipt eviction; input
 * identities are bounded like receipts and historical results are never kept. */
export class MutationIds {
  private seen = new Set<string>();
  private submissions = new Map<string, Submission>();
  private terminal = new Set<string>();

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
    if (typeof id !== "string" || !/^[0-7][0-9A-HJKMNP-TV-Z]{25}$/.test(id)) return Promise.resolve(refused(id, "E_WRITE_ID", "write id must be 26 uppercase Crockford base32 digits, starting with 0–7 (the mintId() form)") as Write<R>);
    let snapshot: unknown, key: string;
    try { snapshot = JSON.parse(JSON.stringify(args)); key = inputKey(op, snapshot); }
    catch { return Promise.resolve(refused(id, "E_INPUT", "mutation arguments must be JSON-serializable") as Write<R>); }
    let entry = this.submissions.get(id);
    if (entry?.key !== undefined && entry.key !== key) return Promise.resolve(refused(id, "E_WRITE_ID_REUSE", "write id already belongs to a different operation or arguments; retry the original input or use a new id") as Write<R>);
    if (this.seen.has(id)) {
      if (!entry) { entry = {}; this.submissions.set(id, entry); }
      const held = entry;
      return (async () => {
        await held.running;
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
    held.running = running;
    void running.then(write => { if (write.state !== "pending") this.finish(id); }, () => {}).finally(() => { delete held.running; });
    return running;
  }
}

// @ref LLP 3000.007#17 — recovering by id confirms execution, never historical result values.
function receipt(write: Terminal): Terminal {
  return write.state === "sent"
    ? { state: "sent", id: write.id, seq: write.seq, replayed: true }
    : { state: "failed", id: write.id, why: { code: write.why.code, family: write.why.family, message: `write refused: ${write.why.code}` } };
}

/** Persist before retiring an outbox entry. Durable receipts are read straight
 * from the device; values holds only session outcomes (online/mock writes and
 * local refusals before admission). Server event ids follow the outbox. */
export class WriteHistory {
  private values = new Map<string, Write>();
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
        this.terminal.delete(oldest); this.values.delete(oldest); this.emitted.delete(oldest);
      }
    }
    return write;
  }

  async keep(write: Terminal): Promise<void> {
    if (this.storage) {
      await this.storage.save(JSON.stringify(receipt(write)));
      this.values.delete(write.id); this.terminal.delete(write.id);
    } else this.remember(write);
  }

  async read(id: string): Promise<Write | undefined> {
    const saved = await this.storage?.read();
    // @ref LLP 3000.007#20.4 — the device owns the receipt window; memory never retains a second server history.
    const durable = saved ? (JSON.parse(saved) as Terminal[]).find(write => write.id === id) : undefined;
    if (durable) { this.values.delete(id); this.terminal.delete(id); }
    return durable ?? this.values.get(id);
  }

  retainEmissions(queued: Iterable<string>): void {
    const retained = new Set(queued);
    for (const id of this.values.keys()) retained.add(id);
    for (const id of this.emitted) if (!retained.has(id)) this.emitted.delete(id);
  }

  firstEmission(id: string): boolean {
    if (this.emitted.has(id)) return false;
    this.emitted.add(id);
    if (!this.storage && this.emitted.size > WRITE_HISTORY_LIMIT) this.emitted.delete(this.emitted.values().next().value!);
    return true;
  }
}
