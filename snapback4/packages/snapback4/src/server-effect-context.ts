import type { Refusal } from "./contract.ts";
import type { EffectMeta } from "./worker.ts";
import { Retry } from "./worker.ts";
import type { EffectContext, ServerOptions } from "./server.ts";
import { ServerError } from "./server-json.ts";
import { boundedStatusCheck, lifetimeFetch, statusPoller } from "./server-lifetime.ts";
import { steps } from "./server-steps.ts";

interface EffectClaim {
  readonly id: string;
  readonly attempt: number;
  readonly leaseToken: string;
  readonly deadline?: number | null;
}

const LOST_CODES = new Set(["E_EFFECT_LEASE", "E_EFFECT_GENERATION", "E_EFFECT_CANCELLED", "E_EFFECT_DEADLINE", "E_AUTH"]);

// @ref LLP 3000.009#5.2 — generated effects receive only their held effect
// lease's status/step surface; data and administrative authority stay absent.
export function effectContext(
  claim: EffectClaim,
  meta: EffectMeta,
  secrets: Readonly<Record<string, string>>,
  options: ServerOptions & { url: string; token: string },
  redact: (message: string) => string,
): {
  context: EffectContext<string>;
  authorityLost(): { lost: boolean; terminal: boolean; message: string };
  confirm(): Promise<void>;
  close(): void;
} {
  const doFetch = options.fetch ?? globalThis.fetch.bind(globalThis);
  const base = `${options.url.replace(/\/$/, "")}/effects/${encodeURIComponent(claim.id)}`;
  const lifetime = new AbortController();
  const deadline = claim.deadline ?? null;
  let ended: Refusal | undefined;
  let closed = false;
  let cancelled = false;
  let poller: { close(): void; quiesce(): Promise<void> } | undefined;
  const closedWhy: Refusal = { code: "E_EFFECT_CLOSED", family: "effect", message: "the effect context has closed" };
  const fetchWithinLifetime = lifetimeFetch(doFetch, lifetime.signal);
  const end = (why: Refusal) => {
    if (ended) return;
    ended = why;
    cancelled = why.code === "E_EFFECT_CANCELLED";
    poller?.close();
    lifetime.abort(why.retryable ? new Retry(`${why.code}: ${why.message}`) : new ServerError(why.code, why.message, why.family));
  };
  const onStop = () => end(closedWhy);
  if (options.signal?.aborted) onStop(); else options.signal?.addEventListener("abort", onStop, { once: true });
  const assertActive = () => {
    const why = closed ? ended ?? closedWhy : ended;
    if (why?.retryable) throw new Retry(`${why.code}: ${why.message}`);
    if (why) throw new ServerError(why.code, why.message, why.family);
  };
  const request = async (path: string, body: unknown, timeout?: AbortSignal): Promise<unknown> => {
    assertActive();
    const signal = timeout ? AbortSignal.any([lifetime.signal, timeout]) : lifetime.signal;
    let response: Response, json: { denied?: Refusal };
    try {
      response = await fetchWithinLifetime(`${base}${path}`, {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${options.token}`, "x-snapback-effect-lease": claim.leaseToken },
        body: JSON.stringify(body), signal,
      });
      json = await response.json() as { denied?: Refusal };
    } catch (error) {
      if (!ended && !closed) end({ code: "E_OFFLINE", family: "link", message: "the effect authority could not be confirmed", retryable: true });
      throw error;
    }
    assertActive();
    if (json.denied) {
      if (LOST_CODES.has(json.denied.code)) end(json.denied);
      if (json.denied.retryable) throw new Retry(`${json.denied.code}: ${json.denied.message}`);
      throw new ServerError(json.denied.code, json.denied.message, json.denied.family);
    }
    if (!response.ok) {
      end({ code: "E_OFFLINE", family: "link", message: `effect request failed with HTTP ${response.status}`, retryable: true });
      assertActive();
    }
    return json;
  };
  const checkStatus = async (timeout: AbortSignal) => {
    const status = await request("/status", {}, timeout) as { id?: string; attempt?: number; state?: string; deadline?: number | null; cancelled?: boolean; errorCode?: string };
    if (status.id !== claim.id || status.attempt !== claim.attempt) {
      end({ code: "E_EFFECT_LEASE", family: "effect", message: "this effect attempt no longer holds its lease" });
    } else if (status.cancelled) {
      end({ code: "E_EFFECT_CANCELLED", family: "effect", message: "the effect was cancelled" });
    } else if (status.state !== "running") {
      end({ code: status.errorCode ?? "E_EFFECT_LEASE", family: "effect", message: "this effect attempt is no longer running" });
    }
    assertActive();
  };
  poller = statusPoller({
    intervalMs: options.statusIntervalMs ?? 1000,
    stopped: () => closed || Boolean(ended),
    poll: checkStatus,
    lost(error) {
      if (error instanceof ServerError && LOST_CODES.has(error.refusal.code)) end(error.refusal);
      else if (!ended) end({ code: "E_OFFLINE", family: "link", message: "the effect status could not be confirmed", retryable: true });
    },
  });
  return {
    context: Object.freeze({
      effect: Object.freeze({ ...meta }),
      invocation: Object.freeze({ id: claim.id, attempt: claim.attempt, deadline, get cancelled() { return cancelled; }, signal: lifetime.signal }),
      secrets,
      step: steps((path, body) => request(path, body), assertActive, redact),
    } satisfies EffectContext<string>),
    authorityLost() {
      const why = ended;
      return { lost: Boolean(why), terminal: why?.code === "E_EFFECT_GENERATION", message: redact(why ? `${why.code}: ${why.message}` : "effect authority lost") };
    },
    async confirm() {
      await poller?.quiesce();
      assertActive();
      await boundedStatusCheck(checkStatus, lifetime.signal);
      assertActive();
    },
    close() {
      if (closed) return;
      closed = true;
      poller?.close();
      options.signal?.removeEventListener("abort", onStop);
      lifetime.abort(new ServerError(closedWhy.code, closedWhy.message, closedWhy.family));
    },
  };
}
