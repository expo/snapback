import ts from "typescript";
import type { Environment, ProvenanceOrigin, VariableInfo } from "../compiler";
import { refuse } from "../diagnostics";
import type { Provenance } from "../ir";
import { guardedWalk } from "./recursion";
import {
  callName,
  isDbMember,
  propertyName,
  replaceNode,
  staticMemberPath,
  unwrapCall,
  unwrapExpression,
} from "../syntax";
import { collectionElementOrigins, originDirectCandidates, selectExpressionMember, snapshotEnvironment } from "./collection-origins";
import { expandHelper } from "./helper-expansion";
import {
  candidateAmbiguity,
  directOriginCandidates,
  isOperationCompositeBinding,
  UNKNOWN_DIRECT_ORIGIN,
} from "./operation-context";

type Presence = "required" | "optional";
type Classification =
  | { kind: "known"; provenance: Provenance; presence: Presence; candidates?: string[] }
  | { kind: "absent" }
  | { kind: "ambiguous"; directRewrite?: string; candidates?: string[] };
type KnownClassification = Extract<Classification, { kind: "known" }>;

export type ProvenanceBinding = Pick<VariableInfo, "provenance" | "provenanceAmbiguity">;

/**
 * @ref LLP 1002#2-the-authored-surface-the-snapback2-module — this is the one
 * recursive implementation of the closed provenance rules. A member selection
 * is a path through the same domain as its base: operation composites, helper
 * substitutions, immutable aliases, rows, nested literals, and ordered spreads
 * do not get separate provenance shortcuts.
 */
export function provenance(node: ts.Expression, env: Environment): Provenance {
  const result = classify(node, env, [], node);
  return result.kind === "known" ? result.provenance : "Computed";
}

export function readProvenance(node: ts.Expression, env: Environment): Provenance {
  const result = classify(node, env, [], node);
  if (result.kind !== "known") {
    refuseAmbiguous(node, env, result.kind === "ambiguous" ? result.directRewrite : undefined,
      result.kind === "ambiguous" ? result.candidates : undefined);
  }
  return result.provenance;
}

export function provenanceBinding(node: ts.Expression, env: Environment): ProvenanceBinding {
  const result = classify(node, env, [], node);
  return result.kind === "known"
    ? { provenance: result.provenance }
    : {
        provenance: "Computed",
        provenanceAmbiguity: result.kind === "ambiguous"
          ? candidateAmbiguity(
              result.candidates ?? (result.directRewrite ? [result.directRewrite] : [UNKNOWN_DIRECT_ORIGIN]),
            )
          : {},
      };
}

export function combinedProvenanceBinding(nodes: readonly ts.Expression[], env: Environment): ProvenanceBinding {
  const bindings = nodes.map((node) => provenanceBinding(node, env));
  const ambiguous = bindings.find((binding) => binding.provenanceAmbiguity);
  return ambiguous
    ? { provenance: "Computed", provenanceAmbiguity: { ...ambiguous.provenanceAmbiguity } }
    : { provenance: combineProvenance(bindings.map((binding) => binding.provenance)) };
}

export function collectionElementBinding(node: ts.Expression, env: Environment): VariableInfo {
  const origins = collectionElementOrigins(node, env);
  if (!origins || origins.length === 0) {
    return { ...provenanceBinding(node, env), provenanceAmbiguity: {} };
  }
  const classified = combineAlternatives(
    origins.map((origin) => classifyOrigin(origin, [], node)),
    "required",
    originDirectCandidates(origins),
  );
  return {
    ...(classified.kind === "known"
      ? { provenance: classified.provenance }
      : {
          provenance: "Computed" as const,
          provenanceAmbiguity: candidateAmbiguity(
            classified.kind === "ambiguous"
              ? classified.candidates ?? [UNKNOWN_DIRECT_ORIGIN]
              : originDirectCandidates(origins),
          ),
        }),
    alternativeOrigins: origins,
  };
}

export function collectionOriginsBinding(
  origins: readonly ProvenanceOrigin[],
  authoredNode: ts.Expression,
): ProvenanceBinding {
  const classified = combineAlternatives(
    origins.map((origin) => classifyOrigin(origin, [], authoredNode)),
    "required",
    originDirectCandidates(origins),
  );
  return classified.kind === "known"
    ? { provenance: classified.provenance }
    : {
        provenance: "Computed",
        provenanceAmbiguity: candidateAmbiguity(
          classified.kind === "ambiguous" ? classified.candidates ?? originDirectCandidates(origins) : originDirectCandidates(origins),
        ),
      };
}

