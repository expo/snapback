import { existsSync } from "node:fs";
import { lstat, mkdir, mkdtemp, readdir, readFile, realpath, rename, rm, writeFile } from "node:fs/promises";
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import ts from "typescript";
import { boundedDiagnostics, diagnostic, typeDiagnostic } from "./diagnostics";
import { type FrontendDiagnostic, type ProjectResult } from "./ir";
import { callLeaf, moduleJsonConstants, objectOf, property, staticJson } from "./lower/static";
import { unwrapCall, walk } from "./syntax";
import { frontendQuarryDiagnostic, prepareQuarry, type QuarryInput } from "./quarry/index";
import { moduleSeedJsonConstants, staticSeedJson, validateSeedRow } from "./project-seed";
import { quarryOnlyDiagnostics, type LowerProjectOptions } from "./project-authoring";
import { lowerDirectQuarryProject } from "./quarry/project";
import { bindQuarrySchema } from "./quarry/bound-schema";
import { QuarryError } from "./quarry/diagnostics";
// @ref LLP 1002#3-the-compiler-worker-and-the-project-json — one lowering pass owns the ProjectJson, sources, API types, and aggregate refusals.

export async function lowerProject(root: string, options: LowerProjectOptions = {}): Promise<ProjectResult> {
  const started = performance.now();
  const projectRoot = resolve(root);
  const authoredRoot = join(projectRoot, "snapback");
  const hasTsSchema = existsSync(join(authoredRoot, "schema.ts"));
  const hasQuarrySchema = existsSync(join(authoredRoot, "schema.q"));
  if (!hasTsSchema && !hasQuarrySchema) return {
    ok: false,
    diagnostics: [typeDiagnostic("E_SCHEMA_DEFAULT_EXPORT", "schema", "snapback/schema.q", 1, 1,
      "missing snapback/schema.q", "create snapback/schema.q with table declarations", "schema/project")],
    ms: elapsed(started),
  };
  const discoveredModulePaths = await discoverModulePaths(authoredRoot);
  const tsModulePaths = discoveredModulePaths.filter((path) => path.endsWith(".ts")).sort();
  const authored = await quarryOnlyDiagnostics(projectRoot, hasTsSchema, tsModulePaths);
  if (authored.length > 0) return { ok: false, diagnostics: authored, ms: elapsed(started) };
  const quarryPaths = discoveredModulePaths.filter((path) => path.endsWith(".q")).sort();
  return lowerDirectQuarryProject({
    started, projectRoot, authoredRoot, discoveredModulePaths, quarryPaths, tsModulePaths,
    ...(options.adhocSource === undefined ? {} : { adhocSource: options.adhocSource }),
  });
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
  const seedConstants = moduleSeedJsonConstants(sourceFile);
  const value = object && staticSeedJson(object, seedConstants);
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

  const authoredRoot = join(projectRoot, "snapback");
  const paths = (await discoverModulePaths(authoredRoot)).filter((item) => item.endsWith(".q"));
  const inputs: QuarryInput[] = await Promise.all(paths.map(async (item) => ({
    path: item,
    fileName: relativeSite(projectRoot, item),
    source: await readFile(item, "utf8"),
  })));
  const prepared = prepareQuarry(inputs);
  if (!prepared.ok) return { ok: false, diagnostics: prepared.diagnostics };
  let tables: Record<string, { columns?: Record<string, unknown> }>;
  try {
    tables = bindQuarrySchema(prepared.prepared.documents, prepared.prepared.catalog).tables as
      Record<string, { columns?: Record<string, unknown> }>;
  } catch (error) {
    if (!(error instanceof QuarryError)) throw error;
    return { ok: false, diagnostics: [frontendQuarryDiagnostic(error.diagnostic)] };
  }
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

function firstInvalidStaticSpread(node: ts.Node, constants: Map<string, unknown>): ts.SpreadAssignment | undefined {
  let invalid: ts.SpreadAssignment | undefined;
  walk(node, (item) => {
    if (invalid || !ts.isSpreadAssignment(item)) return;
    const value = staticJson(item.expression, constants);
    if (!value || typeof value !== "object" || Array.isArray(value)) invalid = item;
  });
  return invalid;
}



function relativeSite(root: string, path: string): string {
  return relative(root, isAbsolute(path) ? path : resolve(path)).split(sep).join("/");
}


function elapsed(started: number): number {
  return Math.round((performance.now() - started) * 100) / 100;
}
