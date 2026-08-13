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
  | { readonly Vector: { readonly dimensions: number } }
  | 'Principal'
  | { readonly Id: { readonly table: string } }
  | { readonly AppSchemaRef: { readonly authority: 'app'; readonly table: string } }
  | { readonly RelationIncarnation: { readonly foreignKeyField: string; readonly parentTable: string } }
  | { readonly Vector: { readonly dimensions: number } }
  | { readonly AssetRef: {
      readonly upload?: string;
      readonly media?: {
        readonly intent: string;
        readonly policy: string;
        readonly kinds: ReadonlyArray<'image' | 'video' | 'audio' | 'file'>;
        readonly delivery?: string;
        readonly variants?: ReadonlyArray<string>;
        readonly classificationProfile: 'detected-content-type.v1';
        readonly retentionClass: 'media-reference.v1';
        readonly targetCapability: 'assets.media-ref-projection.v1';
      };
    } };

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
  string(options?: { maxBytes?: number }): Validator<string, 'String', false>;
  principal(): Validator<string, 'Principal', false>;
  id<const Table extends string>(table: Table): Validator<string, { readonly Id: { readonly table: Table } }, false>;
  /** Complete stored document shape, valid only inside a result contract. */
  doc<const Table extends string>(table: Table): Validator<Readonly<Record<string, unknown>>, { readonly AppSchemaRef: { readonly authority: 'app'; readonly table: Table } }, false>;
  relationIncarnationOf<const ForeignKey extends string, const Parent extends string>(
    spec: { foreignKeyField: ForeignKey; parentTable: Parent },
  ): Validator<string, { readonly RelationIncarnation: { readonly foreignKeyField: ForeignKey; readonly parentTable: Parent } }, false>;
  assetRef<const Upload extends string = string>(
    options?: { upload?: Upload | null },
  ): Validator<string, { readonly AssetRef: { readonly upload?: Upload } }, false>;
  media<
    const Intent extends string,
    const Policy extends string,
    const Kinds extends ReadonlyArray<'image' | 'video' | 'audio' | 'file'>,
  >(options: {
    intent: Intent;
    policy: Policy;
    kinds: Kinds;
    delivery?: string;
    variants?: ReadonlyArray<string>;
  }): Validator<string, { readonly AssetRef: {
    readonly upload: Intent;
    readonly media: {
      readonly intent: Intent;
      readonly policy: Policy;
      readonly kinds: Kinds;
      readonly delivery?: string;
      readonly variants?: ReadonlyArray<string>;
      readonly classificationProfile: 'detected-content-type.v1';
      readonly retentionClass: 'media-reference.v1';
      readonly targetCapability: 'assets.media-ref-projection.v1';
    };
  } }, false>;
  boolean(): Validator<boolean, 'Boolean', false>;
  integer(options?: { min?: number; max?: number }): Validator<number, 'Integer', false>;
  real(options?: { min?: number; max?: number }): Validator<number, 'Real', false>;
  number(options?: { min?: number; max?: number }): Validator<number, 'Real', false>;
  finiteReal(options?: { min?: number; max?: number }): Validator<number, 'Real', false>;
  vector<const Dimensions extends number>(
    dimensions: Dimensions,
  ): Validator<ReadonlyArray<number> & { readonly length: Dimensions }, { readonly Vector: { readonly dimensions: Dimensions } }, false>;
  json(options?: { maxDepth?: number; maxBytes?: number }): Validator<unknown, 'Json', false>;
  null(): Validator<null, 'Json', false>;
  literal<const Value extends string | number | boolean | null>(value: Value): Validator<Value, 'Json', false>;
  object<const Fields extends Record<string, Validator>>(fields: Fields): Validator<InferObjectValidatorFields<Fields>, 'Json', false> & { readonly fields: Fields };
  optional<Inner extends Validator>(inner: Inner): Validator<InferValidator<Inner> | undefined, Inner['fieldType'], true>;
  array<Inner extends Validator>(
    inner: Inner,
    options?: { maxItems?: number },
  ): Validator<ReadonlyArray<InferValidator<Inner>>, 'Json', false>;
  tuple<const Elements extends readonly Validator[]>(
    elements: Elements,
  ): Validator<{ readonly [Index in keyof Elements]: InferValidator<Elements[Index]> }, 'Json', false>;
  union<const Variants extends readonly Validator[]>(
    variants: Variants,
  ): Validator<InferValidator<Variants[number]>, 'Json', false>;
};