function classify(
  node: ts.Expression,
  env: Environment,
  path: readonly string[],
  authoredNode: ts.Expression,
): Classification {
  return guardedWalk(env, node, "provenance", () => classifyInner(node, env, path, authoredNode));
}

function classifyInner(
  node: ts.Expression,
  env: Environment,
  path: readonly string[],
  authoredNode: ts.Expression,
): Classification {
  const value = unwrapExpression(node);
  const substituted = ts.isIdentifier(value) ? env.substitutions.get(value.text) : undefined;
  if (substituted) return classify(substituted.expression, substituted.environment, path, authoredNode);

  if (ts.isIdentifier(value)) return classifyIdentifier(value, env, path, authoredNode);
  if (ts.isPropertyAccessExpression(value)) {
    return classify(value.expression, env, [value.name.text, ...path], authoredNode);
  }

  if (ts.isStringLiteralLike(value) || ts.isNumericLiteral(value)
    || value.kind === ts.SyntaxKind.NullKeyword || value.kind === ts.SyntaxKind.TrueKeyword
    || value.kind === ts.SyntaxKind.FalseKeyword) {
    return path.length === 0 ? known("Const") : ambiguous();
  }

  if (ts.isObjectLiteralExpression(value)) {
    return path.length === 0
      ? classifyObject(value, env, authoredNode)
      : classifyObjectMember(value, env, path, authoredNode);
  }
  if (ts.isArrayLiteralExpression(value)) {
    if (path.length > 0) return ambiguous();
    return combineClassifications(value.elements.map((element) => {
      const expression = ts.isSpreadElement(element) ? element.expression : element;
      return classify(expression, env, [], authoredNode);
    }));
  }

  if (ts.isCallExpression(value)) {
    const expanded = expandHelper(value, env);
    if (expanded) return classify(expanded.expression, expanded.environment, path, authoredNode);
    if (isRowCall(value, env)) return classifyRow(value, env, path);
    return path.length === 0 ? known("Computed") : ambiguous();
  }

  if (ts.isConditionalExpression(value)) {
    return path.length === 0
      ? known("Computed")
      : combineAlternatives([
          classify(value.whenTrue, env, path, authoredNode),
          classify(value.whenFalse, env, path, authoredNode),
        ], "required");
  }

  if (ts.isTemplateExpression(value) || ts.isBinaryExpression(value) || ts.isNewExpression(value)
    || ts.isPrefixUnaryExpression(value)) {
    return path.length === 0 ? known("Computed") : ambiguous();
  }

  if (path.length > 0) return ambiguous();
  const children: Classification[] = [];
  value.forEachChild((child) => {
    if (ts.isExpression(child)) children.push(classify(child, env, [], authoredNode));
  });
  return combineClassifications(children);
}

function classifyIdentifier(
  node: ts.Identifier,
  env: Environment,
  path: readonly string[],
  authoredNode: ts.Expression,
): Classification {
  const info = env.variables.get(node.text);
  if (!info) return ambiguous();
  if (info.provenanceAmbiguity) {
    return ambiguous(info.provenanceAmbiguity.directRewrite, info.provenanceAmbiguity.candidates);
  }
  if (info.operationComposite === "args") {
    if (path.length === 0) {
      return Object.keys(env.args).length === 0 ? known("Const") : known("Arg");
    }
    const descriptor = env.args[path[0]!];
    if (!descriptor) return absent();
    return {
      ...known("Arg"),
      presence: typeof descriptor !== "string" && "Optional" in descriptor ? "optional" : "required",
    };
  }
  if (info.operationComposite === "ctx") {
    if (path.length === 0) return known("Viewer");
    return path[0] === "viewer" ? known("Viewer") : absent();
  }
  if (info.alternativeOrigins) {
    return combineAlternatives(
      info.alternativeOrigins.map((origin) => classifyOrigin(origin, path, authoredNode)),
      "required",
      originDirectCandidates(info.alternativeOrigins),
    );
  }
  if (info.rowBinding) return classifyBoundRow(info, path);
  if (info.immutableOrigin) {
    return classify(info.immutableOrigin.expression, info.immutableOrigin.environment, path, authoredNode);
  }
  if (path.length === 0 || info.provenance === "Arg" || info.provenance === "Viewer" || info.provenance === "Const") {
    return known(info.provenance);
  }
  return ambiguous();
}

