import { basename } from "node:path";
import type { IndexComponent, Provenance } from "../ir";
import type { Expr, IndexDecl, ProgramDecl, ScalarType, Site, TableCatalog, TableDecl } from "./ast";
import { selectIndex } from "./catalog";
import { refuse, typeError, unsupported } from "./diagnostics";

export type BoundSourceStack = { definition: Site; use?: Site };
export type BoundPresence = "required" | "optional";

export type BoundTableSymbol = {
  kind: "table"; id: string; name: string; declaration: TableDecl; source: BoundSourceStack;
};
export type BoundIndexSymbol = {
  kind: "index"; id: string; name: string; declaration: IndexDecl; table: BoundTableSymbol; source: BoundSourceStack;
};
export type BoundArgumentSymbol = {
  kind: "argument"; id: string; name: string; type: ScalarType; source: BoundSourceStack;
};

export type BoundType =
  | ScalarType
  | { kind: "null" }
  | { kind: "row"; table: BoundTableSymbol; nullable: boolean }
  | { kind: "page"; table: BoundTableSymbol; max: number }
  | { kind: "object"; fields: ReadonlyMap<string, BoundValueFacts>; nullable: boolean }
  | { kind: "numeric-literal"; fractionalDigits: number };

export type BoundValueFacts = {
  type: BoundType;
  presence: BoundPresence;
  max?: number;
  origin: Provenance;
  tableOrigin?: BoundTableSymbol;
  readOrigin?: BoundRead;
};

type BoundExpressionBase = { facts: BoundValueFacts; source: BoundSourceStack };
export type BoundExpression = BoundExpressionBase & (
  | { kind: "literal"; value: string | number | boolean | null; numericText?: string }
  | { kind: "variable"; symbol: BoundArgumentSymbol }
  | { kind: "input"; input: "Viewer" | "Now" | "NewId" | "ReadTime" }
  | { kind: "array"; items: BoundExpression[] }
  | { kind: "object"; fields: Array<{ name: string; value: BoundExpression; source: BoundSourceStack }> }
  | { kind: "unary"; op: "Not" | "Neg"; value: BoundExpression }
  | { kind: "binary"; op: string; left: BoundExpression; right: BoundExpression }
  | { kind: "member"; base: BoundExpression; name: string }
  | { kind: "builtin"; builtin: string | Record<string, unknown>; args: BoundExpression[] }
  | { kind: "get" | "exists" | "scan" | "aggregate"; read: BoundRead }
);

export type BoundRead = {
  table: BoundTableSymbol;
  index: BoundIndexSymbol;
  key: BoundExpression[];
  provenance: Provenance;
  source: BoundSourceStack;
  range?: {
    components: IndexComponent[];
    order: "Asc" | "Desc";
    take: number;
    after: BoundExpression | null;
    opaqueCursor: boolean;
  };
};

export type BoundStatement = { kind: "return"; value: BoundExpression; source: BoundSourceStack };
export type BoundQuarryProgram = {
  name: string;
  kind: ProgramDecl["kind"];
  args: BoundArgumentSymbol[];
  result: BoundValueFacts;
  body: BoundStatement[];
  source: BoundSourceStack;
};

/** The direct seam currently accepts expression-return operations only. */
export function bindQuarryProgram(program: ProgramDecl, catalog: TableCatalog): BoundQuarryProgram {
  const statement = program.body[0];
  if (program.focalTable || program.body.length !== 1 || statement?.kind !== "return") {
    unsupported(program.site, "this statement form in the direct Quarry expression seam", "keep it on the parity oracle until direct statement lowering lands");
  }
  const operationName = `${basename(program.site.file, ".q")}.${program.name}`;
  const args = program.args.map((arg, index): BoundArgumentSymbol => ({
    kind: "argument", id: `${operationName}:argument:${index}`, name: arg.name,
    type: structuredClone(arg.type), source: sourceStack(arg.site),
  }));
  const binder = new ExpressionBinder(program, catalog, new Map(args.map((arg) => [arg.name, arg])));
  const value = binder.expression(statement.value);
  return {
    name: operationName, kind: program.kind, args, result: value.facts,
    body: [{ kind: "return", value, source: sourceStack(statement.site) }], source: sourceStack(program.site),
  };
}

class ExpressionBinder {
  constructor(
    private readonly program: ProgramDecl,
    private readonly catalog: TableCatalog,
    private readonly args: Map<string, BoundArgumentSymbol>,
  ) {}

