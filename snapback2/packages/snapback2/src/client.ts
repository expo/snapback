import { cursorArgument } from "./local-cursor.js";
import { internalSubscribe, internalConsumers } from "./internal-access.js";
import { mayNeedAssetPlanning } from "./assets.js";
import { ClientAuth, anonymousAuth, restoreAuthToken, saveAuthToken, storageRefusal, ensureBearerTransition } from "./client-auth.js";
import { SharedSse } from "./live.js";
import type { AssetFetchOptions } from "./store/byte-cache.js";
import { api, referenceName, type Api, type ApiProxy, type Channel as ChannelRef, type Op } from "./api.js";
import { captureGrant, createOutboxApi, drainOutbox, type DrainResult } from "./client-outbox.js";
import {
  acceptOffline,
  answerOffline,
  commitOffline,
  createOfflineDrain, refuseDrains,
  createOfflineRuntime,
  decodeOfflineSubscription,
  goOffline,
  goOnline,
  offlineNetworkRefusal,
  offlineRefusal as makeOfflineRefusal,
  performOfflineResume,
  restartOffline,
  settleSubscription,
  validateOfflineOptions,
} from "./client-offline.js";
import {
  assetBlobFor, assetBytesFor,
  assetHeadersFor,
  assetUrlFor,
  uploadAsset,
  listUploadsFor, discardUploadFor,
  type Authority,
} from "./client-upload.js";
import {
  RefusalError,
  copyRefusal, toRefusal, requestRefusal,
  fallbackRefusal, followerRefusal, supersededRefusal, throwIfAborted, withAbort,
  isRefusalError,
  isTerminalSession,
  responseRefusal, responseJson, type JsonRequestOptions,
  sseObject,
  terminalSessionEnvelope,
  wireAuthMe,
  wireManifest,
  wireQuery,
  wireShape,
  wireSubscription,
} from "./client-wire.js";
import { admitDrain, InvalidOfflineStoreError, type OfflineRuntime, type MountedQuery } from "./offline.js";
import { TabFollower } from "./client-sessions.js";
import { ClientQueries } from "./client-observed.js";
import type { HistorySnapshot, ItemRow, Items, ItemSnapshot, ItemsWithHistory } from "./client-items.js";
import { ClientInbox } from "./client-inbox.js";
import { performMutation, type MutationClient } from "./client-mutations.js";
import { createChannel, type ChannelHost } from "./client-channels.js";
import { ReconnectingSse } from "./sse.js";
import type { SseResponse } from "./sse-parser.js";
import { stableSerialize } from "./types.js";
import type {
  AssetInput, AssetRecord, AssetUploadOptions, AssetUploadSource, AssetUrlOptions,
  AuthMe, AuthSession, AuthTokenStore, ChannelHandle,
  ClientSnapshot, CreateClientOptions, ImageAsset, LiveQueryDelivery, Manifest,
  MutationResult, ObservedQuery, OutboxApi, Principal,
  QueryResult, QueryRefusedDelivery, Refusal, RefusedDelivery,
  SnapbackClient, Subscription, SubscriptionDelivery, VideoAsset,
} from "./types.js";
export { api };
export { mutationTarget, type MutationTargetRef, type MutationProgramIdentity, type AdmittedMutationTargets } from "./mutation-targets.js";
export { browserTokenStore } from "./token-store.js";
export type { Api, ApiProxy, ChannelRef as Channel, Op };
export type { ResultOf, ArgsOf } from "./api.js";
export * from "./types.js";
export * from "./snapshot.js";
export { defineItems, withHistory, type Items, type ItemsWithHistory, type QueryItem, type ItemAction, type ItemSnapshot, type HistorySnapshot } from "./client-items.js";
export type {
  CoverageFacts,
  HeldOperation,
  OutboxEntry,
  OutboxStore,
  RangeStore,
  RangeStoreFactory,
  Receipt,
  ReceiptRange,
} from "./store/range-store.js";
export type { PartialReason } from "./twin-hydrate.js";
type SessionExpiration =
  | { cleared: false }
  | { cleared: true; authGeneration: number; fence: number };
