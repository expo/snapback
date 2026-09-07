import { bindDescriptorProgram, nativeDescriptorName } from "./lower/descriptor-origin";
import { readFile } from "node:fs/promises";
import { basename, relative, resolve, sep } from "node:path";
import ts from "typescript";
import { expandArgumentObject } from "./args";
import { diagnostic, typeDiagnostic } from "./diagnostics";
import type { FrontendDiagnostic } from "./ir";
import { invalidDescriptorRefusal, lowerArgDescriptor } from "./lower/schema";
import { numberValue, objectOf, property, propertyEntries, stringValue } from "./lower/static";
import { createProjectProgram, loadCompilerLib } from "./project-program";
import { hasExport, snapbackCallName, unwrapCall } from "./syntax";

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
  if (modulePaths.length === 0) return diagnostics;
  const schemaPath = resolve(projectRoot, "snapback/schema.ts");
  const schemaSource = hasTypeScriptSchema ? await readFile(schemaPath, "utf8") : "";
  const sources = await Promise.all(modulePaths.sort().map(async path => [path, await readFile(path, "utf8")] as const));
  const checked = createProjectProgram(schemaPath, schemaSource, sources, loadCompilerLib());
  bindDescriptorProgram(checked.program, checked.library);
  for (const [path] of sources) {
    const fileName = relativeSite(projectRoot, path);
    const sourceFile = checked.program.getSourceFile(path)!;
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
  if (kind === "query" || kind === "mutation" || kind === "channel") {
    const config = objectOf(call.arguments[0]);
    const args = kind === "channel" ? objectOf(config && property(config, "args")) : config;
    if (!args) return "spell out the complete argument object before moving this declaration to Quarry";
    const expanded = expandArgumentObject(args);
    if (expanded.invalidSpread || expanded.invalidProperty)
      return "spell out every argument as name: descriptor before moving this declaration to Quarry";
    const entries = expanded.entries;
    for (const entry of entries) {
      const problem = quarryArgumentProblem(entry.value);
      if (problem) return `argument ${entry.name}: ${problem}`;
    }
    const fields: string[] = [];
    for (const entry of entries) {
      const type = quarryType(entry.value);
      if (!type) return `argument ${entry.name}: this descriptor has no proven Quarry spelling; preserve all constraints when writing its type`;
      fields.push(`${entry.name}: ${type}`);
    }
    return `${kind} ${name}(${fields.join(", ")}):`;
  }
  if (kind === "table") return `table ${name}:`;
  return "table items:\n  value: json <=1000\n  public";
}

function quarryArgumentProblem(node: ts.Expression, listElement = false): string | undefined {
  const call = unwrapCall(node);
  const kind = call && nativeDescriptorName(call);
  if (!call || !kind) return "descriptor origin is not a proven native constructor; spell out a native descriptor before moving this declaration to Quarry";
  if (kind === "text" && lowerArgDescriptor(node) === undefined) {
    return 'use a positive text bound, a minimum from zero through that bound, and format handle or format url; present null/undefined formats are invalid';
  }
  if (kind === "optional" && listElement) {
    return "Quarry list elements cannot be optional; separate optional values into named optional arguments before moving this declaration to Quarry";
  }
  if ((kind === "list" || kind === "optional") && call.arguments[0]) {
    const inner = quarryArgumentProblem(call.arguments[0], kind === "list");
    if (inner) return inner;
  }
  if (kind === "list") {
    const options = objectOf(call.arguments[1]);
    const entries = options && propertyEntries(options);
    if (entries && new Set(entries.map(entry => entry.name)).size !== entries.length)
      return "t.list options must declare max exactly once; preserve the intended bound before moving this declaration to Quarry";
  }
  // The complete wrapper, including arity and every option, must be admitted
  // before a usable signature is printed. Guidance never guesses a bound.
  if (lowerArgDescriptor(node) === undefined) return invalidDescriptorRefusal(node, "argument").message;
  return undefined;
}

function quarryType(node: ts.Expression): string | undefined {
  const call = unwrapCall(node);
  if (!call) return undefined;
  const kind = nativeDescriptorName(call);
  if (kind === "optional" && call.arguments[0]) {
    const inner = quarryType(call.arguments[0]);
    return inner === undefined ? undefined : inner.endsWith(" ?") ? inner : `${inner} ?`;
  }
  if (kind === "cursor" || kind === "id" || kind === "principal" || kind === "int" || kind === "time" || kind === "bool") return kind;
  if (kind === "text") {
    const options = objectOf(call.arguments[1]);
    const min = options && numberValue(property(options, "min"));
    const max = numberValue(call.arguments[0]);
    if (max === undefined) return undefined;
    const format = options && stringValue(property(options, "format"));
    return `${min ? `text ${min}..${max}` : `text <=${max}`}${format === "handle" || format === "url" ? ` format ${format}` : ""}`;
  }
  if (["json", "bytes", "image", "video"].includes(kind ?? "")) {
    const max = numberValue(call.arguments[0]);
    return max === undefined ? undefined : `${kind} <=${max}`;
  }
  if (kind === "decimal") {
    const scale = numberValue(call.arguments[0]);
    return scale === undefined ? undefined : `decimal ${scale}`;
  }
  if (kind === "money") {
    const currency = stringValue(call.arguments[0]);
    const scale = call.arguments[1] ? numberValue(call.arguments[1]) : 2;
    return currency === undefined || scale === undefined ? undefined : `money ${currency} ${scale}`;
  }
  // A TS table alias is not necessarily a Quarry catalog name. Do not guess
  // one from its spelling or silently demote its nominal reference to id.
  if (kind === "ref") return undefined;
  if (kind === "list" && call.arguments[0]) {
    const options = objectOf(call.arguments[1]);
    const max = options && numberValue(property(options, "max"));
    const inner = quarryType(call.arguments[0]);
    return inner === undefined || max === undefined ? undefined : `[${inner}] <=${max}`;
  }
  if (kind === "enum") {
    const values = call.arguments[0] && ts.isArrayLiteralExpression(call.arguments[0])
      ? call.arguments[0].elements.map((item) => stringValue(item as ts.Expression)).filter((item): item is string => item !== undefined)
      : [];
    return `enum(${values.map((item) => JSON.stringify(item)).join(", ")})`;
  }
  return undefined;
}

function relativeSite(root: string, path: string): string {
  return relative(root, resolve(path)).split(sep).join("/");
}