  expression(expression: Expr): BoundExpression {
    const source = sourceStack(expression.site);
    if (expression.kind === "literal") return this.literal(expression);
    if (expression.kind === "name") return this.name(expression.name, expression.site);
    if (expression.kind === "array") {
      const items = expression.items.map((item) => this.expression(item));
      const itemType = items[0]?.facts.type ?? ({ kind: "null" } as const);
      const type: ScalarType = { kind: "list", item: scalarType(itemType, expression.site), max: items.length, optional: false };
      return { kind: "array", items, facts: facts(type, combineOrigins(items), { max: items.length }), source };
    }
    if (expression.kind === "object") {
      const fields = expression.fields.map((field) => ({
        name: field.name,
        value: this.expression(field.value ?? { kind: "name", name: field.name, site: field.site }),
        source: sourceStack(field.site),
      }));
      const type: BoundType = { kind: "object", fields: new Map(fields.map((field) => [field.name, field.value.facts])), nullable: false };
      return { kind: "object", fields, facts: facts(type, combineOrigins(fields.map((field) => field.value))), source };
    }
    if (expression.kind === "unary") {
      const value = this.expression(expression.value);
      const type = expression.op === "not" ? boolType() : value.facts.type;
      return { kind: "unary", op: expression.op === "not" ? "Not" : "Neg", value, facts: facts(type, "Computed"), source };
    }
    if (expression.kind === "binary") return this.binary(expression);
    if (expression.kind === "member") return this.member(expression);
    if (expression.kind === "call") return this.call(expression);
    if (expression.kind === "read") return this.read(expression);
    if (expression.kind === "exists") {
      const read = this.boundRead(expression.read, "exists");
      return { kind: "exists", read, facts: facts(boolType(), "Computed", { readOrigin: read }), source };
    }
    if (expression.kind === "aggregate") {
      const readExpression: Extract<Expr, { kind: "read" }> = {
        kind: "read", table: expression.table, keys: expression.keys, site: expression.site,
      };
      const read = this.boundRead(readExpression, "point");
      const value = this.catalog.get(expression.table)?.columns.get("value");
      if (!value) refuse(expression.site, `#${expression.table}[...] requires a maintained target with a value column`);
      const type = { ...value, optional: false } as ScalarType;
      return { kind: "aggregate", read, facts: facts(type, "Computed", { readOrigin: read }), source };
    }
    if (expression.kind === "created") refuse(expression.site, "created is valid only in an insert table rule");
    if (expression.kind === "shapeUse") refuse(expression.site, `shape ${expression.name} belongs to bound expansion, which has not landed yet`);
    unsupported(expression.site, `${expression.kind} in the direct Quarry expression seam`, "keep this operation on the parity oracle until its bound form lands");
  }

  private literal(expression: Extract<Expr, { kind: "literal" }>): BoundExpression {
    let type: BoundType;
    if (expression.value === null) type = { kind: "null" };
    else if (typeof expression.value === "string") type = { kind: "text", max: Math.max(1, [...expression.value].length), optional: false };
    else if (typeof expression.value === "boolean") type = boolType();
    else {
      const fractionalDigits = decimalPlaces(expression.numericText);
      type = fractionalDigits === 0 ? { kind: "int", optional: false } : { kind: "numeric-literal", fractionalDigits };
    }
    return { kind: "literal", value: expression.value, numericText: expression.numericText,
      facts: facts(type, "Const"), source: sourceStack(expression.site) };
  }

  private name(name: string, site: Site): BoundExpression {
    const source = sourceStack(site);
    const argument = this.args.get(name);
    if (argument) return { kind: "variable", symbol: argument, facts: facts(argument.type, "Arg"), source };
    if (name === "viewer") return { kind: "input", input: "Viewer", facts: facts({ kind: "principal", optional: false }, "Viewer"), source };
    if (name === "now") return { kind: "input", input: this.program.kind === "query" ? "ReadTime" : "Now",
      facts: facts({ kind: "time", optional: false }, "Computed"), source };
    if (name === "commit") return { kind: "input", input: "Now", facts: facts({ kind: "time", optional: false }, "Computed"), source };
    if (name === "new") return { kind: "input", input: "NewId", facts: facts({ kind: "id", optional: false }, "Computed"), source };
    refuse(site, `unknown name ${name}`);
  }

  private binary(expression: Extract<Expr, { kind: "binary" }>): BoundExpression {
    const left = this.expression(expression.left);
    const right = this.expression(expression.right);
    const op = binaryOperator(expression.op);
    if (!op) unsupported(expression.site, `operator ${expression.op}`, "use a comparison, Boolean operator, +, -, or *");
    let type: BoundType;
    if (["Eq", "Ne", "Lt", "Lte", "Gt", "Gte", "And", "Or"].includes(op)) type = boolType();
    else if (expression.op === "??") type = coalescedType(left.facts.type, right.facts.type);
    else if (left.facts.type.kind === "time" && right.facts.type.kind === "time" && op === "Sub") type = { kind: "int", optional: false };
    else type = requiredType(left.facts.type);
    return { kind: "binary", op, left, right, facts: facts(type, "Computed"), source: sourceStack(expression.site) };
  }

