// @ref LLP 1012#7-writes-offline — writes that cannot reach the owner become
// durable intents; replay is FIFO, one envelope per request, and a settlement
// lands in the same swap as the rows the commit produced.
import {
  SnapbackRefusal,
  isSnapbackRefusal,
  wireMutation,
  wireObject,
  wireQuery,
  wireRefusalEnvelope,
  wireShape,
} from "./client-wire.js";
import { DeliveryEnvelopeDecodeError } from "./offline-protocol.js";
import { tailWatermark, type AcceptedDelivery, type OfflineRuntime } from "./offline.js";
import { replayEnvelope, type OutboxEntry } from "./store/outbox.js";
import { referenceName } from "./api.js";
import type { MutationResult, OutboxApi } from "./types.js";

/** Records the grant a login/guest response carries; the value passes through untouched. */
export function captureGrant<T>(runtime: OfflineRuntime | undefined, value: T): T {
  return runtime ? runtime.noteGrant(value) : value;
}

/**
 * The replayed mutation's terminal object: today's committed/rejected shapes
 * plus the trace conflict, which carries no diagnostic code of its own on the
 * wire and is given the client-side `E_OFFLINE_CONFLICT` envelope here.
 */
export function wireReplayResponse<Result>(value: unknown): MutationResult<Result> & { intent?: string } {
  const surface = "replayed mutation response";
  const record = wireObject(value, surface);
  const intent = typeof record.intent === "string" ? { intent: record.intent } : {};
  if (record.state === "rejected" && record.reason === "conflict") {
    if (record.site !== undefined && typeof record.site !== "string") throw wireShape(`${surface}.site must be a string`);
    const site = record.site as string | undefined;
    return {
      state: "rejected",
      reason: "conflict",
      code: "E_OFFLINE_CONFLICT",
      family: "offline",
      message: `the rows this write read have changed${site ? ` at ${site}` : ""}`,
      ...(site === undefined ? {} : { site }),
      rewrite: "read the current row, then send the write again as a new intent",
      guide: "offline",
      ...intent,
    };
  }
  const result = wireMutation<Result>(value);
  if (result.state === "rejected" && typeof record.reason === "string") return { ...result, reason: record.reason, ...intent };
  return { ...result, ...intent };
}

type Transport = (path: string, init: RequestInit) => Promise<unknown>;
type DrainResult = { stopped: boolean; reason?: "fence" };

export interface SubmitMutationOptions {
  runtime: OfflineRuntime | undefined;
  /** The client's transport is cut (`client.offline()`); the owner is never tried. */
  offline: boolean;
  op: string;
  args: unknown;
  json: Transport;
  failure(error: unknown): Error;
  drain(): Promise<{ stopped: boolean }>;
}

/**
 * A client with no store (no partition open) sends today's bytes. With a
 * partition open every write carries the replay envelope, online or not: the
 * twin runs it locally for its ids and trace, the intent is durable before the
 * request, and the server's ledger makes the online path exactly-once too — a
 * 503 after a commit can no longer double-send (LLP 1002 §9, LLP 1012 §7). A
 * partition with no custody yet (no grant, or an unknown write bound) refuses
 * `E_OFFLINE_ID_BLOCK` with no request rather than fall back to plain bytes:
 * that window is exactly where a 503 after a commit would double-send.
 * Offline, behind queued intents a drain could not clear, or after a transport
 * failure, the write resolves `queued`.
 */
export async function submitMutation<Result>(options: SubmitMutationOptions): Promise<MutationResult<Result>> {
  const { runtime } = options;
  const plain = async () => wireMutation<Result>(await options.json("/api/mutation", {
    method: "POST",
    body: JSON.stringify({ op: options.op, args: options.args }),
  }));
  if (!runtime || runtime.principal === undefined) return plain();
  const enqueue = async (): Promise<OutboxEntry> => {
    try {
      return await runtime.outbox.enqueue(
        { op: options.op, args: options.args, issuedSeq: runtime.seq },
        (ids) => runtime.predict(options.op, options.args, ids),
      );
    } catch (error) {
      throw options.failure(error);
    }
  };
  const queued = (entry: OutboxEntry): MutationResult<Result> => ({ state: "queued", intent: entry.intent, ids: entry.ids });
  if (options.offline) return queued(await enqueue());
  if ((await runtime.queuedIntents()).length > 0) {
    // FIFO: an intent issued behind queued ones must not overtake them. An
    // older intent's refusal is its own: it reaches `settled()` and
    // `useOutbox()`, never this call, which queues behind it.
    let stopped = true;
    try {
      ({ stopped } = await options.drain());
    } catch {
      stopped = true;
    }
    if (stopped) return queued(await enqueue());
  }
  const entry = await enqueue();
  let stopped: boolean;
  try {
    ({ stopped } = await options.drain());
  } catch (error) {
    // A refusal that stopped the replay belongs to the intent that drew it;
    // this one is durable and reports through its entry.
    const own = await runtime.store.outbox.get(entry.intent);
    if (own && own.state !== "queued") return settledResult<Result>(own, runtime);
    throw error;
  }
  const settled = await runtime.store.outbox.get(entry.intent);
  // A transport failure mid-drain leaves the intent queued: the retry is the same envelope.
  if (!settled || settled.state === "queued") return queued(entry);
  void stopped;
  return settledResult<Result>(settled, runtime);
}

