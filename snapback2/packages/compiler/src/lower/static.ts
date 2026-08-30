import ts from "typescript";
import { expressionProperty, propertyName, snapbackCallName, unwrapCall, unwrapExpression } from "../syntax";

export function callLeaf(node: ts.Expression | undefined): string | undefined {
  if (!node) return undefined;
  const call = unwrapCall(node);
  if (!call) return undefined;
  const snapback = snapbackCallName(call);
  if (snapback) return snapback;
  const leaf = ts.isIdentifier(call.expression)
    ? call.expression.text
    : ts.isPropertyAccessExpression(call.expression) ? call.expression.name.text : undefined;
  return leaf && ["query", "mutation", "effect", "channel", "table", "schema", "seed", "emit"].includes(leaf)
    ? undefined
    : leaf;
}

export function callOf(node: ts.Expression | undefined, name: string): ts.CallExpression | undefined {
  const call = node && unwrapCall(node);
  return call && callLeaf(call) === name ? call : undefined;
}

export function objectOf(node: ts.Expression | undefined): ts.ObjectLiteralExpression | undefined {
  const value = node && unwrapExpression(node);
  return value && ts.isObjectLiteralExpression(value) ? value : undefined;
}

export function property(object: ts.ObjectLiteralExpression, name: string): ts.Expression | undefined {
  return expressionProperty(object, name);
}

export function propertyEntries(object: ts.ObjectLiteralExpression): Array<{ name: string; value: ts.Expression; node: ts.Node }> {
  const entries: Array<{ name: string; value: ts.Expression; node: ts.Node }> = [];
  for (const item of object.properties) {
    if (ts.isPropertyAssignment(item)) {
      const name = propertyName(item.name);
      if (name) entries.push({ name, value: item.initializer, node: item });
    } else if (ts.isShorthandPropertyAssignment(item)) {
      entries.push({ name: item.name.text, value: item.name, node: item });
    }
  }
  return entries;
}

export function stringValue(node: ts.Expression | undefined): string | undefined {
  const value = node && unwrapExpression(node);
  return value && ts.isStringLiteralLike(value) ? value.text : undefined;
}

export function numberValue(node: ts.Expression | undefined): number | undefined {
  const value = node && unwrapExpression(node);
  if (value && ts.isNumericLiteral(value)) return Number(value.text);
  if (value && ts.isPrefixUnaryExpression(value) && value.operator === ts.SyntaxKind.MinusToken
    && ts.isNumericLiteral(value.operand)) return -Number(value.operand.text);
  return undefined;
}

export function booleanValue(node: ts.Expression | undefined): boolean | undefined {
  const value = node && unwrapExpression(node);
  if (value?.kind === ts.SyntaxKind.TrueKeyword) return true;
  if (value?.kind === ts.SyntaxKind.FalseKeyword) return false;
  return undefined;
}

export function stringArray(node: ts.Expression | undefined): string[] | undefined {
  const value = node && unwrapExpression(node);
  if (!value || !ts.isArrayLiteralExpression(value)) return undefined;
  const result = value.elements.map((item) => stringValue(item));
  return result.every((item): item is string => item !== undefined) ? result : undefined;
}

export function staticJson(node: ts.Expression, constants: Map<string, unknown> = new Map()): unknown | undefined {
  const value = unwrapExpression(node);
  if (value.kind === ts.SyntaxKind.NullKeyword) return null;
  const bool = booleanValue(value);
  if (bool !== undefined) return bool;
  const number = numberValue(value);
  if (number !== undefined) return number;
  const string = stringValue(value);
  if (string !== undefined) return string;
  if (ts.isIdentifier(value)) return constants.get(value.text);
  if (ts.isArrayLiteralExpression(value)) {
    const output: unknown[] = [];
    for (const item of value.elements) {
      if (ts.isSpreadElement(item)) return undefined;
      const lowered = staticJson(item, constants);
      if (lowered === undefined) return undefined;
      output.push(lowered);
    }
    return output;
  }
  if (ts.isObjectLiteralExpression(value)) {
    const output: Record<string, unknown> = {};
    for (const item of value.properties) {
      if (ts.isSpreadAssignment(item)) {
        const spread = staticJson(item.expression, constants);
        if (!spread || typeof spread !== "object" || Array.isArray(spread)) return undefined;
        Object.assign(output, spread);
        continue;
      }
      const entry = ts.isPropertyAssignment(item)
        ? { name: propertyName(item.name), value: item.initializer }
        : ts.isShorthandPropertyAssignment(item) ? { name: item.name.text, value: item.name } : undefined;
      if (!entry?.name) return undefined;
      const lowered = staticJson(entry.value, constants);
      if (lowered === undefined) return undefined;
      output[entry.name] = lowered;
    }
    return output;
  }
  return undefined;
}

export function moduleJsonConstants(sourceFile: ts.SourceFile): Map<string, unknown> {
  const constants = new Map<string, unknown>();
  for (const statement of sourceFile.statements) {
    if (!ts.isVariableStatement(statement) || !(statement.declarationList.flags & ts.NodeFlags.Const)) continue;
    for (const declaration of statement.declarationList.declarations) {
      if (!ts.isIdentifier(declaration.name) || !declaration.initializer) continue;
      const value = staticJson(declaration.initializer, constants);
      if (value !== undefined) constants.set(declaration.name.text, value);
    }
  }
  return constants;
}