export interface ResultContract<Result = unknown> {
  readonly __resultContract: true;
  readonly __result?: Result;
}

export declare const results: {
  documents<const Table extends string>(table: Table): ResultContract<ReadonlyArray<{ readonly _id: string }>>;
  records<const RowValidator extends Validator>(
    validator: RowValidator,
    options?: { minItems?: number; maxItems?: number },
  ): ResultContract<ReadonlyArray<InferValidator<RowValidator>>>;
  document<const Table extends string>(table: Table): ResultContract<{ readonly _id: string }>;
  value<const ValueValidator extends Validator>(
    validator: ValueValidator,
  ): ResultContract<InferValidator<ValueValidator>>;
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
export declare const literal: typeof lit;
export declare function bindingRef(name: string): ValueExpr;
export declare const binding: typeof bindingRef;
export declare function authActualActor(): ValueExpr;
export declare function authActivityActorKind(): ValueExpr;
export declare function authGrantId(): ValueExpr;
export declare function clientMutationDigest(): ValueExpr;
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
export interface OrderSpec {
  field: string;
  direction: 'Asc' | 'Desc';
  /** UTF-8 write ceiling for a string or application-id order field; single-valued per table/field. */
  maxEncodedBytes?: number;
}

export declare function eq(field: string, value: ValueExpr): FilterSpec;
export declare function ltFilter(field: string, value: ValueExpr): FilterSpec;
export declare function lteFilter(field: string, value: ValueExpr): FilterSpec;
export declare function gtFilter(field: string, value: ValueExpr): FilterSpec;
export declare function gteFilter(field: string, value: ValueExpr): FilterSpec;
export declare function asc(field: string, options?: { maxEncodedBytes?: number }): OrderSpec;
export declare function desc(field: string, options?: { maxEncodedBytes?: number }): OrderSpec;

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
/** One host-owned scoped allocation, admitted only by write-with-activity.v1. */
export declare function allocateSequence(counter: string, scope: ValueExpr, into: string): MutationStep;
/** Set-oriented delete; an explicitly authored empty filter clears the table. */
export declare function deleteWhere(table: string, filter: FilterSpec[]): MutationStep;
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
  | 'sequence_allocation_v1'
  | 'snapshot_batch_v1'
  | 'snapshot_batch_v2'
  | 'settlement.bounded_skew'
  | 'permission_epoch_resync'
  | 'full_text_search_v1'
  | 'live_full_text_search_v1'
  | 'vector_search_v1';

export interface PushAudienceReference<Name extends string = string> {
  readonly audience: Name;
  readonly args: Readonly<Record<string, unknown>>;
}

export interface PushSeamDefinition<AudienceName extends string = string> {
  readonly __pushSeamDefinition: true;
  readonly audiences: Readonly<Record<AudienceName, (
    args?: Readonly<Record<string, unknown>>,
  ) => PushAudienceReference<AudienceName>>>;
}

type PushMembershipClause = {
  readonly membership: MembershipTableBuilder;
  readonly resourceArg?: string;
  readonly roles: readonly string[];
};

type PushResolverClause = PushMembershipClause | {
  /** Runtime principal ids are allowed only through this declared, bounded
   * resolver and are refused for deferred sends. */
  readonly principalsArg: string;
  readonly maxItems: number;
};

type PushAuthorizeClause = PushMembershipClause | { readonly system: true };

export declare function definePushSeam(spec: {
  readonly appScope: {
    readonly easProjectId: string;
    readonly applicationId: string;
    readonly environment: string;
  };
  readonly registry: {
    readonly idleRetentionMs: number;
  };
}): PushSeamDefinition<never>;

export declare function definePushSeam<const Audiences extends Record<string, {
  readonly resolve: PushResolverClause;
  readonly authorize: PushAuthorizeClause;
}>>(spec: {
  readonly appScope: {
    readonly easProjectId: string;
    readonly applicationId: string;
    readonly environment: string;
  };
  readonly registry: {
    readonly idleRetentionMs: number;
  };
  readonly audiences: Audiences;
  readonly uses: readonly string[];
  readonly ledger: {
    readonly retentionMs: number;
  };
}): PushSeamDefinition<keyof Audiences & string>;

export interface FunctionAuthOptions {
  /** Controls whether the resolved server authority must carry a user. */
  auth?: AuthRequirement;
  /** Conjunction of built-in assurance kinds or defineAuth aliases. */
  requires?: readonly string[];
  /** Closed application refusal codes admitted for `ctx.refuse`. */
  refusals?: readonly string[];
  /** Declared refusal codes whose occurrences opt into issue tracking. Every
   * entry must also appear in `refusals`; this never admits a code itself. */
  trackedRefusals?: readonly string[];
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

interface JsQuerySpecBase extends QueryAuthOptions {
  args?: Record<string, Validator>;
  reads: string[];
  result?: Validator | ResultContract;
  authScopeField?: string;
  /** Interim LLP 0231 field-masking residual. This records the fields the
   * opaque handler claims to conceal and its disclosure condition; it is
   * handler-enforced review evidence, not a noninterference proof. */
  fieldBoundary?: {
    fields: readonly string[];
    condition: string;
  };
  /** Closed declaration for diagnostics. JavaScript remains non-retainable
   * until its ctx.auth and module-state profile is mechanically proved. */
  authorizationDependence?: AuthorizationInputDimension[];
  defaultLive?: boolean;
}
export type JsQuerySpec = JsQuerySpecBase & (
  | { source: string; exportName: string; handler?: never }
  | { handler: (ctx: any, args: any) => unknown; source?: never; exportName?: never }
);

export interface HostPlanMutationSpec extends AuthorityCreatingAuthOptions {
  args?: Record<string, Validator>;
  plan: MutationStep | MutationStep[];
  returns?: ReturnSpec;
  result?: ResultContract;
  /** Lane-L only: accept the captured runtimeNow() value for one direct
   * integer field when its settlement-clock skew is within the bound. */
  boundedSkew?: { field: string; maxSkewMs: number };
}

interface JsMutationSpecBase extends AuthorityCreatingAuthOptions {
  args?: Record<string, Validator>;
  reads?: string[];
  writes: string[];
  result?: ResultContract;
  /** Declares the named out-of-profile class keeping this mutation JS-tier;
   * codegen emits the class-specific "outgrew the IR" info diagnostic. */
  outgrewIr?: OutgrewIrClass;
  /** Declared scoped counters available through ctx.sequence.allocate(). */
  sequences?: readonly {
    name: string;
    scopeTable: string;
    scopeAccess: 'public.v1' | {
      declaration: string;
      roles: readonly string[];
    };
  }[];
}
export type JsMutationSpec = JsMutationSpecBase & (
  | { source: string; exportName: string; handler?: never }
  | { handler: (ctx: any, args: any) => unknown; source?: never; exportName?: never }
);

export interface HostPlanActionSpec extends AuthorityCreatingAuthOptions {
  args?: Record<string, Validator>;
  plan: unknown | unknown[];
  returns?: unknown;
  writes?: string[];
  uses?: string[];
  result?: ResultContract;
}

export interface JsActionSpec extends AuthorityCreatingAuthOptions {
  args?: Record<string, Validator>;
  js?: { source: string; exportName: string };
  handler?: (ctx: any, args: any) => unknown;
  writes?: string[];
  uses?: string[];
  result?: ResultContract;
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

/**
 * The closed opt-in for the generated principal-addressed removal command
 * (LLP 0100 §2). V1 admits only `{ remove: true }`; activation requires at
 * least one TOTAL other-principal removal transition (`op: 'remove'`,
 * `target: 'other'`, `from` omitted) whose caller classes are full
 * non-pending roles — and, under `lastHolder`, exactly the protected role.
 */
export interface MembershipPrincipalAddressedWrites { remove: true }

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
  principalAddressedWrites?: MembershipPrincipalAddressedWrites;
}

export interface AppMembershipSpec extends Omit<ResourceMembershipSpec, 'scope' | 'resource' | 'bootstrapRole' | 'lastHolder'> {
  scope: 'app';
  bootstrapRole?: never;
  lastHolder?: never;
}

export type MembershipSpec = ResourceMembershipSpec | AppMembershipSpec;

/** The rollout-1 authority facade over one canonical membership table.
 * `hierarchy` lists the roles implied by each role; codegen closes it into
 * explicit membership role sets. `roster.visible` is projection metadata
 * only in v1—generated roster operations and hooks are not part of this lane.
 */
export interface AuthorityProfileSpec<
  Role extends string = string,
  Field extends string = string,
> {
  readonly name: string;
  readonly hierarchy: Readonly<Partial<Record<Role, readonly Role[]>>>;
  readonly roster: { readonly visible: readonly Field[] };
}

type RolesOf<Spec extends MembershipSpec> =
  | Spec['roles'][number]
  | (Spec extends { pendingRoles: readonly (infer Role extends string)[] } ? Role : never);
type ActiveRolesOf<Spec extends MembershipSpec> = Spec['roles'][number];
type ScopeOf<Spec extends MembershipSpec> = Spec extends { scope: 'app' } ? 'app' : 'resource';

export type AssetSharingSpec<Fields extends Record<string, Validator> = Record<string, Validator>> =
  | { kind: 'public-read' }
  | { kind: 'owner'; field: keyof Fields & string }
  | { kind: 'membership'; membership: string; roles?: readonly string[] };

export type TableVisibilityArmSpec<Fields extends Record<string, Validator> = Record<string, Validator>> =
  | { kind: 'owner'; field: keyof Fields & string }
  | {
    kind: 'membership';
    declaration: string | MembershipTableBuilder;
    resourceField: keyof Fields & string;
    roles?: readonly string[];
  };

export type TableVisibilitySpec<Fields extends Record<string, Validator> = Record<string, Validator>> =
  | { kind: 'public-read' }
  | TableVisibilityArmSpec<Fields>
  | { kind: 'any-of'; arms: readonly [TableVisibilityArmSpec<Fields>, TableVisibilityArmSpec<Fields>, ...TableVisibilityArmSpec<Fields>[]] };

/** Finite schema authority for retained record history. Runtime validation
 * enforces retainMs in 1..2,592,000,000 and maxVersionsPerRecord in 1..1,000. */
export interface HistoryRetentionSpec {
  readonly retainMs: number;
  readonly maxVersionsPerRecord: number;
}

export interface TableBuilder<Fields extends Record<string, Validator> = Record<string, Validator>> {
  index(name: string, fields: Array<keyof Fields & string>, options?: { unique?: boolean }): TableBuilder<Fields>;
  searchIndex(name: string, spec: SearchIndexSpec<Fields>): TableBuilder<Fields>;
  vectorIndex(name: string, spec: VectorIndexSpec<Fields>): TableBuilder<Fields>;
  searchLiveLimits(spec?: { maxLiveSubscriptionsPerTable?: number }): TableBuilder<Fields>;
  sync(): TableBuilder<Fields>;
  permissionBacking(fields?: Array<keyof Fields & string>): TableBuilder<Fields>;
  membership<const Spec extends MembershipSpec>(spec: Spec): MembershipTableBuilder<Fields, RolesOf<Spec>, ScopeOf<Spec>, ActiveRolesOf<Spec>>;
  /** Declare this table's default row-visibility policy (LLP 0231 D1). */
  visibility(spec: TableVisibilitySpec<Fields>): TableBuilder<Fields>;
  /** Declare this table's row-visibility policy sufficient for asset
   * sharing (LLP 0044 §Asset read authorization; LLP 0007 dated amendment
   * 2026-07-31). Without it a typed reference confers no via-references
   * read authority. */
  assetSharing(spec: AssetSharingSpec<Fields>): TableBuilder<Fields>;
  /** Opt into bounded per-record history for this table. */
  history(spec: HistoryRetentionSpec): TableBuilder<Fields>;
}

export type SearchFieldClassification = 'public' | 'private' | 'sensitive' | 'forbidden';
export interface SearchIndexSpec<Fields extends Record<string, Validator>> {
  semanticVersion: string;
  textFields: Partial<Record<keyof Fields & string, {
    weight: number;
    classification: SearchFieldClassification;
  }>>;
  fieldClassifications?: Partial<Record<keyof Fields & string, SearchFieldClassification>>;
  equalityFilters?: Array<keyof Fields & string>;
  storedFields?: Array<keyof Fields & string>;
  highlightFields?: Array<keyof Fields & string>;
  visibility:
    | { kind: 'public-read' }
    | { kind: 'owner'; field: keyof Fields & string }
    | {
      kind: 'membership';
      declaration: string | MembershipTableBuilder;
      resourceField: keyof Fields & string;
      roles?: readonly string[];
    };
  sourceLimits?: {
    maxIndexedBytes?: number;
    maxTokens?: number;
    maxPostingOperations?: number;
  };
  queryLimits?: {
    maxCandidateWork?: number;
    maxPrefixTerms?: number;
    minPrefixScalars?: number;
  };
  cursorLimits?: { ttlMs?: number; maxBytes?: number };
  maintenanceLimits?: {
    searchMaintenanceEffects?: number;
    searchPostingOps?: number;
    searchPositions?: number;
    searchBytes?: number;
  };
  liveLimits?: {
    maxLiveSubscriptions?: number;
    maxLiveSubscriptionsPerConnection?: number;
  };
}

export interface VectorIndexSpec<Fields extends Record<string, Validator>> {
  semanticVersion: string;
  vectorField: keyof Fields & string;
  metric: 'l2sq' | 'dot';
  fieldClassifications: Partial<Record<keyof Fields & string, SearchFieldClassification>>;
  equalityFilters?: Array<keyof Fields & string>;
  storedFields?: Array<keyof Fields & string>;
  visibility:
    | { kind: 'public-read' }
    | { kind: 'owner'; field: keyof Fields & string };
  tieBreak?: 'id-asc' | 'id-desc';
  maxIndexedVectorsPerPartition: number;
}

export interface VectorIndexSpec<Fields extends Record<string, Validator>> {
  semanticVersion: string;
  vectorField: keyof Fields & string;
  metric: 'l2sq' | 'dot';
  fieldClassifications: Partial<Record<keyof Fields & string, SearchFieldClassification>>;
  equalityFilters?: Array<keyof Fields & string>;
  storedFields?: Array<keyof Fields & string>;
  visibility: { kind: 'public-read' } | { kind: 'owner'; field: keyof Fields & string };
  tieBreak?: 'id-asc' | 'id-desc';
  maxIndexedVectorsPerPartition: number;
  maintenanceLimits?: { vectorMaintenanceEffects?: number; vectorBytes?: number };
}

export interface MembershipTableBuilder<
  Fields extends Record<string, Validator> = Record<string, Validator>,
  Role extends string = string,
  Scope extends 'resource' | 'app' = 'resource',
  ActiveRole extends Role = Role,
> extends TableBuilder<Fields> {
  index(name: string, fields: Array<keyof Fields & string>, options?: { unique?: boolean }): MembershipTableBuilder<Fields, Role, Scope, ActiveRole>;
  sync(): MembershipTableBuilder<Fields, Role, Scope, ActiveRole>;
  /** Decorate this membership with AuthorityProfileV1 (LLP 0240 D1/D2). */
  authorityProfile(
    spec: AuthorityProfileSpec<ActiveRole, keyof Fields & string>,
  ): MembershipTableBuilder<Fields, Role, Scope, ActiveRole>;
  memberOf(...args: Scope extends 'app'
    ? [] | [resource: MembershipResourceRef<'app'>]
    : [resource: MembershipResourceRef]): MembershipPredicate;
  hasRole(...args: Scope extends 'app'
    ? [role: Role, ...roles: Role[]] | [resource: MembershipResourceRef<'app'>, role: Role, ...roles: Role[]]
    : [resource: MembershipResourceRef, role: Role, ...roles: Role[]]): MembershipPredicate;
}

export declare function defineTable<const Fields extends Record<string, Validator>>(fields: Fields): TableBuilder<Fields>;
export type AuthAssuranceKind = 'authenticated' | 'email_verified' | 'phone_verified' | 'recent_auth' | 'phishing_resistant';
export type AuthMechanism =
  | { readonly kind: 'guest' }
  | { readonly kind: 'password'; readonly identifier: 'username' | 'email'; readonly provider: string; readonly recovery: string }
  | { readonly kind: 'email-code'; readonly identityKind: 'email'; readonly provider: string; readonly canonicalization?: 'email-v1'; readonly delivery: string }
  | { readonly kind: 'passkey'; readonly provider: string };
export interface AuthProgramV1 {
  readonly version: 1;
  readonly mechanisms: Readonly<Record<string, AuthMechanism>>;
  readonly providers?: Readonly<Record<string, Readonly<Record<string, unknown>>>>;
  readonly assuranceRequirements: Readonly<Record<string, { readonly allOf: readonly string[] }>>;
  readonly guestPolicy: {
    readonly enabled: boolean;
    readonly claiming?: readonly string[];
    readonly reaping?: {
      readonly afterMs: number;
      readonly cleanup:
        | { readonly kind: 'declarative'; readonly default: 'delete' | 'tombstone' | 'retain-anonymized'; readonly tables: Readonly<Record<string, { readonly principalField: string; readonly onReap: 'delete' | 'tombstone' | 'retain-anonymized' }>> }
        | { readonly kind: 'handler'; readonly handler: string; readonly reads: readonly string[]; readonly writes: readonly string[] };
    };
  };
  readonly secretReferences: Readonly<Record<string, { readonly config: string }>>;
  readonly verifiedProvisioning?: {
    readonly handler: string;
    readonly requires: readonly string[];
    readonly reads: readonly string[];
    readonly writes: readonly ({ readonly table: string; readonly mode: 'ordinary' } | { readonly table: string; readonly mode: 'identity-binding'; readonly principalField: string; readonly identityField: string } | { readonly table: string; readonly mode: 'permission-backing'; readonly principalField: string })[];
  };
}
export declare const AUTH_DEFAULT_UNCLAIMED_GUEST_RETENTION_MS: number;
export declare function defineAuth(program: AuthProgramV1): AuthProgramV1;
export declare function defineSchema(
  tables: Record<string, unknown>,
  options?: {
    ephemeral?: unknown;
    auth?: { mode: AuthMode; agents?: { mode?: 'disabled' | 'invited' | 'open'; invitedBy?: 'operators' | 'users' } };
    authProgram?: AuthProgramV1;
    /** App-level asset policy (LLP 0044 §Deletion): reference GC is the
     * schema-declared opt-in; only typed `v.assetRef` references protect an
     * asset, and the grace must sit inside the target's Enforced bounds. */
    assets?: { referenceGc?: { graceMs: number } };
    /** Registry-only LLP 0143 declaration. The send and handoff-ledger slices
     * are not implied by this marker. */
    pushSeam?: PushSeamDefinition;
    requiredCapabilities?: TargetCapabilityId[];
  },
): unknown;
export declare function defineQuery(spec: HostPlanQuerySpec): unknown;
export declare function defineLiveQuery(spec: HostPlanQuerySpec): unknown;
/**
 * The generated declared job-status query (LLP 0070 first slice; LLP 0121
 * option 3): an ordinary live query over one job's privacy-bounded lifecycle
 * projection. Args are fixed (`jobId: v.string()`). Declaring it is the whole
 * authoring step: codegen itself emits both the experimental
 * `jobs_one_off_v1` capability requirement and the artifact-level
 * experimental acknowledgment. Do NOT add `jobs_one_off_v1` to
 * `defineSchema(..., { requiredCapabilities })` — that option admits
 * schema-level target capabilities only and refuses this id as unknown.
 */
export declare function defineJobStatusQuery(spec?: {
  auth?: AuthRequirement;
}): unknown;
/**
 * Declare the privacy-bounded LLP 0143 handoff-ledger query. The result is
 * authorized against the intent's stored audience arguments and never
 * contains token bytes, payloads, or provider prose.
 */
export declare function definePushLedgerQuery(spec: {
  auth: 'authenticated';
}): unknown;
export declare function defineJsQuery(spec: JsQuerySpec): unknown;
export declare function defineJsLiveQuery(spec: JsQuerySpec): unknown;
export declare function defineSearchQuery(spec: {
  table: TableBuilder;
  index: string;
  auth?: AuthRequirement;
  resourceArg?: string;
}): unknown;
export declare function defineVectorQuery(spec: {
  table: TableBuilder;
  index: string;
  auth?: AuthRequirement;
}): unknown;
/** First-page-only live search; the authored argument contract deliberately
 * omits the ordinary search request's `after` continuation member. */
export declare function defineLiveSearchQuery(spec: {
  table: TableBuilder;
  index: string;
  auth?: AuthRequirement;
}): unknown;

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
  /** Owner-issued retained-result class. Changing this value rotates the
   * generated plan/materialization identity; it never mutates old records. */
  retention?: 'none' | 'opaque-authorized-snapshot-v1' | 'result-transform-snapshot-v1';
}
export declare function defineRelationalQuery(spec: RelationalQuerySpec): unknown;
export declare function owner<const Field extends string>(field: Field): { kind: 'owner'; field: Field };
export declare function anyOf<const Arms extends readonly [TableVisibilityArmSpec, TableVisibilityArmSpec, ...TableVisibilityArmSpec[]]>(
  arms: Arms,
): { kind: 'any-of'; arms: Arms };
export declare function throughParent(): { kind: 'through-parent.v1' };
export declare function throughScope(spec: {
  scopeField: string;
  scopeIncarnationField: string;
}): { kind: 'through-scope.v1'; scopeField: string; scopeIncarnationField: string };
export declare function defineBoundedChildrenQuery(spec: unknown): unknown;
/** Defines a static 2–8 node snapshot batch. All-bounded tuples retain the
 * frozen `snapshot-batch.v1` profile; any tuple containing a relational node
 * emits `snapshot-batch.v2`, which admits only bounded-children and
 * relational-query definitions and requires at least one relational node. */
export declare function defineSnapshotBatchQuery(spec: { nodes: readonly unknown[] }): unknown;

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
export declare const SETTLEMENT_BOUNDED_SKEW_MAX_MS: 86400000;
export declare function mutationPlan(...steps: unknown[]): unknown;
export declare function existingOwner(spec: unknown): unknown;
export declare function clientMutation(): { kind: 'client-mutation.v1' };
export declare function assertSourceChanged(table: string, id: ValueExpr, operation: 'insert' | 'patch' | 'delete'): unknown;
export declare function defineWriteWithActivity(spec: unknown): unknown;
export declare function defineJsMutation(spec: JsMutationSpec): unknown;
export declare function defineAction(spec: HostPlanActionSpec | JsActionSpec): unknown;
/** One generated upload intent (LLP 0044 §Generated upload intents): the
 * declaration fixes accepted types, byte bounds, delivery profile,
 * read-access policy, and processing recipe; the client cannot supply or
 * widen any of them. Location-bearing image media require explicit
 * `image.location`; video media require the distinct `video.location`
 * sibling — omission refuses at generation. */
export interface AssetUploadSpec {
  args?: Record<string, Validator>;
  auth?: 'public' | 'optional-user' | 'authenticated';
  reads?: readonly string[];
  accept: { mediaTypes: readonly string[]; maxBytes: number };
  delivery?: { kind: 'public-immutable' | 'private-signed' | 'private-strict' };
  access?: { read: 'owner-only' | 'via-references' };
  image?: {
    location: 'strip' | 'retain';
    variants?: ReadonlyArray<{ key: string; width: number }>;
  };
  video?: {
    location: 'strip' | 'retain';
  };
  /** Declared lifecycle callbacks: each names a declared mutation whose
   * args are exactly `{ event: v.string(), assetId: v.string(),
   * facts: v.json() }`, invoked at-least-once with replay-safe idempotency
   * under the asset owner's authority — typed facts, never byte authority.
   * Dev-lane only in v1; a sessions schema refuses at generation. */
  on?: { ready?: string; rejected?: string };
  authorize?: (ctx: unknown, args?: unknown) => unknown;
  source?: string;
  exportName?: string;
}
export declare function defineAssetUpload(spec: AssetUploadSpec): unknown;
export declare function isAssetUploadDef(value: unknown): boolean;
export interface AssetBearingCommandSpec {
  readonly mutation: unknown;
  readonly assets?: Record<string, Readonly<{
    readonly intent: unknown;
    readonly mutationArg: string;
    readonly optional: boolean;
  }>>;
}
/** Closed LLP 0180 command declaration: one ordinary mutation and at most one
 * asset input. Codegen derives the public inputs and validates the mapping. */
export declare function defineCommand(spec: AssetBearingCommandSpec): unknown;
export declare function isCommandDef(value: unknown): boolean;
export declare function defineCron(jobs: Record<string, unknown>): unknown;
export declare function defineConfig(entries: Record<string, unknown>): unknown;
export declare function runMutation(name: string, args?: Record<string, ValueExpr>, opts?: { bindResultAs?: string }): unknown;

export declare const allow: Record<string, (...args: unknown[]) => unknown>;
export declare const ephemeral: { collection(spec: Record<string, unknown>): unknown };
export declare function defineEphemeral(collections: Record<string, unknown>): unknown;

// LLP 0179's closed generated-surface declaration grammar.
export interface SurfaceParam<Name extends string = string> {
  readonly __surfaceValue: true;
  readonly kind: 'param';
  readonly name: Name;
}
export interface SurfaceInput<Name extends string = string> {
  readonly __surfaceValue: true;
  readonly kind: 'input';
  readonly name: Name;
}
export interface SurfaceBinding<Reference = unknown, Bindings extends Record<string, unknown> = Record<string, unknown>> {
  readonly __surfaceBinding: true;
  readonly reference: Reference;
  readonly bindings: Bindings;
}
export declare function param<const Name extends string>(name: Name): SurfaceParam<Name>;
export declare function input<const Name extends string>(name: Name): SurfaceInput<Name>;
export declare function bind<Reference, const Bindings extends Record<string, unknown>>(
  reference: Reference,
  bindings?: Bindings,
): SurfaceBinding<Reference, Bindings>;
export interface SurfaceSpec {
  readonly params?: Record<string, Validator>;
  readonly reads?: Record<string, SurfaceBinding>;
  readonly mutations?: Record<string, SurfaceBinding>;
  readonly commands?: Record<string, SurfaceBinding>;
  readonly assets?: Record<string, SurfaceBinding>;
  readonly presence?: Record<string, SurfaceBinding>;
}
export declare function defineSurface<const Spec extends SurfaceSpec>(spec: Spec): Spec;

export declare function isFunctionDef(value: unknown): boolean;
export declare function isCronDef(value: unknown): boolean;
export declare function isConfigDef(value: unknown): boolean;
export declare function isEphemeralCollectionDef(value: unknown): boolean;
export declare function isEphemeralDef(value: unknown): boolean;
export declare function isSurfaceDef(value: unknown): boolean;
export declare function isSurfaceBinding(value: unknown): boolean;
export declare function isRoutesDef(value: unknown): boolean;
export declare function isTableDef(value: unknown): boolean;

/** A `params-v1` route-param reference for `defineRoutes` args mappings
 * (the `{"$param": name}` grammar of LLP 0092 §0E.6). */
export declare function routeParam(name: string): { $param: string };

export interface RouteQuerySpec {
  readonly function: string;
  readonly args?: Record<string, unknown>;
}
export interface RouteEntrySpec {
  readonly route: string;
  readonly queries: readonly RouteQuerySpec[];
  readonly persist?: boolean;
}
/** Declare the app's route→query manifest (LLP 0092 §0C.1); compiled by
 * codegen into `generated/routes.manifest.json`. */
export declare function defineRoutes(routes: readonly RouteEntrySpec[]): unknown;

export declare function assert(cond: unknown, message: string): asserts cond;
