// @ref LLP 1012#5-retention-revocation-and-the-fence — rule 3, decided from the
// delivered row alone: a `tombstones <table>[.<column>] if <when>` declaration on
// the row's table names the body the client evicts before an absence proves it.
// Pure over the schema JSON and a wire row; the swap that applies it is the
// store's, not this module's.

export type TombstoneTarget = { table: string; id: string };
export type WireRow = { table: string; row: Record<string, unknown> };

type Declaration = { table: string; column: string; when: unknown };

/**
 * The rows a delivered row tombstones: one `{ table, id }` per declaration of
 * `row.table` whose predicate holds, naming the row its reference column points
 * at. A null or non-string reference tombstones nothing; a null column makes
 * every comparison false; a predicate shape this module does not know (there is
 * none the compiler emits) is false, so an unfamiliar schema never evicts.
 */
export function tombstonesFor(schema: unknown, row: WireRow): TombstoneTarget[] {
  const targets: TombstoneTarget[] = [];
  const seen = new Set<string>();
  for (const declaration of declarationsFor(schema, row.table)) {
    const id = field(row.row, declaration.column);
    if (typeof id !== "string" || id.length === 0) continue;
    if (holds(declaration.when, row.row) !== true) continue;
    const key = `${declaration.table} ${id}`;
    if (seen.has(key)) continue;
    seen.add(key);
    targets.push({ table: declaration.table, id });
  }
  return targets;
}

function declarationsFor(schema: unknown, table: string): Declaration[] {
  const tables = record(schema)?.tables;
  const entry = record(tables)?.[table];
  const list = record(entry)?.tombstones;
  if (!Array.isArray(list)) return [];
  return list.flatMap((item) => {
    const declaration = record(item);
    return declaration && typeof declaration.table === "string" && typeof declaration.column === "string" && "when" in declaration
      ? [{ table: declaration.table, column: declaration.column, when: declaration.when }]
      : [];
  });
}

/**
 * The rule-expression encoding the schema carries: `Eq`/`Ne` over `Field`/`Literal`,
 * `And`, `Or`, `Not`. Tri-state: `undefined` is "this module does not know", and
 * it stays unknown through `Not`, `And`, and `Or`, so an unfamiliar predicate never
 * evicts, negated or not.
 */
function holds(when: unknown, row: Record<string, unknown>): boolean | undefined {
  const expr = record(when);
  if (!expr) return undefined;
  if (Array.isArray(expr.And)) {
    const parts = expr.And.map((item) => holds(item, row));
    return parts.some((part) => part === false) ? false : parts.every((part) => part === true) ? true : undefined;
  }
  if (Array.isArray(expr.Or)) {
    const parts = expr.Or.map((item) => holds(item, row));
    return parts.some((part) => part === true) ? true : parts.every((part) => part === false) ? false : undefined;
  }
  if ("Not" in expr) {
    const inner = holds(expr.Not, row);
    return inner === undefined ? undefined : !inner;
  }
  const comparison = Array.isArray(expr.Eq) ? expr.Eq : Array.isArray(expr.Ne) ? expr.Ne : undefined;
  if (!comparison || comparison.length !== 2) return undefined;
  const left = term(comparison[0], row);
  const right = term(comparison[1], row);
  if (left === undefined || right === undefined) return false;
  return Array.isArray(expr.Eq) ? left === right : left !== right;
}

/** Enum and text compare as strings, bool as booleans; anything else (null, viewer, a row image) is undefined. */
function term(value: unknown, row: Record<string, unknown>): string | boolean | undefined {
  const node = record(value);
  if (!node) return undefined;
  if (typeof node.Field === "string") return scalar(field(row, node.Field));
  if ("Literal" in node) {
    const literal = record(node.Literal);
    if (!literal) return undefined;
    if (typeof literal.String === "string") return literal.String;
    if (typeof literal.Bool === "boolean") return literal.Bool;
  }
  return undefined;
}

function scalar(value: unknown): string | boolean | undefined {
  return typeof value === "string" || typeof value === "boolean" ? value : undefined;
}

function field(row: Record<string, unknown>, name: string): unknown {
  return Object.hasOwn(row, name) ? row[name] : undefined;
}

function record(value: unknown): Record<string, any> | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? (value as Record<string, any>) : undefined;
}
