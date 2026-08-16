export interface Diagnostic {
  code: string;
  message?: string;
  severity?: string;
  details?: Record<string, unknown>;
  [key: string]: unknown;
}

export interface SnapbackError extends Error {
  code?: string;
  status?: number;
  diagnostic?: Diagnostic;
  receipt?: KitReceipt;
  outcome?: unknown;
}

export interface FunctionReference<Args = Record<string, unknown>> {
  name?: string;
  id?: string;
  args?: Args;
  [key: string]: unknown;
}

export type FunctionRef<Args = Record<string, unknown>> = string | FunctionReference<Args>;
export type ConnectionAxis = 'connecting' | 'live' | 'polling' | 'stale' | 'disconnected';

export interface QueryResponse<Row = Record<string, unknown>> {
  rows: Row[];
  version: number;
  [key: string]: unknown;
}

export interface MutationResponse<Result = unknown> {
  result: Result;
  version?: number;
  receipt?: KitReceipt;
  changes?: unknown[];
  [key: string]: unknown;
}

export interface ActionResponse<Result = unknown> {
  ok: boolean;
  result?: Result;
  diagnostic?: Diagnostic;
  [key: string]: unknown;
}

export interface KitReceipt {
  kind: string;
  [key: string]: unknown;
}

export interface EnsureAppInput {
  schema?: unknown;
  functions?: unknown;
  seed?: unknown;
}

export interface EnsureAppResult {
  profile?: string;
  schema?: string;
  functions?: string;
  seed?: string;
  [key: string]: unknown;
}

export interface CallOptions<Args = Record<string, unknown>> {
  args?: Args;
  userId?: string;
  readSet?: unknown[];
  authorityCapture?: unknown;
}

export interface MutateOptions<Args = Record<string, unknown>> extends CallOptions<Args> {
  correlation?: unknown;
  clientMutationId?: string | null;
  acknowledgedClientMutationIds?: string[];
  ctxLedger?: unknown;
  authorityDescriptor?: unknown;
}

export interface LiveQueryOptions<Row = Record<string, unknown>, Args = Record<string, unknown>>
  extends CallOptions<Args> {
  connectionId: string;
  transport?: 'poll' | 'stream';
  pollCadenceMs?: number;
  fallbackToPoll?: boolean;
  onUpdate?: ((rows: Row[]) => void) | null;
  onConnectionChange?: ((connection: ConnectionAxis, detail: { previous: ConnectionAxis; error?: unknown }) => void) | null;
  onSubscriptionEvent?: ((event: unknown) => void) | null;
  onAuthorizationBoundary?: ((boundary: unknown) => void) | null;
  onAuthorizationError?: ((error: SnapbackError) => void) | null;
  authorizationQueue?: unknown;
  authorizationNamespace?: unknown;
  correlation?: unknown;
  stream?: Record<string, unknown>;
}

export interface LiveQueryHandle<Row = Record<string, unknown>> {
  subscriptionId: string | null;
  version: number;
  rows: Row[];
  readonly connection: ConnectionAxis;
  readonly authorizationNamespace: unknown;
  authorizationDisposition: string;
  authorizationState(): unknown;
  poll(): Promise<Row[]>;
  pause(): void;
  resume(): Promise<void>;
  dispose(): void;
}

export interface EphemeralEntrySnapshot<Value = unknown> {
  key: string;
  value: Value;
  expiresAtMs: number;
  receivedAtMs: number;
  scopeEpoch: number;
  entryVersion: number;
}

export interface EphemeralPublishResult {
  entry_version: number;
  scope_epoch: number;
  key: string;
  [key: string]: unknown;
}

export interface EphemeralCollectionRef<Scope = Record<string, unknown>, Value = unknown> {
  artifactKind: 'ephemeralCollectionReference';
  name: string;
  readonly __scope?: Scope;
  readonly __value?: Value;
}

export interface EphemeralSubscribeOptions<Scope = Record<string, unknown>> {
  connectionId: string;
  scope?: Scope;
  userId?: string;
  permissions?: string[];
  transport?: 'stream' | 'poll';
  stream?: Record<string, unknown>;
}

export interface LiveStreamManager {
  isOpen(): boolean;
  waitUntilReady(options?: {
    timeoutMs?: number;
    revalidate?: boolean;
    signal?: AbortSignal;
  }): Promise<number>;
  onState(listener: (state: string, detail?: { wasOpen?: boolean }) => void): () => void;
}

