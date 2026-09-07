import ts from "typescript";
import type { Expr, IndexKeyExpr } from "../ir";
import { derivedPosition, MAX_SEARCH_SOURCE_SCALARS } from "../index-components";
import { refuse } from "../diagnostics";
import { unwrapExpression } from "../syntax";
import type { Environment } from "./environment";
import { expressionType } from "./cursor";
import { expandHelper } from "./helper-expansion";
import { guardedWalk } from "./recursion";

// @ref LLP 1001#unicode-search-foundation — Q belongs to the key source expression, independently of every indexed field maximum.
export function scanKeyExpressions(node: ts.Expression, expressions: Expr[], env: Environment, table: string, index: string): IndexKeyExpr[] {
  const info = [...env.tables.values()].find(t => t.name === table)?.indexes?.[index];
  const derived = info ? derivedPosition(info.components) : -1;
  if (derived >= 0 && expressions.length <= derived) refuse(env, "E_ARGS_TYPE", node,
    "search must equality-bind through wordPrefixes; its component cannot be omitted or ranged", "supply the ordinary scope prefix followed by a bounded text term");
  if (derived < 0) return expressions.map(Scalar => ({ Scalar }));
  const { source, environment } = keySource(node, env);
  return expressions.map((expression, position) => {
    const component = info?.components[position];
    if (!component || "Column" in component) return { Scalar: expression };
    const key = ts.isArrayLiteralExpression(source) ? source.elements[position] : expressions.length === 1 ? source : undefined;
    const type = key && expressionType(key, environment);
    if (!key || type?.kind !== "string" || type.id || type.builtText || type.max === undefined
      || !Number.isSafeInteger(type.max) || type.max < 0 || type.max > MAX_SEARCH_SOURCE_SCALARS) {
      refuse(env, "E_ARGS_TYPE", key ?? node, "wordPrefixes requires present bounded text with its own declared maximum",
        "pass a declared bounded text argument or column; use ! or ?? for optional text");
    }
    return { WordPrefix: { source: expression, contract: component.WordPrefixes.contract, source_max: type.max } };
  });
}

function keySource(node: ts.Expression, env: Environment): { source: ts.Expression; environment: Environment } {
  return guardedWalk(env, node, "search key source", () => {
    const source = unwrapExpression(node);
    if (ts.isIdentifier(source)) {
      const origin = env.substitutions.get(source.text) ?? env.variables.get(source.text)?.immutableOrigin;
      if (origin) return keySource(origin.expression, origin.environment);
    }
    const expanded = expandHelper(source, env);
    return expanded ? keySource(expanded.expression, expanded.environment) : { source, environment: env };
  });
}

export function requireOrdinaryRead(node: ts.Node, env: Environment, table: string, index: string): void {
  const info = [...env.tables.values()].find(t => t.name === table)?.indexes?.[index];
  if (info && derivedPosition(info.components) >= 0) refuse(env, "E_ARGS_TYPE", node,
    "wordPrefixes indexes are scan-only and cannot supply point, exists, or write addresses", "use an ordinary index for this address");
}
