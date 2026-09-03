import { basename } from "node:path";
import type { Document, QuarryDiagnostic, RuleDecl, ScalarType, Site, TableCatalog, TableDecl } from "./ast";
import { buildCatalog } from "./catalog";
import { QuarryError } from "./diagnostics";
import { parseDocument } from "./parser";
import { emitPrograms } from "./program";
import { emitSchema } from "./schema";
import type { FrontendDiagnostic, QuarryGenerated, SourceSite } from "../ir";

export type QuarryInput = { path: string; fileName: string; source: string };
export type QuarryVirtualModule = {
  path: string;
  fileName: string;
  source: string;
  authored: string;
  authoredSource: string;
  lineMap: Array<SourceSite | undefined>;
};
export type QuarryCompileResult =
  | { ok: true; schema: QuarryVirtualModule; modules: QuarryVirtualModule[] }
  | { ok: false; diagnostics: FrontendDiagnostic[] };

// @ref LLP 1004#what-default-binds — Quarry is a compiler front end whose
// generated TypeScript exists only in memory and retains authored source sites.
export function compileQuarry(inputs: QuarryInput[]): QuarryCompileResult {
  const diagnostics: QuarryDiagnostic[] = [];
  const documents: Document[] = [];
  for (const input of inputs) {
    const parsed = parseDocument(input.fileName, input.source);
    documents.push(parsed.document);
    diagnostics.push(...parsed.diagnostics);
  }
  diagnostics.push(...placementDiagnostics(documents));
  if (diagnostics.length > 0) return { ok: false, diagnostics: diagnostics.map(frontend) };

  let catalog: TableCatalog;
  try {
    materializeMaintains(documents);
    catalog = buildCatalog(documents);
  } catch (error) {
    return { ok: false, diagnostics: [frontend(caughtDiagnostic(error, inputs[0]?.fileName))] };
  }

  const schemaDocument = documents.find((document) => basename(document.file) === "schema.q")!;
  const schemaInput = inputs.find((input) => input.fileName === schemaDocument.file)!;
  let schemaSource = "";
  try {
    schemaSource = emitSchema(documents, catalog, schemaDocument.file);
  } catch (error) {
    diagnostics.push(caughtDiagnostic(error, schemaDocument.file));
  }
  const moduleSources = new Map<string, string>();
  for (const document of documents.filter((item) => basename(item.file) !== "schema.q")) {
    let valid = true;
    for (const program of document.programs) {
      try {
        emitPrograms([program], catalog, document.file, document.effects);
      } catch (error) {
        valid = false;
        diagnostics.push(caughtDiagnostic(error, document.file));
      }
    }
    if (valid) moduleSources.set(document.file, emitPrograms(document.programs, catalog, document.file, document.effects));
  }
  if (diagnostics.length > 0) return { ok: false, diagnostics: diagnostics.map(frontend) };

  const schema = virtualModule(schemaInput.path.replace(/\.q$/, ".ts"), schemaDocument.file, schemaSource, schemaInput.source);
  const modules = documents
    .filter((document) => basename(document.file) !== "schema.q")
    .map((document) => {
      const input = inputs.find((item) => item.fileName === document.file)!;
      return virtualModule(input.path.replace(/\.q$/, ".ts"), document.file, moduleSources.get(document.file)!, input.source);
    });
  return { ok: true, schema, modules };
}

export function remapVirtualDiagnostic(
  diagnostic: FrontendDiagnostic,
  virtual: QuarryVirtualModule,
  generatedTypeError = false,
): FrontendDiagnostic {
  const site = parseSite(diagnostic.site);
  const authored = site && mapGeneratedLine(virtual, site.line);
  if (!authored) return diagnostic;
  return {
    ...diagnostic,
    site: `${authored.file}:${authored.line}:${authored.col}`,
    message: generatedTypeError ? `in code generated from ${authored.file}: ${diagnostic.message}` : diagnostic.message,
    rewrite: diagnostic.code === "E_DECIMAL_SCALE"
      ? quarryDecimalRewrite(virtual.authoredSource, authored.line, diagnostic.message)
      : generatedTypeError && diagnostic.message.includes("undefined")
        ? "add ! else CODE to assert the possibly absent Quarry value before using it here"
        : virtual.authoredSource,
  };
}

