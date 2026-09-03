import { existsSync, readFileSync } from "node:fs";
import { lstat, mkdir, mkdtemp, readdir, readFile, realpath, rename, rm, writeFile } from "node:fs/promises";
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import ts from "typescript";
import type { TableInfo } from "./authored-types";
import { lowerSource } from "./compiler";
import { boundedDiagnostics, diagnostic, typeDiagnostic } from "./diagnostics";
import { type FrontendDiagnostic, type Program, type ProjectResult, type SourceSite } from "./ir";
import { effectBindings, collectEffectCatalog, lowerEffects, type OperationDecl, type SourceModule } from "./lower/effects";
import { lowerSchema } from "./lower/schema";
import { boundOperationDiagnostics } from "./operation-diagnostics";
import { callLeaf, moduleJsonConstants, objectOf, property, staticJson } from "./lower/static";
import { hasExport, propertyName, unwrapCall, walk } from "./syntax";
import { typeDiagnosticSite } from "./type-diagnostic-site";
import { compileQuarry, quarryInspection, remapVirtualDiagnostic, remapVirtualSource, type QuarryInput, type QuarryVirtualModule } from "./quarry/index";
import { createProjectProgram, projectTypeDiagnostics } from "./project-program";
import { validateSeedRow } from "./project-seed";
import { sortSerdeMaps } from "./project-sort";
import { quarryOnlyDiagnostics, type LowerProjectOptions } from "./project-authoring";
import { apiRowName, generateApiDts } from "./project-api-types";
// @ref LLP 1002#3-the-compiler-worker-and-the-project-json — one lowering pass owns the ProjectJson, sources, API types, and aggregate refusals.

