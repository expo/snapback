import ts from "typescript";
import { refuse } from "../diagnostics";
import type { Expr } from "../ir";
import { expressionProperty, stringArgument, unwrapExpression } from "../syntax";
import type { Environment, LoweredValue } from "./environment";

// @ref LLP 1010#a5-the-merged-feed — lanes remain scans until the heap asks for their next row.
export function lowerMergeByIndex(
  call: ts.CallExpression, env: Environment, hint: string | undefined,
  lowerValue: (node: ts.Expression, env: Environment, hint?: string) => LoweredValue,
  lowerBlock: (node: ts.Block, env: Environment, hint: string) => LoweredValue,
): LoweredValue {
  const input = call.arguments[0] && unwrapExpression(call.arguments[0]);
  const site = stringArgument(call.arguments[4]);
  if (!input || !ts.isArrayLiteralExpression(input) || !site)
    refuse(env, "E_OPAQUE", call, "mergeByIndex requires static lane descriptors and a site");
  const statements: import("../ir").Stmt[] = [];
  const lanes = input.elements.map((element) => {
    if (!ts.isObjectLiteralExpression(element)) refuse(env, "E_OPAQUE", element, "merge lane must be a descriptor");
    const callback = expressionProperty(element, "lane");
    const rows = expressionProperty(element, "rows");
    if (!callback || !ts.isArrowFunction(callback))
      refuse(env, "E_OPAQUE", element, "merge lane must name a scan");
    const loweredSource = rows ? lowerValue(rows, env) : null;
    if (loweredSource) statements.push(...loweredSource.statements);
    const source = loweredSource?.expression ?? null;
    if (source && !("Scan" in source)) refuse(env, "E_OPAQUE", rows!, "merge lane source must be a bounded scan");
    const parameter = callback.parameters[0];
    const binding = parameter && ts.isIdentifier(parameter.name) ? parameter.name.text : "";
    const nested = { ...env, variables: new Map(env.variables) };
    if (source && "Scan" in source) nested.variables.set(binding, {
      provenance: "Shape", rowBinding: true, rowTable: source.Scan.table,
    });
    const lowered = ts.isBlock(callback.body) ? lowerBlock(callback.body, nested, hint ?? "merge")
      : lowerValue(callback.body, nested);
    const scan = lowered.expression;
    if (!("Scan" in scan)) refuse(env, "E_OPAQUE", callback.body, "merge lane must name a scan");
    return { ...(lowered.statements.length ? { setup: lowered.statements } : {}), scan: scan.Scan, source: source && "Scan" in source ? source.Scan : null, binding };
  });
  return { statements, expression: { Merge: { site, lanes } } };
}
