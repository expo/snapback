import ts from "typescript";
import { diagnostic } from "../diagnostics";
import type { FrontendDiagnostic, SchemaJson, Value } from "../ir";
import type { TableInfo } from "../compiler";
import { hasExport, propertyName, unwrapCall, unwrapExpression } from "../syntax";
import {
  booleanValue,
  callLeaf,
  numberValue,
  objectOf,
  property,
  propertyEntries,
  staticJson,
  stringArray,
  stringValue,
} from "./static";

// @ref LLP 1002#2-the-authored-surface-the-snapback2-module — schema descriptors lower by exported name; id/byId are implicit.

type SchemaModule = { sourceFile: ts.SourceFile; source: string; fileName: string };
type LoweredSchema = {
  schema: SchemaJson;
  tables: Map<string, TableInfo>;
  channels: Set<string>;
  diagnostics: FrontendDiagnostic[];
};

export function lowerSchema(source: string, fileName: string): LoweredSchema {
  const sourceFile = ts.createSourceFile(fileName, source, ts.ScriptTarget.ES2022, true);
  const module = { sourceFile, source, fileName };
  const diagnostics: FrontendDiagnostic[] = [];
  const tableCalls = new Map<string, ts.CallExpression>();
  const channelCalls = new Map<string, ts.CallExpression>();
  let defaultCall: ts.CallExpression | undefined;

  for (const statement of sourceFile.statements) {
    if (ts.isExportAssignment(statement) && !statement.isExportEquals) {
      const call = unwrapCall(statement.expression);
      if (call && callLeaf(call) === "schema") defaultCall = call;
      else diagnostics.push(schemaDiagnostic(module, "E_SCHEMA_DEFAULT_EXPORT", statement, "schema.ts must default-export schema({...})"));
      continue;
    }
    if (!ts.isVariableStatement(statement) || !hasExport(statement)) continue;
    for (const declaration of statement.declarationList.declarations) {
      if (!ts.isIdentifier(declaration.name) || !declaration.initializer) continue;
      const call = unwrapCall(declaration.initializer);
      if (!call) continue;
      if (callLeaf(call) === "table") tableCalls.set(declaration.name.text, call);
      if (callLeaf(call) === "channel") channelCalls.set(declaration.name.text, call);
    }
  }

  if (!defaultCall) {
    diagnostics.push(schemaDiagnostic(module, "E_SCHEMA_DEFAULT_EXPORT", sourceFile, "schema.ts must default-export schema({...})"));
  }

  const tables = new Map<string, TableInfo>();
  for (const name of tableCalls.keys()) {
    if (name.startsWith("_")) {
      diagnostics.push(schemaDiagnostic(module, "E_SCHEMA_RESERVED", tableCalls.get(name)!, `table ${name} uses the reserved _ prefix`));
    }
    tables.set(name, { name, private: true });
  }

  const tableJson: Record<string, unknown> = {};
  for (const [name, call] of tableCalls) {
    const lowered = lowerTable(module, name, call, tables, diagnostics);
    if (lowered) {
      tableJson[name] = lowered.value;
      tables.set(name, { name, private: lowered.private });
    }
  }

  const channelJson: Record<string, unknown> = {};
  for (const [name, call] of channelCalls) {
    const lowered = lowerChannel(module, call, tables, diagnostics);
    if (lowered) channelJson[name] = lowered;
  }

  const root = defaultCall ? objectOf(defaultCall.arguments[0]) : undefined;
  if (defaultCall && !root) {
    diagnostics.push(schemaDiagnostic(module, "E_SCHEMA_DEFAULT_EXPORT", defaultCall, "schema() requires one object literal"));
  }
  if (root) validateRootRefs(module, root, "tables", tableCalls, diagnostics);
  if (root) validateRootRefs(module, root, "channels", channelCalls, diagnostics);

  const maintains = root ? lowerMaintains(module, property(root, "maintains"), tables, diagnostics) : [];
  for (const item of maintains) {
    const value = item as { source: string; target: string };
    const info = tables.get(value.target);
    if (info) info.maintainedFrom = value.source;
  }
  const authObject = root && objectOf(property(root, "auth"));
  const auth = {
    password: booleanValue(authObject && property(authObject, "password")) ?? false,
    guests: booleanValue(authObject && property(authObject, "guests")) ?? false,
  };

  return {
    schema: { tables: tableJson, maintains, channels: channelJson, auth, effects: [] },
    tables,
    channels: new Set(channelCalls.keys()),
    diagnostics,
  };
}

