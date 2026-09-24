// @ref LLP 3000.013#6 — online intents need durable custody before dispatch; local devices already own their outbox.
import type { Client, Mutation, Write } from "./contract.ts";
import type { SessionStore } from "./auth.ts";
import { mintId } from "./client.ts";
import { MutationIds, WRITE_HISTORY_LIMIT } from "./writes.ts";

type Intent = { id: string; op: string; args: unknown };
type Terminal = Exclude<Write, { state: "pending" }>;
type Journal = { pending: Intent[]; receipts: Terminal[] };
const locks = new Map<string, Promise<unknown>>();

// Web Locks cover independent tabs using localStorage adapters. Other hosts
// serialize within this runtime; a custom store must not have concurrent writers
// in different processes (SessionStore has no compare-and-swap operation).
function locked<T>(key: string, work: () => Promise<T>): Promise<T> {
  const previous = locks.get(key) ?? Promise.resolve();
  const result = previous.catch(() => {}).then(async () => {
    if (globalThis.navigator?.locks) return await globalThis.navigator.locks.request(key, work);
    return await work();
  });
  locks.set(key, result);
  void result.finally(() => { if (locks.get(key) === result) locks.delete(key); }).catch(() => {});
  return result;
}

/** Private implementation; the returned client has the unchanged Client card. */
export async function onlineCustody(raw: Client, url: string, store: SessionStore, report: (error: unknown) => void) {
  const key = `snapback4:${encodeURIComponent(url)}:${encodeURIComponent(raw.viewer()!)}:writes`;
  let active = true;
  const ids = new MutationIds();
  const listeners = new Set<(write: Terminal) => void>();
  let writes: Promise<unknown> = Promise.resolve();
  const read = async (): Promise<Journal> => {
    const text = await store.get(key);
    return text ? JSON.parse(text) as Journal : { pending: [], receipts: [] };
  };
  const change = <T>(work: (journal: Journal) => T): Promise<T> => {
    const result = locked(key, async () => {
      const journal = await read();
      const value = work(journal);
      await store.set(key, JSON.stringify(journal));
      return value;
    });
    writes = result;
    return result;
  };
  const terminal = (write: Write): write is Terminal => write.state !== "pending"
    && !(write.state === "failed" && ["E_CLOSED", "E_AUTH"].includes(write.why.code));
  const settle = async (write: Terminal) => {
    const found = await change(journal => {
      if (!journal.pending.some(intent => intent.id === write.id)) return false;
      journal.pending = journal.pending.filter(intent => intent.id !== write.id);
      // Never persist historical read results or refusal details for disclosure on reopen.
      const receipt: Terminal = write.state === "sent"
        ? { state: "sent", id: write.id, seq: write.seq, replayed: true }
        : { state: "failed", id: write.id, why: { code: write.why.code, family: write.why.family, message: `write refused: ${write.why.code}` } };
      journal.receipts.push(receipt);
      journal.receipts = journal.receipts.slice(-WRITE_HISTORY_LIMIT);
      return true;
    });
    if (found && active) for (const listener of listeners) listener(write);
  };
  const stop = raw.onWrite(write => {
    if (active && terminal(write)) void settle(write).catch(report);
  });
  const initial = await locked(key, read);
  for (const receipt of initial.receipts) ids.remember(receipt.id);

  const client: Client = {
    ...raw,
    mutate<A, R>(op: Mutation<A, R>, args: A, options?: import("./contract.ts").MutateOptions): Promise<Write<R>> {
      const id = options?.id ?? mintId();
      if (!active || !raw.viewer()) return Promise.resolve({ state: "failed", id, why: { code: "E_AUTH", family: "auth", message: "sign in to write", site: "app.mutate", rewrite: "await app.auth.login(email, password)" } });
      return ids.run<R>(id, op.name, args, () => client.write(id), async snapshot => {
        const refusal = await change(journal => {
          const previous = journal.pending.find(intent => intent.id === id);
          if (previous) {
            // MutationIds below checks normalized input without replacing its owner.
            const check = new MutationIds();
            check.remember(id, previous.op, previous.args);
            return check.run(id, op.name, snapshot, async () => ({ state: "pending", id }), async () => ({ state: "pending", id }));
          }
          const receipt = journal.receipts.find(write => write.id === id);
          if (receipt) return Promise.resolve(receipt);
          journal.pending.push({ id, op: op.name, args: snapshot });
          return undefined;
        });
        if (refusal?.state === "failed" || refusal?.state === "sent") return refusal as Write<R>;
        if (!active) return { state: "pending", id };
        const result = await raw.mutate(op, snapshot as A, { id });
        if (active && terminal(result)) {
          try { await settle(result); }
          catch (error) { report(error); return { state: "pending", id, reason: "waiting to persist the terminal receipt" }; }
        }
        return terminal(result) ? result : { state: "pending", id };
      });
    },
    async write(id) {
      if (!active || !raw.viewer()) return undefined;
      const journal = await locked(key, read);
      if (!active || !raw.viewer()) return undefined;
      const receipt = journal.receipts.find(write => write.id === id);
      if (receipt) return receipt;
      const known = await raw.write(id);
      if (journal.pending.some(intent => intent.id === id)) {
        if (known && terminal(known)) {
          try { await settle(known); return known; }
          catch (error) { report(error); }
        }
        return { state: "pending", id };
      }
      return known;
    },
    onWrite(listener) { listeners.add(listener); return () => { listeners.delete(listener); }; },
    async close() { pause(); await raw.close(); await writes; },
    async signOut() { pause(); await raw.signOut(); await writes; },
    async logoutAll() { const result = await raw.logoutAll(); if (result.ok) pause(); return result; },
  };
  function pause() { active = false; stop(); listeners.clear(); }
  // Start in recorded order before a screen can submit a later intent. The
  // online client owns retransmission/backoff, including lost confirmations.
  const recovery = Promise.all(initial.pending.map(intent =>
    client.mutate({ kind: "mutation", name: intent.op }, intent.args, { id: intent.id })));
  void recovery.catch(report);
  return { client, pause };
}
