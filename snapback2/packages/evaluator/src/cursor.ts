// @ref LLP 1011#b1-opaque-cursors — The evaluator and engine share this
// canonical tagged position format, including nominal Id/String values.
import { utf8 } from "./hash";
import { EvalError } from "./errors";
import { plainObject, scalarText, validateColumnValue, validateTypedValue } from "./value-runtime";
import type { Value } from "./types";

const VERSION = 1;
const MAX_BYTES = 4_096;
const ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";

export interface CursorColumn { name: string; kind: any }
export interface CursorPosition {
  table: string;
  index: string;
  order: "Asc" | "Desc";
  suffix: CursorColumn[];
  values: Value[];
}

export function encodeCursor(position: CursorPosition): string {
  validateValues(position.suffix, position.values);
  const text = JSON.stringify([
    VERSION, position.table, position.index, position.order,
    position.suffix.map((column) => ({ name: column.name, kind: normalizeDescriptor(column.kind) })),
    position.values.map(normalizeValue),
  ]);
  if (text.length > MAX_BYTES) fail("cursor token exceeds 4096 bytes");
  const bytes: number[] = [];
  utf8(text, byte => bytes.push(byte));
  if (bytes.length > MAX_BYTES) fail("cursor token exceeds 4096 bytes");
  let result = "";
  for (let offset = 0; offset < bytes.length; offset += 3) {
    const a = bytes[offset]!;
    const b = bytes[offset + 1];
    const c = bytes[offset + 2];
    result += ALPHABET[a >> 2]!;
    result += ALPHABET[((a & 3) << 4) | ((b ?? 0) >> 4)]!;
    if (b !== undefined) result += ALPHABET[((b & 15) << 2) | ((c ?? 0) >> 6)]!;
    if (c !== undefined) result += ALPHABET[c & 63]!;
  }
  return result;
}

export function decodeCursor(token: string): CursorPosition {
  if (token.length > Math.ceil(MAX_BYTES * 4 / 3)) fail("cursor token exceeds 4096 bytes");
  if (!/^[A-Za-z0-9_-]*$/.test(token) || token.length % 4 === 1) fail("cursor token is not canonical base64url");
  const bytes: number[] = [];
  for (let offset = 0; offset < token.length; offset += 4) {
    const chunk = token.slice(offset, offset + 4);
    const values = Array.from(chunk, (character) => ALPHABET.indexOf(character));
    const bits = (values[0]! << 18) | ((values[1] ?? 0) << 12) | ((values[2] ?? 0) << 6) | (values[3] ?? 0);
    bytes.push((bits >> 16) & 255);
    if (chunk.length >= 3) bytes.push((bits >> 8) & 255);
    if (chunk.length === 4) bytes.push(bits & 255);
  }
  if (bytes.length > MAX_BYTES) fail("cursor token exceeds 4096 bytes");
  let tagged: any;
  try { tagged = JSON.parse(decodeUtf8(bytes)); }
  catch { fail("cursor token is not the canonical tagged encoding"); }
  if (!Array.isArray(tagged) || tagged.length !== 6) fail("cursor token is not the canonical tagged encoding");
  const [version, table, index, order, rawSuffix, rawValues] = tagged;
  if (version !== VERSION) fail(`cursor token version ${String(version)} is unsupported`);
  if (typeof table !== "string" || typeof index !== "string" || !["Asc", "Desc"].includes(order)
      || !Array.isArray(rawSuffix) || !Array.isArray(rawValues)) fail("cursor token is not the canonical tagged encoding");
  const suffix = rawSuffix.map((column: any): CursorColumn => {
    if (!plainObject(column) || Object.keys(column).length !== 2 || typeof column.name !== "string" || !("kind" in column))
      fail("cursor token is not the canonical tagged encoding");
    return { name: column.name, kind: normalizeDescriptor(column.kind) };
  });
  const values = rawValues.map(normalizeValue);
  const position: CursorPosition = { table, index, order, suffix, values };
  validateValues(suffix, values);
  if (encodeCursor(position) !== token) fail("cursor token is not canonical");
  return position;
}

export function decodeCursorFor(token: string, expected: Omit<CursorPosition, "values">, schema?: any): Value {
  const position = decodeCursor(token);
  if (position.table !== expected.table || position.index !== expected.index || position.order !== expected.order
      || JSON.stringify(position.suffix.map(c => [c.name, c.kind]))
        !== JSON.stringify(expected.suffix.map(c => [c.name, normalizeDescriptor(c.kind)]))) {
    fail("cursor token describes a different table, index, order, or suffix");
  }
  // A token's own descriptor is structural data. Only the current index grants address custody.
  const parts = schema?.tables?.[expected.table]?.indexes?.[expected.index]?.components;
  if (schema && (!Array.isArray(parts) || expected.suffix.length > parts.length
    || expected.suffix.some((column, i) => parts[parts.length - expected.suffix.length + i]?.Column !== column.name
      || JSON.stringify(normalizeDescriptor(schema.tables[expected.table].columns[column.name])) !== JSON.stringify(normalizeDescriptor(column.kind)))))
    fail('cursor token describes a different current index suffix');
  position.values.forEach((value, i) => {
    if (schema) validateColumnValue(schema, expected.table, expected.suffix[i].name, value);
    else validateTypedValue(expected.suffix[i].kind, value, 'cursor suffix', false);
  });
  return { Array: position.values };
}

export function cursorSuffix(schema: any, scan: any): CursorColumn[] {
  const table = schema.tables?.[scan.table];
  const index = table?.indexes?.[scan.index];
  if (!table || !index) fail(`cursor names missing index ${scan.table}.${scan.index}`);
  return index.components.slice(scan.prefix.length).map((c: any) => {
    if (typeof c.Column !== "string") fail("derived component cannot appear in a cursor suffix");
    return { name: c.Column, kind: table.columns[c.Column] };
  });
}