function lowerTable(
  module: SchemaModule,
  name: string,
  call: ts.CallExpression,
  tables: Map<string, TableInfo>,
  diagnostics: FrontendDiagnostic[],
): { value: unknown; private: boolean } | undefined {
  const config = objectOf(call.arguments[0]);
  if (!config) {
    diagnostics.push(schemaDiagnostic(module, "E_SCHEMA_INVALID", call, `table ${name} requires an object literal`));
    return undefined;
  }
  const columnsObject = objectOf(property(config, "columns"));
  if (!columnsObject) {
    diagnostics.push(schemaDiagnostic(module, "E_SCHEMA_INVALID", config, `table ${name} requires columns`));
    return undefined;
  }
  const columns: Record<string, unknown> = { id: "Id" };
  for (const entry of propertyEntries(columnsObject)) {
    const lowered = lowerColumn(module, entry.value, tables, diagnostics);
    if (lowered !== undefined) columns[entry.name] = lowered;
  }

  const indexes: Record<string, unknown> = { byId: { columns: ["id"], unique: true } };
  const indexesObject = objectOf(property(config, "indexes"));
  if (indexesObject) {
    for (const entry of propertyEntries(indexesObject)) {
      const value = objectOf(entry.value);
      const names = value && stringArray(property(value, "columns"));
      if (!value || !names) {
        diagnostics.push(schemaDiagnostic(module, "E_SCHEMA_INVALID", entry.node, `index ${name}.${entry.name} requires columns`));
        continue;
      }
      for (const column of names) {
        if (!(column in columns)) {
          diagnostics.push(schemaDiagnostic(module, "E_SCHEMA_INDEX_COLUMN", entry.node, `index ${name}.${entry.name} names unknown column ${column}`));
        }
      }
      indexes[entry.name] = { columns: names, unique: booleanValue(property(value, "unique")) ?? false };
    }
  }

  const rulesObject = objectOf(property(config, "rules"));
  const rules: Record<string, unknown> = {};
  for (const side of ["read", "insert", "update", "delete"]) {
    const node = rulesObject && property(rulesObject, side);
    rules[side] = node ? lowerRule(module, node, tables, diagnostics) ?? "Deny" : "Deny";
  }
  const constraints = lowerConstraints(module, property(config, "constraints"), indexes, diagnostics);
  return { value: { columns, indexes, rules, constraints }, private: !isPublicRule(rules.read) };
}

function lowerColumn(
  module: SchemaModule,
  node: ts.Expression,
  tables: Map<string, TableInfo>,
  diagnostics: FrontendDiagnostic[],
): unknown | undefined {
  const call = unwrapCall(node);
  const name = call && callLeaf(call);
  if (!call || !name) {
    diagnostics.push(schemaDiagnostic(module, "E_SCHEMA_INVALID", node, "column type must be a t.* descriptor"));
    return undefined;
  }
  if (name === "id") return "Id";
  if (name === "int") return "Int";
  if (name === "bool") return "Bool";
  if (name === "time") return "Time";
  if (name === "text") {
    const max = numberValue(call.arguments[0]);
    if (max !== undefined) return { Text: { max } };
  }
  if (name === "json") {
    const maxBytes = numberValue(call.arguments[0]);
    if (maxBytes !== undefined) return { Json: { max_bytes: maxBytes } };
  }
  if (name === "ref") {
    const target = call.arguments[0];
    const table = target && ts.isIdentifier(unwrapExpression(target)) ? (unwrapExpression(target) as ts.Identifier).text : undefined;
    if (!table || !tables.has(table)) {
      diagnostics.push(schemaDiagnostic(module, "E_SCHEMA_UNKNOWN_TABLE", target ?? call, `unknown table ${table ?? target?.getText() ?? "<missing>"}`));
      return undefined;
    }
    return { Ref: { table: tables.get(table)!.name } };
  }
  if (name === "optional" && call.arguments[0]) {
    const inner = lowerColumn(module, call.arguments[0], tables, diagnostics);
    return inner === undefined ? undefined : { Optional: inner };
  }
  if (name === "list" && call.arguments[0]) {
    const inner = lowerColumn(module, call.arguments[0], tables, diagnostics);
    const options = objectOf(call.arguments[1]);
    const max = options && numberValue(property(options, "max"));
    if (inner !== undefined && max !== undefined) return { List: { of: inner, max } };
  }
  diagnostics.push(schemaDiagnostic(module, "E_SCHEMA_INVALID", node, `invalid t.${name} column descriptor`));
  return undefined;
}

