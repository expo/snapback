import ts from "typescript";
import type { Environment } from "./environment";
import { unwrapExpression } from "../syntax";

export function optionalCursorArgumentNames(
  node: ts.Expression | undefined,
  env: Environment,
  table: string,
  index: string,
  prefixLength: number,
): string[] {
  if (!node) return [];
  const value = unwrapExpression(node);
  const components = ts.isArrayLiteralExpression(value) ? [...value.elements] : [value];
  const names = components.map((component) => {
    const item = unwrapExpression(component);
    if (!ts.isPropertyAccessExpression(item)) return undefined;
    const base = unwrapExpression(item.expression);
    return ts.isIdentifier(base) && env.variables.get(base.text)?.operationComposite === "args"
      ? item.name.text
      : undefined;
  });
  if (names.some((name) => name === undefined)) return [];
  if (!names.every((name) => {
    const descriptor = env.args[name!];
    return typeof descriptor !== "string" && descriptor !== undefined && "Optional" in descriptor;
  })) return [];
  const tableInfo = [...env.tables.values()].find((candidate) => candidate.name === table);
  const suffixTypes = tableInfo?.indexes?.[index]?.types.slice(prefixLength);
  if (!suffixTypes || suffixTypes.length !== names.length || suffixTypes.some((type) => type.kind === "optional")) return [];
  return names as string[];
}
