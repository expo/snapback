// @ref LLP 0194#design — this published type-only module is the single
// declaration owner for the handler context surface; generated app APIs only
// instantiate and re-export it.

/** Rows keyed by their schema table name. */
export type HandlerRowMap = object;

/** Declared index-name unions keyed by schema table name. */
export type HandlerIndexMap<Rows extends HandlerRowMap> = {
  readonly [Table in keyof Rows]?: PropertyKey;
};

/** Closed unique-index key shapes keyed by table and unique index name. */
export type HandlerUniqueIndexKeyMap<Rows extends HandlerRowMap> = {
  readonly [Table in keyof Rows]?: Readonly<Record<PropertyKey, object>>;
};

/** Insert or patch value shapes keyed by admitted schema table name. */
export type HandlerWriteMap<Rows extends HandlerRowMap> = Partial<{
  readonly [Table in keyof Rows]: unknown;
}>;

/**
 * Operation-specific table admission. A table is admitted to an operation
 * exactly when it is a key of that operation's generated map.
 */
export interface HandlerTableAdmissionMaps<Rows extends HandlerRowMap> {
  readonly read: Partial<Record<keyof Rows, true>>;
  readonly insert: Partial<Record<keyof Rows, true>>;
  readonly patch: Partial<Record<keyof Rows, true>>;
  readonly delete: Partial<Record<keyof Rows, true>>;
}

/** One schema-derived type argument for every handler database surface. */
export interface HandlerSchema<
  Rows extends HandlerRowMap,
  Indexes extends HandlerIndexMap<Rows>,
  Inserts extends HandlerWriteMap<Rows>,
  Patches extends HandlerWriteMap<Rows>,
  Admissions extends HandlerTableAdmissionMaps<Rows>,
  UniqueIndexKeys extends HandlerUniqueIndexKeyMap<Rows> = HandlerUniqueIndexKeyMap<Rows>,
> {
  readonly rows: Rows;
  readonly indexes: Indexes;
  readonly uniqueIndexKeys: UniqueIndexKeys;
  readonly inserts: Inserts;
  readonly patches: Patches;
  readonly admissions: Admissions;
}

export type AnyHandlerSchema = HandlerSchema<any, any, any, any, any, any>;
export type RowsOf<Schema extends AnyHandlerSchema> = Schema['rows'];
export type IndexesOf<Schema extends AnyHandlerSchema> = Schema['indexes'];
export type UniqueIndexKeysOf<Schema extends AnyHandlerSchema> = Schema['uniqueIndexKeys'];
export type InsertsOf<Schema extends AnyHandlerSchema> = Schema['inserts'];
export type PatchesOf<Schema extends AnyHandlerSchema> = Schema['patches'];
export type AdmissionsOf<Schema extends AnyHandlerSchema> = Schema['admissions'];
export type AdmittedTable<
  Schema extends AnyHandlerSchema,
  Operation extends keyof AdmissionsOf<Schema>,
> = Extract<keyof AdmissionsOf<Schema>[Operation], keyof RowsOf<Schema> & string>;

export type ReadableTable<Schema extends AnyHandlerSchema> = AdmittedTable<Schema, 'read'>;
export type InsertableTable<Schema extends AnyHandlerSchema> = Extract<
  AdmittedTable<Schema, 'insert'>,
  keyof InsertsOf<Schema> & string
>;
export type PatchableTable<Schema extends AnyHandlerSchema> = Extract<
  AdmittedTable<Schema, 'patch'>,
  keyof PatchesOf<Schema> & string
>;
export type DeletableTable<Schema extends AnyHandlerSchema> = AdmittedTable<Schema, 'delete'>;

/** The schema-derived row returned for one admitted table. */
export type HandlerRow<
  Schema extends AnyHandlerSchema,
  Table extends ReadableTable<Schema>,
> = RowsOf<Schema>[Table];

/** The opaque row id carried by the generated row's `_id` field. */
export type HandlerRowId<
  Schema extends AnyHandlerSchema,
  Table extends keyof RowsOf<Schema> & string,
> = RowsOf<Schema>[Table] extends { readonly _id: infer Id } ? Id : never;

/**
 * Immutable portable query builder. Every chaining call returns the same
 * table-specialized surface; `collect` and `first` execute it.
 */
export interface QueryBuilder<
  Schema extends AnyHandlerSchema,
  Table extends ReadableTable<Schema>,
