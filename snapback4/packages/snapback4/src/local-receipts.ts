import type { Refusal, Write } from "./contract.ts";
import type { WriteHistory, MutationIds } from "./writes.ts";
import type { Queued } from "./local-types.ts";

type Terminal = Exclude<Write, { state: "pending" }>;
type Call = (request: Record<string, unknown>) => Promise<{ denied?: Refusal }>;

export async function readQueued(call: (request: Record<string, unknown>) => Promise<{ ok?: unknown; denied?: Refusal }>, mutationIds: MutationIds, history: WriteHistory): Promise<Queued[]> {
  const answer = await call({ op: "queued" });
  if (answer.denied) throw new Error(`${answer.denied.code}: ${answer.denied.message}`);
  const entries = (answer.ok as Queued[] | undefined) ?? [];
  for (const entry of entries) mutationIds.remember(entry.id, entry.op, entry.args);
  history.retainEmissions(entries.map(entry => entry.id));
  return entries;
}

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

// @ref LLP 3000.013#6 — shared lookup is never settlement authority. Orphan
// adoption can add custody while lookup awaits history; recompute locally.
export async function lookupWrite(history: WriteHistory, queued: () => Promise<Queued[]>, id: string, unavailable: () => unknown, acquired: () => boolean): Promise<Write | undefined> {
  if (unavailable()) return;
  let entry = (await queued()).find(entry => entry.id === id);
  if (unavailable()) return;
  let receipt: Write | undefined;
  if (!entry) {
    receipt = await history.lookup(id);
    if (unavailable()) return;
    const adopted = (await queued()).find(entry => entry.id === id);
    entry = adopted;
  }
  if (unavailable()) return;
  if (entry) {
    const seq = entry.sent_seq ?? entry.observed_seq;
    receipt = seq == null ? await history.read(id) : await history.acknowledged(id, seq, successSequence(entry) != null).catch(() => history.read(id));
  }
  if (unavailable()) return;
  if (!entry || (receipt && receipt.state !== "pending")) return receipt;
  return receipt ?? { state: "pending", id, ...(!entry.predictable && !entry.predicted.length
    ? { reason: !acquired() ? "queued without a row: not acquired yet" : "queued without a row: local data does not justify prediction" } : {}) };
}
