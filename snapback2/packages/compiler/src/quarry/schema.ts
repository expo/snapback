import type { ChannelDecl, Document, Expr, MaintainDecl, RuleDecl, ScalarType, Site, TableCatalog, TableDecl } from "./ast";
import { orderedTables, selectIndex } from "./catalog";
import { currentRule, refuse, typeError } from "./diagnostics";
import { quarryExpression } from "./print";

type RuleContext = {
  names: Set<string>;
  focal?: boolean;
  effect?: RuleDecl["effect"];
  old?: string;
  next?: string;
  table?: TableDecl;
  args?: Map<string, ScalarType>;
};

export function emitSchema(documents: Document[], catalog: TableCatalog, sourceFile: string): string {
  const rootSite = documents.find((document) => document.tables.length > 0)?.tables[0]?.site
    ?? { file: sourceFile, line: 1, col: 1 };
  const lines: string[] = [withSite(header(sourceFile), rootSite)];
  lines.push(withSite('import { channel, rule, schema, table, t } from "snapback2";', rootSite), "");
  for (const table of orderedTables(catalog)) lines.push(...emitTable(table, catalog), "");
  const channels = documents.flatMap((document) => document.channels);
  for (const declaration of channels) lines.push(...emitChannel(declaration, catalog), "");
  const identity = documents.find((document) => document.identity)?.identity ?? { password: false, guests: false };
  const maintains = documents.flatMap((document) => document.maintains);
  lines.push(withSite("export default schema({", rootSite));
  lines.push(withSite(`  auth: { password: ${identity.password}, guests: ${identity.guests} },`, rootSite));
  lines.push(withSite(`  tables: { ${[...catalog.keys()].filter(name => name !== "connected").join(", ")} },`, rootSite));
  if (maintains.length > 0) {
    lines.push(withSite("  maintains: [", maintains[0]!.site));
    for (const declaration of maintains) lines.push(withSite(`    ${maintainCode(declaration, catalog)},`, declaration.site));
    lines.push(withSite("  ],", maintains.at(-1)!.site));
  }
  lines.push(withSite(`  channels: { ${channels.map((item) => item.name).join(", ")} },`, rootSite));
  lines.push(withSite("});", rootSite));
  return `${lines.join("\n")}\n`;
}

function emitTable(declaration: TableDecl, catalog: TableCatalog): string[] {
  const lines = [withSite(`export var ${declaration.name} = table({`, declaration.site)];
  lines.push(withSite("  columns: {", declaration.site));
  for (const column of declaration.columns) lines.push(withSite(`    ${property(column.name)}: ${typeCode(column.type)},`, column.site));
  lines.push(withSite("  },", declaration.site));
  // @ref LLP 1012#5-retention-revocation-and-the-fence — omission is an
  // explicit IR default; the client policy is carried once per table.
  lines.push(withSite(`  retain: ${JSON.stringify(declaration.retain?.policy ?? "until-revoked")},`, declaration.retain?.site ?? declaration.site));
  if (declaration.indexes.length > 0) {
    lines.push(withSite("  indexes: {", declaration.site));
    for (const index of declaration.indexes) {
      lines.push(withSite(
        `    ${property(index.name)}: { columns: [${index.columns.map((column) => JSON.stringify(column)).join(", ")}]${index.unique ? ", unique: true" : ""} },`,
        index.site,
      ));
    }
    lines.push(withSite("  },", declaration.site));
  }
  const ruleLines: string[] = [];
  if (declaration.public) ruleLines.push(withSite(`    read: rule.public(${JSON.stringify(declaration.public.reason)}),`, declaration.public.site));
  for (const rule of declaration.rules) {
    if (rule.effect === "read" && declaration.public) refuse(rule.site, `table ${declaration.name} cannot combine public with an explicit read rule`);
    ruleLines.push(withSite(`    ${rule.effect}: ${emitRule(rule, catalog, declaration)},`, rule.site));
  }
  if (ruleLines.length > 0) lines.push(withSite("  rules: {", declaration.site), ...ruleLines, withSite("  },", declaration.site));
  const constraints = emitConstraints(declaration, catalog);
  if (constraints.length > 0) lines.push(withSite("  constraints: [", declaration.site), ...constraints, withSite("  ],", declaration.site));
  lines.push(withSite("});", declaration.site));
  return lines;
}

