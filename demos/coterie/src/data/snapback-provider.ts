import type {
  ContractDataProvider,
  DataCellV2,
  DataConnection,
  DataMutationCorrelation,
  DataMutationResult,
  DataObserver,
  DataSubscription,
  SerializedError,
} from '@exact/contract/runtime';

import { createAssetClient } from '../../../../packages/snapback-client/assets.mjs';
import { SnapbackClient } from '../../../../packages/snapback-client/online.mjs';
import {
  AuthCoordinator,
  createMemoryAuthCustodyStorage,
  type SnapbackAuthCustodyStorage,
} from '../../../../packages/snapback-contract/auth-coordinator.mjs';
import { createIndexedDbAuthCustodyStorage } from '../../../../packages/snapback-contract/auth-custody-indexeddb.mjs';

import type {
  GeneratedApi,
  GeneratedDataModel,
} from '../../snapback/generated/api.d.ts';
// TypeScript's bundler resolver does not pair generated `.mjs` modules with
// their adjacent `.d.ts` declaration, so preserve that generated type here.
// @ts-expect-error generated Snapback ESM is typed by the adjacent api.d.ts
import { api as generatedApi } from '../../snapback/generated/api.mjs';
import { coterieAvatarUrlForRef } from './coterie-fixtures.ts';
import { coterieSurfaceManifest } from './memory-provider.ts';

const api = generatedApi as GeneratedApi;

export const COTERIE_SNAPBACK_MILESTONE = 'M1' as const;

export const COTERIE_SNAPBACK_M1_OPERATIONS = Object.freeze({
  queries: Object.freeze(['listSession', 'listProfiles']),
  mutations: Object.freeze([
    'signup',
    'login',
    'logout',
    'editProfile',
    'setAvatar',
  ]),
});

const M1_QUERY_NAMES = new Set<string>(COTERIE_SNAPBACK_M1_OPERATIONS.queries);
const M1_MUTATION_NAMES = new Set<string>(COTERIE_SNAPBACK_M1_OPERATIONS.mutations);
const M2_QUERY_NAMES = new Set([
  'listFeed',
  'listInsights',
  'listProfilePosts',
  'listThread',
]);
const M3_QUERY_NAMES = new Set(['listChats', 'listMessages', 'searchSocial']);
const M2_MUTATION_NAMES = new Set(['createPost', 'setFollow', 'setLike', 'setRepost']);
const M3_MUTATION_NAMES = new Set([
  'sendMessage',
  'setChatAccent',
  'setDisappearing',
]);

const PROFILE_STREAM_TIMEOUT_MS = 10_000;
const AVATAR_ASSET_CACHE_LIMIT = 32;
const AVATAR_MEDIA_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp']);
const SESSION_REQUIRED_CODES = new Set([
  'SNAPBACK_AUTH_SESSION_EXPIRED',
  'SNAPBACK_AUTH_SESSION_REVOKED',
]);
const AVATAR_REFERENCE_ADMISSION_CODES = new Set([
  'SNAPBACK_ASSET_MEDIA_BOUNDS_EXCEEDED',
  'SNAPBACK_ASSET_MEDIA_TYPE_UNSUPPORTED',
]);
let providerSequence = 0;

type CoterieSnapbackCustody = 'auto' | 'memory' | 'indexeddb';

export interface CoterieSnapbackProviderOptions {
  baseUrl?: string;
  custody?: CoterieSnapbackCustody;
  clientStoreId?: string;
  storagePartition?: string;
  /** Narrow fault/delivery seams used only by the adapter's regression suite. */
  __testHooks?: {
    beforeAuthResult?(operation: 'login' | 'signup'): void | Promise<void>;
    beforeEnsureProfile?(operation: 'signup' | 'signup-recovery'): void | Promise<void>;
    beforeAvatarAttach?(facts: {
      assetId: string;
      reused: boolean;
      sourceDigest: string;
    }): void | Promise<void>;
    onAvatarAssetSelected?(facts: {
      assetId: string;
      reused: boolean;
      sourceDigest: string;
    }): void;
    profileDeliveryTimeoutMs?: number;
    suppressProfileUpdate?(rows: readonly BackendProfileRow[]): boolean;
  };
}

export interface CoterieSnapbackProvider extends ContractDataProvider {
  readonly milestone: typeof COTERIE_SNAPBACK_MILESTONE;
  readonly baseUrl: string;
  close(): Promise<void>;
  dispose(): void;
}

type BackendProfileRow = GeneratedDataModel['profiles'];

interface BackendSessionCredential {
  session: {
    id: string;
    userId: string;
    expiresAt: number;
  };
}

interface ProfileSubscription<T> {
  active: boolean;
  generation: number;
  observer: DataObserver<T>;
  handle: {
    readonly rows: readonly BackendProfileRow[];
    readonly connection: unknown;
    dispose(): void | Promise<void>;
  } | null;
  start: Promise<void> | null;
  connection: DataConnection;
  lastValue?: T;
}

interface AuthResultState {
  profileExists: boolean;
  value: {
    userId: string;
    sessionToken: string;
  };
}

class NamedProviderError extends Error {
  constructor(name: string, message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = name;
  }
}

function environmentValue(name: string): string | undefined {
  const metaEnvironment = (import.meta as ImportMeta & {
    env?: Record<string, string | boolean | undefined>;
  }).env;
  const metaValue = metaEnvironment?.[name];
  if (typeof metaValue === 'string' && metaValue.length > 0) return metaValue;
  if (typeof process !== 'undefined') {
    const processValue = process.env[name];
    if (typeof processValue === 'string' && processValue.length > 0) return processValue;
  }
  return undefined;
}