function classifyOrigin(
  origin: ProvenanceOrigin,
  path: readonly string[],
  authoredNode: ts.Expression,
): Classification {
  return "expression" in origin
    ? classify(origin.expression, origin.environment, path, authoredNode)
    : classifyBinding(origin.binding, path, authoredNode);
}

function classifyBinding(
  info: VariableInfo,
  path: readonly string[],
  authoredNode: ts.Expression,
): Classification {
  if (info.provenanceAmbiguity) {
    return ambiguous(info.provenanceAmbiguity.directRewrite, info.provenanceAmbiguity.candidates);
  }
  if (info.alternativeOrigins) {
    return combineAlternatives(
      info.alternativeOrigins.map((origin) => classifyOrigin(origin, path, authoredNode)),
      "required",
      originDirectCandidates(info.alternativeOrigins),
    );
  }
  if (info.rowBinding) return classifyBoundRow(info, path);
  if (path.length === 0) return known(info.provenance);
  return ambiguous();
}

function classifyObject(
  node: ts.ObjectLiteralExpression,
  env: Environment,
  authoredNode: ts.Expression,
): Classification {
  const members: Classification[] = [];
  for (const property of node.properties) {
    if (ts.isSpreadAssignment(property)) {
      members.push(classify(property.expression, env, [], authoredNode));
    } else if (ts.isShorthandPropertyAssignment(property)) {
      members.push(classify(property.name, env, [], authoredNode));
    } else if (ts.isPropertyAssignment(property)) {
      members.push(classify(property.initializer, env, [], authoredNode));
    } else {
      members.push(ambiguous());
    }
  }
  return combineClassifications(members);
}

function classifyObjectMember(
  node: ts.ObjectLiteralExpression,
  env: Environment,
  path: readonly string[],
  authoredNode: ts.Expression,
): Classification {
  const [selected, ...rest] = path;
  const laterOptional: Classification[] = [];
  for (const property of [...node.properties].reverse()) {
    let candidate: Classification | undefined;
    if (ts.isSpreadAssignment(property)) {
      candidate = classify(property.expression, env, path, authoredNode);
      const selectedOrigins = selectExpressionMember(property.expression, env, selected!);
      if (selectedOrigins.kind === "found") {
        candidate = withCandidates(candidate, originDirectCandidates(selectedOrigins.origins));
      }
    } else if (ts.isShorthandPropertyAssignment(property) && property.name.text === selected) {
      candidate = withCandidates(
        classify(property.name, env, rest, authoredNode),
        [...directOriginCandidates(property.name, env)],
      );
    } else if (ts.isPropertyAssignment(property) && propertyName(property.name) === selected) {
      candidate = withCandidates(
        classify(property.initializer, env, rest, authoredNode),
        [...directOriginCandidates(property.initializer, env)],
      );
    }
    if (!candidate || candidate.kind === "absent") continue;
    if (candidate.kind === "ambiguous") return candidate;
    if (candidate.presence === "optional") {
      laterOptional.push(candidate);
      continue;
    }
    return combineAlternatives([...laterOptional, candidate], "required");
  }
  return laterOptional.length > 0 ? combineAlternatives(laterOptional, "optional") : absent();
}

function classifyBoundRow(info: VariableInfo, path: readonly string[]): Classification {
  if (path.length === 0) return known("Shape");
  if (info.objectFields && !info.objectFields.includes(path[0]!)) return absent();
  if (path.length > 1) return ambiguous();
  return { ...known("Shape"), presence: info.nullableRead ? "optional" : "required" };
}

function classifyRow(call: ts.CallExpression, env: Environment, path: readonly string[]): Classification {
  if (path.length === 0) return known("Shape");
  const fields = rowFields(call.arguments[0], env);
  if (fields && !fields.includes(path[0]!)) return absent();
  if (path.length > 1) return ambiguous();
  return { ...known("Shape"), presence: "optional" };
}

