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

/** One abort-aware status cadence shared by generated action and effect
 * contexts. The caller remains authoritative for interpreting status. */
export function statusPoller(options: {
  readonly intervalMs: number;
  readonly stopped: () => boolean;
  readonly poll: (timeout: AbortSignal) => Promise<void>;
  readonly lost: (error: unknown) => void;
}): { close(): void } {
  let timer: ReturnType<typeof setTimeout> | undefined;
  let closed = false;
  const schedule = () => {
    if (closed || options.stopped()) return;
    // A handler may await only its cancellation signal; keep this timer live.
    timer = setTimeout(() => { void poll(); }, options.intervalMs);
  };
  const poll = async () => {
    timer = undefined;
    if (closed || options.stopped()) return;
    const timeout = new AbortController();
    const timeoutTimer = setTimeout(() => timeout.abort(), 10_000);
    try { await options.poll(timeout.signal); }
    catch (error) { if (!closed && !options.stopped()) options.lost(error); }
    finally { clearTimeout(timeoutTimer); }
    schedule();
  };
  schedule();
  return { close() { closed = true; if (timer) clearTimeout(timer); } };
}
