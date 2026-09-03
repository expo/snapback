import ts from "typescript";
import type { Environment, ProvenanceOrigin, VariableInfo } from "../compiler";
import {
  callName,
  collectionConstructor,
  expressionProperty,
  isFunctionLike,
  numericLiteral,
  unwrapCall,
  unwrapExpression,
} from "../syntax";
import { selectExpressionMember } from "./collection-origins";
import { expandHelper } from "./helper-expansion";
import { guardedWalk } from "./recursion";

export function operationArgumentList(
  node: ts.Expression,
  env: Environment,
): { name: string; max?: number } | undefined {
  const value = unwrapExpression(node);
  if (!ts.isPropertyAccessExpression(value)) return undefined;
  const base = unwrapExpression(value.expression);
  if (!ts.isIdentifier(base) || env.variables.get(base.text)?.operationComposite !== "args") return undefined;
  const argument = env.args[value.name.text];
  return {
    name: value.name.text,
    ...(argument && typeof argument !== "string" && "List" in argument ? { max: argument.List.max } : {}),
  };
}

export function derivedBound(node: ts.Expression, env: Environment): Partial<VariableInfo> {
  const known = staticBound(node, env);
  return known === undefined ? {} : { max: known, boundSource: `${node.getText()} static bound` };
}

export function staticBound(node: ts.Expression, env: Environment): number | undefined {
  return guardedWalk(env, node, "static bound", () => staticBoundInner(node, env));
}

function staticBoundInner(node: ts.Expression, env: Environment): number | undefined {
  const value = unwrapExpression(node);
  if (ts.isIdentifier(value)) {
    const substituted = env.substitutions.get(value.text);
    if (substituted) return staticBound(substituted.expression, substituted.environment);
    const info = env.variables.get(value.text);
    return info?.max ?? (info ? alternativeOriginBound(info, staticBound) : undefined);
  }
  const operationList = operationArgumentList(value, env);
  if (operationList) return operationList.max;
  if (ts.isPropertyAccessExpression(value)) {
    const selected = selectExpressionMember(value.expression, env, value.name.text);
    if (selected.kind === "found") {
      const bounds = selected.origins.map((origin) => originBound(origin, staticBound));
      if (bounds.every((bound): bound is number => bound !== undefined)) return Math.max(...bounds);
    }
  }
  if (ts.isArrayLiteralExpression(value)) {
    let total = 0;
    for (const element of value.elements) {
      if (ts.isSpreadElement(element)) {
        const bound = staticBound(element.expression, env);
        if (bound === undefined) return undefined;
        total += bound;
      } else total += 1;
    }
    return total;
  }
  if (ts.isConditionalExpression(value)) {
    const whenTrue = staticBound(value.whenTrue, env);
    const whenFalse = staticBound(value.whenFalse, env);
    return whenTrue === undefined || whenFalse === undefined ? undefined : Math.max(whenTrue, whenFalse);
  }
  if (ts.isNewExpression(value) && collectionConstructor(value)) {
    const initializer = value.arguments?.[0];
    return initializer ? staticBound(initializer, env) : 0;
  }
  const call = unwrapCall(node);
  const expanded = call && expandHelper(call, env);
  if (expanded) return staticBound(expanded.expression, expanded.environment);
  if (call && callName(call).endsWith(".scan")) {
    const take = scanTake(call);
    if (typeof take === "number") return take;
  }
  if (call && ts.isIdentifier(call.expression) && call.expression.text === "mergeByIndex") {
    return numericLiteral(call.arguments[3]);
  }
  if (call && ts.isIdentifier(call.expression) && call.expression.text === "mentionTokens") return 85;
  if (call && ts.isPropertyAccessExpression(call.expression)) {
    const method = call.expression.name.text;
    const owner = staticBound(call.expression.expression, env);
    if (method === "map" || method === "filter" || method === "sort") return owner;
    if (method === "slice") {
      const start = numericLiteral(call.arguments[0]) ?? 0;
      const end = numericLiteral(call.arguments[1]);
      return end === undefined ? owner : Math.max(0, end - start);
    }
    if (method === "flatMap" && owner !== undefined) {
      const callback = call.arguments[0];
      if (callback && isFunctionLike(callback) && !ts.isBlock(callback.body)) {
        const inner = staticBound(callback.body, env);
        if (inner !== undefined) return owner * inner;
      }
    }
  }
  return undefined;
}

function alternativeOriginBound(
  info: VariableInfo,
  bound: (node: ts.Expression, env: Environment) => number | undefined,
): number | undefined {
  if (!info.alternativeOrigins || info.alternativeOrigins.length === 0) return undefined;
  const values = info.alternativeOrigins.map((origin) => originBound(origin, bound));
  return values.every((value): value is number => value !== undefined) ? Math.max(...values) : undefined;
}

function originBound(
  origin: ProvenanceOrigin,
  bound: (node: ts.Expression, env: Environment) => number | undefined,
): number | undefined {
  return "binding" in origin
    ? origin.binding.max ?? alternativeOriginBound(origin.binding, bound)
    : bound(origin.expression, origin.environment);
}

function scanTake(call: ts.CallExpression): number | "arg" | undefined {
  const options = call.arguments[2];
  if (!options || !ts.isObjectLiteralExpression(options)) return undefined;
  const take = expressionProperty(options, "take");
  return take ? numericLiteral(take) ?? "arg" : undefined;
}
