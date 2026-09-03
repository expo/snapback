import ts from "typescript";
import { refuse } from "../diagnostics";
import type { Expr } from "../ir";
import { literal, stringArgument, unwrapExpression } from "../syntax";
import type { Environment, LoweredValue } from "./environment";

export function lowerMergeByIndex(
  call: ts.CallExpression,
  env: Environment,
  hint: string | undefined,
  lowerValue: (node: ts.Expression, env: Environment, hint?: string) => LoweredValue,
  lowerExpr: (node: ts.Expression, env: Environment, hint?: string) => Expr,
): LoweredValue {
  const rows = call.arguments[0];
  const fields = call.arguments[1];
  const order = stringArgument(call.arguments[2]);
  const limit = call.arguments[3];
  const site = stringArgument(call.arguments[4]);
  const table = stringArgument(call.arguments[5]);
  if (!rows || !fields || !ts.isArrayLiteralExpression(unwrapExpression(fields)) || !limit || !site || !table
    || (order !== "asc" && order !== "desc")) {
    refuse(env, "E_OPAQUE", call, "mergeByIndex requires rows, static fields, asc/desc, take, site, and table");
  }
  const lowered = lowerValue(rows, env, hint);
  const keys = (unwrapExpression(fields) as ts.ArrayLiteralExpression).elements.map((field) => {
    const name = stringArgument(field);
    if (!name) refuse(env, "E_OPAQUE", field, "mergeByIndex fields must be static strings");
    return { field: name, order: order === "desc" ? "Desc" as const : "Asc" as const };
  });
  const sorted: Expr = { Builtin: { builtin: { Sort: { keys } }, args: [lowered.expression] } };
  const deduped: Expr = { Builtin: { builtin: { DedupeById: { site, table } }, args: [sorted] } };
  return {
    statements: lowered.statements,
    expression: { Builtin: { builtin: "Slice", args: [deduped, literal(0), lowerExpr(limit, env)] } },
  };
}
