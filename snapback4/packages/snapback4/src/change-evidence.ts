import type { Footprint } from "./query-dependencies.ts";
import type { ReadScopes } from "./local-reads.ts";

// @ref LLP 3000.009.001.000#3.4 — unknown evidence cannot certify revocation.
// @ref LLP 3000.023#12 — known evidence classifies mounted read retention.
export function canRevoke(tables: ReadonlySet<string> | undefined, scopes: ReadScopes | undefined, preserved: unknown): boolean {
  if (preserved === null || preserved === undefined) return false;
  if (!tables?.size || tables.size > 256 || !scopes || typeof scopes !== "object" || Array.isArray(scopes) || Object.values(scopes).some(groups => !Array.isArray(groups)) || !Array.isArray(preserved) || preserved.length > 256
    || preserved.some(t => typeof t !== "string" || t.length > 512)) return true;
  const safe = new Set(preserved);
  return [...tables].some(table => !safe.has(table));
}

interface EvidenceWatch {
  tables: ReadonlySet<string>;
  scopes?: ReadScopes | undefined;
  opaque?: () => boolean;
  protectedReads: Iterable<{ tables: ReadonlySet<string>; scopes?: ReadScopes | undefined }>;
}
export function watchCanRevoke(watch: EvidenceWatch, preserved: unknown): boolean {
  if (preserved === null || preserved === undefined) return false;
  return watch.opaque?.() === true || canRevoke(watch.tables, watch.scopes, preserved)
    || [...watch.protectedReads].some(read => canRevoke(read.tables, read.scopes, preserved));
}
export function evidenceTouches(watch: EvidenceWatch, tables: readonly string[] | undefined): boolean {
  return tables === undefined || [watch, ...watch.protectedReads].some(read => read.tables.size === 0 || tables.some(t => read.tables.has(t)));
}

// @ref LLP 3000.041#42-w2-the-client-re-evaluates-precisely-and-never-loses-a-notification — a
// body projected to this viewer's interest (it carries `interest`) is read by
// the truth table of §4.1: a recorded table inside the interest is judged by
// the projected lists, one outside it by the aggregate bits, and `*`, a
// missing bit or null evidence is unknown (re-run, no revocation withdrawal).
export type PartitionProjection = Readonly<Record<string, { own?: boolean; public?: boolean; groups?: readonly unknown[][] }>> | "*";
export interface ChangeEvidence {
  /** The body carried `interest`: it was projected to this viewer. */
  projected: boolean;
  /** Projected but unclassifiable: every watch re-runs and nothing revokes. */
  unknown: boolean;
  interest: ReadonlySet<string> | undefined;
  tables: readonly string[] | undefined;
  preserved: readonly string[] | null;
  preservedOthers: boolean | null;
  /** Settlement writes inside the interest; undefined when unknown. */
  writes: Footprint | undefined;
  /** An outside-interest table may have been written. */
  writesOthers: boolean;
  partitions: PartitionProjection | undefined;
}
interface ChangeBody { interest?: unknown; tables?: unknown; preserved?: unknown; preservedOthers?: unknown; changes?: unknown; partitions?: unknown }
const names = (value: unknown): value is readonly string[] => Array.isArray(value) && value.length <= 256 && value.every(t => typeof t === "string" && t.length <= 512);
export function classifyChange(json: ChangeBody, intervalWrites: Footprint | undefined): ChangeEvidence {
  const tables = names(json.tables) ? json.tables : undefined;
  if (json.interest === undefined) {
    return { projected: false, unknown: false, interest: undefined, tables, preserved: names(json.preserved) ? json.preserved : null, preservedOthers: null, writes: intervalWrites, writesOthers: false, partitions: undefined };
  }
  const unknown: ChangeEvidence = { projected: true, unknown: true, interest: undefined, tables: undefined, preserved: null, preservedOthers: null, writes: undefined, writesOthers: true, partitions: "*" };
  if (!names(json.interest)) return unknown;
  const preservedOthers = typeof json.preservedOthers === "boolean" ? json.preservedOthers : null;
  // A projected preserved list without its aggregate bit certifies nothing.
  const preserved = names(json.preserved) && preservedOthers !== null ? json.preserved : null;
  const changes = json.changes as { others?: unknown } | null | undefined;
  const writesKnown = !!changes && typeof changes === "object" && typeof changes.others === "boolean" && intervalWrites !== undefined;
  const partitions = json.partitions === "*" ? "*" : json.partitions && typeof json.partitions === "object" && !Array.isArray(json.partitions) ? json.partitions as PartitionProjection : undefined;
  return { projected: true, unknown: false, interest: new Set(json.interest), tables, preserved, preservedOthers: preserved === null ? null : preservedOthers,
    writes: writesKnown ? intervalWrites : undefined, writesOthers: writesKnown ? (changes as { others: boolean }).others : true, partitions };
}