/** An online write that settled in its own call: the terminal answer, with the entry retired from the queue. */
async function settledResult<Result>(entry: OutboxEntry, runtime: OfflineRuntime): Promise<MutationResult<Result>> {
  await runtime.outbox.dismiss(entry.intent);
  if (entry.state === "expired") {
    throw new SnapbackRefusal({
      code: "E_OFFLINE_INTENT_EXPIRED",
      family: "offline",
      message: "the owner refused this intent because its replay grant is unknown, foreign, or older than thirty days",
      site: "client.outbox.replay",
      rewrite: "dismiss this intent, resume online for a fresh grant, then send again",
      guide: "offline",
    });
  }
  return entry.response as MutationResult<Result>;
}

export interface DrainOptions {
  signal?: AbortSignal;
  runtime: OfflineRuntime;
  json: Transport;
  shape(message: string): Error;
  failure(error: unknown): Error;
}

/**
 * Replays queued intents in order. A transport failure leaves the intent
 * queued and stops; a rejection, conflict, or refusal settles only that intent
 * and the drain continues. Past the fence, replay waits for a successful
 * resume; only the owner's `E_OFFLINE_INTENT_EXPIRED` refusal settles expired.
 */
export function drainOutbox(options: DrainOptions): Promise<DrainResult> {
  const { runtime } = options;
  const run = runtime.drainTail.then(() => drainQueued(options));
  runtime.drainTail = run.then(() => undefined, () => undefined);
  // The outcome keeps the rejection for `settled()`; the handler here only
  // stops an unobserved refusal from surfacing as an unhandled rejection.
  const outcome = run.then((result) => result.reason === "fence" ? { stopped: "fence" as const } : undefined);
  void outcome.catch(() => undefined);
  runtime.drainOutcome = outcome;
  return run;
}

async function drainQueued(options: DrainOptions): Promise<DrainResult> {
  const { runtime } = options;
  options.signal?.throwIfAborted();
  if (runtime.principal === undefined) return { stopped: false };
  for (const queued of await runtime.outbox.queued()) {
    options.signal?.throwIfAborted();
    const entry = await runtime.store.outbox.get(queued.intent);
    options.signal?.throwIfAborted();
    if (!entry || entry.state !== "queued") continue;
    // @ref LLP 1012#7-writes-offline — the fence never discards a queued
    // write: an intent neither its grant nor a later resume can vouch for
    // stops the drain, and only the owner's refusal can expire it.
    if (!(await runtime.outbox.canReplay(entry))) return { stopped: true, reason: "fence" };
    options.signal?.throwIfAborted();
    let raw: unknown;
    try {
      raw = await options.json("/api/mutation", { method: "POST", body: JSON.stringify(replayEnvelope(entry)) });
    } catch (error) {
      if (isSnapbackRefusal(error) && error.retryable) return { stopped: true };
      if (isSnapbackRefusal(error) && error.envelope.family === "offline") {
        await settle(
          options,
          entry,
          error.code === "E_OFFLINE_INTENT_EXPIRED" ? "expired" : "rejected",
          { state: "rejected", ...wireRefusalEnvelope(error.envelope, "offline refusal"), intent: entry.intent },
        );
        continue;
      }
      throw error;
    }
    options.signal?.throwIfAborted();
    const result = wireReplayResponse(raw);
    if (result.state === "committed") {
      // @ref LLP 1012#7-writes-offline — a committed settlement lands with the
      // rows the commit produced or not at all: when the tail cannot be fetched
      // the intent stays queued and the drain stops; the retry is the same
      // envelope, which the owner's ledger answers unexecuted, and the tail
      // then joins the settlement swap.
      const revision = runtime.coverageRevision;
      let tail: Awaited<ReturnType<typeof logTail>>;
      try {
        tail = await logTail(options, revision);
      } catch (error) {
        if (isSnapbackRefusal(error) && error.retryable) return { stopped: true };
        throw error;
      }
      options.signal?.throwIfAborted();
      if (revision !== runtime.coverageRevision) return { stopped: true };
      if (!(await settle(options, entry, "committed", result, tail, revision))) return { stopped: true };
    } else {
      await settle(options, entry, "rejected", result);
    }
  }
  return { stopped: false };
}