function validateValues(suffix: CursorColumn[], values: Value[]): void {
  if (suffix.length !== values.length) fail("cursor token values do not match its typed suffix");
  suffix.forEach((column, offset) => {
    const value = values[offset]!;
    const kind = column.kind;
    if (kind?.Optional !== undefined) {
      if (value === "Null") return;
      validateValues([{ name: column.name, kind: kind.Optional }], [value]);
      return;
    }
    const valid = kind === "Id" || kind === "Principal" || kind?.Ref !== undefined
      ? variant(value, "Id")
      : kind?.Text !== undefined || kind?.Enum !== undefined
        ? variant(value, "String")
        : kind === "Int" || kind === "Time" || kind?.Decimal !== undefined || kind?.Money !== undefined
          ? variant(value, "Int")
          : kind === "Bool" ? variant(value, "Bool")
            : kind?.Bytes !== undefined ? variant(value, "Bytes")
              : kind?.Json !== undefined ? ["Bool", "Int", "String", "Id", "Bytes"].some((name) => variant(value, name)) : false;
    if (!valid) fail("cursor token values do not match its typed suffix");
  });
}

function normalizeDescriptor(value: any): any {
  if (["Id", "Principal", "Int", "Bool", "Time"].includes(value)) return value;
  if (!plainObject(value) || Object.keys(value).length !== 1) fail("cursor token is not the canonical tagged encoding");
  const name = Object.keys(value)[0]!;
  const data = value[name];
  const field = name === "Text" || name === "Bytes" ? "max" : name === "Json" ? "max_bytes"
    : name === "Ref" ? "table" : name === "Decimal" ? "scale" : undefined;
  if (field !== undefined) {
    if (!plainObject(data) || Object.keys(data).length !== 1
      || (name === "Ref" ? typeof data[field] !== "string" : !nonnegativeInteger(data[field]))) fail("cursor token is not the canonical tagged encoding");
    return { [name]: { [field]: data[field] } };
  }
  if (name === "Money") {
    if (!plainObject(data) || Object.keys(data).length !== 2 || typeof data.currency !== "string" || !nonnegativeInteger(data.scale)) fail("cursor token is not the canonical tagged encoding");
    return { Money: { currency: data.currency, scale: data.scale } };
  }
  if (name === "Enum") {
    if (!plainObject(data) || Object.keys(data).length !== 1 || !Array.isArray(data.variants) || !data.variants.every((item: any) => typeof item === "string")) fail("cursor token is not the canonical tagged encoding");
    return { Enum: { variants: data.variants.slice() } };
  }
  if (name === "Optional") return { Optional: normalizeDescriptor(data) };
  if (name === "List") {
    if (!plainObject(data) || Object.keys(data).length !== 2 || !("of" in data) || !nonnegativeInteger(data.max)) fail("cursor token is not the canonical tagged encoding");
    return { List: { of: normalizeDescriptor(data.of), max: data.max } };
  }
  fail("cursor token is not the canonical tagged encoding");
}

function normalizeValue(value: any): Value {
  if (value === "Null") return value;
  if (!plainObject(value) || Object.keys(value).length !== 1) fail("cursor token is not the canonical tagged encoding");
  const name = Object.keys(value)[0]!;
  const data = value[name];
  if (name === "Bool" && typeof data === "boolean") return { Bool: data };
  if (name === "Int" && Number.isSafeInteger(data)) return { Int: data };
  if ((name === "String" || name === "Id" || name === "Bytes") && typeof data === "string") {
    scalarText(data);
    if (name === "Bytes" && !/^(?:[0-9a-f]{2})*$/.test(data)) fail("invalid cursor Bytes");
    return { [name]: data } as Value;
  }
  if (name === "Array" && Array.isArray(data)) return { Array: data.map(normalizeValue) };
  if ((name === "Row" || name === "Map") && plainObject(data)) {
    const normalized: Record<string, Value> = {};
    for (const key of Object.keys(data)) normalized[key] = normalizeValue(data[key]);
    return { [name]: normalized } as Value;
  }
  fail("cursor token is not the canonical tagged encoding");
}

function decodeUtf8(bytes: number[]): string {
  let result = "";
  for (let offset = 0; offset < bytes.length;) {
    const a = bytes[offset++]!;
    let code: number;
    if (a < 0x80) code = a;
    else if ((a & 0xe0) === 0xc0 && offset < bytes.length) code = (a & 31) << 6 | bytes[offset++]! & 63;
    else if ((a & 0xf0) === 0xe0 && offset + 1 < bytes.length) code = (a & 15) << 12 | (bytes[offset++]! & 63) << 6 | bytes[offset++]! & 63;
    else if ((a & 0xf8) === 0xf0 && offset + 2 < bytes.length) code = (a & 7) << 18 | (bytes[offset++]! & 63) << 12 | (bytes[offset++]! & 63) << 6 | bytes[offset++]! & 63;
    else fail("cursor token is not canonical UTF-8");
    if (code >= 0xd800 && code <= 0xdfff || code > 0x10ffff) fail("cursor token is not canonical UTF-8");
    result += String.fromCodePoint(code);
  }
  // decodeCursor re-encodes the entire position and compares bytes, rejecting noncanonical UTF-8.
  return result;
}

function variant(value: Value, name: string): boolean { return value !== "Null" && name in value; }
function nonnegativeInteger(value: any): boolean { return Number.isInteger(value) && value >= 0; }
function fail(message: string): never { throw new EvalError("E_INPUT", message); }
