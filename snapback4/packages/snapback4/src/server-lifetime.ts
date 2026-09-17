/** Unlike a raw injected fetch, this settles on abort even if its implementation
 * ignores the signal. The pending fetch's rejection is still observed. */
export async function untilAborted<T>(work: () => Promise<T>, signal?: AbortSignal | null): Promise<T> {
  if (signal?.aborted) throw signal.reason;
  if (!signal) return work();
  return new Promise((resolve, reject) => {
    const abort = () => { signal.removeEventListener("abort", abort); reject(signal.reason); };
    signal.addEventListener("abort", abort, { once: true });
    Promise.resolve().then(() => { if (signal.aborted) throw signal.reason; return work(); }).then(resolve, reject).finally(() => signal.removeEventListener("abort", abort));
  });
}

/** Bind both a fetch and consumption of any response clones to one lifetime.
 * This is a settlement guard for injected transports that ignore AbortSignal,
 * not a claim that aborting a request cancels a committed server operation. */
export function lifetimeFetch(doFetch: typeof fetch, lifetime: AbortSignal): typeof fetch {
  const responseWithin = (response: Response, signal: AbortSignal): Response => new Proxy(response, {
    get(target, property) {
      if (property === "clone") return () => responseWithin(target.clone(), signal);
      if (["arrayBuffer", "blob", "bytes", "formData", "json", "text"].includes(String(property))) {
        const consume = Reflect.get(target, property, target) as ((...args: unknown[]) => Promise<unknown>) | undefined;
        if (typeof consume === "function") return (...args: unknown[]) => untilAborted(() => consume.apply(target, args), signal);
      }
      const value = Reflect.get(target, property, target) as unknown;
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
  return async (input, init) => {
    const signal = init?.signal ? AbortSignal.any([lifetime, init.signal]) : lifetime;
    const response = await untilAborted(() => doFetch(input, { ...init, signal }), signal);
    return responseWithin(response, signal);
  };
}

/** @internal Run one status check under the shared hard bound. The outer race settles
 * even when an injected transport or the check itself ignores AbortSignal. */
export async function boundedStatusCheck(
  check: (timeout: AbortSignal) => Promise<void>,
  lifetime?: AbortSignal,
  timeoutMs = 10_000,
): Promise<void> {
  const timeout = new AbortController();
  const timer = setTimeout(() => timeout.abort(), timeoutMs);
  const signal = lifetime ? AbortSignal.any([lifetime, timeout.signal]) : timeout.signal;
  try { await untilAborted(() => check(signal), signal); }
  finally { clearTimeout(timer); }
}

/** One abort-aware status cadence shared by generated action and effect
 * contexts. The caller remains authoritative for interpreting status. */
export function statusPoller(options: {
  readonly intervalMs: number;
  readonly stopped: () => boolean;
  readonly poll: (timeout: AbortSignal) => Promise<void>;
  readonly lost: (error: unknown) => void;
}): { close(): void; quiesce(): Promise<void> } {
  let timer: ReturnType<typeof setTimeout> | undefined;
  let active: Promise<void> | undefined;
  let closed = false;
  let quiesced = false;
  const schedule = () => {
    if (closed || quiesced || options.stopped()) return;
    // A handler may await only its cancellation signal; keep this timer live.
    timer = setTimeout(() => { void poll(); }, options.intervalMs);
  };
  const poll = () => {
    timer = undefined;
    if (closed || quiesced || options.stopped()) return;
    active = (async () => {
      try { await boundedStatusCheck(options.poll); }
      catch (error) { if (!closed && !options.stopped()) options.lost(error); }
      finally { active = undefined; schedule(); }
    })();
  };
  schedule();
  return {
    close() { closed = true; if (timer) clearTimeout(timer); timer = undefined; },
    async quiesce() {
      quiesced = true;
      if (timer) clearTimeout(timer);
      timer = undefined;
      await active;
    },
  };
}