type InternalClientOptions = CreateClientOptions & {
  offlinePrincipal?: Principal;
  offlineReadObserver?: (ref: unknown, args: unknown, result: unknown) => void;
};
// @ref LLP 1002#9-the-client-snapback2client-snapback2react-snapback2test — auth custody is restored explicitly and every principal transition fences old in-memory work.
class Client implements SnapbackClient {
  readonly auth;
  readonly outbox: OutboxApi;
  readonly ready: Promise<void>;
  private readonly localReady: Promise<void>;
  private readonly startupController = new AbortController();
  private readonly lifetimeController = new AbortController();
  private startupComplete = false;
  private queryCursors?: Manifest["ops"];
  readonly url: string;
  readonly fetchImpl: typeof globalThis.fetch;
  readonly customFetch: boolean;
  private readonly tokenStore?: AuthTokenStore;
  readonly persona?: string;
  private readonly createOptions: InternalClientOptions;
  private readonly offlineRuntime?: OfflineRuntime;
  private readonly live: SharedSse;
  private readonly mounted = new Map<string, MountedQuery>();
  private readonly queries: ClientQueries;
  /** Browser-tab writer/follower ownership over the one persistent partition. */
  private readonly inbox: ClientInbox;
  private readonly follower: TabFollower<Authority>;
  private offlineMetadataLoaded = false;
  private offlineStartupPending = false;
  private resumeTail: Promise<void> = Promise.resolve();
  private resumeFlight?: Promise<void>;
  private resumeController?: AbortController;
  private readonly drainControllers = new Set<AbortController>();
  private resetRefusal?: Refusal;
  // Pending reads, never buffered authority-bearing responses. Custody is per principal.
  private readonly supersessionQueries = new Map<string, { principal: string; op: string; args: unknown }>();
  private forcedOffline = false;
  private currentToken?: string;
  private currentPrincipal?: Principal;
  private readonly authState: ClientAuth;
  private authGeneration = 0;
  private custodyGeneration = 0;
  private operationFence = 0;
  private transitionTail: Promise<void> = Promise.resolve();
  private custodyTail: Promise<void> = Promise.resolve();
  private currentSnapshot: ClientSnapshot;
  private readonly statusListeners = new Set<(snapshot: ClientSnapshot) => void>();
  private readonly subscriptions = new Set<Subscription<unknown>>();
  private readonly writes = new Set<Promise<unknown>>();
  carrier?: {
    token: string;
    expiresAt: number;
    authGeneration: number;
    custodyGeneration: number;
    fence: number;
  };
  private closed = false;
  private closing: Promise<void> = Promise.resolve();
  constructor(options: InternalClientOptions) {
    if (!options?.url) throw new TypeError("createClient requires url");
    if (options.persona !== undefined && (options.token !== undefined || options.tokenStore !== undefined)) {
      throw new TypeError("createClient cannot combine dev persona `persona` with bearer token custody");
    }
    this.createOptions = options;
    this.url = options.url.replace(/\/+$/, "");
    this.fetchImpl = options.fetch ?? globalThis.fetch?.bind(globalThis);
    this.customFetch = options.fetch !== undefined;
    if (typeof this.fetchImpl !== "function") throw new TypeError("createClient requires a fetch implementation");
    this.live = new SharedSse(this.url, (...args) => this.fetchImpl(...args));
    this.tokenStore = options.tokenStore;
    this.persona = options.persona;
    this.forcedOffline = options.startOffline === true;
    this.currentSnapshot = { auth: { state: "hydrating" }, authGeneration: 0, persona: options.persona, connection: this.forcedOffline ? "offline" : "reconnecting" };
    this.authState = new ClientAuth(() => this.publishAuthSnapshot(), () => ({ token: this.currentToken, principal: this.currentPrincipal }), current => this.me(current), () => !this.forcedOffline);
    validateOfflineOptions(options.offline);
    try {
      this.offlineRuntime = createOfflineRuntime(options.offline);
    } catch (error) {
      if (error instanceof InvalidOfflineStoreError) throw error;
      throw this.offlineRefusal(error);
    }
    // @ref LLP 1018.004#2-the-inbox — the tab channel carries nudges and the
    // writer's announced status; admission is the ledger's, from durable rows.
    this.inbox = new ClientInbox({
      url: this.url, runtime: this.offlineRuntime, closed: () => this.closed, fence: () => this.operationFence,
      failure: (error, site) => this.offlineRefusal(error, site).envelope,
      superseded: () => supersededRefusal(),
      writerStatus: () => this.offlineRuntime!.outbox.status(),
      subscribeLedger: (listener) => this.offlineRuntime?.outbox.subscribe(listener) ?? (() => undefined),
      admitted: () => { void this.drainNow().catch(() => undefined); },
    });
    this.follower = new TabFollower<Authority>({
      runtime: () => this.offlineRuntime!, closed: () => this.closed,
      inherited: (principal) => {
        this.supersessionQueries.clear(); this.offlineMetadataLoaded = false; this.currentPrincipal = principal as Principal;
      },
      following: (principal, authenticated, authEpoch) => this.inbox.following(
        principal, authenticated, authEpoch, this.persona !== undefined),
      admitInherited: async () => { await this.inbox.admit(); },
      writer: () => this.inbox.activate(),
      stopped: () => this.inbox.stop(),
      takeover: () => this.takeover(), drain: (authority) => { void this.drainNow(authority).catch(() => undefined); },
      failed: (error) => { this.patchSnapshot({ lastRefusal: this.offlineRefusal(error, "RangeStore.open").envelope }); },
    });
    this.queries = new ClientQueries({
      cursor: op => this.offlineRuntime?.declaredCursorArg(op) ?? cursorArgument(this.queryCursors?.[op])
        ?? (this.offlineRuntime?.programGeneration || this.queryCursors ? null : undefined),
      prepare: async op => {
        await this.localReady;
        const cursor = this.offlineRuntime?.declaredCursorArg(op);
        if (cursor || this.offlineRuntime?.programGeneration || this.queryCursors) return cursor ?? cursorArgument(this.queryCursors?.[op]);
        // @ref LLP 1002#9-the-client-snapback2client-snapback2react-snapback2test — retry cold preparation once across the captured bearer restoration.
        const authority = await this.operationAuthority(), restoring = !!authority.token && this.authState.value.state === "hydrating";
        try { return cursorArgument((await this.manifestFor(authority)).ops[op]); }
        catch (error) {
          if (!restoring || !isRefusalError(error) || !error.retryable) throw error;
          await this.authState.settled(this.lifetimeController.signal);
          this.ensureAuthority(authority);
          return cursorArgument((await this.manifestFor(authority)).ops[op]);
        }
      },
      identity: () => [this.authGeneration, this.operationFence],
      active: ([generation, fence]) => !this.closed && this.authGeneration === generation && this.operationFence === fence,
      connection: () => this.currentSnapshot.connection,
      open: (ref, args, callback, drain) => drain ? this.drain(ref, args, callback) : this.subscribeRegular(ref, args, callback),
      query: (ref, args) => this.queryInternal(ref, args),
      local: (ref, args, drain) => answerOffline(this.offlineRuntime, referenceName(ref), args, error => this.offlineRefusal(error), drain),
      entries: () => this.offlineRuntime?.itemEntries() ?? Promise.resolve([]),
      compactedThrough: () => this.offlineRuntime?.compactedThrough() ?? Promise.resolve(0),
    });
    this.offlineRuntime?.subscribeInputs(() => this.queries.refresh());
    this.outbox = createOutboxApi(this.offlineRuntime, () => this.drainNow(), () => this.localReady,
      () => this.forcedOffline, this.inbox, () => `${this.authGeneration}:${this.operationFence}`);
    this.auth = {
      signup: (input: { email: string; password: string }) => this.session("/api/auth/signup", input),
      login: (input: { email: string; password: string }) => this.session("/api/auth/login", input),
      guest: () => this.session("/api/auth/guest", {}),
      logout: () => this.logout(),
      me: () => this.me(),
    };
    this.localReady = this.hydrate(options.token).then(async () => {
      const principal = this.persona === undefined ? options.offlinePrincipal ?? this.currentPrincipal : `dev:${this.persona}` as Principal;
      if (principal) { await this.openOffline(principal); this.currentPrincipal = principal; }
    }).catch(error => {
      if (!this.closed) this.authState.failed(error);
      throw error;
    });
    this.ready = this.localReady.then(() => this.initializeOffline()).finally(() => { this.startupComplete = true; });
    void this.ready.then(() => {
      if (!this.closed && this.currentToken !== undefined && this.operationFence === 0 && this.authState.value.state === "hydrating"
        && this.authState.value.retryAt === undefined) return this.me();
    }).catch(() => undefined); // Each restoration attempt publishes its own failure.
  }
  get snapshot(): ClientSnapshot { return this.currentSnapshot; }
  async query<Args, Result>(ref: Op<Args, Result>, args: Args): Promise<QueryResult<Result>> {
    try { return await this.queryInternal(ref, args); }
    catch (error) { return { state: "refused", ...toRefusal(error) }; }
  }
  private async queryInternal<Args, Result>(ref: Op<Args, Result>, args: Args, drain = false): Promise<QueryResult<Result>> {
    await this.localReady;
    // Cold held reads may bypass restoration, never an explicit account transition.
    const localAuthority = await this.transitionAuthority();
    this.ensureAuthority(localAuthority);
    const op = referenceName(ref);
    // A follower admits a drain the way a client with no store does: from the manifest, not held custody.
    if (drain && this.offlineRuntime && !this.offlineRuntime.following) this.offlineRuntime.drainCursor(op);
    if (this.currentToken && this.authState.value.state === "hydrating" && this.offlineRuntime
      && (this.startupComplete || this.offlineRuntime.principal)) {
      const held = await answerOffline<Result>(this.offlineRuntime, op, args, error => this.offlineRefusal(error), drain);
      this.ensureAuthority(localAuthority);
      return held;
    }
    if (!this.startupComplete && this.offlineRuntime?.principal !== undefined) {
      const held = await answerOffline(this.offlineRuntime, op, args, (error) => this.offlineRefusal(error, "client.query.local"));
      this.ensureAuthority(localAuthority);
      if (held.state !== "hydrating") return held as QueryResult<Result>;
    }
    const authority = await this.operationAuthority(false);
    if (this.forcedOffline) {
      this.patchSnapshot({ connection: "offline" });
      return answerOffline(this.offlineRuntime, op, args, (error) => this.offlineRefusal(error));
    }
    if (this.currentToken) await this.authState.settled(this.lifetimeController.signal);
    this.ensureAuthority(authority);
    await this.ensureOfflineMetadata(authority);
    this.scheduleSupersessionReset(authority);
    const transportArgs = this.offlineRuntime?.serverArguments(op, args) ?? args;
    let backoff = 50;
    for (let attempt = 1; ; attempt += 1) {
      try {
        const held = await this.offlineRuntime?.answer(op, transportArgs);
        const revision = this.offlineRuntime?.coverageRevision;
        const raw = await this.json(`/api/query?receipt=${this.offlineRuntime ? 1 : 0}${drain ? "&drain=1" : ""}`, {
          method: "POST",
          body: JSON.stringify(this.offlineRuntime && held?.validator ? { op, args: transportArgs, validator: held.validator } : { op, args: transportArgs }),
        }, authority);
        const accepted = await acceptOffline<Result>(this.offlineRuntime, op, transportArgs, raw, wireShape,
          () => this.json("/api/query?receipt=1", { method: "POST", body: JSON.stringify({ op, args: transportArgs }) }, authority));
        const superseded = await commitOffline(this.offlineRuntime, op, transportArgs, accepted, (error) => this.offlineRefusal(error, "client.query.commit"), revision);
        const decoded = wireQuery<Result>(accepted.result);
        const result = this.offlineRuntime ? await this.offlineRuntime.withQueryItems(op, transportArgs, accepted, decoded) : decoded;
        this.validated(authority);
        if (superseded || revision !== this.offlineRuntime?.coverageRevision) this.scheduleSupersessionReset(authority, { op, args });
        if (this.offlineRuntime && this.createOptions.offlineReadObserver) {
          const held = await answerOffline<Result>(
            this.offlineRuntime,
            op,
            args,
            (error) => this.offlineRefusal(error),
          );
          this.createOptions.offlineReadObserver(ref, args, held);
        }
        // Every typed receipt, including an empty capped page, terminates this request.
        return result;
      } catch (error) {
        if (isRefusalError(error) && error.retryable && this.offlineRuntime && attempt >= 3) {
          this.patchSnapshot({ connection: "offline" });
          return answerOffline(this.offlineRuntime, op, args, (failure) => this.offlineRefusal(failure));
        }
        if (!isRefusalError(error)
          || error.code !== "E_TRANSPORT"
          || !error.retryable
          || attempt >= 3) throw error;
        await new Promise<void>((resolve) => setTimeout(resolve, backoff));
        this.ensureAuthority(authority);
        backoff *= 2;
      }
    }
  }
  async mutation<Args, Result>(ref: Op<Args, Result>, args: AssetInput<Args>): Promise<MutationResult<Result>> {
    try { return await performMutation(this as unknown as MutationClient, ref, args); }
    catch (error) { return { state: "rejected", ...toRefusal(error) }; }
  }
  upload(source: AssetUploadSource, options: AssetUploadOptions & { readonly kind: "image" }): Promise<ImageAsset>;
  upload(source: AssetUploadSource, options: AssetUploadOptions & { readonly kind: "video" }): Promise<VideoAsset>;
  upload(source: AssetUploadSource, options?: AssetUploadOptions): Promise<AssetRecord>;
  async upload(source: AssetUploadSource, options: AssetUploadOptions = {}): Promise<AssetRecord> {
    const authority = await this.operationAuthority();
    return this.trackWrite(() => uploadAsset(this, source, options, authority).catch(async error => {
      if (isRefusalError(error) && isTerminalSession(error.envelope)) await this.terminalRefusal(authority, error.envelope);
      throw error;
    }));
  }

