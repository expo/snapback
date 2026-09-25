import type { Refusal, Write } from "./contract.ts";
import type { WriteHistory } from "./writes.ts";
import type { Queued } from "./local-types.ts";

type Terminal = Exclude<Write, { state: "pending" }>;
type Call = (request: Record<string, unknown>) => Promise<{ denied?: Refusal }>;

// @ref LLP 3000.013#6 — persist known terminal custody before sync or replay;
// both success and refusal retain their original outcome after a failed save.
export async function settleReceipt(history: WriteHistory, call: Call, write: Terminal, revalidatedStore?: string): Promise<void> {
  await history.keep(write, revalidatedStore);
  const applied = await call({ op: "settle", id: write.id, ...(write.state === "sent" ? { seq: write.seq } : {}) });
  if (applied.denied) throw new Error(applied.denied.message);
}

export function successSequence(entry?: Queued): number | undefined {
  const seq = entry?.receipt_store?.success_seq;
  return seq != null && (entry?.sent_seq === seq || entry?.observed_seq === seq) ? seq : undefined;
}

export async function recoverReceipt(history: WriteHistory, call: Call, id: string, observedSeq?: number | null, qualified = false): Promise<Terminal | undefined> {
  const known = observedSeq == null ? await history.read(id, true) : await history.acknowledged(id, observedSeq, qualified);
  if (!known || known.state === "pending") return;
  // read() preserves known outcomes through storage failure. It does not prove
  // durability: keep() must succeed before the outbox or transport can advance.
  await settleReceipt(history, call, known);
  return known;
}
