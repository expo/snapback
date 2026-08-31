import ts from "typescript";
import type { Environment } from "../compiler";
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
  if (ts.isIdentifier(value) && env.args[value.text]) return `args.${value.text}`;
  if (ts.isCallExpression(value)) {
    for (const argument of value.arguments) {
      const direct = directArgument(argument, env);
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

export function moduleBasename(fileName: string): string {
  return fileName.split(/[\\/]/).at(-1)!.replace(/\.[^.]+$/, "");
}
