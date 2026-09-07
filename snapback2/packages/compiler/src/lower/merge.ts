import ts from "typescript";
import { refuse } from "../diagnostics";
import type { Expr } from "../ir";
import { expressionProperty, stringArgument, unwrapExpression, numericLiteral } from "../syntax";
import type { Environment, LoweredValue } from "./environment";
import { heldSearchDescriptor } from "./held-search";
import { cloneEnvironment } from "./expr";
import { declareBinding } from "./lexical-binding";
import { requireStaticOperands } from "./scan-operands";

// @ref LLP 1010#a5-the-merged-feed — lanes remain scans until the heap asks for their next row.
export function lowerMergeByIndex(
  call: ts.CallExpression, env: Environment, hint: string | undefined,
  lowerValue: (node: ts.Expression, env: Environment, hint?: string) => LoweredValue,
  lowerBlock: (node: ts.Block, env: Environment, hint: string) => LoweredValue,
): LoweredValue {
  const input = call.arguments[0] && unwrapExpression(call.arguments[0]);
  const site = stringArgument(call.arguments[2]);
  if (call.arguments.length !== 3 || numericLiteral(call.arguments[1]) === undefined) refuse(env, "E_OPAQUE", call.arguments[1] ?? call,
    "mergeByIndex requires a literal limit and static lane descriptors", "use a literal limit matching the lane scan bounds");
  if (!input || !ts.isArrayLiteralExpression(input) || !site)
    refuse(env, "E_OPAQUE", call, "mergeByIndex requires static lane descriptors and a site");
  const statements: import("../ir").Stmt[] = [];
  const lanes = input.elements.map((element) => {
    if (!ts.isObjectLiteralExpression(element)) refuse(env, "E_OPAQUE", element, "merge lane must be a descriptor");
    requireStaticOperands(element, ["rows","lane"], env, "merge lane");
    const callback = expressionProperty(element, "lane");
    const rows = expressionProperty(element, "rows");
    if (!callback || !ts.isArrowFunction(callback))
      refuse(env, "E_OPAQUE", element, "merge lane must name a scan");
    // @ref LLP 1002#2-the-authored-surface-the-snapback2-module — a successful lowering cannot discard authored parameter evaluation; merge IR models only the optional row binder.
    const unsupported = callback.parameters.find(parameter =>
      !ts.isIdentifier(parameter.name) || parameter.initializer || parameter.dotDotDotToken || parameter.questionToken);
    if (unsupported || callback.parameters.length > 1) refuse(env, "E_OPAQUE", unsupported ?? callback.parameters[1]!,
      "merge lane callback accepts zero or one plain identifier parameter; defaults, rest and additional parameters are unsupported",
      "use () => scan for a fixed lane, or (row) => scan for a discovered row; bind other values explicitly outside the callback");
    const loweredSource = rows ? lowerValue(rows, env) : null;
    if (loweredSource) statements.push(...loweredSource.statements);
    const source = loweredSource?.expression ?? null;
    if (source && !("Scan" in source)) refuse(env, "E_OPAQUE", rows!, "merge lane source must be a bounded scan");
    const parameter = callback.parameters[0];
    const binding = parameter && ts.isIdentifier(parameter.name) ? parameter.name.text : "";
    const nested = cloneEnvironment(env);
    const runtimeName = source && "Scan" in source ? declareBinding(binding, {
      provenance: "Shape", rowBinding: true, rowTable: source.Scan.table,
    }, nested) : binding;
    const lowered = ts.isBlock(callback.body) ? lowerBlock(callback.body, nested, hint ?? "merge")
      : lowerValue(callback.body, nested);
    const scan = lowered.expression;
    if (!("Scan" in scan)) refuse(env, "E_OPAQUE", callback.body, "merge lane must name a scan");
    return { ...(lowered.statements.length ? { setup: lowered.statements } : {}), scan: scan.Scan, source: source && "Scan" in source ? source.Scan : null, binding: runtimeName };
  });
  const merge = { site, lanes };
  const held = statements.length === 0 ? heldSearchDescriptor(merge, env) : undefined;
  return { statements, expression: { Merge: { ...merge, ...(held ? { held_search: held } : {}) } } };
}
