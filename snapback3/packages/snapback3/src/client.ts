import { referenceName, type Op } from './api.js';
import { acquisitionState, canonicalDeclarations, chainValue, declarationIdentity, envelopeFromStored, pages,
  resolveChain, restoreAcquiredPool, storedResource, type AcquisitionSpec, type PageChain } from './resource/acquisition.js';
import { FactPool, queryKey, snapshot, taggedArgs, validateManifest } from './resource/facts.js';
import { isSha256 } from '../../evaluator/src/hash.js';
import { decodeDeliveryMessage, ownDeliveryEnvelope, type DeliveryEnvelopeV1, type DeliveryUnchanged } from './resource/protocol.js';
import { checkedStoredOperation } from './resource/operation.js';
import { DatasetAcquisition, Intent, loading, Resource } from './resource/handles.js';
import { PendingQueryCoordinator, type PredictionUpdate } from './resource/prediction.js';
import { rowReferences } from './resource/row-values.js';
import { canonicalJson } from '../../evaluator/src/value-runtime.js';
import { deferred, errorOf, ownJson, Signal } from './resource/signal.js';
import { createIndexedDBStorage, createMemoryStorage } from './resource/storage.js';
import { normalizeOwnerUrl, platformId, storageJob, timer, type ClientPlatformDefaults } from './client-platform.js';
import { SnapbackError, type Acquisition, type AcquisitionDeclaration, type AcquisitionSnapshot, type Args,
  type ClientSnapshot, type ClientStorage, type Manifest,
  type MutationReceipt, type Operation, type OperationSnapshot, type QueryResource, type ResourceSnapshot,
  type Session, type StoragePatch, type StoredAcquisition, type StoredAcquisitionResource,
  type StoredAcquisitionRow, type StoredOperation } from './resource/types.js';

export { api, referenceName } from './api.js';
export type { Op, Channel, Api, ArgsOf, ResultOf } from './api.js';
export { createIndexedDBStorage, createMemoryStorage, pages, SnapbackError };
export type { AcquisitionSpec, PageChain };
export type { Acquisition, AcquisitionSnapshot, ClientSnapshot, ClientStorage, MutationReceipt, Operation, OperationSnapshot,
  PendingResourceItem, QueryResource, ResourceSnapshot, Session, StoragePatch, StoredState } from './resource/types.js';

export interface ClientOptions {
  url: string;
  storage?: ClientStorage | false;
  fetch?: typeof globalThis.fetch;
  /** Secure identity source for hosts without Web Crypto. Expo supplies expo-crypto by default. */
  idFactory?: () => string;
  /** Disable the event connection for a request-only host. Queries and writes still work. */
  live?: boolean;
}
export type { ClientPlatformDefaults } from './client-platform.js';

const nameOf = (ref: string | Op<any, any, any>): string => typeof ref === 'string' ? ref : referenceName(ref);
const isPending = (state: string): boolean => ['persisting', 'queued', 'sending', 'observing', 'parked', 'error', 'rejected', 'conflict'].includes(state);
const retryable = (error: SnapbackError): boolean => ['S3_NETWORK', 'S3_OWNER_BUSY', 'S3_WORKER_TIMEOUT', 'S3_WORKER_IO',
  'S3_WORKER_EXIT', 'S3_WORKER_CLOSED', 'S3_UNAVAILABLE', 'S3_RESPONSE_INVALID'].includes(error.code)
  || [408, 425, 429, 500, 502, 503, 504].includes((error.details as any)?.status);
const exactObject = (value: unknown, required: readonly string[], optional: readonly string[] = []): boolean => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const keys = Object.keys(value as object);
  return required.every(key => Object.hasOwn(value, key))
    && keys.every(key => required.includes(key) || optional.includes(key));
};
const ownAcquisitionSpec = <Root>(input: AcquisitionSpec<Root>): AcquisitionSpec<Root> => {
  const root = input.root;
  return Object.freeze({ id: input.id, revision: input.revision,
    root: Object.freeze({ key: root.key, op: root.op, args: ownJson(root.args),
      ...(root.cursor !== undefined ? { cursor: root.cursor } : {}) }),
    ...(input.expand ? { expand: input.expand } : {}) });
};

/** One client owns resource evidence, identity, and the durable operation queue.
 * React and other hosts subscribe to these same values. */
// @ref LLP 2000#5-ownership-before-abstraction — application code renders state;
// the SDK owns subscription sharing, retry identity, and account transitions.
export class SnapbackClient extends Signal<ClientSnapshot> {
  readonly ready: Promise<void>;
  readonly auth: {
    persona(name: string): Promise<Session>;
    signup(email: string, password: string): Promise<Session>;
    login(email: string, password: string): Promise<Session>;
    logout(): Promise<void>;
  };
  private readonly url: string;
  private readonly storage: ClientStorage;
  private readonly ownsStorage: boolean;
  private readonly fetcher: typeof globalThis.fetch;
  private readonly idFactory?: () => string;
  private readonly resources = new Map<string, Resource<any>>();
  private readonly acquiredFacts = new Map<string, { pool: FactPool; seq: number }>();
  private readonly acquiredIdentities = new Map<string, string>();
  private readonly acquisitionHandles = new Map<string, DatasetAcquisition>();
  private readonly acquisitionSpecs = new Map<string, AcquisitionSpec<any>>();
  private readonly acquisitionControllers = new Map<string, AbortController>();
  private readonly acquisitionRunning = new Set<string>();
  private readonly acquisitionRerun = new Set<string>();
  private acquisitionEpoch = 0;
  private readonly intents = new Map<string, Intent<any>>();
  private readonly journal = new Map<string, StoredOperation>();
  private readonly predictions = new PendingQueryCoordinator();
  private operationOrder = 0;
  private readonly clientId: string;
  private readonly releaseStorageListener?: () => void;
  private releaseBrowserListeners?: () => void;
  private readonly requests = new Set<AbortController>();
  private readonly queued = new Map<Resource<any>, ReturnType<typeof deferred<ResourceSnapshot<any>>>>();
  private readonly acquiring = new Map<string, Promise<ResourceSnapshot<any>>>();
  private session: Session | null = null;
  private manifest: Manifest | null = null;
  private facts: FactPool | null = null;
  private persistence = Promise.resolve();
  private closeResult = Promise.resolve();
  private accountEpoch = 0;
  private readEpoch = 0;
  /** Monotonic authority knowledge survives fact eviction and local cache clears. */
  private minimumSeq = 0;
  private manifestRequest = 0;
  private allowedOnline = true;
  private connected = false;
  private closed = false;
  private draining = false;
  private drainRequested = false;
  private readScheduled = false;
  private eventController?: AbortController;
  private eventQueries = '';
  private eventsScheduled = false;
  private retryTimer?: ReturnType<typeof setTimeout>;
  private expiryTimer?: ReturnType<typeof setTimeout>;
  private retryDelay = 250;
  private lastError?: SnapbackError;
  private readonly browserOnline = () => { if (this.allowedOnline) void this.reconnect().catch(() => {}); };
  private readonly browserOffline = () => { this.connected = false; this.stopEvents(); this.staleResources(); this.publish(); };

  constructor(private readonly options: ClientOptions, platform: ClientPlatformDefaults = {}) {
    super({ status: 'starting', principal: null, pending: [] });
    this.url = normalizeOwnerUrl(options.url);
    const defaultFetch = platform.fetch ?? globalThis.fetch;
    if (!options.fetch && typeof defaultFetch !== 'function')
      throw new SnapbackError('S3_PLATFORM_FETCH', 'This host needs a fetch implementation. Use its platform entrypoint or provide fetch.');
    this.fetcher = options.fetch ?? defaultFetch.bind(globalThis);
    this.idFactory = options.idFactory ?? platform.idFactory;
    this.clientId = platformId(this.idFactory);
    this.ownsStorage = options.storage === undefined;
    this.storage = options.storage === false ? createMemoryStorage()
      : options.storage ?? platform.defaultStorage?.()
      ?? (typeof indexedDB === 'undefined' ? createMemoryStorage() : createIndexedDBStorage(`snapback3:${this.url}`));
    this.auth = {
      persona: name => this.signIn('persona', { name }),
      signup: (email, password) => this.signIn('signup', { email, password }),
      login: (email, password) => this.signIn('login', { email, password }),
      logout: () => this.signOut(),
    };
    this.ready = this.initialize();
    void this.ready.catch(() => {});
    this.releaseStorageListener = this.storage.subscribe?.(event => {
      if (event.source === this.clientId || this.closed) return;
      // Hide the old authority synchronously; async storage reads must never
      // leave an old account rendered while another tab has switched accounts.
      this.clearAuthority();
      const epoch = this.accountEpoch;
      void this.ready.then(() => this.storageAuthorityChanged(epoch)).catch(error => this.storageFailure(error));
    });
    if (typeof window !== 'undefined' && typeof window.addEventListener === 'function'
      && typeof window.removeEventListener === 'function') {
      const browser = window;
      browser.addEventListener('online', this.browserOnline);
      browser.addEventListener('offline', this.browserOffline);
      this.releaseBrowserListeners = () => {
        browser.removeEventListener('online', this.browserOnline);
        browser.removeEventListener('offline', this.browserOffline);
      };
    }
  }

  watch<A, T>(operation: Op<A, T, any>, args: A): QueryResource<T>;
  watch<T = unknown>(operation: string, args?: Args): QueryResource<T>;
  watch<T>(operation: string | Op<any, T, any>, input: Args = {}): QueryResource<T> {
    this.assertOpen();
    const op = nameOf(operation), args = ownJson(input), key = queryKey(op, args);
    const existing = this.resources.get(key);
    if (existing) return existing;
    const resource: Resource<T> = new Resource<T>(op, args, () => this.acquireResource(resource), active => {
      resource.active = active;
      if (active) {
        this.readLocal(resource);
        if (this.options.live === false || !this.connected || !this.session) void this.acquireResource(resource).catch(() => {});
      }
      this.refreshEvents();
      if (!active) void this.observeOperations().catch(error => this.storageFailure(error));
    });
    this.resources.set(key, resource);
    this.readLocal(resource);
    return resource;
  }

