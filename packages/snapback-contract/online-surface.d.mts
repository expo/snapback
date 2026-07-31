import type { SnapbackProviderDiagnostic } from './diagnostics.mjs';
import type {
  SnapbackArtifactIndex,
  SnapbackContractDataManifest,
} from './artifact-validation.mjs';
import type { ContractConnectionState } from './keyed-provider.mjs';

export interface OnlineContractProvider {
  subscribe(
    name: string,
    args: Record<string, unknown> | undefined,
    observer: (cell: Record<string, unknown>) => void,
  ): { dispose(): void };
  readonly [key: string]: unknown;
}

export interface OnlineSnapbackContractSurface {
  readonly adapterVersion: 1;
  readonly capabilityClass: 'Online';
  readonly boundary: unknown;
  readonly provider: OnlineContractProvider;
  readonly links: Readonly<Record<string, (args?: Record<string, unknown>) => unknown>>;
  readonly diagnostics: SnapbackProviderDiagnostic[];
  readonly livePush: boolean;
  readonly liveQueries: readonly string[];
  readonly rootId: string;
  connection(name?: string): ContractConnectionState;
  connections(): Record<string, ContractConnectionState>;
  pendingCount(): number;
  flush(): Promise<unknown>;
  dispose(): void;
}

/**
 * Create a small server-authoritative Online surface over fixed boot scopes.
 * Use createKeyedSnapbackContractProvider for binding-time keyed identity and
 * the full root surface for coordinated authority or retained/offline work.
 */
export function createOnlineSnapbackContractSurface(options: {
  runtime: {
    createContractMockQueryBoundary(initialRows: Record<string, unknown>): unknown;
    createBoundaryContractDataProvider(
      manifest: SnapbackContractDataManifest,
      boundary: unknown,
      options: Record<string, unknown>,
    ): OnlineContractProvider;
    createProviderQueryHandle(
      provider: OnlineContractProvider,
      name: string,
      args: Record<string, unknown>,
    ): unknown;
  };
  client: {
    query(name: string, options: Record<string, unknown>): Promise<{ rows?: unknown[] }>;
    mutate(name: string, options: Record<string, unknown>): Promise<unknown>;
    liveQuery?(name: string, options: Record<string, unknown>): Promise<{
      rows?: unknown[];
      connection?: ContractConnectionState;
      dispose?(): void;
    }>;
    authorityFence?: unknown;
    authCoordinator?: unknown;
    agentAuthority?: unknown;
  };
  manifest: SnapbackContractDataManifest;
  artifactIndex?: SnapbackArtifactIndex | null;
  schemaManifest?: Readonly<Record<string, unknown>> | null;
  functionManifest?: Readonly<Record<string, unknown>> | null;
  userId?: string;
  liveQueries: readonly (string | Readonly<{ name: string; args?: Record<string, unknown> }>)[];
  requiredQueries?: readonly (string | Readonly<{ name: string }>)[] | null;
  livePush?: boolean;
  liveFallbackToPoll?: boolean;
  connectionId?: string | null;
  liveStreamOptions?: Record<string, unknown>;
  onConnectionChange?:
    | ((connection: ContractConnectionState, detail: Readonly<Record<string, unknown>>) => void)
    | null;
  onSubscriptionEvent?: ((event: Readonly<Record<string, unknown>>) => void) | null;
  rootId?: string;
}): Promise<OnlineSnapbackContractSurface>;
