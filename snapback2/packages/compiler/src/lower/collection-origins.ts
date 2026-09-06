import ts from "typescript";
import type { Environment, ProvenanceOrigin, VariableInfo } from "../compiler";
import { callName, isDbMember, propertyName, staticMemberPath, unwrapCall, unwrapExpression } from "../syntax";
import { expandHelper } from "./helper-expansion";
import { directOriginCandidates, isOperationCompositeBinding } from "./operation-context";
import { guardedWalk } from "./recursion";

type Presence = "required" | "optional";
type MemberSelection =
  | { kind: "found"; origins: ProvenanceOrigin[]; presence: Presence }
  | { kind: "absent" }
  | { kind: "unknown" };

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
    if (info?.max !== undefined) return [elementOrigin(info, info.operationArgument)];
    return undefined;
  }
  if (ts.isPropertyAccessExpression(value)) {
    const selected = selectExpressionMember(value.expression, env, value.name.text);
    return selected.kind === "found" ? flattenCollectionOrigins(selected.origins) : undefined;
  }
  if (ts.isArrayLiteralExpression(value)) {
    const origins: ProvenanceOrigin[] = [];
    const elementEnvironment = snapshotEnvironment(env);
    for (const element of value.elements) {
      if (ts.isSpreadElement(element)) {
        const spread = collectionElementOrigins(element.expression, env);
        if (!spread) return undefined;
        origins.push(...spread);
      } else {
        origins.push({ expression: element, environment: elementEnvironment });
      }
    }
    return origins;
  }
  if (ts.isConditionalExpression(value)) {
    const whenTrue = collectionElementOrigins(value.whenTrue, env);
    const whenFalse = collectionElementOrigins(value.whenFalse, env);
    return whenTrue && whenFalse ? [...whenTrue, ...whenFalse] : undefined;
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
  if (call && ts.isIdentifier(call.expression) && call.expression.text === "mergeByIndex") {
    const rows = call.arguments[0];
    if (!rows || !ts.isArrayLiteralExpression(rows)) return undefined;
    // Certification requires every lane to return a scan of the same table/index.
    // A collection element's row fields therefore have the same origin shape in
    // every descriptor; prefixes and discovery bindings cannot change those fields.
    const lane = rows.elements[0];
    if (!lane || !ts.isObjectLiteralExpression(lane)) return undefined;
    const callback = lane.properties.find((p) => ts.isPropertyAssignment(p) && propertyName(p.name) === "lane");
    if (!callback || !ts.isPropertyAssignment(callback) || !ts.isArrowFunction(callback.initializer)) return undefined;
    const body = callback.initializer.body;
    const returned = ts.isBlock(body) ? body.statements.at(-1) : undefined;
    const expression = ts.isBlock(body) ? returned && ts.isReturnStatement(returned) && returned.expression : body;
    return expression ? collectionElementOrigins(expression, env) : undefined;
  }
  if (call && ts.isIdentifier(call.expression) && call.expression.text === "mentionTokens") {
    return [{ binding: { provenance: "Computed" } }];
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
        ? [{ expression: callback.body, environment: snapshotEnvironment(callbackEnv) }]
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
      if (nested) elements.push(...nested);
      else if (origin.binding.max !== undefined || origin.binding.operationArgument || origin.binding.rowCollection) {
        elements.push(elementOrigin(origin.binding, origin.candidate));
      } else return undefined;
      continue;
    }
    const nested = collectionElementOrigins(origin.expression, origin.environment);
    if (!nested) return undefined;
    elements.push(...nested);
  }
  return elements;
}

export function selectOriginMembers(origin: ProvenanceOrigin, member: string): MemberSelection {
  if ("binding" in origin) {
    return origin.binding.immutableOrigin
      ? selectOriginMembers(origin.binding.immutableOrigin, member)
      : { kind: "unknown" };
  }
  return selectExpressionMember(origin.expression, origin.environment, member);
}

