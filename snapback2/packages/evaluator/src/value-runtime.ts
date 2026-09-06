import { compareCodepoints } from './hash';
export { compareCodepoints } from './hash';
import coreIrContract from "../../../crates/snapback2-core/ir-contract.json" with { type: "json" };
import { canonicalRuleJson, canonicalSchemaJson } from "./certificate-identity";
import { EvalError } from "./errors";
import { sha256, utf8Length } from "./hash";
import { cursorSuffix, decodeCursor, decodeCursorFor } from "./cursor";
import { scalarLength } from "./unicode";
import type { TraceRange, Value } from "./types";

const I53_MAX = 9_007_199_254_740_991;
const I53_MIN = -I53_MAX;

export function canonicalValue(value: Value): string {
  if (value === "Null") return '"Null"';
  const kind = kindOf(value);
  const data = (value as any)[kind];
  if (kind === "Bool" || kind === "Int") return `{"${kind}":${JSON.stringify(data)}}`;
  if (kind === "String" || kind === "Id") return `{"${kind}":${JSON.stringify(data)}}`;
  if (kind === "Bytes") {
    if (!canonicalBytes(data)) throw new EvalError("E_INPUT", "Bytes is not canonical lowercase base16");
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
  if (!hasOwn(object, name)) throw new EvalError("E_FIELD", `missing field ${name}`);
  return object[name];
}

export function fieldOrNull(value: Value, name: string): Value {
  const object = asObject(value);
  return hasOwn(object, name) ? object[name] : "Null";
}

export function asObject(value: Value): Record<string, Value> {
  if (isVariant(value, "Row")) return value.Row;
  if (isVariant(value, "Map")) return value.Map;
  throw new EvalError("E_TYPE", "expected row or map");
}

export function asArray(value: Value): Value[] {
  if (!isVariant(value, "Array")) throw new EvalError("E_TYPE", "expected array");
  return value.Array;
}

export function asString(value: Value): string {
  if (isVariant(value, "String")) return value.String;
  if (isVariant(value, "Id")) return value.Id;
  throw new EvalError("E_TYPE", "expected string or id");
}

export function asInt(value: Value): number {
  if (!isVariant(value, "Int")) throw new EvalError("E_TYPE", "expected int");
  return value.Int;
}

export function asBool(value: Value): boolean {
  if (!isVariant(value, "Bool")) throw new EvalError("E_TYPE", "expected bool");
  return value.Bool;
}

export function int(value: number): Value {
  return { Int: safeNumber(value) };
}

export function safeNumber(value: number): number {
  if (!Number.isSafeInteger(value) || value < I53_MIN || value > I53_MAX)
    throw new EvalError("E_OVERFLOW", `${value} is outside the i53 value model`);
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
      throw new EvalError("E_INPUT", "Bytes is not canonical lowercase base16");
    return compareCodepoints(leftData, rightData);
  }
  if (leftKind === "Array") return compareArrays(leftData, rightData);
  const leftEntries = Object.keys(leftData).sort(compareCodepoints);
  const rightEntries = Object.keys(rightData).sort(compareCodepoints);
  const length = comparePrimitive(leftEntries.length, rightEntries.length);
  if (length !== 0) return length;
  for (let index = 0; index < leftEntries.length; index += 1) {
    const key = compareCodepoints(leftEntries[index], rightEntries[index]);
    if (key !== 0) return key;
    const value = totalCompare(leftData[leftEntries[index]], rightData[rightEntries[index]]);
    if (value !== 0) return value;
  }
  return 0;
}

export function compareArrays(left: Value[], right: Value[]): number {
  const length = Math.min(left.length, right.length);
  for (let index = 0; index < length; index += 1) {
    const compared = totalCompare(left[index], right[index]);
    if (compared !== 0) return compared;
  }
  return comparePrimitive(left.length, right.length);
}

export function comparePrimitive(left: number | boolean, right: number | boolean): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

export function stableSort<T>(values: T[], compare: (left: T, right: T) => number): T[] {
  if (values.length <= 1) return values;
  const middle = Math.floor(values.length / 2);
  const left = stableSort(values.slice(0, middle), compare);
  const right = stableSort(values.slice(middle), compare);
  const result: T[] = [];
  while (left.length > 0 && right.length > 0) {
    result.push(compare(left[0], right[0]) <= 0 ? left.shift()! : right.shift()!);
  }
  return result.concat(left, right);
}

