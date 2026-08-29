export type ProgramKind = "Query" | "Mutation";
export type Provenance = "Arg" | "Viewer" | "Const" | "Shape" | "Computed";
export type Order = "Asc" | "Desc";

export type Value =
  | "Null"
  | { Bool: boolean }
  | { Int: number }
  | { String: string }
  | { Id: string }
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
  | { Return: Expr }
  | "Break"
  | "Continue";

export type Program = {
  name: string;
  kind: ProgramKind;
  args: Record<string, "Scalar" | { List: { max: number } }>;
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

export type DiagnosticFamily =
  | "E_UNBOUND_SCAN"
  | "E_UNBOUND_LOOP"
  | "E_UNBOUND_COUNT"
  | "E_STRUCTURAL_COUNT"
  | "E_AMBIENT_TIME"
  | "E_OPAQUE"
  | "E_BOUND";

export type FrontendDiagnostic = {
  family: DiagnosticFamily;
  span: Span;
  message: string;
  rewrite: string;
};

export type LowerResult =
  | { ok: true; programs: Program[] }
  | { ok: false; diagnostics: FrontendDiagnostic[] };
