import { createClient, mintId } from "./client.ts";
import type { Refusal } from "./contract.ts";
import type { ActionMeta } from "./worker.ts";
import { Retry } from "./worker.ts";
import type { ServerContext, ServerOptions } from "./server.ts";
import { ServerError } from "./server-json.ts";
import { steps, writeIdFor } from "./server-steps.ts";

/** Unlike a raw injected fetch, this settles on abort even if its implementation
 * ignores the signal. The pending fetch's rejection is still observed. */
async function untilAborted<T>(work: () => Promise<T>, signal?: AbortSignal | null): Promise<T> {
  if (signal?.aborted) throw signal.reason;
  if (!signal) return work();
  return new Promise((resolve, reject) => {
    const abort = () => { signal.removeEventListener("abort", abort); reject(signal.reason); };
    signal.addEventListener("abort", abort, { once: true });
    Promise.resolve().then(() => { if (signal.aborted) throw signal.reason; return work(); }).then(resolve, reject).finally(() => signal.removeEventListener("abort", abort));
  });
}

export function context(
  meta: ActionMeta,
  secrets: Readonly<Record<string, string>>,
  options: ServerOptions & { url: string; token: string },
  redact: (message: string) => string,
): { context: ServerContext<string>; close: () => Promise<void> } {
  const doFetch = options.fetch ?? globalThis.fetch.bind(globalThis);
  const base = `${options.url.replace(/\/$/, "")}/actions/${encodeURIComponent(meta.id)}`;
  const lifetime = new AbortController();
  let ended: Refusal | undefined;
  let closed = false;
  let cancelled = false;
  let pollTimer: ReturnType<typeof setTimeout> | undefined;
  let deadlineTimer: ReturnType<typeof setTimeout> | undefined;
  const deadline = meta.deadline ?? null;
  const started = performance.now();
  const claimedAt = (meta as ActionMeta & { readonly now?: number }).now ?? Date.now();
  const now = () => claimedAt + (performance.now() - started);
  const closedWhy = { code: "E_ACTION_CLOSED", family: "action", message: "the action context has closed" };
  const end = (why: Refusal) => {
    if (ended) return;
    ended = why;
    cancelled = why.code === "E_ACTION_CANCELLED";
    if (pollTimer) clearTimeout(pollTimer);
    if (deadlineTimer) clearTimeout(deadlineTimer);
    lifetime.abort(why.retryable ? new Retry(`${why.code}: ${why.message}`) : new ServerError(why.code, why.message, why.family));
    void client.close();
  };
  const refusal = (): Refusal | undefined => {
    if (closed) return ended ?? closedWhy;
    if (deadline !== null && now() >= deadline) end({ code: "E_ACTION_DEADLINE", family: "action", message: "the action deadline has passed" });
    return ended;
  };
  const assertActive = () => {
    const why = refusal();
    if (why?.retryable) throw new Retry(`${why.code}: ${why.message}`);
    if (why) throw new ServerError(why.code, why.message, why.family);
  };
  const client = createClient({
    url: options.url,
    session: meta.session,
    fetch: async (url, init) => {
      const signal = init?.signal ? AbortSignal.any([lifetime.signal, init.signal]) : lifetime.signal;
      const response = await untilAborted(() => doFetch(url, { ...init, signal }), signal);
      // The online client only consumes JSON. Bind body consumption to the
      // same lifetime, including a test transport that ignores abort itself.
      const json = response.json.bind(response);
      response.json = () => untilAborted(json, signal);
      return response;
    },
  });
  const post = async (path: string, body: unknown, timeout?: AbortSignal): Promise<unknown> => {
    assertActive();
    const signal = timeout ? AbortSignal.any([lifetime.signal, timeout]) : lifetime.signal;
    const response = await untilAborted(() => doFetch(`${base}${path}`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${options.token}`, "x-snapback-action-lease": meta.session.token },
      body: JSON.stringify(body),
      signal,
    }), signal);
    const json = await untilAborted(() => response.json(), signal) as { denied?: Refusal };
    assertActive();
    if (json.denied) {
      const why = json.denied;
      if (why.retryable) throw new Retry(`${why.code}: ${why.message}`);
      if (["E_ACTION_LEASE", "E_ACTION_DEADLINE", "E_ACTION_CANCELLED", "E_ACTION_AUTHORITY", "E_AUTH"].includes(why.code)) end(why);
      throw new ServerError(why.code, why.message, why.family);
    }
    if (!response.ok) throw new Retry(`action request failed with HTTP ${response.status}`);
    return json;
  };
  const poll = async () => {
    pollTimer = undefined;
    if (closed || ended) return;
    const timeout = new AbortController();
    const timeoutTimer = setTimeout(() => timeout.abort(), 10_000);
    try {
      const reply = await post("/status", {}, timeout.signal) as { invocation?: { id: string; attempt: number; cancelled: boolean; state: string; errorCode?: string } };
      if (closed || ended) return;
      const status = reply.invocation;
      if (!status || status.id !== meta.id || status.attempt !== meta.attempt) {
        end({ code: "E_ACTION_LEASE", family: "action", message: "this action attempt no longer holds its lease" });
      } else if (status.cancelled) {
        end({ code: "E_ACTION_CANCELLED", family: "action", message: "the action was cancelled" });
      } else if (status.state !== "running") {
        end({ code: status.errorCode ?? "E_ACTION_LEASE", family: "action", message: "this action attempt is no longer running" });
      }
    } catch (error) {
      if (!closed && !ended) {
        end(error instanceof ServerError ? error.refusal : { code: "E_OFFLINE", family: "link", message: "the action status could not be confirmed", retryable: true });
      }
    } finally { clearTimeout(timeoutTimer); }
    if (!closed && !ended) schedulePoll();
  };
  const schedulePoll = () => {
    // The handler may be awaiting only its cancellation signal. Invocation
    // timers own that live work until close/end; an unreferenced timer lets
    // Node exit between claim and status with an unsettled top-level await.
    pollTimer = setTimeout(() => { void poll(); }, options.statusIntervalMs ?? 1000);
  };
  const onStop = () => end(closedWhy);
  if (options.signal?.aborted) onStop();
  else options.signal?.addEventListener("abort", onStop, { once: true });
  const scheduleDeadline = () => {
    if (deadline === null || closed || ended) return;
    const remaining = deadline - now();
    if (remaining <= 0) { refusal(); return; }
    deadlineTimer = setTimeout(scheduleDeadline, Math.min(remaining, 2_147_483_647));
  };
  scheduleDeadline();
  if (!ended) schedulePoll();
  return {
    context: Object.freeze({
      principal: meta.principal,
      invocation: Object.freeze({ id: meta.id, attempt: meta.attempt, deadline, get cancelled() { return cancelled; }, signal: lifetime.signal }),
      secrets,
      async query(op, args) {
        const why = refusal();
        if (why) return { denied: why };
        const result = await client.query(op, args);
        return refusal() ? { denied: refusal()! } : result;
      },
      async mutate(op, args, mutateOptions) {
        const why = refusal();
        if (why) return { state: "failed", id: mutateOptions?.id ?? mintId(), why };
        // A request may already have committed. Preserve the client's pending
        // or failed receipt even if authority ends while the call is in flight.
        return client.mutate(op, args, mutateOptions);
      },
      writeIdFor(name) { assertActive(); return writeIdFor(meta.id, name); },
      step: steps(post, assertActive, redact),
    } satisfies ServerContext<string>),
    async close() {
      if (!closed) {
        closed = true;
        if (pollTimer) clearTimeout(pollTimer);
        if (deadlineTimer) clearTimeout(deadlineTimer);
        options.signal?.removeEventListener("abort", onStop);
        lifetime.abort(new ServerError(closedWhy.code, closedWhy.message));
      }
      await client.close();
    },
  };
}
