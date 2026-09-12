import { referenceName, type Op } from './api.js';
import { FactPool, queryKey, snapshot, taggedArgs, validateManifest } from './resource/facts.js';
import { isSha256 } from '../../evaluator/src/hash.js';
import { ownDeliveryEnvelope, type DeliveryEnvelopeV1 } from './resource/protocol.js';
import { rowReferences } from './resource/row-values.js';
import { canonicalJson } from '../../evaluator/src/value-runtime.js';
import { deferred, errorOf, ownJson, Signal } from './resource/signal.js';
import { createIndexedDBStorage, createMemoryStorage } from './resource/storage.js';
import { SnapbackError, type Args, type ClientSnapshot, type ClientStorage, type Manifest,
  type MutationReceipt, type Operation, type OperationSnapshot, type QueryResource, type ResourceSnapshot,
  type Session, type StoragePatch, type StoredOperation } from './resource/types.js';

export { api, referenceName } from './api.js';
export type { Op, Channel, Api, ArgsOf, ResultOf } from './api.js';
export { createIndexedDBStorage, createMemoryStorage, SnapbackError };
export type { ClientSnapshot, ClientStorage, MutationReceipt, Operation, OperationSnapshot,
  QueryResource, ResourceSnapshot, Session, StoragePatch, StoredState } from './resource/types.js';

export interface ClientOptions {
  url: string;
  storage?: ClientStorage | false;
  fetch?: typeof globalThis.fetch;
  /** Disable the event connection for a request-only host. Queries and writes still work. */
  live?: boolean;
}

const loading = <T>(): ResourceSnapshot<T> => ({ data: undefined, status: 'loading', complete: false, fresh: false });
const nameOf = (ref: string | Op<any, any, any>): string => typeof ref === 'string' ? ref : referenceName(ref);
const isPending = (state: string): boolean => ['persisting', 'queued', 'sending', 'observing', 'parked', 'error', 'rejected', 'conflict'].includes(state);
const retryable = (error: SnapbackError): boolean => ['S3_NETWORK', 'S3_OWNER_BUSY', 'S3_WORKER_TIMEOUT', 'S3_WORKER_IO',
  'S3_WORKER_EXIT', 'S3_WORKER_CLOSED', 'S3_UNAVAILABLE', 'S3_RESPONSE_INVALID'].includes(error.code)
  || [408, 425, 429, 500, 502, 503, 504].includes((error.details as any)?.status);
const timer = (fn: () => void, ms: number): ReturnType<typeof setTimeout> => {
  const handle = setTimeout(fn, ms);
  (handle as any).unref?.();
  return handle;
};

class Resource<T> extends Signal<ResourceSnapshot<T>> implements QueryResource<T> {
  active = false;
  references?: Set<string>;
  projection?: string;
  readonly key: string;
  constructor(readonly op: string, readonly args: Args,
    private readonly acquire: () => Promise<ResourceSnapshot<T>>, demand: (active: boolean) => void) {
    super(loading<T>(), demand);
    this.key = queryKey(op, args);
  }
  refresh = (): Promise<ResourceSnapshot<T>> => this.acquire();
}

