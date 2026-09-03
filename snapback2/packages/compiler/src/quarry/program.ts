import type {
  Expr,
  EffectDecl,
  IndexDecl,
  KeyPart,
  MergeExpr,
  ObjectField,
  ProgramDecl,
  ScalarType,
  ShapeField,
  Site,
  Stmt,
  TableCatalog,
} from "./ast";
import { selectIndex } from "./catalog";
import { refuse, typeError, unsupported } from "./diagnostics";
import { header, siteMark, typeCode } from "./schema";

type ObjectType = { kind: "object"; fields: Map<string, ValueType>; nullable: boolean };
type SequenceType = { kind: "sequence"; item: ValueType; max: number };
type NumericLiteralType = { kind: "numeric-literal"; fractionalDigits: number };
type ValueType =
  | ScalarType
  | { kind: "row"; table: string; nullable: boolean }
  | { kind: "page"; table: string }
  | SequenceType
  | ObjectType
  | NumericLiteralType
  | { kind: "unknown" };
type Binding = { code: string; type: ValueType };
type Completion = { kind: "return" } | { kind: "assign"; name: string };
type Emitted = Binding & { effectOnly?: boolean };

class Writer {
  readonly lines: string[] = [];
  indent = 0;
  private lastSite: Site;
  constructor(site: Site) { this.lastSite = site; }
  raw(text = "", site?: Site): void {
    if (site) this.lastSite = site;
    this.lines.push(text ? `${"  ".repeat(this.indent)}${text} ${siteMark(site ?? this.lastSite)}` : "");
  }
  statement(text: string, site: Site): void { this.raw(text, site); }
  nested(run: () => void): void { this.indent += 1; run(); this.indent -= 1; }
}

class Environment {
  readonly bindings = new Map<string, Binding>();
  focal?: Binding;
  inlineComparisons = false;

  constructor(readonly catalog: TableCatalog, readonly program: ProgramDecl, readonly effects: Set<string>) {
    for (const arg of program.args) this.bindings.set(arg.name, { code: `args.${arg.name}`, type: arg.type });
  }

  clone(): Environment {
    const clone = new Environment(this.catalog, this.program, this.effects);
    clone.bindings.clear();
    for (const [name, binding] of this.bindings) clone.bindings.set(name, { ...binding });
    clone.focal = this.focal && { ...this.focal };
    clone.inlineComparisons = this.inlineComparisons;
    return clone;
  }
}

export function emitPrograms(programs: ProgramDecl[], catalog: TableCatalog, sourceFile: string, effects: EffectDecl[] = []): string {
  const rootSite = programs[0]?.site ?? effects[0]?.site ?? { file: sourceFile, line: 1, col: 1 };
  const writer = new Writer(rootSite);
  writer.raw(header(sourceFile), rootSite);
  writer.statement(`import { deterministicShare, divmod, emit, max, mergeByIndex, mentionTokens, min, mutation, query, range, recurse, t } from "snapback2";`, { file: sourceFile, line: 1, col: 1 });
  if (catalog.size > 0) writer.statement(`import { ${[...catalog.keys()].join(", ")} } from "./schema";`, { file: sourceFile, line: 1, col: 1 });
  for (const effect of effects) writer.statement(`import { ${effect.name} } from "./${effect.module}";`, effect.site);
  writer.raw();
  writer.statement(`function orderedPair(left: any, right: any): [any, any] { return [left, right]; }`, { file: sourceFile, line: 1, col: 1 });
  writer.raw();
  for (const program of programs) {
    emitProgram(program, catalog, writer, new Set(effects.map((effect) => effect.name)));
    writer.raw();
  }
  return `${writer.lines.join("\n").trimEnd()}\n`;
}

function emitProgram(program: ProgramDecl, catalog: TableCatalog, writer: Writer, effects: Set<string>): void {
  const env = new Environment(catalog, program, effects);
  const args = program.args.map((arg) => `${property(arg.name)}: ${typeCode(arg.type)}`).join(", ");
  writer.raw(`export const ${program.name} = ${program.kind}({ ${args} }, ({ db, ctx, args }) => {`, program.site);
  writer.nested(() => emitBody(program.body, env, writer, { kind: "return" }));
  writer.statement(`});`, program.site);
}

function emitBody(body: Stmt[], env: Environment, writer: Writer, completion?: Completion, discardLast = false): void {
  if (body.length === 0) {
    if (completion?.kind === "return") writer.statement("return null;", env.program.site);
    else if (completion?.kind === "assign") writer.statement(`${completion.name} = null;`, env.program.site);
    return;
  }
  for (const [index, statement] of body.entries()) {
    const isLast = index === body.length - 1;
    emitStatement(statement, env, writer, isLast ? completion : undefined, isLast && discardLast);
  }
}

function emitStatement(statement: Stmt, env: Environment, writer: Writer, completion?: Completion, discard = false): void {
  if (statement.kind === "bind") {
    if (statement.names.length > 1) {
      if (statement.names.length !== 2 || statement.value.kind !== "call" || statement.value.name !== "sorted" || statement.value.args.length !== 2) {
        refuse(statement.site, "tuple bindings are supported only as (a, b) = sorted(a, b)");
      }
      const left = emitExpr(statement.value.args[0]!, env, writer);
      const right = emitExpr(statement.value.args[1]!, env, writer);
      writer.statement(`const [${statement.names.join(", ")}] = orderedPair(${left.code}, ${right.code});`, statement.site);
      env.bindings.set(statement.names[0]!, { code: statement.names[0]!, type: left.type });
      env.bindings.set(statement.names[1]!, { code: statement.names[1]!, type: right.type });
    } else {
      const value = emitExpr(statement.value, env, writer);
      if (value.effectOnly) refuse(statement.site, "update/upsert/delete do not yield a value; bind a following point read instead");
      const name = statement.names[0]!;
      writer.statement(`const ${name} = ${value.code};`, statement.site);
      env.bindings.set(name, { code: name, type: value.type });
    }
    finishNull(completion, writer, statement.site);
    return;
  }
  if (statement.kind === "require") {
    const condition = emitExpr(statement.condition, env, writer);
    requireBoolean(statement.condition, condition.type, "require");
    writer.statement(`db.require(${condition.code}, ${JSON.stringify(statement.code)});`, statement.site);
    finishNull(completion, writer, statement.site);
    return;
  }
  if (statement.kind === "return") {
    const value = emitExpr(statement.value, env, writer);
    writer.statement(`return ${value.effectOnly ? "null" : value.code};`, statement.site);
    return;
  }
  if (statement.kind === "emit") {
    if (!env.effects.has(statement.effect)) refuse(statement.site, `unknown effect ${statement.effect}; declare effect ${statement.effect} from <module>`);
    const payload = emitExpr(statement.payload, env, writer);
    writer.statement(`emit(${statement.effect}, ${payload.code});`, statement.site);
    finishNull(completion, writer, statement.site);
    return;
  }
  if (statement.kind === "expr") {
    const value = emitExpr(statement.value, env, writer);
    if (completion) {
      const code = value.effectOnly ? "null" : value.code;
      if (completion.kind === "return") writer.statement(`return ${code};`, statement.site);
      else if (statement.value.kind === "write" && statement.value.op === "insert") {
        const inserted = temporary("inserted", statement.site);
        writer.statement(`const ${inserted} = ${code};`, statement.site);
        writer.statement(`${completion.name} = ${inserted};`, statement.site);
      } else writer.statement(`${completion.name} = ${code};`, statement.site);
    } else if (discard && !value.effectOnly) {
      if (statement.value.kind === "write" && statement.value.op === "insert") writer.statement(`${value.code};`, statement.site);
      else writer.statement(`const ${temporary("discard", statement.site)} = ${value.code};`, statement.site);
    } else if (!value.effectOnly) {
      if (statement.value.kind !== "write" || statement.value.op !== "insert") {
        refuse(statement.site, "a non-final expression must be a write; bind it if its value is needed");
      }
      writer.statement(`${value.code};`, statement.site);
    }
    return;
  }
  if (statement.kind === "if") {
    const condition = emitExpr(statement.condition, env, writer);
    requireBoolean(statement.condition, condition.type, "if");
    writer.raw(`if (${condition.code}) {`, statement.site);
    writer.nested(() => emitBody(statement.thenBody, env.clone(), writer, completion));
    if (statement.elseBody.length > 0) {
      writer.raw("} else {", statement.site);
      writer.nested(() => emitBody(statement.elseBody, env.clone(), writer, completion));
    } else if (completion) {
      writer.raw("} else {", statement.site);
      writer.nested(() => finishNull(completion, writer, statement.site));
    }
    writer.statement("}", statement.site);
    return;
  }
  if (statement.kind === "for") {
    const domain = emitExpr(statement.domain, env, writer);
    const itemType = domain.type.kind === "page"
      ? { kind: "row", table: domain.type.table, nullable: false } satisfies ValueType
      : domain.type.kind === "sequence" || domain.type.kind === "list" ? domain.type.item : { kind: "unknown" } satisfies ValueType;
    if (domain.type.kind !== "page" && domain.type.kind !== "sequence" && domain.type.kind !== "list" && domain.type.kind !== "unknown") {
      refuse(statement.domain.site, "for domains must be a page, capped list argument, range, tokens result, or literal list");
    }
    writer.raw(`for (const ${statement.name} of ${domain.code}) {`, statement.site);
    writer.nested(() => {
      const nested = env.clone();
      nested.bindings.set(statement.name, { code: statement.name, type: itemType });
      emitBody(statement.body, nested, writer);
    });
    writer.statement("}", statement.site);
    finishNull(completion, writer, statement.site);
    return;
  }
  emitMatch(statement, env, writer, completion);
}

