import type {
  FunctionArgs,
  FunctionResult,
  PreparedReactBinding,
  SnapbackFunctionReference,
} from '@snapback/client';

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

export type QueryState<Result> =
  | Readonly<{ status: 'pending'; data: undefined; error: null; connection: SnapbackConnection }>
  | Readonly<{ status: 'ready'; data: Result; error: null; connection: SnapbackConnection }>
  | Readonly<{ status: 'refreshing'; data: Result; error: null; connection: SnapbackConnection }>
  | Readonly<{ status: 'error'; data: undefined; error: SnapbackDiagnostic; connection: SnapbackConnection }>
  | Readonly<{ status: 'skipped'; data: undefined; error: null; connection: SnapbackConnection }>;

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

export const skip: unique symbol;

export interface SnapbackReactProvider {
  readonly kind: 'snapback.react-provider.v1';
  readonly providerInstanceId: string;
  readonly binding: PreparedReactBinding;
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
    diagnostics: readonly SnapbackDiagnostic[];
  }>;
  dispose(): Promise<void>;
}

export function createSnapbackReactProvider(
  binding: PreparedReactBinding,
  options?: {
    readonly connectionId?: string;
    readonly onDiagnostic?: (diagnostic: SnapbackDiagnostic) => void;
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
}>;

export function useSnapbackQueries<const Entries extends QueryEntryMap>(
  entries: Entries,
): QueryGroupState<Entries>;

export function useSnapbackMutation<Ref extends MutationReference>(
  reference: Ref,
): (args: FunctionArgs<Ref>) => Promise<FunctionResult<Ref>>;

export type SnapbackConnectionState = Readonly<{
  status: SnapbackConnection;
  diagnostic: SnapbackDiagnostic | null;
  activeSubscriptions: number;
}>;

export function useSnapbackConnection(): SnapbackConnectionState;
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
export function observeSnapbackQueries<const Entries extends QueryEntryMap>(
  provider: SnapbackReactProvider,
  entries: Entries,
  listener: (state: QueryGroupState<Entries>) => void,
): SnapbackQueryGroupObserver<Entries>;
export function invokeSnapbackMutation<Ref extends MutationReference>(
  provider: SnapbackReactProvider,
  reference: Ref,
  args: FunctionArgs<Ref>,
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
