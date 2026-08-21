import type {
  AuthBootstrapSnapshot,
  AuthorityTransitionReceiptV1,
  CurrentPrincipalSnapshot,
  FunctionArgs,
  FunctionResult,
  GeneratedOptimisticPresentation,
  LiveQueryRef,
  EphemeralScope,
  EphemeralValue,
  LiveQueryRetention,
  MutationDisposition,
  MutationOutput,
  MutationRef,
  OutboxDrainControllerStatus,
  OutboxDrainOptions,
  OutboxDrainPhase,
  OutboxReplayOutcome,
  PreparedReactQueryGroup,
  PreparedReactBinding,
  SnapbackAppBindingV1,
  SnapbackAppClient,
  SnapbackAppClientPlatform,
  SnapbackApplicationDescriptorV1,
  SnapbackAuthFacade,
  QuarantinedMutationReentryOutcome,
  QuarantinedMutationTombstone,
  QueryGroupEntries,
  ResultGoneAcknowledgementOutcome,
  SnapbackProvisionalId,
  SnapbackEphemeralReference,
  StrandedMutation,
  StrandedMutationDiscardOutcome,
} from '@expo/snapback-client';
import type {
  AssetDiagnostic,
  AssetFileLike,
  AssetIssuedUrlSnapshot,
  AssetSignedUrlOptions,
  AssetTaskSnapshot,
  AssetUploadTask,
  MediaCollectionItem,
  MediaCollectionItemState,
  MediaCollectionState,
  MediaKind,
  MediaRef,
  MediaState,
} from '@expo/snapback-client/assets';
import type {
  AssetBearingCommandDescriptorV1,
  AssetBearingCommandReferenceV1,
  CommandArgs,
  CommandRef,
  CommandOutcome,
  CommandResidue,
  CommandResult,
  CommandTask,
  CommandTaskSnapshot,
  MediaCommandDescriptorV1,
  MediaCommandOutcome,
  MediaCommandReferenceV1,
  MediaCommandTask,
  MediaCommandTaskSnapshot,
  MutationAttemptSnapshot,
  SnapbackCommandDiagnostic,
  TypedRemediation,
} from '@expo/snapback-client/commands';

export type {
  AssetDiagnostic,
  AssetFileLike,
  AssetIssuedUrlSnapshot,
  AssetSignedUrlOptions,
  AssetTaskSnapshot,
  AssetUploadTask,
  MediaCollectionItem,
  MediaCollectionItemState,
  MediaCollectionState,
  MediaKind,
  MediaRef,
  MediaState,
} from '@expo/snapback-client/assets';
export type {
  AssetBearingCommandDescriptorV1,
  AssetBearingCommandReferenceV1,
  CommandArgs,
  CommandRef,
  CommandOutcome,
  CommandResidue,
  CommandResult,
  CommandTask,
  CommandTaskSnapshot,
  MediaCommandDescriptorV1,
  MediaCommandOutcome,
  MediaCommandReferenceV1,
  MediaCommandTask,
  MediaCommandTaskSnapshot,
  MutationAttemptSnapshot,
  SnapbackCommandDiagnostic,
  TypedRemediation,
} from '@expo/snapback-client/commands';
export type SnapbackDiagnostic = import('@expo/snapback-client').SnapbackDiagnostic;
export type SnapbackDiagnosticsSnapshot = import('@expo/snapback-client').SnapbackClientDiagnosticsSnapshot;
export {
  ARGUMENT_NORMALIZATION_VERSION,
  SnapbackDiagnosticError,
  isSnapbackDiagnosticError,
} from '@expo/snapback-client';

export type SnapbackMutationQueuedOutcome = Readonly<{
  status: 'queued';
  clientMutationId: string;
  sequence: number;
  presentation: 'installed' | 'withheld' | 'unavailable';
  /** Payload-safe local presentation diagnostic, present for unavailable. */
  diagnosticCode?: string;
  operationCoverageDisposition?: string;
  operationHash?: string;
}>;

/** React facade dispatch result: the settled branch contains only the LLP
 * 0101-validated function result, never the raw headless MutationOutput. */
export type SnapbackMutationDispatchOutcome<Result> =
  | Readonly<{ status: 'settled'; result: Result }>
  | SnapbackMutationQueuedOutcome;

export type SnapbackConnection =
  | 'idle'
  | 'connecting'
  | 'live'
  | 'polling'
  | 'stale'
  | 'disconnected'
  | 'closed'
  | 'error';

/** Channel B canonical-base freshness axis (LLP 0090 D1 / LLP 0114):
 * 'retained' rows come from persistence/preload; 'current' means the base is
 * current, while `answerClass: 'optimistic'` explicitly marks data with a
 * private prediction; 'unknown' means no rows are held; 'snapshot' rows come
 * from a mixed-route read-only child's boot snapshot. */
export type SnapbackFreshness = 'unknown' | 'retained' | 'current' | 'snapshot';
export type SnapbackAnswerClass =
  | 'unknown'
  | 'labeled-retained'
  | 'authoritative'
  | 'optimistic'
  | 'pending-without-prediction';

/** Refuse-with-clarity retainability fact, surfaced from the headless
 * handle (LLP 0129 Phase 0); null until the subscription is classified. */
export type SnapbackRetention = LiveQueryRetention;
export type SnapbackAuthTransitionOwner = 'auth-coordinator';

export type QueryState<Result> = (
  | Readonly<{ status: 'pending'; data: undefined; error: null; connection: SnapbackConnection; freshness: 'unknown'; retention: SnapbackRetention | null }>
  | Readonly<{ status: 'blocked'; reason: 'authentication-required' | 'authentication-not-settled'; transitionOwner: SnapbackAuthTransitionOwner; data: undefined; error: null; connection: SnapbackConnection; freshness: 'unknown'; retention: null }>
  | Readonly<{ status: 'ready'; data: Result; error: null; connection: SnapbackConnection; freshness: 'current' | 'snapshot'; retention: SnapbackRetention | null }>
  | Readonly<{ status: 'refreshing'; data: Result; error: null; connection: SnapbackConnection; freshness: 'retained' | 'current'; retention: SnapbackRetention | null }>
  | Readonly<{ status: 'error'; data: undefined; error: SnapbackDiagnostic; transitionOwner?: SnapbackAuthTransitionOwner; connection: SnapbackConnection; freshness: 'unknown'; retention: SnapbackRetention | null }>
  | Readonly<{ status: 'skipped'; data: undefined; error: null; connection: SnapbackConnection; freshness: 'unknown'; retention: null }>
) & Readonly<{
  answerClass: SnapbackAnswerClass;
  optimisticPresentation?: GeneratedOptimisticPresentation | null;
}>;

