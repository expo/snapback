export type Site = { file: string; line: number; col: number };

export type ScalarType =
  | { kind: "text"; max: number; optional: boolean }
  | { kind: "id"; optional: boolean }
  | { kind: "int"; optional: boolean }
  | { kind: "time"; optional: boolean }
  | { kind: "bool"; optional: boolean }
  | { kind: "enum"; variants: string[]; optional: boolean }
  | { kind: "ref"; table: string; optional: boolean }
  | { kind: "list"; item: ScalarType; max: number; optional: boolean };

export type KeyPart = { column?: string; value: Expr; site: Site };

export type ShapeField =
  | { kind: "spread"; site: Site }
  | { kind: "bare"; name: string; site: Site }
  | { kind: "field"; name: string; value: Expr; site: Site };

export type Expr =
  | { kind: "name"; name: string; site: Site }
  | { kind: "focal"; site: Site }
  | { kind: "literal"; value: string | number | boolean | null; site: Site }
  | { kind: "array"; items: Expr[]; site: Site }
  | { kind: "unary"; op: "not" | "-"; value: Expr; site: Site }
  | { kind: "binary"; op: string; left: Expr; right: Expr; site: Site }
  | { kind: "member"; base: Expr; name: string; site: Site }
  | { kind: "call"; name: string; args: Expr[]; site: Site }
  | { kind: "read"; table: string; keys: KeyPart[]; range?: RangeSpec; site: Site }
  | { kind: "exists"; read: Extract<Expr, { kind: "read" }>; site: Site }
  | { kind: "assert"; value: Expr; code: string; site: Site }
  | { kind: "shape"; base: Expr; fields: ShapeField[]; site: Site }
  | { kind: "walk"; table: string; seed: Expr; column: string; depth: number; site: Site }
  | { kind: "write"; op: "insert" | "update" | "upsert" | "delete"; table: string; keys: KeyPart[]; fields: ObjectField[]; site: Site };

export type ObjectField = { name: string; value?: Expr; site: Site };
export type RangeSpec = { order: "asc" | "desc"; take: number; cursor?: Expr; cursorKind?: "after" | "before"; index?: string; site: Site };

export type Stmt =
  | { kind: "bind"; names: string[]; value: Expr; site: Site }
  | { kind: "expr"; value: Expr; site: Site }
  | { kind: "require"; condition: Expr; code: string; site: Site }
  | { kind: "if"; condition: Expr; thenBody: Stmt[]; elseBody: Stmt[]; site: Site }
  | { kind: "for"; name: string; domain: Expr; body: Stmt[]; site: Site }
  | { kind: "match"; read: Extract<Expr, { kind: "read" }>; someName: string; someBody: Stmt[]; noneBody: Stmt[]; site: Site };

export type IndexDecl = { name: string; columns: string[]; unique: boolean; site: Site };
export type RuleDecl = { effect: "read" | "insert" | "update" | "delete"; bindings: string[]; value: Expr; site: Site };
export type ColumnDecl = { name: string; type: ScalarType; site: Site };
export type TableDecl = { name: string; columns: ColumnDecl[]; indexes: IndexDecl[]; rules: RuleDecl[]; publicSite?: Site; site: Site };
export type ChannelDecl = { name: string; args: ArgDecl[]; publish: Expr; subscribe: Expr; ttlSeconds: number; site: Site };
export type ArgDecl = { name: string; type: ScalarType; site: Site };
export type ProgramDecl = { kind: "query" | "mutation"; name: string; args: ArgDecl[]; result?: ScalarType; body: Stmt[]; site: Site };

export type Document = {
  file: string;
  identity: boolean;
  tables: TableDecl[];
  channels: ChannelDecl[];
  programs: ProgramDecl[];
};

export type QuarryDiagnostic = Site & { message: string };

export type TableCatalog = Map<string, {
  declaration: TableDecl;
  columns: Map<string, ScalarType>;
  indexes: IndexDecl[];
}>;