  async listUploads(options: { after?: string } = {}) {
    return listUploadsFor(this, options, await this.operationAuthority());
  }
  async discardUpload(id: string): Promise<boolean> {
    const authority = await this.operationAuthority();
    return this.trackWrite(() => discardUploadFor(this, id, authority));
  }

  async assetUrl(asset: AssetRecord | null | undefined, options?: AssetUrlOptions): Promise<string | undefined>;
  async assetUrl(assets: readonly AssetRecord[], options?: AssetUrlOptions): Promise<string[]>;
  async assetUrl(assetOrList: AssetRecord | readonly AssetRecord[] | null | undefined, options: AssetUrlOptions = {}): Promise<string | string[] | undefined> {
    return assetUrlFor(this, assetOrList, options, await this.operationAuthority());
  }
  async assetHeaders(): Promise<Record<string, string>> {
    return assetHeadersFor(this, await this.operationAuthority());
  }
  async assetBlob(url: string, options: AssetFetchOptions = {}): Promise<Blob> {
    const authority = await this.operationAuthority();
    return assetBlobFor(this, this.offlineRuntime?.bytes, () => this.forcedOffline, url, options, authority);
  }
  async assetBytes(url: string, options: AssetFetchOptions = {}) {
    const authority = await this.operationAuthority();
    return assetBytesFor(this, this.offlineRuntime?.bytes, () => this.forcedOffline, url, options, authority);
  }
  get assetCache(): OfflineRuntime["bytes"] | undefined {
    return this.offlineRuntime?.bytes;
  }
  observe<Args, Result, Row extends ItemRow, Draft, HistoryArgs, History>(ref: Op<Args, Result>, args: Args,
    options: { live?: false; drain?: boolean; items: ItemsWithHistory<Args, Result, Row, Draft, HistoryArgs, History> },
  ): ObservedQuery<Result, HistorySnapshot<Result, Row, Draft, History>>;
  observe<Args, Result, Row extends ItemRow, Draft>(ref: Op<Args, Result>, args: Args,
    options: { live?: false; drain?: boolean; items: Items<Args, Result, Row, Draft> }): ObservedQuery<Result, ItemSnapshot<Result, Row, Draft>>;
  observe<Args, Result>(ref: Op<Args, Result>, args: Args, options?: { live?: false; drain?: boolean; items?: undefined }): ObservedQuery<Result>;
  observe<Args, Result, Row extends ItemRow, Draft>(
    ref: Op<Args, Result>, args: Args, options: { live?: false; drain?: boolean; items?: Items<Args, Result, Row, Draft> } = {},
  ): ObservedQuery<Result> {
    return this.queries.observe(ref, args, options as { live?: false; drain?: boolean; items: Items<Args, Result, Row, Draft> });
  }
  [internalSubscribe]<Args, Result>(
    ref: Op<Args, Result>,
    args: Args,
    callback: (delivery: SubscriptionDelivery<Result>) => void,
    options: { drain?: boolean } = {},
  ): Subscription<SubscriptionDelivery<Result>> {
    return this.queries.subscribe(ref, args, callback, options);
  }
  [internalConsumers](ref: Op<any, any>, args: unknown, drain = false): number {
    return this.queries.consumers(ref, args, drain);
  }
  private subscribeRegular<Args, Result>(
    ref: Op<Args, Result>,
    args: Args,
    callback: (delivery: SubscriptionDelivery<Result>) => void,
    drain = false,
  ): Subscription<SubscriptionDelivery<Result>> {
    const op = referenceName(ref);
    let transportArgs = this.offlineRuntime?.serverArguments(op, args) ?? args;
    const mountedKey = `${op}\u0000live\u0000${stableSerialize(args)}`;
    const mountedRecord: MountedQuery = { op, args: transportArgs, drain: false };
    if (!drain) this.mounted.set(mountedKey, mountedRecord);
    let lastPair: { seq: number; data?: Result } | undefined;
    let connected = false;
    let revision: number | undefined;
    let authority: Authority | undefined;
    let subscription: Subscription<SubscriptionDelivery<Result>>;
    const finish = (value: LiveQueryDelivery<Result> | QueryRefusedDelivery) => {
      lastPair = settleSubscription(value, () => this.ensureAuthority(authority), (patch) =>
        this.patchSnapshot({ ...patch, lastRefusal: patch.lastRefusal ?? this.resetRefusal }));
      return value;
    };
    subscription = new ReconnectingSse<SubscriptionDelivery<Result>>({
      open: async (lastEventId, signal) => {
        authority ??= await this.operationAuthority();
        if (this.forcedOffline) throw offlineNetworkRefusal();
        if (this.currentToken) await this.authState.settled(signal);
        await this.ensureOfflineMetadata(authority);
        transportArgs = this.offlineRuntime?.serverArguments(op, args) ?? args;
        mountedRecord.args = transportArgs;
        if (!drain) this.mounted.set(mountedKey, mountedRecord);
        this.scheduleSupersessionReset(authority);
        revision = this.offlineRuntime?.coverageRevision;
        const held = await this.offlineRuntime?.answer(op, transportArgs);
        let path = `/api/subscribe?op=${encodeURIComponent(op)}&args=${encodeURIComponent(JSON.stringify(transportArgs))}`;
        if (this.offlineRuntime) path += "&receipt=1";
        if (drain) path += "&drain=1";
        if (held?.validator) path += `&validator=${encodeURIComponent(held.validator)}`;
        return this.stream(path, lastEventId, signal, authority);
      },
      decode: ({ data }, current) => {
        const frameRevision = revision, frameAuthority = authority!, frameArgs = transportArgs;
        if (!this.offlineRuntime) return finish(wireSubscription<Result>(data, value => { connected = value; }));
        return decodeOfflineSubscription<Result>({
          runtime: this.offlineRuntime, op, args: frameArgs, data, shape: wireShape,
          revalidate: () => this.json("/api/query?receipt=1", { method: "POST", body: JSON.stringify({ op, args: frameArgs }) }, frameAuthority),
          failure: (error) => this.offlineRefusal(error),
          revision: frameRevision, current,
          superseded: () => this.scheduleSupersessionReset(authority!, { op, args }),
          observe: this.createOptions.offlineReadObserver
            ? async () => this.createOptions.offlineReadObserver!(
                ref,
                args,
                await answerOffline(this.offlineRuntime, op, args, (error) => this.offlineRefusal(error)),
              )
            : undefined,
        }).then(value => current() || (value.state === "refused" && isTerminalSession(value)) ? finish(value) : value);
      },
      bufferedTerminal: ({ data }) => {
        const value = wireSubscription<Result>(data);
        return value.state === "refused" && isTerminalSession(value)
          ? new RefusalError(copyRefusal(value))
          : undefined;
      },
      onError: async (error) => {
        const { retry, event, refusal } = await this.subscriptionError(error, authority, subscription);
        if (retry && this.offlineRuntime) {
          this.patchSnapshot({ connection: "offline" });
          const event = await answerOffline<Result>(
            this.offlineRuntime,
            op,
            args,
            (failure) => this.offlineRefusal(failure), drain,
          );
          return { retry, event: event as SubscriptionDelivery<Result>, failure: refusal };
        }
        return {
          retry,
          event: event === undefined ? undefined : { ...event, live: false as const },
          failure: refusal,
        };
      },
      onLoss: () => {
        if (!this.authorityCurrent(authority)) return undefined;
        this.patchSnapshot({ connection: this.transportFailureState() });
        if (this.offlineRuntime) return undefined;
        if (connected) return { state: "hydrating", live: false, connection: "offline" };
        if (!lastPair) return undefined;
        return "data" in lastPair
          ? { state: "stale", live: false, since: Date.now(), seq: lastPair.seq, data: lastPair.data }
          : { state: "stale", live: false, since: Date.now(), seq: lastPair.seq };
      },
      terminal: (event) => event.state === "refused"
        ? new RefusalError(copyRefusal(event))
        : undefined,
      onEvent: callback,
    });
    const tracked = this.track(subscription);
    let closed = false;
    void this.localReady.then(async () => {
      const heldAuthority = await this.transitionAuthority();
      if (!closed && this.offlineRuntime && (!this.startupComplete || (this.currentToken && this.authState.value.state === "hydrating"))) {
        this.ensureAuthority(heldAuthority);
        const held = await answerOffline<Result>(this.offlineRuntime, op, args, error => this.offlineRefusal(error), drain);
        this.ensureAuthority(heldAuthority);
        if (!closed && (!this.startupComplete || this.authState.value.state === "hydrating")) callback(held as SubscriptionDelivery<Result>);
      }
    }).catch(() => undefined);
    const close = tracked.close.bind(tracked);
    const resettable = tracked as Subscription<SubscriptionDelivery<Result>> & { reset?(): void };
    const reset = resettable.reset?.bind(resettable);
    if (reset) resettable.reset = () => { lastPair = undefined; connected = false; reset(); };
    tracked.close = () => {
      closed = true;
      // Only this subscription's own record leaves the mounted set (a newer one of the same query keeps its own).
      if (!drain && this.mounted.get(mountedKey) === mountedRecord) this.mounted.delete(mountedKey);
      close();
    };
    return tracked;
  }
  private drain<Args, Result>(
    ref: Op<Args, Result>,
    args: Args,
    callback: (delivery: SubscriptionDelivery<Result>) => void,
  ): Subscription<SubscriptionDelivery<Result>> {
    const op = referenceName(ref);
    return createOfflineDrain({
      ref,
      op,
      args,
      callback,
      runtime: this.offlineRuntime,
      ready: this.ready,
      mounted: this.mounted,
      offline: () => this.forcedOffline,
      cursor: async () => this.offlineRuntime && !this.offlineRuntime.following
        ? this.offlineRuntime.drainCursor(op) : admitDrain(op, (await this.manifest()).ops[op]?.drain),
      query: (pageArgs: Args) => this.queryInternal(ref, pageArgs, true),
      subscribe: (tailArgs, onEvent) => this.subscribeRegular(ref, tailArgs, onEvent, true),
      track: (subscription) => this.track(subscription),
      resume: async () => this.performResume(await this.operationAuthority()),
      observe: this.offlineRuntime && this.createOptions.offlineReadObserver
        ? async () => this.createOptions.offlineReadObserver!(
            ref,
            args,
            await answerOffline(this.offlineRuntime, op, args, (error) => this.offlineRefusal(error)),
          )
        : undefined,
    });
  }

