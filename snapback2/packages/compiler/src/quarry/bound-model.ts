import type { IndexComponent, Provenance } from "../ir";
import type { IndexDecl, ProgramDecl, ScalarType, Site, TableDecl } from "./ast";

export type BoundSourceStack = { definition: Site; use?: Site };
export type BoundPresence = "required" | "optional";

export type BoundTableSymbol = {
  kind: "table"; id: string; name: string; declaration: TableDecl; source: BoundSourceStack;
};
export type BoundIndexSymbol = {
  kind: "index"; id: string; name: string; declaration: IndexDecl; table: BoundTableSymbol; source: BoundSourceStack;
};
export type BoundArgumentSymbol = {
  kind: "argument"; id: string; name: string; type: ScalarType; origin: Provenance; source: BoundSourceStack;
  narrowedMembers?: ReadonlySet<string>;
};
export type BoundLocalSymbol = {
  kind: "local"; id: string; name: string; facts: BoundValueFacts; source: BoundSourceStack;
  narrowedMembers?: ReadonlySet<string>;
};
export type BoundValueSymbol = BoundArgumentSymbol | BoundLocalSymbol;

export type BoundType =
  | ScalarType
  | { kind: "unknown" }
  | { kind: "null" }
  | { kind: "empty-list"; max: 0 }
  | { kind: "row"; table: BoundTableSymbol; nullable: boolean }
  | { kind: "page"; table: BoundTableSymbol; max: number; item?: BoundValueFacts }
  | { kind: "collection"; item: BoundValueFacts; max: number }
  | { kind: "object"; fields: ReadonlyMap<string, BoundValueFacts>; nullable: boolean }
  | { kind: "numeric-literal"; fractionalDigits: number };

export type BoundValueFacts = {
  type: BoundType;
  presence: BoundPresence;
  max?: number;
  /** This int, or every int item in this list, still represents authored whole units. */
  wholeUnits?: true;
  origin: Provenance;
  fieldProjection?: "inherited-row" | "constructed";
  tableOrigin?: BoundTableSymbol;
  readOrigin?: BoundRead;
};

type BoundExpressionBase = { facts: BoundValueFacts; source: BoundSourceStack };
export type BoundExpression = BoundExpressionBase & (
  | { kind: "literal"; value: string | number | boolean | null; numericText?: string; wireValue?: number; wireKind?: "id" }
  | { kind: "variable"; symbol: BoundValueSymbol }
  | { kind: "focal"; id: string }
  | { kind: "input"; input: "Viewer" | "Now" | "NewId" | "ReadTime" }
  | { kind: "array"; items: BoundExpression[] }
  | { kind: "scale"; value: BoundExpression; multiplier: number; preserveNull: boolean }
  | { kind: "scale-list"; value: BoundExpression; multiplier: number; max: number; preserveNull: boolean }
  | { kind: "object"; fields: Array<{ name: string; value: BoundExpression; source: BoundSourceStack }> }
  | { kind: "unary"; op: "Not" | "Neg"; value: BoundExpression }
  | { kind: "binary"; op: string; left: BoundExpression; right: BoundExpression; scaleDivisor?: number }
  | { kind: "assert"; value: BoundExpression; code: string }
  | { kind: "member"; base: BoundExpression; name: string }
  | { kind: "shape"; base: BoundExpression; focal: Extract<BoundExpression, { kind: "focal" }>;
      fields: Array<{ name: string; value: BoundExpression; source: BoundSourceStack }> }
  | { kind: "builtin"; builtin: string | Record<string, unknown>; args: BoundExpression[] }
  | { kind: "invoke"; bindings: Array<{
      symbol: BoundArgumentSymbol;
      value: BoundExpression;
      coercion?: "row-id";
    }>; body: BoundExpression }
  | { kind: "range"; start: number; end: number; max: number }
  | { kind: "walk"; site: string; table: BoundTableSymbol; index: BoundIndexSymbol;
      seed: BoundExpression; column: string; depth: number }
  | { kind: "merge"; site: string; table: BoundTableSymbol; index: BoundIndexSymbol;
      lanes: BoundMergeLane[]; heldSearch?: BoundHeldSearch }
  | { kind: "write"; op: "insert" | "update" | "upsert" | "delete";
      table: BoundTableSymbol; index?: BoundIndexSymbol; key: BoundExpression[];
      fields: Array<{ name: string; value: BoundExpression; expected: ScalarType; coercion?: "row-id"; source: BoundSourceStack }>;
      focal?: Extract<BoundExpression, { kind: "focal" }>; usesFocal: boolean; addressedColumns: string[]; provenance: Provenance }
  | { kind: "get" | "exists" | "scan" | "aggregate"; read: BoundRead }
);

export type BoundRead = {
  table: BoundTableSymbol;
  index: BoundIndexSymbol;
  key: BoundExpression[];
  provenance: Provenance;
  source: BoundSourceStack;
  skipNullKey?: boolean;
  range?: {
    components: IndexComponent[];
    order: "Asc" | "Desc";
    take: number;
    after: BoundExpression | null;
    opaqueCursor: boolean;
    mergeSite?: string;
  };
};

export type BoundMergeLane = {
  sourceRead?: BoundRead;
  symbol?: BoundLocalSymbol;
  scan: BoundRead;
  source: BoundSourceStack;
};

export type BoundHeldSearch = {
  term: BoundExpression;
  termComponent: Extract<IndexComponent, { WordPrefixes: unknown }>;
  scope: Array<{ column: string; value: BoundExpression }>;
  suffix: string[];
  authorizationIndex: string;
};

export type BoundStatement =
  | { kind: "return"; value: BoundExpression; source: BoundSourceStack }
  | { kind: "expr"; value: BoundExpression; completion: boolean; source: BoundSourceStack }
  | { kind: "bind"; symbols: BoundLocalSymbol[]; tupleFields?: string[]; value: BoundExpression; source: BoundSourceStack }
  | { kind: "require"; condition: BoundExpression; code: string; source: BoundSourceStack }
  | { kind: "emit"; effect: string; payload: BoundExpression; source: BoundSourceStack }
  | { kind: "if"; condition: BoundExpression; thenBody: BoundStatement[]; elseBody: BoundStatement[]; source: BoundSourceStack }
  | { kind: "for"; symbol: BoundLocalSymbol; domain: BoundExpression; body: BoundStatement[]; source: BoundSourceStack }
  | { kind: "match"; value: BoundExpression & { kind: "get" }; symbol: BoundLocalSymbol;
      someBody: BoundStatement[]; noneBody: BoundStatement[]; source: BoundSourceStack };
export type BoundQuarryProgram = {
  name: string;
  kind: ProgramDecl["kind"];
  args: BoundArgumentSymbol[];
  focal?: Extract<BoundExpression, { kind: "focal" }>;
  result: BoundValueFacts;
  body: BoundStatement[];
  source: BoundSourceStack;
};
