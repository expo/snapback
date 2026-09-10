// @ref LLP 1012#7-writes-offline — writes that cannot reach the owner become
// durable intents; replay is FIFO, one envelope per request, and a settlement
// lands in the same swap as the rows the commit produced.
import { followerRefusal, throwIfAborted } from "./client-wire.js";
import {
  RefusalError,
  isRefusalError, isTerminalSession,
  wireMutation,
  wireObject,
  wireQuery,
  wireRefusal,
  wireShape,
} from "./client-wire.js";
import { DeliveryEnvelopeDecodeError } from "./offline-protocol.js";
import { OfflineAuthorityError, type AcceptedDelivery, type OfflineRuntime } from "./offline.js";
import { FullRevalidationRequired } from "./store/fact-integrity.js";
import { OutboxRefusal, replayEnvelope, type OutboxEntry } from "./store/outbox.js";
import { referenceName } from "./api.js";
import { inboxKeyOf } from "./store/inbox.js";
import { observeOutbox } from "./client-outbox-observed.js";
import type { MutationResult, OutboxApi, OutboxSettlement, OutboxStatus } from "./types.js";

/**
 * The replayed mutation's terminal object: today's committed/rejected shapes
 * plus the trace conflict, which carries no diagnostic code of its own on the
 * wire and is given the client-side `E_OFFLINE_CONFLICT` envelope here.
 */
