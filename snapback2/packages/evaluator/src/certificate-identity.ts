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
  if (schema.auth != null) known(schema.auth, ["password", "guests"], "auth");
  if (schema.auth !== undefined && (schema.auth.password || schema.auth.guests)) {
    canonical.auth = { password: schema.auth.password, guests: schema.auth.guests };
  }
  if (schema.effects !== undefined && schema.effects.length > 0) canonical.effects = schema.effects;
  return JSON.stringify(canonical);
}

// @ref LLP 1016#d5--schedules-row-timers-and-periods-on-the-owners-clock — declaration sites
// remain diagnostic input and are deliberately absent from evaluator-side schema identity.
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
  const out = pick(maintain, ["kind", "source", "by", "target", "readable"], "maintain");
  out.kind = normalizeMaintainKind(out.kind);
  out.readable = out.readable == null ? null : normalizeRule(out.readable);
  return out;
}

function normalizeMaintainKind(kind: any): any {
  if (typeof kind !== "object" || kind === null) return kind;
  const [tag, data] = tagged(kind);
  return { [tag]: tag === "Sum" ? pick(data, ["of"], "maintain.kind.Sum") : deepSorted(data) };
}

function normalizeTable(table: any): any {
  known(table, ["columns", "indexes", "rules", "constraints", "retain", "tombstones", "deliver"], "table");
  const canonical: Record<string, any> = {
    columns: sortedMap(table.columns ?? {}, normalizeColumnType),
    indexes: sortedMap(table.indexes ?? {}, normalizeIndex),
    rules: normalizeRules(table.rules),
    constraints: (table.constraints ?? []).map(normalizeConstraint),
    retain: table.retain ?? "until-revoked",
  };
  // @ref LLP 1012#5-retention-revocation-and-the-fence — serde skips an empty
  // list, so a table without the word keeps the bytes it had before it existed.
  if (table.tombstones !== undefined) {
    if (!Array.isArray(table.tombstones)) {
      throw new EvalError("E_SCHEMA", "table tombstones must be an array");
    }
    if (table.tombstones.length > 0) canonical.tombstones = table.tombstones.map(normalizeTombstone);
  }
  // @ref LLP 1019#7-the-twin — the declaration is canonicalized in Rust field
  // order and hashed, never stripped to make prediction work; serde skips a
  // false flag, so the bytes carry only the words the line said.
  if (table.deliver != null) {
    const deliver = pick(table.deliver, ["target", "prefix", "principal", "log", "receipts", "bootstrap"], "deliver");
    for (const flag in deliver) if (deliver[flag] === false) delete deliver[flag];
    canonical.deliver = deliver;
  }
  return canonical;
}

function normalizeTombstone(tombstone: any): any {
  const out = pick(tombstone, ["table", "column", "when"], "tombstone");
  out.when = normalizeRule(tombstone.when);
  return out;
}

function normalizeIndex(index: any): any {
  return { ...pick(index, ["components", "unique"], "index"), components: index.components.map((c: any) => {
    const [tag, value] = tagged(c);
    if (tag === "Column") return { Column: value };
    if (tag !== "WordPrefixes") throw new EvalError("E_SCHEMA", "unknown index component");
    return { WordPrefixes: pick(value, ["fields", "contract"], "WordPrefixes") };
  }) };
}

function normalizeChannel(channel: any): any {
  // @ref LLP 1001.000#declaration-and-value — typed latest state participates in the schema identity in Rust field order.
  known(channel, ["args", "value", "publish", "subscribe", "ttl_ms"], "channel");
  const value = channel.value;
  if (value == null || typeof value !== "object" || Array.isArray(value) || Object.keys(value).length === 0) {
    throw new EvalError("E_SCHEMA", "channel value requires a nonempty record declaration");
  }
  return {
    args: sortedMap(channel.args ?? {}, normalizeArgType),
    value: sortedMap(value, normalizeArgType),
    publish: normalizeRule(channel.publish),
    subscribe: normalizeRule(channel.subscribe),
    ttl_ms: channel.ttl_ms,
  };
}

function normalizeRules(rules: any): any {
  if (rules == null) return rules;
  const out = pick(rules, ["read", "insert", "update", "delete"], "rules");
  for (const kind in out) out[kind] = normalizeRule(out[kind]);
  return out;
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
        ...(data.format == null ? {} : { format: data.format }),
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
  Text: ["max"], Bytes: ["max"], Video: ["max"], Enum: ["variants"], Decimal: ["scale"],
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
      ...(data.of == null ? {} : { of: normalizeArgType(data.of) }),
      max: data.max,
    } };
  }
  return normalizeColumnType(arg);
}

function normalizeStatement(statement: any): any {
  if (typeof statement === "string") return statement;
  const [kind, raw] = tagged(statement);
  const shape = Object.hasOwn(STATEMENTS, kind) ? STATEMENTS[kind] : undefined;
  const data = shape ? pick(raw, shape[0], kind) : raw;
  for (const field of shape?.[1] ?? []) data[field] = normalizeExpression(data[field]);
  switch (kind) {
    case "Check": data.current = normalizeRead(data.current); break;
    case "Require": if (data.site == null) delete data.site; break;
    case "If":
      data.then_body = data.then_body.map(normalizeStatement); data.else_body = data.else_body.map(normalizeStatement); break;
    case "For": data.domain = normalizeDomain(data.domain); data.body = data.body.map(normalizeStatement); break;
    case "Return": return { Return: normalizeExpression(data) };
    default: if (!shape) return statement;
  }
  return { [kind]: data };
}

