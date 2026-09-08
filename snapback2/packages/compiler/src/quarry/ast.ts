import type { RetentionPolicy, IndexComponent } from "../ir";

export type Site = { file: string; line: number; col: number; expandedFrom?: Site; expansionId?: number };

export type ScalarType =
  | { kind: "cursor"; optional: boolean }
  | { kind: "text"; min?: number; max: number; format?: "handle" | "url"; optional: boolean }
  | { kind: "id"; optional: boolean }
  | { kind: "principal"; optional: boolean }
  | { kind: "int"; optional: boolean }
  | { kind: "decimal"; scale: number; optional: boolean }
  | { kind: "money"; currency: string; scale: number; explicitScale?: boolean; optional: boolean }
  | { kind: "time"; optional: boolean }
  | { kind: "bool"; optional: boolean }
  | { kind: "json"; max: number; optional: boolean }
  | { kind: "bytes"; max: number; optional: boolean }
  | { kind: "image"; max: number; once?: boolean; optional: boolean }
  | { kind: "video"; max: number; optional: boolean }
  | { kind: "enum"; variants: string[]; optional: boolean }
  | { kind: "ref"; table: string; optional: boolean }
  | { kind: "list"; item: ScalarType; max: number; optional: boolean };

export type KeyPart = { column?: string; value: Expr; site: Site };

export type ShapeField =
  | { kind: "spread"; site: Site }
  | { kind: "namedSpread"; name: string; site: Site }
  | { kind: "bare"; name: string; site: Site }
  | { kind: "field"; name: string; value: Expr; site: Site };

export type ShapeDecl = { name: string; fields: ShapeField[]; site: Site };
export type ShapeImport = { name: string; module: string; site: Site };
export type FunctionDecl = { name: string; args: ArgDecl[]; body: Expr; site: Site };
export type FunctionImport = { name: string; module: string; site: Site };
/** `proc name(args):` a statement block elaborated at each call under the caller's context (LLP 1018.005). */
export type ProcDecl = { name: string; args: ArgDecl[]; body: Stmt[]; site: Site };
export type ProcImport = { name: string; module: string; site: Site };

export type Expr =
  | { kind: "name"; name: string; site: Site }
  | { kind: "focal"; site: Site }
  | { kind: "literal"; value: string | number | boolean | null; numericText?: string; site: Site }
  | { kind: "array"; items: Expr[]; site: Site }
  | { kind: "object"; fields: ObjectField[]; site: Site }
  | { kind: "unary"; op: "not" | "-"; value: Expr; site: Site }
  | { kind: "binary"; op: string; left: Expr; right: Expr; site: Site }
  | { kind: "member"; base: Expr; name: string; site: Site }
  | { kind: "call"; name: string; args: Expr[]; site: Site }
  | { kind: "read"; table: string; keys: KeyPart[]; index?: string; range?: RangeSpec; site: Site }
  | MergeExpr
  | { kind: "exists"; read: Extract<Expr, { kind: "read" }>; site: Site }
  | { kind: "created"; read: Extract<Expr, { kind: "read" }>; site: Site }
  | { kind: "aggregate"; table: string; keys: KeyPart[]; site: Site }
  | { kind: "assert"; value: Expr; code: string; site: Site }
  | { kind: "shapeUse"; base: Expr; name: string; site: Site }
  | { kind: "shape"; base: Expr; fields: ShapeField[]; authoredName?: string; authoredFields?: ShapeField[]; site: Site }
  | { kind: "walk"; table: string; seed: Expr; column: string; depth: number; site: Site }
  | { kind: "write"; op: "insert" | "update" | "upsert" | "delete"; table: string; keys: KeyPart[]; fields: ObjectField[]; site: Site };

export type ObjectField = { name: string; value?: Expr; site: Site };
export type RangeSpec = {
  order: "asc" | "desc";
  take: number;
  cursor?: Expr;
  cursorKind?: "after";
  /** Refused author intent retained only until the post-catalog repair pass. */
  where?: { predicate: Expr; site: Site };
  /** Internal tag emitted only for scans belonging to one Quarry merge. */
  mergeSite?: string;
  site: Site;
};
export type MergeLane = {
  prefix: Expr[];
  columns?: Array<string | undefined>;
  loop?: { name: string; domain: Extract<Expr, { kind: "read" }> };
  site: Site;
};
export type MergeExpr = {
  kind: "merge";
  table: string;
  index: string;
  order: "asc" | "desc";
  take: number;
  cursor?: Expr;
  cursorKind?: "after";
  lanes: MergeLane[];
  site: Site;
};

