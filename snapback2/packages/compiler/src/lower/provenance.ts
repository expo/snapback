import ts from "typescript";
import type { Environment, FunctionLike, VariableInfo } from "../compiler";
import { refuse } from "../diagnostics";
import type { Provenance } from "../ir";
import {
  callName,
  isDbMember,
  propertyName,
  replaceNode,
  staticMemberPath,
  unwrapCall,
  unwrapExpression,
} from "../syntax";

type Presence = "required" | "optional";
type Classification =
  | { kind: "known"; provenance: Provenance; presence: Presence }
  | { kind: "absent" }
  | { kind: "ambiguous"; directRewrite?: string };
type KnownClassification = Extract<Classification, { kind: "known" }>;

export type ProvenanceBinding = Pick<VariableInfo, "provenance" | "provenanceAmbiguity">;

export function strictBinding(
  name: string,
  binding: VariableInfo,
  env: Environment,
  directRewrite?: string,
): VariableInfo {
  return env.mutableBindings.has(name)
    ? { ...binding, provenanceAmbiguity: { directRewrite: directRewrite ?? binding.provenanceAmbiguity?.directRewrite } }
    : binding;
}

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
  if (result.kind !== "known") refuseAmbiguous(node, env, result.kind === "ambiguous" ? result.directRewrite : undefined);
  return result.provenance;
}

