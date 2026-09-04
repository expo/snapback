import type { Receipt, ReceiptRange, StoredRow } from "./store/range-store.js";

export type DeliveryState = "complete" | "capped" | "partial" | "denied";

export interface DeliveryEnvelopeV1 {
  protocol: 1;
  generation: string;
  schemaHash: string;
  planHash: string;
  authority: { principal: string; authEpoch: number };
  state: DeliveryState;
  data: unknown;
  next: string | null;
  seq: number;
  rows: StoredRow[];
  receipt: Receipt;
  validator: string;
  reason?: string;
  rule?: string;
}

export interface ResumeRequestV1 {
  protocol: 1;
  generation: string;
  schemaHash: string;
  authEpoch: number;
  log?: { op: string; args: unknown; watermark: string | null; validator?: string };
  mounted: Array<{ op: string; args: unknown; validator: string }>;
}

export type ResumeAnswer =
  | { op: string; args: unknown; unchanged: true; validator: string }
  | ({ op?: string; args?: unknown; unchanged?: false; watermark?: string | null } & DeliveryEnvelopeV1);

export interface ResumeResponseV1 {
  seq: number;
  generation: string;
  schemaHash: string;
  authority: { principal: string; authEpoch: number };
  log?: ResumeAnswer;
  mounted: ResumeAnswer[];
  grant?: unknown;
  more?: number;
}

export class OfflineProtocolShapeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "OfflineProtocolShapeError";
  }
}

function object(value: unknown, surface: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new OfflineProtocolShapeError(`${surface} must be an object`);
  }
  return value as Record<string, unknown>;
}

function present(record: Record<string, unknown>, field: string, surface: string): unknown {
  if (!Object.prototype.hasOwnProperty.call(record, field)) {
    throw new OfflineProtocolShapeError(`${surface} is missing ${field}`);
  }
  return record[field];
}

function string(record: Record<string, unknown>, field: string, surface: string): string {
  const value = present(record, field, surface);
  if (typeof value !== "string" || value.length === 0) {
    throw new OfflineProtocolShapeError(`${surface}.${field} must be a non-empty string`);
  }
  return value;
}

function number(record: Record<string, unknown>, field: string, surface: string): number {
  const value = present(record, field, surface);
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) {
    throw new OfflineProtocolShapeError(`${surface}.${field} must be a non-negative safe integer`);
  }
  return value;
}

function optionalString(record: Record<string, unknown>, field: string, surface: string): string | undefined {
  if (!Object.prototype.hasOwnProperty.call(record, field)) return undefined;
  const value = record[field];
  if (typeof value !== "string" || value.length === 0) {
    throw new OfflineProtocolShapeError(`${surface}.${field} must be a non-empty string`);
  }
  return value;
}

function decodeRange(value: unknown, index: number): ReceiptRange {
  const surface = `delivery receipt range ${index}`;
  const range = object(value, surface);
  const rowIds = present(range, "rowIds", surface);
  if (!Array.isArray(rowIds) || rowIds.some((id) => typeof id !== "string" || id.length === 0)) {
    throw new OfflineProtocolShapeError(`${surface}.rowIds must be strings`);
  }
  const absence = present(range, "absence", surface);
  if (typeof absence !== "boolean") throw new OfflineProtocolShapeError(`${surface}.absence must be boolean`);
  const decoded: ReceiptRange = {
    site: string(range, "site", surface),
    table: string(range, "table", surface),
    index: string(range, "index", surface),
    prefix: present(range, "prefix", surface),
    bounds: present(range, "bounds", surface),
    rowIds: [...rowIds] as string[],
    stop: present(range, "stop", surface),
    absence,
  };
  const haloId = optionalString(range, "haloId", surface);
  if (haloId !== undefined) decoded.haloId = haloId;
  const ruleHash = optionalString(range, "ruleHash", surface);
  if (ruleHash !== undefined) decoded.ruleHash = ruleHash;
  if (Object.prototype.hasOwnProperty.call(range, "rowKeys")) {
    const rowKeys = object(range.rowKeys, `${surface}.rowKeys`);
    for (const [id, key] of Object.entries(rowKeys)) {
      if (!Array.isArray(key)) throw new OfflineProtocolShapeError(`${surface}.rowKeys.${id} must be an array`);
    }
    decoded.rowKeys = rowKeys as Record<string, unknown[]>;
  }
  return decoded;
}

