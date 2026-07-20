import type {
  ExternalConnection,
  ExternalQueryStore,
  ExternalStoreSnapshot,
} from '@snapback/client/external-store';

export interface SnapbackReactProvider {
  readonly backend?: string;
  readonly name?: string;
  readonly externalStoreProtocol: 'snapback.external-store.v1';
  subscribe<Row>(
    name: string,
    args: Record<string, unknown>,
    userId: string | undefined,
    observer: (
      rows: Row[],
      connection: ExternalConnection,
      delivery?: { kind: 'authoritative' | 'connection' | 'error'; error?: unknown },
    ) => void,
  ): unknown | Promise<unknown>;
  mutate<Result>(name: string, args: Record<string, unknown>, userId: string | undefined): Promise<Result>;
}

export interface SnapbackQueryResult<Row = unknown> extends ExternalStoreSnapshot<Row> {
  readonly store: ExternalQueryStore<Row>;
  readonly mutate: <Result>(
    name: string,
    args: Record<string, unknown>,
    options?: {
      optimisticRows?: readonly Row[] | ((rows: readonly Row[]) => readonly Row[]);
      isAuthoritative?: (
        rows: readonly Row[],
        mutation: { id: string; status: 'pending' | 'confirmed'; result?: unknown },
      ) => boolean;
      id?: string;
    },
  ) => Promise<Result>;
}

export const SNAPBACK_EXTERNAL_STORE_PROTOCOL: 'snapback.external-store.v1';
export function useExternalQueryStore<Row = unknown>(store: ExternalQueryStore<Row>): ExternalStoreSnapshot<Row>;
export function useSnapbackQuery<Row = unknown>(options: {
  provider: SnapbackReactProvider;
  name: string;
  args?: Record<string, unknown>;
  userId?: string;
  authority?: string;
  initialRows?: readonly Row[];
  protocol?: 'snapback.external-store.v1';
}): SnapbackQueryResult<Row>;
