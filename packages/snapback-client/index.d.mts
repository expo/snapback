export {
  SNAPBACK_EXTERNAL_STORE_PROTOCOL,
  ExternalQueryScope,
  assertExternalStoreCompatibility,
  createExternalQueryStore,
  externalStoreIdentity,
} from './external-store.mjs';
export type {
  ExternalConnection,
  ExternalProviderDelivery,
  ExternalQueryStore,
  ExternalStoreController,
  ExternalStoreFreshness,
  ExternalStoreSnapshot,
  ExternalStoreStatus,
} from './external-store.mjs';
export {
  CANONICAL_CLIENT_VALUE_V1_LIMITS,
  canonicalizeClientValueV1,
  canonicalReactStoreKeyV1,
} from './canonical-client-value.mjs';

export type SnapbackFunctionKind = 'Query' | 'LiveQuery' | 'Mutation' | 'Action';
export interface SnapbackFunctionReference<
  Name extends string = string,
  Kind extends SnapbackFunctionKind = SnapbackFunctionKind,
  Args = Record<string, unknown>,
  Result = unknown,
> {
  readonly artifactKind: 'functionReference';
  readonly schemaVersion: string;
  readonly appId: string;
  readonly id: string;
  readonly name: Name;
  readonly kind: Kind;
  readonly implementationHash: string;
  readonly argsContractHash: string;
  readonly resultContractHash: string;
  readonly __args?: Args;
  readonly __result?: Result;
}

export interface SnapbackEphemeralReference<
  Name extends string = string,
  Scope = Record<string, unknown>,
  Value = unknown,
  KeyMode extends 'Connection' | 'Session' | 'User' | 'Custom' =
    'Connection' | 'Session' | 'User' | 'Custom',
> {
  readonly artifactKind: 'ephemeralCollectionReference';
  readonly schemaVersion: string;
  readonly appId: string;
  readonly id: string;
  readonly name: Name;
  readonly keyMode: KeyMode;
  readonly scopeFields: readonly string[];
  readonly routingFields: readonly string[];
  readonly defaultTtlMs: number;
  readonly maxTtlMs: number;
  readonly maxValueBytes: number;
  readonly publishRate: Readonly<{ sustainedHz: number; burst: number }>;
  readonly deliveryMode: 'latest';
  readonly __scope?: Scope;
  readonly __value?: Value;
}

export interface SnapbackQueryGroupReference<
  Route extends string = string,
  Params = Record<string, unknown>,
  Entries = Record<string, unknown>,
> {
  readonly artifactKind: 'queryGroupReference';
  readonly formatVersion: 1;
  readonly schemaVersion: string;
  readonly appId: string;
  readonly id: string;
  readonly route: Route;
  readonly definitionHash: string;
  readonly queries: readonly Readonly<{
    name: string;
    ref: SnapbackFunctionReference<string, 'LiveQuery', unknown, unknown>;
    args: Readonly<Record<string, unknown>>;
  }>[];
  readonly persist?: false;
  readonly __params?: Params;
  readonly __entries?: Entries;
}

export type QueryGroupParams<Ref> =
  Ref extends { readonly __params?: infer Params } ? Params : Record<string, unknown>;
export type QueryGroupEntries<Ref> =
  Ref extends { readonly __entries?: infer Entries } ? Entries : Record<string, unknown>;

export type FunctionArgs<Ref> =
  Ref extends { readonly __args?: infer Args } ? Args : Record<string, unknown>;
export type FunctionResult<Ref> =
  Ref extends { readonly __result?: infer Result } ? Result : unknown;
export type EphemeralScope<Ref> =
  Ref extends { readonly __scope?: infer Scope } ? Scope : Record<string, unknown>;
export type EphemeralValue<Ref> =
  Ref extends { readonly __value?: infer Value } ? Value : unknown;

/** Structurally compatible with the generated `Id<Table>` nominal type. */
export type SnapbackId<Table extends string> =
  string & { readonly __snapbackIdTable: Table };

/**
 * Admit an id from an untyped boundary after validating Snapback's bounded
 * opaque-id grammar. This does not assert that the referenced row exists.
 */
export function admitSnapbackId<const Table extends string>(
  table: Table,
  value: string,
): SnapbackId<Table>;

export interface QueryOutput<Result> {
  readonly rows: Result;
  readonly version: number;
  readonly cursor?: string | null;
}

