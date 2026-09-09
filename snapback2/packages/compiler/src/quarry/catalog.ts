import { columnAt, columnComponents, componentLabel, componentProblem, derivedPosition, MAX_SEARCH_SOURCE_SCALARS } from "../index-components";
import type { IndexComponent } from "../ir";
import type { Document, Expr, IndexDecl, KeyPart, ScalarType, Site, TableCatalog, TableDecl } from "./ast";
import { quarryExpression } from "./print";
import { QuarryError, ambiguous, refuse, typeError } from "./diagnostics";

export function buildCatalog(documents: Document[]): TableCatalog {
  const catalog: TableCatalog = new Map();
  // @ref LLP 1001#51-connected — a virtual program read, never an authored table.
  const site = { file: documents[0]?.file ?? "snapback/schema.q", line: 1, col: 1 };
  const declaration: TableDecl = {
    name: "connected", site,
    columns: [
      { name: "principal", type: { kind: "principal", optional: false }, site },
      { name: "value", type: { kind: "int", optional: false }, site },
    ],
    indexes: [{ name: "byPrincipal", components: columnComponents(["principal"]), unique: true, site }],
    rules: [], immutable: [], caps: [], finalExists: [], tombstones: [],
  };
  catalog.set("connected", { declaration, columns: new Map(declaration.columns.map(c => [c.name, c.type])), indexes: declaration.indexes });
  for (const document of documents) {
    for (const table of document.tables) {
      if (catalog.has(table.name)) refuse(table.site, `duplicate table ${table.name}`);
      const columns = new Map<string, ScalarType>();
      for (const column of table.columns) {
        if (column.name === "id") refuse(column.site, `table ${table.name} gets id implicitly; remove the id column`);
        if (columns.has(column.name)) refuse(column.site, `duplicate column ${table.name}.${column.name}`);
        columns.set(column.name, column.type);
      }
      const indexes: IndexDecl[] = [{ name: "byId", components: columnComponents(["id"]), unique: true, site: table.site }, ...table.indexes];
      const indexNames = new Set<string>();
      for (const index of indexes) {
        if (indexNames.has(index.name)) refuse(index.site, `duplicate index ${table.name}.${index.name}; name one ordering explicitly`);
        indexNames.add(index.name);
        const problem = componentProblem(index.components, index.unique, name => {
          const type = name === "id" ? { kind: "id" } : columns.get(name);
          // Ordinary column-domain refusals are aggregated before catalog construction.
          return type ? { indexable: true,
            ...(type.kind === "text" ? { textMax: (type as Extract<ScalarType, { kind: "text" }>).max } : {}) } : undefined;
        });
        if (problem) typeError(index.site, `${table.name}.${index.name}: ${problem}`, "use one nonunique wordPrefixes(textField) between ordinary scope and ordering components");
      }
      const capped = new Set<string>();
      for (const cap of table.caps) {
        const tuple = JSON.stringify(cap.by);
        const repair = `cap ${cap.max} by ${[...new Set(cap.by)].join(", ")}`;
        for (const name of cap.by) {
          if (name === "id") continue;
          const column = columns.get(name);
          if (!column) {
            const nearest = [...columns.keys()].sort((a, b) => distance(name, a) - distance(name, b))[0];
            refuse(cap.site, `${table.name} cap names unknown column ${name}${nearest ? `; did you mean ${nearest}?` : ""}`,
              `cap ${cap.max} by ${cap.by.map((c) => c === name ? nearest ?? c : c).join(", ")}`);
          }
          if (["list", "image", "video"].includes(column.kind)) {
            throw new QuarryError(cap.site, `cap on ${table.name} needs indexable grouping column ${name}`, "E_SCHEMA_CONSTRAINT", "cap 50 by <scalar columns>", "schema/project");
          }
        }
        if (new Set(cap.by).size !== cap.by.length) throw new QuarryError(cap.site, `cap on ${table.name} repeats a grouping column`, "E_SCHEMA_CONSTRAINT", repair, "schema/project");
        if (capped.has(tuple)) throw new QuarryError(cap.site, `${table.name} already caps ${cap.by.join(", ")}`, "E_SCHEMA_CONSTRAINT", "remove the duplicate cap line", "schema/project");
        capped.add(tuple);
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
      validateArgs(channel.value, catalog);
      for (const field of channel.value) validateChannelValue(field.type, field.site);
    }
    const programNames = new Set<string>();
    for (const program of document.programs) {
      if (programNames.has(program.name)) refuse(program.site, `duplicate operation ${program.name}`);
      programNames.add(program.name);
      validateArgs(program.args, catalog);
    }
    // Helper parameters get the same validation as operation arguments (LLP 1018.005 §2).
    for (const helper of [...document.functions, ...document.procs]) validateArgs(helper.args, catalog);
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

// @ref LLP 1001.000#declaration-and-value — latest state owns no asset custody, byte stream or durable cursor.
function validateChannelValue(type: ScalarType, site: Site): void {
  if (["bytes", "image", "video", "cursor"].includes(type.kind)) throw new QuarryError(site,
    `channel values do not support ${type.kind}`, "E_QUARRY_TYPE",
    "use bounded text, json, scalars, enums, optionals or lists in value", "live-query");
  if ((type.kind === "text" || type.kind === "json" || type.kind === "list")
    && (!Number.isInteger(type.max) || type.max < 1 || type.max > 0xffff_ffff)) throw new QuarryError(site,
    "channel value bounds must be positive integers no larger than 4294967295", "E_QUARRY_TYPE",
    "use a positive bounded text, json or list type", "live-query");
  if (type.kind === "list") validateChannelValue(type.item, site);
}

function validateType(type: ScalarType, catalog: TableCatalog, site: Site): void {
  if (type.kind === "ref" && type.table === "connected") refuse(site, "connected has principal keys, not row references", "declare this value as principal");
  if (type.kind === "text" && type.max < 1) refuse(site, "text bounds must be positive");
  if (type.kind === "text" && type.min !== undefined && (type.min < 0 || type.min > type.max)) refuse(site, "text minimum must be between zero and its maximum");
  if ((type.kind === "json" || type.kind === "bytes") && type.max < 1) refuse(site, `${type.kind} bounds must be positive`);
  if ((type.kind === "image" || type.kind === "video")
    && (!Number.isInteger(type.max) || type.max < 1 || type.max > 0xffff_ffff)) {
    refuse(site, `${type.kind} byte bounds must be positive integers no larger than 4294967295`);
  }
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
    if (expr.range?.where) collectExprDependencies(expr.range.where.predicate, into);
  } else if (expr.kind === "merge") {
    into.add(expr.table);
    if (expr.cursor) collectExprDependencies(expr.cursor, into);
    for (const lane of expr.lanes) {
      for (const value of lane.prefix) collectExprDependencies(value, into);
      if (lane.loop) collectExprDependencies(lane.loop.domain, into);
    }
  } else if (expr.kind === "exists" || expr.kind === "created") {
    collectExprDependencies(expr.read, into);
  } else if (expr.kind === "binary") {
    collectExprDependencies(expr.left, into);
    collectExprDependencies(expr.right, into);
  } else if (expr.kind === "unary" || expr.kind === "assert") {
    collectExprDependencies(expr.value, into);
  } else if (expr.kind === "member") {
    collectExprDependencies(expr.base, into);
  } else if (expr.kind === "call") {
    for (const arg of expr.args) collectExprDependencies(arg, into);
  } else if (expr.kind === "shapeUse") {
    collectExprDependencies(expr.base, into);
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
  if (!info) refuse(site, `unknown table ${table}`, `available tables: ${[...catalog.keys()].join(", ")}`);
  const named = keys.some((key) => key.column !== undefined);
  if (named && keys.some((key) => key.column === undefined)) refuse(site, "an index key cannot mix named and positional parts");
  if (explicit) {
    const selected = info.indexes.find((index) => index.name === explicit);
    if (!selected) refuse(site, `table ${table} has no index ${explicit}`, indexGuidance(info.declaration, info.indexes));
    validateIndexKeys(info.declaration, selected, keys, mode, infer, site);
    return selected;
  }
  let candidates = info.indexes.filter((index) => {
    if (mode === "range" && index.name === "byId") return false;
    const derived = derivedPosition(index.components);
    if (derived >= 0 && (mode !== "range" || keys.length <= derived)) return false;
    if (table === "connected" && keys.length !== 1) return false;
    if (mode === "point" && (!index.unique || index.components.length !== keys.length)) return false;
    if ((mode === "range" || mode === "exists") && index.components.length < keys.length) return false;
    if (named) return keys.every((key, offset) => columnAt(index.components, offset) === key.column);
    return keys.every((key, offset) => componentKeyCompatible(key.value, infer(key.value), info.declaration, index.components[offset]!));
  });
  if (mode === "point" && keys.length === 1 && !named) {
    const type = infer(keys[0]!.value);
    if (type?.kind === "ref" && (type.table === table || type.table === "")) candidates = candidates.filter((index) => index.name === "byId");
    else if (candidates.some((index) => index.name !== "byId")) candidates = candidates.filter((index) => index.name !== "byId");
  }
  if (mode !== "range") {
    const exact = candidates.filter((index) => index.components.length === keys.length);
    if (exact.length > 0) candidates = exact;
  }
  if (candidates.length === 0) {
    const spelling = keys.map((key) => key.column ?? "?").join(", ");
    const eligible = info.indexes.filter((index) => mode !== "point" || index.unique);
    const requiredNull = eligible.flatMap((index) => keys.flatMap((key, offset) => {
      const column = columnAt(index.components, offset);
      return column && (!key.column || key.column === column) && key.value.kind === "literal" && key.value.value === null
        && !columnType(info.declaration, column).optional ? [`${table}.${index.name}.${column} is required; null needs an optional key column`] : [];
    }));
    refuse(site, `no ${mode === "point" ? "unique index" : "ordering"} on ${table} matches [${spelling}]; name the columns/index or add one`,
      [...requiredNull, indexGuidance(info.declaration, eligible)].join("; "));
  }
  if (candidates.length > 1) ambiguous(
    site,
    `index selection for ${table}[...] is ambiguous (${candidates.map((item) => item.name).join(", ")}); name it with by <index>`,
    `${indexGuidance(info.declaration, candidates)}; select with by <index>`,
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
  if (table.name === "connected" && (keys.length !== 1 || infer(keys[0]!.value)?.kind !== "principal" || infer(keys[0]!.value)?.optional)) {
    refuse(site, "connected requires one nonoptional principal", "use connected[viewer] or exists connected[p] with p: principal");
  }
  const derived = derivedPosition(index.components);
  if (derived >= 0 && mode !== "range") typeError(site, "wordPrefixes indexes are scan-only; point, exists, rule, and write addressing require ordinary indexes", "use an ordinary index for this address or first/last for search");
  if (derived >= 0 && keys.length <= derived) typeError(site, "search must equality-bind through the wordPrefixes component", "supply ordinary scope keys followed by a bounded text term");
  if (mode === "point" && (!index.unique || index.components.length !== keys.length)) refuse(site, `${table.name}.${index.name} is not a complete unique key`);
  if ((mode === "range" || mode === "exists") && index.components.length < keys.length) refuse(site, `${table.name}.${index.name} has no ${keys.length}-column prefix`);
  for (const [offset, key] of keys.entries()) {
    const component = index.components[offset]!;
    if ("WordPrefixes" in component) {
      if (key.column) typeError(key.site, "wordPrefixes is a derived component, not a source column", "use positional keys for a search index");
      if (!componentKeyCompatible(key.value, infer(key.value), table, component)) typeError(key.value.site,
        "wordPrefixes requires present bounded text with its own declared maximum", "pass term: text <=N; use ! or ?? for optional text; do not construct text with +");
      continue;
    }
    const column = component.Column;
    if (key.column && column !== key.column) refuse(key.site, `${table.name}.${index.name} expects ${column} at key position ${offset + 1}`);
    const actual = infer(key.value);
    const expected = columnType(table, column);
    if (expected.kind === "int" && fractionalNumericLiteral(key.value)) {
      typeError(key.value.site, "int positions take integer literals", "use an integer literal for this int index key");
    }
    if (!keyCompatible(key.value, actual, expected)) {
      const received = key.value.kind === "literal" && key.value.value === null ? "null" : actual ? typeName(actual) : "unknown";
      const required = received === "null" && !expected.optional ? `; ${column} is required` : "";
      const alternatives = table.indexes.filter((candidate) => candidate.unique && derivedPosition(candidate.components) < 0 && candidate.components.length === keys.length
        && keys.every((part, i) => keyCompatible(part.value, infer(part.value), columnType(table, columnAt(candidate.components, i)!))));
      const replacement = mode === "point" && alternatives.length === 1 ? alternatives[0] : undefined;
      const rewrite = replacement
        ? `${table.name}[${keys.map((part, i) => `${columnAt(replacement.components, i)} = ${quarryExpression(part.value)}`).join(", ")}]`
        : `${table.name}.${index.name}.${column} requires ${typeName(expected)}; received ${received}${required}; ${indexGuidance(table, [index])}`;
      refuse(key.value.site, `${table.name}.${index.name} expects ${typeName(expected)} for ${column}, got ${received}${required}`, rewrite, !!replacement);
    }
  }
}

function componentKeyCompatible(expr: Expr, actual: ScalarType | undefined, table: TableDecl, component: IndexComponent): boolean {
  if ("Column" in component) return keyCompatible(expr, actual, columnType(table, component.Column));
  return actual?.kind === "text" && !actual.optional && !("builtText" in actual && actual.builtText)
    && Number.isSafeInteger(actual.max) && actual.max >= 0 && actual.max <= MAX_SEARCH_SOURCE_SCALARS;
}

function fractionalNumericLiteral(expr: Expr): boolean {
  if (expr.kind === "unary" && expr.op === "-") return fractionalNumericLiteral(expr.value);
  return expr.kind === "literal" && typeof expr.value === "number" && expr.numericText?.includes(".") === true;
}

function columnType(table: TableDecl, name: string): ScalarType {
  if (name === "id") return { kind: "ref", table: table.name, optional: false };
  return table.columns.find((column) => column.name === name)?.type ?? { kind: "int", optional: false };
}

export function idLiteral(expr: Expr, expected: ScalarType): boolean {
  return (expected.kind === "ref" || expected.kind === "id")
    && expr.kind === "literal" && typeof expr.value === "string" && expr.value.length > 0;
}

export function keyCompatible(expr: Expr, actual: ScalarType | undefined, expected: ScalarType): boolean {
  // @ref LLP 1011#null-keys-and-id-literals-2026-09-05 — null selects the optional key's group, never a required key.
  if (expr.kind === "literal" && expr.value === null) return expected.optional;
  return idLiteral(expr, expected) || compatible(actual, expected);
}

function indexGuidance(table: TableDecl, indexes: IndexDecl[]): string {
  return `candidate indexes: ${indexes.map((index) => `${table.name}.${index.name} (${index.components.map((component) => "Column" in component ? `${component.Column}: ${typeName(columnType(table, component.Column))}` : `${componentLabel(component)}: bounded query text (independent maximum)`).join(", ")})`).join("; ")}`;
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
  if (expected.kind === "decimal") return actual.kind === "decimal" && actual.scale === expected.scale;
  if (expected.kind === "money") {
    return actual.kind === "money" && actual.currency === expected.currency && actual.scale === expected.scale;
  }
  return actual.kind === expected.kind;
}

function typeName(type: ScalarType): string {
  if (type.optional) return `${typeName({ ...type, optional: false })} ?`;
  if (type.kind === "ref") return `reference to ${type.table}`;
  if (type.kind === "list") return `[${typeName(type.item)}] <=${type.max}`;
  if (type.kind === "text") return `${type.min === undefined ? `text <=${type.max}` : `text ${type.min}..${type.max}`}${type.format ? ` format ${type.format}` : ""}`;
  if (type.kind === "decimal") return `decimal ${type.scale}`;
  if (type.kind === "money") return `money ${type.currency} ${type.scale}`;
  return type.kind;
}

function distance(a: string, b: string): number {
  let row = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 0; i < a.length; i++) {
    const next = [i + 1];
    for (let j = 0; j < b.length; j++) next.push(Math.min(next[j]! + 1, row[j + 1]! + 1, row[j]! + Number(a[i] !== b[j])));
    row = next;
  }
  return row[b.length]!;
}
