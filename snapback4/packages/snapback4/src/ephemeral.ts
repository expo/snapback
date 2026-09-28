// @ref LLP 3000.017#24-the-client — one ordered, memory-only lane; only proven renewals coalesce.
import type { Client, Ephemeral, Link, MutateOptions, Mutation, MutationPromise, Refusal, Signal } from "./contract.ts";
import { refusal, readResponse, invalidResponse, transportRefusal } from "./http-response.ts";

export const ephemeralOffline = (): Refusal => ({ code: "E_OFFLINE", family: "link", retryable: true,
  message: "an ephemeral write needs an online link; it is dropped, not held or retried" });
export const failedSignal = (id: string, why: Refusal): Signal<never> => ({ state: "failed", id, why });

/** Keep the public overloads at every facade without widening an ephemeral op
 * to a durable mutation. The first decision always precedes durable custody. */
export function routeMutations(
  signal: <A, R>(op: Ephemeral<A, R>, args: A) => Promise<Signal<R>>,
  durable: <A, R>(op: Mutation<A, R>, args: A, options?: MutateOptions) => MutationPromise<R>,
): Client["mutate"] {
  function mutate<A, R>(op: Ephemeral<A, R>, args: A): Promise<Signal<R>>;
  function mutate<A, R>(op: Mutation<A, R>, args: A, options?: MutateOptions): MutationPromise<R>;
  function mutate<A, R>(op: Ephemeral<A, R> | Mutation<A, R>, args: A, options?: MutateOptions) {
    return op.ephemeral ? signal(op, args) : durable(op, args, options);
  }
  return mutate;
}

interface Options {
  url: string;
  fetch: typeof fetch;
  headers(): Record<string, string>;
  link(): Link;
  mint(): string;
  offline(): void;
  signal: AbortSignal;
  unavailable?(): Refusal | null | undefined;
  storeId?(): string | undefined;
  now?(): number;
}
interface Entry {
  op: Ephemeral<unknown, unknown>;
  args: unknown;
  id: string;
  key: string;
  resolve(outcome: Signal): void;
}

export function ephemeralLane(options: Options) {
  const waiting: Entry[] = [];
  const now = options.now ?? (() => performance.now());
  let running = false;
  let previous: { key: string; at: number; outcome: Signal } | undefined;
  const unavailable = () => options.unavailable?.() ?? (options.signal.aborted
    ? { code: "E_CLOSED", family: "client", message: "this client is closed" }
    : options.link() !== "online" ? ephemeralOffline() : undefined);
  const dropWaiting = () => {
    previous = undefined;
    for (const entry of waiting.splice(0)) entry.resolve(failedSignal(entry.id, unavailable() ?? ephemeralOffline()));
  };
  options.signal.addEventListener("abort", dropWaiting, { once: true });
  const reusable = (op: Ephemeral<unknown, unknown>, key: string) => op.renews && previous?.key === key
    && now() - previous.at < op.renewMs && waiting.length === 0 ? previous.outcome : undefined;

  async function send(entry: Entry): Promise<Signal> {
    const controller = new AbortController();
    const abort = () => controller.abort();
    options.signal.addEventListener("abort", abort, { once: true });
    const timeout = setTimeout(abort, 4000);
    const interrupted = new Promise<never>((_, reject) => {
      controller.signal.addEventListener("abort", () => reject(new Error("ephemeral request interrupted")), { once: true });
    });
    try {
      const work = (async (): Promise<Signal> => {
        const store = options.storeId?.();
        const response = await options.fetch(`${options.url}/m/${entry.op.name}`, {
          method: "POST", headers: options.headers(), signal: controller.signal,
          body: JSON.stringify({ id: entry.id, args: entry.args, ...(store ? { store_id: store } : {}) }),
        });
        const json = await readResponse(response);
        const denied = refusal(json?.denied ?? json?.why);
        if (denied) return failedSignal(entry.id, denied);
        if (json?.state === "sent" && Object.hasOwn(json, "result") && !("seq" in json)) {
          return { state: "sent", id: entry.id, result: json.result };
        }
        return failedSignal(entry.id, invalidResponse(response.status, "ephemeral write"));
      })();
      return await Promise.race([work, interrupted]);
    } catch (error) {
      if (!options.signal.aborted) options.offline();
      return failedSignal(entry.id, (options.signal.aborted ? unavailable() : options.unavailable?.()) ?? transportRefusal(error));
    } finally {
      clearTimeout(timeout);
      options.signal.removeEventListener("abort", abort);
    }
  }
  async function drain() {
    if (running) return;
    running = true;
    try {
      while (waiting.length) {
        if (unavailable()) { dropWaiting(); break; }
        const entry = waiting.shift()!;
        const saved = reusable(entry.op, entry.key);
        if (saved) { entry.resolve(saved); continue; }
        const at = now();
        // An intervening dispatch closes the renewal window, even on refusal.
        previous = undefined;
        const outcome = await send(entry);
        if (outcome.state === "sent" && !unavailable()) previous = { key: entry.key, at, outcome };
        entry.resolve(outcome);
      }
    } finally { running = false; }
  }
  return {
    linkChanged() { if (options.link() !== "online") dropWaiting(); },
    mutate<A, R>(op: Ephemeral<A, R>, args: A): Promise<Signal<R>> {
      const id = options.mint();
      const why = unavailable();
      if (why) return Promise.resolve(failedSignal(id, why));
      let snapshot: unknown, key: string;
      try {
        snapshot = JSON.parse(JSON.stringify(args));
        const sorted = (value: unknown): unknown => Array.isArray(value) ? value.map(sorted)
          : value && typeof value === "object" ? Object.fromEntries(Object.entries(value).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0).map(([k, v]) => [k, sorted(v)])) : value;
        key = JSON.stringify([op.name, sorted(snapshot)]);
      } catch {
        return Promise.resolve(failedSignal(id, { code: "E_INPUT", family: "input", message: "ephemeral arguments must be JSON-serializable" }));
      }
      const saved = !running && reusable(op, key);
      if (saved) return Promise.resolve(saved as Signal<R>);
      const replace = op.renews ? waiting.findIndex(entry => entry.op.renews && entry.key === key) : -1;
      if (replace < 0 && waiting.length >= 256) return Promise.resolve(failedSignal(id,
        { code: "E_RATE_LIMIT", family: "auth", retryable: true, message: "the ephemeral lane already holds 256 waiting calls" }));
      const displaced = replace < 0 ? undefined : waiting.splice(replace, 1)[0];
      const promise = new Promise<Signal<R>>(resolve => {
        waiting.push({ op, args: snapshot, id, key, resolve(outcome) { resolve(outcome as Signal<R>); } });
      });
      if (displaced) void promise.then(outcome => displaced.resolve(outcome));
      void drain();
      return promise;
    },
  };
}
