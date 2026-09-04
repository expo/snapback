import { api, referenceName, type Api, type ApiProxy, type Channel as ChannelRef, type Op } from "./api.js";
import { AssetInputError, mayNeedAssetPlanning, planAssetArguments, substituteAssetRecords } from "./assets.js";
import { captureGrant, createOutboxApi, drainOutbox, submitMutation } from "./client-outbox.js";
import {
  acceptOffline,
  answerOffline,
  commitOffline,
  createOfflineDrain,
  createOfflineRuntime,
  decodeOfflineSubscription,
  goOffline,
  goOnline,
  initializeOfflineClient,
  offlineNetworkRefusal,
  offlineRefusal as makeOfflineRefusal,
  performOfflineResume,
  restartOffline,
  settleSubscription,
  validateOfflineOptions,
} from "./client-offline.js";
import {
  assetBlobFor,
  assetHeadersFor,
  assetInput,
  assetUrlFor,
  uploadAsset,
  uploadPrepared,
  type Authority,
} from "./client-upload.js";
import {
  SnapbackRefusal,
  copyRefusal,
  fallbackRefusal,
  isSnapbackRefusal,
  isTerminalSession,
  responseRefusal,
  sseObject,
  terminalSessionEnvelope,
  wireAuthMe,
  wireAuthSession,
  wireChannelDelivery,
  wireChannelPublish,
  wireLogout,
  wireManifest,
  wireQuery,
  wireShape,
  wireSubscription,
} from "./client-wire.js";
import { type OfflineRuntime, type MountedQuery } from "./offline.js";
import { ReconnectingSse } from "./sse.js";
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
  ChannelDelivery,
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
  readonly url: string;
  readonly fetchImpl: typeof globalThis.fetch;
  readonly customFetch: boolean;
  private readonly tokenStore?: AuthTokenStore;
  readonly persona?: string;
  private readonly createOptions: InternalClientOptions;
  private readonly offlineRuntime?: OfflineRuntime;
  private readonly mounted = new Map<string, MountedQuery>();
  private offlineMetadataLoaded = false;
  private resumeTail: Promise<void> = Promise.resolve();
  private forcedOffline = false;
  private currentToken?: string;
  private currentPrincipal?: Principal;
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
    this.fetchImpl = options.fetch ?? globalThis.fetch;
    this.customFetch = options.fetch !== undefined;
    if (typeof this.fetchImpl !== "function") throw new TypeError("createClient requires a fetch implementation");
    this.tokenStore = options.tokenStore;
    this.persona = options.as;
    this.forcedOffline = options.startOffline === true;
    this.currentSnapshot = { authGeneration: 0, persona: options.as, connection: this.forcedOffline ? "offline" : "reconnecting" };
    validateOfflineOptions(options.offline);
    try {
      this.offlineRuntime = createOfflineRuntime(options.offline);
    } catch (error) {
      throw this.offlineRefusal(error);
    }
    this.outbox = createOutboxApi(this.offlineRuntime, () => this.drainNow(), () => this.ready);
    this.auth = {
      signup: (input: { email: string; password: string }) => this.session("/api/auth/signup", input),
      login: (input: { email: string; password: string }) => this.session("/api/auth/login", input),
      guest: () => this.session("/api/auth/guest", {}),
      logout: () => this.logout(),
      me: () => this.me(),
    };
    this.ready = this.hydrate(options.token).then(() => this.initializeOffline());
  }

  get snapshot(): ClientSnapshot {
    return this.currentSnapshot;
  }

  async query<Args, Result>(ref: Op<Args, Result>, args: Args): Promise<QueryResult<Result>> {
    const authority = await this.operationAuthority();
    const op = referenceName(ref);
    if (this.forcedOffline) {
      this.patchSnapshot({ connection: "offline" });
      return answerOffline(this.offlineRuntime, op, args, (error) => this.offlineRefusal(error));
    }
    await this.ensureOfflineMetadata(authority);
    let backoff = 50;
    for (let attempt = 1; ; attempt += 1) {
      try {
        const held = await this.offlineRuntime?.answer(op, args);
        const raw = await this.json(this.offlineRuntime ? "/api/query?receipt=1" : "/api/query", {
          method: "POST",
          body: JSON.stringify(this.offlineRuntime && held?.validator ? { op, args, validator: held.validator } : { op, args }),
        }, authority);
        const accepted = await acceptOffline<Result>(this.offlineRuntime, op, args, raw, wireShape);
        const result = wireQuery<Result>(accepted.result);
        await commitOffline(this.offlineRuntime, op, args, accepted, (error) => this.offlineRefusal(error));
        if (this.offlineRuntime && this.createOptions.offlineReadObserver) {
          const held = await answerOffline<Result>(
            this.offlineRuntime,
            op,
            args,
            (error) => this.offlineRefusal(error),
          );
          this.createOptions.offlineReadObserver(ref, args, held);
        }
        this.validated(authority);
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
        let mutationArgs: unknown = args;
        if (mayNeedAssetPlanning(args)) {
          // @ref LLP 1006#10-clients — the descriptor fence binds substitution
          // to the manifest read here. The owner independently validates the
          // resulting records against its live generation on every request.
          const operation = referenceName(ref);
          const descriptorManifest = await this.manifestFor(authority);
          const descriptor = descriptorManifest.ops[operation]?.args;
          if (descriptor === undefined) {
            throw assetInput(this, new AssetInputError(
              "E_ASSET_TYPE",
              `manifest generation ${descriptorManifest.generation} has no argument descriptor for ${operation}`,
            ));
          }
          const placements = await planAssetArguments(args, descriptor)
            .catch((error) => { throw assetInput(this, error); });
          if (placements.length > 0) {
            const records: AssetRecord[] = [];
            for (const placement of placements) {
              records.push(await uploadPrepared(this, placement.prepared, {}, authority));
            }
            const current = await this.manifestFor(authority);
            if (current.generation !== descriptorManifest.generation) {
              throw assetInput(this, new AssetInputError(
                "E_ASSET_NOT_READY",
                `descriptor generation changed from ${descriptorManifest.generation} to ${current.generation} during asset upload`,
              ));
            }
            mutationArgs = substituteAssetRecords(args, placements, records);
          }
        }
        const result = await submitMutation<Result>({
          runtime: this.offlineRuntime, offline: this.forcedOffline, op: referenceName(ref), args: mutationArgs,
          json: (path, init) => this.json(path, init, authority), failure: (error) => this.offlineRefusal(error),
          drain: () => this.drainNow(),
        });
        if (result.state === "rejected" && isTerminalSession(result)) {
          const wasCurrent = this.authorityCurrent(authority);
          const expiration = await this.expireSession(authority);
          if (!wasCurrent || !this.expirationCurrent(expiration)) throw this.supersededRefusal();
          this.recordRefusal(result);
          return result;
        }
        this.validated(authority);
        return result;
      } catch (error) {
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
    return this.trackWrite(() => uploadAsset(this, source, options, authority));
  }

  async assetUrl(asset: AssetRecord | null | undefined, options?: AssetUrlOptions): Promise<string | undefined>;
  async assetUrl(assets: readonly AssetRecord[], options?: AssetUrlOptions): Promise<string[]>;
  async assetUrl(
    assetOrList: AssetRecord | readonly AssetRecord[] | null | undefined,
    options: AssetUrlOptions = {},
  ): Promise<string | string[] | undefined> {
    const authority = await this.operationAuthority();
    return assetUrlFor(this, assetOrList, options, authority);
  }

  async assetHeaders(): Promise<Record<string, string>> {
    return assetHeadersFor(this, await this.operationAuthority());
  }

  async assetBlob(url: string, options: { signal?: AbortSignal } = {}): Promise<Blob> {
    const authority = await this.operationAuthority();
    return assetBlobFor(this, this.offlineRuntime?.bytes, this.forcedOffline, url, options, authority);
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
    if (options.drain) return this.drain(ref, args, callback);
    return this.subscribeRegular(ref, args, callback);
  }

  private subscribeRegular<Args, Result>(
    ref: Op<Args, Result>,
    args: Args,
    callback: (delivery: SubscriptionDelivery<Result>) => void,
  ): Subscription<SubscriptionDelivery<Result>> {
    const op = referenceName(ref);
    const mountedKey = `${op}\u0000${stableSerialize(args)}`;
    this.mounted.set(mountedKey, { op, args, drain: false });
    let lastPair: { seq: number; data?: Result } | undefined;
    let authority: Authority | undefined;
    let subscription: Subscription<SubscriptionDelivery<Result>>;
    const finish = (value: LiveQueryDelivery<Result> | QueryRefusedDelivery) => {
      lastPair = settleSubscription(value, () => this.ensureAuthority(authority), (patch) => this.patchSnapshot(patch));
      return value;
    };
    subscription = new ReconnectingSse<SubscriptionDelivery<Result>>({
      open: async (lastEventId, signal) => {
        authority ??= await this.operationAuthority();
        if (this.forcedOffline) throw offlineNetworkRefusal();
        await this.ensureOfflineMetadata(authority);
        const held = await this.offlineRuntime?.answer(op, args);
        let path = `/api/subscribe?op=${encodeURIComponent(op)}&args=${encodeURIComponent(JSON.stringify(args))}`;
        if (this.offlineRuntime) path += "&receipt=1";
        if (held?.validator) path += `&validator=${encodeURIComponent(held.validator)}`;
        return this.stream(path, lastEventId, signal, authority);
      },
      decode: ({ data }) => {
        if (!this.offlineRuntime) return finish(wireSubscription<Result>(data));
        return decodeOfflineSubscription<Result>({
          runtime: this.offlineRuntime, op, args, data, shape: wireShape,
          failure: (error) => this.offlineRefusal(error),
          observe: this.createOptions.offlineReadObserver
            ? async () => this.createOptions.offlineReadObserver!(
                ref,
                args,
                await answerOffline(this.offlineRuntime, op, args, (error) => this.offlineRefusal(error)),
              )
            : undefined,
        }).then(finish);
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
            (failure) => this.offlineRefusal(failure),
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
    const close = tracked.close.bind(tracked);
    tracked.close = () => {
      this.mounted.delete(mountedKey);
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
      query: (pageArgs: Args) => this.query(ref, pageArgs),
      subscribe: (tailArgs, onEvent) => this.subscribeRegular(ref, tailArgs, onEvent),
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
    const path = referenceName(ref);
    const name = encodeURIComponent(path.startsWith("channels.") ? path.slice("channels.".length) : path);
    return {
      publish: async (payload: Payload) => {
        const authority = await this.operationAuthority();
        return this.trackWrite(async () => {
          const result = wireChannelPublish(await this.json(`/api/channel/${name}/publish`, {
            method: "POST",
            body: JSON.stringify({ args, payload }),
          }, authority));
          if ("state" in result) {
            if (isTerminalSession(result)) {
              const wasCurrent = this.authorityCurrent(authority);
              const expiration = await this.expireSession(authority);
              if (!wasCurrent || !this.expirationCurrent(expiration)) throw this.supersededRefusal();
            }
            this.recordRefusal(result);
          } else {
            this.validated(authority);
          }
          return result;
        });
      },
      subscribe: (callback: (event: ChannelDelivery<Payload>) => void) => {
        const path = `/api/channel/${name}/subscribe?args=${encodeURIComponent(JSON.stringify(args))}`;
        let authority: Authority | undefined;
        let subscription: Subscription<ChannelDelivery<Payload>>;
        subscription = new ReconnectingSse<ChannelDelivery<Payload>>({
          open: async (lastEventId, signal) => {
            authority ??= await this.operationAuthority();
            return this.stream(path, lastEventId, signal, authority);
          },
          decode: ({ data }) => {
            const value = wireChannelDelivery<Payload>(data);
            if ("state" in value && value.state === "refused" && isTerminalSession(value)) {
              throw new SnapbackRefusal(copyRefusal(value));
            }
            this.ensureAuthority(authority);
            this.patchSnapshot({
              connection: "connected",
              lastRefusal: "state" in value && value.state === "refused"
                ? copyRefusal(value)
                : undefined,
            });
            return value;
          },
          bufferedTerminal: ({ data }) => {
            const value = wireChannelDelivery<Payload>(data);
            return "state" in value && value.state === "refused" && isTerminalSession(value)
              ? new SnapbackRefusal(copyRefusal(value))
              : undefined;
          },
          onError: async (error) => {
            const decision = await this.subscriptionError(error, authority, subscription);
            return { retry: decision.retry, event: decision.event, failure: decision.refusal };
          },
          onLoss: () => {
            if (!this.authorityCurrent(authority)) return undefined;
            this.patchSnapshot({ connection: this.transportFailureState() });
            return undefined;
          },
          terminal: (event) => "state" in event && event.state === "refused"
            ? new SnapbackRefusal(copyRefusal(event))
            : undefined,
          onEvent: callback,
        });
        return this.track(subscription);
      },
    };
  }

  async manifest(): Promise<Manifest> {
    const authority = await this.operationAuthority();
    return this.manifestFor(authority);
  }

  async offline(): Promise<void> {
    return goOffline({
      ready: this.ready,
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
    this.ensureBearerTransition(path.slice("/api/auth/".length));
    return this.transition(async (authority) => {
      const session = wireAuthSession(
        captureGrant(this.offlineRuntime, await this.json(path, { method: "POST", body: JSON.stringify(input) }, authority, false, false)),
        `${path.slice("/api/".length)} response`,
      );
      await this.openOffline(session.viewer, true);
      await this.installToken(session.token);
      this.ensureOpen();
      // The program lands with the grant, so "log in, go offline, write" prices and predicts from custody.
      try {
        await this.ensureOfflineMetadata({
          authGeneration: this.authGeneration,
          custodyGeneration: this.custodyGeneration,
          fence: this.operationFence,
          token: this.currentToken,
        });
      } catch (error) {
        if (!isSnapbackRefusal(error) || !error.retryable) throw error;
      }
      this.validated(undefined);
      return session;
    });
  }

  private async logout(): Promise<{ ok: boolean }> {
    this.ensureBearerTransition("logout");
    return this.transition(async (authority) => {
      let result: { ok: boolean } | undefined;
      let requestFailure: unknown;
      try {
        result = wireLogout(await this.json(
          "/api/auth/logout",
          { method: "POST" },
          authority,
          false,
          false,
        ));
      } catch (error) {
        requestFailure = error;
      }
      let wipeFailure: unknown;
      try { await this.wipeOffline(); } catch (error) { wipeFailure = error; }
      await this.clearToken();
      this.ensureOpen();
      if (requestFailure !== undefined) throw requestFailure;
      if (wipeFailure !== undefined) throw wipeFailure;
      this.validated(undefined);
      return result as { ok: boolean };
    });
  }

  private async me(): Promise<AuthMe> {
    const authority = await this.operationAuthority();
    const result = wireAuthMe(await this.json("/api/auth/me", {}, authority));
    await this.openOffline(result.viewer, true);
    this.validated(authority);
    return result;
  }

  private async hydrate(explicitToken: string | undefined): Promise<void> {
    let token = explicitToken;
    let principal: string | null | undefined;
    if (token === undefined && this.tokenStore) {
      try {
        const [storedToken, storedPrincipal] = await Promise.all([
          this.tokenStore.load(), this.tokenStore.loadPrincipal?.(),
        ]);
        token = storedToken ?? undefined;
        principal = storedPrincipal;
      } catch (error) {
        throw this.storageRefusal("load", error);
      }
    }
    if (token !== undefined && (typeof token !== "string" || token.length === 0)) {
      throw this.storageRefusal("load", new TypeError("stored token must be a non-empty string or null"));
    }
    if (explicitToken !== undefined) await this.saveToken(token!);
    if (this.closed) return;
    this.currentToken = token;
    if (token !== undefined && principal) this.currentPrincipal = principal as Principal;
    this.authGeneration += 1;
    this.publishAuthSnapshot();
  }

  headers(authority: Authority, stream = false, hasBody = false): Headers {
    const headers = new Headers();
    headers.set("Accept", stream ? "text/event-stream" : "application/json");
    if (hasBody) headers.set("Content-Type", "application/json");
    if (authority.token) headers.set("Authorization", `Bearer ${authority.token}`);
    if (this.persona) headers.set("X-Snapback-As", this.persona);
    return headers;
  }

  private async manifestFor(authority: Authority): Promise<Manifest> {
    const value = wireManifest(await this.json("/api/manifest", {}, authority));
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
  private async ensureOfflineMetadata(authority: Authority, force = false): Promise<void> {
    if (!this.offlineRuntime || (this.offlineMetadataLoaded && !force)) return;
    let manifest: Manifest;
    // Unreachable at cold start: held answers and the outbox still serve; the metadata loads on the next reach.
    try { manifest = await this.manifestFor(authority); } catch (error) { if (isSnapbackRefusal(error) && error.retryable) return; throw error; }
    if (this.offlineRuntime.programGeneration !== manifest.programGeneration || force) {
      try {
        const program = await this.json(
          `/api/program?generation=${encodeURIComponent(manifest.programGeneration)}`,
          {},
          authority,
        );
        this.offlineRuntime.program(program);
      } catch (error) {
        if (!isSnapbackRefusal(error) || error.status !== 404) throw error;
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
    enforceAuthority = true,
    clearTerminalSession = true,
  ): Promise<unknown> {
    if (enforceAuthority) this.ensureAuthority(authority);
    else this.ensureOpen();
    if (this.forcedOffline) throw offlineNetworkRefusal();
    let response: Response;
    try {
      response = await this.fetchImpl(`${this.url}${path}`, {
        ...init,
        headers: this.headers(authority, false, init.body !== undefined && init.body !== null),
      });
    } catch (error) {
      if (enforceAuthority) this.ensureAuthority(authority);
      else this.ensureOpen();
      const refusal = new SnapbackRefusal(
        fallbackRefusal("E_NETWORK", error instanceof Error ? error.message : String(error)),
        true,
      );
      this.patchSnapshot({ connection: this.transportFailureState(), lastRefusal: refusal.envelope });
      throw refusal;
    }
    if (!response.ok) {
      if (response.status >= 400 && response.status < 500) {
        let refusal: SnapbackRefusal;
        try {
          refusal = await responseRefusal(response);
        } catch (error) {
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
        const wasCurrent = !enforceAuthority || this.authorityCurrent(authority);
        let expiration: SessionExpiration | undefined;
        if (clearTerminalSession && isTerminalSession(refusal.envelope)) {
          expiration = await this.expireSession(authority);
        }
        if (enforceAuthority && (!wasCurrent
          || (expiration !== undefined && !this.expirationCurrent(expiration)))) {
          throw this.supersededRefusal();
        }
        if (enforceAuthority && !(clearTerminalSession && isTerminalSession(refusal.envelope))) {
          this.ensureAuthority(authority);
        }
        else this.ensureOpen();
        this.patchSnapshot({ connection: "connected" });
        this.recordRefusal(refusal.envelope);
        throw refusal;
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
      if (enforceAuthority) this.ensureAuthority(authority);
      else this.ensureOpen();
      const refusal = wireShape(`${path} must contain valid JSON`);
      this.recordRefusal(refusal.envelope);
      throw refusal;
    }
    let terminal: RefusalEnvelope | undefined;
    try {
      terminal = clearTerminalSession ? terminalSessionEnvelope(value) : undefined;
    } catch (error) {
      if (enforceAuthority) this.ensureAuthority(authority);
      else this.ensureOpen();
      throw error;
    }
    if (terminal !== undefined && enforceAuthority && !this.authorityCurrent(authority)) {
      await this.expireSession(authority);
      throw this.supersededRefusal();
    }
    if (enforceAuthority) this.ensureAuthority(authority);
    else this.ensureOpen();
    this.patchSnapshot({ connection: "connected" });
    return value;
  }

  private async stream(
    path: string,
    lastEventId: string | undefined,
    signal: AbortSignal,
    authority: Authority,
  ): Promise<Response> {
    this.ensureAuthority(authority);
    if (this.forcedOffline) throw offlineNetworkRefusal();
    const headers = this.headers(authority, true);
    if (lastEventId !== undefined) headers.set("Last-Event-ID", lastEventId);
    try {
      const response = await this.fetchImpl(`${this.url}${path}`, { headers, signal });
      if (!response.ok) {
        if (response.status >= 400 && response.status < 500) {
          let refusal: SnapbackRefusal | undefined;
          try {
            refusal = await responseRefusal(response);
          } catch (error) {
            if (isSnapbackRefusal(error) && !error.retryable) throw error;
            // A non-envelope 4xx cannot be interpreted as a terminal owner refusal.
          }
          if (refusal !== undefined) {
            if (isTerminalSession(refusal.envelope)
              && (signal.aborted || !this.authorityCurrent(authority))) {
              await this.expireSession(authority);
              throw this.supersededRefusal();
            }
            if (!isTerminalSession(refusal.envelope)) this.ensureAuthority(authority);
            throw refusal;
          }
        }
        this.ensureAuthority(authority);
        throw new SnapbackRefusal(
          fallbackRefusal("E_HTTP", `${path} returned HTTP ${response.status}`),
          true,
        );
      }
      this.ensureAuthority(authority);
      signal.throwIfAborted();
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
        expiration = await this.expireSession(authority, origin);
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
    const authority = {
      authGeneration: this.authGeneration,
      custodyGeneration: this.custodyGeneration,
      fence: this.operationFence,
      token: this.currentToken,
    };
    return initializeOfflineClient({
      principal: this.persona === undefined
        ? this.createOptions.offlinePrincipal ?? this.currentPrincipal
        : `dev:${this.persona}` as Principal,
      bearer: this.persona === undefined && this.currentToken !== undefined,
      authority,
      open: (principal, authenticated) => this.openOffline(principal, authenticated),
      confirm: async (current) => wireAuthMe(await this.json("/api/auth/me", {}, current)).viewer,
      metadata: (current) => this.ensureOfflineMetadata(current),
      resume: (current) => this.performResume(current),
      ignore: (error) => isSnapbackRefusal(error) && (error.retryable || error.code === "E_OFFLINE_RESUME"),
    });
  }

  private async openOffline(principal: Principal, authenticated = false): Promise<void> {
    if (!this.offlineRuntime) return;
    try {
      const changed = this.offlineRuntime.principal !== principal;
      await this.offlineRuntime.open(principal, authenticated);
      if (authenticated) await this.offlineRuntime.reauthenticate(principal);
      this.currentPrincipal = principal;
      if (changed) this.offlineMetadataLoaded = false;
    } catch (error) {
      throw this.offlineRefusal(error);
    }
  }

  private async sealOffline(): Promise<void> {
    if (!this.offlineRuntime) return;
    try { await this.offlineRuntime.seal(); }
    catch (error) { throw this.offlineRefusal(error); }
  }

  private async wipeOffline(): Promise<void> {
    if (!this.offlineRuntime) return;
    try { await this.offlineRuntime.wipe(); this.currentPrincipal = undefined; }
    catch (error) { throw this.offlineRefusal(error); }
  }

  private async performResume(authority: Authority): Promise<void> {
    if (!this.offlineRuntime || this.forcedOffline) return;
    await this.ensureOfflineMetadata(authority);
    try {
      await performOfflineResume({
        runtime: this.offlineRuntime,
        mounted: this.mounted,
        authority,
        bearerConfirmed: authority.token !== undefined,
        json: (path, init, current) => this.json(path, init, current),
        validated: (current) => this.validated(current),
        shape: wireShape,
        failure: (error) => this.offlineRefusal(error),
        subscriptions: this.subscriptions,
        reload: (current) => this.ensureOfflineMetadata(current, true),
      });
    } catch (error) {
      // Local no-facts refusals never pass through json(). Publish them on cold
      // initialization as well as online(), without making ready unusable.
      if (isSnapbackRefusal(error) && this.authorityCurrent(authority)) this.recordRefusal(error.envelope);
      throw error;
    }
  }

  private async drainNow(): Promise<{ stopped: boolean; reason?: "fence" }> {
    const authority = await this.operationAuthority();
    if (!this.offlineRuntime) return { stopped: false };
    return drainOutbox({ runtime: this.offlineRuntime, json: (path, init) => this.json(path, init, authority),
      shape: wireShape, failure: (error) => this.offlineRefusal(error) });
  }

  private offlineRefusal(error: unknown): SnapbackRefusal {
    const carrier = this.createOptions?.offline?.store.carrier
      ?? this.createOptions?.offline?.store.name
      ?? "configured";
    const refusal = makeOfflineRefusal(error, carrier);
    this.recordRefusal(refusal.envelope);
    return refusal;
  }

  recordRefusal(envelope: RefusalEnvelope): void {
    this.patchSnapshot({ lastRefusal: envelope });
  }

  validated(authority: Authority | undefined): void {
    if (authority !== undefined) this.ensureAuthority(authority);
    else this.ensureOpen();
    this.patchSnapshot({ connection: "connected", lastRefusal: undefined });
  }

  private async operationAuthority(): Promise<Authority> {
    await this.ready;
    while (true) {
      const transition = this.transitionTail;
      await transition;
      if (transition === this.transitionTail) break;
    }
    await this.resumeTail;
    this.ensureOpen();
    return {
      authGeneration: this.authGeneration,
      custodyGeneration: this.custodyGeneration,
      fence: this.operationFence,
      token: this.currentToken,
    };
  }

  private transition<T>(
    action: (authority: Authority) => Promise<T>,
    waitForWrites = true,
    except?: Subscription<unknown>,
  ): Promise<T> {
    this.operationFence += 1;
    this.closeTransports(except);
    const run = this.transitionTail.then(async () => {
      await this.ready;
      this.ensureOpen();
      if (waitForWrites) await this.settleWrites();
      const authority: Authority = {
        authGeneration: this.authGeneration,
        custodyGeneration: this.custodyGeneration,
        fence: this.operationFence,
        token: this.currentToken,
      };
      try {
        return await action(authority);
      } finally {
        this.authGeneration += 1;
        this.publishAuthSnapshot();
      }
    });
    this.transitionTail = run.then(() => undefined, () => undefined);
    return run;
  }

  private async expireSession(authority: Authority, origin?: Subscription<unknown>): Promise<SessionExpiration> {
    if (authority.token === undefined) return { cleared: false };
    return this.custody(async () => {
      if (this.currentToken !== authority.token
        || this.custodyGeneration !== authority.custodyGeneration) return { cleared: false };
      this.operationFence += 1;
      const fence = this.operationFence;
      const authGeneration = this.authGeneration + 1;
      this.closeTransports(origin);
      let sealFailure: unknown;
      try {
        try { await this.sealOffline(); } catch (error) { sealFailure = error; }
        await this.clearTokenNow();
        if (sealFailure !== undefined) throw sealFailure;
      } finally {
        this.authGeneration += 1;
        this.publishAuthSnapshot();
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

  private async installToken(token: string): Promise<void> {
    await this.custody(async () => {
      this.ensureOpen();
      await this.saveToken(token);
      await this.tokenStore?.savePrincipal?.(this.currentPrincipal ?? null);
      // Commit replacement custody only after durable persistence succeeds,
      // but before close can prevent its in-memory installation. Predecessor
      // evidence may clear a failed save; it cannot erase a completed one.
      this.custodyGeneration += 1;
      // Persistence may have outlived close(). Retain the durable token for a
      // future client restore, but never resurrect this closed instance.
      this.ensureOpen();
      this.currentToken = token;
    });
  }

  private custody<Result>(action: () => Promise<Result>): Promise<Result> {
    const run = this.custodyTail.then(action);
    this.custodyTail = run.then(() => undefined, () => undefined);
    return run;
  }

  private async saveToken(token: string): Promise<void> {
    if (!this.tokenStore) return;
    try {
      await this.tokenStore.save(token);
    } catch (error) {
      throw this.storageRefusal("save", error);
    }
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
        failure = this.storageRefusal("clear", error);
      }
    }
    this.currentToken = undefined;
    this.currentPrincipal = undefined;
    if (failure) throw failure;
  }

  private storageRefusal(action: string, error: unknown): SnapbackRefusal {
    const refusal = new SnapbackRefusal({
      code: "E_AUTH_TOKEN_STORE",
      family: "auth",
      message: `token store ${action} failed: ${error instanceof Error ? error.message : String(error)}`,
      guide: "auth/session",
    });
    this.recordRefusal(refusal.envelope);
    return refusal;
  }

  private ensureBearerTransition(action: string): void {
    if (this.persona === undefined) return;
    const refusal = new SnapbackRefusal({
      code: "E_AUTH_PERSONA_TRANSITION",
      family: "auth",
      message: `dev persona clients cannot ${action} a bearer session`,
      guide: "auth/personas",
    });
    this.recordRefusal(refusal.envelope);
    throw refusal;
  }

  private trackWrite<Result>(run: () => Promise<Result>): Promise<Result> {
    const request = run();
    this.writes.add(request as Promise<unknown>);
    void request.finally(() => this.writes.delete(request as Promise<unknown>)).catch(() => undefined);
    return request;
  }

  private async settleWrites(): Promise<void> {
    while (this.writes.size > 0) await Promise.allSettled([...this.writes]);
  }

  private closeTransports(except?: Subscription<unknown>): void {
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
    this.patchSnapshot({ authGeneration: this.authGeneration, token: this.currentToken });
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
    this.currentSnapshot = next;
    for (const listener of this.statusListeners) {
      try {
        listener(next);
      } catch {
        // Application observers cannot turn a validated client operation into a refusal.
      }
    }
    return next;
  }
}

// @ref LLP 1002#9-the-client-snapback2client-snapback2react-snapback2test — one small headless client speaks the owner wire directly.
export function createClient(options: CreateClientOptions): SnapbackClient {
  return new Client(options);
}
