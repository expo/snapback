import { existsSync, readFileSync } from "node:fs";
import { readdir, readFile } from "node:fs/promises";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";
import { lowerSource, type TableInfo } from "./compiler";
import { diagnostic, typeDiagnostic } from "./diagnostics";
import type { FrontendDiagnostic, Program, ProjectResult, SourceSite } from "./ir";
import { effectBindings, collectEffectCatalog, lowerEffects, type OperationDecl, type SourceModule } from "./lower/effects";
import { lowerSchema } from "./lower/schema";
import { callLeaf, objectOf, property, propertyEntries } from "./lower/static";
import { findNarrowestNode, hasExport, propertyName, unwrapCall, unwrapExpression } from "./syntax";

// @ref LLP 1002#3-the-compiler-worker-and-the-project-json — one lowering pass owns the ProjectJson, sources, API types, and aggregate refusals.

export async function lowerProject(root: string): Promise<ProjectResult> {
  const started = performance.now();
  const projectRoot = resolve(root);
  const authoredRoot = join(projectRoot, "snapback");
  const schemaPath = join(authoredRoot, "schema.ts");
  let schemaSource: string;
  try {
    schemaSource = await readFile(schemaPath, "utf8");
  } catch {
    const site = relativeSite(projectRoot, schemaPath);
    return {
      ok: false,
      diagnostics: [typeDiagnostic("E_SCHEMA_DEFAULT_EXPORT", "schema", site, 1, 1, "missing snapback/schema.ts", "create snapback/schema.ts with a default schema({...}) export", "schema/project")],
      ms: elapsed(started),
    };
  }

  const entries = await readdir(authoredRoot, { withFileTypes: true });
  const modulePaths = entries
    .filter((entry) => entry.isFile() && entry.name.endsWith(".ts") && !["schema.ts", "seed.ts"].includes(entry.name))
    .map((entry) => join(authoredRoot, entry.name))
    .sort();
  const moduleSources = await Promise.all(modulePaths.map(async (path) => [path, await readFile(path, "utf8")] as const));
  const modules: SourceModule[] = moduleSources.map(([path, source]) => ({
    moduleName: moduleName(path),
    fileName: relativeSite(projectRoot, path),
    source,
    sourceFile: ts.createSourceFile(path, source, ts.ScriptTarget.ES2022, true),
  }));
  const schemaFileName = relativeSite(projectRoot, schemaPath);
  const schema = lowerSchema(schemaSource, schemaFileName);
  const diagnostics = [...schema.diagnostics];

  const libText = loadCompilerLib();
  const checked = createProjectProgram(schemaPath, schemaSource, moduleSources, libText);
  diagnostics.push(...projectTypeDiagnostics(checked.program, projectRoot));

  const operations = collectOperations(modules);
  const catalog = collectEffectCatalog(modules);
  const loweredEffects = lowerEffects(catalog, operations);
  diagnostics.push(...loweredEffects.diagnostics);

  const programs: Program[] = [];
  const sources: Record<string, SourceSite> = {};
  for (const module of modules) {
    const tables = tableBindings(module, schema.tables, diagnostics);
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

  if (diagnostics.length > 0) {
    return { ok: false, diagnostics: deduplicateDiagnostics(diagnostics), ms: elapsed(started) };
  }

  schema.schema.effects = loweredEffects.effects.map((item) => item.name);
  programs.sort((left, right) => left.name.localeCompare(right.name));
  const apiDts = generateApiDts(operations, checked.program, checked.checker);
  return {
    ok: true,
    project: { schema: schema.schema, programs, effects: loweredEffects.effects },
    sources: Object.fromEntries(Object.entries(sources).sort(([left], [right]) => left.localeCompare(right))),
    apiDts,
    ms: elapsed(started),
  };
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
  const value = object && staticSeedValue(object);
  const record = value && typeof value === "object" ? value as Record<string, unknown> : undefined;
  if (!record || !Array.isArray(record.personas) || typeof record.rows !== "object" || record.rows === null) {
    const module = { sourceFile, source, fileName };
    return {
      ok: false,
      diagnostics: [diagnostic(module, "E_SCHEMA_INVALID", expression ?? sourceFile, "seed.ts must default-export seed({ personas, rows })", source)],
    };
  }
  return { ok: true, seed: record as { personas: string[]; rows: Record<string, unknown[]> } };
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

function createProjectProgram(
  schemaPath: string,
  schemaSource: string,
  moduleSources: ReadonlyArray<readonly [string, string]>,
  libText: string,
): { program: ts.Program; checker: ts.TypeChecker } {
  const libPath = resolve(dirname(schemaPath), "__snapback2_lib.d.ts");
  const files = new Map<string, string>([[schemaPath, schemaSource], [libPath, libText], ...moduleSources]);
  const options: ts.CompilerOptions = {
    module: ts.ModuleKind.ESNext,
    moduleResolution: ts.ModuleResolutionKind.Bundler,
    noEmit: true,
    noLib: true,
    strict: true,
    target: ts.ScriptTarget.ES2022,
    types: [],
  };
  const host = ts.createCompilerHost(options, true);
  const sourceFile = host.getSourceFile.bind(host);
  const read = host.readFile.bind(host);
  const exists = host.fileExists.bind(host);
  host.fileExists = (name) => files.has(name) || exists(name);
  host.readFile = (name) => files.get(name) ?? read(name);
  host.getSourceFile = (name, languageVersion, onError, shouldCreateNewSourceFile) => {
    const text = files.get(name);
    return text === undefined
      ? sourceFile(name, languageVersion, onError, shouldCreateNewSourceFile)
      : ts.createSourceFile(name, text, languageVersion, true);
  };
  const program = ts.createProgram([...files.keys()], options, host);
  return { program, checker: program.getTypeChecker() };
}

function projectTypeDiagnostics(program: ts.Program, projectRoot: string): FrontendDiagnostic[] {
  return ts.getPreEmitDiagnostics(program).flatMap((item) => {
    if (!item.file || item.file.fileName.endsWith("__snapback2_lib.d.ts")) return [];
    if (!resolve(item.file.fileName).startsWith(`${resolve(projectRoot)}${sep}`)) return [];
    if (selfTableReference(item)) return [];
    const position = item.start === undefined ? { line: 0, character: 0 } : item.file.getLineAndCharacterOfPosition(item.start);
    const file = relativeSite(projectRoot, item.file.fileName);
    const message = ts.flattenDiagnosticMessageText(item.messageText, "\n");
    const node = item.start === undefined ? item.file : findNarrowestNode(item.file, item.start);
    const effectThen = ancestorProperty(node, "then");
    return [typeDiagnostic(
      effectThen ? "E_EFFECT_THEN_ARGS" : "E_ARGS_TYPE",
      effectThen ? "effect" : "args",
      file,
      position.line + 1,
      position.character + 1,
      message,
      item.file.text,
      effectThen ? "effects/authoring" : "programs/args",
    )];
  });
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
    if (!imports || !ts.isNamedImports(imports)) continue;
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
    }
    const items = grouped.get(operation.moduleName) ?? [];
    items.push(`      readonly ${quoteProperty(operation.exportName)}: Op<${argsText}, ${resultText}>;`);
    grouped.set(operation.moduleName, items);
  }
  const modulesText = [...grouped].sort(([left], [right]) => left.localeCompare(right)).map(([name, items]) =>
    `    readonly ${quoteProperty(name)}: {\n${items.join("\n")}\n    };`).join("\n");
  return `import type { Op } from 'snapback2/client';\n\ndeclare module 'snapback2/client' {\n  interface Api {\n${modulesText}\n  }\n}\n\nexport {};\n`;
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
  const fields = propertyEntries(object).map((entry) => {
    const call = unwrapCall(entry.value);
    const optional = call && callLeaf(call) === "optional";
    const type = call ? descriptorType(call, checker) : "unknown";
    return `${quoteProperty(entry.name)}${optional ? "?" : ""}: ${type}`;
  });
  return fields.length === 0 ? "{}" : `{ ${fields.join("; ")} }`;
}

