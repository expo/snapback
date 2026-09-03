// @ref LLP 1011#b1-opaque-cursors — The evaluator and engine share this
// canonical tagged position format, including nominal Id/String values.
import { EvalError } from "./errors";
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
  const bytes = utf8(JSON.stringify([
    VERSION, position.table, position.index, position.order,
    position.suffix.map((column) => ({ name: column.name, kind: normalizeDescriptor(column.kind) })),
    position.values.map(normalizeValue),
  ]));
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

export function decodeCursorFor(token: string, expected: Omit<CursorPosition, "values">): Value {
  const position = decodeCursor(token);
  if (position.table !== expected.table || position.index !== expected.index || position.order !== expected.order
      || JSON.stringify(position.suffix) !== JSON.stringify(expected.suffix)) {
    fail("cursor token describes a different table, index, order, or suffix");
  }
  return { Array: position.values };
}

export function cursorSuffix(schema: any, scan: any): CursorColumn[] {
  const table = schema.tables?.[scan.table];
  const index = table?.indexes?.[scan.index];
  if (!table || !index) fail(`cursor names missing index ${scan.table}.${scan.index}`);
  return index.columns.slice(scan.prefix.length).map((name: string) => ({ name, kind: table.columns[name] }));
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
  if (name === "Text" || name === "Bytes" || name === "Json") {
    const key = name === "Json" ? "max_bytes" : "max";
    if (!plainObject(data) || Object.keys(data).length !== 1 || !nonnegativeInteger(data[key])) fail("cursor token is not the canonical tagged encoding");
    return { [name]: { [key]: data[key] } };
  }
  if (name === "Ref") {
    if (!plainObject(data) || Object.keys(data).length !== 1 || typeof data.table !== "string") fail("cursor token is not the canonical tagged encoding");
    return { Ref: { table: data.table } };
  }
  if (name === "Decimal") {
    if (!plainObject(data) || Object.keys(data).length !== 1 || !nonnegativeInteger(data.scale)) fail("cursor token is not the canonical tagged encoding");
    return { Decimal: { scale: data.scale } };
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
  if ((name === "String" || name === "Id" || name === "Bytes") && typeof data === "string") return { [name]: data } as Value;
  if (name === "Array" && Array.isArray(data)) return { Array: data.map(normalizeValue) };
  if ((name === "Row" || name === "Map") && plainObject(data)) {
    const normalized: Record<string, Value> = {};
    for (const key of Object.keys(data)) normalized[key] = normalizeValue(data[key]);
    return { [name]: normalized } as Value;
  }
  fail("cursor token is not the canonical tagged encoding");
}

function utf8(text: string): number[] {
  const result: number[] = [];
  for (const character of text) {
    const code = character.codePointAt(0)!;
    if (code <= 0x7f) result.push(code);
    else if (code <= 0x7ff) result.push(0xc0 | code >> 6, 0x80 | code & 63);
    else if (code <= 0xffff) result.push(0xe0 | code >> 12, 0x80 | code >> 6 & 63, 0x80 | code & 63);
    else result.push(0xf0 | code >> 18, 0x80 | code >> 12 & 63, 0x80 | code >> 6 & 63, 0x80 | code & 63);
  }
  return result;
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
  if (JSON.stringify(result).includes("�")) fail("cursor token is not canonical UTF-8");
  return result;
}

function variant(value: Value, name: string): boolean { return value !== "Null" && name in value; }
function plainObject(value: any): value is Record<string, any> { return value !== null && typeof value === "object" && !Array.isArray(value); }
function nonnegativeInteger(value: any): boolean { return Number.isInteger(value) && value >= 0; }
function fail(message: string): never { throw new EvalError("E_INPUT", message); }