> {
  withIndex(index: IndexesOf<Schema>[Table]): QueryBuilder<Schema, Table>;
  eq<Field extends keyof HandlerRow<Schema, Table> & string>(
    field: Field,
    value: HandlerRow<Schema, Table>[Field],
  ): QueryBuilder<Schema, Table>;
  in<Field extends keyof HandlerRow<Schema, Table> & string>(
    field: Field,
    values: ReadonlyArray<HandlerRow<Schema, Table>[Field]>,
  ): QueryBuilder<Schema, Table>;
  lt<Field extends keyof HandlerRow<Schema, Table> & string>(
    field: Field,
    value: HandlerRow<Schema, Table>[Field],
  ): QueryBuilder<Schema, Table>;
  lte<Field extends keyof HandlerRow<Schema, Table> & string>(
    field: Field,
    value: HandlerRow<Schema, Table>[Field],
  ): QueryBuilder<Schema, Table>;
  gt<Field extends keyof HandlerRow<Schema, Table> & string>(
    field: Field,
    value: HandlerRow<Schema, Table>[Field],
  ): QueryBuilder<Schema, Table>;
  gte<Field extends keyof HandlerRow<Schema, Table> & string>(
    field: Field,
    value: HandlerRow<Schema, Table>[Field],
  ): QueryBuilder<Schema, Table>;
  order<Field extends keyof HandlerRow<Schema, Table> & string>(
    field: Field,
    direction?: 'asc' | 'desc' | 'Asc' | 'Desc',
  ): QueryBuilder<Schema, Table>;
  take(limit: number): QueryBuilder<Schema, Table>;
  collect(): Promise<Array<HandlerRow<Schema, Table>>>;
  first(): Promise<HandlerRow<Schema, Table> | null>;
}

/** Read-only database operations under one handler authority mode. */
export interface ReadDatabaseAuthority<Schema extends AnyHandlerSchema> {
  get<Table extends ReadableTable<Schema>>(
    table: Table,
    id: HandlerRowId<Schema, Table>,
  ): Promise<HandlerRow<Schema, Table> | null>;
  getMany<Table extends ReadableTable<Schema>>(
    table: Table,
    ids: ReadonlyArray<HandlerRowId<Schema, Table>>,
  ): Promise<Array<HandlerRow<Schema, Table> | null>>;
  uniqueMany<
    Table extends ReadableTable<Schema>,
    Index extends keyof UniqueIndexKeysOf<Schema>[Table] & string,
  >(
    table: Table,
    index: Index,
    keys: ReadonlyArray<UniqueIndexKeysOf<Schema>[Table][Index]>,
  ): Promise<Array<HandlerRow<Schema, Table> | null>>;
  query<Table extends ReadableTable<Schema>>(table: Table): QueryBuilder<Schema, Table>;
}

/**
 * Read-only database authority available to query handlers. Ordinary methods
 * enforce table visibility; `elevated` is the explicit trusted-handler bypass.
 */
export interface QueryDatabase<Schema extends AnyHandlerSchema> {
  get<Table extends ReadableTable<Schema>>(
    table: Table,
    id: HandlerRowId<Schema, Table>,
  ): Promise<HandlerRow<Schema, Table> | null>;
  getMany<Table extends ReadableTable<Schema>>(
    table: Table,
    ids: ReadonlyArray<HandlerRowId<Schema, Table>>,
  ): Promise<Array<HandlerRow<Schema, Table> | null>>;
  uniqueMany<
    Table extends ReadableTable<Schema>,
    Index extends keyof UniqueIndexKeysOf<Schema>[Table] & string,
  >(
    table: Table,
    index: Index,
    keys: ReadonlyArray<UniqueIndexKeysOf<Schema>[Table][Index]>,
  ): Promise<Array<HandlerRow<Schema, Table> | null>>;
  query<Table extends ReadableTable<Schema>>(table: Table): QueryBuilder<Schema, Table>;
  readonly elevated: ReadDatabaseAuthority<Schema>;
}

/** Read-write database authority available only to mutation handlers. */
export interface MutationDatabase<Schema extends AnyHandlerSchema>
  extends QueryDatabase<Schema> {
  insert<Table extends InsertableTable<Schema>>(
    table: Table,
    values: InsertsOf<Schema>[Table],
  ): Promise<HandlerRowId<Schema, Table>>;
  patch<Table extends PatchableTable<Schema>>(
    table: Table,
    id: HandlerRowId<Schema, Table>,
    values: PatchesOf<Schema>[Table],
  ): Promise<unknown>;
  delete<Table extends DeletableTable<Schema>>(
    table: Table,
    id: HandlerRowId<Schema, Table>,
  ): Promise<unknown>;
}

export interface AnonymousAuthContext {
  readonly userId: null;
  readonly sessionId: null;
  readonly isAuthenticated: false;
}

export interface AuthenticatedAuthContext<Principal extends string = string> {
  readonly userId: Principal;
  readonly sessionId: string | null;
  readonly isAuthenticated: true;
  readonly provider?: string;
  readonly roles: readonly string[];
  readonly kind: 'human' | 'agent';
  readonly actor?: {
    readonly userId: Principal;
    readonly kind: 'agent';
    readonly grantId: string;
  };
  readonly actorKind?: 'asset-callbacks';
}

