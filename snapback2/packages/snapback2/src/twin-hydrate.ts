// @ref LLP 1012#indexed-held-search — receipt admission uses the issuing operation's trusted query bound.
import { tagWireValue,
  type TaggedValue, type WireValue } from "./offline-protocol.js";
import { plainObject } from "../../evaluator/src/value-runtime.js";

/** Tag one operation argument by the IR's descriptor (`Cursor`, `Optional`, or a column type). */
export function tagArgument(descriptor: unknown, value: unknown, path: string, schema?: any): TaggedValue {
  if (plainObject(descriptor) && "Optional" in descriptor) {
    return value === null || value === undefined ? "Null" : tagArgument(descriptor.Optional, value, path, schema);
  }
  if (descriptor === "Cursor") {
    if (value === null || value === undefined) return "Null";
    if (typeof value !== "string") throw new TypeError(`${path} must be an opaque cursor string`);
    return { String: value };
  }
  if (value === undefined) throw new TypeError(`${path} is required`);
  return tagWireValue(descriptor, value as WireValue, path, schema);
}

export function tagArguments(descriptors: unknown, args: unknown, schema?: any): Record<string, TaggedValue> {
  const tagged: Record<string, TaggedValue> = Object.create(null);
  if (!plainObject(descriptors)) return tagged;
  const record = plainObject(args) ? args : {};
  for (const [name, descriptor] of Object.entries(descriptors)) {
    tagged[name] = tagArgument(descriptor, record[name], `args.${name}`, schema);
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
