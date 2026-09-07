import type { Expr, HeldSearchDescriptor, Scan } from "../ir";
import { columnAt, derivedPosition, ordinaryColumns } from "../index-components";
import type { Environment, VariableInfo } from "./environment";
import { runtimeBinding } from "./lexical-binding";

type Merge = Extract<Expr, { Merge: unknown }>["Merge"];
type Rule = any;

/** Structural expression identity is a proof about programs, never equality of runtime search atoms. */
function same(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (!a || !b || typeof a !== "object" || typeof b !== "object") return false;
  if (Array.isArray(a) || Array.isArray(b)) return Array.isArray(a) && Array.isArray(b)
    && a.length === b.length && a.every((v, i) => same(v, b[i]));
  const left = a as Record<string, unknown>, right = b as Record<string, unknown>;
  const keys = Object.keys(left);
  return keys.length === Object.keys(right).length && keys.every(k => Object.hasOwn(right, k) && same(left[k], right[k]));
}

// @ref LLP 1012#indexed-held-search — captured aliases retain their original principal filter across lexical shadows.
function resolve(expr: Expr, env: Environment, seen = new Set<VariableInfo>()): { value: Expr; environment: Environment } {
  if ("Variable" in expr) {
    const binding = runtimeBinding(expr.Variable, env);
    const origin = binding?.identityEnvironment ?? binding?.immutableOrigin?.environment;
    if (binding?.identityExpression && origin && !seen.has(binding)) {
      return resolve(binding.identityExpression, origin, new Set([...seen, binding]));
    }
  }
  return { value: expr, environment: env };
}

function invariant(expr: Expr, env: Environment): boolean {
  const { value, environment } = resolve(expr, env);
  return "Literal" in value || "Input" in value && value.Input === "Viewer"
    || "Variable" in value && Object.hasOwn(environment.args, value.Variable)
      && (!runtimeBinding(value.Variable, environment)
        || runtimeBinding(value.Variable, environment)?.operationArgument === value.Variable);
}

function field(expr: Expr, binding: string): string | undefined {
  return "Field" in expr && "Variable" in expr.Field.base && expr.Field.base.Variable === binding ? expr.Field.name : undefined;
}

function termExpr(term: Rule): Expr | undefined {
  if (term === "Viewer") return { Input: "Viewer" };
  if (term && typeof term === "object" && "Literal" in term) return { Literal: term.Literal };
}

function uncut(scan: Scan): boolean { return !scan.after && !scan.before && !scan.range; }

