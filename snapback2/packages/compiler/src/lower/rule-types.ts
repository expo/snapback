import ts from "typescript";
import { diagnostic } from "../diagnostics";
import type { FrontendDiagnostic } from "../ir";
import { unwrapCall, unwrapExpression } from "../syntax";
import { callLeaf, objectOf, property, staticJson, stringValue } from "./static";

type SchemaModule = { sourceFile: ts.SourceFile; source: string; fileName: string };
type RuleSubject = { label: string; columns: Record<string, unknown> };
type RuleTableShape = RuleSubject & { indexes: Record<string, { columns?: string[] }> };
// @ref LLP 1002#2-the-authored-surface-the-snapback2-module — row-image terms and created-row probes are scoped to the mutation effect that defines them.
type RuleEffect = "read" | "insert" | "update" | "delete";
type RuleUse = { kind: "table"; effect: RuleEffect } | { kind: "other" };
const RULE_TYPE_REWRITE = "declare authority axes as Principal and align rule terms with the referenced index columns";
type RuleType =
  | { kind: "principal" }
  | { kind: "id" }
  | { kind: "ref"; table: string }
  | { kind: "text" }
  | { kind: "int" }
  | { kind: "bool" }
  | { kind: "time" }
  | { kind: "json" }
  | { kind: "enum"; variants: string[] }
  | { kind: "decimal"; scale: number }
  | { kind: "money"; currency: string; scale: number }
  | { kind: "optional"; of: RuleType }
  | { kind: "list"; of: RuleType }
  | { kind: "scalar" }
  | { kind: "null-literal" }
  | { kind: "text-literal"; value: string }
  | { kind: "int-literal" }
  | { kind: "bool-literal" }
  | { kind: "array-literal"; values: RuleType[] }
  | { kind: "json-literal" };

// @ref LLP 1001#6-identity-identityrs — Viewer comparisons are authority comparisons,
// so their schema axis must be nominal Principal rather than an application row id.
export function validateRuleTypes(
  module: SchemaModule,
  tableCalls: Map<string, ts.CallExpression>,
  channelCalls: Map<string, ts.CallExpression>,
  tableJson: Record<string, unknown>,
  channelJson: Record<string, unknown>,
  diagnostics: FrontendDiagnostic[],
): void {
  const catalog = ruleTableCatalog(tableJson);
  for (const [name, call] of tableCalls) {
    const config = objectOf(call.arguments[0]);
    const rules = config && objectOf(property(config, "rules"));
    const subject = catalog.get(name);
    for (const side of ["read", "insert", "update", "delete"] as const) {
      const node = rules && property(rules, side);
      if (node) validateRuleType(module, node, subject, { kind: "table", effect: side }, catalog, diagnostics);
    }
    if (config && subject) validateFinalExistsTypes(module, config, name, subject, catalog, diagnostics);
  }
  for (const [name, call] of channelCalls) {
    const config = objectOf(call.arguments[0]);
    const lowered = channelJson[name];
    const args = lowered && typeof lowered === "object" && !Array.isArray(lowered)
      ? (lowered as Record<string, unknown>).args
      : undefined;
    const subject: RuleSubject | undefined = args && typeof args === "object" && !Array.isArray(args)
      ? { label: `channel ${name}`, columns: args as Record<string, unknown> }
      : undefined;
    for (const side of ["publish", "subscribe"]) {
      const node = config && property(config, side);
      if (node) validateRuleType(module, node, subject, { kind: "other" }, catalog, diagnostics);
    }
  }
}

export function validateMaintainRuleTypes(
  module: SchemaModule,
  node: ts.Expression | undefined,
  tableJson: Record<string, unknown>,
  diagnostics: FrontendDiagnostic[],
): void {
  const value = node && unwrapExpression(node);
  if (!value || !ts.isArrayLiteralExpression(value)) return;
  const catalog = ruleTableCatalog(tableJson);
  for (const item of value.elements) {
    const config = objectOf(item);
    const readable = config && property(config, "readable");
    if (!readable) continue;
    const target = stringValue(property(config, "into"));
    validateRuleType(module, readable, target ? catalog.get(target) : undefined, { kind: "other" }, catalog, diagnostics);
  }
}

