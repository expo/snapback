// @ref LLP 1012#8-the-delivery-envelope-the-validator-and-resume — offline transport coordination is isolated from auth custody and asset methods.
import { throwIfAborted } from "./client-wire.js";
import { drainOutbox } from "./client-outbox.js";
import { DrainSubscription } from "./drain.js";
import { DeliveryEnvelopeDecodeError } from "./offline-protocol.js";
import {
  SnapbackRefusal,
  copyRefusal,
  isSnapbackRefusal,
  isTerminalSession,
  sseObject,
  wireQuery,
  wireSubscription,
} from "./client-wire.js";
import {
  OfflineRuntime,
  offlineView,
  type AcceptedDelivery,
  type MountedQuery,
  type ResumeAdjustment,
} from "./offline.js";
import {
  stableSerialize,
  type OfflineClientOptions,
  type LiveQueryDelivery,
  type QueryResult,
  type QueryRefusedDelivery,
  type RefusalEnvelope,
  type SnapbackClient,
  type Subscription,
  type SubscriptionDelivery,
} from "./types.js";
import type { Op } from "./api.js";

export function validateOfflineOptions(options: OfflineClientOptions | undefined): void {
  if (options === undefined) return;
  if (!options || typeof options !== "object" || typeof options.store !== "function") {
    throw new TypeError("createClient offline.store must be a carrier factory");
  }
  if (options.fenceDays !== undefined
    && (!Number.isInteger(options.fenceDays) || options.fenceDays < 1 || options.fenceDays > 30)) {
    throw new TypeError("createClient offline.fenceDays must be an integer from 1 through 30");
  }
  if (options.maxAssetBytes !== undefined
    && (!Number.isSafeInteger(options.maxAssetBytes) || options.maxAssetBytes < 1)) {
    throw new TypeError("createClient offline.maxAssetBytes must be a positive safe integer");
  }
}

export function createOfflineRuntime(options: OfflineClientOptions | undefined): OfflineRuntime | undefined {
  validateOfflineOptions(options);
  return options ? new OfflineRuntime(options) : undefined;
}

export function offlineRefusal(error: unknown, carrier: string, site = "client.offline"): SnapbackRefusal {
  if (isSnapbackRefusal(error)) return error;
  const candidate = error && typeof error === "object" ? (error as { code?: unknown }).code : undefined;
  if (candidate === "E_OFFLINE_ID_BLOCK") {
    const local = error as { message: string; site?: string; rewrite?: string };
    return new SnapbackRefusal({
      code: candidate,
      family: "offline",
      message: local.message,
      site: local.site ?? "client.outbox.enqueue",
      rewrite: local.rewrite ?? "resume online for a fresh grant, then enqueue a new intent",
      guide: "offline",
    });
  }
  if (candidate === "E_OFFLINE_AUTHORITY") {
    return new SnapbackRefusal({
      code: candidate,
      family: "offline",
      message: error instanceof Error ? error.message : String(error),
      site: "RangeStore.commit",
      rewrite: "keep the held coverage; a delivery for another principal or auth epoch is refused, not committed — open the partition it belongs to (another generation is not refused: it supersedes the held coverage until the next resume resets it)",
      guide: "offline",
    });
  }
  const message = error instanceof Error ? error.message : String(error);
  const supplied = error as { site?: string; rewrite?: string } | undefined;
  const lifecycle = /sealed|not open|closed|partition must be/.test(message);
  const corrupt = error instanceof SyntaxError || /unsupported format|corrupt|persisted state/.test(message);
  const delivery = /conflicting (deliveries|row)|conditional validator|store (delivery|receipt|resume)/.test(message);
  const code = lifecycle ? "E_OFFLINE_LIFECYCLE" : corrupt ? "E_OFFLINE_STATE" : delivery ? "E_OFFLINE_DELIVERY"
    : candidate === "E_OFFLINE_LOCK" || candidate === "E_OFFLINE_CARRIER" ? candidate
    : site === "RangeStore.open" ? "E_OFFLINE_CARRIER" : "E_OFFLINE_STATE";
  const rewrite = supplied?.rewrite ?? (lifecycle
    ? "authenticate the same account to unseal its data, or reopen the client if it is closed; queued writes are kept"
    : corrupt ? "preserve this partition for recovery; inspect its persisted state before resetting it, since a reset discards queued writes"
    : delivery ? "keep the current coverage and retry an authenticated query; inspect the delivery consistency error if it repeats"
    : code === "E_OFFLINE_LOCK" ? (carrier === "SQLite" ? "this account is open in another client; close it and try again" : "this account is open in another tab")
    : code === "E_OFFLINE_CARRIER" ? `install or configure the ${carrier} carrier`
    : "retry this local operation; preserve queued writes and inspect the reported state error if it repeats");
  return new SnapbackRefusal({
    code, family: "offline", message, site: supplied?.site ?? site, rewrite, guide: "offline",
  });
}

