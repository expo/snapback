// @ref LLP 1001#10-what-binds-and-how-it-is-checked — certificate identity uses
// Rust serde's BTreeMap order even when a direct TypeScript caller constructed
// the equivalent object with a different property insertion order.

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
export function canonicalSchemaJson(schema: any): string {
  const canonical: Record<string, any> = {
    tables: sortedMap(schema.tables ?? {}, normalizeTable),
    maintains: (schema.maintains ?? []).map(normalizeMaintain),
  };
  if (schema.channels !== undefined && Object.keys(schema.channels).length > 0) {
    canonical.channels = sortedMap(schema.channels, normalizeChannel);
  }
  if (schema.auth !== undefined && (schema.auth.password || schema.auth.guests)) {
    canonical.auth = { password: schema.auth.password, guests: schema.auth.guests };
  }
  if (schema.effects !== undefined && schema.effects.length > 0) canonical.effects = schema.effects;
  return JSON.stringify(canonical);
}

/** A rule in serde's field order: what `Schema::rule_hash` serializes beside the schema hash. */
export function canonicalRuleJson(rule: any): string {
  return JSON.stringify(normalizeRule(rule));
}

function normalizeMaintain(maintain: any): any {
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
  return tag === "Sum" ? { Sum: { of: data.of } } : kind;
}

function normalizeTable(table: any): any {
  return {
    columns: sortedMap(table.columns ?? {}, normalizeColumnType),
    indexes: sortedMap(table.indexes ?? {}, normalizeIndex),
    rules: normalizeRules(table.rules),
    constraints: (table.constraints ?? []).map(normalizeConstraint),
    retain: table.retain ?? "until-revoked",
  };
}

function normalizeIndex(index: any): any {
  return { columns: index?.columns, unique: index?.unique };
}

function normalizeChannel(channel: any): any {
  return {
    args: sortedMap(channel.args ?? {}, normalizeArgType),
    publish: normalizeRule(channel.publish),
    subscribe: normalizeRule(channel.subscribe),
    ttl_ms: channel.ttl_ms,
  };
}

function normalizeRules(rules: any): any {
  if (rules === undefined || rules === null) return rules;
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
      return { [kind]: {
        table: data.table,
        index: data.index,
        key: data.key.map(normalizeRuleTerm),
        provenance: data.provenance,
      } };
    case "Public":
      return { Public: { reason: data.reason } };
    default:
      return rule;
  }
}

function normalizeRuleTerm(term: any): any {
  if (typeof term !== "object" || term === null) return term;
  const [kind, data] = tagged(term);
  return kind === "Literal" ? { Literal: normalizeValue(data) } : term;
}

function normalizeConstraint(constraint: any): any {
  if (typeof constraint !== "object" || constraint === null) return constraint;
  const [kind, data] = tagged(constraint);
  switch (kind) {
    case "Unique": return { Unique: { index: data.index } };
    case "Cap": return { Cap: { by: data.by, max: data.max } };
    case "Immutable": return { Immutable: { fields: data.fields } };
    case "Text": return { Text: {
      field: data.field,
      min: data.min ?? 0,
      ...(data.format === undefined || data.format === null ? {} : { format: data.format }),
    } };
    case "FinalExistsOnInsert": return { FinalExistsOnInsert: {
      table: data.table,
      index: data.index,
      key: data.key.map(normalizeRuleTerm),
    } };
    default: return constraint;
  }
}

function normalizeColumnType(column: any): any {
  if (typeof column !== "object" || column === null) return column;
  const [kind, data] = tagged(column);
  if (kind === "Optional") return { Optional: normalizeColumnType(data) };
  if (kind === "List") return { List: { of: normalizeColumnType(data.of), max: data.max } };
  if (["Text", "Bytes", "Image", "Video"].includes(kind)) return { [kind]: { max: data.max } };
  if (kind === "Enum") return { Enum: { variants: data.variants } };
  if (kind === "Decimal") return { Decimal: { scale: data.scale } };
  if (kind === "Money") return { Money: { currency: data.currency, scale: data.scale } };
  if (kind === "Ref") return { Ref: { table: data.table } };
  if (kind === "Json") return { Json: { max_bytes: data.max_bytes } };
  return { [kind]: data };
}

function normalizeArgType(arg: any): any {
  if (typeof arg !== "object" || arg === null) return arg;
  const [kind, data] = tagged(arg);
  if (kind === "Optional") return { Optional: normalizeArgType(data) };
  if (kind === "List") {
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