  /** Acquire and retain a declared paginated dataset. The explicit revision is
   * part of its durable identity because JavaScript derivation closures cannot be hashed safely. */
  acquire<Root>(input: AcquisitionSpec<Root>): Acquisition {
    this.assertOpen();
    const spec = ownAcquisitionSpec(input);
    const existing = this.acquisitionHandles.get(spec.id);
    if (existing) {
      const previous = this.acquisitionSpecs.get(spec.id)!;
      const identity = (value: AcquisitionSpec<any>) => canonicalJson({ revision: value.revision,
        root: { key: value.root.key, op: value.root.op, args: value.root.args, cursor: value.root.cursor } });
      if (identity(previous) === identity(spec)) return existing;
      const hash = this.acquiredIdentities.get(spec.id)
        ?? (this.manifest ? declarationIdentity(spec.id, previous.revision, resolveChain(this.manifest, previous.root)) : undefined);
      void this.retireAcquisition(spec.id, hash).catch(error => this.storageFailure(error));
      this.acquisitionControllers.get(spec.id)?.abort();
      if (this.acquisitionRunning.has(spec.id)) this.acquisitionRerun.add(spec.id); else this.acquisitionRerun.delete(spec.id);
      existing.seal(new SnapbackError('S3_ACQUISITION_CHANGED',
        'This dataset declaration changed. Its prior handle was sealed and acquisition restarted.'));
      this.acquisitionHandles.delete(spec.id); this.acquisitionSpecs.delete(spec.id);
    }
    if (this.manifest && this.acquiredFacts.has(spec.id)) {
      try {
        const root = resolveChain(this.manifest, spec.root);
        if (this.acquiredIdentities.get(spec.id) !== declarationIdentity(spec.id, spec.revision, root)) {
          void this.retireAcquisition(spec.id, this.acquiredIdentities.get(spec.id)).catch(error => this.storageFailure(error));
        }
      } catch {
        void this.retireAcquisition(spec.id, this.acquiredIdentities.get(spec.id)).catch(error => this.storageFailure(error));
      }
    }
    let handle!: DatasetAcquisition;
    handle = new DatasetAcquisition(spec.id, () => this.cancelAcquisition(spec), () => this.startAcquisition(spec.id));
    this.acquisitionHandles.set(spec.id, handle); this.acquisitionSpecs.set(spec.id, spec);
    this.startAcquisition(spec.id);
    return handle;
  }

  query<A, T>(operation: Op<A, T, any>, args: A): Promise<T>;
  query<T = unknown>(operation: string, args?: Args): Promise<T>;
  async query<T>(operation: string | Op<any, T, any>, args: Args = {}): Promise<T> {
    const resource = this.watch<T>(nameOf(operation), args);
    const value = await resource.refresh();
    if (value.status === 'denied' || value.status === 'error') throw value.error;
    if (value.data === undefined) throw new SnapbackError('S3_UNAVAILABLE', 'This resource is not available yet.');
    return value.data;
  }

  mutate<A, T>(operation: Op<A, T, any>, args: A): Operation<T>;
  mutate<T = unknown>(operation: string, args?: Args): Operation<T>;
  mutate<T>(operation: string | Op<any, T, any>, input: Args = {}): Operation<T> {
    this.assertOpen();
    const op = nameOf(operation), args = ownJson(input);
    const id = platformId(this.idFactory);
    if (this.intents.has(id) || this.journal.has(id))
      throw new SnapbackError('S3_PLATFORM_ID', 'The identity source repeated an operation identity.');
    const intent = new Intent<T>(id, op, args);
    this.intents.set(intent.id, intent);
    void this.admit(intent, this.accountEpoch).catch(error => {
      const failure = errorOf(error);
      intent.set({ ...intent.getSnapshot(), status: 'error', error: failure });
      intent.fail(failure); this.publish();
    });
    return intent;
  }

  /** Find recoverable work after a process restart. Other accounts' work stays private. */
  operation<T = unknown>(id: string): Operation<T> | undefined {
    return this.journal.get(id)?.principal === this.session?.principal.id ? this.intents.get(id) : undefined;
  }

  /** Dismiss a terminal result after its recoverable input has been handled.
   * Unknown and parked operations cannot be discarded through this method. */
  async dismissOperation(id: string): Promise<void> {
    await this.ready;
    this.assertOpen();
    const entry = this.journal.get(id);
    if (!entry || entry.principal !== this.session?.principal.id) throw new SnapbackError('S3_OPERATION_UNKNOWN', 'This operation is not available to this account.');
    if (!entry.receipt) throw new SnapbackError('S3_OPERATION_PENDING', 'This operation has no terminal result yet.');
    const dismissed: StoredOperation = { ...entry, dismissed: true };
    await this.persist({ operations: [dismissed] });
    this.journal.set(id, dismissed); this.publish();
  }

  setOnline(online: boolean): void {
    this.allowedOnline = online;
    if (!online) {
      this.readEpoch++;
      this.connected = false; this.stopEvents();
      for (const controller of this.requests) controller.abort();
      clearTimeout(this.retryTimer); this.retryTimer = undefined;
      this.staleResources(); this.publish();
    } else { void this.reconnect().catch(() => {}); }
  }

  async reconnect(): Promise<void> {
    await this.ready;
    if (this.closed || !this.allowedOnline) return;
    const epoch = this.accountEpoch;
    try {
      await this.loadManifest(epoch);
      if (epoch !== this.accountEpoch || !this.allowedOnline || this.closed) return;
      this.connected = true; this.lastError = undefined; this.retryDelay = 250;
      this.startEvents(); this.publish();
      for (const [id, handle] of this.acquisitionHandles) if (handle.awaitingRetry) this.resumeAcquisition(id);
      await Promise.allSettled([...this.resources.values()].filter(resource => resource.active).map(resource => this.acquireResource(resource)));
      await this.drain();
    } catch (error) { this.networkFailure(error); }
  }

  close(): void {
    if (this.closed) return;
    this.closed = true; this.accountEpoch++;
    this.releaseStorageListener?.();
    this.stopEvents(); clearTimeout(this.retryTimer); clearTimeout(this.expiryTimer);
    for (const controller of this.requests) controller.abort();
    this.sealAcquisitions(new SnapbackError('S3_CLOSED', 'The client is closed.'));
    for (const waiter of this.queued.values()) waiter.reject(new SnapbackError('S3_CLOSED', 'The client is closed.'));
    this.queued.clear();
    this.releaseBrowserListeners?.(); this.releaseBrowserListeners = undefined;
    const pending = this.persistence;
    this.closeResult = storageJob(this.storage, async () => {
      await pending;
      if (this.ownsStorage) await this.storage.close?.();
    });
    // close() stays safe for teardown callbacks that intentionally do not wait.
    void this.closeResult.catch(() => {});
  }

  /** Await durable writes and, for a platform/default store, its connection close. */
  async closeAsync(): Promise<void> { this.close(); await this.closeResult; }
  private async initialize(): Promise<void> {
    try {
      let state;
      for (;;) {
        const epoch = this.accountEpoch;
        state = await storageJob(this.storage, () => this.storage.load());
        if (this.closed || epoch === this.accountEpoch) break;
      }
      if (this.closed) return;
      if (![1, 2].includes(state.version) || !Array.isArray(state.operations)) throw new SnapbackError('S3_STORAGE', 'Local state has an unsupported format.');
      if (state.manifest) this.manifest = validateManifest(state.manifest);
      if (state.session && state.session.expiresAt > Date.now()) this.session = this.checkedSession(state.session);
      for (const entry of state.operations) {
        const body = checkedStoredOperation(entry);
        this.operationOrder = Math.max(this.operationOrder, entry.order ?? ++this.operationOrder);
        const intent = new Intent(entry.id, body.op, body.args);
        this.journal.set(entry.id, entry); this.intents.set(entry.id, intent);
        this.updateIntent(entry); intent.admission();
        if (entry.receipt) intent.finish(entry.receipt);
      }
      if (this.manifest && this.session) {
        this.facts = new FactPool(this.manifest, this.session);
        if (state.frame) this.facts.restore(state.frame);
        this.minimumSeq = Math.max(0, this.facts.seq, state.acquisitionFloor ?? 0,
          ...[...this.journal.values()].filter(entry => entry.principal === this.session!.principal.id).map(entry => entry.receipt?.seq ?? 0));
        if (!state.acquisitionsInvalidated) this.restoreAcquisitions(state);
      }
      this.refreshPredictions(false);
      this.scheduleExpiry();
      for (const resource of this.resources.values()) this.readLocal(resource);
      this.connected = false; this.publish();
      // Local readiness is never held behind an unbounded network request.
      // A cached session reconnects opportunistically after ready settles.
      if (this.session && this.allowedOnline) queueMicrotask(() => { void this.reconnect(); });
    } catch (error) {
      this.lastError = errorOf(error, 'S3_STORAGE');
      this.set({ status: 'error', principal: null, pending: [], error: this.lastError });
      throw this.lastError;
    }
  }

  private checkedSession(input: Session): Session {
    if (!input || typeof input.token !== 'string' || !input.token || typeof input.principal?.id !== 'string'
      || typeof input.principal.kind !== 'string' || !Number.isSafeInteger(input.authEpoch)
      || input.authEpoch < 0 || !Number.isSafeInteger(input.expiresAt) || input.expiresAt <= Date.now())
      throw new SnapbackError('S3_AUTH', 'The session is invalid or expired.');
    return ownJson(input);
  }

