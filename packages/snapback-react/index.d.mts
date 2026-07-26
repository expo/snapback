import type {
  ExternalConnection,
  ExternalQueryStore,
  ExternalStoreSnapshot,
} from '@snapback/client/external-store';

export interface SnapbackFunctionReference<
  Name extends string = string,
  Kind extends 'Query' | 'Mutation' | 'LiveQuery' | 'Action' = 'Query' | 'Mutation' | 'LiveQuery' | 'Action',
> {
  readonly artifactKind: 'functionReference';
  readonly id: string;
  readonly name: Name;
  readonly kind: Kind;
}

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
    mutation: string | SnapbackFunctionReference<string, 'Mutation'>,
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
export function useExternalQueryStore<Row = unknown>(store: ExternalQueryStore<Row>): ExternalStoreSnapshot<Row>;
export function useSnapbackQuery<Row = unknown>(options: {
  provider: SnapbackReactProvider;
  name?: string;
  query?: SnapbackFunctionReference<string, 'Query' | 'LiveQuery'>;
  args?: Record<string, unknown>;
  userId?: string;
  authority?: string;
  initialRows?: readonly Row[];
  protocol?: 'snapback.external-store.v1';
}): SnapbackQueryResult<Row>;