/** LLP 0055 §Audit server-derived attribution block, copied verbatim. */
export interface FunctionAttribution {
  readonly actorUserId: string;
  readonly effectiveUserId: string | null;
  readonly grantId: string;
  readonly dryRun: boolean;
}

export interface MutationOutput<Result> {
  readonly version: number;
  readonly changed_count: number;
  readonly result: Result;
  readonly ctx_ledger?: unknown;
  readonly receipt: Readonly<Record<string, unknown>>;
  readonly attribution?: FunctionAttribution;
}

export interface ActionOutput<Result> {
  readonly ok: boolean;
  readonly result: Result;
  readonly diagnostic?: Readonly<Record<string, unknown>>;
}

export type SearchMatchAtomV1 =
  | { readonly Term: { readonly value: string; readonly field?: string } }
  | { readonly Phrase: { readonly values: readonly string[]; readonly field?: string } }
  | { readonly Prefix: { readonly value: string; readonly field?: string } };
export type SearchClauseV1 =
  | SearchMatchAtomV1
  | { readonly Filter: {
      readonly field: string;
      readonly op: 'eq';
      readonly value: string | number | boolean;
    } }
  | { readonly Not: SearchMatchAtomV1 }
  | { readonly Any: readonly SearchMatchAtomV1[] };
/** @deprecated Use SearchClauseV1 or SearchMatchAtomV1 for the closed shape. */
export type SearchAtomV1 = SearchClauseV1;
export interface SearchQueryAstV1 {
  readonly all: readonly SearchClauseV1[];
}
export interface SearchRequestV1 {
  readonly query: SearchQueryAstV1;
  readonly limit?: number;
  readonly after?: string;
}
export interface SearchMatchRangeV1 {
  readonly start: number;
  readonly end: number;
}
export interface SearchHighlightV1 {
  readonly field: string;
  readonly text: string;
  readonly matches: readonly SearchMatchRangeV1[];
}
/** @ref LLP 0073#ranking-order-and-cursors — generated operation refs bind
 * these generic defaults to one exact stored-field projection and row-id. */
export interface SearchItemV1<
  Fields extends Readonly<Record<string, unknown>> = Readonly<Record<string, unknown>>,
  RowId extends string = string,
> {
  readonly rowId: RowId;
  readonly score: number;
  readonly fields: Fields;
  readonly highlights: readonly SearchHighlightV1[];
}
declare const searchPageV1Brand: unique symbol;
export interface SearchPageV1<
  Fields extends Readonly<Record<string, unknown>> = Readonly<Record<string, unknown>>,
  RowId extends string = string,
> {
  /** Generated operation phantom; no runtime response is expected to carry it. */
  readonly [searchPageV1Brand]: true;
  readonly items: readonly SearchItemV1<Fields, RowId>[];
  readonly cursor: string | null;
  readonly hasMore: boolean;
}

/**
 * Search operations deliberately carry an operation-level SearchPageV1
 * phantom while the ordinary query wire carries only that page's items in
 * QueryOutput.rows and its cursor at QueryOutput.cursor.
 */
export type QueryWireResult<Result> =
  Result extends SearchPageV1<infer Fields, infer RowId>
    ? readonly SearchItemV1<Fields, RowId>[]
    : Result;

export function parseSearchQueryV1(
  source: string,
  options?: { readonly fields?: readonly string[]; readonly minPrefixScalars?: number },
): SearchQueryAstV1;
export const search: Readonly<{
  term(value: string, field?: string): SearchMatchAtomV1;
  phrase(values: string | readonly string[], field?: string): SearchMatchAtomV1;
  prefix(value: string, field?: string): SearchMatchAtomV1;
  not(atom: SearchMatchAtomV1): SearchClauseV1;
  any(...atoms: readonly (SearchMatchAtomV1 | readonly SearchMatchAtomV1[])[]): SearchClauseV1;
  filter(field: string, value: string | number | boolean): SearchClauseV1;
  all(...clauses: readonly (SearchClauseV1 | readonly SearchClauseV1[])[]): SearchQueryAstV1;
}>;

export interface LiveQueryHandle<Rows> {
  subscriptionId: string | null;
  version: number;
  rows: Rows;
  readonly connection: 'connecting' | 'live' | 'polling' | 'stale' | 'disconnected';
  readonly paused: boolean;
  poll(): Promise<Rows>;
  pause(): Promise<void>;
  resume(): Promise<void>;
  dispose(): void;
  flushResumeState(): Promise<void>;
}

