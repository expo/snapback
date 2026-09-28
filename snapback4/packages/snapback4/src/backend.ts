// The backend as `GET /schema` sends it: the schema's shape and the
// programs the device runs. The client reads only what it needs to route
// a read (which tables an operation touches, which of them sync); the
// device interprets the programs.

export interface SearchComposition {
  table: string; index: string; column: string; kind: "Time" | "Int";
  order: "Asc" | "Desc"; limit: number; needle: string; cursor: string; variant: number[] | null;
}
export interface OperationFacts {
  reads?: string[];
  search?: SearchComposition;
  held?: boolean;
  runs?: "device" | "server";
  predicts?: "eligible" | "never";
  ephemeral?: boolean;
  renews?: boolean;
  renewMs?: number;
  ephemeralReads?: string[];
}

export interface ProgramJson extends OperationFacts {
  name: string;
  kind: "Query" | "Mutation" | "job" | "action";
  args: Record<string, unknown>;
  body: unknown[];
  /** The body is the app's native module (LLP 3000.005). */
  native?: boolean;
  held?: boolean;
  runs?: "device" | "server";
  predicts?: "eligible" | "never";
}

export interface TableJson {
  ephemeral?: { life_ms: number };
  columns: Record<string, unknown>;
  indexes: Record<string, { components: ({ Column: string } | { WordPrefixes: unknown })[]; unique: boolean }>;
  sync?: { audience: unknown; horizon?: { last: number; by: string } | null } | null;
  leave?: "until-revoked" | "delivered-history";
  /** The time column that ends a row's life; a row past it is absent here too. */
  expire?: string | null;
  through?: { parent: string } | null;
}

export interface SchemaJson {
  delivery?: { fingerprint: string; table: string; group: string; position: string; mutation: string; args: [string, string, string] }[];
  tables: Record<string, TableJson>;
  maintains?: unknown[];
  timelines?: { name: string; posts: [string, ...string[]]; reposts: [string, ...string[]]; owned?: string[]; edges?: string[]; authors?: string[] }[];
  operations?: Record<string, OperationFacts>;
}

/** The app's native module the server serves at `/native.wasm` (LLP
 * 3000.005 §9): its digest, and the jobs and reads it implements. A
 * device installs it once per digest and answers native reads over the
 * rows it holds. */
export interface NativeJson {
  digest: string;
  jobs: string[];
  reads: string[];
}

export interface BackendJson {
  generation: number;
  schema: SchemaJson;
  programs: ProgramJson[];
  native?: NativeJson | null;
}

/** The tables an operation reads or writes, its rules' included: what
 * decides whether a read can run on the device and a write can predict. */
export function operationTables(program: ProgramJson, schema: SchemaJson): Set<string> {
  const reads = schema.operations?.[program.name]?.reads;
  if (program.kind === "Query" && reads !== undefined) return new Set(reads);
  const tables = new Set<string>();
  const walk = (value: unknown) => {
    if (!value || typeof value !== "object") return;
    for (const [key, child] of Object.entries(value)) {
      if (key === "table" && typeof child === "string") tables.add(child);
      else walk(child);
    }
  };
  walk(program.body);
  for (const table of tables) {
    walk((schema.tables[table] as { rules?: unknown } | undefined)?.rules);
    // @ref LLP 3000.029#9 — schema closure, matching the shared Rust engine.
    const parent = schema.tables[table]?.through?.parent;
    if (parent) tables.add(parent);
    for (const value of schema.maintains ?? []) {
      const maintain = value as { target: string; source: string; row_key?: { table: string }; parent_key?: { parent: string } };
      if (maintain.target !== table) continue;
      tables.add(maintain.source);
      if (maintain.row_key) tables.add(maintain.row_key.table);
      if (maintain.parent_key) tables.add(maintain.parent_key.parent);
    }
    // @ref LLP 3000.016#21a-owned-events-follow-their-source-rows — a partial event prediction writes its source slot, not an owned row.
    // Include those dependencies in invalidation and the fallback fence, even
    // when an unknown branch has not yet executed the event read.
    for (const timeline of schema.timelines ?? []) {
      if (!(timeline.owned ?? ["Posts", "RemovedEvents", "Feed", "Work", "Edges"].map(suffix => timeline.name + suffix)).includes(table)) continue;
      for (const source of [...timeline.owned ?? [], timeline.posts[0], timeline.reposts[0], timeline.edges?.[0], timeline.authors?.[0]]) {
        if (!source) continue;
        tables.add(source);
      }
    }
  }
  return tables;
}