function emitMatch(statement: Extract<Stmt, { kind: "match" }>, env: Environment, writer: Writer, completion?: Completion): void {
  const found = emitRead(statement.read, env, writer);
  const local = temporary("match", statement.site);
  writer.statement(`const ${local} = ${found.code};`, statement.site);
  const discardBranchValues = completion === undefined;
  let branchCompletion = completion;
  let result: string | undefined;
  if (completion?.kind === "return") {
    result = temporary("matchResult", statement.site);
    writer.statement(`let ${result}: any = null;`, statement.site);
    branchCompletion = { kind: "assign", name: result };
  }
  writer.raw(`if (${local} !== null) {`, statement.site);
  writer.nested(() => {
    const nested = env.clone();
    nested.bindings.set(statement.someName, { code: statement.someName, type: { kind: "row", table: statement.read.table, nullable: false } });
    writer.statement(`const ${statement.someName} = ${local};`, statement.site);
    emitBody(statement.someBody, nested, writer, branchCompletion, discardBranchValues);
  });
  writer.raw("} else {", statement.site);
  writer.nested(() => emitBody(statement.noneBody, env.clone(), writer, branchCompletion, discardBranchValues));
  writer.statement("}", statement.site);
  if (result) writer.statement(`return ${result};`, statement.site);
}

function finishNull(completion: Completion | undefined, writer: Writer, site: Site): void {
  if (!completion) return;
  if (completion.kind === "return") writer.statement("return null;", site);
  else writer.statement(`${completion.name} = null;`, site);
}

function emitExpr(expr: Expr, env: Environment, writer: Writer): Emitted {
  if (expr.kind === "literal") return { code: literalCode(expr), type: literalType(expr) };
  if (expr.kind === "name") return emitName(expr.name, expr.site, env);
  if (expr.kind === "focal") {
    if (!env.focal) refuse(expr.site, ". is available only inside a shape or write patch");
    return env.focal;
  }
  if (expr.kind === "array") {
    const items = expr.items.map((item) => emitExpr(item, env, writer));
    const item = items[0]?.type ?? { kind: "unknown" } satisfies ValueType;
    return { code: `[${items.map((value) => value.code).join(", ")}]`, type: { kind: "list", item: scalarOrUnknown(item), max: items.length, optional: false } };
  }
  if (expr.kind === "object") {
    const types = new Map<string, ValueType>();
    const fields = expr.fields.map((field) => {
      const value = emitExpr(field.value ?? { kind: "name", name: field.name, site: field.site }, env, writer);
      types.set(field.name, value.type);
      return `${property(field.name)}: ${value.code}`;
    });
    return { code: `{ ${fields.join(", ")} }`, type: { kind: "object", fields: types, nullable: false } };
  }
  if (expr.kind === "unary") {
    const value = emitExpr(expr.value, env, writer);
    if (expr.op === "not") requireBoolean(expr.value, value.type, "not");
    if (expr.op === "-" && !numericAmountType(value.type)) {
      const optionalNumeric = ["int", "decimal", "money"].includes(value.type.kind) && "optional" in value.type && value.type.optional;
      if (optionalNumeric) typeError(expr.site, "negation requires a present int, decimal, or money value", "require presence first: -(value!) or -(value ?? 0)");
      else typeError(expr.site, "negation requires an int, decimal, or money value", "negate an int, decimal, or money value");
    }
    return { code: `${expr.op === "not" ? "!" : "-"}(${value.code})`, type: expr.op === "not" ? boolType() : value.type };
  }
  if (expr.kind === "binary") return emitBinary(expr, env, writer);
  if (expr.kind === "member") return emitMember(expr, env, writer);
  if (expr.kind === "call") return emitCall(expr, env, writer);
  if (expr.kind === "read") return emitRead(expr, env, writer);
  if (expr.kind === "merge") return emitMerge(expr, env, writer);
  if (expr.kind === "exists") {
    const read = emitRead(expr.read, env, writer, true);
    return { code: read.code, type: boolType() };
  }
  if (expr.kind === "created") refuse(expr.site, "created is valid only in an insert table rule");
  if (expr.kind === "aggregate") {
    const read = emitRead({ kind: "read", table: expr.table, keys: expr.keys, site: expr.site }, env, writer);
    const value = env.catalog.get(expr.table)?.columns.get("value");
    if (!value) refuse(expr.site, `#${expr.table}[...] requires a maintained target with a value column`);
    // @ref LLP 1001#4-generation-and-runtime-registryrs-successorrs — aggregate absence becomes typed zero once, before the value enters ordinary IR expressions.
    const local = temporary("agg", expr.site);
    writer.statement(`const ${local} = ${read.code}?.value ?? 0;`, expr.site);
    return { code: local, type: { ...value, optional: false } };
  }
  if (expr.kind === "assert") {
    const value = emitExpr(expr.value, env, writer);
    const local = temporary("required", expr.site);
    writer.statement(`const ${local} = ${value.code};`, expr.site);
    writer.statement(`db.require(${local} !== null, ${JSON.stringify(expr.code)});`, expr.site);
    return { code: `${local}!`, type: nonNullable(value.type) };
  }
  if (expr.kind === "shape") return emitShape(expr, env, writer);
  if (expr.kind === "walk") {
    const info = env.catalog.get(expr.table);
    if (!info) refuse(expr.site, `unknown table ${expr.table}`);
    const column = info.columns.get(expr.column);
    if (column?.kind !== "ref" || column.table !== expr.table) refuse(expr.site, `walk ${expr.table} up .${expr.column} requires a self-reference column`);
    const seed = emitExpr(expr.seed, env, writer);
    const walked = temporary("walk", expr.site);
    const current = temporary("ancestor", expr.site);
    writer.statement(`const ${walked}: any[] = [];`, expr.site);
    writer.raw(`for (const ${current} of recurse(${seed.code}, (current) => db.get(${expr.table}, current.${expr.column}), { depth: ${expr.depth}, fanout: 1 })) {`);
    writer.nested(() => writer.statement(`${walked}.push(${current});`, expr.site));
    writer.statement("}", expr.site);
    return {
      code: walked,
      type: { kind: "sequence", item: { kind: "row", table: expr.table, nullable: false }, max: expr.depth + 1 },
    };
  }
  return emitWrite(expr, env, writer);
}

function emitName(name: string, site: Site, env: Environment): Emitted {
  const binding = env.bindings.get(name);
  if (binding) return binding;
  if (name === "viewer") return { code: "ctx.viewer", type: { kind: "principal", optional: false } };
  if (name === "now") return { code: "ctx.now()", type: { kind: "time", optional: false } };
  if (name === "commit") return { code: "ctx.commitTime", type: { kind: "time", optional: false } };
  if (name === "new") return { code: "ctx.newId()", type: { kind: "id", optional: false } };
  refuse(site, `unknown name ${name}`);
}