export interface RqsRegisteredSubscription {
  readonly subscriptionId: string;
  readonly rows: readonly unknown[];
  readonly version: number;
  readonly resume: null | Readonly<Record<string, unknown> & { readonly token: string }>;
  readonly attachDeadline: number | null;
  readonly authorization?: unknown;
}

export interface RqsRegisteredRegistry {
  readonly connection: null | Readonly<{
    connectionId: string;
    grant: string;
    attachDeadline: number | null;
  }>;
  readonly generation: string | null;
  readonly versionStream: string | null;
  readonly size: number;
  lookup(name: string, args?: Readonly<Record<string, unknown>>): RqsRegisteredSubscription | null;
  consume(name: string, args?: Readonly<Record<string, unknown>>): RqsRegisteredSubscription | null;
}

export function createRqsRegisteredRegistry(bundle: unknown): RqsRegisteredRegistry;

export type LiveQueryRegistrationOptions =
  | Readonly<{
      transport: 'stream';
      registeredSubscription?: RqsRegisteredSubscription | null;
    }>
  | Readonly<{
      transport?: 'poll';
      registeredSubscription?: null;
    }>;

export interface StartedLiveQueryHandle<Rows> {
  readonly current: LiveQueryHandle<Rows> | null;
  started(): Promise<void>;
  dispose(): void;
  settled(): Promise<void>;
}

export interface PreparedReactBinding {
  readonly appId: string;
  readonly profile: string;
  readonly deploymentIdentity: Readonly<{
    targetProfileId: string;
    target: string;
    schemaHash: string | null;
    bundleHash: string;
    inputsHash: string | null;
  }>;
  readonly authMode: AuthMode | null;
  readonly routeManifestHash: string;
  readonly registeredBundleAvailable: boolean;
  readonly functionCatalogDigest: string;
  readonly capabilityDigest: string;
  readonly references: Readonly<Record<string, SnapbackFunctionReference>>;
  readonly ephemeral: Readonly<Record<string, SnapbackEphemeralReference>>;
  readonly groups: Readonly<Record<string, SnapbackQueryGroupReference>>;
  prepareQueryGroup<Ref extends SnapbackQueryGroupReference>(
    reference: Ref,
    params: QueryGroupParams<Ref>,
    options?: {
      readonly fallbackToLive?: boolean;
      readonly userId?: string;
    },
  ): Promise<PreparedReactQueryGroup<Ref>>;
}

export interface PreparedReactQueryGroup<
  Ref extends SnapbackQueryGroupReference = SnapbackQueryGroupReference,
> {
  readonly artifactKind: 'preparedReactQueryGroup';
  readonly source: 'registered-bundle' | 'live-fallback' | 'live-recovery';
  readonly reason?:
    | 'registered_bundle_boot_v1-unavailable'
    | 'attach-deadline-expired'
    | 'unadopted-delta'
    | 'authority-replaced';
  readonly reference: Ref;
  readonly params: QueryGroupParams<Ref>;
  readonly boot: null | Readonly<{
    source: 'registered-bundle';
    commitVersion: number;
    generation: string;
    versionStream: string;
    attachDeadline: number;
  }>;
  readonly entries: readonly Readonly<{
    name: string;
    ref: SnapbackFunctionReference<string, 'LiveQuery', unknown, unknown>;
    args: Readonly<Record<string, unknown>>;
  }>[];
  dispose(): Promise<void>;
}

export function prepareReactQueryGroupForBinding<
  Ref extends SnapbackQueryGroupReference,
>(
  binding: PreparedReactBinding,
  reference: Ref,
  params: QueryGroupParams<Ref>,
  options?: {
    readonly fallbackToLive?: boolean;
    readonly userId?: string;
  },
): Promise<PreparedReactQueryGroup<Ref>>;
export function consumePreparedReactQueryGroup<
  Ref extends SnapbackQueryGroupReference,
>(
  binding: PreparedReactBinding,
  value: PreparedReactQueryGroup<Ref>,
): PreparedReactQueryGroup<Ref>;
export function abandonConsumedReactQueryGroup(
  value: PreparedReactQueryGroup,
): Promise<void>;

export interface EphemeralEntry<Value> {
  readonly key: string;
  readonly value: Value;
  readonly expiresAtMs: number;
  readonly receivedAtMs: number;
  readonly scopeEpoch: number;
  readonly entryVersion: number;
}