export function offlineNetworkRefusal(): SnapbackRefusal {
  return new SnapbackRefusal({
    code: "E_NETWORK",
    family: "owner",
    message: "client transport is offline",
    rewrite: "call client.online() to restore this device transport",
    guide: "offline",
  }, true);
}

export async function acceptOffline<Result>(
  runtime: OfflineRuntime | undefined,
  op: string,
  args: unknown,
  raw: unknown,
  shape: (message: string) => Error,
): Promise<AcceptedDelivery<Result>> {
  if (!runtime) return { result: raw as AcceptedDelivery<Result>["result"] };
  try {
    return await runtime.accept<Result>(op, args, raw);
  } catch (error) {
    if (error instanceof DeliveryEnvelopeDecodeError) throw shape(error.message);
    throw error;
  }
}

export async function commitOffline(
  runtime: OfflineRuntime | undefined,
  op: string,
  args: unknown,
  accepted: AcceptedDelivery<unknown>,
  failure: (error: unknown) => Error,
  revision?: number,
  current?: () => boolean,
): Promise<boolean> {
  if (!runtime) return false;
  try { return await runtime.commit(op, args, accepted, revision, current); }
  catch (error) { throw failure(error); }
}

export async function decodeOfflineSubscription<Result>(options: {
  runtime: OfflineRuntime;
  op: string;
  args: unknown;
  data: string;
  shape(message: string): Error;
  failure(error: unknown): Error;
  observe?(): Promise<void>;
  revision?: number;
  current?: () => boolean;
  superseded?(): void;
}): Promise<LiveQueryDelivery<Result> | QueryRefusedDelivery> {
  const raw = sseObject(options.data, "subscription delivery");
  const accepted = await acceptOffline<Result>(options.runtime, options.op, options.args, raw, options.shape);
  const value = accepted.envelope || accepted.refresh
    ? { ...wireQuery<Result>(accepted.result, "subscription delivery"), live: true as const }
    : wireSubscription<Result>(options.data);
  if (value.state !== "refused") {
    const superseded = await commitOffline(options.runtime, options.op, options.args, accepted, options.failure, options.revision, options.current);
    if (superseded) options.superseded?.();
    if (!options.current || options.current()) await options.observe?.();
  }
  return value;
}

export function settleSubscription<Result>(
  value: LiveQueryDelivery<Result> | QueryRefusedDelivery,
  ensureAuthority: () => void,
  patch: (value: { connection: "connected"; lastRefusal: RefusalEnvelope | undefined }) => void,
): { seq: number; data?: Result } | undefined {
  if (value.state === "refused" && isTerminalSession(value)) {
    throw new SnapbackRefusal(copyRefusal(value));
  }
  ensureAuthority();
  patch({
    connection: "connected",
    lastRefusal: value.state === "refused" ? copyRefusal(value) : undefined,
  });
  return value.state === "refused"
    ? undefined
    : "data" in value ? { seq: value.seq, data: value.data } : { seq: value.seq };
}

// @ref LLP 1012#6-reads-offline — the twin is the client: a read with the
// backend unreachable runs the certified program over coverage; a retained
// answer (§5 rule 4) is served as held, since its rows are what the swap kept.
export async function answerOffline<Result>(
  runtime: OfflineRuntime | undefined,
  op: string,
  args: unknown,
  failure: (error: unknown) => Error,
  drain = false,
): Promise<QueryResult<Result>> {
  try {
    if (drain) runtime?.drainCursor(op);
    const held = await runtime?.answer<Result>(op, args);
    const local = held?.retained ? undefined : await runtime?.evaluate(op, args);
    return offlineView(held, local) as QueryResult<Result>;
  } catch (error) {
    throw failure(error);
  }
}