function emitConstraints(declaration: TableDecl, catalog: TableCatalog): string[] {
  const lines: string[] = [];
  for (const index of declaration.indexes.filter((item) => item.unique)) {
    lines.push(withSite(`    { unique: ${JSON.stringify(index.name)} },`, index.site));
  }
  for (const cap of declaration.caps) {
    lines.push(withSite(`    { cap: { by: ${JSON.stringify(cap.by)}, max: ${cap.max} } },`, cap.site));
  }
  for (const immutable of declaration.immutable) {
    lines.push(withSite(`    { immutable: [${immutable.columns.map((column) => JSON.stringify(column)).join(", ")}] },`, immutable.site));
  }
  for (const column of declaration.columns) {
    if (column.type.kind !== "text") continue;
    if (column.type.min !== undefined || column.type.format) {
      const fields = [`field: ${JSON.stringify(column.name)}`];
      if (column.type.min !== undefined) fields.push(`min: ${column.type.min}`);
      if (column.type.format) fields.push(`format: ${JSON.stringify(column.type.format)}`);
      lines.push(withSite(`    { text: { ${fields.join(", ")} } },`, column.site));
    }
  }
  for (const finalExists of declaration.finalExists) {
    const read = finalExists.value.read;
    const context: RuleContext = { names: new Set(), focal: true, effect: "insert", table: declaration };
    const index = selectIndex(catalog, read.table, read.keys, "exists", read.index, (value) => ruleTermType(value, context), read.site);
    const key = read.keys.map((item) => ruleTerm(item.value, context).code).join(", ");
    lines.push(withSite(
      `    { finalExistsOnInsert: { table: ${JSON.stringify(read.table)}, index: ${JSON.stringify(index.name)}, key: [${key}] } },`,
      finalExists.site,
    ));
  }
  return lines;
}

function emitChannel(declaration: ChannelDecl, catalog: TableCatalog): string[] {
  const context: RuleContext = {
    names: new Set(declaration.args.map((arg) => arg.name)),
    args: new Map(declaration.args.map((arg) => [arg.name, arg.type])),
  };
  return [
    withSite(`export const ${declaration.name} = channel({`, declaration.site),
    withSite(`  args: { ${declaration.args.map((arg) => `${property(arg.name)}: ${typeCode(arg.type)}`).join(", ")} },`, declaration.site),
    withSite(`  publish: ${ruleExpr(declaration.publish, catalog, context)},`, declaration.publish.site),
    withSite(`  subscribe: ${ruleExpr(declaration.subscribe, catalog, context)},`, declaration.subscribe.site),
    withSite(`  ttlMs: ${declaration.ttlSeconds * 1000},`, declaration.site),
    withSite("});", declaration.site),
  ];
}

function maintainCode(declaration: MaintainDecl, catalog: TableCatalog): string {
  const kind = declaration.aggregate === "count"
    ? `count: ${JSON.stringify(declaration.source)}`
    : `sum: { source: ${JSON.stringify(declaration.source)}, of: ${JSON.stringify(declaration.column)} }`;
  const readable = declaration.readable
    ? `, readable: ${emitRule(declaration.readable, catalog, catalog.get(declaration.name)?.declaration)}`
    : "";
  return `{ ${kind}, by: [${declaration.by.map((column) => JSON.stringify(column)).join(", ")}], into: ${JSON.stringify(declaration.name)}${readable} }`;
}

function emitRule(declaration: RuleDecl, catalog: TableCatalog, table?: TableDecl): string {
  const context: RuleContext = { names: new Set(declaration.bindings), focal: declaration.bindings.length === 0, effect: declaration.effect, table };
  if (declaration.effect === "update" && declaration.bindings.length === 2) [context.old, context.next] = declaration.bindings;
  return ruleExpr(declaration.value, catalog, context);
}