  private assertOpen(): void {
    if (this.closed) throw new SnapbackError('S3_CLOSED', 'The client is closed.');
  }
  private async signIn(method: string, args: Args): Promise<Session> {
    await this.ready;
    this.assertOpen();
    this.clearAuthority();
    const epoch = this.accountEpoch;
    await this.persist({ session: null });
    try {
      const session = this.checkedSession(await this.request(`/api/auth/${method}`, { method: 'POST', body: JSON.stringify(args) }));
      if (epoch !== this.accountEpoch || this.closed) throw new SnapbackError('S3_AUTH_CHANGED', 'The active account changed before sign-in completed.');
      this.session = session;
      await this.persist({ session });
      if (epoch !== this.accountEpoch) throw new SnapbackError('S3_AUTH_CHANGED', 'The active account changed.');
      await this.loadManifest(epoch);
      this.facts = new FactPool(this.manifest!, session);
      this.restoreAcquisitions(await this.storage.load());
      this.restoreIntentHandles();
      this.refreshPredictions(false);
      this.connected = true; this.lastError = undefined;
      this.scheduleExpiry(); this.publish(); this.startEvents();
      for (const resource of this.resources.values()) if (resource.active) void this.acquireResource(resource).catch(() => {});
      void this.drain();
      return session;
    } catch (error) {
      if (epoch === this.accountEpoch) { this.lastError = errorOf(error); this.publish(); }
      throw error;
    }
  }

  private async signOut(): Promise<void> {
    await this.ready;
    this.assertOpen();
    const previous = this.session;
    this.clearAuthority();
    await this.persist({ session: null });
    if (previous && this.allowedOnline) {
      try { await this.request('/api/auth/logout', { method: 'POST', body: '{}' }, previous.token); } catch { /* Local logout also works offline. */ }
    }
  }

  private clearAuthority(): void {
    this.accountEpoch++; this.readEpoch++; this.minimumSeq = 0; this.session = null; this.facts = null;
    this.acquiredFacts.clear(); this.acquiredIdentities.clear();
    this.predictions.clear();
    this.stopEvents(); clearTimeout(this.expiryTimer);
    for (const controller of this.requests) controller.abort();
    const failure = new SnapbackError('S3_AUTH_CHANGED', 'The active account changed.');
    for (const waiter of this.queued.values()) waiter.reject(failure);
    this.queued.clear(); this.acquiring.clear();
    for (const resource of this.resources.values()) {
      resource.references = undefined; resource.projection = undefined; resource.acquisition = undefined;
      resource.set(loading(), false);
    }
    const sealed = [...this.intents.values()].filter(intent => intent.seal(false));
    const acquisitionFailure = new SnapbackError('S3_AUTH_CHANGED', 'This acquisition belongs to a previous account session.');
    this.sealAcquisitions(acquisitionFailure);
    for (const resource of this.resources.values()) resource.notify();
    for (const intent of sealed) intent.notify();
    this.publish();
  }

  private scheduleExpiry(): void {
    clearTimeout(this.expiryTimer);
    if (!this.session) return;
    this.expiryTimer = timer(() => {
      if (this.session && this.session.expiresAt > Date.now()) { this.scheduleExpiry(); return; }
      this.clearAuthority();
      this.lastError = new SnapbackError('S3_AUTH', 'Sign in again to continue.');
      this.publish(); void this.persist({ session: null }).catch(error => this.storageFailure(error));
    }, Math.max(0, Math.min(this.session.expiresAt - Date.now(), 2_147_483_647)));
  }

  private async loadManifest(epoch: number): Promise<void> {
    const request = ++this.manifestRequest;
    const manifest = validateManifest(await this.request('/api/manifest'));
    if (epoch !== this.accountEpoch || this.closed || request !== this.manifestRequest) return;
    if (manifest.seq < this.minimumSeq)
      throw new SnapbackError('S3_STALE_SNAPSHOT', 'The manifest predates an already known commit.');
    const authorityChanged = this.manifest !== null && (this.manifest.generation !== manifest.generation
      || this.manifest.schemaHash !== manifest.schemaHash);
    const changed = this.manifest === null || authorityChanged;
    const advanced = this.facts !== null && manifest.seq > this.facts.seq;
    if (authorityChanged) {
      this.sealAcquisitions(new SnapbackError('S3_GENERATION_CHANGED',
        'This acquisition belongs to an older application generation. Start it again with a current declaration.'));
      // A successor changes authority without resetting this owner's commit sequence.
      this.minimumSeq = manifest.seq;
    } else if (manifest.seq > this.minimumSeq) this.suspendAcquisitions(manifest.seq);
    this.manifest = manifest;
    if (changed || advanced) {
      this.readEpoch++;
      this.facts = this.session ? new FactPool(manifest, this.session) : null;
      for (const resource of this.resources.values()) { resource.acquisition = undefined; resource.set(loading()); }
    }
    const patch = { manifest, ...(changed || advanced ? { frame: null as null } : {}) };
    if (authorityChanged) await this.persistFailClosed(patch, epoch);
    else await this.persist(patch);
    if (changed || advanced) this.refreshPredictions(false);
    if (changed) await this.observeOperations();
  }

  private readLocal(resource: Resource<any>, notify = true): boolean {
    if (!this.session || this.session.expiresAt <= Date.now()) return false;
    let acquisition: Resource<any>['acquisition'];
    let local = this.facts && this.facts.seq >= this.minimumSeq ? this.facts.read(resource.op, resource.args) : undefined;
    if (!local) {
      const candidates = [...this.acquiredFacts].filter(([, item]) => item.seq >= this.minimumSeq)
        .sort(([, a], [, b]) => b.seq - a.seq);
      for (const [id, candidate] of candidates) {
        local = candidate.pool.read(resource.op, resource.args);
        if (local) { acquisition = { id, seq: candidate.seq }; break; }
      }
    }
    if (local) {
      const envelope = this.facts?.envelope(resource.key);
      resource.references = envelope ? rowReferences(envelope.data) : undefined;
      resource.projection = envelope ? canonicalJson(envelope.data) : undefined;
      resource.acquisition = acquisition;
      resource.set(local, notify);
      return true;
    }
    return false;
  }

  /** Rebase every current pool from the one durable FIFO, then publish only
   * certified queries whose read tables intersect an entering/leaving overlay. */
  private refreshPredictions(notify = true): PredictionUpdate {
    const pools = [this.facts, ...[...this.acquiredFacts.values()].map(item => item.pool)]
      .filter((pool): pool is FactPool => pool !== null);
    const update = this.predictions.sync(this.manifest, this.session, this.journal.values(), pools);
    if (!update.changedTables.size) return update;
    const changed: Resource<any>[] = [];
    for (const resource of this.resources.values()) {
      const reads = this.manifest?.programs[resource.op]?.certificate.read_sites ?? [];
      if (!reads.some((site: any) => update.changedTables.has(site.table))) continue;
      const before = resource.getSnapshot();
      const available = this.readLocal(resource, false);
      if (!available && before.pending?.length) resource.set(loading(), false);
      if (resource.getSnapshot() !== before) changed.push(resource);
    }
    if (notify) for (const resource of changed) resource.notify();
    return update;
  }

  private withdrawAcquiredResources(id?: string): void {
    for (const resource of this.resources.values()) if (resource.acquisition && (!id || resource.acquisition.id === id)) {
      resource.references = undefined; resource.projection = undefined; resource.acquisition = undefined;
      resource.set(loading(), false); this.readLocal(resource); resource.notify();
    }
  }

  private retireAcquisition(id: string, declarationHash?: string, epoch = this.accountEpoch): Promise<void> {
    const session = this.session, manifest = this.manifest;
    this.acquiredFacts.delete(id); this.acquiredIdentities.delete(id); this.withdrawAcquiredResources(id);
    if (!declarationHash || !session || !manifest) return Promise.resolve();
    const cancellation = { id, declarationHash, token: session.token, principal: session.principal.id, authEpoch: session.authEpoch,
      generation: manifest.generation, schemaHash: manifest.schemaHash };
    return this.persistFailClosed({ cancelAcquisition: cancellation }, epoch, cancellation);
  }

  private restoreAcquisitions(state: Awaited<ReturnType<ClientStorage['load']>>): void {
    if (!this.manifest || !this.session || state.acquisitionsInvalidated) return;
    for (const acquisition of state.acquisitions ?? []) {
      try {
        const declared = this.acquisitionSpecs.get(acquisition.id);
        if (declared) {
          const root = resolveChain(this.manifest, declared.root);
          if (declarationIdentity(declared.id, declared.revision, root) !== acquisition.declarationHash) continue;
        }
        const pool = restoreAcquiredPool(this.manifest, this.session, acquisition,
          state.acquisitionRows ?? [], state.acquisitionResources ?? []);
        if (pool && acquisition.seq !== undefined && acquisition.seq >= this.minimumSeq) {
          this.predictions.attach(pool);
          this.acquiredFacts.set(acquisition.id, { pool, seq: acquisition.seq });
          this.acquiredIdentities.set(acquisition.id, acquisition.declarationHash);
        }
      } catch (error) { this.storageFailure(error); }
    }
  }

  /** A newer observation can revoke an inactive acquired resource. Retain its
   * physical row versions, but remove the coherent-ready pointer until the SDK
   * has conditionally revalidated every declared page at the new sequence. */
  private suspendAcquisitions(seq?: number): void {
    const epoch = this.accountEpoch;
    this.acquisitionEpoch++;
    if (seq !== undefined) this.minimumSeq = Math.max(this.minimumSeq, seq);
    this.acquiredFacts.clear(); this.acquiredIdentities.clear();
    this.withdrawAcquiredResources();
    const resumable = [...this.acquisitionHandles].filter(([, handle]) => handle.prepareAutomaticResume()).map(([id]) => id);
    void this.persistFailClosed({ ...(seq !== undefined ? { acquisitionFloor: seq } : {}), acquisitionsInvalidated: true,
      invalidateAcquisitions: true }, epoch).then(() => {
      if (epoch === this.accountEpoch && this.allowedOnline && this.session)
        for (const id of resumable) this.startAcquisition(id);
    }).catch(() => {});
  }