export type EphemeralRoomSnapshot<Value> =
  | Readonly<{
      status: 'pending' | 'resyncing';
      entries: readonly [];
      selfKey: null;
      diagnostic: null;
      connection: string;
      reason: string | null;
    }>
  | Readonly<{
      status: 'ready' | 'stale';
      entries: readonly EphemeralEntry<Value>[];
      selfKey: string;
      diagnostic: null;
      connection: string;
      reason: string | null;
    }>
  | Readonly<{
      status: 'error' | 'unsupported';
      entries: readonly [];
      selfKey: null;
      diagnostic: Readonly<Record<string, unknown>>;
      connection: string;
      reason: string | null;
    }>;

export interface EphemeralRoomHandle<Value> {
  subscribe(listener: () => void): () => void;
  getSnapshot(): EphemeralRoomSnapshot<Value>;
  getServerSnapshot(): EphemeralRoomSnapshot<Value>;
  readonly grantedConnectionId: string | null;
  started(): Promise<void>;
  publish(value: Value, options?: { readonly ttlMs?: number }): Promise<unknown>;
  delete(): Promise<unknown>;
  dispose(): void;
  settled(): Promise<void>;
  inspection(): Readonly<Record<string, unknown>>;
}

export class EphemeralOverlay<Scope = Record<string, unknown>, Value = unknown> {
  readonly scope: Scope;
  onChange(
    listener: (result: string, overlay: EphemeralOverlay<Scope, Value>) => void,
  ): () => void;
  publish(value: Value, options?: { ttlMs?: number; connectionId?: string }): Promise<unknown>;
  delete(options?: { connectionId?: string }): Promise<unknown>;
  drain(): Promise<unknown>;
  currentEntries(options?: { prune?: boolean }): EphemeralEntry<Value>[];
  dispose(): void;
}

export interface SnapbackClientOptions {
  readonly adminToken?: string | null;
  readonly bearerToken?: string | null;
  readonly authClientProtocol?: number | null;
  readonly authInvalidationProtocol?: number | null;
  readonly authorityDescriptorProtocol?: number | null;
  readonly authorizedLeaseProtocol?: number | null;
  readonly ephemeralAuthorityProtocol?: number | null;
  readonly ephemeralExpiryProtocol?: number | null;
  readonly authCoordinator?: unknown;
  readonly agentAuthority?: unknown;
  readonly senderConstrained?: boolean;
  readonly clientStoreId?: string;
  readonly authCounterCeiling?: number;
  readonly rqsStore?: unknown;
  readonly strictWireVersion?: boolean;
  readonly onWireVersionDiagnostic?: ((diagnostic: unknown) => void) | null;
}

export type AuthMode = 'dev' | 'sessions';
export type ExpectedDataVersionStreamV1 =
  | { readonly state: 'absent' }
  | { readonly state: 'present'; readonly value: string };
export interface SeedArtifactV1 {
  readonly formatVersion: 'snapback.seed.v1';
  readonly appId: string;
  readonly seedVersion: string;
  readonly seedDigest: string;
  readonly tables: Readonly<Record<string, readonly Readonly<Record<string, unknown>>[]>>;
}
export interface ActiveSeedIdentityV1 {
  readonly appId: string;
  readonly seedVersion: string;
  readonly seedDigest: string;
  readonly dataVersionStream: string;
  readonly schemaHash: string;
  readonly directApplicationRows: number;
  readonly derivedProjectionRows: number;
  readonly totalApplicationEffects: number;
}
interface SeedReceiptBaseV1 {
  readonly formatVersion: 'snapback.seed.receipt.v1';
  readonly operationId: string;
  readonly requestDigest: string;
  readonly appId: string;
  readonly schemaHash: string;
  readonly dataVersionStream: string;
  readonly directApplicationRows: number;
  readonly derivedProjectionRows: number;
  readonly totalApplicationEffects: number;
  readonly resetDeletedRows: number;
}
export type SeedInstallReceiptV1 =
  | Readonly<SeedReceiptBaseV1 & {
      readonly operation: 'install';
      readonly outcome: 'installed';
      readonly seedVersion: string;
      readonly seedDigest: string;
    }>
  | Readonly<SeedReceiptBaseV1 & {
      readonly operation: 'reset-install';
      readonly outcome: 'reset-installed';
      readonly seedVersion: string;
      readonly seedDigest: string;
    }>
  | Readonly<SeedReceiptBaseV1 & {
      readonly operation: 'clear';
      readonly outcome: 'cleared';
      readonly seedVersion?: never;
      readonly seedDigest?: never;
    }>;