  channel<Args, Value>(ref: ChannelRef<Args, Value>, args: Args): ChannelHandle<Value> {
    return createChannel(this.channelHost(), ref, args);
  }
  private channelHost(): ChannelHost<Authority, SessionExpiration> {
    return {
      operationAuthority: () => this.operationAuthority(),
      trackWrite: (run) => this.trackWrite(run),
      json: (path, init, authority, options) => this.json(path, init, authority, options),
      stream: (path, lastEventId, signal, authority) => this.stream(path, lastEventId, signal, authority),
      authorityCurrent: (authority) => this.authorityCurrent(authority),
      ensureAuthority: (authority) => this.ensureAuthority(authority),
      validated: (authority) => this.validated(authority),
      expireSession: (authority) => this.expireSession(authority),
      expirationCurrent: (expiration) => this.expirationCurrent(expiration),
      supersededRefusal: () => supersededRefusal(),
      recordRefusal: (refusal) => this.recordRefusal(refusal),
      patchSnapshot: (patch) => { this.patchSnapshot(patch); },
      transportFailureState: () => this.transportFailureState(),
      subscriptionError: (error, authority, origin) => this.subscriptionError(error, authority, origin),
      track: (subscription) => this.track(subscription),
    };
  }

  async manifest(): Promise<Manifest> {
    const authority = await this.operationAuthority();
    return this.manifestFor(authority);
  }

  async offline(): Promise<void> {
    this.forcedOffline = true;
    this.authState.offline();
    this.live.close();
    this.startupController.abort();
    this.abortSync();
    return goOffline({
      ready: this.localReady,
      ensureOpen: () => this.ensureOpen(),
      force: (value) => { this.forcedOffline = value; },
      connection: (value) => { this.patchSnapshot({ connection: value }); },
      reconnect: () => this.reconnectTransports(),
    });
  }

  async online(): Promise<void> {
    if (this.offlineRuntime?.following) await this.inbox.refresh();
    return goOnline({
      ready: this.ready,
      ensureOpen: () => this.ensureOpen(),
      force: (value) => { this.forcedOffline = value; },
      connection: (value) => { this.patchSnapshot({ connection: value }); },
      authority: () => this.operationAuthority(),
      resume: (authority) => this.performResume(authority),
      setResume: (run) => { this.resumeTail = run; },
      reconnect: () => this.reconnectTransports(),
    });
  }

  async restart(): Promise<SnapbackClient> {
    return restartOffline({
      ready: this.ready,
      ensureOpen: () => this.ensureOpen(),
      forced: () => this.forcedOffline,
      shutdown: async () => {
        this.closed = true;
        this.lifetimeController.abort();
        this.follower.stop();
        this.inbox.stop();
        this.authState.stop();
        this.abortSync();
        this.operationFence += 1;
        this.closeTransports();
        this.patchSnapshot({ connection: "offline" });
        await this.inbox.settled();
        await this.offlineRuntime?.close();
      },
      create: () => {
        const offline = this.createOptions.offline;
        const options: InternalClientOptions = this.persona !== undefined
          ? { url: this.url, persona: this.persona, fetch: this.fetchImpl, offline, startOffline: this.forcedOffline,
              offlineReadObserver: this.createOptions.offlineReadObserver }
          : { url: this.url, token: this.currentToken, tokenStore: this.tokenStore, fetch: this.fetchImpl, offline,
              offlinePrincipal: this.currentPrincipal, startOffline: this.forcedOffline,
              offlineReadObserver: this.createOptions.offlineReadObserver };
        return new Client(options);
      },
    });
  }

  subscribeStatus(callback: (snapshot: ClientSnapshot) => void): () => void {
    this.statusListeners.add(callback);
    try {
      callback(this.currentSnapshot);
    } catch (error) {
      this.statusListeners.delete(callback);
      throw error;
    }
    return () => this.statusListeners.delete(callback);
  }

  close(): Promise<void> {
    if (this.closed) return this.closing;
    this.closed = true;
    this.lifetimeController.abort();
    this.startupController.abort();
    this.follower.stop();
    this.inbox.stop();
    this.authState.stop();
    this.abortSync();
    this.operationFence += 1;
    this.closeTransports();
    this.patchSnapshot({ connection: "offline" });
    // Resolves once the carrier is quiet: a test or a shutdown that removes the
    // store's directory right after close() would otherwise race the last swap.
    this.closing = this.inbox.settled().then(() => this.offlineRuntime?.close());
    return this.closing;
  }
  private track<Event>(subscription: Subscription<Event>): Subscription<Event> {
    this.subscriptions.add(subscription as Subscription<unknown>);
    const close = subscription.close.bind(subscription);
    subscription.close = () => {
      this.subscriptions.delete(subscription as Subscription<unknown>);
      close();
    };
    return subscription;
  }
  private async session(path: string, input: unknown): Promise<AuthSession> {
    ensureBearerTransition(this, path.slice("/api/auth/".length));
    const session = await this.transition(authority => this.authState.session(path, {
      request: async () => captureGrant(this.offlineRuntime,
        await this.json(path, { method: "POST", body: JSON.stringify(input) }, authority, { enforceAuthority: false, terminalSession: "keep" })),
      install: async session => {
        await this.openOffline(session.viewer, true, session.authEpoch);
        await this.installToken(session.token, session.viewer);
        this.ensureOpen();
        this.authGeneration += 1;
      },
      metadata: () => this.ensureOfflineMetadata({ authGeneration: this.authGeneration,
        custodyGeneration: this.custodyGeneration, fence: this.operationFence, token: this.currentToken })
        .catch(error => { throw this.offlineRefusal(error); }),
      validated: () => this.validated(undefined),
    }));
    this.ensureOpen();
    this.resumeAfterAuth();
    return session;
  }
  private async logout(): Promise<{ ok: boolean }> {
    ensureBearerTransition(this, "logout");
    return this.transition(authority => this.authState.logout({
      request: () => this.json("/api/auth/logout", { method: "POST" }, authority, { enforceAuthority: false, terminalSession: "keep" }),
      wipe: () => this.wipeOffline(),
      clear: async () => { await this.clearToken(); this.ensureOpen(); this.authGeneration += 1; },
      validated: () => this.validated(undefined),
    }));
  }
  private async me(current = () => true): Promise<AuthMe> {
    const authority = await this.operationAuthority();
    if (!current()) throw supersededRefusal();
    const result = await this.confirmAuth(authority);
    this.resumeAfterAuth();
    return result;
  }

