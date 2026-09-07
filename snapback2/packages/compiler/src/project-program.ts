import { basename, dirname, isAbsolute, relative, resolve, sep } from "node:path";
import ts from "typescript";
import { typeDiagnostic } from "./diagnostics";
import type { FrontendDiagnostic } from "./ir";
import { callLeaf } from "./lower/static";
import { findNarrowestNode, hasExport, unwrapCall } from "./syntax";
import { typeDiagnosticSite } from "./type-diagnostic-site";
import { recordTypeDiagnosticCause } from "./type-diagnostic-cause";

export function createProjectProgram(
  schemaPath: string,
  schemaSource: string,
  moduleSources: ReadonlyArray<readonly [string, string]>,
  libText: string,
  target = ts.ScriptTarget.ES2022,
): { program: ts.Program; checker: ts.TypeChecker } {
  const libPath = resolve(dirname(schemaPath), "__snapback2_lib.d.ts");
  const files = new Map<string, string>([[schemaPath, schemaSource], [libPath, libText], ...moduleSources]);
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
  host.resolveModuleNameLiterals = (literals, containingFile, _redirectedReference, compilerOptions) =>
    literals.map((literal) => {
      const name = literal.text;
      if (name === "snapback2" || name.startsWith("snapback2/")) return { resolvedModule: undefined };
      return ts.resolveModuleName(name, containingFile, compilerOptions, host);
    });
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

export function projectTypeDiagnostics(
  program: ts.Program,
  projectRoot: string,
  include: (node: ts.Node) => boolean = () => true,
  files?: ReadonlySet<string>,
): FrontendDiagnostic[] {
  const checker = program.getTypeChecker();
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
    if (!item.file || item.file.fileName.endsWith("__snapback2_lib.d.ts")) return [];
    if (item.file.fileName.includes(`${sep}node_modules${sep}`)) return [];
    if (!resolve(item.file.fileName).startsWith(`${resolve(projectRoot)}${sep}`)) return [];
    if (selfTableReference(item) || exportedStaticTableUsedBeforeAssigned(item, checker)) return [];
    const position = item.start === undefined ? { line: 0, character: 0 } : item.file.getLineAndCharacterOfPosition(item.start);
    const file = relativeSite(projectRoot, item.file.fileName);
    const message = ts.flattenDiagnosticMessageText(item.messageText, "\n");
    const node = item.start === undefined ? item.file : findNarrowestNode(item.file, item.start);
    if (!include(node)) return [];
    const siteKind = typeDiagnosticSite(node, file);
    return [recordTypeDiagnosticCause(typeDiagnostic(
      siteKind.code,
      siteKind.family,
      file,
      position.line + 1,
      position.character + 1,
      message,
      typeDiagnosticRewrite(item.file, node, message),
      siteKind.guide,
    ), item, node, checker)];
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
  return relative(root, isAbsolute(path) ? path : resolve(path)).split(sep).join("/");
}
