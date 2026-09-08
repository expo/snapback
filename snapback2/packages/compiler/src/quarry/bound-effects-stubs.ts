import type { TableCatalog } from "./ast";
import { boundApiRowAliases, renderBoundArgumentType, renderBoundValueType } from "./bound-api";
import type { BoundQuarryProgram, BoundValueFacts } from "./bound";

export type BoundEffectDeclarationSources = {
  schema: { fileName: string; source: string };
  modules: Array<{ fileName: string; source: string }>;
};

/** Declaration-only modules let authored TypeScript effects check imports and
 * `then` signatures without recovering data semantics from generated code.
 * The caller supplies all bound operations. Jobs and timer bindings have no
 * callable declaration; a scheduled mutation target remains a valid server
 * `then` target even though it is absent from the client API. */
export function boundEffectDeclarationSources(
  catalog: TableCatalog,
  programs: readonly BoundQuarryProgram[],
): BoundEffectDeclarationSources {
  const imports = "import type { Bytes, Cursor, Decimal, ImageAsset, Json, Money, Operation, Page, Principal, Table, VideoAsset } from 'snapback2';";
  const tables = [...catalog.values()].sort((left, right) => left.declaration.name.localeCompare(right.declaration.name));
  const rowNames = boundApiRowAliases(catalog);
  const rowTypes = tables.map(({ declaration }) => {
    const fields = ["readonly id: string", ...declaration.columns.map((column) => {
      const facts: BoundValueFacts = {
        type: column.type, presence: column.type.optional ? "optional" : "required",
        origin: "Shape", fieldProjection: "inherited-row",
      };
      return `readonly ${property(column.name)}${column.type.optional ? "?" : ""}: ${renderBoundValueType(
        facts, catalog, { mode: "effect-stub" })}`;
    })];
    return `export type ${rowNames.get(declaration.name)} = { ${fields.join("; ")} };`;
  });
  const tableDeclarations = tables.filter(({ declaration }) => declaration.name !== "connected")
    .map(({ declaration }, index) => exportedBinding(
      `__quarry_table_${index}`, declaration.name, `Table<${rowNames.get(declaration.name)}>`));
  const schema = `${imports}\n${rowTypes.join("\n")}\n${tableDeclarations.join("\n")}\n`;
  const rowImports = [...rowNames.values()].join(", ");

  const grouped = new Map<string, BoundQuarryProgram[]>();
  for (const program of programs.filter((item) => (item.kind === "query" || item.kind === "mutation")
    && !item.name.split(".").at(-1)!.startsWith("_timerBinding_"))) {
    const moduleName = program.name.split(".")[0]!;
    grouped.set(moduleName, [...(grouped.get(moduleName) ?? []), program]);
  }
  const modules = [...grouped].sort(([left], [right]) => left.localeCompare(right)).map(([moduleName, members]) => ({
    fileName: `snapback/${moduleName}.ts`,
    source: `${imports}\n${rowImports ? `import type { ${rowImports} } from './schema';\n` : ""}${members
      .sort((left, right) => left.name.localeCompare(right.name)).map((program, index) => {
        const args = program.args.length === 0 ? "{}" : `{ ${program.args.map((argument) =>
          `${property(argument.name)}${argument.type.optional ? "?" : ""}: ${renderBoundArgumentType(
            // Effect `then` calls run on the server and cannot supply a browser File.
            argument.type, catalog, { mutation: false, optionalValueNull: true })}`)
          .join("; ")} }`;
        const result = renderBoundValueType(program.result, catalog, { mode: "effect-stub" });
        return exportedBinding(`__quarry_operation_${index}`, program.name.split(".").at(-1)!,
          `Operation<${args}, ${result}, ${JSON.stringify(program.kind)}>`);
      }).join("\n")}\n`,
  }));
  return { schema: { fileName: "snapback/schema.ts", source: schema }, modules };
}

function exportedBinding(localName: string, exportName: string, type: string): string {
  return `declare const ${localName}: ${type};\nexport { ${localName} as ${exportName} };`;
}

function property(value: string): string {
  return /^[A-Za-z_$][A-Za-z0-9_$]*$/.test(value) ? value : JSON.stringify(value);
}
