import ts from "typescript";
import type { Environment, ProvenanceOrigin, VariableInfo } from "../compiler";
import { expressionProperty, unwrapExpression } from "../syntax";

export function operationArgumentList(
  node: ts.Expression,
  env: Environment,
): { name: string; max?: number } | undefined {
  const value = unwrapExpression(node);
  if (!ts.isPropertyAccessExpression(value)) return undefined;
  const base = unwrapExpression(value.expression);
  if (!ts.isIdentifier(base) || env.variables.get(base.text)?.operationComposite !== "args") return undefined;
  const argument = env.args[value.name.text];
  return {
    name: value.name.text,
    ...(argument && typeof argument !== "string" && "List" in argument ? { max: argument.List.max } : {}),
  };
}

export function alternativeMemberBound(
  info: VariableInfo,
  member: string,
  bound: (node: ts.Expression, env: Environment) => number | undefined,
): number | undefined {
  if (!info.alternativeOrigins || info.alternativeOrigins.length === 0) return undefined;
  const values = info.alternativeOrigins.map((origin) => originMemberBound(origin, member, bound));
  return values.every((value): value is number => value !== undefined) ? Math.max(...values) : undefined;
}

function originMemberBound(
  origin: ProvenanceOrigin,
  member: string,
  bound: (node: ts.Expression, env: Environment) => number | undefined,
): number | undefined {
  if ("binding" in origin) return alternativeMemberBound(origin.binding, member, bound);
  const value = unwrapExpression(origin.expression);
  if (!ts.isObjectLiteralExpression(value)) return undefined;
  const selected = expressionProperty(value, member)
    ?? value.properties.find((property): property is ts.ShorthandPropertyAssignment =>
      ts.isShorthandPropertyAssignment(property) && property.name.text === member)?.name;
  return selected ? bound(selected, origin.environment) : undefined;
}
