// @ref LLP 1001#10-what-binds-and-how-it-is-checked — certificate identity uses
// Rust serde's BTreeMap order even when a direct TypeScript caller constructed
// the equivalent object with a different property insertion order.

import { EvalError } from "./errors";

export function canonicalProgramJson(program: any): string {
  return JSON.stringify({
    ...program,
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
function pick(record: any, fields: readonly string[], what: string): Record<string, any> {
  known(record, fields, what);
  const out: Record<string, any> = {};
  for (const field of fields) if (record[field] !== undefined) out[field] = record[field];
  return out;
}

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

function normalizeMaintain(maintain: any): any {
  known(maintain, ["kind", "source", "by", "target", "readable"], "maintain");
  return {
    kind: normalizeMaintainKind(maintain.kind),
    source: maintain.source,
    by: maintain.by,
    target: maintain.target,
    readable: maintain.readable === null || maintain.readable === undefined ? null : normalizeRule(maintain.readable),
  };
}

function normalizeMaintainKind(kind: any): any {
  if (typeof kind !== "object" || kind === null) return kind;
  const [tag, data] = tagged(kind);
  return { [tag]: tag === "Sum" ? pick(data, ["of"], "maintain.kind.Sum") : deepSorted(data) };
}

function normalizeTable(table: any): any {
  known(table, ["columns", "indexes", "rules", "constraints", "retain"], "table");
  return {
    columns: sortedMap(table.columns ?? {}, normalizeColumnType),
    indexes: sortedMap(table.indexes ?? {}, normalizeIndex),
    rules: normalizeRules(table.rules),
    constraints: (table.constraints ?? []).map(normalizeConstraint),
    retain: table.retain ?? "until-revoked",
  };
}

function normalizeIndex(index: any): any {
  return pick(index, ["columns", "unique"], "index");
}

function normalizeChannel(channel: any): any {
  known(channel, ["args", "publish", "subscribe", "ttl_ms"], "channel");
  return {
    args: sortedMap(channel.args ?? {}, normalizeArgType),
    publish: normalizeRule(channel.publish),
    subscribe: normalizeRule(channel.subscribe),
    ttl_ms: channel.ttl_ms,
  };
}

function normalizeRules(rules: any): any {
  if (rules === undefined || rules === null) return rules;
  known(rules, ["read", "insert", "update", "delete"], "rules");
  return {
    read: normalizeRule(rules.read),
    insert: normalizeRule(rules.insert),
    update: normalizeRule(rules.update),
    delete: normalizeRule(rules.delete),
  };
}

export function normalizeRule(rule: any): any {
  if (typeof rule !== "object" || rule === null) return rule;
  const [kind, data] = tagged(rule);
  switch (kind) {
    case "Eq":
    case "Ne":
      return { [kind]: data.map(normalizeRuleTerm) };
    case "And":
    case "Or":
      return { [kind]: data.map(normalizeRule) };
    case "Not":
      return { [kind]: normalizeRule(data) };
    case "Exists":
    case "Created":
      return { [kind]: { ...pick(data, ["table", "index", "key", "provenance"], `rule.${kind}`), key: data.key.map(normalizeRuleTerm) } };
    case "Public":
      return { Public: pick(data, ["reason"], "rule.Public") };
    default:
      return { [kind]: deepSorted(data) };
  }
}

function normalizeRuleTerm(term: any): any {
  if (typeof term !== "object" || term === null) return term;
  const [kind, data] = tagged(term);
  if (kind === "Literal") return { Literal: normalizeValue(data) };
  if (kind === "Field" || kind === "OldField" || kind === "NextField") return term;
  return { [kind]: deepSorted(data) };
}

function normalizeConstraint(constraint: any): any {
  if (typeof constraint !== "object" || constraint === null) return constraint;
  const [kind, data] = tagged(constraint);
  const what = `constraint.${kind}`;
  switch (kind) {
    case "Unique": return { Unique: pick(data, ["index"], what) };
    case "Cap": return { Cap: pick(data, ["by", "max"], what) };
    case "Immutable": return { Immutable: pick(data, ["fields"], what) };
    case "Text":
      known(data, ["field", "min", "format"], what);
      return { Text: {
        field: data.field,
        min: data.min ?? 0,
        ...(data.format === undefined || data.format === null ? {} : { format: data.format }),
      } };
    case "FinalExistsOnInsert":
      return { FinalExistsOnInsert: { ...pick(data, ["table", "index", "key"], what), key: data.key.map(normalizeRuleTerm) } };
    default: return { [kind]: deepSorted(data) };
  }
}

function normalizeColumnType(column: any): any {
  if (typeof column !== "object" || column === null) return column;
  const [kind, data] = tagged(column);
  if (kind === "Optional") return { Optional: normalizeColumnType(data) };
  const what = `column.${kind}`;
  if (kind === "List") return { List: { ...pick(data, ["of", "max"], what), of: normalizeColumnType(data.of) } };
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
  switch (kind) {
    case "Const":
    case "Let":
    case "Assign":
    case "Push":
      return { [kind]: { ...data, value: normalizeExpression(data.value) } };
    case "If":
      return { If: {
        ...data,
        condition: normalizeExpression(data.condition),
        then_body: data.then_body.map(normalizeStatement),
        else_body: data.else_body.map(normalizeStatement),
      } };
    case "For":
      return { For: {
        ...data,
        domain: normalizeDomain(data.domain),
        body: data.body.map(normalizeStatement),
      } };
    case "Require":
      return { Require: { ...data, condition: normalizeExpression(data.condition) } };
    case "Insert":
      return { Insert: { ...data, row: normalizeExpression(data.row) } };
    case "Update":
      return { Update: {
        ...data,
        key: normalizeExpression(data.key),
        patch: normalizeExpression(data.patch),
      } };
    case "Upsert":
      return { Upsert: {
        ...data,
        key: normalizeExpression(data.key),
        row: normalizeExpression(data.row),
      } };
    case "Delete":
      return { Delete: { ...data, key: normalizeExpression(data.key) } };
    case "Emit":
      return { Emit: { ...data, payload: normalizeExpression(data.payload) } };
    case "Return":
      return { Return: normalizeExpression(data) };
    default:
      return statement;
  }
}

function normalizeDomain(domain: any): any {
  const [kind, data] = tagged(domain);
  switch (kind) {
    case "Page":
      return { Page: normalizeScan(data) };
    case "DerivedArray":
      return { DerivedArray: { ...data, value: normalizeExpression(data.value) } };
    case "Recurse":
      return { Recurse: { ...data, seed: normalizeExpression(data.seed) } };
    default:
      return domain;
  }
}

function normalizeExpression(expression: any): any {
  const [kind, data] = tagged(expression);
  switch (kind) {
    case "Literal":
      return { Literal: normalizeValue(data) };
    case "Field":
      return { Field: { ...data, base: normalizeExpression(data.base) } };
    case "Array":
      return { Array: data.map(normalizeExpression) };
    case "Object":
      return { Object: sortedMap(data, normalizeExpression) };
    case "Binary":
      return { Binary: {
        ...data,
        left: normalizeExpression(data.left),
        right: normalizeExpression(data.right),
      } };
    case "Unary":
      return { Unary: { ...data, value: normalizeExpression(data.value) } };
    case "Builtin":
      return { Builtin: { ...data, args: data.args.map(normalizeExpression) } };
    case "Get":
    case "Exists":
      return { [kind]: normalizeRead(data) };
    case "Scan":
      return { Scan: normalizeScan(data) };
    default:
      return expression;
  }
}

function normalizeRead(read: any): any {
  return { ...read, key: read.key.map(normalizeExpression) };
}

function normalizeScan(scan: any): any {
  return {
    ...scan,
    prefix: scan.prefix.map(normalizeExpression),
    after: nullableExpression(scan.after),
    before: nullableExpression(scan.before),
    range: scan.range === null ? null : {
      ...scan.range,
      gt: nullableExpression(scan.range.gt),
      gte: nullableExpression(scan.range.gte),
      lt: nullableExpression(scan.range.lt),
      lte: nullableExpression(scan.range.lte),
    },
  };
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

function compareCodepoints(left: string, right: string): number {
  const leftPoints = Array.from(left, (value) => value.codePointAt(0)!);
  const rightPoints = Array.from(right, (value) => value.codePointAt(0)!);
  for (let index = 0; index < Math.min(leftPoints.length, rightPoints.length); index += 1) {
    if (leftPoints[index] !== rightPoints[index]) return leftPoints[index]! - rightPoints[index]!;
  }
  return leftPoints.length - rightPoints.length;
}
