import type { ReadScopes } from "./local-reads.ts";

// @ref LLP 3000.023#12 — absence, widening and opaque dependencies always bound.
export function canRevoke(tables: ReadonlySet<string> | undefined, scopes: ReadScopes | undefined, preserved: unknown): boolean {
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
  return watch.opaque?.() === true || canRevoke(watch.tables, watch.scopes, preserved)
    || [...watch.protectedReads].some(read => canRevoke(read.tables, read.scopes, preserved));
}
export function evidenceTouches(watch: EvidenceWatch, tables: readonly string[] | undefined): boolean {
  return tables === undefined || [watch, ...watch.protectedReads].some(read => read.tables.size === 0 || tables.some(t => read.tables.has(t)));
}