export type QueryReference<
  Name extends string = string,
  Args = Record<string, unknown>,
  Result extends ReadonlyArray<unknown> = ReadonlyArray<unknown>,
> = LiveQueryRef<Name, Args, Result>;

export type MutationReference<
  Name extends string = string,
  Args = Record<string, unknown>,
  Result = unknown,
> = MutationRef<Name, Args, Result>;

/** The stable generated shape shared by every authority profile. Exact
 * profile members remain inferred from the application's generated API. */
export type AuthorityProfileReferences = Readonly<{
  list: QueryReference<string, unknown, ReadonlyArray<unknown>>;
  myRole: QueryReference<string, unknown, ReadonlyArray<unknown>>;
}>;

export type AuthorityProfileScopeId<Profile extends AuthorityProfileReferences> =
  FunctionArgs<Profile['list']> extends { readonly scopeId: infer Scope } ? Scope : never;

export type AuthorityRosterRow<Profile extends AuthorityProfileReferences> =
  FunctionResult<Profile['list']> extends ReadonlyArray<infer Row> ? Row : never;

export type AuthorityMyRoleRow<Profile extends AuthorityProfileReferences> =
  FunctionResult<Profile['myRole']> extends ReadonlyArray<infer Row> ? Row : never;

export type AuthorityRosterLoadMoreOutcome =
  | Readonly<{ status: 'complete' }>
  | Readonly<{
      status: 'appended';
      rows: number;
      cursor: string | null;
      hasMore: boolean;
    }>
  | Readonly<{
      status: 'reset';
      reason: 'cursor-invalid' | 'identity-changed';
    }>;

export type AuthorityRosterState<Row> = QueryState<readonly Row[]> & Readonly<{
  /** Opaque server continuation. Applications may persist no meaning in it. */
  cursor: string | null;
  hasMore: boolean;
  loadingInitial: boolean;
  loadingMore: boolean;
  /** The last continuation failure. Already-loaded rows remain renderable. */
  pageError: SnapbackDiagnostic | null;
  loadMore(): Promise<AuthorityRosterLoadMoreOutcome>;
  /** Drop all retained pages and reacquire the first page. */
  reset(): void;
}>;

export type SnapbackAuthorityMutationDispatchOutcome<Result> =
  | Readonly<{
      status: 'settled';
      result: Result;
      authorityTransitions: readonly AuthorityTransitionReceiptV1[];
    }>
  | SnapbackMutationQueuedOutcome;

export type SnapbackAuthorityMutationDisposition =
  | Exclude<MutationDisposition, { readonly status: 'settled' }>
  | Readonly<{
      status: 'settled';
      settlement: MutationOutput<unknown> & Readonly<{
        authorityTransitions: readonly AuthorityTransitionReceiptV1[];
      }>;
      settledAt: number;
    }>;

type OptimisticCreateQueryRow<Ref extends QueryReference> =
  FunctionResult<Ref> extends ReadonlyArray<infer Row> ? Row : never;
type OptimisticCreateTable<Row> = Row extends {
  readonly _id: string & { readonly __snapbackIdTable: infer Table extends string };
} ? Table : string;
export type OptimisticCreateProvisionalFields<Row> = Omit<
  Row,
  '_id' | '_version' | '_createdAt' | '_updatedAt'
>;
export type OptimisticCreateEntity<Row> =
  | Readonly<{
      kind: 'canonical';
      identity: Readonly<{
        kind: 'canonical';
        id: Row extends { readonly _id: infer Id } ? Id : string;
      }>;
      fields: Row;
    }>
  | Readonly<{
      kind: 'provisional';
      identity: Readonly<{
        kind: 'provisional';
        id: SnapbackProvisionalId<OptimisticCreateTable<Row>>;
        intentId: SnapbackProvisionalId<OptimisticCreateTable<Row>>;
      }>;
      fields: OptimisticCreateProvisionalFields<Row>;
    }>;

export type ConnectionEphemeralCollectionReference<
  Name extends string = string,
  Scope = Record<string, unknown>,
  Value = unknown,
> = SnapbackEphemeralReference<Name, Scope, Value, 'Connection'>;

export const skip: unique symbol;

export interface SnapbackReactCoreProvider {
  readonly kind: 'snapback.react-provider.v1';
  readonly providerInstanceId: string;
  readonly binding: PreparedReactBinding;
  /** Activate provider-owned registrations. Idempotent for an active provider. */
  start(): SnapbackReactCoreProvider;
  registerEphemeralRepublisher(
    reference: string,
    callback: (context: Readonly<{
      collection: string;
      publish(value: unknown, options?: Readonly<Record<string, unknown>>): Promise<unknown>;
    }>) => unknown,
  ): Readonly<{ dispose(): void }>;
  /** Quiesce provider-owned live query and presence handles for host lifecycle. */
  pause(): Promise<void>;
  /** Resume provider-owned live query and presence handles after host activation. */
  resume(): Promise<void>;
  inspection(): Readonly<{
    providerInstanceId: string;
    terminal: boolean;
    custodyPaused: boolean;
    hostPaused: boolean;
    stores: number;
    optimisticLayers: number;
    optimisticCreateViews: number;
    optimisticCreateConsumers: number;
    provisionalCreates: number;
    confirmedOptimisticLayers: readonly Readonly<{
      attemptId: string;
      mutationId: string;
      queryId: string;
      confirmedRevision: number;
      storeRevision: number;
    }>[];
    consumers: number;
    serverSubscriptions: number;
    leases: number;
    reservations: number;
    timers: number;
    listeners: number;
    presenceStores: number;
    presenceConsumers: number;
    presenceSubscriptions: number;
    publishers: number;
    presenceTimers: number;
    presenceListeners: number;
    resyncReasons: readonly string[];
    diagnostics: readonly SnapbackDiagnostic[];
    preparedRegistrations: number;
    preparedGroupSource: PreparedReactQueryGroup['source'] | null;
    preparedGroupReason: string | null;
    preparedGroupBoot: PreparedReactQueryGroup['boot'];
    /** Mounted-provider HMR generation handoff state (development only). */
    generationHandoff: 'active' | 'ok' | 'failed' | null;
  }>;
  dispose(): Promise<void>;
}

