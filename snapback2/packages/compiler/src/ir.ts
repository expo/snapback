export type ProgramKind = "Query" | "Mutation" | "job";
export type Provenance = "Arg" | "Viewer" | "Const" | "Shape" | "Computed";
export type Order = "Asc" | "Desc";
export type RetentionPolicy = "until-revoked" | "delivered-history";
import type { IndexComponent, IndexKeyExpr, SearchContract } from "../../evaluator/src/search-key";
export type { IndexComponent, IndexKeyExpr, IndexAtom, SearchContract } from "../../evaluator/src/search-key";
export type Index = { components: IndexComponent[]; unique: boolean };

import coreIrContract from "../../../crates/snapback2-core/ir-contract.json" with { type: "json" };

export const IR_CONTRACT = Object.freeze({
  systemPrincipalId: coreIrContract.systemPrincipalId,
  retentionPolicies: coreIrContract.retentionPolicies as readonly RetentionPolicy[],
});

export type Value =
  | "Null"
  | { Bool: boolean }
  | { Int: number }
  | { String: string }
  | { Id: string }
  | { Bytes: string }
  | { Array: Value[] }
  | { Row: Record<string, Value> }
  | { Map: Record<string, Value> };

export type Expr =
  | { Literal: Value }
  | { Variable: string }
  | { Input: "Viewer" | "Now" | "NewId" | "ReadTime" }
  | { Field: { base: Expr; name: string } }
  | { Array: Expr[] }
  | { Object: Record<string, Expr> }
  | { Binary: { op: string; left: Expr; right: Expr } }
  | { Unary: { op: "Not" | "Neg"; value: Expr } }
  | { Builtin: { builtin: string | Record<string, unknown>; args: Expr[] } }
  | { Get: Read }
  | { Exists: Read }
  | { Scan: Scan }
  | { Merge: { site: string; lanes: { setup?: Stmt[]; scan: Scan; source: Scan | null; binding: string }[]; held_search?: HeldSearchDescriptor } };

export type Read = {
  site: string;
  table: string;
  index: string;
  key: Expr[];
  provenance: Provenance;
};

export type Scan = {
  site: string;
  table: string;
  index: string;
  prefix: IndexKeyExpr[];
  order: Order;
  take: { Literal: number } | { Arg: { name: string; max: number } };
  after: Expr | null;
  before: Expr | null;
  range: { gt: Expr | null; gte: Expr | null; lt: Expr | null; lte: Expr | null } | null;
  opaque_cursor?: boolean;
  merge_site?: string | null;
  provenance: Provenance;
};

// @ref LLP 1012#indexed-held-search — the engine revalidates this alternate plan against the actual merge and source rule.
export type HeldSearchDescriptor = {
  table: string;
  index: string;
  term: { source: Expr; contract: SearchContract; source_max: number };
  scope: Array<{ column: string; value: Expr }>;
  suffix: string[];
  order: Order;
  take: Scan["take"];
  after: Expr | null;
  discovery: { scan: Scan; binding: string; authorization_index: string };
};

export type LoopDomain =
  | { Page: Scan }
  | { LiteralRange: { start: number; end_exclusive: number } }
  | { ArgList: { name: string; max: number } }
  | { DerivedArray: { value: Expr; max: number; bound_source: string } }
  | {
      Recurse: {
        site: string;
        table: string;
        index: string;
        seed: Expr;
        next_field: string;
        depth: number;
        fanout: number;
        provenance: Provenance;
      };
    };

export type Stmt =
  | { Const: { name: string; value: Expr } }
  | { Let: { name: string; value: Expr } }
  | { Assign: { name: string; value: Expr } }
  | { Push: { target: string; value: Expr } }
  | { If: { condition: Expr; then_body: Stmt[]; else_body: Stmt[] } }
  | { For: { binding: string; domain: LoopDomain; body: Stmt[] } }
  | { Require: { condition: Expr; code: string } }
  | { Insert: { table: string; row: Expr } }
  | { Update: { table: string; key: Expr; patch: Expr } }
  | { Upsert: { table: string; key: Expr; row: Expr } }
  | { Delete: { table: string; key: Expr } }
  | { Emit: { effect: string; payload: Expr } }
  | { Return: Expr }
  | "Break"
  | "Continue";

export type ArgType =
  | "Cursor"
  | "Id"
  | "Principal"
  | { Ref: { table: string } }
  | "Int"
  | "Bool"
  | "Time"
  | "Scalar"
  | { Text: { max: number; min?: number; format?: "handle" | "url" } }
  | { Bytes: { max: number } }
  | { Image: { max: number } }
  | { Video: { max: number } }
  | { Json: { max_bytes: number } }
  | { Optional: ArgType }
  | { List: { of: ArgType; max: number } }
  | { Enum: { variants: string[] } }
  | { Decimal: { scale: number } }
  | { Money: { currency: string; scale: number } };

