import type { BackendJson } from "./backend.ts";
import { checkRead, duringRead } from "./read-work.ts";

// @ref LLP 3000.023#11 — missing compiler facts are unknown, never empty.
export type Footprint = Readonly<Record<string, readonly string[] | null>>;
export type QueryDependencies = { reads: Footprint; writes: Footprint };
export function dependencies(backend: BackendJson | null | undefined, operation: string): QueryDependencies | undefined {
  const facts = backend?.programs.find(p => p.name === operation)?.settlement;
  const footprint = (value: unknown): value is Footprint => !!value && typeof value === "object" && !Array.isArray(value)
    && Object.values(value).every(fields => fields === null || Array.isArray(fields) && fields.every(f => typeof f === "string"));
  return facts && footprint(facts.reads) && footprint(facts.writes) ? facts : undefined;
}
export function intersects(reads: Footprint | undefined, writes: Footprint | undefined): boolean {
  if (!reads || !writes) return true;
  return Object.entries(writes).some(([table, fields]) => Object.hasOwn(reads, table)
    && (fields === null || reads[table] === null || fields.some(f => reads[table]!.includes(f))));
}

/** Capture once, recheck synchronously at publication. Unknown events fence all. */
export class QueryChanges {
  private version = 0;
  private unknown = 0;
  private readonly tables = new Map<string, number>();
  change(tables?: readonly string[]): void {
    this.version++;
    if (tables === undefined) this.unknown = this.version;
    else for (const table of tables) this.tables.set(table, this.version);
  }
  capture(): (tables: ReadonlySet<string>) => boolean {
    const version = this.version;
    return tables => this.unknown <= version && [...tables].every(t => (this.tables.get(t) ?? 0) <= version);
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
  private readonly tables = new Map<string, number>();
  change(cut: number, tables?: readonly string[]): void {
    if (tables === undefined) this.unknown = Math.max(this.unknown, cut);
    else for (const table of tables) this.tables.set(table, Math.max(this.tables.get(table) ?? 0, cut));
  }
  current(cut: number, tables: ReadonlySet<string>): boolean {
    return Number.isSafeInteger(cut) && cut >= this.unknown && [...tables].every(t => cut >= (this.tables.get(t) ?? 0));
  }
}
