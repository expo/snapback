import { basename } from "node:path";
import { columnComponents } from "../index-components";
import type { ColumnDecl, DeliverDecl, Document, Expr, RuleDecl, ScalarType, Site, TableDecl } from "./ast";
import { QuarryError, nameRewrite, typeError } from "./diagnostics";

const EVENT_KINDS = ["delivered", "changed", "removed"];

// @ref LLP 1019#1-the-declaration — `deliver` names a capped range of a
// target table; the engine-owned log and receipts table are materialized
// here, ahead of the catalog, in exactly the shape the engine derives, so the
// Rust trust boundary can hold every generation to it.
/** Resolve every `deliver` line and add the tables it generates to `schema.q`. */
export function materializeDeliveries(documents: Document[]): void {
  const schema = documents.find((document) => basename(document.file) === "schema.q");
  if (!schema) return;
  const generated: TableDecl[] = [];
  for (const table of schema.tables) {
    const deliver = table.deliver;
    if (!deliver) continue;
    const site = deliver.site;
    const declared = schema.tables.map((candidate) => candidate.name);
    const target = schema.tables.find((candidate) => candidate.name === deliver.target);
    if (!target || deliver.target === "connected") {
      throw new QuarryError(site, `deliver names unknown table ${deliver.target}`, "E_QUARRY_UNKNOWN", nameRewrite(deliver.target, declared));
    }
    const prefix = deliver.prefix.map((name) => {
      const column = table.columns.find((candidate) => candidate.name === name);
      if (!column) {
        throw new QuarryError(site, `deliver prefix key .${name} is not a column of ${table.name}`, "E_QUARRY_UNKNOWN",
          nameRewrite(name, table.columns.map((candidate) => candidate.name)));
      }
      return column;
    });
    const keys = deliver.prefix.map((name) => `.${name}`).join(", ");
    const by = deliver.prefix.join(", ");
    // @ref LLP 1019#1-the-declaration — the pinned group is the cap whose `by`
    // tuple equals the prefix names, never the first cap of the same arity.
    const cap = target.caps.find((candidate) => candidate.by.length === deliver.prefix.length
      && candidate.by.every((name, offset) => name === deliver.prefix[offset]));
    if (!cap) {
      throw new QuarryError(site,
        `deliver to ${deliver.target}[${keys}] pins no capped group: ${deliver.target} has no cap N by ${by}`,
        "E_DELIVER_UNBOUNDED", `cap 50 by ${by}`, "deliver", true);
    }
    for (const column of prefix) {
      const groupColumn = target.columns.find((candidate) => candidate.name === column.name);
      if (!groupColumn || !sameStoredType(groupColumn.type, column.type)) {
        typeError(site,
          `deliver prefix key .${column.name} (${column.type.kind}) does not match ${deliver.target}.${column.name} (${groupColumn?.type.kind ?? "missing"}) in cap ${cap.max} by ${by}`,
          `pin the cap's columns with ${table.name} columns of the same type`);
      }
    }
    const principals = target.columns.filter((candidate) => candidate.type.kind === "principal" && !candidate.type.optional);
    let principal: string;
    if (deliver.by !== undefined) {
      const named = target.columns.find((candidate) => candidate.name === deliver.by);
      if (!named || named.type.kind !== "principal" || named.type.optional) {
        throw new QuarryError(site,
          named ? `deliver by .${deliver.by}: ${deliver.target}.${deliver.by} is ${named.type.kind}${named.type.optional ? " ?" : ""}, not principal`
            : `deliver by .${deliver.by}: ${deliver.target} has no such column`,
          "E_DELIVER_PRINCIPAL", principals[0] ? deliverLine(deliver, principals[0].name) : `add a principal column to ${deliver.target}`,
          "deliver", principals.length > 0);
      }
      principal = named.name;
    } else if (principals.length === 1) {
      principal = principals[0]!.name;
    } else {
      throw new QuarryError(site,
        principals.length === 0 ? `deliver to ${deliver.target}: ${deliver.target} has no principal column`
          : `deliver to ${deliver.target}: ${deliver.target} has ${principals.length} principal columns (${principals.map((column) => column.name).join(", ")}); name one with by .<column>`,
        "E_DELIVER_PRINCIPAL", principals[0] ? deliverLine(deliver, principals[0].name) : `add a principal column to ${deliver.target}`,
        "deliver", principals.length > 0);
    }
    // The engine enforces the cap through an index led by its columns; the fan-out reads the same index.
    const enforced = target.indexes.some((index) => deliver.prefix.every((name, offset) => {
      const component = index.components[offset];
      return component !== undefined && "Column" in component && component.Column === name;
    }));
    if (!enforced) {
      throw new QuarryError(site, `cap ${cap.max} by ${by} on ${deliver.target} has no index whose leading columns are ${by}`,
        "E_DELIVER_UNBOUNDED", `by byGroup: ${by}, ${principal}`, "deliver", true);
    }
    const taken = new Set([...declared, ...schema.maintains.map((maintain) => maintain.name), ...generated.map((candidate) => candidate.name)]);
    for (const name of [deliver.name, ...(deliver.receipts ? [`${deliver.name}Receipts`] : [])]) {
      if (taken.has(name)) {
        throw new QuarryError(site, `deliver as ${deliver.name}: ${name} is already declared`, "E_QUARRY_UNKNOWN",
          deliverLine({ ...deliver, name: `${deliver.name}Log` }, principal), "quarry/names", true);
      }
    }
    deliver.principal = principal;
    generated.push(logTable(table, deliver, prefix));
    if (deliver.receipts) generated.push(receiptsTable(table, deliver));
  }
  schema.tables.push(...generated);
}

