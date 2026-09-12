import { basename } from "node:path";
import type { Document, ScalarType, TableCatalog } from "./ast";
import type { BoundExpression, BoundQuarryProgram, BoundStatement, BoundType, BoundValueFacts } from "./bound";

type PrintedType = { text: string; precedence: 1 | 2 | 3 };
export type BoundDeclarationMode = "result" | "effect-stub";

// @ref LLP 1002#3-the-compiler-worker-and-the-project-json — Public declarations come from the same bound facts as executable Quarry IR.
export function generateBoundApiDts(
  programs: readonly BoundQuarryProgram[],
  documents: readonly Document[],
  catalog: TableCatalog,
): string {
  const rowAliases = boundApiRowAliases(catalog);
  const scheduled = scheduledTargets(programs, documents);
  const callable = programs
    .filter((program) => (program.kind === "query" || program.kind === "mutation") && !scheduled.has(program.name))
    .sort((left, right) => compare(left.name, right.name));
  const grouped = new Map<string, BoundQuarryProgram[]>();
  for (const program of callable) {
    const [module] = operationParts(program.name);
    const members = grouped.get(module) ?? [];
    members.push(program);
    grouped.set(module, members);
  }

  const rows = [...catalog.values()]
    .map((entry) => entry.declaration)
    .sort((left, right) => compare(left.name, right.name))
    .map((table) => {
      const fields = table.columns.map((column) => {
        const optional = column.type.optional;
        const type = printScalar(column.type, "result", false);
        return `  ${quoteProperty(column.name)}${optional ? "?" : ""}: ${optional ? union(type, primary("null")).text : type.text};`;
      });
      if (!table.columns.some((column) => column.name === "id")) fields.unshift("  id: string;");
      return `type ${rowAliases.get(table.name)!} = {\n${fields.join("\n")}\n};`;
    })
    .join("\n");

  // @ref LLP 1001.000#declaration-and-value — the shared value type accepts ordinary argument optionals and numeric minor units.
  const channelDeclarations = documents.flatMap((document) => document.channels)
    .sort((left, right) => compare(left.name, right.name));
  const channelByName = new Map(channelDeclarations.map((channel) => [channel.name, channel]));
  const ordinaryModules = [...grouped]
    .sort(([left], [right]) => compare(left, right))
    .filter(([module]) => module !== "channels" || channelDeclarations.length === 0)
    .map(([module, members]) => `    readonly ${quoteProperty(module)}: {\n${members.map((program) =>
      `      readonly ${quoteProperty(operationParts(program.name)[1])}: ${operationType(program, rowAliases)};`).join("\n")}\n    };`)
    .join("\n");

  let channels = "";
  if (channelDeclarations.length > 0) {
    const channelPrograms = grouped.get("channels") ?? [];
    const channelProgramNames = new Set(channelPrograms.map((program) => operationParts(program.name)[1]));
    const items = channelPrograms.map((program) => {
      const name = operationParts(program.name)[1];
      const channel = channelByName.get(name);
      const intersection = channel ? ` & Channel<${printArgs(channel.args, false)}, ${printArgs(channel.value, false)}>` : "";
      return `      readonly ${quoteProperty(name)}: ${operationType(program, rowAliases)}${intersection};`;
    });
    for (const channel of channelDeclarations) {
      if (!channelProgramNames.has(channel.name)) {
        items.push(`      readonly ${quoteProperty(channel.name)}: Channel<${printArgs(channel.args, false)}, ${printArgs(channel.value, false)}>;`);
      }
    }
    const catalogText = items.length === 0
      ? "    readonly channels: {};"
      : `    readonly channels: {\n${items.join("\n")}\n    };`;
    const occupied = new Set([...grouped.keys(), "channels", "op", "then", "toJSON"]);
    const aliases = channelDeclarations
      .filter((channel) => !occupied.has(channel.name))
      .map((channel) => `    readonly ${quoteProperty(channel.name)}: Channel<${printArgs(channel.args, false)}, ${printArgs(channel.value, false)}>;`);
    channels = [catalogText, ...aliases].join("\n");
  }

  const members = [ordinaryModules, channels].filter(Boolean).join("\n");
  return `import type { Bytes, Cursor, Decimal, ImageAsset, Json, Money, Page, Principal, VideoAsset } from 'snapback2';\nimport type { Channel, Op } from 'snapback2/client';\n\n${rows}\n\ndeclare module 'snapback2/client' {\n  interface Api {\n${members}\n  }\n}\n\nexport {};\n`;
}

