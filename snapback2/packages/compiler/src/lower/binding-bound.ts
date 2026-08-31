import ts from "typescript";
import type { Environment, ProvenanceOrigin, VariableInfo } from "../compiler";
import { expressionProperty, unwrapExpression } from "../syntax";

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
