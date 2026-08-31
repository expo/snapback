import ts from "typescript";
import type { Environment, ProvenanceOrigin, VariableInfo } from "../compiler";
import { callName, isDbMember, propertyName, staticMemberPath, unwrapCall, unwrapExpression } from "../syntax";
import { expandHelper } from "./helper-expansion";
import { directOriginCandidates, isOperationCompositeBinding } from "./operation-context";
import { guardedWalk } from "./recursion";

export function collectionElementOrigins(node: ts.Expression, env: Environment): ProvenanceOrigin[] | undefined {
  return guardedWalk(env, node, "collection elements", () => collectionElementOriginsInner(node, env));
}

function collectionElementOriginsInner(node: ts.Expression, env: Environment): ProvenanceOrigin[] | undefined {
  const value = unwrapExpression(node);
  if (ts.isIdentifier(value)) {
    const substituted = env.substitutions.get(value.text);
    if (substituted) return collectionElementOrigins(substituted.expression, substituted.environment);
    const info = env.variables.get(value.text);
    if (info?.elementOrigins) return info.elementOrigins;
    if (info?.alternativeOrigins) return flattenCollectionOrigins(info.alternativeOrigins);
    if (info?.rowCollection) {
      return [{ binding: {
        provenance: "Shape",
        rowBinding: true,
        objectFields: info.objectFields,
      } }];
    }
    return undefined;
  }
  if (ts.isPropertyAccessExpression(value)) {
    const base = unwrapExpression(value.expression);
    if (!ts.isIdentifier(base)) return undefined;
    const info = env.variables.get(base.text);
    if (info?.immutableOrigin) {
      const selected = selectOriginMember(info.immutableOrigin, value.name.text);
      return selected && collectionElementOrigins(selected.expression, selected.environment);
    }
    if (info?.alternativeOrigins) {
      const members = info.alternativeOrigins.map((origin) => selectOriginMember(origin, value.name.text));
      return members.every((member): member is Extract<ProvenanceOrigin, { expression: ts.Expression }> => !!member)
        ? flattenCollectionOrigins(members)
        : undefined;
    }
    return undefined;
  }
  if (ts.isArrayLiteralExpression(value)) {
    const origins: ProvenanceOrigin[] = [];
    for (const element of value.elements) {
      if (ts.isSpreadElement(element)) {
        const spread = collectionElementOrigins(element.expression, env);
        if (!spread) return undefined;
        origins.push(...spread);
      } else {
        origins.push({ expression: element, environment: env });
      }
    }
    return origins;
  }
  const call = unwrapCall(value);
  const expanded = call && expandHelper(call, env);
  if (expanded) return collectionElementOrigins(expanded.expression, expanded.environment);
  if (call && callName(call).endsWith(".scan")
    && isDbMember(call.expression, (binding) => isOperationCompositeBinding(binding, "db", env))) {
    return [{ binding: {
      provenance: "Shape",
      rowBinding: true,
      objectFields: rowFields(call.arguments[0], env),
    } }];
  }
  if (call && ts.isPropertyAccessExpression(call.expression)) {
    const method = call.expression.name.text;
    const owner = call.expression.expression;
    if (["filter", "sort", "slice"].includes(method)) return collectionElementOrigins(owner, env);
    if (method === "map" || method === "flatMap") {
      const callback = call.arguments[0];
      if (!callback || !ts.isArrowFunction(callback) && !ts.isFunctionExpression(callback)
        || callback.parameters.length === 0 || !ts.isIdentifier(callback.parameters[0]!.name)
        || ts.isBlock(callback.body)) return undefined;
      const callbackEnv = snapshotEnvironment(env);
      callbackEnv.variables.set(callback.parameters[0].name.text, collectionElementBinding(owner, env));
      return method === "map"
        ? [{ expression: callback.body, environment: callbackEnv }]
        : collectionElementOrigins(callback.body, callbackEnv);
    }
  }
  return undefined;
}

function collectionElementBinding(node: ts.Expression, env: Environment): VariableInfo {
  const origins = collectionElementOrigins(node, env);
  return origins && origins.length > 0
    ? { provenance: "Computed", alternativeOrigins: origins }
    : { provenance: "Computed", provenanceAmbiguity: {} };
}

function flattenCollectionOrigins(origins: readonly ProvenanceOrigin[]): ProvenanceOrigin[] | undefined {
  const elements: ProvenanceOrigin[] = [];
  for (const origin of origins) {
    if ("binding" in origin) {
      const nested = origin.binding.elementOrigins
        ?? (origin.binding.alternativeOrigins ? flattenCollectionOrigins(origin.binding.alternativeOrigins) : undefined);
      if (!nested) return undefined;
      elements.push(...nested);
      continue;
    }
    const nested = collectionElementOrigins(origin.expression, origin.environment);
    if (!nested) return undefined;
    elements.push(...nested);
  }
  return elements;
}

export function selectOriginMember(
  origin: ProvenanceOrigin,
  member: string,
): Extract<ProvenanceOrigin, { expression: ts.Expression }> | undefined {
  if ("binding" in origin) {
    return origin.binding.immutableOrigin
      ? selectOriginMember(origin.binding.immutableOrigin, member)
      : undefined;
  }
  const value = unwrapExpression(origin.expression);
  if (ts.isIdentifier(value)) {
    const info = origin.environment.variables.get(value.text);
    return info?.immutableOrigin ? selectOriginMember(info.immutableOrigin, member) : undefined;
  }
  if (!ts.isObjectLiteralExpression(value)) return undefined;
  const selected = value.properties.find((property): property is ts.PropertyAssignment =>
    ts.isPropertyAssignment(property) && propertyName(property.name) === member)?.initializer
    ?? value.properties.find((property): property is ts.ShorthandPropertyAssignment =>
      ts.isShorthandPropertyAssignment(property) && property.name.text === member)?.name;
  return selected ? { expression: selected, environment: origin.environment } : undefined;
}

export function originDirectCandidates(origins: readonly ProvenanceOrigin[]): string[] {
  const candidates = new Set<string>();
  for (const origin of origins) {
    if ("expression" in origin) {
      for (const candidate of directOriginCandidates(origin.expression, origin.environment)) candidates.add(candidate);
      continue;
    }
    for (const candidate of origin.binding.provenanceAmbiguity?.candidates ?? []) candidates.add(candidate);
    if (origin.binding.provenanceAmbiguity?.directRewrite) {
      candidates.add(origin.binding.provenanceAmbiguity.directRewrite);
    }
    if (origin.binding.immutableOrigin) {
      for (const candidate of directOriginCandidates(
        origin.binding.immutableOrigin.expression,
        origin.binding.immutableOrigin.environment,
      )) candidates.add(candidate);
    }
  }
  return [...candidates];
}

export function snapshotEnvironment(env: Environment): Environment {
  return {
    ...env,
    variables: new Map([...env.variables].map(([name, info]) => [name, { ...info }])),
    substitutions: new Map(env.substitutions),
    helperStack: [...env.helperStack],
  };
}

function rowFields(target: ts.Expression | undefined, env: Environment): string[] | undefined {
  if (!target) return undefined;
  const binding = staticMemberPath(target)?.split(".")[0];
  const columns = binding && env.tables.get(binding)?.columns;
  return columns ? [...new Set(["id", ...Object.keys(columns)])] : undefined;
}
