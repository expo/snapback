import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { basename, dirname, resolve, sep } from "node:path";
import ts from "typescript";
import { typeDiagnostic } from "./diagnostics";
import type { FrontendDiagnostic } from "./ir";
import { callLeaf } from "./lower/static";
import { findNarrowestNode, hasExport, unwrapCall } from "./syntax";
import { typeDiagnosticSite } from "./type-diagnostic-site";
import { sourceFiles, sourcePath } from "./source-path";

const projectSources = new WeakMap<ts.Program, { library: ts.SourceFile; canonical: (name: string) => string }>();

export function createProjectProgram(
  schemaPath: string,
  schemaSource: string,
  moduleSources: ReadonlyArray<readonly [string, string]>,
  libText: string,
  target = ts.ScriptTarget.ES2022,
): { program: ts.Program; checker: ts.TypeChecker; library: ts.SourceFile } {
  const options: ts.CompilerOptions = {
    module: ts.ModuleKind.ESNext,
    moduleResolution: ts.ModuleResolutionKind.Bundler,
    noEmit: true,
    noLib: true,
    strict: true,
    target,
    skipLibCheck: true,
    types: [],
  };
  const host = ts.createCompilerHost(options, true);
  const normalized = (name: string) => resolve(host.getCurrentDirectory(), sourcePath(name));
  const canonical = (name: string) => host.getCanonicalFileName(normalized(name));
  const authored = [[schemaPath, schemaSource], ...moduleSources] as const;
  const files = sourceFiles(authored, canonical);
  // Case folding owns lookup, not the displayed/source filename. Keep the
  // authored path's casing in SourceFiles and diagnostic sites.
  const roots = new Map<string, string>();
  for (const [name] of authored) if (!roots.has(canonical(name))) roots.set(canonical(name), normalized(name));
  let libPath = normalized(resolve(dirname(sourcePath(schemaPath)), "__snapback2_lib.d.ts"));
  // Authored files cannot replace the declaration source that grants native
  // authority, including equivalent paths into the same virtual slot.
  while (files.has(canonical(libPath))) libPath = normalized(resolve(dirname(libPath), `_${basename(libPath)}`));
  files.set(canonical(libPath), libText);
  const directories = new Set<string>();
  for (const path of files.keys()) {
    for (let dir = dirname(path); !directories.has(dir); dir = dirname(dir)) directories.add(dir);
  }
  const directoryExists = host.directoryExists?.bind(host);
  host.directoryExists = (name) => directories.has(canonical(name)) || !!directoryExists?.(name);
  host.resolveModuleNameLiterals = (literals, containingFile, _redirectedReference, compilerOptions) =>
    literals.map((literal) => {
      const name = literal.text;
      if (name === "snapback2" || name.startsWith("snapback2/")) return { resolvedModule: undefined };
      return ts.resolveModuleName(name, containingFile, compilerOptions, host);
    });
  const sourceFile = host.getSourceFile.bind(host);
  const read = host.readFile.bind(host);
  const exists = host.fileExists.bind(host);
  host.fileExists = (name) => files.has(canonical(name)) || exists(name);
  host.readFile = (name) => files.get(canonical(name)) ?? read(name);
  host.getSourceFile = (name, languageVersion, onError, shouldCreateNewSourceFile) => {
    const text = files.get(canonical(name));
    return text === undefined
      ? sourceFile(name, languageVersion, onError, shouldCreateNewSourceFile)
      : ts.createSourceFile(name, text, languageVersion, true);
  };
  const program = ts.createProgram([...roots.values(), libPath], options, host);
  const library = program.getSourceFile(libPath)!;
  projectSources.set(program, { library, canonical });
  return { program, checker: program.getTypeChecker(), library };
}

export function projectTypeDiagnostics(
  program: ts.Program,
  projectRoot: string,
  include: (node: ts.Node) => boolean = () => true,
  files?: ReadonlySet<string>,
): FrontendDiagnostic[] {
  const checker = program.getTypeChecker();
  const context = projectSources.get(program);
  const canonical = context?.canonical ?? ((name: string) => resolve(sourcePath(name)));
  // Imported Quarry declarations supply effect/then types, but their bodies
  // have already been checked against the subset. Do not check them twice.
  // Per-file checking omits program-wide diagnostics; the no-file filter below drops them either way.
  const diagnostics = files
    ? [...files].flatMap((path) => {
      const file = program.getSourceFile(path);
      return file ? [...program.getSyntacticDiagnostics(file), ...program.getSemanticDiagnostics(file)] : [];
    })
    : ts.getPreEmitDiagnostics(program);
  return diagnostics.flatMap((item) => {
    if (!item.file || item.file === context?.library) return [];
    if (item.file.fileName.includes(`${sep}node_modules${sep}`)) return [];
    if (!canonical(item.file.fileName).startsWith(`${canonical(projectRoot)}${sep}`)) return [];
    if (selfTableReference(item) || exportedStaticTableUsedBeforeAssigned(item, checker)) return [];
    const position = item.start === undefined ? { line: 0, character: 0 } : item.file.getLineAndCharacterOfPosition(item.start);
    const file = relativeSite(projectRoot, item.file.fileName);
    const message = ts.flattenDiagnosticMessageText(item.messageText, "\n");
    const node = item.start === undefined ? item.file : findNarrowestNode(item.file, item.start);
    if (!include(node)) return [];
    const siteKind = typeDiagnosticSite(node, file);
    return [typeDiagnostic(
      siteKind.code,
      siteKind.family,
      file,
      position.line + 1,
      position.character + 1,
      message,
      typeDiagnosticRewrite(item.file, node, message),
      siteKind.guide,
    )];
  });
}