export function boundApiRowName(table: string): string {
  const pascal = table.split(/[^A-Za-z0-9]+/).filter(Boolean)
    .map((part) => part[0]!.toUpperCase() + part.slice(1))
    .join("");
  return `${pascal || "Table"}Row`;
}

/** Stable aliases remain familiar until a legal table-name collision needs an injective suffix. */
export function boundApiRowAliases(catalog: TableCatalog): ReadonlyMap<string, string> {
  const byBase = new Map<string, string[]>();
  for (const name of catalog.keys()) byBase.set(boundApiRowName(name), [...(byBase.get(boundApiRowName(name)) ?? []), name]);
  return new Map([...byBase].flatMap(([base, names]) => names.sort(compare).map((name): [string, string] => [
    name, names.length === 1 ? base : `${base}_u${[...name].map((character) =>
      character.codePointAt(0)!.toString(16).padStart(6, "0")).join("")}`,
  ])));
}

export function renderBoundValueType(
  facts: BoundValueFacts,
  catalog: TableCatalog,
  _options: { mode: BoundDeclarationMode },
): string {
  return printFacts(facts, boundApiRowAliases(catalog)).text;
}

export function renderBoundArgumentType(
  type: ScalarType,
  _catalog: TableCatalog,
  options: { mutation: boolean; optionalValueNull: boolean },
): string {
  const value = printScalar({ ...type, optional: options.optionalValueNull && type.optional } as ScalarType,
    "argument", options.mutation);
  return value.text;
}

function operationType(program: BoundQuarryProgram, rows: ReadonlyMap<string, string>): string {
  return `Op<${printArgs(program.args, program.kind === "mutation")}, ${printFacts(program.result, rows).text}${targetTypes(program)}>`;
}

// Runtime correspondence comes from Rust certification of the lowered IR;
// these bound facts only type which table/action choices an app may request.
function targetTypes(program: BoundQuarryProgram): string {
  if (program.kind !== "mutation") return "";
  const tables = new Map<string, Set<string>>();
  const absorbed = postCreateUpdates(program.body);
  const walk = (value: unknown): void => {
    if (!value || typeof value !== "object") return;
    if (Array.isArray(value)) { value.forEach(walk); return; }
    const node = value as Record<string, any>;
    if (node.kind === "write") {
      const kinds = tables.get(node.table.name) ?? new Set<string>();
      for (const kind of node.op === "upsert" ? ["create", "update"]
        : [node.op === "insert" ? "create" : node.op === "delete" ? "remove" : "update"])
        if (!absorbed.has(node as BoundExpression)) kinds.add(kind);
      tables.set(node.table.name, kinds);
    }
    for (const [key, child] of Object.entries(node)) {
      if (!["facts", "source", "symbol", "symbols", "table", "index", "focal"].includes(key)) walk(child);
    }
  };
  walk(program.body);
  return tables.size ? `, { ${[...tables].sort(([a], [b]) => compare(a, b)).map(([table, kinds]) =>
    `${quoteProperty(table)}: ${[...kinds].sort().map(kind => JSON.stringify(kind)).join(" | ")}`).join("; ")} }` : "";
}

// @ref LLP 1018.003.001#3-semantic-mutation-targets — generated choices use
// the same narrow semantic action as certification: updating the exact row
// returned by an earlier unconditional insert refines its create presentation.
function postCreateUpdates(statements: readonly BoundStatement[]): ReadonlySet<BoundExpression> {
  const created = new Map<string, string>();
  const absorbed = new Set<BoundExpression>();
  const root = (statement: BoundStatement): BoundExpression | undefined =>
    statement.kind === "bind" || statement.kind === "expr" || statement.kind === "return"
      ? statement.value : undefined;
  const createdTable = (expression: BoundExpression): string | undefined => {
    if (expression.kind === "variable" && expression.symbol.kind === "local") return created.get(expression.symbol.id);
    return expression.kind === "member" && expression.name === "id" ? createdTable(expression.base) : undefined;
  };
  for (const statement of statements) {
    const value = root(statement);
    if (value?.kind === "write" && value.op === "update" && value.index?.name === "byId"
      && value.key.length === 1 && createdTable(value.key[0]!) === value.table.name) absorbed.add(value);
    if (statement.kind === "bind" && statement.symbols.length === 1 && value?.kind === "write"
      && value.op === "insert" && !value.ifAbsent) created.set(statement.symbols[0]!.id, value.table.name);
  }
  return absorbed;
}