function lowerRule(
  module: SchemaModule,
  node: ts.Expression,
  tables: Map<string, TableInfo>,
  diagnostics: FrontendDiagnostic[],
): unknown | undefined {
  const call = unwrapCall(node);
  const name = call && callLeaf(call);
  if (!call || !name) {
    diagnostics.push(ruleDiagnostic(module, node, "rule must be a rule.* descriptor"));
    return undefined;
  }
  if (name === "public") return { Public: { reason: stringValue(call.arguments[0]) ?? "" } };
  if (name === "allow") return "Allow";
  if (name === "deny") return "Deny";
  if (name === "principal") return { PrincipalKind: stringValue(call.arguments[0]) ?? "" };
  if (name === "viewerIs") return { Eq: [{ Field: stringValue(call.arguments[0]) ?? "" }, "Viewer"] };
  if (name === "eq" || name === "ne") {
    const left = call.arguments[0] && lowerTerm(module, call.arguments[0], diagnostics);
    const right = call.arguments[1] && lowerTerm(module, call.arguments[1], diagnostics);
    if (left !== undefined && right !== undefined) return { [name === "eq" ? "Eq" : "Ne"]: [left, right] };
  }
  if (name === "and" || name === "or") {
    const values = call.arguments.map((item) => lowerRule(module, item, tables, diagnostics)).filter((item) => item !== undefined);
    return { [name === "and" ? "And" : "Or"]: values };
  }
  if (name === "not" && call.arguments[0]) {
    const value = lowerRule(module, call.arguments[0], tables, diagnostics);
    return value === undefined ? undefined : { Not: value };
  }
  if (name === "exists") {
    const target = call.arguments[0];
    const tableName = target && ts.isIdentifier(unwrapExpression(target)) ? (unwrapExpression(target) as ts.Identifier).text : undefined;
    if (!tableName || !tables.has(tableName)) {
      diagnostics.push(schemaDiagnostic(module, "E_SCHEMA_UNKNOWN_TABLE", target ?? call, `unknown table ${tableName ?? "<missing>"}`));
      return undefined;
    }
    const index = stringValue(call.arguments[1]);
    const keyNode = call.arguments[2] && unwrapExpression(call.arguments[2]);
    if (!index || !keyNode || !ts.isArrayLiteralExpression(keyNode)) {
      diagnostics.push(ruleDiagnostic(module, call, "rule.exists requires table, index, and a key array"));
      return undefined;
    }
    const key = keyNode.elements.map((item) => lowerTerm(module, item, diagnostics)).filter((item) => item !== undefined);
    const options = objectOf(call.arguments[3]);
    const hidden = booleanValue(options && property(options, "hidden")) ?? false;
    return {
      Exists: {
        table: tables.get(tableName)!.name,
        index,
        key,
        provenance: ruleProvenance(key),
        input_visibility: hidden ? "Hidden" : "Readable",
      },
    };
  }
  diagnostics.push(ruleDiagnostic(module, node, `unsupported rule.${name}`));
  return undefined;
}

