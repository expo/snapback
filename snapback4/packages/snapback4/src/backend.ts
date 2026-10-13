// The backend as `GET /schema` sends it: the schema's shape and the
// programs the device runs. The client reads only what it needs to route
// a read (which tables an operation touches, which of them sync); the
// device interprets the programs.

export interface SearchComposition {
  table: string; index: string; column: string; kind: "Time" | "Int";
  order: "Asc" | "Desc"; limit: number; needle: string; cursor: string; variant: number[] | null;
}
export interface OperationFacts {
  search?: SearchComposition;
  search_decoration?: boolean;
  held?: boolean;
  runs?: "device" | "server";
  predicts?: "eligible" | "never";
  ephemeral?: boolean;
  renews?: boolean;
  renewMs?: number;
  ephemeralReads?: string[];
}

export interface ProgramJson extends OperationFacts {
  settlement?: import("./query-dependencies.ts").QueryDependencies | null;
  name: string;
  kind: "Query" | "Mutation" | "job" | "action";
  args: Record<string, unknown>;
  body: unknown[];
  read_time_granularity_ms?: number | null;
  returned_shapes?: Record<string, string>;
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
  /** The time column that starts a row's server-authoritative read life. */
  notBefore?: string | null;
}

export interface SchemaJson {
  delivery?: { fingerprint: string; table: string; group: string; position: string; mutation: string; args: [string, string, string] }[];
  tables: Record<string, TableJson>;
  maintains?: unknown[];
  timelines?: { name: string; posts: [string, ...string[]]; reposts: [string, ...string[]]; edges?: [string, ...string[]] }[];
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
  store_id?: string;
  device_compatibility?: import("./device-version.ts").DeviceCompatibility;
  generation: number;
  schema: SchemaJson;
  programs: ProgramJson[];
  native?: NativeJson | null;
}

/** The tables an operation reads or writes, its rules' included: what
 * decides whether a read can run on the device and a write can predict. */
export function operationTables(program: ProgramJson, schema: SchemaJson): Set<string> {
  const tables = new Set<string>();
  const walk = (value: unknown) => {
    if (!value || typeof value !== "object") return;
    for (const [key, child] of Object.entries(value)) {
      if (key === "table" && typeof child === "string") tables.add(child);
      else walk(child);
    }
  };
  walk(program.body);
  for (const table of Object.keys(program.settlement?.reads ?? {})) tables.add(table);
  for (const table of tables) {
    walk((schema.tables[table] as { rules?: unknown } | undefined)?.rules);
    // @ref LLP 3000.016#21a-owned-events-follow-their-source-rows — a partial event prediction writes its source slot, not an owned row.
    // Include those dependencies in invalidation and the fallback fence, even
    // when an unknown branch has not yet executed the event read.
    for (const timeline of schema.timelines ?? []) {
      if (table !== `${timeline.name}Posts`) continue;
      for (const source of [timeline.posts[0], timeline.reposts[0]]) {
        const sync = schema.tables[source]?.sync;
        if (!sync || sync.horizon) tables.add(source);
      }
    }
  }
  return tables;
}

// @ref LLP 3000.023#11 — a current miss is not proof of permanent unavailability.
// Recognize only the compiler's unconditional, literal-key count lowering.
// Other branches, time/argument inputs, native code and coverage-dependent
// sources stay retryable. This inspects shape; the Rust engine still evaluates.
export function permanentlyUnavailableHeldCount(program: ProgramJson | undefined, schema: SchemaJson): boolean {
  const object = (value: unknown): Record<string, unknown> => value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
  const matches = (value: unknown, expected: unknown): boolean => {
    if (value === expected) return true;
    if (!value || !expected || typeof value !== "object" || typeof expected !== "object") return false;
    const a = Object.entries(value), b = Object.entries(expected);
    return a.length === b.length && b.every(([key, child]) => Object.hasOwn(value, key) && matches((value as Record<string, unknown>)[key], child));
  };
  if (!program || program.native || Object.keys(program.args).length || program.body.length !== 3) return false;
  const binding = object(object(program.body[0]).Let), get = object(object(binding.value).Get);
  const table = typeof get.table === "string" ? schema.tables[get.table] : undefined;
  if (!table || table.sync || !object(object(table).residency).online_only || object(table).through) return false;
  const maintain = schema.maintains?.map(object).find(m => m.target === get.table);
  const source = typeof maintain?.source === "string" ? schema.tables[maintain.source] : undefined;
  // Inherited/parent-key aggregates may authorize a known answer before the
  // unsynced-table check; membership or coverage can then change availability.
  if (!source || object(source).through || maintain?.kind !== "Count" || maintain.parent_key || maintain.own_keys) return false;
  if (!Array.isArray(get.key) || !get.key.length || !get.key.every(key => Object.keys(object(key)).length === 1 && Object.hasOwn(object(key), "Literal"))) return false;
  if (typeof binding.name !== "string" || typeof get.site !== "string" || typeof get.index !== "string") return false;
  const result = object(object(program.body[2]).Return).Variable;
  if (typeof result !== "string") return false;
  const variable = { Variable: binding.name };
  // @ref LLP 3000.015#3 — current count lowering separates the row and scalar slots.
  // Keep the exact prior serialized form eligible as well.
  const write = (value: unknown) => result === binding.name
    ? { Assign: { name: result, value } } : { Let: { name: result, value } };
  return matches(program.body, [
    { Let: { name: binding.name, value: { Get: { table: get.table, index: get.index, key: get.key, site: get.site, provenance: "Shape" } } } },
    { If: { condition: { Binary: { left: variable, op: "Eq", right: { Literal: "Null" } } },
      then_body: [write({ Literal: { Int: 0 } })],
      else_body: [write({ Field: { base: variable, name: "value" } })] } },
    { Return: { Variable: result } },
  ]);
}