  // @ref LLP 1012#7-writes-offline — confirmation after an interrupted startup
  private resumeAfterAuth(): void {
    if (!this.offlineStartupPending) return;
    // Capture only after every queued transition, including failures, settles.
    // The shared resume owns failures; they cannot reject an installed session.
    this.resumeTail = this.operationAuthority(false).then(authority => {
      if (!this.offlineStartupPending || this.authState.value.state !== "authenticated"
        || !this.offlineRuntime?.principal || this.offlineRuntime.principal !== this.currentPrincipal) return;
      return this.performResume(authority);
    }).catch(() => undefined);
  }
  private confirmAuth(authority: Authority): Promise<AuthMe> {
    return this.authState.confirm(async signal => {
      try {
        const result = wireAuthMe(await this.json("/api/auth/me", { signal }, authority, { authRestoration: true }));
        throwIfAborted(signal);
        await this.openOffline(result.viewer, true, result.authEpoch);
        this.ensureAuthority(authority);
        await this.saveConfirmedPrincipal(result.viewer, authority);
        this.ensureAuthority(authority);
        this.currentPrincipal = result.viewer;
        this.validated(authority);
        return result;
      } catch (error) {
        if (anonymousAuth(error) && this.authorityCurrent(authority)) await this.expireSession(authority, { fromAuth: true });
        throw error;
      }
    });
  }
  private async hydrate(explicitToken: string | undefined): Promise<void> {
    this.authGeneration += 1;
    const { token, principal } = await restoreAuthToken(explicitToken, this.tokenStore,
      token => saveAuthToken(this.tokenStore, token, (action, error) => storageRefusal(this, action, error)), (action, error) => storageRefusal(this, action, error));
    if (this.closed) return;
    this.currentToken = token;
    if (token !== undefined && principal) this.currentPrincipal = principal as Principal;
    this.authState.reset({ state: "hydrating", restoringViewer: this.currentPrincipal });
  }

  headers(authority: Authority, stream = false, hasBody = false): Headers {
    const headers = new Headers();
    headers.set("Accept", stream ? "text/event-stream" : "application/json");
    if (hasBody) headers.set("Content-Type", "application/json");
    if (authority.token) headers.set("Authorization", `Bearer ${authority.token}`);
    if (this.persona) headers.set("X-Snapback-As", this.persona);
    return headers;
  }
  private observedProgramGeneration?: string;
  private async manifestFor(authority: Authority, signal?: AbortSignal): Promise<Manifest> {
    throwIfAborted(signal);
    const value = wireManifest(await this.json("/api/manifest", { signal }, authority));
    throwIfAborted(signal);
    this.validated(authority);
    this.observedProgramGeneration = value.programGeneration;
    this.patchSnapshot({ generation: value.generation });
    this.queryCursors = value.ops;
    this.offlineRuntime?.manifest(value);
    // A generation change re-fetches the program on the next read (LLP 1012 §8).
    if (this.offlineRuntime && this.offlineRuntime.programGeneration !== value.programGeneration) this.offlineMetadataLoaded = false;
    return value;
  }

  /**
   * The manifest and, when the partition holds none for the live generation,
   * `GET /api/program`: the twin's custody and the write bounds. `force`
   * reloads after `E_OFFLINE_RESET`, whose generation the held program predates.
   */
  private async ensureOfflineMetadata(authority: Authority, force = false, retry = true, signal?: AbortSignal): Promise<void> {
    throwIfAborted(signal);
    if (!this.offlineRuntime || (this.offlineMetadataLoaded && !force)) return;
    let manifest: Manifest;
    // Unreachable at cold start: held answers and the outbox still serve; the metadata loads on the next reach.
    try { manifest = await this.manifestFor(authority, signal); throwIfAborted(signal); } catch (error) {
      if (!force && isRefusalError(error) && error.retryable) return;
      throw error;
    }
    if (this.offlineRuntime.programGeneration !== manifest.programGeneration || this.offlineRuntime.needsDrainMetadata || force) {
      try {
        const program = await this.json(
          `/api/program?generation=${encodeURIComponent(manifest.programGeneration)}`,
          { signal },
          authority,
        );
        throwIfAborted(signal);
        await this.offlineRuntime.program(program, signal);
        throwIfAborted(signal);
      } catch (error) {
        if (!isRefusalError(error) || error.status !== 404) throw error;
        if (force) {
          // The owner can advance between manifest and program. Coalesce that
          // successor into this reset; repeated churn keeps the reset pending.
          if (retry) return this.ensureOfflineMetadata(authority, true, false, signal);
          throw error;
        }
      }
    }
    this.offlineMetadataLoaded = true;
  }

  networkRefusal(message: string): RefusalError {
    const refusal = new RefusalError(fallbackRefusal("E_TRANSPORT", message), true);
    this.patchSnapshot({ connection: this.transportFailureState(), lastRefusal: refusal.envelope });
    return refusal;
  }

  transportRefusal(message: string): RefusalError {
    const refusal = new RefusalError(fallbackRefusal("E_TRANSPORT", message), true);
    this.patchSnapshot({ connection: this.transportFailureState(), lastRefusal: refusal.envelope });
    return refusal;
  }

