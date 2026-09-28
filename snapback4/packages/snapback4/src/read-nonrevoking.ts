import type { BackendJson } from "./backend.ts";

// @ref LLP 3000.029#7 — only public base-row puts without prediction effects
// preserve authority. This is metadata classification, never query evaluation.
export function nonRevokingPuts(backend: BackendJson | null | undefined, page: Record<string, unknown>): string[] {
  if (!backend || page.snapshot || page.snapshot_catchup || Object.keys(page.joined ?? {}).length
    || (Array.isArray(page.acquisitions) && page.acquisitions.length) || !Array.isArray(page.events)) return [];
  const candidates = new Set<string>();
  const invalid = new Set<string>();
  for (const event of page.events as { table: string; kind: string }[]) {
    if (event.kind === "put") candidates.add(event.table); else invalid.add(event.table);
  }
  return [...candidates].filter(name => {
    const table = backend.schema.tables[name] as { rules?: { read?: unknown }; expire?: unknown; through?: unknown; ephemeral?: unknown; written_by?: object } | undefined;
    const rule = table?.rules?.read;
    const publicRead = rule === "Allow" || (!!rule && typeof rule === "object" && "Public" in rule);
    return publicRead && !invalid.has(name) && !table?.expire && !table?.through && !table?.ephemeral
      && !Object.keys(table?.written_by ?? {}).length
      && !backend.schema.maintains?.some(m => (m as { target?: string }).target === name);
  });
}

// Restrict retention to a direct immutable-key lookup. A public table can be a
// rule witness or authored require for a different query, so public writes alone
// are insufficient proof for that query's old answer.
export function putRetention(backend: BackendJson | null | undefined, name: string): string[] {
  const program = backend?.programs.find(p => p.name === name);
  if (!program || program.native || program.body.length !== 1) return [];
  const read = (program.body[0] as { Return?: { Get?: { table: string; index: string; key: unknown[] } } }).Return?.Get;
  if (!read || !read.key.every(key => key && typeof key === "object" &&
    ("Literal" in key || ("Input" in key && (key as { Input: string }).Input === "Viewer") || ("Variable" in key && (key as { Variable: string }).Variable in program.args)))) return [];
  const table = backend!.schema.tables[read.table];
  const index = table?.indexes[read.index];
  const immutable = (table as { constraints?: { Immutable?: { fields: string[] } }[] })?.constraints?.flatMap(c => c.Immutable?.fields ?? []) ?? [];
  if (!index?.unique || index.components.length !== read.key.length || !index.components.every(c => "Column" in c && (c.Column === "id" || immutable.includes(c.Column)))) return [];
  return nonRevokingPuts(backend, { events: [{ table: read.table, kind: "put" }] });
}

// Admissions and settlements during a sync matter only to their dependencies.
// Unknown footprints and scope changes spoil every table's proof.
export class PredictionEffects {
  revision = 0;
  private unknown = 0;
  private readonly changedAt = new Map<string, number>();
  changed(tables?: readonly string[]): void {
    const revision = ++this.revision;
    if (tables === undefined) this.unknown = revision;
    else for (const table of tables) this.changedAt.set(table, revision);
  }
  unaffected(table: string, captured: number): boolean {
    return captured >= this.unknown && captured >= (this.changedAt.get(table) ?? 0);
  }
}