export function variant(value: any): [string, any] {
  if (typeof value === "string") return [value, null];
  const keys = Object.keys(value);
  if (keys.length !== 1) throw new EvalError("E_CORPUS", "invalid externally tagged variant");
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
    default: throw new EvalError("E_INPUT", `unsupported value kind ${kind}`);
  }
}

/** The digest a replay trace carries for a point read: SHA-256 over the canonical
 * wire row, exactly `snapback2-core`'s `row_digest` (`offline.rs`). */
export function rowDigest(row: Value): string {
  return sha256(JSON.stringify(wireJson(row)));
}

/** `Schema::rule_hash`: the schema hash beside the rule in serde's field order. */
export function scopedRuleHash(schema: any, rule: any): string {
  return sha256(`[${JSON.stringify(sha256(canonicalSchemaJson(schema)))},${canonicalRuleJson(rule)}]`);
}

export function kindOf(value: Value): string {
  if (value === "Null") return "Null";
  const keys = Object.keys(value);
  if (keys.length !== 1) throw new EvalError("E_INPUT", "invalid externally tagged value");
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
    throw new EvalError("E_TYPE", `SameValueZero expects primitive operands, got ${leftKind}`);
  }
  if (["Bytes", "Row", "Array", "Map"].includes(rightKind)) {
    throw new EvalError("E_TYPE", `SameValueZero expects primitive operands, got ${rightKind}`);
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
  if (value !== null && typeof value === "object") {
    return `{${Object.keys(value)
      .sort(compareCodepoints)
      .map((key) => `${JSON.stringify(key)}:${canonicalJson((value as any)[key])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

export function validateWriteRow(schema: any, tableName: string, row: Value): void {
  const columns = schema.tables?.[tableName]?.columns;
  if (columns === undefined) throw new EvalError("E_SCHEMA", `missing table ${tableName}`);
  const object = asObject(row);
  if (!hasOwn(object, "id")) throw new EvalError("E_SCHEMA", `${tableName} row lacks id`);
  const unknown = Object.keys(object).find((name) => !hasOwn(columns, name));
  if (unknown !== undefined)
    throw new EvalError("E_INPUT", `${tableName} row contains undeclared field ${unknown}`);
  for (const [name, descriptor] of Object.entries<any>(columns)) {
    const value = hasOwn(object, name) ? object[name] : undefined;
    if (value === undefined && descriptor?.Optional === undefined)
      throw new EvalError("E_INPUT", `${tableName}.${name} is required`);
    if (value !== undefined) validateTypedValue(descriptor, value, `${tableName}.${name}`, false);
  }
}

export function validateInputs(schema: any, program: any, inputs: Record<string, Value>): void {
  for (const [name, descriptor] of Object.entries<any>(program.args ?? {})) {
    const value = inputs[name];
    if (value === undefined) throw new EvalError("E_INPUT", `missing arg ${name}`);
    validateTypedValue(descriptor, value, `arg ${name}`, true);
  }
}

/** Cursor scope follows executed control flow, including an empty merge. */
export function validateScanCursor(schema: any, scan: any, bindings: Map<string, Value>): void {
  if (!scan.opaque_cursor) return;
  if (scan.before !== null) throw new EvalError("E_INPUT", "opaque cursors only support after");
  const cursor = scan.after?.Variable !== undefined ? bindings.get(scan.after.Variable) : scan.after?.Literal;
  if (cursor === undefined) throw new EvalError("E_INPUT", "opaque cursor expression must derive from an operation argument");
  if (cursor === "Null") return;
  if (!isVariant(cursor, "String")) throw new EvalError("E_INPUT", "opaque cursor must be a string");
  decodeCursorFor(cursor.String, {
    table: scan.table, index: scan.index, order: scan.order, suffix: cursorSuffix(schema, scan),
  });
}


export function validateTypedValue(
  descriptor: any,
  value: Value,
  label: string,
  fanoutForLongList: boolean,
  internalKey = false,
): void {
  assertValue(value, label);
  if (!internalKey && valueContainsReservedPrincipal(value))
    throw new EvalError("E_INPUT", `${label} cannot carry the reserved system principal`);
  if (descriptorContainsAsset(descriptor)) {
    validateAssetTypedValue(descriptor, value, label);
    return;
  }
  if (descriptor?.Optional !== undefined) {
    if (value !== "Null") validateTypedValue(descriptor.Optional, value, label, fanoutForLongList, internalKey);
    return;
  }
  if (descriptor?.List !== undefined) {
    if (!isVariant(value, "Array")) throw new EvalError("E_INPUT", `${label} must be a list`);
    if (value.Array.length > descriptor.List.max)
      throw new EvalError(fanoutForLongList ? "E_FANOUT" : "E_INPUT", `${label} exceeds list max ${descriptor.List.max}`);
    if (descriptor.List.of !== null && descriptor.List.of !== undefined) {
      for (const item of value.Array)
        validateTypedValue(descriptor.List.of, item, label, fanoutForLongList, internalKey);
    }
    return;
  }
  if (descriptor === "Cursor") {
    if (!isVariant(value, "String")) throw new EvalError("E_INPUT", `${label} must be a cursor string`);
    decodeCursor(value.String);
    return;
  }
  if (descriptor === "Scalar") return;
  if (descriptor === "Id" || descriptor === "Principal" || descriptor?.Ref !== undefined) {
    if (!isVariant(value, "Id")) throw new EvalError("E_INPUT", `${label} must be an id`);
    return;
  }
  if (descriptor?.Text !== undefined) {
    if (!isVariant(value, "String")) throw new EvalError("E_INPUT", `${label} must be text`);
    const codePoint = disallowedTextControlCodePoint(value.String);
    if (codePoint !== undefined)
      throw new EvalError("E_INPUT", `${label} contains disallowed control character U+${codePoint.toString(16).toUpperCase().padStart(4, "0")}`);
    const length = Array.from(value.String).length;
    if (length > descriptor.Text.max)
      throw new EvalError("E_INPUT", `${label} exceeds text max ${descriptor.Text.max}`);
    // Argument refinements apply recursively before any program body executes; column Text is unchanged.
    if (fanoutForLongList && length < (descriptor.Text.min ?? 0))
      throw new EvalError("E_INPUT", `${label} is shorter than text min ${descriptor.Text.min}`);
    if (fanoutForLongList && descriptor.Text.format !== undefined && !(descriptor.Text.format === 'handle'
      ? /^[a-z0-9_]*$/.test(value.String) : descriptor.Text.format === 'url' && validHttpUrl(value.String)))
      throw new EvalError('E_INPUT', `${label} has invalid ${String(descriptor.Text.format)} format`);
    return;
  }
  if (descriptor?.Bytes !== undefined) {
    if (!isVariant(value, "Bytes") || !canonicalBytes(value.Bytes))
      throw new EvalError("E_INPUT", `${label} must be bytes`);
    if (value.Bytes.length / 2 > descriptor.Bytes.max)
      throw new EvalError("E_INPUT", `${label} exceeds bytes max ${descriptor.Bytes.max}`);
    return;
  }
  if (["Int", "Time"].includes(descriptor) || descriptor?.Decimal !== undefined || descriptor?.Money !== undefined) {
    if (!isVariant(value, "Int") || !Number.isSafeInteger(value.Int))
      throw new EvalError("E_INPUT", `${label} must be an i53 integer`);
    return;
  }
  if (descriptor === "Bool") {
    if (!isVariant(value, "Bool")) throw new EvalError("E_INPUT", `${label} must be a boolean`);
    return;
  }
  if (descriptor?.Json !== undefined) {
    if (utf8Length(canonicalValue(value)) > descriptor.Json.max_bytes)
      throw new EvalError("E_INPUT", `${label} exceeds JSON max ${descriptor.Json.max_bytes} bytes`);
    return;
  }
  if (descriptor?.Enum !== undefined) {
    if (!isVariant(value, "String") || !descriptor.Enum.variants.includes(value.String))
      throw new EvalError("E_INPUT", `${label} is not a declared enum value`);
    return;
  }
  throw new EvalError("E_SCHEMA", `unsupported type for ${label}`);
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
function validateAssetTypedValue(descriptor: any, value: Value, label: string): string[] {
  if (descriptor?.Optional !== undefined) {
    return value === "Null" ? [] : validateAssetTypedValue(descriptor.Optional, value, label);
  }
  if (descriptor?.List !== undefined) {
    if (!isVariant(value, "Array")) throw assetType(label, "must be a list");
    if (value.Array.length > descriptor.List.max)
      throw assetType(label, `exceeds list max ${descriptor.List.max}`);
    const ids = value.Array.flatMap((item, index) =>
      validateAssetTypedValue(descriptor.List.of, item, `${label}[${index}]`),
    );
    const seen = new Set<string>();
    const duplicate = ids.find((id) => seen.has(id) || !seen.add(id));
    if (duplicate !== undefined)
      throw assetType(label, `repeats asset id ${duplicate}; asset ids in a list must be unique`);
    return ids;
  }
  const kind = descriptor?.Image !== undefined ? "image" : descriptor?.Video !== undefined ? "video" : null;
  if (kind === null) throw new EvalError("E_SCHEMA", `unsupported asset type for ${label}`);
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

export function assertValue(value: Value, label: string): void {
  if (value === "Null") return;
  if (!value || typeof value !== "object" || Object.keys(value).length !== 1) throw new EvalError("E_INPUT", `${label} is not a tagged value`);
  const kind = kindOf(value);
  const data = (value as any)[kind];
  if (kind === "Bool" && typeof data === "boolean") return;
  if (kind === "Int" && Number.isSafeInteger(data)) return;
  if ((kind === "String" || kind === "Id") && typeof data === "string") {
    scalarText(data);
    if (kind === "Id") validateIdentity(data);
    return;
  }
  if (kind === "Bytes" && canonicalBytes(data)) return;
  if (kind === "Array" && Array.isArray(data)) {
    for (const item of data) assertValue(item, label);
    return;
  }
  if ((kind === "Row" || kind === "Map") && data !== null && typeof data === "object" && !Array.isArray(data)) {
    for (const [key, item] of Object.entries(data)) { scalarText(key); assertValue(item as Value, label); }
    return;
  }
  throw new EvalError("E_INPUT", `${label} is not a valid value`);
}

export function valueContainsReservedPrincipal(value: Value): boolean {
  if (isVariant(value, "Id")) return value.Id === coreIrContract.systemPrincipalId;
  if (isVariant(value, "Array")) return value.Array.some(valueContainsReservedPrincipal);
  if (isVariant(value, "Row")) return Object.values(value.Row).some(valueContainsReservedPrincipal);
  if (isVariant(value, "Map")) return Object.values(value.Map).some(valueContainsReservedPrincipal);
  return false;
}

export function canonicalBytes(value: unknown): value is string {
  return typeof value === "string" && /^(?:[0-9a-f]{2})*$/.test(value);
}

export function hasOwn(value: object, key: PropertyKey): boolean {
  return Object.prototype.hasOwnProperty.call(value, key);
}

export function clone<T>(value: T): T {
  if (value === null || value === undefined) return value;
  return JSON.parse(JSON.stringify(value));
}

export function sortObject<T>(value: Record<string, T>): Record<string, T> {
  const sorted: Record<string, T> = Object.create(null);
  for (const key of Object.keys(value).sort(compareCodepoints)) sorted[key] = value[key];
  return sorted;
}

export function builtinArity(kind: string): number {
  switch (kind) {
    case "Len": case "Sort":  case "MentionTokens": case "Words": case "Count": case "CountCapped": case "Sum": return 1;
    case "Concat": case "Min": case "Max": case "Divmod": return 2;
    case "Slice": case "DeterministicShare": return 3;
    default: throw new EvalError("E_OPAQUE", `unsupported builtin ${kind}`);
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
  try { scalarLength(text, text.length); } catch { throw new EvalError("E_INPUT", "invalid Unicode scalar text"); }
}
export function validateIdentity(id: string): void {
  scalarText(id);
  if (utf8Length(JSON.stringify({ Id: id })) > 144) throw new EvalError("E_INPUT", "identity exceeds 144 canonical bytes");
}
