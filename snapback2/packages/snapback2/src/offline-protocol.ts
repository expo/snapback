import { utf8Length } from "../../evaluator/src/hash.js";
// @ref LLP 1012#8-the-delivery-envelope-the-validator-and-resume — this is the strict public mirror of the frozen server envelope.

import { components } from "../../evaluator/src/index-store.js";
import { prepareRange } from "../../evaluator/src/coverage.js";
import { scalarText, validateIdentity, validateTypedValue, validateWriteRow } from "../../evaluator/src/value-runtime.js";
import type { ClosureReceipt, IndexAtom } from "../../evaluator/src/types.js";
import { schemaDigest } from "./offline-schema.js";
import { mapRowValues } from "./store/row-values.js";

/** Exact pooled-row reference spelling. Application objects with `$row` are escaped on the wire. */
export type WireRowReference = { $row: { table: string; id: string } };
export type WireEscapedObject = { $row: { $value: Record<string, WireValue> } };
export type WireValue =
  | null
  | boolean
  | number
  | string
  | WireValue[]
  | { [key: string]: WireValue }
  | WireRowReference
  | WireEscapedObject;

export interface DeliveryRow {
  table: string;
  id: string;
  row: Record<string, WireValue>;
}

export type WireIndexAtom = { Scalar: WireValue } | { WordPrefix: { contract: "u17-nfc-scf-nfc-wsp-p"; source: string } };
export interface DeliveryRange {
  site: string;
  table: string;
  index: string;
  prefix: WireIndexAtom[];
  order: "Asc" | "Desc";
  take: number;
  after: WireValue | null;
  before: WireValue | null;
  gt: WireValue | null;
  gte: WireValue | null;
  lt: WireValue | null;
  lte: WireValue | null;
  ruleHash: string;
  rowIds: string[];
  stop: "Limit" | "Exhausted";
  absence: boolean;
  haloId?: string;
}

export interface DeliveryVerdict {
  ruleHash: string;
  /**
   * The verdict's pinned inputs, digested as a wire fact:
   * `sha256(canonical([table, index, key]))` — the JSON array of the rule
   * input's table name, index name, and key values in wire encoding (ids and
   * text as strings, integers as numbers, null as null, bytes as
   * `{ "Bytes": hex }`), serialized with sorted object keys and no whitespace.
   * A twin evaluating a rule computes it from the schema and the wire values it
   * holds and looks the verdict up by `ruleHash` plus this digest; a replay
   * trace's `inputsDigest` is the same value. A transaction-local created-row
   * probe prefixes the array with `"created"`. Defined once in
   * `snapback2-core/src/offline.rs` (`rule_inputs_digest`).
   */
  pinnedInputsDigest: string;
  principal: string;
  authEpoch: number;
  result: boolean;
}

export interface DeliveryReceipt {
  ranges: DeliveryRange[];
  absences: Array<[table: string, index: string, key: WireValue[]]>;
  verdicts: DeliveryVerdict[];
}

export interface DeliveryAuthority {
  principal: string;
  authEpoch: number;
}

export interface DeliveryEnvelopeV1 {
  /** Live registry inputs cannot be cached, even before program custody arrives. */
  connected?: true;
  protocol: 1;
  generation: string;
  schemaHash: string;
  planHash: string;
  authority: DeliveryAuthority;
  state: "complete" | "capped" | "partial" | "denied";
  reason?: string;
  rule?: string;
  data: WireValue;
  next: string | null;
  seq: number;
  /** Exact signed owner-pinned execution clock, only on certified timed queries. */
  readTime?: number;
  rows: DeliveryRow[];
  receipt: DeliveryReceipt;
  validator: string;
}

export interface DeliveryUnchanged {
  state: "unchanged";
  seq: number;
  validator: string;
}

export type DeliveryMessage = DeliveryEnvelopeV1 | DeliveryUnchanged;

export type TaggedValue =
  | "Null"
  | { Bool: boolean }
  | { Int: number }
  | { String: string }
  | { Id: string }
  | { Bytes: string }
  | { Row: Record<string, TaggedValue> }
  | { Array: TaggedValue[] }
  | { Map: Record<string, TaggedValue> };

export type EvaluatorClosureReceipt = ClosureReceipt & { schema_hash: string };

