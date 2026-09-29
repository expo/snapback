import type { Write } from "./contract.ts";
import type { SessionStore } from "./auth.ts";
import { StorageWarning } from "./app-storage.ts";
import { identityRefusal } from "./identity-admission.ts";
import { mintId } from "./client.ts";
import { WRITE_HISTORY_LIMIT } from "./writes.ts";

export type Intent = { owner: string; id: string; op: string; args: unknown; storeId?: string | null; dispatched?: boolean; holdReason?: string; statusRevision?: string; admissionDeadline?: number };
export type Terminal = Exclude<Write, { state: "pending" }>;
export type Journal = { owner: string; backend: string; pending: Intent[]; receipts: Terminal[]; retired?: string[]; retirementFull?: boolean; firstStore?: string; changedStore?: boolean };

export function observeJournalStore(journal: Journal, store: string): void {
  if (journal.firstStore === undefined) journal.firstStore = store;
  else if (journal.firstStore !== store) journal.changedStore = true;
}

// @ref LLP 3000.013#6 — persist dispatch ownership before the request can execute.
export function bindIntentStore(journal: Journal, intent: Intent, store: string | undefined): Terminal | undefined {
  if (store) observeJournalStore(journal, store);
  // Admission may have survived a crash before dispatch binding. Even then,
  // an unbound intent cannot migrate past the first observed store.
  const mismatched = intent.storeId
    ? intent.storeId !== store
    : journal.changedStore || (journal.firstStore !== undefined && journal.firstStore !== store);
  if (mismatched) {
    const refused: Terminal = { state: "failed", id: intent.id, why: intent.admissionDeadline && !intent.dispatched ? identityRefusal(false) : { code: "E_STORE_REPLACED", family: "store",
      message: "the intent belongs to a different or unprovable store; whether it executed is unknown; do not retry automatically",
      site: "app.mutate", rewrite: "reconcile this write with its original store before submitting new intent", guide: "sync" } };
    journal.pending = journal.pending.filter(entry => entry.id !== intent.id);
    journal.receipts.push(refused);
    keepReceipts(journal, new Set([intent.id]), true);
    return refused;
  }
  intent.storeId = store ?? null;
  delete intent.admissionDeadline;
  intent.dispatched = true;
  delete intent.holdReason;
  // @ref LLP 3000.019#3.3 — even repeated sent status supersedes an unsaved hold in another owner.
  intent.statusRevision = mintId();
}
// Retirement-protected ids have no safe expiry. Keep about 116 KiB at most;
// saturation permanently fences new admissions instead of forgetting an id.
export const RETIRED_ID_LIMIT = 4096;
const unknown = (write: Terminal) => write.state === "failed" && ["E_STORE_REPLACED", "E_STORE_RESTORE"].includes(write.why.code);

export function keepReceipts(journal: Journal, pinned: Set<string>, retiring: boolean): void {
  const removed = new Set<Terminal>();
  let excess = Math.max(0, journal.receipts.length - WRITE_HISTORY_LIMIT);
  // Compact old unknown outcomes first, then evict old ordinary receipts.
  // A bulk retirement exceeding the body window still keeps every retired id.
  for (const eligible of [
    (write: Terminal) => unknown(write) && !pinned.has(write.id),
    (write: Terminal) => !pinned.has(write.id),
    (_write: Terminal) => true,
  ]) for (const write of journal.receipts) {
    if (!excess) break;
    if (!removed.has(write) && eligible(write)) { removed.add(write); excess--; }
  }
  const retired = new Set(journal.retired);
  // R6: an id the server may have executed is never admitted again by this app
  // while its record might matter. Retirement preserves every displaced id;
  // ordinary successful-write history keeps its existing eviction policy.
  for (const write of removed) if ((retiring || unknown(write)) && !journal.retirementFull) {
    if (retired.has(write.id)) continue;
    if (retired.size === RETIRED_ID_LIMIT) journal.retirementFull = true;
    else retired.add(write.id);
  }
  if (retired.size) journal.retired = [...retired];
  journal.receipts = journal.receipts.filter(write => !removed.has(write));
}

