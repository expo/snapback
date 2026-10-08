import type { BackendJson } from "./backend.ts";
import { checkRead, duringRead } from "./read-work.ts";

// @ref LLP 3000.023#11 — missing compiler facts are unknown, never empty.
export type Footprint = Readonly<Record<string, readonly string[] | null>>;
export type QueryDependencies = { reads: Footprint; writes: Footprint };
export function dependencies(backend: BackendJson | null | undefined, operation: string): QueryDependencies | undefined {
  return validateDependencies(backend?.programs.find(p => p.name === operation)?.settlement);
}
export function footprint(value: unknown): value is Footprint {
  return !!value && typeof value === "object" && !Array.isArray(value)
    && Object.values(value).every(fields => fields === null || Array.isArray(fields) && fields.every(f => typeof f === "string"));
}
export function validateDependencies(value: unknown): QueryDependencies | undefined {
  const facts = value as QueryDependencies | undefined;
  return facts && typeof facts === "object" && !Array.isArray(facts) && footprint(facts.reads) && footprint(facts.writes) ? facts : undefined;
}
export type Changes = Footprint | readonly string[];
export function tableFootprint(tables: Iterable<string>): Footprint { return Object.fromEntries([...tables].map(t => [t, null])); }
export function readFootprint(inputs: Footprint | undefined, tables: Iterable<string>): Footprint | undefined {
  return inputs && { ...tableFootprint(tables), ...inputs };
}
const effects = (changes: Changes): Footprint => Array.isArray(changes) ? tableFootprint(changes) : changes as Footprint;
export function intersects(reads: Footprint | undefined, writes: Footprint | undefined): boolean {
  if (!reads || !writes) return true;
  return Object.entries(writes).some(([table, fields]) => Object.hasOwn(reads, table)
    && (fields === null || reads[table] === null || fields.some(f => reads[table]!.includes(f))));
}

/** Capture once, recheck synchronously at publication. Unknown events fence all. */
export class QueryChanges {
  private version = 0;
  private readonly cuts = new QueryCuts();
  change(changes?: Changes): void { this.cuts.change(++this.version, changes); }
  capture(): (reads: Footprint | ReadonlySet<string> | undefined) => boolean {
    const version = this.version;
    return reads => this.cuts.current(version, reads);
  }
}

// Subscribe before inspecting custody; notifications during async queue reads
// cause a fresh inspection. No polling or missed observation/failure wakeup.
export async function waitForQueryWrites(blocked: () => boolean | Promise<boolean>, subscribe: (notify: () => void) => () => void, signal: AbortSignal): Promise<void> {
  let version = 0, wake: (() => void) | undefined;
  const stop = subscribe(() => { version++; wake?.(); });
  try {
    while (true) {
      checkRead(signal);
      const before = version;
      if (!await duringRead(Promise.resolve(blocked()), signal)) return;
      checkRead(signal);
      if (before !== version) continue;
      await duringRead(new Promise<void>(resolve => { wake = resolve; }), signal);
      wake = undefined;
    }
  } finally { stop(); }
}

/** Server evidence is ordered by its existing sequence, including this reply. */
export class QueryCuts {
  private unknown = 0;
  private latest = 0;
  private readonly tables = new Map<string, { all: number; fields: Map<string, number> }>();
  clear(): void { this.unknown = 0; this.latest = 0; this.tables.clear(); }
  change(cut: number, changes?: Changes): void {
    this.latest = Math.max(this.latest, cut);
    if (changes === undefined) this.unknown = Math.max(this.unknown, cut);
    else for (const [table, fields] of Object.entries(effects(changes))) {
      let entry = this.tables.get(table);
      if (!entry) this.tables.set(table, entry = { all: 0, fields: new Map() });
      if (fields === null) entry.all = Math.max(entry.all, cut);
      else for (const field of fields) entry.fields.set(field, Math.max(entry.fields.get(field) ?? 0, cut));
    }
  }
  current(cut: number, reads: Footprint | ReadonlySet<string> | undefined): boolean {
    if (!Number.isSafeInteger(cut) || cut < this.unknown) return false;
    if (reads === undefined) return cut >= this.latest;
    const inputs = reads instanceof Set ? tableFootprint(reads) : reads as Footprint | undefined;
    return [...this.tables].every(([table, entry]) => inputs && !Object.hasOwn(inputs, table)
      || cut >= entry.all && [...entry.fields].every(([field, at]) => cut >= at || inputs?.[table] != null && !inputs[table]!.includes(field)));
  }
}

/** Evidence names a complete server interval; caller supplies its pinned identity/generation. */
export function intervalChanges(value: unknown, after: number, through: number): Footprint | undefined {
  const proof = value as { after?: number; through?: number; writes?: unknown } | undefined;
  return proof && Number.isSafeInteger(after) && Number.isSafeInteger(through) && Number.isSafeInteger(proof.after) && proof.after! >= 0 && proof.after! <= after
    && proof.through === through && through >= after && footprint(proof.writes) ? proof.writes : undefined;
}
