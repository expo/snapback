import { overloaded } from "./http-response.ts";
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
  /** Present on fenced claims from current cores; never a service credential. */
  readonly leaseToken?: string;
  readonly id: string;
  readonly effect: string;
  readonly payload: Payload;
  /** Claims so far, this one counted: 1 on the first try. */
  readonly attempt: number;
  /** The commit that emitted it. */
  readonly seq: number;
  readonly at: number;
}

/** @internal */
export interface GeneratedEffect extends Effect {
  readonly leaseToken: string;
  readonly declarationContract?: string;
  readonly deadline?: number | null;
}

export interface EffectMeta {
  readonly id: string;
  /** Stable across redelivery; pass to the provider as its idempotency key. */
  readonly idempotencyKey: string;
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
  /** Server clock at claim, used to anchor deadline timers across clock offsets. */
  readonly now?: number;
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
  /** Optional durable SQLite completion ledger (Node 24). Keep this file across
   * restarts/releases; share it between workers consuming the same effects.
   * Serializes ledgered handlers. Provider I/O and this commit are not atomic. */
  readonly ledger?: string | true;
  readonly actions?: Readonly<Record<string, ActionHandler<never>>>;
  /** One bounded registry poll instead of one poll per action. Generated
   * servers select this; legacy workers keep per-name polling by default. */
  readonly actionRegistry?: boolean;
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
  /** Every failed effect attempt (including successfully recorded retries),
   * settlement and polling failures. Error text is redacted before delivery. */
  readonly onError?: (error: unknown) => void;
  /** Lifecycle hook for a supervisor sharing authentication with other loops. */
  readonly onAuthFailure?: () => void;
  /** Sanitize error text before logging or recording failed work. */
  readonly redact?: (message: string) => string;
}

