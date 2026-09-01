import type {
  Expr,
  KeyPart,
  ObjectField,
  ProgramDecl,
  ScalarType,
  ShapeField,
  Site,
  Stmt,
  TableCatalog,
} from "./ast";
import { selectIndex } from "./catalog";
import { refuse } from "./diagnostics";
import { header, siteMark, typeCode } from "./schema";

type ValueType =
  | ScalarType
  | { kind: "row"; table: string; nullable: boolean }
  | { kind: "page"; table: string }
  | { kind: "object" }
  | { kind: "unknown" };
type Binding = { code: string; type: ValueType };
type Completion = { kind: "return" } | { kind: "assign"; name: string };
type Emitted = Binding & { effectOnly?: boolean };

class Writer {
  readonly lines: string[] = [];
  indent = 0;
  raw(text = ""): void { this.lines.push(`${"  ".repeat(this.indent)}${text}`); }
  statement(text: string, site: Site): void { this.raw(`${text} ${siteMark(site)}`); }
  nested(run: () => void): void { this.indent += 1; run(); this.indent -= 1; }
}

class Environment {
  readonly bindings = new Map<string, Binding>();
  focal?: Binding;

  constructor(readonly catalog: TableCatalog, readonly program: ProgramDecl) {
    for (const arg of program.args) this.bindings.set(arg.name, { code: `args.${arg.name}`, type: arg.type });
  }

  clone(): Environment {
    const clone = new Environment(this.catalog, this.program);
    clone.bindings.clear();
    for (const [name, binding] of this.bindings) clone.bindings.set(name, { ...binding });
    clone.focal = this.focal && { ...this.focal };
    return clone;
  }
}

export function emitPrograms(programs: ProgramDecl[], catalog: TableCatalog, sourceFile: string): string {
  const writer = new Writer();
  writer.raw(header(sourceFile));
  writer.statement(`import { max, mentionTokens, min, mutation, query, range, recurse, t } from "snapback2";`, { file: sourceFile, line: 1, col: 1 });
  if (catalog.size > 0) writer.statement(`import { ${[...catalog.keys()].join(", ")} } from "./schema";`, { file: sourceFile, line: 1, col: 1 });
  writer.raw();
  writer.statement(`function orderedPair(left: any, right: any): [any, any] { return [left, right]; }`, { file: sourceFile, line: 1, col: 1 });
  writer.raw();
  for (const program of programs) {
    emitProgram(program, catalog, writer);
    writer.raw();
  }
  return `${writer.lines.join("\n").trimEnd()}\n`;
}

function emitProgram(program: ProgramDecl, catalog: TableCatalog, writer: Writer): void {
  const env = new Environment(catalog, program);
  const args = program.args.map((arg) => `${property(arg.name)}: ${typeCode(arg.type)}`).join(", ");
  writer.raw(`export const ${program.name} = ${program.kind}({ ${args} }, ({ db, ctx, args }) => {`);
  writer.nested(() => emitBody(program.body, env, writer, { kind: "return" }));
  writer.statement(`});`, program.site);
}

function emitBody(body: Stmt[], env: Environment, writer: Writer, completion?: Completion): void {
  if (body.length === 0) {
    if (completion?.kind === "return") writer.statement("return null;", env.program.site);
    else if (completion?.kind === "assign") writer.statement(`${completion.name} = null;`, env.program.site);
    return;
  }
  for (const [index, statement] of body.entries()) {
    const isLast = index === body.length - 1;
    emitStatement(statement, env, writer, isLast ? completion : undefined);
  }
}