/** The declaration as one Quarry line, for rewrites. */
export function deliverLine(deliver: DeliverDecl, principal?: string): string {
  const keys = deliver.prefix.map((name) => `.${name}`).join(", ");
  const by = principal === undefined ? "" : ` by .${principal}`;
  return `deliver to ${deliver.target}[${keys}]${by} as ${deliver.name}${deliver.receipts ? " with receipts" : ""}${deliver.bootstrap ? " bootstrap" : ""}`;
}

function logTable(content: TableDecl, deliver: DeliverDecl, prefix: ColumnDecl[]): TableDecl {
  const site = deliver.site;
  const column = (name: string, type: ScalarType): ColumnDecl => ({ name, type, site });
  const columns: ColumnDecl[] = [
    column("recipient", { kind: "principal", optional: false }),
    column("row", { kind: "ref", table: content.name, optional: false }),
    column("incarnation", { kind: "int", optional: false }),
    ...prefix.map((entry) => column(entry.name, structuredClone(entry.type))),
    column("kind", { kind: "enum", variants: [...EVENT_KINDS], optional: false }),
    column("audience", { kind: "int", optional: false }),
    column("seq", { kind: "int", optional: false }),
    column("at", { kind: "time", optional: false }),
  ];
  const names = columns.map((entry) => entry.name);
  const collision = names.find((name, offset) => name === "id" || names.indexOf(name) !== offset);
  if (collision !== undefined) {
    throw new QuarryError(site, `deliver prefix key .${collision} collides with a log column of the same name`, "E_QUARRY_UNKNOWN",
      `rename ${content.name}.${collision}, then ${deliverLine(deliver, deliver.principal)}`);
  }
  const focal = (name: string): Expr => ({ kind: "member", base: { kind: "focal", site }, name, site });
  const read: RuleDecl = { effect: "read", bindings: [], site,
    value: { kind: "binary", op: "=", left: focal("recipient"), right: { kind: "name", name: "viewer", site }, site } };
  return {
    name: deliver.name,
    columns,
    indexes: [
      { name: "byRecipient", components: columnComponents(["recipient", "seq", "id"]), unique: false, site },
      { name: "byRecipientGroup", components: columnComponents(["recipient", ...deliver.prefix, "kind", "seq", "id"]), unique: false, site },
      // @ref LLP 1019#mechanism--decided-by-p0-2026-09-10 — `(row, kind, recipient)`: historical fan-out seeks `(row, 'delivered')`.
      { name: "byRow", components: columnComponents(["row", "kind", "recipient"]), unique: false, site },
    ],
    rules: [read, deny("insert", site), deny("update", site), deny("delete", site)],
    immutable: [{ columns: [...names].sort(), site }],
    caps: [],
    finalExists: [],
    derived: { deliver: content.name, kind: "log" },
    site,
  };
}