export interface SnapbackClientOptions {
  adminToken?: string | null;
  devIdentityCapability?: string | null;
  bearerToken?: string | null;
  authClientProtocol?: number | null;
  authInvalidationProtocol?: number | null;
  authorityDescriptorProtocol?: number | null;
  authorizedLeaseProtocol?: number | null;
  authCoordinator?: unknown;
  agentAuthority?: AgentAuthorityFence | null;
  clientStoreId?: string;
  authCounterCeiling?: number;
}

export class SnapbackClient {
  constructor(baseUrl: string, options?: SnapbackClientOptions);
  readonly baseUrl: string;

  static auth(userId?: string, options?: { permissions?: string[] }): unknown;
  static roomPermission(prefix: string, scope: Record<string, unknown>): string;

  health(): Promise<{ ok: boolean; [key: string]: unknown }>;
  inspect(): Promise<Record<string, unknown>>;
  ensureApp(input?: EnsureAppInput): Promise<EnsureAppResult>;
  loadSchema(manifest: unknown): Promise<{ diagnostics?: Diagnostic[]; [key: string]: unknown }>;
  loadFunctions(manifest: unknown): Promise<unknown>;
  ensureEphemeralCollections(manifest: unknown): Promise<unknown>;
  reset(seed?: unknown): Promise<unknown>;
  seed(seed: unknown): Promise<unknown>;

  query<Row = Record<string, unknown>, Args = Record<string, unknown>>(
    ref: FunctionRef<Args>,
    options?: CallOptions<Args>,
  ): Promise<QueryResponse<Row>>;
  mutate<Result = unknown, Args = Record<string, unknown>>(
    ref: FunctionRef<Args>,
    options?: MutateOptions<Args>,
  ): Promise<MutationResponse<Result>>;
  action<Result = unknown, Args = Record<string, unknown>>(
    ref: FunctionRef<Args>,
    options?: CallOptions<Args>,
  ): Promise<ActionResponse<Result>>;
  liveQuery<Row = Record<string, unknown>, Args = Record<string, unknown>>(
    ref: FunctionRef<Args>,
    options: LiveQueryOptions<Row, Args>,
  ): Promise<LiveQueryHandle<Row>>;

  subscribeEphemeral<Scope, Value>(
    ref: EphemeralCollectionRef<Scope, Value>,
    options: EphemeralSubscribeOptions<Scope>,
  ): Promise<EphemeralOverlay<Value>>;
  subscribeEphemeral<Value = unknown>(
    ref: string,
    options: EphemeralSubscribeOptions,
  ): Promise<EphemeralOverlay<Value>>;
  liveStreamManager(connectionId: string, options?: Record<string, unknown>): LiveStreamManager;
  receipts(): KitReceipt[];
  onReceipt(listener: (receipt: KitReceipt) => void): () => void;
  authSession(options?: { force?: boolean }): Promise<Record<string, unknown> | null>;
  connectionGrant(connectionId: string): Promise<Record<string, unknown>>;
  disconnect(connectionId: string): Promise<unknown>;
}

export class EphemeralOverlay<Value = unknown> {
  readonly entries: Map<string, unknown>;
  readonly grantedConnectionId: string;
  readonly connectionId: string;
  publish(value: Value, options?: { ttlMs?: number | null }): Promise<EphemeralPublishResult>;
  onChange(listener: (result: string, overlay: EphemeralOverlay<Value>) => void): () => void;
  currentEntries(options?: { prune?: boolean }): EphemeralEntrySnapshot<Value>[];
  dispose(): void;
}

export class AgentAuthorityFence {}
export function createMemoryAgentAuthorityCustodyStorage(): unknown;
export function deriveServiceAuthorityInstanceId(...args: unknown[]): string;

export const LIVE_HEARTBEAT_INTERVAL_MS: number;
export const LIVE_FRESHNESS_BUDGET_MS: number;
export const LIVE_RECONNECT_BASE_DELAY_MS: number;
export const LIVE_RECONNECT_MAX_DELAY_MS: number;
export const DEFAULT_POLL_CADENCE_MS: number;
export const LIVE_DURABLE_KINDS: Readonly<Record<string, string>>;
export const LIVE_SOCKET_KINDS: Readonly<Record<string, string>>;