export class DeliveryEnvelopeDecodeError extends TypeError {
  constructor(readonly path: string, detail: string) {
    super(`${path}: ${detail}`);
    this.name = "DeliveryEnvelopeDecodeError";
  }
}

export function decodeDeliveryEnvelope(json: unknown): DeliveryEnvelopeV1 {
  // Output + closure admission ceilings, plus the fixed authority/validator envelope.
  if (utf8Length(JSON.stringify(json)) > 5 * 1024 * 1024 + 4096) fail('$', 'delivery exceeds closure/output envelope budget');
  object(json, "$", [
    "protocol", "generation", "schemaHash", "planHash", "authority", "state",
    "data", "next", "seq", "rows", "receipt", "validator",
  ], ["reason", "rule", "connected", "readTime"]);
  if (Object.hasOwn(json, "readTime") && (!Number.isSafeInteger(json.readTime) || Object.is(json.readTime, -0)))
    fail("$.readTime", "expected canonical signed safe-integer milliseconds");
  if (json.connected !== undefined && json.connected !== true) fail("$.connected", "must be true when present");
  if (json.protocol !== 1) fail("$.protocol", "unsupported delivery protocol");
  digest(json.generation, "$.generation");
  digest(json.schemaHash, "$.schemaHash");
  digest(json.planHash, "$.planHash");
  object(json.authority, "$.authority", ["principal", "authEpoch"]);
  string(json.authority.principal, "$.authority.principal"); validateIdentity(json.authority.principal);
  uint(json.authority.authEpoch, "$.authority.authEpoch");
  if (!["complete", "capped", "partial", "denied"].includes(String(json.state)))
    fail("$.state", "expected complete, capped, partial, or denied");
  if (json.state === "partial") string(json.reason, "$.reason");
  else if (json.reason !== undefined) fail("$.reason", "is only valid for partial state");
  if (json.state === "denied") string(json.rule, "$.rule");
  else if (json.rule !== undefined) fail("$.rule", "is only valid for denied state");
  wire(json.data, "$.data");
  if (json.next !== null) string(json.next, "$.next");
  uint(json.seq, "$.seq");
  array(json.rows, "$.rows");
  const pool = new Set<string>();
  json.rows.forEach((row: unknown, index: number) => {
    object(row, `$.rows[${index}]`, ["table", "id", "row"]);
    string(row.table, `$.rows[${index}].table`);
    string(row.id, `$.rows[${index}].id`); validateIdentity(row.id);
    object(row.row, `$.rows[${index}].row`, [], [], true);
    wire(row.row, `$.rows[${index}].row`);
    if (row.row.id !== row.id) fail(`$.rows[${index}].id`, "does not match the row id");
    const key = poolKey(row.table, row.id);
    if (pool.has(key)) fail(`$.rows[${index}]`, "duplicates a pooled row");
    pool.add(key);
  });
  receipt(json.receipt, pool, json.authority as DeliveryAuthority);
  validateReferences(json.data, pool, "$.data");
  digest(json.validator, "$.validator");
  return json as DeliveryEnvelopeV1;
}

/** Decode either a full authority envelope or a conditional `unchanged` marker. */
export function decodeDeliveryMessage(json: unknown): DeliveryMessage {
  if (plain(json) && json.state === "unchanged") {
    object(json, "$", ["state", "seq", "validator"]);
    uint(json.seq, "$.seq");
    digest(json.validator, "$.validator");
    return json as unknown as DeliveryUnchanged;
  }
  return decodeDeliveryEnvelope(json);
}

