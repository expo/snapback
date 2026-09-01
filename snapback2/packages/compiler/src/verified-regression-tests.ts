import type { TableInfo } from "./compiler";
import { lowerSource } from "./compiler";
import { lowerSchema } from "./lower/schema";

type Register = (name: string, run: () => void | Promise<void>) => void;

export function registerVerifiedRegressionTests(
  test: Register,
  assert: (condition: unknown, message: string) => asserts condition,
): void {
  test("schema index width is refused before storage", () => {
    const columns = Array.from({ length: 9 }, (_, index) => `c${index}: t.int()`).join(", ");
    const names = (count: number) => Array.from({ length: count }, (_, index) => `'c${index}'`).join(", ");
    const source = `import { schema, table, t } from "snapback2";
      export const rows = table({ columns: { ${columns} }, indexes: {
        empty: { columns: [] }, supported: { columns: [${names(8)}] }, tooWide: { columns: [${names(9)}] },
      } }); export default schema({ tables: { rows } });`;
    const lowered = lowerSchema(source, "snapback/schema.ts");
    const messages = lowered.diagnostics.filter((item) => item.code === "E_SCHEMA_INDEX_COLUMN").map((item) => item.message);
    assert(messages.some((message) => message.includes("non-empty")), "empty index was admitted");
    assert(messages.some((message) => message.includes("at most 8")), "nine-column index was admitted");
    assert(!messages.some((message) => message.includes("supported")), "eight-column index was refused");
  });

  test("authored update patches cannot carry id", () => {
    const tables = new Map<string, TableInfo>([["items", {
      name: "items", private: false, columns: { id: { kind: "string" }, label: { kind: "string", max: 32 } },
    }]]);
    const source = `import { mutation } from "snapback2";
      export const bad = mutation({}, ({ db }) => db.update(items, "a", { id: "b", label: "new" }));`;
    const lowered = lowerSource(source, "identity.ts", undefined, { tables });
    assert(!lowered.ok && lowered.diagnostics.some((item) => item.code === "E_SCHEMA_ID_RESERVED"),
      "compiler admitted an id-changing update patch");
  });
}