function ruleExpr(expr: Expr, catalog: TableCatalog, context: RuleContext): string {
  currentRule(expr);
  if (expr.kind === "name") {
    if (expr.name === "allow") return "rule.allow()";
    if (expr.name === "deny") return "rule.deny()";
    if (expr.name === "public") return 'rule.public("Quarry public rule")';
    refuse(expr.site, `rule expression ${expr.name} is not allow, deny, public, or a supported predicate`);
  }
  if (expr.kind === "unary" && expr.op === "not") return `rule.not(${ruleExpr(expr.value, catalog, context)})`;
  if (expr.kind === "binary" && (expr.op === "and" || expr.op === "or")) {
    return `rule.${expr.op}(${flattenBoolean(expr, expr.op).map((item) => ruleExpr(item, catalog, context)).join(", ")})`;
  }
  if (expr.kind === "binary" && (expr.op === "=" || expr.op === "!=")) {
    const leftType = ruleTermType(expr.left, context);
    const rightType = ruleTermType(expr.right, context);
    if (leftType?.kind === "int" && fractionalNumericLiteral(expr.right)
      || rightType?.kind === "int" && fractionalNumericLiteral(expr.left)) {
      typeError(expr.site, "int positions take integer literals", "use an integer literal in the int comparison");
    }
    if (leftType && rightType && !compatibleRuleTypes(leftType, rightType)
      && !brandedLiteralPair(leftType, expr.right) && !brandedLiteralPair(rightType, expr.left)) {
      refuse(expr.site, `cannot compare nominal ${leftType.kind} with ${rightType.kind}; fields compared with viewer must be principal`);
    }
    const left = ruleTerm(expr.left, context);
    const right = ruleTerm(expr.right, context);
    if (expr.op === "=" && left.kind === "field" && right.code === "rule.viewer" && left.method === "field") return `rule.viewerIs(${JSON.stringify(left.field)})`;
    if (expr.op === "=" && right.kind === "field" && left.code === "rule.viewer" && right.method === "field") return `rule.viewerIs(${JSON.stringify(right.field)})`;
    return `rule.${expr.op === "=" ? "eq" : "ne"}(${left.code}, ${right.code})`;
  }
  if (expr.kind === "exists" || expr.kind === "created") {
    if (expr.read.table === "connected") refuse(expr.site,
      "connected is only readable in queries and mutations, not rules",
      `move ${quarryExpression(expr)} into a query or mutation; keep table rules based on durable facts`);
    const index = selectIndex(catalog, expr.read.table, expr.read.keys, "exists", expr.read.index, (value) => ruleTermType(value, context), expr.site);
    const keys = expr.read.keys.map((key) => ruleTerm(key.value, context).code).join(", ");
    return `rule.${expr.kind}(${expr.read.table}, ${JSON.stringify(index.name)}, [${keys}])`;
  }
  if (expr.kind === "member" || expr.kind === "read") refuse(expr.site, "rules cannot follow point reads or nested field chains; use a direct .field or exists/created probe");
  if (expr.kind === "binary" && ["<", "<=", ">", ">="].includes(expr.op)) refuse(expr.site, `the platform rule vocabulary has eq/ne but not ${expr.op}; move the bounded comparison into a mutation require`);
  refuse(expr.site, `rule expression cannot be represented by the Snapback 2 platform${context.effect ? ` for ${context.effect}` : ""}`);
}

function ruleTerm(expr: Expr, context: RuleContext): { code: string; kind: "field" | "other"; field?: string; method?: string } {
  if (expr.kind === "name" && expr.name === "viewer") return { code: "rule.viewer", kind: "other" };
  if (expr.kind === "literal") return { code: `rule.literal(${literalCode(expr)})`, kind: "other" };
  // @ref LLP 1010#a3-one-row-binder — focal .field is the candidate row;
  // only a two-image update retains named old/next terms.
  if (expr.kind === "member" && expr.base.kind === "focal" && context.focal) {
    if (context.table && expr.name !== "id" && !context.table.columns.some((column) => column.name === expr.name)) {
      refuse(expr.site, `table ${context.table.name} has no rule field ${expr.name}`);
    }
    return { code: `rule.field(${JSON.stringify(expr.name)})`, kind: "field", field: expr.name, method: "field" };
  }
  if (expr.kind === "member" && expr.base.kind === "name" && context.names.has(expr.base.name)) {
    if (context.table && expr.name !== "id" && !context.table.columns.some((column) => column.name === expr.name)) {
      refuse(expr.site, `table ${context.table.name} has no rule field ${expr.name}`);
    }
    const method = expr.base.name === context.old ? "oldField" : expr.base.name === context.next ? "nextField" : "field";
    return { code: `rule.${method}(${JSON.stringify(expr.name)})`, kind: "field", field: expr.name, method };
  }
  if (expr.kind === "name" && context.names.has(expr.name)) return { code: `rule.field(${JSON.stringify(expr.name)})`, kind: "field", field: expr.name, method: "field" };
  if (expr.kind === "member") refuse(expr.site, "rule terms cannot follow nested field chains; use a direct .field or exists/created probe");
  refuse(expr.site, "rule terms may only be viewer, literals, channel arguments, or direct .fields of the ruled row");
}

function ruleTermType(expr: Expr, context: RuleContext): ScalarType | undefined {
  if (expr.kind === "name" && expr.name === "viewer") return { kind: "principal", optional: false };
  if (expr.kind === "literal") {
    if (typeof expr.value === "string") return { kind: "text", max: Math.max(1, expr.value.length), optional: false };
    if (typeof expr.value === "number") return { kind: "int", optional: false };
    if (typeof expr.value === "boolean") return { kind: "bool", optional: false };
  }
  if (expr.kind === "member" && expr.base.kind === "focal" && context.focal) {
    if (expr.name === "id" && context.table) return { kind: "ref", table: context.table.name, optional: false };
    return context.table?.columns.find((column) => column.name === expr.name)?.type;
  }
  if (expr.kind === "member" && expr.base.kind === "name" && context.names.has(expr.base.name)) {
    if (expr.name === "id" && context.table) return { kind: "ref", table: context.table.name, optional: false };
    return context.table?.columns.find((column) => column.name === expr.name)?.type;
  }
  if (expr.kind === "name" && context.names.has(expr.name)) return context.args?.get(expr.name);
  return undefined;
}