function emitBinary(expr: Extract<Expr, { kind: "binary" }>, env: Environment, writer: Writer): Emitted {
  const left = emitExpr(expr.left, env, writer);
  const right = emitExpr(expr.right, env, writer);
  if (expr.op === "and" || expr.op === "or") {
    requireBoolean(expr.left, left.type, expr.op);
    requireBoolean(expr.right, right.type, expr.op);
    return { code: `(${left.code} ${expr.op === "and" ? "&&" : "||"} ${right.code})`, type: boolType() };
  }
  if (expr.op === "??") return { code: `(${left.code} ?? ${right.code})`, type: nonNullable(left.type) };
  const operator = expr.op === "=" ? "===" : expr.op === "!=" ? "!==" : expr.op;
  // @ref LLP 1010#a2-total-equality--program-only — program equality is total;
  // only ordered comparison requires present operands.
  if (["=", "!=", "<", "<=", ">", ">="].includes(expr.op)) {
    if ((expr.op === "=" || expr.op === "!=") && expr.right.kind === "literal" && expr.right.value === null) {
      return { code: `(${left.code} ${expr.op === "=" ? "===" : "!=="} null)`, type: boolType() };
    }
    refuseFractionalInt(expr, left.type, right.type);
    const branded = brandedType(left.type) ?? brandedType(right.type);
    const other = branded === left.type ? right : left;
    const otherExpr = branded === left.type ? expr.right : expr.left;
    if (branded && !brandedType(other.type) && !numericLiteral(otherExpr)) {
      typeError(
        expr.site,
        `cannot compare nominal ${brandedName(branded)} with ${valueTypeName(other.type)}`,
        `compare ${simpleExpr(branded === left.type ? expr.left : expr.right)} with the same ${brandedName(branded)} type`,
      );
    }
    if (!branded && isScalar(left.type) && isScalar(right.type) && !compatible(left.type, right.type)) {
      refuse(expr.site, `cannot compare nominal ${left.type.kind} with ${right.type.kind}; use a principal value only with viewer`);
    }
    if (["<", "<=", ">", ">="].includes(expr.op) && (isNullableValue(left.type) || isNullableValue(right.type))) {
      const leftText = optionalComparisonOperand(expr.left, left.type);
      const rightText = optionalComparisonOperand(expr.right, right.type);
      typeError(
        expr.site,
        `ordered comparison ${expr.op} requires present operands`,
        `${leftText} ${expr.op} ${rightText}`,
      );
    }
    return { code: `(${left.code} ${operator} ${right.code})`, type: boolType() };
  }
  refuseFractionalInt(expr, left.type, right.type);
  const branded = brandedType(left.type) ?? brandedType(right.type);
  // @ref LLP 1004#money-and-decimal-worked-out-2026-09-03 — branded loss of scale is explicit Euclidean divmod, never host-number rounding.
  if (branded && (expr.op === "/" || expr.op === "%")) {
    const member = expr.op === "/" ? "quotient" : "remainder";
    typeError(expr.site, `${brandedName(branded)} does not admit ${expr.op}`, `use divmod(${simpleExpr(expr.left)}, ${simpleExpr(expr.right)}).${member}`);
  }
  if (branded && (expr.op === "+" || expr.op === "-")) {
    const other = branded === left.type ? right : left;
    const otherExpr = branded === left.type ? expr.right : expr.left;
    if (!brandedType(other.type) && !numericLiteral(otherExpr)) {
      typeError(expr.site, `${expr.op} requires matching ${brandedName(branded)} values`, `use two matching ${brandedName(branded)} values`);
    }
    return { code: `(${left.code} ${expr.op} ${right.code})`, type: branded };
  }
  if (branded && expr.op === "*") {
    const leftBrand = brandedType(left.type);
    const rightBrand = brandedType(right.type);
    if (leftBrand && rightBrand) {
      if (leftBrand.kind === "money" && rightBrand.kind === "money") {
        typeError(
          expr.site,
          "money multiplied by money has no currency-squared value in Quarry",
          "multiply the money value by a decimal rate or an int",
        );
      }
      const dropped = leftBrand.kind === "money" ? rightBrand
        : rightBrand.kind === "money" ? leftBrand
          : rightBrand;
      const result = leftBrand.kind === "money" ? leftBrand
        : rightBrand.kind === "money" ? rightBrand
          : leftBrand;
      const divisor = 10 ** dropped.scale;
      return { code: `divmod((${left.code} * ${right.code}), ${divisor}).quotient`, type: result };
    }
    const other = branded === left.type ? right : left;
    const otherExpr = branded === left.type ? expr.right : expr.left;
    if (!brandedType(other.type) && (other.type.kind !== "int" || fractionalNumericLiteral(otherExpr))) {
      typeError(
        expr.site,
        `${brandedName(branded)} multiplication requires an int operand or a decimal-typed rate; a bare fractional literal has no scale`,
        "use an int operand or declare the rate as a decimal S argument or column",
      );
    }
    return { code: `(${left.code} * ${right.code})`, type: branded };
  }
  return { code: `(${left.code} ${expr.op} ${right.code})`, type: left.type };
}

function emitMember(expr: Extract<Expr, { kind: "member" }>, env: Environment, writer: Writer): Emitted {
  let base = emitExpr(expr.base, env, writer);
  if (isRef(base.type)) {
    const refType = base.type;
    if (!refType.table) refuse(expr.site, `cannot auto-dereference ${expr.name} because the reference target is not known; use a typed table ref`);
    const local = temporary("deref", expr.site);
    if (refType.optional) {
      const key = temporary("derefKey", expr.site);
      writer.statement(`const ${key} = ${base.code} ?? null;`, expr.site);
      writer.statement(`let ${local}: any = null;`, expr.site);
      writer.raw(`if (${key} !== null) {`);
      writer.nested(() => writer.statement(`${local} = db.get(${refType.table}, ${key});`, expr.site));
      writer.statement("}", expr.site);
    } else {
      writer.statement(`const ${local} = db.get(${refType.table}, ${base.code});`, expr.site);
    }
    base = { code: local, type: { kind: "row", table: refType.table, nullable: true } };
  }
  if (base.type.kind === "image" || base.type.kind === "video") {
    // @ref LLP 1006#3-authoring-surface — assets are closed records, so admission facts use ordinary field selection.
    const fields = base.type.kind === "image"
      ? ["id", "width", "height"]
      : ["id", "width", "height", "duration"];
    if (!fields.includes(expr.name)) {
      typeError(
        expr.site,
        `${base.type.kind} asset has no field ${expr.name}; available fields are ${fields.join(", ")}`,
        `${simpleExpr(expr.base)}.${base.type.kind === "video" ? "duration" : "width"}`,
      );
    }
    const field: ScalarType = expr.name === "id"
      ? { kind: "id", optional: base.type.optional }
      : { kind: "int", optional: base.type.optional };
    return { code: `${base.code}${base.type.optional ? "?." : "."}${expr.name}`, type: field };
  }
  if (base.type.kind === "row") {
    const info = env.catalog.get(base.type.table);
    const column = expr.name === "id"
      ? { kind: "ref", table: base.type.table, optional: false } satisfies ScalarType
      : info?.columns.get(expr.name);
    if (!column) refuse(expr.site, `table ${base.type.table} has no column ${expr.name}`);
    return { code: `${base.code}${base.type.nullable ? "?." : "."}${expr.name}`, type: { ...column, optional: column.optional || base.type.nullable } };
  }
  if (base.type.kind === "object") {
    const field = base.type.fields.get(expr.name);
    if (!field) refuse(expr.site, `shaped object has no field ${expr.name}`);
    return {
      code: `${base.code}${base.type.nullable ? "?." : "."}${expr.name}`,
      type: base.type.nullable ? nullableValue(field) : field,
    };
  }
  if (base.type.kind === "json") return { code: `(${base.code} as any)?.${expr.name}`, type: { kind: "unknown" } };
  if (base.type.kind === "unknown") return { code: `${base.code}?.${expr.name}`, type: { kind: "unknown" } };
  refuse(expr.site, `cannot select .${expr.name} from ${base.type.kind}`);
}

function emitCall(expr: Extract<Expr, { kind: "call" }>, env: Environment, writer: Writer): Emitted {
  if (expr.name === "sorted") {
    refuse(expr.site, "sorted(a, b) must be consumed by a two-name binding: (lo, hi) = sorted(a, b)");
  }
  const target = expr.name === "tokens" ? "mentionTokens" : expr.name;
  if (!["tokens", "range", "min", "max", "count", "divmod", "share"].includes(expr.name)) {
    unsupported(expr.site, `user function or recursion (${expr.name})`, "use a Quarry builtin or inline one bounded expression");
  }
  const args = expr.args.map((arg) => emitExpr(arg, env, writer));
  // @ref LLP 1004#money-and-decimal-worked-out-2026-09-03 — Quarry exposes only the engine's exact split primitives and preserves nominal result types.
  if (expr.name === "divmod") {
    if (args.length !== 2) typeError(expr.site, `divmod(a, b) requires exactly 2 arguments; received ${args.length}`, "use divmod(amount, integerDivisor)");
    const numerator = args[0]!;
    const divisor = args[1]!;
    if (!numericAmountType(numerator.type)) {
      typeError(expr.args[0]!.site, `divmod's first argument must be int, decimal, or money; received ${valueTypeName(numerator.type)}`, "use an int, decimal, or money numerator");
    }
    if (divisor.type.kind !== "int" || fractionalNumericLiteral(expr.args[1]!)) {
      typeError(expr.args[1]!.site, "divmod's divisor must be an int", "use an integer expression or integer literal as the divisor");
    }
    const resultType = numerator.type as ScalarType;
    return {
      code: `divmod(${numerator.code}, ${divisor.code})`,
      type: { kind: "object", fields: new Map([["quotient", resultType], ["remainder", resultType]]), nullable: false },
    };
  }
  if (expr.name === "share") {
    if (args.length !== 3) typeError(expr.site, `share(amount, recipients, recipient) requires exactly 3 arguments; received ${args.length}`, "use share(amount, recipients, recipient)");
    const amount = args[0]!;
    const recipients = args[1]!;
    const recipient = args[2]!;
    if (!numericAmountType(amount.type)) {
      typeError(expr.args[0]!.site, `share's amount must be int, decimal, or money; received ${valueTypeName(amount.type)}`, "use an int, decimal, or money amount");
    }
    const item = boundedItemType(recipients.type);
    if (!item) {
      typeError(expr.args[1]!.site, `share recipients must be a bounded list or page; received ${valueTypeName(recipients.type)}`, "use a bounded [T] <=N argument or bounded page-derived list");
    }
    if (!sameRecipientType(item, recipient.type)) {
      typeError(
        expr.args[2]!.site,
        `share recipient type ${valueTypeName(recipient.type)} does not match recipient-list item type ${valueTypeName(item)}`,
        "use a recipient with the same nominal type as the recipients list items",
      );
    }
    return { code: `deterministicShare(${amount.code}, ${recipients.code}, ${recipient.code})`, type: amount.type as ScalarType };
  }
  if (expr.name === "count") {
    if (args.length !== 1 || !["list", "page", "sequence"].includes(args[0]!.type.kind)) refuse(expr.site, "count(x) requires one bounded list or page");
    return { code: `${args[0]!.code}.length`, type: { kind: "int", optional: false } };
  }
  if (expr.name === "tokens") return { code: `${target}(${args.map((arg) => arg.code).join(", ")})`, type: { kind: "list", item: { kind: "text", max: 4096, optional: false }, max: 64, optional: false } };
  if (expr.name === "range") {
    if (args.length !== 2) refuse(expr.site, "range(a, b) requires two arguments");
    for (const argument of expr.args) {
      if (fractionalNumericLiteral(argument)) {
        typeError(argument.site, "int positions take integer literals", `replace ${literalExpressionText(argument)} with an integer literal`);
      }
    }
    const start = literalNumber(expr.args[0]);
    const end = literalNumber(expr.args[1]);
    const max = start === undefined || end === undefined ? 1000 : Math.max(0, end - start);
    return { code: `range(${args.map((arg) => arg.code).join(", ")})`, type: { kind: "list", item: { kind: "int", optional: false }, max, optional: false } };
  }
  if (expr.name === "min" || expr.name === "max") {
    const branded = args.map((arg) => brandedType(arg.type)).find((type) => type !== undefined);
    if (branded) {
      args.forEach((arg, index) => {
        if (!brandedType(arg.type) && !numericLiteral(expr.args[index]!)) {
          typeError(expr.args[index]!.site, `${expr.name} requires matching ${brandedName(branded)} values`, `use matching ${brandedName(branded)} values`);
        }
      });
      return { code: `${target}(${args.map((arg) => arg.code).join(", ")})`, type: branded };
    }
    const fractional = expr.args.find(fractionalNumericLiteral);
    if (fractional && args.some((arg) => arg.type.kind === "int")) {
      typeError(fractional.site, "int positions take integer literals", `replace ${literalExpressionText(fractional)} with an integer literal`);
    }
  }
  return { code: `${target}(${args.map((arg) => arg.code).join(", ")})`, type: args[0]?.type ?? { kind: "int", optional: false } };
}