function descriptorType(call: ts.CallExpression, checker: ts.TypeChecker): string {
  const name = callLeaf(call);
  if (name === "id" || name === "text" || name === "ref") return "string";
  if (name === "int" || name === "time") return "number";
  if (name === "bool") return "boolean";
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

function staticSeedValue(object: ts.ObjectLiteralExpression): unknown {
  const value: Record<string, unknown> = {};
  for (const entry of propertyEntries(object)) {
    const lowered = staticExpression(entry.value);
    if (lowered === undefined) return undefined;
    value[entry.name] = lowered;
  }
  return value;
}

function staticExpression(node: ts.Expression): unknown {
  const value = unwrapExpression(node);
  if (value.kind === ts.SyntaxKind.NullKeyword) return null;
  if (value.kind === ts.SyntaxKind.TrueKeyword) return true;
  if (value.kind === ts.SyntaxKind.FalseKeyword) return false;
  if (ts.isStringLiteralLike(value)) return value.text;
  if (ts.isNumericLiteral(value)) return Number(value.text);
  if (ts.isPrefixUnaryExpression(value) && value.operator === ts.SyntaxKind.MinusToken && ts.isNumericLiteral(value.operand)) {
    return -Number(value.operand.text);
  }
  if (ts.isArrayLiteralExpression(value)) {
    const output = value.elements.map((item) => staticExpression(item));
    return output.some((item) => item === undefined) ? undefined : output;
  }
  if (ts.isObjectLiteralExpression(value)) return staticSeedValue(value);
  return undefined;
}

function selfTableReference(item: ts.Diagnostic): boolean {
  if (!item.file || item.start === undefined) return false;
  const node = findNarrowestNode(item.file, item.start);
  const declaration = ancestor(node, ts.isVariableDeclaration);
  const call = declaration?.initializer && unwrapCall(declaration.initializer);
  return !!call && callLeaf(call) === "table" && ts.isIdentifier(declaration!.name) && node.getText() === declaration!.name.text;
}

function ancestorProperty(node: ts.Node, name: string): boolean {
  const property = ancestor(node, ts.isPropertyAssignment);
  return !!property && propertyName(property.name) === name;
}

function ancestor<T extends ts.Node>(node: ts.Node, guard: (value: ts.Node) => value is T): T | undefined {
  let current: ts.Node | undefined = node;
  while (current) {
    if (guard(current)) return current;
    current = current.parent;
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

function deduplicateDiagnostics(values: FrontendDiagnostic[]): FrontendDiagnostic[] {
  const seen = new Set<string>();
  return values.filter((item) => {
    const key = `${item.code}\0${item.site}\0${item.message}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  }).sort((left, right) => left.site.localeCompare(right.site) || left.code.localeCompare(right.code));
}

function moduleName(path: string): string {
  return path.split(sep).at(-1)!.replace(/\.ts$/, "");
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