function decodeReceipt(value: unknown): Receipt {
  const receipt = object(value, "delivery receipt");
  const ranges = present(receipt, "ranges", "delivery receipt");
  const absences = present(receipt, "absences", "delivery receipt");
  const verdicts = present(receipt, "verdicts", "delivery receipt");
  if (!Array.isArray(ranges) || !Array.isArray(absences) || !Array.isArray(verdicts)) {
    throw new OfflineProtocolShapeError("delivery receipt arrays are malformed");
  }
  const decodedAbsences = absences.map((value, index) => {
    if (!Array.isArray(value) || value.length !== 3
      || typeof value[0] !== "string" || typeof value[1] !== "string" || !Array.isArray(value[2])) {
      throw new OfflineProtocolShapeError(`delivery receipt absence ${index} must be [table,index,key]`);
    }
    return [value[0], value[1], value[2]] as [string, string, unknown[]];
  });
  return { ranges: ranges.map(decodeRange), absences: decodedAbsences, verdicts: structuredClone(verdicts) };
}

// @ref LLP 1012#8-the-delivery-envelope-the-validator-and-resume — the client treats the v1 envelope as frozen and rejects malformed custody facts.
export function decodeDeliveryEnvelopeV1(value: unknown): DeliveryEnvelopeV1 | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)
    || (value as Record<string, unknown>).protocol === undefined) return undefined;
  const record = object(value, "delivery envelope");
  if (record.protocol !== 1) throw new OfflineProtocolShapeError("delivery envelope.protocol must be 1");
  const authorityRecord = object(present(record, "authority", "delivery envelope"), "delivery envelope.authority");
  const state = string(record, "state", "delivery envelope");
  if (!["complete", "capped", "partial", "denied"].includes(state)) {
    throw new OfflineProtocolShapeError("delivery envelope.state is unknown");
  }
  const next = present(record, "next", "delivery envelope");
  if (next !== null && typeof next !== "string") {
    throw new OfflineProtocolShapeError("delivery envelope.next must be a string or null");
  }
  const rows = present(record, "rows", "delivery envelope");
  if (!Array.isArray(rows)) throw new OfflineProtocolShapeError("delivery envelope.rows must be an array");
  const seen = new Set<string>();
  const decodedRows = rows.map((value, index) => {
    const row = object(value, `delivery row ${index}`);
    const table = string(row, "table", `delivery row ${index}`);
    const id = string(row, "id", `delivery row ${index}`);
    const body = object(present(row, "row", `delivery row ${index}`), `delivery row ${index}.row`);
    const key = `${table}\u0000${id}`;
    if (seen.has(key)) throw new OfflineProtocolShapeError(`delivery row ${index} duplicates ${table}/${id}`);
    seen.add(key);
    return { table, id, row: structuredClone(body) };
  });
  const decoded: DeliveryEnvelopeV1 = {
    protocol: 1,
    generation: string(record, "generation", "delivery envelope"),
    schemaHash: string(record, "schemaHash", "delivery envelope"),
    planHash: string(record, "planHash", "delivery envelope"),
    authority: {
      principal: string(authorityRecord, "principal", "delivery envelope.authority"),
      authEpoch: number(authorityRecord, "authEpoch", "delivery envelope.authority"),
    },
    state: state as DeliveryState,
    data: structuredClone(present(record, "data", "delivery envelope")),
    next: next as string | null,
    seq: number(record, "seq", "delivery envelope"),
    rows: decodedRows,
    receipt: decodeReceipt(present(record, "receipt", "delivery envelope")),
    validator: string(record, "validator", "delivery envelope"),
  };
  const reason = optionalString(record, "reason", "delivery envelope");
  if (reason !== undefined) decoded.reason = reason;
  const rule = optionalString(record, "rule", "delivery envelope");
  if (rule !== undefined) decoded.rule = rule;
  return decoded;
}

function rowMarker(value: unknown): [string, string] | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const marker = (value as { $row?: unknown }).$row;
  return Array.isArray(marker) && marker.length === 2
    && typeof marker[0] === "string" && typeof marker[1] === "string"
    ? marker as [string, string] : undefined;
}

/** Expand the v1 row-reference form before application code sees data. */
export function expandDeliveryData(envelope: DeliveryEnvelopeV1): unknown {
  const rows = new Map(envelope.rows.map((row) => [`${row.table}\u0000${row.id}`, row.row]));
  const expand = (value: unknown): unknown => {
    const marker = rowMarker(value);
    if (marker) return structuredClone(rows.get(`${marker[0]}\u0000${marker[1]}`) ?? null);
    if (Array.isArray(value)) return value.map(expand);
    if (!value || typeof value !== "object") return value;
    return Object.fromEntries(Object.entries(value as Record<string, unknown>).map(([key, item]) => [key, expand(item)]));
  };
  return expand(envelope.data);
}