function emitRead(expr: Extract<Expr, { kind: "read" }>, env: Environment, writer: Writer, exists = false): Emitted {
  if (!env.catalog.has(expr.table)) refuse(expr.site, `unknown table ${expr.table}`);
  const mode = expr.range ? "range" : exists ? "exists" : "point";
  const index = selectIndex(env.catalog, expr.table, expr.keys, mode, expr.index, (value) => inferExpr(value, env), expr.site);
  const keys = expr.keys.map((key) => keyBinding(emitExpr(key.value, env, writer)));
  const target = index.name === "byId" ? expr.table : `${expr.table}.${index.name}`;
  if (expr.range) {
    if (expr.range.cursorKind === "before" && expr.range.order !== "desc") refuse(expr.range.site, "before is supported only with last N; use after with first N for ascending pagination");
    const remainingColumns = index.columns.slice(expr.keys.length);
    if (expr.range.cursor && remainingColumns.length === 0) {
      const { cursor: _cursor, cursorKind: _cursorKind, ...range } = expr.range;
      typeError(
        expr.range.cursor.site,
        `scan ${expr.table}.${index.name} prefix names every index column, so a cursor has no position to compare; remove after/before or shorten the prefix`,
        quarryExpression({ ...expr, range }),
      );
    }
    if (expr.range.cursor && index.columns.at(-1) !== "id" && !index.unique) {
      const columns = [...index.columns.filter((column) => column !== "id"), "id"];
      typeError(
        index.site,
        `cursor at ${formatSite(expr.range.cursor.site)} uses \`${expr.table}.${index.name}\`, which is not a total order (it neither ends in id nor is unique)`,
        `by ${index.name}: ${columns.join(", ")}`,
      );
    }
    if (expr.range.cursor?.kind === "array") {
      const cursor = expr.range.cursor;
      const actual = cursor.items.map((item) => inferExpr(item, env));
      const expected = remainingColumns.map((column) => column === "id"
        ? { kind: "ref", table: expr.table, optional: false } satisfies ScalarType
        : env.catalog.get(expr.table)?.columns.get(column));
      const allInfer = actual.length === expected.length
        && actual.every((type) => type !== undefined)
        && expected.every((type) => type !== undefined);
      const mismatch = allInfer
        ? actual.findIndex((type, offset) =>
          !cursorKindMatches(cursor.items[offset]!, type!, expected[offset]!))
        : -1;
      if (mismatch >= 0) {
        const permutation = uniqueCursorPermutation(cursor.items, actual as ScalarType[], expected as ScalarType[]);
        const { cursor: _cursor, cursorKind: _cursorKind, ...range } = expr.range;
        const rewrite = permutation
          ? `${expr.range.cursorKind ?? "after"} (${permutation.map(cursorRewriteExpression).join(", ")})`
          : quarryExpression({ ...expr, range });
        typeError(
          expr.range.cursor.site,
          `${expr.table}.${index.name} cursor component ${mismatch + 1} does not match ${remainingColumns[mismatch]}`,
          rewrite,
        );
      }
    }
    if (expr.range.cursor && (index.columns.at(-1) === "id" || index.unique)
      && remainingColumns.length > 1 && expr.range.cursor.kind !== "array") {
      const cursor = expr.range.cursor;
      const first = cursor.kind === "name" ? cursor.name : remainingColumns[0]!;
      const firstSuffix = title(remainingColumns[0]!);
      const root = first.endsWith(firstSuffix) ? first.slice(0, -firstSuffix.length) : first;
      const tuple = [first, ...remainingColumns.slice(1).map((column) => `${root}${title(column)}`)];
      typeError(
        cursor.site,
        `${expr.table}.${index.name} has ${remainingColumns.length} ordering columns after the prefix (${remainingColumns.join(", ")}); its cursor must be a tuple`,
        `${expr.range.cursorKind ?? "after"} (${tuple.join(", ")})`,
      );
    }
    const options = [`order: ${JSON.stringify(expr.range.order)}`, `take: ${expr.range.take}`];
    if (expr.range.cursor) options.push(`after: ${emitExpr(expr.range.cursor, env, writer).code}`);
    if (expr.range.mergeSite) options.push(`mergeSite: ${JSON.stringify(expr.range.mergeSite)}`);
    const scan = `db.scan(${target}, [${keys.map((key) => key.code).join(", ")}], { ${options.join(", ")} })`;
    return { code: scan, type: { kind: "page", table: expr.table } };
  }
  const key = index.name === "byId" && keys.length === 1 ? keys[0]!.code : `[${keys.map((item) => item.code).join(", ")}]`;
  return exists
    ? { code: `db.exists(${target}, ${key})`, type: boolType() }
    : { code: `db.get(${target}, ${key})`, type: { kind: "row", table: expr.table, nullable: true } };
}

function emitMerge(expr: MergeExpr, env: Environment, writer: Writer): Emitted {
  const info = env.catalog.get(expr.table);
  if (!info) refuse(expr.site, `unknown table ${expr.table}`);
  const index = info.indexes.find((candidate) => candidate.name === expr.index);
  if (!index) refuse(expr.site, `table ${expr.table} has no index ${expr.index}`);
  if (expr.cursorKind === "before" && expr.order !== "desc") {
    refuse(expr.site, "before is supported only with last N; use after with first N for ascending pagination");
  }
  const widths = new Set(expr.lanes.map((lane) => lane.prefix.length));
  if (widths.size !== 1) {
    const lane = expr.lanes.find((candidate) => candidate.prefix.length !== expr.lanes[0]!.prefix.length) ?? expr.lanes[0]!;
    typeError(lane.site, "merge lanes must have equal-width index prefixes", `use ${expr.lanes[0]!.prefix.length} prefix key(s) in this lane`);
  }
  const width = expr.lanes[0]!.prefix.length;
  if (width >= index.columns.length) {
    typeError(expr.lanes[0]!.site, `merge lane prefixes must leave at least one ${expr.table}.${index.name} suffix column`, "drop the last prefix key from every lane");
  }
  const seen = new Map<string, number>();
  expr.lanes.forEach((lane, offset) => {
    const key = lane.prefix.map(quarryExpression).join("\u0000");
    if (seen.has(key)) typeError(lane.site, "merge lanes have structurally identical prefixes", "drop this duplicate lane");
    seen.set(key, offset);
    const nested = env.clone();
    if (lane.loop) nested.bindings.set(lane.loop.name, { code: lane.loop.name, type: { kind: "row", table: lane.loop.domain.table, nullable: false } });
    lane.prefix.forEach((value, position) => {
      const actual = inferExpr(value, nested);
      const column = index.columns[position]!;
      const expected = column === "id"
        ? { kind: "ref", table: expr.table, optional: false } satisfies ScalarType
        : info.columns.get(column);
      if (actual && expected && !compatible(actual, expected)) {
        typeError(lane.site, `merge lane key ${position + 1} is ${valueTypeName(actual)}; ${expr.table}.${index.name}.${column} is ${valueTypeName(expected)}`, `use a ${valueTypeName(expected)} expression in this lane position`);
      }
    });
    selectIndex(
      env.catalog,
      expr.table,
      lane.prefix.map((value) => ({ value, site: value.site })),
      "range",
      expr.index,
      (value) => inferExpr(value, nested),
      lane.site,
    );
  });
  const mergeSite = `${expr.site.file}:${expr.site.line}:${expr.site.col}`;
  const union = temporary("mergeUnion", expr.site);
  writer.statement(`const ${union}: Array<(typeof ${expr.table})["__row"]> = [];`, expr.site);
  for (const lane of expr.lanes) {
    const emitLane = (nested: Environment): void => {
      const scan = emitRead({
        kind: "read",
        table: expr.table,
        keys: lane.prefix.map((value) => ({ value, site: value.site })),
        index: expr.index,
        range: {
          order: expr.order,
          take: expr.take,
          cursor: expr.cursor,
          cursorKind: expr.cursorKind,
          mergeSite,
          site: lane.site,
        },
        site: lane.site,
      }, nested, writer);
      const row = temporary("mergeRow", lane.site);
      writer.raw(`for (const ${row} of ${scan.code}) {`, lane.site);
      writer.nested(() => writer.statement(`${union}.push(${row});`, lane.site));
      writer.statement("}", lane.site);
    };
    if (!lane.loop) {
      emitLane(env);
      continue;
    }
    const domain = emitRead(lane.loop.domain, env, writer);
    writer.raw(`for (const ${lane.loop.name} of ${domain.code}) {`, lane.site);
    writer.nested(() => {
      const nested = env.clone();
      nested.bindings.set(lane.loop!.name, { code: lane.loop!.name, type: { kind: "row", table: lane.loop!.domain.table, nullable: false } });
      emitLane(nested);
    });
    writer.statement("}", lane.site);
  }
  const suffix = index.columns.slice(width);
  return {
    code: `mergeByIndex(${union}, ${JSON.stringify(suffix)}, ${JSON.stringify(expr.order)}, ${expr.take}, ${JSON.stringify(mergeSite)}, ${JSON.stringify(expr.table)})`,
    type: { kind: "page", table: expr.table },
  };
}