// @ref LLP 1019#6-receipts-with-receipts — the receipts table inherits the
// content read rule table-wide, so it carries every column that rule reads,
// with `.id` rewritten to `.row`.
function receiptsTable(content: TableDecl, deliver: DeliverDecl): TableDecl {
  const site = deliver.site;
  const column = (name: string, type: ScalarType): ColumnDecl => ({ name, type, site });
  const columns: ColumnDecl[] = [
    column("row", { kind: "ref", table: content.name, optional: false }),
    column("recipient", { kind: "principal", optional: false }),
    column("received", { kind: "bool", optional: false }),
    column("seq", { kind: "int", optional: false }),
  ];
  const read = content.rules.find((rule) => rule.effect === "read");
  if (read) {
    const fixed = new Set(["id", ...columns.map((entry) => entry.name)]);
    for (const field of ruleFields(read.value, new Set(read.bindings))) {
      if (field === "id") continue;
      const source = content.columns.find((candidate) => candidate.name === field);
      if (!source) continue;
      if (fixed.has(field)) {
        throw new QuarryError(site, `${deliver.name}Receipts cannot be derived: ${content.name}'s read rule reads .${field}, a receipts column`,
          "E_QUARRY_UNKNOWN", `rename ${content.name}.${field}, then ${deliverLine(deliver, deliver.principal)}`);
      }
      columns.push(column(field, structuredClone(source.type)));
    }
  }
  return {
    name: `${deliver.name}Receipts`,
    columns,
    indexes: [{ name: "byRow", components: columnComponents(["row", "recipient"]), unique: true, site }],
    rules: [
      ...(read ? [{ ...read, value: rewriteIdToRow(read.value, new Set(read.bindings)), site }] : []),
      deny("insert", site), deny("update", site), deny("delete", site),
    ],
    immutable: [{ columns: ["recipient", "row"], site }],
    caps: [],
    finalExists: [],

    ...(content.public && !read ? { public: { ...content.public, site } } : {}),
    derived: { deliver: content.name, kind: "receipts" },
    site,
  };
}

function deny(effect: RuleDecl["effect"], site: Site): RuleDecl {
  return { effect, bindings: ["r"], value: { kind: "name", name: "deny", site }, site };
}

/** Every `.field` (or `binding.field`) a rule reads, on any probe key or comparison. */
function ruleFields(expr: Expr, bindings: Set<string>, out = new Set<string>()): Set<string> {
  if (expr.kind === "member" && (expr.base.kind === "focal" || (expr.base.kind === "name" && bindings.has(expr.base.name)))) out.add(expr.name);
  else if (expr.kind === "binary") { ruleFields(expr.left, bindings, out); ruleFields(expr.right, bindings, out); }
  else if (expr.kind === "unary") ruleFields(expr.value, bindings, out);
  else if (expr.kind === "exists" || expr.kind === "created") for (const key of expr.read.keys) ruleFields(key.value, bindings, out);
  return out;
}

function rewriteIdToRow(expr: Expr, bindings: Set<string>): Expr {
  if (expr.kind === "member" && expr.name === "id" && (expr.base.kind === "focal" || (expr.base.kind === "name" && bindings.has(expr.base.name)))) {
    return { ...expr, name: "row" };
  }
  if (expr.kind === "binary") return { ...expr, left: rewriteIdToRow(expr.left, bindings), right: rewriteIdToRow(expr.right, bindings) };
  if (expr.kind === "unary") return { ...expr, value: rewriteIdToRow(expr.value, bindings) };
  if (expr.kind === "exists" || expr.kind === "created") {
    return { ...expr, read: { ...expr.read, keys: expr.read.keys.map((key) => ({ ...key, value: rewriteIdToRow(key.value, bindings) })) } };
  }
  return expr;
}

/** Equality of the stored column type: what the engine compares (text minimums and formats are constraints, not storage). */
function sameStoredType(left: ScalarType, right: ScalarType): boolean {
  const stored = (type: ScalarType): string => {
    const { min: _min, format: _format, explicitScale: _explicit, ...rest } = type as ScalarType & { min?: number; format?: string; explicitScale?: boolean };
    return JSON.stringify(rest.kind === "list" ? { ...rest, item: stored(rest.item) } : rest);
  };
  return stored(left) === stored(right);
}
