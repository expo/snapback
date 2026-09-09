// @ref LLP 1012#5-retention-revocation-and-the-fence — a declaration on the
// delivered row's table names the body evicted before an absence proves it.
import { plainObject } from "../../evaluator/src/value-runtime.js";

export type TombstoneTarget = { table: string; id: string };
export type WireRow = { table: string; row: Record<string, unknown> };

type ObjectValue = Record<string, any>;
const object = (value: unknown): ObjectValue | undefined =>
  plainObject(value) ? value : undefined;
const field = (row: Record<string, unknown>, name: string): unknown =>
  Object.hasOwn(row, name) ? row[name] : undefined;
const scalar = (value: unknown): string | boolean | undefined =>
  typeof value === "string" || typeof value === "boolean" ? value : undefined;

function term(value: unknown, row: Record<string, unknown>): string | boolean | undefined {
  const node = object(value);
  if (!node) return undefined;
  if (typeof node.Field === "string") return scalar(field(row, node.Field));
  const literal = object(node.Literal);
  if (!literal) return undefined;
  return scalar(typeof literal.String === "string" ? literal.String : literal.Bool);
}

/** False/unknown/true are ordered so min/max preserve three-valued And/Or. */
function holds(value: unknown, row: Record<string, unknown>): number {
  const expr = object(value);
  if (!expr) return 1;
  if (Array.isArray(expr.And)) return expr.And.reduce((result, part) => Math.min(result, holds(part, row)), 2);
  if (Array.isArray(expr.Or)) return expr.Or.reduce((result, part) => Math.max(result, holds(part, row)), 0);
  if ("Not" in expr) return 2 - holds(expr.Not, row);
  const equal = Array.isArray(expr.Eq);
  const comparison = equal ? expr.Eq : Array.isArray(expr.Ne) ? expr.Ne : undefined;
  if (!comparison || comparison.length !== 2) return 1;
  const left = term(comparison[0], row), right = term(comparison[1], row);
  return left !== undefined && right !== undefined && (equal ? left === right : left !== right) ? 2 : 0;
}

/** Derive the unique physical rows revoked by one delivered row. */
export function tombstonesFor(schema: unknown, row: WireRow): TombstoneTarget[] {
  const entry = object(object(object(schema)?.tables)?.[row.table]);
  const declarations = entry?.tombstones;
  if (!Array.isArray(declarations)) return [];
  const targets: TombstoneTarget[] = [];
  for (const value of declarations) {
    const declaration = object(value);
    if (!declaration || typeof declaration.table !== "string" || typeof declaration.column !== "string" || !("when" in declaration)) continue;
    const id = field(row.row, declaration.column);
    if (typeof id !== "string" || id.length === 0 || holds(declaration.when, row.row) !== 2) continue;
    if (!targets.some((target) => target.table === declaration.table && target.id === id))
      targets.push({ table: declaration.table, id });
  }
  return targets;
}
