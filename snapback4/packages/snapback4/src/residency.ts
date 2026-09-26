import type { Refusal } from "./contract.ts";

/** Physical local rows, including predictions and retained/expired images still
 * stored. Counts confer no query authority. Media caches are separate. */
export interface Residency {
  /** UTF-8 stored row payload bytes, excluding keys and indexes. */
  readonly tables: Readonly<Record<string, { readonly rows: number; readonly bytes: number }>>;
  readonly totalBytes: number;
  /** SQLite allocated pages (including free pages; excluding WAL/SHM files),
   * or UTF-8 logical persistence record keys + values (before IDB packing).
   * Neither is RSS or an estimate of IndexedDB's physical disk allocation. */
  readonly totalBytesKind: "sqlite-pages" | "logical";
  /** Allocated wasm linear memory shared by this realm's devices, not live heap. */
  readonly wasmHeapBytes?: number;
}

export function residencyError(why: Refusal): Error {
  return Object.assign(new Error(`${why.code}: ${why.message}`), why);
}

// @ref LLP 3000.019#3.4 — one public call across persistence hosts; recheck session custody after the read.
export async function readResidency(call: (request: Record<string, unknown>) => Promise<{ ok?: unknown; denied?: Refusal }>, unavailable: () => Refusal | null): Promise<Residency> {
  const before = unavailable();
  if (before) throw residencyError(before);
  const result = await call({ op: "residency" });
  const denied = unavailable() ?? result.denied;
  if (denied) throw residencyError(denied);
  return result.ok as Residency;
}