  async json(
    path: string,
    init: RequestInit,
    authority: Authority,
    options: JsonRequestOptions = {},
  ): Promise<unknown> {
    const { enforceAuthority = true, terminalSession = "expire", authRestoration = false, onSend } = options;
    throwIfAborted(init.signal);
    if (enforceAuthority) this.ensureAuthority(authority);
    else this.ensureOpen();
    if (this.forcedOffline) throw offlineNetworkRefusal();
    const request = { ...init, headers: this.headers(authority, false, init.body !== undefined && init.body !== null) };
    let response: Response;
    try {
      onSend?.();
      response = await this.fetchImpl(`${this.url}${path}`, request);
    } catch (error) {
      throwIfAborted(init.signal);
      if (enforceAuthority) this.ensureAuthority(authority);
      else this.ensureOpen();
      const refusal = requestRefusal(error);
      this.patchSnapshot({ connection: this.transportFailureState(), lastRefusal: refusal.envelope });
      throw refusal;
    }
    if (!authRestoration) throwIfAborted(init.signal);
    if (!response.ok) {
      if (response.status >= 400 && response.status < 500) {
        let refusal: RefusalError;
        try {
          refusal = await responseRefusal(response);
        } catch (error) {
          throwIfAborted(init.signal);
          if (isRefusalError(error)) {
            if (enforceAuthority) this.ensureAuthority(authority);
            else this.ensureOpen();
            if (error.retryable) {
              this.patchSnapshot({ connection: this.transportFailureState(), lastRefusal: error.envelope });
            }
            throw error;
          }
          throw error;
        }
        return this.refuseJson(refusal, authority, init.signal, options);
      }
      if (enforceAuthority) this.ensureAuthority(authority);
      else this.ensureOpen();
      const refusal = new RefusalError(
        fallbackRefusal("E_TRANSPORT", `${path} returned HTTP ${response.status}`),
        true,
      );
      this.patchSnapshot({ connection: this.transportFailureState(), lastRefusal: refusal.envelope });
      throw refusal;
    }
    let value: unknown;
    try {
      value = await responseJson(response, path);
    } catch (error) {
      throwIfAborted(init.signal);
      if (enforceAuthority) this.ensureAuthority(authority);
      else this.ensureOpen();
      const refusal = requestRefusal(error);
      this.recordRefusal(refusal.envelope);
      throw refusal;
    }
    if (!authRestoration) throwIfAborted(init.signal);
    let terminal: Refusal | undefined;
    try {
      terminal = terminalSession !== "keep" ? terminalSessionEnvelope(value) : undefined;
    } catch (error) {
      throwIfAborted(init.signal);
      if (enforceAuthority) this.ensureAuthority(authority);
      else this.ensureOpen();
      throw error;
    }
    if (terminal && (terminalSession === "expire" || (enforceAuthority && !this.authorityCurrent(authority)))) {
      return this.refuseJson(new RefusalError(terminal), authority, init.signal, options);
    }
    if (enforceAuthority) this.ensureAuthority(authority);
    else this.ensureOpen();
    throwIfAborted(init.signal);
    this.patchSnapshot({ connection: "connected" });
    return value;
  }
  // @ref LLP 1012#7-writes-offline — typed session terminals and HTTP refusals stop before settlement; cancellation preserves the exact queued envelope.
  private async refuseJson(refusal: RefusalError, authority: Authority, signal: AbortSignal | null | undefined, options: JsonRequestOptions): Promise<never> {
    const { enforceAuthority = true, terminalSession = "expire", authRestoration = false } = options;
    // @ref LLP 1002#9-the-client-snapback2client-snapback2react-snapback2test — me() retains late terminal evidence across cancellation.
    if (!authRestoration) throwIfAborted(signal);
    const wasCurrent = !enforceAuthority || this.authorityCurrent(authority);
    const expire = terminalSession !== "keep" && terminalSession !== "after-cleanup" && isTerminalSession(refusal.envelope);
    let expiration: SessionExpiration | undefined;
    if (terminalSession !== "keep" && authority.token !== undefined && isTerminalSession(refusal.envelope) && (expire || !wasCurrent)) {
      expiration = await this.expireSession(authority, { signal, fromAuth: authRestoration && this.authorityCurrent(authority) });
    }
    if (enforceAuthority && (!wasCurrent || (expiration !== undefined && !this.expirationCurrent(expiration)))) throw supersededRefusal();
    if (enforceAuthority && !expire) this.ensureAuthority(authority);
    else this.ensureOpen();
    throwIfAborted(signal);
    this.patchSnapshot({ connection: "connected" });
    this.recordRefusal(refusal.envelope);
    throw refusal;
  }
  private async stream(
    path: string,
    lastEventId: string | undefined,
    signal: AbortSignal,
    authority: Authority,
  ): Promise<SseResponse> {
    this.ensureAuthority(authority);
    if (this.forcedOffline) throw offlineNetworkRefusal();
    const headers = this.headers(authority, true);
    if (lastEventId !== undefined) headers.set("Last-Event-ID", lastEventId);
    try {
      const response = await this.live.open(path, lastEventId, signal, headers, async () => { await this.expireSession(authority); });
      this.ensureAuthority(authority);
      throwIfAborted(signal);
      this.patchSnapshot({ connection: "connected" });
      return response;
    } catch (error) {
      if (isRefusalError(error) && isTerminalSession(error.envelope)) throw error;
      // An aborted transport can still settle when a custom fetch ignores its
      // signal. Fence it before interpreting or publishing the late result.
      this.ensureAuthority(authority);
      if (signal.aborted) throw error;
      if (isRefusalError(error)) {
        this.patchSnapshot({
          connection: error.retryable ? this.transportFailureState() : "connected",
          lastRefusal: error.envelope,
        });
        throw error;
      }
      const refusal = requestRefusal(error);
      this.patchSnapshot({ connection: this.transportFailureState(), lastRefusal: refusal.envelope });
      throw refusal;
    }
  }
  private async subscriptionError(
    error: unknown,
    authority: Authority | undefined,
    origin: Subscription<unknown>,
  ): Promise<{ event?: RefusedDelivery; retry: boolean; refusal?: RefusalError }> {
    const refusal = isRefusalError(error)
      ? error
      : requestRefusal(error);
    if (refusal.code === "E_AUTH_SUPERSEDED") {
      return { retry: false, refusal };
    }
    if (isTerminalSession(refusal.envelope) && authority !== undefined) {
      const wasCurrent = this.authorityCurrent(authority);
      let expiration: SessionExpiration;
      try {
        expiration = await this.expireSession(authority, { origin });
      } catch (error) {
        if (this.closed) {
          return { retry: false, refusal: supersededRefusal() };
        }
        const terminal = isRefusalError(error)
          ? error
          : new RefusalError({
              code: "E_AUTH_TOKEN_STORE",
              family: "auth",
              message: `token store clear failed: ${error instanceof Error ? error.message : String(error)}`,
              guide: "auth/session",
            });
        this.patchSnapshot({ connection: "connected", lastRefusal: terminal.envelope });
        return {
          retry: false,
          refusal: terminal,
          event: { state: "refused", ...terminal.envelope },
        };
      }
      if (this.closed) {
        return { retry: false, refusal: supersededRefusal() };
      }
      if (!wasCurrent || !this.expirationCurrent(expiration)) {
        return { retry: false, refusal: supersededRefusal() };
      }
    }
    if (this.closed) {
      return { retry: false, refusal: supersededRefusal() };
    }
    if (refusal.retryable) {
      this.patchSnapshot({ connection: this.transportFailureState(), lastRefusal: refusal.envelope });
      return { retry: true };
    }
    this.patchSnapshot({ connection: "connected", lastRefusal: refusal.envelope });
    return { retry: false, refusal, event: { state: "refused", ...refusal.envelope } };
  }
  private async initializeOffline(): Promise<void> {
    if (!this.offlineRuntime) return;
    this.offlineStartupPending = true;
    if (this.operationFence > 0) return;
    const authority = {
      authGeneration: this.authGeneration,
      custodyGeneration: this.custodyGeneration,
      fence: this.operationFence,
      token: this.currentToken,
    };
    await this.authState.initializeOffline({
      signal: this.startupController.signal,
      confirm: () => this.confirmAuth(authority),
      hasPrincipal: () => !!this.offlineRuntime?.principal,
      metadata: () => this.ensureOfflineMetadata(authority, false, true, this.startupController.signal),
      resume: () => this.performResume(authority),
      cut: () => this.startupController.signal.aborted,
    });
    if (!this.currentToken && !this.offlineRuntime.principal) this.offlineStartupPending = false;
  }

  private async openOffline(principal: Principal, authenticated = false, authEpoch?: number): Promise<void> {
    if (!this.offlineRuntime) return;
    if (this.follower.confirm(principal, authenticated, authEpoch)) return;
    this.inbox.stop();
    try {
      const changed = this.offlineRuntime.principal !== principal;
      await this.offlineRuntime.open(principal, authenticated);
      if (authenticated) await this.offlineRuntime.reauthenticate(principal, authEpoch);
      if (changed) {
        this.supersessionQueries.clear();
        this.offlineMetadataLoaded = false;
      }
      await this.inbox.activate();
    } catch (error) {
      // @ref LLP 1018.004#2-the-inbox — a held writer lock makes this client a follower: live reads,
      // durable inbox rows the writer admits, takeover on writer close; its first durable read precedes any network work.
      const code = error && typeof error === "object" ? (error as { code?: unknown }).code : undefined;
      if (code === "E_OFFLINE_LOCK" && this.offlineRuntime.canFollow) {
        await this.follower.begin(principal, authenticated, authEpoch);
        await this.inbox.refresh();
        return;
      }
      throw this.offlineRefusal(error, "RangeStore.open");
    }
  }

  /** The writer tab closed: load the program and resume the inherited coverage; the caller replays the inherited queue. */
  private async takeover(): Promise<Authority> {
    const authority = await this.operationAuthority();
    try {
      await this.ensureOfflineMetadata(authority);
      await this.performResume(authority);
    } catch (error) {
      if (!(isRefusalError(error)
        && (error.retryable || error.code === "E_OFFLINE_RESUME" || error.code === "E_OFFLINE_RESET"))) throw error;
    }
    return authority;
  }

  private async sealOffline(): Promise<void> {
    if (!this.offlineRuntime) return;
    this.inbox.stop();
    try { await this.offlineRuntime.seal(); }
    catch (error) { throw this.offlineRefusal(error, "RangeStore.seal"); }
  }

  private async wipeOffline(): Promise<void> {
    if (!this.offlineRuntime) return;
    // A follower owns no partition: sign-out withdraws its wait and touches nothing the writer tab holds.
    this.follower.stop();
    this.inbox.stop();
    this.abortSync();
    this.supersessionQueries.clear();
    try { await this.offlineRuntime.wipe(); this.currentPrincipal = undefined; }
    catch (error) { throw this.offlineRefusal(error, "RangeStore.wipe"); }
  }