export function resolveCoterieSnapbackUrl(explicit?: string): string {
  const configured = explicit ?? environmentValue('COTERIE_SNAPBACK_URL');
  if (!configured) {
    throw new Error(
      'COTERIE_PROVIDER=snapback requires COTERIE_SNAPBACK_URL; refusing to fall back to memory',
    );
  }
  let parsed: URL;
  try {
    parsed = new URL(configured);
  } catch (cause) {
    throw new Error('COTERIE_SNAPBACK_URL must be an absolute HTTP(S) server URL', { cause });
  }
  if (
    (parsed.protocol !== 'http:' && parsed.protocol !== 'https:')
    || parsed.username
    || parsed.password
    || parsed.search
    || parsed.hash
    || (parsed.pathname !== '/' && parsed.pathname !== '')
  ) {
    throw new Error(
      'COTERIE_SNAPBACK_URL must be an HTTP(S) origin with no credentials, path, query, or fragment',
    );
  }
  return parsed.origin;
}

function resolvedCustody(explicit?: CoterieSnapbackCustody): CoterieSnapbackCustody {
  const configured = explicit ?? environmentValue('COTERIE_SNAPBACK_CUSTODY') ?? 'auto';
  if (configured === 'auto' || configured === 'memory' || configured === 'indexeddb') {
    return configured;
  }
  throw new Error(
    `Unknown COTERIE_SNAPBACK_CUSTODY "${configured}"; valid values: auto, indexeddb, memory`,
  );
}

function createCustodyStorage(custody: CoterieSnapbackCustody): SnapbackAuthCustodyStorage & {
  close?(): Promise<void>;
} {
  const indexedDbAvailable = typeof globalThis.indexedDB?.open === 'function';
  if (custody === 'indexeddb' || (custody === 'auto' && indexedDbAvailable)) {
    if (!indexedDbAvailable) {
      throw new Error(
        'COTERIE_SNAPBACK_CUSTODY=indexeddb requires a browser IndexedDB implementation',
      );
    }
    return createIndexedDbAuthCustodyStorage();
  }
  return createMemoryAuthCustodyStorage({ state: { custody: {} } });
}

function milestoneForOperation(name: string): 'M2' | 'M3' | null {
  if (M2_QUERY_NAMES.has(name) || M2_MUTATION_NAMES.has(name)) return 'M2';
  if (M3_QUERY_NAMES.has(name) || M3_MUTATION_NAMES.has(name)) return 'M3';
  return null;
}

function milestoneRefusal(name: string): NamedProviderError {
  const milestone = milestoneForOperation(name) ?? 'M2/M3';
  return new NamedProviderError(
    'SnapbackMilestoneUnsupportedError',
    `snapback provider claims M1 only; ${name} arrives with M2/M3 — LLP 0266 D7 (${milestone})`,
  );
}

function serialized(error: unknown): SerializedError {
  if (error instanceof Error) {
    return {
      name: error.name,
      message: error.message,
      ...(error.stack ? { stack: error.stack } : {}),
    };
  }
  return { name: 'SnapbackProviderError', message: String(error) };
}

function rejected<T>(error: unknown): DataMutationResult<T> {
  return { ok: false, error: serialized(error) };
}

function diagnosticCode(error: unknown): string | null {
  const candidate = error as {
    code?: unknown;
    diagnostic?: { code?: unknown };
  } | null;
  const value = candidate?.diagnostic?.code ?? candidate?.code;
  return typeof value === 'string' ? value : null;
}

function applicationCode(error: unknown): string | null {
  const candidate = error as {
    details?: { appCode?: unknown };
    diagnostic?: { details?: { appCode?: unknown } };
  } | null;
  const value = candidate?.diagnostic?.details?.appCode ?? candidate?.details?.appCode;
  return typeof value === 'string' ? value : null;
}

function declaredError(operation: string, error: unknown): NamedProviderError {
  if (error instanceof NamedProviderError) return error;
  const code = diagnosticCode(error);
  const appCode = applicationCode(error);
  const causeMessage = error instanceof Error ? error.message : String(error);

  if (appCode === 'DUPLICATE_HANDLE') {
    return new NamedProviderError(
      'DuplicateHandleError',
      'An account already uses that handle.',
      { cause: error },
    );
  }
  if (appCode === 'PROFILE_NOT_OWNED') {
    return new NamedProviderError(
      'SnapbackProviderError',
      `The active Snapback session does not own the requested profile: ${causeMessage}`,
      { cause: error },
    );
  }

  if (operation === 'login' && code === 'SNAPBACK_AUTH_CREDENTIAL_INVALID') {
    return new NamedProviderError(
      'InvalidCredentialsError',
      'Email or password is incorrect.',
      { cause: error },
    );
  }
  if (operation === 'signup' && code === 'SNAPBACK_AUTH_PASSWORD_EXISTS') {
    return new NamedProviderError(
      'DuplicateEmailError',
      'An account already uses that email.',
      { cause: error },
    );
  }
  if (operation === 'signup' && code === 'SNAPBACK_AUTH_PASSWORD_POLICY') {
    return new NamedProviderError(
      'PasswordTooShortError',
      'Password must satisfy the active Snapback password policy.',
      { cause: error },
    );
  }
  if (
    (operation === 'editProfile' || operation === 'setAvatar')
    && code !== null
    && SESSION_REQUIRED_CODES.has(code)
  ) {
    return new NamedProviderError(
      'SessionRequiredError',
      'An active session is required.',
      { cause: error },
    );
  }
  if (
    operation === 'setAvatar'
    && code !== null
    && AVATAR_REFERENCE_ADMISSION_CODES.has(code)
  ) {
    return new NamedProviderError(
      'AvatarReferenceInvalidError',
      'Avatar reference is invalid or unavailable.',
      { cause: error },
    );
  }

  return new NamedProviderError(
    'SnapbackProviderError',
    `${operation} failed through Snapback: ${causeMessage}`,
    { cause: error },
  );
}

