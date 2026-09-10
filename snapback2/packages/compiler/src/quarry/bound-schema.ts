import { nameRewrite } from "./diagnostics";
import type { ArgType, DeliverJson, IndexComponent, SchemaJson, SourceSite, TableJson, Value } from "../ir";
import { expandedNumericLiteral } from "../syntax";
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

type RuleTerm = { value: unknown; kind: "field" | "other"; field?: string; method?: "field" | "oldField" | "nextField" };

/** Lower prepared Quarry declarations directly into the executable schema contract. */
export function bindQuarrySchema(documents: Document[], catalog: TableCatalog): SchemaJson {
  return bindQuarrySchemaArtifact(documents, catalog).schema;
}

export type BoundQuarrySchemaArtifact = {
  schema: SchemaJson;
  sources: Array<[string, SourceSite]>;
};

/** Keep executable constraints and their authored locations in one ordered artifact. */
export function bindQuarrySchemaArtifact(documents: Document[], catalog: TableCatalog): BoundQuarrySchemaArtifact {
  const tables: Record<string, TableJson> = Object.create(null);
  const sources: Array<[string, SourceSite]> = [];
  for (const declaration of orderedTables(catalog)) {
    if (declaration.name === "connected") continue;
    const bound = bindTable(declaration, catalog);
    tables[declaration.name] = bound.table;
    const base = `schema.tables.${declaration.name}`;
    sources.push([base, declaration.site]);
    for (const column of declaration.columns) sources.push([`${base}.columns.${column.name}`, column.site]);
    for (const index of declaration.indexes) sources.push([`${base}.indexes.${index.name}`, index.site]);
    const read = declaration.rules.find(rule => rule.effect === "read");
    sources.push([`schema.tables.${declaration.name}.rules.read`, read?.site ?? declaration.public?.site ?? { ...declaration.site, text: "read <- deny" }]);
    for (const [offset, site] of bound.constraintSources.entries()) {
      sources.push([`schema.tables.${declaration.name}.constraints[${offset}]`, site]);
    }
    if (bound.deliverSource) sources.push([`schema.tables.${declaration.name}.deliver`, bound.deliverSource]);
  }
  const channels: Record<string, unknown> = Object.create(null);
  for (const declaration of documents.flatMap((document) => document.channels)) {
    channels[declaration.name] = bindChannel(declaration, catalog);
    const site = `schema.channels.${declaration.name}`;
    sources.push([site, declaration.site], [`${site}.publish`, declaration.publish.site],
      [`${site}.subscribe`, declaration.subscribe.site]);
    for (const [kind, fields] of [["args", declaration.args], ["value", declaration.value]] as const) {
      for (const field of fields) sources.push([`${site}.${kind}.${field.name}`, field.site]);
    }
  }
  const identity = documents.find((document) => document.identity)?.identity;
  const schema: SchemaJson = {
    tables,
    maintains: documents.flatMap((document) => document.maintains).map((item) => bindMaintain(item, catalog)),
    channels,
    auth: { password: identity?.password ?? false, guests: identity?.guests ?? false },
    effects: [],
  };
  return { schema, sources };
}

function bindTable(
  declaration: TableDecl,
  catalog: TableCatalog,
): { table: TableJson; constraintSources: SourceSite[]; deliverSource?: SourceSite } {
  const columns: Record<string, unknown> = Object.assign(Object.create(null), { id: "Id" });
  for (const column of declaration.columns) columns[column.name] = bindColumn(column.type, catalog, column.site);
  const indexes: Record<string, unknown> = Object.create(null);
  for (const index of catalog.get(declaration.name)?.indexes ?? []) {
    indexes[index.name] = { components: structuredClone(index.components), unique: index.unique };
  }
  const rules: Record<string, unknown> = Object.create(null);
  for (const effect of ["read", "insert", "update", "delete"] as const) {
    const rule = declaration.rules.find((candidate) => candidate.effect === effect);
    if (effect === "read" && declaration.public) {
      if (rule) refuse(rule.site, `table ${declaration.name} cannot combine public with an explicit read rule`);
      rules.read = { Public: { reason: declaration.public.reason } };
    } else {
      rules[effect] = rule ? bindRule(rule, catalog, declaration) : "Deny";
    }
  }
  const constraints = bindConstraints(declaration, catalog);
  const deliver = bindDeliver(declaration, catalog);
  const table: TableJson = {
    columns,
    indexes,
    rules,
    constraints: constraints.values,
    // @ref LLP 1012#5-retention-revocation-and-the-fence — omission is an explicit IR default.
    retain: declaration.retain?.policy ?? "until-revoked",
    // @ref LLP 1019#3-what-writes-it — only the engine-derived log declares body eviction.
    ...(declaration.derived?.kind === "log" ? { tombstones: [{
      table: declaration.derived.deliver, column: "row",
      when: { Eq: [{ Field: "kind" }, { Literal: { String: "removed" } }] },
    }] } : {}),
    ...(deliver ? { deliver } : {}),
  };
  return { table, constraintSources: constraints.sources,
    ...(declaration.deliver ? { deliverSource: declaration.deliver.site } : {}) };
}

