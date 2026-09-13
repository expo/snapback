import type { ProgramJson } from "./interpreter.ts";
import type { SchemaJson } from "./store.ts";

/** Include rule dependencies when deciding whether an operation is local. */
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
