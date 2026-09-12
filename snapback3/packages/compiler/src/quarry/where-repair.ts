import { columnAt, columnComponents, ordinaryColumns, derivedPosition } from "../index-components";
import type { Document, Expr, IndexDecl, QuarryDiagnostic, ScalarType, Stmt, TableCatalog } from "./ast";
import { quarryExpression } from "./print";

const FALLBACK = "use an index whose prefix pins the predicate, a table invariant (after insert <- exists ...), or merge for a fan-in feed";

// @ref LLP 1011#b6-the-refused-where-as-a-two-site-repair — `where` never
// reaches lowering; catalog facts turn the narrow equality form into two sited repairs.
export function whereRepairDiagnostics(documents: Document[], catalog: TableCatalog): QuarryDiagnostic[] {
  const diagnostics: QuarryDiagnostic[] = [];
  const visit = (expr: Expr) => {
    if (expr.kind !== "read" || !expr.range?.where) return;
    diagnostics.push(...repair(expr, catalog));
  };
  for (const document of documents) {
    for (const program of document.programs) walkStatements(program.body, visit);
    // Helper bodies are authored reads too; a where inside one was silently discarded before LLP 1018.005.
    for (const helper of document.functions) walk(helper.body, visit);
    for (const proc of document.procs) walkStatements(proc.body, visit);
  }
  return diagnostics;
}

function repair(read: Extract<Expr, { kind: "read" }>, catalog: TableCatalog): QuarryDiagnostic[] {
  const intent = read.range!.where!;
  if (!read.range?.order || !Number.isInteger(read.range.take)) return [fallback(intent.site)];
  const info = catalog.get(read.table);
  const terms = equalityTerms(intent.predicate);
  const base = info && baseIndex(read, info.indexes);
  if (!info || !terms || !base || derivedPosition(base.components) >= 0) return [fallback(intent.site)];

  const prefixColumns = ordinaryColumns(base.components)!.slice(0, read.keys.length);
  const suffixColumns = ordinaryColumns(base.components)!.slice(read.keys.length);
  const predicateColumns: string[] = [];
  const predicateValues: Expr[] = [];
  const seen = new Map<string, string>();
  for (const term of terms) {
    const column = term.column === "id" ? { kind: "id", optional: false } as const : info.columns.get(term.column);
    if (!column || !indexable(column) || !stableValue(term.value)) return [fallback(intent.site)];
    const rendered = quarryExpression(term.value);
    const prior = seen.get(term.column);
    if (prior !== undefined) {
      if (prior !== rendered) return [fallback(intent.site)];
      continue;
    }
    seen.set(term.column, rendered);
    const prefixOffset = prefixColumns.indexOf(term.column);
    if (prefixOffset >= 0) {
      if (quarryExpression(read.keys[prefixOffset]!.value) !== rendered) return [fallback(intent.site)];
      continue;
    }
    predicateColumns.push(term.column);
    predicateValues.push(term.value);
  }
  const leading = [...prefixColumns, ...predicateColumns];
  // Pinning a predicate column removes it from the varying order. An index
  // with the same prefix but a different suffix would silently reorder the feed.
  const predicateSet = new Set(predicateColumns);
  const columns = [...leading, ...suffixColumns.filter((column) => !predicateSet.has(column))];
  if (!base.unique && columns.at(-1) !== "id" && !columns.includes("id")) columns.push("id");
  if (!base.unique && columns.at(-1) !== "id") return [fallback(intent.site)];
  if (columns.length > 8 || (read.range.cursor && columns.length === leading.length)) return [fallback(intent.site)];
  const compatible = info.indexes.find((index) => derivedPosition(index.components) < 0 && total(index)
    && columns.length === index.components.length
    && columns.every((column, offset) => columnAt(index.components, offset) === column));
  let selected: IndexDecl;
  let indexLine: string;
  let schemaMessage: string;
  if (compatible) {
    selected = compatible;
    indexLine = renderIndex(compatible);
    schemaMessage = `where repair reuses ${read.table}.${compatible.name} for the read at ${siteText(intent.site)}`;
  } else {
    const unique = base.unique;
    const name = collisionFreeName(columns, info.indexes);
    selected = { name, components: columnComponents(columns), unique, site: base.site };
    indexLine = renderIndex(selected);
    schemaMessage = `where needs this index for the read at ${siteText(intent.site)}`;
  }

  const repaired: Extract<Expr, { kind: "read" }> = {
    ...read,
    keys: [
      ...read.keys,
      ...predicateValues.map((value, offset) => ({
        ...(read.keys.some((key) => key.column !== undefined) ? { column: predicateColumns[offset]! } : {}),
        value, site: value.site,
      })),
    ],
    index: selected.name,
    range: { ...read.range!, where: undefined },
  };
  return [
    diagnostic(selected.site, schemaMessage, indexLine),
    diagnostic(intent.site, "where is refused; use the indexed prefix scan in this rewrite", quarryExpression(repaired)),
  ];
}

function baseIndex(read: Extract<Expr, { kind: "read" }>, indexes: IndexDecl[]): IndexDecl | undefined {
  const named = read.keys.some((key) => key.column !== undefined);
  if (named && read.keys.some((key) => key.column === undefined)) return undefined;
  if (read.index) return indexes.find((index) => index.name === read.index
    && read.keys.length <= index.components.length
    && read.keys.every((key, offset) => key.column === undefined || key.column === columnAt(index.components, offset)));
  const candidates = indexes.filter((index) => index.name !== "byId" && index.components.length > read.keys.length
    && (!named || read.keys.every((key, offset) => key.column === columnAt(index.components, offset))));
  return candidates.length === 1 ? candidates[0] : undefined;
}