export type Stmt =
  | { kind: "bind"; names: string[]; value: Expr; site: Site }
  | { kind: "expr"; value: Expr; site: Site }
  | { kind: "require"; condition: Expr; code: string; site: Site }
  | { kind: "return"; value: Expr; site: Site }
  | { kind: "emit"; effect: string; payload: Expr; site: Site }
  | { kind: "if"; condition: Expr; thenBody: Stmt[]; elseBody: Stmt[]; site: Site }
  | { kind: "for"; name: string; domain: Expr; body: Stmt[]; site: Site }
  | { kind: "match"; read: Extract<Expr, { kind: "read" }>; someName: string; someBody: Stmt[]; noneBody: Stmt[]; site: Site };

export type IndexDecl = { name: string; components: IndexComponent[]; unique: boolean; site: Site };
export type RuleDecl = { effect: "read" | "insert" | "update" | "delete"; bindings: string[]; value: Expr; site: Site };
export type ColumnDecl = { name: string; type: ScalarType; site: Site };
export type FinalExistsDecl = { value: Extract<Expr, { kind: "exists" }>; site: Site };
/** `tombstones <table>[.<column>] if <predicate>`: a delivered row of this table names a row of `table` the client evicts. */
export type TombstoneDecl = { table: string; column: string; predicate: Expr; site: Site };
export type TableDecl = {
  name: string;
  columns: ColumnDecl[];
  indexes: IndexDecl[];
  rules: RuleDecl[];
  immutable: Array<{ columns: string[]; site: Site }>;
  caps: { max: number; by: string[]; site: Site }[];
  finalExists: FinalExistsDecl[];
  tombstones: TombstoneDecl[];
  retain?: { policy: RetentionPolicy; site: Site };
  public?: { reason: string; site: Site };
  site: Site;
};
export type ChannelDecl = { name: string; args: ArgDecl[]; publish: Expr; subscribe: Expr; ttlSeconds: number; site: Site };
export type MaintainDecl = {
  name: string;
  aggregate: "count" | "sum";
  source: string;
  column?: string;
  by: string[];
  read: RuleDecl;
  readable?: RuleDecl;
  site: Site;
};
export type EffectDecl = { name: string; module: string; site: Site };
export type ArgDecl = { name: string; type: ScalarType; site: Site };
export type ProgramDecl = { focalTable?: string; kind: "query" | "mutation" | "job"; name: string; args: ArgDecl[]; body: Stmt[]; site: Site };

export type ScheduleDecl = { name: string; trigger: { row: { table: string; column: string } } | { every: { durationMs: number } }; target: string; args: Expr[]; predicate?: Expr; site: Site };

export type Document = {
  file: string;
  identity: { password: boolean; guests: boolean } | undefined;
  tables: TableDecl[];
  maintains: MaintainDecl[];
  channels: ChannelDecl[];
  effects: EffectDecl[];
  shapes: ShapeDecl[];
  shapeImports: ShapeImport[];
  functions: FunctionDecl[];
  functionImports: FunctionImport[];
  procs: ProcDecl[];
  procImports: ProcImport[];
  programs: ProgramDecl[];
  schedules: ScheduleDecl[];
};

export type QuarryCode = "E_SCHEMA_ASSET_MAINTAIN" | "E_SCHEMA_CONSTRAINT" | "E_SCHEMA_INDEX_COLUMN"
  | "E_SCHEDULE_COLUMN" | "E_SCHEDULE_TARGET" | "E_SCHEDULE_DURATION"
  | "E_DECIMAL_SCALE" | "E_EMIT_IN_QUERY" | "E_OPAQUE" | "E_OP_RESERVED" | "E_UNBOUND_LOOP"
  | "E_QUARRY_SYNTAX" | "E_QUARRY_UNKNOWN" | "E_QUARRY_AMBIGUOUS" | "E_QUARRY_UNSUPPORTED" | "E_QUARRY_PLACEMENT"
  | "E_QUARRY_TYPE" | "E_QUARRY_RETAIN" | "E_QUARRY_TOMBSTONE";
export type QuarryDiagnostic = Site & { code: QuarryCode; message: string; rewrite: string; guide: string; executableRewrite?: boolean };

export type TableCatalog = Map<string, {
  declaration: TableDecl;
  columns: Map<string, ScalarType>;
  indexes: IndexDecl[];
}>;