export function provenanceBinding(node: ts.Expression, env: Environment): ProvenanceBinding {
  const result = classify(node, env, [], node);
  return result.kind === "known"
    ? { provenance: result.provenance }
    : {
        provenance: "Computed",
        provenanceAmbiguity: result.kind === "ambiguous" && result.directRewrite
          ? { directRewrite: result.directRewrite }
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

function classify(
  node: ts.Expression,
  env: Environment,
  path: readonly string[],
  authoredNode: ts.Expression,
): Classification {
  const value = unwrapExpression(node);
  const substituted = ts.isIdentifier(value) ? env.substitutions.get(value.text) : undefined;
  if (substituted) return classify(substituted, env, path, authoredNode);

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
    if (isRowCall(value)) return classifyRow(value, env, path);
    return path.length === 0 ? known("Computed") : ambiguous();
  }

  if (ts.isTemplateExpression(value) || ts.isBinaryExpression(value) || ts.isNewExpression(value)
    || ts.isPrefixUnaryExpression(value) || ts.isConditionalExpression(value)) {
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
  if (node.text === "args") {
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
  if (node.text === "ctx") {
    if (path.length === 0) return known("Viewer");
    return path[0] === "viewer" ? known("Viewer") : absent();
  }

  const info = env.variables.get(node.text);
  if (!info) return ambiguous();
  if (info.provenanceAmbiguity) return ambiguous(info.provenanceAmbiguity.directRewrite);
  if (info.rowBinding) return classifyBoundRow(info, path);
  if (info.immutableOrigin) return classify(info.immutableOrigin, env, path, authoredNode);
  if (path.length === 0 || info.provenance === "Arg" || info.provenance === "Viewer" || info.provenance === "Const") {
    return known(info.provenance);
  }
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
    } else if (ts.isShorthandPropertyAssignment(property) && property.name.text === selected) {
      candidate = classify(property.name, env, rest, authoredNode);
    } else if (ts.isPropertyAssignment(property) && propertyName(property.name) === selected) {
      candidate = classify(property.initializer, env, rest, authoredNode);
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

function combineAlternatives(values: Classification[], presence: Presence): Classification {
  const knownValues = values.filter((value): value is KnownClassification => value.kind === "known");
  if (knownValues.length !== values.length) return ambiguous();
  const first = knownValues[0]?.provenance;
  if (!first || knownValues.some((value) => value.provenance !== first)) return ambiguous();
  return { kind: "known", provenance: first, presence };
}

function known(provenance: Provenance): KnownClassification {
  return { kind: "known", provenance, presence: "required" };
}

function absent(): Classification {
  return { kind: "absent" };
}

function ambiguous(directRewrite?: string): Classification {
  return directRewrite ? { kind: "ambiguous", directRewrite } : { kind: "ambiguous" };
}

function isRowCall(call: ts.CallExpression): boolean {
  return callName(call).endsWith(".get") && isDbMember(call.expression);
}

function rowFields(target: ts.Expression | undefined, env: Environment): string[] | undefined {
  if (!target) return undefined;
  const path = staticMemberPath(target);
  const binding = path?.split(".")[0];
  const columns = binding && env.tables.get(binding)?.columns;
  return columns ? [...new Set(["id", ...Object.keys(columns)])] : undefined;
}

function refuseAmbiguous(node: ts.Expression, env: Environment, directRewrite?: string): never {
  const firstArg = Object.keys(env.args)[0];
  const fallback = directRewrite ?? (firstArg ? `args.${firstArg}` : "null");
  const value = unwrapExpression(node);
  const replacement = ts.isArrayLiteralExpression(value)
    ? `[${value.elements.map((element) => {
        const expression = ts.isSpreadElement(element) ? element.expression : element;
        const classified = classify(expression, env, [], node);
        return classified.kind === "known"
          ? element.getText(env.sourceFile)
          : classified.kind === "ambiguous" && classified.directRewrite
            ? classified.directRewrite
            : fallback;
      }).join(", ")}]`
    : fallback;
  refuse(
    env,
    "E_PROVENANCE_AMBIGUOUS",
    node,
    "read key provenance is ambiguous; each key must follow one direct origin rule",
    replaceNode(env.source, node, replacement),
  );
}

export function combineProvenance(values: Provenance[]): Provenance {
  if (values.includes("Computed")) return "Computed";
  const meaningful = new Set(values.filter((value) => value !== "Const"));
  if (meaningful.size === 0) return "Const";
  if (meaningful.size === 1) return [...meaningful][0]!;
  return "Shape";
}

export function expandHelper(
  node: ts.Expression,
  env: Environment,
): { expression: ts.Expression; environment: Environment } | undefined {
  const call = unwrapCall(node);
  if (!call || !ts.isIdentifier(call.expression)) return undefined;
  const helper = env.helpers.get(call.expression.text);
  if (!helper) return undefined;
  if (env.helperStack.includes(call.expression.text)) {
    refuse(env, "E_OPAQUE", call, "recursive helper is not inlineable");
  }
  const body = helperBodyExpression(helper);
  if (!body) refuse(env, "E_OPAQUE", helper, "helper must be a single pure return expression");
  const next: Environment = {
    ...env,
    variables: new Map([...env.variables].map(([name, info]) => [name, { ...info }])),
    substitutions: new Map(env.substitutions),
    helperStack: [...env.helperStack, call.expression.text],
  };
  helper.parameters.forEach((parameter, index) => {
    if (!ts.isIdentifier(parameter.name) || !call.arguments[index]) {
      refuse(env, "E_OPAQUE", parameter, "helper parameters must be positional identifiers");
    }
    const argument = call.arguments[index]!;
    if (!ts.isIdentifier(argument) || argument.text !== parameter.name.text) {
      next.substitutions.set(parameter.name.text, argument);
    }
  });
  return { expression: body, environment: next };
}

function helperBodyExpression(helper: FunctionLike): ts.Expression | undefined {
  if (!helper.body) return undefined;
  if (!ts.isBlock(helper.body)) return helper.body;
  if (helper.body.statements.length !== 1 || !ts.isReturnStatement(helper.body.statements[0])) return undefined;
  return helper.body.statements[0].expression;
}

export function isRowExpression(node: ts.Expression, env: Environment): boolean {
  const value = unwrapExpression(node);
  const substituted = ts.isIdentifier(value) ? env.substitutions.get(value.text) : undefined;
  if (substituted) return isRowExpression(substituted, env);
  if (ts.isIdentifier(value)) return env.variables.get(value.text)?.rowBinding === true;
  const call = unwrapCall(value);
  if (!call) return false;
  const expanded = expandHelper(call, env);
  if (expanded) return isRowExpression(expanded.expression, expanded.environment);
  return isRowCall(call);
}

export function isRowCollectionExpression(node: ts.Expression, env: Environment): boolean {
  const value = unwrapExpression(node);
  const substituted = ts.isIdentifier(value) ? env.substitutions.get(value.text) : undefined;
  if (substituted) return isRowCollectionExpression(substituted, env);
  if (ts.isIdentifier(value)) return env.variables.get(value.text)?.rowCollection === true;
  const call = unwrapCall(value);
  if (!call) return false;
  const expanded = expandHelper(call, env);
  if (expanded) return isRowCollectionExpression(expanded.expression, expanded.environment);
  if (callName(call).endsWith(".scan") && isDbMember(call.expression)) return true;
  return ts.isPropertyAccessExpression(call.expression) && call.expression.name.text === "filter"
    && isRowCollectionExpression(call.expression.expression, env);
}