export interface Worker {
  /** Resolves when polling stops, including an unavailable ledger. */
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

/** @internal Generated server registry seam; runWorker's public effect wire is
 * intentionally separate and unchanged. */
export type GeneratedEffectOutcome =
  | { readonly kind: "settle"; readonly result: unknown }
  | { readonly kind: "active-error"; readonly error: string; readonly retry: boolean }
  | { readonly kind: "authority-lost"; readonly error: string; readonly terminal: boolean };

/** @internal */
export interface GeneratedEffectRegistration {
  readonly declarationContract: string;
  execute(effect: GeneratedEffect, meta: EffectMeta): Promise<GeneratedEffectOutcome>;
}

class GeneratedEffectTerminal extends Error {}

/** Claim, perform, settle, repeat. Runs until `signal` aborts. */
export function runWorker(options: WorkerOptions): Worker {
  const doFetch = options.fetch ?? globalThis.fetch.bind(globalThis);
  const base = options.url.replace(/\/$/, "");
  const headers = { "content-type": "application/json", authorization: `Bearer ${options.token}` };
  const effects = options.effects ?? {};
  let ledger: import("./worker-ledger.ts").WorkerLedger | undefined;
  const actions = options.actions ?? {};
  const stop = new AbortController();
  const abort = () => stop.abort();
  if (options.signal?.aborted) stop.abort();
  else options.signal?.addEventListener("abort", abort, { once: true });
  let principal: string | null = null;
  const rawReport = options.onError ?? ((error: unknown) => console.error("snapback4 worker:", error));
  const redact = options.redact ?? ((message: string) => message);
  const message = (error: unknown) => redact(error instanceof Error ? error.message : String(error)).split(options.token).join("[REDACTED]");
  const report = (error: unknown) => rawReport(options.redact || message(error) !== (error instanceof Error ? error.message : String(error)) ? new Error(message(error)) : error);
  const storageStopped = () => {
    stop.abort();
    // The supervisor owns this process, including unrelated application timers.
    // Exit 78 is its ledger-unavailable status; standalone callers own done.
    if (typeof process !== "undefined" && process.env.SNAPBACK_WORKER_SUPERVISED === "1") process.exit(78);
  };
  const authenticationEnded = (why?: Refusal) => {
    if (why?.family !== "auth" || overloaded(why) || stop.signal.aborted) return;
    stop.abort();
    try { options.onAuthFailure?.(); } catch (error) { report(error); }
  };
  const post = async (path: string, body: unknown, lease?: string, effectLease?: string): Promise<unknown> => {
    const response = await doFetch(`${base}${path}`, { method: "POST", headers: { ...headers, ...(lease ? { "x-snapback-action-lease": lease } : {}), ...(effectLease ? { "x-snapback-effect-lease": effectLease } : {}) }, body: JSON.stringify(body), signal: stop.signal });
    const reply = await response.json() as { denied?: Refusal };
    authenticationEnded(reply.denied);
    if (overloaded(reply.denied) && !path.endsWith("/claim") && !path.endsWith("/claim-set")) await pause();
    return reply;
  };
  const settle = async (effect: Effect, outcome: { result: unknown } | { error: string; retry: boolean }) => {
    const path = "result" in outcome ? `/effects/${encodeURIComponent(effect.id)}/done` : `/effects/${encodeURIComponent(effect.id)}/failed`;
    const reply = (await post(path, outcome, undefined, effect.leaseToken)) as { ok?: boolean; denied?: Refusal };
    if (reply.denied?.code === "E_EFFECT_LEASE") {
      // @ref LLP 3000.007#20.12 — a lost claim says nothing about current
      // state; only a separate claim or maintenance path may observe requeue.
      const denial = reply.denied.message.startsWith(`${reply.denied.code}:`)
        ? reply.denied.message
        : `${reply.denied.code}: ${reply.denied.message}`;
      report(new Error(`effect ${effect.id} settlement lost authority: ${denial}`));
    } else if (reply.denied) report(new Error(`${reply.denied.code}: ${reply.denied.message}`));
    return !reply.denied;
  };
  const perform = async (effect: Effect) => {
    const handler = Object.hasOwn(effects, effect.effect) ? effects[effect.effect] as EffectHandler | undefined : undefined;
    const meta: EffectMeta = { id: effect.id, idempotencyKey: effect.id, effect: effect.effect, attempt: effect.attempt, seq: effect.seq, at: effect.at, worker: principal ?? "" };
    if (!handler) {
      const error = new GiveUp(`this worker has no handler for ${effect.effect}`);
      try { await settle(effect, { error: message(error), retry: false }); }
      finally { report(error); }
      return;
    }
    try {
      const perform = async () => handler(effect.payload as never, meta);
      const result = ledger ? await ledger.run(meta.idempotencyKey, perform, stop.signal) : await perform();
      await settle(effect, { result: result === undefined ? null : result });
    } catch (error) {
      if (ledger?.isUnavailable(error)) {
        if (!stop.signal.aborted) report(error);
        storageStopped();
        return;
      }
      if (ledger && stop.signal.aborted) return;
      try { await settle(effect, { error: message(error), retry: !(error instanceof GiveUp) }); }
      // @ref LLP 3000.009#5.2 — recording a failed attempt must not hide its failure.
      finally { report(error); }
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
  type Poll = { path: string; filter: { effect: string; fenced: true } | { action: string; session: number } | { actions: string[]; session: number }; wait: number };
  const loop = async (kind: "effects" | "actions", next: () => Poll) => {
    while (!stop.signal.aborted) {
      const poll = next();
      let reply: ClaimReply;
      try {
        reply = (await post(poll.path, { limit: options.batch ?? 8, lease: options.lease ?? 60, wait: poll.wait, ...poll.filter })) as ClaimReply;
      } catch (error) {
        if (stop.signal.aborted) return;
        report(error);
        await pause();
        continue;
      }
      if (reply.denied) {
        report(new Error(`${reply.denied.code}: ${reply.denied.message}`));
        if (reply.denied.family === "auth" && !overloaded(reply.denied)) { stop.abort(); return; }
        await pause();
        continue;
      }
      if (reply.worker) principal = reply.worker;
      else if (reply.effects?.length && principal === null) principal = "service";
      const work = kind === "effects" ? (reply.effects ?? []).map(perform) : (reply.requests ?? []).map(performAction);
      for (const result of await Promise.allSettled(work)) if (result.status === "rejected" && !stop.signal.aborted) report(result.reason);
      if (!work.length && poll.wait === 0) await pause();
    }
  };
  const actionNames = Object.keys(actions);
  const actionLoops = () => {
    if (!options.actionRegistry) return actionNames.map(name => loop("actions", () => ({ path: "/actions/claim", filter: { action: name, session: options.actionSessions?.[name] ?? 60 }, wait: options.wait ?? 25 })));
    const sessions = new Map<number, string[]>();
    for (const name of actionNames) {
      const duration = options.actionSessions?.[name] ?? 60;
      const names = sessions.get(duration) ?? [];
      names.push(name); sessions.set(duration, names);
    }
    const chunks: { actions: string[]; session: number }[] = [];
    for (const [session, names] of sessions) {
      for (let index = 0; index < names.length; index += 128) chunks.push({ actions: names.slice(index, index + 128), session });
    }
    if (!chunks.length) return [];
    // One loop owns bounded batches, not one waiting socket per handler.
    // Rotate even after an empty/refused poll; a quiet group cannot hide work
    // in another session-duration group or beyond the 128-name wire bound.
    let index = 0;
    return [loop("actions", () => {
      const filter = chunks[index]!; index = (index + 1) % chunks.length;
      return { path: "/actions/claim-set", filter, wait: chunks.length > 1 ? Math.min(options.wait ?? 25, 1) : options.wait ?? 25 };
    })];
  };
  const done = (async () => {
    // @ref LLP 3000.009#5.2 — storage failures must not spend delivery attempts.
    if (options.ledger !== undefined) {
      try {
        const { WorkerLedger } = await import("./worker-ledger.ts");
        ledger = await WorkerLedger.open(options.ledger === true ? process.env.SNAPBACK_WORKER_LEDGER ?? "" : options.ledger, stop.signal);
      } catch (error) {
        if (stop.signal.aborted) return;
        report(new Error(`worker ledger initialization failed; polling stopped: ${message(error)}`));
        storageStopped();
        return;
      }
    }
    await Promise.all([...Object.keys(effects).map(name => loop("effects", () => ({ path: "/effects/claim", filter: { effect: name, fenced: true }, wait: options.wait ?? 25 }))), ...actionLoops()]);
  })().finally(() => { options.signal?.removeEventListener("abort", abort); ledger?.close(); });
  return { done, principal: () => principal };
}

/** The declaration-bound effect arm used only by generated startServer(). */
// @ref LLP 3000.009#5.2 — generated claims bind one exact declaration and never settle after authority loss.
export function runGeneratedEffects(options: WorkerOptions, registry: Readonly<Record<string, GeneratedEffectRegistration>>): Worker {
  const doFetch = options.fetch ?? globalThis.fetch.bind(globalThis);
  const base = options.url.replace(/\/$/, "");
  const headers = { "content-type": "application/json", authorization: `Bearer ${options.token}` };
  const stop = new AbortController();
  const abort = () => stop.abort(options.signal?.reason);
  if (options.signal?.aborted) abort(); else options.signal?.addEventListener("abort", abort, { once: true });
  let principal: string | null = null;
  const rawReport = options.onError ?? ((error: unknown) => console.error("snapback4 worker:", error));
  const redact = options.redact ?? ((message: string) => message);
  const message = (error: unknown) => redact(error instanceof Error ? error.message : String(error)).split(options.token).join("[REDACTED]");
  const effectMessage = (effect: GeneratedEffect, error: unknown) => message(error).split(effect.leaseToken).join("[REDACTED]");
  const report = (error: unknown) => rawReport(options.redact || message(error) !== (error instanceof Error ? error.message : String(error)) ? new Error(message(error)) : error);
  const terminal = (error: Error): never => {
    const failure = new GeneratedEffectTerminal(error.message);
    report(failure); stop.abort(failure); throw failure;
  };
  const pause = () => new Promise<void>((resolve) => {
    if (stop.signal.aborted) { resolve(); return; }
    const finish = () => { clearTimeout(timer); stop.signal.removeEventListener("abort", finish); resolve(); };
    const timer = setTimeout(finish, 2_000);
    stop.signal.addEventListener("abort", finish, { once: true });
  });
  const post = async (path: string, body: unknown, effectLease?: string): Promise<unknown> => {
    const response = await doFetch(`${base}${path}`, { method: "POST", headers: { ...headers, ...(effectLease ? { "x-snapback-effect-lease": effectLease } : {}) }, body: JSON.stringify(body), signal: stop.signal });
    const reply = await response.json() as { denied?: Refusal };
    if (reply.denied?.family === "auth" && !overloaded(reply.denied) && !stop.signal.aborted) {
      stop.abort(reply.denied);
      try { options.onAuthFailure?.(); } catch (error) { report(error); }
    }
    if (overloaded(reply.denied) && !path.endsWith("/claim")) await pause();
    return reply;
  };
  const settle = async (effect: GeneratedEffect, outcome: { result: unknown } | { error: string; retry: boolean }) => {
    const path = "result" in outcome ? `/effects/${encodeURIComponent(effect.id)}/done` : `/effects/${encodeURIComponent(effect.id)}/failed`;
    let reply: { ok?: boolean; denied?: Refusal };
    try { reply = await post(path, outcome, effect.leaseToken) as { ok?: boolean; denied?: Refusal }; }
    catch (error) { throw new Error(effectMessage(effect, error)); }
    if (reply.denied?.code === "E_EFFECT_GENERATION") terminal(new Error(`${reply.denied.code}: ${reply.denied.message}`));
    if (reply.denied) report(new Error(effectMessage(effect, `${reply.denied.code}: ${reply.denied.message}`)));
    return !reply.denied;
  };
  const perform = async (effect: GeneratedEffect, registration: GeneratedEffectRegistration) => {
    const meta: EffectMeta = Object.freeze({ id: effect.id, idempotencyKey: effect.id, effect: effect.effect, attempt: effect.attempt, seq: effect.seq, at: effect.at, worker: principal ?? "" });
    const outcome = await registration.execute(effect, meta);
    if (outcome.kind === "authority-lost") {
      if (outcome.terminal) terminal(new Error(outcome.error));
      report(new Error(outcome.error));
      return;
    }
    if (outcome.kind === "active-error") {
      try { await settle(effect, { error: effectMessage(effect, outcome.error), retry: outcome.retry }); }
      finally { report(new Error(effectMessage(effect, outcome.error))); }
      return;
    }
    try { await settle(effect, { result: outcome.result === undefined ? null : outcome.result }); }
    catch (error) {
      if (stop.signal.aborted) throw error;
      try { await settle(effect, { error: effectMessage(effect, error), retry: true }); }
      finally { report(new Error(effectMessage(effect, error))); }
    }
  };
  const loop = async (name: string, registration: GeneratedEffectRegistration) => {
    while (!stop.signal.aborted) {
      let reply: ClaimReply;
      try {
        reply = await post("/effects/claim", { limit: options.batch ?? 8, lease: options.lease ?? 60, wait: options.wait ?? 25, effect: name, fenced: true, declarationContract: registration.declarationContract }) as ClaimReply;
      } catch (error) {
        if (stop.signal.aborted) return;
        report(error); await pause(); continue;
      }
      if (reply.denied) {
        const error = new Error(`${reply.denied.code}: ${reply.denied.message}`);
        if (reply.denied.code === "E_EFFECT_GENERATION") terminal(error);
        report(error);
        if (reply.denied.family === "auth" && !overloaded(reply.denied)) return;
        await pause(); continue;
      }
      if (reply.worker) principal = reply.worker;
      else if (reply.effects?.length && principal === null) principal = "service";
      if (reply.effects !== undefined && !Array.isArray(reply.effects)) terminal(new Error(`E_EFFECT_GENERATION: generated claim for ${name} returned an invalid effect list`));
      const effects = (reply.effects ?? []) as GeneratedEffect[];
      for (const effect of effects) {
        if (!effect || typeof effect !== "object" || effect.effect !== name || typeof effect.leaseToken !== "string" || !effect.leaseToken || effect.declarationContract !== registration.declarationContract) {
          const id = effect && typeof effect === "object" && typeof effect.id === "string" ? effect.id : "<unknown>";
          terminal(new Error(`E_EFFECT_GENERATION: claimed effect ${id} did not match generated declaration ${name}`));
        }
      }
      const work = effects.map(effect => perform(effect, registration));
      for (const result of await Promise.allSettled(work)) {
        if (result.status === "rejected" && result.reason instanceof GeneratedEffectTerminal) throw result.reason;
        if (result.status === "rejected" && !stop.signal.aborted) report(result.reason);
      }
      if (!work.length && (options.wait ?? 25) === 0) await pause();
    }
  };
  const loops = Object.keys(registry).map(name => loop(name, registry[name]!));
  const done = Promise.all(loops).then(() => {}).catch(error => { stop.abort(error); throw error; }).finally(() => options.signal?.removeEventListener("abort", abort));
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
