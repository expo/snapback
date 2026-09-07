import { scanOptionsNeedSequence } from "./scan-operands";
import { OperandOrder } from "./operand-order";
import ts from "typescript";
import type { Expr, Stmt } from "../ir";
import type { Environment, LoweredValue, VariableInfo } from "./environment";
import { contextualNodeKey, temporary, unwrapExpression } from "../syntax";
import { cloneEnvironment, lowerCall, lowerExpr } from "./expr";
import { expandHelper } from "./helper-expansion";
import { runtimeBinding } from "./lexical-binding";
import { captureTupleValues, convertAtUse, convertCapturedValue } from "./value-conversion";
import { refuse } from "../diagnostics";
import { expressionType } from "./cursor";
import { refuseRecursiveWalk } from "./recursion";

export function lowerCallValue(call: ts.CallExpression, env: Environment, lowerValue: (node: ts.Expression, env: Environment, hint?: string) => LoweredValue, hint?: string): LoweredValue {
  const statements: Stmt[] = [];
  const expanded = expandHelper(call, env);
  if (expanded && ts.isIdentifier(call.expression)) {
    statements.push(...evaluateHelperArguments(call, expanded, env, lowerValue, hint));
    const body = lowerValue(expanded.expression, expanded.environment, hint);
    return { statements: [...statements, ...body.statements], expression: body.expression };
  }
  const order = new OperandOrder(env);
  const expression = lowerCall(call, env, hint, (node, scope, at) => order.add(lowerValue(node, scope, at)));
  if ("Scan" in expression && scanOptionsNeedSequence(call)) order.flush();
  return { statements: order.statements, expression };
}

export function evaluateHelperArguments(call: ts.CallExpression, expanded: NonNullable<ReturnType<typeof expandHelper>>,
  env: Environment, lowerValue: (node: ts.Expression, env: Environment, hint?: string) => LoweredValue, hint?: string): Stmt[] {
  const statements: Stmt[] = [];
  if (ts.isIdentifier(call.expression)) {
    // @ref LLP 1002#2-the-authored-surface-the-snapback2-module — helper substitution retains call-by-value and each actual argument's lexical provenance.
    const helper = env.helpers.get(call.expression.text)!;
    for (const [index, argument] of call.arguments.entries()) {
      const lowered = lowerValue(argument, env, hint);
      lowered.expression = captureTupleValues(lowered, env);
      statements.push(...lowered.statements);
      const name = temporary(env, "helperArgument");
      statements.push({ Const: { name, value: lowered.expression } });
      const prior = "Variable" in lowered.expression ? runtimeBinding(lowered.expression.Variable, env) : undefined;
      const info: VariableInfo = { provenance: "Const", identityExpression: lowered.expression,
        identityEnvironment: cloneEnvironment(env), capturedShape: prior?.capturedShape ?? lowered.expression,
        mutatedCollection: prior?.mutatedCollection };
      env.runtimeBindings.set(name, info);
      const parameter = helper.parameters[index];
      if (parameter && ts.isIdentifier(parameter.name)) {
        const origin = expanded.environment.substitutions.get(parameter.name.text)!;
        expanded.environment.substitutions.set(parameter.name.text, { ...origin, value: { Variable: name } });
      }
    }
  }
  return statements;
}


export function lowerKey(node: ts.Expression, env: Environment, operand: typeof lowerExpr = lowerExpr): Expr[] {
  const value = unwrapExpression(node);
  if (ts.isArrayLiteralExpression(value)) return value.elements.map((element) => {
    const lowered = operand(element, env);
    if (expressionType(element, env)?.kind === "list" || "Array" in keyShape(lowered, env, element)) {
      refuseKeyTuple(element, env);
    }
    return lowered;
  });
  if (ts.isIdentifier(value)) {
    const substitution = env.substitutions.get(value.text);
    if (substitution) {
      if (substitution.value) {
        keyShape(substitution.value, env, value);
        const converted = convertAtUse(value, env, substitution.value, substitution.environment);
        return keyComponents(converted, value, env);
      }
      return lowerKey(substitution.expression, substitution.environment, operand);
    }
    const items = env.variables.get(value.text)?.tupleItems;
    if (items) {
      keyShape({ Variable: env.variables.get(value.text)?.runtimeName ?? value.text }, env, value);
      const conversion = env.valueConversions.get(contextualNodeKey(env.literalContext, value, env.sourceFile));
      const converted = conversion && convertCapturedValue({ Array: items }, conversion);
      return fixedComponents(converted && "Array" in converted ? converted.Array : items, value, env);
    }
  }
  const lowered = operand(value, env);
  return keyComponents(lowered, value, env);
}

export function lowerScalarKey(node: ts.Expression, env: Environment, operand: typeof lowerExpr = lowerExpr): Expr {
  const items = lowerKey(node, env, operand);
  if (items.length !== 1) refuse(env, "E_OPAQUE", node,
    "a write address requires exactly one scalar identity", "bind the row's scalar id and use it as the write address");
  return items[0]!;
}

function keyComponents(value: Expr, node: ts.Expression, env: Environment): Expr[] {
  const shape = keyShape(value, env, node);
  if ("Array" in shape) return fixedComponents(shape.Array, node, env);
  if (expressionType(node, env)?.kind === "list") refuseKeyTuple(node, env);
  return [value];
}

function fixedComponents(items: Expr[], node: ts.Expression, env: Environment): Expr[] {
  for (const item of items) if ("Array" in keyShape(item, env, node)) refuseKeyTuple(node, env);
  return items;
}

// @ref LLP 1002#2-the-authored-surface-the-snapback2-module — tuple substitution requires immutable collection identity; capturing a scalar before reassignment still captures its value.
function keyShape(value: Expr, env: Environment, site: ts.Expression, seen = new Set<VariableInfo>()): Expr {
  if ("Variable" in value) {
    const info = runtimeBinding(value.Variable, env);
    if (!info) return value;
    if (info.mutatedCollection) refuseKeyTuple(site, env);
    if (seen.has(info) || seen.size >= 128) refuseRecursiveWalk(env, site);
    const shape = info.locallyCreatedCollection ? info.capturedShape : info.identityExpression ?? info.capturedShape;
    if (!shape) {
      if (info.collection) refuseKeyTuple(site, env);
      return value;
    }
    seen.add(info);
    return keyShape(shape, info.identityEnvironment ?? env, site, seen);
  }
  if ("Field" in value) {
    const base = keyShape(value.Field.base, env, site, seen);
    if ("Object" in base && base.Object[value.Field.name]) return keyShape(base.Object[value.Field.name]!, env, site, seen);
  }
  return value;
}

function refuseKeyTuple(node: ts.Expression, env: Environment): never {
  refuse(env, "E_OPAQUE", node,
    "address tuples require a fixed immutable shape; a mutated or unproven list cannot supply key components",
    "bind each intended scalar key component once, then pass an explicit immutable tuple [component1, ...]; do not mutate the address tuple");
}