/** Serde field order and expression-bearing fields for statement struct variants. */
const STATEMENTS: Record<string, readonly [readonly string[], readonly string[]]> = {
  Const: [['name','value'], ['value']], Let: [['name','value'], ['value']], Assign: [['name','value'], ['value']], Push: [['target','value'], ['value']],
  If: [['condition','then_body','else_body'], ['condition']], For: [['binding','domain','body'], []], Require: [['condition','code','site'], ['condition']],
  Check: [["condition", "current"], ["condition"]], InsertIfAbsent: [["table", "row", "result"], ["row"]],
  Insert: [['table','row'], ['row']], Update: [['table','key','patch'], ['key','patch']], Upsert: [['table','key','row'], ['key','row']],
  Delete: [['table','key'], ['key']], Emit: [['effect','payload'], ['payload']],
};

function normalizeDomain(domain: any): any {
  const [kind, raw] = tagged(domain);
  const fields = kind === 'DerivedArray' ? ['value','max','bound_source'] : kind === 'Recurse' ? ['site','table','index','seed','next_field','depth','fanout','provenance']
    : kind === 'LiteralRange' ? ['start','end_exclusive'] : kind === 'ArgList' ? ['name','max'] : undefined;
  const data = fields ? pick(raw, fields, kind) : raw;
  switch (kind) {
    case "Page": return { Page: normalizeScan(data) };
    case "DerivedArray": data.value = normalizeExpression(data.value); break;
    case "Recurse": data.seed = normalizeExpression(data.seed); break;
  }
  return { [kind]: data };
}

function normalizeExpression(expression: any): any {
  const [kind, raw] = tagged(expression);
  const fields = kind === 'Field' ? ['base','name'] : kind === 'Binary' ? ['op','left','right'] : kind === 'Unary' ? ['op','value']
    : kind === 'Builtin' ? ['builtin','args'] : kind === 'Merge' ? ['site','lanes','held_search'] : undefined;
  const data = fields ? pick(raw, fields, kind) : raw;
  switch (kind) {
    case "Literal": return { Literal: normalizeValue(data) };
    case "Field": data.base = normalizeExpression(data.base); break;
    case "Array": return { Array: data.map(normalizeExpression) };
    case "Object": return { Object: sortedMap(data, normalizeExpression) };
    case "Binary": data.left = normalizeExpression(data.left); data.right = normalizeExpression(data.right); break;
    case "Unary": data.value = normalizeExpression(data.value); break;
    case "Builtin": data.args = data.args.map(normalizeExpression); break;
    case "Get": case "Exists": return { [kind]: normalizeRead(data) };
    case "Scan": return { Scan: normalizeScan(data) };
    case "Merge":
      data.lanes = data.lanes.map(({ setup, ...lane }: any) => ({ ...(setup?.length ? { setup: setup.map(normalizeStatement) } : {}),
        ...pick(lane, ["scan", "source", "binding"], "merge lane"), scan: normalizeScan(lane.scan),
        ...(lane.source == null ? {} : { source: normalizeScan(lane.source) }),
      }));
      if (data.held_search) data.held_search = normalizeHeldSearch(data.held_search); break;
    default: return expression;
  }
  return { [kind]: data };
}

function normalizeHeldSearch(d: any): any {
  const out = pick(d, ["table", "index", "term", "scope", "suffix", "order", "take", "after", "discovery"], "held_search");
  out.term = { source: normalizeExpression(d.term.source), contract: d.term.contract, source_max: d.term.source_max };
  out.scope = d.scope.map((s: any) => ({ column: s.column, value: normalizeExpression(s.value) }));
  out.take = normalizeBound(d.take);
  out.after = nullableExpression(d.after);
  out.discovery = { scan: normalizeScan(d.discovery.scan), binding: d.discovery.binding, authorization_index: d.discovery.authorization_index };
  return out;
}

function normalizeRead(read: any): any {
  return { ...pick(read, ["site","table","index","key","provenance"], "read"), key: read.key.map(normalizeExpression) };
}

function normalizeScan(scan: any): any {
  return {
    ...pick(scan, ["site","table","index","prefix","order","take","after","before","range","opaque_cursor","merge_site","provenance"], "scan"),
    take: normalizeBound(scan.take),
    prefix: scan.prefix.map((key: any) => {
      const [tag, value] = tagged(key);
      if (tag === "Scalar") return { Scalar: normalizeExpression(value) };
      if (tag !== "WordPrefix") throw new EvalError("E_SCHEMA", "unknown index key expression");
      return { WordPrefix: { ...pick(value, ["source", "contract", "source_max"], "WordPrefix"), source: normalizeExpression(value.source) } };
    }),
    after: nullableExpression(scan.after),
    before: nullableExpression(scan.before),
    range: scan.range === null ? null : {
      ...pick(scan.range, ["gt", "gte", "lt", "lte"], "range"),
      gt: nullableExpression(scan.range.gt),
      gte: nullableExpression(scan.range.gte),
      lt: nullableExpression(scan.range.lt),
      lte: nullableExpression(scan.range.lte),
    },
  };
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
