import { columnComponents } from "../index-components";
import { basename } from "node:path";
import type { Document, QuarryDiagnostic, RuleDecl, ScalarType, TableCatalog, TableDecl } from "./ast";
import { buildCatalog } from "./catalog";
import { QuarryError } from "./diagnostics";
import { parseDocument } from "./parser";
import { prepareSchedules } from "./schedule";
import { whereRepairDiagnostics } from "./where-repair";
import type { FrontendDiagnostic } from "../ir";

export type QuarryInput = { path: string; fileName: string; source: string };
export type PreparedQuarry = {
  documents: Document[];
  catalog: TableCatalog;
  schedules: ReturnType<typeof prepareSchedules>;
  diagnostics: QuarryDiagnostic[];
};
export type QuarryPrepareResult =
  | { ok: true; prepared: PreparedQuarry }
  | { ok: false; diagnostics: FrontendDiagnostic[] };

/** Parse declarations and build the catalog consumed by direct typed binding. */
export function prepareQuarry(inputs: QuarryInput[]): QuarryPrepareResult {
  const diagnostics: QuarryDiagnostic[] = [];
  let documents: Document[] = [];
  for (const input of inputs) {
    const parsed = parseDocument(input.fileName, input.source);
    documents.push(parsed.document);
    diagnostics.push(...parsed.diagnostics);
  }
  diagnostics.push(...placementDiagnostics(documents));
  diagnostics.push(...schemaDomainDiagnostics(documents));
  if (diagnostics.length > 0) return { ok: false, diagnostics: diagnostics.map(frontendQuarryDiagnostic) };


  let catalog: TableCatalog;
  try {
    materializeMaintains(documents);
    catalog = buildCatalog(documents);
  } catch (error) {
    return { ok: false, diagnostics: [frontendQuarryDiagnostic(caughtDiagnostic(error, inputs[0]?.fileName))] };
  }
  diagnostics.push(...whereRepairDiagnostics(documents, catalog));
  if (diagnostics.length > 0) return { ok: false, diagnostics: diagnostics.map(frontendQuarryDiagnostic) };

  let schedules: ReturnType<typeof prepareSchedules> = [];
  try { schedules = prepareSchedules(documents, catalog); } catch (error) { diagnostics.push(caughtDiagnostic(error)); }
  if (diagnostics.length > 0) return { ok: false, diagnostics: diagnostics.map(frontendQuarryDiagnostic) };
  return { ok: true, prepared: { documents, catalog, schedules, diagnostics } };
}

function schemaDomainDiagnostics(documents: Document[]): QuarryDiagnostic[] {
  const diagnostics: QuarryDiagnostic[] = [];
  const tables = new Map(documents.flatMap((document) => document.tables).map((table) => [table.name, table]));
  for (const table of tables.values()) {
    const columns = new Map(table.columns.map((column) => [column.name, column.type]));
    for (const index of table.indexes) for (const component of index.components) {
      if (!("Column" in component)) continue;
      const type = columns.get(component.Column);
      if (!type || !containsAsset(type)) continue;
      diagnostics.push(new QuarryError(index.site,
        `index ${table.name}.${index.name} column ${component.Column} has non-indexable type ${schemaTypeName(type)}`,
        "E_SCHEMA_INDEX_COLUMN", `remove ${component.Column} from this index`, "schema/project").diagnostic);
    }
  }
  for (const declaration of documents.flatMap((document) => document.maintains)) {
    const source = tables.get(declaration.source);
    for (const field of declaration.by) {
      const type = source?.columns.find((column) => column.name === field)?.type;
      if (!type || !containsAsset(type)) continue;
      diagnostics.push(new QuarryError(declaration.site,
        `maintain.by cannot use asset-typed source column ${declaration.source}.${field}`,
        "E_SCHEMA_ASSET_MAINTAIN", "remove the asset column from maintain.by", "schema/project").diagnostic);
    }
  }
  return diagnostics;
}

