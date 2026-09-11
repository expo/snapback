import { RefusalError, supersededRefusal, throwIfAborted, toRefusal, withAbort } from "./client-wire.js";
import type { OutboxSettlement, RecoveryResult } from "./types.js";

export interface RecoveryHost {
  ready(): Promise<void>;
  identity(): string;
  scope(): AbortSignal;
  online(check: () => void, current: () => void): Promise<void>;
  settled(check: () => void): Promise<OutboxSettlement>;
}

export function recoveryLifecycle(): RefusalError {
  return new RefusalError({ code: "E_OFFLINE_LIFECYCLE", family: "offline", guide: "offline",
    site: "client.outbox.recover", message: "recovery stopped because this client was closed or taken offline",
    rewrite: "saved work is kept; reconnect this account when you want to continue" });
}

// @ref LLP 1018.008.006.000#explicit-recovery-on-the-existing-owner — callers
// own deadlines; shared resume/drain transactions outlive an expired waiter.
export async function recoverOutbox(host: RecoveryHost, deadlineMs = 10_000): Promise<RecoveryResult> {
  const identity = host.identity(), scope = host.scope(), waiter = new AbortController();
  let stopped: unknown;
  // Native AbortSignal can omit reason; retain this waiter's structured refusal.
  const stop = (error: unknown) => { stopped ??= error; waiter.abort(); };
  const current = () => {
    if (host.identity() !== identity) throw supersededRefusal();
    if (scope.aborted) throw recoveryLifecycle();
  };
  const check = () => { current(); if (stopped) throw stopped; throwIfAborted(waiter.signal); };
  const invalidate = () => {
    try { current(); } catch (error) { stop(error); }
  };
  scope.addEventListener("abort", invalidate, { once: true });
  const deadline = setTimeout(() => stop(new RefusalError({
    code: "E_TRANSPORT", family: "transport", retryable: true, guide: "offline", site: "client.outbox.recover",
    message: "the recovery wait timed out; your saved work is kept",
    rewrite: "retry recovery to check the work still in progress",
  }, true)), deadlineMs);
  try {
    const settlement = await withAbort(waiter.signal, async () => {
      check();
      await host.ready(); check();
      await host.online(check, current); check();
      const result = await host.settled(check); check();
      return result;
    });
    check();
    return { settlement };
  } catch (error) {
    return { refusal: toRefusal(stopped ?? error) };
  } finally {
    clearTimeout(deadline);
    scope.removeEventListener("abort", invalidate);
  }
}