export function encodeDeliveryEnvelope(envelope: DeliveryEnvelopeV1): string {
  const decoded = decodeDeliveryEnvelope(envelope);
  const ordered: Record<string, unknown> = {
    protocol: decoded.protocol,
    generation: decoded.generation,
    schemaHash: decoded.schemaHash,
    planHash: decoded.planHash,
    authority: {
      principal: decoded.authority.principal,
      authEpoch: decoded.authority.authEpoch,
    },
    state: decoded.state,
  };
  if (decoded.reason !== undefined) ordered.reason = decoded.reason;
  if (decoded.rule !== undefined) ordered.rule = decoded.rule;
  ordered.data = canonicalWire(decoded.data);
  ordered.next = decoded.next;
  ordered.seq = decoded.seq;
  ordered.rows = [...decoded.rows]
    .sort((left, right) => compareText(left.table, right.table) || compareText(left.id, right.id))
    .map((row) => ({ table: row.table, id: row.id, row: canonicalWire(row.row) }));
  ordered.receipt = {
    ranges: decoded.receipt.ranges.map((range) => {
      const item: Record<string, unknown> = {
        site: range.site,
        table: range.table,
        index: range.index,
        prefix: range.prefix.map(canonicalWire),
        order: range.order,
        take: range.take,
        after: range.after === null ? null : canonicalWire(range.after),
        before: range.before === null ? null : canonicalWire(range.before),
        gt: range.gt === null ? null : canonicalWire(range.gt),
        gte: range.gte === null ? null : canonicalWire(range.gte),
        lt: range.lt === null ? null : canonicalWire(range.lt),
        lte: range.lte === null ? null : canonicalWire(range.lte),
        ruleHash: range.ruleHash,
        rowIds: [...range.rowIds],
        stop: range.stop,
        absence: range.absence,
      };
      if (range.haloId !== undefined) item.haloId = range.haloId;
      return item;
    }),
    absences: decoded.receipt.absences.map(([table, index, key]) => [
      table,
      index,
      key.map(canonicalWire),
    ]),
    verdicts: decoded.receipt.verdicts.map((verdict) => ({
      ruleHash: verdict.ruleHash,
      pinnedInputsDigest: verdict.pinnedInputsDigest,
      principal: verdict.principal,
      authEpoch: verdict.authEpoch,
      result: verdict.result,
    })),
  };
  ordered.validator = decoded.validator;
  if (decoded.readTime !== undefined) ordered.readTime = decoded.readTime;
  if (decoded.connected) ordered.connected = true;
  return JSON.stringify(ordered);
}

export function expandRows(envelope: DeliveryEnvelopeV1): WireValue {
  const decoded = decodeDeliveryEnvelope(envelope);
  const rows = new Map(decoded.rows.map((row) => [poolKey(row.table, row.id), row.row]));
  return mapRowValues(decoded.data, (ref) => {
    const row = rows.get(poolKey(ref.table, ref.id));
    if (row === undefined) fail("$.data", `references missing row ${ref.table}/${ref.id}`);
    return clone(row);
  }) as WireValue;
}

/** Rebuild the evaluator's externally-tagged private receipt from the public pool. */
export function toClosureReceipt(envelope: DeliveryEnvelopeV1, schema: any, program?: any): EvaluatorClosureReceipt {
  const decoded = decodeDeliveryEnvelope(envelope);
  let actualSchemaHash: string;
  try {
    actualSchemaHash = schemaDigest(schema);
  } catch (error) {
    fail("schema", error instanceof Error ? error.message : String(error));
  }
  if (actualSchemaHash !== decoded.schemaHash) {
    fail("schema", `hash ${actualSchemaHash} does not match envelope schemaHash ${decoded.schemaHash}`);
  }
  const taggedRows = new Map<string, { table: string; id: string; row: TaggedValue }>();
  for (const row of decoded.rows) {
    const tagged = { table: row.table, id: row.id, row: tagRow(schema, row.table, row.row) };
    taggedRows.set(poolKey(row.table, row.id), tagged);
  }
  const ranges = decoded.receipt.ranges.map((range) => ({
    site: range.site,
    table: range.table,
    index: range.index,
    prefix: tagWireRangePrefix(schema, range, program),
    order: range.order,
    take: range.take,
    after: tagBoundary(schema, range, range.after),
    before: tagBoundary(schema, range, range.before),
    gt: tagBoundary(schema, range, range.gt),
    gte: tagBoundary(schema, range, range.gte),
    lt: tagBoundary(schema, range, range.lt),
    lte: tagBoundary(schema, range, range.lte),
    rule_hash: range.ruleHash,
    row_ids: [...range.rowIds],
    stop: range.stop,
    absence: range.absence,
    halo: range.haloId === undefined
      ? null
      : { table: range.table, id: range.haloId },
    n2_suffix: null,
  }));
  return {
    schema_hash: decoded.schemaHash,
    rows: Array.from(taggedRows.values()).map(clone),
    ranges,
    absences: decoded.receipt.absences.map(([table, index, key]) => [
      table,
      index,
      tagIndexValues(schema, table, index, key, 0),
    ]),
    verdicts: decoded.receipt.verdicts.map((verdict) => ({
      rule_hash: verdict.ruleHash,
      pinned_inputs_digest: verdict.pinnedInputsDigest,
      principal: verdict.principal,
      auth_epoch: verdict.authEpoch,
      result: verdict.result,
    })),
  };
}