  /** A live read never waits for reset. online() joins it and reports its verdict. */
  private scheduleSupersessionReset(authority: Authority, item?: { op: string; args: unknown }): void {
    const principal = this.offlineRuntime?.principal;
    if (!this.authorityCurrent(authority) || principal === undefined) return;
    if (item) this.supersessionQueries.set(`${principal}\u0000${item.op}\u0000${stableSerialize(item.args)}`, { principal, ...item });
    if (this.forcedOffline || (!this.offlineRuntime?.resetNeeded && this.supersessionQueries.size === 0)) return;
    // The rejection is retained on the snapshot; the next opportunity retries.
    void this.performResume(authority).catch(() => undefined);
  }

  private performResume(authority: Authority): Promise<void> {
    if (!this.offlineRuntime || this.forcedOffline) return Promise.resolve();
    if (this.resumeFlight) return this.resumeFlight;
    const controller = new AbortController();
    this.resumeController = controller;
    const run = withAbort(controller.signal, () => this.resumeOffline(authority, controller.signal)).then(() => {
      throwIfAborted(controller.signal);
      this.ensureAuthority(authority);
      this.offlineStartupPending = false;
      this.resetRefusal = undefined;
      this.validated(authority);
    }, (error) => {
      // Local no-facts refusals never pass through json(): offlineRefusal()
      // publishes them on cold initialization as well as online().
      if (!controller.signal.aborted && this.authorityCurrent(authority)) {
        const refusal = this.offlineRefusal(error);
        this.resetRefusal = refusal.envelope;
        refuseDrains(this.mounted, refusal.envelope);
      }
      throw error;
    });
    this.resumeFlight = run;
    void run.then(() => {
      if (this.resumeFlight !== run) return;
      this.resumeFlight = undefined;
      this.resumeController = undefined;
      this.scheduleSupersessionReset(authority);
    }, () => {
      if (this.resumeFlight === run) { this.resumeFlight = undefined; this.resumeController = undefined; }
    });
    return run;
  }

  private abortSync(except?: AbortSignal | null): void {
    if (this.resumeController?.signal !== except) {
      this.resumeController?.abort(); this.resumeController = undefined; this.resumeFlight = undefined;
    }
    for (const controller of this.drainControllers) if (controller.signal !== except) controller.abort();
  }

  private async resumeOffline(authority: Authority, signal: AbortSignal): Promise<void> {
    const runtime = this.offlineRuntime!;
    const check = () => { throwIfAborted(signal); this.ensureAuthority(authority); };
    const json = async (path: string, init: RequestInit) => {
      check();
      // @ref LLP 1012#7-writes-offline — release the serialized drain even if replay or its tail ignores abort.
      const value = await withAbort(signal, () => this.json(path, { ...init, signal }, authority));
      check();
      return value;
    };
    await this.ensureOfflineMetadata(authority, false, true, signal);
    check();
    // One flight owns bounded convergence, including successors found by cold
    // subscription opens. Keep all pending keys until an entire round commits.
    for (let round = 0; round < 3; round++) {
      const reset = await performOfflineResume({
        runtime, mounted: this.mounted, authority, signal,
        bearerConfirmed: authority.token !== undefined, json,
        validated: (current) => { check(); this.validated(current); },
        shape: wireShape, failure: (error) => this.offlineRefusal(error),
        subscriptions: this.subscriptions,
        reload: (current) => this.ensureOfflineMetadata(current, true, true, signal),
      });
      check();
      if (reset) for (const item of [...this.mounted.values()].filter(item => !item.drain)) {
        const principal = runtime.principal!;
        const key = `${principal}\u0000${item.op}\u0000${stableSerialize(item.args)}`;
        if (!this.supersessionQueries.has(key)) this.supersessionQueries.set(key, { principal, op: item.op, args: item.args });
      }
      const pending = [...this.supersessionQueries];
      const revision = runtime.coverageRevision;
      let superseded = false;
      // Fresh authenticated reads, never buffered envelopes. The epoch remains
      // the session epoch authenticated by the resume, even for first facts.
      for (const [, item] of pending) {
        check();
        if (item.principal !== runtime.principal) continue;
        const raw = await json("/api/query?receipt=1", {
          method: "POST", body: JSON.stringify({ op: item.op, args: runtime.serverArguments(item.op, item.args) }),
        });
        check();
        const accepted = await acceptOffline(runtime, item.op, item.args, raw, wireShape,
          () => json("/api/query?receipt=1", { method: "POST", body: JSON.stringify({ op: item.op, args: runtime.serverArguments(item.op, item.args) }) }));
        check();
        wireQuery(accepted.result);
        superseded = await commitOffline(runtime, item.op, item.args, accepted,
          (error) => this.offlineRefusal(error), revision, () => !signal.aborted);
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
        const drained = await drainOutbox({ runtime, json, signal, shape: wireShape, failure: (error) => this.offlineRefusal(error) });
        check();
        fenced = drained.reason === "fence";
      }
      const complete = await runtime.completeReset(revision, signal);
      check();
      if (!complete) continue;
      for (const [key, item] of pending) if (this.supersessionQueries.get(key) === item) this.supersessionQueries.delete(key);
      if (this.supersessionQueries.size === 0 && !runtime.resetNeeded && !fenced) return;
    }
    throw new RefusalError({
      code: "E_OFFLINE_RESET", family: "offline", message: "the program changed during three coverage rebuild attempts",
      site: "client.resume", rewrite: "retry online() after the program stops rotating", guide: "offline",
    });
  }

  private async drainNow(captured?: Authority): Promise<DrainResult> {
    await this.localReady;
    if (this.forcedOffline) {
      const remaining = (await this.offlineRuntime?.queuedIntents())?.length ?? 0;
      const reason = await this.offlineRuntime?.outbox.fence() === "past" ? "fence" : "offline";
      if (this.offlineRuntime) this.offlineRuntime.drainVerdict = Promise.resolve({ stopped: reason, remaining });
      return { stopped: true, reason, remaining };
    }
    const authority = captured ?? await this.operationAuthority();
    this.ensureAuthority(authority);
    if (!this.offlineRuntime) return { stopped: false, remaining: 0 };
    // @ref LLP 1012#7-writes-offline — cancel the drain before auth waits for tracked writes.
    const controller = new AbortController(), signal = controller.signal;
    this.drainControllers.add(controller);
    try {
      return await drainOutbox({ runtime: this.offlineRuntime, signal,
        json: (path, init) => withAbort(signal, () => this.json(path, { ...init, signal }, authority)),
        shape: wireShape, failure: (error) => this.offlineRefusal(error, "client.outbox.drain") });
    } finally { this.drainControllers.delete(controller); }
  }

  async terminalRefusal(authority: Authority, refusal: Refusal, options: { preserveVerdict?: boolean } = {}): Promise<void> {
    // Discard first; cleanup expiry preserves the already settled verdict.
    const wasCurrent = this.authorityCurrent(authority);
    const expiration = await this.expireSession(authority);
    if (expiration.cleared ? (!wasCurrent || !this.expirationCurrent(expiration)) : (!wasCurrent && !options.preserveVerdict)) throw supersededRefusal();
    this.recordRefusal(refusal);
  }

  private offlineRefusal(error: unknown, site = "client.offline"): RefusalError {
    const carrier = this.createOptions?.offline?.store.carrier
      ?? this.createOptions?.offline?.store.name
      ?? "configured";
    const refusal = makeOfflineRefusal(error, carrier, site);
    this.recordRefusal(refusal.envelope);
    return refusal;
  }

  recordRefusal(envelope: Refusal): void {
    this.patchSnapshot({ lastRefusal: envelope });
  }

  validated(authority: Authority | undefined): void {
    if (authority !== undefined) this.ensureAuthority(authority);
    else this.ensureOpen();
    if (!this.forcedOffline) this.patchSnapshot({ connection: "connected", lastRefusal: this.resetRefusal });
    void this.inbox.activate().catch(error => {
      if (!this.closed) this.patchSnapshot({ lastRefusal: this.offlineRefusal(error, "client.inbox.activate").envelope });
    });
  }

  private async transitionAuthority(): Promise<Authority> {
    while (true) {
      const transition = this.transitionTail;
      await transition;
      if (transition === this.transitionTail) break;
    }
    this.ensureOpen();
    return {
      authGeneration: this.authGeneration,
      custodyGeneration: this.custodyGeneration,
      fence: this.operationFence,
      token: this.currentToken,
    };
  }

  private async operationAuthority(waitForResume = true): Promise<Authority> {
    await this.ready;
    while (true) {
      const authority = await this.transitionAuthority();
      const resume = this.resumeTail;
      if (waitForResume) await resume;
      if (this.authorityCurrent(authority) && (!waitForResume || resume === this.resumeTail)) return authority;
    }
  }

