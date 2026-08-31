import ts from "typescript";
import type { Expr, Value } from "./ir";

export type SnapbackSymbol = "query" | "mutation" | "effect" | "channel" | "table" | "schema" | "seed" | "emit";

const snapbackSymbols = new Set<SnapbackSymbol>([
  "query", "mutation", "effect", "channel", "table", "schema", "seed", "emit",
]);

export function snapbackCallName(call: ts.CallExpression, sourceFile = call.getSourceFile()): SnapbackSymbol | undefined {
  const named = new Map<string, SnapbackSymbol>();
  const namespaces = new Set<string>();
  for (const statement of sourceFile.statements) {
    if (!ts.isImportDeclaration(statement) || !ts.isStringLiteral(statement.moduleSpecifier)
      || statement.moduleSpecifier.text !== "snapback2") continue;
    const bindings = statement.importClause?.namedBindings;
    if (bindings && ts.isNamedImports(bindings)) {
      for (const item of bindings.elements) {
        const imported = item.propertyName?.text ?? item.name.text;
        if (snapbackSymbols.has(imported as SnapbackSymbol)) named.set(item.name.text, imported as SnapbackSymbol);
      }
    } else if (bindings && ts.isNamespaceImport(bindings)) {
      namespaces.add(bindings.name.text);
    }
  }
  if (ts.isIdentifier(call.expression)) {
    return named.get(call.expression.text);
  }
  if (ts.isPropertyAccessExpression(call.expression) && ts.isIdentifier(call.expression.expression)
    && namespaces.has(call.expression.expression.text)
    && snapbackSymbols.has(call.expression.name.text as SnapbackSymbol)) {
    return call.expression.name.text as SnapbackSymbol;
  }
  return undefined;
}

export function findAncestor<T extends ts.Node>(node: ts.Node, predicate: (node: ts.Node) => node is T): T | undefined {
  let parent = node.parent;
  while (parent) {
    if (predicate(parent)) return parent;
    parent = parent.parent;
  }
  return undefined;
}

export function replaceNode(source: string, node: ts.Node, replacement: string): string {
  return source.slice(0, node.getStart()) + replacement + source.slice(node.getEnd());
}

export function applyEdits(source: string, edits: Array<{ start: number; end: number; text: string }>): string {
  return edits
    .sort((a, b) => b.start - a.start)
    .reduce((text, edit) => text.slice(0, edit.start) + edit.text + text.slice(edit.end), source);
}

export function containsIncrement(node: ts.Node): boolean {
  let found = false;
  walk(node, (child) => {
    if ((ts.isPostfixUnaryExpression(child) || ts.isPrefixUnaryExpression(child))
      && (child.operator === ts.SyntaxKind.PlusPlusToken || child.operator === ts.SyntaxKind.MinusMinusToken)) found = true;
  });
  return found;
}

export function containsCall(node: ts.Node, suffix: string): boolean {
  let found = false;
  walk(node, (child) => {
    if (ts.isCallExpression(child) && callName(child).endsWith(suffix)) found = true;
  });
  return found;
}

export function firstDescendantCall(node: ts.Node, suffix: string): ts.CallExpression | undefined {
  let found: ts.CallExpression | undefined;
  walk(node, (child) => {
    if (!found && ts.isCallExpression(child) && callName(child).endsWith(suffix)) found = child;
  });
  return found;
}

export function findNarrowestNode(sourceFile: ts.SourceFile, position: number): ts.Node {
  let best: ts.Node = sourceFile;
  const visit = (node: ts.Node) => {
    if (node.getFullStart() <= position && position < node.getEnd()) {
      best = node;
      ts.forEachChild(node, visit);
    }
  };
  visit(sourceFile);
  return best;
}

export function previousStatement(sourceFile: ts.SourceFile, node: ts.Statement): ts.Statement | undefined {
  const statements = statementSiblings(sourceFile, node);
  const index = statements?.indexOf(node) ?? -1;
  return index > 0 ? statements![index - 1] : undefined;
}

export function nextStatement(sourceFile: ts.SourceFile, node: ts.Statement): ts.Statement | undefined {
  const statements = statementSiblings(sourceFile, node);
  const index = statements?.indexOf(node) ?? -1;
  return index >= 0 ? statements![index + 1] : undefined;
}

function statementSiblings(sourceFile: ts.SourceFile, node: ts.Statement): readonly ts.Statement[] | undefined {
  if (node.parent === sourceFile) return sourceFile.statements;
  if (ts.isBlock(node.parent)) return node.parent.statements;
  return undefined;
}

export function walk(node: ts.Node, visit: (node: ts.Node) => void): void {
  visit(node);
  ts.forEachChild(node, (child) => walk(child, visit));
}