export interface SeedMatchedObservationV1 {
  readonly formatVersion: 'snapback.seed.matched-observation.v1';
  readonly outcome: 'matched';
  readonly active: ActiveSeedIdentityV1;
  readonly establishingReceipt: Extract<
    SeedInstallReceiptV1,
    { readonly operation: 'install' | 'reset-install' }
  >;
}
export type SeedEnsureResultV1 =
  | Readonly<{
      readonly state: 'installed';
      readonly receipt: Extract<SeedInstallReceiptV1, { readonly operation: 'install' }>;
    }>
  | Readonly<{
      readonly state: 'matched';
      readonly observation: SeedMatchedObservationV1;
    }>;
interface SeedPreviewCountsV1 {
  readonly current?: ActiveSeedIdentityV1;
  readonly requested?: ActiveSeedIdentityV1;
  readonly directApplicationRows: number;
  readonly derivedProjectionRows: number;
  readonly totalApplicationEffects: number;
  readonly resetDeletedRows: number;
}
export type SeedPreviewResultV1 =
  | Readonly<SeedPreviewCountsV1 & {
      readonly state: 'installable' | 'matched' | 'reset-installable' | 'clearable';
      readonly diagnosticCode?: never;
    }>
  | Readonly<SeedPreviewCountsV1 & {
      readonly state: 'refused';
      readonly diagnosticCode:
        | 'SNAPBACK_SEED_VERSION_REUSED'
        | 'SNAPBACK_SEED_MIGRATION_REQUIRED'
        | 'SNAPBACK_SEED_NONEMPTY_UNTRACKED'
        | 'SNAPBACK_SEED_PARTIAL_UNTRACKED'
        | 'SNAPBACK_SEED_OPERATION_HISTORICAL'
        | 'SNAPBACK_SEED_EFFECT_LIMIT_EXCEEDED';
    }>;
export declare function newSeedOperationIdV1(nowMs?: number): string;

type FunctionRef<
  Kind extends SnapbackFunctionKind,
  Args = unknown,
  Result = unknown,
> = string | SnapbackFunctionReference<string, Kind, Args, Result>;
type NamedReference = string;

export interface SnapbackLiveManagerInspection {
  readonly connectionId: string;
  readonly open: boolean;
  readonly closed: boolean;
  readonly socketDemand: number;
  readonly durableListeners: number;
  readonly ephemeralListeners: number;
  readonly stateListeners: number;
  readonly readinessListeners: number;
  readonly pendingRequests: number;
  readonly reconnectTimer: number;
  readonly heartbeatTimer: number;
}

export interface SnapbackLocalResourceInspection {
  readonly managers: readonly SnapbackLiveManagerInspection[];
  readonly managerCount: number;
  readonly grants: readonly string[];
  readonly grantCount: number;
  readonly laneConsumers: readonly Readonly<{
    connectionId: string;
    durable: number;
    ephemeral: number;
  }>[];
  readonly socketDemand: number;
  readonly timers: number;
  readonly listeners: number;
}

