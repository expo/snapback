// A worker: the process that performs what a backend `emit`s. The engine
// keeps every effect durably in the commit that emitted it; a worker
// holding a service token (`snapback4 token --service <name>`) claims
// effects under a lease, does the I/O the data plane never does — a push
// provider, a mail API, a model call — and settles each one. A failure
// retries with backoff up to the engine's bound; a worker that dies loses
// its lease and the effect is claimed again. One `runWorker` loop covers
// the wire; the handlers are the application's.

import type { Refusal } from "./contract.ts";

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

export class GiveUp extends Error {}
export class Retry extends Error {}

export interface WorkerOptions {
  readonly url: string;
  /** A service token from `snapback4 token --service <name>`. */
  readonly token: string;
  readonly effects: Readonly<Record<string, EffectHandler<never>>>;
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
}

export interface Worker {
  /** Resolves when the loop has stopped (the signal aborted). */
  readonly done: Promise<void>;
  /** The worker's principal once the first claim answered. */
  principal(): string | null;
}

interface ClaimReply {
  effects?: Effect[];
  denied?: Refusal;
}

/** Claim, perform, settle, repeat. Runs until `signal` aborts. */
export function runWorker(options: WorkerOptions): Worker {
  const doFetch = options.fetch ?? globalThis.fetch.bind(globalThis);
  const base = options.url.replace(/\/$/, "");
  const headers = { "content-type": "application/json", authorization: `Bearer ${options.token}` };
  const names = Object.keys(options.effects);
  let principal: string | null = null;
  const report = options.onError ?? ((error: unknown) => console.error("snapback4 worker:", error));
  const post = async (path: string, body: unknown): Promise<unknown> => {
    const response = await doFetch(`${base}${path}`, { method: "POST", headers, body: JSON.stringify(body), signal: options.signal ?? null });
    return response.json();
  };
  const settle = async (effect: Effect, outcome: { result: unknown } | { error: string; retry: boolean }) => {
    const path = "result" in outcome ? `/effects/${encodeURIComponent(effect.id)}/done` : `/effects/${encodeURIComponent(effect.id)}/failed`;
    const reply = (await post(path, outcome)) as { ok?: boolean; denied?: Refusal };
    if (reply.denied) report(new Error(`${reply.denied.code}: ${reply.denied.message}`));
  };
  const perform = async (effect: Effect) => {
    const handler = options.effects[effect.effect] as EffectHandler | undefined;
    const meta: EffectMeta = { id: effect.id, effect: effect.effect, attempt: effect.attempt, seq: effect.seq, at: effect.at, worker: principal ?? "" };
    if (!handler) {
      await settle(effect, { error: `this worker has no handler for ${effect.effect}`, retry: false });
      return;
    }
    try {
      const result = await handler(effect.payload as never, meta);
      await settle(effect, { result: result === undefined ? null : result });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await settle(effect, { error: message, retry: !(error instanceof GiveUp) });
    }
  };
  const done = (async () => {
    while (!options.signal?.aborted) {
      let reply: ClaimReply;
      try {
        reply = (await post("/effects/claim", { limit: options.batch ?? 8, lease: options.lease ?? 60, wait: options.wait ?? 25, ...(names.length === 1 ? { effect: names[0] } : {}) })) as ClaimReply;
      } catch (error) {
        if (options.signal?.aborted) return;
        report(error);
        await new Promise((resolve) => setTimeout(resolve, 2_000));
        continue;
      }
      if (reply.denied) {
        report(new Error(`${reply.denied.code}: ${reply.denied.message}`));
        if (reply.denied.family === "auth") return;
        await new Promise((resolve) => setTimeout(resolve, 2_000));
        continue;
      }
      const effects = reply.effects ?? [];
      if (effects.length > 0 && principal === null) {
        principal = "service";
      }
      await Promise.all(effects.map(perform));
    }
  })();
  return { done, principal: () => principal };
}

/** The effects the server holds, for an operator's script or a test:
 * `state` is `queued`, `running`, `sent` or `failed`. */
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