export type Program = {
  name: string;
  kind: ProgramKind;
  args: Record<string, ArgType>;
  read_time_granularity_ms: number | null;
  body: Stmt[];
};

export type Span = {
  file: string;
  start: number;
  end: number;
  line: number;
  column: number;
};

export type DiagnosticCode =
  | "E_SCHEDULE_COLUMN"
  | "E_SCHEDULE_TARGET"
  | "E_SCHEDULE_DURATION"
  | "E_UNBOUND_SCAN"
  | "E_UNBOUND_LOOP"
  | "E_STRUCTURAL_COUNT"
  | "E_STRUCTURAL_FANOUT"
  | "E_AMBIENT_TIME"
  | "E_OPAQUE"
  | "E_BOUND"
  | "E_ARGS_TYPE"
  | "E_ARGS_CURSOR_INDEX"
  | "E_ARGS_CURSOR_SHAPE"
  | "E_ARGS_ID_SCALAR"
  | "E_ARGS_ID_TEXT"
  | "E_OP_INVALID"
  | "E_OP_NONE"
  | "E_OP_RESERVED"
  | "E_OP_MODULE_BASENAME"
  | "E_DIAG_TRUNCATED"
  | "E_SCHEMA_RESERVED"
  | "E_SCHEMA_ID_RESERVED"
  | "E_SCHEMA_INDEX_COLUMN"
  | "E_SCHEMA_ASSET_MAINTAIN"
  | "E_SCHEMA_ASSET_SEED"
  | "E_SCHEMA_CONSTRAINT"
  | "E_SCHEMA_MAINTAIN"
  | "E_SCHEMA_DEFAULT_EXPORT"
  | "E_SCHEMA_INVALID"
  | "E_RULE_INVALID"
  | "E_DECIMAL_SCALE"
  | "E_SEED_INVALID"
  | "E_SEED_PERSONA"
  | "E_SEED_TABLE"
  | "E_SEED_ROW"
  | "E_SEED_SHAPE"
  | "E_SEED_VALUE"
  | "E_EFFECT_CLOSURE"
  | "E_EFFECT_TYPE"
  | "E_EFFECT_IMPORT"
  | "E_EFFECT_GRANT"
  | "E_EFFECT_THEN_ARGS"
  | "E_EFFECT_UNKNOWN"
  | "E_EMIT_IN_QUERY"
  | "E_QUARRY_SYNTAX"
  | "E_QUARRY_UNKNOWN"
  | "E_QUARRY_AMBIGUOUS"
  | "E_QUARRY_UNSUPPORTED"
  | "E_QUARRY_PLACEMENT"
  | "E_QUARRY_TYPE"
  | "E_QUARRY_RETAIN"
  | "E_QUARRY_TOMBSTONE"
  | "E_QUARRY_ONLY";

export type RefusalFamily = "schedule" | "bound" | "opaque" | "schema" | "rule" | "effect" | "args" | "op" | "input" | "quarry";

export type FrontendDiagnostic = {
  code: DiagnosticCode;
  family: RefusalFamily;
  message: string;
  site: string;
  rule?: string;
  rewrite: string;
  guide: string;
};

export type TableJson = {
  retain: RetentionPolicy;
  /** Present only when the table declares `tombstones`; `when` is the rule-expression encoding. */
  tombstones?: Array<{ table: string; column: string; when: unknown }>;
  [key: string]: unknown;
};

export type SchemaJson = {
  schedules?: Array<{ name: string; trigger: unknown; target: string; binding: string; site: string }>;
  tables: Record<string, TableJson>;
  maintains: unknown[];
  channels: Record<string, unknown>;
  auth: { password: boolean; guests: boolean };
  effects: string[];
};

export type EffectJson = {
  name: string;
  grants: string[];
  source: string;
  then: string | null;
};

export type ProjectJson = {
  schema: SchemaJson;
  programs: Program[];
  effects: EffectJson[];
};

export type SourceSite = { file: string; line: number; col: number; text?: string; use?: SourceSite; guard?: string; requirement?: string };
export type QuarryGenerated = { file: string; generated: string; source: string };

export type ProjectResult =
  | { ok: true; project: ProjectJson; sources: Record<string, SourceSite>; apiDts: string; quarry: QuarryGenerated[]; ms: number }
  | { ok: false; diagnostics: FrontendDiagnostic[]; ms: number };

export type LowerResult =
  | { ok: true; programs: Program[] }
  | { ok: false; diagnostics: FrontendDiagnostic[] };
