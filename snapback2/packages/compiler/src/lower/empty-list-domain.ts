import ts from "typescript";
import type { Environment, ProvenanceOrigin, VariableInfo } from "./environment";
import { operationArgumentList } from "./binding-bound";
import { selectExpressionMember } from "./collection-origins";
import { guardedWalk } from "./recursion";
import { unwrapExpression } from "../syntax";

type ArgumentDomain = { name: string; max: number; emptyDefault: boolean };

// @ref LLP 1017#32-the-rule — retain the genuine unrebound argument origin for an empty-default loop. A branch-assigned coalescing temporary has no native population proof.
export function emptyDefaultArgument(node: ts.Expression, env: Environment): ArgumentDomain | undefined {
  const found = argumentDomain(node, env);
  return found?.emptyDefault ? found : undefined;
}

function argumentDomain(node: ts.Expression, env: Environment): ArgumentDomain | undefined {
  return guardedWalk(env, node, "empty-default argument domain", () => {
    const value = unwrapExpression(node);
    const argument = operationArgumentList(value, env);
    if (argument?.max !== undefined) return { ...argument, max: argument.max, emptyDefault: false };
    if (ts.isBinaryExpression(value) && value.operatorToken.kind === ts.SyntaxKind.QuestionQuestionToken) {
      const fallback = unwrapExpression(value.right);
      if (!ts.isArrayLiteralExpression(fallback) || fallback.elements.length !== 0) return undefined;
      const left = argumentDomain(value.left, env);
      return left && { ...left, emptyDefault: true };
    }
    if (ts.isIdentifier(value)) {
      // Helper actuals have their own evaluation custody. Leave those domains
      // on the general path instead of replaying or dropping their evaluation.
      if (env.substitutions.has(value.text)) return undefined;
      return bindingDomain(env.variables.get(value.text), env);
    }
    if (ts.isPropertyAccessExpression(value) && stableReference(value.expression, env)) {
      const selected = selectExpressionMember(value.expression, env, value.name.text);
      if (selected.kind !== "found" || selected.origins.length !== 1) return undefined;
      return originDomain(selected.origins[0]!, env);
    }
    return undefined;
  });
}

function bindingDomain(info: VariableInfo | undefined, env: Environment): ArgumentDomain | undefined {
  if (!info || info.mutatedCollection || info.collectionDeclaration && env.mutableBindings.has(info.collectionDeclaration)) return undefined;
  if (info.immutableOrigin) return argumentDomain(info.immutableOrigin.expression, info.immutableOrigin.environment);
  if (info.operationArgument && info.max !== undefined) return { name: info.operationArgument, max: info.max, emptyDefault: false };
  return undefined;
}

function originDomain(origin: ProvenanceOrigin, env: Environment): ArgumentDomain | undefined {
  return "expression" in origin
    ? argumentDomain(origin.expression, origin.environment)
    : bindingDomain(origin.binding, env);
}

function stableReference(node: ts.Expression, env: Environment): boolean {
  const value = unwrapExpression(node);
  if (ts.isPropertyAccessExpression(value)) return stableReference(value.expression, env);
  if (!ts.isIdentifier(value) || env.substitutions.has(value.text)) return false;
  const info = env.variables.get(value.text);
  return !!info && !info.mutatedCollection
    && !(info.collectionDeclaration && env.mutableBindings.has(info.collectionDeclaration));
}