  private member(expression: Extract<Expr, { kind: "member" }>): BoundExpression {
    const base = this.expression(expression.base);
    const source = sourceStack(expression.site);
    const baseType = base.facts.type;
    if ((baseType.kind === "list" || baseType.kind === "page") && expression.name === "length") {
      return { kind: "builtin", builtin: "Len", args: [base], facts: facts({ kind: "int", optional: false }, "Computed"), source };
    }
    let type: BoundType | undefined;
    let origin: Provenance = "Computed";
    if (baseType.kind === "row") {
      const column = expression.name === "id"
        ? { kind: "ref", table: baseType.table.name, optional: false } as ScalarType
        : this.catalog.get(baseType.table.name)?.columns.get(expression.name);
      if (column) type = { ...column, optional: column.optional || baseType.nullable } as ScalarType;
      origin = "Shape";
    } else if (baseType.kind === "object") {
      const field = baseType.fields.get(expression.name);
      if (field) type = baseType.nullable ? optionalType(field.type) : field.type;
      origin = field?.origin ?? "Computed";
    } else if (baseType.kind === "image" || baseType.kind === "video") {
      if (["width", "height", "duration"].includes(expression.name)) type = { kind: "int", optional: baseType.optional };
    }
    if (!type) typeError(expression.site, `cannot select .${expression.name} from ${baseType.kind}`, "select a declared row or object field");
    return { kind: "member", base, name: expression.name, facts: facts(type, origin), source };
  }

  private call(expression: Extract<Expr, { kind: "call" }>): BoundExpression {
    if (expression.name === "words") unsupported(expression.site, "words() in direct Quarry", "use an engine-maintained wordPrefixes index");
    const args = expression.args.map((argument) => this.expression(argument));
    const source = sourceStack(expression.site);
    if (expression.name === "tokens") {
      const type: ScalarType = { kind: "list", item: { kind: "text", max: 4096, optional: false }, max: 64, optional: false };
      return { kind: "builtin", builtin: "MentionTokens", args, facts: facts(type, "Computed", { max: 64 }), source };
    }
    if (expression.name === "count") return { kind: "builtin", builtin: "Len", args, facts: facts({ kind: "int", optional: false }, "Computed"), source };
    if (expression.name === "min" || expression.name === "max") {
      if (args.length < 2) typeError(expression.site, `${expression.name} requires at least two arguments`, `use ${expression.name}(a, b)`);
      const builtin = expression.name === "min" ? "Min" : "Max";
      return args.slice(1).reduce<BoundExpression>((left, right) => ({
        kind: "builtin", builtin, args: [left, right], facts: facts(left.facts.type, "Computed"), source,
      }), args[0]!);
    }
    if (expression.name === "divmod" && args.length === 2) {
      const fields = new Map(["quotient", "remainder"].map((name) => [name, facts(requiredType(args[0]!.facts.type), "Computed")]));
      return { kind: "builtin", builtin: { Divmod: { remainder_sink: "lexicographic-id" } }, args,
        facts: facts({ kind: "object", fields, nullable: false }, "Computed"), source };
    }
    if (expression.name === "share" && args.length === 3) {
      return { kind: "builtin", builtin: "DeterministicShare", args, facts: facts(requiredType(args[0]!.facts.type), "Computed"), source };
    }
    unsupported(expression.site, `call ${expression.name}`, "use a direct Quarry pure builtin");
  }

  private read(expression: Extract<Expr, { kind: "read" }>): BoundExpression {
    const read = this.boundRead(expression, expression.range ? "range" : "point");
    if (expression.range) {
      const type: BoundType = { kind: "page", table: read.table, max: expression.range.take };
      return { kind: "scan", read, facts: facts(type, "Shape", { max: expression.range.take, tableOrigin: read.table, readOrigin: read }), source: sourceStack(expression.site) };
    }
    const type: BoundType = { kind: "row", table: read.table, nullable: true };
    return { kind: "get", read, facts: facts(type, "Shape", { tableOrigin: read.table, readOrigin: read }), source: sourceStack(expression.site) };
  }

