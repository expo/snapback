import ts from "typescript";
import type { TableInfo } from "../authored-types";
import type { FunctionLike, LowerSourceOptions } from "../compiler";
import type { Expr } from "../ir";
import { snapbackCallName, stringArgument, unwrapCall } from "../syntax";

export type ModuleInfo = {
  sourceSites?: Record<string, import("../ir").SourceSite>;
  sourceFile: ts.SourceFile;
  source: string;
  fileName: string;
  tables: Map<string, TableInfo>;
  effects: Map<string, string>;
  helpers: Map<string, FunctionLike>;
  loweredScanPrefixes: Map<ts.CallExpression, Expr[][]>;
};

export function inspectModule(
  sourceFile: ts.SourceFile,
  source: string,
  fileName: string,
  options: LowerSourceOptions,
): ModuleInfo {
  const tables = new Map(options.tables ?? []);
  const effects = new Map(options.effects ?? []);
  const helpers = new Map<string, FunctionLike>();
  for (const statement of sourceFile.statements) {
    if (ts.isFunctionDeclaration(statement) && statement.name) {
      helpers.set(statement.name.text, statement);
      continue;
    }
    if (!ts.isVariableStatement(statement)) continue;
    for (const declaration of statement.declarationList.declarations) {
      if (!ts.isIdentifier(declaration.name) || !declaration.initializer) continue;
      const name = declaration.name.text;
      const call = unwrapCall(declaration.initializer);
      const imported = call && snapbackCallName(call, sourceFile);
      const localHelper = call && ts.isIdentifier(call.expression) && ["privateTable", "maintained"].includes(call.expression.text)
        ? call.expression.text
        : undefined;
      const callee = imported ?? localHelper;
      if (!call || !callee) {
        if (ts.isArrowFunction(declaration.initializer) || ts.isFunctionExpression(declaration.initializer)) {
          helpers.set(name, declaration.initializer);
        }
        continue;
      }
      if (callee === "table" || callee === "privateTable" || callee === "maintained") {
        const tableName = stringArgument(call.arguments[0]) ?? name;
        const maintainedFrom = callee === "maintained" && ts.isIdentifier(call.arguments[1])
          ? call.arguments[1].text
          : undefined;
        tables.set(name, { name: tableName, private: callee === "privateTable", maintainedFrom });
      } else if (callee === "effect") {
        if (!effects.has(name)) effects.set(name, name);
      } else if (ts.isArrowFunction(declaration.initializer) || ts.isFunctionExpression(declaration.initializer)) {
        helpers.set(name, declaration.initializer);
      }
    }
  }
  return { sourceFile, source, fileName, tables, effects, helpers, sourceSites: options.sourceSites, loweredScanPrefixes: new Map() };
}