// @ref LLP 1012#indexed-held-search — discovery must enumerate exactly the source rule's membership scopes; an extra filter is application semantics.
export function heldSearchDescriptor(merge: Merge, env: Environment): HeldSearchDescriptor | undefined {
  if (env.kind !== "Query" || merge.lanes.length !== 1) return;
  const lane = merge.lanes[0]!;
  const { scan, source, binding } = lane;
  if (!source || !binding || lane.setup?.length || scan.before || scan.range || !uncut(source)) return;
  const table = [...env.tables.values()].find(t => t.name === scan.table);
  const membership = [...env.tables.values()].find(t => t.name === source.table);
  const index = table?.indexes?.[scan.index];
  const discoveryIndex = membership?.indexes?.[source.index];
  if (!table || !membership || !index || !discoveryIndex) return;
  const derived = derivedPosition(index.components);
  if (derived < 1 || scan.prefix.length !== derived + 1 || columnAt(index.components, -1) !== "id") return;
  const key = scan.prefix[derived];
  if (!key || !("WordPrefix" in key) || !invariant(key.WordPrefix.source, env)) return;
  const discoveryColumns = ordinaryColumns(discoveryIndex.components);
  const suffix = ordinaryColumns(index.components.slice(derived + 1));
  if (!discoveryColumns || !suffix || !suffix.length || source.prefix.length > discoveryColumns.length) return;
  const pins = new Map<string, Expr>();
  for (const [position, atom] of source.prefix.entries()) {
    if (!("Scalar" in atom) || !invariant(atom.Scalar, env)) return;
    pins.set(discoveryColumns[position]!, resolve(atom.Scalar, env).value);
  }
  const rule = table.readRule as Rule;
  if (!rule || typeof rule !== "object" || Object.keys(rule).length !== 1 || !rule.Exists) return;
  const probe = rule.Exists;
  if (probe.table !== source.table || !Array.isArray(probe.key)) return;
  const authorizationIndex = membership.indexes?.[probe.index];
  const authorizationColumns = authorizationIndex && ordinaryColumns(authorizationIndex.components);
  if (!authorizationColumns || probe.key.length !== authorizationColumns.length) return;
  const scope: HeldSearchDescriptor["scope"] = [];
  const mappings = new Map<string, Expr>();
  for (let position = 0; position < derived; position++) {
    const atom = scan.prefix[position]!, column = columnAt(index.components, position);
    if (!("Scalar" in atom) || !column) return;
    // Only a direct lane field names this callback's row. A captured field may
    // refer to an outer row whose binding happens to have the same spelling.
    if (!field(atom.Scalar, binding) && !invariant(atom.Scalar, env)) return;
    const value = field(atom.Scalar, binding) ? atom.Scalar : resolve(atom.Scalar, env).value;
    scope.push({ column, value: atom.Scalar });
    mappings.set(column, value);
  }
  const expectedPins = new Map<string, Expr>();
  const enumerated = new Set<string>();
  for (const [position, term] of probe.key.entries()) {
    const column = authorizationColumns[position]!;
    if (term && typeof term === "object" && typeof term.Field === "string") {
      const value = mappings.get(term.Field);
      if (!value) return;
      const memberField = field(value, binding);
      if (memberField) {
        if (memberField !== column || pins.has(column)) return;
        enumerated.add(term.Field);
      } else expectedPins.set(column, value);
    } else {
      const value = termExpr(term);
      if (!value) return;
      expectedPins.set(column, value);
    }
  }
  if (!enumerated.size || scope.some(s => field(mappings.get(s.column)!, binding) && !enumerated.has(s.column))) return;
  if (pins.size !== expectedPins.size || [...expectedPins].some(([column, value]) => !same(pins.get(column), value))) return;
  // Every witness of the source rule must also be visible to discovery. Unknown/extra membership authority is not a proof.
  if (!discoveryVisible(membership.readRule, membership.name, membership.indexes!, pins, env)) return;
  return {
    table: scan.table, index: scan.index, term: key.WordPrefix, scope, suffix,
    order: scan.order, take: scan.take, after: scan.after,
    discovery: { scan: source, binding, authorization_index: probe.index },
  };
}

function discoveryVisible(rule: Rule, table: string, indexes: NonNullable<import("../authored-types").TableInfo["indexes"]>, pins: Map<string, Expr>, env: Environment): boolean {
  if (rule === "Allow" || rule && typeof rule === "object" && "Public" in rule) return true;
  if (!rule || typeof rule !== "object") return false;
  if (Array.isArray(rule.Eq)) return [rule.Eq, [...rule.Eq].reverse()].some(([left, right]) =>
    typeof left?.Field === "string" && termExpr(right) && same(pins.get(left.Field), termExpr(right)));
  const probe = rule.Exists;
  const index = probe?.table === table ? indexes[probe.index] : undefined;
  const columns = index && ordinaryColumns(index.components);
  if (!index?.unique || !columns?.length || probe.key?.length !== columns.length) return false;
  return columns.every((column, i) => {
    const term = probe.key[i];
    // Required unique self-probes witness themselves. Optional unique keys do not supply this proof.
    return index.types[i]?.kind !== "optional" && index.types[i]?.kind !== "unknown"
      && (term?.Field === column || termExpr(term) !== undefined && same(pins.get(column), resolve(termExpr(term)!, env).value));
  });
}