export type DeliveryRangeExtent =
  | { stop: "Limit"; prefix: WireIndexAtom[]; firstKey: WireValue[]; lastKey: WireValue[]; presentIds: string[] }
  | {
    stop: "Exhausted";
    prefix: WireIndexAtom[];
    bounds: Pick<DeliveryRange, "after" | "before" | "gt" | "gte" | "lt" | "lte">;
    presentIds: string[];
  };

/** Derive the rule-2 range extent solely from a delivery and its generation schema. */
export function deliveryRangeExtent(
  envelope: DeliveryEnvelopeV1,
  schema: any,
  range: DeliveryRange,
  program?: any,
): DeliveryRangeExtent {
  const decoded = decodeDeliveryEnvelope(envelope);
  const selected = decoded.receipt.ranges.find((candidate) => candidate === range)
    ?? decoded.receipt.ranges.find((candidate) => candidate.site === range.site);
  if (!selected) fail("$.receipt.ranges", `does not contain site ${range.site}`);
  tagWireRangePrefix(schema, selected, program);
  const presentIds = selected.haloId === undefined
    ? [...selected.rowIds]
    : [...selected.rowIds, selected.haloId];
  if (selected.stop === "Exhausted") {
    return {
      stop: "Exhausted",
      prefix: clone(selected.prefix),
      bounds: {
        after: clone(selected.after), before: clone(selected.before),
        gt: clone(selected.gt), gte: clone(selected.gte),
        lt: clone(selected.lt), lte: clone(selected.lte),
      },
      presentIds,
    };
  }
  if (selected.rowIds.length === 0) fail(`$.receipt.ranges[${selected.site}].rowIds`, "Limit extent needs a returned row");
  const rows = new Map(decoded.rows.map((row) => [poolKey(row.table, row.id), row]));
  const key = (id: string): WireValue[] => {
    const row = rows.get(poolKey(selected.table, id))!;
    return indexColumns(schema, selected.table, selected.index).slice(selected.prefix.length).map((column) => {
      if (!(column in row.row)) fail(`$.rows.${selected.table}/${id}.${column}`, "is required by the range index");
      return clone(row.row[column]!);
    });
  };
  return {
    stop: "Limit",
    prefix: clone(selected.prefix),
    firstKey: key(selected.rowIds[0]!),
    lastKey: key(selected.rowIds[selected.rowIds.length - 1]!),
    presentIds,
  };
}

