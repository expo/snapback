// @ref LLP 1001#10-what-binds-and-how-it-is-checked — certificate identity uses
// Rust serde's BTreeMap order even when a direct TypeScript caller constructed
// the equivalent object with a different property insertion order.

import { compareCodepoints } from './hash';
import { EvalError } from "./errors";

export function canonicalProgramJson(program: any): string {
  return JSON.stringify({
    ...pick(program, ["name", "kind", "args", "read_time_granularity_ms", "body"], "program"),
    args: sortedMap(program.args ?? {}, normalizeArgType),
    body: (program.body ?? []).map(normalizeStatement),
  });
}

// @ref LLP 1012#8-the-delivery-envelope-the-validator-and-resume — schema and
// rule identity mirror serde's struct-field order and skip rules exactly, so
// the hash is the same whether the schema arrived in struct order (the
// corpus) or through a sorted `serde_json::Value` (`GET /api/program`).
//
// An unseen shape never hashes equal to a known one: a payload with a field
// serde's struct does not carry is refused (`E_SCHEMA`) rather than dropped,
// since dropping would let two different schemas hash the same; an unknown
// variant is kept whole with its payload deep-sorted, so it hashes
// deterministically and unlike anything this normalizer knows. The twin
// treats a refusal as `hydrating` and never predicts under it.
export function canonicalSchemaJson(schema: any): string {
  known(schema, ["tables", "schedules", "maintains", "channels", "auth", "effects"], "schema");
  const canonical: Record<string, any> = {
    tables: sortedMap(schema.tables ?? {}, normalizeTable),
  };
  // @ref LLP 1016#d5--schedules-row-timers-and-periods-on-the-owners-clock — a schedule on the
  // schema is scalars only (its binding is a program named here), in serde's field order.
  if (schema.schedules !== undefined && schema.schedules.length > 0) {
    canonical.schedules = schema.schedules.map(normalizeSchedule);
  }
  canonical.maintains = (schema.maintains ?? []).map(normalizeMaintain);
  if (schema.channels !== undefined && Object.keys(schema.channels).length > 0) {
    canonical.channels = sortedMap(schema.channels, normalizeChannel);
  }
  if (schema.auth !== undefined && schema.auth !== null) known(schema.auth, ["password", "guests"], "auth");
  if (schema.auth !== undefined && (schema.auth.password || schema.auth.guests)) {
    canonical.auth = { password: schema.auth.password, guests: schema.auth.guests };
  }
  if (schema.effects !== undefined && schema.effects.length > 0) canonical.effects = schema.effects;
  return JSON.stringify(canonical);
}

function normalizeSchedule(schedule: any): any {
  // `site` is the declaration's position, for diagnostics only: serde skips it, so it is never in
  // the hash (a blank line above a schedule is not a successor). A compiler-shaped payload still
  // carries it; the shape is known, and the bytes leave it out.
  const out = pick(schedule, ["name", "trigger", "target", "binding", "site"], "schedule");
  delete out.site;
  const [kind, data] = tagged(schedule.trigger);
  out.trigger = kind === "row"
    ? { row: pick(data, ["table", "column"], "schedule trigger") }
    : kind === "every"
      ? { every: pick(data, ["durationMs"], "schedule trigger") }
      : { [kind]: deepSorted(data) };
  return out;
}

/** Refuses a payload carrying a field the serde struct does not: a shape this hasher has never seen. */
function known(record: any, fields: readonly string[], what: string): void {
  if (typeof record !== "object" || record === null || Array.isArray(record)) {
    throw new EvalError("E_SCHEMA", `${what} must be an object`);
  }
  const unknown = Object.keys(record).filter((key) => !fields.includes(key));
  if (unknown.length > 0) {
    throw new EvalError("E_SCHEMA", `unknown ${what} field ${unknown.join(", ")}: a schema shape newer than this evaluator`);
  }
}

/** The struct's fields in serde order, and nothing else: `known` plus the reconstruction in one step. */
function pick(record: any, fields: readonly string[], what: string, transforms: Transforms = {}): Record<string, any> {
  known(record, fields, what);
  const out: Record<string, any> = {};
  for (const field of fields) if (record[field] !== undefined) out[field] = record[field];
  // Copy in serde order before transforming in refusal order: these orders can differ (Scan.take/prefix).
  for (const field of Object.keys(transforms)) out[field] = transforms[field](record[field]);
  return out;
}

