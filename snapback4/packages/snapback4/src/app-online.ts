// @ref LLP 3000.013#6 — online intents need durable custody before dispatch; local devices already own their outbox.
import type { Client, Mutation, Refusal, Write } from "./contract.ts";
import type { SessionStore } from "./auth.ts";
import { mintId } from "./client.ts";
import { MutationIds, WriteHistory, WRITE_HISTORY_LIMIT } from "./writes.ts";

import { storeKey, storeLock as locked } from "./app-storage.ts";
import { journalReader, type Journal, type Terminal } from "./app-journal.ts";

// Unknown store outcomes cannot evict known sent ids during bulk retirement.
// Keep the same bounded window, discarding the oldest unknown failures first.
function keepReceipts(receipts: Terminal[]): Terminal[] {
  let excess = Math.max(0, receipts.length - WRITE_HISTORY_LIMIT);
  return receipts.filter(write => {
    if (excess && write.state === "failed" && ["E_STORE_REPLACED", "E_STORE_RESTORE"].includes(write.why.code)) { excess--; return false; }
    return true;
  }).slice(-WRITE_HISTORY_LIMIT);
}

/** Private implementation; the returned client has the unchanged Client card. */
export async function onlineCustody(raw: Client, url: string, store: SessionStore, report: (error: unknown) => void) {
  const viewer = raw.viewer()!;
  const key = storeKey("writes", url, viewer);
  let active = true;
  let storeRefusal: Refusal | undefined;
  let retirement: Promise<void> | undefined;
  const ids = new MutationIds();
  const emissions = new WriteHistory();
  const listeners = new Set<(write: Terminal) => void>();
  let writes: Promise<unknown> = Promise.resolve();
  const read = journalReader(key, viewer, url, store, report);
  const change = <T>(work: (journal: Journal) => T): Promise<T> => {
    const result = locked(key, async () => {
      const journal = await read(true);
      const value = work(journal);
      await store.set(key, JSON.stringify(journal));
      return value;
    });
    writes = result;
    return result;
  };
  const terminal = (write: Write): write is Terminal => write.state !== "pending"
    && !(write.state === "failed" && ["E_CLOSED", "E_AUTH"].includes(write.why.code));
  const notify = (write: Terminal) => {
    ids.finish(write.id);
    if (active && emissions.firstEmission(write.id)) for (const listener of listeners) listener(write);
  };
  const settle = async (write: Terminal) => {
    await change(journal => {
      if (!journal.pending.some(intent => intent.id === write.id)) return false;
      journal.pending = journal.pending.filter(intent => intent.id !== write.id);
      // Never persist historical read results or refusal details for disclosure on reopen.
      const receipt: Terminal = write.state === "sent"
        ? { state: "sent", id: write.id, seq: write.seq, replayed: true }
        : { state: "failed", id: write.id, why: { code: write.why.code, family: write.why.family, message: ["E_STORE_REPLACED", "E_STORE_RESTORE"].includes(write.why.code) ? `write refused: ${write.why.code}; whether it executed is unknown; do not retry automatically` : `write refused: ${write.why.code}` } };
      journal.receipts.push(receipt);
      journal.receipts = keepReceipts(journal.receipts);
      return true;
    });
    // Durable retirement belongs to the shared journal; notification and
    // reservation cleanup belong to every client that observed settlement.
    notify(write);
  };
  const stop = raw.onWrite(write => {
    if (active && terminal(write)) void settle(write).catch(report);
  });
  const initial = await locked(key, read);
  for (const receipt of initial.receipts) ids.remember(receipt.id);

  const refusedStore = async (id: string): Promise<Write> => {
    // UI custody may already be paused. A terminal outcome still owns its
    // durable intent until retirement commits, including admission in flight.
    try { await retirement; return { state: "failed", id, why: storeRefusal! }; }
    catch (error) { report(error); return { state: "pending", id, reason: "waiting to persist the terminal receipt" }; }
  };

  const client: Client = {
    ...raw,
    mutate<A, R>(op: Mutation<A, R>, args: A, options?: import("./contract.ts").MutateOptions): Promise<Write<R>> {
      const id = options?.id ?? mintId();
      if (storeRefusal) return refusedStore(id) as Promise<Write<R>>;
      if (!active || raw.viewer() !== viewer) return Promise.resolve({ state: "failed", id, why: { code: "E_AUTH", family: "auth", message: "sign in to write", site: "app.mutate", rewrite: "await app.auth.login(email, password)" } });
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
          journal.pending.push({ owner: viewer, id, op: op.name, args: snapshot });
          return undefined;
        });
        if (refusal?.state === "failed" || refusal?.state === "sent") return refusal as Write<R>;
        if (storeRefusal) return refusedStore(id) as Promise<Write<R>>;
        if (!active || raw.viewer() !== viewer) return { state: "pending", id };
        const result = await raw.mutate(op, snapshot as A, { id });
        if (storeRefusal) return refusedStore(id) as Promise<Write<R>>;
        if (terminal(result)) {
          try { await settle(result); }
          catch (error) { report(error); return { state: "pending", id, reason: "waiting to persist the terminal receipt" }; }
        }
        return terminal(result) ? result : { state: "pending", id };
      });
    },
    async write(id) {
      if (!active || raw.viewer() !== viewer) return undefined;
      const journal = await locked(key, read);
      if (!active || raw.viewer() !== viewer) return undefined;
      const receipt = journal.receipts.find(write => write.id === id);
      if (receipt) { notify(receipt); return receipt; }
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
    async close() { pause(); await raw.close(); await writes.catch(report); },
    async signOut() { pause(); await raw.signOut(); await writes.catch(report); },
    async logoutAll() { const result = await raw.logoutAll(); if (result.ok) pause(); return result; },
  };
  function pause() { active = false; stop(); listeners.clear(); }
  // Start in recorded order before a screen can submit a later intent. The
  // online client owns retransmission/backoff, including lost confirmations.
  const recovery = Promise.all(initial.pending.filter(intent => intent.owner === raw.viewer()).map(intent =>
    client.mutate({ kind: "mutation", name: intent.op }, intent.args, { id: intent.id })));
  void recovery.catch(report);
  function refuseStore(why: Refusal): Promise<void> {
    if (retirement) return retirement;
    storeRefusal = why;
    // Fence admissions synchronously, then retire the entire durable queue
    // before createApp can reopen. These intents must never cross stores.
    retirement = change(journal => {
      const failed = journal.pending.map(intent => ({ state: "failed", id: intent.id,
        why: { code: why.code, family: why.family, message: "store changed; whether this write executed is unknown" } } as const));
      journal.pending = [];
      journal.receipts.push(...failed);
      journal.receipts = keepReceipts(journal.receipts);
      return failed;
    }).then(failed => { for (const write of failed) notify(write); });
    return retirement;
  }
  return { client, pause, refuseStore };
}
