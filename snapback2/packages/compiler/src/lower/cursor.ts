import ts from "typescript";
import { authoredTypeFromColumn, requiredType, isIdType, type AuthoredType } from "../authored-types";
import { diagnostic } from "../diagnostics";
import { callName, contextualNodeKey, propertyName, replaceNode, unwrapExpression } from "../syntax";
import type { Environment, VariableInfo } from "./environment";
import { expandHelper } from "./helper-expansion";

export function checkScanPrefix(
  node: ts.Expression,
  env: Environment,
  table: string,
  index: string,
  prefixLength: number,
): boolean {
  const tableInfo = [...env.tables.values()].find((candidate) => candidate.name === table);
  const indexInfo = tableInfo?.indexes?.[index];
  if (!indexInfo || prefixLength <= indexInfo.columns.length) return true;
  env.diagnostics.push(diagnostic(
    env,
    "E_ARGS_TYPE",
    node,
    `scan ${env.siteBase}.${env.accessOrdinal.value} prefix supplies ${prefixLength} components but ${table}.${index} has ${indexInfo.columns.length} columns`,
    overlongPrefixRewrite(node, env, indexInfo.columns.length),
  ));
  return false;
}

export function checkTupleCursor(
  node: ts.Expression | undefined,
  env: Environment,
  table: string,
  index: string,
  prefixLength: number,
): void {
  if (!node) return;
  const value = unwrapExpression(node);
  const tableInfo = [...env.tables.values()].find((candidate) => candidate.name === table);
  const indexInfo = tableInfo?.indexes?.[index];
  if (!indexInfo) return;
  const remainingColumns = indexInfo.columns.slice(prefixLength);
  const expectedTypes = indexInfo.types.slice(prefixLength);
  if (remainingColumns.length === 0) {
    env.diagnostics.push(diagnostic(
      env,
      "E_ARGS_CURSOR_SHAPE",
      value,
      `scan ${table}.${index} prefix names every index column, so a cursor has no position to compare; remove after/before or shorten the prefix`,
      removeCursorProperties(node, env),
    ));
    return;
  }
  // @ref LLP 1001#3-read-and-write-states-no-silent-states — a cursored index must be a total order (ends in `id`, or is
  // unique); otherwise tied keys are skipped between pages. The runtime accepts the
  // lossy shape, so this is a policy refusal like an unbounded scan, not a type check.
  if (indexInfo.columns.at(-1) !== "id" && indexInfo.unique !== true) {
    const totalOrderColumns = [...indexInfo.columns.filter((column) => column !== "id"), "id"];
    env.diagnostics.push(diagnostic(
      env,
      "E_ARGS_CURSOR_INDEX",
      value,
      `scan ${table}.${index} uses a cursor, so the index must be a total order: end in id, or be unique`,
      `change ${table}.${index} to { columns: [${totalOrderColumns.map((column) => JSON.stringify(column)).join(", ")}] }`,
    ));
    return;
  }

  const expanded = expandHelper(value, env);
  const shapeValue = unwrapExpression(expanded?.expression ?? value);
  const shapeEnv = expanded?.environment ?? env;
  const authored = expressionType(shapeValue, shapeEnv);
  const elements = ts.isArrayLiteralExpression(shapeValue) ? [...shapeValue.elements] : undefined;
  const knownNonScalar = staticallyObjectExpression(shapeValue, shapeEnv) || knownRuntimeScalar(authored) === false;
  if (remainingColumns.length === 1 && !elements && knownNonScalar) {
    env.diagnostics.push(diagnostic(
      env,
      "E_ARGS_CURSOR_SHAPE",
      value,
      `scan ${table}.${index} cursor must be an indexable scalar for its one remaining index column`,
      argumentTupleRewrite(node, env, remainingColumns, expectedTypes),
    ));
    return;
  }
  const shapeMatches = elements
    ? elements.length === remainingColumns.length
    : knownRuntimeScalar(authored) === true
      ? remainingColumns.length === 1
      : knownRuntimeScalar(authored) === false
        ? remainingColumns.length === 1 ? undefined : false
        : undefined;
  const tuple = tupleExpression(node, env, table, remainingColumns);
  const tupleRewrite = tuple ? replaceNode(env.source, node, tuple) : env.source;
  const rewrite = tuple && tupleRewrite !== env.source
    ? tupleRewrite
    : argumentTupleRewrite(node, env, remainingColumns, expectedTypes);
  if (shapeMatches === false) {
    env.diagnostics.push(diagnostic(
      env,
      "E_ARGS_CURSOR_SHAPE",
      value,
      `scan ${table}.${index} cursor has the wrong static shape: expected exactly ${remainingColumns.length} cursor value(s), one per remaining index column`,
      rewrite,
    ));
    return;
  }

  const components = elements ?? (remainingColumns.length === 1 ? [shapeValue] : undefined);
  if (!components || components.length !== remainingColumns.length) return;
  const bound = node.parent && ts.isPropertyAssignment(node.parent)
    ? propertyName(node.parent.name) ?? "after"
    : "after";
  components.forEach((component, offset) => {
    const actual = expressionType(component, shapeEnv);
    const expected = expectedTypes[offset];
    if (cursorTypeMatches(actual, expected) !== false) return;
    env.diagnostics.push(diagnostic(
      env,
      "E_ARGS_TYPE",
      component,
      `scan ${env.siteBase}.${env.accessOrdinal.value} ${bound} cursor component ${offset + 1} is ${cursorTypeName(actual)} but ${table}.${index} column ${remainingColumns[offset]} is ${cursorTypeName(expected)}`,
      rewrite,
    ));
  });
}

