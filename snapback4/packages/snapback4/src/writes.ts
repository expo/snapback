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

/** Client receipts, separate from the executable outbox. Persist before retiring
 * an entry, so a reopen can still name its outcome after the row has gone. */
export class WriteHistory {
  private values = new Map<string, Write>();
  private terminal = new Set<string>();
  private persisted = new Set<string>();
  private emitted = new Set<string>();
  constructor(private storage?: Storage) {}

  remember<T extends Write>(write: T): T {
    if (write.state !== "pending" || !this.values.has(write.id)) this.values.set(write.id, write.state === "pending" ? write : receipt(write));
    if (write.state !== "pending") {
      this.terminal.add(write.id);
      if (this.terminal.size > WRITE_HISTORY_LIMIT) {
        const oldest = this.terminal.values().next().value!;
        this.terminal.delete(oldest); this.values.delete(oldest); this.persisted.delete(oldest);
      }
    }
    return write;
  }

  async keep(write: Terminal): Promise<void> {
    await this.storage?.save(JSON.stringify(receipt(write)));
    if (this.storage) this.persisted.add(write.id);
    this.remember(write);
  }

  async read(id: string): Promise<Write | undefined> {
    const saved = await this.storage?.read();
    const current = this.values.get(id);
    const durable = saved ? (JSON.parse(saved) as Terminal[]).find(write => write.id === id) : undefined;
    if (durable) return durable;
    if (this.persisted.has(id)) return undefined;
    return current;
  }

  firstEmission(id: string): boolean {
    if (this.emitted.has(id)) return false;
    this.emitted.add(id);
    if (this.emitted.size > WRITE_HISTORY_LIMIT) this.emitted.delete(this.emitted.values().next().value!);
    return true;
  }
}