// @ref LLP 1019#1-the-declaration — the resolved descriptor in Rust field
// order; the tables it generates were materialized before the catalog.
function bindDeliver(declaration: TableDecl, catalog: TableCatalog): DeliverJson | undefined {
  const deliver = declaration.deliver;
  if (!deliver) return undefined;
  if (deliver.principal === undefined) refuse(deliver.site, `deliver on ${declaration.name} was not resolved before binding`);
  return {
    target: tableName(catalog, deliver.target, deliver.site),
    prefix: [...deliver.prefix],
    principal: deliver.principal,
    log: deliver.name,
    ...(deliver.receipts ? { receipts: true as const } : {}),
    ...(deliver.bootstrap ? { bootstrap: true as const } : {}),
  };
}

function bindColumn(type: ScalarType, catalog: TableCatalog, site: TableDecl["site"]): unknown {
  let descriptor: unknown;
  if (type.kind === "cursor") refuse(site, "cursor is an argument type, not a stored column type");
  if (type.kind === "text") descriptor = { Text: { max: type.max } };
  else if (type.kind === "id") descriptor = "Id";
  else if (type.kind === "principal") descriptor = "Principal";
  else if (type.kind === "int") descriptor = "Int";
  else if (type.kind === "decimal") descriptor = { Decimal: { scale: type.scale } };
  else if (type.kind === "money") descriptor = { Money: { currency: type.currency, scale: type.scale } };
  else if (type.kind === "time") descriptor = "Time";
  else if (type.kind === "bool") descriptor = "Bool";
  else if (type.kind === "json") descriptor = { Json: { max_bytes: type.max } };
  else if (type.kind === "bytes") descriptor = { Bytes: { max: type.max } };
  // @ref LLP 1006#3-authoring-surface — asset bounds and once custody are executable column metadata.
  else if (type.kind === "image") descriptor = { Image: { max: type.max, ...(type.once ? { once: true } : {}) } };
  else if (type.kind === "video") descriptor = { Video: { max: type.max } };
  else if (type.kind === "enum") descriptor = { Enum: { variants: [...type.variants] } };
  else if (type.kind === "ref") descriptor = { Ref: { table: tableName(catalog, type.table, site) } };
  else descriptor = { List: { of: bindColumn({ ...type.item, optional: false }, catalog, site), max: type.max } };
  return type.optional ? { Optional: descriptor } : descriptor;
}

function bindConstraints(
  declaration: TableDecl,
  catalog: TableCatalog,
): { values: unknown[]; sources: SourceSite[] } {
  const constraints: unknown[] = [];
  const sources: SourceSite[] = [];
  const add = (value: unknown, site: SourceSite) => {
    constraints.push(value);
    sources.push(site);
  };
  for (const index of declaration.indexes.filter((item) => item.unique)) {
    add({ Unique: { index: index.name } }, index.site);
  }
  for (const cap of declaration.caps) add({ Cap: { by: [...cap.by], max: cap.max } }, cap.site);
  for (const immutable of declaration.immutable) {
    add({ Immutable: { fields: [...immutable.columns] } }, immutable.site);
  }
  for (const column of declaration.columns) {
    if (column.type.kind === "text" && (column.type.min !== undefined || column.type.format)) {
      add({ Text: {
        field: column.name,
        min: column.type.min ?? 0,
        ...(column.type.format ? { format: column.type.format } : {}),
      } }, column.site);
    }
  }
  for (const declarationConstraint of declaration.finalExists) {
    const read = declarationConstraint.value.read;
    const context: RuleContext = { names: new Set(), focal: true, effect: "insert", table: declaration };
    const index = selectIndex(
      catalog,
      read.table,
      read.keys,
      "exists",
      read.index,
      (value) => ruleTermType(value, context),
      read.site,
    );
    add({ FinalExistsOnInsert: {
      table: tableName(catalog, read.table, read.site),
      index: index.name,
      key: read.keys.map((item) => bindRuleTerm(item.value, context).value),
    } }, declarationConstraint.site);
  }
  return { values: constraints, sources };
}

