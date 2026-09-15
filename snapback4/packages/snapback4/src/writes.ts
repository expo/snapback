import type { Write } from "./contract.ts";

type Terminal = Exclude<Write, { state: "pending" }>;
interface Storage {
  read(id: string): Promise<string | null>;
  save(id: string, value: string): Promise<void>;
}

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
  constructor(private storage?: Storage) {}

  remember<T extends Write>(write: T): T {
    if (write.state !== "pending" || !this.values.has(write.id)) this.values.set(write.id, write.state === "pending" ? write : receipt(write));
    return write;
  }

  async keep(write: Terminal): Promise<void> {
    await this.storage?.save(write.id, JSON.stringify(receipt(write)));
    this.remember(write);
  }

  async read(id: string): Promise<Write | undefined> {
    const saved = await this.storage?.read(id);
    const current = this.values.get(id);
    if (current && current.state !== "pending") return current;
    if (saved) return this.remember(JSON.parse(saved) as Terminal);
    return current;
  }
}
