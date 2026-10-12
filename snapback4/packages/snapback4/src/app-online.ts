import { guardFollowing } from "./following-transport.ts";
import { pendingIntentAccess, pendingIntent, registerPendingIntents, registerIntentObserver, OnlineIntentPresentation } from "./pending-items.ts";
import { routeMutations, failedSignal } from "./ephemeral.ts";
// @ref LLP 3000.013#6 — online intents need durable custody before dispatch; local devices already own their outbox.
import type { Client, Mutation, Refusal, Write } from "./contract.ts";
import type { SessionStore } from "./auth.ts";
import { inheritClose } from "./closing-responses.ts";
import { mintId } from "./client.ts";
import { inputKey, mutationWaitSeconds, MutationIds, WriteHistory } from "./writes.ts";
import { pendingChanges } from "./pending-writes.ts";
import { IdentityWait, identityRefusal } from "./identity-admission.ts";
import { journalChanges } from "./journal-changes.ts";

import { storeKey, storeLock as locked } from "./app-storage.ts";
import { bindIntentStore, capturedReceipt, journalReader, keepReceipts, observeJournalStore, retiredReceipt, type Intent, type Journal, type Terminal } from "./app-journal.ts";
import { dispatchIdentity, identifyDispatch, ownDispatch } from "./online-dispatch.ts";
import { admissionRefusal, failedAdmission } from "./admission.ts";
import { admissionAuthorityRefusal, type AdmissionAuthorityContext } from "./admission-authority.ts";
import { StorageWarning } from "./app-storage.ts";
import { OnlineCapture, markedId, type CaptureRecord } from "./online-capture.ts";

