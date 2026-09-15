import type { Write } from "./contract.ts";

type Terminal = Exclude<Write, { state: "pending" }>;
interface Storage {
  read(): Promise<string | null>;
  save(value: string): Promise<void>;
}

export const WRITE_HISTORY_LIMIT = 256;

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