class Intent<T> extends Signal<OperationSnapshot<T>> implements Operation<T> {
  private readonly admitted = deferred<void>();
  private readonly terminal = deferred<MutationReceipt<T>>();
  readonly durable = this.admitted.promise;
  private sealed = false;
  private readonly sealedResult = deferred<MutationReceipt<T>>();
  get settled(): Promise<MutationReceipt<T>> { return this.sealed ? this.sealedResult.promise : this.terminal.promise; }
  get isSealed(): boolean { return this.sealed; }
  constructor(readonly id: string, op: string, args: Args) { super({ id, op, args, status: 'persisting' }); }
  admission(): void { this.admitted.resolve(); }
  finish(receipt: MutationReceipt<T>): void { if (!this.sealed) this.terminal.resolve(receipt); }
  fail(error: SnapbackError): void { this.admitted.reject(error); this.terminal.reject(error); }
  override set(value: OperationSnapshot<T>, notify = true): void { if (!this.sealed) super.set(value, notify); }
  seal(notify = true): boolean {
    if (this.sealed) return false;
    this.sealed = true;
    const error = new SnapbackError('S3_AUTH_CHANGED', 'This operation belongs to a previous account session. Sign in to recover its current handle.');
    super.set({ id: this.id, op: '', args: Object.freeze({}), status: 'sealed', error }, notify);
    this.admitted.reject(error); this.terminal.reject(error); this.sealedResult.reject(error);
    return true;
  }
}

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
  private readonly fetcher: typeof globalThis.fetch;
  private readonly resources = new Map<string, Resource<any>>();
  private readonly intents = new Map<string, Intent<any>>();
  private readonly journal = new Map<string, StoredOperation>();
  private readonly clientId = globalThis.crypto.randomUUID();
  private readonly releaseStorageListener?: () => void;
  private readonly requests = new Set<AbortController>();
  private readonly queued = new Map<Resource<any>, ReturnType<typeof deferred<ResourceSnapshot<any>>>>();
  private readonly acquiring = new Map<string, Promise<ResourceSnapshot<any>>>();
  private session: Session | null = null;
  private manifest: Manifest | null = null;
  private facts: FactPool | null = null;
  private persistence = Promise.resolve();
  private accountEpoch = 0;
  private readEpoch = 0;
  /** Monotonic authority knowledge survives fact eviction and local cache clears. */
  private minimumSeq = 0;
  private manifestRequest = 0;
  private allowedOnline = true;
  private connected = false;
  private closed = false;
  private draining = false;
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

  constructor(private readonly options: ClientOptions) {
    super({ status: 'starting', principal: null, pending: [] });
    this.url = options.url.replace(/\/+$/, '');
    this.fetcher = options.fetch ?? globalThis.fetch.bind(globalThis);
    this.storage = options.storage === false ? createMemoryStorage()
      : options.storage ?? (typeof indexedDB === 'undefined' ? createMemoryStorage() : createIndexedDBStorage(`snapback3:${this.url}`));
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
    if (typeof window !== 'undefined') {
      window.addEventListener('online', this.browserOnline);
      window.addEventListener('offline', this.browserOffline);
    }
  }

  watch<A, T>(operation: Op<A, T, any>, args: A): QueryResource<T>;
  watch<T = unknown>(operation: string, args?: Args): QueryResource<T>;
  watch<T>(operation: string | Op<any, T, any>, input: Args = {}): QueryResource<T> {
    const op = nameOf(operation), args = ownJson(input), key = queryKey(op, args);
    const existing = this.resources.get(key);
    if (existing) return existing;
    const resource: Resource<T> = new Resource<T>(op, args, () => this.acquire(resource), active => {
      resource.active = active;
      if (active) {
        this.readLocal(resource);
        if (this.options.live === false || !this.connected || !this.session) void this.acquire(resource).catch(() => {});
      }
      this.refreshEvents();
      if (!active) void this.observeOperations().catch(error => this.storageFailure(error));
    });
    this.resources.set(key, resource);
    this.readLocal(resource);
    return resource;
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
    const op = nameOf(operation), args = ownJson(input);
    const intent = new Intent<T>(globalThis.crypto.randomUUID(), op, args);
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
      await Promise.allSettled([...this.resources.values()].filter(resource => resource.active).map(resource => this.acquire(resource)));
      await this.drain();
    } catch (error) { this.networkFailure(error); }
  }

  close(): void {
    if (this.closed) return;
    this.closed = true; this.accountEpoch++;
    this.releaseStorageListener?.();
    this.stopEvents(); clearTimeout(this.retryTimer); clearTimeout(this.expiryTimer);
    for (const controller of this.requests) controller.abort();
    for (const waiter of this.queued.values()) waiter.reject(new SnapbackError('S3_CLOSED', 'The client is closed.'));
    this.queued.clear();
    if (typeof window !== 'undefined') {
      window.removeEventListener('online', this.browserOnline);
      window.removeEventListener('offline', this.browserOffline);
    }
    if (!this.options.storage) void this.persistence.finally(() => this.storage.close?.());
  }

  private async initialize(): Promise<void> {
    try {
      let state;
      for (;;) {
        const epoch = this.accountEpoch;
        state = await this.storage.load();
        if (this.closed || epoch === this.accountEpoch) break;
      }
      if (this.closed) return;
      if (state.version !== 1 || !Array.isArray(state.operations)) throw new SnapbackError('S3_STORAGE', 'Local state has an unsupported format.');
      if (state.manifest) this.manifest = validateManifest(state.manifest);
      if (state.session && state.session.expiresAt > Date.now()) this.session = this.checkedSession(state.session);
      for (const entry of state.operations) {
        const body = this.checkedBody(entry);
        const intent = new Intent(entry.id, body.op, body.args);
        this.journal.set(entry.id, entry); this.intents.set(entry.id, intent);
        this.updateIntent(entry); intent.admission();
        if (entry.receipt) intent.finish(entry.receipt);
      }
      if (this.manifest && this.session) {
        this.facts = new FactPool(this.manifest, this.session);
        if (state.frame) this.facts.restore(state.frame);
        this.minimumSeq = Math.max(0, this.facts.seq,
          ...[...this.journal.values()].filter(entry => entry.principal === this.session!.principal.id).map(entry => entry.receipt?.seq ?? 0));
      }
      this.scheduleExpiry();
      for (const resource of this.resources.values()) this.readLocal(resource);
      try { await this.loadManifest(this.accountEpoch); this.connected = true; }
      catch (error) { this.connected = false; this.lastError = errorOf(error); }
      this.publish(); this.startEvents();
      queueMicrotask(() => { void this.drain(); });
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

  private async signIn(method: string, args: Args): Promise<Session> {
    await this.ready;
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
      this.restoreIntentHandles();
      this.connected = true; this.lastError = undefined;
      this.scheduleExpiry(); this.publish(); this.startEvents();
      for (const resource of this.resources.values()) if (resource.active) void this.acquire(resource).catch(() => {});
      void this.drain();
      return session;
    } catch (error) {
      if (epoch === this.accountEpoch) { this.lastError = errorOf(error); this.publish(); }
      throw error;
    }
  }

  private async signOut(): Promise<void> {
    await this.ready;
    const previous = this.session;
    this.clearAuthority();
    await this.persist({ session: null });
    if (previous && this.allowedOnline) {
      try { await this.request('/api/auth/logout', { method: 'POST', body: '{}' }, previous.token); } catch { /* Local logout also works offline. */ }
    }
  }

  private clearAuthority(): void {
    this.accountEpoch++; this.readEpoch++; this.minimumSeq = 0; this.session = null; this.facts = null;
    this.stopEvents(); clearTimeout(this.expiryTimer);
    for (const controller of this.requests) controller.abort();
    const failure = new SnapbackError('S3_AUTH_CHANGED', 'The active account changed.');
    for (const waiter of this.queued.values()) waiter.reject(failure);
    this.queued.clear(); this.acquiring.clear();
    for (const resource of this.resources.values()) {
      resource.references = undefined; resource.projection = undefined; resource.set(loading(), false);
    }
    const sealed = [...this.intents.values()].filter(intent => intent.seal(false));
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
    if (manifest.seq < this.minimumSeq) throw new SnapbackError('S3_STALE_SNAPSHOT', 'The manifest predates an already known commit.');
    const changed = this.manifest?.generation !== manifest.generation || this.manifest.schemaHash !== manifest.schemaHash;
    const advanced = this.facts !== null && manifest.seq > this.facts.seq;
    this.manifest = manifest;
    if (changed || advanced) {
      this.readEpoch++;
      this.facts = this.session ? new FactPool(manifest, this.session) : null;
      for (const resource of this.resources.values()) resource.set(loading());
    }
    await this.persist({ manifest, ...(changed || advanced ? { frame: null } : {}) });
    if (changed) await this.observeOperations();
  }

  private readLocal(resource: Resource<any>): void {
    if (!this.session || this.session.expiresAt <= Date.now()) return;
    if (this.facts && this.facts.seq < this.minimumSeq) return;
    const local = this.facts?.read(resource.op, resource.args);
    if (local) {
      const envelope = this.facts?.envelope(resource.key);
      resource.references = envelope ? rowReferences(envelope.data) : undefined;
      resource.projection = envelope ? canonicalJson(envelope.data) : undefined;
      resource.set(local);
    }
  }

  private async acquire<T>(resource: Resource<T>): Promise<ResourceSnapshot<T>> {
    await this.ready;
    if (this.closed) throw new SnapbackError('S3_CLOSED', 'The client is closed.');
    if (!this.session) {
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
        else if (renew && this.allowedOnline) void this.acquire(resource).then(waiter.resolve, waiter.reject);
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
    if (response.seq > this.minimumSeq) { this.minimumSeq = response.seq; this.staleResources(); }
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
      resource.set(failure
        ? { ...loading(), status: failure.code === 'S3_FORBIDDEN' ? 'denied' : 'error', seq: response.seq, error: failure }
        : snapshot(deliveries.get(resource.key)!, true), false);
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
        resource.references = undefined; resource.projection = undefined;
        resource.set(local ?? loading(), false); changed.add(resource);
      } else if (resource.getSnapshot().data === undefined) {
        const local = this.facts.read(resource.op, resource.args);
        if (local) { resource.set(local, false); changed.add(resource); }
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
      body, status: 'queued', createdAt: Date.now() };
    await this.persist({ operations: [entry] });
    this.journal.set(entry.id, entry); this.updateIntent(entry); intent.admission(); this.publish();
    void this.drain();
  }

  private checkedBody(entry: StoredOperation): { op: string; args: Args; intent: string; planHash: string; schemaHash: string } {
    const body = JSON.parse(entry.body);
    if (!/^[A-Za-z0-9_-]{1,128}$/.test(entry.id) || typeof entry.principal !== 'string'
      || body.intent !== entry.id || typeof body.op !== 'string' || !body.op
      || !isSha256(body.planHash) || !isSha256(body.schemaHash) || !body.args || Array.isArray(body.args)
      || !['queued', 'parked', 'committed', 'rejected', 'conflict'].includes(entry.status)
      || !Number.isSafeInteger(entry.createdAt) || entry.createdAt < 0)
      throw new SnapbackError('S3_STORAGE', 'A pending operation has invalid identity.');
    if (entry.receipt && (entry.receipt.intent !== entry.id || entry.receipt.state !== entry.status
      || !['committed', 'rejected', 'conflict'].includes(entry.receipt.state)
      || !Number.isSafeInteger(entry.receipt.seq) || entry.receipt.seq < 0)
      || ['committed', 'rejected', 'conflict'].includes(entry.status) && !entry.receipt)
      throw new SnapbackError('S3_STORAGE', 'A saved operation has an invalid terminal receipt.');
    return ownJson(body);
  }

  private updateIntent(entry: StoredOperation): void {
    let intent = this.intents.get(entry.id)!;
    const body = this.checkedBody(entry);
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
    for (const resource of this.resources.values()) if (!checked.has(resource.key) && resource.getSnapshot().data !== undefined) {
      if (!resource.references || [...resource.references].some(key => removed.has(key))) invalidated.add(resource);
    }
    // Independent resources proven safe by this same response keep their useful
    // old values while new positive values wait for durable admission.
    this.facts?.clear();
    for (const resource of invalidated) { resource.references = undefined; resource.projection = undefined; resource.set(loading(), false); }
    for (const resource of invalidated) resource.notify();
  }

  private async drain(): Promise<void> {
    if (this.draining || this.closed || !this.allowedOnline || !this.connected || !this.session || !this.manifest) return;
    this.draining = true;
    const session = this.session, epoch = this.accountEpoch;
    try {
      for (const entry of this.journal.values()) {
        if (this.closed || epoch !== this.accountEpoch || !this.allowedOnline) break;
        if (entry.principal !== session.principal.id || !['queued', 'parked'].includes(entry.status)) continue;
        const intent = this.intents.get(entry.id)!;
        const body = this.checkedBody(entry);
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
        this.minimumSeq = Math.max(this.minimumSeq, terminal.seq);
        const settled: StoredOperation = { ...entry, status: terminal.state, receipt: ownJson(terminal), error: undefined };
        if (terminal.state === 'committed' && !this.awaitingObservation(settled)) settled.observed = true;
        // A process death here leaves the original intent retryable. Receipt
        // durability must finish before observers see a terminal operation.
        await this.persist({ operations: [settled] });
        this.journal.set(entry.id, settled); this.updateIntent(settled); intent.finish(settled.receipt!); this.publish();
        if (epoch === this.accountEpoch && terminal.state === 'committed') this.renewResources();
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
      this.publish();
    }
  }

  private async park(entry: StoredOperation, error: SnapbackError): Promise<void> {
    const parked: StoredOperation = { ...entry, status: 'parked', error: { code: error.code, message: error.message } };
    await this.persist({ operations: [parked] });
    this.journal.set(entry.id, parked); this.updateIntent(parked); this.publish();
  }

  private awaitingObservation(entry: StoredOperation): boolean {
    if (!entry.receipt || entry.receipt.state !== 'committed') return false;
    const body = this.checkedBody(entry), program = this.manifest?.programs[body.op];
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
    // Generic invalidations may revoke row visibility. Do not retain their
    // previous authorization while obtaining the next resource batch.
    for (const resource of this.resources.values()) {
      resource.set(loading());
      if (resource.active) void this.acquire(resource).catch(() => {});
    }
    void this.persist({ frame: null }).catch(error => this.storageFailure(error));
  }

  private renewResources(): void {
    this.readEpoch++;
    this.facts?.clear();
    this.staleResources();
    for (const resource of this.resources.values()) if (resource.active) void this.acquire(resource).catch(() => {});
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
                  for (const resource of requested) if (resource.active) void this.acquire(resource).catch(() => {});
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
    this.set({ status: !this.session ? 'signed-out' : this.connected && this.allowedOnline ? 'online' : 'offline',
      principal: this.session?.principal ?? null, pending: Object.freeze(pending),
      ...(this.lastError ? { error: this.lastError } : {}) });
  }

  private persist(patch: StoragePatch): Promise<void> {
    const next = this.persistence.then(() => this.storage.write({ ...patch, source: this.clientId }))
      .catch(error => { throw errorOf(error, 'S3_STORAGE'); });
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
      // Restore recoverable work for the newly selected account; the operation
      // ledger still owns the terminal identity if two tabs drain concurrently.
      for (const entry of stored.operations) {
        const body = this.checkedBody(entry);
        let intent = this.intents.get(entry.id);
        if (!intent) { intent = new Intent(entry.id, body.op, body.args); this.intents.set(entry.id, intent); }
        this.journal.set(entry.id, entry); this.updateIntent(entry); intent.admission();
        if (entry.receipt) intent.finish(entry.receipt);
      }
      this.scheduleExpiry(); this.publish();
      if (this.allowedOnline) await this.reconnect();
    }
  }

  private async request(path: string, init: RequestInit = {}, token?: string): Promise<any> {
    if (this.closed) throw new SnapbackError('S3_CLOSED', 'The client is closed.');
    if (!this.allowedOnline) throw new SnapbackError('S3_NETWORK', 'This client is offline.');
    const controller = new AbortController(); this.requests.add(controller);
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
    } finally { this.requests.delete(controller); }
  }
}

export function createClient(options: ClientOptions): SnapbackClient { return new SnapbackClient(options); }