/** Full root composition. The ./core entry returns SnapbackReactCoreProvider
 * and statically omits these surface/command/asset capabilities. */
export interface SnapbackReactProvider extends SnapbackReactCoreProvider {
  readonly kind: 'snapback.react-provider.v1';
  readonly providerInstanceId: string;
  readonly binding: PreparedReactBinding;
  readonly assets: unknown | null;
  readonly assetSourceAdapter: import('@expo/snapback-client').CommandAssetSourceAdapter | null;
  /** Activate provider-owned registrations. Idempotent for an active provider. */
  start(): SnapbackReactProvider;
  surface<Surface extends SnapbackSurfaceDescriptor>(
    descriptor: Surface,
    params: SurfaceParams<Surface>,
    options?: SurfaceOptions<Surface>,
  ): BoundSnapbackSurface<Surface>;
  registerEphemeralRepublisher(
    reference: string,
    callback: (context: Readonly<{
      collection: string;
      publish(value: unknown, options?: Readonly<Record<string, unknown>>): Promise<unknown>;
    }>) => unknown,
  ): Readonly<{ dispose(): void }>;
  /** Quiesce provider-owned live query and presence handles for host lifecycle. */
  pause(): Promise<void>;
  /** Resume provider-owned live query and presence handles after host activation. */
  resume(): Promise<void>;
  inspection(): Readonly<{
    providerInstanceId: string;
    terminal: boolean;
    custodyPaused: boolean;
    hostPaused: boolean;
    stores: number;
    optimisticLayers: number;
    optimisticCreateViews: number;
    optimisticCreateConsumers: number;
    provisionalCreates: number;
    confirmedOptimisticLayers: readonly Readonly<{
      attemptId: string;
      mutationId: string;
      queryId: string;
      confirmedRevision: number;
      storeRevision: number;
    }>[];
    orphanedOptimisticLayers: readonly Readonly<{
      attemptId: string;
      clientMutationId: string;
      mutationId: string;
      queryId: string;
      disposition: 'unknown';
    }>[];
    consumers: number;
    serverSubscriptions: number;
    leases: number;
    reservations: number;
    timers: number;
    listeners: number;
    presenceStores: number;
    presenceConsumers: number;
    presenceSubscriptions: number;
    publishers: number;
    presenceTimers: number;
    presenceListeners: number;
    resyncReasons: readonly string[];
    diagnostics: readonly SnapbackDiagnostic[];
    preparedRegistrations: number;
    preparedGroupSource: PreparedReactQueryGroup['source'] | null;
    preparedGroupReason: string | null;
    preparedGroupBoot: PreparedReactQueryGroup['boot'];
    /** Mounted-provider HMR generation handoff state (development only). */
    generationHandoff: 'active' | 'ok' | 'failed' | null;
    outboxDrain: OutboxDrainControllerStatus | null;
  }>;
  dispose(): Promise<void>;
}

export function createSnapbackReactProvider(
  binding: PreparedReactBinding,
  options?: {
    readonly connectionId?: string;
    readonly onDiagnostic?: (diagnostic: SnapbackDiagnostic) => void;
    readonly preparedGroup?: PreparedReactQueryGroup;
    /** Automatic is the durable-writer default; manual retains a safety
     * controller whose cycles are requested only through drainNow. */
    readonly outboxDrain?: 'auto' | 'manual';
    /** P2 carrier/test seams passed through to startOutboxDrain. */
    readonly outboxDrainOptions?: Omit<OutboxDrainOptions, 'automatic'>;
    /** Test/DI seam: a pre-built SnapbackAssetClient-compatible surface. */
    readonly assets?: unknown;
    /** Platform URI/picker conversion installed once by an owning host package. */
    readonly assetSourceAdapter?: import('@expo/snapback-client').CommandAssetSourceAdapter;
    /**
     * Mounted-provider HMR generation handoff tuning (development only —
     * the handoff arms itself only on a positive development signal such as
     * Metro's `__DEV__` or a bundler HMR host). `onReloadRequired` replaces
     * the default full-reload attempt when the handoff cannot complete
     * atomically.
     */
    readonly developmentHmr?: {
      readonly timeoutMs?: number;
      readonly pollIntervalMs?: number;
      readonly onReloadRequired?: (failure: SnapbackDiagnostic) => void;
    };
  },
): SnapbackReactProvider;

type SnapbackProviderSharedProps = Readonly<{
  children?: any;
  fallback?: any | ((state: AuthBootstrapSnapshot) => any);
  outboxDrain?: 'auto' | 'manual';
  outboxDrainOptions?: Omit<OutboxDrainOptions, 'automatic'>;
}>;

export type SnapbackProviderProps = SnapbackProviderSharedProps & (
  | Readonly<{
      appClient: SnapbackAppClient;
      app?: never;
      binding?: never;
      platform?: never;
      storagePartition?: never;
      now?: never;
      provider?: never;
    }>
  | Readonly<{
      app: SnapbackApplicationDescriptorV1;
      binding: SnapbackAppBindingV1;
      platform: SnapbackAppClientPlatform;
      storagePartition?: string;
      /** Injected binding-admission clock; defaults to Date.now. */
      now?: () => number;
      appClient?: never;
      provider?: never;
    }>
  | Readonly<{
      binding?: PreparedReactBinding;
      provider?: SnapbackReactProvider;
      appClient?: never;
      app?: never;
      platform?: never;
      storagePartition?: never;
      now?: never;
    }>
);

export function SnapbackProvider(props: SnapbackProviderProps): any;

