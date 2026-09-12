// @ref LLP 1012#7-writes-offline — writes that cannot reach the owner become
// durable intents; replay is FIFO with bounded generated acknowledgement groups, and a settlement
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
import { AcknowledgementTailRequired } from './delivery-acknowledgements.js';
import { OutboxRefusal, replayEnvelope, type OutboxEntry } from "./store/outbox.js";
export { blockedStatus } from './store/outbox.js';
import { referenceName } from "./api.js";
import { inboxKeyOf } from "./store/inbox.js";
import { observeOutbox } from "./client-outbox-observed.js";
import { recoverOutbox, recoveryLifecycle } from "./client-outbox-recover.js";
import type { RecoveryDemand } from "./client-recovery.js";
import type { ConnectionState, MutationResult, OutboxApi, OutboxSettlement, OutboxStatus } from "./types.js";

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
  /** After atomic carrier completion, retain this call's public identity through a refused wait. */
  onAdmitted?(intent: string): void;
  prepare?(op: string): Promise<void>;
  /** The writer admits every inbox row durable before this write, so a local write never overtakes them (LLP 1018.004 §4). */
  admitInbox?(): Promise<{ stopped?: string; op?: string } | void>;
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
  if (!runtime) return plain();
  // @ref LLP 1023.002#a--a-small-reproduction-matrix-on-current-source —
  // failed bearer restoration is not permission to bypass configured custody.
  if (runtime.principal === undefined) throw options.failure(new Error("durable partition is not open; finish signing in before submitting this write"));
  const admitInbox = async () => {
    let gate = await options.admitInbox?.();
    if (gate?.stopped && !options.offline && options.prepare) {
      await options.prepare(gate.op ?? options.op);
      gate = await options.admitInbox?.();
    }
    if (!gate?.stopped) return;
    // An older row another tab wrote is waiting on what this partition lacks; this write may not overtake it.
    throw options.failure(new OutboxRefusal(
      `an older write from another tab of this device is waiting for admission (${gate.stopped}); this write queues behind it`,
      "resume online for a fresh grant, then send again"));
  };
  await admitInbox();
  const enqueue = async (): Promise<OutboxEntry> => {
    if (!options.offline) await options.prepare?.(options.op);
    await admitInbox(); // A follower may have become durable while capacity was in flight.
    let custody = false;
    const admit = async () => {
      const entry = await runtime.outbox.enqueue(
      { op: options.op, args: options.args, expectedGeneration: options.expectedGeneration, issuedSeq: runtime.seq, presentation: options.presentation },
      ids => runtime.predict(options.op, options.args, ids),
        () => { options.onCustody?.("outbox"); custody = true; },
      );
      options.onAdmitted?.(entry.intent);
      return entry;
    };
    try {
      return await admit();
    } catch (error) {
      // Capacity was advisory: another concurrent admission may have consumed
      // the slice. Retry only this pristine ID refusal, never ambiguous custody.
      if (!custody && !options.offline && options.prepare && error instanceof OutboxRefusal && error.code === "E_OFFLINE_ID_BLOCK") {
        await options.prepare(options.op);
        await admitInbox();
        try { return await admit(); } catch (next) { throw options.failure(next); }
      }
      throw options.failure(error);
    }
  };
  const queued = (entry: OutboxEntry): MutationResult<Result> => ({ state: "queued", intent: entry.intent, ids: entry.ids });
  if (options.offline) return queued(await enqueue());
  // @ref LLP 1012#7-writes-offline — admission appends behind older intents;
  // replay enforces FIFO. Waiting for a drain before admission lets background
  // acknowledgements continually move the end of the queue ahead of this write.
  const entry = await enqueue();
  const slot = openTerminal(runtime, entry.intent);
  try {
    let stopped: boolean;
    try {
      ({ stopped } = await Promise.race([options.drain(), slot.done.then(() => ({ stopped: false }))]));
    } catch (error) {
      // A refusal that stopped the replay belongs to the intent that drew it;
      // this one is durable and reports through its entry.
      // Session expiry sealed the store; preserve its refusal instead of reading through that seal.
      if (isRefusalError(error) && isTerminalSession(error.envelope)) throw error;
      const own = slot.entry ?? await runtime.store.outbox.get(entry.intent);
      if (own && own.state !== "queued") return settledResult<Result>(own);
      if (own && !own.refusal && isRefusalError(error)
        && (error.envelope.family === "input" || error.envelope.family === "schema")) return queued(entry);
      throw error;
    }
    const settled = slot.entry ?? await runtime.store.outbox.get(entry.intent);
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
type TerminalWaiter = { entry?: OutboxEntry; done: Promise<void>; resolve(): void };
const terminalWaiters = new WeakMap<OfflineRuntime, Map<string, TerminalWaiter>>();
function openTerminal(runtime: OfflineRuntime, intent: string): TerminalWaiter {
  let waiters = terminalWaiters.get(runtime);
  if (!waiters) terminalWaiters.set(runtime, (waiters = new Map()));
  let resolve!: () => void;
  const done = new Promise<void>(yes => { resolve = yes; });
  const slot: TerminalWaiter = { done, resolve };
  waiters.set(intent, slot);
  return slot;
}
function closeTerminal(runtime: OfflineRuntime, intent: string): void {
  terminalWaiters.get(runtime)?.delete(intent);
}
function recordTerminal(runtime: OfflineRuntime, entry: OutboxEntry): void {
  const slot = terminalWaiters.get(runtime)?.get(entry.intent);
  if (slot) { slot.entry = entry; slot.resolve(); }
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
 * queued and stops. Non-retryable input/schema refusals persist dismissal
 * eligibility and stop the drain; terminal rejections/conflicts settle and
 * continue. Past the fence, replay waits for a successful
 * resume; only the owner's `E_OFFLINE_INTENT_EXPIRED` refusal settles expired.
 */
export function drainOutbox(options: DrainOptions): Promise<DrainResult> {
  const { runtime } = options;
  // @ref LLP 1018.008.000#follower-tabs-and-readiness — waiting describes
  // actual recovery/replay work, not connected transport by itself.
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
    ({ stopped: reason !== undefined, ...(reason ? { reason } : {}), remaining: runtime.principal === undefined ? 0 : (await runtime.outbox.status()).remaining });
  if (runtime.principal === undefined) return finish();
  for (;;) {
    if (runtime.following) return finish("pending");
    await runtime.outbox.admitAcknowledgements();
    const candidates = await runtime.outbox.attemptBatch(options.signal);
    throwIfAborted(options.signal);
    if (runtime.following) return finish("pending");
    if (!candidates.length) return finish((await runtime.outbox.queued()).length ? "fence"
      : (await runtime.outbox.pendingAcknowledgements()).remaining ? "pending" : undefined);
    const entries: OutboxEntry[] = [], encoded: string[] = [];
    let bytes = 12;
    for (const entry of candidates) {
      const value = JSON.stringify(replayEnvelope(entry)), size = new TextEncoder().encode(value).byteLength;
      if (entries.length && bytes + size + 1 > 1_048_576) break;
      entries.push(entry); encoded.push(value); bytes += size + 1;
    }
    const revision = runtime.coverageRevision;
    let results: Array<MutationResult<unknown> & { intent?: string }> = [], failure: unknown;
    try {
      const raw = await options.json("/api/mutation", { method: "POST",
        body: entries.length === 1 ? encoded[0] : `{"batch":[${encoded.join(",")}]}` });
      if (entries.length === 1) results = [wireReplayResponse(raw)];
      else {
        const response = wireObject(raw, "replay batch response");
        if (!Array.isArray(response.results) || response.results.length > entries.length || typeof response.more !== "boolean"
          || (response.error === undefined ? (!response.results.length || response.more !== (response.results.length < entries.length))
            : response.more || response.results.length === entries.length)) throw wireShape("invalid replay batch prefix");
        results = response.results.map(wireReplayResponse);
        if (response.error !== undefined) {
          const refusal = wireRefusal(response.error, "replay batch refusal");
          failure = new RefusalError(refusal, refusal.retryable === true);
        }
      }
      if (results.some((result, index) => result.state === "queued"
        || (entries.length > 1 || result.intent !== undefined) && result.intent !== entries[index].intent))
        throw wireShape("replay terminal does not match its FIFO intent");
    } catch (error) { failure = error; results = []; }
    throwIfAborted(options.signal);
    if (revision !== runtime.coverageRevision) return finish("authority");
    if (results.length) {
      const settled = results.map((result, index) => runtime.outbox.settle(entries[index], result.state as "committed" | "rejected", result));
      try {
        if (!(await settleResults(options, settled, revision))) return finish("authority");
      } catch (error) {
        if (isRefusalError(error) && error.retryable) return finish("transport");
        throw error;
      }
    }
    if (failure === undefined) continue;
    const entry = entries[results.length];
    if (isRefusalError(failure) && failure.retryable) return finish("transport");
    if (isRefusalError(failure) && failure.envelope.family === "offline") {
      if (!(await settleEntries(options, [runtime.outbox.settle(entry,
        failure.code === "E_OFFLINE_INTENT_EXPIRED" ? "expired" : "rejected",
        { state: "rejected", ...wireRefusal(failure.envelope, "offline refusal"), intent: entry.intent })], undefined, revision))) return finish("authority");
      continue;
    }
    // A known unspent refusal remains at its exact FIFO position; later entries cannot overtake it.
    if (isRefusalError(failure) && (failure.envelope.family === "input" || failure.envelope.family === "schema"))
      await runtime.outbox.attempt(entry.intent, wireRefusal(failure.envelope, "replay refusal"));
    throw failure;
  }
}

// @ref LLP 1018.008.007.002#5-batch-acknowledgement-admission-and-replay —
// replay terminals retain their actual effects. One later same-authority tail may
// accompany the whole prefix; a terminal itself never proves those effects observed.
async function settleResults(options: DrainOptions, entries: OutboxEntry[], revision: number): Promise<boolean> {
  const committed = entries.filter(entry => entry.state === "committed");
  if (committed.length) {
    const identity = (entry: OutboxEntry) => JSON.stringify((entry.response as { program?: unknown }).program);
    if (committed.some(entry => identity(entry) !== identity(committed[0]))) {
      for (const entry of entries) if (!(await settleResults(options, [entry], revision))) return false;
      return true;
    }
    let noTail = committed.length === entries.length;
    for (const entry of committed) if (!(await options.runtime.store.outbox.acknowledgementWithoutTail?.(entry))) { noTail = false; break; }
    if (noTail) {
      try { return await settleEntries(options, entries, undefined, revision, true); }
      catch (error) { if (!(error instanceof AcknowledgementTailRequired)) throw error; }
    }
    const tail = await logTail(options, revision);
    if (tail && committed.some(entry => tail.accepted.result.seq < (entry.response as { seq: number }).seq))
      throw new OfflineAuthorityError("delivery log predates the replay terminal");
    return settleEntries(options, entries, tail, revision);
  }
  return settleEntries(options, entries, undefined, revision);
}

function settlement(result: DrainResult): OutboxSettlement {
  return { stopped: result.reason ?? false, remaining: result.remaining };
}

async function followerSettlement(runtime: OfflineRuntime, inbox: FollowerInbox | undefined, offline: boolean, check = () => {}): Promise<OutboxSettlement> {
  const queuedEntries = (await runtime.itemEntries()).filter((entry) => entry.state === "queued" && inboxKeyOf(entry.intent) === undefined).length;
  check();
  const remaining = runtime.inboxPending + queuedEntries;
  if (remaining === 0) return { stopped: false, remaining };
  const status = await inbox?.status();
  check();
  if (status?.reason === "writer-unresponsive") return { stopped: "writer-unresponsive", remaining };
  const writer = inbox?.writer;
  if (writer?.fence === "past") return { stopped: "fence", remaining };
  return { stopped: offline ? "offline" : "pending", remaining };
}

async function settleEntries(
  options: DrainOptions,
  entries: OutboxEntry[],
  tail?: { op: string; args: unknown; accepted: AcceptedDelivery<unknown>; deliveryOrder: number },
  revision = options.runtime.coverageRevision,
  acknowledgementOnly = false,
): Promise<boolean> {
  try {
    throwIfAborted(options.signal);
    const superseded = await options.runtime.commitMany(tail ? [tail] : [], undefined,
      { put: entries, ...(acknowledgementOnly ? { acknowledgementOnly: true as const } : {}) }, revision,
      () => !options.signal?.aborted, undefined, tail?.deliveryOrder);
    throwIfAborted(options.signal);
    const current = !superseded && revision === options.runtime.coverageRevision;
    if (current) for (const entry of entries) recordTerminal(options.runtime, entry);
    return current;
  } catch (error) {
    if (error instanceof AcknowledgementTailRequired) throw error;
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
  const deliveryOrder = runtime.beginDelivery();
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
  return { op: watermark.op, args, accepted, deliveryOrder };
}

/** The inbox role a follower's outbox API delegates to (LLP 1018.004 §§2–3). */
export interface FollowerInbox {
  status(): Promise<OutboxStatus>;
  subscribe(listener: () => void): () => void;
  dismiss(intent: string): Promise<OutboxEntry | undefined>;
  refresh(): Promise<void>;
  readonly writer: OutboxStatus | undefined;
}

export function createOutboxApi(
  runtime: OfflineRuntime | undefined,
  drain: () => Promise<DrainResult>,
  ready: () => Promise<void> = async () => undefined,
  offline: () => boolean = () => false,
  inbox?: FollowerInbox,
  identity: () => string = () => runtime?.principal ?? "",
  prepare?: (op: string) => RecoveryDemand,
  recovering: () => boolean = () => false,
  client?: {
    connection(): ConnectionState;
    subscribe(notify: () => void): () => void;
    scope(): AbortSignal;
    recoveryIdentity?(): string;
    online(check: () => void, current: () => void): Promise<void>;
  },
): OutboxApi {
  const entries = (): Promise<OutboxEntry[]> => runtime?.itemEntries() ?? Promise.resolve([]);
  const status = async (op?: import("./api.js").Op<any, any>): Promise<OutboxStatus> => {
    await ready().catch(() => undefined);
    if (runtime?.following) return inbox?.status()
      ?? { ready: false, reason: "follower", action: "other-tab", remaining: 0, fence: "inside" };
    if (!runtime || runtime.principal === undefined) return { ready: true, reason: "ready", action: "none", remaining: 0, fence: "inside" };
    try {
      const value = await runtime.outbox.status(op === undefined ? undefined : referenceName(op));
      return { ...value, ...(runtime.draining ? { draining: true as const } : {}), ...(recovering() ? { recovering: true as const } : {}) };
    }
    catch (error) {
      if (error instanceof Error && /sealed/.test(error.message)) return { ready: false, reason: "sealed", action: "sign-in", remaining: 0, fence: "past" };
      throw error;
    }
  };
  // A recovery waiter checks its captured lifecycle after every suspension,
  // before reading another mutable partition fact. Ordinary settled keeps its contract.
  const settled = async (check = () => {}): Promise<OutboxSettlement> => {
    check(); await ready(); check();
    if (runtime?.following) {
      await inbox?.refresh(); check();
      return followerSettlement(runtime, inbox, offline(), check);
    }
    await runtime?.drainTail; check();
    if (!runtime || runtime.principal === undefined) return { stopped: false, remaining: 0 };
    const result = await runtime.drainVerdict; check();
    let remaining: number;
    try { remaining = (await runtime.outbox.status()).remaining; }
    catch (error) {
      check();
      if (error instanceof Error && /sealed|not open|closed/.test(error.message)) throw new RefusalError({
        code: "E_OFFLINE_LIFECYCLE", family: "offline", guide: "offline", site: "client.outbox.settled",
        message: "outbox settlement is unavailable while this partition is sealed or closed",
        rewrite: "authenticate the same account or reopen the client; queued writes are kept",
      });
      throw error;
    }
    check();
    if (remaining === 0) return { stopped: false, remaining };
    const fence = await runtime.outbox.fence(); check();
    if (fence === "past") return { stopped: "fence", remaining };
    return { stopped: offline() ? "offline" : result.stopped || "pending", remaining };
  };
  return {
    entries,
    status,
    observe: observeOutbox(entries, status, notify => {
      const stop = runtime?.outbox.subscribe(notify), stopInbox = inbox?.subscribe(notify), stopClient = client?.subscribe(notify);
      return () => { stop?.(); stopInbox?.(); stopClient?.(); };
    }, identity, () => (runtime?.following ? inbox?.writer : undefined), prepare, client?.connection),
    recover: () => client ? recoverOutbox({ ready, identity: client.recoveryIdentity ?? identity, scope: client.scope, online: client.online, settled })
      : Promise.resolve({ refusal: recoveryLifecycle().envelope }),
    // @ref LLP 1018.004#2-the-inbox — a follower's dismissal is a durable command row the writer consumes.
    dismiss: async (intent) => {
      const entry = (runtime?.following || runtime?.principal !== undefined) && inbox ? await inbox.dismiss(intent)
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
    settled: () => settled(),
  };
}
