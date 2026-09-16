// A worker: the process that performs what a backend `emit`s. The engine
// keeps every effect durably in the commit that emitted it; a worker
// holding a service token (`snapback4 token --service <name>`) claims
// effects under a lease, does the I/O the data plane never does — a push
// provider, a mail API, a model call — and settles each one. A failure
// retries with backoff up to the engine's bound; a worker that dies loses
// its lease and the effect is claimed again. One `runWorker` loop covers
// the wire; the handlers are the application's.

import type { Refusal } from "./contract.ts";
import type { Session } from "./auth.ts";

export interface Effect<Payload = unknown> {
  readonly id: string;
  readonly effect: string;
  readonly payload: Payload;
  /** Claims so far, this one counted: 1 on the first try. */
  readonly attempt: number;
  /** The commit that emitted it. */
  readonly seq: number;
  readonly at: number;
}

export interface EffectMeta {
  readonly id: string;
  readonly effect: string;
  readonly attempt: number;
  readonly seq: number;
  readonly at: number;
  /** The worker's principal (`service:<name>`), as the server sees it. */
  readonly worker: string;
}

/** A handler returns a result the engine keeps beside the effect (`sent`),
 * or throws: a thrown `Retry` (or any error) queues the effect again with
 * backoff; a thrown `GiveUp` marks it `failed` at once. */
export type EffectHandler<Payload = unknown> = (payload: Payload, meta: EffectMeta) => Promise<unknown> | unknown;

export interface ActionMeta {
  readonly id: string;
  readonly action: string;
  readonly principal: string;
  readonly attempt: number;
  readonly at: number;
  /** Generated action contract identity. Older hand-written workers may ignore it. */
  readonly contract?: string;
  /** Absolute epoch milliseconds, or no operation deadline. */
  readonly deadline?: number | null;
  /** Pass to createClient({ url, session: meta.session }); reads and writes
   * run under this request's viewer. It cannot refresh and dies with the lease. */
  readonly session: Session;
}

export interface ActionRequest<Args = unknown> extends ActionMeta { readonly args: Args }
export type ActionHandler<Args = unknown, Result = unknown> = (args: Args, meta: ActionMeta) => Promise<Result> | Result;

export class GiveUp extends Error {}
export class Retry extends Error {}

export interface WorkerOptions {
  readonly url: string;
  /** A service token from `snapback4 token --service <name>`. */
  readonly token: string;
  readonly effects?: Readonly<Record<string, EffectHandler<never>>>;
  readonly actions?: Readonly<Record<string, ActionHandler<never>>>;
  /** Per-action viewer session duration in seconds (default 60, maximum
   * 900). A claim ends at the earlier of this and `lease`. */
  readonly actionSessions?: Readonly<Record<string, number>>;
  /** Seconds a claim lasts before the engine hands the effect to another
   * worker; longer than the slowest handler. Default 60. */
  readonly lease?: number;
  /** How many effects one claim takes. Default 8. */
  readonly batch?: number;
  /** Seconds a claim waits for work before answering empty. Default 25. */
  readonly wait?: number;
  readonly fetch?: typeof fetch;
  /** Stops the loop when aborted. */
  readonly signal?: AbortSignal;
  readonly onError?: (error: unknown) => void;
  /** Sanitize error text before logging or recording failed work. */
  readonly redact?: (message: string) => string;
}

export interface Worker {
  /** Resolves when the loop has stopped (the signal aborted). */
  readonly done: Promise<void>;
  /** The worker's principal once the first claim answered. */
  principal(): string | null;
}

interface ClaimReply {
  effects?: Effect[];
  requests?: ActionRequest[];
  worker?: string;
  denied?: Refusal;
}

