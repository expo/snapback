import type { Refusal, Write } from "./contract.ts";
import type { WriteHistory } from "./writes.ts";

type Terminal = Exclude<Write, { state: "pending" }>;
type Call = (request: Record<string, unknown>) => Promise<{ denied?: Refusal }>;

// @ref LLP 3000.013#6 — persist known terminal custody before sync or replay;
// both success and refusal retain their original outcome after a failed save.
export async function settleReceipt(history: WriteHistory, call: Call, write: Terminal): Promise<void> {
  await history.keep(write);
  const applied = await call({ op: "settle", id: write.id, ...(write.state === "sent" ? { seq: write.seq } : {}) });
  if (applied.denied) throw new Error(applied.denied.message);
}

export async function recoverReceipt(history: WriteHistory, call: Call, id: string, observedSeq?: number | null): Promise<Terminal | undefined> {
  const known = observedSeq == null ? await history.read(id, true) : await history.acknowledged(id, observedSeq);
  if (!known || known.state === "pending") return;
  // read() preserves known outcomes through storage failure. It does not prove
  // durability: keep() must succeed before the outbox or transport can advance.
  await settleReceipt(history, call, known);
  return known;
}
