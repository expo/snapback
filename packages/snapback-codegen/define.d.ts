// Typed surface for the define.mjs authoring builder — the first-class
// authoring surface for the data-tier mutation IR (LLP 0051 D2).
//
// The runtime authority is define.mjs (executed by codegen); these types make
// the builder statically checkable from TS definition modules. Keep the two
// in sync — a form that exists in define.mjs but not here loses its static
// safety, and one that exists here but not there is a lie.

// ---------------------------------------------------------------------------
// Validators
// ---------------------------------------------------------------------------

export type FieldType =
  | 'String'
  | 'Boolean'
  | 'Integer'
  | 'Real'
  | 'Json'
  | 'Principal'
  | { readonly Id: { readonly table: string } };

export interface Validator<
  Value = unknown,
  Type extends FieldType = FieldType,
  Optional extends boolean = boolean,
> {
  readonly __validator: true;
  readonly fieldType: Type;
  readonly primitive: string;
  readonly optional: Optional;
  readonly fields?: Record<string, Validator>;
  readonly __value?: Value;
}

export type InferValidator<Input extends Validator> =
  Input extends Validator<infer Value, FieldType, boolean> ? Value : never;

type OptionalValidatorKeys<Fields extends Record<string, Validator>> = {
  [Name in keyof Fields]-?: Fields[Name]['optional'] extends true ? Name : never;
}[keyof Fields];

type RequiredValidatorKeys<Fields extends Record<string, Validator>> =
  Exclude<keyof Fields, OptionalValidatorKeys<Fields>>;

export type InferObjectValidatorFields<Fields extends Record<string, Validator>> =
  { [Name in RequiredValidatorKeys<Fields>]: Exclude<InferValidator<Fields[Name]>, undefined> }
  & { [Name in OptionalValidatorKeys<Fields>]?: Exclude<InferValidator<Fields[Name]>, undefined> };

export declare const v: {
  string(): Validator<string, 'String', false>;
  principal(): Validator<string, 'Principal', false>;
  id<const Table extends string>(table: Table): Validator<string, { readonly Id: { readonly table: Table } }, false>;
  boolean(): Validator<boolean, 'Boolean', false>;
  integer(): Validator<number, 'Integer', false>;
  real(): Validator<number, 'Real', false>;
  number(): Validator<number, 'Real', false>;
  json(): Validator<unknown, 'Json', false>;
  object<const Fields extends Record<string, Validator>>(fields: Fields): Validator<InferObjectValidatorFields<Fields>, 'Json', false> & { readonly fields: Fields };
  optional<Inner extends Validator>(inner: Inner): Validator<InferValidator<Inner> | undefined, Inner['fieldType'], true>;
};

export interface MembershipResourceRef<Table extends string = string> {
  readonly __membershipResourceRef: true;
  readonly __resourceTable: Table;
}

export declare const membershipResource: {
  arg(path: string): MembershipResourceRef<string>;
  rowField(field: string): MembershipResourceRef<string>;
  app(): MembershipResourceRef<'app'>;
};

export interface MembershipPredicate {
  readonly __membershipPredicate: true;
}

// ---------------------------------------------------------------------------
// Value expressions (the closed v1 profile — LLP 0051 D2)
// ---------------------------------------------------------------------------

export interface ValueExpr {
  readonly __expr: true;
}

/** Strict arg lookup by dotted path; missing is a typed error. */
export declare function arg(path: string): ValueExpr;
/** The whole args object — null-safe base for optional access. */
export declare function argsRoot(): ValueExpr;
/** Optional arg access: missing keys yield null (compose with coalesce). */
export declare function argOpt(path: string): ValueExpr;
export declare function authUserId(): ValueExpr;
export declare function authKind(): ValueExpr;
export declare function authActorKind(): ValueExpr;
export declare function authIsDelegated(): ValueExpr;
export declare function lit(value: unknown): ValueExpr;
export declare function bindingRef(name: string): ValueExpr;
export declare function runtimeId(): ValueExpr;
export declare function runtimeNow(): ValueExpr;
/** Null-propagating access by arbitrary string key (hyphenated keys fine). */
export declare function field(base: ValueExpr, ...keys: string[]): ValueExpr;