/** Exact LLP 0238 current-principal projection from the ordinary app owner.
 * Official providers withhold hook consumers until ready. Custom SSR trees
 * that render this hook must provide a deterministic server snapshot equal to
 * the first hydration snapshot. */
export function useSnapbackCurrentPrincipal(): CurrentPrincipalSnapshot;

/** Stable projection of the framework-neutral application's auth facade. */
export function useSnapbackAuth(): SnapbackAuthFacade;

export function useSnapbackQuery<Ref extends QueryReference>(
  reference: Ref,
  args: FunctionArgs<Ref> | typeof skip,
): QueryState<FunctionResult<Ref>>;

/** Live roster plus opaque-cursor load-more lifecycle. Scope, caller, and
 * generated-reference changes synchronously discard retained continuations. */
export function useSnapbackAuthorityRoster<
  Profile extends AuthorityProfileReferences,
>(
  profile: Profile,
  scopeId: AuthorityProfileScopeId<Profile>,
  options?: Readonly<{ limit?: number }>,
): AuthorityRosterState<AuthorityRosterRow<Profile>>;

/** The current caller's server-derived role/status row, or null when absent. */
export function useSnapbackAuthorityMyRole<
  Profile extends AuthorityProfileReferences,
>(
  profile: Profile,
  scopeId: AuthorityProfileScopeId<Profile>,
): QueryState<AuthorityMyRoleRow<Profile> | null>;

/** Dispatch an authority mutation while retaining committed transition
 * receipts on the settled branch. Refusals reject as SnapbackDiagnosticError. */
export function useSnapbackAuthorityMutation<Ref extends MutationReference>(
  reference: Ref,
): (
  args: FunctionArgs<Ref>,
) => Promise<SnapbackAuthorityMutationDispatchOutcome<FunctionResult<Ref>>>;

/** Observe the existing durable mutation disposition for a queued authority
 * intent. Null/undefined projects the stable `unknown` arm. */
export function useSnapbackAuthorityMutationStatus(
  clientMutationId: string | null | undefined,
): SnapbackAuthorityMutationDisposition;

export type PresenceEntry<Value> = Readonly<{
  key: string;
  value: DeepReadonly<Value>;
  expiresAtMs: number;
  receivedAtMs: number;
  scopeEpoch: number;
  entryVersion: number;
}>;
export type PublisherState =
  | Readonly<{ status: 'observing' | 'publishing' | 'published'; diagnostic: null }>
  | Readonly<{ status: 'publish-error'; diagnostic: SnapbackDiagnostic }>;
export type PresenceActions<Value> = Readonly<{
  publisher: PublisherState;
  publish(value: Value, options?: { readonly ttlMs?: number }): Promise<void>;
  delete(): Promise<void>;
}>;
export type PresenceState<Value> =
  | (Readonly<{
      status: 'pending' | 'resyncing';
      entries: readonly [];
      selfKey: null;
      diagnostic: null;
      connection: SnapbackConnection;
    }> & PresenceActions<Value>)
  | (Readonly<{
      status: 'ready' | 'stale';
      entries: readonly PresenceEntry<Value>[];
      selfKey: string;
      diagnostic: null;
      connection: SnapbackConnection;
    }> & PresenceActions<Value>)
  | (Readonly<{
      status: 'error' | 'unsupported';
      entries: readonly [];
      selfKey: null;
      diagnostic: SnapbackDiagnostic;
      connection: SnapbackConnection;
    }> & PresenceActions<Value>);
type DeepReadonly<Value> =
  Value extends (...args: any[]) => any ? Value
    : Value extends readonly (infer Entry)[] ? readonly DeepReadonly<Entry>[]
      : Value extends object ? { readonly [Name in keyof Value]: DeepReadonly<Value[Name]> }
        : Value;

/**
 * React hook for a generated connection-owned ephemeral collection. The
 * generated `scope` is the app-defined room boundary (for example, a
 * conversation id); "presence" names the managed React projection, not a
 * separate schema feature.
 */
export function useSnapbackPresence<
  Ref extends ConnectionEphemeralCollectionReference,
>(
  reference: Ref,
  options: Readonly<{
    scope: EphemeralScope<Ref>;
    value: EphemeralValue<Ref> | typeof skip;
    ttlMs?: number;
  }>,
): PresenceState<EphemeralValue<Ref>>;

export type ActivityPresenceOptions<Ref extends ConnectionEphemeralCollectionReference> =
  Readonly<{
    scope: EphemeralScope<Ref>;
    value: () => EphemeralValue<Ref>;
    idleMs: number;
    ttlMs?: number;
    /** Defaults to true. False retains the granted connection's own entry. */
    excludeSelf?: boolean;
    onError?: (diagnostic: SnapbackDiagnostic) => void;
  }>;

export type ActivityPresenceState<Value> = Readonly<{
  status: PresenceState<Value>['status'];
  active: boolean;
  touch(): void;
  withdraw(): Promise<void>;
  peers: readonly PresenceEntry<Value>[];
  publisher: PublisherState;
  connection: SnapbackConnection;
  diagnostic: SnapbackDiagnostic | null;
  lastError: SnapbackDiagnostic | null;
}>;

/**
 * Announce a connection-owned ephemeral value after activity ticks and
 * withdraw it after the absolute idle deadline, explicit withdrawal, room
 * replacement, or unmount. Renewal remains provider-owned.
 */
export function useSnapbackActivityPresence<
  Ref extends ConnectionEphemeralCollectionReference,
>(
  reference: Ref,
  options: ActivityPresenceOptions<Ref>,
): ActivityPresenceState<EphemeralValue<Ref>>;

export interface SnapbackSurfaceMember<Reference = unknown, Input = Record<string, never>> {
  readonly artifactKind: 'surfaceMemberBinding';
  readonly reference: Reference;
  readonly __input?: Input;
}
export interface SnapbackSurfaceDescriptor<
  Params = any,
  Reads = any,
  Mutations = any,
  Commands = any,
  Presence = any,
  Assets = any,