export type AuthContext<Principal extends string = string> =
  | AnonymousAuthContext
  | AuthenticatedAuthContext<Principal>;

/** Deterministic handler invocation time and id allocation. */
export interface RuntimeContext {
  now(): number;
  id(): string;
}

/** Mutation replay identity projected from the admitted request. */
export interface MutationSettlement {
  readonly clientMutationId: string | null;
  readonly settlementId: string | null;
}

export interface MutationIdentityContext {
  settlement(): MutationSettlement;
}

/** Transactional asset attachment; concrete generated APIs narrow its values. */
export interface AssetsContext<AssetId = string, Options = unknown, Attached = any> {
  attach(assetId: AssetId, options?: Options): Promise<Attached>;
  grant(
    assetId: AssetId,
    principal: string,
    options?: Readonly<{ state?: 'pending' | 'active' }>,
  ): Promise<Readonly<{ grantId: string }>>;
  activate(grantId: string): Promise<void>;
  revoke(grantId: string): Promise<void>;
}

/** Transactional durable-job enqueue available to mutation handlers. */
export interface JobsContext {
  enqueue(
    name: string,
    args: Readonly<Record<string, unknown>>,
    options?: Readonly<Record<string, unknown>>,
  ): Promise<unknown>;
}

/** Scoped transactional counter allocation available to declared mutations. */
export interface SequenceContext<Counter extends string = string, ScopeId = string> {
  allocate(counter: Counter, scopeId: ScopeId): Promise<number>;
}

/** Shared query-handler context with read-only database authority. */
export interface QueryContext<
  Schema extends AnyHandlerSchema,
  Auth extends AuthContext = AuthContext,
  Permissions = Record<string, never>,
  Assets = unknown,
  Runtime extends RuntimeContext = RuntimeContext,
> {
  readonly db: QueryDatabase<Schema>;
  readonly permissions: Permissions;
  readonly auth: Auth;
  readonly runtime: Runtime;
  readonly assets: Assets;
  isDirectHuman(): boolean;
  refuse(code: string, details?: unknown): never;
}

/** Shared mutation-handler context with the write-capability additions. */
export interface MutationContext<
  Schema extends AnyHandlerSchema,
  Auth extends AuthContext = AuthContext,
  Permissions = Record<string, never>,
  Assets = AssetsContext,
  Runtime extends RuntimeContext = RuntimeContext,
  Membership = Record<string, never>,
  Jobs extends JobsContext = JobsContext,
  Sequence extends SequenceContext = SequenceContext,
  Mutation extends MutationIdentityContext = MutationIdentityContext,
> extends QueryContext<Schema, Auth, Permissions, Assets, Runtime> {
  readonly db: MutationDatabase<Schema>;
  readonly membership: Membership;
  readonly jobs: Jobs;
  readonly sequence: Sequence;
  readonly mutation: Mutation;
}

export interface SecretHandle {
  expose(): string;
  asBearer(): string;
  toString(): string;
  toJSON(): string;
}

export interface SecretsContext<Handle = SecretHandle> {
  get(name: string): Handle;
  rotating(name: string): Handle;
}

export interface StreamAttemptContext {
  start(clientKey: string): Promise<unknown>;
  settle(attemptToken: string, cause: unknown): Promise<unknown>;
}

export interface ActionContextBase<
  Auth extends AuthContext,
  Runtime extends RuntimeContext,
  Assets,
  Secrets,
  Run,
> {
  readonly auth: Auth;
  readonly runtime: Runtime;
  readonly assets: Assets;
  readonly secrets: Secrets;
  readonly run: Run;
  readonly cron: Run;
  readonly streamAttempt: StreamAttemptContext;
  isDirectHuman(): boolean;
  runMutation(name: string, args: Readonly<Record<string, unknown>>): Promise<unknown>;
  fetch(request: Readonly<Record<string, unknown>>): Promise<any>;
  fetchStream(request: Readonly<Record<string, unknown>>): Promise<any>;
  refuse(code: string, details?: unknown): never;
}

/** Advisory, fixed-budget connected-client facts available to actions. */
export interface RealtimeContext {
  hasFreshClient(request: Readonly<{ principalId: string }>): Promise<boolean>;
}

/** Action handler context. `push` exists in types only when codegen admits it. */
export type ActionContext<
  Auth extends AuthContext = AuthContext,
  Runtime extends RuntimeContext = RuntimeContext,
  Assets = unknown,
  Secrets = SecretsContext,
  Run = unknown,
  Push = never,
  Realtime = never,
> = ActionContextBase<Auth, Runtime, Assets, Secrets, Run>
  & ([Push] extends [never] ? object : { readonly push: Push })
  & ([Realtime] extends [never] ? object : { readonly realtime: Realtime });

/** Generic handler function shape instantiated by each generated API. */
export type Handler<Context, Args, Result> = (
  ctx: Context,
  args: Args,
) => Result | Promise<Result>;
