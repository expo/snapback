import type { Write } from "./contract.ts";
import type { SessionStore } from "./auth.ts";
import { StorageWarning } from "./app-storage.ts";
import { mintId } from "./client.ts";
import { WRITE_HISTORY_LIMIT } from "./writes.ts";

export type Intent = { owner: string; id: string; op: string; args: unknown };
export type Terminal = Exclude<Write, { state: "pending" }>;
export type Journal = { owner: string; backend: string; pending: Intent[]; receipts: Terminal[] };
const record = (value: unknown): value is Record<string, unknown> => !!value && typeof value === "object" && !Array.isArray(value);
const id = (value: unknown) => typeof value === "string" && /^[0-7][0-9A-HJKMNP-TV-Z]{25}$/.test(value);

function valid(value: unknown, owner: string, backend: string): value is Journal {
  if (!record(value) || value.owner !== owner || value.backend !== backend || !Array.isArray(value.pending) || !Array.isArray(value.receipts) || value.receipts.length > WRITE_HISTORY_LIMIT) return false;
  if (!value.pending.every(item => record(item) && item.owner === owner && id(item.id) && typeof item.op === "string" && item.op.length > 0 && Object.hasOwn(item, "args"))) return false;
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
