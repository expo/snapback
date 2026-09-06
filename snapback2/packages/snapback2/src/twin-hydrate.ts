// @ref LLP 1012#indexed-held-search — receipt admission uses the issuing operation's trusted query bound.
import { tagReceipt, tagWireRow, tagWireValue,
  type DeliveryReceipt, type EvaluatorClosureReceipt, type TaggedValue, type WireValue } from "./offline-protocol.js";
import type { StoredAnswer, StoredRow } from "./store/range-store.js";

/** Retag one changed receipt, including its own halo pool; never collect the partition history. */
export function closureFromAnswer(answer: StoredAnswer, schema: any, schemaHash: string, program: any,
  row: (key: string) => StoredRow | undefined): EvaluatorClosureReceipt {
  const rows = answer.refs.flatMap(ref => {
    const body = row(`${ref.table}\0${ref.id}`);
    return body ? [{ ...ref, row: tagWireRow(schema, ref.table, body.row as Record<string, WireValue>) }] : [];
  });
  const pool = new Set(rows.map(r => `${r.table}\0${r.id}`));
  const receipt = tagReceipt(schema, (answer.receipt ?? { ranges: [], absences: [], verdicts: [] }) as DeliveryReceipt, program);
  // Only durable page metadata may survive local eviction; public delivery shape never admits these fields.
  for (let i = 0; i < receipt.ranges.length; i++) {
    const range = receipt.ranges[i]!, held = answer.receipt!.ranges[i]!;
    if (range.halo && !pool.has(`${range.halo.table}\0${range.halo.id}`)) range.halo = null;
    if (held.heldSuffix) range.held_suffix = held.heldSuffix;
    if (held.evictedIds?.length) range.evicted_ids = held.evictedIds;
  }
  return { schema_hash: schemaHash, rows, ...receipt };
}

/** Tag one operation argument by the IR's descriptor (`Cursor`, `Optional`, or a column type). */
export function tagArgument(descriptor: unknown, value: unknown, path: string): TaggedValue {
  if (descriptor !== null && typeof descriptor === "object" && !Array.isArray(descriptor) && "Optional" in descriptor) {
    return value === null || value === undefined ? "Null" : tagArgument((descriptor as { Optional: unknown }).Optional, value, path);
  }
  if (descriptor === "Cursor") {
    if (value === null || value === undefined) return "Null";
    if (typeof value !== "string") throw new TypeError(`${path} must be an opaque cursor string`);
    return { String: value };
  }
  if (value === undefined) throw new TypeError(`${path} is required`);
  return tagWireValue(descriptor, value as WireValue, path);
}

export function tagArguments(descriptors: unknown, args: unknown): Record<string, TaggedValue> {
  const tagged: Record<string, TaggedValue> = Object.create(null);
  if (descriptors === null || typeof descriptors !== "object") return tagged;
  const record = args !== null && typeof args === "object" && !Array.isArray(args) ? args as Record<string, unknown> : {};
  for (const [name, descriptor] of Object.entries(descriptors as Record<string, unknown>)) {
    tagged[name] = tagArgument(descriptor, record[name], `args.${name}`);
  }
  return tagged;
}

export type PartialReason = "never-held" | "evicted" | "computed-key";

export interface PartialSite {
  site: string;
  reason: PartialReason;
}

interface TraceLike {
  ranges: Array<{ site: string; table: string; provenance?: string }>;
  absences: Array<{ site: string; table: string; index: string; key: unknown[]; provenance?: string }>;
}

/**
 * Why a site fell outside coverage: a row a swap evicted (`evicted`: a
 * primary-key read of an evicted row, or a range over a table one of whose
 * held pages lost a member), a key the program computed from another row so
 * no page could have named it (`computed-key`), or a read the store simply
 * never held (`never-held`).
 */
export function partialReasons(sites: string[], trace: TraceLike, coverage: { evicted: Set<string>; holed: Set<string> }): PartialSite[] {
  const { evicted, holed } = coverage;
  return sites.map((site) => {
    const absence = trace.absences.find((item) => item.site === site);
    const range = trace.ranges.find((item) => item.site === site);
    const provenance = absence?.provenance ?? range?.provenance;
    if (absence && absence.index === "byId") {
      const id = absence.key[0];
      const text = id !== null && typeof id === "object" && "Id" in id ? String((id as { Id: unknown }).Id) : undefined;
      if (text !== undefined && evicted.has(`${absence.table}\0${text}`)) return { site, reason: "evicted" };
    }
    if (range && holed.has(range.table)) return { site, reason: "evicted" };
    if (provenance === "Shape") return { site, reason: "computed-key" };
    return { site, reason: "never-held" };
  });
}