  private sealAcquisitions(error: SnapbackError): void {
    this.acquisitionEpoch++;
    this.acquiredFacts.clear(); this.acquiredIdentities.clear();
    for (const controller of this.acquisitionControllers.values()) controller.abort();
    this.acquisitionControllers.clear(); this.acquisitionRunning.clear(); this.acquisitionRerun.clear();
    for (const handle of this.acquisitionHandles.values()) handle.seal(error);
    this.acquisitionHandles.clear(); this.acquisitionSpecs.clear();
  }

  private cancelAcquisition(spec: AcquisitionSpec<any>): Promise<void> {
    const id = spec.id;
    this.acquisitionRerun.delete(id);
    this.acquisitionControllers.get(id)?.abort();
    const hash = this.acquiredIdentities.get(id)
      ?? (this.manifest ? declarationIdentity(id, spec.revision, resolveChain(this.manifest, spec.root)) : undefined);
    return this.retireAcquisition(id, hash).catch(error => this.storageFailure(error));
  }

  private resumeAcquisition(id: string): void {
    const handle = this.acquisitionHandles.get(id);
    if (!handle?.prepareAutomaticResume()) return;
    this.startAcquisition(id);
  }

  private startAcquisition(id: string): void {
    const handle = this.acquisitionHandles.get(id);
    if (!handle || handle.getSnapshot().status !== 'acquiring') return;
    if (this.acquisitionRunning.has(id)) { this.acquisitionRerun.add(id); return; }
    const completion = handle.completed;
    void this.runAcquisition(id).catch(error => {
      if (handle.completed !== completion) return;
      const failure = errorOf(error);
      if (failure.code === 'S3_ACQUISITION_INVALIDATED') return;
      if (retryable(failure)) {
        handle.suspend(failure);
        if (failure.code === 'S3_NETWORK') this.networkFailure(failure);
        else { this.lastError = failure; this.publish(); this.scheduleRetry(); }
      } else handle.fail(failure);
    });
  }