export function createOfflineDrain<Args, Result>(options: {
  ref: Op<Args, Result>;
  op: string;
  args: Args;
  callback: (delivery: SubscriptionDelivery<Result>) => void;
  runtime: OfflineRuntime | undefined;
  /** Settles once the manifest was loaded or could not be: the cursor argument's name is known after it. */
  ready?: Promise<void>;
  cursor(): Promise<string> | string;
  mounted: Map<string, MountedQuery>;
  query(pageArgs: Args): Promise<QueryResult<Result>>;
  subscribe(tailArgs: Args, callback: (delivery: SubscriptionDelivery<Result>) => void): Subscription<SubscriptionDelivery<Result>>;
  track(subscription: Subscription<SubscriptionDelivery<Result>>): Subscription<SubscriptionDelivery<Result>>;
  observe?(): Promise<void>;
  /** Performs a resume; a drained log that holds no replay grant asks for one here. */
  resume?(): Promise<void>;
}): Subscription<SubscriptionDelivery<Result>> {
  const key = `${options.op}\u0000drain\u0000${stableSerialize(options.args)}`;

  const draining = new DrainSubscription<Args, Result>({
    args: options.args,
    query: options.query,
    subscribe: options.subscribe,
    // The cursor argument is named by the manifest's op descriptor (`c` until it is loaded).
    cursor: async () => {
      await options.ready?.catch(() => undefined);
      return options.cursor();
    },
    mark: async (watermark, current, offline) => {
      // A follower tab pages and tails live; the writer tab owns the watermark and the grant.
      if (!options.runtime || offline || options.runtime.following) return;
      options.runtime.drainCursor(options.op);
      const revision = options.runtime.coverageRevision;
      const tailArgs = { ...(options.args as Record<string, unknown>), [options.runtime.cursorArg(options.op)]: watermark };
      const held = await options.runtime.answer(options.op, tailArgs);
      if (!current()) return;
      await options.runtime.markWatermark(options.op, options.args, watermark, held?.validator, revision);
      if (!current()) return;
      await options.observe?.();
      // @ref LLP 1012#7-writes-offline — the recipe's drain is where a device
      // earns its first grant, so a send after going offline has ids to pin.
      if (options.resume && !(await options.runtime.outbox.grant())) {
        await options.resume().catch(error => {
          // A different drain's refusal does not invalidate this admitted log.
          if (isSnapbackRefusal(error) && error.envelope.reason === "unsupported-log" && error.envelope.op !== options.op) return;
          throw error;
        });
      }
    },
    onEvent: options.callback,
  });
  const record: MountedQuery = { op: options.op, args: options.args, drain: true, refuse: envelope => draining.refuse(envelope) };
  options.mounted.set(key, record);
  const tracked = options.track(draining);
  const close = tracked.close.bind(tracked);
  tracked.close = () => {
    if (options.mounted.get(key) === record) options.mounted.delete(key);
    close();
  };
  return tracked;
}

export async function goOffline(options: {
  ready: Promise<void>;
  ensureOpen(): void;
  force(value: boolean): void;
  connection(value: "offline" | "reconnecting"): void;
  reconnect(): void;
}): Promise<void> {
  options.ensureOpen();
  options.force(true);
  await options.ready;
  options.ensureOpen();
  options.connection("offline");
  options.reconnect();
}

export async function goOnline<Authority>(options: {
  ready: Promise<void>;
  ensureOpen(): void;
  force(value: boolean): void;
  connection(value: "offline" | "reconnecting"): void;
  authority(): Promise<Authority>;
  resume(authority: Authority): Promise<void>;
  setResume(run: Promise<void>): void;
  reconnect(): void;
}): Promise<void> {
  await options.ready;
  options.ensureOpen();
  options.force(false);
  options.connection("reconnecting");
  const authority = await options.authority();
  const run = options.resume(authority);
  options.setResume(run.then(() => undefined, () => undefined));
  try {
    await run;
  } finally {
    // A rejected resume or drain must not leave the transport closed.
    options.reconnect();
  }
}

export async function restartOffline(options: {
  ready: Promise<void>;
  ensureOpen(): void;
  forced(): boolean;
  shutdown(): Promise<void>;
  create(): SnapbackClient;
}): Promise<SnapbackClient> {
  await options.ready;
  options.ensureOpen();
  const stayedOffline = options.forced();
  await options.shutdown();
  const restarted = options.create();
  await restarted.ready;
  if (stayedOffline) await restarted.offline();
  return restarted;
}

type RefusalLike = Error & {
  code?: string;
  status?: number;
  envelope?: RefusalEnvelope;
};

function refusal(error: unknown): RefusalLike | undefined {
  return error instanceof Error && typeof (error as RefusalLike).code === "string"
    ? error as RefusalLike : undefined;
}

function record(value: unknown, surface: string, shape: (message: string) => Error): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw shape(`${surface} must be an object`);
  return value as Record<string, unknown>;
}