export function selectExpressionMember(
  node: ts.Expression,
  env: Environment,
  member: string,
): MemberSelection {
  const value = unwrapExpression(node);
  if (ts.isIdentifier(value)) {
    const substituted = env.substitutions.get(value.text);
    if (substituted) return selectExpressionMember(substituted.expression, substituted.environment, member);
    const info = env.variables.get(value.text);
    if (info?.operationComposite === "args") {
      const descriptor = env.args[member];
      if (!descriptor) return { kind: "absent" };
      const unwrapped = typeof descriptor !== "string" && "Optional" in descriptor ? descriptor.Optional : descriptor;
      const max = typeof unwrapped !== "string" && "List" in unwrapped ? unwrapped.List.max : undefined;
      return {
        kind: "found",
        origins: [{ binding: {
          provenance: "Arg",
          operationArgument: member,
          ...(max !== undefined ? { max, boundSource: `arg ${member} max` } : {}),
        }, candidate: `${value.text}.${member}` }],
        presence: typeof descriptor !== "string" && "Optional" in descriptor ? "optional" : "required",
      };
    }
    if (info?.operationComposite === "ctx") {
      return member === "viewer"
        ? { kind: "found", origins: [{ binding: { provenance: "Viewer" } }], presence: "required" }
        : { kind: "absent" };
    }
    if (info?.provenanceAmbiguity) return { kind: "unknown" };
    if (info?.alternativeOrigins) {
      const selected = info.alternativeOrigins.map((origin) => selectOriginMembers(origin, member));
      if (selected.some((item) => item.kind !== "found")) return { kind: "unknown" };
      return {
        kind: "found",
        origins: selected.flatMap((item) => item.kind === "found" ? item.origins : []),
        presence: selected.some((item) => item.kind === "found" && item.presence === "optional")
          ? "optional"
          : "required",
      };
    }
    return info?.immutableOrigin
      ? selectOriginMembers(info.immutableOrigin, member)
      : { kind: "unknown" };
  }
  if (ts.isConditionalExpression(value)) {
    return mergeMemberAlternatives([
      selectExpressionMember(value.whenTrue, env, member),
      selectExpressionMember(value.whenFalse, env, member),
    ]);
  }
  if (!ts.isObjectLiteralExpression(value)) return { kind: "unknown" };
  const laterOptional: ProvenanceOrigin[] = [];
  for (const property of [...value.properties].reverse()) {
    let selected: MemberSelection | undefined;
    if (ts.isSpreadAssignment(property)) {
      selected = selectExpressionMember(property.expression, env, member);
    } else if (ts.isShorthandPropertyAssignment(property) && property.name.text === member) {
      selected = {
        kind: "found",
        origins: [{ expression: property.name, environment: snapshotEnvironment(env) }],
        presence: "required",
      };
    } else if (ts.isPropertyAssignment(property) && propertyName(property.name) === member) {
      selected = {
        kind: "found",
        origins: [{ expression: property.initializer, environment: snapshotEnvironment(env) }],
        presence: "required",
      };
    }
    if (!selected || selected.kind === "absent") continue;
    if (selected.kind === "unknown") return selected;
    if (selected.presence === "optional") {
      laterOptional.push(...selected.origins);
      continue;
    }
    return { kind: "found", origins: [...laterOptional, ...selected.origins], presence: "required" };
  }
  return laterOptional.length > 0
    ? { kind: "found", origins: laterOptional, presence: "optional" }
    : { kind: "absent" };
}

export function originDirectCandidates(origins: readonly ProvenanceOrigin[]): string[] {
  const candidates = new Set<string>();
  for (const origin of origins) {
    if ("expression" in origin) {
      for (const candidate of directOriginCandidates(origin.expression, origin.environment)) candidates.add(candidate);
      continue;
    }
    if (origin.candidate) candidates.add(origin.candidate);
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
    if (origin.binding.alternativeOrigins) {
      for (const candidate of originDirectCandidates(origin.binding.alternativeOrigins)) candidates.add(candidate);
    }
  }
  return [...candidates];
}

function mergeMemberAlternatives(alternatives: readonly MemberSelection[]): MemberSelection {
  if (alternatives.some((item) => item.kind === "unknown")) return { kind: "unknown" };
  if (alternatives.every((item) => item.kind === "absent")) return { kind: "absent" };
  if (alternatives.some((item) => item.kind === "absent")) return { kind: "unknown" };
  const found = alternatives as Extract<MemberSelection, { kind: "found" }>[];
  return {
    kind: "found",
    origins: found.flatMap((item) => item.origins),
    presence: found.some((item) => item.presence === "optional") ? "optional" : "required",
  };
}

export function snapshotEnvironment(env: Environment): Environment {
  return {
    ...env,
    variables: new Map([...env.variables].map(([name, info]) => [name, { ...info }])),
    substitutions: new Map(env.substitutions),
    helperStack: [...env.helperStack],
    deferredCollectionMutations: new Set(env.deferredCollectionMutations),
  };
}

function elementOrigin(info: VariableInfo, candidate?: string): ProvenanceOrigin {
  const {
    max: _max,
    boundSource: _boundSource,
    elementOrigins: _elementOrigins,
    alternativeOrigins: _alternativeOrigins,
    ...binding
  } = info;
  return { binding, ...(candidate ? { candidate } : {}) };
}

function rowFields(target: ts.Expression | undefined, env: Environment): string[] | undefined {
  if (!target) return undefined;
  const binding = staticMemberPath(target)?.split(".")[0];
  const columns = binding && env.tables.get(binding)?.columns;
  return columns ? [...new Set(["id", ...Object.keys(columns)])] : undefined;
}