export declare function add(left: ValueExpr, right: ValueExpr): ValueExpr;
export declare function sub(left: ValueExpr, right: ValueExpr): ValueExpr;
export declare function mul(left: ValueExpr, right: ValueExpr): ValueExpr;
export declare function div(left: ValueExpr, right: ValueExpr): ValueExpr;
export declare function mod(left: ValueExpr, right: ValueExpr): ValueExpr;
/** Value equality (deep; cross-representation numeric). `eq` is the filter helper. */
export declare function eqv(left: ValueExpr, right: ValueExpr): ValueExpr;
export declare function ne(left: ValueExpr, right: ValueExpr): ValueExpr;
export declare function lt(left: ValueExpr, right: ValueExpr): ValueExpr;
export declare function lte(left: ValueExpr, right: ValueExpr): ValueExpr;
export declare function gt(left: ValueExpr, right: ValueExpr): ValueExpr;
export declare function gte(left: ValueExpr, right: ValueExpr): ValueExpr;
/** Value-returning over truthiness (JS-style). */
export declare function and(left: ValueExpr, right: ValueExpr): ValueExpr;
export declare function or(left: ValueExpr, right: ValueExpr): ValueExpr;
export declare function not(expr: ValueExpr): ValueExpr;
export declare function neg(expr: ValueExpr): ValueExpr;
/** Ternary. */
export declare function cond(test: ValueExpr, then: ValueExpr, otherwise: ValueExpr): ValueExpr;
/** String template: parts are expressions or plain strings. */
export declare function concat(...parts: Array<ValueExpr | string>): ValueExpr;

export type PinnedFunction =
  | 'len' | 'trim' | 'lower' | 'abs' | 'min' | 'max'
  | 'round' | 'floor' | 'ceil' | 'coalesce';
export declare const PINNED_FUNCTIONS: readonly PinnedFunction[];
/** Call into the pinned v1 library; codegen fails closed outside it. */
export declare function call(func: PinnedFunction, ...args: ValueExpr[]): ValueExpr;
export declare function coalesce(...exprs: ValueExpr[]): ValueExpr;
/** Closed record constructor (computed-summary returns). */
export declare function record(fields: Record<string, ValueExpr>): ValueExpr;

// ---------------------------------------------------------------------------
// Query helpers
// ---------------------------------------------------------------------------

export interface FilterSpec { field: string; op: string; value: ValueExpr }
export interface OrderSpec { field: string; direction: 'Asc' | 'Desc' }

export declare function eq(field: string, value: ValueExpr): FilterSpec;
export declare function ltFilter(field: string, value: ValueExpr): FilterSpec;
export declare function lteFilter(field: string, value: ValueExpr): FilterSpec;
export declare function gtFilter(field: string, value: ValueExpr): FilterSpec;
export declare function gteFilter(field: string, value: ValueExpr): FilterSpec;
export declare function asc(field: string): OrderSpec;
export declare function desc(field: string): OrderSpec;

// ---------------------------------------------------------------------------
// Mutation steps (v1 profile — LLP 0051 D2)
// ---------------------------------------------------------------------------

export interface MutationStep { readonly [key: string]: unknown }
export interface ReturnSpec { readonly [key: string]: unknown }

