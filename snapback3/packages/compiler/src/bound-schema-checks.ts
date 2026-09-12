import { deepStrictEqual, equal, ok, throws } from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { columnComponents } from "./index-components";
import { compileInline } from "./quarry-check-helpers";
import type { Document, RuleDecl, ScalarType, TableDecl } from "./quarry/ast";
import { bindQuarrySchema } from "./quarry/bound-schema";
import { buildCatalog } from "./quarry/catalog";
import { QuarryError } from "./quarry/diagnostics";
import { parseDocument } from "./quarry/parser";
import { rustCheck } from "./rust-check";

const frontend = resolve(decodeURIComponent(new URL(".", import.meta.url).pathname), "..");

function updateBinderSchema(rule: string, collisions = true): string {
  return `table rows:
  owner: principal
${collisions ? "  old: rows\n  next: rows\n  prior: rows\n  later: rows\n" : ""}  public
  ${rule}

table memberships:
  row: rows
  principal: principal
  unique byRowPrincipal: row, principal
  public
`;
}

export function runBareUpdateBinderChecks(): void {
  for (const bindings of [["old", "next"], ["prior", "later"]]) {
    for (const name of bindings) {
      for (const collisions of [false, true]) {
        for (const predicate of [
          `exists memberships[${name}, viewer]`,
          `exists memberships[${name}, viewer] by byRowPrincipal`,
          `exists memberships[row = ${name}, principal = viewer]`,
          `${name} = viewer`,
          `viewer != ${name}`,
          `not (${name} = null) or (${bindings[0]}.owner = viewer and viewer = ${name})`,
        ]) {
          const source = updateBinderSchema(`update (${bindings.join(", ")}) <- ${predicate}`, collisions);
          const result = compileInline([{ fileName: "snapback/schema.q", source }]);
          ok(!result.ok, `bare update binder compiled: ${predicate} (collisions: ${collisions})`);
          equal(result.diagnostics.length, 1, JSON.stringify(result.diagnostics));
          const diagnostic = result.diagnostics[0]!;
          const line = source.split("\n").findIndex(text => text.includes("update ("));
          const predicateStart = source.split("\n")[line]!.indexOf("<- ") + 3;
          equal(diagnostic.site, `snapback/schema.q:${line + 1}:${predicateStart + predicate.indexOf(name) + 1}`);
          equal(diagnostic.code, "E_QUARRY_UNKNOWN");
          ok(diagnostic.message.includes(`bare ${name} is the update row`), diagnostic.message);
          equal(diagnostic.rewrite, `-- write ${name}.id or ${name}.<column>`);
          equal(diagnostic.guide, "quarry/names");
        }
      }
    }
  }
}

export function runUpdateBinderCompatibilityChecks(): void {
  for (const [before, after] of [["old", "next"], ["prior", "later"], ["next", "old"]]) {
    const source = updateBinderSchema(`update (${before}, ${after}) <- (
    ${before}.owner = viewer and ${after}.owner = viewer
    and ${before}.id = ${after}.id and ${before}.old = ${after}.old
    and exists memberships[${before}.id, viewer]
    and exists memberships[${after}.next, viewer]
  )`);
    const result = compileInline([{ fileName: "snapback/schema.q", source }]);
    ok(result.ok, JSON.stringify(result));
    deepStrictEqual((result.project.schema.tables.rows!.rules as Record<string, unknown>).update, { And: [
      { Eq: [{ OldField: "owner" }, "Viewer"] },
      { Eq: [{ NextField: "owner" }, "Viewer"] },
      { Eq: [{ OldField: "id" }, { NextField: "id" }] },
      { Eq: [{ OldField: "old" }, { NextField: "old" }] },
      { Exists: { table: "memberships", index: "byRowPrincipal", key: [{ OldField: "id" }, "Viewer"], provenance: "Shape" } },
      { Exists: { table: "memberships", index: "byRowPrincipal", key: [{ NextField: "next" }, "Viewer"], provenance: "Shape" } },
    ] });
    assertSchemaCertifies(result.project.schema);
  }

  const source = updateBinderSchema("update <- .owner = viewer and .old = .next") + `
channel typing(room: rows, old: rows, next: rows):
  value: { typing: bool }
  publish <- exists memberships[room, viewer] and exists memberships[old, viewer]
  subscribe <- exists memberships[next, viewer]
  ttl 5s

channel presence(room: principal, old: principal, next: principal):
  value: { active: bool }
  publish <- room = viewer and old = viewer
  subscribe <- next = viewer
  ttl 5s
`;
  const result = compileInline([{ fileName: "snapback/schema.q", source }]);
  ok(result.ok, JSON.stringify(result));
  deepStrictEqual((result.project.schema.tables.rows!.rules as Record<string, unknown>).update, { And: [
    { Eq: [{ Field: "owner" }, "Viewer"] },
    { Eq: [{ Field: "old" }, { Field: "next" }] },
  ] });
  const channels = result.project.schema.channels as Record<string, { publish: unknown; subscribe: unknown }>;
  deepStrictEqual(channels.typing!.publish, { And: [
    { Exists: { table: "memberships", index: "byRowPrincipal", key: [{ Field: "room" }, "Viewer"], provenance: "Shape" } },
    { Exists: { table: "memberships", index: "byRowPrincipal", key: [{ Field: "old" }, "Viewer"], provenance: "Shape" } },
  ] });
  deepStrictEqual(channels.typing!.subscribe,
    { Exists: { table: "memberships", index: "byRowPrincipal", key: [{ Field: "next" }, "Viewer"], provenance: "Shape" } });
  deepStrictEqual(channels.presence!.publish, { And: [
    { Eq: [{ Field: "room" }, "Viewer"] }, { Eq: [{ Field: "old" }, "Viewer"] },
  ] });
  deepStrictEqual(channels.presence!.subscribe, { Eq: [{ Field: "next" }, "Viewer"] });
  assertSchemaCertifies(result.project.schema);
}

function assertSchemaCertifies(schema: ReturnType<typeof bindQuarrySchema>): void {
  const checked = rustCheck([{
    name: "rule-binders.probe", kind: "Query", args: {}, read_time_granularity_ms: null,
    body: [{ Return: { Literal: "Null" } }],
  }], "synthetic", schema);
  equal(checked.length, 1, JSON.stringify(checked));
  ok(!checked[0]!.error && checked[0]!.certificate, JSON.stringify(checked));
}

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
  runBareUpdateBinderChecks();
  runUpdateBinderCompatibilityChecks();
  console.log("bound schema checks passed");
}