function bindMaintain(declaration: MaintainDecl, catalog: TableCatalog): unknown {
  const target = catalog.get(declaration.name)?.declaration;
  if (!target) refuse(declaration.site, `maintain ${declaration.name} has no materialized target table`);
  return {
    kind: declaration.aggregate === "count" ? "Count" : { Sum: { of: declaration.column! } },
    source: tableName(catalog, declaration.source, declaration.site),
    by: [...declaration.by],
    target: target.name,
    readable: declaration.readable ? bindRule(declaration.readable, catalog, target) : null,
  };
}

function bindChannel(declaration: ChannelDecl, catalog: TableCatalog): unknown {
  const args: Record<string, unknown> = Object.create(null);
  for (const arg of declaration.args) args[arg.name] = bindArgument(arg.type, catalog, arg.site);
  const value: Record<string, ArgType> = Object.create(null);
  for (const field of declaration.value) value[field.name] = bindArgument(field.type, catalog, field.site);
  const context: RuleContext = {
    names: new Set(declaration.args.map((arg) => arg.name)),
    args: new Map(declaration.args.map((arg) => [arg.name, arg.type])),
  };
  return {
    args,
    value,
    publish: bindRuleExpr(declaration.publish, catalog, context),
    subscribe: bindRuleExpr(declaration.subscribe, catalog, context),
    ttl_ms: declaration.ttlSeconds * 1000,
  };
}

function bindArgument(type: ScalarType, catalog: TableCatalog, site: TableDecl["site"]): ArgType {
  let descriptor: ArgType;
  if (type.kind === "cursor") descriptor = "Cursor";
  else if (type.kind === "text") descriptor = { Text: {
    max: type.max,
    ...(type.min ? { min: type.min } : {}),
    ...(type.format ? { format: type.format } : {}),
  } };
  else if (type.kind === "id") descriptor = "Id";
  else if (type.kind === "principal") descriptor = "Principal";
  else if (type.kind === "int") descriptor = "Int";
  else if (type.kind === "decimal") descriptor = { Decimal: { scale: type.scale } };
  else if (type.kind === "money") descriptor = { Money: { currency: type.currency, scale: type.scale } };
  else if (type.kind === "time") descriptor = "Time";
  else if (type.kind === "bool") descriptor = "Bool";
  else if (type.kind === "json") descriptor = { Json: { max_bytes: type.max } };
  else if (type.kind === "bytes") descriptor = { Bytes: { max: type.max } };
  else if (type.kind === "image") descriptor = { Image: { max: type.max } };
  else if (type.kind === "video") descriptor = { Video: { max: type.max } };
  else if (type.kind === "enum") descriptor = { Enum: { variants: [...type.variants] } };
  else if (type.kind === "ref") descriptor = { Ref: { table: tableName(catalog, type.table, site) } };
  else descriptor = { List: { of: bindArgument({ ...type.item, optional: false }, catalog, site), max: type.max } };
  return type.optional ? { Optional: descriptor } : descriptor;
}

function bindRule(declaration: RuleDecl, catalog: TableCatalog, table?: TableDecl): unknown {
  const context: RuleContext = {
    names: new Set(declaration.bindings),
    focal: declaration.bindings.length === 0,
    effect: declaration.effect,
    table,
  };
  if (declaration.effect === "update" && declaration.bindings.length === 2) {
    [context.old, context.next] = declaration.bindings;
  }
  return bindRuleExpr(declaration.value, catalog, context);
}