function equalityTerms(expr: Expr): Array<{ column: string; value: Expr }> | undefined {
  if (expr.kind === "binary" && expr.op === "and") {
    const left = equalityTerms(expr.left);
    const right = equalityTerms(expr.right);
    return left && right ? [...left, ...right] : undefined;
  }
  if (expr.kind !== "binary" || expr.op !== "=") return undefined;
  if (expr.left.kind === "member" && expr.left.base.kind === "focal") return [{ column: expr.left.name, value: expr.right }];
  if (expr.right.kind === "member" && expr.right.base.kind === "focal") return [{ column: expr.right.name, value: expr.left }];
  return undefined;
}

function indexable(type: ScalarType): boolean {
  return !["list", "json", "image", "video", "cursor"].includes(type.kind);
}

// A prefix is evaluated once before scanning. Do not move a per-row read,
// assertion, ID allocation, or focal reference into that position.
function stableValue(expr: Expr): boolean {
  if (expr.kind === "literal") return true;
  if (expr.kind === "name") return expr.name !== "new";
  // Even a non-focal member can auto-dereference a typed table reference.
  // Bind that value before the scan if it should be a constant prefix.
  if (expr.kind === "unary") return stableValue(expr.value);
  if (expr.kind === "binary") return stableValue(expr.left) && stableValue(expr.right);
  if (expr.kind === "call" && (expr.name === "min" || expr.name === "max")) return expr.args.every(stableValue);
  return false;
}

function total(index: IndexDecl): boolean { return index.unique || columnAt(index.components, -1) === "id"; }

function collisionFreeName(columns: string[], indexes: IndexDecl[]): string {
  const stemColumns = columns.at(-1) === "id" ? columns.slice(0, -1) : columns;
  const stem = `by${stemColumns.map(title).join("") || "Repair"}`;
  const names = new Set(indexes.map((index) => index.name));
  if (!names.has(stem)) return stem;
  let suffix = 2;
  while (names.has(`${stem}${suffix}`)) suffix += 1;
  return `${stem}${suffix}`;
}

function renderIndex(index: IndexDecl): string {
  return `${index.unique ? "unique" : "by"} ${index.name}: ${ordinaryColumns(index.components)!.join(", ")}`;
}

function diagnostic(site: Expr["site"], message: string, rewrite: string): QuarryDiagnostic {
  return { ...site, code: "E_QUARRY_UNSUPPORTED", message, rewrite, guide: "quarry/refusals" };
}

function fallback(site: Expr["site"]): QuarryDiagnostic {
  return diagnostic(site, "where is not part of the Snapback 2 platform", FALLBACK);
}

function walkStatements(statements: Stmt[], visit: (expr: Expr) => void): void {
  for (const statement of statements) {
    if (statement.kind === "bind" || statement.kind === "expr" || statement.kind === "return") walk(statement.value, visit);
    else if (statement.kind === "require") walk(statement.condition, visit);
    else if (statement.kind === "emit") walk(statement.payload, visit);
    else if (statement.kind === "if") {
      walk(statement.condition, visit);
      walkStatements(statement.thenBody, visit);
      walkStatements(statement.elseBody, visit);
    } else if (statement.kind === "for") {
      walk(statement.domain, visit);
      walkStatements(statement.body, visit);
    }
  }
}

function walk(expr: Expr, visit: (expr: Expr) => void): void {
  visit(expr);
  if (expr.kind === "unary" || expr.kind === "assert") walk(expr.value, visit);
  else if (expr.kind === "binary") { walk(expr.left, visit); walk(expr.right, visit); }
  else if (expr.kind === "member" || expr.kind === "shapeUse") walk(expr.base, visit);
  else if (expr.kind === "call") expr.args.forEach((item) => walk(item, visit));
  else if (expr.kind === "array") expr.items.forEach((item) => walk(item, visit));
  else if (expr.kind === "object") expr.fields.forEach((field) => field.value && walk(field.value, visit));
  else if (expr.kind === "read") {
    expr.keys.forEach((key) => walk(key.value, visit));
    if (expr.range?.cursor) walk(expr.range.cursor, visit);
  } else if (expr.kind === "merge") {
    if (expr.cursor) walk(expr.cursor, visit);
    expr.lanes.forEach((lane) => {
      lane.prefix.forEach((value) => walk(value, visit));
      if (lane.loop) walk(lane.loop.domain, visit);
    });
  } else if (expr.kind === "exists" || expr.kind === "created") walk(expr.read, visit);
  else if (expr.kind === "shape") {
    walk(expr.base, visit);
    expr.fields.forEach((field) => field.kind === "field" && walk(field.value, visit));
  } else if (expr.kind === "walk") walk(expr.seed, visit);
  else if (expr.kind === "write") {
    expr.keys.forEach((key) => walk(key.value, visit));
    expr.fields.forEach((field) => field.value && walk(field.value, visit));
  }
}

function title(value: string): string { return value ? value[0]!.toUpperCase() + value.slice(1) : value; }
function siteText(site: Expr["site"]): string { return `${site.file}:${site.line}:${site.col}`; }