function ruleTableCatalog(tableJson: Record<string, unknown>): Map<string, RuleTableShape> {
  const catalog = new Map<string, RuleTableShape>();
  for (const [name, value] of Object.entries(tableJson)) {
    if (!value || typeof value !== "object" || Array.isArray(value)) continue;
    const record = value as Record<string, unknown>;
    const columns = record.columns && typeof record.columns === "object" && !Array.isArray(record.columns)
      ? record.columns as Record<string, unknown>
      : {};
    const indexes = record.indexes && typeof record.indexes === "object" && !Array.isArray(record.indexes)
      ? record.indexes as Record<string, { columns?: string[] }>
      : {};
    catalog.set(name, { label: `table ${name}`, columns, indexes });
  }
  return catalog;
}

function validateRuleType(
  module: SchemaModule,
  node: ts.Expression,
  subject: RuleSubject | undefined,
  ruleUse: RuleUse,
  catalog: Map<string, RuleTableShape>,
  diagnostics: FrontendDiagnostic[],
): void {
  const call = unwrapCall(node);
  const name = call && callLeaf(call);
  if (!call || !name) return;
  if (name === "viewerIs" && call.arguments.length === 1 && call.arguments[0]) {
    const field = stringValue(call.arguments[0]);
    if (field) {
      const actual = ruleFieldType(module, call.arguments[0], subject, field, diagnostics);
      if (actual && !compatible(actual, { kind: "principal" })) {
        diagnostics.push(ruleTypeDiagnostic(
          module,
          call.arguments[0],
          `${subject?.label ?? "unknown rule subject"}.${field} is ${ruleTypeLabel(actual)}; fields compared with rule.viewer must be Principal`,
        ));
      }
    }
    return;
  }
  if ((name === "eq" || name === "ne") && call.arguments.length === 2) {
    const left = call.arguments[0] && ruleTermType(module, call.arguments[0], subject, ruleUse, diagnostics);
    const right = call.arguments[1] && ruleTermType(module, call.arguments[1], subject, ruleUse, diagnostics);
    if (left && right && !compatible(left, right)) {
      diagnostics.push(ruleTypeDiagnostic(
        module,
        call,
        `rule.${name} compares ${ruleTypeLabel(left)} with ${ruleTypeLabel(right)}; rule terms must have compatible scalar types`,
      ));
    }
    return;
  }
  if (name === "and" || name === "or") {
    for (const item of call.arguments) validateRuleType(module, item, subject, ruleUse, catalog, diagnostics);
    return;
  }
  if (name === "not" && call.arguments[0]) {
    validateRuleType(module, call.arguments[0], subject, ruleUse, catalog, diagnostics);
    return;
  }
  if (name !== "exists" && name !== "created") return;
  if (name === "created" && !(ruleUse.kind === "table" && ruleUse.effect === "insert")) {
    diagnostics.push(ruleTypeDiagnostic(
      module,
      call,
      "created-row probes are valid only in table insert rules",
    ));
  }
  if (call.arguments.length !== 3) return;
  const probe = name;
  const target = call.arguments[0] && unwrapExpression(call.arguments[0]);
  const tableName = target && ts.isIdentifier(target) ? target.text : undefined;
  const indexName = stringValue(call.arguments[1]);
  const key = call.arguments[2] && unwrapExpression(call.arguments[2]);
  const targetShape = tableName ? catalog.get(tableName) : undefined;
  if (!tableName || !targetShape) {
    diagnostics.push(ruleTypeDiagnostic(
      module,
      call.arguments[0] ?? call,
      `rule.${probe} references unresolved table ${tableName ?? call.arguments[0]?.getText() ?? "<missing>"}`,
    ));
    return;
  }
  if (!indexName) return;
  const index = indexName ? targetShape?.indexes[indexName] : undefined;
  if (!index) {
    diagnostics.push(ruleTypeDiagnostic(
      module,
      call.arguments[1] ?? call,
      `rule.${probe} references unresolved index ${tableName}.${indexName}`,
    ));
    return;
  }
  if (!key || !ts.isArrayLiteralExpression(key)) return;
  const columns = index.columns;
  if (!Array.isArray(columns)) {
    diagnostics.push(ruleTypeDiagnostic(
      module,
      call.arguments[1] ?? call,
      `rule.${probe} index ${tableName}.${indexName} has an unresolved column list`,
    ));
    return;
  }
  if (key.elements.length !== columns.length) {
    diagnostics.push(ruleTypeDiagnostic(
      module,
      key,
      `rule.${probe} key for ${tableName}.${indexName} has ${key.elements.length} terms; expected ${columns.length}`,
    ));
  }
  for (const [position, term] of key.elements.entries()) {
    const column = columns[position];
    if (!column) continue;
    const expected = ruleTypeFromDescriptor(targetShape.columns[column]);
    if (!expected) {
      diagnostics.push(ruleTypeDiagnostic(
        module,
        term,
        `rule.${probe} index ${tableName}.${indexName} references unresolved column ${column}`,
      ));
      continue;
    }
    const actual = ruleTermType(module, term, subject, ruleUse, diagnostics);
    if (!actual || compatibleExists(actual, expected, tableName, column)) continue;
    diagnostics.push(ruleTypeDiagnostic(
      module,
      term,
      `rule.${probe} term for ${tableName}.${indexName}.${column} is ${ruleTypeLabel(actual)}; expected ${ruleTypeLabel(expected)}`,
    ));
  }
}