function lowerTerm(module: SchemaModule, node: ts.Expression, diagnostics: FrontendDiagnostic[]): unknown | undefined {
  const value = unwrapExpression(node);
  if (ts.isPropertyAccessExpression(value) && value.expression.getText() === "rule" && value.name.text === "viewer") return "Viewer";
  const call = unwrapCall(value);
  const name = call && callLeaf(call);
  if (call && name === "field") return { Field: stringValue(call.arguments[0]) ?? "" };
  if (call && name === "literal" && call.arguments[0]) {
    const literal = staticJson(call.arguments[0]);
    if (literal !== undefined) return { Literal: encodeValue(literal) };
  }
  diagnostics.push(ruleDiagnostic(module, node, "rule term must be field(), viewer, or literal()"));
  return undefined;
}

function lowerConstraints(
  module: SchemaModule,
  node: ts.Expression | undefined,
  indexes: Record<string, unknown>,
  diagnostics: FrontendDiagnostic[],
): unknown[] {
  const value = node && unwrapExpression(node);
  if (!value) return [];
  if (!ts.isArrayLiteralExpression(value)) {
    diagnostics.push(schemaDiagnostic(module, "E_SCHEMA_INVALID", value, "constraints must be an array"));
    return [];
  }
  const output: unknown[] = [];
  for (const item of value.elements) {
    const object = objectOf(item);
    if (!object) continue;
    const unique = stringValue(property(object, "unique"));
    if (unique) {
      if (!(unique in indexes)) diagnostics.push(schemaDiagnostic(module, "E_SCHEMA_INDEX_COLUMN", item, `constraint names unknown index ${unique}`));
      output.push({ Unique: { index: unique } });
      continue;
    }
    const cap = objectOf(property(object, "cap"));
    if (cap) {
      const by = stringArray(property(cap, "by"));
      const max = numberValue(property(cap, "max"));
      if (by && max !== undefined) output.push({ Cap: { by, max } });
      continue;
    }
    if (booleanValue(property(object, "appendOnly"))) output.push("AppendOnly");
    const immutable = stringArray(property(object, "immutable"));
    if (immutable) output.push({ Immutable: { fields: immutable } });
  }
  return output;
}

function lowerMaintains(
  module: SchemaModule,
  node: ts.Expression | undefined,
  tables: Map<string, TableInfo>,
  diagnostics: FrontendDiagnostic[],
): unknown[] {
  const value = node && unwrapExpression(node);
  if (!value) return [];
  if (!ts.isArrayLiteralExpression(value)) {
    diagnostics.push(schemaDiagnostic(module, "E_SCHEMA_INVALID", value, "maintains must be an array"));
    return [];
  }
  const output: unknown[] = [];
  for (const item of value.elements) {
    const object = objectOf(item);
    if (!object) continue;
    const count = stringValue(property(object, "count"));
    const sumObject = objectOf(property(object, "sum"));
    const source = count ?? (sumObject && stringValue(property(sumObject, "source")));
    const target = stringValue(property(object, "into"));
    const by = stringArray(property(object, "by"));
    if (!source || !target || !by || !tables.has(source) || !tables.has(target)) {
      diagnostics.push(schemaDiagnostic(module, "E_SCHEMA_UNKNOWN_TABLE", item, "maintain names an unknown source or target table"));
      continue;
    }
    const readableNode = property(object, "readable");
    output.push({
      kind: count ? "Count" : { Sum: { of: stringValue(sumObject && property(sumObject, "of")) ?? "" } },
      source,
      by,
      target,
      readable: readableNode ? lowerRule(module, readableNode, tables, diagnostics) ?? null : null,
    });
  }
  return output;
}