function receipt(value: unknown, pool: Set<string>, authority: DeliveryAuthority): void {
  object(value, "$.receipt", ["ranges", "absences", "verdicts"]);
  array(value.ranges, "$.receipt.ranges");
  value.ranges.forEach((range: unknown, index: number) => {
    const path = `$.receipt.ranges[${index}]`;
    object(range, path, [
      "site", "table", "index", "prefix", "order", "take", "after", "before",
      "gt", "gte", "lt", "lte", "ruleHash", "rowIds", "stop", "absence",
    ], ["haloId"]);
    for (const name of ["site", "table", "index", "ruleHash"] as const) string(range[name], `${path}.${name}`);
    digest(range.ruleHash, `${path}.ruleHash`);
    array(range.prefix, `${path}.prefix`); range.prefix.forEach((item: unknown, at: number) => wireIndexAtom(item, `${path}.prefix[${at}]`));
    if (!["Asc", "Desc"].includes(String(range.order))) fail(`${path}.order`, "expected Asc or Desc");
    uint(range.take, `${path}.take`);
    for (const name of ["after", "before", "gt", "gte", "lt", "lte"] as const)
      if (range[name] !== null) wire(range[name], `${path}.${name}`);
    array(range.rowIds, `${path}.rowIds`);
    const rowIds = new Set<string>();
    range.rowIds.forEach((id: unknown, at: number) => {
      string(id, `${path}.rowIds[${at}]`); validateIdentity(id);
      if (rowIds.has(id)) fail(`${path}.rowIds[${at}]`, "duplicates a row id");
      rowIds.add(id);
      if (!pool.has(poolKey(range.table, id))) fail(`${path}.rowIds[${at}]`, "references a missing same-table pooled row");
    });
    if (!["Limit", "Exhausted"].includes(String(range.stop))) fail(`${path}.stop`, "expected Limit or Exhausted");
    boolean(range.absence, `${path}.absence`);
    if (range.haloId !== undefined) {
      string(range.haloId, `${path}.haloId`);
      if (!pool.has(poolKey(range.table, range.haloId))) fail(`${path}.haloId`, "references a missing pooled row");
    }
  });
  array(value.absences, "$.receipt.absences");
  value.absences.forEach((absence: unknown, index: number) => {
    const path = `$.receipt.absences[${index}]`;
    array(absence, path);
    if (absence.length !== 3) fail(path, "expected [table, index, key]");
    string(absence[0], `${path}[0]`);
    if (absence[1] !== "byId") fail(`${path}[1]`, "only primary byId absences may be delivered");
    array(absence[2], `${path}[2]`); absence[2].forEach((item: unknown, at: number) => wire(item, `${path}[2][${at}]`));
  });
  array(value.verdicts, "$.receipt.verdicts");
  value.verdicts.forEach((verdict: unknown, index: number) => {
    const path = `$.receipt.verdicts[${index}]`;
    object(verdict, path, ["ruleHash", "pinnedInputsDigest", "principal", "authEpoch", "result"]);
    digest(verdict.ruleHash, `${path}.ruleHash`);
    digest(verdict.pinnedInputsDigest, `${path}.pinnedInputsDigest`);
    string(verdict.principal, `${path}.principal`); validateIdentity(verdict.principal);
    uint(verdict.authEpoch, `${path}.authEpoch`);
    boolean(verdict.result, `${path}.result`);
    if (verdict.principal !== authority.principal) fail(`${path}.principal`, "does not match envelope authority");
    if (verdict.authEpoch !== authority.authEpoch) fail(`${path}.authEpoch`, "does not match envelope authority");
  });
}

/** Tag one pooled wire row by its table's declared column types (the evaluator's private form). */
export function tagWireRow(schema: any, table: string, row: Record<string, WireValue>): TaggedValue {
  return tagRow(schema, table, row);
}

/** Tag index key values (a prefix, a key, or a cursor position) by the index's column types from `offset`. */
export function tagWireIndexValues(schema: any, table: string, index: string, values: WireValue[], offset = 0): TaggedValue[] {
  return tagIndexValues(schema, table, index, values, offset);
}

/** Tag a range boundary (`after`, `before`, `gt`, …): an array is a position after the prefix, a scalar its first column. */
export function tagWireBoundary(schema: any, range: Pick<DeliveryRange, "table" | "index" | "prefix">, value: WireValue | null): TaggedValue | null {
  return tagBoundary(schema, range as DeliveryRange, value);
}

/** Tag one wire value by a declared column or argument descriptor. */
export function tagWireValue(descriptor: unknown, value: WireValue, path: string): TaggedValue {
  return tagTyped(descriptor, value, path);
}

function tagRow(schema: any, table: string, row: Record<string, WireValue>): TaggedValue {
  const columns = schema?.tables?.[table]?.columns;
  if (!plain(columns)) fail(`schema.tables.${table}.columns`, "is missing");
  const tagged: Record<string, TaggedValue> = Object.create(null);
  for (const [name, value] of Object.entries(row)) {
    if (!(name in columns)) fail(`rows.${table}.${name}`, "is not a declared column");
    tagged[name] = tagTyped(columns[name], value, `rows.${table}.${name}`);
  }
  const result = { Row: tagged };
  validateWriteRow(schema, table, result);
  return result;
}

function tagIndexValues(schema: any, table: string, index: string, values: WireValue[], offset: number): TaggedValue[] {
  const columns = indexColumns(schema, table, index);
  return values.map((value, at) => {
    const name = columns[offset + at];
    if (name === undefined) fail(`schema.tables.${table}.indexes.${index}`, "has too few columns");
    return tagTyped(schema.tables[table].columns[name], value, `${table}.${index}[${offset + at}]`);
  });
}

function tagBoundary(schema: any, range: DeliveryRange, value: WireValue | null): TaggedValue | null {
  if (value === null) return null;
  if (Array.isArray(value)) return { Array: tagIndexValues(schema, range.table, range.index, value, range.prefix.length) };
  return tagIndexValues(schema, range.table, range.index, [value], range.prefix.length)[0]!;
}

