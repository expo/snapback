import { pendingIntentAccess, pendingIntent, registerPendingIntents, forwardIntentObserver } from "./pending-items.ts";
import { routeMutations, failedSignal } from "./ephemeral.ts";
// @ref LLP 3000.013#6 — online intents need durable custody before dispatch; local devices already own their outbox.
import type { Client, Mutation, Refusal, Write } from "./contract.ts";
import type { SessionStore } from "./auth.ts";
import { inheritClose } from "./closing-responses.ts";
import { mintId } from "./client.ts";
import { mutationWaitSeconds, MutationIds, WriteHistory } from "./writes.ts";
import { pendingChanges } from "./pending-writes.ts";
import { IdentityWait, identityRefusal } from "./identity-admission.ts";
import { journalChanges } from "./journal-changes.ts";

import { storeKey, storeLock as locked } from "./app-storage.ts";
import { bindIntentStore, journalReader, keepReceipts, observeJournalStore, retiredReceipt, type Journal, type Terminal } from "./app-journal.ts";
import { dispatchIdentity, identifyDispatch, ownDispatch } from "./online-dispatch.ts";

/** Private implementation; the returned client has the unchanged Client card. */
export async function onlineCustody(raw: Client, url: string, store: SessionStore, report: (error: unknown) => void, autoStart = true) {
  const viewer = raw.viewer()!;
  const key = storeKey("writes", url, viewer);
  let active = true;
  let storeRefusal: Refusal | undefined;
  let retirement: Promise<void> | undefined;
  const ids = new MutationIds();
  const emissions = new WriteHistory();
  // I13: failed receipt persistence cannot turn a known outcome back into
  // pending, even after the raw client's bounded history evicts that id.
  const unpersisted = new Map<string, Terminal>();
  // @ref LLP 3000.019#3.3 — failed status saves cannot hide this runtime's
  // observed hold. This overlays presentation only; the journal still owns FIFO.
  const unsavedHolds = new Map<string, { reason: string; revision: string | undefined }>();
  const dispatchRevisions = new Map<string, string | undefined>();
  const recoveredIntents = new Set<string>();
  const listeners = new Set<(write: Terminal) => void>();
  const pending = pendingChanges();
  const identification = new IdentityWait(pending.notify);
  const stopPending = raw.onPendingWrites?.(pending.notify);
  let writes: Promise<unknown> = Promise.resolve();
  const read = journalReader(key, viewer, url, store, report);
  const change = <T>(work: (journal: Journal) => T, recoverExisting = false): Promise<T> => {
    const result = locked(key, async () => {
      const journal = await read(true);
      const before = recoverExisting ? JSON.stringify(journal) : undefined;
      const value = work(journal);
      const after = JSON.stringify(journal);
      // Reading an existing intent/receipt needs no new custody. A redundant
      // save must not turn that known outcome into an admission refusal.
      if (after !== before) { await store.set(key, after); journalEvents.notify(); }
      return value;
    });
    writes = result;
    return result;
  };
  const terminal = (write: Write): write is Terminal => write.state !== "pending"
    && !(write.state === "failed" && ["E_CLOSED", "E_AUTH"].includes(write.why.code));
  const notify = (write: Terminal) => {
    unsavedHolds.delete(write.id);
    dispatchRevisions.delete(write.id);
    ids.finish(write.id);
    pending.notify();
    if (active && emissions.firstEmission(write.id)) for (const listener of listeners) listener(write);
  };
  // @ref LLP 3000.007#17 — recovery confirms execution, never historical result values or details.
  const receiptOf = (write: Terminal): Terminal => write.state === "sent"
    ? { state: "sent", id: write.id, seq: write.seq, replayed: true }
    : { state: "failed", id: write.id, why: { code: write.why.code, family: write.why.family, message: ["E_STORE_REPLACED", "E_STORE_RESTORE"].includes(write.why.code) ? `write refused: ${write.why.code}; whether it executed is unknown; do not retry automatically` : `write refused: ${write.why.code}` } };
  const retain = (write: Terminal, error: unknown) => {
    const first = !unpersisted.has(write.id);
    if (active) unpersisted.set(write.id, receiptOf(write));
    if (first) notify(write);
    report(error);
  };
  const settle = async (write: Terminal) => {
    await change(journal => {
      if (!journal.pending.some(intent => intent.id === write.id)) return false;
      journal.pending = journal.pending.filter(intent => intent.id !== write.id);
      // Never persist historical read results or refusal details for disclosure on reopen.
      journal.receipts.push(receiptOf(write));
      keepReceipts(journal, new Set([write.id]), write.state === "failed" && ["E_STORE_REPLACED", "E_STORE_RESTORE"].includes(write.why.code));
      return true;
    });
    // Durable retirement belongs to the shared journal; notification and
    // reservation cleanup belong to every client that observed settlement.
    if (unpersisted.delete(write.id)) ids.finish(write.id);
    else notify(write);
  };
  const stop = raw.onWrite(write => {
    if (active && terminal(write)) {
      // An old intent can be retired while this runtime already belongs to
      // the new store. Its refusal does not fence unrelated new-store intent.
      if (recoveredIntents.delete(write.id)) { notify(write); return; }
      // The raw client emits one refusal per queued write. Retire that store's
      // queue once, so all newly failed receipts share the same pinned save.
      const retiring = write.state === "failed" && ["E_STORE_REPLACED", "E_STORE_RESTORE"].includes(write.why.code);
      if (retiring) void refuseStore(write.why).catch(report);
      else void settle(write).catch(error => retain(write, error));
    }
  });
  const initial = await locked(key, read);
  const journalEvents = journalChanges(key, pending.notify);
  const restoredIds = new Set(initial.pending.map(intent => intent.id));
  ownDispatch(raw, {
    observe: identity => { void change(journal => observeJournalStore(journal, identity)).catch(report); },
    before: (id, identity) => change(journal => {
      const intent = journal.pending.find(entry => entry.id === id);
      if (!intent) {
        const receipt = journal.receipts.find(entry => entry.id === id) ?? retiredReceipt(journal, id);
        if (receipt) return { write: receipt, revision: undefined };
        throw new Error("the write has no durable intent; it cannot be dispatched");
      }
      const write = bindIntentStore(journal, intent, identity);
      return { write, revision: intent.statusRevision };
    }).then(({ write, revision }) => {
      unsavedHolds.delete(id);
      if (write) recoveredIntents.add(id);
      else if (active) dispatchRevisions.set(id, revision);
      return write;
    }),
    held: (id, reason) => {
      const revision = dispatchRevisions.get(id);
      return change(journal => {
        const intent = journal.pending.find(entry => entry.id === id);
        if (intent) { intent.holdReason = reason; intent.statusRevision = mintId(); }
      }).then(() => { unsavedHolds.delete(id); }).catch(error => {
        if (active) { unsavedHolds.set(id, { reason, revision }); pending.notify(); }
        report(error);
      });
    },
  });
  for (const receipt of initial.receipts) ids.remember(receipt.id);
  for (const id of initial.retired ?? []) ids.remember(id);

  const refusedStore = async (id: string): Promise<Write> => {
    // UI custody may already be paused. A terminal outcome still owns its
    // durable intent until retirement commits, including admission in flight.
    try { await retirement; return { state: "failed", id, why: storeRefusal! }; }
    catch (error) { report(error); return { state: "pending", id, reason: "waiting to persist the terminal receipt" }; }
  };

  const client: Client = {
    ...raw,
    mutate: routeMutations((op, args) => {
      if (storeRefusal || !active || raw.viewer() !== viewer) return Promise.resolve(failedSignal(mintId(), storeRefusal ?? { code: "E_AUTH", family: "auth", message: "sign in to write" }));
      return raw.mutate(op, args);
    }, function<A, R>(op: Mutation<A, R>, args: A, options?: import("./contract.ts").MutateOptions): Promise<Write<R>> {
      const id = options?.id ?? mintId();
      if (storeRefusal) return refusedStore(id) as Promise<Write<R>>;
      if (!active || raw.viewer() !== viewer) return Promise.resolve({ state: "failed", id, why: { code: "E_AUTH", family: "auth", message: "sign in to write", site: "app.mutate", rewrite: "await app.auth.login(email, password)" } });
      return ids.run<R>(id, op.name, args, async () => {
        if (storeRefusal) return refusedStore(id);
        const write = await client.write(id);
        if (storeRefusal) return refusedStore(id);
        // Paused custody hides receipts; it does not prove that a durable
        // intent expired. Every overlapping caller still owns that intent.
        return !active || raw.viewer() !== viewer ? { state: "pending", id } : write;
      }, snapshot => {
        const submit = async (release = () => {}): Promise<Write<R>> => {
        // Identify before admitting new intent. A reopened journal can name A
        // while this runtime first connects to B; only recovered unbound
        // intent belongs to that earlier history. Existing entries keep their
        // recorded ownership and still pass the strict dispatch guard below.
        const identity = dispatchIdentity(raw);
        // Discovery can fence this runtime and retire its queue. Do not add
        // a later admission behind that completed retirement transaction.
        if (storeRefusal) return refusedStore(id) as Promise<Write<R>>;
        let refusal: Write | undefined;
        try { refusal = await change(journal => {
          const previous = journal.pending.find(intent => intent.id === id);
          if (previous) {
            // MutationIds below checks normalized input without replacing its owner.
            const check = new MutationIds();
            check.remember(id, previous.op, previous.args);
            return check.run(id, op.name, snapshot, async () => ({ state: "pending", id }), async () => ({ state: "pending", id }));
          }
          const receipt = journal.receipts.find(write => write.id === id) ?? retiredReceipt(journal, id);
          if (receipt) return Promise.resolve(receipt);
          if (identity) observeJournalStore(journal, identity);
          journal.pending.push({ owner: viewer, id, op: op.name, args: snapshot, storeId: identity ?? null, dispatched: false });
          return undefined;
        }, true); } catch (error) {
          return { state: "failed", id, why: { code: "E_STORE", family: "store", message: `write ${id} admission outcome is unknown: ${String(error)}` } };
        }
        if (refusal?.state === "failed" || refusal?.state === "sent") return refusal as Write<R>;
        if (storeRefusal) return refusedStore(id) as Promise<Write<R>>;
        if (!active || raw.viewer() !== viewer) return { state: "pending", id };
        const dispatch = async (): Promise<Write<R>> => {
          const sending = raw.mutate(op, snapshot as A, { ...options, id });
          release();
          const result = await sending;
          if (storeRefusal) return refusedStore(id) as Promise<Write<R>>;
          if (terminal(result)) {
            try { await settle(result); }
            // Keep the durable intent for replay if receipt storage fails, but
            // never replace the server-confirmed outcome of this dispatched call.
            catch (error) { retain(result, error); }
          }
          return terminal(result) ? result : { state: "pending", id };
        };
        if (mutationWaitSeconds(options?.waitSeconds) === 0) {
          // @ref LLP 3000.008.002.000#3-submit-once-then-let-the-user-continue — the committed journal owns recovery after this return.
          void dispatch().catch(error => { try { report(error); } catch { /* Reporting must not reject a detached continuation. */ } });
          return { state: "pending", id };
        }
        return dispatch();
        };
        if ((!dispatchIdentity(raw) || identification.size) && !restoredIds.has(id)) {
          return identification.run({ id, op: op.name, args: snapshot }, async () => {
            if (!active || raw.viewer() !== viewer) return { code: "E_AUTH", family: "auth", message: "sign in to write" };
            if (storeRefusal) return identityRefusal(false);
            await identifyDispatch(raw);
            if (storeRefusal) return identityRefusal(false);
            return !!dispatchIdentity(raw);
          }, submit, why => {
            const write = { state: "failed" as const, id, why };
            emissions.remember(write); notify(write); return write;
          });
        }
        return submit();
      });
    }),
    async write(id) {
      if (!active || raw.viewer() !== viewer) return undefined;
      const waiting = identification.write(id);
      if (waiting) return waiting;
      const refused = await emissions.read(id);
      if (refused) return refused;
      const retained = unpersisted.get(id);
      if (retained) {
        try { await settle(retained); }
        catch (error) { retain(retained, error); }
        return retained;
      }
      const journal = await locked(key, read);
      if (!active || raw.viewer() !== viewer) return undefined;
      const receipt = journal.receipts.find(write => write.id === id);
      if (receipt) { notify(receipt); return receipt; }
      const retired = retiredReceipt(journal, id);
      // Saturation fences new admissions, not recovery of an admitted intent.
      if (retired && !journal.pending.some(intent => intent.id === id)) return retired;
      const known = await raw.write(id);
      if (journal.pending.some(intent => intent.id === id)) {
        if (known && terminal(known)) {
          try { await settle(known); return known; }
          catch (error) { retain(known, error); return known; }
        }
        return { state: "pending", id };
      }
      return known;
    },
    onWrite(listener) { listeners.add(listener); return () => { listeners.delete(listener); }; },
    // @ref LLP 3000.019#3.3 — restored online intent is visible before replay;
    // the shared journal supplies order and persisted dispatch status.
    async pendingWrites() {
      if (!active || raw.viewer() !== viewer) return [];
      const journal = await locked(key, read);
      if (!active || raw.viewer() !== viewer) return [];
      const revisions = new Map(journal.pending.map(intent => [intent.id, intent.statusRevision]));
      for (const [id, hold] of unsavedHolds) if (!revisions.has(id) || revisions.get(id) !== hold.revision) unsavedHolds.delete(id);
      for (const id of dispatchRevisions.keys()) if (!revisions.has(id)) dispatchRevisions.delete(id);
      return [...identification.pending(), ...journal.pending.filter(intent => !unpersisted.has(intent.id)).map(intent => {
        const reason = unsavedHolds.get(intent.id)?.reason ?? intent.holdReason;
        return { id: intent.id, op: intent.op, args: intent.args, predicted: [],
          ...(reason ? { state: "held" as const, reason }
            : { state: intent.dispatched ? "sent" as const : "queued" as const }),
        };
      })];
    },
    onPendingWrites: pending.subscribe,
    async close() { pause(); await raw.close(); await writes.catch(report); },
    async signOut() { pause(); await raw.signOut(); await writes.catch(report); },
    async logoutAll() { const result = await raw.logoutAll(); if (result.ok) pause(); return result; },
  };
  const rawIntents = pendingIntentAccess(raw);
  const intentScope = () => active && !storeRefusal && raw.viewer() === viewer ? rawIntents.scope() : undefined;
  registerPendingIntents(client, { scope: intentScope, async read() {
    const before = intentScope();
    if (before == null) return [];
    const [rawItems, entries] = await Promise.all([rawIntents.read(), client.pendingWrites()]);
    if (before !== intentScope()) return [];
    const terminal = rawItems.filter(item => item.phase === "settling");
    const settled = new Set(terminal.map(item => item.write.id));
    const saving = new Set(identification.pending().map(write => write.id));
    return [...terminal, ...entries.filter(write => !settled.has(write.id)).map(write => pendingIntent(write, saving.has(write.id)))];
  } });
  forwardIntentObserver(client, raw, () => intentScope() != null);
  inheritClose(client, raw);
  function pause() { identification.close(); active = false; pending.notify(); pending.clear(); journalEvents.close(); stopPending?.(); stop(); listeners.clear(); unpersisted.clear(); unsavedHolds.clear(); dispatchRevisions.clear(); }
  // Start in recorded order before a screen can submit a later intent. The
  // online client owns retransmission/backoff, including lost confirmations.
  let started = false;
  function start() {
    if (started || !active) return;
    started = true;
    const recovery = Promise.all(initial.pending.filter(intent => intent.owner === raw.viewer()).map(intent =>
      client.mutate({ kind: "mutation", name: intent.op }, intent.args, { id: intent.id })));
    void recovery.catch(report);
  }
  if (autoStart) start();
  function refuseStore(why: Refusal): Promise<void> {
    if (retirement) return retirement;
    storeRefusal = why;
    identification.close(identityRefusal(false));
    // Fence admissions synchronously, then retire the entire durable queue
    // before createApp can reopen. These intents must never cross stores.
    retirement = change(journal => {
      const failed = journal.pending.map(intent => ({ state: "failed", id: intent.id,
        why: { code: why.code, family: why.family, message: "store changed; whether this write executed is unknown" } } as const));
      journal.pending = [];
      journal.receipts.push(...failed);
      keepReceipts(journal, new Set(failed.map(write => write.id)), true);
      return failed;
    }).then(failed => { for (const write of failed) notify(write); });
    return retirement;
  }
  return { client, pause, start, refuseStore };
}
