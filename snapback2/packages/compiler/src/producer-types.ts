import ts from "typescript";
import { requiredType, unknownType, type AuthoredType } from "./authored-types";
import { commonCaptureType } from "./destination-conversion";
import { callName, isFunctionLike, numericLiteral } from "./syntax";

type List = Extract<AuthoredType, { kind: "list" }>;
export function boundedList(of: AuthoredType, max: number | undefined): List {
  return { kind: "list", of, ...(max !== undefined && Number.isSafeInteger(max) && max >= 0 ? { max } : {}) };
}
export function concatenatedList(lists: List[]): List {
  return boundedList(commonCaptureType(lists.filter(list => list.max !== 0).map(list => list.of)),
    lists.reduce((sum, list) => sum + (list.max ?? NaN), 0));
}

// @ref LLP 1002#2-the-authored-surface-the-snapback2-module — a producer carries source units and a proof of its cardinality, independently of destination conversion.
/** Source transfer functions never take a destination type. Unknown output
 * representation remains unknown even when the lowering has a cardinality. */
export function collectionProducerType(call: ts.CallExpression, expression: (node: ts.Expression) => AuthoredType,
  callback: (node: ts.ArrowFunction | ts.FunctionExpression, first: AuthoredType, second?: AuthoredType) => AuthoredType): AuthoredType | undefined {
  const name = callName(call);
  if (ts.isIdentifier(call.expression)) {
    if (name === "range") {
      const start = numericLiteral(call.arguments[0]), end = numericLiteral(call.arguments[1]);
      return boundedList({ kind: "int" }, start !== undefined && end !== undefined ? Math.max(0, end - start) : undefined);
    }
    if (name === "mentionTokens") return boundedList({ kind: "string" }, 85);
    if (["top", "intersectById", "mergeByTime"].includes(name)) {
      const types = call.arguments.map(argument => isFunctionLike(argument) ? unknownType : requiredType(expression(argument)));
      const index = name === "top" ? 1 : 0;
      let owner = types[index];
      if (owner?.kind !== "list") return unknownType;
      if (name === "mergeByTime") owner = owner.of.kind === "list"
        ? boundedList(owner.of.of, (owner.max ?? NaN) * (owner.of.max ?? NaN)) : boundedList(unknownType, undefined);
      const limit = numericLiteral(call.arguments[name === "top" ? 0 : 1]);
      return boundedList(owner.of, limit !== undefined && limit >= 0 ? Math.min(owner.max ?? Infinity, limit) : owner.max);
    }
    return undefined;
  }
  if (!ts.isPropertyAccessExpression(call.expression)) return undefined;
  const method = call.expression.name.text;
  if (!["map", "flatMap", "filter", "some", "sort", "slice", "reduce"].includes(method)) return undefined;
  const owner = requiredType(expression(call.expression.expression));
  if (owner.kind !== "list") return unknownType;
  if (method === "sort" || method === "slice") {
    for (const argument of call.arguments) if (!isFunctionLike(argument)) expression(argument);
    return owner;
  }
  const fn = call.arguments[0];
  if (!fn || !isFunctionLike(fn)) return unknownType;
  if (method === "reduce") {
    const initial = call.arguments[1] && expression(call.arguments[1]);
    if (!initial) return unknownType;
    const result = callback(fn, initial, owner.of);
    if (owner.max === 0) return initial;
    // A growing composite accumulator needs a separate loop-carried proof.
    // Scalar alternatives reach their representation fixed point in one join.
    return ["int", "decimal", "string", "bool", "null"].includes(initial.kind)
      ? commonCaptureType([initial, result]) : unknownType;
  }
  const result = callback(fn, owner.of);
  if (method === "flatMap") return boundedList(result.kind === "list" ? result.of : unknownType,
    (owner.max ?? NaN) * (result.kind === "list" ? result.max ?? NaN : NaN));
  return method === "map" ? boundedList(result, owner.max) : method === "filter" ? owner : { kind: "bool" };
}