function selfTableReference(item: ts.Diagnostic): boolean {
  if (!item.file || item.start === undefined) return false;
  const node = findNarrowestNode(item.file, item.start);
  const declaration = ancestor(node, ts.isVariableDeclaration);
  const call = declaration?.initializer && unwrapCall(declaration.initializer);
  return !!call && callLeaf(call) === "table" && ts.isIdentifier(declaration!.name) && node.getText() === declaration!.name.text;
}

function exportedStaticTableUsedBeforeAssigned(item: ts.Diagnostic, checker: ts.TypeChecker): boolean {
  if (item.code !== 2454 || !item.file || item.start === undefined) return false;
  if (basename(item.file.fileName) !== "schema.ts" || basename(dirname(item.file.fileName)) !== "snapback") return false;
  const node = findNarrowestNode(item.file, item.start);
  if (!ts.isIdentifier(node)) return false;
  const declaration = checker.getSymbolAtLocation(node)?.valueDeclaration;
  if (!declaration || !ts.isVariableDeclaration(declaration) || declaration.getSourceFile() !== item.file) return false;
  const statement = ancestor(declaration, ts.isVariableStatement);
  const call = declaration.initializer && unwrapCall(declaration.initializer);
  return !!statement && hasExport(statement) && !!call && callLeaf(call) === "table";
}

function ancestor<T extends ts.Node>(node: ts.Node, guard: (value: ts.Node) => value is T): T | undefined {
  let current: ts.Node | undefined = node;
  while (current) {
    if (guard(current)) return current;
    current = current.parent;
  }
  return undefined;
}

function typeDiagnosticRewrite(sourceFile: ts.SourceFile, node: ts.Node, message: string): string {
  const statement = ancestor(node, ts.isStatement);
  if (statement) return `${statement.getText(sourceFile)}\n// Fix the TypeScript error above: ${message.split("\n")[0]}`;
  const position = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile));
  const lineStarts = sourceFile.getLineStarts();
  const start = lineStarts[position.line] ?? 0;
  const next = lineStarts[position.line + 1] ?? sourceFile.text.length;
  return `${sourceFile.text.slice(start, next).trimEnd()}\n// Fix the TypeScript error above: ${message.split("\n")[0]}`;
}

function relativeSite(root: string, path: string): string {
  // Called only after canonical containment succeeds; preserve authored casing
  // even when the host resolves a differently cased spelling of the root.
  return sourcePath(resolve(path)).split("/").slice(sourcePath(resolve(root)).split("/").length).join("/");
}

export function loadCompilerLib(effects = false): string {
  const moduleCandidates = [
    fileURLToPath(new URL("../lib.d.ts", import.meta.url)),
    fileURLToPath(new URL("./authoring-lib.d.ts", import.meta.url)),
    fileURLToPath(new URL("./index.d.ts", import.meta.url)),
  ];
  const subsetCandidates = effects ? [
    // Effect checking requires running node build.mjs in packages/snapback2 first: the complete
    // ES2020 library is built only in dist/, including this bundled-compiler fallback.
    fileURLToPath(new URL("../../snapback2/dist/effects-lib.d.ts", import.meta.url)),
    fileURLToPath(new URL("./effects-lib.d.ts", import.meta.url)),
  ] : [
    fileURLToPath(new URL("../subset-lib.d.ts", import.meta.url)),
    fileURLToPath(new URL("./compiler-lib.d.ts", import.meta.url)),
  ];
  const modulePath = moduleCandidates.find(existsSync);
  const subsetPath = subsetCandidates.find(existsSync);
  if (!modulePath || !subsetPath) throw new Error("snapback2 compiler: checker declarations are missing beside the compiler bundle");
  const declarations = readFileSync(modulePath, "utf8");
  const globals = readFileSync(subsetPath, "utf8");
  return effects ? `${declarations}\n${globals}` : `${globals}\n${declarations}`;
}