function emitShape(expr: Extract<Expr, { kind: "shape" }>, env: Environment, writer: Writer): Emitted {
  let base = emitExpr(expr.base, env, writer);
  if (isRef(base.type)) {
    const refType = base.type;
    if (!refType.table) refuse(expr.site, "shape auto-dereference needs a typed table reference");
    const deref = temporary("shapeRef", expr.site);
    if (refType.optional) {
      const key = temporary("shapeRefKey", expr.site);
      writer.statement(`const ${key} = ${base.code} ?? null;`, expr.site);
      writer.statement(`let ${deref}: any = null;`, expr.site);
      writer.raw(`if (${key} !== null) {`);
      writer.nested(() => writer.statement(`${deref} = db.get(${refType.table}, ${key});`, expr.site));
      writer.statement("}", expr.site);
    } else {
      writer.statement(`const ${deref} = db.get(${refType.table}, ${base.code});`, expr.site);
    }
    base = { code: deref, type: { kind: "row", table: refType.table, nullable: true } };
  }
  if (base.type.kind === "page") return emitPageShape(base, expr.fields, expr.site, env, writer, base.type.table);
  if (base.type.kind === "sequence" && base.type.item.kind === "row") {
    return emitPageShape(base, expr.fields, expr.site, env, writer, base.type.item.table);
  }
  if (base.type.kind !== "row") refuse(expr.site, "shapes may focus only a row, reference, or page");
  const rowType = base.type;
  const focalName = temporary("row", expr.site);
  writer.statement(`const ${focalName} = ${base.code};`, expr.site);
  const result = temporary("shape", expr.site);
  let resultType: ObjectType = { kind: "object", fields: new Map(), nullable: false };
  if (rowType.nullable) {
    writer.statement(`let ${result}: any = null;`, expr.site);
    writer.raw(`if (${focalName} !== null) {`);
    writer.nested(() => {
      const [shapeCode, shapeType] = shapeObject(expr.fields, { code: focalName, type: { ...rowType, nullable: false } }, env, writer);
      resultType = shapeType;
      writer.statement(`${result} = ${shapeCode};`, expr.site);
    });
    writer.statement("}", expr.site);
  } else {
    const [shapeCode, shapeType] = shapeObject(expr.fields, { code: focalName, type: rowType }, env, writer);
    resultType = shapeType;
    writer.statement(`const ${result} = ${shapeCode};`, expr.site);
  }
  return { code: result, type: { ...resultType, nullable: rowType.nullable } };
}

function emitPageShape(base: Binding, fields: ShapeField[], site: Site, env: Environment, writer: Writer, table: string): Emitted {
  const page = temporary("page", site);
  const result = temporary("rows", site);
  const row = temporary("row", site);
  let itemType: ObjectType = { kind: "object", fields: new Map(), nullable: false };
  writer.statement(`const ${page} = ${base.code};`, site);
  writer.statement(`const ${result}: any[] = [];`, site);
  writer.raw(`for (const ${row} of ${page}) {`);
  writer.nested(() => {
    const [shapeCode, shapeType] = shapeObject(fields, { code: row, type: { kind: "row", table, nullable: false } }, env, writer);
    itemType = shapeType;
    writer.statement(`${result}.push(${shapeCode});`, site);
  });
  writer.statement("}", site);
  return { code: result, type: { kind: "sequence", item: itemType, max: 1000 } };
}

function shapeObject(fields: ShapeField[], focal: Binding, env: Environment, writer: Writer): [string, ObjectType] {
  const prior = env.focal;
  env.focal = focal;
  try {
    const properties: string[] = [];
    const types = new Map<string, ValueType>();
    for (const field of fields) {
      if (field.kind === "spread") {
        properties.push(`...${focal.code}`);
        if (focal.type.kind !== "row") refuse(field.site, "shape spread requires a row");
        types.set("id", { kind: "ref", table: focal.type.table, optional: false });
        for (const [name, type] of env.catalog.get(focal.type.table)?.columns ?? []) types.set(name, type);
      } else if (field.kind === "bare") {
        const value = emitMember({ kind: "member", base: { kind: "focal", site: field.site }, name: field.name, site: field.site }, env, writer);
        properties.push(`${property(field.name)}: ${value.code}`);
        types.set(field.name, value.type);
      } else {
        const value = emitExpr(field.value, env, writer);
        properties.push(`${property(field.name)}: ${value.code}`);
        types.set(field.name, value.type);
      }
    }
    return [`{ ${properties.join(", ")} }`, { kind: "object", fields: types, nullable: false }];
  } finally {
    env.focal = prior;
  }
}

function emitWrite(expr: Extract<Expr, { kind: "write" }>, env: Environment, writer: Writer): Emitted {
  const info = env.catalog.get(expr.table);
  if (!info) refuse(expr.site, `unknown table ${expr.table}`);
  if (expr.op === "insert") {
    const fields = emitFields(expr.fields, env, writer, info.columns);
    if (!expr.fields.some((field) => field.name === "id")) fields.unshift("id: ctx.newId()");
    return { code: `db.insert(${expr.table}, { ${fields.join(", ")} })`, type: { kind: "row", table: expr.table, nullable: false } };
  }
  const index = selectIndex(env.catalog, expr.table, expr.keys, "point", undefined, (value) => inferExpr(value, env), expr.site);
  validateAddressedKeyFields(expr, index);
  const keys = expr.keys.map((part, offset) => {
    const emitted = keyBinding(emitExpr(part.value, env, writer));
    const local = temporary(`writeKey${offset + 1}`, part.site);
    writer.statement(`const ${local} = ${emitted.code};`, part.value.site);
    return { ...emitted, code: local };
  });
  const addressedFields = new Map(index.columns.map((column, offset) => [column, keys[offset]!.code]));
  if (index.name !== "byId" || keys.length !== 1) {
    return emitIndexedWrite(expr, env, writer, info.columns, index, keys);
  }
  const key = keys[0]!;
  if (expr.op === "delete") {
    writer.statement(`db.delete(${expr.table}, ${key.code});`, expr.site);
    return { code: "null", type: { kind: "unknown" }, effectOnly: true };
  }
  const writeFields = expr.op === "update"
    ? expr.fields.filter((field) => !addressedFields.has(field.name))
    : expr.fields;
  const usesFocal = writeFields.some((field) => field.value && mentionsFocal(field.value));
  if (!usesFocal && expr.op !== "upsert") {
    const fields = emitFields(writeFields, env, writer, info.columns);
    writer.statement(`db.${expr.op}(${expr.table}, ${key.code}, { ${fields.join(", ")} });`, expr.site);
    return { code: "null", type: { kind: "unknown" }, effectOnly: true };
  }

  const prior = env.focal;
  const rowName = temporary("old", expr.site);
  env.focal = { code: rowName, type: { kind: "row", table: expr.table, nullable: expr.op === "upsert" } };
  try {
    writer.raw(`db.${expr.op}(${expr.table}, ${key.code}, (${rowName}) => {`);
    writer.nested(() => {
      const fields = emitEvaluatedFields(
        writeFields,
        env,
        writer,
        info.columns,
        expr.op === "upsert" ? addressedFields : undefined,
      );
      if (expr.op === "upsert" && !expr.fields.some((field) => field.name === "id")) fields.unshift(`id: ${key.code}`);
      writer.statement(`return { ${fields.join(", ")} };`, expr.site);
    });
    writer.statement("});", expr.site);
  } finally {
    env.focal = prior;
  }
  return { code: "null", type: { kind: "unknown" }, effectOnly: true };
}

