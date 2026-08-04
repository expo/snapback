import type {
  FunctionArgs,
  FunctionResult,
  EphemeralScope,
  EphemeralValue,
  LiveQueryRetention,
  OutboxReplayOutcome,
  PreparedReactQueryGroup,
  PreparedReactBinding,
  QueryGroupEntries,
  SnapbackEphemeralReference,
  SnapbackFunctionReference,
} from '@expo/snapback-client';

export type SnapbackDiagnostic = Readonly<{
  schemaVersion: 'snapback.client-diagnostic.v1';
  code: string;
  severity: 'error';
  message: string;
  details: Readonly<Record<string, unknown>>;
}>;

export type SnapbackConnection =
  | 'idle'
  | 'connecting'
  | 'live'
  | 'polling'
  | 'stale'
  | 'disconnected'
  | 'closed'
  | 'error';

/** Channel B freshness axis (LLP 0090 D1 / LLP 0114): 'retained' rows come
 * from persistence/preload and are never presented as settled; 'current'
 * rows are authoritative; 'unknown' means no rows are held. */
export type SnapbackFreshness = 'unknown' | 'retained' | 'current';

/** Refuse-with-clarity retainability fact, surfaced from the headless
 * handle (LLP 0129 Phase 0); null until the subscription is classified. */
export type SnapbackRetention = LiveQueryRetention;

export type QueryState<Result> =
  | Readonly<{ status: 'pending'; data: undefined; error: null; connection: SnapbackConnection; freshness: 'unknown'; retention: SnapbackRetention | null }>
  | Readonly<{ status: 'ready'; data: Result; error: null; connection: SnapbackConnection; freshness: 'current'; retention: SnapbackRetention | null }>
  | Readonly<{ status: 'refreshing'; data: Result; error: null; connection: SnapbackConnection; freshness: 'retained' | 'current'; retention: SnapbackRetention | null }>
  | Readonly<{ status: 'error'; data: undefined; error: SnapbackDiagnostic; connection: SnapbackConnection; freshness: 'unknown'; retention: SnapbackRetention | null }>
  | Readonly<{ status: 'skipped'; data: undefined; error: null; connection: SnapbackConnection; freshness: 'unknown'; retention: null }>;

export type QueryReference<
  Name extends string = string,
  Args = Record<string, unknown>,
  Result extends ReadonlyArray<unknown> = ReadonlyArray<unknown>,
> = SnapbackFunctionReference<Name, 'LiveQuery', Args, Result>;

export type MutationReference<
  Name extends string = string,
  Args = Record<string, unknown>,
  Result = unknown,
> = SnapbackFunctionReference<Name, 'Mutation', Args, Result>;

export type ConnectionEphemeralCollectionReference<
  Name extends string = string,
  Scope = Record<string, unknown>,
  Value = unknown,
> = SnapbackEphemeralReference<Name, Scope, Value, 'Connection'>;

export const skip: unique symbol;

export interface SnapbackReactProvider {
  readonly kind: 'snapback.react-provider.v1';
  readonly providerInstanceId: string;
  readonly binding: PreparedReactBinding;
  readonly assets: unknown | null;
  registerEphemeralRepublisher(
    reference: string,
    callback: (context: Readonly<{
      collection: string;
      publish(value: unknown, options?: Readonly<Record<string, unknown>>): Promise<unknown>;
    }>) => unknown,
  ): Readonly<{ dispose(): void }>;
  inspection(): Readonly<{
    providerInstanceId: string;
    terminal: boolean;
    custodyPaused: boolean;
    stores: number;
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
  }>;
  dispose(): Promise<void>;
}

export function createSnapbackReactProvider(
  binding: PreparedReactBinding,
  options?: {
    readonly connectionId?: string;
    readonly onDiagnostic?: (diagnostic: SnapbackDiagnostic) => void;
    readonly preparedGroup?: PreparedReactQueryGroup;
    /** Test/DI seam: a pre-built SnapbackAssetClient-compatible surface. */
    readonly assets?: unknown;
  },
): SnapbackReactProvider;

export function SnapbackProvider(props: Readonly<{
  binding?: PreparedReactBinding;
  provider?: SnapbackReactProvider;
  children?: any;
}>): any;

export function useSnapbackQuery<Ref extends QueryReference>(
  reference: Ref,
  args: FunctionArgs<Ref> | typeof skip,
): QueryState<FunctionResult<Ref>>;

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
  status: 'pending' | 'ready' | 'refreshing' | 'error';
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

export function useSnapbackMutation<
  Ref extends MutationReference,
  Q extends QueryReference = never,
>(
  reference: Ref,
  options?: Readonly<{
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
  }>,
): (args: FunctionArgs<Ref>) => Promise<FunctionResult<Ref>>;