  // @ref LLP 2000#16-making-acquisition-fast — traversal, durable progress,
  // conditional normalization, and coherent publication are one SDK-owned job.
  private async runAcquisition(id: string): Promise<void> {
    await this.ready;
    if (this.acquisitionRunning.has(id)) return;
    const spec = this.acquisitionSpecs.get(id), handle = this.acquisitionHandles.get(id);
    if (!spec || !handle || handle.getSnapshot().status !== 'acquiring') return;
    if (!this.session || !this.manifest) throw new SnapbackError('S3_AUTH', 'Sign in before acquiring offline data.');
    this.acquisitionRunning.add(id);
    const controller = new AbortController(); this.acquisitionControllers.set(id, controller);
    const epoch = this.accountEpoch, acquisitionEpoch = this.acquisitionEpoch, session = this.session, manifest = this.manifest;
    const assertCurrent = () => {
      if (acquisitionEpoch !== this.acquisitionEpoch)
        throw new SnapbackError('S3_ACQUISITION_INVALIDATED', 'The acquisition is restarting after newer authority.');
      if (controller.signal.aborted || this.closed || epoch !== this.accountEpoch
        || this.session?.token !== session.token || this.manifest?.generation !== manifest.generation
        || this.acquisitionHandles.get(id) !== handle)
        throw new SnapbackError('S3_AUTH_CHANGED', 'The acquisition account or application changed.');
    };
    try {
      await this.persistence;
      assertCurrent();
      const root = resolveChain(manifest, spec.root);
      const identity = declarationIdentity(spec.id, spec.revision, root);
      let loaded = await this.storage.load();
      assertCurrent();
      let stored = acquisitionState(loaded, id);
      const compatible = stored.acquisition?.declarationHash === identity
        && stored.acquisition.principal === session.principal.id && stored.acquisition.authEpoch === session.authEpoch
        && stored.acquisition.generation === manifest.generation && stored.acquisition.schemaHash === manifest.schemaHash;
      if (!compatible) {
        this.acquiredFacts.delete(id); this.acquiredIdentities.delete(id); this.withdrawAcquiredResources(id);
        stored = { acquisition: undefined, rows: stored.rows, resources: new Map() };
      }
      let resources = stored.resources, rows = stored.rows;
      let metadata: StoredAcquisition = compatible ? { ...stored.acquisition! } : {
        id, declarationHash: identity, principal: session.principal.id, authEpoch: session.authEpoch,
        generation: manifest.generation, schemaHash: manifest.schemaHash, status: 'acquiring', phase: 'traverse',
        rootKeys: [root.key], derivedDeclarations: [], pending: [root], resourceKeys: [], pages: 0,
      };
      let freshTraversal = !compatible && resources.size === 0;
      const freshResources = new Map<string, number>();
      const declarations = (): AcquisitionDeclaration[] => [root, ...metadata.derivedDeclarations];
      const findChain = (key: string): AcquisitionDeclaration | undefined => declarations().find(item => item.key === key);
      const validateResource = (resource: StoredAcquisitionResource): AcquisitionDeclaration => {
        const chain = findChain(resource.chainKey);
        if (!chain) throw new SnapbackError('S3_STORAGE', 'Acquisition progress names an unknown chain.');
        return ownJson({ key: `validation:${resource.key}`, op: resource.op, args: resource.args, cursor: chain.cursor,
          follow: false, validator: resource.envelope.validator });
      };
      const continuation = (chain: AcquisitionDeclaration, args: Args): AcquisitionDeclaration =>
        ownJson({ key: chain.key, op: chain.op, args, cursor: chain.cursor, follow: true });
      const walk = (chain: AcquisitionDeclaration): { keys: string[]; missing?: AcquisitionDeclaration } => {
        const keys: string[] = [], seen = new Set<string>();
        let args = chain.args;
        for (;;) {
          const key = queryKey(chain.op, args);
          if (seen.has(key)) throw new SnapbackError('S3_PROTOCOL', 'An acquisition cursor repeated a page.');
          seen.add(key);
          const resource = resources.get(key);
          if (!resource || resource.chainKey !== chain.key) return { keys, missing: continuation(chain, args) };
          keys.push(key);
          const envelope = envelopeFromStored(resource, rows, manifest);
          if (envelope.state === 'denied') throw new SnapbackError(envelope.rule ?? 'S3_FORBIDDEN', 'The acquired dataset is no longer authorized.');
          if (envelope.state === 'partial' || envelope.state === 'capped' && envelope.next === null)
            throw new SnapbackError('S3_ACQUISITION_INCOMPLETE', 'A page ended without complete acquisition evidence.');
          if (envelope.next === null) return { keys };
          args = ownJson({ ...args, [chain.cursor]: envelope.next });
        }
      };
      const persistProgress = async (changedRows: StoredAcquisitionRow[] = [], changedResources: StoredAcquisitionResource[] = [],
        clearGlobalInvalidation = false): Promise<void> => {
        assertCurrent();
        if (metadata.seq !== undefined && metadata.seq < this.minimumSeq)
          throw new SnapbackError('S3_SEQUENCE_CHANGED', 'The acquisition checkpoint predates newer authority.');
        metadata.resourceKeys = [...new Set(metadata.resourceKeys)];
        await this.persist({ acquisition: { acquisition: metadata, rows: changedRows, resources: changedResources },
          acquisitionFloor: metadata.seq ?? this.minimumSeq,
          ...(clearGlobalInvalidation ? { acquisitionsInvalidated: false } : {}) });
        assertCurrent();
      };
      const restart = async (): Promise<void> => {
        resources = new Map(); freshTraversal = true; freshResources.clear();
        metadata = { ...metadata, status: 'acquiring', phase: 'traverse', seq: undefined,
          derivedDeclarations: [], pending: [root], resourceKeys: [], pages: 0 };
        await persistProgress();
      };

      if (!compatible) await persistProgress();

      if (metadata.status === 'ready' && metadata.seq !== undefined && metadata.seq >= this.minimumSeq
        && !loaded.acquisitionsInvalidated) {
        const derived = (spec.expand?.(chainValue(root, resources, rows, manifest)) ?? []).map(page => resolveChain(manifest, page));
        if (canonicalDeclarations(metadata.derivedDeclarations) !== canonicalDeclarations(derived)) await restart();
        else {
          const pool = restoreAcquiredPool(manifest, session, metadata, [...rows.values()], [...resources.values()]);
          if (pool) {
            this.predictions.attach(pool);
            assertCurrent();
            this.acquiredFacts.set(id, { pool, seq: metadata.seq });
            this.acquiredIdentities.set(id, identity);
            const ready = { id, status: 'ready' as const, pages: metadata.pages,
              chains: declarations().length, seq: metadata.seq };
            handle.finish(ready); return;
          }
        }
      }
      if (!this.allowedOnline) throw new SnapbackError('S3_NETWORK', 'Resume acquisition after the client is online.');
      if (metadata.status === 'ready' || metadata.phase === 'validate' || loaded.acquisitionsInvalidated) {
        freshTraversal = false; freshResources.clear();
        metadata.status = 'acquiring'; metadata.phase = 'validate';
        if (loaded.acquisitionsInvalidated || metadata.seq !== undefined && metadata.seq < this.minimumSeq) metadata.seq = undefined;
        metadata.pending = metadata.resourceKeys.map(key => {
          const resource = resources.get(key);
          if (!resource) throw new SnapbackError('S3_STORAGE', 'Acquisition progress names a missing resource.');
          return validateResource(resource);
        });
        if (!metadata.pending.length) await restart(); else await persistProgress();
      }

      let validationChanged = false, rootChanged = false;
      for (let turns = 0; turns < 100_000; turns++) {
        if (controller.signal.aborted || epoch !== this.accountEpoch || this.closed)
          throw new SnapbackError('S3_AUTH_CHANGED', 'The acquisition was cancelled or its account changed.');
        if (!metadata.pending.length) {
          assertCurrent();
          const rootWalk = walk(root);
          if (rootWalk.missing) { metadata.phase = 'traverse'; metadata.pending = [rootWalk.missing]; await persistProgress(); continue; }
          const derived = (spec.expand?.(chainValue(root, resources, rows, manifest)) ?? []).map(page => resolveChain(manifest, page));
          const duplicate = new Set(derived.map(item => item.key));
          if (duplicate.size !== derived.length || duplicate.has(root.key))
            throw new SnapbackError('S3_ACQUISITION_DECLARATION', 'Acquisition chain keys must be unique.');
          if (metadata.derivedDeclarations.length
            && canonicalDeclarations(metadata.derivedDeclarations) !== canonicalDeclarations(derived) && !rootChanged) {
            await restart(); rootChanged = true; continue;
          }
          metadata.derivedDeclarations = derived;
          const walks = declarations().map(walk);
          const missing = walks.flatMap(item => item.missing ? [item.missing] : []);
          metadata.resourceKeys = [...new Set(walks.flatMap(item => item.keys))];
          if (missing.length) { metadata.phase = 'traverse'; metadata.pending = missing; await persistProgress(); continue; }
          const freshCheckpoint = freshTraversal && metadata.phase === 'traverse' && metadata.seq !== undefined
            && freshResources.size === metadata.resourceKeys.length
            && metadata.resourceKeys.every(key => freshResources.get(key) === metadata.seq);
          if (!freshCheckpoint && (metadata.phase !== 'validate' || validationChanged)) {
            metadata.phase = 'validate'; validationChanged = false; rootChanged = false;
            metadata.pending = metadata.resourceKeys.map(key => validateResource(resources.get(key)!));
            await persistProgress(); continue;
          }
          metadata.status = 'ready'; metadata.pages = metadata.resourceKeys.length;
          await persistProgress([], [], true);
          const pool = restoreAcquiredPool(manifest, session, metadata, [...rows.values()], [...resources.values()]);
          if (!pool) throw new SnapbackError('S3_STORAGE', 'The completed acquisition could not be restored.');
          this.predictions.attach(pool);
          assertCurrent();
          this.acquiredFacts.set(id, { pool, seq: metadata.seq! });
          this.acquiredIdentities.set(id, identity);
          for (const resource of this.resources.values()) if (resource.getSnapshot().data === undefined) this.readLocal(resource);
          const ready = { id, status: 'ready' as const, pages: metadata.pages,
            chains: declarations().length, seq: metadata.seq };
          handle.finish(ready); return;
        }

        const requestDeclarations = metadata.pending.slice(0, 64), expectedSeq = metadata.seq ?? this.minimumSeq;
        let response: any;
        try {
          response = await this.request('/api/acquire', { method: 'POST', body: JSON.stringify({
            expectedSeq, chains: requestDeclarations,
          }), signal: controller.signal }, session.token);
        } catch (error) {
          const failure = errorOf(error);
          if (failure.code === 'S3_AUTH') {
            if (epoch === this.accountEpoch && this.session?.token === session.token && !this.closed)
              await this.lostAuthority(failure);
            throw failure;
          }
          if (failure.code === 'S3_SEQUENCE_CHANGED') {
            await this.loadManifest(epoch);
            assertCurrent();
            freshTraversal = false; freshResources.clear();
            metadata.phase = 'validate'; metadata.pending = metadata.resourceKeys.map(key => validateResource(resources.get(key)!));
            metadata.seq = undefined;
            if (!metadata.pending.length) await restart(); else await persistProgress();
            continue;
          }
          throw failure;
        }
        assertCurrent();
        if (!exactObject(response, ['generation', 'seq', 'pages', 'continuations', 'more'])
          || response.generation !== manifest.generation || !Number.isSafeInteger(response.seq) || response.seq < 0
          || !Array.isArray(response.pages) || !Array.isArray(response.continuations) || typeof response.more !== 'boolean')
          throw new SnapbackError('S3_PROTOCOL', 'The acquisition response has an invalid identity.');
        if (expectedSeq !== undefined && response.seq !== expectedSeq)
          throw new SnapbackError('S3_PROTOCOL', 'The acquisition response changed sequence unexpectedly.');
        if (response.seq < this.minimumSeq)
          throw new SnapbackError('S3_SEQUENCE_CHANGED', 'The acquisition response predates newer authority.');
        const nextResources = new Map(resources), nextRows = new Map(rows);
        const changedResources: StoredAcquisitionResource[] = [], changedRows: StoredAcquisitionRow[] = [];
        const requestedKeys = new Set(requestDeclarations.map(item => item.key));
        const accounted = new Set<string>(), deliveredIdentities = new Set<string>();
        for (const page of response.pages) {
          const requested = requestDeclarations.find(item => item.key === page?.key);
          const previousForRequest = page?.args && !Array.isArray(page.args) ? nextResources.get(queryKey(page.op, page.args)) : undefined;
          const chain = requested?.follow === false ? findChain(previousForRequest?.chainKey ?? '') : findChain(page?.key);
          if (!exactObject(page, ['key', 'op', 'args', 'message']) || !chain || !requestedKeys.has(page.key)
            || page.op !== chain.op || !page.args || Array.isArray(page.args)
            || canonicalJson({ ...page.args, [chain.cursor]: chain.args[chain.cursor] }) !== canonicalJson(chain.args))
            throw new SnapbackError('S3_PROTOCOL', 'The acquisition response returned an undeclared page.');
          const resourceKey = queryKey(page.op, page.args);
          const executionIdentity = `${page.key}:${resourceKey}`;
          if (deliveredIdentities.has(executionIdentity)) throw new SnapbackError('S3_PROTOCOL', 'The acquisition response repeated a page.');
          deliveredIdentities.add(executionIdentity); accounted.add(executionIdentity);
          const message = decodeDeliveryMessage(page.message);
          if (message.state === 'unchanged') {
            freshTraversal = false; freshResources.clear();
            const unchanged = message as DeliveryUnchanged, previous = nextResources.get(resourceKey);
            const declaration = requestDeclarations.find(item => item.key === page.key
              && canonicalJson(item.args) === canonicalJson(page.args));
            if (!previous || declaration?.follow !== false || declaration.validator !== unchanged.validator
              || previous.envelope.validator !== unchanged.validator || unchanged.seq !== response.seq)
              throw new SnapbackError('S3_PROTOCOL', 'An unchanged page does not match its held validator.');
            const advanced = { ...previous, envelope: { ...previous.envelope, seq: response.seq } };
            nextResources.set(resourceKey, advanced); changedResources.push(advanced);
          } else {
            const envelope = ownDeliveryEnvelope(message);
            if (envelope.seq !== response.seq || envelope.generation !== manifest.generation
              || envelope.schemaHash !== manifest.schemaHash || envelope.planHash !== manifest.programs[page.op]?.planHash
              || envelope.authority.principal !== session.principal.id || envelope.authority.authEpoch !== session.authEpoch)
              throw new SnapbackError('S3_AUTHORITY_CHANGED', 'An acquisition page belongs to another program or account.');
            if (envelope.state === 'denied') {
              this.acquiredFacts.delete(id); this.acquiredIdentities.delete(id);
              const denied = new SnapbackError(envelope.rule ?? 'S3_FORBIDDEN', 'The acquired dataset is no longer authorized.');
              handle.seal(denied);
              this.withdrawAcquiredResources(id);
              metadata = { ...metadata, status: 'cancelled', pending: [], resourceKeys: [] };
              await this.persistFailClosed({ acquisition: { acquisition: metadata, rows: [], resources: [] } }, epoch);
              throw denied;
            }
            if (envelope.state === 'partial' || envelope.state === 'capped' && envelope.next === null)
              throw new SnapbackError('S3_ACQUISITION_INCOMPLETE', 'The owner ended an acquisition chain without complete evidence.');
            const saved = storedResource(id, chain.key, page.op, ownJson(page.args), envelope);
            nextResources.set(saved.resource.key, saved.resource); changedResources.push(saved.resource);
            if (freshTraversal && metadata.phase === 'traverse' && requested?.follow === true)
              freshResources.set(saved.resource.key, response.seq);
            else if (freshTraversal) { freshTraversal = false; freshResources.clear(); }
            for (const row of saved.rows) if (!nextRows.has(row.versionKey)) {
              nextRows.set(row.versionKey, row); changedRows.push(row);
            }
            validationChanged ||= metadata.phase === 'validate'; rootChanged ||= metadata.phase === 'validate' && chain.key === root.key;
          }
        }
        const continuations: AcquisitionDeclaration[] = response.continuations.map((item: any) => {
          const requested = requestDeclarations.find(declaration => declaration.key === item?.key);
          const previous = item?.args && !Array.isArray(item.args) ? nextResources.get(queryKey(item.op, item.args)) : undefined;
          const chain = requested?.follow === false ? findChain(previous?.chainKey ?? '') : findChain(item?.key);
          if (!exactObject(item, ['key', 'op', 'args', 'cursor', 'follow'], ['validator'])
            || !chain || item.op !== chain.op || item.cursor !== chain.cursor || typeof item.follow !== 'boolean'
            || !item.args || (item.args[item.cursor] !== null && typeof item.args[item.cursor] !== 'string')
            || canonicalJson({ ...item.args, [chain.cursor]: chain.args[chain.cursor] }) !== canonicalJson(chain.args)
            || item.follow === false && !isSha256(item.validator)
            || item.follow === true && item.validator !== undefined)
            throw new SnapbackError('S3_PROTOCOL', 'The owner returned an invalid acquisition continuation.');
          accounted.add(`${item.key}:${queryKey(item.op, item.args)}`);
          return ownJson(item);
        });
        for (const item of requestDeclarations) if (!accounted.has(`${item.key}:${queryKey(item.op, item.args)}`))
          throw new SnapbackError('S3_PROTOCOL', 'The acquisition response omitted a requested execution.');
        if (response.more !== (continuations.length > 0))
          throw new SnapbackError('S3_PROTOCOL', 'The acquisition continuation marker is inconsistent.');
        resources = nextResources; rows = nextRows; metadata.seq = response.seq;
        for (const item of continuations) if (item.follow && resources.has(queryKey(item.op, item.args)))
          throw new SnapbackError('S3_PROTOCOL', 'An acquisition cursor repeated a previously admitted page.');
        metadata.pages = resources.size;
        metadata.pending = [...continuations, ...metadata.pending.slice(requestDeclarations.length)];
        metadata.resourceKeys = [...new Set([...metadata.resourceKeys, ...changedResources.map(item => item.key)])];
        await persistProgress(changedRows, changedResources);
        handle.set({ id, status: 'acquiring', pages: metadata.pages, chains: declarations().length, seq: metadata.seq });
      }
      throw new SnapbackError('S3_ACQUISITION_LIMIT', 'Acquisition exceeded its bounded continuation limit.');
    } finally {
      if (this.acquisitionControllers.get(id) === controller) {
        this.acquisitionControllers.delete(id); this.acquisitionRunning.delete(id);
        if (this.acquisitionRerun.delete(id) && this.acquisitionHandles.has(id)) queueMicrotask(() => this.resumeAcquisition(id));
      }
    }
  }