/** Claim, perform, settle, repeat. Runs until `signal` aborts. */
export function runWorker(options: WorkerOptions): Worker {
  const doFetch = options.fetch ?? globalThis.fetch.bind(globalThis);
  const base = options.url.replace(/\/$/, "");
  const headers = { "content-type": "application/json", authorization: `Bearer ${options.token}` };
  const effects = options.effects ?? {};
  const actions = options.actions ?? {};
  const stop = new AbortController();
  const abort = () => stop.abort();
  if (options.signal?.aborted) stop.abort();
  else options.signal?.addEventListener("abort", abort, { once: true });
  let principal: string | null = null;
  const rawReport = options.onError ?? ((error: unknown) => console.error("snapback4 worker:", error));
  const redact = options.redact ?? ((message: string) => message);
  const message = (error: unknown) => redact(error instanceof Error ? error.message : String(error));
  const report = (error: unknown) => rawReport(options.redact ? new Error(message(error)) : error);
  const post = async (path: string, body: unknown, lease?: string): Promise<unknown> => {
    const response = await doFetch(`${base}${path}`, { method: "POST", headers: { ...headers, ...(lease ? { "x-snapback-action-lease": lease } : {}) }, body: JSON.stringify(body), signal: stop.signal });
    return response.json();
  };
  const settle = async (effect: Effect, outcome: { result: unknown } | { error: string; retry: boolean }) => {
    const path = "result" in outcome ? `/effects/${encodeURIComponent(effect.id)}/done` : `/effects/${encodeURIComponent(effect.id)}/failed`;
    const reply = (await post(path, outcome)) as { ok?: boolean; denied?: Refusal };
    if (reply.denied?.code === "E_EFFECT_LEASE") {
      // @ref LLP 3000.007#20.12 — only a recorded requeue is informational; a lost claim does not imply expiry or retry.
      const message = `effect ${effect.id} settlement refused (${reply.denied.code}): ${reply.denied.message}`;
      const queued = `effect ${effect.id} is queued and not claimed by this worker; claim it first`;
      // Match the server's complete queued refusal, never a substring or
      // a later listing that could describe another attempt. Unknown stays loud.
      if (reply.denied.message === queued || reply.denied.message === `E_EFFECT_LEASE: ${queued}`) console.info(redact(`snapback4 worker: ${message}; the effect was requeued`));
      else report(new Error(message));
    } else if (reply.denied) report(new Error(`${reply.denied.code}: ${reply.denied.message}`));
    return !reply.denied;
  };
  const perform = async (effect: Effect) => {
    const handler = Object.hasOwn(effects, effect.effect) ? effects[effect.effect] as EffectHandler | undefined : undefined;
    const meta: EffectMeta = { id: effect.id, effect: effect.effect, attempt: effect.attempt, seq: effect.seq, at: effect.at, worker: principal ?? "" };
    if (!handler) {
      await settle(effect, { error: `this worker has no handler for ${effect.effect}`, retry: false });
      return;
    }
    try {
      const result = await handler(effect.payload as never, meta);
      await settle(effect, { result: result === undefined ? null : result });
    } catch (error) {
      let recorded = false;
      try { recorded = await settle(effect, { error: message(error), retry: !(error instanceof GiveUp) }); }
      finally { if (!recorded) report(error); }
    }
  };
  const performAction = async (request: ActionRequest) => {
    const { args, ...meta } = request;
    const handler = Object.hasOwn(actions, request.action) ? actions[request.action] as ActionHandler | undefined : undefined;
    const actionMessage = (error: unknown) => message(error).split(request.session.token).join("[REDACTED]");
    let outcome: { result: unknown } | { error: string; retry: boolean; code?: string };
    try {
      if (!handler) throw new GiveUp(`this worker has no handler for ${request.action}`);
      outcome = { result: (await handler(args, meta)) ?? null };
    } catch (error) {
      const code = error instanceof GiveUp ? (error as { refusal?: Refusal }).refusal?.code : undefined;
      outcome = { error: actionMessage(error), retry: !(error instanceof GiveUp), ...(code ? { code } : {}) };
    }
    if ("result" in outcome) {
      try { JSON.stringify(outcome); }
      catch (error) { outcome = { error: actionMessage(error), retry: false }; }
    }
    const settle = async (value: typeof outcome) => {
      const reply = await post(`/actions/${encodeURIComponent(request.id)}/${"result" in value ? "done" : "failed"}`, value, request.session.token) as { denied?: Refusal };
      if (reply.denied) throw Object.assign(new Error(`${reply.denied.code}: ${reply.denied.message}`), { refusal: reply.denied });
    };
    try { await settle(outcome); }
    catch (error) {
      // A malformed/oversized result is a handler failure; a lost response
      // leaves the lease to expire, never re-executes a settled action here.
      const why = (error as { refusal?: Refusal }).refusal;
      if ("result" in outcome && (why?.code === "E_BOUND" || why?.code === "E_INPUT")) {
        try { await settle({ error: actionMessage(error), retry: false }); }
        catch (error) { throw new Error(actionMessage(error)); }
      } else throw new Error(actionMessage(error));
    }
  };
  const pause = () => new Promise<void>((resolve) => {
    if (stop.signal.aborted) { resolve(); return; }
    const finish = () => { clearTimeout(timer); stop.signal.removeEventListener("abort", finish); resolve(); };
    const timer = setTimeout(finish, 2_000);
    stop.signal.addEventListener("abort", finish, { once: true });
  });
  // Each named handler claims only its own work. Empty queues long-poll
  // independently, so effects cannot starve actions (or steal other workers' work).
  const loop = async (kind: "effects" | "actions", name: string) => {
    while (!stop.signal.aborted) {
      let reply: ClaimReply;
      try {
        reply = (await post(`/${kind}/claim`, { limit: options.batch ?? 8, lease: options.lease ?? 60, wait: options.wait ?? 25, ...(kind === "effects" ? { effect: name } : { action: name, session: options.actionSessions?.[name] ?? 60 }) })) as ClaimReply;
      } catch (error) {
        if (stop.signal.aborted) return;
        report(error);
        await pause();
        continue;
      }
      if (reply.denied) {
        report(new Error(`${reply.denied.code}: ${reply.denied.message}`));
        if (reply.denied.family === "auth") { stop.abort(); return; }
        await pause();
        continue;
      }
      if (reply.worker) principal = reply.worker;
      else if (reply.effects?.length && principal === null) principal = "service";
      const work = kind === "effects" ? (reply.effects ?? []).map(perform) : (reply.requests ?? []).map(performAction);
      for (const result of await Promise.allSettled(work)) if (result.status === "rejected" && !stop.signal.aborted) report(result.reason);
      if (!work.length && options.wait === 0) await pause();
    }
  };
  const done = Promise.all([...Object.keys(effects).map(name => loop("effects", name)), ...Object.keys(actions).map(name => loop("actions", name))]).then(() => {}).finally(() => options.signal?.removeEventListener("abort", abort));
  return { done, principal: () => principal };
}

