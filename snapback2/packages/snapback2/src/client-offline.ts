// @ref LLP 1012#8-the-delivery-envelope-the-validator-and-resume — offline transport coordination is isolated from auth custody and asset methods.
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
  if (options.viewOnce !== undefined && typeof options.viewOnce !== "function") {
    throw new TypeError("createClient offline.viewOnce must be a (table, row) => boolean predicate");
  }
}

export function createOfflineRuntime(options: OfflineClientOptions | undefined): OfflineRuntime | undefined {
  validateOfflineOptions(options);
  return options ? new OfflineRuntime(options) : undefined;
}

export function offlineRefusal(error: unknown, carrier: string): SnapbackRefusal {
  if (isSnapbackRefusal(error)) return error;
  const candidate = error && typeof error === "object" ? (error as { code?: unknown }).code : undefined;
  if (candidate === "E_OFFLINE_ID_BLOCK" || candidate === "E_OFFLINE_INTENT_EXPIRED") {
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
  const code = candidate === "E_OFFLINE_LOCK" || candidate === "E_OFFLINE_CARRIER" ? candidate : "E_OFFLINE_CARRIER";
  const rewrite = code === "E_OFFLINE_LOCK"
    ? "this account is open in another tab"
    : `install or configure the ${carrier} carrier`;
  return new SnapbackRefusal({
    code,
    family: "offline",
    message: error instanceof Error ? error.message : String(error),
    site: "RangeStore.open",
    rewrite,
    guide: "offline",
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
): Promise<boolean> {
  if (!runtime) return false;
  try { return await runtime.commit(op, args, accepted, revision); }
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
  superseded?(): void;
}): Promise<LiveQueryDelivery<Result> | QueryRefusedDelivery> {
  const raw = sseObject(options.data, "subscription delivery");
  const accepted = await acceptOffline<Result>(options.runtime, options.op, options.args, raw, options.shape);
  const value = accepted.envelope || accepted.refresh
    ? { ...wireQuery<Result>(accepted.result, "subscription delivery"), live: true as const }
    : wireSubscription<Result>(options.data);
  if (value.state !== "refused") {
    const superseded = await commitOffline(options.runtime, options.op, options.args, accepted, options.failure, options.revision);
    if (superseded) options.superseded?.();
    await options.observe?.();
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
): Promise<QueryResult<Result>> {
  try {
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
  mounted: Map<string, MountedQuery>;
  query(pageArgs: Args): Promise<QueryResult<Result>>;
  subscribe(tailArgs: Args, callback: (delivery: SubscriptionDelivery<Result>) => void): Subscription<SubscriptionDelivery<Result>>;
  track(subscription: Subscription<SubscriptionDelivery<Result>>): Subscription<SubscriptionDelivery<Result>>;
  observe?(): Promise<void>;
  /** Performs a resume; a drained log that holds no replay grant asks for one here. */
  resume?(): Promise<void>;
}): Subscription<SubscriptionDelivery<Result>> {
  const key = `${options.op}\u0000${stableSerialize(options.args)}`;
  options.mounted.set(key, { op: options.op, args: options.args, drain: true });
  const draining = new DrainSubscription<Args, Result>({
    args: options.args,
    query: options.query,
    subscribe: options.subscribe,
    // The cursor argument is named by the manifest's op descriptor (`c` until it is loaded).
    cursor: async () => {
      await options.ready?.catch(() => undefined);
      return options.runtime?.cursorArg(options.op) ?? "c";
    },
    mark: async (watermark, current) => {
      if (!options.runtime) return;
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
        await options.resume().catch(() => undefined);
      }
    },
    onEvent: options.callback,
  });
  const tracked = options.track(draining);
  const close = tracked.close.bind(tracked);
  tracked.close = () => {
    options.mounted.delete(key);
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
  await options.ready;
  options.ensureOpen();
  options.force(true);
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

export async function initializeOfflineClient<Principal, Authority>(options: {
  principal?: Principal;
  bearer: boolean;
  authority: Authority;
  open(principal: Principal, authenticated?: boolean): Promise<void>;
  confirm(authority: Authority): Promise<Principal>;
  metadata(authority: Authority): Promise<void>;
  resume(authority: Authority): Promise<void>;
  ignore(error: unknown): boolean;
}): Promise<void> {
  let principal = options.principal;
  if (principal) await options.open(principal);
  try {
    if (options.bearer) {
      principal = await options.confirm(options.authority);
      await options.open(principal, true);
    }
    if (!principal) return;
    await options.metadata(options.authority);
    await options.resume(options.authority);
  } catch (error) {
    if (!options.ignore(error)) throw error;
  }
}

type RefusalLike = Error & {
  code?: string;
  status?: number;
  envelope?: { which?: unknown; cap?: unknown };
};

function refusal(error: unknown): RefusalLike | undefined {
  return error instanceof Error && typeof (error as RefusalLike).code === "string"
    ? error as RefusalLike : undefined;
}

function record(value: unknown, surface: string, shape: (message: string) => Error): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw shape(`${surface} must be an object`);
  return value as Record<string, unknown>;
}

function resumeAdjustment(error: RefusalLike): ResumeAdjustment {
  const which = typeof error.envelope?.which === "string" ? error.envelope.which : undefined;
  const cap = Number.isSafeInteger(error.envelope?.cap) && Number(error.envelope?.cap) >= 0
    ? Number(error.envelope?.cap) : undefined;
  return { ...(which === undefined ? {} : { which }), ...(cap === undefined ? {} : { cap }) };
}

export async function performOfflineResume<Authority>(options: {
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
}, adjustment: ResumeAdjustment = {}, retry = true): Promise<void> {
  if (!options.runtime) return;
  const request = await options.runtime.resumeRequest([...options.mounted.values()], adjustment);
  if (!request) {
    // @ref LLP 1012#7-writes-offline — no resume can be built without facts (a
    // login grant with nothing delivered yet), but the queue must never sit:
    // the held grant replays it directly, and a missing grant settles loudly.
    if ((await options.runtime.queuedIntents()).length > 0) await drainOutbox(drainOptions(options));
    return;
  }
  const standIn = request.log !== undefined && options.runtime.standInLog(request.log);
  let value: unknown;
  try {
    value = await options.json("/api/resume", { method: "POST", body: JSON.stringify(request) }, options.authority);
  } catch (error) {
    const candidate = refusal(error);
    if (candidate?.code === "E_OFFLINE_RESET") {
      // @ref LLP 1012#8-the-delivery-envelope-the-validator-and-resume — drop
      // coverage, keep the sealed outbox, fetch the live generation's program
      // (the twin and the write bounds re-price from it), then drain and
      // cold-drain: the queue never waits on the next write.
      // Keep the durable reset marker until metadata succeeds, so a failed
      // reload is actually retried on the next online opportunity.
      await options.reload?.(options.authority);
      options.validated(options.authority);
      await options.runtime.resetCoverage();
      for (const subscription of [...options.subscriptions]) {
        (subscription as Subscription<unknown> & { reset?: () => void }).reset?.();
      }
      if ((await options.runtime.queuedIntents()).length > 0) await drainOutbox(drainOptions(options));
      return;
    }
    if (candidate?.status === 404) return;
    if (candidate?.code === "E_OFFLINE_RESUME" && retry) {
      return performOfflineResume(options, resumeAdjustment(candidate), false);
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
  if (options.bearerConfirmed) await options.runtime.reauthenticate(authority.principal as string);
  if (!Array.isArray(response.mounted)) throw options.shape("resume response.mounted must be an array");
  const swaps: Array<{ op: string; args: unknown; accepted: AcceptedDelivery<unknown> }> = [];
  let watermark: { op: string; args: unknown; watermark: string | null; validator?: string } | undefined;
  if (response.log && typeof response.log === "object" && !Array.isArray(response.log)
    && (response.log as Record<string, unknown>).unchanged !== true && request.log) {
    const { watermark: returned, ...delivery } = response.log as Record<string, unknown>;
    if (returned !== null && typeof returned !== "string") throw options.shape("resume response.log.watermark must be a string or null");
    // The server answers the log as the page after `watermark` (writer_resume log_args), so
    // it is held under that cursor's args; filing it under the base args would replace the
    // drained first page with the tail — an empty one after a restart (LLP 1012 §8). The
    // cursor argument is the one the manifest types `Cursor`, whatever its name.
    const tailArgs = request.log.watermark === null
      ? request.log.args
      : { ...(request.log.args as Record<string, unknown>), [options.runtime.cursorArg(request.log.op)]: request.log.watermark };
    const accepted = await acceptOffline(options.runtime, request.log.op, tailArgs, delivery, options.shape);
    swaps.push({ op: request.log.op, args: tailArgs, accepted });
    // A stand-in log (no drained query held) borrows an ordinary answer; it
    // must not leave a watermark behind and turn that answer into a drain.
    if (!standIn) watermark = {
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
  }
  await options.runtime.commitMany(swaps, watermark);
  options.validated(options.authority);
  // @ref LLP 1012#7-writes-offline — every successful resume returns a grant,
  // and the outbox replays FIFO right after it.
  options.runtime.noteGrant(response);
  try {
    await options.runtime.adoptPendingGrant();
  } catch (error) {
    throw options.failure ? options.failure(error) : error;
  }
  await drainOutbox(drainOptions(options));
}

function drainOptions<Authority>(options: {
  runtime: OfflineRuntime | undefined;
  authority: Authority;
  json(path: string, init: RequestInit, authority: Authority): Promise<unknown>;
  shape(message: string): Error;
  failure?(error: unknown): Error;
}): Parameters<typeof drainOutbox>[0] {
  return {
    runtime: options.runtime!,
    json: (path, init) => options.json(path, init, options.authority),
    shape: options.shape,
    failure: options.failure ?? ((error) => (error instanceof Error ? error : new Error(String(error)))),
  };
}