function placementDiagnostics(documents: Document[]): QuarryDiagnostic[] {
  const diagnostics: QuarryDiagnostic[] = [];
  const schema = documents.find((document) => basename(document.file) === "schema.q");
  if (!schema) {
    diagnostics.push(placement(documents[0]?.file ?? "snapback/schema.q", 1, 1, "a Quarry project requires snapback/schema.q", "create snapback/schema.q and move schema declarations into it"));
  }
  for (const document of documents) {
    const isSchema = basename(document.file) === "schema.q";
    const declarationSite = document.tables[0]?.site ?? document.maintains[0]?.site ?? document.channels[0]?.site
      ?? (document.identity ? { file: document.file, line: 1, col: 1 } : undefined);
    if (!isSchema && declarationSite) diagnostics.push(placement(document.file, declarationSite.line, declarationSite.col, "tables, maintains, channels, and use identity belong in schema.q", "move this declaration to snapback/schema.q"));
    if (isSchema && (document.shapes.length > 0 || document.shapeImports.length > 0
      || document.functions.length > 0 || document.functionImports.length > 0)) {
      const site = (document.shapes[0] ?? document.shapeImports[0]
        ?? document.functions[0] ?? document.functionImports[0])!.site;
      diagnostics.push(placement(document.file, site.line, site.col, "shape and fn declarations belong in an operations .q module, not schema.q", "move this declaration to snapback/<module>.q"));
    }
    if (isSchema && (document.programs.length > 0 || document.effects.length > 0)) {
      const site = document.programs[0]?.site ?? document.effects[0]!.site;
      diagnostics.push(placement(document.file, site.line, site.col, "schema.q holds declarations only; query, mutation, and effect declarations belong in a program module", "move this declaration to snapback/<module>.q"));
    }
    if (!isSchema && document.programs.length === 0 && document.schedules.length === 0
      && document.shapes.length === 0 && document.shapeImports.length === 0
      && document.functions.length === 0 && document.functionImports.length === 0) {
      diagnostics.push(placement(document.file, 1, 1, `${basename(document.file)} must declare at least one query, mutation, shape, or fn`, "add a query, mutation, shape, or fn, or remove the empty module"));
    }
    if (!isSchema && document.programs.length === 0 && document.effects.length > 0) diagnostics.push(placement(document.file, document.effects[0]!.site.line, document.effects[0]!.site.col, "effect imports need a query or mutation in this module", "move this effect import to the mutation module that emits it"));
    const stem = basename(document.file).slice(0, -2);
    if (!/^[A-Za-z_$][A-Za-z0-9_$-]*$/.test(stem)) diagnostics.push(placement(document.file, 1, 1, `file stem ${stem} cannot become an API namespace`, "rename the module to an identifier-like stem"));
  }
  if (schema && schema.tables.length === 0) diagnostics.push(placement(schema.file, 1, 1, "schema.q must declare at least one table", "add a table declaration"));
  return diagnostics;
}