function tagTyped(descriptor: any, value: WireValue, path: string): TaggedValue {
  if (plain(descriptor) && "Optional" in descriptor) return value === null ? "Null" : tagTyped(descriptor.Optional, value, path);
  if (value === null) return "Null";
  if (descriptor === "Id" || descriptor === "Principal" || plain(descriptor) && "Ref" in descriptor) {
    if (typeof value !== "string") fail(path, "expected id string");
    validateIdentity(value);
    return { Id: value };
  }
  if (plain(descriptor) && ("Text" in descriptor || "Enum" in descriptor)) {
    if (typeof value !== "string") fail(path, "expected text string");
    const tagged = { String: value };
    validateTypedValue(descriptor, tagged, path, false);
    return tagged;
  }
  if (["Int", "Time"].includes(String(descriptor)) || plain(descriptor) && ("Decimal" in descriptor || "Money" in descriptor)) {
    uintOrSigned(value, path); return { Int: value as number };
  }
  if (descriptor === "Bool") { boolean(value, path); return { Bool: value as boolean }; }
  if (plain(descriptor) && "Bytes" in descriptor) {
    const bytes = plain(value) && "Bytes" in value ? value.Bytes : undefined;
    if (!plain(value) || Object.keys(value).length !== 1 || typeof bytes !== "string" || !/^(?:[0-9a-f]{2})*$/.test(bytes))
      fail(path, "expected canonical Bytes");
    return { Bytes: bytes };
  }
  if (plain(descriptor) && "List" in descriptor) {
    array(value, path);
    return { Array: value.map((item: WireValue, index: number) => tagTyped(descriptor.List.of, item, `${path}[${index}]`)) };
  }
  if (plain(descriptor) && ("Image" in descriptor || "Video" in descriptor)) {
    const tagged = tagJson(value);
    validateTypedValue(descriptor, tagged, path, false);
    return tagged;
  }
  // @ref LLP 1012#8-the-delivery-envelope-the-validator-and-resume — tag by
  // the declared column type only: a `json` value shaped `{ "Bytes": "…" }` is
  // application data, never the byte variant (O1a review).
  if (plain(descriptor) && "Json" in descriptor) return tagJson(value);
  fail(path, "has an unsupported schema descriptor");
}

function tagJson(value: WireValue): TaggedValue {
  if (value === null) return "Null";
  if (typeof value === "boolean") return { Bool: value };
  if (typeof value === "number") return { Int: value };
  if (typeof value === "string") return { String: value };
  if (Array.isArray(value)) return { Array: value.map(tagJson) };
  return { Map: Object.fromEntries(Object.entries(value).map(([key, item]) => [key, tagJson(item)])) };
}

function indexColumns(schema: any, table: string, index: string): string[] {
  return components(schema, table, index).map(c => "Column" in c ? c.Column : "");
}

function validateReferences(value: unknown, pool: Set<string>, path: string): void {
  if (rowReference(value)) {
    validateIdentity(value.$row.id); scalarText(value.$row.table);
    if (!pool.has(poolKey(value.$row.table, value.$row.id))) fail(path, "references a missing pooled row");
    return;
  }
  if (escapedObject(value)) {
    for (const [key, item] of Object.entries(value.$row.$value)) {
      validateReferences(item, pool, `${path}.$row.$value.${key}`);
    }
    return;
  }
  if (Array.isArray(value)) value.forEach((item, index) => validateReferences(item, pool, `${path}[${index}]`));
  else if (plain(value)) {
    if ("$row" in value) fail(path, "has a malformed reserved $row value");
    for (const [key, item] of Object.entries(value)) validateReferences(item, pool, `${path}.${key}`);
  }
}

function canonicalWire(value: WireValue): WireValue {
  if (Array.isArray(value)) return value.map(canonicalWire);
  if (plain(value)) {
    const record = value as Record<string, WireValue>;
    return Object.fromEntries(
      Object.keys(record).sort().map((key) => [key, canonicalWire(record[key]!)]),
    );
  }
  return value;
}

