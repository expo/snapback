import ts from "typescript";
import type { Environment, VariableInfo } from "../compiler";
import { unwrapExpression, walk } from "../syntax";

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
  const value = unwrapExpression(node);
  if (ts.isPropertyAccessExpression(value) && ts.isIdentifier(value.expression)
    && value.expression.text === "args") return value.getText(env.sourceFile);
  if (ts.isIdentifier(value)) {
    if (env.args[value.text]) return `args.${value.text}`;
    const info = env.variables.get(value.text);
    return info?.provenanceAmbiguity?.directRewrite
      ?? (info?.immutableOrigin ? directArgument(info.immutableOrigin, env) : undefined);
  }
  // Property names are labels, never value operands. Walking `value.key` through
  // forEachChild would otherwise discover an unrelated operation argument named
  // `key` and rewrite the helper declaration instead of the authored read key.
  if (ts.isPropertyAccessExpression(value)) return directArgument(value.expression, env);
  if (ts.isCallExpression(value)) {
    for (const argument of value.arguments) {
      const direct = directArgument(argument, env);
      if (direct) return direct;
    }
    return undefined;
  }
  if (ts.isObjectLiteralExpression(value)) {
    for (const property of value.properties) {
      const expression = ts.isSpreadAssignment(property)
        ? property.expression
        : ts.isPropertyAssignment(property)
          ? property.initializer
          : ts.isShorthandPropertyAssignment(property)
            ? property.name
            : undefined;
      if (!expression) continue;
      const direct = directArgument(expression, env);
      if (direct) return direct;
    }
    return undefined;
  }
  let direct: string | undefined;
  value.forEachChild((child) => {
    if (!direct && ts.isExpression(child)) direct = directArgument(child, env);
  });
  return direct;
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
