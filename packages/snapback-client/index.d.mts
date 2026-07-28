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
> {
  readonly artifactKind: 'ephemeralCollectionReference';
  readonly name: Name;
  readonly __scope?: Scope;
  readonly __value?: Value;
}

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

export interface MutationOutput<Result> {
  readonly version: number;
  readonly changed_count: number;
  readonly result: Result;
  readonly ctx_ledger?: unknown;
  readonly receipt: Readonly<Record<string, unknown>>;
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
export interface SearchMatchRangeV1 {
  readonly start: number;
  readonly end: number;
}
export interface SearchHighlightV1 {
  readonly field: string;
  readonly text: string;
  readonly matches: readonly SearchMatchRangeV1[];
}
export interface SearchItemV1 {
  readonly rowId: string;
  readonly score: number;
  readonly fields: Readonly<Record<string, unknown>>;
  readonly highlights: readonly SearchHighlightV1[];
}
export interface SearchPageV1 {
  readonly items: readonly SearchItemV1[];
  readonly cursor: string | null;
  readonly hasMore: boolean;
}

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
  readonly functionCatalogDigest: string;
  readonly capabilityDigest: string;
  readonly references: Readonly<Record<string, SnapbackFunctionReference>>;
}

export interface EphemeralEntry<Value> {
  readonly key: string;
  readonly value: Value;
  readonly expiresAtMs: number;
  readonly receivedAtMs: number;
  readonly scopeEpoch: number;
  readonly entryVersion: number;
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
export declare function newSeedOperationIdV1(nowMs?: number): string;

type FunctionRef<
  Kind extends SnapbackFunctionKind,
  Args = unknown,
  Result = unknown,
> = string | SnapbackFunctionReference<string, Kind, Args, Result>;
type NamedReference = string;

export class SnapbackClient {
  constructor(baseUrl: string, options?: SnapbackClientOptions);
  health(): Promise<unknown>;
  inspect(): Promise<unknown>;
  prepareReactBinding(options: {
    readonly generatedManifest:
      | Readonly<Record<string, unknown>>
      | {
          readonly functions: Readonly<Record<string, unknown>>;
          readonly capabilityManifest?: Readonly<Record<string, unknown>>;
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
  ): Promise<unknown>;
  previewVersionedSeed(
    artifact: SeedArtifactV1 | null,
    options?: {
      readonly operation?: 'install' | 'resetInstall' | 'clear';
      readonly requestedMode?: AuthMode;
      readonly expectedDataVersionStream?: ExpectedDataVersionStreamV1;
    },
  ): Promise<unknown>;
  resetInstallVersionedSeed(
    artifact: SeedArtifactV1,
    options: {
      readonly operationId?: string;
      readonly requestedMode?: AuthMode;
      readonly expectedDataVersionStream: ExpectedDataVersionStreamV1;
    },
  ): Promise<unknown>;
  clearVersionedSeed(options: {
    readonly operationId?: string;
    readonly requestedMode?: AuthMode;
    readonly expectedDataVersionStream: ExpectedDataVersionStreamV1;
  }): Promise<unknown>;
  query<Ref extends FunctionRef<'Query' | 'LiveQuery'>>(
    ref: Ref,
    options?: { readonly args?: FunctionArgs<Ref>; readonly userId?: string },
  ): Promise<QueryOutput<FunctionResult<Ref>>>;
  query<Result = unknown>(
    ref: NamedReference,
    options?: { readonly args?: Record<string, unknown>; readonly userId?: string },
  ): Promise<QueryOutput<Result>>;
  search(
    ref: FunctionRef<'Query' | 'LiveQuery'>,
    options: {
      readonly query: SearchQueryAstV1;
      readonly limit?: number;
      readonly after?: string | null;
      readonly userId?: string;
    },
  ): Promise<SearchPageV1>;
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
      readonly transport?: 'poll' | 'stream';
      readonly pollCadenceMs?: number;
      readonly fallbackToPoll?: boolean;
      readonly onUpdate?: (rows: FunctionResult<Ref>) => void;
      readonly onConnectionChange?: (
        connection: LiveQueryHandle<FunctionResult<Ref>>['connection'],
        detail?: { readonly error?: unknown },
      ) => void;
    },
  ): Promise<LiveQueryHandle<FunctionResult<Ref>>>;
  liveQuery<Row = unknown>(
    ref: NamedReference,
    options: {
      readonly connectionId: string;
      readonly args?: Record<string, unknown>;
      readonly userId?: string;
      readonly transport?: 'poll' | 'stream';
      readonly pollCadenceMs?: number;
      readonly fallbackToPoll?: boolean;
      readonly onUpdate?: (rows: Row[]) => void;
      readonly onConnectionChange?: (
        connection: LiveQueryHandle<Row[]>['connection'],
        detail?: { readonly error?: unknown },
      ) => void;
    },
  ): Promise<LiveQueryHandle<Row[]>>;
  startLiveQuery<Ref extends FunctionRef<'LiveQuery'>>(
    ref: Ref,
    options: {
      readonly connectionId: string;
      readonly args?: FunctionArgs<Ref>;
      readonly userId?: string;
      readonly transport?: 'poll' | 'stream';
      readonly pollCadenceMs?: number;
      readonly fallbackToPoll?: boolean;
      readonly supersedes?: StartedLiveQueryHandle<FunctionResult<Ref>> | null;
      readonly onUpdate?: (rows: FunctionResult<Ref>) => void;
      readonly onConnectionChange?: (
        connection: LiveQueryHandle<FunctionResult<Ref>>['connection'],
        detail?: { readonly error?: unknown },
      ) => void;
    },
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
      publish(
        value: EphemeralValue<Ref>,
        options?: Readonly<Record<string, unknown>>,
      ): Promise<unknown>;
    }>) => void | EphemeralValue<Ref> | Promise<void | EphemeralValue<Ref>>,
  ): Readonly<{ dispose(): void }>;
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

export class AgentAuthorityFence {
  constructor(...args: unknown[]);
}
export function createMemoryAgentAuthorityCustodyStorage(...args: unknown[]): unknown;
export function deriveServiceAuthorityInstanceId(...args: unknown[]): string;