export async function lowerProject(root: string, options: LowerProjectOptions = {}): Promise<ProjectResult> {
  const started = performance.now();
  const projectRoot = resolve(root);
  const authoredRoot = join(projectRoot, "snapback");
  const tsSchemaPath = join(authoredRoot, "schema.ts");
  const qSchemaPath = join(authoredRoot, "schema.q");
  const hasTsSchema = existsSync(tsSchemaPath);
  const hasQuarrySchema = existsSync(qSchemaPath);
  if (!hasTsSchema && !hasQuarrySchema) {
    return {
      ok: false,
      diagnostics: [typeDiagnostic("E_SCHEMA_DEFAULT_EXPORT", "schema", "snapback/schema.q", 1, 1,
        "missing snapback/schema.q", "create snapback/schema.q with table declarations", "schema/project")],
      ms: elapsed(started),
    };
  }
  const discoveredModulePaths = await discoverModulePaths(authoredRoot);
  const tsModulePaths = discoveredModulePaths.filter((path) => path.endsWith(".ts")).sort();
  if (options.authoring !== "any") {
    const authored = await quarryOnlyDiagnostics(projectRoot, hasTsSchema, tsModulePaths);
    if (authored.length > 0) return { ok: false, diagnostics: authored, ms: elapsed(started) };
  }
  if (hasTsSchema && hasQuarrySchema) {
    return {
      ok: false,
      diagnostics: [typeDiagnostic("E_QUARRY_PLACEMENT", "quarry", "snapback/schema.q", 1, 1,
        "snapback/schema.q and snapback/schema.ts cannot coexist; exactly one schema is allowed",
        "-- remove snapback/schema.ts or snapback/schema.q", "quarry/projects")],
      ms: elapsed(started),
    };
  }

  const quarryPaths = discoveredModulePaths.filter((path) => path.endsWith(".q")).sort();
  if (!hasQuarrySchema && quarryPaths.length > 0) {
    const path = quarryPaths[0]!;
    return {
      ok: false,
      diagnostics: [typeDiagnostic("E_QUARRY_PLACEMENT", "quarry", relativeSite(projectRoot, path), 1, 1,
        `Quarry module ${relativeSite(projectRoot, path)} requires snapback/schema.q; this project has snapback/schema.ts`,
        "-- move the schema to snapback/schema.q", "quarry/projects")],
      ms: elapsed(started),
    };
  }

  let schemaPath = tsSchemaPath;
  let schemaSource = hasTsSchema ? await readFile(tsSchemaPath, "utf8") : "";
  let virtualModules: QuarryVirtualModule[] = [];
  if (hasQuarrySchema) {
    const inputs: QuarryInput[] = await Promise.all(quarryPaths.map(async (path) => ({
      path,
      fileName: relativeSite(projectRoot, path),
      source: await readFile(path, "utf8"),
    })));
    const compiled = compileQuarry(inputs);
    if (!compiled.ok) return { ok: false, diagnostics: boundedDiagnostics(compiled.diagnostics, 50, "Quarry refusals"), ms: elapsed(started) };
    schemaPath = compiled.schema.path;
    schemaSource = compiled.schema.source;
    virtualModules = [compiled.schema, ...compiled.modules];
  }
  const virtualByFile = new Map(virtualModules.map((module) => [relativeSite(projectRoot, module.path), module]));
  const diskModuleSources = await Promise.all(tsModulePaths.map(async (path) => [path, await readFile(path, "utf8")] as const));
  const virtualModuleSources = virtualModules.filter((module) => module !== virtualModules[0]).map((module) => [module.path, module.source] as const);
  const moduleSources = [...diskModuleSources, ...virtualModuleSources].sort(([left], [right]) => left.localeCompare(right));
  const modules: SourceModule[] = moduleSources.map(([path, source]) => ({
    moduleName: moduleName(path),
    fileName: relativeSite(projectRoot, path),
    source,
    sourceFile: ts.createSourceFile(path, source, ts.ScriptTarget.ES2022, true),
  }));
  const schemaFileName = relativeSite(projectRoot, schemaPath);
  const schema = lowerSchema(schemaSource, schemaFileName);
  const programPaths = [...tsModulePaths, ...quarryPaths.filter((path) => basename(path) !== "schema.q")];
  const diagnostics = [
    ...schema.diagnostics,
    ...nestedModuleDiagnostics(discoveredModulePaths, authoredRoot, projectRoot),
    ...duplicateModuleBasenameDiagnostics(programPaths, projectRoot),
    ...rowAliasDiagnostics(schema.tables, schemaFileName),
  ];
  if (modules.length === 0) {
    diagnostics.push(typeDiagnostic(
      "E_OP_NONE",
      "op",
      schemaFileName,
      1,
      1,
      "module exports no query/mutation/effect",
      "query operation():\n  return null",
      "programs/operations",
    ));
  }

  const libText = loadCompilerLib();
  const checked = createProjectProgram(schemaPath, schemaSource, moduleSources, libText);
  diagnostics.push(...projectTypeDiagnostics(checked.program, projectRoot).map((item) => remapDiagnostic(item, virtualByFile, true)));

  const operations = collectOperations(modules);
  diagnostics.push(...reservedApiPathDiagnostics(operations, schemaSource, schemaFileName));
  const catalog = collectEffectCatalog(modules);
  const loweredEffects = lowerEffects(catalog, operations);
  diagnostics.push(...loweredEffects.diagnostics);

  const programs: Program[] = [];
  const sources: Record<string, SourceSite> = Object.create(null);
  const bindingsByModule = new Map<string, Map<string, TableInfo>>();
  for (const module of modules) {
    const tables = tableBindings(module, schema.tables, diagnostics);
    bindingsByModule.set(module.moduleName, tables);
    const effects = effectBindings(module, catalog);
    const lowered = lowerSource(module.source, module.fileName, undefined, {
      tables,
      effects,
      operationPrefix: module.moduleName,
    });
    if (lowered.ok) {
      programs.push(...lowered.programs.map(sortSerdeMaps));
      for (const declaration of operations.values()) {
        if (declaration.moduleName !== module.moduleName) continue;
        const position = declaration.module.sourceFile.getLineAndCharacterOfPosition(declaration.call.getStart());
        sources[declaration.name] = { file: module.fileName, line: position.line + 1, col: position.character + 1 };
      }
    } else {
      diagnostics.push(...lowered.diagnostics);
    }
  }

  const operationBounded = boundProjectOperationDiagnostics(diagnostics, modules, operations)
    .map((item) => remapDiagnostic(item, virtualByFile, false));
  if (operationBounded.length > 0) {
    return { ok: false, diagnostics: boundedDiagnostics(operationBounded, 50, "project refusals"), ms: elapsed(started) };
  }

  schema.schema.effects = loweredEffects.effects.map((item) => item.name);
  programs.sort((left, right) => left.name.localeCompare(right.name));
  const apiDts = generateApiDts(operations, checked.program, checked.checker, schema.tables, bindingsByModule);
  return {
    ok: true,
    project: { schema: schema.schema, programs, effects: loweredEffects.effects },
    sources: Object.fromEntries(Object.entries(sources).map(([name, site]) => {
      const virtual = virtualByFile.get(site.file);
      return [name, virtual ? remapVirtualSource(site, virtual) : site] as [string, SourceSite];
    }).sort(([left], [right]) => left.localeCompare(right))),
    apiDts,
    quarry: quarryInspection(virtualModules),
    ms: elapsed(started),
  };
}