export type SnapbackConnectionState = Readonly<{
  status: SnapbackConnection;
  diagnostic: SnapbackDiagnostic | null;
  activeSubscriptions: number;
}>;

export function useSnapbackConnection(): SnapbackConnectionState;

/** Projection of the headless client's queued-intent facts (LLP 0043 M2 /
 * LLP 0129 Phase 0): 'loading' until the first durable-store read lands. */
export type SnapbackOutboxState =
  | Readonly<{ status: 'loading'; supported: false; pending: 0; failed: 0; replaying: false }>
  | Readonly<{ status: 'ready'; supported: boolean; pending: number; failed: number; replaying: boolean }>;

export type SnapbackOutboxHandle = SnapbackOutboxState & Readonly<{
  /** Drain the durable outbox in sequence order (the client's single-flight
   * replayQueuedMutations; full-resync-before-replay stays client-owned). */
  replay(): Promise<OutboxReplayOutcome>;
}>;

export function useSnapbackOutbox(): SnapbackOutboxHandle;

export interface SnapbackOutboxObserver {
  snapshot(): SnapbackOutboxState;
  replay(): Promise<OutboxReplayOutcome>;
  dispose(): void;
}
export function observeSnapbackOutbox(
  provider: SnapbackReactProvider,
  listener: (state: SnapbackOutboxState) => void,
): SnapbackOutboxObserver;
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
  provider: SnapbackReactProvider,
  reference: Ref,
  options: Readonly<{
    scope: EphemeralScope<Ref>;
    value?: EphemeralValue<Ref> | typeof skip;
    ttlMs?: number;
  }>,
  listener: (state: PresenceState<EphemeralValue<Ref>>) => void,
): SnapbackPresenceObserver<EphemeralValue<Ref>, EphemeralScope<Ref>>;
export function observeSnapbackQueries<const Entries extends QueryEntryMap>(
  provider: SnapbackReactProvider,
  entries: Entries,
  listener: (state: QueryGroupState<Entries>) => void,
): SnapbackQueryGroupObserver<Entries>;
export function observeSnapbackQueries<
  const Group extends PreparedReactQueryGroup,
>(
  provider: SnapbackReactProvider,
  group: Group,
  listener: (
    state: QueryGroupState<QueryGroupEntries<Group['reference']> & QueryEntryMap>,
  ) => void,
): SnapbackQueryGroupObserver<QueryGroupEntries<Group['reference']> & QueryEntryMap>;
export function invokeSnapbackMutation<
  Ref extends MutationReference,
  Q extends QueryReference = never,
>(
  provider: SnapbackReactProvider,
  reference: Ref,
  args: FunctionArgs<Ref>,
  options?: Readonly<{
    optimistic?: Readonly<{
      query: Q;
      args: FunctionArgs<Q>;
      update(current: FunctionResult<Q>, mutationArgs: FunctionArgs<Ref>): FunctionResult<Q>;
      isAuthoritative?(current: FunctionResult<Q>, result: FunctionResult<Ref>): boolean;
    }>;
  }>,
): Promise<FunctionResult<Ref>>;

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

export interface AssetUploadHookState {
  readonly assetId: string | null;
  readonly assetRef: string | null;
  readonly attemptId: string | null;
  readonly attemptExpiresAtMs: number | null;
  readonly status: AssetUploadHookStatus;
  readonly diagnostic: { code?: string; message?: string } | null;
  readonly bytesTransferred: number;
  readonly totalBytes: number;
  readonly previewUrl: string | null;
  readonly integrityBasis: string | null;
}

export interface AssetUploadHook {
  readonly state: AssetUploadHookState;
  start(
    file: { size: number; slice(start: number, end?: number): unknown },
    options?: Readonly<{
      args?: Record<string, unknown>;
      userId?: string | null;
      declaredFilename?: string | null;
      declaredContentType?: string | null;
      previewUrl?: string | null;
    }>,
  ): unknown;
  resumePersisted(options: {
    assetId: string;
    file: { size: number; slice(start: number, end?: number): unknown };
    userId?: string | null;
  }): unknown;
  pause(): void;
  resume(): void;
  cancel(options?: { discardAsset?: boolean }): Promise<unknown>;
  retry(): Promise<unknown>;
}

export function useSnapbackAssetUpload(options: Readonly<{
  upload: { artifactKind: 'assetUploadReference'; name: string } | string;
}>): AssetUploadHook;

export type AssetImagePhase = 'empty' | 'preview' | 'placeholder' | 'rendition';

export interface AssetImageState {
  readonly phase: AssetImagePhase;
  readonly src: string | null;
  readonly aspectRatio: number | null;
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
