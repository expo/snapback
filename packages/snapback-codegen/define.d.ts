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

export interface Validator {
  readonly __validator: true;
  readonly fieldType: 'String' | 'Boolean' | 'Integer' | 'Real' | 'Json';
  readonly primitive: string;
  readonly optional: boolean;
  readonly fields?: Record<string, Validator>;
}

export declare const v: {
  string(): Validator;
  boolean(): Validator;
  integer(): Validator;
  real(): Validator;
  number(): Validator;
  json(): Validator;
  object(fields: Record<string, Validator>): Validator;
  optional(inner: Validator): Validator;
};

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

export declare function defineTable(fields: Record<string, Validator>): unknown;
export declare function defineSchema(tables: Record<string, unknown>, options?: { ephemeral?: unknown }): unknown;
export declare function defineQuery(spec: Record<string, unknown>): unknown;
export declare function defineLiveQuery(spec: Record<string, unknown>): unknown;
export declare function defineJsQuery(spec: Record<string, unknown>): unknown;
export declare function defineJsLiveQuery(spec: Record<string, unknown>): unknown;
export declare function defineMutation(spec: {
  args?: Record<string, Validator>;
  plan: MutationStep | MutationStep[];
  returns?: ReturnSpec;
}): { plan: { steps: MutationStep[]; return_value: ReturnSpec | null } };
export declare function defineJsMutation(spec: {
  args?: Record<string, Validator>;
  source: string;
  exportName: string;
  reads?: string[];
  writes: string[];
  /** Declares the named out-of-profile class keeping this mutation JS-tier;
   * codegen emits the class-specific "outgrew the IR" info diagnostic. */
  outgrewIr?: OutgrewIrClass;
}): unknown;
export declare function defineAction(spec: Record<string, unknown>): unknown;
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
