import type { Expr } from "../ir";

export function upsertIdentityMatches(
  key: Expr,
  row: Expr,
  binding: (name: string) => Expr | undefined,
): boolean | undefined {
  row = resolveRowContainer(row, binding, new Set());
  if ("Object" in row) {
    const id = row.Object.id;
    return id === undefined ? undefined : sameIr(key, id) && !expressionConsumesNewId(id);
  }
  if (!("Literal" in row) || row.Literal === "Null" || typeof row.Literal !== "object") return undefined;
  const fields = "Row" in row.Literal ? row.Literal.Row : "Map" in row.Literal ? row.Literal.Map : undefined;
  const id = fields?.id;
  return id === undefined ? undefined : sameIr(key, { Literal: id });
}

function resolveRowContainer(
  expression: Expr,
  binding: (name: string) => Expr | undefined,
  seen: Set<string>,
): Expr {
  if (!("Variable" in expression) || seen.has(expression.Variable)) return expression;
  seen.add(expression.Variable);
  const value = binding(expression.Variable);
  return value === undefined ? expression : resolveRowContainer(value, binding, seen);
}

function expressionConsumesNewId(value: unknown): boolean {
  if (Array.isArray(value)) return value.some(expressionConsumesNewId);
  if (!value || typeof value !== "object") return false;
  const item = value as Record<string, unknown>;
  return item.Input === "NewId" || Object.values(item).some(expressionConsumesNewId);
}

function sameIr(left: unknown, right: unknown): boolean {
  if (left === right) return true;
  if (Array.isArray(left) || Array.isArray(right)) {
    return Array.isArray(left) && Array.isArray(right) && left.length === right.length
      && left.every((item, index) => sameIr(item, right[index]));
  }
  if (!left || !right || typeof left !== "object" || typeof right !== "object") return false;
  const leftRecord = left as Record<string, unknown>;
  const rightRecord = right as Record<string, unknown>;
  const leftKeys = Object.keys(leftRecord).sort();
  const rightKeys = Object.keys(rightRecord).sort();
  return leftKeys.length === rightKeys.length
    && leftKeys.every((key, index) => key === rightKeys[index] && sameIr(leftRecord[key], rightRecord[key]));
}
