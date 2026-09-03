import ts from "typescript";
import { requiredType, isIdType, type AuthoredType } from "../authored-types";
import { diagnostic } from "../diagnostics";
import { callName, contextualNodeKey, propertyName, replaceNode, unwrapExpression } from "../syntax";
import type { Environment, VariableInfo } from "./environment";
import { expandHelper } from "./helper-expansion";

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
  const remainingColumns = indexInfo.columns.slice(prefixLength);
  const expectedTypes = indexInfo.types.slice(prefixLength);

  const expanded = expandHelper(value, env);
  const shapeValue = unwrapExpression(expanded?.expression ?? value);
  const shapeEnv = expanded?.environment ?? env;
  const authored = expressionType(shapeValue, shapeEnv);
  const elements = ts.isArrayLiteralExpression(shapeValue) ? [...shapeValue.elements] : undefined;
  const shapeMatches = elements
    ? elements.length === remainingColumns.length
    : knownRuntimeScalar(authored) === true
      ? remainingColumns.length === 1
      : knownRuntimeScalar(authored) === false
        ? remainingColumns.length === 1 ? undefined : false
        : undefined;
  if (shapeMatches !== false) return;

  const tuple = tupleExpression(value, env, table, remainingColumns);
  env.diagnostics.push(diagnostic(
    env,
    "E_ARGS_CURSOR_SHAPE",
    value,
    `scan ${table}.${index} cursor has the wrong static shape: expected exactly ${remainingColumns.length} cursor value(s), one per remaining index column`,
    tuple ? replaceNode(env.source, value, tuple) : argumentTupleRewrite(value, env, remainingColumns, expectedTypes),
  ));
}

function expressionType(node: ts.Expression, env: Environment): AuthoredType | undefined {
  const value = unwrapExpression(node);
  if (ts.isPropertyAccessExpression(value)) {
    const base = unwrapExpression(value.expression);
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
  const value = requiredType(type);
  if (value.kind === "unknown" || value.kind === "json" || value.kind === "list") return undefined;
  if (value.kind === "object" || value.kind === "row") return false;
  return true;
}

function tupleExpression(node: ts.Expression, env: Environment, table: string, columns: string[]): string | undefined {
  const value = unwrapExpression(node);
  const bases: ts.Expression[] = [];
  const collectBase = (candidate: ts.Expression): void => {
    const unwrapped = unwrapExpression(candidate);
    if (ts.isPropertyAccessExpression(unwrapped)) {
      const base = unwrapExpression(unwrapped.expression);
      const type = env.expressionTypes.get(contextualNodeKey(env.literalContext, base, env.sourceFile));
      if (requiredType(type).kind === "row") bases.push(unwrapped.expression);
    }
  };
  if (ts.isArrayLiteralExpression(value)) value.elements.forEach(collectBase);
  else collectBase(value);
  const rowBinding = [...env.variables].find(([, info]) => info.rowBinding && bindingTable(info) === table)?.[0];
  const base = bases[0]?.getText(env.sourceFile) ?? rowBinding;
  if (base) return `[${columns.map((column) => `${base}.${column}`).join(", ")}]`;

  if (columns.length === 1 && !ts.isArrayLiteralExpression(value)) {
    return value.getText(env.sourceFile);
  }
  return undefined;
}

function bindingTable(info: VariableInfo): string | undefined {
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