  private async acquireResource<T>(resource: Resource<T>): Promise<ResourceSnapshot<T>> {
    await this.ready;
    if (this.closed) throw new SnapbackError('S3_CLOSED', 'The client is closed.');
    if (!this.session) {
      resource.acquisition = undefined;
      resource.set({ ...loading(), status: 'denied', error: new SnapbackError('S3_AUTH', 'Sign in to load this resource.') });
      return resource.getSnapshot();
    }
    if (!this.allowedOnline) { this.readLocal(resource); return resource.getSnapshot(); }
    const existing = this.acquiring.get(resource.key);
    if (existing) return existing;
    const waiter = deferred<ResourceSnapshot<T>>();
    this.queued.set(resource, waiter);
    this.acquiring.set(resource.key, waiter.promise);
    // A renewal takes the active screen's independent resources in one server
    // snapshot. Each still owns its own availability and failure state.
    for (const sibling of this.resources.values()) if (sibling.active && !this.acquiring.has(sibling.key)) {
      const companion = deferred<ResourceSnapshot<any>>();
      this.queued.set(sibling, companion); this.acquiring.set(sibling.key, companion.promise);
    }
    if (!this.readScheduled) { this.readScheduled = true; queueMicrotask(() => { void this.readBatch(); }); }
    return waiter.promise;
  }

  private async readBatch(): Promise<void> {
    this.readScheduled = false;
    const batch = [...this.queued.entries()]; this.queued.clear();
    const epoch = this.accountEpoch, readEpoch = this.readEpoch, session = this.session;
    let renew = false;
    if (!batch.length) return;
    if (!session) {
      for (const [resource, waiter] of batch) {
        if (this.acquiring.get(resource.key) === waiter.promise) this.acquiring.delete(resource.key);
        waiter.reject(new SnapbackError('S3_AUTH_CHANGED', 'The active account changed.'));
      }
      return;
    }
    try {
      const response = await this.request('/api/read', { method: 'POST', body: JSON.stringify({
        queries: batch.map(([resource]) => ({ key: resource.key, op: resource.op, args: resource.args })),
      }) }, session.token);
      if (epoch !== this.accountEpoch || this.closed) throw new SnapbackError('S3_AUTH_CHANGED', 'The account changed while loading.');
      if (readEpoch !== this.readEpoch) throw new SnapbackError('S3_READ_INVALIDATED', 'The resource changed while loading.');
      await this.receive(response, batch.map(([resource]) => resource), epoch, readEpoch);
    } catch (error) {
      if (epoch === this.accountEpoch && !this.closed) {
      const failure = errorOf(error);
        if (failure.code === 'S3_READ_INVALIDATED' || failure.code === 'S3_STALE_SNAPSHOT') renew = true;
        else if (failure.code === 'S3_AUTH') await this.lostAuthority(failure);
        else {
          if (failure.code === 'S3_GENERATION_CHANGED') this.scheduleRetry();
          else if (failure.code === 'S3_NETWORK') this.networkFailure(error);
          for (const [resource] of batch) {
            this.readLocal(resource);
            const value = resource.getSnapshot();
            if (value.data === undefined && failure.code !== 'S3_NETWORK') resource.set({ ...value, status: 'error', error: failure, fresh: false });
            else resource.set({ ...value, fresh: false, error: failure });
          }
        }
      }
    } finally {
      for (const [resource, waiter] of batch) {
        if (this.acquiring.get(resource.key) === waiter.promise) this.acquiring.delete(resource.key);
        if (epoch !== this.accountEpoch || this.closed) waiter.reject(new SnapbackError('S3_AUTH_CHANGED', 'The active account changed.'));
        else if (renew && this.allowedOnline) void this.acquireResource(resource).then(waiter.resolve, waiter.reject);
        else waiter.resolve(resource.getSnapshot());
      }
    }
  }

  /** HTTP and live frames pass through exactly the same identity, evidence,
   * durability, and per-resource publication boundary. */
  private async receive(response: any, requested: Resource<any>[], epoch: number, readEpoch: number,
    valid: () => boolean = () => true): Promise<void> {
    const assertCurrent = () => {
      if (epoch !== this.accountEpoch || this.closed) throw new SnapbackError('S3_AUTH_CHANGED', 'The active account changed.');
      if (!valid() || readEpoch !== this.readEpoch) throw new SnapbackError('S3_READ_INVALIDATED', 'The resource changed while loading.');
    };
    assertCurrent();
    if (!Array.isArray(response.resources) || response.resources.length !== requested.length
      || !Number.isSafeInteger(response.seq) || response.seq < 0)
      throw new SnapbackError('S3_PROTOCOL', 'The read response is incomplete.');
    if (response.generation !== this.manifest?.generation) {
      await this.loadManifest(epoch);
      throw new SnapbackError('S3_GENERATION_CHANGED', 'The application changed; loading its new resources.');
    }
    if (response.seq < this.minimumSeq) throw new SnapbackError('S3_STALE_SNAPSHOT', 'This response predates an already known commit.');
    const byKey = new Map(response.resources.map((item: any) => [item.key, item]));
    if (byKey.size !== requested.length) throw new SnapbackError('S3_PROTOCOL', 'The read response repeats a resource.');
    const delivered: Array<{ key: string; op: string; args: Args; envelope: DeliveryEnvelopeV1 }> = [];
    const errors = new Map<string, SnapbackError>();
    for (const resource of requested) {
      const item = byKey.get(resource.key) as any;
      if (!item) throw new SnapbackError('S3_PROTOCOL', 'The read response omitted a requested resource.');
      if (item.error) errors.set(resource.key, new SnapbackError(item.error.code ?? 'S3_QUERY', item.error.message ?? 'This resource could not be loaded.'));
      else {
        const envelope = ownDeliveryEnvelope(item.envelope);
        if (envelope.seq !== response.seq) throw new SnapbackError('S3_PROTOCOL', 'Resource sequence differs from its batch.');
        delivered.push({ key: resource.key, op: resource.op, args: resource.args, envelope });
      }
    }
    this.facts ??= new FactPool(this.manifest!, this.session!);
    if (response.seq < this.facts.seq) return;
    const previousSeq = this.facts.seq;
    const staged = this.facts.prepare(delivered, response.seq);
    if (!staged) return;
    if (response.seq > this.minimumSeq) { this.suspendAcquisitions(response.seq); this.staleResources(); }
    this.redactReceived(delivered, errors);
    try { await this.persist({ frame: staged.patch }); }
    catch (error) {
      // Failed positive custody cannot restore an authority already withdrawn by
      // this received replacement. Clear the tiny durable cache pointer too.
      this.facts.clear();
      try { await this.persist({ frame: null }); }
      catch { try { await this.persist({ session: null }); } catch { /* Hard I/O cannot erase bytes; RAM remains redacted. */ } }
      this.storageFailure(error);
      throw error;
    }
    assertCurrent();
    if (response.seq < this.minimumSeq || !staged.commit()) return;
    this.connected = true; this.lastError = undefined; this.retryDelay = 250;
    const changed = new Set<Resource<any>>();
    const deliveries = new Map(delivered.map(item => [item.key, item.envelope]));
    // Prepare every value before notifying any subscriber. A subscriber reading
    // its neighbors sees the complete publication, including resource refusals.
    for (const resource of requested) {
      const failure = errors.get(resource.key);
      resource.acquisition = undefined;
      resource.set(failure
        ? { ...loading(), status: failure.code === 'S3_FORBIDDEN' ? 'denied' : 'error', seq: response.seq, error: failure }
        : this.facts.read(resource.op, resource.args, true) ?? snapshot(deliveries.get(resource.key)!, true), false);
      const accepted = deliveries.get(resource.key);
      resource.references = accepted ? rowReferences(accepted.data) : undefined;
      resource.projection = accepted ? canonicalJson(accepted.data) : undefined;
      changed.add(resource);
    }
    for (const resource of this.resources.values()) if (!byKey.has(resource.key)) {
      if (response.seq > previousSeq) {
        // Unwatched resource data does not acquire a later authorization merely
        // because another resource was delivered. Reuse requires a fresh proof.
        const local = this.facts.read(resource.op, resource.args);
        resource.references = undefined; resource.projection = undefined; resource.acquisition = undefined;
        resource.set(local ?? loading(), false); changed.add(resource);
      } else if (resource.getSnapshot().data === undefined) {
        const local = this.facts.read(resource.op, resource.args);
        if (local) { resource.acquisition = undefined; resource.set(local, false); changed.add(resource); }
      }
    }
    await this.observeOperations();
    for (const resource of changed) resource.notify();
    this.publish();
  }