function combineClassifications(values: Classification[]): Classification {
  const ambiguousValue = values.find((value) => value.kind === "ambiguous");
  if (ambiguousValue?.kind === "ambiguous") return ambiguousValue;
  const provenances = values.flatMap((value) => value.kind === "known" ? [value.provenance] : []);
  return known(combineProvenance(provenances));
}

function combineAlternatives(
  values: Classification[],
  presence: Presence,
  candidates: string[] = [],
): Classification {
  const knownValues = values.filter((value): value is KnownClassification => value.kind === "known");
  const inherited = values.flatMap((value) => value.kind === "absent" ? [] : value.candidates ?? []);
  const allCandidates = [...new Set([...candidates, ...inherited])];
  if (knownValues.length !== values.length) {
    return ambiguous(undefined, [...new Set([...allCandidates, UNKNOWN_DIRECT_ORIGIN])]);
  }
  const first = knownValues[0]?.provenance;
  if (!first || knownValues.some((value) => value.provenance !== first)) return ambiguous(undefined, allCandidates);
  return {
    kind: "known",
    provenance: first,
    presence,
    ...(allCandidates.length > 0 ? { candidates: allCandidates } : {}),
  };
}

function known(provenance: Provenance, candidates?: string[]): KnownClassification {
  return {
    kind: "known",
    provenance,
    presence: "required",
    ...(candidates && candidates.length > 0 ? { candidates } : {}),
  };
}

function absent(): Classification {
  return { kind: "absent" };
}

function ambiguous(directRewrite?: string, candidates?: string[]): Classification {
  return {
    kind: "ambiguous",
    ...(directRewrite ? { directRewrite } : {}),
    ...(candidates && candidates.length > 0 ? { candidates } : {}),
  };
}

function withCandidates(value: Classification, candidates: string[]): Classification {
  if (value.kind === "absent" || candidates.length === 0) return value;
  return { ...value, candidates: [...new Set([...(value.candidates ?? []), ...candidates])] };
}

function isRowCall(call: ts.CallExpression, env: Environment): boolean {
  return callName(call).endsWith(".get")
    && isDbMember(call.expression, (binding) => isOperationCompositeBinding(binding, "db", env));
}

function rowFields(target: ts.Expression | undefined, env: Environment): string[] | undefined {
  if (!target) return undefined;
  const path = staticMemberPath(target);
  const binding = path?.split(".")[0];
  const columns = binding && env.tables.get(binding)?.columns;
  return columns ? [...new Set(["id", ...Object.keys(columns)])] : undefined;
}

function refuseAmbiguous(
  node: ts.Expression,
  env: Environment,
  directRewrite?: string,
  directCandidates?: string[],
): never {
  const value = unwrapExpression(node);
  const choices: string[] = [];
  const replacementFor = (expression: ts.Expression, direct?: string, candidates?: string[]): string => {
    const choice = honestRewrite(expression, env, direct, candidates);
    choices.push(...choice.candidates);
    return choice.replacement;
  };
  const replacement = ts.isArrayLiteralExpression(value)
    ? `[${value.elements.map((element) => {
        const expression = ts.isSpreadElement(element) ? element.expression : element;
        const classified = classify(expression, env, [], node);
        return classified.kind === "known"
          ? element.getText(env.sourceFile)
          : classified.kind === "ambiguous" && classified.directRewrite
            ? replacementFor(expression, classified.directRewrite)
            : replacementFor(expression, undefined, classified.kind === "ambiguous" ? classified.candidates : undefined);
      }).join(", ")}]`
    : replacementFor(value, directRewrite, directCandidates);
  const candidates = [...new Set(choices)];
  const candidateMessage = candidates.length > 0 ? `; candidate direct origins: ${candidates.join(", ")}` : "";
  refuse(
    env,
    "E_PROVENANCE_AMBIGUOUS",
    node,
    `read key provenance is ambiguous; each key must follow one direct origin rule${candidateMessage}`,
    replaceNode(env.source, node, replacement),
  );
}

function honestRewrite(
  node: ts.Expression,
  env: Environment,
  directRewrite?: string,
  directCandidates?: string[],
): { replacement: string; candidates: string[] } {
  const discovered = [...new Set([
    ...(directCandidates ?? []),
    ...(directRewrite ? [directRewrite] : []),
  ])];
  if (discovered.length === 1 && discovered[0] !== UNKNOWN_DIRECT_ORIGIN) {
    return { replacement: discovered[0]!, candidates: discovered };
  }
  if (discovered.length > 1) return sentinelRewrite(discovered);
  return sentinelRewrite(discovered.length === 0 ? [UNKNOWN_DIRECT_ORIGIN] : discovered);
}

