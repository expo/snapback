import type { Read, Refusal } from "./contract.ts";
import type { ServerClock } from "./clock.ts";
import { armReadExpiry, correctReadExpiries, readDeadlineWithdrawn, type ReadDeadlines } from "./read-expiry.ts";
import { matchingReads } from "./read-key.ts";
import { LocalReads, notifyLocalWatch as notify, type LocalWatch as Watch } from "./local-reads.ts";

// @ref LLP 3000.023#10 — held expiry may raise the floor after evaluation returns.
export function withdrawnLocalResult(watches: Iterable<Watch>, watch: Watch,
  result: { read: Read<unknown>; deadlineWithdrawn?: true; serverExpiry?: number | null }): boolean {
  return !!result.deadlineWithdrawn || ("data" in result.read
    && readDeadlineWithdrawn(matchingReads(watches, watch.op, watch.args), result.serverExpiry));
}

export function localReadDeadlines(watches: Map<string, Watch>, answers: LocalReads, clock: ServerClock,
  closed: () => boolean, unavailable: () => Refusal | null, acquireRead: (watch: Watch) => void, online: () => boolean) {
  function scheduleExpiry(watch: Watch, nextExpiry: number | null, serverExpiry?: number | null, localWakeup = false, valueDevice?: number | null, valueServer?: number | null, valueRetry?: number) {
    const deadlines = { device: nextExpiry, server: serverExpiry ?? null, localWakeup, valueDevice, valueServer, valueRetry };
    armReadExpiry(watch, deadlines, clock,
      () => !closed() && watches.get(watch.key) === watch, sweepExpiries,
      (serverDue, now) => answers.expire(watch, serverDue, now), online());
  }
  function sweepExpiries() {
    correctReadExpiries(watches.values(), clock, withdrawExpiry,
      (watch, d) => scheduleExpiry(watch, d.device, d.server, d.localWakeup, d.valueDevice, d.valueServer, d.valueRetry),
      watch => { if (watches.get(watch.key) === watch) acquireRead(watch); });
  }
  function withdrawExpiry(watch: Watch, d: ReadDeadlines, serverDue: boolean, serverNow: number): () => void {
    // @ref LLP 3000.018#3.2 — fence every displayed expiry, preserving newer memory and its cuts.
    answers.expire(watch, serverDue, serverNow);
    // @ref LLP 3000.007#6.5 — Rule 5: expiry ends stale retention before asynchronous recovery.
    const denied = unavailable(), reset = denied || !d.localWakeup || serverDue;
    let deliver: (() => void) | undefined;
    if (denied) deliver = watch.reset({ denied }, true);
    else if (reset) deliver = watch.expire();
    else scheduleExpiry(watch, null, d.server, d.localWakeup, d.valueDevice, d.valueServer); // A local wakeup preserves the server deadline.
    return () => { deliver?.(); if (reset && watches.get(watch.key) === watch) notify(watch); };
  }
  return { scheduleExpiry, sweepExpiries };
}
