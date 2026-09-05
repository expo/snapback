import { readFile } from "node:fs/promises";
import { basename, relative, resolve, sep } from "node:path";
import ts from "typescript";
import { expandArgumentObject } from "./args";
import { diagnostic, typeDiagnostic } from "./diagnostics";
import type { FrontendDiagnostic } from "./ir";
import { numberValue, objectOf, property, stringValue } from "./lower/static";
import { hasExport, snapbackCallName, staticMemberPath, unwrapCall } from "./syntax";

export type LowerProjectOptions = { authoring?: "quarry" | "any"; adhocSource?: string };

const authoredDeclarations = new Set(["query", "mutation", "table", "channel", "schema"]);

// @ref LLP 1007#4b-does-the-typescript-authoring-surface-stay — product compilation admits Quarry declarations and TypeScript effects only.
export async function quarryOnlyDiagnostics(
  projectRoot: string,
  hasTypeScriptSchema: boolean,
  modulePaths: string[],
): Promise<FrontendDiagnostic[]> {
  const diagnostics: FrontendDiagnostic[] = [];
  if (hasTypeScriptSchema) {
    diagnostics.push(typeDiagnostic(
      "E_QUARRY_ONLY",
      "quarry",
      "snapback/schema.ts",
      1,
      1,
      "backends are authored in Quarry; the schema is snapback/schema.q",
      "table items:\n  value: json <=1000\n  public",
      "quarry/projects",
    ));
  }
  for (const path of modulePaths.sort()) {
    const source = await readFile(path, "utf8");
    const fileName = relativeSite(projectRoot, path);
    const sourceFile = ts.createSourceFile(path, source, ts.ScriptTarget.ES2022, true);
    const module = { fileName, sourceFile };
    const locals = new Map<string, { kind: string; call: ts.CallExpression }>();
    for (const statement of sourceFile.statements) {
      if (ts.isVariableStatement(statement)) {
        for (const declaration of statement.declarationList.declarations) {
          if (!ts.isIdentifier(declaration.name) || !declaration.initializer) continue;
          const call = unwrapCall(declaration.initializer);
          const kind = call && snapbackCallName(call, sourceFile);
          if (!call || !kind || !authoredDeclarations.has(kind)) continue;
          locals.set(declaration.name.text, { kind, call });
          if (hasExport(statement)) pushAuthored(diagnostics, module, fileName, declaration.name, declaration.name.text, kind, call);
        }
      }
    }
    for (const statement of sourceFile.statements) {
      if (ts.isExportDeclaration(statement) && !statement.moduleSpecifier && statement.exportClause
        && ts.isNamedExports(statement.exportClause)) {
        for (const specifier of statement.exportClause.elements) {
          const local = locals.get(specifier.propertyName?.text ?? specifier.name.text);
          if (local) pushAuthored(diagnostics, module, fileName, specifier.name, specifier.name.text, local.kind, local.call);
        }
      } else if (ts.isExportAssignment(statement) && !statement.isExportEquals) {
        const call = unwrapCall(statement.expression);
        const directKind = call && snapbackCallName(call, sourceFile);
        const local = ts.isIdentifier(statement.expression) ? locals.get(statement.expression.text) : undefined;
        const authored = call && directKind && authoredDeclarations.has(directKind)
          ? { kind: directKind, call }
          : local;
        const name = local && ts.isIdentifier(statement.expression) ? statement.expression.text : "operation";
        if (authored) pushAuthored(diagnostics, module, fileName, statement, name, authored.kind, authored.call);
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
  call: ts.CallExpression,
): void {
  diagnostics.push(diagnostic(module, "E_QUARRY_ONLY", site, authoringMessage(fileName), quarryHeader(kind, name, call)));
}

function authoringMessage(fileName: string): string {
  const stem = basename(fileName, ".ts");
  return `queries and mutations are authored in Quarry (snapback/${stem}.q); TypeScript modules may export effects only`;
}

function quarryHeader(kind: string, name: string, call: ts.CallExpression): string {
  if (kind === "query" || kind === "mutation") {
    const args = objectOf(call.arguments[0]);
    const fields = args ? expandArgumentObject(args).entries.map((entry) => `${entry.name}: ${quarryType(entry.value)}`) : [];
    return `${kind} ${name}(${fields.join(", ")}):`;
  }
  if (kind === "table") return `table ${name}:`;
  if (kind === "channel") return `channel ${name}():`;
  return "table items:\n  value: json <=1000\n  public";
}

function quarryType(node: ts.Expression): string {
  const call = unwrapCall(node);
  if (!call) return "json <=1000";
  const kind = snapbackCallName(call) ?? staticMemberPath(call.expression)?.split(".").at(-1);
  if (kind === "optional" && call.arguments[0]) return `${quarryType(call.arguments[0])} ?`;
  if (kind === "id" || kind === "principal" || kind === "int" || kind === "time" || kind === "bool") return kind;
  if (["text", "json", "bytes", "image", "video"].includes(kind ?? "")) {
    return `${kind} <=${numberValue(call.arguments[0]) ?? 1000}`;
  }
  if (kind === "ref") return staticMemberPath(call.arguments[0]) ?? "id";
  if (kind === "list" && call.arguments[0]) {
    const options = objectOf(call.arguments[1]);
    const max = options && numberValue(property(options, "max"));
    return `[${quarryType(call.arguments[0])}] <=${max ?? 100}`;
  }
  if (kind === "enum") {
    const values = call.arguments[0] && ts.isArrayLiteralExpression(call.arguments[0])
      ? call.arguments[0].elements.map((item) => stringValue(item as ts.Expression)).filter((item): item is string => item !== undefined)
      : [];
    return `enum(${values.map((item) => JSON.stringify(item)).join(", ")})`;
  }
  return "json <=1000";
}

function relativeSite(root: string, path: string): string {
  return relative(root, resolve(path)).split(sep).join("/");
}
