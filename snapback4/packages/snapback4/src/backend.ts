// The backend as `GET /schema` sends it: the schema's shape and the
// programs the device runs. The client reads only what it needs to route
// a read (which tables an operation touches, which of them sync); the
// device interprets the programs.

export interface ProgramJson {
  name: string;
  kind: "Query" | "Mutation" | "job";
  args: Record<string, unknown>;
  body: unknown[];
}

export interface TableJson {
  columns: Record<string, unknown>;
  indexes: Record<string, { components: ({ Column: string } | { WordPrefixes: unknown })[]; unique: boolean }>;
  sync?: { audience: unknown; horizon?: { last: number; by: string } | null } | null;
  leave?: "until-revoked" | "delivered-history";
  /** The time column that ends a row's life; a row past it is absent here too. */
  expire?: string | null;
}

export interface SchemaJson {
  tables: Record<string, TableJson>;
  maintains?: unknown[];
}

export interface BackendJson {
  generation: number;
  schema: SchemaJson;
  programs: ProgramJson[];
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
  for (const table of tables) walk((schema.tables[table] as { rules?: unknown } | undefined)?.rules);
  return tables;
}