function validateFinalExistsTypes(
  module: SchemaModule,
  config: ts.ObjectLiteralExpression,
  sourceTable: string,
  subject: RuleSubject,
  catalog: Map<string, RuleTableShape>,
  diagnostics: FrontendDiagnostic[],
): void {
  const constraints = property(config, "constraints");
  const value = constraints && unwrapExpression(constraints);
  if (!value || !ts.isArrayLiteralExpression(value)) return;
  for (const item of value.elements) {
    const constraint = objectOf(item);
    const finalNode = constraint && property(constraint, "finalExistsOnInsert");
    const finalExists = finalNode && objectOf(finalNode);
    if (!finalExists) continue;
    const tableNode = property(finalExists, "table");
    const tableName = stringValue(tableNode);
    if (!tableName) continue;
    const target = catalog.get(tableName);
    if (!target) {
      diagnostics.push(ruleTypeDiagnostic(
        module,
        tableNode ?? finalNode,
        `final-exists constraint references unknown table ${tableName}`,
      ));
      continue;
    }
    const indexNode = property(finalExists, "index");
    const indexName = stringValue(indexNode);
    if (!indexName) continue;
    const index = target.indexes[indexName];
    if (!index) {
      diagnostics.push(ruleTypeDiagnostic(
        module,
        indexNode ?? finalNode,
        `final-exists constraint references unknown index ${tableName}.${indexName}`,
      ));
      continue;
    }
    const keyNode = property(finalExists, "key");
    const key = keyNode && unwrapExpression(keyNode);
    if (!key || !ts.isArrayLiteralExpression(key)) continue;
    const columns = index.columns;
    if (!Array.isArray(columns)) {
      diagnostics.push(ruleTypeDiagnostic(
        module,
        indexNode ?? finalNode,
        `final-exists index ${tableName}.${indexName} has an unresolved column list`,
      ));
      continue;
    }
    if (key.elements.length !== columns.length) {
      diagnostics.push(ruleTypeDiagnostic(
        module,
        key,
        `final-exists key for ${tableName}.${indexName} has ${key.elements.length} terms; expected ${columns.length}`,
      ));
    }
    for (const [position, term] of key.elements.entries()) {
      const column = columns[position];
      if (!column) continue;
      const expected = ruleTypeFromDescriptor(target.columns[column]);
      if (!expected) {
        diagnostics.push(ruleTypeDiagnostic(
          module,
          term,
          `final-exists index ${tableName}.${indexName} references unresolved column ${column}`,
        ));
        continue;
      }
      const actual = ruleTermType(module, term, subject, { kind: "other" }, diagnostics);
      if (!actual || compatibleFinalExists(
        actual,
        expected,
        sourceTable,
        tableName,
        column,
        term,
      )) continue;
      diagnostics.push(ruleTypeDiagnostic(
        module,
        term,
        `final-exists term for ${tableName}.${indexName}.${column} is ${ruleTypeLabel(actual)}; expected ${ruleTypeLabel(expected)}`,
      ));
    }
  }
}

