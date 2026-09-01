import type { ChannelDecl, Document, Expr, RuleDecl, ScalarType, Site, TableCatalog, TableDecl } from "./ast";
import { orderedTables, selectIndex } from "./catalog";
import { refuse } from "./diagnostics";

export function emitSchema(documents: Document[], catalog: TableCatalog, sourceFile: string): string {
  const lines: string[] = [];
  lines.push(header(sourceFile));
  lines.push(`import { channel, rule, schema, table, t } from "snapback2"; ${mark(sourceFile, 1)}`);
  lines.push("");
  for (const table of orderedTables(catalog)) {
    lines.push(...emitTable(table, catalog));
    lines.push("");
  }
  const channels = documents.flatMap((document) => document.channels);
  for (const declaration of channels) {
    lines.push(...emitChannel(declaration, catalog));
    lines.push("");
  }
  const tables = [...catalog.keys()].join(", ");
  const channelNames = channels.map((item) => item.name).join(", ");
  const identity = documents.some((document) => document.identity);
  const rootSite = documents.find((document) => document.tables.length > 0)?.tables[0]?.site ?? { file: sourceFile, line: 1, col: 1 };
  lines.push("export default schema({");
  lines.push(`  auth: { password: ${identity}, guests: ${identity} },`);
  lines.push(`  tables: { ${tables} },`);
  lines.push(`  channels: { ${channelNames} },`);
  lines.push(`}); ${siteMark(rootSite)}`);
  return `${lines.join("\n")}\n`;
}

function emitTable(declaration: TableDecl, catalog: TableCatalog): string[] {
  const lines = [`export const ${declaration.name} = table({`];
  lines.push("  columns: {");
  for (const column of declaration.columns) lines.push(`    ${property(column.name)}: ${typeCode(column.type)},`);
  lines.push("  },");
  if (declaration.indexes.length > 0) {
    lines.push("  indexes: {");
    for (const index of declaration.indexes) {
      lines.push(`    ${property(index.name)}: { columns: [${index.columns.map((column) => JSON.stringify(column)).join(", ")}]${index.unique ? ", unique: true" : ""} },`);
    }
    lines.push("  },");
  }
  const ruleLines: string[] = [];
  if (declaration.publicSite) ruleLines.push(`    read: rule.public(${JSON.stringify(`${declaration.name} is public in Quarry`)}),`);
  for (const rule of declaration.rules) {
    if (rule.effect === "read" && declaration.publicSite) refuse(rule.site, `table ${declaration.name} cannot combine public with an explicit read rule`);
    ruleLines.push(`    ${rule.effect}: ${emitRule(rule, catalog)},`);
  }
  if (ruleLines.length > 0) lines.push("  rules: {", ...ruleLines, "  },");
  lines.push(`}); ${siteMark(declaration.site)}`);
  return lines;
}

function emitChannel(declaration: ChannelDecl, catalog: TableCatalog): string[] {
  const bindings = new Set(declaration.args.map((arg) => arg.name));
  return [
    `export const ${declaration.name} = channel({`,
    `  args: { ${declaration.args.map((arg) => `${property(arg.name)}: ${typeCode(arg.type)}`).join(", ")} },`,
    `  publish: ${ruleExpr(declaration.publish, catalog, bindings, undefined)},`,
    `  subscribe: ${ruleExpr(declaration.subscribe, catalog, bindings, undefined)},`,
    `  ttlMs: ${declaration.ttlSeconds * 1000},`,
    `}); ${siteMark(declaration.site)}`,
  ];
}

function emitRule(declaration: RuleDecl, catalog: TableCatalog): string {
  const allowed = new Set(declaration.bindings);
  if (declaration.effect === "update" && declaration.bindings.length > 1) {
    const old = declaration.bindings.slice(0, -1);
    if (old.some((binding) => mentionsName(declaration.value, binding))) {
      refuse(declaration.value.site, "the packaged rule combinators cannot compare old and next rows; restructure as a next-row rule or mutation guard");
    }
    for (const binding of old) allowed.delete(binding);
  }
  return ruleExpr(declaration.value, catalog, allowed, declaration.effect);
}