async function discoverModulePaths(directory: string, root = directory): Promise<string[]> {
  const paths: string[] = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) {
      if (directory === root && entry.name === "tests") continue;
      paths.push(...await discoverModulePaths(path, root));
    } else if (entry.isFile() && (entry.name.endsWith(".ts") || entry.name.endsWith(".q"))
      && !(directory === root && ["schema.ts", "seed.ts"].includes(entry.name))) {
      paths.push(path);
    }
  }
  return paths;
}

function duplicateModuleBasenameDiagnostics(paths: string[], projectRoot: string): FrontendDiagnostic[] {
  const grouped = new Map<string, string[]>();
  for (const path of paths) {
    const name = moduleName(path);
    const group = grouped.get(name) ?? [];
    group.push(path);
    grouped.set(name, group);
  }
  const diagnostics: FrontendDiagnostic[] = [];
  for (const [name, group] of grouped) {
    if (group.length < 2) continue;
    for (const path of group.sort()) {
      const site = relativeSite(projectRoot, path);
      diagnostics.push(typeDiagnostic(
        "E_OP_MODULE_BASENAME",
        "op",
        site,
        1,
        1,
        `module basename ${name} is duplicated; read-site identity requires one flat module per basename`,
        `rename ${site} so every snapback module has a unique basename`,
        "programs/module-basename",
      ));
    }
  }
  return diagnostics;
}

function nestedModuleDiagnostics(paths: string[], authoredRoot: string, projectRoot: string): FrontendDiagnostic[] {
  return paths.filter((path) => dirname(path) !== authoredRoot).sort().map((path) => {
    const site = relativeSite(projectRoot, path);
    return typeDiagnostic(
      "E_OP_INVALID",
      "op",
      site,
      1,
      1,
      `nested operation module ${site} is unsupported; operation modules must be direct children of snapback`,
      `move ${site} directly under snapback/`,
      "programs/operations",
    );
  });
}

function rowAliasDiagnostics(tables: Map<string, TableInfo>, schemaFileName: string): FrontendDiagnostic[] {
  const names = new Map<string, string[]>();
  for (const table of tables.values()) {
    const alias = apiRowName(table.name);
    names.set(alias, [...(names.get(alias) ?? []), table.name]);
  }
  return [...names].filter(([, tables]) => tables.length > 1).map(([alias, tables]) => typeDiagnostic(
    "E_SCHEMA_INVALID",
    "schema",
    schemaFileName,
    1,
    1,
    `tables ${tables.join(" and ")} generate the same row alias ${alias}`,
    "rename one table so generated row type names are unique",
    "schema/project",
  ));
}

export async function lowerSeed(root: string): Promise<
  | { ok: true; seed: { personas: string[]; rows: Record<string, unknown[]> } }
  | { ok: false; diagnostics: FrontendDiagnostic[] }