type Normalize = (value: any) => any;
type Transforms = Record<string, Normalize>;
const list = (normalize: Normalize): Normalize => value => value.map(normalize);
const struct = (what: string, fields: Record<string, Normalize | null>, complete = false): Normalize => {
  const names = Object.keys(fields);
  return value => {
    const out = complete ? (known(value, names, what), {}) : pick(value, names, what);
    for (const name of names) if (fields[name] || complete) out[name] = fields[name] ? fields[name]!(value[name]) : value[name];
    return out;
  };
};

/** Static constructor dispatch, without retaining input trees or registering new shapes. */
function node(value: any, constructors: Transforms, unknown: Normalize): any {
  const [kind, data] = tagged(value);
  return Object.hasOwn(constructors, kind) ? { [kind]: constructors[kind](data) } : unknown(value);
}
const unchanged: Normalize = value => value;
const unknownPayload: Normalize = value => { const [kind, data] = tagged(value); return { [kind]: deepSorted(data) }; };

/** An unknown variant's payload with every object's keys sorted: deterministic, and never a known shape's bytes. */
function deepSorted(value: any): any {
  if (Array.isArray(value)) return value.map(deepSorted);
  if (typeof value !== "object" || value === null) return value;
  return sortedMap(value, deepSorted);
}

/** A rule in serde's field order: what `Schema::rule_hash` serializes beside the schema hash. */
export function canonicalRuleJson(rule: any): string {
  return JSON.stringify(normalizeRule(rule));
}


function normalizeMaintainKind(kind: any): any {
  if (typeof kind !== "object" || kind === null) return kind;
  const [tag, data] = tagged(kind);
  return { [tag]: tag === "Sum" ? pick(data, ["of"], "maintain.kind.Sum") : deepSorted(data) };
}


function normalizeRules(rules: any): any {
  if (rules === undefined || rules === null) return rules;
  return ruleRecord(rules);
}

export function normalizeRule(rule: any): any {
  return typeof rule !== "object" || rule === null ? rule : node(rule, RULE, unknownPayload);
}

function normalizeRuleTerm(term: any): any {
  if (typeof term !== "object" || term === null) return term;
  return node(term, RULE_TERM, unknownPayload);
}

function normalizeConstraint(constraint: any): any {
  return typeof constraint !== "object" || constraint === null ? constraint : node(constraint, CONSTRAINT, unknownPayload);
}

function normalizeColumnType(column: any): any {
  if (typeof column !== "object" || column === null) return column;
  const [kind, data] = tagged(column);
  if (kind === "Optional") return { Optional: normalizeColumnType(data) };
  const what = `column.${kind}`;
  if (kind === "List") return { List: { ...pick(data, ["of", "max"], what), of: normalizeColumnType(data.of) } };
  if (kind === "Image") {
    known(data, ["max", "once"], what);
    if (data.once !== undefined && typeof data.once !== "boolean") throw new TypeError("column.Image.once must be boolean");
    return { Image: { max: data.max, ...(data.once === true ? { once: true } : {}) } };
  }
  const fields = COLUMN_FIELDS[kind];
  return { [kind]: fields === undefined ? deepSorted(data) : pick(data, fields, what) };
}

/** The payload fields of each struct-variant column kind, in serde order. */
const COLUMN_FIELDS: Record<string, readonly string[]> = {
  Text: ["max"], Bytes: ["max"], Image: ["max"], Video: ["max"], Enum: ["variants"], Decimal: ["scale"],
  Money: ["currency", "scale"], Ref: ["table"], Json: ["max_bytes"],
};

function normalizeArgType(arg: any): any {
  if (typeof arg !== "object" || arg === null) return arg;
  const [kind, data] = tagged(arg);
  if (kind === "Optional") return { Optional: normalizeArgType(data) };
  if (kind === "Text") {
    known(data, ["max", "min", "format"], "arg.Text");
    if (data.min !== undefined && (!Number.isInteger(data.min) || data.min < 0 || data.min > 0xffffffff))
      throw new TypeError("arg.Text.min must be u32");
    if (data.format !== undefined && data.format !== 'handle' && data.format !== 'url')
      throw new TypeError('arg.Text.format must be handle or url');
    return { Text: { max: data.max, ...(data.min ? { min: data.min } : {}), ...(data.format === undefined ? {} : { format: data.format }) } };
  }
  if (kind === "List") {
    // `ArgType::List { of: Option<Box<ArgType>>, max }`: `of` is skipped when
    // absent, and a payload carrying any other field is refused like every
    // struct variant, never rebuilt without it.
    known(data, ["of", "max"], "arg.List");
    return { List: {
      ...(data.of === null || data.of === undefined ? {} : { of: normalizeArgType(data.of) }),
      max: data.max,
    } };
  }
  return normalizeColumnType(arg);
}

