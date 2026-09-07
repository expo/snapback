import { readFile } from "node:fs/promises";
import { basename, dirname, relative, resolve, sep } from "node:path";
import ts from "typescript";
import { boundedDiagnostics, typeDiagnostic } from "../diagnostics";
import type { FrontendDiagnostic, ProjectResult } from "../ir";
import { collectEffectCatalog, lowerEffects, type EffectCatalog, type SourceModule } from "../lower/effects";
import { createProjectProgram, loadCompilerLib, projectTypeDiagnostics } from "../project-program";
import { generateBoundApiDts } from "./bound-api";
import { boundEffectDeclarationSources } from "./bound-effects-stubs";
import { tryBindQuarryProject } from "./bound-project";
import { frontendQuarryDiagnostic, prepareQuarry, type QuarryInput } from "./index";

export type DirectQuarryProjectInput = {
  started: number;
  projectRoot: string;
  authoredRoot: string;
  discoveredModulePaths: string[];
  quarryPaths: string[];
  tsModulePaths: string[];
  adhocSource?: string;
};

/** Complete production Quarry assembly. TypeScript is consulted only for
 * authored effects against declaration-only schema/operation modules. */
export async function lowerDirectQuarryProject(input: DirectQuarryProjectInput): Promise<ProjectResult> {
  const quarryInputs: QuarryInput[] = await Promise.all(input.quarryPaths.map(async (path) => ({
    path, fileName: relativeSite(input.projectRoot, path), source: await readFile(path, "utf8"),
  })));
  if (input.adhocSource !== undefined) quarryInputs.push({
    path: resolve(input.authoredRoot, "__adhoc.q"), fileName: "snapback/__adhoc.q", source: input.adhocSource,
  });
  const prepared = prepareQuarry(quarryInputs);
  if (!prepared.ok) return failed(input.started, prepared.diagnostics);

  const bound = tryBindQuarryProject(prepared.prepared);
  if (!bound.ok) return failed(input.started, bound.diagnostics.map(frontendQuarryDiagnostic));
  const project = bound.project;
  const diagnostics: FrontendDiagnostic[] = [
    ...nestedModuleDiagnostics(input.discoveredModulePaths, input.authoredRoot, input.projectRoot),
    ...duplicateModuleBasenameDiagnostics([
      ...input.tsModulePaths,
      ...input.quarryPaths.filter((path) => basename(path) !== "schema.q"),
    ], input.projectRoot),
  ];

  let effectCatalog: EffectCatalog = new Map();
  if (input.tsModulePaths.length > 0) {
    const declarations = boundEffectDeclarationSources(prepared.prepared.catalog, project.boundPrograms);
    const schemaPath = resolve(input.projectRoot, declarations.schema.fileName);
    const diskSources = await Promise.all(input.tsModulePaths.map(async (path) => [path, await readFile(path, "utf8")] as const));
    const declarationSources = declarations.modules.map((module) =>
      [resolve(input.projectRoot, module.fileName), module.source] as const);
    const checked = createProjectProgram(schemaPath, declarations.schema.source,
      [...diskSources, ...declarationSources].sort(([left], [right]) => left.localeCompare(right)),
      loadCompilerLib(true), ts.ScriptTarget.ES2020);
    const effectPaths = new Set(input.tsModulePaths);
    diagnostics.push(...projectTypeDiagnostics(checked.program, input.projectRoot, () => true, effectPaths).map((item) =>
      item.family === "effect" ? item : {
        ...item, code: "E_EFFECT_TYPE" as const, family: "effect" as const, guide: "effects/authoring",
      }));
    const effectModules: SourceModule[] = diskSources.map(([path, source]) => ({
      moduleName: moduleName(path), fileName: relativeSite(input.projectRoot, path), source,
      sourceFile: checked.program.getSourceFile(path)!,
    }));
    effectCatalog = collectEffectCatalog(effectModules);
  }
  for (const expected of project.effects) if (!effectCatalog.has(expected.name)) diagnostics.push(typeDiagnostic(
    "E_EFFECT_UNKNOWN", "effect", expected.source.file, expected.source.line, expected.source.col,
    `effect ${expected.name} is not exported by snapback/${expected.moduleName}.ts`,
    `export const ${expected.localName} = effect({ ... }) from snapback/${expected.moduleName}.ts`,
    "effects/authoring",
  ));
  if (project.boundPrograms.length === 0 && effectCatalog.size === 0) diagnostics.push(typeDiagnostic(
    "E_OP_NONE", "op", "snapback/schema.q", 1, 1,
    "project declares no query, mutation, or effect",
    "query operation():\n  return null", "programs/operations",
  ));
  const loweredEffects = lowerEffects(effectCatalog, project.operationSignatures);
  diagnostics.push(...loweredEffects.diagnostics);
  if (diagnostics.length > 0) return failed(input.started, diagnostics);

  project.schema.effects = loweredEffects.effects.map((effect) => effect.name);
  const inspection = project.inspection.map((item) => item.generated === "schema.ir.json"
    ? { ...item, source: JSON.stringify(project.schema, null, 2) } : item);
  return {
    ok: true,
    project: { schema: project.schema, programs: project.programs, effects: loweredEffects.effects },
    sources: project.sources,
    apiDts: generateBoundApiDts(project.clientPrograms, prepared.prepared.documents, prepared.prepared.catalog),
    quarry: inspection,
    ms: elapsed(input.started),
  };
}

function duplicateModuleBasenameDiagnostics(paths: string[], projectRoot: string): FrontendDiagnostic[] {
  const grouped = new Map<string, string[]>();
  for (const path of paths) grouped.set(moduleName(path), [...(grouped.get(moduleName(path)) ?? []), path]);
  return [...grouped].flatMap(([name, group]) => group.length < 2 ? [] : group.sort().map((path) => {
    const site = relativeSite(projectRoot, path);
    return typeDiagnostic("E_OP_MODULE_BASENAME", "op", site, 1, 1,
      `module basename ${name} is duplicated; read-site identity requires one flat module per basename`,
      `rename ${site} so every snapback module has a unique basename`, "programs/operations");
  }));
}

function nestedModuleDiagnostics(paths: string[], authoredRoot: string, projectRoot: string): FrontendDiagnostic[] {
  return paths.filter((path) => dirname(path) !== authoredRoot).sort().map((path) => {
    const site = relativeSite(projectRoot, path);
    return typeDiagnostic("E_OP_INVALID", "op", site, 1, 1,
      `nested operation module ${site} is unsupported; operation modules must be direct children of snapback`,
      `move ${site} directly under snapback/`, "programs/operations");
  });
}

function moduleName(path: string): string {
  return path.split(sep).at(-1)!.replace(/\.(?:q|ts)$/, "");
}

function relativeSite(root: string, path: string): string {
  return relative(root, resolve(path)).split(sep).join("/");
}

function failed(started: number, diagnostics: FrontendDiagnostic[]): ProjectResult {
  return { ok: false, diagnostics: boundedDiagnostics(diagnostics, 50, "project refusals"), ms: elapsed(started) };
}

function elapsed(started: number): number {
  return Math.round((performance.now() - started) * 100) / 100;
}