export class SnapbackClient {
  constructor(baseUrl: string, options?: SnapbackClientOptions);
  health(): Promise<unknown>;
  inspect(): Promise<unknown>;
  captureAuthority(): unknown;
  allocateLiveQueryNamespace(
    ref: NamedReference,
    args?: Readonly<Record<string, unknown>>,
  ): unknown;
  isAuthorityCaptureCurrent(capture: unknown): boolean;
  localResourceInspection(connectionIds?: Iterable<string> | null): SnapbackLocalResourceInspection;
  prepareReactBinding(options: {
    readonly generatedManifest:
      | Readonly<Record<string, unknown>>
      | {
          readonly functions: Readonly<Record<string, unknown>>;
          readonly schema?: Readonly<Record<string, unknown>>;
          readonly capabilityManifest?: Readonly<Record<string, unknown>>;
          readonly routes?: Readonly<Record<string, unknown>>;
        };
  }): Promise<PreparedReactBinding>;
  ensureApp(options?: {
    readonly schema?: unknown;
    readonly functions?: unknown;
    readonly seed?: unknown;
    readonly routes?: unknown;
    readonly intent?: 'provision' | null;
    readonly requestedMode?: 'dev' | 'sessions' | null;
  }): Promise<unknown>;
  ensureVersionedSeed(
    artifact: SeedArtifactV1,
    options?: { readonly operationId?: string; readonly requestedMode?: AuthMode },
  ): Promise<SeedEnsureResultV1>;
  previewVersionedSeed(
    artifact: SeedArtifactV1,
    options?: {
      readonly operation?: 'install';
      readonly requestedMode?: AuthMode;
      readonly expectedDataVersionStream?: never;
    },
  ): Promise<SeedPreviewResultV1>;
  previewVersionedSeed(
    artifact: SeedArtifactV1,
    options: {
      readonly operation: 'resetInstall';
      readonly requestedMode?: AuthMode;
      readonly expectedDataVersionStream: ExpectedDataVersionStreamV1;
    },
  ): Promise<SeedPreviewResultV1>;
  previewVersionedSeed(
    artifact: null,
    options: {
      readonly operation: 'clear';
      readonly requestedMode?: AuthMode;
      readonly expectedDataVersionStream: ExpectedDataVersionStreamV1;
    },
  ): Promise<SeedPreviewResultV1>;
  resetInstallVersionedSeed(
    artifact: SeedArtifactV1,
    options: {
      readonly operationId?: string;
      readonly requestedMode?: AuthMode;
      readonly expectedDataVersionStream: ExpectedDataVersionStreamV1;
    },
  ): Promise<Extract<SeedInstallReceiptV1, { readonly operation: 'reset-install' }>>;
  clearVersionedSeed(options: {
    readonly operationId?: string;
    readonly requestedMode?: AuthMode;
    readonly expectedDataVersionStream: ExpectedDataVersionStreamV1;
  }): Promise<Extract<SeedInstallReceiptV1, { readonly operation: 'clear' }>>;
  releaseConnection(
    connectionId: string,
    options?: {
      readonly attachDeadline?: number | null;
      readonly timeoutMs?: number;
      readonly ifIdle?: boolean;
    },
  ): Promise<Readonly<{
    released: boolean;
    attached?: boolean;
    reason?: 'not-owned' | 'shared-demand';
  }>>;
  fetchBundle(options: {
    readonly route: string;
    readonly params?: Readonly<Record<string, string>>;
    readonly mode?: 'read' | 'register';
    readonly idempotencyKey?: string | null;
    readonly devManifestEntry?: unknown;
    readonly userId?: string;
    readonly authorityCapture?: unknown;
    readonly authorizationNamespaces?: readonly unknown[];
    readonly authInvalidationProtocol?: 1 | null;
  }): Promise<unknown>;
  query<Ref extends FunctionRef<'Query' | 'LiveQuery'>>(
    ref: Ref,
    options?: { readonly args?: FunctionArgs<Ref>; readonly userId?: string },
  ): Promise<QueryOutput<QueryWireResult<FunctionResult<Ref>>>>;
  query<Result = unknown>(
    ref: NamedReference,
    options?: { readonly args?: Record<string, unknown>; readonly userId?: string },
  ): Promise<QueryOutput<Result>>;
  search<Ref extends SnapbackFunctionReference<
    string,
    'Query',
    SearchRequestV1,
    SearchPageV1
  >>(
    ref: Ref,
    options: {
      readonly query: SearchQueryAstV1;
      readonly limit?: number;
      readonly after?: string;
      readonly userId?: string;
    },
  ): Promise<FunctionResult<Ref>>;
  mutate<Ref extends FunctionRef<'Mutation'>>(
    ref: Ref,
    options?: {
      readonly args?: FunctionArgs<Ref>;
      readonly userId?: string;
      readonly clientMutationId?: string | null;
    },
  ): Promise<MutationOutput<FunctionResult<Ref>>>;
  mutate<Result = unknown>(
    ref: NamedReference,
    options?: {
      readonly args?: Record<string, unknown>;
      readonly userId?: string;
      readonly clientMutationId?: string | null;
    },
  ): Promise<MutationOutput<Result>>;
  action<Ref extends FunctionRef<'Action'>>(
    ref: Ref,
    options?: { readonly args?: FunctionArgs<Ref>; readonly userId?: string },
  ): Promise<ActionOutput<FunctionResult<Ref>>>;
  action<Result = unknown>(
    ref: NamedReference,
    options?: { readonly args?: Record<string, unknown>; readonly userId?: string },
  ): Promise<ActionOutput<Result>>;
  liveQuery<Ref extends FunctionRef<'Query' | 'LiveQuery'>>(
    ref: Ref,
    options: {
      readonly connectionId: string;
      readonly args?: FunctionArgs<Ref>;
      readonly userId?: string;
      readonly pollCadenceMs?: number;
      readonly fallbackToPoll?: boolean;
      readonly onUpdate?: (rows: FunctionResult<Ref>) => void;
      readonly onConnectionChange?: (
        connection: LiveQueryHandle<FunctionResult<Ref>>['connection'],
        detail?: { readonly error?: unknown },
      ) => void;
    } & LiveQueryRegistrationOptions,
  ): Promise<LiveQueryHandle<FunctionResult<Ref>>>;
  liveQuery<Row = unknown>(
    ref: NamedReference,
    options: {
      readonly connectionId: string;
      readonly args?: Record<string, unknown>;
      readonly userId?: string;
      readonly pollCadenceMs?: number;
      readonly fallbackToPoll?: boolean;
      readonly onUpdate?: (rows: Row[]) => void;
      readonly onConnectionChange?: (
        connection: LiveQueryHandle<Row[]>['connection'],
        detail?: { readonly error?: unknown },
      ) => void;
    } & LiveQueryRegistrationOptions,
  ): Promise<LiveQueryHandle<Row[]>>;
  startLiveQuery<Ref extends FunctionRef<'LiveQuery'>>(
    ref: Ref,
    options: {
      readonly connectionId: string;
      readonly args?: FunctionArgs<Ref>;
      readonly userId?: string;
      readonly pollCadenceMs?: number;
      readonly fallbackToPoll?: boolean;
      readonly supersedes?: StartedLiveQueryHandle<FunctionResult<Ref>> | null;
      readonly onUpdate?: (rows: FunctionResult<Ref>) => void;
      readonly onConnectionChange?: (
        connection: LiveQueryHandle<FunctionResult<Ref>>['connection'],
        detail?: { readonly error?: unknown },
      ) => void;
    } & LiveQueryRegistrationOptions,
  ): StartedLiveQueryHandle<FunctionResult<Ref>>;
  subscribeEphemeral<
    Ref extends string | SnapbackEphemeralReference<string, unknown, unknown>,
  >(
    ref: Ref,
    options: {
      readonly connectionId: string;
      readonly scope?: EphemeralScope<Ref>;
      readonly userId?: string;
      readonly permissions?: readonly string[];
    },
  ): Promise<EphemeralOverlay<EphemeralScope<Ref>, EphemeralValue<Ref>>>;
  registerEphemeralRepublisher<
    Ref extends string | SnapbackEphemeralReference<string, unknown, unknown>,
  >(
    ref: Ref,
    callback: (context: Readonly<{
      collection: string;
      scope: EphemeralScope<Ref>;
      publish(
        value: EphemeralValue<Ref>,
        options?: Readonly<Record<string, unknown>>,
      ): Promise<unknown>;
    }>) => void | EphemeralValue<Ref> | Promise<void | EphemeralValue<Ref>>,
  ): Readonly<{ dispose(): void }>;
  publishEphemeral<
    Ref extends string | SnapbackEphemeralReference<string, unknown, unknown>,
  >(
    ref: Ref,
    options: {
      readonly connectionId: string;
      readonly scope?: EphemeralScope<Ref>;
      readonly value: EphemeralValue<Ref>;
      readonly ttlMs?: number | null;
      readonly userId?: string;
      readonly permissions?: readonly string[];
    },
  ): Promise<unknown>;
  deleteEphemeral<
    Ref extends string | SnapbackEphemeralReference<string, unknown, unknown>,
  >(
    ref: Ref,
    options: {
      readonly connectionId: string;
      readonly scope?: EphemeralScope<Ref>;
      readonly userId?: string;
      readonly permissions?: readonly string[];
    },
  ): Promise<unknown>;
  disconnect(connectionId: string): Promise<unknown>;
  startEphemeralRoom<
    Ref extends SnapbackEphemeralReference<string, unknown, unknown, 'Connection'>,
  >(
    admittedDefinition: Readonly<{
      reference: Ref;
      definition: Readonly<Record<string, unknown>>;
      connectionId: string;
    }>,
    scope: EphemeralScope<Ref>,
  ): EphemeralRoomHandle<EphemeralValue<Ref>>;
}