function normalizeStatement(statement: any): any {
  if (typeof statement === "string") return statement;
  const [kind, data] = tagged(statement);
  // The original field lookup refused inherited object names before examining children.
  // Keep that refusal boundary; an unknown constructor must not turn them into hashable IR.
  if (!Object.hasOwn(STATEMENT, kind) && kind in STATEMENT) pick(data, STATEMENT[kind] as any, kind);
  return node(statement, STATEMENT, unchanged);
}

function normalizeDomain(domain: any): any { return node(domain, DOMAIN, unchanged); }
function normalizeExpression(expression: any): any { return node(expression, EXPRESSION, unchanged); }

function normalizeLanes(lanes: any[]): any[] {
  return lanes.map(({ setup, ...lane }: any) => ({ ...(setup?.length ? { setup: setup.map(normalizeStatement) } : {}),
    ...pick(lane, ["scan", "source", "binding"], "merge lane"), scan: normalizeScan(lane.scan),
    ...(lane.source == null ? {} : { source: normalizeScan(lane.source) }),
  }));
}

function normalizeHeldSearch(d: any): any {
  known(d, ["table", "index", "term", "scope", "suffix", "order", "take", "after", "discovery"], "held_search");
  return {
    table: d.table, index: d.index,
    term: { source: normalizeExpression(d.term.source), contract: d.term.contract, source_max: d.term.source_max },
    scope: d.scope.map((s: any) => ({ column: s.column, value: normalizeExpression(s.value) })),
    suffix: d.suffix, order: d.order, take: normalizeBound(d.take), after: nullableExpression(d.after),
    discovery: { scan: normalizeScan(d.discovery.scan), binding: d.discovery.binding, authorization_index: d.discovery.authorization_index },
  };
}

function normalizeScan(scan: any): any {
  return pick(scan, ["site","table","index","prefix","order","take","after","before","range","opaque_cursor","merge_site","provenance"], "scan", SCAN);
}

function normalizeBound(bound: any): any {
  const [kind, data] = tagged(bound);
  return { [kind]: kind === 'Arg' ? pick(data, ['name','max'], 'bound') : data };
}

function nullableExpression(expression: any): any {
  return expression === null ? null : normalizeExpression(expression);
}

function normalizeValue(value: any): any {
  if (typeof value === "string") return value;
  const [kind, data] = tagged(value);
  if (kind === "Array") return { Array: data.map(normalizeValue) };
  if (kind === "Row" || kind === "Map") return { [kind]: sortedMap(data, normalizeValue) };
  return value;
}

const normalizeMaintain = struct("maintain", {
  kind: normalizeMaintainKind, source: null, by: null, target: null,
  readable: value => value == null ? null : normalizeRule(value),
}, true);
const normalizeTable = struct("table", {
  columns: value => sortedMap(value ?? {}, normalizeColumnType), indexes: value => sortedMap(value ?? {}, normalizeIndex),
  rules: normalizeRules, constraints: value => (value ?? []).map(normalizeConstraint), retain: value => value ?? "until-revoked",
}, true);
const normalizeIndex = struct("index", { components: list(component => {
  const [tag, value] = tagged(component);
  if (tag === "Column") return { Column: value };
  if (tag !== "WordPrefixes") throw new EvalError("E_SCHEMA", "unknown index component");
  return { WordPrefixes: pick(value, ["fields","contract"], "WordPrefixes") };
}), unique: null });
const normalizeChannel = struct("channel", {
  args: value => sortedMap(value ?? {}, normalizeArgType), publish: normalizeRule, subscribe: normalizeRule, ttl_ms: null,
}, true);
const ruleRecord = struct("rules", { read: normalizeRule, insert: normalizeRule, update: normalizeRule, delete: normalizeRule }, true);

