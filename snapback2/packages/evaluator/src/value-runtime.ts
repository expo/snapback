import { compareCodepoints } from './hash';
export { compareCodepoints } from './hash';
import coreIrContract from "../../../crates/snapback2-core/ir-contract.json" with { type: "json" };
import { canonicalRuleJson, canonicalSchemaJson } from "./certificate-identity";
import { fail, EvalError } from "./errors";
import { sha256, utf8Length } from "./hash";
import { cursorSuffix, decodeCursor, decodeCursorFor } from "./cursor";
import { scalarLength } from "./unicode";
import type { TraceRange, Value } from "./types";
import { immutable, RowImage } from "./row-image";

const preparedSchemas = new WeakMap<object,{ hash: string; rules: Map<unknown,string>; rangeHash?: string }>();

// @ref LLP 1012#6-reads-offline — only this isolated, deeply immutable schema
// custody may reuse canonical schema/rule bytes across fresh Runner executions.
export function prepareSchema(schema: any, expected: string): any {
  const owned = immutable(structuredClone(schema));
  if (schemaDigest(owned) !== expected) return;
  const rules = new Map<unknown,string>();
  for (const table of Object.values<any>(owned.tables)) for (const rule of Object.values(table.rules ?? {}))
    rules.set(rule,sha256(`[${JSON.stringify(expected)},${canonicalRuleJson(rule)}]`));
  return preparedSchemas.set(owned,{ hash: expected,rules }),owned;
}

// @ref LLP 1018.008.004#implementation-selection-2026-09-10 — reuse only
// validated immutable custody, never a mutable caller's claimed identity.
export function schemaDigest(schema: any): string {
  return preparedSchemas.get(schema)?.hash ?? sha256(canonicalSchemaJson(schema));
}

// @ref LLP 1018.008.007.002#6-reduce-the-remaining-preparation-and-publication-work — retain the exact range identity only in existing validated immutable schema custody.
export function rangeSchemaIdentity(schema: any): string {
  const owned = preparedSchemas.get(schema);
  return owned ? owned.rangeHash ??= sha256(canonicalJson(schema)) : sha256(canonicalJson(schema));
}

export function canonicalValue(value: Value): string {
  if (value === "Null") return '"Null"';
  const kind = kindOf(value);
  const data = (value as any)[kind];
  if (kind === "Bool" || kind === "Int") return `{"${kind}":${JSON.stringify(data)}}`;
  if (kind === "String" || kind === "Id") return `{"${kind}":${JSON.stringify(data)}}`;
  if (kind === "Bytes") {
    if (!canonicalBytes(data)) fail("E_INPUT", "Bytes is not canonical lowercase base16");
    return `{"Bytes":${JSON.stringify(data)}}`;
  }
  if (kind === "Array") return `{"Array":${canonicalValues(data)}}`;
  const entries = Object.keys(data)
    .sort(compareCodepoints)
    .map((key) => `${JSON.stringify(key)}:${canonicalValue(data[key])}`)
    .join(",");
  return `{"${kind}":{${entries}}}`;
}

export function canonicalValues(values: Value[]): string {
  return `[${values.map(canonicalValue).join(",")}]`;
}

export function rangeStops(ranges: TraceRange[]): Record<string, string[]> {
  const result: Record<string, string[]> = Object.create(null);
  for (const range of ranges) (result[range.site] ??= []).push(range.stop);
  return sortObject(result);
}

// @ref LLP 1001#2-what-a-commit-records — omitted Optional fields are Null before rules and maintains.
export function materializeOptionalFields(schema: any, tableName: string, value: Value): Value {
  if (!isVariant(value, "Row")) return clone(value);
  const entries: Record<string, Value> = Object.assign(Object.create(null), value.Row);
  for (const [name, descriptor] of Object.entries<any>(
    schema.tables?.[tableName]?.columns ?? {},
  )) {
    if (descriptor?.Optional !== undefined && !hasOwn(entries, name)) {
      entries[name] = "Null";
    }
  }
  return rowValue(entries);
}