> {
  const projectRoot = resolve(root);
  const path = join(projectRoot, "snapback", "seed.ts");
  if (!existsSync(path)) return { ok: true, seed: { personas: [], rows: {} } };
  const source = await readFile(path, "utf8");
  const fileName = relativeSite(projectRoot, path);
  const sourceFile = ts.createSourceFile(path, source, ts.ScriptTarget.ES2022, true);
  let expression: ts.Expression | undefined;
  for (const statement of sourceFile.statements) {
    if (ts.isExportAssignment(statement) && !statement.isExportEquals) expression = statement.expression;
  }
  const call = expression && unwrapCall(expression);
  if (call && callLeaf(call) === "seed") expression = call.arguments[0];
  const object = expression && objectOf(expression);
  const constants = moduleJsonConstants(sourceFile);
  const value = object && staticJson(object, constants);
  const record = value && typeof value === "object" ? value as Record<string, unknown> : undefined;
  const module = { sourceFile, source, fileName };
  const invalidSpread = object && firstInvalidStaticSpread(object, constants);
  if (!record && invalidSpread) {
    return {
      ok: false,
      diagnostics: [diagnostic(module, "E_SEED_SHAPE", invalidSpread, `seed object spread ${invalidSpread.expression.getText(sourceFile)} is not statically JSON`,
        "replace the spread with a JSON object constant or spell its fields explicitly")],
    };
  }
  if (!record || !Array.isArray(record.personas) || typeof record.rows !== "object" || record.rows === null || Array.isArray(record.rows)) {
    return {
      ok: false,
      diagnostics: [diagnostic(module, "E_SEED_INVALID", expression ?? sourceFile, "seed.ts must default-export seed({ personas, rows })", source)],
    };
  }
  const diagnostics: FrontendDiagnostic[] = [];
  const personas = record.personas as unknown[];
  const personaNames = personas.filter((item): item is string => typeof item === "string" && item.length > 0);
  if (personaNames.length !== personas.length || new Set(personaNames).size !== personaNames.length) {
    diagnostics.push(diagnostic(module, "E_SEED_PERSONA", expression ?? sourceFile, "seed personas must be unique, non-empty strings", source));
  }

  let schemaSource: string;
  try {
    schemaSource = await readFile(join(projectRoot, "snapback", "schema.ts"), "utf8");
  } catch {
    const authoredRoot = join(projectRoot, "snapback");
    const paths = (await discoverModulePaths(authoredRoot)).filter((item) => item.endsWith(".q"));
    const inputs: QuarryInput[] = await Promise.all(paths.map(async (item) => ({
      path: item,
      fileName: relativeSite(projectRoot, item),
      source: await readFile(item, "utf8"),
    })));
    const compiled = compileQuarry(inputs);
    if (!compiled.ok) return { ok: false, diagnostics: compiled.diagnostics };
    schemaSource = compiled.schema.source;
  }
  const loweredSchema = lowerSchema(schemaSource, "snapback/schema.ts");
  if (loweredSchema.diagnostics.length > 0) return { ok: false, diagnostics: loweredSchema.diagnostics };
  const tables = loweredSchema.schema.tables as Record<string, { columns?: Record<string, unknown> }>;
  const rows = record.rows as Record<string, unknown>;
  for (const [table, seeded] of Object.entries(rows)) {
    if (!Object.hasOwn(tables, table)) {
      diagnostics.push(diagnostic(module, "E_SEED_TABLE", expression ?? sourceFile, `seed rows name unknown table ${table}`, source));
      continue;
    }
    if (!Array.isArray(seeded)) {
      diagnostics.push(diagnostic(module, "E_SEED_ROW", expression ?? sourceFile, `seed rows.${table} must be an array`, source));
      continue;
    }
    const columns = tables[table]?.columns ?? {};
    for (const [index, row] of seeded.entries()) {
      validateSeedRow(module, expression ?? sourceFile, table, index, row, columns, diagnostics);
    }
  }
  return diagnostics.length > 0
    ? { ok: false, diagnostics: boundedDiagnostics(diagnostics, 50, "seed refusals") }
    : { ok: true, seed: { personas: personaNames, rows: rows as Record<string, unknown[]> } };
}

export async function listJourneys(root: string): Promise<string[]> {
  const projectRoot = resolve(root);
  const tests = join(projectRoot, "snapback", "tests");
  if (!existsSync(tests)) return [];
  const entries = await readdir(tests, { withFileTypes: true });
  return entries
    .filter((entry) => entry.isFile() && entry.name.endsWith(".test.ts"))
    .map((entry) => relativeSite(projectRoot, join(tests, entry.name)))
    .sort();
}

export async function compileJourneys(
  root: string,
  apiDts: string,
): Promise<
  | { ok: true; files: string[] }
  | { ok: false; diagnostics: FrontendDiagnostic[] }