function staticallyObjectExpression(
  node: ts.Expression,
  env: Environment,
  seen = new Set<ts.Expression>(),
): boolean {
  const value = unwrapExpression(node);
  if (seen.has(value)) return false;
  seen.add(value);
  if (ts.isObjectLiteralExpression(value)) return true;
  if (!ts.isIdentifier(value)) return false;
  const substitution = env.substitutions.get(value.text);
  if (substitution) return staticallyObjectExpression(substitution.expression, substitution.environment, seen);
  const origin = env.variables.get(value.text)?.immutableOrigin;
  return origin ? staticallyObjectExpression(origin.expression, origin.environment, seen) : false;
}

function removeCursorProperties(node: ts.Expression, env: Environment): string {
  const property = node.parent;
  const object = property?.parent;
  if (!property || !ts.isPropertyAssignment(property) || !object || !ts.isObjectLiteralExpression(object)) {
    return env.source;
  }
  return replaceNode(env.source, object, optionsWithoutCursorProperties(object, env));
}

function overlongPrefixRewrite(node: ts.Expression, env: Environment, columnCount: number): string {
  const value = unwrapExpression(node);
  const prefix = ts.isArrayLiteralExpression(value)
    ? `[${value.elements.slice(0, columnCount).map((element) => element.getText(env.sourceFile)).join(", ")}]`
    : "[]";
  const call = node.parent;
  const options = call && ts.isCallExpression(call) && call.arguments[1] === node
    ? call.arguments[2]
    : undefined;
  const object = options && ts.isObjectLiteralExpression(unwrapExpression(options))
    ? unwrapExpression(options) as ts.ObjectLiteralExpression
    : undefined;
  const edits = [{ start: node.getStart(env.sourceFile), end: node.getEnd(), value: prefix }];
  if (object && columnCount > 0) {
    edits.push({
      start: object.getStart(env.sourceFile),
      end: object.getEnd(),
      value: optionsWithoutCursorProperties(object, env),
    });
  }
  return replaceRanges(env.source, edits);
}

function optionsWithoutCursorProperties(object: ts.ObjectLiteralExpression, env: Environment): string {
  const kept = object.properties.filter((property) => {
    if (!ts.isPropertyAssignment(property) && !ts.isShorthandPropertyAssignment(property)) return true;
    const name = propertyName(property.name);
    return name !== "after" && name !== "before";
  });
  return `{ ${kept.map((property) => property.getText(env.sourceFile)).join(", ")} }`;
}

