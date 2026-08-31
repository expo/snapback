import ts from "typescript";
import type { Environment, VariableInfo } from "../compiler";
import { unwrapExpression, walk } from "../syntax";
import { guardedWalk } from "./recursion";

export function assignedBindings(node: ts.Node): Set<string> {
  const names = new Set<string>();
  walk(node, (child) => {
    if (ts.isBinaryExpression(child) && child.operatorToken.kind === ts.SyntaxKind.EqualsToken
      && ts.isIdentifier(child.left)) names.add(child.left.text);
    if ((ts.isPostfixUnaryExpression(child) || ts.isPrefixUnaryExpression(child))
      && (child.operator === ts.SyntaxKind.PlusPlusToken || child.operator === ts.SyntaxKind.MinusMinusToken)
      && ts.isIdentifier(child.operand)) names.add(child.operand.text);
  });
  return names;
}

export function directArgument(node: ts.Expression, env: Environment): string | undefined {
  const candidates = directArgumentCandidates(node, env);
  return candidates.size === 1 ? [...candidates][0] : undefined;
}

function directArgumentCandidates(node: ts.Expression, env: Environment): Set<string> {
  return guardedWalk(env, node, "direct argument", () => directArgumentCandidatesInner(node, env));
}

function directArgumentCandidatesInner(node: ts.Expression, env: Environment): Set<string> {
  const value = unwrapExpression(node);
  if (ts.isPropertyAccessExpression(value) && ts.isIdentifier(value.expression)
    && env.variables.get(value.expression.text)?.operationComposite === "args") return new Set([value.getText(env.sourceFile)]);
  if (ts.isIdentifier(value)) {
    const info = env.variables.get(value.text);
    if (info?.operationComposite === "args") return new Set([value.text]);
    if (info?.provenanceAmbiguity?.directRewrite) return new Set([info.provenanceAmbiguity.directRewrite]);
    return info?.immutableOrigin ? directArgumentCandidates(info.immutableOrigin, env) : new Set();
  }
  // Property names are labels, never value operands. Walking `value.key` through
  // forEachChild would otherwise discover an unrelated operation argument named
  // `key` and rewrite the helper declaration instead of the authored read key.
  if (ts.isPropertyAccessExpression(value)) return directArgumentCandidates(value.expression, env);
  if (ts.isObjectLiteralExpression(value)) {
    const candidates = new Set<string>();
    for (const property of value.properties) {
      const expression = ts.isSpreadAssignment(property)
        ? property.expression
        : ts.isPropertyAssignment(property)
          ? property.initializer
          : ts.isShorthandPropertyAssignment(property)
            ? property.name
            : undefined;
      if (!expression) continue;
      for (const direct of directArgumentCandidates(expression, env)) candidates.add(direct);
    }
    return candidates;
  }
  const candidates = new Set<string>();
  value.forEachChild((child) => {
    if (!ts.isExpression(child)) return;
    for (const direct of directArgumentCandidates(child, env)) candidates.add(direct);
  });
  return candidates;
}

export function withDirectRewrite(
  binding: Pick<VariableInfo, "provenance" | "provenanceAmbiguity">,
  node: ts.Expression,
  env: Environment,
): Pick<VariableInfo, "provenance" | "provenanceAmbiguity"> {
  if (!binding.provenanceAmbiguity || binding.provenanceAmbiguity.directRewrite) return binding;
  return { ...binding, provenanceAmbiguity: { directRewrite: directArgument(node, env) } };
}

export function moduleBasename(fileName: string): string {
  return fileName.split(/[\\/]/).at(-1)!.replace(/\.[^.]+$/, "");
}