/** Private implementation; the returned client has the unchanged Client card. */
export async function onlineCustody(raw: Client, url: string, store: SessionStore, report: (error: unknown) => void, autoStart = true,
  captureAuthority?: AdmissionAuthorityContext) {
  const viewer = raw.viewer()!;
  const key = storeKey("writes", url, viewer);
  // @ref LLP 3000.013.000#4 — a device-less browser app captures each click
  // synchronously; once committed, the journal below owns it as before.
  const capture = captureAuthority ? new OnlineCapture(url, viewer, captureAuthority) : undefined;
  // @ref LLP 3000.013.000#4.4 — captured admissions wait behind recovery, from before signed-in.
  let recovery: Promise<void> | undefined, openGate: (() => void) | undefined;
  if (capture) recovery = new Promise<void>(resolve => { openGate = resolve; });
  // Ids durable in the journal that this runtime replays without capturing; settled ids leave.
  const restoredIds = new Set<string>();
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
  const rawIntents = pendingIntentAccess(raw);
  const intentScope = () => active && !storeRefusal && raw.viewer() === viewer ? rawIntents.scope() : undefined;
  const presentation = new OnlineIntentPresentation(intentScope, pending.notify);
  const stopPending = raw.onPendingWrites?.(pending.notify);
  let writes: Promise<unknown> = Promise.resolve();
  const read = journalReader(key, viewer, url, store, report);
  const change = <T>(work: (journal: Journal) => T, recoverExisting = false): Promise<T> => {
    const result = locked(key, async () => {
      const journal = await read(true);
      const before = recoverExisting ? JSON.stringify(journal) : undefined;
      const value = work(journal);
      capture?.collect(journal);
      const after = JSON.stringify(journal);
      // Reading an existing intent/receipt needs no new custody. A redundant
      // save must not turn that known outcome into an admission refusal.
      if (after !== before) { await store.set(key, after); journalEvents.notify(); }
      return value;
    });
    writes = result;
    return result;
  };
  // @ref LLP 3000.013.000#4.2 — journal lock, then session lock, raw store only:
  // the click's session must still hold when its intent and marker commit.
  const sessionEnded = Symbol("session ended");
  // One normalized comparison (MutationIds' input key) for admission and recovery.
  const sameInput = (a: { op: string; args: unknown }, b: { op: string; args: unknown }) => {
    try { return inputKey(a.op, a.args) === inputKey(b.op, b.args); } catch { return false; }
  };
  const admitCaptured = <T>(record: CaptureRecord, work: (journal: Journal) => T): Promise<{ value: Awaited<T>; known: boolean } | typeof sessionEnded> => {
    const result = locked(key, () => locked(record.authority.key, async () => {
      if (!await capture!.holds(record)) return sessionEnded;
      const journal = await read(true);
      const before = JSON.stringify(journal);
      const value = await work(journal);
      // A refusal of an unknown id (input reuse, saturation) keeps no marker.
      const known = journal.pending.some(intent => intent.id === record.id && sameInput(intent, record))
        || (value as Write | undefined)?.state === "sent"
        || ((value as Write | undefined)?.state === "failed" && !["E_WRITE_ID_REUSE"].includes((value as Extract<Write, { state: "failed" }>).why.code)
          && (journal.receipts.some(write => write.id === record.id) || !!journal.retired?.includes(record.id) || markedId(journal, record.id)));
      if (known) capture!.mark(journal, record);
      capture!.collect(journal);
      const after = JSON.stringify(journal);
      if (after !== before) { await store.set(key, after); journalEvents.notify(); }
      return { value, known };
    }));
    writes = result;
    return result;
  };
  let recoveryDelay = 1_000, recoveryTimer: ReturnType<typeof setTimeout> | undefined;
  const scheduleRecovery = () => {
    if (!capture || recoveryTimer || !active) return;
    recoveryTimer = setTimeout(() => { recoveryTimer = undefined; if (capture.stale && active) void recover(); }, recoveryDelay);
    (recoveryTimer as { unref?: () => void }).unref?.();
    recoveryDelay = Math.min(recoveryDelay * 2, 60_000);
  };
  const terminal = (write: Write): write is Terminal => write.state !== "pending"
    && !(write.state === "failed" && ["E_CLOSED", "E_AUTH"].includes(write.why.code));
  const notify = (write: Terminal) => {
    unsavedHolds.delete(write.id);
    dispatchRevisions.delete(write.id);
    restoredIds.delete(write.id);
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
  const journalEntries = (journal: Journal) => journal.pending.map(intent => {
    const hold = unsavedHolds.get(intent.id);
    const reason = (hold?.revision === intent.statusRevision ? hold?.reason : undefined) ?? intent.holdReason;
    return { id: intent.id, op: intent.op, args: intent.args, predicted: [],
      ...(reason ? { state: "held" as const, reason } : { state: intent.dispatched ? "sent" as const : "queued" as const }) };
  });
  const settle = async (write: Terminal) => {
    await change(journal => {
      const intent = journal.pending.find(intent => intent.id === write.id);
      if (!intent) return false;
      presentation.sync(journalEntries(journal), journal.receipts);
      presentation.settled(write, { id: intent.id, op: intent.op, args: intent.args, predicted: [], state: intent.dispatched ? "sent" : "queued" });
      journal.pending = journal.pending.filter(intent => intent.id !== write.id);
      // Never persist historical read results or refusal details for disclosure on reopen.
      journal.receipts.push(receiptOf(write));
      keepReceipts(journal, new Set([write.id]), write.state === "failed" && ["E_STORE_REPLACED", "E_STORE_RESTORE"].includes(write.why.code));
      return true;
    });
    presentation.release(write.id);
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
  // Subscribe across the opening read, when pause's journal subscription does
  // not exist yet. Even a complete viewer round trip retires this lifetime.
  let viewerChanged = false, initialized = false;
  const stopViewer = raw.onViewer(next => {
    if (next !== viewer) { viewerChanged = true; if (initialized) pause(); }
  });
  const initial = await locked(key, read);
  // @ref LLP 3000.013.000#4.5 — liveness is visible to peers before the first capture.
  if (capture) await capture.ready;
  const journalEvents = journalChanges(key, pending.notify);
  for (const intent of initial.pending) restoredIds.add(intent.id);
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
        const submit = async (release = () => {}, captured?: CaptureRecord): Promise<Write<R>> => {
        // Identify before admitting new intent. A reopened journal can name A
        // while this runtime first connects to B; only recovered unbound
        // intent belongs to that earlier history. Existing entries keep their
        // recorded ownership and still pass the strict dispatch guard below.
        const identity = dispatchIdentity(raw);
        // Discovery can fence this runtime and retire its queue. Do not add
        // a later admission behind that completed retirement transaction.
        // @ref LLP 3000.013.000#4.7 — a store refusal cancels a capture only with a
        // terminal refusal to its caller; a pending retirement keeps the record.
        const refusedCapture = async (): Promise<Write<R>> => {
          const outcome = await refusedStore(id);
          if (captured) { if (outcome.state === "failed") capture!.cancel(captured); else capture!.keep(captured); }
          return outcome as Write<R>;
        };
        if (storeRefusal) return refusedCapture();
        // Recovered clicks are admitted before this runtime's new ones.
        if (captured && recovery) await recovery;
        if (storeRefusal) return refusedCapture();
        const admission = (journal: Journal) => {
          const previous = journal.pending.find(intent => intent.id === id);
          if (previous) {
            // MutationIds below checks normalized input without replacing its owner.
            const check = new MutationIds();
            check.remember(id, previous.op, previous.args);
            return check.run(id, op.name, snapshot, async () => ({ state: "pending", id }), async () => ({ state: "pending", id }));
          }
          // @ref LLP 3000.013.000#4.2 — today's precedence, then an id known only by its marker.
          const receipt = journal.receipts.find(write => write.id === id) ?? retiredReceipt(journal, id) ?? capturedReceipt(journal, id);
          if (receipt) return Promise.resolve(receipt);
          if (identity) observeJournalStore(journal, identity);
          // A capture keeps the store it recorded, whatever the transport sees now.
          journal.pending.push({ owner: viewer, id, op: op.name, args: snapshot, storeId: captured?.storeId ?? identity ?? null, dispatched: false });
          return undefined;
        };
        let refusal: Write | undefined;
        try {
          if (captured) {
            const admitted = await admitCaptured(captured, admission);
            if (admitted === sessionEnded) {
              capture!.cancel(captured);
              captureAuthority!.recheck();
              return { state: "failed", id, why: admissionAuthorityRefusal() };
            }
            refusal = admitted.value;
            if (admitted.known) capture!.remove(captured);
            else capture!.cancel(captured);
          } else refusal = await change(admission, true);
        } catch (error) {
          // @ref LLP 3000.013.000#4.2 — the record stays durable: the call stays
          // pending and this runtime recovers it before its next admission.
          if (captured) {
            capture!.failed(captured); scheduleRecovery(); report(error);
            return { state: "pending", id, reason: "journaled in this browser; waiting for the write journal to commit" };
          }
          return { state: "failed", id, why: { code: "E_STORE", family: "store", message: `write ${id} admission outcome is unknown: ${String(error)}` } };
        }
        // A replay answered by a retained receipt ends this runtime's replay ownership too.
        if (refusal?.state === "failed" || refusal?.state === "sent") { restoredIds.delete(id); return refusal as Write<R>; }
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
        // @ref LLP 3000.013.000#4.1 — capture in the calling stack once the store is identified; a refusal admits nothing.
        const admit = (release = () => {}): Promise<Write<R>> => {
          if (!capture || restoredIds.has(id)) return submit(release);
          if (capture.stale) void recover();
          const identity = dispatchIdentity(raw);
          const captured = identity ? capture.capture(id, op.name, snapshot, identity)
            : admissionRefusal("the backend store is not identified; the write was not admitted", "app.mutate", "retry with the same id");
          if (!("v" in captured)) { release(); return failedAdmission<R>(id, captured); }
          return submit(release, captured);
        };
        if ((!dispatchIdentity(raw) || identification.size) && !restoredIds.has(id)) {
          return identification.run({ id, op: op.name, args: snapshot }, async () => {
            if (!active || raw.viewer() !== viewer) return { code: "E_AUTH", family: "auth", message: "sign in to write" };
            if (storeRefusal) return identityRefusal(false);
            await identifyDispatch(raw);
            if (storeRefusal) return identityRefusal(false);
            return !!dispatchIdentity(raw);
          }, admit, why => {
            const write = { state: "failed" as const, id, why };
            emissions.remember(write); notify(write); return write;
          });
        }
        return admit();
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
      // A capture whose commit has not succeeded is still durable custody.
      if (!journal.pending.some(intent => intent.id === id) && capture?.holding(id)) return { state: "pending", id };
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
  // The durable online journal is a client wrapper, not a new history owner.
  guardFollowing(client, raw, async () => (await client.pendingWrites()).length > 0,
    () => active && !storeRefusal && raw.viewer() === viewer);
  registerPendingIntents(client, { scope: intentScope, revision: () => rawIntents.revision?.(), retain: presentation.retain, async read() {
    const before = intentScope(), revision = rawIntents.revision?.();
    if (before == null) return [];
    const journal = await locked(key, read);
    if (before !== intentScope() || revision !== rawIntents.revision?.()) return [];
    const entries = journalEntries(journal);
    const items = presentation.sync(entries, [...journal.receipts, ...unpersisted.values()]);
    const listed = new Set([...items.map(item => item.write.id), ...entries.map(entry => entry.id), ...journal.receipts.map(write => write.id)]);
    return [...items, ...identification.pending().filter(write => !listed.has(write.id)).map(write => pendingIntent(write, true))];
  } });
  registerIntentObserver(client, ids => { if (intentScope() != null) presentation.observed(ids); });
  inheritClose(client, raw);
  // @ref LLP 3000.023#3.4 — this custody lifetime cannot reactivate after an
  // account flip, even if a later response names its original viewer again.
  function pause() { capture?.close(); clearTimeout(recoveryTimer); openGate?.(); identification.close(); active = false; presentation.clear(); pending.notify(); pending.clear(); journalEvents.close(); stopViewer(); stopPending?.(); stop(); listeners.clear(); unpersisted.clear(); unsavedHolds.clear(); dispatchRevisions.clear(); }
  initialized = true;
  if (viewerChanged || raw.viewer() !== viewer) pause();
  // Start in recorded order before a screen can submit a later intent. The
  // online client owns retransmission/backoff, including lost confirmations.
  let started = false;
  function start() {
    if (started || !active) return;
    started = true;
    const recovery = Promise.all(initial.pending.filter(intent => intent.owner === raw.viewer()).map(intent =>
      client.mutate({ kind: "mutation", name: intent.op }, intent.args, { id: intent.id })));
    void recovery.catch(report);
    if (capture) void recover().finally(() => { openGate?.(); openGate = undefined; });
  }
  // @ref LLP 3000.013.000#4.4 — admit this scope's surviving captures once,
  // under the journal lock and then the session lock; replay them before this
  // runtime's new clicks. Ownership first; another authority source is never read.
  function recover(): Promise<void> {
    if (!capture || !active) return Promise.resolve();
    capture.stale = false;
    const adopted: Intent[] = [];
    const run = locked(key, async () => {
      const records = await capture.candidates();
      if (!records.length) return;
      await locked(records[0]!.authority.key, async () => {
        const journal = await read(true);
        const before = JSON.stringify(journal);
        const admitted: CaptureRecord[] = [], ended: CaptureRecord[] = [], reused: CaptureRecord[] = [];
        const known = new Set<string>();
        let blocked = 0;
        for (const record of records) {
          if (record.viewer !== viewer) { if (!await capture.holds(record)) ended.push(record); continue; }
          const pending = journal.pending.find(intent => intent.id === record.id);
          if (pending || journal.receipts.some(write => write.id === record.id) || journal.retired?.includes(record.id) || markedId(journal, record.id)) {
            if (pending && !sameInput(pending, record)) { reused.push(record); continue; }
            // Protect this capture; remove it only after this transaction commits, so a
            // failed save leaves the record and with it the replay obligation below.
            capture.mark(journal, record);
            admitted.push(record);
            // A peer committed this intent and died before sending it: this runtime owns its replay.
            if (pending && !restoredIds.has(record.id) && !known.has(record.id) && !adopted.some(intent => intent.id === record.id)) { known.add(record.id); adopted.push(pending); }
            continue;
          }
          if (!await capture.holds(record)) { ended.push(record); continue; }
          if (journal.retirementFull) { blocked++; continue; }
          const intent: Intent = { owner: viewer, id: record.id, op: record.op, args: record.args, storeId: record.storeId, dispatched: false };
          journal.pending.push(intent); capture.mark(journal, record); adopted.push(intent); admitted.push(record);
        }
        capture.collect(journal);
        const after = JSON.stringify(journal);
        if (after !== before) { await store.set(key, after); journalEvents.notify(); }
        for (const record of admitted) capture.remove(record);
        for (const record of [...ended, ...reused]) capture.cancel(record);
        if (ended.length) console.warn(`snapback4: ${ended.length} browser write${ended.length === 1 ? "" : "s"} captured under a session that has since ended ${ended.length === 1 ? "was" : "were"} not sent (LLP 3000.013.000 §4.6).`);
        if (reused.length) report(new StorageWarning({ code: "E_WRITE_ID_REUSE", family: "input", site: "app.mutate", guide: "writes",
          message: `${reused.length} browser write${reused.length === 1 ? "" : "s"} reused an id already journaled with different input and ${reused.length === 1 ? "was" : "were"} not sent`,
          rewrite: "use a new id for different input" }));
        if (blocked) report(new StorageWarning({ code: "E_WRITE_RECEIPT_EXPIRED", family: "input", site: "app.mutate", guide: "writes",
          message: `${blocked} browser write${blocked === 1 ? " is" : "s are"} kept in this browser but not admitted: the online journal's retirement id limit is full`,
          rewrite: "reconcile the prior outcomes with the backend before explicitly replacing this account's write journal" }));
      });
    });
    writes = run;
    const done = run.then(() => {
      recoveryDelay = 1_000;
      for (const intent of adopted) {
        restoredIds.add(intent.id);
        // A recovered id this runtime reserved earlier belongs to the journal's replay now.
        ids.release(intent.id);
        if (active) void client.mutate({ kind: "mutation", name: intent.op }, intent.args, { id: intent.id }).catch(report);
      }
    }, error => { capture.stale = true; report(error); scheduleRecovery(); });
    recovery = done;
    return done;
  }
  if (autoStart) start();
  function refuseStore(why: Refusal): Promise<void> {
    if (retirement) return retirement;
    storeRefusal = why;
    presentation.clear();
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
