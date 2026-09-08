// @ref LLP 1018.003#10-retirement-is-a-read-model-decision-dismissal-is-a-write —
// one read model per client, no settlement effects in mounted hooks.
import { referenceName, type Op } from "./api.js";
import type { ObservedOutbox, OutboxEntry, OutboxSnapshot, OutboxStatus } from "./types.js";

const initial: OutboxSnapshot = Object.freeze({ entries: Object.freeze([]) as unknown as OutboxEntry[],
  status: Object.freeze({ ready: false, reason: "grant-missing", action: "resume", remaining: 0, fence: "inside" }) });
interface Slot {
  op?: Op<any, any>;
  identity?: string;
  snapshot: OutboxSnapshot;
  listeners: Set<() => void>;
}

function immutable<T>(value: T): T {
  if (value && typeof value === "object") {
    for (const child of Object.values(value)) immutable(child);
    Object.freeze(value);
  }
  return value;
}

export function observeOutbox(
  entries: () => Promise<OutboxEntry[]>, status: (op?: Op<any, any>) => Promise<OutboxStatus>,
  subscribe: (notify: () => void) => () => void, identity: () => string,
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
        for (const [at, slot] of active.entries()) {
          if (slot.listeners.size === 0) continue;
          const next = { entries: history, status: Object.freeze(statuses[at]!) };
          if (slot.identity === account && slot.snapshot.entries === history
            && JSON.stringify(slot.snapshot.status) === JSON.stringify(next.status)) continue;
          slot.identity = account; slot.snapshot = Object.freeze(next);
          for (const notify of [...slot.listeners]) try { notify(); } catch { /* isolated consumers */ }
        }
      }, () => undefined);
    });
  };
  return (op) => {
    const key = op === undefined ? "" : referenceName(op);
    return {
      getSnapshot: () => {
        const slot = slots.get(key);
        return slot?.identity === identity() ? slot.snapshot : initial;
      },
      subscribe: notify => {
        let slot = slots.get(key);
        if (!slot) { slot = { op, snapshot: initial, listeners: new Set() }; slots.set(key, slot); }
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
          if (slot!.listeners.size === 0) slots.delete(key);
          if (slots.size === 0) { version += 1; unsubscribe?.(); unsubscribe = undefined; history = initial.entries; historyKey = ""; historyAccount = undefined; }
        };
      },
    };
  };
}