function printArgs(args: readonly { name: string; type: ScalarType }[], mutation: boolean): string {
  if (args.length === 0) return "{}";
  return `{ ${args.map((arg) => {
    const type = printScalar(arg.type, "argument", mutation);
    const brand = argumentBrand(arg.type);
    return `${brand ? `/** ${brand} — minor units */ ` : ""}${quoteProperty(arg.name)}${arg.type.optional ? "?" : ""}: ${type.text}`;
  }).join("; ")} }`;
}

function printFacts(facts: BoundValueFacts, rows: ReadonlyMap<string, string>): PrintedType {
  const type = facts.type;
  let value: PrintedType;
  if (type.kind === "unknown") value = primary("unknown");
  else if (type.kind === "null") value = primary("null");
  else if (type.kind === "numeric-literal") value = primary("number");
  else if (isScalar(type)) value = printScalar(type, "result", false);
  else if (type.kind === "row") value = primary(rows.get(type.table.name) ?? "Record<string, Json>");
  else if (type.kind === "page") {
    const row = rows.get(type.table.name) ?? "Record<string, Json>";
    if (!type.item) value = primary(`Page<${row}>`);
    else {
      const item = printFacts(type.item, rows);
      value = item.text === row ? primary(`Page<${item.text}>`) : array(item);
    }
  } else if (type.kind === "collection") value = array(printFacts(type.item, rows));
  else if (type.kind === "empty-list") value = array(primary("never"));
  else value = printObject(facts, type, rows);
  return type.kind !== "null" && facts.presence === "optional" ? union(value, primary("null")) : value;
}

function printObject(
  facts: BoundValueFacts,
  type: Extract<BoundType, { kind: "object" }>,
  rows: ReadonlyMap<string, string>,
): PrintedType {
  const table = facts.tableOrigin?.declaration;
  const baseNames = table ? ["id", ...table.columns.map((column) => column.name)] : [];
  const inherits = Boolean(table && baseNames.every((name) => type.fields.has(name)));
  let body: PrintedType;
  if (!inherits || !table) {
    body = object([...type.fields].map(([name, field]) => printField(name, field, rows, table)));
  } else {
    const changed = baseNames.filter((name) => !sameInheritedField(name, type.fields.get(name)!, table));
    const extras = [...type.fields].filter(([name]) => !baseNames.includes(name) || changed.includes(name));
    const rowName = rows.get(table.name) ?? "Record<string, Json>";
    const base = changed.length === 0
      ? primary(rowName)
      : primary(`Omit<${rowName}, ${changed.map((name) => JSON.stringify(name)).join(" | ")}>`);
    body = extras.length === 0 ? base : intersection(base, object(extras.map(([name, field]) => printField(name, field, rows, table))));
  }
  return body;
}

function sameInheritedField(
  name: string,
  actual: BoundValueFacts,
  table: { name: string; columns: Array<{ name: string; type: ScalarType }> },
): boolean {
  const expected = name === "id"
    ? ({ kind: "ref", table: table.name, optional: false } satisfies ScalarType)
    : table.columns.find((column) => column.name === name)?.type;
  if (!expected || !isScalar(actual.type) || actual.fieldProjection !== "inherited-row") return false;
  const actualType = printScalar(actual.type, "result", false).text;
  const expectedType = printScalar(expected, "result", false).text;
  return actualType === expectedType && actual.type.optional === expected.optional;
}

function printField(
  name: string,
  facts: BoundValueFacts,
  rows: ReadonlyMap<string, string>,
  table?: { columns: Array<{ name: string; type: ScalarType }> },
): string {
  const optional = inheritedOptionalField(name, facts, table);
  const type = optional
    ? union(union(printScalar({ ...facts.type, optional: false } as ScalarType, "result", false), primary("null")), primary("undefined"))
    : printFacts(facts, rows);
  return `${quoteProperty(name)}${optional ? "?" : ""}: ${type.text}`;
}