function lowerChannel(
  module: SchemaModule,
  call: ts.CallExpression,
  tables: Map<string, TableInfo>,
  diagnostics: FrontendDiagnostic[],
): unknown | undefined {
  const config = objectOf(call.arguments[0]);
  const argsObject = config && objectOf(property(config, "args"));
  if (!config || !argsObject) {
    diagnostics.push(schemaDiagnostic(module, "E_SCHEMA_INVALID", call, "channel requires args, publish, subscribe, and ttlMs"));
    return undefined;
  }
  const args: Record<string, unknown> = {};
  for (const entry of propertyEntries(argsObject)) args[entry.name] = lowerArgDescriptor(entry.value);
  const publishNode = property(config, "publish");
  const subscribeNode = property(config, "subscribe");
  const ttl = numberValue(property(config, "ttlMs"));
  if (!publishNode || !subscribeNode || ttl === undefined) {
    diagnostics.push(schemaDiagnostic(module, "E_SCHEMA_INVALID", config, "channel requires publish, subscribe, and ttlMs"));
    return undefined;
  }
  return {
    args,
    publish: lowerRule(module, publishNode, tables, diagnostics) ?? "Deny",
    subscribe: lowerRule(module, subscribeNode, tables, diagnostics) ?? "Deny",
    ttl_ms: ttl,
  };
}

export function lowerArgDescriptor(node: ts.Expression): unknown {
  const call = unwrapCall(node);
  if (call && callLeaf(call) === "list") {
    const options = objectOf(call.arguments[1]);
    return { List: { max: numberValue(options && property(options, "max")) ?? 0 } };
  }
  return "Scalar";
}

function validateRootRefs(
  module: SchemaModule,
  root: ts.ObjectLiteralExpression,
  field: string,
  declarations: Map<string, ts.CallExpression>,
  diagnostics: FrontendDiagnostic[],
): void {
  const object = objectOf(property(root, field));
  if (!object) {
    if (declarations.size > 0) diagnostics.push(schemaDiagnostic(module, "E_SCHEMA_INVALID", root, `schema() must list its ${field}`));
    return;
  }
  const included = new Set<string>();
  for (const entry of propertyEntries(object)) {
    const value = unwrapExpression(entry.value);
    const exported = ts.isIdentifier(value) ? value.text : undefined;
    if (!exported || !declarations.has(exported)) {
      diagnostics.push(schemaDiagnostic(module, "E_SCHEMA_UNKNOWN_TABLE", entry.node, `${field} entry ${entry.name} is not a named schema export`));
    } else if (entry.name !== exported) {
      diagnostics.push(schemaDiagnostic(module, "E_SCHEMA_INVALID", entry.node, `${field} entry ${entry.name} must use its export name ${exported}`));
    } else {
      included.add(exported);
    }
  }
  for (const [name, call] of declarations) {
    if (!included.has(name)) diagnostics.push(schemaDiagnostic(module, "E_SCHEMA_INVALID", call, `${field} omits exported ${name}`));
  }
}

function encodeValue(value: unknown): Value {
  if (value === null) return "Null";
  if (typeof value === "boolean") return { Bool: value };
  if (typeof value === "number") return { Int: value };
  if (typeof value === "string") return { String: value };
  if (Array.isArray(value)) return { Array: value.map(encodeValue) };
  return { Row: Object.fromEntries(Object.entries(value as Record<string, unknown>).map(([key, item]) => [key, encodeValue(item)])) };
}

function ruleProvenance(key: unknown[]): "Arg" | "Viewer" | "Const" | "Shape" | "Computed" {
  if (key.some((item) => typeof item === "object" && item !== null && "Field" in item)) return "Shape";
  if (key.some((item) => item === "Viewer")) return "Viewer";
  if (key.every((item) => typeof item === "object" && item !== null && "Literal" in item)) return "Const";
  return "Computed";
}

function isPublicRule(value: unknown): boolean {
  return typeof value === "object" && value !== null && "Public" in value;
}

function schemaDiagnostic(
  module: SchemaModule,
  code: "E_SCHEMA_RESERVED" | "E_SCHEMA_UNKNOWN_TABLE" | "E_SCHEMA_INDEX_COLUMN" | "E_SCHEMA_DEFAULT_EXPORT" | "E_SCHEMA_INVALID",
  node: ts.Node,
  message: string,
): FrontendDiagnostic {
  return diagnostic(module, code, node, message, module.source);
}

function ruleDiagnostic(module: SchemaModule, node: ts.Node, message: string): FrontendDiagnostic {
  return diagnostic(module, "E_RULE_INVALID", node, message, module.source);
}