// @ref LLP 1001#1-store-storers — the engine's write address remains the
// intrinsic scalar row id; Quarry resolves an alternate unique key before it
// emits the base-table write rather than pretending the IR has composite ids.
function emitIndexedWrite(
  expr: Extract<Expr, { kind: "write" }>,
  env: Environment,
  writer: Writer,
  columns: Map<string, ScalarType>,
  index: IndexDecl,
  keys: Emitted[],
): Emitted {
  const row = temporary("writeRow", expr.site);
  writer.statement(`const ${row} = db.get(${expr.table}.${index.name}, [${keys.map((key) => key.code).join(", ")}]);`, expr.site);
  const addressedFields = new Map(index.columns.map((column, offset) => [column, keys[offset]!.code]));

  if (expr.op === "delete") {
    writer.statement(`db.require(${row} !== null, "NOT_FOUND");`, expr.site);
    writer.statement(`db.delete(${expr.table}, ${row}!.id);`, expr.site);
    return { code: "null", type: { kind: "unknown" }, effectOnly: true };
  }

  if (expr.op === "update") {
    writer.statement(`db.require(${row} !== null, "NOT_FOUND");`, expr.site);
    const prior = env.focal;
    env.focal = { code: `${row}!`, type: { kind: "row", table: expr.table, nullable: false } };
    try {
      const patch = expr.fields.filter((field) => !addressedFields.has(field.name));
      const fields = patch.some((field) => field.value && mentionsFocal(field.value))
        ? emitEvaluatedFields(patch, env, writer, columns)
        : emitFields(patch, env, writer, columns);
      writer.statement(`db.update(${expr.table}, ${row}!.id, { ${fields.join(", ")} });`, expr.site);
    } finally {
      env.focal = prior;
    }
    return { code: "null", type: { kind: "unknown" }, effectOnly: true };
  }

  const prior = env.focal;
  env.focal = { code: row, type: { kind: "row", table: expr.table, nullable: true } };
  try {
    // `id: new` is the minted form, not an authored id: the present branch keeps the
    // row's id and only the absent branch mints, so the upsert converges.
    const mintsId = (field: ObjectField) => field.name === "id" && field.value?.kind === "name" && field.value.name === "new";
    const sourceFields = index.columns.includes("id") ? expr.fields : expr.fields.filter((field) => !mintsId(field));
    const authoredId = sourceFields.find((field) => field.name === "id");
    const key = temporary("upsertKey", expr.site);
    const fields = emitEvaluatedFieldEntries(sourceFields, env, writer, columns, addressedFields);
    const authoredNames = new Set(sourceFields.map((field) => field.name));
    const injected = index.columns.flatMap((column, offset) =>
      authoredNames.has(column) ? [] : [{ name: column, value: keys[offset]!.code }]);
    fields.unshift(...injected);
    if (!authoredId && !index.columns.includes("id")) {
      writer.statement(`const ${key} = ${row}?.id ?? ctx.newId();`, expr.site);
      const rowFields = fields.map(fieldCode);
      rowFields.unshift(`id: ${key}`);
      writer.statement(`db.upsert(${expr.table}, ${key}, { ${rowFields.join(", ")} });`, expr.site);
    } else {
      const id = fields.find((field) => field.name === "id")!.value;
      const idRow = temporary("upsertIdRow", expr.site);
      writer.statement(`const ${idRow} = db.get(${expr.table}, ${id});`, expr.site);
      writer.statement(`db.require(${row} !== null || ${idRow} === null, "UPSERT_ID_IN_USE");`, expr.site);
      writer.statement(`db.require(${row} === null || ${row}.id === ${id}, "UPSERT_ID_MISMATCH");`, expr.site);
      writer.statement(`const ${key} = ${row}?.id ?? ${id};`, expr.site);
      const rowFields = fields.filter((field) => field.name !== "id").map(fieldCode);
      rowFields.unshift(`id: ${key}`);
      writer.statement(`db.upsert(${expr.table}, ${key}, { ${rowFields.join(", ")} });`, expr.site);
    }
  } finally {
    env.focal = prior;
  }
  return { code: "null", type: { kind: "unknown" }, effectOnly: true };
}

function emitFields(
  fields: ObjectField[],
  env: Environment,
  writer: Writer,
  columns: Map<string, ScalarType>,
): string[] {
  return fields.map((field) => {
    const value = emitExpr(field.value ?? { kind: "name", name: field.name, site: field.site }, env, writer);
    const expected = field.name === "id" ? { kind: "id", optional: false } satisfies ScalarType : columns.get(field.name);
    validateFieldType(field, value.type, expected, env);
    const code = expected && (expected.kind === "ref" || expected.kind === "id") ? keyBinding(value).code : value.code;
    return `${property(field.name)}: ${code}`;
  });
}

type EvaluatedField = { name: string; value: string };

function emitEvaluatedFields(
  fields: ObjectField[],
  env: Environment,
  writer: Writer,
  columns: Map<string, ScalarType>,
  replacements: Map<string, string> = new Map(),
): string[] {
  return emitEvaluatedFieldEntries(fields, env, writer, columns, replacements).map(fieldCode);
}

function emitEvaluatedFieldEntries(
  fields: ObjectField[],
  env: Environment,
  writer: Writer,
  columns: Map<string, ScalarType>,
  replacements: Map<string, string> = new Map(),
): EvaluatedField[] {
  return fields.map((field) => {
    const replacement = replacements.get(field.name);
    if (replacement) return { name: field.name, value: replacement };
    const value = emitExpr(field.value ?? { kind: "name", name: field.name, site: field.site }, env, writer);
    const expected = field.name === "id" ? { kind: "id", optional: false } satisfies ScalarType : columns.get(field.name);
    validateFieldType(field, value.type, expected, env);
    const code = expected && (expected.kind === "ref" || expected.kind === "id") ? keyBinding(value).code : value.code;
    const local = temporary("patch", field.site);
    writer.statement(`const ${local} = ${code};`, field.site);
    return { name: field.name, value: local };
  });
}

function fieldCode(field: EvaluatedField): string { return `${property(field.name)}: ${field.value}`; }

function validateAddressedKeyFields(expr: Extract<Expr, { kind: "write" }>, index: IndexDecl): void {
  if (expr.op === "delete") return;
  const authoredId = expr.op === "update"
    ? expr.fields.find((field) => field.name === "id")
    : undefined;
  if (authoredId) {
    typeError(
      authoredId.site,
      "update patches may not name id; row identity is immutable",
      quarryWriteWithoutField(expr, authoredId),
    );
  }
  for (const [offset, column] of index.columns.entries()) {
    const field = expr.fields.find((candidate) => candidate.name === column);
    if (!field) continue;
    const value = field.value ?? { kind: "name", name: field.name, site: field.site } satisfies Expr;
    if (quarryExpression(value) === quarryExpression(expr.keys[offset]!.value)) continue;
    typeError(
      field.site,
      `${expr.op} may not reassign addressed key column ${column}; the ${index.name} address is authoritative`,
      quarryWriteWithoutField(expr, field),
    );
  }
}

function quarryWriteWithoutField(expr: Extract<Expr, { kind: "write" }>, removed: ObjectField): string {
  const key = expr.op === "insert" ? "" : `[${expr.keys.map(quarryKeyPart).join(", ")}]`;
  const fields = expr.op === "delete" ? "" : ` { ${expr.fields.filter((field) => field !== removed).map(quarryObjectField).join(", ")} }`;
  return `${expr.op} ${expr.table}${key}${fields}`;
}

function quarryKeyPart(part: KeyPart): string {
  return `${part.column ? `${part.column} = ` : ""}${quarryExpression(part.value)}`;
}

function quarryObjectField(field: ObjectField): string {
  return field.value ? `${field.name}: ${quarryExpression(field.value)}` : field.name;
}

