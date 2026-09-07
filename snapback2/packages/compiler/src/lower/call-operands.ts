import ts from "typescript";
import { refuse } from "../diagnostics";
import { callName, snapbackCallName, unwrapExpression } from "../syntax";
import type { Environment } from "./environment";
import { requireCurrentComposite } from "./operation-context";

// @ref LLP 1002#2-the-authored-surface-the-snapback2-module — successful lowering owns every operand; unsupported call shapes must refuse before dispatch can discard one.
export function checkCallOperands(call: ts.CallExpression, env: Environment): void {
  // Inlined helpers evaluate all actual arguments, including unused extras.
  if (ts.isIdentifier(call.expression) && !env.variables.has(call.expression.text)
    && !env.substitutions.has(call.expression.text) && env.helpers.get(call.expression.text)?.body) return;
  const member = ts.isPropertyAccessExpression(call.expression) ? call.expression : undefined;
  const receiver = member && unwrapExpression(member.expression);
  const owner = receiver && ts.isIdentifier(receiver) ? env.variables.get(receiver.text) : undefined;
  const method = member?.name.text;
  if (receiver && ts.isIdentifier(receiver)) requireCurrentComposite(receiver, env);
  let arity: [number, number?] | undefined;
  if (snapbackCallName(call, env.sourceFile) === "emit") arity = [2];
  else if (owner?.operationComposite === "db") {
    if (["get", "exists", "insert", "delete"].includes(method!)) arity = [2];
    else if (["scan", "update", "upsert"].includes(method!)) arity = [3];
    else if (["require", "assert"].includes(method!)) arity = [1, 2];
  } else if (owner?.operationComposite === "ctx" && ["now", "commitTime", "newId"].includes(method!)) arity = [0];
  else if (owner?.collection === "Map" && method === "set") arity = [2];
  else if (owner?.collection && ["get", "has", "add"].includes(method!)) arity = [1];
  else if (member) {
    if (["map", "flatMap", "filter", "some", "sort"].includes(method!)) arity = [1];
    else if (["reduce", "slice"].includes(method!)) arity = [2];
    else if (["require", "count", "countCapped"].includes(method!)) arity = [0];
    else if (method === "scan") arity = [3];
    else if (method === "push") arity = [1, Infinity];
  } else {
    const name = callName(call);
    if (["range", "decimal", "divmod"].includes(name)) arity = [2];
    else if (["recurse", "deterministicShare", "mergeByIndex"].includes(name)) arity = [3];
    else if (["normalizeWordPrefix", "normalizeHandle", "memberOf", "mentionTokens", "words"].includes(name)) arity = [1];
    else if (["concat", "min", "max"].includes(name)) arity = [2, Infinity];
  }
  if (!arity) return;
  const [min, max = min] = arity;
  if (call.arguments.length < min || call.arguments.length > max || call.arguments.some(ts.isSpreadElement)) {
    refuse(env, "E_OPAQUE", call, `${callName(call)} accepts ${min === max ? `exactly ${min}` : `${min} to ${max}`} positional operands in the supported subset`,
      "use the supported call operands; bind any additional expression explicitly before this call");
  }
}