function sentinelRewrite(candidates: string[]): { replacement: string; candidates: string[] } {
  const description = candidates.length > 0 ? candidates.join(" | ") : "no bound direct origins";
  return {
    replacement: `(() => { throw new Error(${JSON.stringify(`E_PROVENANCE_AMBIGUOUS: choose one direct origin: ${description}`)}); })()`,
    candidates,
  };
}

export function combineProvenance(values: Provenance[]): Provenance {
  if (values.includes("Computed")) return "Computed";
  const meaningful = new Set(values.filter((value) => value !== "Const"));
  if (meaningful.size === 0) return "Const";
  if (meaningful.size === 1) return [...meaningful][0]!;
  return "Shape";
}

export { expandHelper } from "./helper-expansion";

export function isRowExpression(node: ts.Expression, env: Environment): boolean {
  return guardedWalk(env, node, "row expression", () => isRowExpressionInner(node, env));
}

function isRowExpressionInner(node: ts.Expression, env: Environment): boolean {
  const value = unwrapExpression(node);
  const substituted = ts.isIdentifier(value) ? env.substitutions.get(value.text) : undefined;
  if (substituted) return isRowExpression(substituted.expression, substituted.environment);
  if (ts.isIdentifier(value)) return env.variables.get(value.text)?.rowBinding === true;
  const call = unwrapCall(value);
  if (!call) return false;
  const expanded = expandHelper(call, env);
  if (expanded) return isRowExpression(expanded.expression, expanded.environment);
  return isRowCall(call, env);
}

export function isRowCollectionExpression(node: ts.Expression, env: Environment): boolean {
  return guardedWalk(env, node, "row collection", () => isRowCollectionExpressionInner(node, env));
}

function isRowCollectionExpressionInner(node: ts.Expression, env: Environment): boolean {
  const value = unwrapExpression(node);
  const substituted = ts.isIdentifier(value) ? env.substitutions.get(value.text) : undefined;
  if (substituted) return isRowCollectionExpression(substituted.expression, substituted.environment);
  if (ts.isIdentifier(value)) return env.variables.get(value.text)?.rowCollection === true;
  const call = unwrapCall(value);
  if (!call) return false;
  const expanded = expandHelper(call, env);
  if (expanded) return isRowCollectionExpression(expanded.expression, expanded.environment);
  if (callName(call).endsWith(".scan")
    && isDbMember(call.expression, (binding) => isOperationCompositeBinding(binding, "db", env))) return true;
  if (!ts.isPropertyAccessExpression(call.expression)) return false;
  if (["filter", "sort", "slice"].includes(call.expression.name.text)) {
    return isRowCollectionExpression(call.expression.expression, env);
  }
  if (call.expression.name.text === "flatMap") {
    if (!isRowCollectionExpression(call.expression.expression, env)) return false;
    const callback = call.arguments[0];
    if (!callback || !ts.isArrowFunction(callback) && !ts.isFunctionExpression(callback)
      || callback.parameters.length === 0 || !ts.isIdentifier(callback.parameters[0]!.name)
      || ts.isBlock(callback.body)) return false;
    const body = unwrapExpression(callback.body);
    if (!ts.isArrayLiteralExpression(body)) return false;
    const callbackEnv = snapshotEnvironment(env);
    callbackEnv.variables.set(callback.parameters[0].name.text, {
      provenance: "Shape",
      rowBinding: true,
      objectFields: rowFields(call.expression.expression, env),
    });
    return body.elements.every((element) => !ts.isSpreadElement(element) && isRowExpression(element, callbackEnv));
  }
  if (call.expression.name.text !== "map") return false;
  const callback = call.arguments[0];
  if (!callback || !ts.isArrowFunction(callback) && !ts.isFunctionExpression(callback)
    || callback.parameters.length === 0 || !ts.isIdentifier(callback.parameters[0]!.name)
    || ts.isBlock(callback.body)) return false;
  const body = unwrapExpression(callback.body);
  return ts.isIdentifier(body) && body.text === callback.parameters[0].name.text
    && isRowCollectionExpression(call.expression.expression, env);
}