export function quarryExpression(expr: Expr): string {
  if (expr.kind === "name") return expr.name;
  if (expr.kind === "focal") return ".";
  if (expr.kind === "literal") return JSON.stringify(expr.value);
  if (expr.kind === "array") return `[${expr.items.map(quarryExpression).join(", ")}]`;
  if (expr.kind === "object") return `{ ${expr.fields.map(quarryObjectField).join(", ")} }`;
  if (expr.kind === "unary") return `${expr.op} (${quarryExpression(expr.value)})`;
  if (expr.kind === "binary") return `(${quarryExpression(expr.left)} ${expr.op} ${quarryExpression(expr.right)})`;
  if (expr.kind === "member") {
    return expr.base.kind === "focal"
      ? `.${expr.name}`
      : `(${quarryExpression(expr.base)}).${expr.name}`;
  }
  if (expr.kind === "call") return `${expr.name}(${expr.args.map(quarryExpression).join(", ")})`;
  if (expr.kind === "read") {
    let rendered = `${expr.table}[${expr.keys.map(quarryKeyPart).join(", ")}]`;
    if (expr.range?.cursor) rendered += ` ${expr.range.cursorKind ?? "after"} ${quarryExpression(expr.range.cursor)}`;
    if (expr.range) rendered += ` ${expr.range.order === "asc" ? "first" : "last"} ${expr.range.take}`;
    if (expr.index) rendered += ` by ${expr.index}`;
    return rendered;
  }
  if (expr.kind === "merge") {
    const cursor = expr.cursor ? ` ${expr.cursorKind ?? "after"} ${quarryExpression(expr.cursor)}` : "";
    const lanes = expr.lanes.map((lane) => `  [${lane.prefix.map(quarryExpression).join(", ")}]${lane.loop ? ` for ${lane.loop.name} in ${quarryExpression(lane.loop.domain)}` : ""}`).join("\n");
    return `merge ${expr.table}${cursor} ${expr.order === "asc" ? "first" : "last"} ${expr.take} by ${expr.index}:\n${lanes}`;
  }
  if (expr.kind === "exists" || expr.kind === "created") return `${expr.kind} ${quarryExpression(expr.read)}`;
  if (expr.kind === "aggregate") return `#${expr.table}[${expr.keys.map(quarryKeyPart).join(", ")}]`;
  if (expr.kind === "assert") return `(${quarryExpression(expr.value)})! else ${expr.code}`;
  if (expr.kind === "shape") {
    const fields = expr.fields.map((field) => field.kind === "spread"
      ? "*"
      : field.kind === "bare" ? field.name : `${field.name}: ${quarryExpression(field.value)}`);
    return `(${quarryExpression(expr.base)}) { ${fields.join(", ")} }`;
  }
  if (expr.kind === "walk") return `walk ${expr.table}[${quarryExpression(expr.seed)}] up .${expr.column} depth ${expr.depth}`;
  return quarryWriteWithoutField(expr, { name: "", site: expr.site });
}

function uniqueCursorPermutation(
  items: Expr[],
  actual: ScalarType[],
  expected: ScalarType[],
): Expr[] | undefined {
  const matches: Expr[][] = [];
  const visit = (offset: number, used: Set<number>, ordered: Expr[]): void => {
    if (matches.length > 1) return;
    if (offset === expected.length) {
      matches.push([...ordered]);
      return;
    }
    for (let index = 0; index < items.length; index += 1) {
      if (used.has(index) || !cursorKindMatches(items[index]!, actual[index]!, expected[offset]!)) continue;
      used.add(index);
      ordered.push(items[index]!);
      visit(offset + 1, used, ordered);
      ordered.pop();
      used.delete(index);
    }
  };
  visit(0, new Set(), []);
  return matches.length === 1 ? matches[0] : undefined;
}

function cursorRewriteExpression(expr: Expr): string {
  const simple = simpleExpr(expr);
  return simple === "x" ? quarryExpression(expr) : simple;
}

function cursorKindMatches(expr: Expr, actual: ScalarType, expected: ScalarType): boolean {
  if (expr.kind === "literal" && expr.value === null) return true;
  if (actual.optional) return true;
  if (expected.kind === "json") return !["list"].includes(actual.kind);
  if (["id", "principal", "ref"].includes(expected.kind)) {
    return ["id", "principal", "ref"].includes(actual.kind);
  }
  if (["text", "enum"].includes(expected.kind)) return ["text", "enum"].includes(actual.kind);
  if (["int", "time", "decimal", "money"].includes(expected.kind)) {
    return ["int", "time", "decimal", "money"].includes(actual.kind);
  }
  return actual.kind === expected.kind;
}

function validateFieldType(
  field: ObjectField,
  actual: ValueType,
  expected: ScalarType | undefined,
  env: Environment,
): void {
  const expression = field.value ?? { kind: "name", name: field.name, site: field.site } satisfies Expr;
  if (expected?.optional && expression.kind === "literal" && expression.value === null) return;
  if (expected?.kind === "int" && fractionalNumericLiteral(expression)) {
    typeError(field.site, "int positions take integer literals", `replace ${literalExpressionText(expression)} with an integer literal`);
  }
  if (expected?.kind === "decimal" || expected?.kind === "money") {
    if (numericLiteral(expression)) return;
    if (actual.kind === "decimal" || actual.kind === "money") return;
    typeError(field.site, `${field.name} is ${brandedName(expected)}; ${valueTypeName(actual)} is nominally different`, `use a ${brandedName(expected)} value`);
  }
  if ((actual.kind === "decimal" || actual.kind === "money") && expected) {
    typeError(field.site, `${field.name} is ${expected.kind}; ${brandedName(actual)} is nominally different`, `use a ${expected.kind} value`);
  }
  if (expected?.kind === "principal" && actual.kind !== "principal") {
    refuse(field.site, `${field.name} is principal; ${actual.kind} is nominally different (a ref/id is not a principal)`);
  }
  if ((expected?.kind === "ref" || expected?.kind === "id") && actual.kind === "principal") {
    refuse(field.site, `${field.name} is ${expected.kind}; principal is nominally different`);
  }
  const expectedAsset = nestedAssetShape(expected);
  const actualAsset = nestedAssetShape(actual);
  const acceptsAsset = expectedAsset
    ? assetExpressionAcceptsExpected(expression, actual, expected!, env)
    : !actualAsset;
  if ((expectedAsset || actualAsset) && !acceptsAsset) {
    const wrapperMismatch = expectedAsset && actualAsset && expectedAsset.kind === actualAsset.kind;
    const wanted = expectedAsset
      ? wrapperMismatch ? assetShapeName(expectedAsset) : `${expectedAsset.kind} asset`
      : "non-asset";
    const received = actualAsset
      ? wrapperMismatch ? assetShapeName(actualAsset) : `${actualAsset.kind} asset`
      : valueTypeName(actual);
    typeError(field.site, `${field.name} requires ${wanted} values at every nested asset position; received ${received}`, `use a ${wanted} value for ${field.name}`);
  }
}

function assetExpressionAcceptsExpected(
  expression: Expr,
  actual: ValueType,
  expected: ScalarType,
  env: Environment,
): boolean {
  if (expected.kind === "list" && expression.kind === "array") {
    const inferredItem = actual.kind === "list" || actual.kind === "sequence"
      ? actual.item
      : { kind: "unknown" } satisfies ValueType;
    return expression.items.every((item) => assetExpressionAcceptsExpected(
      item,
      inferExpr(item, env) ?? inferredItem,
      expected.item,
      env,
    ));
  }
  return assetShapeAccepts(nestedAssetShape(expected), nestedAssetShape(actual));
}

// @ref LLP 1006#3-authoring-surface — list/optional wrappers do not erase the
// nominal image/video kind of the closed record stored beneath them.
type AssetShape = {
  kind: "image" | "video";
  wrappers: Array<{ optional: boolean }>;
  leafOptional: boolean;
};

function nestedAssetShape(type: ValueType | undefined): AssetShape | undefined {
  if (!type) return undefined;
  if (type.kind === "image" || type.kind === "video") {
    return { kind: type.kind, wrappers: [], leafOptional: type.optional };
  }
  if (type.kind === "list" || type.kind === "sequence") {
    const nested = nestedAssetShape(type.item);
    if (nested) {
      return {
        ...nested,
        wrappers: [{ optional: type.kind === "list" && type.optional }, ...nested.wrappers],
      };
    }
  }
  return undefined;
}

function assetShapeAccepts(expected: AssetShape | undefined, actual: AssetShape | undefined): boolean {
  if (!expected || !actual || expected.kind !== actual.kind || expected.wrappers.length !== actual.wrappers.length) return false;
  if (actual.leafOptional && !expected.leafOptional) return false;
  return actual.wrappers.every((wrapper, index) => !wrapper.optional || expected.wrappers[index]!.optional);
}

function assetShapeName(shape: AssetShape): string {
  let name = `${shape.kind} asset${shape.leafOptional ? " or null" : ""}`;
  for (const wrapper of [...shape.wrappers].reverse()) name = `[${name}]${wrapper.optional ? " or null" : ""}`;
  return name;
}

function inferExpr(expr: Expr, env: Environment): ScalarType | undefined {
  if (expr.kind === "name") {
    const binding = env.bindings.get(expr.name)?.type;
    if (binding && isScalar(binding)) return binding;
    if (binding?.kind === "row") return { kind: "ref", table: binding.table, optional: binding.nullable };
    if (expr.name === "viewer") return { kind: "principal", optional: false };
    if (expr.name === "new") return { kind: "id", optional: false };
    if (expr.name === "now" || expr.name === "commit") return { kind: "time", optional: false };
  }
  if (expr.kind === "focal" && env.focal?.type.kind === "row") return { kind: "ref", table: env.focal.type.table, optional: env.focal.type.nullable };
  if (expr.kind === "literal") {
    const type = literalType(expr);
    return isScalar(type) ? type : undefined;
  }
  if (expr.kind === "member") {
    const base = inferExpr(expr.base, env);
    if (base?.kind === "ref" && base.table) {
      if (expr.name === "id") return { kind: "ref", table: base.table, optional: base.optional };
      return env.catalog.get(base.table)?.columns.get(expr.name);
    }
  }
  return undefined;
}

function literalType(expr: Extract<Expr, { kind: "literal" }>): ScalarType | NumericLiteralType {
  if (typeof expr.value === "string") return { kind: "text", max: Math.max(1, expr.value.length), optional: false };
  if (typeof expr.value === "number") {
    const digits = fractionalDigits(expr.numericText);
    return digits === 0 ? { kind: "int", optional: false } : { kind: "numeric-literal", fractionalDigits: digits };
  }
  if (typeof expr.value === "boolean") return { kind: "bool", optional: false };
  return { kind: "text", max: 1, optional: true };
}

