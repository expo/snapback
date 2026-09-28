import type { ServerClock } from "./clock.ts";
import { armReadExpiry, correctReadExpiries, type ReadDeadlines } from "./read-expiry.ts";
import { notifyLocalWatch as notify } from "./local-reads.ts";
import type { Query, Read, Refusal } from "./contract.ts";
import type { BackendJson } from "./backend.ts";
import type { LocalReads, LocalWatch } from "./local-reads.ts";
import { invalidateReadEvidence, readKey } from "./read-observation.ts";
import { putRetention } from "./read-nonrevoking.ts";

type Result = {
  op: Query<unknown, unknown>; args: unknown; read: Read<unknown>; tables: Set<string>;
  invalidated?: boolean; serverOnly?: boolean; seq?: number | undefined;
  nextExpiry: number | null; serverExpiry?: number | null; localWakeup?: boolean;
};
// @ref LLP 3000.029#7 — the last synchronous gate also covers direct reads and
// other observations created while a replica cut is pending.
export function reconcileLocalRead(answers: LocalReads, watches: Iterable<LocalWatch>, backend: BackendJson | null,
  result: Result, publish: () => boolean,
  expiry: (watch: LocalWatch, device: number | null, server?: number | null, wakeup?: boolean) => void, watch?: LocalWatch): boolean {
  const key = readKey(result.op, result.args);
  if (!result.serverOnly && answers.blocked(key, result.tables)) return "loading" in result.read && publish();
  if (!result.invalidated) return publish();
  answers.replacement(key, result.seq);
  return invalidateReadEvidence(watches, result.op, result.args, result.read, peer => {
    peer.stablePuts = putRetention(backend, result.op.name); peer.tables = new Set(result.tables);
    peer.serverRead = true; peer.serverOnly = result.serverOnly === true; peer.serverSeq = result.seq;
    expiry(peer, result.nextExpiry, result.serverExpiry, result.localWakeup);
  }, watch, publish);
}

export function localReadDeadlines(watches: Map<string, LocalWatch>, answers: LocalReads, clock: ServerClock,
  closed: () => boolean, unavailable: () => Refusal | null, rerun: (watch: LocalWatch) => Promise<void>) {
  function scheduleExpiry(watch: LocalWatch, nextExpiry: number | null, serverExpiry?: number | null, localWakeup = false) {
    const deadlines = { device: nextExpiry, server: serverExpiry ?? null, localWakeup };
    armReadExpiry(watch, deadlines, clock,
      () => !closed() && watches.get(watch.key) === watch, sweepExpiries,
      (serverDue, now) => answers.expire(watch, serverDue, now));
  }
  function sweepExpiries() {
    correctReadExpiries(watches.values(), clock, withdrawExpiry,
      (watch, d) => scheduleExpiry(watch, d.device, d.server, d.localWakeup),
      watch => { if (watches.get(watch.key) === watch) void rerun(watch); });
  }
  function withdrawExpiry(watch: LocalWatch, d: ReadDeadlines, serverDue: boolean, serverNow: number): () => void {
    // @ref LLP 3000.018#3.2 — fence every displayed expiry, preserving newer memory and its cuts.
    answers.expire(watch, serverDue, serverNow);
    // @ref LLP 3000.007#6.5 — Rule 5: expiry ends stale retention before asynchronous recovery.
    const denied = unavailable(), reset = denied || !d.localWakeup || serverDue;
    let deliver: (() => void) | undefined;
    if (denied) deliver = watch.reset({ denied }, true);
    else if (reset) deliver = watch.expire();
    else scheduleExpiry(watch, null, d.server, d.localWakeup); // A local wakeup preserves the server deadline.
    return () => { deliver?.(); if (reset && watches.get(watch.key) === watch) notify(watch); };
  }
  return { scheduleExpiry, sweepExpiries };
}