export function retiredReceipt(journal: Journal, id: string): Terminal | undefined {
  if (!journal.retirementFull && !journal.retired?.includes(id)) return undefined;
  return { state: "failed", id, why: { code: "E_WRITE_RECEIPT_EXPIRED", family: "input", guide: "writes", site: "app.mutate",
    message: journal.retirementFull ? "the online journal's retirement id limit is full; new admissions are blocked rather than risking replay of a prior outcome"
      : "this write id was preserved after a store change; its receipt body is no longer retained and it cannot be admitted again",
    rewrite: "reconcile the prior outcomes with the backend before explicitly replacing this account's write journal; do not retry automatically" } };
}
const record = (value: unknown): value is Record<string, unknown> => !!value && typeof value === "object" && !Array.isArray(value);
const id = (value: unknown) => typeof value === "string" && /^[0-7][0-9A-HJKMNP-TV-Z]{25}$/.test(value);

function valid(value: unknown, owner: string, backend: string): value is Journal {
  if (!record(value) || value.owner !== owner || value.backend !== backend || !Array.isArray(value.pending) || !Array.isArray(value.receipts) || value.receipts.length > WRITE_HISTORY_LIMIT) return false;
  if (value.retired !== undefined && (!Array.isArray(value.retired) || value.retired.length > RETIRED_ID_LIMIT || !value.retired.every(id))) return false;
  if (value.retirementFull !== undefined && typeof value.retirementFull !== "boolean") return false;
  if (value.firstStore !== undefined && (typeof value.firstStore !== "string" || !value.firstStore)) return false;
  if (value.changedStore !== undefined && typeof value.changedStore !== "boolean") return false;
  if (!value.pending.every(item => record(item) && item.owner === owner && id(item.id) && typeof item.op === "string" && item.op.length > 0 && Object.hasOwn(item, "args"))) return false;
  if (!value.pending.every(item => (item.storeId == null || (typeof item.storeId === "string" && item.storeId.length > 0))
    && (item.dispatched === undefined || typeof item.dispatched === "boolean"))) return false;
  if (!value.pending.every(item => item.admissionDeadline === undefined || (Number.isSafeInteger(item.admissionDeadline) && (item.admissionDeadline as number) > 0))) return false;
  if (!value.pending.every(item => item.holdReason === undefined || typeof item.holdReason === "string")) return false;
  if (!value.pending.every(item => item.statusRevision === undefined || id(item.statusRevision))) return false;
  if (new Set(value.pending.map(item => item.id)).size !== value.pending.length) return false;
  return value.receipts.every(item => record(item) && id(item.id) && (item.state === "sent"
    ? Number.isSafeInteger(item.seq) && (item.seq as number) >= 0
    : item.state === "failed" && record(item.why) && typeof item.why.code === "string" && typeof item.why.family === "string" && typeof item.why.message === "string"));
}

/** Called inside the journal lock. Preserve damaged/foreign bytes before
 * replacing the active record. If preservation fails, sign-in still succeeds,
 * but writes remain blocked until storage can preserve those bytes. */
export function journalReader(key: string, owner: string, backend: string, store: SessionStore, report: (error: unknown) => void) {
  const empty = (): Journal => ({ owner, backend, pending: [], receipts: [] });
  return async (forWrite = false): Promise<Journal> => {
    const text = await store.get(key);
    if (text === null) return empty();
    try {
      const parsed: unknown = JSON.parse(text);
      if (valid(parsed, owner, backend)) return parsed;
    } catch { /* Preserve the original bytes below. */ }
    const journal = empty();
    try {
      const side = `${key}.damaged.${mintId().toLowerCase()}`;
      await store.set(side, text);
      await store.set(key, JSON.stringify(journal));
      report(new StorageWarning({ code: "E_CLIENT", family: "client", site: "app.mutate",
        message: "The online write journal was damaged or belonged to another owner; its bytes were preserved and no saved intent was replayed.",
        rewrite: `inspect the saved bytes with await sessionStore.get(${JSON.stringify(side)}); submit new intent with app.mutate(op, args)` }));
    } catch (error) {
      report(new StorageWarning({ code: "E_CLIENT", family: "client", site: "app.mutate",
        message: "The damaged online write journal could not be preserved; its original bytes remain and writes are blocked until storage is repaired.",
        rewrite: "repair sessionStore, then reopen createApp({ url, sessionStore })" }));
      if (forWrite) throw error;
    }
    return journal;
  };
}