function scalarOrUnknown(type: ValueType): ScalarType {
  return isScalar(type) ? type : { kind: "text", max: 1, optional: true };
}

function isScalar(type: ValueType): type is ScalarType {
  return ["text", "id", "principal", "int", "decimal", "money", "time", "bool", "json", "bytes", "image", "video", "enum", "ref", "list"].includes(type.kind);
}

function isRef(type: ValueType): type is Extract<ScalarType, { kind: "ref" }> { return type.kind === "ref"; }
function nonNullable(type: ValueType): ValueType {
  if (type.kind === "row") return { ...type, nullable: false };
  if (type.kind === "object") return { ...type, nullable: false };
  if (isScalar(type)) return { ...type, optional: false } as ScalarType;
  return type;
}
function nullableValue(type: ValueType): ValueType {
  if (type.kind === "row" || type.kind === "object") return { ...type, nullable: true };
  if (isScalar(type)) return { ...type, optional: true } as ScalarType;
  return { kind: "unknown" };
}
function isNullableValue(type: ValueType): boolean {
  if (type.kind === "row" || type.kind === "object") return type.nullable;
  if (type.kind === "unknown") return true;
  return isScalar(type) && type.optional;
}
function requireBoolean(expr: Expr, type: ValueType, construct: string): void {
  if (type.kind === "bool" && !type.optional) return;
  const nullable = (isScalar(type) && type.optional)
    || ((type.kind === "row" || type.kind === "object") && type.nullable);
  const spelling = expr.kind === "name" ? expr.name : expr.kind === "member" ? `${simpleExpr(expr.base)}.${expr.name}` : "x";
  typeError(
    expr.site,
    `${construct} requires a Boolean operand; got ${type.kind}${nullable ? "?" : ""}`,
    nullable ? `${spelling} != null` : `compare ${spelling} to a value so ${construct} receives a Boolean`,
  );
}
function simpleExpr(expr: Expr): string {
  if (expr.kind === "name") return expr.name;
  if (expr.kind === "focal") return "";
  if (expr.kind === "member") return `${simpleExpr(expr.base)}.${expr.name}`;
  return "x";
}
function optionalComparisonOperand(expr: Expr, type: ValueType): string {
  const rendered = simpleExpr(expr);
  const value = rendered === "x" ? `(${quarryExpression(expr)})` : rendered;
  return isNullableValue(type) ? `${value}!` : value;
}
function boolType(): ScalarType { return { kind: "bool", optional: false }; }
function keyBinding(value: Emitted): Emitted {
  return value.type.kind === "row" ? { ...value, code: `${value.code}.id`, type: { kind: "ref", table: value.type.table, optional: value.type.nullable } } : value;
}
function compatible(left: ScalarType, right: ScalarType): boolean {
  if (left.kind === "principal" || right.kind === "principal") return left.kind === "principal" && right.kind === "principal";
  if (left.kind === "ref" || left.kind === "id") return right.kind === "ref" || right.kind === "id";
  if (right.kind === "ref" || right.kind === "id") return false;
  if ((left.kind === "enum" && right.kind === "text") || (left.kind === "text" && right.kind === "enum")) return true;
  if (left.kind === "decimal" || right.kind === "decimal") {
    return left.kind === "decimal" && right.kind === "decimal" && left.scale === right.scale;
  }
  if (left.kind === "money" || right.kind === "money") {
    return left.kind === "money" && right.kind === "money"
      && left.currency === right.currency && left.scale === right.scale;
  }
  return left.kind === right.kind;
}
function brandedType(type: ValueType): Extract<ScalarType, { kind: "decimal" | "money" }> | undefined {
  return type.kind === "decimal" || type.kind === "money" ? type : undefined;
}
function brandedName(type: Extract<ScalarType, { kind: "decimal" | "money" }>): string {
  return type.kind === "decimal" ? `decimal ${type.scale}` : `money ${type.currency} ${type.scale}`;
}
function numericAmountType(type: ValueType): type is Extract<ScalarType, { kind: "int" | "decimal" | "money" }> {
  return (type.kind === "int" || type.kind === "decimal" || type.kind === "money") && !type.optional;
}
function boundedItemType(type: ValueType): ValueType | undefined {
  if (type.kind === "list" || type.kind === "sequence") return type.item;
  if (type.kind === "page") return { kind: "row", table: type.table, nullable: false };
  return undefined;
}
function sameRecipientType(left: ValueType, right: ValueType): boolean {
  if (left.kind === "row" || right.kind === "row") {
    return left.kind === "row" && right.kind === "row" && left.table === right.table && !left.nullable && !right.nullable;
  }
  if (!isScalar(left) || !isScalar(right) || left.optional || right.optional) return false;
  if (left.kind !== right.kind) return false;
  if (left.kind === "ref" && right.kind === "ref") return left.table === right.table;
  if (left.kind === "decimal" && right.kind === "decimal") return left.scale === right.scale;
  if (left.kind === "money" && right.kind === "money") return left.currency === right.currency && left.scale === right.scale;
  return true;
}
function valueTypeName(type: ValueType): string {
  if (type.kind === "numeric-literal") return "decimal literal";
  if (type.kind === "ref") return `ref ${type.table}`;
  if (type.kind === "row") return `row ${type.table}`;
  return type.kind;
}
function numericLiteral(expr: Expr): boolean {
  return expr.kind === "literal" && typeof expr.value === "number"
    || expr.kind === "unary" && expr.op === "-" && numericLiteral(expr.value);
}
function fractionalNumericLiteral(expr: Expr): boolean {
  if (expr.kind === "unary" && expr.op === "-") return fractionalNumericLiteral(expr.value);
  return expr.kind === "literal" && typeof expr.value === "number" && fractionalDigits(expr.numericText) > 0;
}
function fractionalDigits(text: string | undefined): number {
  const dot = text?.indexOf(".") ?? -1;
  return dot < 0 ? 0 : text!.length - dot - 1;
}
function literalCode(expr: Extract<Expr, { kind: "literal" }>): string {
  return typeof expr.value === "number" ? expr.numericText ?? JSON.stringify(expr.value) : JSON.stringify(expr.value);
}
function literalExpressionText(expr: Expr): string {
  if (expr.kind === "unary" && expr.op === "-") return `-${literalExpressionText(expr.value)}`;
  return expr.kind === "literal" && typeof expr.value === "number" ? expr.numericText ?? String(expr.value) : "the literal";
}
function refuseFractionalInt(expr: Extract<Expr, { kind: "binary" }>, left: ValueType, right: ValueType): void {
  const fractional = left.kind === "int" && fractionalNumericLiteral(expr.right)
    ? expr.right
    : right.kind === "int" && fractionalNumericLiteral(expr.left) ? expr.left : undefined;
  if (fractional) {
    typeError(fractional.site, "int positions take integer literals", `replace ${literalExpressionText(fractional)} with an integer literal`);
  }
}
function literalNumber(expr: Expr | undefined): number | undefined { return expr?.kind === "literal" && typeof expr.value === "number" ? expr.value : undefined; }
function property(value: string): string { return /^[A-Za-z_$][\w$]*$/.test(value) ? value : JSON.stringify(value); }
function title(value: string): string { return value.length === 0 ? value : value[0]!.toUpperCase() + value.slice(1); }
function temporary(kind: string, site: Site): string { return `__q_${kind}_${site.line}_${site.col}`; }
function formatSite(site: Site): string { return `${site.file}:${site.line}:${site.col}`; }

function mentionsFocal(expr: Expr): boolean {
  if (expr.kind === "focal") return true;
  if (expr.kind === "member") return mentionsFocal(expr.base);
  if (expr.kind === "binary") return mentionsFocal(expr.left) || mentionsFocal(expr.right);
  if (expr.kind === "unary" || expr.kind === "assert") return mentionsFocal(expr.value);
  if (expr.kind === "call") return expr.args.some(mentionsFocal);
  if (expr.kind === "array") return expr.items.some(mentionsFocal);
  if (expr.kind === "read") {
    return expr.keys.some((key) => mentionsFocal(key.value))
      || (expr.range?.cursor !== undefined && mentionsFocal(expr.range.cursor));
  }
  if (expr.kind === "merge") return expr.lanes.some((lane) => lane.prefix.some(mentionsFocal));
  if (expr.kind === "exists" || expr.kind === "created") return mentionsFocal(expr.read);
  if (expr.kind === "aggregate") return expr.keys.some((key) => mentionsFocal(key.value));
  if (expr.kind === "shape") return mentionsFocal(expr.base) || expr.fields.some((field) => field.kind === "field" && mentionsFocal(field.value));
  if (expr.kind === "walk") return mentionsFocal(expr.seed);
  if (expr.kind === "object") return expr.fields.some((field) => field.value !== undefined && mentionsFocal(field.value));
  if (expr.kind === "write") {
    return expr.keys.some((key) => mentionsFocal(key.value))
      || expr.fields.some((field) => field.value !== undefined && mentionsFocal(field.value));
  }
  return false;
}