  // @ref LLP 2000#writes-and-user-work — durable admission and server settlement
  // are distinct; neither a lost reply nor a restart creates a new submission.
  private async admit(intent: Intent<any>, epoch: number): Promise<void> {
    await this.ready;
    if (epoch !== this.accountEpoch || intent.isSealed) throw new SnapbackError('S3_AUTH_CHANGED', 'The account changed before this operation was admitted.');
    if (!this.session) throw new SnapbackError('S3_AUTH', 'Sign in before making changes.');
    if (!this.manifest) throw new SnapbackError('S3_UNAVAILABLE', 'Connect once to load this application.');
    const current = intent.getSnapshot(), program = this.manifest.programs[current.op];
    if (!program || program.kind.toLowerCase() !== 'mutation') throw new SnapbackError('S3_OPERATION_UNKNOWN', `${current.op} is not a mutation.`);
    taggedArgs(this.manifest, current.op, current.args);
    const body = JSON.stringify(ownJson({ op: current.op, args: current.args, intent: intent.id,
      planHash: program.planHash, schemaHash: this.manifest.schemaHash }));
    const entry: StoredOperation = { id: intent.id, principal: this.session.principal.id,
      body, status: 'queued', createdAt: Date.now(), order: ++this.operationOrder };
    await this.persist({ operations: [entry] });
    this.journal.set(entry.id, entry); this.updateIntent(entry); intent.admission();
    this.refreshPredictions(); this.publish();
    void this.drain();
  }

  private updateIntent(entry: StoredOperation): void {
    let intent = this.intents.get(entry.id)!;
    const body = checkedStoredOperation(entry);
    if (intent.isSealed && entry.principal === this.session?.principal.id) {
      intent = new Intent(entry.id, body.op, body.args); this.intents.set(entry.id, intent); intent.admission();
    }
    intent.set({ id: entry.id, op: body.op, args: body.args,
      status: entry.status === 'committed' && !entry.observed && this.awaitingObservation(entry) ? 'observing' : entry.status,
      ...(entry.receipt ? { receipt: entry.receipt } : {}),
      ...(entry.error ? { error: new SnapbackError(entry.error.code, entry.error.message) } : {}) });
    if (entry.receipt) intent.finish(entry.receipt);
  }

  private restoreIntentHandles(): void {
    for (const entry of this.journal.values()) if (entry.principal === this.session?.principal.id) this.updateIntent(entry);
  }

  /** Negative authorization is effective as soon as a checked replacement
   * arrives. It cannot wait for a storage transaction that may never succeed. */
  private redactReceived(delivered: Array<{ key: string; envelope: DeliveryEnvelopeV1 }>, errors: Map<string, SnapbackError>): void {
    const invalidated = new Set<Resource<any>>(), removed = new Set<string>();
    const checked = new Set(delivered.map(item => item.key));
    for (const [key, error] of errors) if (error.code === 'S3_FORBIDDEN' || error.code === 'S3_AUTH') {
      const resource = this.resources.get(key);
      if (resource) {
        invalidated.add(resource);
        for (const ref of resource.references ?? []) removed.add(ref);
      }
    }
    for (const item of delivered) {
      const resource = this.resources.get(item.key);
      if (!resource || resource.getSnapshot().data === undefined) continue;
      const oldRefs = resource.references ?? new Set<string>();
      const nextRefs = rowReferences(item.envelope.data);
      for (const key of oldRefs) if (!nextRefs.has(key)) removed.add(key);
      const changedProjection = oldRefs.size === 0
        && (resource.projection === undefined || resource.projection !== canonicalJson(item.envelope.data));
      if (item.envelope.state === 'denied' || item.envelope.state === 'partial'
        || [...oldRefs].some(key => !nextRefs.has(key)) || changedProjection) invalidated.add(resource);
    }
    if (!invalidated.size) return;
    this.suspendAcquisitions();
    for (const resource of this.resources.values()) if (!checked.has(resource.key) && resource.getSnapshot().data !== undefined) {
      if (!resource.references || [...resource.references].some(key => removed.has(key))) invalidated.add(resource);
    }
    // Independent resources proven safe by this same response keep their useful
    // old values while new positive values wait for durable admission.
    this.facts?.clear();
    for (const resource of invalidated) {
      resource.references = undefined; resource.projection = undefined; resource.acquisition = undefined;
      resource.set(loading(), false);
    }
    for (const resource of invalidated) resource.notify();
  }

  private async drain(): Promise<void> {
    if (this.closed || !this.allowedOnline || !this.connected || !this.session || !this.manifest) return;
    if (this.draining) { this.drainRequested = true; return; }
    this.draining = true;
    const session = this.session, epoch = this.accountEpoch;
    try {
      for (const entry of this.journal.values()) {
        if (this.closed || epoch !== this.accountEpoch || !this.allowedOnline) break;
        if (entry.principal !== session.principal.id || !['queued', 'parked'].includes(entry.status)) continue;
        const intent = this.intents.get(entry.id)!;
        const body = checkedStoredOperation(entry);
        intent.set({ ...intent.getSnapshot(), status: 'sending', error: undefined }); this.publish();
        // Terminal lookup comes before successor checks: a committed lost reply
        // still belongs to the old immutable request after the schema changes.
        let terminal = await this.request(`/api/operation/${encodeURIComponent(entry.id)}`, {}, session.token);
        if (epoch !== this.accountEpoch) break;
        if (terminal?.receipt !== undefined) terminal = terminal.receipt;
        if (!terminal) {
          const program = this.manifest.programs[body.op];
          if (!program || program.planHash !== body.planHash || this.manifest.schemaHash !== body.schemaHash) {
            await this.park(entry, new SnapbackError('S3_OPERATION_CHANGED', 'This saved change uses an older application. Review it before submitting a new change.'));
            continue;
          }
          try { terminal = await this.request('/api/mutation', { method: 'POST', body: entry.body }, session.token); }
          catch (error) {
            const failure = errorOf(error);
            if (!retryable(failure) && failure.code !== 'S3_AUTH') { await this.park(entry, failure); continue; }
            throw failure;
          }
        }
        if (!['committed', 'rejected', 'conflict'].includes(terminal.state) || terminal.intent !== entry.id
          || !Number.isSafeInteger(terminal.seq) || terminal.seq < 0)
          throw new SnapbackError('S3_PROTOCOL', 'The mutation receipt has an invalid identity.');
        const settled: StoredOperation = { ...entry, status: terminal.state, receipt: ownJson(terminal), error: undefined };
        if (terminal.state === 'committed' && !this.awaitingObservation(settled)) settled.observed = true;
        // A process death here leaves the original intent retryable. Receipt
        // durability must finish before observers see a terminal operation.
        await this.persist({ operations: [settled] });
        this.journal.set(entry.id, settled);
        // Retire precisely this durable operation over the still-held base
        // before a sequence renewal. Subscribers never see its predicted row
        // relabelled as an authoritative stale frame.
        this.refreshPredictions(false);
        const advanced = terminal.seq > this.minimumSeq;
        this.minimumSeq = Math.max(this.minimumSeq, terminal.seq);
        if (advanced || terminal.state === 'committed') this.renewResources();
        this.updateIntent(settled); intent.finish(settled.receipt!); this.publish();
      }
    } catch (error) {
      const failure = errorOf(error);
      if (epoch === this.accountEpoch) {
        if (failure.code === 'S3_AUTH') await this.lostAuthority(failure);
        else this.networkFailure(error);
      }
    } finally {
      this.draining = false;
      for (const entry of this.journal.values()) {
        const intent = this.intents.get(entry.id)!;
        if (intent.getSnapshot().status === 'sending') this.updateIntent(entry);
      }
      const rerun = this.drainRequested;
      this.drainRequested = false;
      this.publish();
      if (rerun) void this.drain();
    }
  }

  private async park(entry: StoredOperation, error: SnapbackError): Promise<void> {
    const parked: StoredOperation = { ...entry, status: 'parked', error: { code: error.code, message: error.message } };
    await this.persist({ operations: [parked] });
    this.journal.set(entry.id, parked); this.updateIntent(parked); this.refreshPredictions(); this.publish();
  }

  private awaitingObservation(entry: StoredOperation): boolean {
    if (!entry.receipt || entry.receipt.state !== 'committed') return false;
    const body = checkedStoredOperation(entry), program = this.manifest?.programs[body.op];
    if (!program || this.manifest?.schemaHash !== body.schemaHash || program.planHash !== body.planHash) return false;
    const tables = new Set<string>((program.certificate.write_sites ?? []).map((site: any) => site.table));
    return [...this.resources.values()].some(resource => resource.active
      && (this.manifest?.programs[resource.op]?.certificate.read_sites ?? []).some((site: any) => tables.has(site.table))
      && (resource.getSnapshot().seq ?? -1) < entry.receipt!.seq);
  }

  private async observeOperations(): Promise<void> {
    const observed: StoredOperation[] = [];
    for (const entry of this.journal.values()) if (entry.principal === this.session?.principal.id
      && entry.status === 'committed' && !entry.observed && !this.awaitingObservation(entry)) {
      observed.push({ ...entry, observed: true });
    }
    if (!observed.length) return;
    await this.persist({ operations: observed });
    for (const entry of observed) { this.journal.set(entry.id, entry); this.updateIntent(entry); }
    this.publish();
  }

  private invalidate(): void {
    this.readEpoch++;
    this.facts?.clear();
    this.suspendAcquisitions();
    // Generic invalidations may revoke row visibility. Do not retain their
    // previous authorization while obtaining the next resource batch.
    for (const resource of this.resources.values()) {
      resource.acquisition = undefined;
      resource.set(loading());
      if (resource.active) void this.acquireResource(resource).catch(() => {});
    }
    void this.persist({ frame: null }).catch(error => this.storageFailure(error));
  }

  private renewResources(): void {
    this.readEpoch++;
    this.facts?.clear();
    this.suspendAcquisitions(this.minimumSeq);
    this.staleResources();
    for (const resource of this.resources.values()) if (resource.active) void this.acquireResource(resource).catch(() => {});
    void this.persist({ frame: null }).catch(error => this.storageFailure(error));
  }

  private staleResources(): void {
    for (const resource of this.resources.values()) resource.set({ ...resource.getSnapshot(), fresh: false });
  }

