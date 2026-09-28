import type { DeviceCore, DeviceOpening } from "./local-device.ts";
import { deliveryCommit } from "./local-device.ts";
import { deviceControl } from "./device-control.ts";
import type { Change } from "./web.ts";
import { indexedDbPersistence } from "./web.ts";
import { claimStore } from "./web-ownership.ts";
import { terminalReceipts, receiptHistory, lookupReceipts } from "./web-receipts.ts";
import { admissionHost } from "./admission.ts";
import { admissionAuthorityHost, admissionAuthorityRefusal } from "./admission-authority.ts";
import { AdmissionJournal, AdmissionError, bindingRefusal, journalStoreBinding, writeRefusal } from "./web-journal.ts";
import { WebWorkerHost, StaleWorkerCommit, type WorkerTransaction, type WorkerWasmSource } from "./web-worker-host.ts";
import { WebWorkerSuspend } from "./web-worker-suspend.ts";
import { adoptWorkerOrphans } from "./web-worker-orphans.ts";
import { successSequence } from "./local-receipts.ts";
import type { Queued } from "./local-types.ts";
import type { Write } from "./contract.ts";
class KnownAdmissionRefusal extends Error { constructor(readonly reply: Record<string, unknown>) { super("admission cancellation failed"); } }

/** Worker adapter for the opt-in browser device. */
export async function openWorkerDevice(name: string, backend: DeviceOpening | null, wasm?: WorkerWasmSource): Promise<DeviceCore> {
  const persist = indexedDbPersistence(), claim = await claimStore(persist, name, true);
  if (!claim) throw new Error("webDevice: persistence could not claim an exclusive device store");
  // The client first tries an offline open. Under the exclusive, quiescent
  // claim, absence of this metadata proves that open must request a backend.
  // Avoid starting and caching a whole VM merely to discover that absence.
  try {
    if (backend === null && await persist.read!(claim.name, "m", "device:backend") === null) {
      throw new Error(JSON.stringify({ denied: { code: "E_AUTH", family: "auth",
        message: "this device has never synced: the server must be reachable once to open" } }));
    }
  } catch (error) { await claim.release(); throw error; }
  const host = new WebWorkerHost(claim);
  const journal = new AdmissionJournal(claim.name, true, id => host.control.capture(id));
  journal.load(await host.open(backend, wasm));
  const suspension = new WebWorkerSuspend(host, journal);
  const prepared = new WeakMap<Record<string, unknown>, ReturnType<AdmissionJournal["capture"]>>();
  const admissions = new Set<string>(), outbox = new Map<string, Queued>();
  const listeners = new Set<(floor?: number) => void>();
  const waiting = new Map<string, AbortController>();
  let chain: Promise<unknown> = Promise.resolve(), closing: Promise<void> | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined, retries = 0;
  let recovered = false;
  let pendingCalls = 0;
  const remember = (changes: readonly Change[]) => {
    journal.remember([...changes]);
    for (const c of changes) if (c.s === "o") {
      if (c.v === null) outbox.delete(c.k); else outbox.set(c.k, JSON.parse(c.v));
    }
  };
  const capture = (request: Record<string, unknown>) => {
    try { prepared.set(request, journal.capture(request)); }
    catch (error) { if (error instanceof AdmissionError) return error.why; throw error; }
    return undefined;
  };
  const retry = () => {
    if (closing || timer || retries === 3) return;
    timer = setTimeout(() => { timer = undefined; background(); }, 1000 * 2 ** retries++);
  };
  const waitForLock = (name: string) => {
    if (closing || waiting.has(name)) return;
    const controller = new AbortController(); waiting.set(name, controller);
    void navigator.locks.request(name, { signal: controller.signal }, () => {}).then(() => {
      waiting.delete(name); if (!closing && !controller.signal.aborted) background();
    }, () => { waiting.delete(name); });
  };
  const settle = async (tx: WorkerTransaction, extra: Change[] = [], durable?: () => void, statusOnly = false) => {
    const changes = await tx.commit([...journal.cleanup(outbox), ...extra], durable);
    remember(changes);
    const floor = Math.max(0, ...[...outbox.values()].map(e => e.now ?? 0));
    if (!statusOnly && changes.some(c => c.s === "o")) for (const notify of listeners) notify(floor);
    journal.cleanup(outbox);
  };
  const recover = async (tx: WorkerTransaction, orphans: boolean) => {
    // A host failure restores its journal/outbox; use the durable image on
    // every transaction so no private mirror survives a lost commit reply.
    journal.load([...tx.journal]); outbox.clear(); remember(tx.journal);
    if (!recovered || orphans) {
      if (await adoptWorkerOrphans(tx, name, claim.name, persist, extra => settle(tx, extra), waitForLock, journal.authority)) retry();
    }
    await journal.fenceWith(tx.invoke);
    await journal.recoverWith(tx.invoke, extra => settle(tx, extra), admissions);
    await settle(tx);
    recovered = true;
  };
  const serial = <T>(work: () => Promise<T>): Promise<T> => {
    const answer = chain.then(work); chain = answer.catch(() => {}); return answer;
  };
  const background = () => {
    if (closing) return;
    void serial(async () => {
      try { await host.transaction(tx => recover(tx, true)); await suspension.prepare(); }
      catch { recovered = false; retry(); }
    });
  };
  const execute = async (tx: WorkerTransaction, request: Record<string, unknown>, admission: ReturnType<AdmissionJournal["capture"]>, committed?: (reply: Record<string, unknown>) => void) => {
    const current = (request as { [deliveryCommit]?: () => boolean })[deliveryCommit];
    if (current && !current()) return { ok: true };
    if (request.op === "settle_exit") {
      const write = request.write as Extract<Write, { state: "failed" }>;
      const history = terminalReceipts((await tx.invoke({ op: "meta", key: "write-history" })).ok);
      const entry = ((await tx.invoke({ op: "queued" })).ok as Queued[]).find(e => e.id === write.id);
      if (history.some(e => e.id === write.id) || !entry || entry.sent_seq != null || entry.observed_seq != null) { await settle(tx); return { ok: false }; }
      const kept = await tx.invoke({ op: "keep_write", value: JSON.stringify({ state: "failed", id: write.id, why: {
        code: write.why.code, family: write.why.family, message: `write refused: ${write.why.code}; whether it executed is unknown; do not retry automatically`,
      } }) });
      if (kept.denied) { await settle(tx); return kept; }
      const retired = await tx.invoke({ op: "settle", id: write.id });
      if (retired.denied) throw new Error(retired.denied.message);
      const reply = { ok: true }; await settle(tx, [], () => committed?.(reply)); return reply;
    }
    if (request.op === "begin_send" && typeof request.id === "string") {
      const entry = outbox.get(request.id), seq = entry?.sent_seq ?? entry?.observed_seq;
      if (seq != null) {
        const qualified = successSequence(entry) === seq;
        if (!qualified) {
          const started = await tx.invoke({ op: "begin_send", id: request.id });
          if (started.denied) { await settle(tx); return started; }
          await settle(tx, [], undefined, true);
        }
        return { ok: { receipt: { state: "sent", id: request.id, seq, replayed: true }, qualified } };
      }
      const state = (await tx.invoke({ op: "sync_state", capture: false })).ok;
      const binding = journalStoreBinding(journal.boundStore(request.id), state.store_id);
      if (!entry || binding !== "allow") {
        await journal.fenceWith(tx.invoke); await settle(tx);
        return { denied: bindingRefusal(binding === "defer" ? "defer" : "retire") };
      }
    }
    // Remove page closures before structured cloning.
    const wire = Object.fromEntries(Object.entries(request));
    const reply = request.op === "admit" ? await journal.admitWith(tx.invoke, request.entry, admission?.storeId) : await tx.invoke(wire);
    if (request.op === "queued" && Array.isArray(reply.ok)) reply.ok = reply.ok.map((entry: Queued) => ({ ...entry, store_id: entry.receipt_store?.id ?? journal.boundStore(entry.id) }));
    const observes = ["observe_store", "apply", "adopt"].includes(String(request.op));
    if (!reply.denied && observes) await journal.fenceWith(tx.invoke);
    if (current) { await tx.commitIf(current); committed?.(reply); }
    else {
      try {
        await settle(tx, !admission ? [] : !reply.denied ? [journal.transfer(admission, false)] : writeRefusal(reply) ? journal.refused(admission) : [],
          () => committed?.(reply), request.op === "begin_send" || request.op === "hold_write");
      } catch (error) {
        if (!admission || !writeRefusal(reply)) throw error;
        // Known local refusal wins even if cancellation bookkeeping failed.
        throw new KnownAdmissionRefusal(reply);
      }
    }
    if (admission) host.control.admitted(admission.entry.id);
    if (!reply.denied && observes) await recover(tx, true);
    if (request.op === "meta" && request.key === "write-history" && request.lookup === true && !reply.denied) {
      reply.ok = JSON.stringify(lookupReceipts(await receiptHistory(persist, name), terminalReceipts(reply.ok)));
    }
    return reply;
  };
  const core: DeviceCore = {
    [deviceControl]: () => host.control.read(),
    onOutbox(listener) { listeners.add(listener); return () => { listeners.delete(listener); }; },
    onSuspend: flush => suspension.onSuspend(flush),
    media: {
      read: id => persist.read!(`snapback4-media:${claim.name}`, "a", id),
      write: (id, hex) => persist.save(`snapback4-media:${claim.name}`, [{ s: "a", k: id, v: hex }]),
      remove: id => persist.save(`snapback4-media:${claim.name}`, [{ s: "a", k: id, v: null }]),
    },
    [deliveryCommit](request, current) { return core.call({ ...request, [deliveryCommit]: current }); },
    call(request, committed) {
      if (closing) return Promise.reject(new Error("the device is closed"));
      if (request.op === "admit" && !prepared.has(request)) {
        const denied = capture(request); if (denied) return Promise.resolve({ denied });
      }
      const admission = prepared.get(request); prepared.delete(request);
      if (admission) { request = { ...request, entry: admission.entry }; admissions.add(admission.entry.id); }
      // Enqueue on the host now, not after an async page-chain wait, so a
      // prepared exit loses permission before any newer capture can occur.
      host.invalidatePreparation(); pendingCalls++;
      return serial(async () => {
        try {
          const reply = await host.transaction(async tx => {
            await recover(tx, false);
            return admission ? journal.authorize(admission, () => execute(tx, request, admission, committed), async () => {
              const refused = { denied: admissionAuthorityRefusal() };
              await settle(tx, journal.refused(admission), () => committed?.(refused));
              host.control.admitted(admission.entry.id); return refused;
            }) : execute(tx, request, admission, committed);
          });
          if (pendingCalls === 1 && ["admit", "enqueue", "settle", "settle_exit", "begin_send"].includes(String(request.op))) await suspension.prepare();
          return reply;
        } catch (error) {
          recovered = false;
          if (error instanceof StaleWorkerCommit) return { ok: true };
          if (error instanceof KnownAdmissionRefusal) return error.reply;
          throw error;
        } finally { pendingCalls--; if (admission) admissions.delete(admission.entry.id); }
      });
    },
    close() {
      suspension.close(); listeners.clear(); clearTimeout(timer);
      for (const waiter of waiting.values()) waiter.abort(); waiting.clear();
      return closing ??= chain.then(() => host.close());
    },
  };
  admissionHost(core, capture);
  admissionAuthorityHost(core, authority => { journal.authority = authority; background(); });
  return core;
}
