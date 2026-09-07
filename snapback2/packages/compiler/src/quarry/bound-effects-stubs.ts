import type { ScalarType, TableCatalog } from "./ast";
import type { BoundQuarryProgram, BoundType, BoundValueFacts } from "./bound";

export type BoundEffectDeclarationSources = {
  schema: { fileName: string; source: string };
  modules: Array<{ fileName: string; source: string }>;
};

/** Declaration-only modules let authored TypeScript effects check imports and
 * `then` signatures without recovering data semantics from generated code. */
export function boundEffectDeclarationSources(
  catalog: TableCatalog,
  programs: readonly BoundQuarryProgram[],
): BoundEffectDeclarationSources {
  const imports = "import type { Bytes, Cursor, Decimal, ImageAsset, Json, Money, Operation, Page, Principal, Table, VideoAsset } from 'snapback2';";
  const tables = [...catalog.values()].filter((item) => item.declaration.name !== "connected")
    .filter((item) => tsBinding(item.declaration.name))
    .sort((left, right) => left.declaration.name.localeCompare(right.declaration.name));
  const rowNames = new Map(tables.map((table) => [table.declaration.name, `${pascal(table.declaration.name)}Row`]));
  const rowTypes = tables.map(({ declaration }) => {
    const fields = ["readonly id: string", ...declaration.columns.map((column) => {
      const optional = column.type.optional;
      return `readonly ${property(column.name)}${optional ? "?" : ""}: ${scalarType({ ...column.type, optional: false }, rowNames)}${optional ? " | null" : ""}`;
    })];
    return `export type ${rowNames.get(declaration.name)} = { ${fields.join("; ")} };`;
  });
  const tableDeclarations = tables.map(({ declaration }) =>
    `export declare const ${declaration.name}: Table<${rowNames.get(declaration.name)}>;`);
  const schema = `${imports}\n${rowTypes.join("\n")}\n${tableDeclarations.join("\n")}\n`;
  const rowImports = [...rowNames.values()].join(", ");

  const grouped = new Map<string, BoundQuarryProgram[]>();
  for (const program of programs.filter((item) => {
    const name = item.name.split(".").at(-1)!;
    return tsBinding(name) && !name.startsWith("_timerBinding_");
  })) {
    const moduleName = program.name.split(".")[0]!;
    grouped.set(moduleName, [...(grouped.get(moduleName) ?? []), program]);
  }
  const modules = [...grouped].sort(([left], [right]) => left.localeCompare(right)).map(([moduleName, members]) => ({
    fileName: `snapback/${moduleName}.ts`,
    source: `${imports}\n${rowImports ? `import type { ${rowImports} } from './schema';\n` : ""}${members.sort((left, right) => left.name.localeCompare(right.name)).map((program) => {
      const args = program.args.length === 0 ? "{}" : `{ ${program.args.map((argument) =>
        `${property(argument.name)}${argument.type.optional ? "?" : ""}: ${scalarType({ ...argument.type, optional: false }, rowNames)}`).join("; ")} }`;
      const result = valueFacts(program.result, rowNames);
      return `export declare const ${program.name.split(".").at(-1)!}: Operation<${args}, ${result}, ${JSON.stringify(program.kind === "query" ? "query" : "mutation")}>;`;
    }).join("\n")}\n`,
  }));
  return { schema: { fileName: "snapback/schema.ts", source: schema }, modules };
}

function valueFacts(facts: BoundValueFacts, rows: Map<string, string>): string {
  const rendered = boundType(facts.type, rows);
  return facts.presence === "optional" && !/(?:^|\s\|\s)null$/.test(rendered) ? `${rendered} | null` : rendered;
}

function boundType(type: BoundType, rows: Map<string, string>): string {
  if (type.kind === "unknown" || type.kind === "numeric-literal") return "unknown";
  if (type.kind === "null") return "null";
  if (type.kind === "row") return `${rows.get(type.table.name) ?? "Record<string, Json>"}${type.nullable ? " | null" : ""}`;
  if (type.kind === "page") return `Page<${type.item ? valueFacts(type.item, rows) : rows.get(type.table.name) ?? "Record<string, Json>"}>`;
  if (type.kind === "collection") return `Array<${valueFacts(type.item, rows)}>`;
  if (type.kind === "object") {
    const fields = [...type.fields].map(([name, field]) => {
      const inheritedOptional = field.fieldProjection === "inherited-row" && field.presence === "optional";
      return `${property(name)}${inheritedOptional ? "?" : ""}: ${valueFacts({
        ...field, presence: field.presence,
      }, rows)}`;
    });
    return `{ ${fields.join("; ")} }${type.nullable ? " | null" : ""}`;
  }
  return scalarType(type, rows);
}

function scalarType(type: ScalarType, rows: Map<string, string>): string {
  if (type.kind === "cursor") return "Cursor";
  if (type.kind === "principal") return "Principal";
  if (type.kind === "id" || type.kind === "ref" || type.kind === "text" || type.kind === "enum") return "string";
  if (type.kind === "bool") return "boolean";
  if (type.kind === "int" || type.kind === "time") return "number";
  if (type.kind === "decimal") return `Decimal<${type.scale}>`;
  if (type.kind === "money") return `Money<${JSON.stringify(type.currency)}, ${type.scale}>`;
  if (type.kind === "json") return "Json";
  if (type.kind === "bytes") return "Bytes";
  if (type.kind === "image") return "ImageAsset";
  if (type.kind === "video") return "VideoAsset";
  return `Array<${scalarType({ ...type.item, optional: false }, rows)}>`;
}

function pascal(value: string): string {
  return value.split(/[^A-Za-z0-9]+/).filter(Boolean).map((part) => part[0]!.toUpperCase() + part.slice(1)).join("") || "Table";
}

function property(value: string): string {
  return /^[A-Za-z_$][A-Za-z0-9_$]*$/.test(value) ? value : JSON.stringify(value);
}

const TS_BINDING_KEYWORDS = new Set([
  "arguments", "await", "break", "case", "catch", "class", "const", "continue", "debugger", "default", "delete", "do",
  "else", "enum", "eval", "export", "extends", "false", "finally", "for", "function", "if", "implements", "import",
  "in", "instanceof", "interface", "let", "new", "null", "package", "private", "protected", "public", "return", "static",
  "super", "switch", "this", "throw", "true", "try", "typeof", "var", "void", "while", "with", "yield",
]);

function tsBinding(value: string): boolean {
  return /^[A-Za-z_$][A-Za-z0-9_$]*$/.test(value) && !TS_BINDING_KEYWORDS.has(value);
}