function emitStatement(statement: Stmt, env: Environment, writer: Writer, completion?: Completion): void {
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
      if (value.effectOnly) refuse(statement.site, "update/upsert/delete do not yield a value on the packaged TypeScript surface; bind a following point read instead");
      const name = statement.names[0]!;
      writer.statement(`const ${name} = ${value.code};`, statement.site);
      env.bindings.set(name, { code: name, type: value.type });
    }
    finishNull(completion, writer, statement.site);
    return;
  }
  if (statement.kind === "require") {
    const condition = emitExpr(statement.condition, env, writer);
    writer.statement(`db.require(${condition.code}, ${JSON.stringify(statement.code)});`, statement.site);
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
    writer.raw(`if (${condition.code}) {`);
    writer.nested(() => emitBody(statement.thenBody, env.clone(), writer, completion));
    if (statement.elseBody.length > 0) {
      writer.raw("} else {");
      writer.nested(() => emitBody(statement.elseBody, env.clone(), writer, completion));
    } else if (completion) {
      writer.raw("} else {");
      writer.nested(() => finishNull(completion, writer, statement.site));
    }
    writer.statement("}", statement.site);
    return;
  }
  if (statement.kind === "for") {
    const domain = emitExpr(statement.domain, env, writer);
    const itemType = domain.type.kind === "page"
      ? { kind: "row", table: domain.type.table, nullable: false } satisfies ValueType
      : domain.type.kind === "list" ? domain.type.item : { kind: "unknown" } satisfies ValueType;
    if (domain.type.kind !== "page" && domain.type.kind !== "list" && domain.type.kind !== "unknown") {
      refuse(statement.domain.site, "for domains must be a page, capped list argument, range, tokens result, or literal list");
    }
    writer.raw(`for (const ${statement.name} of ${domain.code}) {`);
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
  let branchCompletion = completion;
  let result: string | undefined;
  if (completion?.kind === "return") {
    result = temporary("matchResult", statement.site);
    writer.statement(`let ${result}: any = null;`, statement.site);
    branchCompletion = { kind: "assign", name: result };
  }
  writer.raw(`if (${local} !== null) {`);
  writer.nested(() => {
    const nested = env.clone();
    nested.bindings.set(statement.someName, { code: statement.someName, type: { kind: "row", table: statement.read.table, nullable: false } });
    writer.statement(`const ${statement.someName} = ${local};`, statement.site);
    emitBody(statement.someBody, nested, writer, branchCompletion);
  });
  writer.raw("} else {");
  writer.nested(() => emitBody(statement.noneBody, env.clone(), writer, branchCompletion));
  writer.statement("}", statement.site);
  if (result) writer.statement(`return ${result};`, statement.site);
}

function finishNull(completion: Completion | undefined, writer: Writer, site: Site): void {
  if (!completion) return;
  if (completion.kind === "return") writer.statement("return null;", site);
  else writer.statement(`${completion.name} = null;`, site);
}

function emitExpr(expr: Expr, env: Environment, writer: Writer): Emitted {
  if (expr.kind === "literal") return { code: JSON.stringify(expr.value), type: literalType(expr.value) };
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
  if (expr.kind === "unary") {
    const value = emitExpr(expr.value, env, writer);
    return { code: `${expr.op === "not" ? "!" : "-"}(${value.code})`, type: expr.op === "not" ? boolType() : value.type };
  }
  if (expr.kind === "binary") return emitBinary(expr, env, writer);
  if (expr.kind === "member") return emitMember(expr, env, writer);
  if (expr.kind === "call") return emitCall(expr, env, writer);
  if (expr.kind === "read") return emitRead(expr, env, writer);
  if (expr.kind === "exists") {
    const read = emitRead(expr.read, env, writer, true);
    return { code: read.code, type: boolType() };
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
      type: { kind: "list", item: { kind: "ref", table: expr.table, optional: false }, max: expr.depth + 1, optional: false },
    };
  }
  return emitWrite(expr, env, writer);
}

function emitName(name: string, site: Site, env: Environment): Emitted {
  const binding = env.bindings.get(name);
  if (binding) return binding;
  if (name === "viewer") return { code: "ctx.viewer", type: { kind: "ref", table: "", optional: false } };
  if (name === "now") return { code: "ctx.now()", type: { kind: "time", optional: false } };
  if (name === "commit") return { code: "ctx.commitTime", type: { kind: "time", optional: false } };
  if (name === "new") return { code: "ctx.newId()", type: { kind: "ref", table: "", optional: false } };
  refuse(site, `unknown name ${name}`);
}

