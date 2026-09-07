import { readFile } from "node:fs/promises";
import { basename, relative, resolve, sep } from "node:path";
import ts from "typescript";
import { diagnostic, typeDiagnostic } from "./diagnostics";
import type { FrontendDiagnostic } from "./ir";
import { hasExport, snapbackCallName, unwrapCall } from "./syntax";

export type LowerProjectOptions = { adhocSource?: string };

const authoredDeclarations = new Set(["query", "mutation", "table", "channel", "schema"]);

// @ref LLP 1007#4b-does-the-typescript-authoring-surface-stay — product compilation admits Quarry declarations and TypeScript effects only.
export async function quarryOnlyDiagnostics(
  projectRoot: string,
  hasTypeScriptSchema: boolean,
  modulePaths: string[],
): Promise<FrontendDiagnostic[]> {
  const diagnostics: FrontendDiagnostic[] = [];
  if (hasTypeScriptSchema) diagnostics.push(typeDiagnostic(
    "E_QUARRY_ONLY", "quarry", "snapback/schema.ts", 1, 1,
    "backends are authored in Quarry; the schema is snapback/schema.q",
    "-- replace snapback/schema.ts with explicit Quarry table declarations",
    "quarry/projects",
  ));
  for (const path of modulePaths.sort()) {
    const source = await readFile(path, "utf8");
    const fileName = relativeSite(projectRoot, path);
    const sourceFile = ts.createSourceFile(path, source, ts.ScriptTarget.ES2022, true);
    const module = { fileName, sourceFile };
    const locals = new Map<string, { kind: string }>();
    for (const statement of sourceFile.statements) {
      if (!ts.isVariableStatement(statement)) continue;
      for (const declaration of statement.declarationList.declarations) {
        if (!ts.isIdentifier(declaration.name) || !declaration.initializer) continue;
        const call = unwrapCall(declaration.initializer);
        const kind = call && snapbackCallName(call, sourceFile);
        if (!kind || !authoredDeclarations.has(kind)) continue;
        locals.set(declaration.name.text, { kind });
        if (hasExport(statement)) pushAuthored(diagnostics, module, fileName, declaration.name,
          declaration.name.text, kind);
      }
    }
    for (const statement of sourceFile.statements) {
      if (ts.isExportDeclaration(statement) && !statement.moduleSpecifier && statement.exportClause
        && ts.isNamedExports(statement.exportClause)) {
        for (const specifier of statement.exportClause.elements) {
          const local = locals.get(specifier.propertyName?.text ?? specifier.name.text);
          if (local) pushAuthored(diagnostics, module, fileName, specifier.name, specifier.name.text, local.kind);
        }
      } else if (ts.isExportAssignment(statement) && !statement.isExportEquals) {
        const call = unwrapCall(statement.expression);
        const directKind = call && snapbackCallName(call, sourceFile);
        const local = ts.isIdentifier(statement.expression) ? locals.get(statement.expression.text) : undefined;
        const authored = directKind && authoredDeclarations.has(directKind) ? { kind: directKind } : local;
        const name = local && ts.isIdentifier(statement.expression) ? statement.expression.text : "operation";
        if (authored) pushAuthored(diagnostics, module, fileName, statement, name, authored.kind);
      }
    }
  }
  return diagnostics;
}

function pushAuthored(
  diagnostics: FrontendDiagnostic[],
  module: { fileName: string; sourceFile: ts.SourceFile },
  fileName: string,
  site: ts.Node,
  name: string,
  kind: string,
): void {
  diagnostics.push(diagnostic(module, "E_QUARRY_ONLY", site,
    `queries, mutations, tables, and channels are authored in Quarry; TypeScript module ${basename(fileName)} may export effects only`,
    `-- move ${kind} ${name} to snapback/${basename(fileName, ".ts")}.q and preserve every argument type and bound`));
}

function relativeSite(root: string, path: string): string {
  return relative(root, resolve(path)).split(sep).join("/");
}
