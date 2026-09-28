import type { Write } from "./contract.ts";
import { WRITE_HISTORY_LIMIT } from "./writes.ts";
import type { Persistence } from "./web.ts";
import { claimStore } from "./web-ownership.ts";

type TerminalReceipt = Exclude<Write, { state: "pending" }>;

export function terminalReceipts(text: string | null | undefined): TerminalReceipt[] {
  if (!text) return [];
  // Only value-free terminal records cross tab boundaries, never outbox data.
  return (JSON.parse(text) as Write[]).flatMap(write => write.state === "sent"
    ? [{ state: "sent", id: write.id, seq: write.seq, replayed: true } as TerminalReceipt]
    : write.state === "failed" ? [{ state: "failed", id: write.id, why: { code: write.why.code, family: write.why.family, message: `write refused: ${write.why.code}` } } as TerminalReceipt] : []);
}

export async function receiptHistory(persist: Persistence, name: string): Promise<TerminalReceipt[]> {
  const shared = `${name}:receipts`;
  // Adoption requires enumeration too. Recheck existence on each lookup so a
  // sibling's later adoption is visible, but a read never creates the window.
  const exists = persist.has ? await persist.has(shared) : (await persist.others?.(shared))?.includes(shared);
  if (!exists) return [];
  const text = persist.read ? await persist.read(shared, "m", "client:write-history")
    : (await persist.load(shared)).find(c => c.s === "m" && c.k === "client:write-history")?.v;
  return terminalReceipts(text);
}

const unknownOutcome = (write: TerminalReceipt) => write.state === "failed" && write.why.code === "E_STORE_REPLACED";

// @ref LLP 3000.013#6 — a caller's lookup applies adoption's correction rule.
// A shared, verified outcome resolves this client's own unknown replacement
// refusal; every other local outcome wins over shared history.
export function lookupReceipts(shared: TerminalReceipt[], local: TerminalReceipt[]): TerminalReceipt[] {
  const merged = new Map(shared.map(write => [write.id, write]));
  for (const write of local) {
    const prior = merged.get(write.id);
    if (prior && unknownOutcome(write) && !unknownOutcome(prior)) continue;
    merged.set(write.id, write);
  }
  return [...merged.values()];
}

export async function shareReceipts(persist: Persistence, name: string, text: string): Promise<boolean> {
  const held = await claimStore(persist, `${name}:receipts`, false);
  if (!held) return false;
  try {
    const kept = await receiptHistory(persist, name);
    const positions = new Map(kept.map((write, index) => [write.id, index]));
    for (const write of terminalReceipts(text)) {
      const index = positions.get(write.id);
      if (index === undefined) { positions.set(write.id, kept.length); kept.push(write); }
      // @ref LLP 3000.013#6 — a verified outcome resolves replacement's unknown
      // execution. The source device already validated the correction before
      // persisting it; adoption must keep it before deleting that source.
      else {
        const prior = kept[index]!;
        if (unknownOutcome(prior)) kept[index] = write;
      }
    }
    // Corrections retain their position; authored outcomes remain immutable.
    await persist.save(`${name}:receipts`, [{ s: "m", k: "client:write-history", v: JSON.stringify(kept.slice(-WRITE_HISTORY_LIMIT)) }]);
    return true;
  } finally { await held.release(); }
}