function ruleExpr(expr: Expr, catalog: TableCatalog, bindings: Set<string>, effect: RuleDecl["effect"] | undefined): string {
  if (expr.kind === "name") {
    if (expr.name === "allow") return "rule.allow()";
    if (expr.name === "deny") return "rule.deny()";
    if (expr.name === "public") return `rule.public("Quarry public rule")`;
    refuse(expr.site, `rule expression ${expr.name} is not one of allow/deny/public or a supported predicate`);
  }
  if (expr.kind === "unary" && expr.op === "not") return `rule.not(${ruleExpr(expr.value, catalog, bindings, effect)})`;
  if (expr.kind === "binary" && (expr.op === "and" || expr.op === "or")) {
    return `rule.${expr.op}(${ruleExpr(expr.left, catalog, bindings, effect)}, ${ruleExpr(expr.right, catalog, bindings, effect)})`;
  }
  if (expr.kind === "binary" && (expr.op === "=" || expr.op === "!=")) {
    const left = ruleTerm(expr.left, bindings);
    const right = ruleTerm(expr.right, bindings);
    if (expr.op === "=" && left.kind === "field" && right.code === "rule.viewer") return `rule.viewerIs(${JSON.stringify(left.field)})`;
    if (expr.op === "=" && right.kind === "field" && left.code === "rule.viewer") return `rule.viewerIs(${JSON.stringify(right.field)})`;
    return `rule.${expr.op === "=" ? "eq" : "ne"}(${left.code}, ${right.code})`;
  }
  if (expr.kind === "exists") {
    const index = selectIndex(catalog, expr.read.table, expr.read.keys, "point", undefined, (value) => ruleTermType(value, bindings), expr.site);
    const keys = expr.read.keys.map((key) => ruleTerm(key.value, bindings).code).join(", ");
    return `rule.exists(${expr.read.table}, ${JSON.stringify(index.name)}, [${keys}])`;
  }
  if (expr.kind === "member" || expr.kind === "read") {
    refuse(expr.site, "the packaged rule combinators cannot follow point reads or field chains; restructure into a direct row field or rule.exists(...)");
  }
  if (expr.kind === "binary" && ["<", "<=", ">", ">="].includes(expr.op)) {
    refuse(expr.site, `the packaged rule combinators expose eq/ne but not ${expr.op}; restructure the authorization rule`);
  }
  refuse(expr.site, `rule expression cannot be represented by the packaged rule combinators${effect ? ` for ${effect}` : ""}; restructure it`);
}

function ruleTerm(expr: Expr, bindings: Set<string>): { code: string; kind: "field" | "other"; field?: string } {
  if (expr.kind === "name" && expr.name === "viewer") return { code: "rule.viewer", kind: "other" };
  if (expr.kind === "name" && bindings.has(expr.name)) return { code: `rule.field(${JSON.stringify(expr.name)})`, kind: "field", field: expr.name };
  if (expr.kind === "literal") return { code: `rule.literal(${JSON.stringify(expr.value)})`, kind: "other" };
  if (expr.kind === "member" && expr.base.kind === "name" && bindings.has(expr.base.name)) {
    return { code: `rule.field(${JSON.stringify(expr.name)})`, kind: "field", field: expr.name };
  }
  if (expr.kind === "member") refuse(expr.site, "the packaged rule combinators cannot express point-read field chains; restructure with a direct field or rule.exists(...)");
  refuse(expr.site, "rule terms may only be viewer, literals, or direct fields of the ruled row/channel args; restructure the rule");
}

function ruleTermType(expr: Expr, bindings: Set<string>): ScalarType | undefined {
  if (expr.kind === "name" && expr.name === "viewer") return { kind: "ref", table: "", optional: false };
  if (expr.kind === "literal") {
    if (typeof expr.value === "string") return { kind: "text", max: Math.max(1, expr.value.length), optional: false };
    if (typeof expr.value === "number") return { kind: "int", optional: false };
    if (typeof expr.value === "boolean") return { kind: "bool", optional: false };
  }
  if (expr.kind === "member" && expr.base.kind === "name" && bindings.has(expr.base.name)) return undefined;
  if (expr.kind === "name" && bindings.has(expr.name)) return undefined;
  return undefined;
}

export function typeCode(type: ScalarType): string {
  let code: string;
  if (type.kind === "text") code = `t.text(${type.max})`;
  else if (type.kind === "id") code = "t.id()";
  else if (type.kind === "int") code = "t.int()";
  else if (type.kind === "time") code = "t.time()";
  else if (type.kind === "bool") code = "t.bool()";
  else if (type.kind === "enum") code = `t.enum([${type.variants.map((variant) => JSON.stringify(variant)).join(", ")}])`;
  else if (type.kind === "ref") code = `t.ref(${type.table})`;
  else code = `t.list(${typeCode({ ...type.item, optional: false })}, { max: ${type.max} })`;
  return type.optional ? `t.optional(${code})` : code;
}

function mentionsName(expr: Expr, name: string): boolean {
  if (expr.kind === "name") return expr.name === name;
  if (expr.kind === "member") return mentionsName(expr.base, name);
  if (expr.kind === "binary") return mentionsName(expr.left, name) || mentionsName(expr.right, name);
  if (expr.kind === "unary" || expr.kind === "assert") return mentionsName(expr.value, name);
  if (expr.kind === "exists") return expr.read.keys.some((key) => mentionsName(key.value, name));
  if (expr.kind === "read") return expr.keys.some((key) => mentionsName(key.value, name));
  if (expr.kind === "call") return expr.args.some((arg) => mentionsName(arg, name));
  if (expr.kind === "array") return expr.items.some((item) => mentionsName(item, name));
  return false;
}

export function header(file: string): string {
  return `// GENERATED by quarryc from snapback-quarry/${file} — do not edit`;
}

export function mark(file: string, line: number): string { return `// q:${file}:${line}`; }
export function siteMark(site: Site): string { return mark(site.file, site.line); }
function property(value: string): string { return /^[A-Za-z_$][\w$]*$/.test(value) ? value : JSON.stringify(value); }