export function createExternalSessionClient(
  baseUrl: string,
  options: SnapbackClientOptions & { readonly bearerToken: string },
): SnapbackClient;
export function bindSnapbackAppLifecycle(
  appState: {
    readonly currentState?: string | null;
    addEventListener(
      event: 'change',
      listener: (state: string) => void,
    ): { remove(): void } | (() => void);
  },
  handle: { pause(): void | Promise<void>; resume(): void | Promise<void> },
  options?: { activeState?: string; onError?: (error: unknown) => void },
): { dispose(): void; settled(): Promise<void> };

export const LIVE_HEARTBEAT_INTERVAL_MS: number;
export const LIVE_FRESHNESS_BUDGET_MS: number;
export const LIVE_RECONNECT_BASE_DELAY_MS: number;
export const LIVE_RECONNECT_MAX_DELAY_MS: number;
export const DEFAULT_POLL_CADENCE_MS: number;
export const LIVE_DURABLE_KINDS: Readonly<Record<string, string>>;
export const LIVE_SOCKET_KINDS: Readonly<Record<string, string>>;
export const DURABLE_BYTES_RESYNC_REASON: string;
export function durableBytesResyncSentinel(): Readonly<Record<string, unknown>>;
export function dispatchDurableBytesFrame(stream: unknown, frame: unknown): unknown;