  private boundRead(expression: Extract<Expr, { kind: "read" }>, mode: "point" | "range" | "exists"): BoundRead {
    const tableInfo = this.catalog.get(expression.table);
    if (!tableInfo) refuse(expression.site, `unknown table ${expression.table}`);
    const table: BoundTableSymbol = { kind: "table", id: `table:${expression.table}`, name: expression.table,
      declaration: tableInfo.declaration, source: sourceStack(tableInfo.declaration.site) };
    const keyed = expression.keys.map((part) => ({ authored: part.value, bound: this.expression(part.value) }));
    const selected = selectIndex(this.catalog, expression.table, expression.keys, mode, expression.index,
      (authored) => scalarForIndex(keyed.find((item) => item.authored === authored)?.bound.facts.type), expression.site);
    const index: BoundIndexSymbol = { kind: "index", id: `${table.id}:index:${selected.name}`, name: selected.name,
      declaration: selected, table, source: sourceStack(selected.site) };
    const after = expression.range?.cursor ? this.expression(expression.range.cursor) : null;
    const range = expression.range && { components: selected.components,
      order: expression.range.order === "desc" ? "Desc" as const : "Asc" as const,
      take: expression.range.take, after, opaqueCursor: after !== null };
    return { table, index, key: keyed.map((item) => item.bound), provenance: combineOrigins(keyed.map((item) => item.bound)),
      source: sourceStack(expression.site), ...(range ? { range } : {}) };
  }
}

function facts(type: BoundType, origin: Provenance, extra: Partial<BoundValueFacts> = {}): BoundValueFacts {
  return { type, presence: presence(type), origin, ...extra };
}
function presence(type: BoundType): BoundPresence {
  if (type.kind === "null") return "optional";
  if (type.kind === "row" || type.kind === "object") return type.nullable ? "optional" : "required";
  return "optional" in type && type.optional ? "optional" : "required";
}
function combineOrigins(expressions: BoundExpression[]): Provenance {
  const origins = expressions.map((expression) => expression.facts.origin);
  if (origins.includes("Computed")) return "Computed";
  const meaningful = new Set(origins.filter((origin) => origin !== "Const"));
  if (meaningful.size === 0) return "Const";
  if (meaningful.size === 1) return [...meaningful][0]!;
  return "Shape";
}
function scalarForIndex(type: BoundType | undefined): ScalarType | undefined {
  if (!type) return undefined;
  if (type.kind === "row") return { kind: "ref", table: type.table.name, optional: type.nullable };
  return isScalar(type) ? type : undefined;
}
function scalarType(type: BoundType, site: Site): ScalarType {
  if (isScalar(type)) return type;
  typeError(site, `bounded arrays require scalar items; got ${type.kind}`, "use scalar array elements");
}
function isScalar(type: BoundType): type is ScalarType {
  return !["null", "row", "page", "object", "numeric-literal"].includes(type.kind);
}
function requiredType(type: BoundType): BoundType {
  if (type.kind === "row" || type.kind === "object") return { ...type, nullable: false };
  if (isScalar(type)) return { ...type, optional: false } as ScalarType;
  return type;
}
function optionalType(type: BoundType): BoundType {
  if (type.kind === "row" || type.kind === "object") return { ...type, nullable: true };
  if (isScalar(type)) return { ...type, optional: true } as ScalarType;
  return type;
}
function coalescedType(left: BoundType, right: BoundType): BoundType {
  if (left.kind === "text" && right.kind === "text") return { ...left, max: Math.max(left.max, right.max), optional: right.optional };
  if (left.kind === "list" && right.kind === "list") return { ...left, max: Math.max(left.max, right.max), optional: right.optional };
  return requiredType(left);
}
function binaryOperator(operator: string): string | undefined {
  return new Map([
    ["=", "Eq"], ["!=", "Ne"], ["<", "Lt"], ["<=", "Lte"], [">", "Gt"], [">=", "Gte"],
    ["+", "Add"], ["-", "Sub"], ["*", "Mul"], ["and", "And"], ["or", "Or"], ["??", "Coalesce"],
  ]).get(operator);
}
function boolType(): Extract<ScalarType, { kind: "bool" }> { return { kind: "bool", optional: false }; }
function decimalPlaces(text: string | undefined): number {
  const dot = text?.indexOf(".") ?? -1;
  return dot < 0 ? 0 : text!.length - dot - 1;
}
function sourceStack(site: Site): BoundSourceStack {
  const definition = withoutExpansion(site);
  return site.expandedFrom ? { definition, use: withoutExpansion(site.expandedFrom) } : { definition };
}
function withoutExpansion(site: Site): Site {
  const { expandedFrom: _expandedFrom, expansionId: _expansionId, ...authored } = site;
  return authored;
}