> {
  readonly artifactKind: 'surfaceDescriptor';
  readonly id: string;
  readonly params: Readonly<Record<string, unknown>>;
  readonly reads: Reads;
  readonly mutations: Mutations;
  readonly commands: Commands;
  readonly presence: Presence;
  readonly assets: Assets;
  readonly __params?: Params;
}
export type SurfaceParams<Surface> = Surface extends SnapbackSurfaceDescriptor<infer Params, any, any, any, any, any>
  ? Params
  : never;
type SurfaceReads<Surface> = Surface extends SnapbackSurfaceDescriptor<any, infer Reads, any, any, any, any> ? Reads : never;
type SurfaceMutations<Surface> = Surface extends SnapbackSurfaceDescriptor<any, any, infer Mutations, any, any, any> ? Mutations : never;
type SurfaceCommands<Surface> = Surface extends SnapbackSurfaceDescriptor<any, any, any, infer Commands, any, any> ? Commands : never;
type SurfacePresence<Surface> = Surface extends SnapbackSurfaceDescriptor<any, any, any, any, infer Presence, any> ? Presence : never;
type SurfaceAssets<Surface> = Surface extends SnapbackSurfaceDescriptor<any, any, any, any, any, infer Assets> ? Assets : never;
type SurfaceMemberReference<Member> = Member extends SnapbackSurfaceMember<infer Reference, any> ? Reference : never;
type SurfaceMemberInput<Member> = Member extends SnapbackSurfaceMember<any, infer Input> ? Input : never;
type ProjectedCommandTask<Command extends CommandRef> =
  Command extends MediaCommandReferenceV1
    ? MediaCommandTask<CommandResult<Command>>
    : CommandTask<CommandResult<Command>>;
export type SurfaceOptions<Surface extends SnapbackSurfaceDescriptor> = Readonly<{
  presence?: Readonly<{
    [Name in keyof SurfacePresence<Surface>]?: SurfaceMemberReference<SurfacePresence<Surface>[Name]> extends ConnectionEphemeralCollectionReference
      ? EphemeralValue<SurfaceMemberReference<SurfacePresence<Surface>[Name]>> | typeof skip
      : never
  }>;
}>;
export type SurfaceResult<Surface extends SnapbackSurfaceDescriptor> = Readonly<{
  data: Readonly<{
    [Name in keyof SurfaceReads<Surface>]: SurfaceMemberReference<SurfaceReads<Surface>[Name]> extends QueryReference
      ? FunctionResult<SurfaceMemberReference<SurfaceReads<Surface>[Name]>> | undefined
      : never
  }>;
  state: Readonly<{
    [Name in keyof SurfaceReads<Surface>]: SurfaceMemberReference<SurfaceReads<Surface>[Name]> extends QueryReference
      ? QueryState<FunctionResult<SurfaceMemberReference<SurfaceReads<Surface>[Name]>>>
      : never
  }>;
  mutations: Readonly<{
    [Name in keyof SurfaceMutations<Surface>]: SurfaceMemberReference<SurfaceMutations<Surface>[Name]> extends MutationReference
      ? (input: SurfaceMemberInput<SurfaceMutations<Surface>[Name]>) => Promise<
          SnapbackMutationDispatchOutcome<FunctionResult<SurfaceMemberReference<SurfaceMutations<Surface>[Name]>>>
        >
      : never
  }>;
  commands: Readonly<{
    [Name in keyof SurfaceCommands<Surface>]: SurfaceMemberReference<SurfaceCommands<Surface>[Name]> extends CommandRef
      ? (input: SurfaceMemberInput<SurfaceCommands<Surface>[Name]>) => ProjectedCommandTask<SurfaceMemberReference<SurfaceCommands<Surface>[Name]>>
      : never
  }>;
  presence: Readonly<{
    [Name in keyof SurfacePresence<Surface>]: SurfaceMemberReference<SurfacePresence<Surface>[Name]> extends ConnectionEphemeralCollectionReference
      ? PresenceState<EphemeralValue<SurfaceMemberReference<SurfacePresence<Surface>[Name]>>> & Readonly<{
          members: readonly PresenceEntry<EphemeralValue<SurfaceMemberReference<SurfacePresence<Surface>[Name]>>>[];
        }>
      : never
  }>;
  assets: Readonly<{
    [Name in keyof SurfaceAssets<Surface>]: Readonly<{
      readonly reference: SurfaceMemberReference<SurfaceAssets<Surface>[Name]>;
      start(input: SurfaceMemberInput<SurfaceAssets<Surface>[Name]> & Readonly<{
        file: AssetFileLike;
        declaredFilename?: string | null;
        declaredContentType?: string | null;
        previewUrl?: string | null;
      }>): AssetUploadTask;
    }>
  }>;
  descriptor: Surface;
}>;
export interface BoundSnapbackSurface<Surface extends SnapbackSurfaceDescriptor> {
  readonly artifactKind: 'boundSnapbackSurface';
  readonly descriptor: Surface;
  readonly reads: Readonly<{
    [Name in keyof SurfaceReads<Surface>]: Readonly<{
      snapshot(): SurfaceResult<Surface>['state'][Name];
      subscribe(listener: (state: SurfaceResult<Surface>['state'][Name]) => void): () => void;
    }>
  }>;
  readonly mutations: SurfaceResult<Surface>['mutations'];
  readonly commands: SurfaceResult<Surface>['commands'];
  readonly assets: SurfaceResult<Surface>['assets'];
  update(params: SurfaceParams<Surface>, options?: SurfaceOptions<Surface>): void;
  subscribe(listener: () => void): () => void;
  snapshot(): SurfaceResult<Surface>;
  dispose(): Promise<void>;
}
export function bindSnapbackSurface<Surface extends SnapbackSurfaceDescriptor>(
  provider: SnapbackReactProvider,
  surface: Surface,
  params: SurfaceParams<Surface>,
  options?: SurfaceOptions<Surface>,
): BoundSnapbackSurface<Surface>;
export function observeSnapbackSurface<Surface extends SnapbackSurfaceDescriptor>(
  provider: SnapbackReactProvider,
  surface: Surface,
  params: SurfaceParams<Surface>,
  options: SurfaceOptions<Surface>,
  listener: (state: SurfaceResult<Surface>) => void,
): Readonly<{
  snapshot(): SurfaceResult<Surface>;
  readonly reads: BoundSnapbackSurface<Surface>['reads'];
  readonly mutations: BoundSnapbackSurface<Surface>['mutations'];
  readonly commands: BoundSnapbackSurface<Surface>['commands'];
  readonly assets: BoundSnapbackSurface<Surface>['assets'];
  update(params: SurfaceParams<Surface>, options?: SurfaceOptions<Surface>): void;
  dispose(): Promise<void>;
}>;
export function useSurface<Surface extends SnapbackSurfaceDescriptor>(
  surface: Surface,
  params: SurfaceParams<Surface>,
  options?: SurfaceOptions<Surface>,
): SurfaceResult<Surface>;