export declare function insert(
  table: string,
  values: Record<string, ValueExpr>,
  opts?: { bindIdAs?: string },
): MutationStep;
export declare function patch(table: string, id: ValueExpr, values: Record<string, ValueExpr>): MutationStep;
export declare function del(table: string, id: ValueExpr): MutationStep;
/** Point read captured into the read-set; missing binds null unless elseError is set. */
export declare function get(
  table: string,
  id: ValueExpr,
  bindAs: string,
  opts?: { elseError?: string },
): MutationStep;
/** Truthiness guard; failure is the author-supplied typed error code. */
export declare function guard(cond: ValueExpr, elseError: string): MutationStep;
export declare function letBind(bindAs: string, expr: ValueExpr): MutationStep;
/** Set-oriented delete; empty filter clears the table. */
export declare function deleteWhere(table: string, filter?: FilterSpec[]): MutationStep;
/** One insert per element of an argument-supplied array (bounded fan-out). */
export declare function insertEach(
  table: string,
  source: ValueExpr,
  itemAs: string,
  values: Record<string, ValueExpr>,
): MutationStep;

export declare function returnBinding(name: string): ReturnSpec;
export declare function returnChangedCount(): ReturnSpec;
export declare function returnDocument(table: string, id: ValueExpr): ReturnSpec;
export declare function returnLiteral(value: unknown): ReturnSpec;
export declare function returnExpr(expr: ValueExpr): ReturnSpec;

// ---------------------------------------------------------------------------
// Definitions
// ---------------------------------------------------------------------------

export type OutgrewIrClass =
  | 'conditional-writes'
  | 'filtered-read-guards'
  | 'type-coercion'
  | 'general-iteration';
export declare const OUTGREW_IR_CLASSES: Readonly<Record<OutgrewIrClass, string>>;

export type AuthMode = 'dev' | 'sessions';
export type AuthRequirement = 'public' | 'optional-user' | 'authenticated';
export type AuthorizationInputDimension =
  | 'userId'
  | 'kind'
  | 'actorKind'
  | 'isDelegated'
  | 'sessionId'
  | 'provider'
  | 'roles'
  | 'isAuthenticated'
  | 'opaque';
export type TargetCapabilityId =
  | 'auth.sessions.v1'
  | 'cron'
  | 'cron_action_run_mutation'
  | 'host_plan_runtime'
  | 'ibex_ctx_db_host_bridge'
  | 'live_subscriptions'
  | 'mutation_read_set_validation'
  | 'permission_epoch_resync';

export interface FunctionAuthOptions {
  /** Controls whether the resolved server authority must carry a user. */
  auth?: AuthRequirement;
}

export interface AuthorityCreatingAuthOptions extends FunctionAuthOptions {
  /** Marks a mutation/action whose successful effects can create durable
   * authority; scoped grants must consent to this exact function entry. */
  authorityCreating?: boolean;
}

export interface QueryAuthOptions extends FunctionAuthOptions {
  /** Trusted declaration that the complete result is caller-authority invariant.
   * Item 4 accepts true only for a public, ambient-free HostPlan query. */
  authorityIndependent?: boolean;
  /** Opt into AuthorizedLease-backed offline retention after load-time proof. */
  retainable?: boolean;
}

export interface HostPlanQuerySpec extends QueryAuthOptions {
  table: string;
  args?: Record<string, Validator>;
  filter?: FilterSpec[];
  order?: OrderSpec[];
  limit?: number;
  index?: string;
  defaultLive?: boolean;
  /** Explicit userId disjointness declaration; never inferred. */
  authScopeField?: string;
  /** Declaration-bound membership semi-joins, ANDed with ordinary filters. */
  membership?: MembershipPredicate[];
}

export interface JsQuerySpec extends QueryAuthOptions {
  args?: Record<string, Validator>;
  source: string;
  exportName: string;
  reads: string[];
  result?: Validator;
  authScopeField?: string;
  /** Closed declaration for diagnostics. JavaScript remains non-retainable
   * until its ctx.auth and module-state profile is mechanically proved. */
  authorizationDependence?: AuthorizationInputDimension[];
  defaultLive?: boolean;
}

export interface HostPlanMutationSpec extends AuthorityCreatingAuthOptions {
  args?: Record<string, Validator>;
  plan: MutationStep | MutationStep[];
  returns?: ReturnSpec;
}

