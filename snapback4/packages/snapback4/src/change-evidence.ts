import type { ReadScopes } from "./local-reads.ts";

/** The shared wire bound; malformed known evidence conservatively revokes. */
export function validPreserved(value: unknown): value is readonly string[] {
  return Array.isArray(value) && value.length <= 256 && value.every(t => typeof t === "string" && t.length <= 512);
}

// @ref LLP 3000.009.001.000#3.4 — unknown evidence cannot certify revocation.
// @ref LLP 3000.023#12 — known evidence classifies mounted read retention.
export function canRevoke(tables: ReadonlySet<string> | undefined, scopes: ReadScopes | undefined, preserved: unknown): boolean {
  if (preserved === null || preserved === undefined) return false;
  if (!tables?.size || tables.size > 256 || !scopes || typeof scopes !== "object" || Array.isArray(scopes) || Object.values(scopes).some(groups => !Array.isArray(groups)) || !validPreserved(preserved)) return true;
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