export type QueryEntry<Ref extends QueryReference = QueryReference> = Readonly<{
  ref: Ref;
  args: FunctionArgs<Ref> | typeof skip;
}>;

export type QueryEntryMap = Readonly<Record<string, QueryEntry>>;

type EntryState<Entry> = Entry extends { readonly args: typeof skip }
  ? Extract<QueryState<never>, { status: 'skipped' }>
  : Entry extends { readonly ref: infer Ref extends QueryReference }
    ? QueryState<FunctionResult<Ref>>
    : never;

export type QueryStates<Entries extends QueryEntryMap> = Readonly<{
  [Name in keyof Entries]: EntryState<Entries[Name]>
}>;

export type QueryGroupState<Entries extends QueryEntryMap> = Readonly<{
  queries: QueryStates<Entries>;
  status: 'pending' | 'blocked' | 'ready' | 'refreshing' | 'error';
  connection: SnapbackConnection;
  error: SnapbackDiagnostic | null;
  boot: null | Readonly<{
    source: 'registered-bundle';
    commitVersion: number;
    generation: string;
    versionStream: string;
  }>;
}>;

export function useSnapbackQueries<const Entries extends QueryEntryMap>(
  entries: Entries,
): QueryGroupState<Entries>;
type PreparedGroupEntryMap<Group extends PreparedReactQueryGroup> =
  QueryGroupEntries<Group['reference']> extends QueryEntryMap
    ? QueryGroupEntries<Group['reference']>
    : never;
// @ref LLP 0112#generated-reference — preserve the generated declaration's
// finite child keys; intersecting it with QueryEntryMap would reopen every
// string key and erase exact group-result typing.
export function useSnapbackQueries<
  const Group extends PreparedReactQueryGroup,
>(
  group: Group,
): QueryGroupState<PreparedGroupEntryMap<Group>>;

/** Declarative capture-and-set optimistic projection for a records-shaped
 * query result (LLP 0107 replay-safety affordances): spread the returned
 * pair into `optimistic` options. `update` sets the intended primitive
 * field values on the identified row (idempotent, replay-safe by
 * construction); `isAuthoritative` retires only on the complete receipt —
 * per projected field, the mutation result's value when the result object
 * carries that field, else the intended value. */
export function projectRecordFields(
  recordId: string,
  fields: Readonly<Record<string, boolean | number | string | null>>,
  options?: Readonly<{ idField?: string }>,
): Readonly<{
  update<Rows extends ReadonlyArray<Record<string, unknown>>>(current: Rows): Rows;
  isAuthoritative(current: ReadonlyArray<Record<string, unknown>>, result: unknown): boolean;
}>;

export type SnapbackOptimisticMutationOptions<
  Ref extends MutationReference,
  Q extends QueryReference = never,
> = Readonly<{
  optimistic?: Readonly<{
    query: Q;
    args: FunctionArgs<Q>;
    update(
      current: FunctionResult<Q>,
      mutationArgs: FunctionArgs<Ref>,
    ): FunctionResult<Q>;
    isAuthoritative?(
      current: FunctionResult<Q>,
      result: FunctionResult<Ref>,
    ): boolean;
  }>;
}>;

/** Explicit queue:false compatibility mode: connectivity is required and the
 * historical bare validated result is retained by choice. */
export function useSnapbackMutation<
  Ref extends MutationReference,
  Q extends QueryReference = never,
>(
  reference: Ref,
  options: SnapbackOptimisticMutationOptions<Ref, Q> & Readonly<{ queue: false }>,
): (args: FunctionArgs<Ref>) => Promise<FunctionResult<Ref>>;
/** Default mutation dispatch resolves the truthful settled-or-queued union. */
export function useSnapbackMutation<
  Ref extends MutationReference,
  Q extends QueryReference = never,
>(
  reference: Ref,
  options?: SnapbackOptimisticMutationOptions<Ref, Q> & Readonly<{ queue?: undefined }>,
): (args: FunctionArgs<Ref>) => Promise<SnapbackMutationDispatchOutcome<FunctionResult<Ref>>>;

/** Convenience alias for useSnapbackMutation(reference, {...options,
 * queue:false}); resolves the bare LLP 0101-validated result. */
export function useSnapbackSettledMutation<
  Ref extends MutationReference,
  Q extends QueryReference = never,
>(
  reference: Ref,
  options?: SnapbackOptimisticMutationOptions<Ref, Q>,
): (args: FunctionArgs<Ref>) => Promise<FunctionResult<Ref>>;

/** Provider-owned generated-IR insert projected over the exact canonical
 * query store. The generated speculative mint remains private; provisional
 * entities expose only durable intent identity. */
export function useSnapbackOptimisticCreate<
  Ref extends MutationReference,
  Q extends QueryReference,
  Selected = readonly OptimisticCreateEntity<OptimisticCreateQueryRow<Q>>[],
>(
  reference: Ref,
  options: Readonly<{
    query: Q;
    args: FunctionArgs<Q>;
    select?: (entities: readonly OptimisticCreateEntity<OptimisticCreateQueryRow<Q>>[]) => Selected;
  }>,
): Readonly<{
  query: QueryState<Selected>;
  create(args: FunctionArgs<Ref>): Promise<SnapbackMutationDispatchOutcome<FunctionResult<Ref>>>;
}>;
export function useSnapbackCommand<Command extends CommandRef>(
  reference: Command,
): (args: CommandArgs<Command>) => ProjectedCommandTask<Command>;

