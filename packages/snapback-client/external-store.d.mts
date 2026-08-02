export type ExternalConnection = 'connecting' | 'live' | 'polling' | 'stale' | 'disconnected' | null;
export type ExternalStoreStatus = 'pending' | 'ready' | 'refreshing' | 'error';
export type ExternalStoreFreshness = 'unknown' | 'retained' | 'current';
export interface ExternalSettlementIdMapEntry {
  readonly speculative: string;
  readonly authoritative: string | null;
  readonly site: string;
  readonly occurrence: number;
  readonly disposition: 'mapped' | 'unmapped';
}
export type ExternalProviderDelivery =
  | { kind: 'authoritative' }
  | { kind: 'retained' }
  | { kind: 'connection' }
  | { kind: 'error'; error?: unknown };

export interface ExternalStoreSnapshot<Row = unknown> {
  readonly protocol: 'snapback.external-store.v1';
  readonly identity: string | null;
  readonly status: ExternalStoreStatus;
  readonly rows: readonly Row[];
  readonly connection: ExternalConnection;
  readonly error: Readonly<{ name: string; message: string; code?: string; diagnostic?: unknown }> | null;
  readonly freshness: ExternalStoreFreshness;
  readonly generation: number;
  readonly mutation: Readonly<{
    status: 'idle' | 'pending' | 'confirmed' | 'rejected';
    id: string | null;
    error: unknown;
    result?: unknown;
    idMap?: readonly Readonly<ExternalSettlementIdMapEntry>[] | null;
    pendingCount: number;
    attempts: readonly Readonly<{ id: string; status: 'pending' }>[];
    lastSettlement: Readonly<{
      status: 'confirmed' | 'rejected';
      id: string;
      error: unknown;
      result?: unknown;
      idMap?: readonly Readonly<ExternalSettlementIdMapEntry>[] | null;
    }> | null;
  }>;
}

export interface ExternalStoreController<Row = unknown> {
  pending(connection?: ExternalConnection, previous?: readonly Row[]): void;
  retained(rows: readonly Row[], connection?: ExternalConnection): void;
  ready(rows: readonly Row[], connection?: ExternalConnection): void;
  refreshing(rows?: readonly Row[], connection?: ExternalConnection): void;
  error(error: unknown, options?: { previous?: readonly Row[]; connection?: ExternalConnection }): void;
  connection(connection: ExternalConnection): void;
}

export interface ExternalQueryStore<Row = unknown> {
  readonly protocol: 'snapback.external-store.v1';
  readonly identity: string | null;
  subscribe(listener: () => void): () => void;
  getSnapshot(): ExternalStoreSnapshot<Row>;
  getServerSnapshot(): ExternalStoreSnapshot<Row>;
  whenStarted(): Promise<unknown>;
  runMutation<T>(call: () => Promise<T>, options?: {
    optimisticRows?: readonly Row[] | ((rows: readonly Row[]) => readonly Row[]);
    isAuthoritative?: (
      rows: readonly Row[],
      mutation: {
        id: string;
        status: 'pending' | 'confirmed';
        result?: unknown;
        idMap: readonly Readonly<ExternalSettlementIdMapEntry>[] | null;
      },
    ) => boolean;
    id?: string;
  }): Promise<T>;
  inspection(): Readonly<Record<string, unknown>>;
  close(): void;
}

export interface ExternalQueryStoreRegistry {
  get<Row = unknown>(options: {
    start(controller: ExternalStoreController<Row>): unknown | Promise<unknown>;
    identity: string;
    initialRows?: readonly Row[];
    initialConnection?: ExternalConnection;
    protocol?: string;
    provider?: string;
  }): ExternalQueryStore<Row>;
  inspection(): Readonly<{ closed: boolean; stores: number; identities: readonly (string | null)[] }>;
  close(): void;
}

export const SNAPBACK_EXTERNAL_STORE_PROTOCOL: 'snapback.external-store.v1';
export function assertExternalStoreCompatibility(options?: { expected?: string; actual?: string; provider?: string }): void;
export function externalStoreIdentity(options: { provider?: string; query: string; args?: Record<string, unknown>; authority?: string }): string;
export function createExternalQueryStore<Row = unknown>(options: {
  start(controller: ExternalStoreController<Row>): unknown | Promise<unknown>;
  identity?: string;
  initialRows?: readonly Row[];
  initialConnection?: ExternalConnection;
  protocol?: string;
  provider?: string;
}): ExternalQueryStore<Row>;
export function createExternalQueryStoreRegistry(): ExternalQueryStoreRegistry;

export class ExternalQueryScope {
  constructor(onChange?: (snapshot: Readonly<Record<string, unknown>>) => void);
  generation: number;
  renew(): number;
  watch(
    start: (observer: (rows: unknown[], connection: ExternalConnection, delivery?: ExternalProviderDelivery) => void) => Promise<unknown>,
    observer: (rows: unknown[], connection: ExternalConnection, delivery: ExternalProviderDelivery) => void,
  ): Promise<unknown>;
  close(): void;
  snapshot(): Readonly<Record<string, unknown>>;
}