/** The effects the server holds, for an operator's script or a test:
 * `state` is `queued`, `running`, `sent`, `satisfied` or `failed`.
 * `satisfied` records a presence reconnect without invoking a handler. */
export async function listEffects(url: string, token: string, state?: string, doFetch: typeof fetch = globalThis.fetch.bind(globalThis)): Promise<Effect[]> {
  const response = await doFetch(`${url.replace(/\/$/, "")}/effects${state ? `?state=${encodeURIComponent(state)}` : ""}`, { headers: { authorization: `Bearer ${token}` } });
  const json = (await response.json()) as ClaimReply;
  if (json.denied) throw new Error(`${json.denied.code}: ${json.denied.message}`);
  return json.effects ?? [];
}

/** A session for an account the application authenticated itself (a phone
 * it verified, a member of its own directory), minted by its service and
 * handed to that account's device. The principal is the application's own
 * name for the account, outside the engine's namespaces (`member:42`). */
export async function mintSession(url: string, token: string, principal: string, kind = "account", days?: number, doFetch: typeof fetch = globalThis.fetch.bind(globalThis)): Promise<{ principal: string; kind: string; token: string; expiresAt: number }> {
  const response = await doFetch(`${url.replace(/\/$/, "")}/auth/session`, { method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${token}` }, body: JSON.stringify({ principal, kind, ...(days ? { days } : {}) }) });
  const json = (await response.json()) as { session?: { principal: string; kind: string; token: string; expiresAt: number }; denied?: Refusal };
  if (!json.session) throw new Error(json.denied ? `${json.denied.code}: ${json.denied.message}` : "no session");
  return json.session;
}

/** End every session of an account: a lost phone, a removed member. */
export async function revokeSessions(url: string, token: string, principal: string, doFetch: typeof fetch = globalThis.fetch.bind(globalThis)): Promise<number> {
  const response = await doFetch(`${url.replace(/\/$/, "")}/auth/revoke`, { method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${token}` }, body: JSON.stringify({ principal }) });
  const json = (await response.json()) as { revoked?: number; denied?: Refusal };
  if (json.denied) throw new Error(`${json.denied.code}: ${json.denied.message}`);
  return json.revoked ?? 0;
}