function resumeAdjustment(error: RefusalLike): ResumeAdjustment | undefined {
  const value = error.envelope;
  return value?.reason === "limit" && value.which === "mounted" && Number.isSafeInteger(value.cap)
    && Number(value.cap) >= 0 && Number(value.cap) < 32 ? { cap: Number(value.cap) } : undefined;
}

export function refuseDrains(mounted: Map<string, MountedQuery>, envelope: RefusalEnvelope): void {
  if (envelope.code !== "E_OFFLINE_RESUME" || (envelope.which !== "log" && envelope.reason !== "unsupported-log")) return;
  for (const query of mounted.values()) if (query.drain && query.op === envelope.op) query.refuse?.(envelope);
}

export async function performOfflineResume<Authority>(options: {
  signal?: AbortSignal;
  runtime: OfflineRuntime | undefined;
  mounted: Map<string, MountedQuery>;
  authority: Authority;
  bearerConfirmed: boolean;
  json(path: string, init: RequestInit, authority: Authority): Promise<unknown>;
  validated(authority: Authority): void;
  shape(message: string): Error;
  failure?(error: unknown): Error;
  subscriptions: Iterable<Subscription<unknown>>;
  /** Re-fetches `/api/program` for the live generation after `E_OFFLINE_RESET`. */
  reload?(authority: Authority): Promise<void>;
}, adjustment: ResumeAdjustment = {}, retry = true): Promise<boolean> {
  const check = () => throwIfAborted(options.signal);
  check();
  if (!options.runtime) return false;
  const revision = options.runtime.coverageRevision;
  const generation = options.runtime.outbox.generation;
  let request = await options.runtime.resumeRequest([...options.mounted.values()], adjustment);
  check();
  if (!request) {
    // @ref LLP 1012#7-writes-offline — no resume can be built without facts (a
    // login grant with nothing delivered yet), but the queue must never sit:
    // inside the fence the held grant replays it directly. Past the fence a
    // login grant may precede every delivery: earn real authority facts
    // through a named query, then use the owner's supported logless resume;
    // metadata or a fresh consumption grant alone never opens the fence.
    if ((await options.runtime.queuedIntents()).length === 0) return false;
    check();
    if (await options.runtime.outbox.fence() === "inside") {
      check();
      await drainOutbox(drainOptions(options));
      check();
      return false;
    }
    check();
    const seed = await options.runtime.resumeSeed([...options.mounted.values()]);
    check();
    if (!seed) throw resumeUnavailable("no query with known arguments can establish resume facts");
    const raw = await options.json("/api/query?receipt=1", {
      method: "POST", body: JSON.stringify({ op: seed.op, args: seed.args }), signal: options.signal,
    }, options.authority);
    check();
    const accepted = await acceptOffline(options.runtime, seed.op, seed.args, raw, options.shape);
    check();
    wireQuery(accepted.result);
    await commitOffline(options.runtime, seed.op, seed.args, accepted, options.failure ?? ((error) => error as Error),
      revision, () => !options.signal?.aborted);
    check();
    request = await options.runtime.resumeRequest([...options.mounted.values()], adjustment);
    check();
    if (!request) throw resumeUnavailable("the owner query did not deliver the facts required for resume");
  }
  const rebuild = async () => {
    check();
    await options.reload?.(options.authority);
    check();
    // A 409 authenticated request.authEpoch before checking the program; a
    // successful probe below verifies the same epoch explicitly.
    await options.runtime!.resetCoverage(request.authEpoch, options.signal);
    check();
    for (const subscription of [...options.subscriptions]) {
      (subscription as Subscription<unknown> & { reset?: () => void }).reset?.();
    }
    return true;
  };
  let value: unknown;
  try {
    value = await options.json("/api/resume", { method: "POST", body: JSON.stringify(request), signal: options.signal }, options.authority);
    check();
  } catch (error) {
    check();
    const candidate = refusal(error);
    if (candidate?.code === "E_OFFLINE_RESET") return rebuild();
    if (candidate?.status === 404) {
      if ((await options.runtime.queuedIntents()).length > 0) throw error;
      return false;
    }
    if (candidate?.code === "E_OFFLINE_RESUME") {
      const next = resumeAdjustment(candidate);
      if (retry && next && next.cap! < request.mounted.length) return performOfflineResume(options, next, false);
      if (candidate.envelope) refuseDrains(options.mounted, { ...candidate.envelope, op: candidate.envelope.op ?? request.log?.op });
    }
    throw error;
  }
  const response = record(value, "resume response", options.shape);
  if (response.generation !== request.generation || response.schemaHash !== request.schemaHash) {
    throw options.shape("resume response generation does not match the request");
  }
  const authority = record(response.authority, "resume response.authority", options.shape);
  if (authority.principal !== options.runtime.principal || authority.authEpoch !== request.authEpoch) {
    throw options.shape("resume response authority does not match the open partition");
  }
  if (!Array.isArray(response.mounted)) throw options.shape("resume response.mounted must be an array");
  if (request.log && (!response.log || typeof response.log !== "object" || Array.isArray(response.log))) {
    throw options.shape("resume response omitted the requested log");
  }
  // A cold reopen mid-rebuild can already name the current program. A 200
  // authenticates it, but the durable marker still requires the cold rebuild.
  if (options.runtime.resetNeeded) return rebuild();
  if (options.bearerConfirmed) await options.runtime.reauthenticate(authority.principal as string);
  check();
  const swaps: Array<{ op: string; args: unknown; accepted: AcceptedDelivery<unknown> }> = [];
  let watermark: { op: string; args: unknown; watermark: string | null; validator?: string } | undefined;
  if (response.log && typeof response.log === "object" && !Array.isArray(response.log)
    && (response.log as Record<string, unknown>).unchanged !== true && request.log) {
    const { watermark: returned, ...delivery } = response.log as Record<string, unknown>;
    if (returned !== null && typeof returned !== "string") throw options.shape("resume response.log.watermark must be a string or null");
    // The server answers the log as the page after `watermark` (writer_resume log_args), so
    // it is held under that cursor's args; filing it under the base args would replace the
    // drained first page with the tail — an empty one after a restart (LLP 1012 §8). The
    // cursor argument is the owner's returned-page binding, whatever its name.
    const tailArgs = request.log.watermark === null
      ? request.log.args
      : { ...(request.log.args as Record<string, unknown>), [options.runtime.cursorArg(request.log.op)]: request.log.watermark };
    const accepted = await acceptOffline(options.runtime, request.log.op, tailArgs, delivery, options.shape);
    check();
    swaps.push({ op: request.log.op, args: tailArgs, accepted });
    watermark = {
      op: request.log.op,
      args: request.log.args,
      watermark: returned as string | null,
      ...(accepted.envelope?.validator === undefined ? {} : { validator: accepted.envelope.validator }),
    };
  }
  for (const [index, item] of response.mounted.entries()) {
    if (item && typeof item === "object" && !Array.isArray(item)
      && (item as Record<string, unknown>).unchanged === true) continue;
    const requested = request.mounted[index];
    if (!requested) throw options.shape("resume response returned an unrequested mounted query");
    swaps.push({
      op: requested.op,
      args: requested.args,
      accepted: await acceptOffline(options.runtime, requested.op, requested.args, item, options.shape),
    });
    check();
  }
  if (!Number.isSafeInteger(response.seq) || Number(response.seq) < 0) {
    throw options.shape("resume response.seq must be a non-negative safe integer");
  }
  await options.runtime.commitMany(swaps, watermark, undefined, revision, () => !options.signal?.aborted, Number(response.seq));
  check();
  options.validated(options.authority);
  // @ref LLP 1012#7-writes-offline — a resume may omit a replacement grant;
  // successful re-authorization itself renews trust, then replay is FIFO.
  options.runtime.noteGrant(response);
  try {
    await options.runtime.adoptPendingGrant();
    check();
  } catch (error) {
    throw options.failure ? options.failure(error) : error;
  }
  if (!options.runtime.outbox.resumeSucceeded(generation)) return false;
  await drainOutbox(drainOptions(options));
  check();
  return false;
}

function resumeUnavailable(message: string): SnapbackRefusal {
  return new SnapbackRefusal({
    code: "E_OFFLINE_RESUME", family: "offline", message,
    site: "client.online.resume", guide: "offline",
    rewrite: "query an authorized operation online with receipt support, then call online() again; queued writes are kept",
  });
}

function drainOptions<Authority>(options: {
  signal?: AbortSignal;
  runtime: OfflineRuntime | undefined;
  authority: Authority;
  json(path: string, init: RequestInit, authority: Authority): Promise<unknown>;
  shape(message: string): Error;
  failure?(error: unknown): Error;
}): Parameters<typeof drainOutbox>[0] {
  return {
    runtime: options.runtime!,
    signal: options.signal,
    json: (path, init) => options.json(path, init, options.authority),
    shape: options.shape,
    failure: options.failure ?? ((error) => (error instanceof Error ? error : new Error(String(error)))),
  };
}
