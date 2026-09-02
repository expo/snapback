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

export function canonicalSchemaJson(schema: any): string {
  return JSON.stringify({
    ...schema,
    tables: sortedMap(schema.tables ?? {}, normalizeTable),
    maintains: (schema.maintains ?? []).map(normalizeMaintain),
    channels: schema.channels === undefined
      ? undefined
      : sortedMap(schema.channels, normalizeChannel),
  });
}

function normalizeMaintain(maintain: any): any {
  return {
    ...maintain,
    readable: maintain.readable === null ? null : normalizeRule(maintain.readable),
  };
}

function normalizeTable(table: any): any {
  return {
    ...table,
    columns: sortedMap(table.columns ?? {}, normalizeColumnType),
    indexes: sortedMap(table.indexes ?? {}, (index) => index),
    rules: normalizeRules(table.rules),
    constraints: (table.constraints ?? []).map(normalizeConstraint),
  };
}

function normalizeChannel(channel: any): any {
  return {
    ...channel,
    args: sortedMap(channel.args ?? {}, normalizeArgType),
    publish: normalizeRule(channel.publish),
    subscribe: normalizeRule(channel.subscribe),
  };
}

function normalizeRules(rules: any): any {
  if (rules === undefined) return rules;
  return {
    ...rules,
    read: normalizeRule(rules.read),
    insert: normalizeRule(rules.insert),
    update: normalizeRule(rules.update),
    delete: normalizeRule(rules.delete),
  };
}

function normalizeRule(rule: any): any {
  if (typeof rule === "string") return rule;
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
      return { [kind]: { ...data, key: data.key.map(normalizeRuleTerm) } };
    default:
      return rule;
  }
}

function normalizeRuleTerm(term: any): any {
  if (typeof term === "string") return term;
  const [kind, data] = tagged(term);
  return kind === "Literal" ? { Literal: normalizeValue(data) } : term;
}

function normalizeConstraint(constraint: any): any {
  return constraint;
}

function normalizeColumnType(column: any): any {
  if (typeof column === "string") return column;
  const [kind, data] = tagged(column);
  if (kind === "Optional") return { Optional: normalizeColumnType(data) };
  if (kind === "List") return { List: { ...data, of: normalizeColumnType(data.of) } };
  return column;
}

function normalizeArgType(arg: any): any {
  if (typeof arg === "string") return arg;
  const [kind, data] = tagged(arg);
  if (kind === "Optional") return { Optional: normalizeArgType(data) };
  if (kind === "List" && data.of !== null && data.of !== undefined) {
    return { List: { ...data, of: normalizeArgType(data.of) } };
  }
  return arg;
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