export function rowValue(entries: Record<string, Value>): Value {
  const sorted: Record<string, Value> = Object.create(null);
  for (const key of Object.keys(entries).sort(compareCodepoints)) sorted[key] = clone(entries[key]);
  return { Row: sorted };
}

export function field(value: Value, name: string): Value {
  const object = asObject(value);
  if (!hasOwn(object, name)) fail("E_FIELD", `missing field ${name}`);
  return object[name];
}

export function fieldOrNull(value: Value, name: string): Value {
  const object = asObject(value);
  return hasOwn(object, name) ? object[name] : "Null";
}

export function asObject(value: Value): Record<string, Value> {
  if (isVariant(value, "Row")) return value.Row;
  if (isVariant(value, "Map")) return value.Map;
  fail("E_TYPE", "expected row or map");
}

export function asArray(value: Value): Value[] {
  if (!isVariant(value, "Array")) fail("E_TYPE", "expected array");
  return value.Array;
}

export function asString(value: Value): string {
  if (isVariant(value, "String")) return value.String;
  if (isVariant(value, "Id")) return value.Id;
  fail("E_TYPE", "expected string or id");
}

export function asInt(value: Value): number {
  if (!isVariant(value, "Int")) fail("E_TYPE", "expected int");
  return value.Int;
}

export function asBool(value: Value): boolean {
  if (!isVariant(value, "Bool")) fail("E_TYPE", "expected bool");
  return value.Bool;
}

export function int(value: number): Value {
  return { Int: safeNumber(value) };
}

export function safeNumber(value: number): number {
  if (!Number.isSafeInteger(value))
    fail("E_OVERFLOW", `${value} is outside the i53 value model`);
  return value;
}

export function totalCompare(left: Value, right: Value): number {
  const order = ["Null", "Bool", "Int", "String", "Id", "Bytes", "Row", "Array", "Map"];
  const leftKind = kindOf(left);
  const rightKind = kindOf(right);
  const tag = order.indexOf(leftKind) - order.indexOf(rightKind);
  if (tag !== 0) return Math.sign(tag);
  if (leftKind === "Null") return 0;
  const leftData = (left as any)[leftKind];
  const rightData = (right as any)[rightKind];
  if (leftKind === "Bool" || leftKind === "Int") return comparePrimitive(leftData, rightData);
  if (leftKind === "String" || leftKind === "Id") return compareCodepoints(leftData, rightData);
  if (leftKind === "Bytes") {
    if (!canonicalBytes(leftData) || !canonicalBytes(rightData))
      fail("E_INPUT", "Bytes is not canonical lowercase base16");
    return compareCodepoints(leftData, rightData);
  }
  if (leftKind === "Array") return compareArrays(leftData, rightData);
  const leftEntries = Object.keys(leftData).sort(compareCodepoints);
  const rightEntries = Object.keys(rightData).sort(compareCodepoints);
  const length = comparePrimitive(leftEntries.length, rightEntries.length);
  if (length) return length;
  for (let index = 0; index < leftEntries.length; index += 1) {
    const key = compareCodepoints(leftEntries[index], rightEntries[index]);
    if (key) return key;
    const value = totalCompare(leftData[leftEntries[index]], rightData[rightEntries[index]]);
    if (value) return value;
  }
  return 0;
}

export function compareArrays(left: Value[], right: Value[]): number {
  const length = Math.min(left.length, right.length);
  for (let index = 0; index < length; index += 1) {
    const compared = totalCompare(left[index], right[index]);
    if (compared) return compared;
  }
  return comparePrimitive(left.length, right.length);
}

