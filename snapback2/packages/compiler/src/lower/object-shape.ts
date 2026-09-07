import ts from "typescript";
import type { Environment } from "../compiler";
import { refuse } from "../diagnostics";
import {
  callName,
  isDbInsertCall,
  isDbMember,
  isFunctionLike,
  propertyName,
  replaceNode,
  unwrapCall,
  unwrapExpression,
} from "../syntax";
import { expandHelper } from "./helper-expansion";
import { isOperationCompositeBinding } from "./operation-context";
import { isRowCollectionExpression, isRowExpression } from "./provenance";
import { guardedWalk } from "./recursion";

export function knownObjectFields(node: ts.Expression, env: Environment): string[] | undefined {
  return guardedWalk(env, node, "object fields", () => knownObjectFieldsInner(node, env));
}

function knownObjectFieldsInner(node: ts.Expression, env: Environment): string[] | undefined {
  const value = unwrapExpression(node);
  if (ts.isIdentifier(value)) {
    const substituted = env.substitutions.get(value.text);
    if (substituted) return knownObjectFields(substituted.expression, substituted.environment);
    const info = env.variables.get(value.text);
    if (info?.provenanceAmbiguity) return undefined;
    if (info?.operationComposite === "args") return Object.keys(env.args);
    if (info?.operationComposite === "ctx") return ["viewer"];
    return info?.objectFields ?? (info?.immutableOrigin
      ? knownObjectFields(info.immutableOrigin.expression, info.immutableOrigin.environment)
      : undefined);
  }
  if (ts.isPropertyAccessExpression(value)) {
    const selected = selectedObjectMember(value.expression, value.name.text, env);
    return selected && knownObjectFields(selected.expression, selected.environment);
  }
  if (ts.isObjectLiteralExpression(value)) {
    const fields: string[] = [];
    for (const property of value.properties) {
      if (ts.isSpreadAssignment(property)) {
        const spread = knownObjectFields(property.expression, env);
        if (!spread) return undefined;
        for (const field of spread) if (!fields.includes(field)) fields.push(field);
        continue;
      }
      if (ts.isShorthandPropertyAssignment(property)) {
        if (!fields.includes(property.name.text)) fields.push(property.name.text);
        continue;
      }
      if (!ts.isPropertyAssignment(property)) return undefined;
      const name = propertyName(property.name);
      if (!name) return undefined;
      if (!fields.includes(name)) fields.push(name);
    }
    return fields;
  }
  const call = unwrapCall(value);
  const expanded = call && expandHelper(call, env);
  if (expanded) return knownObjectFields(expanded.expression, expanded.environment);
  if (call && isRowExpression(call, env)) {
    // Insert returns its captured input object. Optional columns materialized
    // by storage do not add members to that earlier source snapshot.
    if (isDbInsertCall(call, (binding) => isOperationCompositeBinding(binding, "db", env))) {
      return call.arguments[1] && knownObjectFields(call.arguments[1], env);
    }
    return rowFields(call.arguments[0], env);
  }
  if (call && ts.isPropertyAccessExpression(call.expression) && call.expression.name.text === "require") {
    return knownObjectFields(call.expression.expression, env);
  }
  return undefined;
}

function selectedObjectMember(
  node: ts.Expression,
  member: string,
  env: Environment,
): { expression: ts.Expression; environment: Environment } | undefined {
  const value = unwrapExpression(node);
  if (ts.isIdentifier(value)) {
    const substituted = env.substitutions.get(value.text);
    if (substituted) return selectedObjectMember(substituted.expression, member, substituted.environment);
    const info = env.variables.get(value.text);
    if (info?.provenanceAmbiguity) return undefined;
    const origin = info?.immutableOrigin;
    return origin && selectedObjectMember(origin.expression, member, origin.environment);
  }
  if (ts.isPropertyAccessExpression(value)) {
    const selected = selectedObjectMember(value.expression, value.name.text, env);
    return selected && selectedObjectMember(selected.expression, member, selected.environment);
  }
  if (ts.isObjectLiteralExpression(value)) {
    for (const property of [...value.properties].reverse()) {
      if (ts.isSpreadAssignment(property)) {
        const fields = knownObjectFields(property.expression, env);
        if (!fields) return undefined;
        if (fields.includes(member)) return selectedObjectMember(property.expression, member, env);
        continue;
      }
      if (ts.isShorthandPropertyAssignment(property) && property.name.text === member) {
        return { expression: property.name, environment: env };
      }
      if (ts.isPropertyAssignment(property) && propertyName(property.name) === member) {
        return { expression: property.initializer, environment: env };
      }
    }
    return undefined;
  }
  const call = unwrapCall(value);
  const expanded = call && expandHelper(call, env);
  return expanded && selectedObjectMember(expanded.expression, member, expanded.environment);
}