function wire(value: unknown, path: string): void {
  if (typeof value === "string") { scalarText(value); return; }
  if (value === null || typeof value === "boolean") return;
  if (typeof value === "number") { uintOrSigned(value, path); return; }
  if (Array.isArray(value)) { value.forEach((item, index) => wire(item, `${path}[${index}]`)); return; }
  object(value, path, [], [], true);
  for (const [key, item] of Object.entries(value)) { scalarText(key); wire(item, `${path}.${key}`); }
}

function rowReference(value: unknown): value is WireRowReference {
  return plain(value) && Object.keys(value).length === 1 && plain(value.$row)
    && Object.keys(value.$row).sort().join(",") === "id,table"
    && typeof value.$row.table === "string" && typeof value.$row.id === "string";
}

function escapedObject(value: unknown): value is WireEscapedObject {
  return plain(value) && Object.keys(value).length === 1 && plain(value.$row)
    && Object.keys(value.$row).length === 1 && plain(value.$row.$value);
}

function object(value: any, path: string, required: string[], optional: string[] = [], open = false): asserts value is Record<string, any> {
  if (!plain(value)) fail(path, "expected object");
  for (const name of required) if (!(name in value)) fail(`${path}.${name}`, "is required");
  if (!open) for (const name of Object.keys(value)) if (!required.includes(name) && !optional.includes(name)) fail(`${path}.${name}`, "is unknown");
}
function array(value: any, path: string): asserts value is any[] { if (!Array.isArray(value)) fail(path, "expected array"); }
function string(value: unknown, path: string): asserts value is string { if (typeof value !== "string" || value.length === 0) fail(path, "expected non-empty string"); scalarText(value); }
function boolean(value: unknown, path: string): asserts value is boolean { if (typeof value !== "boolean") fail(path, "expected boolean"); }
function uint(value: unknown, path: string): asserts value is number { if (!Number.isSafeInteger(value) || Number(value) < 0) fail(path, "expected non-negative safe integer"); }
function uintOrSigned(value: unknown, path: string): asserts value is number { if (!Number.isSafeInteger(value)) fail(path, "expected safe integer"); }
function digest(value: unknown, path: string): asserts value is string { if (typeof value !== "string" || !/^[0-9a-f]{64}$/.test(value)) fail(path, "expected lowercase SHA-256 digest"); }
function plain(value: any): value is Record<string, any> { return value !== null && typeof value === "object" && !Array.isArray(value) && (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null); }
function poolKey(table: string, id: string): string { return `${table.length}:${table}${id}`; }
function compareText(left: string, right: string): number { return left < right ? -1 : left > right ? 1 : 0; }
function clone<T>(value: T): T { return structuredClone(value); }
function fail(path: string, detail: string): never { throw new DeliveryEnvelopeDecodeError(path, detail); }

/** Structural parsing never normalizes a descriptor or infers Q. */
function wireIndexAtom(value: unknown, path: string): void {
  if (plain(value) && Object.keys(value).length === 1 && "Scalar" in value) {
    const v = value.Scalar;
    if (v !== null && typeof v === 'object' && !(plain(v) && Object.keys(v).length === 1 && typeof v.Bytes === 'string' && /^(?:[0-9a-f]{2})*$/.test(v.Bytes))) fail(path, 'ordinary atom must be scalar');
    wire(v, path); return;
  }
  object(value, path, ['WordPrefix']);
  object(value.WordPrefix, path, ['contract', 'source']);
  if (value.WordPrefix.contract !== 'u17-nfc-scf-nfc-wsp-p' || typeof value.WordPrefix.source !== 'string') fail(path, 'invalid word-prefix descriptor');
  scalarText(value.WordPrefix.source);
}
export function tagWireRangePrefix(schema: any, range: Pick<DeliveryRange, 'site' | 'table' | 'index' | 'prefix'>, program?: any): IndexAtom[] {
  const parts = components(schema, range.table, range.index);
  const atoms: IndexAtom[] = range.prefix.map((atom, i) => {
    wireIndexAtom(atom, 'range.prefix');
    const part = parts[i];
    if (!part) fail('range.prefix', 'too many components');
    if ('Column' in part && 'Scalar' in atom) return { Scalar: tagTyped(schema.tables[range.table].columns[part.Column], atom.Scalar, 'range.prefix') };
    if ('WordPrefixes' in part && 'WordPrefix' in atom) return atom;
    return fail('range.prefix', 'atom does not match its component');
  });
  prepareRange(schema, { ...range, prefix: atoms }, program);
  return atoms;
}