function materializeMaintains(documents: Document[]): void {
  const schema = documents.find((document) => basename(document.file) === "schema.q")!;
  // @ref LLP 1004#money-and-decimal-worked-out-2026-09-03 — a sum target inherits the source's exact numeric descriptor.
  for (const declaration of schema.maintains) {
    if (declaration.source === "connected") throw new QuarryError(declaration.site,
      "connected cannot be a maintained source", "E_QUARRY_UNKNOWN",
      "replace the maintain with a query returning #connected[p] for p: principal", "quarry/names");
    if (schema.tables.some((table) => table.name === declaration.name)) throw new QuarryError(declaration.site, `maintain target ${declaration.name} duplicates a table`);
    const source = schema.tables.find((table) => table.name === declaration.source);
    if (!source) throw new QuarryError(declaration.site, `maintain ${declaration.name} names unknown source table ${declaration.source}`);
    const columns = declaration.by.map((name) => {
      const sourceColumn = source.columns.find((column) => column.name === name);
      if (!sourceColumn) throw new QuarryError(declaration.site, `maintain ${declaration.name} names unknown source column ${declaration.source}.${name}`);
      return { name, type: structuredClone(sourceColumn.type), site: declaration.site };
    });
    if (declaration.aggregate === "sum") {
      const summed = source.columns.find((column) => column.name === declaration.column);
      if (!summed || !["int", "decimal", "money"].includes(summed.type.kind)) {
        throw new QuarryError(declaration.site, `sum maintain ${declaration.name} requires an int, decimal, or money source column`);
      }
    }
    const summed = declaration.aggregate === "sum"
      ? source.columns.find((column) => column.name === declaration.column)!.type
      : { kind: "int", optional: false } satisfies ScalarType;
    columns.push({ name: "value", type: structuredClone(summed), site: declaration.site });
    const indexName = `by${declaration.by.map((column) => title(column.endsWith("Id") && column.length > 2 ? column.slice(0, -2) : column)).join("")}`;
    const deny = (effect: RuleDecl["effect"]): RuleDecl => ({
      effect,
      bindings: ["r"],
      value: { kind: "name", name: "deny", site: declaration.site },
      site: declaration.site,
    });
    const assetGrouped = columns.some((column) => containsAsset(column.type));
    const target: TableDecl = {
      name: declaration.name,
      columns,
      // @ref LLP 1006#2a-one-asset-one-home-author-ruling-2026-09-01 — the
      // authored maintain refusal owns this error; do not also diagnose the
      // synthetic target index materialized only by the Quarry lowering.
      indexes: assetGrouped ? [] : [{ name: indexName, components: columnComponents(declaration.by), unique: true, site: declaration.site }],
      rules: [declaration.read, deny("insert"), deny("update"), deny("delete")],
      immutable: [],
      caps: [],
      finalExists: [],
      tombstones: [],
      site: declaration.site,
    };
    schema.tables.push(target);
  }
}

function containsAsset(type: ScalarType): boolean {
  if (type.kind === "image" || type.kind === "video") return true;
  return type.kind === "list" && containsAsset(type.item);
}

function schemaTypeName(type: ScalarType): string {
  if (type.kind === "list") return `[${schemaTypeName(type.item)}]`;
  if (type.kind === "image" || type.kind === "video") return `${type.kind} asset`;
  return type.kind;
}

export function frontendQuarryDiagnostic(item: QuarryDiagnostic): FrontendDiagnostic {
  return {
    code: item.code,
    family: item.code.startsWith("E_SCHEMA_") ? "schema"
      : item.code.startsWith("E_SCHEDULE_") ? "schedule"
        : item.code === "E_EMIT_IN_QUERY" ? "effect"
          : item.code === "E_DECIMAL_SCALE" ? "args"
            : item.code.startsWith("E_OP_") ? "op"
              : item.code.startsWith("E_UNBOUND_") ? "bound" : "quarry",
    message: item.message,
    site: `${item.file}:${item.line}:${item.col}`,
    rewrite: item.executableRewrite || item.code === "E_QUARRY_UNSUPPORTED" && item.rewrite === "deny"
      ? item.rewrite : `-- ${item.rewrite.replace(/\n/g, " ")}`,
    guide: item.guide,
  };
}

function caughtDiagnostic(error: unknown, file = "snapback/schema.q"): QuarryDiagnostic {
  return error instanceof QuarryError
    ? error.diagnostic
    : {
        file,
        line: 1,
        col: 1,
        code: "E_QUARRY_UNKNOWN",
        message: error instanceof Error ? error.message : String(error),
        rewrite: error instanceof Error ? error.message : String(error),
        guide: "quarry/names",
      };
}

function placement(file: string, line: number, col: number, message: string, rewrite: string): QuarryDiagnostic {
  return { file, line, col, code: "E_QUARRY_PLACEMENT", message, rewrite, guide: "quarry/projects" };
}

function title(value: string): string { return value.length === 0 ? value : value[0]!.toUpperCase() + value.slice(1); }