> {
  const projectRoot = resolve(root);
  const sourceFiles = (await listJourneys(projectRoot)).map((file) => join(projectRoot, file));
  const buildRoot = join(projectRoot, ".snapback", "build");
  const outputRoot = join(buildRoot, "tests");
  const unsafeOutput = await journeyOutputDiagnostic(projectRoot, [join(projectRoot, ".snapback"), buildRoot, outputRoot]);
  if (unsafeOutput) return { ok: false, diagnostics: [unsafeOutput] };
  await mkdir(buildRoot, { recursive: true });
  const stagedOutput = await mkdtemp(join(buildRoot, ".tests-"));
  if (sourceFiles.length === 0) {
    await replaceDirectoryAtomically(outputRoot, stagedOutput);
    return { ok: true, files: [] };
  }

  const packageDist = compilerPackageDist();
  const clientDts = join(packageDist, "client.d.ts");
  const testDts = join(packageDist, "test.d.ts");
  const stagedApi = join(buildRoot, `.api-${process.pid}-${Date.now()}.d.ts`);
  await writeFile(stagedApi, apiDts);
  const options: ts.CompilerOptions = {
    baseUrl: projectRoot,
    jsx: ts.JsxEmit.ReactJSX,
    lib: ["lib.es2022.d.ts", "lib.dom.d.ts", "lib.dom.iterable.d.ts"],
    module: ts.ModuleKind.ESNext,
    moduleResolution: ts.ModuleResolutionKind.Bundler,
    noEmit: true,
    paths: {
      "snapback2/client": [clientDts],
      "snapback2/test": [testDts],
    },
    skipLibCheck: true,
    strict: true,
    target: ts.ScriptTarget.ES2022,
    types: [],
  };
  const program = ts.createProgram({ rootNames: [...sourceFiles, stagedApi], options });
  const sourceSet = new Set(sourceFiles.map((file) => resolve(file)));
  const diagnostics = ts.getPreEmitDiagnostics(program).flatMap((item) => {
    if (!item.file || !sourceSet.has(resolve(item.file.fileName))) return [];
    const position = item.start === undefined
      ? { line: 0, character: 0 }
      : item.file.getLineAndCharacterOfPosition(item.start);
    return [typeDiagnostic(
      "E_OP_INVALID",
      "op",
      relativeSite(projectRoot, item.file.fileName),
      position.line + 1,
      position.character + 1,
      ts.flattenDiagnosticMessageText(item.messageText, "\n"),
      "fix the journey TypeScript error and rerun snapback2 check",
      "testing/journeys",
    )];
  });
  await rm(stagedApi, { force: true });
  if (diagnostics.length > 0) {
    await rm(stagedOutput, { recursive: true, force: true });
    return { ok: false, diagnostics: boundedDiagnostics(diagnostics, 50, "journey refusals") };
  }

  const clientModule = pathToFileURL(join(packageDist, "client.mjs")).href;
  const testModule = pathToFileURL(join(packageDist, "test.mjs")).href;
  const files: string[] = [];
  for (const sourcePath of sourceFiles) {
    const source = await readFile(sourcePath, "utf8");
    const transpiled = ts.transpileModule(source, {
      fileName: sourcePath,
      compilerOptions: {
        module: ts.ModuleKind.ESNext,
        target: ts.ScriptTarget.ES2022,
      },
    }).outputText;
    const rewritten = rewriteModuleSpecifiers(transpiled, new Map([
      ["snapback2/client", clientModule],
      ["snapback2/test", testModule],
    ]));
    const sourceName = basename(sourcePath);
    const outputName = `${sourceName.slice(0, -".test.ts".length)}.mjs`;
    const outputPath = join(stagedOutput, outputName);
    await writeFile(outputPath, rewritten);
    files.push(relativeSite(projectRoot, outputPath));
  }
  const racedOutput = await journeyOutputDiagnostic(projectRoot, [join(projectRoot, ".snapback"), buildRoot, outputRoot]);
  if (racedOutput) {
    await rm(stagedOutput, { recursive: true, force: true });
    return { ok: false, diagnostics: [racedOutput] };
  }
  await replaceDirectoryAtomically(outputRoot, stagedOutput);
  for (let index = 0; index < files.length; index += 1) {
    files[index] = relativeSite(projectRoot, join(outputRoot, basename(files[index]!)));
  }
  return { ok: true, files };
}