export {
  AgentAuthorityFence,
  createMemoryAgentAuthorityCustodyStorage,
} from './agent-authority.mjs';
export type {
  AgentAuthorityCapture,
  AgentAuthorityCredentialInput,
  AgentAuthorityCustodyStorage,
  AgentAuthorityDescriptor,
  AgentAuthorityFenceOptions,
  AgentAuthorityParticipant,
  AgentCredentialOffer,
  AgentCredentialReplacementOffer,
  AgentCustodyOwner,
  AgentDurableAuthority,
  AgentTerminalHandle,
  AgentTerminationDisposition,
} from './agent-authority.mjs';
/** Exact JS twin of the server's service_authority_instance_id derivation;
 * extra credential fields (tokenId, bearerToken) are tolerated. */
export function deriveServiceAuthorityInstanceId(credential: {
  readonly actorUserId: string;
  readonly credentialId: string;
  readonly credentialGeneration: number;
  readonly grantId: string;
}): string;

export {
  compileResultContractValidator,
  RESULT_CONTRACT_LIMITS_V1,
} from '@snapback/contract/result-contract-validator';

export {
  RQS_STORE_MAX_BYTES,
  RQS_STORE_MAX_ENTRIES,
  arbitrateResumeCandidates,
  createIndexedDbRqsResumeStore,
  rqsEntryKey,
  verifyPersistedResumeEntry,
} from './rqs-store.mjs';
export type {
  RqsPersistedResumeMeta,
  RqsPersistedResumeRecord,
  RqsResumeCandidate,
  RqsResumeEntryRefusalReason,
  RqsResumeStore,
  RqsStoreCommitResult,
  RqsStoreInspection,
} from './rqs-store.mjs';

export {
  RQS_BOOT_ELEMENT_ID,
  createRqsPreloadRegistry,
  readInlineBootPayload,
  readRqsPreloadRegistry,
} from './rqs-preload.mjs';
export type {
  RqsBootDocument,
  RqsBootPayload,
  RqsPreloadEntry,
  RqsPreloadRegistry,
} from './rqs-preload.mjs';

export const DEFAULT_INGRESS_LIMIT_BYTES: Readonly<{
  appCall: number;
  authLifecycle: number;
  discovery: number;
  artifact: number;
  liveFrame: number;
}>;

export function assertPreparedReactBinding(binding: unknown): PreparedReactBinding;
export function preparedReactBindingClient(binding: unknown): SnapbackClient;
export function isPreparedReactQueryGroup(value: unknown): boolean;
export function admittedReactQueryGroup(
  binding: unknown,
  reference: SnapbackQueryGroupReference,
): SnapbackQueryGroupReference;
export function admittedReactReference(
  binding: unknown,
  reference: SnapbackFunctionReference,
  expectedKind: SnapbackFunctionKind | readonly SnapbackFunctionKind[],
): SnapbackFunctionReference;
export function preparedReactResultContract(
  binding: unknown,
  reference: SnapbackFunctionReference,
): Readonly<Record<string, unknown>> | null;
export interface PreparedReactEphemeralDefinition {
  readonly reference: SnapbackEphemeralReference;
  readonly definition: Readonly<Record<string, unknown>>;
  readonly staticPolicyDigest: string;
}
export function admittedReactEphemeralDefinition(
  binding: unknown,
  reference: SnapbackEphemeralReference,
): PreparedReactEphemeralDefinition;