export function rowCollectionFields(node: ts.Expression, env: Environment): string[] | undefined {
  return guardedWalk(env, node, "row collection fields", () => rowCollectionFieldsInner(node, env));
}

function rowCollectionFieldsInner(node: ts.Expression, env: Environment): string[] | undefined {
  const value = unwrapExpression(node);
  if (ts.isIdentifier(value)) {
    const substituted = env.substitutions.get(value.text);
    if (substituted) return rowCollectionFields(substituted.expression, substituted.environment);
    const info = env.variables.get(value.text);
    return !info?.provenanceAmbiguity && info?.rowCollection ? info.objectFields : undefined;
  }
  const call = unwrapCall(value);
  if (!call) return undefined;
  const expanded = expandHelper(call, env);
  if (expanded) return rowCollectionFields(expanded.expression, expanded.environment);
  if (callName(call).endsWith(".scan")
    && isDbMember(call.expression, (binding) => isOperationCompositeBinding(binding, "db", env))) {
    return rowFields(call.arguments[0], env);
  }
  if (ts.isPropertyAccessExpression(call.expression) && ["filter", "sort", "slice"].includes(call.expression.name.text)) {
    return rowCollectionFields(call.expression.expression, env);
  }
  if (ts.isPropertyAccessExpression(call.expression) && call.expression.name.text === "map") {
    const callback = call.arguments[0];
    if (callback && isFunctionLike(callback) && callback.parameters.length > 0 && !ts.isBlock(callback.body)
      && ts.isIdentifier(callback.parameters[0]!.name)) {
      const body = unwrapExpression(callback.body);
      if (ts.isIdentifier(body) && body.text === callback.parameters[0].name.text) {
        return rowCollectionFields(call.expression.expression, env);
      }
    }
  }
  if (ts.isPropertyAccessExpression(call.expression) && call.expression.name.text === "flatMap"
    && isRowCollectionExpression(call, env)) {
    return rowCollectionFields(call.expression.expression, env);
  }
  return undefined;
}

export function nullableReadSpread(node: ts.Expression, env: Environment): string | undefined {
  const value = unwrapExpression(node);
  if (ts.isIdentifier(value) && env.variables.get(value.text)?.nullableRead) return value.text;
  const call = unwrapCall(value);
  return call && callName(call).endsWith(".get")
    && isDbMember(call.expression, (binding) => isOperationCompositeBinding(binding, "db", env))
    ? call.getText(env.sourceFile)
    : undefined;
}

export function nullableSpreadRefusal(node: ts.SpreadAssignment, env: Environment, value: string): never {
  const direct = value.includes(".get(");
  const rewrite = direct
    ? `const row = ${value};\ndb.require(row !== null, "ROW_REQUIRED");\n{ ...row }`
    : `db.require(${value} !== null, "ROW_REQUIRED");\n{ ...${value} }`;
  refuse(env, "E_OPAQUE", node, `nullable db.get result ${value} cannot be spread before it is required`, rewrite);
}

export function objectSpreadRewrite(env: Environment, spread: ts.SpreadAssignment): string {
  const value = spread.expression.getText(env.sourceFile);
  return replaceNode(env.source, spread, `field: ${value}.field`);
}

export function arraySpreadRewrite(env: Environment, spread: ts.SpreadElement): string {
  const value = spread.expression.getText(env.sourceFile);
  return replaceNode(env.source, spread, `${value}[0], ${value}[1]`);
}

function rowFields(target: ts.Expression | undefined, env: Environment): string[] | undefined {
  if (!target) return undefined;
  const value = unwrapExpression(target);
  const binding = ts.isIdentifier(value)
    ? value.text
    : ts.isPropertyAccessExpression(value) && ts.isIdentifier(value.expression)
      ? value.expression.text
      : undefined;
  const columns = binding && env.tables.get(binding)?.columns;
  if (!columns) return undefined;
  return [...new Set(["id", ...Object.keys(columns)])];
}