function compatibleRuleTypes(left: ScalarType, right: ScalarType): boolean {
  if (left.kind === "principal" || right.kind === "principal") return left.kind === "principal" && right.kind === "principal";
  if (left.kind === "ref" || left.kind === "id") return right.kind === "ref" || right.kind === "id";
  if (right.kind === "ref" || right.kind === "id") return false;
  if ((left.kind === "enum" && right.kind === "text") || (left.kind === "text" && right.kind === "enum")) return true;
  if (left.kind === "decimal" || right.kind === "decimal") {
    return left.kind === "decimal" && right.kind === "decimal" && left.scale === right.scale;
  }
  if (left.kind === "money" || right.kind === "money") {
    return left.kind === "money" && right.kind === "money"
      && left.currency === right.currency && left.scale === right.scale;
  }
  return left.kind === right.kind;
}

function brandedLiteralPair(type: ScalarType, expr: Expr): boolean {
  return (type.kind === "decimal" || type.kind === "money") && numericLiteral(expr);
}

function numericLiteral(expr: Expr): boolean {
  return expr.kind === "literal" && typeof expr.value === "number"
    || expr.kind === "unary" && expr.op === "-" && numericLiteral(expr.value);
}

function fractionalNumericLiteral(expr: Expr): boolean {
  if (expr.kind === "unary" && expr.op === "-") return fractionalNumericLiteral(expr.value);
  return expr.kind === "literal" && typeof expr.value === "number" && expr.numericText?.includes(".") === true;
}

function literalCode(expr: Extract<Expr, { kind: "literal" }>): string {
  return typeof expr.value === "number" ? expr.numericText ?? JSON.stringify(expr.value) : JSON.stringify(expr.value);
}

function flattenBoolean(expr: Expr, op: "and" | "or"): Expr[] {
  return expr.kind === "binary" && expr.op === op
    ? [...flattenBoolean(expr.left, op), ...flattenBoolean(expr.right, op)]
    : [expr];
}

export function typeCode(type: ScalarType, tableReference: (table: string) => string = (table) => table): string {
  let code: string;
  if (type.kind === "cursor") code = "t.cursor()";
  else if (type.kind === "text") code = `t.text(${type.max})`;
  else if (type.kind === "id") code = "t.id()";
  else if (type.kind === "principal") code = "t.principal()";
  else if (type.kind === "int") code = "t.int()";
  else if (type.kind === "decimal") code = `t.decimal(${type.scale})`;
  else if (type.kind === "money") code = type.explicitScale
    ? `t.money(${JSON.stringify(type.currency)}, ${type.scale})`
    : `t.money(${JSON.stringify(type.currency)})`;
  else if (type.kind === "time") code = "t.time()";
  else if (type.kind === "bool") code = "t.bool()";
  else if (type.kind === "json") code = `t.json(${type.max})`;
  else if (type.kind === "bytes") code = `t.bytes(${type.max})`;
  // @ref LLP 1006#3-authoring-surface — Quarry asset bounds lower to the same unconditional descriptors as authored TypeScript.
  else if (type.kind === "image") code = `t.image(${type.max}${type.once ? ", { once: true }" : ""})`;
  else if (type.kind === "video") code = `t.video(${type.max})`;
  else if (type.kind === "enum") code = `t.enum([${type.variants.map((variant) => JSON.stringify(variant)).join(", ")}])`;
  else if (type.kind === "ref") code = `t.ref(${tableReference(type.table)})`;
  else code = `t.list(${typeCode({ ...type.item, optional: false }, tableReference)}, { max: ${type.max} })`;
  return type.optional ? `t.optional(${code})` : code;
}

export function header(file: string): string { return `// GENERATED by the Snapback 2 Quarry front end from ${file}`; }
export function mark(file: string, line: number, col = 1): string { return `// q:${file}:${line}:${col}`; }
export function siteMark(site: Site): string {
  const use = site.expandedFrom;
  return `${use ? `/* q-use:${use.file}:${use.line}:${use.col} */ ` : ""}${mark(site.file, site.line, site.col)}`;
}
function withSite(text: string, site: Site): string { return `${text} ${siteMark(site)}`; }
function property(value: string): string { return /^[A-Za-z_$][\w$]*$/.test(value) ? value : JSON.stringify(value); }