export function wireReplayResponse<Result>(value: unknown): MutationResult<Result> & { intent?: string } {
  const surface = "replayed mutation response";
  const record = wireObject(value, surface);
  const intent = typeof record.intent === "string" ? { intent: record.intent } : {};
  if (record.state === "rejected" && record.reason === "conflict" && record.code === undefined) {
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
  if (result.state === "committed" && record.program !== undefined) {
    const program = wireObject(record.program, `${surface}.program`);
    if (typeof program.planHash !== "string" || !/^[a-f0-9]{64}$/.test(program.planHash)
      || typeof program.schemaHash !== "string" || !/^[a-f0-9]{64}$/.test(program.schemaHash)) throw wireShape(`${surface}.program must carry exact plan and schema hashes`);
    if (record.effects !== undefined && (!Array.isArray(record.effects) || record.effects.some(row => !row || typeof row !== "object"
      || typeof row.table !== "string" || !row.table || typeof row.id !== "string" || !row.id
      || (row.removed !== undefined && row.removed !== true)))) throw wireShape(`${surface}.effects must contain row addresses`);
    return { ...result, ...intent, ...(Array.isArray(record.effects) ? { effects: record.effects } : {}), program: { planHash: program.planHash, schemaHash: program.schemaHash } };
  }
  if (result.state === "rejected" && typeof record.reason === "string") return { ...result, reason: record.reason, ...intent };
  return { ...result, ...intent };
}

type Transport = (path: string, init: RequestInit, onSend?: () => void) => Promise<unknown>;
export type DrainResult = { stopped: boolean; reason?: Exclude<OutboxSettlement["stopped"], false>; remaining: number };

export interface SubmitMutationOptions {
  runtime: OfflineRuntime | undefined;
  /** The client's transport is cut (`client.offline()`); the owner is never tried. */
  offline: boolean;
  op: string;
  args: unknown;
  presentation?: string;
  expectedGeneration?: string;
  json: Transport;
  failure(error: unknown): Error;
  drain(): Promise<{ stopped: boolean }>;
  onCustody?(kind: "wire" | "outbox"): void;
  /** The writer admits every inbox row durable before this write, so a local write never overtakes them (LLP 1018.004 §4). */
  admitInbox?(): Promise<{ stopped?: string } | void>;
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
  const plain = async () => {
    return wireMutation<Result>(await options.json("/api/mutation", {
      method: "POST",
      body: JSON.stringify({ op: options.op, args: options.args, expectedGeneration: options.expectedGeneration }),
    }, () => options.onCustody?.("wire")));
  };
  // A follower tab never sends plain bytes: a write landing ahead of the writer
  // tab's queued intents would invert their order when that queue is inherited.
  if (runtime?.following) throw followerRefusal();
  if (!runtime || runtime.principal === undefined) return plain();
  const gate = await options.admitInbox?.();
  if (gate && gate.stopped !== undefined) {
    // An older row another tab wrote is waiting on what this partition lacks; this write may not overtake it.
    throw options.failure(new OutboxRefusal(
      `an older write from another tab of this device is waiting for admission (${gate.stopped}); this write queues behind it`,
      "resume online for a fresh grant, then send again"));
  }
  const enqueue = async (): Promise<OutboxEntry> => {
    try {
      return await runtime.outbox.enqueue(
        { op: options.op, args: options.args, expectedGeneration: options.expectedGeneration, issuedSeq: runtime.seq, presentation: options.presentation },
        (ids) => runtime.predict(options.op, options.args, ids),
        () => options.onCustody?.("outbox"),
      );
    } catch (error) {
      throw options.failure(error);
    }
  };
  const queued = (entry: OutboxEntry): MutationResult<Result> => ({ state: "queued", intent: entry.intent, ids: entry.ids });
  if (options.offline) return queued(await enqueue());
  if ((await runtime.queuedIntents()).length > 0) {
    // FIFO: an intent issued behind queued ones must not overtake them. An
    // older intent's ordinary refusal reaches `settled()` and `useOutbox()`;
    // session death instead fences this call before it can acquire custody.
    let stopped = true;
    try {
      ({ stopped } = await options.drain());
    } catch (error) {
      if (isRefusalError(error) && isTerminalSession(error.envelope)) throw error;
      stopped = true;
    }
    if (stopped) return queued(await enqueue());
  }
  const entry = await enqueue();
  const slot = openTerminal(runtime, entry.intent);
  try {
    let stopped: boolean;
    try {
      ({ stopped } = await options.drain());
    } catch (error) {
      // A refusal that stopped the replay belongs to the intent that drew it;
      // this one is durable and reports through its entry.
      // Session expiry sealed the store; preserve its refusal instead of reading through that seal.
      if (isRefusalError(error) && isTerminalSession(error.envelope)) throw error;
      const own = (await runtime.store.outbox.get(entry.intent)) ?? slot.entry;
      if (own && own.state !== "queued") return settledResult<Result>(own);
      throw error;
    }
    const settled = (await runtime.store.outbox.get(entry.intent)) ?? slot.entry;
    // A transport failure mid-drain leaves the intent queued: the retry is the same envelope.
    if (!settled || settled.state === "queued") return queued(entry);
    void stopped;
    return settledResult<Result>(settled);
  } finally {
    closeTerminal(runtime, entry.intent);
  }
}

// @ref LLP 1018.003.000#4-observation-and-retention —
// dismissal or successful compaction may precede the call reading its entry back;
// the drain records each terminal
// verdict so that call answers from it rather than mistaking absence for "still queued".
// Only a call that is waiting on its own intent holds a slot, and it closes the
// slot on every exit, so the record is bounded by in-flight calls and cannot
// outlive a partition, reset, or principal change.
const terminalWaiters = new WeakMap<OfflineRuntime, Map<string, { entry?: OutboxEntry }>>();
function openTerminal(runtime: OfflineRuntime, intent: string): { entry?: OutboxEntry } {
  let waiters = terminalWaiters.get(runtime);
  if (!waiters) terminalWaiters.set(runtime, (waiters = new Map()));
  const slot: { entry?: OutboxEntry } = {};
  waiters.set(intent, slot);
  return slot;
}
function closeTerminal(runtime: OfflineRuntime, intent: string): void {
  terminalWaiters.get(runtime)?.delete(intent);
}
function recordTerminal(runtime: OfflineRuntime, entry: OutboxEntry): void {
  const slot = terminalWaiters.get(runtime)?.get(entry.intent);
  if (slot) slot.entry = entry;
}

// @ref LLP 1018.003.000#4-observation-and-retention —
// settlement does not prove that a query can display the target. Online and
// initially queued writes share the same terminal handoff and compaction rule.
function settledResult<Result>(entry: OutboxEntry): MutationResult<Result> {
  if (entry.state === "expired") {
    throw new RefusalError({
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
  // @ref LLP 1018.003.001#1-readiness-actions — only active replay justifies
  // waiting for the server; a successful read cannot resume a stopped queue.
  const run = runtime.drainTail.then(async () => {
    throwIfAborted(options.signal);
    runtime.draining = true;
    runtime.outbox.notify();
    try { return await drainQueued(options); }
    finally { runtime.draining = false; runtime.outbox.notify(); }
  });
  runtime.drainTail = run.then(() => undefined, () => undefined);
  // The verdict keeps the rejection for `settled()`; the handler here only
  // stops an unobserved refusal from surfacing as an unhandled rejection.
  const verdict = run.then(settlement);
  void verdict.catch(() => undefined);
  runtime.drainVerdict = verdict;
  return run;
}

async function drainQueued(options: DrainOptions): Promise<DrainResult> {
  const { runtime } = options;
  throwIfAborted(options.signal);
  const finish = async (reason?: DrainResult["reason"]): Promise<DrainResult> =>
    ({ stopped: reason !== undefined, ...(reason ? { reason } : {}), remaining: runtime.principal === undefined ? 0 : (await runtime.outbox.queued()).length });
  if (runtime.principal === undefined) return finish();
  for (const queued of await runtime.outbox.queued()) {
    throwIfAborted(options.signal);
    let entry = await runtime.store.outbox.get(queued.intent);
    throwIfAborted(options.signal);
    if (!entry || entry.state !== "queued") continue;
    // @ref LLP 1012#7-writes-offline — the fence never discards a queued
    // write: an intent neither its grant nor a later resume can vouch for
    // stops the drain, and only the owner's refusal can expire it.
    if (!(await runtime.outbox.canReplay(entry))) return finish("fence");
    throwIfAborted(options.signal);
    entry = await runtime.outbox.attempt(entry.intent);
    if (!entry) continue; // dismissal won the lock: never send discarded bytes.
    throwIfAborted(options.signal);
    let raw: unknown;
    try {
      raw = await options.json("/api/mutation", { method: "POST", body: JSON.stringify(replayEnvelope(entry)) });
    } catch (error) {
      if (isRefusalError(error) && error.retryable) return finish("transport");
      if (isRefusalError(error) && error.envelope.family === "offline") {
        await settle(
          options,
          entry,
          error.code === "E_OFFLINE_INTENT_EXPIRED" ? "expired" : "rejected",
          { state: "rejected", ...wireRefusal(error.envelope, "offline refusal"), intent: entry.intent },
        );
        continue;
      }
      // @ref LLP 1020#a2-enum-case-removal-is-checked-narrowing — the owner judged the
      // replay by current validation and refused it unspent (LLP 1012 §7): the intent
      // keeps its bytes at the head of the queue, and the refusal recorded on it is what
      // makes `dismiss` admit it so the FIFO can continue (fix round r1 ruling).
      if (isRefusalError(error) && (error.envelope.family === "input" || error.envelope.family === "schema")) {
        await runtime.outbox.attempt(entry.intent, wireRefusal(error.envelope, "replay refusal"));
      }
      throw error;
    }
    throwIfAborted(options.signal);
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
        if (isRefusalError(error) && error.retryable) return finish("transport");
        throw error;
      }
      throwIfAborted(options.signal);
      if (revision !== runtime.coverageRevision) return finish("authority");
      if (!(await settle(options, entry, "committed", result, tail, revision))) return finish("authority");
    } else {
      await settle(options, entry, "rejected", result);
    }
  }
  return finish();
}

function settlement(result: DrainResult): OutboxSettlement {
  return { stopped: result.reason ?? false, remaining: result.remaining };
}

async function followerSettlement(runtime: OfflineRuntime, inbox: FollowerInbox | undefined, offline: boolean): Promise<OutboxSettlement> {
  const queuedEntries = (await runtime.itemEntries()).filter((entry) => entry.state === "queued" && inboxKeyOf(entry.intent) === undefined).length;
  const remaining = runtime.inboxPending + queuedEntries;
  if (remaining === 0) return { stopped: false, remaining };
  const status = await inbox?.status();
  if (status?.reason === "writer-unresponsive") return { stopped: "writer-unresponsive", remaining };
  const writer = inbox?.writer;
  if (writer?.fence === "past") return { stopped: "fence", remaining };
  return { stopped: offline ? "offline" : "pending", remaining };
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
    throwIfAborted(options.signal);
    const superseded = await options.runtime.commitMany(tail ? [tail] : [], undefined, { put: [settled] }, revision,
      () => !options.signal?.aborted);
    throwIfAborted(options.signal);
    if (!superseded) recordTerminal(options.runtime, settled);
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
  const principal = runtime.principal;
  const current = () => revision === runtime.coverageRevision && principal === runtime.principal;
  const watermark = await runtime.logWatermark();
  throwIfAborted(options.signal);
  if (!current()) return undefined;
  // No drained query, no tail: the intent settles `committed` with no rows in
  // its swap. That is the only way a queue held under a login grant with
  // nothing delivered can progress (LLP 1012 §7); the prediction overlay
  // stays until the server's rows arrive, so it is not a stranded queue and
  // must not be "fixed" into one.
  if (!watermark || runtime.unsupportedLog(watermark.op)) return undefined;
  const cursor = watermark.cursorArg ?? runtime.cursorArg(watermark.op);
  const args = watermark.watermark === null
    ? watermark.args
    : { ...(watermark.args as Record<string, unknown>), [cursor]: watermark.watermark };
  const held = await runtime.answer(watermark.op, args);
  throwIfAborted(options.signal);
  if (!current()) return undefined;
  const raw = await options.json("/api/query?receipt=1", {
    method: "POST",
    body: JSON.stringify(held?.validator ? { op: watermark.op, args, validator: held.validator } : { op: watermark.op, args }),
  });
  throwIfAborted(options.signal);
  if (!current()) return undefined;
  let accepted: AcceptedDelivery<unknown>;
  let fullFailure: unknown;
  try {
    // @ref LLP 1012#8-the-delivery-envelope-the-validator-and-resume — a
    // conditional tail whose held answer lost immutable fact proofs gets one
    // same-authority full-envelope retry before settlement.
    accepted = await runtime.accept(watermark.op, args, raw, async () => {
      throwIfAborted(options.signal);
      if (!current()) throw options.failure(new OfflineAuthorityError("delivery log authority changed during full revalidation"));
      let full: unknown;
      try {
        full = await options.json("/api/query?receipt=1", {
          method: "POST", body: JSON.stringify({ op: watermark.op, args }),
        });
      } catch (error) { fullFailure = error; throw error; }
      throwIfAborted(options.signal);
      if (!current()) throw options.failure(new OfflineAuthorityError("delivery log authority changed during full revalidation"));
      return full;
    });
  } catch (error) {
    if (error instanceof DeliveryEnvelopeDecodeError) throw options.shape(error.message);
    if (FullRevalidationRequired.is(error) && isRefusalError(fullFailure) && fullFailure.retryable) throw fullFailure;
    throw FullRevalidationRequired.is(error) ? options.failure(error) : error;
  }
  throwIfAborted(options.signal);
  if (!current()) return undefined;
  wireQuery(accepted.result);
  return { op: watermark.op, args, accepted };
}

/** The inbox role a follower's outbox API delegates to (LLP 1018.004 §§2–3). */
export interface FollowerInbox {
  status(): Promise<OutboxStatus>;
  subscribe(listener: () => void): () => void;
  dismiss(intent: string): Promise<OutboxEntry | undefined>;
  refresh(): Promise<void>;
  readonly writer: OutboxStatus | undefined;
}

/** Derive the blocked head from durable entries on either tab. */
export function blockedStatus(entries: OutboxEntry[]): Pick<OutboxStatus, "blocked"> {
  const head = entries.find(entry => entry.state === "queued");
  return head?.refusal ? { blocked: { intent: head.intent, code: head.refusal.code } } : {};
}

export function createOutboxApi(
  runtime: OfflineRuntime | undefined,
  drain: () => Promise<DrainResult>,
  ready: () => Promise<void> = async () => undefined,
  offline: () => boolean = () => false,
  inbox?: FollowerInbox,
  identity: () => string = () => runtime?.principal ?? "",
): OutboxApi {
  const entries = (): Promise<OutboxEntry[]> => runtime?.itemEntries() ?? Promise.resolve([]);
  const status = async (op?: import("./api.js").Op<any, any>): Promise<OutboxStatus> => {
    await ready().catch(() => undefined);
    if (runtime?.following) return inbox?.status()
      ?? { ready: false, reason: "follower", action: "other-tab", remaining: 0, fence: "inside" };
    if (!runtime || runtime.principal === undefined) return { ready: true, reason: "ready", action: "none", remaining: 0, fence: "inside" };
    try {
      const value = await runtime.outbox.status(op === undefined ? undefined : referenceName(op));
      return { ...value, ...blockedStatus(await runtime.outbox.queued()), ...(runtime.draining ? { draining: true as const } : {}) };
    }
    catch (error) {
      if (error instanceof Error && /sealed/.test(error.message)) return { ready: false, reason: "sealed", action: "sign-in", remaining: 0, fence: "past" };
      throw error;
    }
  };
  return {
    entries,
    status,
    observe: observeOutbox(entries, status, notify => {
      const stop = runtime?.outbox.subscribe(notify), stopInbox = inbox?.subscribe(notify);
      return () => { stop?.(); stopInbox?.(); };
    }, identity, () => (runtime?.following ? inbox?.writer : undefined)),
    // @ref LLP 1018.004#2-the-inbox — a follower's dismissal is a durable command row the writer consumes.
    dismiss: async (intent) => {
      const entry = runtime?.following ? await inbox?.dismiss(intent)
        : runtime?.principal !== undefined ? await runtime.outbox.dismiss(intent) : undefined;
      return entry?.state === "queued" && entry.refusal
        ? { intent: entry.intent, op: entry.op, args: entry.args, refusal: entry.refusal } : undefined;
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
      const unsubscribeInbox = inbox?.subscribe(push);
      return () => { active = false; unsubscribe?.(); unsubscribeInbox?.(); };
    },
    // @ref LLP 1012#7-writes-offline — with a partition open every write needs a
    // grant before any request leaves; the fence disables prediction and replay,
    // not enqueue, so an app may keep accepting writes while trust is stale. The
    // op form also checks its certified bound and remaining capacity. Answered
    // after the client's own startup, so a partition about to open never reads
    // as "no partition, plain bytes".
    ready: async (op) => (await status(op)).ready,
    fence: async () => {
      await ready().catch(() => undefined);
      if (runtime?.following) return inbox?.writer?.fence ?? "inside";
      if (!runtime || runtime.principal === undefined) return "inside";
      try { return await runtime.outbox.fence(); }
      catch (error) {
        if (error instanceof Error && /sealed/.test(error.message)) return "past";
        throw error;
      }
    },
    drain: async () => {
      if (runtime?.following) { await inbox?.refresh(); return followerSettlement(runtime, inbox, offline()); }
      const result = await drain();
      return settlement(result);
    },
    // A fence stop is explicit even though custody remains queued. Other
    // non-retryable refusals still reject; transport stops retain their behavior.
    settled: async () => {
      await ready();
      // @ref LLP 1018.004#3-readiness-on-a-follower — a follower's settlement
      // reads the rows and the writer's ledger; it never hangs on an offline writer.
      if (runtime?.following) { await inbox?.refresh(); return followerSettlement(runtime, inbox, offline()); }
      await runtime?.drainTail;
      if (!runtime || runtime.principal === undefined) return { stopped: false, remaining: 0 };
      const result = await runtime.drainVerdict;
      let remaining: number;
      try { remaining = (await runtime.outbox.queued()).length; }
      catch (error) {
        if (error instanceof Error && /sealed|not open|closed/.test(error.message)) throw new RefusalError({
          code: "E_OFFLINE_LIFECYCLE", family: "offline", guide: "offline", site: "client.outbox.settled",
          message: "outbox settlement is unavailable while this partition is sealed or closed",
          rewrite: "authenticate the same account or reopen the client; queued writes are kept",
        });
        throw error;
      }
      if (remaining === 0) return { stopped: false, remaining };
      if (await runtime.outbox.fence() === "past") return { stopped: "fence", remaining };
      return { stopped: offline() ? "offline" : result.stopped || "pending", remaining };
    },
  };
}
