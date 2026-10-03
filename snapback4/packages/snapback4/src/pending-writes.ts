import type { IdentityWait } from "./identity-admission.ts";
import { pendingIntent, registerPendingIntents, type PendingIntent } from "./pending-items.ts";
import type { Client, PendingWrite, Refusal } from "./contract.ts";
import type { Queued } from "./local-types.ts";
import { successSequence } from "./local-receipts.ts";
import type { WriteHistory } from "./writes.ts";

// @ref LLP 3000.019#3.3 — notifications invalidate a view of existing custody;
// no second queue owns admission, delivery order or terminal outcomes.
export function pendingChanges() {
  const listeners = new Set<() => void>();
  return {
    subscribe(notify: () => void) { listeners.add(notify); return () => { listeners.delete(notify); }; },
    notify() {
      for (const notify of listeners) {
        try { notify(); } catch (error) { console.error("snapback4 pending writes listener:", error); }
      }
    },
    clear() { listeners.clear(); },
  };
}

export async function localPendingWrites(queued: () => Promise<Queued[]>, history: WriteHistory,
  unavailable: () => unknown, acquired: () => boolean, holds?: ReturnType<typeof localPendingHolds>): Promise<readonly PendingWrite[]> {
  if (unavailable()) return [];
  const entries = await queued();
  if (unavailable()) return [];
  const terminal = await history.settledIds();
  if (unavailable()) return [];
  const unsettled = entries.filter(entry => successSequence(entry) == null && !terminal.has(entry.id));
  const reasons = await holds?.reasons(unsettled);
  if (unavailable()) return [];
  return unsettled.map(entry => {
    const reason = reasons?.get(entry.id) ?? entry.dispatch;
    const state = reason ? "held" : entry.dispatch != null || entry.sent_seq != null || entry.observed_seq != null ? "sent" : "queued";
    return {
      id: entry.id, op: entry.op, args: entry.args,
      state,
      ...(reason ? { reason } : state === "queued" && !entry.predictable && !entry.predicted.length
        ? { reason: !acquired() ? "queued without a row: not acquired yet" : "queued without a row: local data does not justify prediction" } : {}),
      predicted: entry.predicted,
    };
  });
}

// @ref LLP 3000.019#3.3 — a failed status save cannot erase an observed hold.
// The device's send revision and persisted status fence this runtime-only view;
// the outbox remains the sole owner of ordering and durable custody.
export function localPendingHolds(call: (request: Record<string, unknown>) => Promise<{ ok?: unknown; denied?: Refusal }>,
  current: () => string | undefined, notify: () => void) {
  const holds = new Map<string, { reason: string; revision: number; lifetime: string }>();
  const revision = async () => (await call({ op: "sync_state", capture: false })).ok as { send_revision: number } | undefined;
  return {
    clear() { holds.clear(); },
    forget(id: string) { holds.delete(id); },
    async record(id: string, reason: string) {
      const lifetime = current();
      if (lifetime === undefined) return;
      const before = await revision();
      if (lifetime !== current()) return;
      try {
        const result = await call({ op: "hold_write", id, reason });
        if (!result.denied) { holds.delete(id); return; }
      } catch { /* Keep the received refusal even when the VM discards its failed save. */ }
      if (before && lifetime === current()) {
        holds.set(id, { reason, revision: before.send_revision, lifetime });
        notify();
      }
    },
    async reasons(entries: Queued[]) {
      const reasons = new Map<string, string>();
      if (!holds.size) return reasons;
      const status = await revision(), lifetime = current();
      const queued = new Map(entries.map(entry => [entry.id, entry]));
      for (const [id, hold] of holds) {
        const entry = queued.get(id);
        if (!entry || entry.dispatch !== "" || lifetime !== hold.lifetime || status?.send_revision !== hold.revision) holds.delete(id);
        else reasons.set(id, hold.reason);
      }
      return reasons;
    },
  };
}

// @ref LLP 3000.019#3.3.1 — retain the device's successful unobserved entry,
// even when the public pending list excludes it. Read-only, never a second outbox.
export function registerLocalPendingIntents(client: Client, queued: () => Promise<Queued[]>, history: WriteHistory,
  identification: IdentityWait, holds: ReturnType<typeof localPendingHolds>, scope: () => unknown, acquired: () => boolean) {
  registerPendingIntents(client, { scope, async read() {
    const before = scope();
    if (before == null) return [];
    const entries = await queued();
    if (before !== scope()) return [];
    const receipts = await history.presentationReceipts();
    if (before !== scope()) return [];
    const reasons = await holds.reasons(entries);
    if (before !== scope()) return [];
    const items: PendingIntent[] = [];
    for (const entry of entries) {
      const receipt = receipts.get(entry.id);
      if (receipt?.state === "failed") continue;
      const seq = successSequence(entry) ?? (receipt?.state === "sent" ? receipt.seq : undefined);
      const reason = reasons.get(entry.id) ?? entry.dispatch;
      const state = reason ? "held" : entry.dispatch != null || entry.sent_seq != null || entry.observed_seq != null ? "sent" : "queued";
      const write = { id: entry.id, op: entry.op, args: entry.args, predicted: entry.predicted, state,
        ...(reason ? { reason } : state === "queued" && !entry.predictable && !entry.predicted.length
          ? { reason: !acquired() ? "queued without a row: not acquired yet" : "queued without a row: local data does not justify prediction" } : {}) } as const;
      items.push(seq === undefined ? pendingIntent(write) : { write, phase: "settling", receipt: { state: "sent", id: entry.id, seq, replayed: true } });
    }
    // A terminal receipt can precede release of the identity/admission caller.
    // It always wins over that caller's still-live saving indicator.
    const admitted = new Set(entries.map(entry => entry.id));
    for (const write of identification.pending()) if (!admitted.has(write.id) && !receipts.has(write.id)) items.push(pendingIntent(write, true));
    return before === scope() ? items : [];
  } });
}