function expressionType(node: ts.Expression, env: Environment): AuthoredType | undefined {
  const value = unwrapExpression(node);
  if (ts.isIdentifier(value)) {
    const origin = env.variables.get(value.text)?.immutableOrigin;
    if (origin) return expressionType(origin.expression, origin.environment);
  }
  if (ts.isPropertyAccessExpression(value)) {
    const base = unwrapExpression(value.expression);
    if (ts.isIdentifier(base) && env.variables.get(base.text)?.operationComposite === "args") {
      return authoredTypeFromColumn(env.args[value.name.text]);
    }
    const baseType = env.expressionTypes.get(contextualNodeKey(env.literalContext, base, env.sourceFile));
    const row = requiredType(baseType);
    if (row.kind === "row") {
      const table = [...env.tables.values()].find((candidate) => candidate.name === row.table);
      const field = table?.columns?.[value.name.text];
      if (field) return field;
    }
  }
  return env.expressionTypes.get(contextualNodeKey(env.literalContext, value, env.sourceFile));
}

function knownRuntimeScalar(type: AuthoredType | undefined): boolean | undefined {
  if (type?.kind === "optional" || type?.kind === "row") return undefined;
  const value = requiredType(type);
  if (value.kind === "unknown" || value.kind === "json" || value.kind === "list") return undefined;
  if (value.kind === "object") return false;
  return true;
}

function cursorTypeMatches(
  actual: AuthoredType | undefined,
  expected: AuthoredType | undefined,
): boolean | undefined {
  if (actual?.kind === "optional") {
    const nonNull = cursorTypeMatches(actual.of, expected);
    return nonNull === false ? undefined : nonNull;
  }
  const left = requiredType(actual);
  const right = requiredType(expected);
  if (left.kind === "null") return true;
  if (left.kind === "unknown" || left.kind === "json" || left.kind === "row" || right.kind === "unknown") return undefined;
  if (right.kind === "json") return knownRuntimeScalar(left);
  if (isIdType(right) || right.kind === "principal") {
    return isIdType(left) || left.kind === "principal";
  }
  if (right.kind === "string" || right.kind === "enum") {
    return left.kind === "string" && !isIdType(left) || left.kind === "enum";
  }
  if (right.kind === "int" || right.kind === "decimal") {
    return left.kind === "int" || left.kind === "decimal";
  }
  if (right.kind === "bool") return left.kind === "bool";
  if (right.kind === "bytes") return left.kind === "bytes";
  return false;
}

function cursorTypeName(type: AuthoredType | undefined): string {
  const value = requiredType(type);
  if (isIdType(value) || value.kind === "principal") return "Id";
  if (value.kind === "string" || value.kind === "enum") return "String";
  if (value.kind === "int" || value.kind === "decimal") return "Int";
  if (value.kind === "bool") return "Bool";
  if (value.kind === "bytes") return "Bytes";
  if (value.kind === "null") return "Null";
  if (value.kind === "list") return "array";
  if (value.kind === "row" || value.kind === "object") return "object";
  return "unknown";
}

function tupleExpression(node: ts.Expression, env: Environment, table: string, columns: string[]): string | undefined {
  const value = unwrapExpression(node);
  const rowBase = (candidate: ts.Expression): ts.Expression | undefined => {
    const unwrapped = unwrapExpression(candidate);
    if (ts.isPropertyAccessExpression(unwrapped)) {
      const base = unwrapExpression(unwrapped.expression);
      if (ts.isIdentifier(base) && bindingTable(env.variables.get(base.text)) === table) {
        return unwrapped.expression;
      }
      const type = env.expressionTypes.get(contextualNodeKey(env.literalContext, base, env.sourceFile));
      if (requiredType(type).kind === "row") return unwrapped.expression;
    }
    return undefined;
  };
  if (ts.isArrayLiteralExpression(value)) {
    const bases = value.elements.map(rowBase);
    const first = bases[0]?.getText(env.sourceFile);
    if (first && bases.every((base) => base?.getText(env.sourceFile) === first)) {
      return `[${columns.map((column) => `${first}.${column}`).join(", ")}]`;
    }
    return undefined;
  }
  const authoredBase = rowBase(value)?.getText(env.sourceFile);
  const rowBinding = [...env.variables].find(([, info]) => info.rowBinding && bindingTable(info) === table)?.[0];
  const base = authoredBase ?? rowBinding;
  if (base) return `[${columns.map((column) => `${base}.${column}`).join(", ")}]`;

  if (columns.length === 1 && !ts.isArrayLiteralExpression(value)) {
    return value.getText(env.sourceFile);
  }
  return undefined;
}

function bindingTable(info: VariableInfo | undefined): string | undefined {
  if (!info) return undefined;
  if (info.rowTable) return info.rowTable;
  const expression: any = info.identityExpression;
  return expression?.Get?.table;
}