function emitBinary(expr: Extract<Expr, { kind: "binary" }>, env: Environment, writer: Writer): Emitted {
  const left = emitExpr(expr.left, env, writer);
  const right = emitExpr(expr.right, env, writer);
  if (expr.op === "and" || expr.op === "or") return { code: `(${left.code} ${expr.op === "and" ? "&&" : "||"} ${right.code})`, type: boolType() };
  if (expr.op === "??") return { code: `(${left.code} ?? ${right.code})`, type: nonNullable(left.type) };
  const operator = expr.op === "=" ? "===" : expr.op;
  if (["=", "!=", "<", "<=", ">", ">="].includes(expr.op)) {
    const leftName = temporary("left", expr.site);
    const rightName = temporary("right", expr.site);
    writer.statement(`const ${leftName} = ${left.code};`, expr.left.site);
    writer.statement(`const ${rightName} = ${right.code};`, expr.right.site);
    const comparison = expr.op === "!=" ? `${leftName} !== ${rightName}` : `${leftName} ${operator} ${rightName}`;
    return { code: `(${leftName} !== null && ${rightName} !== null && ${comparison})`, type: boolType() };
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
  if (base.type.kind === "row") {
    const info = env.catalog.get(base.type.table);
    const column = expr.name === "id"
      ? { kind: "ref", table: base.type.table, optional: false } satisfies ScalarType
      : info?.columns.get(expr.name);
    if (!column) refuse(expr.site, `table ${base.type.table} has no column ${expr.name}`);
    return { code: `${base.code}${base.type.nullable ? "?." : "."}${expr.name}`, type: { ...column, optional: column.optional || base.type.nullable } };
  }
  if (base.type.kind === "object" || base.type.kind === "unknown") return { code: `${base.code}?.${expr.name}`, type: { kind: "unknown" } };
  refuse(expr.site, `cannot select .${expr.name} from ${base.type.kind}`);
}

function emitCall(expr: Extract<Expr, { kind: "call" }>, env: Environment, writer: Writer): Emitted {
  if (expr.name === "sorted") {
    refuse(expr.site, "sorted(a, b) must be consumed by a two-name binding: (lo, hi) = sorted(a, b)");
  }
  const target = expr.name === "tokens" ? "mentionTokens" : expr.name;
  if (!["tokens", "range", "min", "max"].includes(expr.name)) {
    refuse(expr.site, `call to ${expr.name} is not a Quarry builtin; recursion and user functions are not supported`);
  }
  const args = expr.args.map((arg) => emitExpr(arg, env, writer));
  if (expr.name === "tokens") return { code: `${target}(${args.map((arg) => arg.code).join(", ")})`, type: { kind: "list", item: { kind: "text", max: 4096, optional: false }, max: 64, optional: false } };
  if (expr.name === "range") {
    if (args.length !== 2) refuse(expr.site, "range(a, b) requires two arguments");
    const start = literalNumber(expr.args[0]);
    const end = literalNumber(expr.args[1]);
    const max = start === undefined || end === undefined ? 1000 : Math.max(0, end - start);
    return { code: `range(${args.map((arg) => arg.code).join(", ")})`, type: { kind: "list", item: { kind: "int", optional: false }, max, optional: false } };
  }
  return { code: `${target}(${args.map((arg) => arg.code).join(", ")})`, type: args[0]?.type ?? { kind: "int", optional: false } };
}

function emitRead(expr: Extract<Expr, { kind: "read" }>, env: Environment, writer: Writer, exists = false): Emitted {
  if (!env.catalog.has(expr.table)) refuse(expr.site, `unknown table ${expr.table}`);
  const mode = expr.range ? "range" : "point";
  const index = selectIndex(env.catalog, expr.table, expr.keys, mode, expr.range?.index, (value) => inferExpr(value, env), expr.site);
  const keys = expr.keys.map((key) => keyBinding(emitExpr(key.value, env, writer)));
  const target = index.name === "byId" ? expr.table : `${expr.table}.${index.name}`;
  if (expr.range) {
    if (expr.range.cursorKind === "before" && expr.range.order !== "desc") refuse(expr.range.site, "before is supported only with last N; use after with first N for ascending pagination");
    const options = [`order: ${JSON.stringify(expr.range.order)}`, `take: ${expr.range.take}`];
    if (expr.range.cursor) options.push(`after: ${emitExpr(expr.range.cursor, env, writer).code}`);
    return { code: `db.scan(${target}, [${keys.map((key) => key.code).join(", ")}], { ${options.join(", ")} })`, type: { kind: "page", table: expr.table } };
  }
  const key = index.name === "byId" && keys.length === 1 ? keys[0]!.code : `[${keys.map((item) => item.code).join(", ")}]`;
  return exists
    ? { code: `db.exists(${target}, ${key})`, type: boolType() }
    : { code: `db.get(${target}, ${key})`, type: { kind: "row", table: expr.table, nullable: true } };
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
  if (base.type.kind === "page") return emitPageShape(base, expr.fields, expr.site, env, writer);
  if (base.type.kind !== "row") refuse(expr.site, "shapes may focus only a row, reference, or page");
  const rowType = base.type;
  const focalName = temporary("row", expr.site);
  writer.statement(`const ${focalName} = ${base.code};`, expr.site);
  const result = temporary("shape", expr.site);
  if (rowType.nullable) {
    writer.statement(`let ${result}: any = null;`, expr.site);
    writer.raw(`if (${focalName} !== null) {`);
    writer.nested(() => {
      const shaped = shapeObject(expr.fields, { code: focalName, type: { ...rowType, nullable: false } }, env, writer);
      writer.statement(`${result} = ${shaped};`, expr.site);
    });
    writer.statement("}", expr.site);
  } else {
    const shaped = shapeObject(expr.fields, { code: focalName, type: rowType }, env, writer);
    writer.statement(`const ${result} = ${shaped};`, expr.site);
  }
  return { code: result, type: { kind: "object" } };
}

function emitPageShape(base: Binding, fields: ShapeField[], site: Site, env: Environment, writer: Writer): Emitted {
  const page = temporary("page", site);
  const result = temporary("rows", site);
  const row = temporary("row", site);
  writer.statement(`const ${page} = ${base.code};`, site);
  writer.statement(`const ${result}: any[] = [];`, site);
  writer.raw(`for (const ${row} of ${page}) {`);
  writer.nested(() => {
    const shaped = shapeObject(fields, { code: row, type: { kind: "row", table: (base.type as { table: string }).table, nullable: false } }, env, writer);
    writer.statement(`${result}.push(${shaped});`, site);
  });
  writer.statement("}", site);
  return { code: result, type: { kind: "list", item: { kind: "ref", table: (base.type as { table: string }).table, optional: false }, max: 1000, optional: false } };
}

function shapeObject(fields: ShapeField[], focal: Binding, env: Environment, writer: Writer): string {
  const prior = env.focal;
  env.focal = focal;
  try {
    const properties: string[] = [];
    for (const field of fields) {
      if (field.kind === "spread") properties.push(`...${focal.code}`);
      else if (field.kind === "bare") properties.push(`${property(field.name)}: ${emitMember({ kind: "member", base: { kind: "focal", site: field.site }, name: field.name, site: field.site }, env, writer).code}`);
      else properties.push(`${property(field.name)}: ${emitExpr(field.value, env, writer).code}`);
    }
    return `{ ${properties.join(", ")} }`;
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
  if (index.name !== "byId" || expr.keys.length !== 1) {
    refuse(expr.site, `the packaged db.${expr.op} surface accepts only a scalar id key; get the row by ${index.name} and write using its id`);
  }
  const key = keyBinding(emitExpr(expr.keys[0]!.value, env, writer));
  if (expr.op === "delete") {
    writer.statement(`db.delete(${expr.table}, ${key.code});`, expr.site);
    return { code: "null", type: { kind: "unknown" }, effectOnly: true };
  }
  const prior = env.focal;
  const rowName = temporary("old", expr.site);
  env.focal = { code: rowName, type: { kind: "row", table: expr.table, nullable: expr.op === "upsert" } };
  let fields: string[];
  try {
    fields = emitFields(expr.fields, env, writer, info.columns);
  } finally {
    env.focal = prior;
  }
  if (expr.op === "upsert" && !expr.fields.some((field) => field.name === "id")) fields.unshift(`id: ${key.code}`);
  const usesFocal = expr.fields.some((field) => field.value && mentionsFocal(field.value));
  const patch = usesFocal || expr.op === "upsert" ? `(${rowName}) => ({ ${fields.join(", ")} })` : `{ ${fields.join(", ")} }`;
  writer.statement(`db.${expr.op}(${expr.table}, ${key.code}, ${patch});`, expr.site);
  return { code: "null", type: { kind: "unknown" }, effectOnly: true };
}

function emitFields(fields: ObjectField[], env: Environment, writer: Writer, columns: Map<string, ScalarType>): string[] {
  return fields.map((field) => {
    const value = emitExpr(field.value ?? { kind: "name", name: field.name, site: field.site }, env, writer);
    const expected = field.name === "id" ? { kind: "id", optional: false } satisfies ScalarType : columns.get(field.name);
    const code = expected && (expected.kind === "ref" || expected.kind === "id") ? keyBinding(value).code : value.code;
    return `${property(field.name)}: ${code}`;
  });
}

function inferExpr(expr: Expr, env: Environment): ScalarType | undefined {
  if (expr.kind === "name") {
    const binding = env.bindings.get(expr.name)?.type;
    if (binding && isScalar(binding)) return binding;
    if (binding?.kind === "row") return { kind: "ref", table: binding.table, optional: binding.nullable };
    if (expr.name === "viewer" || expr.name === "new") return { kind: "ref", table: "", optional: false };
    if (expr.name === "now" || expr.name === "commit") return { kind: "time", optional: false };
  }
  if (expr.kind === "focal" && env.focal?.type.kind === "row") return { kind: "ref", table: env.focal.type.table, optional: env.focal.type.nullable };
  if (expr.kind === "literal") return literalType(expr.value);
  if (expr.kind === "member") {
    const base = inferExpr(expr.base, env);
    if (base?.kind === "ref" && base.table) return env.catalog.get(base.table)?.columns.get(expr.name);
  }
  return undefined;
}

function literalType(value: string | number | boolean | null): ScalarType {
  if (typeof value === "string") return { kind: "text", max: Math.max(1, value.length), optional: false };
  if (typeof value === "number") return { kind: "int", optional: false };
  if (typeof value === "boolean") return { kind: "bool", optional: false };
  return { kind: "text", max: 1, optional: true };
}

function scalarOrUnknown(type: ValueType): ScalarType {
  return isScalar(type) ? type : { kind: "text", max: 1, optional: true };
}

function isScalar(type: ValueType): type is ScalarType {
  return ["text", "id", "int", "time", "bool", "enum", "ref", "list"].includes(type.kind);
}

function isRef(type: ValueType): type is Extract<ScalarType, { kind: "ref" }> { return type.kind === "ref"; }
function nonNullable(type: ValueType): ValueType {
  if (type.kind === "row") return { ...type, nullable: false };
  if (isScalar(type)) return { ...type, optional: false } as ScalarType;
  return type;
}
function boolType(): ScalarType { return { kind: "bool", optional: false }; }
function keyBinding(value: Emitted): Emitted {
  return value.type.kind === "row" ? { ...value, code: `${value.code}.id`, type: { kind: "ref", table: value.type.table, optional: value.type.nullable } } : value;
}
function literalNumber(expr: Expr | undefined): number | undefined { return expr?.kind === "literal" && typeof expr.value === "number" ? expr.value : undefined; }
function property(value: string): string { return /^[A-Za-z_$][\w$]*$/.test(value) ? value : JSON.stringify(value); }
function temporary(kind: string, site: Site): string { return `__q_${kind}_${site.line}_${site.col}`; }

function mentionsFocal(expr: Expr): boolean {
  if (expr.kind === "focal") return true;
  if (expr.kind === "member") return mentionsFocal(expr.base);
  if (expr.kind === "binary") return mentionsFocal(expr.left) || mentionsFocal(expr.right);
  if (expr.kind === "unary" || expr.kind === "assert") return mentionsFocal(expr.value);
  if (expr.kind === "call") return expr.args.some(mentionsFocal);
  if (expr.kind === "shape") return mentionsFocal(expr.base) || expr.fields.some((field) => field.kind === "field" && mentionsFocal(field.value));
  return false;
}