function bindRuleExpr(expr: Expr, catalog: TableCatalog, context: RuleContext): unknown {
  currentRule(expr);
  if (expr.kind === "name") {
    if (expr.name === "allow") return "Allow";
    if (expr.name === "deny") return "Deny";
    if (expr.name === "public") return { Public: { reason: "Quarry public rule" } };
    refuse(expr.site, `rule expression ${expr.name} is not allow, deny, public, or a supported predicate`);
  }
  if (expr.kind === "unary" && expr.op === "not") return { Not: bindRuleExpr(expr.value, catalog, context) };
  if (expr.kind === "binary" && (expr.op === "and" || expr.op === "or")) {
    return { [expr.op === "and" ? "And" : "Or"]:
      flattenBoolean(expr, expr.op).map((item) => bindRuleExpr(item, catalog, context)) };
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
    const left = bindRuleTerm(expr.left, context, rightType);
    const right = bindRuleTerm(expr.right, context, leftType);
    return { [expr.op === "=" ? "Eq" : "Ne"]: [left.value, right.value] };
  }
  if (expr.kind === "exists" || expr.kind === "created") {
    if (expr.read.table === "connected") refuse(
      expr.site,
      "connected is only readable in queries and mutations, not rules",
      `move ${quarryExpression(expr)} into a query or mutation; keep table rules based on durable facts`,
    );
    const index = selectIndex(
      catalog,
      expr.read.table,
      expr.read.keys,
      "exists",
      expr.read.index,
      (value) => ruleTermType(value, context),
      expr.site,
    );
    const key = expr.read.keys.map((item, position) => bindRuleTerm(
      item.value,
      context,
      indexComponentType(catalog, expr.read.table, index.components[position]),
    ).value);
    return { [expr.kind === "exists" ? "Exists" : "Created"]: {
      table: tableName(catalog, expr.read.table, expr.site),
      index: index.name,
      key,
      provenance: ruleProvenance(key),
    } };
  }
  if (expr.kind === "member" || expr.kind === "read") {
    refuse(expr.site, "rules cannot follow point reads or nested field chains; use a direct .field or exists/created probe");
  }
  if (expr.kind === "binary" && ["<", "<=", ">", ">="].includes(expr.op)) {
    refuse(expr.site, `the platform rule vocabulary has eq/ne but not ${expr.op}; move the bounded comparison into a mutation require`);
  }
  refuse(expr.site, `rule expression cannot be represented by the Snapback 2 platform${context.effect ? ` for ${context.effect}` : ""}`);
}

function bindRuleTerm(expr: Expr, context: RuleContext, expected?: ScalarType): RuleTerm {
  if (expr.kind === "name" && expr.name === "viewer") return { value: "Viewer", kind: "other" };
  if (expr.kind === "literal") return { value: { Literal: bindLiteral(expr, expected) }, kind: "other" };
  // @ref LLP 1010#a3-one-row-binder — focal field access is the candidate row; two-image updates retain old/next.
  if (expr.kind === "member" && expr.base.kind === "focal" && context.focal) {
    checkRuleField(context, expr.name, expr.site);
    return { value: { Field: expr.name }, kind: "field", field: expr.name, method: "field" };
  }
  if (expr.kind === "member" && expr.base.kind === "name" && context.names.has(expr.base.name)) {
    checkRuleField(context, expr.name, expr.site);
    const method = expr.base.name === context.old ? "oldField" : expr.base.name === context.next ? "nextField" : "field";
    const tag = method === "oldField" ? "OldField" : method === "nextField" ? "NextField" : "Field";
    return { value: { [tag]: expr.name }, kind: "field", field: expr.name, method };
  }
  if (expr.kind === "name" && context.names.has(expr.name)) {
    return { value: { Field: expr.name }, kind: "field", field: expr.name, method: "field" };
  }
  if (expr.kind === "member") refuse(expr.site, "rule terms cannot follow nested field chains; use a direct .field or exists/created probe");
  refuse(expr.site, "rule terms may only be viewer, literals, channel arguments, or direct .fields of the ruled row");
}