function inheritedOptionalField(
  name: string,
  facts: BoundValueFacts,
  table?: { columns: Array<{ name: string; type: ScalarType }> },
): facts is BoundValueFacts & { type: ScalarType } {
  if (facts.fieldProjection !== "inherited-row" || !isScalar(facts.type) || !facts.type.optional) return false;
  const column = table?.columns.find((candidate) => candidate.name === name);
  return column?.type.optional === true;
}

function printScalar(type: ScalarType, site: "argument" | "result", mutation: boolean): PrintedType {
  let value: PrintedType;
  if (type.kind === "cursor") value = primary("Cursor");
  else if (type.kind === "text" || type.kind === "id" || type.kind === "ref") value = primary("string");
  else if (type.kind === "principal") value = primary("Principal");
  else if (type.kind === "int" || type.kind === "time") value = primary("number");
  else if (type.kind === "decimal") value = primary(site === "argument" ? "number" : `Decimal<${type.scale}>`);
  else if (type.kind === "money") value = primary(site === "argument" ? "number" : `Money<${JSON.stringify(type.currency)}, ${type.scale}>`);
  else if (type.kind === "bool") value = primary("boolean");
  else if (type.kind === "json") value = primary("Json");
  else if (type.kind === "bytes") value = primary("Bytes");
  else if (type.kind === "image" || type.kind === "video") {
    const asset = primary(type.kind === "image" ? "ImageAsset" : "VideoAsset");
    value = site === "argument" && mutation ? union(primary("File"), asset) : asset;
  } else if (type.kind === "enum") {
    value = type.variants.length === 0
      ? primary("never")
      : type.variants.map((variant) => primary(JSON.stringify(variant))).reduce(union);
  } else {
    value = array(printScalar({ ...type.item, optional: false } as ScalarType, site, mutation));
  }
  if (site !== "argument" || !type.optional) return value;
  return union(value, primary("null"));
}

function argumentBrand(type: ScalarType): string | undefined {
  if (type.kind === "decimal") return `decimal ${type.scale}`;
  if (type.kind === "money") return `money ${type.currency} ${type.scale}`;
  return undefined;
}

function scheduledTargets(programs: readonly BoundQuarryProgram[], documents: readonly Document[]): Set<string> {
  const targets = new Set<string>();
  for (const document of documents) {
    const module = basename(document.file, ".q");
    for (const schedule of document.schedules) {
      let matches = programs.filter((program) => program.name === schedule.target || program.name === `${module}.${schedule.target}`);
      if (matches.length === 0) matches = programs.filter((program) => operationParts(program.name)[1] === schedule.target);
      if (matches.length === 1) targets.add(matches[0]!.name);
    }
  }
  return targets;
}

function operationParts(name: string): [module: string, member: string] {
  const separator = name.lastIndexOf(".");
  return separator < 0 ? [name, name] : [name.slice(0, separator), name.slice(separator + 1)];
}

function isScalar(type: BoundType): type is ScalarType {
  return !["unknown", "null", "row", "page", "collection", "empty-list", "object", "numeric-literal"].includes(type.kind);
}

function primary(text: string): PrintedType { return { text, precedence: 3 }; }
function object(fields: string[]): PrintedType { return primary(`{ ${fields.join("; ")} }`); }
function union(left: PrintedType, right: PrintedType): PrintedType {
  if (left.text === right.text) return left;
  return { text: `${left.text} | ${right.text}`, precedence: 1 };
}
function intersection(left: PrintedType, right: PrintedType): PrintedType {
  return { text: `${left.text} & ${right.text}`, precedence: 2 };
}
function array(item: PrintedType): PrintedType {
  return primary(`${item.precedence < 3 ? `(${item.text})` : item.text}[]`);
}
function quoteProperty(value: string): string {
  return /^[A-Za-z_$][\w$]*$/.test(value) ? value : JSON.stringify(value);
}
function compare(left: string, right: string): number { return left < right ? -1 : left > right ? 1 : 0; }
