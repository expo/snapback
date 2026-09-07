import { deepStrictEqual, equal, ok, throws } from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { columnComponents } from "./index-components";
import type { Document, RuleDecl, ScalarType, TableDecl } from "./quarry/ast";
import { bindQuarrySchema } from "./quarry/bound-schema";
import { buildCatalog } from "./quarry/catalog";
import { QuarryError } from "./quarry/diagnostics";
import { parseDocument } from "./quarry/parser";
import { rustCheck } from "./rust-check";

const frontend = resolve(decodeURIComponent(new URL(".", import.meta.url).pathname), "..");

export function runBoundSchemaChecks(): void {
  let checkerSchema: ReturnType<typeof bindQuarrySchema> | undefined;
  for (const fixture of ["quarry-chat", "quarry-surface", "quarry-assets"]) {
    const document = fixtureDocument(fixture);
    materializeMaintainsForOracle(document);
    const catalog = buildCatalog([document]);
    const direct = bindQuarrySchema([document], catalog);
    ok(Object.keys(direct.tables).length > 0, `${fixture}: direct schema lost its tables`);

    if (fixture === "quarry-chat") checkerSchema = direct;
  }

  const collision = parseDocument("snapback/schema.q", "table table:\n  public\n");
  deepStrictEqual(collision.diagnostics, []);
  const collisionCatalog = buildCatalog([collision.document]);
  ok(bindQuarrySchema([collision.document], collisionCatalog).tables.table,
    "declaration identity should allow a name that only collided with generated TypeScript bindings");

  const unsupported = fixtureDocument("quarry-assets");
  unsupported.tables[0]!.columns.push({
    name: "page",
    type: { kind: "cursor", optional: false },
    site: unsupported.tables[0]!.site,
  });
  const unsupportedCatalog = buildCatalog([unsupported]);
  throws(
    () => bindQuarrySchema([unsupported], unsupportedCatalog),
    (error) => error instanceof QuarryError && error.diagnostic.file === "snapback/schema.q",
    "unsupported stored cursor form should refuse at its authored declaration",
  );

  const probe = {
    name: "bound-schema.probe",
    kind: "Query" as const,
    args: {},
    read_time_granularity_ms: null,
    body: [{ Return: { Literal: "Null" as const } }],
  };
  const checked = rustCheck([probe], "synthetic", checkerSchema)[0];
  ok(checked && !checked.error && checked.certificate, `Rust checker refused direct schema: ${JSON.stringify(checked)}`);
  equal(checked.program, probe.name);
}

function fixtureDocument(name: string): Document {
  const source = readFileSync(resolve(frontend, "fixtures", name, "snapback", "schema.q"), "utf8");
  const parsed = parseDocument("snapback/schema.q", source);
  deepStrictEqual(parsed.diagnostics, [], `${name}: fixture parse failed`);
  return parsed.document;
}

/** Current prepareQuarry performs this before catalog construction; keep the parity oracle at that seam. */
function materializeMaintainsForOracle(schema: Document): void {
  for (const declaration of schema.maintains) {
    const source = schema.tables.find((table) => table.name === declaration.source);
    ok(source, `maintain ${declaration.name} names missing source ${declaration.source}`);
    const columns = declaration.by.map((name) => {
      const sourceColumn = source.columns.find((column) => column.name === name);
      ok(sourceColumn, `maintain ${declaration.name} names missing column ${name}`);
      return { name, type: structuredClone(sourceColumn.type), site: declaration.site };
    });
    const valueType = declaration.aggregate === "sum"
      ? source.columns.find((column) => column.name === declaration.column)?.type
      : { kind: "int", optional: false } satisfies ScalarType;
    ok(valueType, `maintain ${declaration.name} has no value type`);
    columns.push({ name: "value", type: structuredClone(valueType), site: declaration.site });
    const deny = (effect: RuleDecl["effect"]): RuleDecl => ({
      effect,
      bindings: ["r"],
      value: { kind: "name", name: "deny", site: declaration.site },
      site: declaration.site,
    });
    const indexName = `by${declaration.by.map((column) => title(
      column.endsWith("Id") && column.length > 2 ? column.slice(0, -2) : column,
    )).join("")}`;
    const target: TableDecl = {
      name: declaration.name,
      columns,
      indexes: containsAsset(columns.map((column) => column.type))
        ? []
        : [{ name: indexName, components: columnComponents(declaration.by), unique: true, site: declaration.site }],
      rules: [declaration.read, deny("insert"), deny("update"), deny("delete")],
      immutable: [],
      caps: [],
      finalExists: [],
      site: declaration.site,
    };
    schema.tables.push(target);
  }
}

function containsAsset(types: ScalarType[]): boolean {
  return types.some((type) => type.kind === "image" || type.kind === "video"
    || type.kind === "list" && containsAsset([type.item]));
}

function title(value: string): string {
  return value.length === 0 ? value : value[0]!.toUpperCase() + value.slice(1);
}

if (import.meta.main) {
  runBoundSchemaChecks();
  console.log("bound schema checks passed");
}