// These are the existing serde field/transform orders. Domain-specific skips and unknown variants
// remain explicit; a shared constructor does not turn unknown input into an admitted program.
const RULE_TERM: Transforms = { Literal: normalizeValue, Field: unchanged, OldField: unchanged, NextField: unchanged };
const RULE: Transforms = {
  Eq: list(normalizeRuleTerm), Ne: list(normalizeRuleTerm), And: list(normalizeRule), Or: list(normalizeRule), Not: normalizeRule,
  Exists: struct("rule.Exists", { "table": null, "index": null, "key": list(normalizeRuleTerm), "provenance": null }),
  Created: struct("rule.Created", { "table": null, "index": null, "key": list(normalizeRuleTerm), "provenance": null }),
  Public: struct("rule.Public", { "reason": null }),
};
const CONSTRAINT: Transforms = {
  Unique: struct("constraint.Unique", { "index": null }), Cap: struct("constraint.Cap", { "by": null, "max": null }),
  Immutable: struct("constraint.Immutable", { "fields": null }),
  Text: data => {
    known(data, ["field","min","format"], "constraint.Text");
    return { field: data.field, min: data.min ?? 0, ...(data.format == null ? {} : { format: data.format }) };
  },
  FinalExistsOnInsert: struct("constraint.FinalExistsOnInsert", { "table": null, "index": null, "key": list(normalizeRuleTerm) }),
};
const STATEMENT: Transforms = {
  Const: struct("Const", { "name": null, "value": normalizeExpression }),
  Let: struct("Let", { "name": null, "value": normalizeExpression }),
  Assign: struct("Assign", { "name": null, "value": normalizeExpression }),
  Push: struct("Push", { "target": null, "value": normalizeExpression }),
  If: struct("If", { "condition": normalizeExpression, "then_body": list(normalizeStatement), "else_body": list(normalizeStatement) }),
  For: struct("For", { "binding": null, "domain": normalizeDomain, "body": list(normalizeStatement) }),
  Require: struct("Require", { "condition": normalizeExpression, "code": null }),
  Insert: struct("Insert", { "table": null, "row": normalizeExpression }),
  Update: struct("Update", { "table": null, "key": normalizeExpression, "patch": normalizeExpression }),
  Upsert: struct("Upsert", { "table": null, "key": normalizeExpression, "row": normalizeExpression }),
  Delete: struct("Delete", { "table": null, "key": normalizeExpression }),
  Emit: struct("Emit", { "effect": null, "payload": normalizeExpression }), Return: normalizeExpression,
};
const DOMAIN: Transforms = {
  Page: normalizeScan,
  DerivedArray: struct("DerivedArray", { "value": normalizeExpression, "max": null, "bound_source": null }),
  Recurse: struct("Recurse", { "site": null, "table": null, "index": null, "seed": normalizeExpression, "next_field": null, "depth": null, "fanout": null, "provenance": null }),
  LiteralRange: struct("LiteralRange", { "start": null, "end_exclusive": null }), ArgList: struct("ArgList", { "name": null, "max": null }),
};
const read = struct("read", { "site": null, "table": null, "index": null, "key": list(normalizeExpression), "provenance": null });
const EXPRESSION: Transforms = {
  Literal: normalizeValue, Field: struct("Field", { "base": normalizeExpression, "name": null }),
  Array: list(normalizeExpression), Object: value => sortedMap(value, normalizeExpression),
  Binary: struct("Binary", { "op": null, "left": normalizeExpression, "right": normalizeExpression }),
  Unary: struct("Unary", { "op": null, "value": normalizeExpression }),
  Builtin: struct("Builtin", { "builtin": null, "args": list(normalizeExpression) }),
  Get: read, Exists: read, Scan: normalizeScan,
  Merge: struct("Merge", { "site": null, "lanes": normalizeLanes, "held_search": value => value ? normalizeHeldSearch(value) : value }),
};
const SCAN: Transforms = {
  take: normalizeBound,
  prefix: list(key => {
    const [tag, value] = tagged(key);
    if (tag === "Scalar") return { Scalar: normalizeExpression(value) };
    if (tag !== "WordPrefix") throw new EvalError("E_SCHEMA", "unknown index key expression");
    return { WordPrefix: pick(value, ["source","contract","source_max"], "WordPrefix", { source: normalizeExpression }) };
  }),
  after: nullableExpression, before: nullableExpression,
  range: value => value === null ? null : pick(value, ["gt","gte","lt","lte"], "range", {
    gt: nullableExpression, gte: nullableExpression, lt: nullableExpression, lte: nullableExpression,
  }),
};

function sortedMap(value: Record<string, any>, normalize: (item: any) => any): Record<string, any> {
  const result: Record<string, any> = Object.create(null);
  for (const key of Object.keys(value).sort(compareCodepoints)) result[key] = normalize(value[key]);
  return result;
}

function tagged(value: any): [string, any] {
  const keys = Object.keys(value);
  if (keys.length !== 1) throw new Error("E_TRACE_SUBSET: malformed externally tagged IR");
  return [keys[0]!, value[keys[0]!]];
}
