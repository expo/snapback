// @ref LLP 1018.003.000#4-observation-and-retention —
// one read model per client, no settlement effects in mounted hooks.
import { referenceName, type Op } from "./api.js";
import type { RecoveryDemand } from "./client-recovery.js";
import { intentLabel, readiness } from "./snapshot.js";
import { dismissible } from "./store/outbox.js";
import { immutable } from '../../evaluator/src/row-image.js';
import type { ConnectionState, ObservedOutbox, OutboxEntry, OutboxSnapshot, OutboxStatus, OutboxWork } from "./types.js";

const empty = Object.freeze([]) as unknown as OutboxEntry[];
const initialStatus: OutboxStatus = Object.freeze({ ready: false, reason: "grant-missing", action: "connect", remaining: 0, fence: "inside" });
const initial: OutboxSnapshot = Object.freeze({ entries: empty, work: Object.freeze([]),
  can: Object.freeze(readiness(initialStatus, "reconnecting", 0)), status: initialStatus });

interface WorkModel { work: readonly OutboxWork[]; byIntent: Map<string, OutboxWork>; queued: Map<string, number>; total: number }
const models = new WeakMap<readonly OutboxEntry[], WorkModel>();
// @ref LLP 1018.008.006.000#one-presentation-of-durable-work — one derived
// index per immutable ledger revision, shared by operation slots and hooks.
export function workModel(entries: readonly OutboxEntry[]): WorkModel {
  const previous = models.get(entries);
  if (previous) return previous;
  const byIntent = new Map<string, OutboxWork>(), queued = new Map<string, number>();
  let total = 0;
  const work = Object.freeze(entries.map(entry => {
    const item = Object.freeze({ entry, label: intentLabel(entry), dismissible: dismissible(entry) });
    byIntent.set(entry.intent, item);
    if (entry.inbox !== undefined) byIntent.set(`inbox:${entry.inbox}`, item);
    if (entry.state === "queued") { total += 1; queued.set(entry.op, (queued.get(entry.op) ?? 0) + 1); }
    return item;
  }));
  const model = { work, byIntent, queued, total };
  models.set(entries, model);
  return model;
}
interface Slot {
  op?: Op<any, any>;
  identity?: string;
  snapshot: OutboxSnapshot;
  listeners: Set<() => void>;
  demand?: RecoveryDemand;
}

export function observeOutbox(
  entries: () => Promise<OutboxEntry[]>, status: (op?: Op<any, any>) => Promise<OutboxStatus>,
  subscribe: (notify: () => void) => () => void, identity: () => string,
  writer: () => OutboxStatus | undefined = () => undefined,
  prepare?: (op: string) => RecoveryDemand,
  connection: () => ConnectionState = () => "reconnecting",
): <Args, Result>(op?: Op<Args, Result>) => ObservedOutbox {
  const slots = new Map<string, Slot>();
  let unsubscribe: (() => void) | undefined, version = 0, scheduled = false;
  let history = initial.entries, historyKey = "", historyAccount: string | undefined;
  const refresh = () => {
    version += 1;
    if (scheduled) return;
    scheduled = true;
    queueMicrotask(() => {
      scheduled = false;
      if (slots.size === 0) return;
      const current = version, account = identity(), active = [...slots.values()];
      void Promise.all([entries(), Promise.all(active.map(slot => status(slot.op)))]).then(([entries, statuses]) => {
        if (current !== version || account !== identity()) return;
        // Compare the ledger once for the client, independent of operation slots.
        const key = JSON.stringify(entries);
        if (key !== historyKey || historyAccount !== account) {
          history = immutable(entries); historyKey = key; historyAccount = account;
        }
        const announced = writer();
        const model = workModel(history), connected = connection();
        for (const [at, slot] of active.entries()) {
          if (slot.listeners.size === 0) continue;
          slot.demand?.update(statuses[at]!);
          // @ref LLP 1018.004#3-readiness-on-a-follower — the writer's announced grant state rides beside a follower's own status.
          const next: OutboxSnapshot = { entries: history, work: model.work, status: Object.freeze(statuses[at]!),
            can: Object.freeze(readiness(statuses[at]!, connected, slot.op === undefined ? model.total : model.queued.get(referenceName(slot.op)) ?? 0)),
            ...(announced === undefined ? {} : { writer: Object.freeze({ ...announced }) }) };
          if (slot.identity === account && slot.snapshot.entries === history
            && JSON.stringify(slot.snapshot.status) === JSON.stringify(next.status)
            && JSON.stringify(slot.snapshot.can) === JSON.stringify(next.can)
            && JSON.stringify(slot.snapshot.writer) === JSON.stringify(next.writer)) continue;
          slot.identity = account; slot.snapshot = Object.freeze(next);
          for (const notify of [...slot.listeners]) try { notify(); } catch { /* isolated consumers */ }
        }
      }, () => undefined);
    });
  };
  return (op) => {
    const key = op === undefined ? "" : referenceName(op);
    const getSnapshot = () => {
      const slot = slots.get(key);
      return slot?.identity === identity() ? slot.snapshot : initial;
    };
    return {
      getSnapshot,
      getWork: intent => workModel(getSnapshot().entries).byIntent.get(intent),
      subscribe: notify => {
        let slot = slots.get(key);
        if (!slot) { slot = { op, snapshot: initial, listeners: new Set() }; slots.set(key, slot); if (op !== undefined) slot.demand = prepare?.(key); }
        // Each attachment has its own identity even when callbacks are equal.
        const listener = () => notify();
        slot.listeners.add(listener);
        unsubscribe ??= subscribe(refresh);
        refresh();
        let closed = false;
        return () => {
          if (closed) return;
          closed = true;
          slot!.listeners.delete(listener);
          if (slot!.listeners.size === 0) { slot!.demand?.close(); slots.delete(key); }
          if (slots.size === 0) { version += 1; unsubscribe?.(); unsubscribe = undefined; history = initial.entries; historyKey = ""; historyAccount = undefined; }
        };
      },
    };
  };
}