export interface JsMutationSpec extends AuthorityCreatingAuthOptions {
  args?: Record<string, Validator>;
  source: string;
  exportName: string;
  reads?: string[];
  writes: string[];
  /** Declares the named out-of-profile class keeping this mutation JS-tier;
   * codegen emits the class-specific "outgrew the IR" info diagnostic. */
  outgrewIr?: OutgrewIrClass;
}

export interface HostPlanActionSpec extends AuthorityCreatingAuthOptions {
  args?: Record<string, Validator>;
  plan: unknown | unknown[];
  returns?: unknown;
  writes?: string[];
  uses?: string[];
}

export interface JsActionSpec extends AuthorityCreatingAuthOptions {
  args?: Record<string, Validator>;
  js: { source: string; exportName: string };
  writes?: string[];
  uses?: string[];
}

export type MembershipRole = string;
export interface MembershipLastHolder { protect: MembershipRole }
export interface MembershipExpiry { field: string; onExpiry: 'remove' }
export type MembershipTarget = 'self' | 'other';
export type MembershipTransition =
  | { op: 'insert'; by: MembershipRole[]; target: MembershipTarget; to: MembershipRole[]; fields?: string[] }
  | { op: 'setRole'; by: MembershipRole[]; target: MembershipTarget; from?: MembershipRole[]; to: MembershipRole[] }
  | { op: 'remove'; by: MembershipRole[]; target: MembershipTarget; from?: MembershipRole[] }
  | { op: 'patch'; by: MembershipRole[]; target: MembershipTarget; from?: MembershipRole[]; fields: string[] };

export interface ResourceMembershipSpec {
  id?: string;
  scope?: 'resource';
  principal: string;
  resource: string;
  role: string;
  roles: readonly MembershipRole[];
  pendingRoles?: readonly MembershipRole[];
  bootstrapRole?: MembershipRole;
  lastHolder?: MembershipLastHolder;
  expiry?: MembershipExpiry;
  incidental?: readonly string[];
  provenance?: 'creation' | 'full';
  transitions?: readonly MembershipTransition[];
}

export interface AppMembershipSpec extends Omit<ResourceMembershipSpec, 'scope' | 'resource' | 'bootstrapRole' | 'lastHolder'> {
  scope: 'app';
  bootstrapRole?: never;
  lastHolder?: never;
}

export type MembershipSpec = ResourceMembershipSpec | AppMembershipSpec;

type RolesOf<Spec extends MembershipSpec> =
  | Spec['roles'][number]
  | (Spec extends { pendingRoles: readonly (infer Role extends string)[] } ? Role : never);
type ScopeOf<Spec extends MembershipSpec> = Spec extends { scope: 'app' } ? 'app' : 'resource';

export interface TableBuilder<Fields extends Record<string, Validator> = Record<string, Validator>> {
  index(name: string, fields: Array<keyof Fields & string>, options?: { unique?: boolean }): TableBuilder<Fields>;
  sync(): TableBuilder<Fields>;
  permissionBacking(fields?: Array<keyof Fields & string>): TableBuilder<Fields>;
  membership<const Spec extends MembershipSpec>(spec: Spec): MembershipTableBuilder<Fields, RolesOf<Spec>, ScopeOf<Spec>>;
}

export interface MembershipTableBuilder<
  Fields extends Record<string, Validator> = Record<string, Validator>,
  Role extends string = string,
  Scope extends 'resource' | 'app' = 'resource',
> extends TableBuilder<Fields> {
  index(name: string, fields: Array<keyof Fields & string>, options?: { unique?: boolean }): MembershipTableBuilder<Fields, Role, Scope>;
  sync(): MembershipTableBuilder<Fields, Role, Scope>;
  memberOf(...args: Scope extends 'app'
    ? [] | [resource: MembershipResourceRef<'app'>]
    : [resource: MembershipResourceRef]): MembershipPredicate;
  hasRole(...args: Scope extends 'app'
    ? [role: Role, ...roles: Role[]] | [resource: MembershipResourceRef<'app'>, role: Role, ...roles: Role[]]
    : [resource: MembershipResourceRef, role: Role, ...roles: Role[]]): MembershipPredicate;
}

