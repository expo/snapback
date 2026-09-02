import { existsSync, readFileSync } from "node:fs";
import { mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import ts from "typescript";
import { expandArgumentObject } from "./args";
import { requiredType, type AuthoredType, type TableInfo } from "./authored-types";
import { lowerSource } from "./compiler";
import { boundedDiagnostics, diagnostic, typeDiagnostic } from "./diagnostics";
import { IR_CONTRACT, type FrontendDiagnostic, type Program, type ProjectResult, type SourceSite } from "./ir";
import { effectBindings, collectEffectCatalog, lowerEffects, type OperationDecl, type SourceModule } from "./lower/effects";
import { lowerSchema } from "./lower/schema";
import { boundOperationDiagnostics } from "./operation-diagnostics";
import { callLeaf, moduleJsonConstants, numberValue, objectOf, property, propertyEntries, staticJson, stringArray, stringValue } from "./lower/static";
import { findNarrowestNode, hasExport, propertyName, staticMemberPath, unwrapCall, unwrapExpression, walk } from "./syntax";
import { typeDiagnosticSite } from "./type-diagnostic-site";
import { compileQuarry, remapVirtualDiagnostic, remapVirtualSource, type QuarryInput, type QuarryVirtualModule } from "./quarry/index";
import { createProjectProgram, projectTypeDiagnostics } from "./project-program";

// @ref LLP 1002#3-the-compiler-worker-and-the-project-json — one lowering pass owns the ProjectJson, sources, API types, and aggregate refusals.

export async function lowerProject(root: string): Promise<ProjectResult> {
  const started = performance.now();
  const projectRoot = resolve(root);
  const authoredRoot = join(projectRoot, "snapback");
  const tsSchemaPath = join(authoredRoot, "schema.ts");
  const qSchemaPath = join(authoredRoot, "schema.q");
  const hasTsSchema = existsSync(tsSchemaPath);
  const hasQuarrySchema = existsSync(qSchemaPath);
  if (hasTsSchema && hasQuarrySchema) {
    return {
      ok: false,
      diagnostics: [typeDiagnostic("E_QUARRY_PLACEMENT", "quarry", "snapback/schema.q", 1, 1,
        "snapback/schema.q and snapback/schema.ts cannot coexist; exactly one schema is allowed",
        "-- remove snapback/schema.ts or snapback/schema.q", "quarry/projects")],
      ms: elapsed(started),
    };
  }
  if (!hasTsSchema && !hasQuarrySchema) {
    return {
      ok: false,
      diagnostics: [typeDiagnostic("E_SCHEMA_DEFAULT_EXPORT", "schema", "snapback/schema.ts", 1, 1,
        "missing snapback/schema.q or snapback/schema.ts", "create snapback/schema.q with table declarations", "schema/project")],
      ms: elapsed(started),
    };
  }

  const discoveredModulePaths = await discoverModulePaths(authoredRoot);
  const quarryPaths = discoveredModulePaths.filter((path) => path.endsWith(".q")).sort();
  if (!hasQuarrySchema && quarryPaths.length > 0) {
    const path = quarryPaths[0]!;
    return {
      ok: false,
      diagnostics: [typeDiagnostic("E_QUARRY_PLACEMENT", "quarry", relativeSite(projectRoot, path), 1, 1,
        `Quarry module ${relativeSite(projectRoot, path)} requires snapback/schema.q; this project has snapback/schema.ts`,
        "-- move the schema to snapback/schema.q or rewrite this module as TypeScript", "quarry/projects")],
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
  const tsModulePaths = discoveredModulePaths
    .filter((path) => path.endsWith(".ts"))
    .sort();
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
  const diagnostics = [...schema.diagnostics, ...duplicateModuleBasenameDiagnostics(programPaths, projectRoot)];
  if (modules.length === 0) {
    diagnostics.push(typeDiagnostic(
      "E_OP_NONE",
      "op",
      schemaFileName,
      1,
      1,
      "module exports no query/mutation/effect",
      "export const operation = query({}, ({ args }) => args);",
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
  const sources: Record<string, SourceSite> = {};
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
    if (!(table in tables)) {
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
  await rm(outputRoot, { recursive: true, force: true });
  await mkdir(outputRoot, { recursive: true });
  if (sourceFiles.length === 0) return { ok: true, files: [] };

  const packageDist = compilerPackageDist();
  const clientDts = join(packageDist, "client.d.ts");
  const testDts = join(packageDist, "test.d.ts");
  const apiPath = join(buildRoot, "api.d.ts");
  await writeFile(apiPath, apiDts);
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
  const program = ts.createProgram({ rootNames: [...sourceFiles, apiPath], options });
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
  if (diagnostics.length > 0) {
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
    }).outputText
      .replace(/(["'])snapback2\/client\1/g, JSON.stringify(clientModule))
      .replace(/(["'])snapback2\/test\1/g, JSON.stringify(testModule));
    const sourceName = basename(sourcePath);
    const outputName = `${sourceName.slice(0, -".test.ts".length)}.mjs`;
    const outputPath = join(outputRoot, outputName);
    await writeFile(outputPath, transpiled);
    files.push(relativeSite(projectRoot, outputPath));
  }
  return { ok: true, files };
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

function generateApiDts(
  operations: Map<string, OperationDecl>,
  program: ts.Program,
  checker: ts.TypeChecker,
  tables: Map<string, TableInfo>,
  bindingsByModule: Map<string, Map<string, TableInfo>>,
): string {
  const grouped = new Map<string, string[]>();
  for (const operation of [...operations.values()].sort((left, right) => left.name.localeCompare(right.name))) {
    const checkedCall = checkedOperationCall(program, operation);
    const args = checkedCall?.arguments[0] && objectOf(checkedCall.arguments[0]);
    const argsText = args ? apiArgsType(args, checker) : "{}";
    const handler = checkedCall?.arguments[1];
    let resultText = "unknown";
    if (handler && (ts.isArrowFunction(handler) || ts.isFunctionExpression(handler))) {
      const signature = checker.getSignatureFromDeclaration(handler);
      if (signature) {
        resultText = checker.typeToString(
          checker.getReturnTypeOfSignature(signature),
          handler,
          ts.TypeFormatFlags.NoTruncation | ts.TypeFormatFlags.InTypeAlias,
        );
      }
      const authored = apiAuthoredResult(handler, args, bindingsByModule.get(operation.moduleName) ?? new Map(), checker);
      if (authored?.special) resultText = authored.text;
    }
    const items = grouped.get(operation.moduleName) ?? [];
    items.push(`      readonly ${quoteProperty(operation.exportName)}: Op<${argsText}, ${resultText}>;`);
    grouped.set(operation.moduleName, items);
  }
  const rowTypes = [...tables.values()]
    .sort((left, right) => left.name.localeCompare(right.name))
    .map(apiRowType)
    .join("\n");
  const channels = apiChannels(program, checker);
  const modulesText = [...grouped].sort(([left], [right]) => left.localeCompare(right))
    .filter(([name]) => name !== "channels" || channels.length === 0)
    .map(([name, items]) => `    readonly ${quoteProperty(name)}: {\n${items.join("\n")}\n    };`)
    .join("\n");
  const channelsText = channels.length === 0 ? "" : (() => {
    const channelByName = new Map(channels.map((item) => [item.name, item]));
    const channelOperations = [...operations.values()]
      .sort((left, right) => left.name.localeCompare(right.name))
      .filter((operation) => operation.moduleName === "channels");
    const operationItems = (grouped.get("channels") ?? []).map((item, index) => {
      const channel = channelByName.get(channelOperations[index]!.exportName);
      return channel ? item.replace(/;$/, ` & Channel<${channel.args}, unknown>;`) : item;
    });
    const operationNames = new Set(channelOperations.map((operation) => operation.exportName));
    const channelItems = channels
      .filter((item) => !operationNames.has(item.name))
      .map((item) => `${quoteProperty(item.name)}: Channel<${item.args}, unknown>`);
    const catalog = operationItems.length === 0
      ? `    readonly channels: { ${channelItems.join("; ")} };`
      : `    readonly channels: {\n${operationItems.join("\n")}\n${channelItems.map((item) => `      readonly ${item};`).join("\n")}\n    };`;
    const occupiedRoots = new Set([...grouped.keys(), "channels", "op", "then", "toJSON"]);
    const aliases = channels
      .filter((item) => !occupiedRoots.has(item.name))
      .map((item) => `    readonly ${quoteProperty(item.name)}: Channel<${item.args}, unknown>;`);
    return [catalog, ...aliases].join("\n");
  })();
  const members = [modulesText, channelsText].filter(Boolean).join("\n");
  return `import type { Bytes, Decimal, Json, Money, Page, Principal } from 'snapback2';\nimport type { Channel, Op } from 'snapback2/client';\n\n${rowTypes}\n\ndeclare module 'snapback2/client' {\n  interface Api {\n${members}\n  }\n}\n\nexport {};\n`;
}

function apiChannels(program: ts.Program, checker: ts.TypeChecker): Array<{ name: string; args: string }> {
  const schema = program.getSourceFiles().find((item) => /[/\\]snapback[/\\]schema\.ts$/.test(item.fileName));
  if (!schema) return [];
  const channels: Array<{ name: string; args: string }> = [];
  for (const statement of schema.statements) {
    if (!ts.isVariableStatement(statement) || !hasExport(statement)) continue;
    for (const declaration of statement.declarationList.declarations) {
      if (!ts.isIdentifier(declaration.name) || !declaration.initializer) continue;
      const call = unwrapCall(declaration.initializer);
      if (!call || callLeaf(call) !== "channel") continue;
      const config = objectOf(call.arguments[0]);
      const args = config && objectOf(property(config, "args"));
      channels.push({ name: declaration.name.text, args: args ? apiArgsType(args, checker) : "{}" });
    }
  }
  return channels.sort((left, right) => left.name.localeCompare(right.name));
}

function apiRowType(table: TableInfo): string {
  const fields = Object.entries(table.columns ?? {}).map(([name, type]) => {
    const optional = type.kind === "optional";
    return `  ${quoteProperty(name)}${optional ? "?" : ""}: ${apiAuthoredType(optional ? type.of : type)};`;
  });
  if (!fields.some((field) => /^  id[?:]/.test(field))) fields.unshift("  id: string;");
  return `type ${apiRowName(table.name)} = {\n${fields.join("\n")}\n};`;
}

function apiRowName(table: string): string {
  const pascal = table.split(/[^A-Za-z0-9]+/).filter(Boolean)
    .map((part) => part[0]!.toUpperCase() + part.slice(1))
    .join("");
  return `${pascal || "Table"}Row`;
}

function checkedOperationCall(program: ts.Program, operation: OperationDecl): ts.CallExpression | undefined {
  const file = program.getSourceFiles().find((item) => item.fileName.endsWith(`/snapback/${operation.moduleName}.ts`));
  if (!file) return undefined;
  for (const statement of file.statements) {
    if (!ts.isVariableStatement(statement) || !hasExport(statement)) continue;
    for (const declaration of statement.declarationList.declarations) {
      if (!ts.isIdentifier(declaration.name) || declaration.name.text !== operation.exportName || !declaration.initializer) continue;
      return unwrapCall(declaration.initializer);
    }
  }
  return undefined;
}

function apiArgsType(object: ts.ObjectLiteralExpression, checker: ts.TypeChecker): string {
  const fields = expandArgumentObject(object).entries.map((entry) => {
    const call = unwrapCall(entry.value);
    const optional = call && callLeaf(call) === "optional";
    const type = call ? descriptorType(call, checker) : "unknown";
    return `${quoteProperty(entry.name)}${optional ? "?" : ""}: ${type}`;
  });
  return fields.length === 0 ? "{}" : `{ ${fields.join("; ")} }`;
}

function descriptorType(call: ts.CallExpression, checker: ts.TypeChecker): string {
  const name = callLeaf(call);
  if (name === "principal") return "Principal";
  if (name === "id" || name === "text" || name === "ref") return "string";
  if (name === "bytes") return "Bytes";
  if (name === "int" || name === "time") return "number";
  if (name === "bool") return "boolean";
  if (name === "enum") {
    const variants = stringArray(call.arguments[0]);
    return variants?.map((item) => JSON.stringify(item)).join(" | ") || "never";
  }
  if (name === "decimal") return `Decimal<${numberValue(call.arguments[0]) ?? "number"}>`;
  if (name === "money") {
    return `Money<${JSON.stringify(stringValue(call.arguments[0]) ?? "")}, ${numberValue(call.arguments[1]) ?? 2}>`;
  }
  if (name === "optional" && call.arguments[0]) {
    const inner = unwrapCall(call.arguments[0]);
    return inner ? descriptorType(inner, checker) : "unknown";
  }
  if (name === "list" && call.arguments[0]) {
    const inner = unwrapCall(call.arguments[0]);
    return `${inner ? descriptorType(inner, checker) : "unknown"}[]`;
  }
  if (name === "json") {
    const type = checker.getTypeAtLocation(call);
    const property = type.getProperty("__value");
    if (property) return checker.typeToString(checker.getTypeOfSymbolAtLocation(property, call), call, ts.TypeFormatFlags.NoTruncation);
  }
  return "unknown";
}

type ApiType = { text: string; special: boolean };
type ApiTypeBinding = { kind: "args" } | { kind: "local"; row?: TableInfo };
type ApiTypeEnvironment = { bindings: Map<string, ApiTypeBinding> };

function apiAuthoredResult(
  handler: ts.ArrowFunction | ts.FunctionExpression,
  args: ts.ObjectLiteralExpression | undefined,
  tables: Map<string, TableInfo>,
  checker: ts.TypeChecker,
): ApiType | undefined {
  const environment: ApiTypeEnvironment = { bindings: new Map() };
  for (const parameter of handler.parameters) {
    for (const name of apiBindingNames(parameter.name)) environment.bindings.set(name, { kind: "local" });
  }
  const context = handler.parameters[0]?.name;
  if (context && ts.isObjectBindingPattern(context)) {
    for (const element of context.elements) {
      if (!ts.isIdentifier(element.name)) continue;
      const property = element.propertyName ? propertyName(element.propertyName) : element.name.text;
      if (property === "args") environment.bindings.set(element.name.text, { kind: "args" });
    }
  }
  if (!ts.isBlock(handler.body)) return apiExpressionType(handler.body, args, tables, checker, environment);
  for (const statement of handler.body.statements) {
    if (ts.isVariableStatement(statement)) {
      for (const declaration of statement.declarationList.declarations) {
        const initializer = declaration.initializer && unwrapExpression(declaration.initializer);
        const call = initializer && unwrapCall(initializer);
        const row = call && callLeaf(call) === "get" && call.arguments[0]
          ? apiTable(call.arguments[0], tables)
          : undefined;
        for (const name of apiBindingNames(declaration.name)) {
          environment.bindings.set(name, { kind: "local", ...(row ? { row } : {}) });
        }
      }
    }
    if (ts.isReturnStatement(statement) && statement.expression) {
      return apiExpressionType(statement.expression, args, tables, checker, environment);
    }
  }
  return undefined;
}

function apiExpressionType(
  node: ts.Expression,
  args: ts.ObjectLiteralExpression | undefined,
  tables: Map<string, TableInfo>,
  checker: ts.TypeChecker,
  environment: ApiTypeEnvironment,
  expected?: AuthoredType,
): ApiType {
  const value = unwrapExpression(node);
  const target = expected && requiredType(expected);
  if (target?.kind === "decimal") return { text: apiAuthoredType(target), special: true };
  if (target?.kind === "enum" && ts.isStringLiteralLike(value)) return { text: apiAuthoredType(target), special: true };
  if (ts.isNumericLiteral(value)) return { text: "number", special: false };
  if (ts.isStringLiteralLike(value) || ts.isTemplateExpression(value)) return { text: "string", special: false };
  if (value.kind === ts.SyntaxKind.TrueKeyword || value.kind === ts.SyntaxKind.FalseKeyword) return { text: "boolean", special: false };
  if (value.kind === ts.SyntaxKind.NullKeyword) return { text: "null", special: false };
  const propertyBase = ts.isPropertyAccessExpression(value) ? unwrapExpression(value.expression) : undefined;
  const propertyBinding = propertyBase && ts.isIdentifier(propertyBase)
    ? environment.bindings.get(propertyBase.text)
    : undefined;
  if (ts.isPropertyAccessExpression(value) && propertyBase && ts.isIdentifier(propertyBase)
    && propertyBinding?.kind === "args" && args) {
    const descriptor = propertyEntries(args).find((item) => item.name === value.name.text)?.value;
    const call = descriptor && unwrapCall(descriptor);
    if (call) {
      const text = `${descriptorType(call, checker)}${callLeaf(call) === "optional" ? " | undefined" : ""}`;
      return { text, special: /^(Decimal|Money)</.test(text) || text.includes(" | ") };
    }
  }
  if (ts.isPropertyAccessExpression(value) && propertyBinding?.kind === "local" && propertyBinding.row) {
    const authored = propertyBinding.row.columns?.[value.name.text];
    if (authored) {
      const optional = authored.kind === "optional";
      const text = `${apiAuthoredType(optional ? authored.of : authored)}${optional ? " | undefined" : ""}`;
      return { text, special: /^(Decimal|Money)</.test(text) || text.includes(" | ") };
    }
  }
  if (ts.isObjectLiteralExpression(value)) {
    let special = false;
    const fields: string[] = [];
    for (const item of value.properties) {
      if (ts.isShorthandPropertyAssignment(item)) {
        const type = apiExpressionType(item.name, args, tables, checker, environment);
        special ||= type.special;
        fields.push(`${quoteProperty(item.name.text)}: ${type.text}`);
        continue;
      }
      if (!ts.isPropertyAssignment(item)) continue;
      const name = propertyName(item.name);
      if (!name) continue;
      const type = apiExpressionType(item.initializer, args, tables, checker, environment);
      special ||= type.special;
      fields.push(`${quoteProperty(name)}: ${type.text}`);
    }
    return { text: `{ ${fields.join("; ")} }`, special };
  }
  if (ts.isArrayLiteralExpression(value)) {
    const items = value.elements.map((item) => apiExpressionType(item, args, tables, checker, environment));
    return { text: `${items[0]?.text ?? "unknown"}[]`, special: items.some((item) => item.special) };
  }
  if (ts.isConditionalExpression(value)) {
    const left = apiExpressionType(value.whenTrue, args, tables, checker, environment, target);
    const right = apiExpressionType(value.whenFalse, args, tables, checker, environment, target);
    return { text: left.text === right.text ? left.text : `${left.text} | ${right.text}`, special: left.special || right.special };
  }
  if (ts.isBinaryExpression(value)) {
    const left = apiExpressionType(value.left, args, tables, checker, environment);
    const right = apiExpressionType(value.right, args, tables, checker, environment);
    if ([
      ts.SyntaxKind.LessThanToken, ts.SyntaxKind.LessThanEqualsToken, ts.SyntaxKind.GreaterThanToken,
      ts.SyntaxKind.GreaterThanEqualsToken, ts.SyntaxKind.EqualsEqualsToken, ts.SyntaxKind.EqualsEqualsEqualsToken,
      ts.SyntaxKind.ExclamationEqualsToken, ts.SyntaxKind.ExclamationEqualsEqualsToken,
    ].includes(value.operatorToken.kind)) return { text: "boolean", special: false };
    if (value.operatorToken.kind === ts.SyntaxKind.QuestionQuestionToken && (left.special || right.special)) {
      return { text: (left.special ? left.text : right.text).replace(/ \| undefined\b/g, ""), special: true };
    }
    const branded = [left, right].find((item) => /^(Decimal|Money)</.test(item.text));
    if (branded && [
      ts.SyntaxKind.PlusToken, ts.SyntaxKind.MinusToken, ts.SyntaxKind.AsteriskToken,
    ].includes(value.operatorToken.kind)) return branded;
  }
  if (ts.isCallExpression(value)) {
    const name = callLeaf(value);
    if ((name === "scan" || name === "get") && value.arguments[0]) {
      const table = apiTable(value.arguments[0], tables);
      if (table) {
        return {
          text: name === "scan" ? `Page<${apiRowName(table.name)}>` : `${apiRowName(table.name)} | null`,
          special: true,
        };
      }
    }
    if (name === "decimal") {
      return { text: `Decimal<${numberValue(value.arguments[1]) ?? "number"}>`, special: true };
    }
    if (name === "min" || name === "max") {
      const branded = value.arguments.map((item) => apiExpressionType(item, args, tables, checker, environment))
        .find((item) => /^(Decimal|Money)</.test(item.text));
      if (branded) return branded;
    }
  }
  const text = checker.typeToString(
    checker.getTypeAtLocation(value),
    value,
    ts.TypeFormatFlags.NoTruncation | ts.TypeFormatFlags.InTypeAlias,
  ).replaceAll('import("snapback2").', "");
  return { text, special: /\b(?:Decimal|Money)</.test(text) };
}

function apiBindingNames(name: ts.BindingName): string[] {
  if (ts.isIdentifier(name)) return [name.text];
  return name.elements.flatMap((element) => ts.isBindingElement(element) ? apiBindingNames(element.name) : []);
}

function apiAuthoredType(value: AuthoredType): string {
  if (value.kind === "int") return "number";
  if (value.kind === "string") return "string";
  if (value.kind === "principal") return "Principal";
  if (value.kind === "bytes") return "Bytes";
  if (value.kind === "bool") return "boolean";
  if (value.kind === "json") return "Json";
  if (value.kind === "decimal") {
    return value.currency ? `Money<${JSON.stringify(value.currency)}, ${value.scale}>` : `Decimal<${value.scale}>`;
  }
  if (value.kind === "enum") return value.variants.map((item) => JSON.stringify(item)).join(" | ") || "never";
  if (value.kind === "list") return `${apiAuthoredType(value.of)}[]`;
  if (value.kind === "optional") return apiAuthoredType(value.of);
  if (value.kind === "row") return apiRowName(value.table);
  return "unknown";
}

function apiTable(node: ts.Expression, tables: Map<string, TableInfo>): TableInfo | undefined {
  const path = staticMemberPath(node);
  if (!path) return undefined;
  const direct = tables.get(path);
  if (direct) return direct;
  const separator = path.lastIndexOf(".");
  return separator > 0 ? tables.get(path.slice(0, separator)) : undefined;
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

function validateSeedRow(
  module: { sourceFile: ts.SourceFile; source: string; fileName: string },
  node: ts.Node,
  table: string,
  index: number,
  value: unknown,
  columns: Record<string, unknown>,
  diagnostics: FrontendDiagnostic[],
): void {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    diagnostics.push(diagnostic(module, "E_SEED_ROW", node, `seed ${table}[${index}] must be an object with a string id`, module.source));
    return;
  }
  const row = value as Record<string, unknown>;
  if (typeof row.id !== "string" || row.id.length === 0) {
    diagnostics.push(diagnostic(module, "E_SEED_ROW", node, `seed ${table}[${index}].id must be a non-empty string`, module.source));
  }
  for (const field of Object.keys(row)) {
    if (!(field in columns)) {
      diagnostics.push(diagnostic(module, "E_SEED_VALUE", node, `seed ${table}[${index}] has unknown column ${field}`, module.source));
    }
  }
  for (const [field, type] of Object.entries(columns)) {
    if (!(field in row)) {
      if (!isOptionalColumn(type)) {
        diagnostics.push(diagnostic(module, "E_SEED_VALUE", node, `seed ${table}[${index}] is missing required column ${field}`, module.source));
      }
      continue;
    }
    const mismatch = seedValueMismatch(row[field], type, `${table}[${index}].${field}`);
    if (mismatch) diagnostics.push(diagnostic(module, "E_SEED_VALUE", node, mismatch, module.source));
  }
}

function seedValueMismatch(value: unknown, type: unknown, path: string): string | undefined {
  if (type === "Id" || type === "Principal" || (type && typeof type === "object" && "Ref" in type)) {
    if (value === IR_CONTRACT.systemPrincipalId) return `${path} cannot carry the reserved system principal`;
    return typeof value === "string" && value.length > 0 ? undefined : `${path} must be a non-empty string`;
  }
  if (type === "Int" || type === "Time") {
    return typeof value === "number" && Number.isSafeInteger(value) ? undefined : `${path} must be an integer`;
  }
  if (type === "Bool") return typeof value === "boolean" ? undefined : `${path} must be boolean`;
  if (!type || typeof type !== "object" || Array.isArray(type)) return `${path} has an unsupported schema type`;
  const descriptor = type as Record<string, any>;
  if (descriptor.Text) {
    return typeof value === "string" && [...value].length <= descriptor.Text.max ? undefined : `${path} must be text of at most ${descriptor.Text.max} characters`;
  }
  if (descriptor.Bytes) {
    const encodedObject = value && typeof value === "object" && !Array.isArray(value)
      ? value as Record<string, unknown>
      : undefined;
    const encoded = encodedObject?.Bytes;
    return encodedObject && Object.keys(encodedObject).length === 1
      && typeof encoded === "string" && /^(?:[0-9a-f]{2})*$/.test(encoded)
      && encoded.length / 2 <= descriptor.Bytes.max
      ? undefined
      : `${path} must be canonical lowercase base16 of at most ${descriptor.Bytes.max} bytes`;
  }
  if (descriptor.Json) {
    const mismatch = jsonWireMismatch(value, path);
    if (mismatch) return mismatch;
    const bytes = new TextEncoder().encode(JSON.stringify(value)).length;
    return bytes <= descriptor.Json.max_bytes ? undefined : `${path} JSON exceeds ${descriptor.Json.max_bytes} bytes`;
  }
  if (descriptor.Enum) {
    const variants = descriptor.Enum.variants as unknown[];
    return typeof value === "string" && variants.includes(value)
      ? undefined
      : `${path} must be one of ${variants.map(String).join(", ")}`;
  }
  if (descriptor.Decimal || descriptor.Money) {
    return typeof value === "number" && Number.isSafeInteger(value) ? undefined : `${path} must be integer minor units`;
  }
  if ("Optional" in descriptor) {
    return value === null ? undefined : seedValueMismatch(value, descriptor.Optional, path);
  }
  if (descriptor.List) {
    if (!Array.isArray(value)) return `${path} must be a list`;
    if (value.length > descriptor.List.max) return `${path} exceeds list max ${descriptor.List.max}`;
    for (let index = 0; index < value.length; index += 1) {
      const mismatch = seedValueMismatch(value[index], descriptor.List.of, `${path}[${index}]`);
      if (mismatch) return mismatch;
    }
    return undefined;
  }
  return `${path} has an unsupported schema type`;
}

function isOptionalColumn(type: unknown): boolean {
  return !!type && typeof type === "object" && !Array.isArray(type) && "Optional" in type;
}

function jsonWireMismatch(value: unknown, path: string): string | undefined {
  if (typeof value === "number") return Number.isSafeInteger(value) ? undefined : `${path} JSON numbers must be integers`;
  if (Array.isArray(value)) {
    for (let index = 0; index < value.length; index += 1) {
      const mismatch = jsonWireMismatch(value[index], `${path}[${index}]`);
      if (mismatch) return mismatch;
    }
  } else if (value && typeof value === "object") {
    for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
      const mismatch = jsonWireMismatch(item, `${path}.${key}`);
      if (mismatch) return mismatch;
    }
  }
  return undefined;
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

function sortSerdeMaps(program: Program): Program {
  return {
    ...program,
    args: Object.fromEntries(Object.entries(program.args).sort(([left], [right]) => left.localeCompare(right))),
    body: sortNestedMaps(program.body) as Program["body"],
  };
}

function sortNestedMaps(value: unknown, mapValue = false): unknown {
  if (Array.isArray(value)) return value.map((item) => sortNestedMaps(item));
  if (!value || typeof value !== "object") return value;
  const entries = Object.entries(value as Record<string, unknown>);
  const ordered = mapValue ? entries.sort(([left], [right]) => left.localeCompare(right)) : entries;
  return Object.fromEntries(ordered.map(([key, item]) => [key, sortNestedMaps(item, ["Object", "Row", "Map"].includes(key))]));
}

function elapsed(started: number): number {
  return Math.round((performance.now() - started) * 100) / 100;
}