function bindLiteral(expr: Extract<Expr, { kind: "literal" }>, expected?: ScalarType): Value {
  if (expr.value === null) return "Null";
  if (typeof expr.value === "boolean") return { Bool: expr.value };
  if (typeof expr.value === "string") return { String: expr.value };
  const target = required(expected);
  if (target?.kind === "decimal" || target?.kind === "money") {
    const text = expr.numericText ?? String(expr.value);
    if (target.scale > 0 && !text.includes(".") && expr.value !== 0)
      typeError(expr.site, "integer rule literals do not implicitly become decimal whole units", `write ${text}.0 for decimal whole units`);
    const expanded = expandedNumericLiteral(text);
    if (!expanded || expanded.fraction.length > target.scale) {
      typeError(expr.site, `numeric rule literal must fit Decimal scale ${target.scale} and the safe integer range`, "use a literal that fits the declared scale");
    }
    const scaled = BigInt(expanded.whole) * (10n ** BigInt(target.scale))
      + BigInt(expanded.fraction.padEnd(target.scale, "0") || "0");
    if (scaled < -9_007_199_254_740_991n || scaled > 9_007_199_254_740_991n) {
      typeError(expr.site, `numeric rule literal must fit Decimal scale ${target.scale} and the safe integer range`, "use a literal that fits the declared scale");
    }
    return { Int: Number(scaled) };
  }
  if (!Number.isInteger(expr.value)) typeError(expr.site,
    "fractional numeric literals require a decimal or money context",
    "use an integer literal or compare against a decimal or money column");
  return { Int: expr.value };
}

function checkRuleField(context: RuleContext, name: string, site: TableDecl["site"]): void {
  if (context.table && name !== "id" && !context.table.columns.some((column) => column.name === name)) {
    refuse(site, `table ${context.table.name} has no rule field ${name}`, nameRewrite(name, ["id", ...context.table.columns.map(column => column.name)]));
  }
}

function ruleTermType(expr: Expr, context: RuleContext): ScalarType | undefined {
  if (expr.kind === "name" && expr.name === "viewer") return { kind: "principal", optional: false };
  if (expr.kind === "literal") {
    if (typeof expr.value === "string") return { kind: "text", max: Math.max(1, expr.value.length), optional: false };
    if (typeof expr.value === "number") return { kind: "int", optional: false };
    if (typeof expr.value === "boolean") return { kind: "bool", optional: false };
  }
  if (expr.kind === "member" && expr.base.kind === "focal" && context.focal) return ruleFieldType(context.table, expr.name);
  if (expr.kind === "member" && expr.base.kind === "name" && context.names.has(expr.base.name)) return ruleFieldType(context.table, expr.name);
  if (expr.kind === "name" && context.names.has(expr.name)) return context.args?.get(expr.name);
  return undefined;
}

function ruleFieldType(table: TableDecl | undefined, name: string): ScalarType | undefined {
  if (name === "id" && table) return { kind: "ref", table: table.name, optional: false };
  return table?.columns.find((column) => column.name === name)?.type;
}

function indexComponentType(
  catalog: TableCatalog,
  table: string,
  component: IndexComponent | undefined,
): ScalarType | undefined {
  if (!component || !("Column" in component)) return undefined;
  return ruleFieldType(catalog.get(table)?.declaration, component.Column);
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

function flattenBoolean(expr: Expr, op: "and" | "or"): Expr[] {
  return expr.kind === "binary" && expr.op === op
    ? [...flattenBoolean(expr.left, op), ...flattenBoolean(expr.right, op)]
    : [expr];
}

function ruleProvenance(key: unknown[]): "Arg" | "Viewer" | "Const" | "Shape" | "Computed" {
  if (key.some((item) => typeof item === "object" && item !== null
    && ["Field", "OldField", "NextField"].some((term) => term in item))) return "Shape";
  if (key.some((item) => item === "Viewer")) return "Viewer";
  if (key.every((item) => typeof item === "object" && item !== null && "Literal" in item)) return "Const";
  return "Computed";
}

function required(type: ScalarType | undefined): ScalarType | undefined {
  return type?.optional ? { ...type, optional: false } : type;
}

function tableName(catalog: TableCatalog, authored: string, site: TableDecl["site"]): string {
  const declaration = catalog.get(authored)?.declaration;
  if (!declaration) refuse(site, `unknown table ${authored}`, nameRewrite(authored, catalog.keys()));
  return declaration.name;
}
