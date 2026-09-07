import ts from "typescript";
import { requiredType } from "../authored-types";
import { refuse } from "../diagnostics";
import { contextualNodeKey, unwrapExpression } from "../syntax";
import { operationArgumentList } from "./binding-bound";
import { selectExpressionMember } from "./collection-origins";
import { sameSourceBinding } from "./descriptor-origin";
import type { Environment, ProvenanceOrigin } from "./environment";
import { expandHelper } from "./helper-expansion";
import { guardedWalk } from "./recursion";

// @ref LLP 1011#null-keys-and-id-literals-2026-09-05 — a static maximum never proves presence. Keep optional-origin checks independent of cardinality and TS assertions.
export function requirePresentCollection(node: ts.Expression, env: Environment): void {
  if (mayBeAbsent(node, env)) refuse(env, "E_UNBOUND_LOOP", node,
    "optional list domain requires an empty default or a proven presence branch",
    `${node.getText(env.sourceFile)} ?? []`);
}

function optionalArgument(name: string, env: Environment): boolean {
  const type = env.args[name];
  return !!type && typeof type !== "string" && "Optional" in type;
}

function mayBeAbsent(node: ts.Expression, env: Environment): boolean {
  return guardedWalk(env, node, "collection presence", () => {
    const value = unwrapExpression(node);
    if (presenceGuard(value, env)) return false;
    if (value.kind === ts.SyntaxKind.NullKeyword) return true;
    if (ts.isBinaryExpression(value) && value.operatorToken.kind === ts.SyntaxKind.QuestionQuestionToken)
      return mayBeAbsent(value.left, env) && mayBeAbsent(value.right, env);
    if (ts.isConditionalExpression(value)) return mayBeAbsent(value.whenTrue, env) || mayBeAbsent(value.whenFalse, env);
    const originAbsent = (origin: ProvenanceOrigin): boolean => "expression" in origin
      ? mayBeAbsent(origin.expression, origin.environment)
      : !!(origin.binding.operationArgument && optionalArgument(origin.binding.operationArgument, env))
        || !!origin.binding.alternativeOrigins?.some(originAbsent)
        || !!(origin.binding.immutableOrigin && originAbsent(origin.binding.immutableOrigin));
    if (ts.isIdentifier(value)) {
      const substitution = env.substitutions.get(value.text);
      if (substitution) return mayBeAbsent(substitution.expression, substitution.environment);
      const info = env.variables.get(value.text);
      if (info?.alternativeOrigins) return info.alternativeOrigins.some(originAbsent);
      if (info?.immutableOrigin) return originAbsent(info.immutableOrigin);
    }
    const argument = operationArgumentList(value, env);
    if (argument) return optionalArgument(argument.name, env);
    if (ts.isPropertyAccessExpression(value)) {
      const selected = selectExpressionMember(value.expression, env, value.name.text);
      if (selected.kind === "found" && (selected.presence === "optional" || selected.origins.some(originAbsent))) return true;
    }
    const helper = expandHelper(value, env);
    if (helper) return mayBeAbsent(helper.expression, helper.environment);
    const type = env.expressionTypes.get(contextualNodeKey(env.literalContext, value, env.sourceFile));
    return type?.kind === "optional" && requiredType(type).kind === "list";
  });
}

function sameReference(left: ts.Expression, right: ts.Expression): boolean {
  const a = unwrapExpression(left), b = unwrapExpression(right);
  if (ts.isIdentifier(a) && ts.isIdentifier(b)) return sameSourceBinding(a, b);
  return ts.isPropertyAccessExpression(a) && ts.isPropertyAccessExpression(b)
    && a.name.text === b.name.text && sameReference(a.expression, b.expression);
}

function presenceGuard(value: ts.Expression, env: Environment): boolean {
  let base = value;
  while (ts.isPropertyAccessExpression(base)) base = unwrapExpression(base.expression);
  if (!ts.isIdentifier(base)) return false;
  const info = env.variables.get(base.text);
  // Flow through a reassigned binding needs a separate proof; a const snapshot
  // or an operation argument cannot change between this guard and its use.
  if (!info || info.collectionDeclaration && env.mutableBindings.has(info.collectionDeclaration)) return false;
  for (let child: ts.Node = value, parent = child.parent; parent; child = parent, parent = parent.parent) {
    if (ts.isFunctionLike(parent)) break;
    if (!ts.isIfStatement(parent) || child !== parent.thenStatement) continue;
    const condition = unwrapExpression(parent.expression);
    if (!ts.isBinaryExpression(condition) || condition.operatorToken.kind !== ts.SyntaxKind.ExclamationEqualsToken) continue;
    if (condition.right.kind === ts.SyntaxKind.NullKeyword && sameReference(value, condition.left)
      || condition.left.kind === ts.SyntaxKind.NullKeyword && sameReference(value, condition.right)) return true;
  }
  return false;
}