function ruleTermType(
  module: SchemaModule,
  node: ts.Expression,
  subject: RuleSubject | undefined,
  ruleUse: RuleUse,
  diagnostics: FrontendDiagnostic[],
): RuleType | undefined {
  const value = unwrapExpression(node);
  if (ts.isPropertyAccessExpression(value)
    && value.expression.getText() === "rule"
    && value.name.text === "viewer") return { kind: "principal" };
  const call = unwrapCall(value);
  const name = call && callLeaf(call);
  if (call && name === "field" && call.arguments.length === 1 && call.arguments[0]) {
    const field = stringValue(call.arguments[0]);
    if (field) return ruleFieldType(module, call.arguments[0], subject, field, diagnostics);
  }
  if (call && (name === "oldField" || name === "nextField")
    && call.arguments.length === 1 && call.arguments[0]) {
    if (!(ruleUse.kind === "table" && ruleUse.effect === "update")) {
      diagnostics.push(ruleTypeDiagnostic(
        module,
        call,
        `${name === "oldField" ? "old" : "next"}-row fields are valid only in table update rules`,
      ));
      return undefined;
    }
    const field = stringValue(call.arguments[0]);
    if (field) return ruleFieldType(module, call.arguments[0], subject, field, diagnostics);
  }
  if (call && name === "literal" && call.arguments.length === 1 && call.arguments[0]) {
    const literal = staticJson(call.arguments[0]);
    if (literal !== undefined) return ruleLiteralType(literal);
  }
  return undefined;
}

function ruleFieldType(
  module: SchemaModule,
  node: ts.Expression,
  subject: RuleSubject | undefined,
  field: string,
  diagnostics: FrontendDiagnostic[],
): RuleType | undefined {
  const kind = ruleTypeFromDescriptor(subject?.columns[field]);
  if (kind) return kind;
  diagnostics.push(ruleTypeDiagnostic(
    module, node,
    `rule references unknown or untyped field ${field} on ${subject?.label ?? "its unresolved outer subject"}`,
  ));
  return undefined;
}

function ruleTypeFromDescriptor(value: unknown): RuleType | undefined {
  if (value === "Principal") return { kind: "principal" };
  if (value === "Id") return { kind: "id" };
  if (value === "Int") return { kind: "int" };
  if (value === "Bool") return { kind: "bool" };
  if (value === "Time") return { kind: "time" };
  if (value === "Scalar") return { kind: "scalar" };
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const descriptor = value as Record<string, any>;
  if (descriptor.Ref && typeof descriptor.Ref.table === "string") return { kind: "ref", table: descriptor.Ref.table };
  if (descriptor.Text) return { kind: "text" };
  if (descriptor.Json) return { kind: "json" };
  if (descriptor.Enum && Array.isArray(descriptor.Enum.variants)) {
    return { kind: "enum", variants: [...descriptor.Enum.variants] };
  }
  if (descriptor.Decimal && typeof descriptor.Decimal.scale === "number") {
    return { kind: "decimal", scale: descriptor.Decimal.scale };
  }
  if (descriptor.Money && typeof descriptor.Money.currency === "string" && typeof descriptor.Money.scale === "number") {
    return { kind: "money", currency: descriptor.Money.currency, scale: descriptor.Money.scale };
  }
  if ("Optional" in descriptor) {
    const inner = ruleTypeFromDescriptor(descriptor.Optional);
    return inner ? { kind: "optional", of: inner } : undefined;
  }
  if (descriptor.List) {
    const inner = ruleTypeFromDescriptor(descriptor.List.of ?? "Scalar");
    return inner ? { kind: "list", of: inner } : undefined;
  }
  return undefined;
}

function ruleLiteralType(value: unknown): RuleType {
  if (value === null) return { kind: "null-literal" };
  if (typeof value === "boolean") return { kind: "bool-literal" };
  if (typeof value === "number") return { kind: "int-literal" };
  if (typeof value === "string") return { kind: "text-literal", value };
  if (Array.isArray(value)) return { kind: "array-literal", values: value.map(ruleLiteralType) };
  return { kind: "json-literal" };
}