function nonEmptyString(value: unknown, errorName: string, message: string): string {
  const normalized = String(value ?? '').trim();
  if (!normalized) throw new NamedProviderError(errorName, message);
  return normalized;
}

function validateEmail(value: unknown): string {
  const email = String(value ?? '').trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/u.test(email)) {
    throw new NamedProviderError('EmailInvalidError', 'Enter a valid email address.');
  }
  return email;
}

function validateLoginInput(args: Record<string, unknown>): { email: string; password: string } {
  const email = String(args.email ?? '').trim().toLowerCase();
  const password = String(args.password ?? '');
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/u.test(email) || password.length === 0) {
    throw new NamedProviderError(
      'InvalidCredentialsError',
      'Email or password is incorrect.',
    );
  }
  return { email, password };
}

function validatePassword(value: unknown): string {
  const password = String(value ?? '');
  if ([...password].length < 8) {
    throw new NamedProviderError(
      'PasswordTooShortError',
      'Password must contain at least 8 characters.',
    );
  }
  return password;
}

function validateHandle(value: unknown): string {
  const handle = String(value ?? '').trim().toLowerCase();
  if (!/^[a-z0-9_]{3,20}$/u.test(handle)) {
    throw new NamedProviderError(
      'HandleInvalidError',
      'Handle must be 3-20 lowercase letters, numbers, or underscores.',
    );
  }
  return handle;
}

function validateDisplayName(value: unknown): string {
  const displayName = String(value ?? '').normalize('NFC').trim();
  if (displayName.length < 1 || displayName.length > 50) {
    throw new NamedProviderError(
      'DisplayNameInvalidError',
      'Display name must contain 1-50 characters.',
    );
  }
  return displayName;
}

function validateBio(value: unknown): string {
  const bio = String(value ?? '').normalize('NFC').trim();
  if (bio.length > 200) {
    throw new NamedProviderError('BioInvalidError', 'Bio must contain at most 200 characters.');
  }
  return bio;
}

function validateLocation(value: unknown): string {
  const location = String(value ?? '').normalize('NFC').trim();
  if (location.length > 50) {
    throw new NamedProviderError(
      'LocationInvalidError',
      'Location must contain at most 50 characters.',
    );
  }
  return location;
}

function validateLink(value: unknown): string {
  const link = String(value ?? '').normalize('NFC').trim();
  if (!link) return '';
  let parsed: URL;
  try {
    parsed = new URL(link);
  } catch (cause) {
    throw new NamedProviderError(
      'LinkInvalidError',
      'Link must be empty or an HTTP(S) URL.',
      { cause },
    );
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new NamedProviderError('LinkInvalidError', 'Link must be empty or an HTTP(S) URL.');
  }
  return parsed.href;
}

function toConnection(value: unknown): DataConnection {
  switch (value) {
    case 'live':
    case 'connecting':
    case 'polling':
    case 'stale':
    case 'disconnected':
      return value;
    case 'open':
      return 'live';
    case 'lost':
    case 'budget-missed':
      return 'stale';
    case 'closed':
      return 'disconnected';
    default:
      return 'connecting';
  }
}

function readyCell<T>(value: T, connection: DataConnection): DataCellV2<T> {
  const empty = Array.isArray(value) ? value.length === 0 : false;
  return { status: 'ready', value, empty, connection };
}

