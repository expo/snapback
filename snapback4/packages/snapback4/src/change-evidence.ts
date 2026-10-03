import type { ReadScopes } from "./local-reads.ts";
import { oncePlan, unproveOnce } from "./read-once.ts";

// @ref LLP 3000.023#12 — absence, widening and opaque dependencies always bound.
export function canRevoke(tables: ReadonlySet<string> | undefined, scopes: ReadScopes | undefined, preserved: unknown, read?: object): boolean {
  if (!tables?.size || tables.size > 256 || !scopes || typeof scopes !== "object" || Array.isArray(scopes) || Object.values(scopes).some(groups => !Array.isArray(groups)) || !Array.isArray(preserved) || preserved.length > 256
    || preserved.some(t => typeof t !== "string" || t.length > 512)) return true;
  const safe = new Set(preserved);
  const plan = oncePlan(read);
  return [...tables].some(table => !safe.has(table) && !(plan?.table === table && safe.has(`~once:${table}`)));
}

interface EvidenceWatch {
  tables: ReadonlySet<string>;
  scopes?: ReadScopes | undefined;
  opaque?: () => boolean;
  snapshot?: object;
  protectedReads: Iterable<{ tables: ReadonlySet<string>; scopes?: ReadScopes | undefined; read?: object }>;
}
export function watchCanRevoke(watch: EvidenceWatch, preserved: unknown): boolean {
  if (watch.snapshot) unproveOnce(watch.snapshot);
  for (const held of watch.protectedReads) if (held.read) unproveOnce(held.read);
  return watch.opaque?.() === true || canRevoke(watch.tables, watch.scopes, preserved, watch.snapshot)
    || [...watch.protectedReads].some(held => canRevoke(held.tables, held.scopes, preserved, held.read));
}
export function evidenceTouches(watch: EvidenceWatch, tables: readonly string[] | undefined): boolean {
  return tables === undefined || [watch, ...watch.protectedReads].some(read => read.tables.size === 0 || tables.some(t => read.tables.has(t)));
}
