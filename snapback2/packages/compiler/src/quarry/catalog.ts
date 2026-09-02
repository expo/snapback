import type { Document, Expr, IndexDecl, KeyPart, ScalarType, Site, TableCatalog, TableDecl } from "./ast";
import { ambiguous, refuse } from "./diagnostics";

export function buildCatalog(documents: Document[]): TableCatalog {
  const catalog: TableCatalog = new Map();
  for (const document of documents) {
    for (const table of document.tables) {
      if (catalog.has(table.name)) refuse(table.site, `duplicate table ${table.name}`);
      const columns = new Map<string, ScalarType>();
      for (const column of table.columns) {
        if (column.name === "id") refuse(column.site, `table ${table.name} gets id implicitly; remove the id column`);
        if (columns.has(column.name)) refuse(column.site, `duplicate column ${table.name}.${column.name}`);
        columns.set(column.name, column.type);
      }
      const indexes: IndexDecl[] = [{ name: "byId", columns: ["id"], unique: true, site: table.site }, ...table.indexes];
      const indexNames = new Set<string>();
      for (const index of indexes) {
        if (indexNames.has(index.name)) refuse(index.site, `duplicate index ${table.name}.${index.name}; name one ordering explicitly`);
        indexNames.add(index.name);
        if (index.columns.length === 0) refuse(index.site, `index ${table.name}.${index.name} needs at least one column`);
        if (new Set(index.columns).size !== index.columns.length) refuse(index.site, `index ${table.name}.${index.name} repeats a column`);
        for (const column of index.columns) {
          if (column !== "id" && !columns.has(column)) refuse(index.site, `index ${table.name}.${index.name} names unknown column ${column}`);
        }
      }
      const ruleEffects = new Set<string>();
      for (const rule of table.rules) {
        if (ruleEffects.has(rule.effect)) refuse(rule.site, `duplicate ${rule.effect} rule on ${table.name}`);
        ruleEffects.add(rule.effect);
      }
      catalog.set(table.name, { declaration: table, columns, indexes });
    }
  }
  for (const info of catalog.values()) {
    for (const column of info.declaration.columns) validateType(column.type, catalog, column.site);
  }
  for (const document of documents) {
    const channelNames = new Set<string>();
    for (const channel of document.channels) {
      if (channelNames.has(channel.name)) refuse(channel.site, `duplicate channel ${channel.name}`);
      channelNames.add(channel.name);
      validateArgs(channel.args, catalog);
    }
    const programNames = new Set<string>();
    for (const program of document.programs) {
      if (programNames.has(program.name)) refuse(program.site, `duplicate operation ${program.name}`);
      programNames.add(program.name);
      validateArgs(program.args, catalog);
      if (program.result) validateType(program.result, catalog, program.site);
    }
  }
  return catalog;
}

function validateArgs(args: Array<{ name: string; type: ScalarType; site: Site }>, catalog: TableCatalog): void {
  const names = new Set<string>();
  for (const arg of args) {
    if (names.has(arg.name)) refuse(arg.site, `duplicate argument ${arg.name}`);
    names.add(arg.name);
    validateType(arg.type, catalog, arg.site);
  }
}

function validateType(type: ScalarType, catalog: TableCatalog, site: Site): void {
  if (type.kind === "text" && type.max < 1) refuse(site, "text bounds must be positive");
  if (type.kind === "text" && type.min !== undefined && (type.min < 0 || type.min > type.max)) refuse(site, "text minimum must be between zero and its maximum");
  if ((type.kind === "json" || type.kind === "bytes") && type.max < 1) refuse(site, `${type.kind} bounds must be positive`);
  if (type.kind === "enum" && (type.variants.length === 0 || new Set(type.variants).size !== type.variants.length)) refuse(site, "enum variants must be non-empty and unique");
  if (type.kind === "ref" && !catalog.has(type.table)) refuse(site, `reference names unknown table ${type.table}`);
  if (type.kind === "list") {
    if (type.max < 1) refuse(site, "list bounds must be positive");
    validateType(type.item, catalog, site);
  }
}

export function orderedTables(catalog: TableCatalog): TableDecl[] {
  // @ref LLP 1004#what-default-binds — the TypeScript lowering is static, so
  // `export var` declarations may retain reciprocal rule/reference graphs.
  return [...catalog.values()].map((info) => info.declaration);
}

function dependencies(table: TableDecl): string[] {
  const result = new Set<string>();
  for (const column of table.columns) collectTypeDependencies(column.type, result);
  for (const rule of table.rules) collectExprDependencies(rule.value, result);
  return [...result];
}

function collectTypeDependencies(type: ScalarType, into: Set<string>): void {
  if (type.kind === "ref") into.add(type.table);
  if (type.kind === "list") collectTypeDependencies(type.item, into);
}

