import { isLocalCursor } from "./local-cursor.js";
import { emptyItemInputs, itemInputs, withItemInputs } from "./query-frame.js";
import { FullRevalidationRequired } from './store/fact-integrity.js';
// @ref LLP 1012#8-the-delivery-envelope-the-validator-and-resume — offline transport coordination is isolated from auth custody and asset methods.
import { throwIfAborted, withAbort, wireShape } from "./client-wire.js";
import type { Authority as ClientAuthority } from "./client-upload.js";
import { drainOutbox } from "./client-outbox.js";
import { DrainSubscription } from "./drain.js";
import { DeliveryEnvelopeDecodeError } from "./offline-protocol.js";
import {
  RefusalError,
  copyRefusal,
  isRefusalError,
  isTerminalSession,
  sseObject,
  wireQuery,
  wireAuthMe,
  wireSubscription,
} from "./client-wire.js";
import {
  OfflineRuntime,
  offlineView,
  type AcceptedDelivery,
  type MountedQuery,
  type ResumeAdjustment,
  type ResumeRequestV1,
} from "./offline.js";
import {
  stableSerialize,
  type OfflineClientOptions,
  type LiveQueryDelivery,
  type QueryResult,
  type QueryRefusedDelivery,
  type Refusal,
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

export function offlineRefusal(error: unknown, carrier: string, site = "client.offline"): RefusalError {
  if (isRefusalError(error)) return error;
  const candidate = error && typeof error === "object" ? (error as { code?: unknown }).code : undefined;
  if (candidate === "E_OFFLINE_ID_BLOCK") {
    const local = error as { message: string; site?: string; rewrite?: string };
    return new RefusalError({
      code: candidate,
      family: "offline",
      message: local.message,
      site: local.site ?? "client.outbox.enqueue",
      rewrite: local.rewrite ?? "resume online for a fresh grant, then enqueue a new intent",
      guide: "offline",
    });
  }
  if (candidate === "E_OFFLINE_AUTHORITY") {
    return new RefusalError({
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
  const delivery = FullRevalidationRequired.is(error) || /conflicting (deliveries|row|durable fact)|conditional validator|store (delivery|receipt|resume)/.test(message);
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
  return new RefusalError({
    code, family: "offline", message, site: supplied?.site ?? site, rewrite, guide: "offline",
  });
}

export function offlineNetworkRefusal(): RefusalError {
  return new RefusalError({
    code: "E_TRANSPORT",
    family: "transport",
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
  revalidate?: () => Promise<unknown>,
): Promise<AcceptedDelivery<Result>> {
  if (!runtime) return { result: raw as AcceptedDelivery<Result>["result"] };
  try {
    return await runtime.accept<Result>(op, args, raw, revalidate);
  } catch (error) {
    if (error instanceof DeliveryEnvelopeDecodeError) throw shape(error.message);
    if (FullRevalidationRequired.is(error)) throw offlineRefusal(error, '');
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
  deliveryOrder?: number,
): Promise<boolean> {
  if (!runtime) return false;
  try { return await runtime.commit(op, args, accepted, revision, current, deliveryOrder); }
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
  deliveryOrder?: number;
  superseded?(): void;
  revalidate?(): Promise<unknown>;
}): Promise<LiveQueryDelivery<Result> | QueryRefusedDelivery> {
  const raw = sseObject(options.data, "subscription delivery");
  const accepted = await acceptOffline<Result>(options.runtime, options.op, options.args, raw, options.shape, options.revalidate);
  const value = () => accepted.envelope || accepted.refresh
    ? { ...wireQuery<Result>(accepted.result, "subscription delivery"), live: true as const }
    : wireSubscription<Result>(options.data);
  if (value().state !== "refused") {
    const superseded = await commitOffline(options.runtime, options.op, options.args, accepted, options.failure,
      options.revision, options.current, options.deliveryOrder);
    if (superseded) options.superseded?.();
    if (!options.current || options.current()) await options.observe?.();
  }
  return options.runtime.withQueryItems(options.op, options.args, accepted, value());
}

export function settleSubscription<Result>(
  value: LiveQueryDelivery<Result> | QueryRefusedDelivery,
  ensureAuthority: () => void,
  patch: (value: { connection: "connected"; lastRefusal: Refusal | undefined }) => void,
): { seq: number; data?: Result } | undefined {
  if (value.state === "refused" && isTerminalSession(value)) {
    throw new RefusalError(copyRefusal(value));
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
    // A follower's drain was admitted from the manifest; its held custody names no cursor yet.
    if (drain && runtime && !runtime.following) runtime.drainCursor(op);
    const held = await runtime?.answer<Result>(op, args);
    const local = await runtime?.evaluate(op, args);
    // Drains own their page/tail continuation lifecycle; ordinary observed
    // pages may preserve one exact receipt-backed owner answer.
    const value = offlineView(held, local, !drain) as QueryResult<Result>;
    if (!itemInputs(value) && runtime?.principal !== undefined) {
      return withItemInputs(value, { ...emptyItemInputs, entries: await runtime.itemEntries() });
    }
    return value;
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
  offline(): boolean;
  mounted: Map<string, MountedQuery>;
  query(pageArgs: Args): Promise<QueryResult<Result> | QueryResult<Result>[]>;
  subscribe(tailArgs: Args, callback: (delivery: SubscriptionDelivery<Result>) => void): Subscription<SubscriptionDelivery<Result>>;
  track(subscription: Subscription<SubscriptionDelivery<Result>>): Subscription<SubscriptionDelivery<Result>>;
  observe?(): Promise<void>;
  /** Performs a resume; a drained log that holds no replay grant asks for one here. */
  resume?(): Promise<void>;
}): Subscription<SubscriptionDelivery<Result>> {
  const key = `${options.op}\u0000drain\u0000${stableSerialize(options.args)}`;

  const draining = new DrainSubscription<Args, Result>({
    args: options.args,
    offline: options.offline,
    query: options.query,
    subscribe: options.subscribe,
    // The cursor argument is named by the manifest's op descriptor (`c` until it is loaded).
    cursor: async () => {
      await options.ready?.catch(() => undefined);
      record.args = options.runtime?.serverArguments(options.op, options.args) ?? options.args;
      return options.cursor();
    },
    mark: async (watermark, current, offline) => {
      // A follower tab pages and tails live; the writer tab owns the watermark and the grant.
      if (!options.runtime || offline || options.runtime.following || isLocalCursor(watermark)) return;
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
          if (isRefusalError(error) && error.envelope.reason === "unsupported-log" && error.envelope.op !== options.op) return;
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
  envelope?: Refusal & Record<string, unknown>;
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

export function refuseDrains(mounted: Map<string, MountedQuery>, envelope: Refusal & { which?: unknown; op?: unknown }): void {
  if (envelope.code !== "E_OFFLINE_RESUME" || (envelope.which !== "log" && envelope.reason !== "unsupported-log")) return;
  for (const query of mounted.values()) if (query.drain && query.op === envelope.op) query.refuse?.(envelope);
}

export async function performOfflineResume<Authority>(options: {
  signal?: AbortSignal;
  demand?: string;
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
}, adjustment: ResumeAdjustment = {}, retry = true): Promise<boolean | "capacity"> {
  const check = () => throwIfAborted(options.signal);
  check();
  if (!options.runtime) return false;
  const grantPrincipal = options.runtime.principal;
  if (grantPrincipal === undefined) return false;
  const fullRead = (op: string, args: unknown) => () => options.json("/api/query?receipt=1", {
    method: "POST", body: JSON.stringify({ op, args }), signal: options.signal,
  }, options.authority);
  const revision = options.runtime.coverageRevision;
  const generation = options.runtime.outbox.generation;
  let request = await options.runtime.resumeRequest([...options.mounted.values()], { ...adjustment, demand: options.demand });
  check();
  let capacityOnly = false;
  if (!request && options.demand && !options.runtime.hasCoverageFacts) {
    // @ref LLP 1018.008.000#capacity-acquisition — a write-only account has no
    // query facts. Authenticate its epoch, then use the existing logless route
    // solely for capacity; never manufacture coverage or a successful resume.
    if (options.runtime.authEpoch === undefined) {
      const me = wireAuthMe(await options.json("/api/auth/me", { signal: options.signal }, options.authority));
      check();
      if (me.viewer !== grantPrincipal || me.authEpoch === undefined) throw resumeUnavailable("capacity acquisition needs an authenticated account epoch");
      await options.runtime.reauthenticate(me.viewer, me.authEpoch);
      check();
    }
    const program = (await options.runtime.store.outbox.programs())[options.runtime.programGeneration!];
    check();
    if (program && !options.runtime.hasCoverageFacts && !options.runtime.resetNeeded) {
      request = { protocol: 1, generation: program.generation, schemaHash: program.schemaHash,
        authEpoch: options.runtime.authEpoch!, mounted: [] };
      capacityOnly = true;
    } else request = await options.runtime.resumeRequest([...options.mounted.values()], { ...adjustment, demand: options.demand });
  }
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
    const seeds = await options.runtime.resumeSeeds([...options.mounted.values()]);
    check();
    if (seeds.length === 0) throw resumeUnavailable("no query with known arguments can establish resume facts");
    for (const seed of seeds) {
      try {
        const deliveryOrder = options.runtime.beginDelivery();
        const raw = await options.json("/api/query?receipt=1", {
          method: "POST", body: JSON.stringify({ op: seed.op, args: seed.args }), signal: options.signal,
        }, options.authority);
        check();
        const accepted = await acceptOffline(options.runtime, seed.op, seed.args, raw, options.shape, fullRead(seed.op, seed.args));
        check();
        const delivered = wireQuery(accepted.result);
        const superseded = await commitOffline(options.runtime, seed.op, seed.args, accepted, options.failure ?? ((error) => error as Error),
          revision, () => !options.signal?.aborted, deliveryOrder);
        check();
        if (seed.drain && !superseded && accepted.envelope && "next" in delivered
          && (delivered.next === null || typeof delivered.next === "string")) {
          await options.runtime.markWatermark(seed.op, seed.args, delivered.next, accepted.envelope.validator, revision);
          check();
        }
        request = await options.runtime.resumeRequest([...options.mounted.values()], { ...adjustment, demand: options.demand });
        check();
        if (request) break;
      } catch (error) {
        // Cancellation and lifecycle replacement win immediately. Query-local
        // refusals fall through to the next known candidate.
        check();
        if (options.runtime.principal !== grantPrincipal || revision !== options.runtime.coverageRevision) throw error;
        // Only a validated terminal owner refusal proves this candidate is
        // unusable. Transport and malformed-body ambiguity retain the durable
        // log and stop this recovery attempt.
        if (!isRefusalError(error) || error.retryable || error.status === undefined) throw error;
        if (seed.drain) {
          await options.runtime.dropWatermark(seed.op, seed.args, revision);
          check();
        }
      }
    }
    if (!request) throw resumeUnavailable("no owner query candidate delivered the facts required for resume");
  }
  const requestedEpoch = request.authEpoch;
  const rebuild = async () => {
    check();
    await options.reload?.(options.authority);
    check();
    // A 409 authenticated request.authEpoch before checking the program; a
    // successful probe below verifies the same epoch explicitly.
    await options.runtime!.resetCoverage(requestedEpoch, options.signal);
    check();
    for (const subscription of [...options.subscriptions]) {
      (subscription as Subscription<unknown> & { reset?: () => void }).reset?.();
    }
    return true;
  };
  let value: unknown;
  const deliveryOrder = options.runtime.beginDelivery();
  try {
    const grant = await options.runtime.outbox.grant();
    check();
    // The absent-field compatibility behavior mints. Send usable capacity on
    // every resume, including zero for an expired grant with unused IDs.
    request = { ...request, remaining: grant && !options.runtime.outbox.expired(grant) ? Math.max(0, grant.count - grant.used) : 0,
      ...(options.demand === undefined ? {} : { demand: options.demand }) } as ResumeRequestV1;
    value = await options.json("/api/resume", { method: "POST", body: JSON.stringify(request), signal: options.signal }, options.authority);
    check();
  } catch (error) {
    check();
    const candidate = refusal(error);
    if (candidate?.code === "E_OFFLINE_RESET" && !capacityOnly) return rebuild();
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
  if (capacityOnly) {
    if (response.mounted.length || response.log != null) throw options.shape("capacity response returned unrequested coverage");
    options.runtime.noteGrant(response, grantPrincipal);
    await options.runtime.adoptPendingGrant(() => {
      check();
      if (options.runtime!.outbox.generation !== generation || options.runtime!.principal !== grantPrincipal
        || options.runtime!.hasCoverageFacts || options.runtime!.resetNeeded) {
        throw resumeUnavailable("coverage changed during capacity acquisition; resume before sending");
      }
    });
    check();
    return "capacity";
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
    const accepted = await acceptOffline(options.runtime, request.log.op, tailArgs, delivery, options.shape, fullRead(request.log.op, tailArgs));
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
      accepted: await acceptOffline(options.runtime, requested.op, requested.args, item, options.shape, fullRead(requested.op, requested.args)),
    });
    check();
  }
  if (!Number.isSafeInteger(response.seq) || Number(response.seq) < 0) {
    throw options.shape("resume response.seq must be a non-negative safe integer");
  }
  try {
    const reset = await options.runtime.commitMany(swaps, watermark, undefined, revision,
      () => !options.signal?.aborted, Number(response.seq), deliveryOrder);
    // @ref LLP 1012#8-the-delivery-envelope-the-validator-and-resume — an
    // internal clock reset or concurrent program rotation starts another
    // recovery round; its response cannot install a grant under replaced facts.
    if (reset || revision !== options.runtime.coverageRevision) return true;
  } catch (error) {
    throw options.failure ? options.failure(error) : error;
  }
  check();
  options.validated(options.authority);
  // @ref LLP 1012#7-writes-offline — a resume may omit a replacement grant;
  // successful re-authorization itself renews trust, then replay is FIFO.
  options.runtime.noteGrant(response, grantPrincipal);
  let lifecycleChanged = false;
  try {
    const grantAuthority = () => {
      check();
      if (options.runtime!.outbox.generation !== generation) {
        lifecycleChanged = true;
        throw resumeUnavailable("offline lifecycle changed during grant adoption; resume again before sending");
      }
    };
    await options.runtime.adoptPendingGrant(grantAuthority);
    grantAuthority();
  } catch (error) {
    // A same-authority confirmation can reopen the same partition while this
    // response is persisting. The grant was rolled back; restart recovery on
    // the new lifecycle instead of exposing an internal coordination race.
    if (lifecycleChanged) { check(); return true; }
    throw options.failure ? options.failure(error) : error;
  }
  if (!options.runtime.outbox.resumeSucceeded(generation)) return false;
  await drainOutbox(drainOptions(options));
  check();
  return false;
}

function resumeUnavailable(message: string): RefusalError {
  return new RefusalError({
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

export interface ResumeClient {
  offlineRuntime?: OfflineRuntime;
  mounted: Map<string, MountedQuery>;
  supersessionQueries: Map<string, { principal: string; op: string; args: unknown }>;
  subscriptions: Set<Subscription<unknown>>;
  ensureAuthority(authority: ClientAuthority): void;
  ensureOfflineMetadata(authority: ClientAuthority, force: boolean, startup: boolean, signal: AbortSignal): Promise<void>;
  json(path: string, init: RequestInit, authority: ClientAuthority): Promise<unknown>;
  offlineRefusal(error: unknown): RefusalError;
  validated(authority: ClientAuthority): void;
}

export async function resumeClient(host: ResumeClient, authority: ClientAuthority, signal: AbortSignal, demand?: string): Promise<boolean> {
  const runtime = host.offlineRuntime!;
  const check = () => { throwIfAborted(signal); host.ensureAuthority(authority); };
  const json = async (path: string, init: RequestInit) => {
    check();
    // @ref LLP 1012#7-writes-offline — release the serialized drain even if replay or its tail ignores abort.
    const value = await withAbort(signal, () => host.json(path, { ...init, signal }, authority));
    check();
    return value;
  };
  await host.ensureOfflineMetadata(authority, false, true, signal);
  check();
  // One flight owns bounded convergence, including successors found by cold
  // subscription opens. Keep all pending keys until an entire round commits.
  for (let round = 0; round < 3; round++) {
    const reset = await performOfflineResume({
      runtime, mounted: host.mounted, authority, signal, demand,
      bearerConfirmed: authority.token !== undefined, json,
      validated: (current) => { check(); host.validated(current); },
      shape: wireShape, failure: (error) => host.offlineRefusal(error),
      subscriptions: host.subscriptions,
      reload: (current) => host.ensureOfflineMetadata(current, true, true, signal),
    });
    check();
    if (reset === "capacity") {
      if ((await runtime.queuedIntents()).length === 0) return true;
      // Capacity can restore transport while the flight owns the reconnect.
      // Preserve its queued replay purpose under the same deadline and fences.
      check(); return resumeClient(host, authority, signal);
    }
    if (reset) for (const item of [...host.mounted.values()].filter(item => !item.drain)) {
      const principal = runtime.principal!;
      const key = `${principal}\u0000${item.op}\u0000${stableSerialize(item.args)}`;
      if (!host.supersessionQueries.has(key)) host.supersessionQueries.set(key, { principal, op: item.op, args: item.args });
    }
    const pending = [...host.supersessionQueries];
    const revision = runtime.coverageRevision;
    let superseded = false;
    // Fresh authenticated reads, never buffered envelopes. The epoch remains
    // the session epoch authenticated by the resume, even for first facts.
    for (const [, item] of pending) {
      check();
      if (item.principal !== runtime.principal) continue;
      const deliveryOrder = runtime.beginDelivery();
      const raw = await json("/api/query?receipt=1", {
        method: "POST", body: JSON.stringify({ op: item.op, args: runtime.serverArguments(item.op, item.args) }),
      });
      check();
      const accepted = await acceptOffline(runtime, item.op, item.args, raw, wireShape,
        () => json("/api/query?receipt=1", { method: "POST", body: JSON.stringify({ op: item.op, args: runtime.serverArguments(item.op, item.args) }) }));
      check();
      wireQuery(accepted.result);
      superseded = await commitOffline(runtime, item.op, item.args, accepted,
        (error) => host.offlineRefusal(error), revision, () => !signal.aborted, deliveryOrder);
      check();
      if (superseded || revision !== runtime.coverageRevision) break;
    }
    if (superseded || revision !== runtime.coverageRevision) continue;
    let fenced = false;
    if (reset) {
      // @ref LLP 1012#7-writes-offline — the rebuild cleared the fence's trust
      // anchor (resetCoverage resets trust), so this drain releases only
      // intents inside the fence; a fence stop is answered by the resume the
      // next round completes, never by the rebuild alone.
      const drained = await drainOutbox({ runtime, json, signal, shape: wireShape, failure: (error) => host.offlineRefusal(error) });
      check();
      fenced = drained.reason === "fence";
    }
    const complete = await runtime.completeReset(revision, signal);
    check();
    if (!complete) continue;
    for (const [key, item] of pending) if (host.supersessionQueries.get(key) === item) host.supersessionQueries.delete(key);
    if (host.supersessionQueries.size === 0 && !runtime.resetNeeded && !fenced) return false;
  }
  throw new RefusalError({
    code: "E_OFFLINE_RESET", family: "offline", message: "the program changed during three coverage rebuild attempts",
    site: "client.resume", rewrite: "retry online() after the program stops rotating", guide: "offline",
  });
}
