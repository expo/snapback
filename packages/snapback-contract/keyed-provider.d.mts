import type {
  SnapbackProviderDiagnosticReport,
} from './diagnostics.mjs';
import type {
  SnapbackArtifactIndex,
  SnapbackContractDataManifest,
} from './artifact-validation.mjs';

export type ContractConnectionState =
  | 'connecting'
  | 'live'
  | 'polling'
  | 'stale'
  | 'disconnected'
  | null;

export interface ContractSerializedError {
  name: string;
  message: string;
  code?: string;
  diagnostic?: unknown;
}

/** Cell states delivered to keyed query observers. */
export type ContractQueryCell =
  | { status: 'pending'; connection: ContractConnectionState }
  | {
      status: 'ready';
      value: unknown;
      rows: unknown;
      empty: boolean;
      connection: ContractConnectionState;
    }
  | {
      status: 'error';
      error: ContractSerializedError;
      previous?: unknown;
      rows?: unknown;
      connection: ContractConnectionState;
      diagnostic?: unknown;
    };

export interface ContractSubscriptionHandle {
  dispose(): void;
}

export type ContractEphemeralCell = {
  status: 'pending' | 'ready' | 'error';
  entries: unknown[];
  connection?: Exclude<ContractConnectionState, null>;
};

export type KeyedBoundaryEphemeralSource = (
  args: Record<string, unknown>,
  emit: (cell: ContractEphemeralCell) => void,
) => ContractSubscriptionHandle | (() => void) | void;

/** The transport provider consumed by Exact's keyed-query runtime. */
export interface KeyedSnapbackContractProviderTransport {
  readonly manifest: SnapbackContractDataManifest;
  partitionId(): string;
  subscribe(
    queryName: string,
    args: Record<string, unknown> | undefined,
    observer: (cell: ContractQueryCell) => void,
  ): ContractSubscriptionHandle;
  forceQueryState(
    queryName: string,
    state: unknown,
    options?: { scope?: unknown },
  ): ContractSubscriptionHandle;
  subscribeEphemeral?(
    name: string,
    args: Record<string, unknown>,
    observer: (cell: ContractEphemeralCell) => void,
  ): ContractSubscriptionHandle;
  mutate(
    mutationName: string,
    args?: Record<string, unknown>,
    correlation?: Readonly<Record<string, unknown>>,
  ): Promise<
    | { ok: true; value: unknown }
    | { ok: false; error: ContractSerializedError }
  >;
  onReceipt?(listener: (receipt: unknown) => void): () => void;
  receipts?(): unknown[];
}

export interface KeyedSnapbackContractProvider {
  readonly provider: KeyedSnapbackContractProviderTransport;
  readonly links: Readonly<
    Record<string, (args?: Record<string, unknown>) => unknown>
  >;
  readonly diagnostics: SnapbackProviderDiagnosticReport[];
  readonly userId: string | undefined;
  readonly disposed: boolean;
  readonly authorityPaused: boolean;
  /** Quiesce then resume under the new opaque partition. */
  rotateAuthority(next?: { userId?: string; authorityCapture?: unknown }): string;
  quiesceAuthority(): unknown;
  resumeAuthority(next?: { userId?: string; authorityCapture?: unknown }): string;
  dispose(): void;
}

/**
 * Create the transport provider consumed by Exact's keyed-query runtime.
 * `keyedQueries` is an allowlist (null admits every non-ephemeral manifest
 * query); legacy `{ name, args }` entries keep their args ignored.
 */
export function createKeyedSnapbackContractProvider(options: {
  runtime: {
    createProviderQueryHandle(
      provider: KeyedSnapbackContractProviderTransport,
      name: string,
      args: Record<string, unknown>,
    ): unknown;
    rotatePartition(provider: KeyedSnapbackContractProviderTransport): unknown;
    createProviderMutation?(
      provider: KeyedSnapbackContractProviderTransport,
      name: string,
    ): (args?: Record<string, unknown>) => unknown;
  };
  client: {
    liveQuery?(name: string, options: Record<string, unknown>): Promise<{
      rows?: unknown;
      connection?: ContractConnectionState;
      dispose?(): void;
    }>;
    query?(name: string, options: Record<string, unknown>): Promise<{ rows?: unknown }>;
    mutate(name: string, options: Record<string, unknown>): Promise<unknown>;
    onReceipt?(listener: (receipt: unknown) => void): () => void;
    receipts?(): unknown[];
  };
  manifest: SnapbackContractDataManifest;
  artifactIndex?: SnapbackArtifactIndex | null;
  schemaManifest?: Readonly<Record<string, unknown>> | null;
  functionManifest?: Readonly<Record<string, unknown>> | null;
  userId?: string;
  initialAuthorityCapture?: unknown;
  keyedQueries?: readonly (string | Readonly<{ name: string; args?: Record<string, unknown> }>)[] | null;
  livePush?: boolean;
  liveFallbackToPoll?: boolean;
  connectionId?: string | null;
  liveStreamOptions?: Record<string, unknown>;
  onConnectionChange?:
    | ((connection: ContractConnectionState, detail: Readonly<Record<string, unknown>>) => void)
    | null;
  onSubscriptionEvent?: ((event: Readonly<Record<string, unknown>>) => void) | null;
  ephemerals?: Readonly<Record<string, KeyedBoundaryEphemeralSource>> | null;
  onReceipt?: ((receipt: unknown) => void) | null;
  rootId?: string;
}): KeyedSnapbackContractProvider;