async function sha256Hex(bytes: ArrayBuffer): Promise<string> {
  if (!globalThis.crypto?.subtle) {
    throw new NamedProviderError(
      'AvatarReferenceInvalidError',
      'Avatar upload requires WebCrypto SHA-256 support.',
    );
  }
  const digest = new Uint8Array(await globalThis.crypto.subtle.digest('SHA-256', bytes));
  return [...digest].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

function sniffAvatarMediaType(bytes: ArrayBuffer): 'image/jpeg' | 'image/png' | 'image/webp' {
  const view = new Uint8Array(bytes);
  if (
    view.length >= 8
    && view[0] === 0x89
    && view[1] === 0x50
    && view[2] === 0x4e
    && view[3] === 0x47
    && view[4] === 0x0d
    && view[5] === 0x0a
    && view[6] === 0x1a
    && view[7] === 0x0a
  ) return 'image/png';
  if (view.length >= 3 && view[0] === 0xff && view[1] === 0xd8 && view[2] === 0xff) {
    return 'image/jpeg';
  }
  if (
    view.length >= 12
    && view[0] === 0x52
    && view[1] === 0x49
    && view[2] === 0x46
    && view[3] === 0x46
    && view[8] === 0x57
    && view[9] === 0x45
    && view[10] === 0x42
    && view[11] === 0x50
  ) return 'image/webp';
  throw new NamedProviderError(
    'AvatarReferenceInvalidError',
    'Avatar reference must contain a PNG, JPEG, or WebP image.',
  );
}

async function clearCapturedAuthorityAndReconcile(
  coordinator: Pick<AuthCoordinator, 'compareAndClear' | 'synchronize'>,
  capture: ReturnType<AuthCoordinator['capture']>,
  reason: string,
  projections: {
    currentPrincipal(): { status: string };
    publishAnonymous(): void;
    refreshNonAnonymous(): void | Promise<void>;
  },
): Promise<{ cleared: boolean | null; clearError: unknown | null }> {
  let cleared: boolean | null = null;
  let clearError: unknown | null = null;
  try {
    ({ cleared } = await coordinator.compareAndClear(capture, reason));
  } catch (error) {
    clearError = error;
  }
  // compareAndClear is capture-scoped. If durable custody already advanced,
  // it returns false without adopting that successor into this context. A
  // mandatory durable reload closes that missed-wakeup gap before the
  // coordinator-derived principal decides the adapter's final projections.
  // @ref LLP 0059#cross-context-ownership — broadcasts are wakeups only; a
  // missed-wakeup predecessor converges through durable synchronization.
  try {
    await coordinator.synchronize();
  } catch (error) {
    projections.publishAnonymous();
    clearError = clearError === null
      ? error
      : new AggregateError(
          [clearError, error],
          'Snapback custody clear and durable reconciliation both failed.',
        );
    return { cleared, clearError };
  }
  if (projections.currentPrincipal().status === 'anonymous') {
    projections.publishAnonymous();
  } else {
    await projections.refreshNonAnonymous();
  }
  return { cleared, clearError };
}

export const coterieSnapbackTestInternals = Object.freeze({
  coterieAvatarUrlForRef,
  clearCapturedAuthorityAndReconcile,
  declaredError,
  sniffAvatarMediaType,
  validateLoginInput,
});

class SnapbackCoterieProvider implements CoterieSnapbackProvider {
  readonly manifest = coterieSurfaceManifest;
  readonly milestone = COTERIE_SNAPBACK_MILESTONE;
  readonly baseUrl: string;

  readonly #client: SnapbackClient;
  readonly #coordinator: AuthCoordinator;
  readonly #storage: SnapbackAuthCustodyStorage & { close?(): Promise<void> };
  readonly #instanceId: string;
  readonly #testHooks: NonNullable<CoterieSnapbackProviderOptions['__testHooks']>;
  readonly #profileDeliveryTimeoutMs: number;
  readonly #sessionObservers = new Set<DataObserver<unknown>>();
  readonly #profileSubscriptions = new Set<ProfileSubscription<unknown>>();
  readonly #profileWaiters = new Set<() => void>();
  readonly #uploadedAvatarAssets = new Map<string, string>();
  readonly #unsubscribePrincipal: () => void;
  readonly #unsubscribeAuthTerminal: () => void;
  #initialization: Promise<void> | null = null;
  #disposed = false;
  #profileRevision = 0;
  #profileRows: readonly BackendProfileRow[] | null = null;
  #profileConnectionSequence = 0;
  #principalRefreshGeneration = 0;
  #profileCompletion: { email: string; credential: BackendSessionCredential } | null = null;
  #closePromise: Promise<void> | null = null;

  constructor(options: CoterieSnapbackProviderOptions = {}) {
    this.baseUrl = resolveCoterieSnapbackUrl(options.baseUrl);
    this.#instanceId = `coterie-snapback-${++providerSequence}`;
    this.#testHooks = options.__testHooks ?? {};
    this.#profileDeliveryTimeoutMs = this.#testHooks.profileDeliveryTimeoutMs
      ?? PROFILE_STREAM_TIMEOUT_MS;
    if (
      !Number.isSafeInteger(this.#profileDeliveryTimeoutMs)
      || this.#profileDeliveryTimeoutMs < 1
    ) {
      throw new TypeError('__testHooks.profileDeliveryTimeoutMs must be a positive safe integer');
    }
    this.#storage = createCustodyStorage(resolvedCustody(options.custody));
    this.#coordinator = new AuthCoordinator({
      appId: api.listProfiles.appId,
      storagePartition:
        options.storagePartition
        ?? environmentValue('COTERIE_SNAPBACK_CUSTODY_PARTITION')
        ?? 'coterie-default',
      storage: this.#storage,
      ...(typeof globalThis.window === 'undefined'
        ? { broadcastChannelFactory: null, hintStorage: null }
        : {}),
    });
    this.#client = new SnapbackClient(this.baseUrl, {
      authCoordinator: this.#coordinator,
      authInvalidationProtocol: 1,
      authorityDescriptorProtocol: 1,
      authorizedLeaseProtocol: 1,
      clientStoreId: options.clientStoreId ?? this.#instanceId,
      rqsStore: null,
      offlineQueue: false,
    });
    this.#unsubscribePrincipal = this.#client.auth.subscribeCurrentPrincipal(() => {
      void this.#principalChanged();
    });
    this.#unsubscribeAuthTerminal = this.#client.auth.subscribeAuthTerminal(() => {
      if (this.#client.auth.authTerminalStatus().terminated) {
        this.#emitSessionReady([]);
        this.#stopProfileSubscriptions('disconnected');
      }
    });
  }

  partitionId(): string {
    return this.#instanceId;
  }

  subscribe<T>(
    queryName: string,
    _args: Record<string, unknown>,
    observer: DataObserver<T>,
  ): DataSubscription {
    if (this.#disposed) {
      observer({
        status: 'error',
        error: serialized(new NamedProviderError('SnapbackProviderDisposedError', 'provider is disposed')),
        connection: 'disconnected',
      });
      return { dispose() {} };
    }
    if (!Object.hasOwn(this.manifest.queries, queryName)) {
      observer({
        status: 'error',
        error: serialized(new NamedProviderError('UnknownQueryError', `Unknown query ${queryName}`)),
      });
      return { dispose() {} };
    }
    if (!M1_QUERY_NAMES.has(queryName)) {
      observer({ status: 'error', error: serialized(milestoneRefusal(queryName)) });
      return { dispose() {} };
    }

    if (queryName === 'listSession') {
      const typedObserver = observer as DataObserver<unknown>;
      let active = true;
      this.#sessionObservers.add(typedObserver);
      observer({ status: 'pending', connection: 'connecting' });
      void this.#ensureInitialized().then(
        () => {
          if (!active || this.#disposed || !this.#sessionObservers.has(typedObserver)) return;
          return this.#refreshSessionProjection();
        },
        (error) => {
          if (!active || this.#disposed || !this.#sessionObservers.has(typedObserver)) return;
          observer({
            status: 'error',
            error: serialized(error),
            connection: 'disconnected',
          });
        },
      );
      return {
        dispose: () => {
          active = false;
          this.#sessionObservers.delete(typedObserver);
        },
      };
    }

    const subscription: ProfileSubscription<T> = {
      active: true,
      generation: 0,
      observer,
      handle: null,
      start: null,
      connection: 'connecting',
    };
    const initializationGeneration = subscription.generation;
    this.#profileSubscriptions.add(subscription as ProfileSubscription<unknown>);
    if (this.#profileRows) {
      this.#publishProfiles(subscription, this.#profileRows);
    } else {
      observer({ status: 'pending', connection: 'connecting' });
    }
    void this.#ensureInitialized().then(
      () => {
        if (
          !subscription.active
          || subscription.generation !== initializationGeneration
          || this.#disposed
        ) return;
        return this.#startProfileSubscription(subscription);
      },
      (error) => {
        if (
          !subscription.active
          || subscription.generation !== initializationGeneration
          || this.#disposed
        ) return;
        observer({
          status: 'error',
          error: serialized(error),
          connection: 'disconnected',
        });
      },
    );
    return {
      dispose: () => {
        subscription.active = false;
        subscription.generation += 1;
        this.#profileSubscriptions.delete(subscription as ProfileSubscription<unknown>);
        void subscription.handle?.dispose();
        subscription.handle = null;
      },
    };
  }

  async mutate<T>(
    mutationName: string,
    args: Record<string, unknown>,
    _correlation?: DataMutationCorrelation,
  ): Promise<DataMutationResult<T>> {
    if (this.#disposed) {
      return rejected(new NamedProviderError('SnapbackProviderDisposedError', 'provider is disposed'));
    }
    if (!Object.hasOwn(this.manifest.mutations, mutationName)) {
      return rejected(new NamedProviderError('UnknownMutationError', `Unknown mutation ${mutationName}`));
    }
    if (!M1_MUTATION_NAMES.has(mutationName)) {
      return rejected(milestoneRefusal(mutationName));
    }

    try {
      await this.#ensureInitialized();
      const value = await this.#runM1Mutation(mutationName, args);
      return { ok: true, ...(value === undefined ? {} : { value: value as T }) };
    } catch (error) {
      return rejected(declaredError(mutationName, error));
    }
  }

  dispose(): void {
    void this.close();
  }

  close(): Promise<void> {
    if (this.#closePromise) return this.#closePromise;
    this.#disposed = true;
    this.#unsubscribePrincipal();
    this.#unsubscribeAuthTerminal();
    this.#sessionObservers.clear();
    const handleClosures = [...this.#profileSubscriptions].map((subscription) => {
      subscription.active = false;
      subscription.generation += 1;
      const result = subscription.handle?.dispose();
      subscription.handle = null;
      return result;
    });
    this.#profileSubscriptions.clear();
    this.#closePromise = (async () => {
      await Promise.allSettled(handleClosures.map((result) => Promise.resolve(result)));
      await this.#client.closeAuth();
      await this.#coordinator.close();
      await this.#storage.close?.();
    })();
    return this.#closePromise;
  }

  async #ensureInitialized(): Promise<void> {
    if (this.#initialization) return this.#initialization;
    this.#initialization = (async () => {
      await this.#client.auth.authSession();
      const principal = this.#client.auth.currentPrincipal();
      if (principal.status === 'authenticated' && principal.expiresAt === null) {
        await this.#client.auth.authRefresh();
      }
      await this.#principalChanged();
    })();
    return this.#initialization;
  }

  async #principalChanged(): Promise<void> {
    if (this.#disposed) return;
    const principal = this.#client.auth.currentPrincipal();
    if (principal.status === 'anonymous') {
      this.#profileCompletion = null;
      this.#emitSessionReady([]);
      this.#stopProfileSubscriptions('disconnected');
      return;
    }
    if (principal.status === 'blocked') {
      const error = new NamedProviderError(
        'SnapbackProviderError',
        principal.diagnostic.message,
      );
      this.#emitSessionError(error);
      this.#stopProfileSubscriptions('disconnected');
      return;
    }
    if (principal.status === 'loading' || principal.status === 'refreshing') return;
    await Promise.all([
      this.#refreshSessionProjection(),
      this.#startAllProfileSubscriptions(),
    ]);
  }

  async #clearCapturedAuthorityAndReconcile(
    capture: ReturnType<AuthCoordinator['capture']>,
    reason: string,
  ): Promise<{ cleared: boolean | null; clearError: unknown | null }> {
    return clearCapturedAuthorityAndReconcile(
      this.#coordinator,
      capture,
      reason,
      {
        currentPrincipal: () => this.#client.auth.currentPrincipal(),
        publishAnonymous: () => {
          this.#profileCompletion = null;
          this.#emitSessionReady([]);
          this.#stopProfileSubscriptions('disconnected');
        },
        refreshNonAnonymous: () => this.#principalChanged(),
      },
    );
  }

  async #refreshSessionProjection(): Promise<void> {
    const generation = ++this.#principalRefreshGeneration;
    const principal = this.#client.auth.currentPrincipal();
    if (principal.status === 'anonymous') {
      this.#emitSessionReady([]);
      return;
    }
    if (principal.status !== 'authenticated') return;

    try {
      const rows = (await this.#client.query(api.getMyProfile, { args: {} })).rows;
      if (generation !== this.#principalRefreshGeneration || this.#disposed) return;
      const current = this.#client.auth.currentPrincipal();
      if (current.status !== 'authenticated' || current.sessionId !== principal.sessionId) return;
      const capture = this.#coordinator.capture();
      const credential = this.#coordinator.credentialFor(capture);
      if (!credential.bearer) {
        throw new NamedProviderError('SessionRequiredError', 'An active session is required.');
      }
      const logicalUserId = rows[0]?.fixtureId ?? principal.userId;
      const expiry = principal.expiresAt
        ?? principal.absoluteExpiresAt
        ?? credential.refreshAfterMs
        ?? Date.now();
      this.#emitSessionReady([{
        id: principal.sessionId,
        userId: logicalUserId,
        signedIn: true,
        token: credential.bearer,
        expiresAt: new Date(expiry).toISOString(),
        revokedAt: null,
      }]);
    } catch (error) {
      if (generation === this.#principalRefreshGeneration && !this.#disposed) {
        this.#emitSessionError(declaredError('listSession', error));
      }
    }
  }

  #emitSessionReady(rows: unknown[]): void {
    for (const observer of this.#sessionObservers) {
      observer(readyCell(rows, 'live'));
    }
  }

  #emitSessionError(error: unknown): void {
    for (const observer of this.#sessionObservers) {
      observer({ status: 'error', error: serialized(error), connection: 'disconnected' });
    }
  }

  async #startAllProfileSubscriptions(): Promise<void> {
    await Promise.all(
      [...this.#profileSubscriptions].map((subscription) => (
        this.#startProfileSubscription(subscription)
      )),
    );
  }

  async #startProfileSubscription<T>(subscription: ProfileSubscription<T>): Promise<void> {
    if (!subscription.active || this.#disposed) return;
    const principal = this.#client.auth.currentPrincipal();
    if (principal.status !== 'authenticated') return;
    if (subscription.handle) return;
    if (subscription.start) return subscription.start;

    const generation = ++subscription.generation;
    subscription.start = (async () => {
      try {
        const handle = await this.#client.liveQuery(api.listProfiles, {
          args: {},
          connectionId: `${this.#instanceId}-profiles-${++this.#profileConnectionSequence}`,
          transport: 'stream',
          fallbackToPoll: false,
          onUpdate: (rows) => {
            if (!subscription.active || subscription.generation !== generation) return;
            if (this.#testHooks.suppressProfileUpdate?.(
              rows as readonly BackendProfileRow[],
            )) return;
            this.#publishProfiles(subscription, rows as readonly BackendProfileRow[]);
          },
          onConnectionChange: (connection) => {
            if (!subscription.active || subscription.generation !== generation) return;
            const next = toConnection(connection);
            if (next === subscription.connection) return;
            subscription.connection = next;
            this.#publishProfileConnection(subscription);
          },
        });
        if (!subscription.active || subscription.generation !== generation || this.#disposed) {
          await handle.dispose();
          return;
        }
        subscription.handle = handle;
        subscription.connection = toConnection(handle.connection);
        this.#publishProfiles(subscription, handle.rows as readonly BackendProfileRow[]);
      } catch (error) {
        if (!subscription.active || subscription.generation !== generation) return;
        subscription.observer({
          status: 'error',
          error: serialized(declaredError('listProfiles', error)),
          connection: 'disconnected',
        });
      } finally {
        if (subscription.generation === generation) subscription.start = null;
      }
    })();
    return subscription.start;
  }

  #publishProfiles<T>(
    subscription: ProfileSubscription<T>,
    rows: readonly BackendProfileRow[],
  ): void {
    this.#profileRows = rows;
    const value = this.#projectProfiles<T>(rows);
    subscription.lastValue = value;
    subscription.observer(readyCell(value, subscription.connection));
    this.#profileRevision += 1;
    for (const resolve of [...this.#profileWaiters]) resolve();
  }

  #projectProfiles<T>(rows: readonly BackendProfileRow[]): T {
    const principal = this.#client.auth.currentPrincipal();
    const principalId = principal.status === 'authenticated' ? principal.userId : null;
    return rows.map((row) => ({
      id: row.fixtureId ?? row.ownerId,
      handle: row.handle,
      displayName: row.displayName,
      bio: row.bio,
      location: row.location,
      link: row.link,
      avatarUrl: row.avatar ? this.#assetUrl(row.avatar) : null,
      followers: 0,
      following: 0,
      followedByMe: false,
      isMe: principalId !== null && row.ownerId === principalId,
    })) as T;
  }

  #publishProfileConnection<T>(subscription: ProfileSubscription<T>): void {
    if (!subscription.active) return;
    if (subscription.lastValue === undefined) {
      subscription.observer({ status: 'pending', connection: subscription.connection });
      return;
    }
    // Connection truth is observable state, but it is not a data delivery and
    // therefore must not advance #profileRevision or release mutation waiters.
    subscription.observer(readyCell(subscription.lastValue, subscription.connection));
  }

  #stopProfileSubscriptions(connection: DataConnection): void {
    this.#profileRows = null;
    for (const subscription of this.#profileSubscriptions) {
      subscription.generation += 1;
      subscription.connection = connection;
      void subscription.handle?.dispose();
      subscription.handle = null;
      subscription.start = null;
      subscription.lastValue = undefined;
      if (subscription.active) {
        subscription.observer({ status: 'pending', connection });
      }
    }
  }

  async #runM1Mutation(name: string, args: Record<string, unknown>): Promise<unknown> {
    switch (name) {
      case 'signup':
        return this.#signup(args);
      case 'login':
        return this.#login(args);
      case 'logout':
        return this.#logout();
      case 'editProfile':
        return this.#editProfile(args);
      case 'setAvatar':
        return this.#setAvatar(args);
      default:
        throw milestoneRefusal(name);
    }
  }

  async #signup(args: Record<string, unknown>): Promise<unknown> {
    const email = validateEmail(args.email);
    const password = validatePassword(args.password);
    const handle = validateHandle(args.handle);
    const displayName = validateDisplayName(args.displayName);
    const recovered = await this.#completePartialRegistration({
      email,
      handle,
      displayName,
    });
    if (recovered !== null) return recovered;
    const claimedHandle = await this.#client.query(api.getProfileByHandle, {
      args: { handle },
    });
    if (claimedHandle.rows.length > 0) {
      throw new NamedProviderError(
        'DuplicateHandleError',
        'An account already uses that handle.',
      );
    }
    const credential = await this.#client.auth.authPasswordSignup({ email, password });
    const adoptedCapture = this.#coordinator.capture();
    try {
      await this.#testHooks.beforeEnsureProfile?.('signup');
      await this.#client.mutate(api.ensureMyProfile, {
        args: { handle, displayName, bio: '', location: '', link: '' },
      });
      await this.#testHooks.beforeAuthResult?.('signup');
      const result = await this.#authResult(credential);
      await Promise.all([this.#refreshSessionProjection(), this.#startAllProfileSubscriptions()]);
      return result.value;
    } catch (originalError) {
      const error = applicationCode(originalError) === 'DUPLICATE_HANDLE'
        ? new NamedProviderError(
            'PartialRegistrationError',
            `The email ${email} is registered, but its profile is incomplete because the handle was claimed concurrently. Sign in with this email, then complete signup with a new handle.`,
            { cause: originalError },
          )
        : originalError;
      await this.#rollbackAdoptedAuthority(adoptedCapture, 'coterie_signup_processing_failed', error);
      throw error;
    }
  }

  async #login(args: Record<string, unknown>): Promise<unknown> {
    const { email, password } = validateLoginInput(args);
    const credential = await this.#client.auth.authPasswordSignIn({ email, password });
    const adoptedCapture = this.#coordinator.capture();
    try {
      await this.#testHooks.beforeAuthResult?.('login');
      const result = await this.#authResult(credential);
      this.#profileCompletion = result.profileExists ? null : { email, credential };
      await Promise.all([this.#refreshSessionProjection(), this.#startAllProfileSubscriptions()]);
      return result.value;
    } catch (error) {
      await this.#rollbackAdoptedAuthority(adoptedCapture, 'coterie_login_processing_failed', error);
      throw error;
    }
  }

  async #authResult(credential: BackendSessionCredential): Promise<AuthResultState> {
    const rows = (await this.#client.query(api.getMyProfile, { args: {} })).rows;
    const capture = this.#coordinator.capture();
    const bearer = this.#coordinator.credentialFor(capture).bearer;
    if (!bearer) {
      throw new NamedProviderError('SnapbackProviderError', 'Snapback adopted no session bearer.');
    }
    return {
      profileExists: rows.length > 0,
      value: {
        userId: rows[0]?.fixtureId ?? rows[0]?.ownerId ?? credential.session.userId,
        sessionToken: bearer,
      },
    };
  }

  async #completePartialRegistration(input: {
    email: string;
    handle: string;
    displayName: string;
  }): Promise<AuthResultState['value'] | null> {
    const recovery = this.#profileCompletion;
    if (!recovery || recovery.email !== input.email) return null;
    const principal = this.#client.auth.currentPrincipal();
    if (principal.status !== 'authenticated') return null;
    const current = (await this.#client.query(api.getMyProfile, { args: {} })).rows;
    if (current.length > 0) {
      this.#profileCompletion = null;
      return null;
    }
    const claimedHandle = await this.#client.query(api.getProfileByHandle, {
      args: { handle: input.handle },
    });
    if (claimedHandle.rows.length > 0) {
      throw new NamedProviderError(
        'DuplicateHandleError',
        'An account already uses that handle.',
      );
    }
    await this.#testHooks.beforeEnsureProfile?.('signup-recovery');
    await this.#client.mutate(api.ensureMyProfile, {
      args: {
        handle: input.handle,
        displayName: input.displayName,
        bio: '',
        location: '',
        link: '',
      },
    });
    const result = await this.#authResult(recovery.credential);
    this.#profileCompletion = null;
    await Promise.all([this.#refreshSessionProjection(), this.#startAllProfileSubscriptions()]);
    return result.value;
  }

  async #rollbackAdoptedAuthority(
    capture: ReturnType<AuthCoordinator['capture']>,
    reason: string,
    originalError: unknown,
  ): Promise<void> {
    const { clearError: rollbackError } = await this.#clearCapturedAuthorityAndReconcile(
      capture,
      reason,
    );
    if (rollbackError !== null) {
      throw new AggregateError(
        [originalError, rollbackError],
        'Snapback auth adoption failed and local authority rollback also failed.',
      );
    }
  }

  async #logout(): Promise<unknown> {
    const principal = this.#client.auth.currentPrincipal();
    if (principal.status !== 'authenticated') {
      this.#emitSessionReady([]);
      this.#stopProfileSubscriptions('disconnected');
      return { revokedToken: null };
    }
    const capture = this.#coordinator.capture();
    const revokedToken = this.#coordinator.credentialFor(capture).bearer;
    let remoteError: unknown = null;
    let clearError: unknown = null;
    try {
      await this.#client.auth.authLogout();
    } catch (error) {
      remoteError = error;
    }
    try {
      ({ clearError } = await this.#clearCapturedAuthorityAndReconcile(
        capture,
        'coterie_logout_terminal',
      ));
    } catch (error) {
      clearError = error;
    }
    if (remoteError !== null && clearError !== null) {
      throw new AggregateError(
        [remoteError, clearError],
        'Snapback logout lost the remote outcome and local custody clear also failed.',
      );
    }
    if (remoteError !== null) throw remoteError;
    if (clearError !== null) throw clearError;
    return { revokedToken };
  }

  async #editProfile(args: Record<string, unknown>): Promise<void> {
    const rows = (await this.#client.query(api.getMyProfile, { args: {} })).rows;
    const current = rows[0];
    if (!current) {
      throw new NamedProviderError('SessionRequiredError', 'An active session is required.');
    }
    const before = this.#profileRevision;
    await this.#client.mutate(api.editProfile, {
      args: {
        profileId: current._id,
        displayName: validateDisplayName(args.displayName),
        bio: validateBio(args.bio),
        handle: args.handle === null ? current.handle : validateHandle(args.handle),
        location: args.location === null ? current.location : validateLocation(args.location),
        link: args.link === null ? current.link : validateLink(args.link),
      },
    });
    await this.#waitForProfileDelivery(before);
  }

  async #setAvatar(args: Record<string, unknown>): Promise<unknown> {
    const avatarRef = nonEmptyString(
      args.avatarRef,
      'AvatarReferenceInvalidError',
      'Avatar reference is invalid or unavailable.',
    );
    const rows = (await this.#client.query(api.getMyProfile, { args: {} })).rows;
    const current = rows[0];
    if (!current) {
      throw new NamedProviderError('SessionRequiredError', 'An active session is required.');
    }
    const servedAvatarUrl = coterieAvatarUrlForRef(avatarRef);
    if (!servedAvatarUrl) {
      throw new NamedProviderError(
        'AvatarReferenceInvalidError',
        'Avatar reference is invalid or unavailable.',
      );
    }
    let bytes: ArrayBuffer;
    try {
      const sourceUrl = new URL(
        servedAvatarUrl,
        typeof globalThis.location?.href === 'string' ? globalThis.location.href : this.baseUrl,
      );
      const response = await fetch(sourceUrl);
      if (!response.ok) {
        throw new NamedProviderError(
          'AvatarReferenceInvalidError',
          `Avatar reference could not be read (${response.status}).`,
        );
      }
      const blob = await response.blob();
      bytes = await blob.arrayBuffer();
    } catch (cause) {
      if (cause instanceof NamedProviderError) throw cause;
      throw new NamedProviderError(
        'AvatarReferenceInvalidError',
        'Avatar reference is invalid or unavailable.',
        { cause },
      );
    }
    const mediaType = sniffAvatarMediaType(bytes);
    if (!AVATAR_MEDIA_TYPES.has(mediaType)) {
      throw new NamedProviderError(
        'AvatarReferenceInvalidError',
        'Avatar reference must contain a PNG, JPEG, or WebP image.',
      );
    }
    const sourceDigest = await sha256Hex(bytes);
    const assetCacheKey = `${current.ownerId}:${sourceDigest}`;
    let assetId = this.#uploadedAvatarAssets.get(assetCacheKey);
    const reused = assetId !== undefined;
    if (!assetId) {
      const assetClient = createAssetClient(
        this.#client as unknown as Parameters<typeof createAssetClient>[0],
      );
      assetId = await assetClient.upload(
        api.avatarUpload,
        new Blob([bytes], { type: mediaType }),
      );
      this.#rememberAvatarAsset(assetCacheKey, assetId);
    }
    const assetFacts = { assetId, reused, sourceDigest };
    this.#testHooks.onAvatarAssetSelected?.(assetFacts);
    const before = this.#profileRevision;
    try {
      await this.#testHooks.beforeAvatarAttach?.(assetFacts);
      await this.#client.mutate(api.attachMyAvatar, {
        args: { profileId: current._id, assetId, sourceDigest },
      });
    } catch (error) {
      const mapped = declaredError('setAvatar', error);
      if (mapped.name !== 'SnapbackProviderError') throw mapped;
      throw new NamedProviderError(
        'SnapbackProviderError',
        `setAvatar attach failed after asset ${assetId} was finalized; the adapter retained its digest mapping for retry, but this backend has no app-opted reference GC for eventual unreferenced cleanup. ${mapped.message}`,
        { cause: error },
      );
    }
    await this.#waitForProfileDelivery(before);
    return { avatarUrl: this.#assetUrl(assetId) };
  }

  #rememberAvatarAsset(key: string, assetId: string): void {
    this.#uploadedAvatarAssets.delete(key);
    this.#uploadedAvatarAssets.set(key, assetId);
    while (this.#uploadedAvatarAssets.size > AVATAR_ASSET_CACHE_LIMIT) {
      const oldest = this.#uploadedAvatarAssets.keys().next().value as string | undefined;
      if (oldest === undefined) break;
      this.#uploadedAvatarAssets.delete(oldest);
    }
  }

  #assetUrl(assetId: string): string {
    return `${this.baseUrl}/assets/public/${encodeURIComponent(assetId)}/thumb`;
  }

  async #waitForProfileDelivery(before: number): Promise<void> {
    if (this.#profileSubscriptions.size === 0 || this.#profileRevision > before) return;
    await new Promise<void>((resolve, rejectTimeout) => {
      let settled = false;
      const finish = () => {
        if (settled || this.#profileRevision <= before) return;
        settled = true;
        clearTimeout(timeout);
        this.#profileWaiters.delete(finish);
        resolve();
      };
      const timeout = setTimeout(() => {
        if (settled) return;
        settled = true;
        this.#profileWaiters.delete(finish);
        rejectTimeout(new NamedProviderError(
          'SnapbackProviderError',
          `Snapback profile stream did not deliver the committed mutation within ${this.#profileDeliveryTimeoutMs}ms.`,
        ));
      }, this.#profileDeliveryTimeoutMs);
      this.#profileWaiters.add(finish);
      finish();
    });
  }
}

/**
 * The provider reuses Coterie's shared declaration manifest verbatim. Its
 * milestone claim is qualification evidence, not a provider-specific digest.
 *
 * @ref LLP 0266#d4-backend-boundary — backend transport and live delivery stay
 * behind Exact's public ContractDataProvider seam.
 * @ref LLP 0266#d7-milestone-frozen-provider-surfaces-resolves-oq1 — this
 * adapter implements M1 and refuses every later operation explicitly.
 * @ref LLP 0266#d8-provider-selection-at-boot — the adapter never generates a
 * provider-specific Coterie declaration or manifest.
 * @ref LLP 0266#d9-snapback-backend-placement — application-owned auth,
 * profiles, and assets stay behind this app-owned Exact adapter.
 */
export function createCoterieSnapbackProvider(
  options: CoterieSnapbackProviderOptions = {},
): CoterieSnapbackProvider {
  return new SnapbackCoterieProvider(options);
}
