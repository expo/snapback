// @ref LLP 1012#7-writes-offline — writes that cannot reach the owner become
// durable intents; replay is FIFO, one envelope per request, and a settlement
// lands in the same swap as the rows the commit produced.
import {
  isSnapbackRefusal,
  wireMutation,
  wireObject,
  wireQuery,
  wireRefusalEnvelope,
  wireShape,
} from "./client-wire.js";
import { DeliveryEnvelopeDecodeError } from "./offline-protocol.js";
import type { AcceptedDelivery, OfflineRuntime } from "./offline.js";
import { replayEnvelope, type OutboxEntry } from "./store/outbox.js";
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

function transportFailure(error: unknown): boolean {
  return isSnapbackRefusal(error) && error.retryable && (error.code === "E_NETWORK" || error.code === "E_TRANSPORT");
}

/**
 * Online with an empty outbox the write takes today's path unchanged. Offline,
 * behind queued intents that a drain could not clear, or after a retryable
 * transport failure, it is enqueued and resolves `queued`.
 */
export async function submitMutation<Result>(options: SubmitMutationOptions): Promise<MutationResult<Result>> {
  const { runtime } = options;
  const plain = async () => wireMutation<Result>(await options.json("/api/mutation", {
    method: "POST",
    body: JSON.stringify({ op: options.op, args: options.args }),
  }));
  if (!runtime || runtime.principal === undefined) return plain();
  const enqueue = async (): Promise<MutationResult<Result>> => {
    try {
      const entry = await runtime.outbox.enqueue({
        op: options.op,
        args: options.args,
        maxNewIds: runtime.maxNewIds(options.op),
        issuedSeq: runtime.seq,
      });
      return { state: "queued", intent: entry.intent, ids: entry.ids };
    } catch (error) {
      throw options.failure(error);
    }
  };
  if (options.offline) return enqueue();
  if ((await runtime.queuedIntents()).length > 0) {
    // FIFO: an intent issued behind queued ones must not overtake them.
    const { stopped } = await options.drain();
    if (stopped) return enqueue();
  }
  try {
    return await plain();
  } catch (error) {
    if (transportFailure(error)) return enqueue();
    throw error;
  }
}

export interface DrainOptions {
  runtime: OfflineRuntime;
  json: Transport;
  shape(message: string): Error;
  failure(error: unknown): Error;
}

/**
 * Replays queued intents in order. A transport failure leaves the intent
 * queued and stops; a rejection, conflict, or refusal settles only that intent
 * and the drain continues; a grant past the fence settles `expired` locally.
 */
export function drainOutbox(options: DrainOptions): Promise<{ stopped: boolean }> {
  const { runtime } = options;
  const run = runtime.drainTail.then(() => drainQueued(options));
  runtime.drainTail = run.then(() => undefined, () => undefined);
  return run;
}

async function drainQueued(options: DrainOptions): Promise<{ stopped: boolean }> {
  const { runtime } = options;
  if (runtime.principal === undefined) return { stopped: false };
  for (const queued of await runtime.outbox.queued()) {
    const entry = await runtime.store.outbox.get(queued.intent);
    if (!entry || entry.state !== "queued") continue;
    const grant = await runtime.outbox.grantById(entry.grant);
    if (!grant || runtime.outbox.pastFence(grant)) {
      await settle(options, entry, "expired");
      continue;
    }
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
    const result = wireReplayResponse(raw);
    if (result.state === "committed") {
      const tail = await logTail(options).catch(() => undefined);
      await settle(options, entry, "committed", result, tail);
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
): Promise<void> {
  const settled = options.runtime.outbox.settle(entry, state, response);
  try {
    await options.runtime.commitMany(tail ? [tail] : [], undefined, { put: [settled] });
  } catch (error) {
    throw options.failure(error);
  }
}

/**
 * The delivery log after the watermark, fetched right after a commit so the
 * committed intent and the rows it produced enter the store in one swap.
 */
async function logTail(options: DrainOptions) {
  const { runtime } = options;
  const coverage = await runtime.coverage();
  const watermark = coverage?.watermarks.sort((a, b) => b.updatedAt - a.updatedAt)[0];
  if (!watermark) return undefined;
  const args = watermark.watermark === null
    ? watermark.args
    : { ...(watermark.args as Record<string, unknown>), c: watermark.watermark };
  const held = await runtime.answer(watermark.op, args);
  const raw = await options.json("/api/query?receipt=1", {
    method: "POST",
    body: JSON.stringify(held?.validator ? { op: watermark.op, args, validator: held.validator } : { op: watermark.op, args }),
  });
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
  drain: () => Promise<{ stopped: boolean }>,
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
      const push = () => { void entries().then(listener, () => undefined); };
      push();
      return runtime ? runtime.outbox.subscribe(push) : () => undefined;
    },
    drain: async () => { await drain(); },
    settled: async () => { await runtime?.drainTail; },
  };
}