function argumentTupleRewrite(
  node: ts.Expression,
  env: Environment,
  columns: string[],
  types: AuthoredType[],
): string {
  const operation = enclosingOperation(node);
  const argsNode = operation?.arguments[0];
  const handler = operation?.arguments[1];
  if (!argsNode || !handler || !ts.isObjectLiteralExpression(unwrapExpression(argsNode))) return env.source;
  const argsObject = unwrapExpression(argsNode) as ts.ObjectLiteralExpression;
  const bound = node.parent && ts.isPropertyAssignment(node.parent) ? propertyName(node.parent.name) : undefined;
  const prefix = bound === "before" ? "before" : "after";
  const used = new Set(Object.keys(env.args));
  const names = columns.map((column) => uniqueArgument(used, `${prefix}${column[0]?.toUpperCase() ?? ""}${column.slice(1)}`));
  const declarations = names.map((name, index) => `${name}: ${descriptor(types[index])}`).join(", ");
  const argsText = argsObject.getText(env.sourceFile);
  const rewrittenArgs = `${argsText.slice(0, -1).trimEnd()}${argsObject.properties.length === 0 ? " " : ", "}${declarations} }`;
  const edits = [
    { start: argsObject.getStart(env.sourceFile), end: argsObject.getEnd(), value: rewrittenArgs },
    { start: node.getStart(env.sourceFile), end: node.getEnd(), value: `[${names.map((name) => `__ARGS__.${name}`).join(", ")}]` },
  ];
  let binding = [...env.variables].find(([, info]) => info.operationComposite === "args")?.[0];
  const parameter = (ts.isArrowFunction(handler) || ts.isFunctionExpression(handler)) ? handler.parameters[0]?.name : undefined;
  if (!binding && parameter && ts.isObjectBindingPattern(parameter)) {
    binding = uniqueBinding(env.source, "snapbackArgs");
    const text = parameter.getText(env.sourceFile);
    edits.push({
      start: parameter.getStart(env.sourceFile),
      end: parameter.getEnd(),
      value: `${text.slice(0, -1).trimEnd()}${parameter.elements.length === 0 ? " " : ", "}args: ${binding} }`,
    });
  }
  if (!binding) return env.source;
  edits[1]!.value = edits[1]!.value.replaceAll("__ARGS__", binding);
  return replaceRanges(env.source, edits);
}

function enclosingOperation(node: ts.Node): ts.CallExpression | undefined {
  for (let parent: ts.Node | undefined = node.parent; parent; parent = parent.parent) {
    if (ts.isCallExpression(parent) && ["query", "mutation"].includes(callName(parent))) return parent;
  }
  return undefined;
}

function uniqueArgument(used: Set<string>, base: string): string {
  let value = base;
  let suffix = 1;
  while (used.has(value)) value = `${base}${suffix++}`;
  used.add(value);
  return value;
}

function uniqueBinding(source: string, base: string): string {
  let value = base;
  let suffix = 1;
  while (new RegExp(`\\b${value}\\b`).test(source)) value = `${base}${suffix++}`;
  return value;
}

function descriptor(type: AuthoredType | undefined): string {
  if (!type) return "t.json(4096)";
  if (isIdType(requiredType(type))) return "t.id()";
  switch (type.kind) {
    case "optional": return `t.optional(${descriptor(type.of)})`;
    case "int": return "t.int()";
    case "principal": return "t.principal()";
    case "string": return `t.text(${type.max ?? 4096})`;
    case "bytes": return `t.bytes(${type.max})`;
    case "bool": return "t.bool()";
    case "enum": return `t.enum(${JSON.stringify(type.variants)})`;
    case "decimal": return type.currency ? `t.money(${JSON.stringify(type.currency)}, ${type.scale})` : `t.decimal(${type.scale})`;
    case "list": return `t.list(${descriptor(type.of)}, { max: ${type.max ?? 64} })`;
    default: return "t.json(4096)";
  }
}

function replaceRanges(source: string, ranges: Array<{ start: number; end: number; value: string }>): string {
  let rewritten = source;
  for (const range of ranges.sort((left, right) => right.start - left.start)) {
    rewritten = `${rewritten.slice(0, range.start)}${range.value}${rewritten.slice(range.end)}`;
  }
  return rewritten;
}