function collectExprDependencies(expr: Expr, into: Set<string>): void {
  if (expr.kind === "read") {
    into.add(expr.table);
    for (const key of expr.keys) collectExprDependencies(key.value, into);
    if (expr.range?.cursor) collectExprDependencies(expr.range.cursor, into);
  } else if (expr.kind === "exists" || expr.kind === "created") {
    collectExprDependencies(expr.read, into);
  } else if (expr.kind === "aggregate") {
    into.add(expr.table);
    for (const key of expr.keys) collectExprDependencies(key.value, into);
  } else if (expr.kind === "binary") {
    collectExprDependencies(expr.left, into);
    collectExprDependencies(expr.right, into);
  } else if (expr.kind === "unary" || expr.kind === "assert") {
    collectExprDependencies(expr.value, into);
  } else if (expr.kind === "member") {
    collectExprDependencies(expr.base, into);
  } else if (expr.kind === "call") {
    for (const arg of expr.args) collectExprDependencies(arg, into);
  } else if (expr.kind === "shape") {
    collectExprDependencies(expr.base, into);
    for (const field of expr.fields) if (field.kind === "field") collectExprDependencies(field.value, into);
  } else if (expr.kind === "walk") {
    into.add(expr.table);
    collectExprDependencies(expr.seed, into);
  } else if (expr.kind === "write") {
    into.add(expr.table);
    for (const key of expr.keys) collectExprDependencies(key.value, into);
    for (const field of expr.fields) if (field.value) collectExprDependencies(field.value, into);
  } else if (expr.kind === "array") {
    for (const item of expr.items) collectExprDependencies(item, into);
  } else if (expr.kind === "object") {
    for (const field of expr.fields) if (field.value) collectExprDependencies(field.value, into);
  }
}

export function selectIndex(
  catalog: TableCatalog,
  table: string,
  keys: KeyPart[],
  mode: "point" | "range" | "exists",
  explicit: string | undefined,
  infer: (expr: Expr) => ScalarType | undefined,
  site: Site,
): IndexDecl {
  const info = catalog.get(table);
  if (!info) refuse(site, `unknown table ${table}`);
  if (explicit) {
    const selected = info.indexes.find((index) => index.name === explicit);
    if (!selected) refuse(site, `table ${table} has no index ${explicit}`);
    validateIndexKeys(info.declaration, selected, keys, mode, infer, site);
    return selected;
  }
  const named = keys.some((key) => key.column !== undefined);
  if (named && keys.some((key) => key.column === undefined)) refuse(site, "an index key cannot mix named and positional parts");
  let candidates = info.indexes.filter((index) => {
    if (mode === "range" && index.name === "byId") return false;
    if (mode === "point" && (!index.unique || index.columns.length !== keys.length)) return false;
    if ((mode === "range" || mode === "exists") && index.columns.length < keys.length) return false;
    if (named) return keys.every((key, offset) => index.columns[offset] === key.column);
    return keys.every((key, offset) => compatible(infer(key.value), columnType(info.declaration, index.columns[offset]!)));
  });
  if (mode === "point" && keys.length === 1 && !named) {
    const type = infer(keys[0]!.value);
    if (type?.kind === "ref" && (type.table === table || type.table === "")) candidates = candidates.filter((index) => index.name === "byId");
    else if (candidates.some((index) => index.name !== "byId")) candidates = candidates.filter((index) => index.name !== "byId");
  }
  if (mode !== "range") {
    const exact = candidates.filter((index) => index.columns.length === keys.length);
    if (exact.length > 0) candidates = exact;
  }
  if (candidates.length === 0) {
    const spelling = keys.map((key) => key.column ?? "?").join(", ");
    refuse(site, `no ${mode === "point" ? "unique index" : "ordering"} on ${table} matches [${spelling}]; name the columns/index or add one`);
  }
  if (candidates.length > 1) ambiguous(
    site,
    `index selection for ${table}[...] is ambiguous (${candidates.map((item) => item.name).join(", ")}); name it with by <index>`,
    `${table}[${keys.map((key) => key.value.kind === "name" ? key.value.name : "key").join(", ")}] by ${candidates[0]!.name}`,
  );
  const selected = candidates[0]!;
  validateIndexKeys(info.declaration, selected, keys, mode, infer, site);
  return selected;
}

function validateIndexKeys(
  table: TableDecl,
  index: IndexDecl,
  keys: KeyPart[],
  mode: "point" | "range" | "exists",
  infer: (expr: Expr) => ScalarType | undefined,
  site: Site,
): void {
  if (mode === "point" && (!index.unique || index.columns.length !== keys.length)) refuse(site, `${table.name}.${index.name} is not a complete unique key`);
  if ((mode === "range" || mode === "exists") && index.columns.length < keys.length) refuse(site, `${table.name}.${index.name} has no ${keys.length}-column prefix`);
  for (const [offset, key] of keys.entries()) {
    const column = index.columns[offset]!;
    if (key.column && column !== key.column) refuse(key.site, `${table.name}.${index.name} expects ${column} at key position ${offset + 1}`);
    const actual = infer(key.value);
    const expected = columnType(table, column);
    if (actual && !compatible(actual, expected)) {
      refuse(key.value.site, `${table.name}.${index.name} expects ${typeName(expected)} for ${column}, got ${typeName(actual)}`);
    }
  }
}

function columnType(table: TableDecl, name: string): ScalarType {
  if (name === "id") return { kind: "ref", table: table.name, optional: false };
  return table.columns.find((column) => column.name === name)?.type ?? { kind: "int", optional: false };
}

function compatible(actual: ScalarType | undefined, expected: ScalarType): boolean {
  if (!actual) return true;
  if (expected.kind === "ref") {
    if (actual.kind === "id") return true;
    return actual.kind === "ref" && (actual.table === "" || actual.table === expected.table);
  }
  if (expected.kind === "id") return actual.kind === "ref" || actual.kind === "id";
  if (expected.kind === "principal") return actual.kind === "principal";
  if (expected.kind === "enum" && actual.kind === "text") return true;
  return actual.kind === expected.kind;
}

function typeName(type: ScalarType): string {
  if (type.kind === "ref") return `reference to ${type.table}`;
  if (type.kind === "list") return "list";
  return type.kind;
}
