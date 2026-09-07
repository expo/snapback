import { ClientAuth, anonymousAuth, restoreAuthToken, saveAuthToken, storageRefusal, ensureBearerTransition } from "./client-auth.js";
import { SharedSse } from "./live.js";
import type { AssetFetchOptions } from "./store/byte-cache.js";
import { followerRefusal, throwIfAborted, withAbort } from "./client-wire.js";
import { api, referenceName, type Api, type ApiProxy, type Channel as ChannelRef, type Op } from "./api.js";
import { captureGrant, createOutboxApi, drainOutbox, submitMutation, type DrainResult } from "./client-outbox.js";
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
  withMutationUploads, listUploadsFor, discardUploadFor,
  type Authority,
} from "./client-upload.js";
import {
  SnapbackRefusal,
  copyRefusal,
  fallbackRefusal,
  isSnapbackRefusal,
  isTerminalSession,
  responseRefusal, type JsonRequestOptions,
  sseObject,
  terminalSessionEnvelope,
  wireAuthMe,
  wireManifest,
  wireQuery,
  wireShape,
  wireSubscription,
} from "./client-wire.js";
import { admitDrain, type OfflineRuntime, type MountedQuery } from "./offline.js";
import { SharedSubscriptions, TabFollower } from "./client-sessions.js";
import { createChannel, type ChannelHost } from "./client-channels.js";
import { ReconnectingSse } from "./sse.js";
import type { SseResponse } from "./sse-parser.js";
import { stableSerialize } from "./types.js";
import type {
  AssetInput,
  AssetRecord,
  AssetUploadOptions,
  AssetUploadSource,
  AssetUrlOptions,
  AuthMe,
  AuthSession,
  AuthTokenStore,
  ChannelHandle,
  ChannelPublishResult,
  ClientSnapshot,
  CreateClientOptions,
  ImageAsset,
  LiveQueryDelivery,
  Manifest,
  MutationResult,
  OutboxApi,
  Principal,
  QueryResult,
  QueryRefusedDelivery,
  RefusalEnvelope,
  RefusedDelivery,
  SnapbackClient,
  Subscription,
  SubscriptionDelivery,
  VideoAsset,
} from "./types.js";

export { api };
export { SnapbackRefusal, isSnapbackRefusal };
export { browserTokenStore } from "./token-store.js";
export type { Api, ApiProxy, ChannelRef as Channel, Op };
export * from "./types.js";
export type {
  Coverage,
  CoverageFacts,
  HeldAnswer,
  HeldOperation,
  HeldProgram,
  OutboxEntry,
  OutboxStore,
  OverlayRow,
  RangeStore,
  RangeStoreFactory,
  Receipt,
  ReceiptRange,
  StoreSwap,
} from "./store/range-store.js";
export type { LocalAnswer, Prediction } from "./twin.js";
export type { PartialReason, PartialSite } from "./twin-hydrate.js";

type SessionExpiration =
  | { cleared: false }
  | { cleared: true; authGeneration: number; fence: number };

