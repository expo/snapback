import { basename } from "node:path";
import type { Expr, Program, Stmt } from "../ir";
import type { Document, ScalarType, TableCatalog } from "./ast";
import type { BoundQuarryProgram, BoundType, BoundValueFacts } from "./bound";
import { lowerBoundQuarryProgram } from "./direct";

type PrintedType = { text: string; precedence: 1 | 2 | 3 };
export type BoundDeclarationMode = "result" | "effect-stub";

// @ref LLP 1002#3-the-compiler-worker-and-the-project-json — Public declarations come from the same bound facts as executable Quarry IR.
export function generateBoundApiDts(
  programs: readonly BoundQuarryProgram[],
  documents: readonly Document[],
  catalog: TableCatalog,
  loweredPrograms: readonly Program[] = [],
): string {
  const rowAliases = boundApiRowAliases(catalog);
  const lowered = new Map(loweredPrograms.map((program) => [program.name, program]));
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
      `      readonly ${quoteProperty(operationParts(program.name)[1])}: ${operationType(program, rowAliases, lowered.get(program.name))};`).join("\n")}\n    };`)
    .join("\n");

  let channels = "";
  if (channelDeclarations.length > 0) {
    const channelPrograms = grouped.get("channels") ?? [];
    const channelProgramNames = new Set(channelPrograms.map((program) => operationParts(program.name)[1]));
    const items = channelPrograms.map((program) => {
      const name = operationParts(program.name)[1];
      const channel = channelByName.get(name);
      const intersection = channel ? ` & Channel<${printArgs(channel.args, false)}, ${printArgs(channel.value, false)}>` : "";
      return `      readonly ${quoteProperty(name)}: ${operationType(program, rowAliases, lowered.get(program.name))}${intersection};`;
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

function operationType(program: BoundQuarryProgram, rows: ReadonlyMap<string, string>, lowered?: Program): string {
  return `Op<${printArgs(program.args, program.kind === "mutation")}, ${printFacts(program.result, rows).text}${targetTypes(program, lowered)}>`;
}

// Runtime correspondence comes from Rust certification of the lowered IR;
// these bound facts only type which table/action choices an app may request.
function targetTypes(program: BoundQuarryProgram, lowered?: Program): string {
  if (program.kind !== "mutation") return "";
  const tables = mutationTargetKinds(lowered ?? lowerBoundQuarryProgram(program));
  return tables.size ? `, { ${[...tables].sort(([a], [b]) => compare(a, b)).map(([table, kinds]) =>
    `${quoteProperty(table)}: ${[...kinds].sort().map(kind => JSON.stringify(kind)).join(" | ")}`).join("; ")} }` : "";
}

type TargetKind = "create" | "update" | "remove";
type TargetFact = { kind: "unknown" } | { kind: "id"; source: string }
  | { kind: "object"; fields: ReadonlyMap<string, TargetFact> };
const unknownTarget: TargetFact = { kind: "unknown" };

// @ref LLP 1018.003.001#3-semantic-mutation-targets — declarations analyze
// the same lowered statement order, aliases, allocation, and escaping control
// flow as Rust certification. Uncertainty may add a kind; it never removes one.
function mutationTargetKinds(program: Program): ReadonlyMap<string, ReadonlySet<TargetKind>> {
  const analysis = new TargetTypeAnalysis();
  for (const [name, type] of Object.entries(program.args)) {
    if (type === "Id" || typeof type === "object" && "Ref" in type) {
      analysis.env.set(name, { kind: "id", source: `arg:${name}` });
    }
  }
  analysis.statements(program.body, false);
  return analysis.targets;
}

class TargetTypeAnalysis {
  readonly env = new Map<string, TargetFact>();
  readonly created = new Set<string>();
  readonly targets = new Map<string, Set<TargetKind>>();
  next: number | undefined = 0;

  private add(table: string, kind: TargetKind): void {
    const kinds = this.targets.get(table) ?? new Set<TargetKind>();
    kinds.add(kind);
    this.targets.set(table, kinds);
  }
  private createdKey(table: string, fact: TargetFact): string | undefined {
    return fact.kind === "id" ? `${table}\0${fact.source}` : undefined;
  }
  private fork(): TargetTypeAnalysis {
    const fork = new TargetTypeAnalysis();
    for (const [name, fact] of this.env) fork.env.set(name, fact);
    for (const key of this.created) fork.created.add(key);
    fork.next = this.next;
    return fork;
  }
  private merge(other: TargetTypeAnalysis): void {
    for (const [table, kinds] of other.targets) for (const kind of kinds) this.add(table, kind);
  }
  private allocate(): TargetFact {
    const source = this.next;
    this.next = source === undefined ? undefined : source + 1;
    return source === undefined ? unknownTarget : { kind: "id", source: `new:${source}` };
  }
  private expression(expression: Expr): TargetFact {
    if ("Input" in expression) return expression.Input === "NewId" ? this.allocate() : unknownTarget;
    if ("Variable" in expression) return this.env.get(expression.Variable) ?? unknownTarget;
    if ("Object" in expression) return { kind: "object", fields: new Map(Object.entries(expression.Object)
      .map(([name, value]) => [name, this.expression(value)])) };
    if ("Field" in expression) {
      const base = this.expression(expression.Field.base);
      return base.kind === "object" ? base.fields.get(expression.Field.name) ?? unknownTarget : unknownTarget;
    }
    if ("Get" in expression) {
      const keys = expression.Get.key.map((key) => this.expression(key));
      return expression.Get.index === "byId" && keys.length === 1
        ? { kind: "object", fields: new Map([["id", keys[0]!]]) } : unknownTarget;
    }
    if ("Exists" in expression) { expression.Exists.key.forEach((key) => this.expression(key)); return unknownTarget; }
    if ("Array" in expression) { expression.Array.forEach((value) => this.expression(value)); return unknownTarget; }
    if ("Builtin" in expression) { expression.Builtin.args.forEach((value) => this.expression(value)); return unknownTarget; }
    if ("Unary" in expression) { this.expression(expression.Unary.value); return unknownTarget; }
    if ("Binary" in expression) {
      this.expression(expression.Binary.left);
      if (["And", "Or"].includes(expression.Binary.op) && allocatesTarget(expression.Binary.right)) this.next = undefined;
      this.expression(expression.Binary.right);
      return unknownTarget;
    }
    if ("Scan" in expression || "Merge" in expression) {
      this.opaque(expression);
      if ("Merge" in expression) this.env.clear();
    }
    return unknownTarget;
  }
  private opaque(value: unknown): void {
    if (!value || typeof value !== "object") return;
    if (Array.isArray(value)) { value.forEach((child) => this.opaque(child)); return; }
    const node = value as Record<string, unknown>;
    if (node.Input === "NewId" || "Emit" in node) this.next = undefined;
    for (const [name, kind] of [["Insert", "create"], ["Update", "update"], ["Delete", "remove"]] as const) {
      const write = node[name];
      if (write && typeof write === "object" && typeof (write as { table?: unknown }).table === "string") {
        this.add((write as { table: string }).table, kind);
      }
    }
    const upsert = node.Upsert;
    if (upsert && typeof upsert === "object" && typeof (upsert as { table?: unknown }).table === "string") {
      this.add((upsert as { table: string }).table, "create");
      this.add((upsert as { table: string }).table, "update");
    }
    Object.values(node).forEach((child) => this.opaque(child));
  }
  statements(statements: readonly Stmt[], guarded: boolean): void {
    let guard = guarded;
    for (const statement of statements) {
      if (typeof statement === "string") break;
      if ("Const" in statement || "Let" in statement || "Assign" in statement) {
        const binding = "Const" in statement ? statement.Const : "Let" in statement ? statement.Let : statement.Assign;
        this.env.set(binding.name, this.expression(binding.value));
      } else if ("Push" in statement) {
        this.expression(statement.Push.value); this.env.set(statement.Push.target, unknownTarget);
      } else if ("Check" in statement) {
        this.expression(statement.Check.condition); this.expression({ Get: statement.Check.current });
      } else if ("Require" in statement) this.expression(statement.Require.condition);
      else if ("Return" in statement) { this.expression(statement.Return); break; }
      else if ("InsertIfAbsent" in statement) {
        this.expression(statement.InsertIfAbsent.row); this.add(statement.InsertIfAbsent.table, "create");
        this.env.set(statement.InsertIfAbsent.result, unknownTarget);
      } else if ("Insert" in statement) {
        const row = this.expression(statement.Insert.row);
        const id = row.kind === "object" ? row.fields.get("id") ?? unknownTarget : unknownTarget;
        this.add(statement.Insert.table, "create");
        const key = !guard && this.createdKey(statement.Insert.table, id);
        if (key) this.created.add(key);
      } else if ("Update" in statement) {
        const key = this.expression(statement.Update.key);
        this.expression(statement.Update.patch);
        const created = !guard && this.createdKey(statement.Update.table, key);
        if (!created || !this.created.has(created)) this.add(statement.Update.table, "update");
      } else if ("Delete" in statement) {
        this.expression(statement.Delete.key); this.add(statement.Delete.table, "remove");
      } else if ("Upsert" in statement) {
        this.expression(statement.Upsert.key); this.expression(statement.Upsert.row);
        this.add(statement.Upsert.table, "create"); this.add(statement.Upsert.table, "update");
      } else if ("Emit" in statement) {
        this.expression(statement.Emit.payload); this.allocate();
      } else if ("If" in statement) {
        this.expression(statement.If.condition);
        const left = this.fork(), right = this.fork();
        left.statements(statement.If.then_body, true); right.statements(statement.If.else_body, true);
        this.next = left.next === right.next ? left.next : undefined;
        for (const [name, value] of this.env) {
          const leftValue = left.env.get(name), rightValue = right.env.get(name);
          this.env.set(name, leftValue && rightValue && equalTargetFacts(leftValue, rightValue) ? leftValue : unknownTarget);
        }
        this.merge(left); this.merge(right);
        if (targetMayExit(statement.If.then_body, true) || targetMayExit(statement.If.else_body, true)) guard = true;
      } else if ("For" in statement) {
        const domain = statement.For.domain;
        if ("DerivedArray" in domain) this.expression(domain.DerivedArray.value);
        else if ("Recurse" in domain) this.expression(domain.Recurse.seed);
        else if ("Page" in domain) this.opaque(domain.Page);
        const repeated = this.fork();
        repeated.next = undefined; repeated.env.set(statement.For.binding, unknownTarget);
        repeated.statements(statement.For.body, true);
        const assigned = new Set<string>([statement.For.binding]);
        targetAssignedBindings(statement.For.body, assigned);
        for (const [name, value] of this.env) {
          const repeatedValue = repeated.env.get(name);
          if (assigned.has(name) || !repeatedValue || !equalTargetFacts(value, repeatedValue)) this.env.set(name, unknownTarget);
        }
        if (allocatesTarget(statement.For.body)) this.next = undefined;
        this.merge(repeated);
        if (targetMayExit(statement.For.body, false)) guard = true;
      }
    }
  }
}

function equalTargetFacts(left: TargetFact, right: TargetFact): boolean {
  if (left.kind !== right.kind) return false;
  if (left.kind === "unknown") return true;
  if (left.kind === "id") return right.kind === "id" && left.source === right.source;
  if (right.kind !== "object" || left.fields.size !== right.fields.size) return false;
  return [...left.fields].every(([name, value]) => right.fields.has(name)
    && equalTargetFacts(value, right.fields.get(name)!));
}
function allocatesTarget(value: unknown): boolean {
  if (!value || typeof value !== "object") return false;
  if (Array.isArray(value)) return value.some(allocatesTarget);
  const node = value as Record<string, unknown>;
  return node.Input === "NewId" || "Emit" in node || Object.values(node).some(allocatesTarget);
}
function targetAssignedBindings(body: readonly Stmt[], names: Set<string>): void {
  for (const statement of body) {
    if (typeof statement === "string") continue;
    if ("Const" in statement) names.add(statement.Const.name);
    else if ("Let" in statement) names.add(statement.Let.name);
    else if ("Assign" in statement) names.add(statement.Assign.name);
    else if ("Push" in statement) names.add(statement.Push.target);
    else if ("If" in statement) {
      targetAssignedBindings(statement.If.then_body, names); targetAssignedBindings(statement.If.else_body, names);
    } else if ("For" in statement) {
      names.add(statement.For.binding); targetAssignedBindings(statement.For.body, names);
    }
  }
}
function targetMayExit(body: readonly Stmt[], loopExitsEscape: boolean): boolean {
  return body.some((statement) => typeof statement === "string" ? loopExitsEscape
    : "Return" in statement || "If" in statement
      && (targetMayExit(statement.If.then_body, loopExitsEscape) || targetMayExit(statement.If.else_body, loopExitsEscape))
    || "For" in statement && targetMayExit(statement.For.body, false));
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
