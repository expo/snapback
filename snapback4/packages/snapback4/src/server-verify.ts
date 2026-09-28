import { overloaded } from "./http-response.ts";
import type { Refusal } from "./contract.ts";
import type { Worker } from "./worker.ts";
import { routeRequest, untilAborted, type RouteDeclaration, type ServiceRoute } from "./server-routes.ts";

interface VerificationClaim {
  readonly id: string;
  readonly route: string;
  readonly contract: string;
  readonly now: number;
  readonly deadline: number;
  readonly leaseToken: string;
  readonly request: unknown;
}

export interface VerifierOptions {
  readonly url: string;
  readonly token: string;
  readonly signal: AbortSignal;
  readonly stop: () => void;
  readonly fetch?: typeof fetch;
  readonly batch?: number;
  readonly lease?: number;
  readonly wait?: number;
  readonly routes: Readonly<Record<string, { declaration: RouteDeclaration; handler: ServiceRoute<string> }>>;
  readonly secrets: (names: readonly string[]) => Readonly<Record<string, string>>;
  readonly redact: (message: string) => string;
  readonly onError?: (error: unknown) => void;
}

// One poll for the registry, with at most four active callbacks. Holding a
// slot until the callback really finishes bounds even abort-ignoring code.
export function runVerifiers(options: VerifierOptions): Worker {
  const names = Object.keys(options.routes);
  const chunks: string[][] = [];
  for (let index = 0; index < names.length; index += 128) chunks.push(names.slice(index, index + 128));
  const signal = options.signal;
  const doFetch = options.fetch ?? globalThis.fetch.bind(globalThis);
  const base = options.url.replace(/\/$/, "");
  const bounded = (value: number | undefined, fallback: number, min: number, max: number) =>
    value === undefined || !Number.isFinite(value) ? fallback : Math.min(max, Math.max(min, Math.floor(value)));
  const limit = bounded(options.batch, 4, 1, 4);
  const wait = Math.min(bounded(options.wait, 25, 0, 25), chunks.length > 1 ? 1 : 25);
  const lease = bounded(options.lease, 10, 1, 25);
  let principal: string | null = null;
  const report = (error: unknown, fence?: string) => {
    let message = error instanceof Error ? error.message : String(error);
    if (fence) message = message.split(fence).join("[REDACTED]");
    message = options.redact(message);
    try { (options.onError ?? ((error: unknown) => console.error("snapback4 verifier:", error)))(new Error(message)); }
    catch { /* A reporting callback cannot prevent fencing or cleanup. */ }
  };
  const post = async (path: string, body: unknown, fence?: string, ticketSignal?: AbortSignal) => {
    const timeout = new AbortController();
    const timer = setTimeout(() => timeout.abort(new Error("route verification transport timed out")), fence ? 10_000 : (wait + 5) * 1000);
    const lifetime = AbortSignal.any([signal, timeout.signal, ...(ticketSignal ? [ticketSignal] : [])]);
    try {
      const response = await untilAborted(() => doFetch(base + path, {
        method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${options.token}`,
          ...(fence ? { "x-snapback-route-lease": fence } : {}) },
        body: JSON.stringify(body), signal: lifetime,
      }), lifetime);
      const reply = await untilAborted(() => response.json(), lifetime) as { denied?: Refusal; requests?: VerificationClaim[]; worker?: string; ok?: boolean };
      lifetime.throwIfAborted();
      if (reply.denied) {
        if (reply.denied.family === "auth" && !overloaded(reply.denied)) options.stop();
        throw new Error(`${reply.denied.code}: ${reply.denied.message}`);
      }
      if (!response.ok) throw new Error(`route verification transport returned HTTP ${response.status}`);
      return reply;
    } finally { clearTimeout(timer); }
  };
  const pause = () => new Promise<void>(resolve => {
    if (signal.aborted) { resolve(); return; }
    const finish = () => { clearTimeout(timer); signal.removeEventListener("abort", finish); resolve(); };
    const timer = setTimeout(finish, 2000);
    signal.addEventListener("abort", finish, { once: true });
  });
  const perform = async (claim: VerificationClaim): Promise<boolean> => {
    if (!claim || typeof claim.id !== "string" || !claim.id || typeof claim.leaseToken !== "string" || !claim.leaseToken
      || !Number.isSafeInteger(claim.now) || !Number.isSafeInteger(claim.deadline)) {
      report(new Error("invalid route verification claim")); return false;
    }
    const started = performance.now();
    const lifetime = new AbortController();
    const abort = () => lifetime.abort(signal.reason);
    if (signal.aborted) abort(); else signal.addEventListener("abort", abort, { once: true });
    const remaining = () => claim.deadline - claim.now - (performance.now() - started);
    const expire = () => lifetime.abort(new Error("route verification ticket expired"));
    const timer = setTimeout(expire, Math.max(0, Math.min(25_000, remaining())));
    // Uncooperative application code still owns its slot/process. Only the
    // supervisor can kill it; done must not pretend that its callback stopped.
    const keeper = setInterval(() => {}, 30_000);
    let disposition: "allow" | "deny" | "unavailable" = "unavailable";
    try {
      if (remaining() <= 0) expire();
      lifetime.signal.throwIfAborted();
      try {
        const entry = typeof claim.route === "string" && Object.hasOwn(options.routes, claim.route) ? options.routes[claim.route] : undefined;
        if (!entry || !entry.declaration.contract || claim.contract !== entry.declaration.contract) throw new Error("route verification contract does not match this runtime");
        const context = Object.freeze({ secrets: options.secrets(entry.declaration.secrets), signal: lifetime.signal });
        const result = await entry.handler.verify(routeRequest(claim.request, entry.declaration), context);
        if (result !== true && result !== false) throw new Error("route verification must return exactly true or false");
        disposition = result ? "allow" : "deny";
      } catch (error) {
        if (!lifetime.signal.aborted) report(error, claim.leaseToken);
      }
      if (remaining() <= 0) expire();
      lifetime.signal.throwIfAborted();
      const reply = await post(`/routes/verify/${encodeURIComponent(claim.id)}/settle`, { disposition }, claim.leaseToken, lifetime.signal);
      if (reply.ok !== true) throw new Error("the server did not acknowledge route verification");
      return true;
    } catch (error) {
      if (!signal.aborted && !lifetime.signal.aborted) report(error, claim.leaseToken);
      return false;
    } finally {
      clearTimeout(timer); clearInterval(keeper);
      signal.removeEventListener("abort", abort);
      lifetime.abort(new Error("route verification context closed"));
    }
  };
  const done = (async () => {
    let index = 0;
    while (!signal.aborted && chunks.length) {
      // Advance before I/O, including a refused or empty chunk. There is
      // still only one poll and one bounded callback batch for the registry.
      const routes = chunks[index]!; index = (index + 1) % chunks.length;
      try {
        const reply = await post("/routes/verify/claim", { routes, limit, lease, wait });
        if (!Array.isArray(reply.requests) || reply.requests.length > limit) throw new Error("invalid route verification claim batch");
        if (typeof reply.worker === "string") principal = reply.worker;
        const results = await Promise.all(reply.requests.map(perform));
        if (results.some(ok => !ok) || (!results.length && wait === 0)) await pause();
      } catch (error) {
        if (signal.aborted) break;
        report(error); await pause();
      }
    }
  })();
  return { done, principal: () => principal };
}