type InternalClientOptions = CreateClientOptions & {
  offlinePrincipal?: Principal;
  offlineReadObserver?: (ref: unknown, args: unknown, result: unknown) => void;
  /** A restart of a device whose transport was cut boots cut, before any request. */
  startOffline?: boolean;
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
  readonly url: string;
  readonly fetchImpl: typeof globalThis.fetch;
  readonly customFetch: boolean;
  private readonly tokenStore?: AuthTokenStore;
  readonly persona?: string;
  private readonly createOptions: InternalClientOptions;
  private readonly offlineRuntime?: OfflineRuntime;
  private readonly live: SharedSse;
  private readonly mounted = new Map<string, MountedQuery>();
  private readonly shared = new SharedSubscriptions();
  /** This browser tab while another tab holds the account's writer lock (LLP 1018 §3). */
  private readonly follower = new TabFollower<Authority>({
    runtime: () => this.offlineRuntime!, closed: () => this.closed,
    inherited: (principal) => { this.supersessionQueries.clear(); this.offlineMetadataLoaded = false; this.currentPrincipal = principal as Principal; },
    takeover: () => this.takeover(), drain: (authority) => { void this.drainNow(authority).catch(() => undefined); },
    failed: (error) => { this.patchSnapshot({ lastRefusal: this.offlineRefusal(error, "RangeStore.open").envelope }); },
  });
  private offlineMetadataLoaded = false;
  private offlineStartupPending = false;
  private resumeTail: Promise<void> = Promise.resolve();
  private resumeFlight?: Promise<void>;
  private resumeController?: AbortController;
  private readonly drainControllers = new Set<AbortController>();
  private resetRefusal?: RefusalEnvelope;
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
    if (options.as !== undefined && (options.token !== undefined || options.tokenStore !== undefined)) {
      throw new TypeError("createClient cannot combine dev persona `as` with bearer token custody");
    }
    this.createOptions = options;
    this.url = options.url.replace(/\/+$/, "");
    this.fetchImpl = options.fetch ?? globalThis.fetch?.bind(globalThis);
    this.customFetch = options.fetch !== undefined;
    if (typeof this.fetchImpl !== "function") throw new TypeError("createClient requires a fetch implementation");
    this.live = new SharedSse(this.url, (...args) => this.fetchImpl(...args));
    this.tokenStore = options.tokenStore;
    this.persona = options.as;
    this.forcedOffline = options.startOffline === true;
    this.currentSnapshot = { auth: { state: "hydrating" }, authGeneration: 0, persona: options.as, connection: this.forcedOffline ? "offline" : "reconnecting" };
    this.authState = new ClientAuth(() => this.publishAuthSnapshot(), () => ({ token: this.currentToken, principal: this.currentPrincipal }), current => this.me(current), () => !this.forcedOffline);
    validateOfflineOptions(options.offline);
    try {
      this.offlineRuntime = createOfflineRuntime(options.offline);
    } catch (error) {
      throw this.offlineRefusal(error);
    }
    this.outbox = createOutboxApi(this.offlineRuntime, () => this.drainNow(), () => this.localReady, () => this.forcedOffline);
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

  get snapshot(): ClientSnapshot {
    return this.currentSnapshot;
  }

  async query<Args, Result>(ref: Op<Args, Result>, args: Args, drain = false): Promise<QueryResult<Result>> {
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
    let backoff = 50;
    for (let attempt = 1; ; attempt += 1) {
      try {
        const held = await this.offlineRuntime?.answer(op, args);
        const revision = this.offlineRuntime?.coverageRevision;
        const raw = await this.json(`/api/query?receipt=${this.offlineRuntime ? 1 : 0}${drain ? "&drain=1" : ""}`, {
          method: "POST",
          body: JSON.stringify(this.offlineRuntime && held?.validator ? { op, args, validator: held.validator } : { op, args }),
        }, authority);
        const accepted = await acceptOffline<Result>(this.offlineRuntime, op, args, raw, wireShape);
        const result = wireQuery<Result>(accepted.result);
        const superseded = await commitOffline(this.offlineRuntime, op, args, accepted, (error) => this.offlineRefusal(error, "client.query.commit"), revision);
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
        // Every typed receipt terminates this request. In particular, an
        // empty Capped array is the terminal drain state, never a retry cue.
        return result;
      } catch (error) {
        if (isSnapbackRefusal(error) && error.retryable && this.offlineRuntime && attempt >= 3) {
          this.patchSnapshot({ connection: "offline" });
          return answerOffline(this.offlineRuntime, op, args, (failure) => this.offlineRefusal(failure));
        }
        if (!isSnapbackRefusal(error)
          || (error.code !== "E_TRANSPORT" && error.code !== "E_NETWORK")
          || !error.retryable
          || attempt >= 3) throw error;
        await new Promise<void>((resolve) => setTimeout(resolve, backoff));
        this.ensureAuthority(authority);
        backoff *= 2;
      }
    }
  }

  async mutation<Args, Result>(ref: Op<Args, Result>, args: AssetInput<Args>): Promise<MutationResult<Result>> {
    const authority = await this.operationAuthority();
    return this.trackWrite(async () => {
      try {
        const result = await withMutationUploads(this, referenceName(ref), args, authority,
          () => this.manifestFor(authority), async (mutationArgs, onCustody) => {
            const result = await submitMutation<Result>({
              runtime: this.offlineRuntime, offline: this.forcedOffline, op: referenceName(ref), args: mutationArgs,
              json: (path, init, onSend) => this.json(path, init, authority, { terminalSession: "after-cleanup", onSend }),
              failure: (error) => this.offlineRefusal(error),
              drain: () => this.drainNow(authority), onCustody,
            });
            // Settle authority before best-effort cleanup, whose 401 may expire
            // the session without invalidating this already received outcome.
            try { this.validated(authority); }
            catch (error) {
              // Supersession suppresses the receipt, not terminal evidence about
              // its captured token. expireSession never clears successor custody.
              if (result.state === "rejected" && isTerminalSession(result)) await this.expireSession(authority);
              throw error;
            }
            return result;
          });
        if (result.state === "rejected" && isTerminalSession(result)) await this.terminalRefusal(authority, result, { preserveOutcome: true });
        return result;
      } catch (error) {
        if (isSnapbackRefusal(error) && isTerminalSession(error.envelope)) await this.terminalRefusal(authority, error.envelope, { preserveOutcome: true });
        if (isSnapbackRefusal(error) && error.code === "E_WIRE_SHAPE") {
          const ambiguous = new SnapbackRefusal(copyRefusal(error.envelope), true);
          this.patchSnapshot({
            connection: this.transportFailureState(),
            lastRefusal: ambiguous.envelope,
          });
          throw ambiguous;
        }
        throw error;
      }
    });
  }

  upload(source: AssetUploadSource, options: AssetUploadOptions & { readonly kind: "image" }): Promise<ImageAsset>;
  upload(source: AssetUploadSource, options: AssetUploadOptions & { readonly kind: "video" }): Promise<VideoAsset>;
  upload(source: AssetUploadSource, options?: AssetUploadOptions): Promise<AssetRecord>;
  async upload(source: AssetUploadSource, options: AssetUploadOptions = {}): Promise<AssetRecord> {
    const authority = await this.operationAuthority();
    return this.trackWrite(() => uploadAsset(this, source, options, authority).catch(async error => {
      if (isSnapbackRefusal(error) && isTerminalSession(error.envelope)) await this.terminalRefusal(authority, error.envelope);
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
  subscribe<Args, Result>(
    ref: Op<Args, Result>,
    args: Args,
    callback: (delivery: SubscriptionDelivery<Result>) => void,
    options: { drain?: boolean } = {},
  ): Subscription<SubscriptionDelivery<Result>> {
    // One entry per (authority generation, kind, op, args): later consumers attach to the first one's stream.
    const key = `${this.authGeneration}\u0000${options.drain ? "drain" : "live"}\u0000${referenceName(ref)}\u0000${stableSerialize(args)}`;
    return this.shared.attach<SubscriptionDelivery<Result>>(key, (fanout) =>
      options.drain ? this.drain(ref, args, fanout) : this.subscribeRegular(ref, args, fanout), callback);
  }
  sharedConsumers(ref: Op<any, any>, args: unknown, drain = false): number {
    return this.shared.consumers(`${this.authGeneration}\u0000${drain ? "drain" : "live"}\u0000${referenceName(ref)}\u0000${stableSerialize(args)}`);
  }
  private subscribeRegular<Args, Result>(
    ref: Op<Args, Result>,
    args: Args,
    callback: (delivery: SubscriptionDelivery<Result>) => void,
    drain = false,
  ): Subscription<SubscriptionDelivery<Result>> {
    const op = referenceName(ref);
    const mountedKey = `${op}\u0000live\u0000${stableSerialize(args)}`;
    const mountedRecord: MountedQuery = { op, args, drain: false };
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
        this.scheduleSupersessionReset(authority);
        revision = this.offlineRuntime?.coverageRevision;
        const held = await this.offlineRuntime?.answer(op, args);
        let path = `/api/subscribe?op=${encodeURIComponent(op)}&args=${encodeURIComponent(JSON.stringify(args))}`;
        if (this.offlineRuntime) path += "&receipt=1";
        if (drain) path += "&drain=1";
        if (held?.validator) path += `&validator=${encodeURIComponent(held.validator)}`;
        return this.stream(path, lastEventId, signal, authority);
      },
      decode: ({ data }, current) => {
        const frameRevision = revision;
        if (!this.offlineRuntime) return finish(wireSubscription<Result>(data, value => { connected = value; }));
        return decodeOfflineSubscription<Result>({
          runtime: this.offlineRuntime, op, args, data, shape: wireShape,
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
          ? new SnapbackRefusal(copyRefusal(value))
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
        ? new SnapbackRefusal(copyRefusal(event))
        : undefined,
      onEvent: callback,
    });
    const tracked = this.track(subscription);
    let closed = false;
    void this.localReady.then(async () => {
      const heldAuthority = await this.transitionAuthority();
      if (!closed && this.offlineRuntime && this.currentToken && this.authState.value.state === "hydrating") {
        this.ensureAuthority(heldAuthority);
        const held = await answerOffline<Result>(this.offlineRuntime, op, args, error => this.offlineRefusal(error), drain);
        this.ensureAuthority(heldAuthority);
        if (!closed && this.authState.value.state === "hydrating") callback(held as SubscriptionDelivery<Result>);
      }
    }).catch(() => undefined);
    const close = tracked.close.bind(tracked);
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
      cursor: async () => this.offlineRuntime && !this.offlineRuntime.following
        ? this.offlineRuntime.drainCursor(op) : admitDrain(op, (await this.manifest()).ops[op]?.drain),
      query: (pageArgs: Args) => this.query(ref, pageArgs, true),
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

  channel<Args, Payload = unknown>(ref: ChannelRef<Args, Payload>, args: Args): ChannelHandle<Payload> {
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
      supersededRefusal: () => this.supersededRefusal(),
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
        this.authState.stop();
        this.abortSync();
        this.operationFence += 1;
        this.closeTransports();
        this.patchSnapshot({ connection: "offline" });
        await this.offlineRuntime?.close();
      },
      create: () => {
        const offline = this.createOptions.offline;
        const options: InternalClientOptions = this.persona !== undefined
          ? { url: this.url, as: this.persona, fetch: this.fetchImpl, offline, startOffline: this.forcedOffline,
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
    this.authState.stop();
    this.abortSync();
    this.operationFence += 1;
    this.closeTransports();
    this.patchSnapshot({ connection: "offline" });
    // Resolves once the carrier is quiet: a test or a shutdown that removes the
    // store's directory right after close() would otherwise race the last swap.
    this.closing = this.offlineRuntime?.close() ?? Promise.resolve();
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
    if (!current()) throw this.supersededRefusal();
    const result = await this.confirmAuth(authority);
    this.resumeAfterAuth();
    return result;
  }

  // @ref LLP 1012#7-writes-offline — confirmation after an interrupted startup
  // must recover program custody and resume the outbox without a mounted query.
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
    const { token, principal } = await restoreAuthToken(explicitToken, this.tokenStore,
      token => saveAuthToken(this.tokenStore, token, (action, error) => storageRefusal(this, action, error)), (action, error) => storageRefusal(this, action, error));
    if (this.closed) return;
    this.currentToken = token;
    if (token !== undefined && principal) this.currentPrincipal = principal as Principal;
    this.authGeneration += 1;
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
  private async manifestFor(authority: Authority, signal?: AbortSignal): Promise<Manifest> {
    throwIfAborted(signal);
    const value = wireManifest(await this.json("/api/manifest", { signal }, authority));
    throwIfAborted(signal);
    this.validated(authority);
    this.patchSnapshot({ generation: value.generation });
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
      if (!force && isSnapbackRefusal(error) && error.retryable) return;
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
        if (!isSnapbackRefusal(error) || error.status !== 404) throw error;
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

  networkRefusal(message: string): SnapbackRefusal {
    const refusal = new SnapbackRefusal(fallbackRefusal("E_NETWORK", message), true);
    this.patchSnapshot({ connection: this.transportFailureState(), lastRefusal: refusal.envelope });
    return refusal;
  }

  transportRefusal(message: string): SnapbackRefusal {
    const refusal = new SnapbackRefusal(fallbackRefusal("E_TRANSPORT", message), true);
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
      const refusal = new SnapbackRefusal(
        fallbackRefusal("E_NETWORK", error instanceof Error ? error.message : String(error)),
        true,
      );
      this.patchSnapshot({ connection: this.transportFailureState(), lastRefusal: refusal.envelope });
      throw refusal;
    }
    if (!authRestoration) throwIfAborted(init.signal);
    if (!response.ok) {
      if (response.status >= 400 && response.status < 500) {
        let refusal: SnapbackRefusal;
        try {
          refusal = await responseRefusal(response);
        } catch (error) {
          throwIfAborted(init.signal);
          if (isSnapbackRefusal(error)) {
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
      const refusal = new SnapbackRefusal(
        fallbackRefusal("E_TRANSPORT", `${path} returned HTTP ${response.status}`),
        true,
      );
      this.patchSnapshot({ connection: this.transportFailureState(), lastRefusal: refusal.envelope });
      throw refusal;
    }
    let value: unknown;
    try {
      value = await response.json();
    } catch {
      throwIfAborted(init.signal);
      if (enforceAuthority) this.ensureAuthority(authority);
      else this.ensureOpen();
      const refusal = wireShape(`${path} must contain valid JSON`);
      this.recordRefusal(refusal.envelope);
      throw refusal;
    }
    if (!authRestoration) throwIfAborted(init.signal);
    let terminal: RefusalEnvelope | undefined;
    try {
      terminal = terminalSession !== "keep" ? terminalSessionEnvelope(value) : undefined;
    } catch (error) {
      throwIfAborted(init.signal);
      if (enforceAuthority) this.ensureAuthority(authority);
      else this.ensureOpen();
      throw error;
    }
    if (terminal && (terminalSession === "expire" || (enforceAuthority && !this.authorityCurrent(authority)))) {
      return this.refuseJson(new SnapbackRefusal(terminal), authority, init.signal, options);
    }
    if (enforceAuthority) this.ensureAuthority(authority);
    else this.ensureOpen();
    throwIfAborted(init.signal);
    this.patchSnapshot({ connection: "connected" });
    return value;
  }

  // @ref LLP 1012#7-writes-offline — typed session terminals and HTTP refusals stop before settlement; cancellation preserves the exact queued envelope.
  private async refuseJson(refusal: SnapbackRefusal, authority: Authority, signal: AbortSignal | null | undefined, options: JsonRequestOptions): Promise<never> {
    const { enforceAuthority = true, terminalSession = "expire", authRestoration = false } = options;
    // @ref LLP 1002#9-the-client-snapback2client-snapback2react-snapback2test — me() retains late terminal evidence across cancellation.
    if (!authRestoration) throwIfAborted(signal);
    const wasCurrent = !enforceAuthority || this.authorityCurrent(authority);
    const expire = terminalSession !== "keep" && terminalSession !== "after-cleanup" && isTerminalSession(refusal.envelope);
    let expiration: SessionExpiration | undefined;
    if (terminalSession !== "keep" && authority.token !== undefined && isTerminalSession(refusal.envelope) && (expire || !wasCurrent)) {
      expiration = await this.expireSession(authority, { signal, fromAuth: authRestoration && this.authorityCurrent(authority) });
    }
    if (enforceAuthority && (!wasCurrent || (expiration !== undefined && !this.expirationCurrent(expiration)))) throw this.supersededRefusal();
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
      if (isSnapbackRefusal(error) && isTerminalSession(error.envelope)) throw error;
      // An aborted transport can still settle when a custom fetch ignores its
      // signal. Fence it before interpreting or publishing the late result.
      this.ensureAuthority(authority);
      if (signal.aborted) throw error;
      if (isSnapbackRefusal(error)) {
        this.patchSnapshot({
          connection: error.retryable ? this.transportFailureState() : "connected",
          lastRefusal: error.envelope,
        });
        throw error;
      }
      const refusal = new SnapbackRefusal(
        fallbackRefusal("E_NETWORK", error instanceof Error ? error.message : String(error)),
        true,
      );
      this.patchSnapshot({ connection: this.transportFailureState(), lastRefusal: refusal.envelope });
      throw refusal;
    }
  }
  private async subscriptionError(
    error: unknown,
    authority: Authority | undefined,
    origin: Subscription<unknown>,
  ): Promise<{ event?: RefusedDelivery; retry: boolean; refusal?: SnapbackRefusal }> {
    const refusal = isSnapbackRefusal(error)
      ? error
      : new SnapbackRefusal(
          fallbackRefusal("E_NETWORK", error instanceof Error ? error.message : String(error)),
          true,
        );
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
          return { retry: false, refusal: this.supersededRefusal() };
        }
        const terminal = isSnapbackRefusal(error)
          ? error
          : new SnapbackRefusal({
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
        return { retry: false, refusal: this.supersededRefusal() };
      }
      if (!wasCurrent || !this.expirationCurrent(expiration)) {
        return { retry: false, refusal: this.supersededRefusal() };
      }
    }
    if (this.closed) {
      return { retry: false, refusal: this.supersededRefusal() };
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
    try {
      const changed = this.offlineRuntime.principal !== principal;
      await this.offlineRuntime.open(principal, authenticated);
      if (authenticated) await this.offlineRuntime.reauthenticate(principal, authEpoch);
      if (changed) {
        this.supersessionQueries.clear();
        this.offlineMetadataLoaded = false;
      }
    } catch (error) {
      // @ref LLP 1018#3-move-one-one-coherent-reactive-client — on web a held writer lock makes this
      // client a follower: live reads, refused writes, the partition and its queue inherited on close.
      const code = error && typeof error === "object" ? (error as { code?: unknown }).code : undefined;
      if (code === "E_OFFLINE_LOCK" && this.offlineRuntime.canFollow) {
        this.follower.begin(principal, authenticated, authEpoch);
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
      if (!(isSnapbackRefusal(error)
        && (error.retryable || error.code === "E_OFFLINE_RESUME" || error.code === "E_OFFLINE_RESET"))) throw error;
    }
    return authority;
  }

  private async sealOffline(): Promise<void> {
    if (!this.offlineRuntime) return;
    try { await this.offlineRuntime.seal(); }
    catch (error) { throw this.offlineRefusal(error, "RangeStore.seal"); }
  }

  private async wipeOffline(): Promise<void> {
    if (!this.offlineRuntime) return;
    // A follower owns no partition: sign-out withdraws its wait and touches nothing the writer tab holds.
    this.follower.stop();
    this.abortSync();
    this.supersessionQueries.clear();
    try { await this.offlineRuntime.wipe(); this.currentPrincipal = undefined; }
    catch (error) { throw this.offlineRefusal(error, "RangeStore.wipe"); }
  }

  /** A live read never waits for reset. online() joins it and reports its outcome. */
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
      if (reset) for (const item of this.mounted.values()) {
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
          method: "POST", body: JSON.stringify({ op: item.op, args: item.args }),
        });
        check();
        const accepted = await acceptOffline(runtime, item.op, item.args, raw, wireShape);
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
    throw new SnapbackRefusal({
      code: "E_OFFLINE_RESET", family: "offline", message: "the program changed during three coverage rebuild attempts",
      site: "client.resume", rewrite: "retry online() after the program stops rotating", guide: "offline",
    });
  }

  private async drainNow(captured?: Authority): Promise<DrainResult> {
    await this.localReady;
    if (this.forcedOffline) {
      const remaining = (await this.offlineRuntime?.queuedIntents())?.length ?? 0;
      const reason = await this.offlineRuntime?.outbox.fence() === "past" ? "fence" : "offline";
      if (this.offlineRuntime) this.offlineRuntime.drainOutcome = Promise.resolve({ stopped: reason, remaining });
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

  async terminalRefusal(authority: Authority, refusal: RefusalEnvelope, options: { preserveOutcome?: boolean } = {}): Promise<void> {
    // Discard first; cleanup expiry preserves the already settled outcome.
    const wasCurrent = this.authorityCurrent(authority);
    const expiration = await this.expireSession(authority);
    if (expiration.cleared ? (!wasCurrent || !this.expirationCurrent(expiration)) : (!wasCurrent && !options.preserveOutcome)) throw this.supersededRefusal();
    this.recordRefusal(refusal);
  }

  private offlineRefusal(error: unknown, site = "client.offline"): SnapbackRefusal {
    const carrier = this.createOptions?.offline?.store.carrier
      ?? this.createOptions?.offline?.store.name
      ?? "configured";
    const refusal = makeOfflineRefusal(error, carrier, site);
    this.recordRefusal(refusal.envelope);
    return refusal;
  }

  recordRefusal(envelope: RefusalEnvelope): void {
    this.patchSnapshot({ lastRefusal: envelope });
  }

  validated(authority: Authority | undefined): void {
    if (authority !== undefined) this.ensureAuthority(authority);
    else this.ensureOpen();
    if (!this.forcedOffline) this.patchSnapshot({ connection: "connected", lastRefusal: this.resetRefusal });
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
      this.abortSync(options.signal);
      if (!options.fromAuth) this.authState.reset({ state: "hydrating" });
      const fence = this.operationFence;
      const authGeneration = this.authGeneration + 1;
      this.closeTransports(options.origin);
      let sealFailure: unknown;
      let anonymous = false;
      try {
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
    let failure: SnapbackRefusal | undefined;
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

  private trackWrite<Result>(run: () => Promise<Result>): Promise<Result> {
    // A follower tab's write is refused here, ahead of uploads, cleanup, and channel publishes alike.
    if (this.offlineRuntime?.following) return Promise.reject(followerRefusal("client.write"));
    const request = run();
    this.writes.add(request as Promise<unknown>);
    void request.finally(() => this.writes.delete(request as Promise<unknown>)).catch(() => undefined);
    return request;
  }

  private async settleWrites(): Promise<void> {
    while (this.writes.size > 0) await Promise.allSettled([...this.writes]);
  }

  private closeTransports(except?: Subscription<unknown>): void {
    this.live.close();
    this.shared.clear(except);
    for (const subscription of [...this.subscriptions]) {
      if (subscription !== except) subscription.close();
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
      throw this.supersededRefusal();
    }
  }

  private supersededRefusal(): SnapbackRefusal {
    return new SnapbackRefusal({
      code: "E_AUTH_SUPERSEDED",
      family: "auth",
      message: "operation belonged to a previous authentication generation",
      guide: "auth/session",
    });
  }

  private ensureOpen(): void {
    if (this.closed) {
      throw new SnapbackRefusal({
        code: "E_CLIENT_CLOSED",
        family: "owner",
        message: "client is closed",
        guide: "owner/connect",
      });
    }
  }

  private publishAuthSnapshot(): void {
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