export function hasExport(node: ts.Node): boolean {
  return ts.canHaveModifiers(node)
    && !!ts.getModifiers(node)?.some((modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword);
}

export function hasAsyncModifier(node: ts.Node): boolean {
  return !!ts.canHaveModifiers(node) && !!ts.getModifiers(node)?.some((modifier) => modifier.kind === ts.SyntaxKind.AsyncKeyword);
}

export function isFunctionLike(node: ts.Node): node is ts.ArrowFunction | ts.FunctionExpression {
  return ts.isArrowFunction(node) || ts.isFunctionExpression(node);
}

export function isEffectFunction(node: ts.Node): boolean {
  let current: ts.Node | undefined = node.parent;
  while (current && !ts.isSourceFile(current)) {
    if (ts.isCallExpression(current) && snapbackCallName(current) === "effect") return true;
    if (ts.isVariableStatement(current)) return false;
    current = current.parent;
  }
  return false;
}

export function unwrapCall(node: ts.Expression): ts.CallExpression | undefined {
  const value = unwrapExpression(node);
  return ts.isCallExpression(value) ? value : undefined;
}

export function unwrapExpression(node: ts.Expression): ts.Expression {
  let value = node;
  while (ts.isParenthesizedExpression(value) || ts.isAsExpression(value) || ts.isNonNullExpression(value)) value = value.expression;
  return value;
}

export function staticMemberPath(node: ts.Expression): string | undefined {
  const value = unwrapExpression(node);
  if (ts.isIdentifier(value)) return value.text;
  if (!ts.isPropertyAccessExpression(value)) return undefined;
  const base = staticMemberPath(value.expression);
  return base ? `${base}.${value.name.text}` : undefined;
}

export function callName(call: ts.CallExpression): string {
  return call.expression.getText();
}

export function descriptorName(call: ts.CallExpression): string | undefined {
  if (ts.isIdentifier(call.expression)) return call.expression.text;
  return ts.isPropertyAccessExpression(call.expression) ? call.expression.name.text : undefined;
}

export function memberName(node: ts.LeftHandSideExpression): string | undefined {
  return ts.isPropertyAccessExpression(node) ? node.name.text : undefined;
}

export function collectionConstructor(node: ts.Expression): "Map" | "Set" | undefined {
  const value = unwrapExpression(node);
  if (!ts.isNewExpression(value) || !ts.isIdentifier(value.expression)) return undefined;
  return value.expression.text === "Map" || value.expression.text === "Set" ? value.expression.text : undefined;
}

type DbBinding = (name: string) => boolean;

export function isDb(node: ts.Expression, binding: DbBinding): boolean {
  return ts.isIdentifier(node) && binding(node.text);
}

export function isDbMember(node: ts.LeftHandSideExpression, binding: DbBinding): boolean {
  return ts.isPropertyAccessExpression(node) && isDb(node.expression, binding);
}

export function isDbWriteCall(node: ts.Expression, binding: DbBinding): node is ts.CallExpression {
  const call = unwrapCall(node);
  return !!call && ts.isPropertyAccessExpression(call.expression) && isDb(call.expression.expression, binding)
    && ["insert", "update", "upsert", "delete", "require", "assert"].includes(call.expression.name.text);
}

export function isDbInsertCall(node: ts.Expression, binding: DbBinding): boolean {
  const call = unwrapCall(node);
  return !!call && ts.isPropertyAccessExpression(call.expression) && isDb(call.expression.expression, binding)
    && call.expression.name.text === "insert";
}

export function isNullableDbGet(node: ts.Expression, binding: DbBinding): boolean {
  const call = unwrapCall(node);
  return !!call && ts.isPropertyAccessExpression(call.expression)
    && isDb(call.expression.expression, binding) && call.expression.name.text === "get";
}

export function nonNullIdentifier(node: ts.Expression): string | undefined {
  const value = unwrapExpression(node);
  if (!ts.isBinaryExpression(value) || ![
    ts.SyntaxKind.ExclamationEqualsToken,
    ts.SyntaxKind.ExclamationEqualsEqualsToken,
  ].includes(value.operatorToken.kind)) return undefined;
  if (ts.isIdentifier(value.left) && value.right.kind === ts.SyntaxKind.NullKeyword) return value.left.text;
  return ts.isIdentifier(value.right) && value.left.kind === ts.SyntaxKind.NullKeyword ? value.right.text : undefined;
}

export function temporary(holder: { temp: { value: number } } | { value: number }, label: string): string {
  const temp = "temp" in holder ? holder.temp : holder;
  const value = temp.value++;
  return `__${label}${value}`;
}

export function syntheticIdentifier(_sourceFile: ts.SourceFile, name: string): ts.Identifier {
  return ts.factory.createIdentifier(name);
}

export function propertyName(name: ts.PropertyName): string | undefined {
  return ts.isIdentifier(name) || ts.isStringLiteralLike(name) || ts.isNumericLiteral(name) ? name.text : undefined;
}

export function expressionProperty(object: ts.ObjectLiteralExpression, name: string): ts.Expression | undefined {
  const property = object.properties.find((item): item is ts.PropertyAssignment =>
    ts.isPropertyAssignment(item) && propertyName(item.name) === name);
  return property?.initializer;
}

export function numberProperty(object: ts.ObjectLiteralExpression, name: string): number | undefined {
  return numericLiteral(expressionProperty(object, name));
}

export function numericLiteral(node: ts.Expression | undefined): number | undefined {
  return node && ts.isNumericLiteral(unwrapExpression(node)) ? Number((unwrapExpression(node) as ts.NumericLiteral).text) : undefined;
}

export function expandedNumericLiteral(text: string): { whole: string; fraction: string } | undefined {
  const match = text.replaceAll("_", "").match(/^(?:(\d+)(?:\.(\d*))?|\.(\d+))(?:e([+-]?\d+))?$/i);
  if (!match) return undefined;
  const integer = match[1] ?? "0";
  const authoredFraction = match[2] ?? match[3] ?? "";
  const exponent = Number(match[4] ?? 0);
  const digits = `${integer}${authoredFraction}`;
  const point = integer.length + exponent;
  const whole = (point <= 0 ? "0" : point >= digits.length ? digits.padEnd(point, "0") : digits.slice(0, point))
    .replace(/^0+(?=\d)/, "");
  const fraction = (point <= 0 ? `${"0".repeat(-point)}${digits}` : point >= digits.length ? "" : digits.slice(point))
    .replace(/0+$/, "");
  return { whole: whole || "0", fraction };
}

export function stringLiteral(node: ts.Expression | undefined): string | undefined {
  const value = node && unwrapExpression(node);
  return value && ts.isStringLiteralLike(value) ? value.text : undefined;
}

export function stringArgument(node: ts.Expression | undefined): string | undefined {
  return stringLiteral(node);
}

export function isZero(node: ts.Expression | undefined): boolean {
  return numericLiteral(node) === 0;
}

export function literal(value: null | boolean | number | string): Expr {
  let encoded: Value;
  if (value === null) encoded = "Null";
  else if (typeof value === "boolean") encoded = { Bool: value };
  else if (typeof value === "number") encoded = { Int: value };
  else encoded = { String: value };
  return { Literal: encoded };
}

export function binaryOperator(kind: ts.SyntaxKind): string | undefined {
  return new Map<ts.SyntaxKind, string>([
    [ts.SyntaxKind.EqualsEqualsEqualsToken, "Eq"],
    [ts.SyntaxKind.EqualsEqualsToken, "Eq"],
    [ts.SyntaxKind.ExclamationEqualsEqualsToken, "Ne"],
    [ts.SyntaxKind.ExclamationEqualsToken, "Ne"],
    [ts.SyntaxKind.LessThanToken, "Lt"],
    [ts.SyntaxKind.LessThanEqualsToken, "Lte"],
    [ts.SyntaxKind.GreaterThanToken, "Gt"],
    [ts.SyntaxKind.GreaterThanEqualsToken, "Gte"],
    [ts.SyntaxKind.PlusToken, "Add"],
    [ts.SyntaxKind.MinusToken, "Sub"],
    [ts.SyntaxKind.AsteriskToken, "Mul"],
    [ts.SyntaxKind.AmpersandAmpersandToken, "And"],
    [ts.SyntaxKind.BarBarToken, "Or"],
  ]).get(kind);
}

export function singular(table: string): string {
  return table.endsWith("ies") ? `${table.slice(0, -3)}y` : table.endsWith("s") ? table.slice(0, -1) : table;
}

export function lowerFirst(value: string): string {
  return value ? value[0]!.toLowerCase() + value.slice(1) : value;
}

export function identifierFromArgsOrLocal(
  node: ts.Expression,
  isOperationArgs: (name: string) => boolean,
): string | undefined {
  const value = unwrapExpression(node);
  if (ts.isIdentifier(value)) return value.text;
  if (ts.isPropertyAccessExpression(value)) {
    const base = unwrapExpression(value.expression);
    if (ts.isIdentifier(base) && isOperationArgs(base.text)) return value.name.text;
  }
  return undefined;
}

export function expansionContext(parent: string, node: ts.Node, sourceFile: ts.SourceFile): string {
  return `${parent}/${node.getStart(sourceFile)}`;
}

export function contextualNodeKey(context: string, node: ts.Node, sourceFile: ts.SourceFile): string {
  return `${context}:${node.getStart(sourceFile)}`;
}