/** A synced table's audience arity from the client's schema copy: 0 public, 1 a principal column, the prefix length for a group. */
export function audienceArity(audience: unknown): number | undefined {
  if (audience === "Public") return 0;
  if (audience && typeof audience === "object") {
    if ("Column" in audience) return 1;
    const target = (audience as { Target?: { prefix?: unknown } }).Target;
    if (target && Array.isArray(target.prefix)) return target.prefix.length;
  }
  return undefined;
}
const prefixMatches = (scopeGroup: Record<string, unknown>, changed: readonly unknown[]) =>
  Object.entries(scopeGroup).every(([index, value]) => JSON.stringify(value) === JSON.stringify(changed[Number(index)]));

/** W2a: whether a notified interval obliges this watch to re-run. */
export function watchAffected(watch: EvidenceWatch, evidence: ChangeEvidence, arity: (table: string) => number | undefined): boolean {
  if (!evidence.projected) return evidenceTouches(watch, evidence.tables);
  if (evidence.unknown || evidence.interest === undefined || evidence.tables === undefined || evidence.preserved === null) return true;
  if (watch.opaque?.() === true) return true;
  const { interest, tables, preserved, partitions } = evidence;
  const touched = new Set(tables), safe = new Set(preserved);
  for (const read of [watch, ...watch.protectedReads]) {
    if (read.tables.size === 0) return true;
    for (const table of read.tables) {
      if (!interest.has(table)) return true;
      if (!safe.has(table)) return true;
      if (!touched.has(table)) continue;
      const groups = read.scopes && Object.hasOwn(read.scopes, table) ? read.scopes[table] : undefined;
      if (!Array.isArray(groups) || groups.length === 0) return true;
      const keys = arity(table);
      if (keys === undefined || groups.some(group => !group || typeof group !== "object" || Object.keys(group).length < keys)) return true;
      if (partitions === undefined || partitions === "*") return true;
      const changed = partitions[table];
      if (!changed || changed.own === true || changed.public === true || !Array.isArray(changed.groups)) return true;
      if (changed.groups.some(group => Array.isArray(group) && groups.some(scopeGroup => prefixMatches(scopeGroup as Record<string, unknown>, group)))) return true;
    }
  }
  return false;
}

/** §12 over a projected body: which recorded tables could have lost a row. */
export function watchRevokes(watch: EvidenceWatch, evidence: ChangeEvidence): boolean {
  if (!evidence.projected) return false;
  if (evidence.unknown || evidence.interest === undefined || evidence.preserved === null) return false;
  if (watch.opaque?.() === true) return true;
  const safe = new Set(evidence.preserved);
  return [watch, ...watch.protectedReads].some(read => read.tables.size === 0 || read.tables.size > 256
    || [...read.tables].some(table => evidence.interest!.has(table) ? !safe.has(table) : evidence.preservedOthers === false));
}

/** The online-only tables these watches read, for the poll's `tables=`. */
export function declaredTables(watches: Iterable<EvidenceWatch>, synced: (table: string) => boolean | undefined): string[] {
  const declared = new Set<string>();
  for (const watch of watches) for (const read of [watch, ...watch.protectedReads]) for (const table of read.tables) if (synced(table) !== true) declared.add(table);
  return [...declared].sort().slice(0, 256);
}