export type SnapbackConnectionState = Readonly<{
  status: SnapbackConnection;
  diagnostic: SnapbackDiagnostic | null;
  activeSubscriptions: number;
}>;

export function useSnapbackConnection(): SnapbackConnectionState;

/** Projection of the headless client's queued-intent facts (LLP 0043 M2 /
 * LLP 0129 Phase 0): 'loading' until the first durable-store read lands. */
export type SnapbackOutboxState =
  | Readonly<{
      status: 'loading'; supported: false;
      pending: 0; failed: 0; stranded: 0; quarantined: 0; resultGone: 0; depth: 0;
      replaying: false; oldestPendingAtMs: null; drainPhase: 'idle';
      lastAttemptAtMs: null; nextRetryAtMs: null; blockedReason: null;
    }>
  | Readonly<{
      status: 'ready'; supported: boolean;
      pending: number; failed: number; stranded: number; quarantined: number;
      resultGone: number; depth: number; replaying: boolean;
      oldestPendingAtMs: number | null; drainPhase: OutboxDrainPhase;
      lastAttemptAtMs: number | null; nextRetryAtMs: number | null;
      blockedReason: string | null;
    }>;

export type SnapbackOutboxHandle = SnapbackOutboxState & Readonly<{
  /** Request one safety-gated P2 drain cycle. */
  drainNow(): Promise<OutboxReplayOutcome>;
  /** @deprecated Use drainNow(). */
  replay(): Promise<OutboxReplayOutcome>;
  mutationStatus(clientMutationId: string): Promise<MutationDisposition>;
  strandedMutations(): Promise<readonly StrandedMutation[]>;
  discardStrandedMutations(
    clientMutationIds: readonly string[],
  ): Promise<StrandedMutationDiscardOutcome>;
  reRecordStrandedMutation(
    clientMutationId: string,
    options?: Readonly<Record<string, unknown>>,
  ): Promise<string>;
  quarantinedMutations(): Promise<readonly QuarantinedMutationTombstone[]>;
  reenterQuarantinedMutations(): Promise<QuarantinedMutationReentryOutcome>;
  acknowledgeResultGoneMutations(
    clientMutationIds: readonly string[],
  ): Promise<ResultGoneAcknowledgementOutcome>;
}>;

export function useSnapbackOutbox(): SnapbackOutboxHandle;

export interface SnapbackOutboxObserver {
  snapshot(): SnapbackOutboxState;
  drainNow(): Promise<OutboxReplayOutcome>;
  /** @deprecated Use drainNow(). */
  replay(): Promise<OutboxReplayOutcome>;
  mutationStatus: SnapbackOutboxHandle['mutationStatus'];
  strandedMutations: SnapbackOutboxHandle['strandedMutations'];
  discardStrandedMutations: SnapbackOutboxHandle['discardStrandedMutations'];
  reRecordStrandedMutation: SnapbackOutboxHandle['reRecordStrandedMutation'];
  quarantinedMutations: SnapbackOutboxHandle['quarantinedMutations'];
  reenterQuarantinedMutations: SnapbackOutboxHandle['reenterQuarantinedMutations'];
  acknowledgeResultGoneMutations: SnapbackOutboxHandle['acknowledgeResultGoneMutations'];
  dispose(): void;
}
export function observeSnapbackOutbox(
  provider: SnapbackReactCoreProvider,
  listener: (state: SnapbackOutboxState) => void,
): SnapbackOutboxObserver;

/** Frozen projection of the bound client's bounded v2 diagnostics channel. */
export function useSnapbackDiagnostics(): SnapbackDiagnosticsSnapshot;

export interface SnapbackDiagnosticsObserver {
  snapshot(): SnapbackDiagnosticsSnapshot;
  dispose(): void;
}
export function observeSnapbackDiagnostics(
  provider: SnapbackReactCoreProvider,
  listener: (snapshot: SnapbackDiagnosticsSnapshot) => void,
): SnapbackDiagnosticsObserver;

export function useEphemeralRepublisher(
  reference: string,
  callback: (context: Readonly<{
    collection: string;
    publish(value: unknown, options?: Readonly<Record<string, unknown>>): Promise<unknown>;
  }>) => unknown,
): void;

export interface SnapbackQueryGroupObserver<Entries extends QueryEntryMap> {
  update<const Next extends QueryEntryMap>(entries: Next): void;
  snapshot(): QueryGroupState<Entries>;
  dispose(): void;
}
export interface SnapbackOptimisticCreateObserver<Args, Result, Selected> {
  snapshot(): QueryState<Selected>;
  create(args: Args): Promise<SnapbackMutationDispatchOutcome<Result>>;
  dispose(): void;
}
export interface SnapbackPresenceObserver<Value, Scope> {
  update(options: Readonly<{
    scope: Scope;
    value?: Value | typeof skip;
    ttlMs?: number;
  }>): void;
  snapshot(): PresenceState<Value>;
  publish(value: Value, options?: { readonly ttlMs?: number }): Promise<void>;
  delete(): Promise<void>;
  dispose(): Promise<void>;
}
export function observeSnapbackPresence<
  Ref extends ConnectionEphemeralCollectionReference,
>(
  provider: SnapbackReactCoreProvider,
  reference: Ref,
  options: Readonly<{
    scope: EphemeralScope<Ref>;
    value?: EphemeralValue<Ref> | typeof skip;
    ttlMs?: number;
  }>,
  listener: (state: PresenceState<EphemeralValue<Ref>>) => void,
): SnapbackPresenceObserver<EphemeralValue<Ref>, EphemeralScope<Ref>>;
export function observeSnapbackQueries<const Entries extends QueryEntryMap>(
  provider: SnapbackReactCoreProvider,
  entries: Entries,
  listener: (state: QueryGroupState<Entries>) => void,
): SnapbackQueryGroupObserver<Entries>;
export function observeSnapbackQueries<
  const Group extends PreparedReactQueryGroup,
