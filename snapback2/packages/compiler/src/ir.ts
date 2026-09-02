export type ProgramKind = "Query" | "Mutation";
export type Provenance = "Arg" | "Viewer" | "Const" | "Shape" | "Computed";
export type Order = "Asc" | "Desc";

import coreIrContract from "../../../crates/snapback2-core/ir-contract.json" with { type: "json" };

export const IR_CONTRACT = Object.freeze({
  systemPrincipalId: coreIrContract.systemPrincipalId,
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
  | { Scan: Scan };

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
  prefix: Expr[];
  order: Order;
  take: { Literal: number } | { Arg: { name: string; max: number } };
  after: Expr | null;
  before: Expr | null;
  range: { gt: Expr | null; gte: Expr | null; lt: Expr | null; lte: Expr | null } | null;
  provenance: Provenance;
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
  | "Id"
  | "Principal"
  | { Ref: { table: string } }
  | "Int"
  | "Bool"
  | "Time"
  | "Scalar"
  | { Text: { max: number } }
  | { Bytes: { max: number } }
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
  | "E_UNBOUND_SCAN"
  | "E_UNBOUND_LOOP"
  | "E_UNBOUND_COUNT"
  | "E_STRUCTURAL_COUNT"
  | "E_AMBIENT_TIME"
  | "E_OPAQUE"
  | "E_BOUND"
  | "E_ARGS_SPREAD"
  | "E_ARGS_DESCRIPTOR"
  | "E_ARGS_TYPE"
  | "E_OP_INVALID"
  | "E_OP_NONE"
  | "E_OP_RESERVED"
  | "E_OP_MODULE_BASENAME"
  | "E_PROVENANCE_AMBIGUOUS"
  | "E_DIAG_TRUNCATED"
  | "E_SCHEMA_RESERVED"
  | "E_SCHEMA_ID_RESERVED"
  | "E_SCHEMA_UNKNOWN_TABLE"
  | "E_SCHEMA_INDEX_COLUMN"
  | "E_SCHEMA_INDEX_OPTION"
  | "E_SCHEMA_CONSTRAINT"
  | "E_SCHEMA_MAINTAIN"
  | "E_SCHEMA_DEFAULT_EXPORT"
  | "E_SCHEMA_COLUMN"
  | "E_SCHEMA_INVALID"
  | "E_RULE_INVALID"
  | "E_DECIMAL_SCALE"
  | "E_ENUM_VARIANT"
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
  | "E_QUARRY_PLACEMENT";

export type RefusalFamily = "bound" | "opaque" | "schema" | "rule" | "effect" | "args" | "op" | "input" | "quarry";

export type FrontendDiagnostic = {
  code: DiagnosticCode;
  family: RefusalFamily;
  message: string;
  site: string;
  rule?: string;
  rewrite: string;
  guide: string;
};

export type SchemaJson = {
  tables: Record<string, unknown>;
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

export type SourceSite = { file: string; line: number; col: number };

export type ProjectResult =
  | { ok: true; project: ProjectJson; sources: Record<string, SourceSite>; apiDts: string; ms: number }
  | { ok: false; diagnostics: FrontendDiagnostic[]; ms: number };

export type LowerResult =
  | { ok: true; programs: Program[] }
  | { ok: false; diagnostics: FrontendDiagnostic[] };