  private transition<T>(
    action: (authority: Authority) => Promise<T>,
    waitForWrites = true,
    except?: Subscription<unknown>,
  ): Promise<T> {
    this.operationFence += 1;
    this.inbox.stop();
    if (!this.startupComplete) this.startupController.abort();
    this.authState.suspend();
    this.supersessionQueries.clear();
    this.abortSync();
    this.resetRefusal = undefined;
    this.closeTransports(except);
    const run = this.transitionTail.then(async () => {
      await this.ready;
      this.ensureOpen();
      if (waitForWrites) await this.settleWrites();
      const previous = this.authState.suspend();
      const authority: Authority = {
        authGeneration: this.authGeneration,
        custodyGeneration: this.custodyGeneration,
        fence: this.operationFence,
        token: this.currentToken,
      };
      try {
        return await action(authority);
      } catch (error) {
        if (!this.closed && this.currentToken === authority.token && this.custodyGeneration === authority.custodyGeneration) {
          this.authState.restore(previous);
        } else if (!this.closed && this.authState.value.state !== "anonymous"
          && (this.currentToken === undefined || this.authState.value.state !== "authenticated")) {
          this.authState.failed(error);
        }
        throw error;
      } finally {
        if (this.authGeneration === authority.authGeneration) this.authGeneration += 1;
        this.publishAuthSnapshot();
      }
    });
    this.transitionTail = run.then(() => undefined, () => undefined);
    void run.catch(() => this.resumeAfterAuth());
    return run;
  }

  private async expireSession(authority: Authority, options: { origin?: Subscription<unknown>; fromAuth?: boolean; signal?: AbortSignal | null } = {}): Promise<SessionExpiration> {
    if (authority.token === undefined) return { cleared: false };
    return this.custody(async () => {
      if (this.currentToken !== authority.token
        || this.custodyGeneration !== authority.custodyGeneration) return { cleared: false };
      this.operationFence += 1;
      this.follower.stop();
      this.inbox.stop();
      this.abortSync(options.signal);
      if (!options.fromAuth) this.authState.reset({ state: "hydrating" });
      const fence = this.operationFence;
      const authGeneration = this.authGeneration + 1;
      this.closeTransports(options.origin);
      let sealFailure: unknown;
      let anonymous = false;
      try {
        await this.inbox.settled();
        try { await this.sealOffline(); } catch (error) { sealFailure = error; }
        await this.clearTokenNow();
        if (sealFailure !== undefined) throw sealFailure;
        anonymous = true;
      } catch (error) {
        if (!this.closed) this.authState.failed(error);
        throw error;
      } finally {
        this.authGeneration += 1;
        // Publish custody/generation and notify reads waiting on restoration together.
        if (anonymous && !this.closed) this.authState.set({ state: "anonymous" });
        else this.publishAuthSnapshot();
      }
      return { cleared: true, authGeneration, fence };
    });
  }

  private expirationCurrent(expiration: SessionExpiration): boolean {
    return expiration.cleared
      && !this.closed
      && this.currentToken === undefined
      && this.operationFence === expiration.fence
      && this.authGeneration === expiration.authGeneration;
  }

  private async installToken(token: string, principal: Principal): Promise<void> {
    await this.custody(async () => {
      this.ensureOpen();
      await saveAuthToken(this.tokenStore, token, (action, error) => storageRefusal(this, action, error));
      try { await this.tokenStore?.savePrincipal?.(principal, token); }
      catch (error) { throw storageRefusal(this, "save principal", error); }
      // Commit replacement custody only after durable persistence succeeds,
      // but before close can prevent its in-memory installation. Predecessor
      // evidence may clear a failed save; it cannot erase a completed one.
      this.custodyGeneration += 1;
      // Persistence may have outlived close(). Retain the durable token for a
      // future client restore, but never resurrect this closed instance.
      this.ensureOpen();
      this.currentToken = token;
      this.currentPrincipal = principal;
    });
  }

  private custody<Result>(action: () => Promise<Result>): Promise<Result> {
    const run = this.custodyTail.then(action);
    this.custodyTail = run.then(() => undefined, () => undefined);
    return run;
  }

  private async saveConfirmedPrincipal(principal: Principal, authority: Authority): Promise<void> {
    if (!authority.token || !this.tokenStore?.savePrincipal) return;
    await this.custody(async () => {
      this.ensureAuthority(authority);
      try { await this.tokenStore!.savePrincipal!(principal, authority.token); }
      catch (error) { throw storageRefusal(this, "save principal", error); }
      this.ensureAuthority(authority);
    });
  }

  private async clearToken(): Promise<void> {
    await this.custody(() => this.clearTokenNow());
  }

  private async clearTokenNow(): Promise<void> {
    let failure: RefusalError | undefined;
    if (this.tokenStore) {
      try {
        await this.tokenStore.save(null);
        await this.tokenStore.savePrincipal?.(null);
      } catch (error) {
        failure = storageRefusal(this, "clear", error);
      }
    }
    this.currentToken = undefined;
    this.currentPrincipal = undefined;
    if (failure) throw failure;
  }

  private trackWrite<Result>(run: () => Promise<Result>, viaInbox = false): Promise<Result> {
    // Follower work that is not an inbox write is refused here before uploads or channel bytes leave.
    if (this.offlineRuntime?.following && !viaInbox) return Promise.reject(followerRefusal("client.write"));
    const request = run();
    this.writes.add(request as Promise<unknown>);
    void request.finally(() => this.writes.delete(request as Promise<unknown>)).catch(() => undefined);
    return request;
  }

  private async settleWrites(): Promise<void> {
    while (this.writes.size > 0) await Promise.allSettled([...this.writes]);
    await this.inbox.settled(); // a nudge- or poll-started admission holds captured custody too (LLP 1018.004 §2)
  }

  private closeTransports(except?: Subscription<unknown>): void {
    this.live.close();
    this.queryCursors = undefined;
    this.queries.clear(except);
    // The stream a terminal refusal came from stays open to deliver it, and so
    // does a drain whose tail that stream is: closing the drain would silence it.
    for (const subscription of [...this.subscriptions]) {
      const owner = subscription as Subscription<unknown> & { owns?(subscription: Subscription<unknown>): boolean };
      if (subscription === except || (except !== undefined && owner.owns?.(except) === true)) continue;
      subscription.close();
    }
  }

  private reconnectTransports(): void {
    for (const subscription of this.subscriptions) {
      (subscription as Subscription<unknown> & { reconnect?: () => void }).reconnect?.();
    }
  }

  private authorityCurrent(authority: Authority | undefined): authority is Authority {
    return authority !== undefined
      && !this.closed
      && authority.fence === this.operationFence
      && authority.authGeneration === this.authGeneration
      && authority.custodyGeneration === this.custodyGeneration
      && authority.token === this.currentToken;
  }

  ensureAuthority(authority: Authority | undefined): asserts authority is Authority {
    if (!this.authorityCurrent(authority)) {
      throw supersededRefusal();
    }
  }

  private ensureOpen(): void {
    if (this.closed) {
      throw new RefusalError({
        code: "E_CLIENT_CLOSED",
        family: "owner",
        message: "client is closed", retryable: false, site: "client.request",
        rewrite: "create a new client before starting another operation", guide: "live-query",
      });
    }
  }

  private publishAuthSnapshot(): void {
    this.queries.retireInactive();
    this.patchSnapshot({ authGeneration: this.authGeneration, token: this.currentToken, auth: this.authState.value });
  }

  private transportFailureState(): "reconnecting" | "offline" {
    return this.forcedOffline || (typeof navigator !== "undefined" && navigator.onLine === false)
      ? "offline" : "reconnecting";
  }

  private patchSnapshot(patch: Partial<ClientSnapshot>): ClientSnapshot {
    const next = { ...this.currentSnapshot, ...patch };
    if (patch.token === undefined && "token" in patch) delete next.token;
    if (patch.lastRefusal === undefined && "lastRefusal" in patch) delete next.lastRefusal;
    if (JSON.stringify(next) === JSON.stringify(this.currentSnapshot)) return this.currentSnapshot;
    const connection = this.currentSnapshot.connection;
    this.currentSnapshot = next;
    if (connection !== next.connection) this.queries.reproject();
    for (const listener of this.statusListeners) {
      try {
        listener(next);
      } catch {
        // Application observers cannot turn a validated client operation into a refusal.
      }
    }
    if (!this.closed) this.authState.connectionChanged(connection, next.connection);
    return next;
  }
}

// @ref LLP 1002#9-the-client-snapback2client-snapback2react-snapback2test — one small headless client speaks the owner wire directly.
export function createClient(options: CreateClientOptions): SnapbackClient {
  return new Client(options);
}