function compatible(left: RuleType, right: RuleType): boolean {
  if (sameRuleType(left, right)) return true;
  if (left.kind === "optional") return right.kind === "null-literal" || compatible(left.of, right);
  if (right.kind === "optional") return left.kind === "null-literal" || compatible(left, right.of);
  if (left.kind === "text" && right.kind === "text-literal") return true;
  if (right.kind === "text" && left.kind === "text-literal") return true;
  if (left.kind === "enum" && right.kind === "text-literal") return left.variants.includes(right.value);
  if (right.kind === "enum" && left.kind === "text-literal") return right.variants.includes(left.value);
  if (["int", "time"].includes(left.kind) && right.kind === "int-literal") return true;
  if (["int", "time"].includes(right.kind) && left.kind === "int-literal") return true;
  if (left.kind === "bool" && right.kind === "bool-literal") return true;
  if (right.kind === "bool" && left.kind === "bool-literal") return true;
  if (left.kind === "json" && jsonLiteral(right)) return true;
  if (right.kind === "json" && jsonLiteral(left)) return true;
  if (left.kind === "array-literal" && right.kind === "array-literal") {
    return left.values.every(jsonLiteral) && right.values.every(jsonLiteral);
  }
  if (left.kind === "list" && right.kind === "array-literal") {
    return right.values.every((value) => compatible(left.of, value));
  }
  if (right.kind === "list" && left.kind === "array-literal") {
    return left.values.every((value) => compatible(value, right.of));
  }
  return false;
}

function jsonLiteral(value: RuleType): boolean {
  if (["null-literal", "text-literal", "int-literal", "bool-literal", "json-literal"].includes(value.kind)) {
    return true;
  }
  return value.kind === "array-literal" && value.values.every(jsonLiteral);
}

function compatibleExists(
  actual: RuleType,
  expected: RuleType,
  targetTable: string,
  targetColumn: string,
): boolean {
  return compatible(actual, expected)
    || (actual.kind === "ref" && actual.table === targetTable
      && expected.kind === "id" && targetColumn === "id");
}

function compatibleFinalExists(
  actual: RuleType,
  expected: RuleType,
  sourceTable: string,
  targetTable: string,
  targetColumn: string,
  term: ts.Expression,
): boolean {
  if (compatibleExists(actual, expected, targetTable, targetColumn)) return true;
  const expectedRef = expected.kind === "ref"
    ? expected.table
    : expected.kind === "optional" && expected.of.kind === "ref"
      ? expected.of.table
      : undefined;
  const call = unwrapCall(term);
  return actual.kind === "id"
    && expectedRef === sourceTable
    && callLeaf(call) === "field"
    && stringValue(call?.arguments[0]) === "id";
}

function sameRuleType(left: RuleType, right: RuleType): boolean {
  if (left.kind !== right.kind) return false;
  if (left.kind === "ref" && right.kind === "ref") return left.table === right.table;
  if (left.kind === "enum" && right.kind === "enum") {
    return JSON.stringify(left.variants) === JSON.stringify(right.variants);
  }
  if (left.kind === "decimal" && right.kind === "decimal") return left.scale === right.scale;
  if (left.kind === "money" && right.kind === "money") {
    return left.currency === right.currency && left.scale === right.scale;
  }
  if (left.kind === "optional" && right.kind === "optional") return sameRuleType(left.of, right.of);
  if (left.kind === "list" && right.kind === "list") return sameRuleType(left.of, right.of);
  if (left.kind === "array-literal" && right.kind === "array-literal") {
    return left.values.length === right.values.length
      && left.values.every((value, index) => sameRuleType(value, right.values[index]!));
  }
  return true;
}

function ruleTypeLabel(value: RuleType): string {
  switch (value.kind) {
    case "principal": return "Principal";
    case "id": return "Id";
    case "ref": return `Ref<${value.table}>`;
    case "text": return "Text";
    case "int": return "Int";
    case "bool": return "Bool";
    case "time": return "Time";
    case "json": return "Json";
    case "enum": return `Enum<${value.variants.join("|")}>`;
    case "decimal": return `Decimal<${value.scale}>`;
    case "money": return `Money<${value.currency},${value.scale}>`;
    case "optional": return `Optional<${ruleTypeLabel(value.of)}>`;
    case "list": return `List<${ruleTypeLabel(value.of)}>`;
    case "scalar": return "Scalar";
    case "null-literal": return "null literal";
    case "text-literal": return `text literal ${JSON.stringify(value.value)}`;
    case "int-literal": return "integer literal";
    case "bool-literal": return "boolean literal";
    case "array-literal": return "array literal";
    case "json-literal": return "json literal";
  }
}

function ruleTypeDiagnostic(
  module: SchemaModule,
  node: ts.Node,
  message: string,
): FrontendDiagnostic {
  return diagnostic(module, "E_RULE_INVALID", node, message, RULE_TYPE_REWRITE);
}