export function comparePrimitive(left: number | boolean | string, right: number | boolean | string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

export function variant(value: any): [string, any] {
  if (typeof value === "string") return [value, null];
  const keys = Object.keys(value);
  if (keys.length !== 1) fail("E_CORPUS", "invalid externally tagged variant");
  return [keys[0], value[keys[0]]];
}

/** The wire encoding of an IR value — ids and text as strings, integers as
 * numbers, null as null, bytes as `{ Bytes: hex }`, rows and maps as objects,
 * arrays as arrays — the form the delivery envelope carries
 * (`offline.rs` `value_to_wire_json`). Verdict inputs are digested in it. */
export function wireJson(value: Value): unknown {
  const [kind, data] = variant(value);
  switch (kind) {
    case "Null": return null;
    case "Bool": case "Int": case "String": case "Id": return data;
    case "Bytes": return { Bytes: data };
    case "Row": case "Map":
      return Object.fromEntries(Object.keys(data).sort(compareCodepoints).map((key) => [key, wireJson(data[key])]));
    case "Array": return data.map(wireJson);
    default: fail("E_INPUT", `unsupported value kind ${kind}`);
  }
}

/** The digest a replay trace carries for a point read: SHA-256 over the canonical
 * wire row, exactly `snapback2-core`'s `row_digest` (`offline.rs`). */
export function rowDigest(row: Value): string {
  return sha256(JSON.stringify(wireJson(row)));
}

/** `Schema::rule_hash`: the schema hash beside the rule in serde's field order. */
export function scopedRuleHash(schema: any, rule: any): string {
  return preparedSchemas.get(schema)?.rules.get(rule) ?? sha256(`[${JSON.stringify(schemaDigest(schema))},${canonicalRuleJson(rule)}]`);
}

export function kindOf(value: Value): string {
  if (value === "Null") return "Null";
  const keys = Object.keys(value);
  if (keys.length !== 1) fail("E_INPUT", "invalid externally tagged value");
  return keys[0];
}

export function isVariant<K extends Exclude<ReturnType<typeof kindOf>, "Null">>(
  value: Value,
  kind: K,
): value is Extract<Value, Record<K, unknown>> {
  return value !== "Null" && kindOf(value) === kind;
}

export function valuesEqual(left: Value[], right: Value[]): boolean {
  return canonicalValues(left) === canonicalValues(right);
}

export function sameValueZero(left: Value, right: Value): boolean {
  // @ref LLP 1002#2-the-authored-surface-the-snapback2-module — Keep the client twin on the compiler's primitive collection identity contract.
  const leftKind = kindOf(left);
  const rightKind = kindOf(right);
  if (["Bytes", "Row", "Array", "Map"].includes(leftKind)) {
    fail("E_TYPE", `SameValueZero expects primitive operands, got ${leftKind}`);
  }
  if (["Bytes", "Row", "Array", "Map"].includes(rightKind)) {
    fail("E_TYPE", `SameValueZero expects primitive operands, got ${rightKind}`);
  }
  if ((leftKind === "String" || leftKind === "Id") && (rightKind === "String" || rightKind === "Id")) {
    const leftText = isVariant(left, "String") ? left.String : (left as { Id: string }).Id;
    const rightText = isVariant(right, "String") ? right.String : (right as { Id: string }).Id;
    return leftText === rightText;
  }
  return canonicalValue(left) === canonicalValue(right);
}

export function startsWith<T>(values: T[], prefix: T[]): boolean {
  return prefix.every((value, index) => values[index] === value);
}

export function validHttpUrl(value: string): boolean {
  const rest = value.startsWith("https://")
    ? value.slice("https://".length)
    : value.startsWith("http://")
      ? value.slice("http://".length)
      : "";
  return rest.length > 0 && !/[\p{White_Space}\p{Cc}]/u.test(rest);
}

export function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (plainObject(value)) {
    return `{${Object.keys(value)
      .sort(compareCodepoints)
      .map((key) => `${JSON.stringify(key)}:${canonicalJson((value as any)[key])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

export function validateWriteRow(schema: any, tableName: string, row: Value): void {
  const columns = schema.tables?.[tableName]?.columns;
  if (columns === undefined) fail("E_SCHEMA", `missing table ${tableName}`);
  const object = asObject(row);
  if (!hasOwn(object, "id")) fail("E_SCHEMA", `${tableName} row lacks id`);
  const unknown = Object.keys(object).find((name) => !hasOwn(columns, name));
  if (unknown !== undefined)
    fail("E_INPUT", `${tableName} row contains undeclared field ${unknown}`);
  for (const [name, descriptor] of Object.entries<any>(columns)) {
    const value = hasOwn(object, name) ? object[name] : undefined;
    if (value === undefined && descriptor?.Optional === undefined)
      fail("E_INPUT", `${tableName}.${name} is required`);
    if (value !== undefined) validateColumnValue(schema, tableName, name, value);
  }
  const id = object.id;
  if (isVariant(id, 'Id') && !identityFits(id.Id)) {
    const maintain = schema.maintains.find((m: any) => m.target === tableName);
    if (canonicalValues(maintain.by.map((name: string) => fieldOrNull(row, name))) !== id.Id)
      fail('E_INPUT', `${tableName}.id differs from its maintained group`);
  }
}

export function validateInputs(schema: any, program: any, inputs: Record<string, Value>): void {
  for (const [name, descriptor] of Object.entries<any>(program.args ?? {})) {
    const value = inputs[name];
    if (value === undefined) fail("E_INPUT", `missing arg ${name}`);
    validateTypedValue(descriptor, value, `arg ${name}`, true, false, schema);
  }
}

/** Cursor scope follows executed control flow, including an empty merge. */
export function validateScanCursor(schema: any, scan: any, bindings: Map<string, Value>): void {
  if (!scan.opaque_cursor) return;
  if (scan.before !== null) fail("E_INPUT", "opaque cursors only support after");
  const cursor = scan.after?.Variable !== undefined ? bindings.get(scan.after.Variable) : scan.after?.Literal;
  if (cursor === undefined) fail("E_INPUT", "opaque cursor expression must derive from an operation argument");
  if (cursor === "Null") return;
  if (!isVariant(cursor, "String")) fail("E_INPUT", "opaque cursor must be a string");
  decodeCursorFor(cursor.String, {
    table: scan.table, index: scan.index, order: scan.order, suffix: cursorSuffix(schema, scan),
  }, schema);
}

/** Intrinsic addresses belong to the table; references belong to their declared target. */
export function columnDescriptor(schema: any, table: string, column: string): any {
  const kind = schema?.tables?.[table]?.columns?.[column];
  if (kind === undefined) fail('E_SCHEMA', `missing column ${table}.${column}`);
  return column === 'id' && kind === 'Id' ? { Ref: { table } } : kind;
}
export function validateColumnValue(schema: any, table: string, column: string, value: Value, internalKey = false): void {
  validateTypedValue(columnDescriptor(schema, table, column), value, `${table}.${column}`, false, internalKey, schema);
}

export function validateTypedValue(
  descriptor: any,
  value: Value,
  label: string,
  fanoutForLongList: boolean,
  internalKey = false,
  schema?: any,
): void {
  const reserved = inspectValue(value, label, descriptor, schema);
  if (!internalKey && reserved)
    fail("E_INPUT", `${label} cannot carry the reserved system principal`);
  validateType(descriptor, value, label, fanoutForLongList, descriptorContainsAsset(descriptor));
}

// The complete scalar/shape preflight precedes every type refusal. Recursive descriptors
// reuse it, including assets, rather than walking each nested value again.
function validateType(descriptor: any, value: Value, label: string, fanout: boolean, asset: boolean): string[] | void {
  if (descriptor?.Optional !== undefined) {
    return value === "Null" ? [] : validateType(descriptor.Optional, value, label, fanout, asset);
  }
  if (descriptor?.List !== undefined) {
    const refuse = (message: string, overflow = false): never => { throw asset ? assetType(label,message) : new EvalError(
      fanout && overflow ? 'E_FANOUT' : 'E_INPUT', `${label} ${message}`); };
    if (!isVariant(value, "Array")) return refuse("must be a list");
    if (value.Array.length > descriptor.List.max) refuse(`exceeds list max ${descriptor.List.max}`,true);
    const ids: string[] | undefined = asset ? [] : undefined;
    if (descriptor.List.of !== null && descriptor.List.of !== undefined) {
      value.Array.forEach((item, index) => {
        const child = validateType(descriptor.List.of, item, asset ? `${label}[${index}]` : label, fanout, asset);
        if (ids && child) for (const id of child) ids.push(id);
      });
    }
    if (ids) {
      const seen = new Set<string>(), duplicate = ids.find(id => seen.has(id) || !seen.add(id));
      if (duplicate !== undefined) throw assetType(label, `repeats asset id ${duplicate}; asset ids in a list must be unique`);
    }
    return ids;
  }
  if (asset) return validateAsset(descriptor,value,label);
  if (descriptor === "Cursor") {
    if (!isVariant(value, "String")) fail("E_INPUT", `${label} must be a cursor string`);
    decodeCursor(value.String);
    return;
  }
  if (descriptor === "Scalar") return;
  if (descriptor === "Id" || descriptor === "Principal" || descriptor?.Ref !== undefined) {
    if (!isVariant(value, "Id")) fail("E_INPUT", `${label} must be an id`);
    return;
  }
  if (descriptor?.Text !== undefined) {
    if (!isVariant(value, "String")) fail("E_INPUT", `${label} must be text`);
    const codePoint = disallowedTextControlCodePoint(value.String);
    if (codePoint !== undefined)
      fail("E_INPUT", `${label} contains disallowed control character U+${codePoint.toString(16).toUpperCase().padStart(4, "0")}`);
    const length = Array.from(value.String).length;
    if (length > descriptor.Text.max)
      fail("E_INPUT", `${label} exceeds text max ${descriptor.Text.max}`);
    // Argument refinements apply recursively before any program body executes; column Text is unchanged.
    if (fanout && length < (descriptor.Text.min ?? 0))
      fail("E_INPUT", `${label} is shorter than text min ${descriptor.Text.min}`);
    if (fanout && descriptor.Text.format !== undefined && !(descriptor.Text.format === 'handle'
      ? /^[a-z0-9_]*$/.test(value.String) : descriptor.Text.format === 'url' && validHttpUrl(value.String)))
      fail('E_INPUT', `${label} has invalid ${String(descriptor.Text.format)} format`);
    return;
  }
  if (descriptor?.Bytes !== undefined) {
    if (!isVariant(value, "Bytes") || !canonicalBytes(value.Bytes))
      fail("E_INPUT", `${label} must be bytes`);
    if (value.Bytes.length / 2 > descriptor.Bytes.max)
      fail("E_INPUT", `${label} exceeds bytes max ${descriptor.Bytes.max}`);
    return;
  }
  if (["Int", "Time"].includes(descriptor) || descriptor?.Decimal !== undefined || descriptor?.Money !== undefined) {
    if (!isVariant(value, "Int") || !Number.isSafeInteger(value.Int))
      fail("E_INPUT", `${label} must be an i53 integer`);
    return;
  }
  if (descriptor === "Bool") {
    if (!isVariant(value, "Bool")) fail("E_INPUT", `${label} must be a boolean`);
    return;
  }
  if (descriptor?.Json !== undefined) {
    if (utf8Length(canonicalValue(value)) > descriptor.Json.max_bytes)
      fail("E_INPUT", `${label} exceeds JSON max ${descriptor.Json.max_bytes} bytes`);
    return;
  }
  if (descriptor?.Enum !== undefined) {
    if (!isVariant(value, "String") || !descriptor.Enum.variants.includes(value.String))
      fail("E_INPUT", `${label} is not a declared enum value`);
    return;
  }
  fail("E_SCHEMA", `unsupported type for ${label}`);
}

function disallowedTextControlCodePoint(text: string): number | undefined {
  for (const character of text) {
    const codePoint = character.codePointAt(0)!;
    if (codePoint < 0x20 && ![0x09, 0x0a, 0x0d].includes(codePoint)) return codePoint;
  }
  return undefined;
}

function descriptorContainsAsset(descriptor: any): boolean {
  if (descriptor?.Image !== undefined || descriptor?.Video !== undefined) return true;
  if (descriptor?.Optional !== undefined) return descriptorContainsAsset(descriptor.Optional);
  if (descriptor?.List?.of !== null && descriptor?.List?.of !== undefined)
    return descriptorContainsAsset(descriptor.List.of);
  return false;
}

// @ref LLP 1006#6-the-write-validated-not-stamped — the twin enforces the closed asset record and list uniqueness but owns no ledger authority.
function validateAsset(descriptor: any, value: Value, label: string): string[] {
  const kind = descriptor?.Image !== undefined ? "image" : descriptor?.Video !== undefined ? "video" : null;
  if (kind === null) fail("E_SCHEMA", `unsupported asset type for ${label}`);
  if (!isVariant(value, "Map")) throw assetType(label, `must be a closed ${kind} asset map`);
  const expected = kind === "image" ? ["height", "id", "width"] : ["duration", "height", "id", "width"];
  const actual = Object.keys(value.Map).sort(compareCodepoints);
  if (actual.length !== expected.length || actual.some((name, index) => name !== expected[index]))
    throw assetType(label, `must contain exactly ${expected.join(", ")}`);
  const idValue = value.Map.id;
  const id = isVariant(idValue, "String") ? idValue.String : "";
  if (!validEngineId(id)) throw assetType(`${label}.id`, "must be a minted s2id");
  for (const field of kind === "image" ? ["width", "height"] : ["width", "height", "duration"]) {
    const member = value.Map[field];
    if (!isVariant(member, "Int") || !Number.isSafeInteger(member.Int) || member.Int <= 0)
      throw assetType(`${label}.${field}`, "must be a positive i53 integer");
  }
  return [id];
}

function validEngineId(id: string): boolean {
  return /^s2id-[0-9a-f]{32}-[0-9a-f]{16}$/.test(id) && !id.endsWith("-0000000000000000");
}

function assetType(path: string, message: string): EvalError {
  return Object.assign(new EvalError("E_ASSET_TYPE", `${path} ${message}`), { path });
}

export function assertValue(value: Value, label: string, descriptor?: any, schema?: any): void { inspectValue(value, label, descriptor, schema); }

/** Collect reserved identity while validating every child; a later shape error still wins. */
function inspectValue(value: Value, label: string, descriptor?: any, schema?: any): boolean {
  while (descriptor?.Optional !== undefined) descriptor = descriptor.Optional;
  if (value === "Null") return false;
  if (!plainObject(value) || Object.keys(value).length !== 1) fail("E_INPUT", `${label} is not a tagged value`);
  const kind = kindOf(value);
  const data = (value as any)[kind];
  if (kind === "Bool" && typeof data === "boolean" || kind === "Int" && Number.isSafeInteger(data)) return false;
  if ((kind === "String" || kind === "Id") && typeof data === "string") {
    if (kind === "Id") {
      if (schema && descriptor?.Ref) validateAddress(schema, descriptor.Ref.table, data);
      else validateIdentity(data);
    } else scalarText(data);
    return kind === "Id" && data === coreIrContract.systemPrincipalId;
  }
  if (kind === "Bytes" && canonicalBytes(data)) return false;
  let reserved = false;
  if (kind === "Array" && Array.isArray(data)) {
    for (const item of data) reserved = inspectValue(item, label, descriptor?.List?.of, schema) || reserved;
    return reserved;
  }
  if ((kind === "Row" || kind === "Map") && plainObject(data)) {
    for (const [key, item] of Object.entries(data)) { scalarText(key); reserved = inspectValue(item as Value, label) || reserved; }
    return reserved;
  }
  fail("E_INPUT", `${label} is not a valid value`);
}

export function canonicalBytes(value: unknown): value is string {
  return typeof value === "string" && /^(?:[0-9a-f]{2})*$/.test(value);
}

export function hasOwn(value: object, key: PropertyKey): boolean {
  return Object.hasOwn(value, key);
}

export function plainObject(value: unknown): value is Record<string, any> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

export function clone<T>(value: T): T {
  // @ref LLP 1018.003.000#3-shared-publication — immutable
  // row ownership survives expression aliases and nested point reads.
  if (value === null || typeof value !== "object" || RowImage.is(value)) return value;
  return (Array.isArray(value) ? value.map(clone) : Object.fromEntries(Object.entries(value)
    .filter(([, child]) => child !== undefined).map(([key, child]) => [key, clone(child)]))) as T;
}

export function sortObject<T>(value: Record<string, T>): Record<string, T> {
  const sorted: Record<string, T> = Object.create(null);
  for (const key of Object.keys(value).sort(compareCodepoints)) sorted[key] = value[key];
  return sorted;
}

export function builtinArity(kind: string): number {
  switch (kind) {
    case "Len": case "Sort":  case "MentionTokens": case "Count": case "CountCapped": case "Sum": return 1;
    case "Concat": case "Min": case "Max": case "Divmod": return 2;
    case "Slice": case "DeterministicShare": return 3;
    default: fail("E_OPAQUE", `unsupported builtin ${kind}`);
  }
}

export function valueText(value: Value): string {
  if (value === "Null") return "null";
  if (isVariant(value, "Bool")) return String(value.Bool);
  if (isVariant(value, "Int")) return String(value.Int);
  if (isVariant(value, "String")) return value.String;
  if (isVariant(value, "Id")) return value.Id;
  if (isVariant(value, "Bytes")) return value.Bytes;
  if (isVariant(value, "Array")) return value.Array.map(valueText).join(",");
  return "[object Object]";
}

export function isWordCharacter(character: string): boolean {
  return character === "_" || /[\p{L}\p{N}]/u.test(character);
}

// @ref LLP 1001#unicode-search-foundation — canonical tagged identity allowance is actual UTF-8, including escapes.
export function scalarText(text: string): void {
  try { scalarLength(text, text.length); } catch { fail("E_INPUT", "invalid Unicode scalar text"); }
}
export function validateIdentity(id: string): void {
  scalarText(id);
  if (!identityFits(id)) fail("E_INPUT", "identity exceeds 144 canonical bytes");
}
function identityFits(id: string): boolean { return utf8Length(JSON.stringify({ Id: id })) <= 144; }

// @ref LLP 1001#maintained-addresses — exact source-domain tuples, never a wider untyped Id allowance.
export function validateAddress(schema: any, table: string, id: string): void {
  scalarText(id);
  if (identityFits(id)) return;
  const invalid = (): never => { fail('E_INPUT', `${table}.id is not a canonical maintained group address`); };
  const maintain = schema.maintains?.find((m: any) => m.target === table);
  if (!maintain) return validateIdentity(id);
  let key: Value[];
  try { key = JSON.parse(id); } catch { return invalid(); }
  if (!Array.isArray(key) || key.length !== maintain.by.length) invalid();
  for (let i = 0; i < key.length; i++) {
    const name = maintain.by[i], kind = schema.tables[maintain.source].columns[name];
    // Group members follow their declared type; only an intrinsic row/index slot rewrites Id to its owning target.
    validateTypedValue(kind, key[i], `${maintain.source}.${name}`, false, false, schema);
  }
  if (canonicalValues(key) !== id) invalid();
}

/** Wire construction preserves input-field refusal order; row admission follows in schema order. */
export type WireRefusal = (path: string, detail: string) => never;
export function wireObject(value: any): value is Record<string, any> {
  return plainObject(value)
    && (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null);
}
export function rowFromWire(schema: any, table: string, row: Record<string, unknown>, fail: WireRefusal): Value {
  const columns = schema?.tables?.[table]?.columns;
  if (!wireObject(columns)) fail(`schema.tables.${table}.columns`, 'is missing');
  const tagged: Record<string, Value> = Object.create(null);
  for (const [name,value] of Object.entries(row)) {
    if (!(name in columns)) fail(`rows.${table}.${name}`, 'is not a declared column');
    tagged[name] = valueFromWire(columnDescriptor(schema,table,name),value,`rows.${table}.${name}`,fail,schema);
  }
  return { Row: tagged };
}

export function valueFromWire(descriptor: any, value: any, path: string, fail: WireRefusal, schema?: any): Value {
  if (wireObject(descriptor) && "Optional" in descriptor) return value === null ? "Null" : valueFromWire(descriptor.Optional, value, path, fail, schema);
  if (value === null) return "Null";
  if (descriptor === "Id" || descriptor === "Principal" || wireObject(descriptor) && "Ref" in descriptor) {
    if (typeof value !== "string") fail(path, "expected id string");
    if (schema && descriptor?.Ref) validateAddress(schema, descriptor.Ref.table, value);
    else validateIdentity(value);
    return { Id: value };
  }
  if (wireObject(descriptor) && ("Text" in descriptor || "Enum" in descriptor)) {
    if (typeof value !== "string") fail(path, "expected text string");
    const tagged = { String: value };
    validateTypedValue(descriptor, tagged, path, false);
    return tagged;
  }
  if (["Int", "Time"].includes(String(descriptor)) || wireObject(descriptor) && ("Decimal" in descriptor || "Money" in descriptor)) {
    if (!Number.isSafeInteger(value)) fail(path, "expected safe integer"); return { Int: value as number };
  }
  if (descriptor === "Bool") { if (typeof value !== "boolean") fail(path, "expected boolean"); return { Bool: value as boolean }; }
  if (wireObject(descriptor) && "Bytes" in descriptor) {
    const bytes = wireObject(value) && "Bytes" in value ? value.Bytes : undefined;
    if (!wireObject(value) || Object.keys(value).length !== 1 || typeof bytes !== "string" || !canonicalBytes(bytes))
      fail(path, "expected canonical Bytes");
    return { Bytes: bytes };
  }
  if (wireObject(descriptor) && "List" in descriptor) {
    if (!Array.isArray(value)) fail(path, "expected array");
    return { Array: value.map((item: any, index: number) => valueFromWire(descriptor.List.of, item, `${path}[${index}]`, fail, schema)) };
  }
  if (wireObject(descriptor) && ("Image" in descriptor || "Video" in descriptor)) {
    const tagged = tagJson(value);
    try { validateTypedValue(descriptor, tagged, path, false); }
    catch (error) {
      // Preserve the public decoder's path-bearing TypeError while sharing evaluator asset validation.
      if (error instanceof EvalError && error.code === 'E_ASSET_TYPE') fail((error as any).path ?? path, error.message);
      throw error;
    }
    return tagged;
  }
  // @ref LLP 1012#8-the-delivery-envelope-the-validator-and-resume — tag by
  // the declared column type only: a `json` value shaped `{ "Bytes": "…" }` is
  // application data, never the byte variant (O1a review).
  if (wireObject(descriptor) && "Json" in descriptor) return tagJson(value);
  fail(path, "has an unsupported schema descriptor");
}

function tagJson(value: any): Value {
  if (value === null) return "Null";
  if (typeof value === "boolean") return { Bool: value };
  if (typeof value === "number") return { Int: value };
  if (typeof value === "string") return { String: value };
  if (Array.isArray(value)) return { Array: value.map(tagJson) };
  return { Map: Object.fromEntries(Object.entries(value).map(([key, item]) => [key, tagJson(item)])) };
}
