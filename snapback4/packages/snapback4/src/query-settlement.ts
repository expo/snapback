import type { Client, Query, Read, Refusal, SettledRead } from "./contract.ts";
import { checkRead, duringRead, withReadSignal, READ_WORK_LIFETIME } from "./read-work.ts";

// @ref LLP 3000.023#11 — queue, evaluation and facade approval share one deadline.
export const QUERY_LIFETIME = READ_WORK_LIFETIME;
export const QUERY_ROUNDS = 4;
const expired = Symbol("one-shot deadline");
type Publication<R> = () => Read<R> | undefined;
type Attempt = <A, R>(op: Query<A, R>, args: A, signal: AbortSignal) => Promise<Publication<R>>;
const attempts = new WeakMap<Client["query"], Attempt>();

function retry(): Refusal {
  return { code: "E_QUERY_RETRY", family: "client", retryable: true, site: "client.query", guide: "client",
    message: "the read did not settle within four rounds or 30 seconds; retry the query" };
}

// Facades use the raw client's same evaluator and final publication fence. They
// add approval inside this budget, rather than nesting independent retry loops.
export async function queryAttempt<A, R>(client: Client, op: Query<A, R>, args: A, signal: AbortSignal): Promise<Publication<R>> {
  const attempt = attempts.get(client.query);
  if (attempt) return attempt(op, args, signal);
  const read = await duringRead(client.query(op, args), signal);
  return () => read;
}

export function settledQuery(run: Attempt, unavailable: () => Refusal | null | undefined, lifetime?: AbortSignal): Client["query"] {
  const attempt: Attempt = async <A, R>(op: Query<A, R>, args: A, signal: AbortSignal) => {
    checkRead(signal);
    const denied = unavailable();
    if (denied) return () => ({ denied });
    let publish: Publication<R>;
    try {
      publish = await withReadSignal(signal, lifetime ?? signal, current => duringRead(run(op, args, current), current));
    } catch (error) {
      const denied = unavailable();
      if (denied) return () => ({ denied });
      throw error;
    }
    return () => { checkRead(signal); const denied = unavailable(); return denied ? { denied } : publish(); };
  };
  const query = <A, R>(op: Query<A, R>, args: A): Promise<SettledRead<R>> => {
    const controller = new AbortController(), signal = controller.signal;
    const stop = () => controller.abort(lifetime?.reason);
    lifetime?.addEventListener("abort", stop, { once: true });
    if (lifetime?.aborted) stop();
    const timer = setTimeout(() => controller.abort(expired), QUERY_LIFETIME);
    const settle = async (): Promise<SettledRead<R>> => {
      try {
        for (let round = 0; round < QUERY_ROUNDS; round++) {
          const denied = unavailable();
          if (denied) return { denied };
          checkRead(signal);
          const publish = await duringRead(attempt(op, args, signal), signal);
          checkRead(signal);
          // No await separates final publication from resolving this promise.
          const read = publish();
          if (read && !("loading" in read)) return read;
          if (round + 1 < QUERY_ROUNDS) await duringRead(new Promise<void>(resolve => {
            const pause = setTimeout(() => { signal.removeEventListener("abort", cancel); resolve(); }, 25 * 2 ** round);
            const cancel = () => clearTimeout(pause);
            signal.addEventListener("abort", cancel, { once: true });
          }), signal);
        }
        return { denied: unavailable() ?? retry() };
      } catch (error) {
        return { denied: unavailable() ?? (signal.aborted ? retry() : {
          code: "E_CLIENT", family: "client", site: "client.query", message: String(error),
        }) };
      } finally {
        clearTimeout(timer); lifetime?.removeEventListener("abort", stop);
        // Retire ignored-abort work before it can adopt or publish a late reply.
        controller.abort();
      }
    };
    return settle();
  };
  attempts.set(query, attempt);
  return query;
}