  private startEvents(): void {
    if (this.options.live === false || this.eventController || !this.session || !this.allowedOnline || this.closed || !this.connected) return;
    const requested = [...this.resources.values()].filter(resource => resource.active);
    if (!requested.length) return;
    const queries = requested.map(resource => ({ key: resource.key, op: resource.op, args: resource.args }));
    const controller = new AbortController(); this.eventController = controller;
    this.eventQueries = JSON.stringify(queries.map(query => query.key));
    const session = this.session, epoch = this.accountEpoch;
    void (async () => {
      try {
        const response = await this.fetcher(`${this.url}/api/events`, { method: 'POST',
          headers: { Authorization: `Bearer ${session.token}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ queries }), signal: controller.signal });
        if (!response.ok) throw new SnapbackError(response.status === 401 ? 'S3_AUTH' : 'S3_NETWORK', 'The live connection was refused.');
        if (!response.body) throw new SnapbackError('S3_NETWORK', 'The live connection has no stream.');
        const reader = response.body.getReader(), decoder = new TextDecoder();
        let buffered = '';
        while (!controller.signal.aborted) {
          const chunk = await reader.read();
          if (chunk.done) break;
          buffered += decoder.decode(chunk.value, { stream: true }).replace(/\r\n/g, '\n');
          if (buffered.length > 64 * (5 * 1024 * 1024 + 4096)) throw new SnapbackError('S3_PROTOCOL', 'Live resource batch exceeds its size limit.');
          let end: number;
          while ((end = buffered.indexOf('\n\n')) >= 0) {
            const frame = buffered.slice(0, end); buffered = buffered.slice(end + 2);
            if (epoch !== this.accountEpoch || this.closed || controller.signal.aborted) return;
            const lines = frame.split('\n');
            const event = lines.find(line => line.startsWith('event:'))?.slice(6).trim();
            if (event === 'auth') { await this.lostAuthority(new SnapbackError('S3_AUTH', 'Sign in again to continue.')); return; }
            if (event === 'invalidate') this.invalidate();
            if (event === 'resources') {
              const data = lines.filter(line => line.startsWith('data:')).map(line => line.slice(5).trimStart()).join('\n');
              const readEpoch = this.readEpoch;
              try { await this.receive(JSON.parse(data), requested, epoch, readEpoch, () => !controller.signal.aborted); }
              catch (error) {
                const code = errorOf(error).code;
                if (code === 'S3_READ_INVALIDATED') continue;
                if (code === 'S3_STALE_SNAPSHOT') {
                  for (const resource of requested) if (resource.active) void this.acquireResource(resource).catch(() => {});
                  continue;
                }
                if (code === 'S3_GENERATION_CHANGED') { this.stopEvents(); this.refreshEvents(); return; }
                throw error;
              }
            }
          }
        }
        if (!controller.signal.aborted && epoch === this.accountEpoch) throw new SnapbackError('S3_NETWORK', 'The live connection ended.');
      } catch (error) {
        if (!controller.signal.aborted && epoch === this.accountEpoch && !this.closed) {
          if (errorOf(error).code === 'S3_AUTH') await this.lostAuthority(errorOf(error));
          else this.networkFailure(error);
        }
      } finally { if (this.eventController === controller) this.eventController = undefined; }
    })();
  }

  private refreshEvents(): void {
    if (this.eventsScheduled || this.closed) return;
    this.eventsScheduled = true;
    queueMicrotask(() => {
      this.eventsScheduled = false;
      const keys = JSON.stringify([...this.resources.values()].filter(resource => resource.active).map(resource => resource.key));
      if (keys === this.eventQueries && this.eventController) return;
      this.stopEvents(); this.startEvents();
    });
  }

  private stopEvents(): void { this.eventController?.abort(); this.eventController = undefined; this.eventQueries = ''; }

  private async lostAuthority(error: SnapbackError): Promise<void> {
    this.clearAuthority(); this.lastError = error; this.publish();
    await this.persist({ session: null });
  }

  private networkFailure(error: unknown): void {
    this.connected = false; this.lastError = errorOf(error);
    this.stopEvents(); this.staleResources(); this.publish(); this.scheduleRetry();
  }

  private scheduleRetry(): void {
    if (this.retryTimer || this.closed || !this.allowedOnline) return;
    this.retryTimer = timer(() => { this.retryTimer = undefined; void this.reconnect().catch(() => {}); }, this.retryDelay);
    this.retryDelay = Math.min(10_000, this.retryDelay * 2);
  }

  private publish(): void {
    const pending: OperationSnapshot[] = [];
    for (const [id, entry] of this.journal) if (entry.principal === this.session?.principal.id && !entry.dismissed) {
      const value = this.intents.get(id)!.getSnapshot();
      if (isPending(value.status)) pending.push(value);
    }
    const next: ClientSnapshot = { status: !this.session ? 'signed-out' : this.connected && this.allowedOnline ? 'online' : 'offline',
      principal: this.session?.principal ?? null, pending: Object.freeze(pending),
      ...(this.lastError ? { error: this.lastError } : {}) };
    const previous = this.getSnapshot();
    if (previous.status === next.status && previous.principal === next.principal
      && previous.error === next.error && previous.pending.length === next.pending.length
      && previous.pending.every((item, index) => item === next.pending[index])) return;
    this.set(next);
  }

  private persist(patch: StoragePatch): Promise<void> {
    if (this.closed) return Promise.reject(new SnapbackError('S3_CLOSED', 'The client is closed.'));
    const previous = this.persistence;
    const next = storageJob(this.storage, async () => { await previous; await this.storage.write({ ...patch, source: this.clientId }); })
      .catch(error => { throw errorOf(error, 'S3_STORAGE'); });
    this.persistence = next.catch(() => {});
    return next;
  }

  /** Withdrawal failures cannot share the ordinary swallowed persistence tail:
   * the durable session fallback must finish before any restore can run. */
  private persistFailClosed(patch: StoragePatch, epoch: number,
    acquisition?: NonNullable<StoragePatch['cancelAcquisition']>): Promise<void> {
    if (this.closed) return Promise.reject(new SnapbackError('S3_CLOSED', 'The client is closed.'));
    const authority = this.session && { token: this.session.token, principal: this.session.principal.id, authEpoch: this.session.authEpoch };
    const previous = this.persistence;
    const next = storageJob(this.storage, async () => {
      await previous;
      try { await this.storage.write({ ...patch, source: this.clientId }); }
      catch (error) {
        const failure = errorOf(error, 'S3_STORAGE');
        if (epoch === this.accountEpoch && !this.closed) {
          this.storageFailure(failure); this.clearAuthority();
        }
        if (authority) try { await this.storage.write({ clearSession: { ...authority, ...(acquisition ? { acquisition } : {}) },
          source: this.clientId }); }
        catch (fallback) {
          if (epoch === this.accountEpoch && !this.closed) this.storageFailure(errorOf(fallback, 'S3_STORAGE'));
        }
        throw failure;
      }
    });
    this.persistence = next.catch(() => {});
    return next;
  }

  private storageFailure(error: unknown): void {
    this.lastError = errorOf(error, 'S3_STORAGE'); this.publish();
  }

  private async storageAuthorityChanged(epoch: number): Promise<void> {
    const stored = await this.storage.load();
    if (this.closed || epoch !== this.accountEpoch || stored.session?.token === this.session?.token) return;
    if (stored.session && stored.session.expiresAt > Date.now()) {
      this.session = this.checkedSession(stored.session);
      if (stored.manifest) this.manifest = validateManifest(stored.manifest);
      this.facts = this.manifest ? new FactPool(this.manifest, this.session) : null;
      this.restoreAcquisitions(stored);
      // Restore recoverable work for the newly selected account; the operation
      // ledger still owns the terminal identity if two tabs drain concurrently.
      for (const entry of stored.operations) {
        const body = checkedStoredOperation(entry);
        this.operationOrder = Math.max(this.operationOrder, entry.order ?? ++this.operationOrder);
        let intent = this.intents.get(entry.id);
        if (!intent) { intent = new Intent(entry.id, body.op, body.args); this.intents.set(entry.id, intent); }
        this.journal.set(entry.id, entry); this.updateIntent(entry); intent.admission();
        if (entry.receipt) intent.finish(entry.receipt);
      }
      this.refreshPredictions(false);
      this.scheduleExpiry(); this.publish();
      if (this.allowedOnline) await this.reconnect();
    }
  }

  private async request(path: string, init: RequestInit = {}, token?: string): Promise<any> {
    if (this.closed) throw new SnapbackError('S3_CLOSED', 'The client is closed.');
    if (!this.allowedOnline) throw new SnapbackError('S3_NETWORK', 'This client is offline.');
    const controller = new AbortController(); this.requests.add(controller);
    const externalSignal = init.signal;
    const abort = () => controller.abort();
    if (externalSignal?.aborted) controller.abort();
    else externalSignal?.addEventListener('abort', abort, { once: true });
    const headers = new Headers(init.headers);
    if (init.body !== undefined) headers.set('Content-Type', 'application/json');
    if (token) headers.set('Authorization', `Bearer ${token}`);
    try {
      let response: Response;
      try { response = await this.fetcher(`${this.url}${path}`, { ...init, headers, signal: controller.signal }); }
      catch (error) { throw errorOf(error, 'S3_NETWORK'); }
      let body;
      try { body = response.status === 204 ? null : await response.json(); }
      catch { throw new SnapbackError('S3_RESPONSE_INVALID', 'The server response could not be decoded; its outcome is unknown.', { status: response.status }); }
      if (!response.ok) {
        const failure = body?.error ?? body;
        throw new SnapbackError(failure?.code ?? (response.status === 401 ? 'S3_AUTH' : 'S3_HTTP'),
          failure?.message ?? `Request failed (${response.status}).`, { ...failure, status: response.status });
      }
      return body;
    } finally { externalSignal?.removeEventListener('abort', abort); this.requests.delete(controller); }
  }
}

export function createClient(options: ClientOptions): SnapbackClient { return new SnapbackClient(options); }
/** Platform entrypoints inject native defaults without disguising an explicit
 * caller-owned storage adapter as client-owned state. */
export function createPlatformClient(options: ClientOptions, platform: ClientPlatformDefaults): SnapbackClient {
  return new SnapbackClient(options, platform);
}