async function settle(
  options: DrainOptions,
  entry: OutboxEntry,
  state: "committed" | "rejected" | "expired",
  response?: unknown,
  tail?: { op: string; args: unknown; accepted: AcceptedDelivery<unknown> },
  revision = options.runtime.coverageRevision,
): Promise<boolean> {
  const settled = options.runtime.outbox.settle(entry, state, response);
  try {
    options.signal?.throwIfAborted();
    const superseded = await options.runtime.commitMany(tail ? [tail] : [], undefined, { put: [settled] }, revision,
      () => !options.signal?.aborted);
    options.signal?.throwIfAborted();
    return !superseded && revision === options.runtime.coverageRevision;
  } catch (error) {
    throw options.failure(error);
  }
}

/**
 * The delivery log after the watermark, fetched right after a commit so the
 * committed intent and the rows it produced enter the store in one swap.
 * The chooser is the rule, not the newest page: the tail is the drained query
 * (`drain: true`) mounted first in this partition — the one whose watermark the
 * store recorded first — and the resume request's `log` uses the same chooser
 * (`tailWatermark`), so a second drained query never feeds the wrong page into
 * the settlement swap (LLP 1012 §7).
 */
async function logTail(options: DrainOptions, revision: number) {
  const { runtime } = options;
  const coverage = await runtime.coverage();
  options.signal?.throwIfAborted();
  if (revision !== runtime.coverageRevision) return undefined;
  const watermark = coverage ? tailWatermark(coverage.watermarks) : undefined;
  // No drained query, no tail: the intent settles `committed` with no rows in
  // its swap. That is the only way a queue held under a login grant with
  // nothing delivered can progress (LLP 1012 §7); the prediction overlay
  // stays until the server's rows arrive, so it is not a stranded queue and
  // must not be "fixed" into one.
  if (!watermark) return undefined;
  const cursor = watermark.cursorArg ?? runtime.cursorArg(watermark.op);
  const args = watermark.watermark === null
    ? watermark.args
    : { ...(watermark.args as Record<string, unknown>), [cursor]: watermark.watermark };
  const held = await runtime.answer(watermark.op, args);
  options.signal?.throwIfAborted();
  if (revision !== runtime.coverageRevision) return undefined;
  const raw = await options.json("/api/query?receipt=1", {
    method: "POST",
    body: JSON.stringify(held?.validator ? { op: watermark.op, args, validator: held.validator } : { op: watermark.op, args }),
  });
  options.signal?.throwIfAborted();
  if (revision !== runtime.coverageRevision) return undefined;
  let accepted: AcceptedDelivery<unknown>;
  try {
    accepted = await runtime.accept(watermark.op, args, raw);
  } catch (error) {
    throw error instanceof DeliveryEnvelopeDecodeError ? options.shape(error.message) : error;
  }
  wireQuery(accepted.result);
  return { op: watermark.op, args, accepted };
}

export function createOutboxApi(
  runtime: OfflineRuntime | undefined,
  drain: () => Promise<DrainResult>,
  ready: () => Promise<void> = async () => undefined,
): OutboxApi {
  const entries = async (): Promise<OutboxEntry[]> => {
    if (!runtime || runtime.principal === undefined) return [];
    try {
      return await runtime.outbox.entries();
    } catch (error) {
      // A sealed partition keeps its outbox closed until the principal re-authenticates.
      if (error instanceof Error && /sealed/.test(error.message)) return [];
      throw error;
    }
  };
  return {
    entries,
    dismiss: async (intent) => {
      if (runtime && runtime.principal !== undefined) await runtime.outbox.dismiss(intent);
    },
    subscribe: (listener) => {
      let active = true;
      let version = 0;
      const push = () => {
        const current = ++version;
        const principal = runtime?.principal;
        void entries().then((value) => {
          if (active && current === version && principal === runtime?.principal) listener(value);
        }, () => undefined);
      };
      push();
      const unsubscribe = runtime?.outbox.subscribe(push);
      return () => { active = false; unsubscribe?.(); };
    },
    // @ref LLP 1012#7-writes-offline — with a partition open every write needs a
    // grant before any request leaves; the fence disables prediction and replay,
    // not enqueue, so an app may keep accepting writes while trust is stale. The
    // op form also checks its certified bound and remaining capacity. Answered
    // after the client's own startup, so a partition about to open never reads
    // as "no partition, plain bytes".
    ready: async (op) => {
      await ready().catch(() => undefined);
      if (!runtime || runtime.principal === undefined) return true;
      try {
        return await runtime.outbox.ready(op === undefined ? undefined : referenceName(op));
      } catch (error) {
        if (error instanceof Error && /sealed/.test(error.message)) return false;
        throw error;
      }
    },
    fence: async () => {
      await ready().catch(() => undefined);
      if (!runtime || runtime.principal === undefined) return "inside";
      try { return await runtime.outbox.fence(); }
      catch (error) {
        if (error instanceof Error && /sealed/.test(error.message)) return "past";
        throw error;
      }
    },
    drain: async () => {
      const result = await drain();
      return result.reason === "fence" ? { stopped: "fence" } : undefined;
    },
    // A fence stop is explicit even though custody remains queued. Other
    // non-retryable refusals still reject; transport stops retain their behavior.
    settled: async () => runtime?.drainOutcome,
  };
}