>(
  provider: SnapbackReactCoreProvider,
  group: Group,
  listener: (
    state: QueryGroupState<QueryGroupEntries<Group['reference']> & QueryEntryMap>,
  ) => void,
): SnapbackQueryGroupObserver<QueryGroupEntries<Group['reference']> & QueryEntryMap>;
export function observeSnapbackOptimisticCreate<
  Ref extends MutationReference,
  Q extends QueryReference,
  Selected = readonly OptimisticCreateEntity<OptimisticCreateQueryRow<Q>>[],
>(
  provider: SnapbackReactCoreProvider,
  reference: Ref,
  options: Readonly<{
    query: Q;
    args: FunctionArgs<Q>;
    select?: (entities: readonly OptimisticCreateEntity<OptimisticCreateQueryRow<Q>>[]) => Selected;
  }>,
  listener: (state: QueryState<Selected>) => void,
): SnapbackOptimisticCreateObserver<FunctionArgs<Ref>, FunctionResult<Ref>, Selected>;
export function invokeSnapbackMutation<
  Ref extends MutationReference,
  Q extends QueryReference = never,
>(
  provider: SnapbackReactCoreProvider,
  reference: Ref,
  args: FunctionArgs<Ref>,
  options: SnapbackOptimisticMutationOptions<Ref, Q> & Readonly<{ queue: false }>,
): Promise<FunctionResult<Ref>>;
export function invokeSnapbackMutation<
  Ref extends MutationReference,
  Q extends QueryReference = never,
>(
  provider: SnapbackReactProvider,
  reference: Ref,
  args: FunctionArgs<Ref>,
  options?: SnapbackOptimisticMutationOptions<Ref, Q> & Readonly<{ queue?: undefined }>,
): Promise<SnapbackMutationDispatchOutcome<FunctionResult<Ref>>>;
export function invokeSnapbackCommand<Command extends CommandRef>(
  provider: SnapbackReactProvider,
  reference: Command,
  args: CommandArgs<Command>,
): ProjectedCommandTask<Command>;

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

// --- Assets (LLP 0044 §Client upload surface) ------------------------------

export type AssetUploadHookStatus =
  | 'idle'
  | 'blanked'
  | 'creating'
  | 'uploading'
  | 'paused'
  | 'finalizing'
  | 'ready'
  | 'rejected'
  | 'cancelled'
  | 'failed';

export interface AssetUrlState extends AssetIssuedUrlSnapshot {
  readonly diagnostic: AssetDiagnostic | null;
  readonly refresh: () => Promise<void>;
}

export interface AssetUrlEmptyState {
  readonly url: null;
  readonly status: 'empty';
  readonly diagnostic: null;
  readonly expiresAt: null;
  readonly rendition: null;
  readonly refresh: () => Promise<void>;
}

export type AssetUrlHookState = AssetUrlState | AssetUrlEmptyState;

export function useSnapbackAssetUrl(
  assetIdOrNull: string | null | undefined,
  options?: AssetSignedUrlOptions,
): AssetUrlState;
export function useSnapbackAssetUrl(
  assetId: null,
  options?: AssetSignedUrlOptions,
): AssetUrlEmptyState;
export function useSnapbackAssetUrl(
  assetId: string | null,
  options?: AssetSignedUrlOptions,
): AssetUrlHookState;

export type MediaHookState<K extends MediaKind = MediaKind> = MediaState<K> & Readonly<{
  refresh: () => Promise<void>;
}>;

export function useSnapbackMedia<K extends MediaKind>(
  mediaRefOrNull: MediaRef<K> | null | undefined,
  options?: AssetSignedUrlOptions,
): MediaHookState<K>;

export function useSnapbackMediaCollection<K extends MediaKind>(
  items: readonly MediaCollectionItem<K>[],
  options?: AssetSignedUrlOptions,
): MediaCollectionState<K>;

export type AssetUploadHookState = Readonly<
  Omit<AssetTaskSnapshot, 'status' | 'integrityBasis'> & {
    readonly status: AssetUploadHookStatus;
    readonly integrityBasis: AssetTaskSnapshot['integrityBasis'] | null;
  }
>;

export interface AssetUploadHook {
  readonly state: AssetUploadHookState;
  start(
    file: AssetFileLike,
    options?: Readonly<{
      args?: Record<string, unknown>;
      userId?: string | null;
      declaredFilename?: string | null;
      declaredContentType?: string | null;
      previewUrl?: string | null;
    }>,
  ): AssetUploadTask;
  resumePersisted(options: {
    assetId: string;
    file: AssetFileLike;
    userId?: string | null;
  }): AssetUploadTask | null;
  pause(): void;
  resume(): void;
  cancel(options?: { discardAsset?: boolean }): Promise<AssetTaskSnapshot>;
  retry(): Promise<AssetUploadTask>;
}

export function useSnapbackAssetUpload(options: Readonly<{
  upload: { artifactKind: 'assetUploadReference'; name: string } | string;
}>): AssetUploadHook;

export type AssetImagePhase = 'empty' | 'preview' | 'placeholder' | 'rendition';
export type AssetImageDelivery = 'pending' | 'public' | 'strict';

export interface AssetImageState {
  readonly phase: AssetImagePhase;
  readonly src: string | null;
  readonly strictSrc: string | null;
  readonly delivery: AssetImageDelivery | null;
  readonly aspectRatio: number | null;
  readonly placeholderSrc: string | null;
  readonly record: Record<string, unknown> | null;
}

export function useSnapbackAssetImage(options?: Readonly<{
  assetId?: string | null;
  placeholder?: string | null;
  previewUrl?: string | null;
  maxWidth?: number;
  userId?: string | null;
}>): AssetImageState;

export function SnapbackAssetImage(props: Readonly<{
  assetId?: string | null;
  placeholder?: string | null;
  previewUrl?: string | null;
  maxWidth?: number;
  userId?: string | null;
  alt?: string;
  [key: string]: unknown;
}>): any;

export function thumbHashToRGBA(hash: Uint8Array): {
  w: number;
  h: number;
  rgba: Uint8Array;
};
export function thumbHashToApproximateAspectRatio(hash: Uint8Array): number;
export function rgbaToDataURL(w: number, h: number, rgba: Uint8Array): string;
export function thumbHashToDataURL(hash: Uint8Array): string;
export function placeholderToDataURL(value: string | Uint8Array): string;