export function remapVirtualSource(site: SourceSite, virtual: QuarryVirtualModule): SourceSite {
  return mapGeneratedLine(virtual, site.line) ?? site;
}

export function quarryInspection(modules: QuarryVirtualModule[]): QuarryGenerated[] {
  return modules.map((module) => ({ file: module.authored, generated: basename(module.path), source: module.source }));
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
    if (isSchema && (document.programs.length > 0 || document.effects.length > 0)) {
      const site = document.programs[0]?.site ?? document.effects[0]!.site;
      diagnostics.push(placement(document.file, site.line, site.col, "schema.q holds declarations only; query, mutation, and effect declarations belong in a program module", "move this declaration to snapback/<module>.q"));
    }
    if (!isSchema && document.programs.length === 0) diagnostics.push(placement(document.file, 1, 1, `${basename(document.file)} must declare at least one query or mutation`, "add a query or mutation, or remove the empty module"));
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
      indexes: assetGrouped ? [] : [{ name: indexName, columns: [...declaration.by], unique: true, site: declaration.site }],
      rules: [declaration.read, deny("insert"), deny("update"), deny("delete")],
      immutable: [],
      finalExists: [],
      site: declaration.site,
    };
    schema.tables.push(target);
  }
}

function containsAsset(type: ScalarType): boolean {
  if (type.kind === "image" || type.kind === "video") return true;
  return type.kind === "list" && containsAsset(type.item);
}

function virtualModule(path: string, authored: string, source: string, authoredSource: string): QuarryVirtualModule {
  const lineMap: Array<SourceSite | undefined> = [];
  let previous: SourceSite | undefined;
  for (const line of source.split("\n")) {
    const match = line.match(/\/\/ q:(.+):(\d+):(\d+)\s*$/);
    if (match) previous = { file: match[1]!, line: Number(match[2]), col: Number(match[3]) };
    lineMap.push(previous);
  }
  return { path, fileName: path, source, authored, authoredSource, lineMap };
}

function frontend(item: QuarryDiagnostic): FrontendDiagnostic {
  return {
    code: item.code,
    family: "quarry",
    message: item.message,
    site: `${item.file}:${item.line}:${item.col}`,
    rewrite: `-- ${item.rewrite.replace(/\n/g, " ")}`,
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
        rewrite: "fix the named Quarry declaration",
        guide: "quarry/names",
      };
}

function placement(file: string, line: number, col: number, message: string, rewrite: string): QuarryDiagnostic {
  return { file, line, col, code: "E_QUARRY_PLACEMENT", message, rewrite, guide: "quarry/projects" };
}

function parseSite(site: string): SourceSite | undefined {
  const match = site.match(/^(.*):(\d+):(\d+)$/);
  return match ? { file: match[1]!, line: Number(match[2]), col: Number(match[3]) } : undefined;
}

function mapGeneratedLine(module: QuarryVirtualModule, line: number): SourceSite | undefined {
  for (let offset = Math.min(line - 1, module.lineMap.length - 1); offset >= 0; offset -= 1) {
    const mapped = module.lineMap[offset];
    if (mapped) return mapped;
  }
  return undefined;
}

function quarryDecimalRewrite(source: string, line: number, message: string): string {
  const authoredLine = source.replace(/\r\n?/g, "\n").split("\n")[line - 1]?.trimEnd();
  return authoredLine ? `${authoredLine} -- ${message}` : `-- ${message}`;
}

function title(value: string): string { return value.length === 0 ? value : value[0]!.toUpperCase() + value.slice(1); }