export declare function defineTable<const Fields extends Record<string, Validator>>(fields: Fields): TableBuilder<Fields>;
export declare function defineSchema(
  tables: Record<string, unknown>,
  options?: {
    ephemeral?: unknown;
    auth?: { mode: AuthMode };
    requiredCapabilities?: TargetCapabilityId[];
  },
): unknown;
export declare function defineQuery(spec: HostPlanQuerySpec): unknown;
export declare function defineLiveQuery(spec: HostPlanQuerySpec): unknown;
export declare function defineJsQuery(spec: JsQuerySpec): unknown;
export declare function defineJsLiveQuery(spec: JsQuerySpec): unknown;

export interface RelationalVisibilitySpec {
  root: { kind: 'owner'; field: string } | { kind: 'public-read' };
  joined: { kind: 'owner'; field: string } | { kind: 'public-read' };
  output: 'owner' | 'public-read';
}
export interface RelationalQuerySpec {
  root: unknown;
  rootAlias?: string;
  joined: unknown;
  joinedAlias?: string;
  join: Array<{ root: string; joined: string }>;
  kind?: 'inner' | 'left';
  visibility: RelationalVisibilitySpec;
  projection: Record<string, { root: string } | { joined: string } | { literal: unknown }>;
  take: number;
  rootIndex: string;
  joinedIndex: string;
  defaultLive?: boolean;
}
export declare function defineRelationalQuery(spec: RelationalQuerySpec): unknown;

export interface MaintainedProjectionSpec {
  /** Stable plan identity; the row-identity domain across rebuilds. */
  id: string;
  root: unknown;
  rootAlias?: string;
  joined: unknown;
  joinedAlias?: string;
  output: unknown;
  join: Array<{ root: string; joined: string }>;
  kind?: 'inner' | 'left';
  visibility: {
    root: { kind: 'owner'; field: string } | { kind: 'public-read' };
    joined: { kind: 'owner'; field: string } | { kind: 'public-read' };
    output: { kind: 'owner'; field: string } | { kind: 'public-read' };
  };
  projection: Record<string, { root: string } | { joined: string } | { literal: unknown }>;
  /** Root `_id` by default, or an immutable declared unique root index. */
  outputKey?: 'rootId' | { index: string };
  /** Declared root index leading with the root join-field sequence. */
  rootReverseIndex: string;
  /** Per-joined-key reference bound, 1..=1023 (reverse-index entries). */
  fanOutLimit: number;
  /** Required acknowledgment when a shared public joined source feeds an
   * owner output (the cross-authority capacity coupling). */
  sharedFanOutDisclosure?: boolean;
}
export declare function defineMaintainedProjection(spec: MaintainedProjectionSpec): unknown;
export declare function isMaintainedProjectionDef(value: unknown): boolean;
export declare function defineMutation(spec: HostPlanMutationSpec): { plan: { steps: MutationStep[]; return_value: ReturnSpec | null } };
export declare function defineJsMutation(spec: JsMutationSpec): unknown;
export declare function defineAction(spec: HostPlanActionSpec | JsActionSpec): unknown;
export declare function defineCron(jobs: Record<string, unknown>): unknown;
export declare function defineConfig(entries: Record<string, unknown>): unknown;
export declare function runMutation(name: string, args?: Record<string, ValueExpr>, opts?: { bindResultAs?: string }): unknown;

export declare const allow: Record<string, (...args: unknown[]) => unknown>;
export declare const ephemeral: { collection(spec: Record<string, unknown>): unknown };
export declare function defineEphemeral(collections: Record<string, unknown>): unknown;

export declare function isFunctionDef(value: unknown): boolean;
export declare function isCronDef(value: unknown): boolean;
export declare function isConfigDef(value: unknown): boolean;
export declare function isEphemeralCollectionDef(value: unknown): boolean;
export declare function assert(cond: unknown, message: string): asserts cond;