async function replaceDirectoryAtomically(target: string, staged: string): Promise<void> {
  const backup = `${target}.replaced-${process.pid}-${Date.now()}`;
  try {
    await rename(target, backup);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
  try {
    await rename(staged, target);
  } catch (error) {
    try {
      await rename(backup, target);
    } catch {
      // Preserve the original replacement failure; the staged directory remains inspectable.
    }
    throw error;
  }
  await rm(backup, { recursive: true, force: true });
}

async function journeyOutputDiagnostic(
  projectRoot: string,
  components: string[],
): Promise<FrontendDiagnostic | undefined> {
  const canonicalRoot = await realpath(projectRoot);
  for (const component of components) {
    try {
      const status = await lstat(component);
      if (status.isSymbolicLink()) {
        return typeDiagnostic("E_OP_INVALID", "op", relativeSite(projectRoot, component), 1, 1,
          `journey output component ${relativeSite(projectRoot, component)} is a symlink`,
          "replace the symlink with a project-owned directory", "testing/journeys");
      }
      const canonical = await realpath(component);
      const fromRoot = relative(canonicalRoot, canonical);
      if (fromRoot === ".." || fromRoot.startsWith(`..${sep}`) || isAbsolute(fromRoot)) {
        return typeDiagnostic("E_OP_INVALID", "op", relativeSite(projectRoot, component), 1, 1,
          `journey output component ${relativeSite(projectRoot, component)} escapes the project`,
          "use a project-owned output directory", "testing/journeys");
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
  }
  return undefined;
}

function rewriteModuleSpecifiers(source: string, replacements: Map<string, string>): string {
  const file = ts.createSourceFile("journey.mjs", source, ts.ScriptTarget.ES2022, true, ts.ScriptKind.JS);
  const edits: Array<{ start: number; end: number; value: string }> = [];
  const add = (node: ts.Expression | undefined) => {
    if (!node || !ts.isStringLiteralLike(node)) return;
    const replacement = replacements.get(node.text);
    if (replacement) edits.push({ start: node.getStart(file), end: node.getEnd(), value: JSON.stringify(replacement) });
  };
  walk(file, (node) => {
    if (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) add(node.moduleSpecifier);
    if (ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword) add(node.arguments[0]);
  });
  return edits.sort((left, right) => right.start - left.start)
    .reduce((text, edit) => `${text.slice(0, edit.start)}${edit.value}${text.slice(edit.end)}`, source);
}

function compilerPackageDist(): string {
  const here = dirname(fileURLToPath(import.meta.url));
  return basename(here) === "dist" ? here : resolve(here, "../../snapback2/dist");
}

function collectOperations(modules: SourceModule[]): Map<string, OperationDecl & { module: SourceModule }> {
  const operations = new Map<string, OperationDecl & { module: SourceModule }>();
  for (const module of modules) {
    for (const statement of module.sourceFile.statements) {
      if (!ts.isVariableStatement(statement) || !hasExport(statement)) continue;
      for (const declaration of statement.declarationList.declarations) {
        if (!ts.isIdentifier(declaration.name) || !declaration.initializer) continue;
        const call = unwrapCall(declaration.initializer);
        const kind = call && callLeaf(call);
        if (!call || (kind !== "query" && kind !== "mutation")) continue;
        const name = `${module.moduleName}.${declaration.name.text}`;
        operations.set(name, { name, moduleName: module.moduleName, exportName: declaration.name.text, kind, call, module });
      }
    }
  }
  return operations;
}

function reservedApiPathDiagnostics(
  operations: Map<string, OperationDecl & { module: SourceModule }>,
  schemaSource: string,
  schemaFileName: string,
): FrontendDiagnostic[] {
  const diagnostics: FrontendDiagnostic[] = [];
  for (const operation of operations.values()) {
    if (operation.moduleName === "then") {
      diagnostics.push(diagnostic(
        operation.module,
        "E_OP_RESERVED",
        operation.call,
        `operation ${operation.name} uses reserved API path segment then`,
        `rename snapback/then.ts to snapback/${operation.exportName === "then" ? "operations" : operation.exportName}.ts`,
      ));
    }
    if (operation.exportName === "then") {
      diagnostics.push(diagnostic(
        operation.module,
        "E_OP_RESERVED",
        operation.call,
        `operation ${operation.name} uses reserved API property then`,
        operation.module.source.replace(/\bthen\b/, "thenOperation"),
      ));
    }
  }

  const sourceFile = ts.createSourceFile(schemaFileName, schemaSource, ts.ScriptTarget.ES2022, true);
  const schemaModule = { sourceFile, source: schemaSource, fileName: schemaFileName };
  for (const statement of sourceFile.statements) {
    if (!ts.isVariableStatement(statement) || !hasExport(statement)) continue;
    for (const declaration of statement.declarationList.declarations) {
      if (!ts.isIdentifier(declaration.name) || declaration.name.text !== "then" || !declaration.initializer) continue;
      const call = unwrapCall(declaration.initializer);
      if (!call || callLeaf(call) !== "channel") continue;
      diagnostics.push(diagnostic(
        schemaModule,
        "E_OP_RESERVED",
        declaration.name,
        "channel then uses a reserved API property",
        schemaSource.replace(/\bthen\b/g, "thenChannel"),
      ));
    }
  }
  return diagnostics;
}

function boundProjectOperationDiagnostics(
  diagnostics: FrontendDiagnostic[],
  modules: SourceModule[],
  operations: Map<string, OperationDecl>,
): FrontendDiagnostic[] {
  let remaining = diagnostics;
  const result: FrontendDiagnostic[] = [];
  for (const module of modules) {
    const local = remaining.filter((item) => item.site.startsWith(`${module.fileName}:`));
    remaining = remaining.filter((item) => !item.site.startsWith(`${module.fileName}:`));
    const spans = [...operations.values()]
      .filter((item) => item.moduleName === module.moduleName)
      .map((item) => ({ name: item.name, call: item.call }));
    result.push(...boundOperationDiagnostics(local, spans, module));
  }
  return [...result, ...remaining];
}

function tableBindings(
  module: SourceModule,
  declared: Map<string, TableInfo>,
  diagnostics: FrontendDiagnostic[],
): Map<string, TableInfo> {
  const bindings = new Map<string, TableInfo>();
  for (const statement of module.sourceFile.statements) {
    if (!ts.isImportDeclaration(statement) || !ts.isStringLiteral(statement.moduleSpecifier)
      || !/^\.\/schema(?:\.ts)?$/.test(statement.moduleSpecifier.text)) continue;
    const imports = statement.importClause?.namedBindings;
    if (!imports) continue;
    if (ts.isNamespaceImport(imports)) {
      for (const [exported, table] of declared) bindings.set(`${imports.name.text}.${exported}`, table);
      continue;
    }
    for (const item of imports.elements) {
      const exported = item.propertyName?.text ?? item.name.text;
      const table = declared.get(exported);
      if (table) bindings.set(item.name.text, table);
      else diagnostics.push(diagnostic(module, "E_SCHEMA_UNKNOWN_TABLE", item, `schema has no exported table ${exported}`, module.source));
    }
  }
  return bindings;
}

function firstInvalidStaticSpread(node: ts.Node, constants: Map<string, unknown>): ts.SpreadAssignment | undefined {
  let invalid: ts.SpreadAssignment | undefined;
  walk(node, (item) => {
    if (invalid || !ts.isSpreadAssignment(item)) return;
    const value = staticJson(item.expression, constants);
    if (!value || typeof value !== "object" || Array.isArray(value)) invalid = item;
  });
  return invalid;
}

function loadCompilerLib(): string {
  const moduleCandidates = [
    fileURLToPath(new URL("../lib.d.ts", import.meta.url)),
    fileURLToPath(new URL("./index.d.ts", import.meta.url)),
  ];
  const subsetCandidates = [
    fileURLToPath(new URL("../subset-lib.d.ts", import.meta.url)),
    fileURLToPath(new URL("./compiler-lib.d.ts", import.meta.url)),
  ];
  const modulePath = moduleCandidates.find(existsSync);
  const subsetPath = subsetCandidates.find(existsSync);
  if (!modulePath || !subsetPath) throw new Error("snapback2 compiler: checker declarations are missing beside the compiler bundle");
  return `${readFileSync(subsetPath, "utf8")}\n${readFileSync(modulePath, "utf8")}`;
}

function moduleName(path: string): string {
  return path.split(sep).at(-1)!.replace(/\.(?:q|ts)$/, "");
}

function remapDiagnostic(
  diagnostic: FrontendDiagnostic,
  virtualByFile: Map<string, QuarryVirtualModule>,
  generatedTypeError: boolean,
): FrontendDiagnostic {
  const file = diagnostic.site.replace(/:\d+:\d+$/, "");
  const virtual = virtualByFile.get(file);
  return virtual ? remapVirtualDiagnostic(diagnostic, virtual, generatedTypeError) : diagnostic;
}

function relativeSite(root: string, path: string): string {
  return relative(root, isAbsolute(path) ? path : resolve(path)).split(sep).join("/");
}

function quoteProperty(value: string): string {
  return /^[A-Za-z_$][\w$]*$/.test(value) ? value : JSON.stringify(value);
}

function elapsed(started: number): number {
  return Math.round((performance.now() - started) * 100) / 100;
}
