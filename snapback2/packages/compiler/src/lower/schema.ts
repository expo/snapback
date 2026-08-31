import ts from "typescript";
import { authoredTypeFromColumn } from "../authored-types";
import { diagnostic } from "../diagnostics";
import { IR_CONTRACT, type FrontendDiagnostic, type SchemaJson, type Value } from "../ir";
import type { TableInfo } from "../compiler";
import { hasExport, propertyName, staticMemberPath, unwrapCall, unwrapExpression } from "../syntax";
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
import { validateMaintainRuleTypes, validateRuleTypes } from "./rule-types";

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
      tables.set(name, { name, private: lowered.private, columns: lowered.columns });
    }
  }

  const channelJson: Record<string, unknown> = {};
  for (const [name, call] of channelCalls) {
    const lowered = lowerChannel(module, call, tables, diagnostics);
    if (lowered) channelJson[name] = lowered;
  }

  validateRuleTypes(module, tableCalls, channelCalls, tableJson, channelJson, diagnostics);

  const root = defaultCall ? objectOf(defaultCall.arguments[0]) : undefined;
  if (defaultCall && !root) {
    diagnostics.push(schemaDiagnostic(module, "E_SCHEMA_DEFAULT_EXPORT", defaultCall, "schema() requires one object literal"));
  }
  if (root) {
    validateKnownKeys(module, root, ["auth", "tables", "maintains", "channels"], "schema", "E_SCHEMA_INVALID", diagnostics);
    validateRootRefs(module, root, "tables", tableCalls, diagnostics);
    validateRootRefs(module, root, "channels", channelCalls, diagnostics);
  }

  const maintains = root ? lowerMaintains(module, property(root, "maintains"), tables, diagnostics) : [];
  if (root) validateMaintainRuleTypes(module, property(root, "maintains"), tableJson, diagnostics);
  for (const item of maintains) {
    const value = item as { source: string; target: string };
    const info = tables.get(value.target);
    if (info) info.maintainedFrom = value.source;
  }
  const authObject = root && objectOf(property(root, "auth"));
  if (authObject) validateKnownKeys(module, authObject, ["password", "guests"], "auth", "E_SCHEMA_INVALID", diagnostics);
  if (root && property(root, "auth") && !authObject) {
    diagnostics.push(schemaDiagnostic(module, "E_SCHEMA_INVALID", property(root, "auth")!, "auth must be an object"));
  }
  for (const key of ["password", "guests"]) {
    const node = authObject && property(authObject, key);
    if (node && booleanValue(node) === undefined) {
      diagnostics.push(schemaDiagnostic(module, "E_SCHEMA_INVALID", node, `auth.${key} must be boolean`));
    }
  }
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
): { value: unknown; private: boolean; columns: Record<string, ReturnType<typeof authoredTypeFromColumn>> } | undefined {
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
  validateKnownKeys(module, config, ["columns", "indexes", "rules", "constraints"], `table ${name}`, "E_SCHEMA_INVALID", diagnostics);
  validateRecordShape(module, columnsObject, `columns for ${name}`, "E_SCHEMA_INVALID", diagnostics);
  const columns: Record<string, unknown> = { id: "Id" };
  for (const entry of propertyEntries(columnsObject)) {
    if (entry.name === "id") {
      diagnostics.push(schemaDiagnostic(module, "E_SCHEMA_ID_RESERVED", entry.node, `column ${name}.id is implicit; remove it`));
      continue;
    }
    const lowered = lowerColumn(module, entry.value, tables, diagnostics);
    if (lowered !== undefined) columns[entry.name] = lowered;
  }

  const indexes: Record<string, unknown> = { byId: { columns: ["id"], unique: true } };
  const indexesObject = objectOf(property(config, "indexes"));
  if (property(config, "indexes") && !indexesObject) {
    diagnostics.push(schemaDiagnostic(module, "E_SCHEMA_INVALID", property(config, "indexes")!, `indexes for ${name} must be an object`));
  }
  if (indexesObject) {
    validateRecordShape(module, indexesObject, `indexes for ${name}`, "E_SCHEMA_INVALID", diagnostics);
    for (const entry of propertyEntries(indexesObject)) {
      const value = objectOf(entry.value);
      const names = value && stringArray(property(value, "columns"));
      if (!value || !names) {
        diagnostics.push(schemaDiagnostic(module, "E_SCHEMA_INVALID", entry.node, `index ${name}.${entry.name} requires columns`));
        continue;
      }
      if (names.length === 0 || new Set(names).size !== names.length) {
        diagnostics.push(schemaDiagnostic(module, "E_SCHEMA_INDEX_COLUMN", entry.node, `index ${name}.${entry.name} columns must be non-empty and unique`));
      }
      const before = diagnostics.length;
      validateKnownKeys(module, value, ["columns", "unique"], `index ${name}.${entry.name}`, "E_SCHEMA_INDEX_OPTION", diagnostics);
      const uniqueNode = property(value, "unique");
      const unique = uniqueNode ? booleanValue(uniqueNode) : false;
      if (uniqueNode && unique === undefined) {
        diagnostics.push(schemaDiagnostic(module, "E_SCHEMA_INDEX_OPTION", uniqueNode, `index ${name}.${entry.name} unique must be boolean`));
      }
      if (entry.name === "byId") {
        if (names.length !== 1 || names[0] !== "id" || unique !== true || diagnostics.length !== before) {
          diagnostics.push(schemaDiagnostic(module, "E_SCHEMA_ID_RESERVED", entry.node, `index ${name}.byId is implicit as { columns: ['id'], unique: true }; remove or match it`));
        }
        continue;
      }
      for (const column of names) {
        if (!(column in columns)) {
          diagnostics.push(schemaDiagnostic(module, "E_SCHEMA_INDEX_COLUMN", entry.node, `index ${name}.${entry.name} names unknown column ${column}`));
        }
      }
      indexes[entry.name] = { columns: names, unique: unique ?? false };
    }
  }

  const rulesObject = objectOf(property(config, "rules"));
  if (property(config, "rules") && !rulesObject) {
    diagnostics.push(ruleDiagnostic(module, property(config, "rules")!, `rules for ${name} must be an object`));
  }
  if (rulesObject) validateKnownKeys(module, rulesObject, ["read", "insert", "update", "delete"], `rules for ${name}`, "E_RULE_INVALID", diagnostics);
  const rules: Record<string, unknown> = {};
  for (const side of ["read", "insert", "update", "delete"]) {
    const node = rulesObject && property(rulesObject, side);
    rules[side] = node ? lowerRule(module, node, tables, diagnostics) ?? "Deny" : "Deny";
  }
  const constraints = lowerConstraints(module, property(config, "constraints"), columns, indexes, diagnostics);
  return {
    value: { columns, indexes, rules, constraints },
    private: !isPublicRule(rules.read),
    columns: Object.fromEntries(Object.entries(columns).map(([column, value]) => [column, authoredTypeFromColumn(value)])),
  };
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
    const detail = invalidDescriptorRefusal(node);
    diagnostics.push(schemaDiagnostic(module, "E_SCHEMA_COLUMN", detail.node, detail.message, detail.rewrite));
    return undefined;
  }
  if (name === "id" && call.arguments.length === 0) return "Id";
  if (name === "principal" && call.arguments.length === 0) return "Principal";
  if (name === "int" && call.arguments.length === 0) return "Int";
  if (name === "bool" && call.arguments.length === 0) return "Bool";
  if (name === "time" && call.arguments.length === 0) return "Time";
  if (name === "enum" && call.arguments.length === 1) {
    const variants = stringArray(call.arguments[0]);
    if (validEnumVariants(variants)) {
      return { Enum: { variants } };
    }
  }
  if (name === "decimal" && call.arguments.length === 1) {
    const scale = numberValue(call.arguments[0]);
    if (validScale(scale)) return { Decimal: { scale } };
  }
  if (name === "money" && (call.arguments.length === 1 || call.arguments.length === 2)) {
    const currency = stringValue(call.arguments[0]);
    const scale = call.arguments[1] ? numberValue(call.arguments[1]) : 2;
    if (currency && /^[A-Z]{3}$/.test(currency) && validScale(scale)) {
      return { Money: { currency, scale } };
    }
  }
  if (name === "text") {
    const max = numberValue(call.arguments[0]);
    if (call.arguments.length === 1 && validPositiveInteger(max)) return { Text: { max } };
  }
  if (name === "json") {
    const maxBytes = numberValue(call.arguments[0]);
    if (call.arguments.length === 1 && validPositiveInteger(maxBytes)) return { Json: { max_bytes: maxBytes } };
  }
  if (name === "ref" && call.arguments.length === 1) {
    const target = call.arguments[0];
    const table = target && ts.isIdentifier(unwrapExpression(target)) ? (unwrapExpression(target) as ts.Identifier).text : undefined;
    if (!table || !tables.has(table)) {
      diagnostics.push(schemaDiagnostic(module, "E_SCHEMA_UNKNOWN_TABLE", target ?? call, `unknown table ${table ?? target?.getText() ?? "<missing>"}`));
      return undefined;
    }
    return { Ref: { table: tables.get(table)!.name } };
  }
  if (name === "optional" && call.arguments.length === 1 && call.arguments[0]) {
    const inner = lowerColumn(module, call.arguments[0], tables, diagnostics);
    return inner === undefined ? undefined : { Optional: inner };
  }
  if (name === "list" && call.arguments.length === 2 && call.arguments[0]) {
    const inner = lowerColumn(module, call.arguments[0], tables, diagnostics);
    if (inner === undefined) return undefined;
    const options = objectOf(call.arguments[1]);
    const max = options && numberValue(property(options, "max"));
    if (options) validateKnownKeys(module, options, ["max"], "list options", "E_SCHEMA_INVALID", diagnostics);
    if (inner !== undefined && validPositiveInteger(max)) return { List: { of: inner, max } };
  }
  const detail = invalidDescriptorRefusal(node);
  diagnostics.push(schemaDiagnostic(module, "E_SCHEMA_COLUMN", detail.node, detail.message, detail.rewrite));
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
  if (name === "public" && call.arguments.length === 1 && stringValue(call.arguments[0])) {
    return { Public: { reason: stringValue(call.arguments[0])! } };
  }
  if (name === "allow" && call.arguments.length === 0) return "Allow";
  if (name === "deny" && call.arguments.length === 0) return "Deny";
  if (name === "system" && call.arguments.length === 0) {
    return { Eq: ["Viewer", { Literal: { Id: IR_CONTRACT.systemPrincipalId } }] };
  }
  if (name === "viewerIs" && call.arguments.length === 1 && stringValue(call.arguments[0])) {
    return { Eq: [{ Field: stringValue(call.arguments[0])! }, "Viewer"] };
  }
  if ((name === "eq" || name === "ne") && call.arguments.length === 2) {
    const left = call.arguments[0] && lowerTerm(module, call.arguments[0], diagnostics);
    const right = call.arguments[1] && lowerTerm(module, call.arguments[1], diagnostics);
    if (left !== undefined && right !== undefined) return { [name === "eq" ? "Eq" : "Ne"]: [left, right] };
  }
  if (name === "and" || name === "or") {
    if (call.arguments.length === 0) {
      diagnostics.push(ruleDiagnostic(module, node, `rule.${name} requires at least one rule`));
      return undefined;
    }
    const values = call.arguments.map((item) => lowerRule(module, item, tables, diagnostics)).filter((item) => item !== undefined);
    return { [name === "and" ? "And" : "Or"]: values };
  }
  if (name === "not" && call.arguments.length === 1 && call.arguments[0]) {
    const value = lowerRule(module, call.arguments[0], tables, diagnostics);
    return value === undefined ? undefined : { Not: value };
  }
  if ((name === "exists" || name === "created") && call.arguments.length === 3) {
    const target = call.arguments[0];
    const tableName = target && ts.isIdentifier(unwrapExpression(target)) ? (unwrapExpression(target) as ts.Identifier).text : undefined;
    if (!tableName || !tables.has(tableName)) {
      diagnostics.push(schemaDiagnostic(module, "E_SCHEMA_UNKNOWN_TABLE", target ?? call, `unknown table ${tableName ?? "<missing>"}`));
      return undefined;
    }
    const index = stringValue(call.arguments[1]);
    const keyNode = call.arguments[2] && unwrapExpression(call.arguments[2]);
    if (!index || !keyNode || !ts.isArrayLiteralExpression(keyNode)) {
      diagnostics.push(ruleDiagnostic(module, call, `rule.${name} requires table, index, and a key array`));
      return undefined;
    }
    const loweredTerms = keyNode.elements.map((item) => lowerTerm(module, item, diagnostics));
    if (loweredTerms.some((item) => item === undefined)) return undefined;
    const key = loweredTerms as unknown[];
    return {
      [name === "exists" ? "Exists" : "Created"]: {
        table: tables.get(tableName)!.name,
        index,
        key,
        provenance: ruleProvenance(key),
      },
    };
  }
  if (name === "exists" && call.arguments.length === 4) {
    diagnostics.push(ruleDiagnostic(
      module,
      call.arguments[3]!,
      "rule.exists visibility is derived from the referenced table policy; remove the options argument",
    ));
    return undefined;
  }
  diagnostics.push(ruleDiagnostic(module, node, `unsupported rule.${name}`));
  return undefined;
}

function lowerTerm(module: SchemaModule, node: ts.Expression, diagnostics: FrontendDiagnostic[]): unknown | undefined {
  const value = unwrapExpression(node);
  if (ts.isPropertyAccessExpression(value) && value.expression.getText() === "rule" && value.name.text === "viewer") return "Viewer";
  const call = unwrapCall(value);
  const name = call && callLeaf(call);
  if (call && name === "field" && call.arguments.length === 1 && stringValue(call.arguments[0])) {
    return { Field: stringValue(call.arguments[0])! };
  }
  if (call && (name === "oldField" || name === "nextField")
    && call.arguments.length === 1 && stringValue(call.arguments[0])) {
    return { [name === "oldField" ? "OldField" : "NextField"]: stringValue(call.arguments[0])! };
  }
  if (call && name === "literal" && call.arguments[0]) {
    const fractional = findFractionalLiteral(call.arguments[0]);
    if (fractional) {
      diagnostics.push(diagnostic(
        module,
        "E_DECIMAL_SCALE",
        fractional,
        `fractional literal ${fractional.text} has no Decimal target in a rule literal`,
        module.source.slice(0, fractional.getStart(module.sourceFile)) + fractional.text.replace(".", "") + module.source.slice(fractional.getEnd()),
      ));
      return undefined;
    }
    const literal = staticJson(call.arguments[0]);
    if (literal !== undefined) return { Literal: encodeValue(literal) };
  }
  diagnostics.push(ruleDiagnostic(module, node, "rule term must be field(), oldField(), nextField(), viewer, or literal()"));
  return undefined;
}

function findFractionalLiteral(node: ts.Node): ts.NumericLiteral | undefined {
  let found: ts.NumericLiteral | undefined;
  const visit = (value: ts.Node) => {
    if (found) return;
    if (ts.isNumericLiteral(value) && value.text.includes(".")) found = value;
    else ts.forEachChild(value, visit);
  };
  visit(node);
  return found;
}

function lowerConstraints(
  module: SchemaModule,
  node: ts.Expression | undefined,
  columns: Record<string, unknown>,
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
    if (!object) {
      diagnostics.push(schemaDiagnostic(module, "E_SCHEMA_CONSTRAINT", item, "constraint must be an object with exactly one supported form"));
      continue;
    }
    const entries = propertyEntries(object);
    if (entries.length !== 1 || object.properties.length !== 1) {
      diagnostics.push(schemaDiagnostic(module, "E_SCHEMA_CONSTRAINT", item, "constraint must have exactly one of unique, cap, appendOnly, immutable, text, or finalExistsOnInsert"));
      continue;
    }
    const unique = stringValue(property(object, "unique"));
    if (unique) {
      if (!(unique in indexes)) diagnostics.push(schemaDiagnostic(module, "E_SCHEMA_INDEX_COLUMN", item, `constraint names unknown index ${unique}`));
      output.push({ Unique: { index: unique } });
      continue;
    }
    const cap = objectOf(property(object, "cap"));
    if (cap) {
      validateKnownKeys(module, cap, ["by", "max"], "cap constraint", "E_SCHEMA_CONSTRAINT", diagnostics);
      const by = stringArray(property(cap, "by"));
      const max = numberValue(property(cap, "max"));
      if (by && by.length > 0 && max !== undefined && Number.isInteger(max) && max > 0) {
        for (const field of by) {
          if (!(field in columns)) diagnostics.push(schemaDiagnostic(module, "E_SCHEMA_CONSTRAINT", item, `cap constraint names unknown column ${field}`));
        }
        output.push({ Cap: { by, max } });
      } else {
        diagnostics.push(schemaDiagnostic(module, "E_SCHEMA_CONSTRAINT", item, "cap constraint requires non-empty by and a positive integer max"));
      }
      continue;
    }
    if (property(object, "appendOnly")) {
      if (booleanValue(property(object, "appendOnly")) === true) output.push("AppendOnly");
      else diagnostics.push(schemaDiagnostic(module, "E_SCHEMA_CONSTRAINT", item, "appendOnly constraint must be true"));
      continue;
    }
    const immutable = stringArray(property(object, "immutable"));
    if (immutable && immutable.length > 0) {
      for (const field of immutable) {
        if (!(field in columns)) diagnostics.push(schemaDiagnostic(module, "E_SCHEMA_CONSTRAINT", item, `immutable constraint names unknown column ${field}`));
      }
      output.push({ Immutable: { fields: immutable } });
      continue;
    }
    const text = objectOf(property(object, "text"));
    if (text) {
      validateKnownKeys(module, text, ["field", "min", "format"], "text constraint", "E_SCHEMA_CONSTRAINT", diagnostics);
      const field = stringValue(property(text, "field"));
      const min = property(text, "min") ? numberValue(property(text, "min")) : 0;
      const format = property(text, "format") ? stringValue(property(text, "format")) : undefined;
      if (!field || !(field in columns)) {
        diagnostics.push(schemaDiagnostic(module, "E_SCHEMA_CONSTRAINT", item, `text constraint names unknown column ${field ?? "<missing>"}`));
        continue;
      }
      const max = textDescriptorMax(columns[field]);
      if (max === undefined) {
        diagnostics.push(schemaDiagnostic(module, "E_SCHEMA_CONSTRAINT", item, `text constraint names non-text column ${field}`));
        continue;
      }
      if (min === undefined || !Number.isInteger(min) || min < 0) {
        diagnostics.push(schemaDiagnostic(module, "E_SCHEMA_CONSTRAINT", item, "text constraint min must be a non-negative integer"));
        continue;
      }
      if (min > max) {
        diagnostics.push(schemaDiagnostic(module, "E_SCHEMA_CONSTRAINT", item, `text constraint min ${min} exceeds ${field}'s maximum ${max}`));
        continue;
      }
      if (format !== undefined && format !== "handle" && format !== "url") {
        diagnostics.push(schemaDiagnostic(module, "E_SCHEMA_CONSTRAINT", item, "text constraint format must be handle or url"));
        continue;
      }
      if (min === 0 && format === undefined) {
        diagnostics.push(schemaDiagnostic(module, "E_SCHEMA_CONSTRAINT", item, "text constraint must declare min or format"));
        continue;
      }
      output.push({ Text: { field, min, ...(format === undefined ? {} : { format }) } });
      continue;
    }
    // @ref LLP 1002#2-the-authored-surface-the-snapback2-module — the static table name breaks the source/target declaration cycle without weakening deferred catalog checks.
    const finalNode = property(object, "finalExistsOnInsert");
    if (finalNode) {
      const finalExists = objectOf(finalNode);
      if (!finalExists) {
        diagnostics.push(schemaDiagnostic(
          module,
          "E_SCHEMA_CONSTRAINT",
          finalNode,
          "finalExistsOnInsert must be an object with table, index, and key",
          finalExistsRewrite(),
        ));
        continue;
      }
      validateKnownKeys(module, finalExists, ["table", "index", "key"], "finalExistsOnInsert constraint", "E_SCHEMA_CONSTRAINT", diagnostics);
      const table = stringValue(property(finalExists, "table"));
      const index = stringValue(property(finalExists, "index"));
      const keyNode = property(finalExists, "key") && unwrapExpression(property(finalExists, "key")!);
      if (!table || !index || !keyNode || !ts.isArrayLiteralExpression(keyNode)) {
        diagnostics.push(schemaDiagnostic(
          module,
          "E_SCHEMA_CONSTRAINT",
          finalExists,
          "finalExistsOnInsert requires a static table-name string, index string, and key array",
          finalExistsRewrite(),
        ));
        continue;
      }
      const loweredTerms = keyNode.elements.map((term) => lowerTerm(module, term, diagnostics));
      if (loweredTerms.some((term) => term === undefined)) continue;
      output.push({ FinalExistsOnInsert: { table, index, key: loweredTerms } });
      continue;
    }
    diagnostics.push(schemaDiagnostic(module, "E_SCHEMA_CONSTRAINT", item, "unknown or malformed constraint; use unique, cap, appendOnly, immutable, text, or finalExistsOnInsert"));
  }
  return output;
}

function textDescriptorMax(value: unknown): number | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const descriptor = value as Record<string, any>;
  if (descriptor.Text && typeof descriptor.Text.max === "number") return descriptor.Text.max;
  return "Optional" in descriptor ? textDescriptorMax(descriptor.Optional) : undefined;
}

function finalExistsRewrite(): string {
  return '{ finalExistsOnInsert: { table: "memberships", index: "byConversationPrincipalRole", key: [rule.field("id"), rule.field("creatorId"), rule.literal("admin")] } }';
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
    if (!object) {
      diagnostics.push(schemaDiagnostic(module, "E_SCHEMA_MAINTAIN", item, "maintain must be an object"));
      continue;
    }
    validateKnownKeys(module, object, ["count", "sum", "by", "into", "readable"], "maintain", "E_SCHEMA_MAINTAIN", diagnostics);
    const count = stringValue(property(object, "count"));
    const sumObject = objectOf(property(object, "sum"));
    if (sumObject) validateKnownKeys(module, sumObject, ["source", "of"], "sum maintain", "E_SCHEMA_MAINTAIN", diagnostics);
    const source = count ?? (sumObject && stringValue(property(sumObject, "source")));
    const target = stringValue(property(object, "into"));
    const by = stringArray(property(object, "by"));
    const validKind = !!count !== !!sumObject;
    const sumField = sumObject && stringValue(property(sumObject, "of"));
    if (!validKind || !source || !target || !by || by.length === 0 || (sumObject && !sumField)) {
      diagnostics.push(schemaDiagnostic(module, "E_SCHEMA_MAINTAIN", item, "maintain requires exactly one count/sum form, non-empty by, and into"));
      continue;
    }
    if (!tables.has(source) || !tables.has(target)) {
      diagnostics.push(schemaDiagnostic(module, "E_SCHEMA_UNKNOWN_TABLE", item, "maintain names an unknown source or target table"));
      continue;
    }
    const sourceColumns = tables.get(source)?.columns ?? {};
    for (const field of by) {
      if (!(field in sourceColumns)) diagnostics.push(schemaDiagnostic(module, "E_SCHEMA_MAINTAIN", item, `maintain names unknown source column ${field}`));
    }
    if (sumField && !(sumField in sourceColumns)) {
      diagnostics.push(schemaDiagnostic(module, "E_SCHEMA_MAINTAIN", item, `sum maintain names unknown source column ${sumField}`));
    }
    const readableNode = property(object, "readable");
    output.push({
      kind: count ? "Count" : { Sum: { of: sumField! } },
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
  validateKnownKeys(module, config, ["args", "publish", "subscribe", "ttlMs"], "channel", "E_SCHEMA_INVALID", diagnostics);
  validateRecordShape(module, argsObject, "channel args", "E_SCHEMA_INVALID", diagnostics);
  const args: Record<string, unknown> = {};
  for (const entry of propertyEntries(argsObject)) {
    const lowered = lowerArgDescriptor(entry.value, tables);
    if (lowered === undefined) {
      diagnostics.push(schemaDiagnostic(module, "E_SCHEMA_INVALID", entry.node, `invalid channel argument descriptor ${entry.name}`));
    } else {
      args[entry.name] = lowered;
    }
  }
  const publishNode = property(config, "publish");
  const subscribeNode = property(config, "subscribe");
  const ttl = numberValue(property(config, "ttlMs"));
  if (!publishNode || !subscribeNode || !validPositiveInteger(ttl)) {
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

export function lowerArgDescriptor(
  node: ts.Expression,
  tables?: Map<string, TableInfo>,
): unknown | undefined {
  const call = unwrapCall(node);
  if (call && callLeaf(call) === "list") {
    const options = objectOf(call.arguments[1]);
    const max = numberValue(options && property(options, "max"));
    const known = options && propertyEntries(options).every((entry) => entry.name === "max")
      && options.properties.length === propertyEntries(options).length;
    const of = call.arguments[0] && lowerArgDescriptor(call.arguments[0], tables);
    return call.arguments.length === 2 && of !== undefined && known && validPositiveInteger(max)
      ? { List: { of, max } }
      : undefined;
  }
  if (call && callLeaf(call) === "optional" && call.arguments[0]) {
    const inner = lowerArgDescriptor(call.arguments[0], tables);
    return call.arguments.length === 1 && inner !== undefined ? { Optional: inner } : undefined;
  }
  if (call && callLeaf(call) === "enum") {
    const variants = stringArray(call.arguments[0]);
    return call.arguments.length === 1 && validEnumVariants(variants)
      ? { Enum: { variants } }
      : undefined;
  }
  if (call && callLeaf(call) === "decimal") {
    const scale = numberValue(call.arguments[0]);
    return call.arguments.length === 1 && validScale(scale) ? { Decimal: { scale } } : undefined;
  }
  if (call && callLeaf(call) === "money") {
    const currency = stringValue(call.arguments[0]);
    const scale = call.arguments[1] ? numberValue(call.arguments[1]) : 2;
    return (call.arguments.length === 1 || call.arguments.length === 2) && currency && /^[A-Z]{3}$/.test(currency) && validScale(scale)
      ? { Money: { currency, scale } }
      : undefined;
  }
  if (!call || !validArgDescriptor(node)) return undefined;
  switch (callLeaf(call)) {
    case "id": return "Id";
    case "principal": return "Principal";
    case "ref": {
      if (!tables) return "Id";
      const path = call.arguments[0] && staticMemberPath(call.arguments[0]);
      const table = path && tables.get(path);
      return table ? { Ref: { table: table.name } } : undefined;
    }
    case "int": return "Int";
    case "bool": return "Bool";
    case "time": return "Time";
    case "text": return { Text: { max: numberValue(call.arguments[0]) } };
    case "json": return { Json: { max_bytes: numberValue(call.arguments[0]) } };
    default: return undefined;
  }
}

export function lowerLegacyArgDescriptor(node: ts.Expression): unknown | undefined {
  const call = unwrapCall(node);
  if (!call) return undefined;
  const options = callLeaf(call) === "list" && objectOf(call.arguments[1]);
  const max = options && numberValue(property(options, "max"));
  return typeof max === "number" ? { List: { max } } : "Scalar";
}

function validArgDescriptor(node: ts.Expression): boolean {
  const call = unwrapCall(node);
  const name = call && callLeaf(call);
  if (!call || !name) return false;
  if (["id", "principal", "int", "bool", "time"].includes(name)) return call.arguments.length === 0;
  if (name === "text" || name === "json") return call.arguments.length === 1 && validPositiveInteger(numberValue(call.arguments[0]));
  if (name === "ref") return call.arguments.length === 1;
  if (name === "optional") return call.arguments.length === 1 && !!call.arguments[0] && validArgDescriptor(call.arguments[0]);
  if (name === "enum") {
    const variants = stringArray(call.arguments[0]);
    return call.arguments.length === 1 && validEnumVariants(variants);
  }
  if (name === "decimal") return call.arguments.length === 1 && validScale(numberValue(call.arguments[0]));
  if (name === "money") {
    const currency = stringValue(call.arguments[0]);
    const scale = call.arguments[1] ? numberValue(call.arguments[1]) : 2;
    return (call.arguments.length === 1 || call.arguments.length === 2) && !!currency && /^[A-Z]{3}$/.test(currency) && validScale(scale);
  }
  if (name === "list") return lowerArgDescriptor(node) !== undefined;
  return false;
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
  if (key.some((item) => typeof item === "object" && item !== null
    && ["Field", "OldField", "NextField"].some((term) => term in item))) return "Shape";
  if (key.some((item) => item === "Viewer")) return "Viewer";
  if (key.every((item) => typeof item === "object" && item !== null && "Literal" in item)) return "Const";
  return "Computed";
}

function isPublicRule(value: unknown): boolean {
  return typeof value === "object" && value !== null && "Public" in value;
}

function validScale(value: number | undefined): value is number {
  return value !== undefined && Number.isInteger(value) && value >= 0 && value <= 12;
}

function validEnumVariants(value: string[] | undefined): value is string[] {
  return !!value?.length && value.every((variant) => variant.length > 0) && new Set(value).size === value.length;
}

export function invalidDescriptorRefusal(node: ts.Expression): { node: ts.Expression; message: string; rewrite: string } {
  const call = unwrapCall(node);
  const name = call && callLeaf(call);
  if (call && (name === "optional" || name === "list") && call.arguments[0]
    && lowerArgDescriptor(call.arguments[0]) === undefined) {
    return invalidDescriptorRefusal(call.arguments[0]);
  }
  const callee = call?.expression.getText() ?? "t.text";
  const sibling = (descriptor: string) => {
    const dot = callee.lastIndexOf(".");
    return `${dot >= 0 ? callee.slice(0, dot + 1) : "t."}${descriptor}`;
  };
  if (name === "decimal") {
    const scale = correctedScale(numberValue(call!.arguments[0]));
    return { node, message: "t.decimal(scale) requires an integer scale from 0 through 12", rewrite: `${callee}(${scale})` };
  }
  if (name === "money") {
    const authored = stringValue(call!.arguments[0]);
    const currency = authored && /^[A-Za-z]{3}$/.test(authored) ? authored.toUpperCase() : "USD";
    const scale = call!.arguments[1] ? `, ${correctedScale(numberValue(call!.arguments[1]))}` : "";
    return {
      node,
      message: "t.money(currency, scale?) requires an uppercase ISO-4217-shaped three-letter currency and a scale from 0 through 12",
      rewrite: `${callee}(${JSON.stringify(currency)}${scale})`,
    };
  }
  if (name === "enum") {
    const variants = [...new Set((stringArray(call!.arguments[0]) ?? []).filter((variant) => variant.length > 0))];
    if (variants.length === 0) variants.push("value");
    return {
      node,
      message: "t.enum(variants) requires at least one unique, non-empty string variant",
      rewrite: `${callee}(${JSON.stringify(variants)})`,
    };
  }
  const rewrites: Record<string, string> = {
    id: `${callee}()`, principal: `${callee}()`, int: `${callee}()`, bool: `${callee}()`, time: `${callee}()`,
    text: `${callee}(100)`, json: `${callee}(1000)`, ref: `${callee}(table)`,
    optional: `${callee}(${sibling("text")}(100))`,
    list: `${callee}(${sibling("text")}(100), { max: 10 })`,
  };
  return {
    node,
    message: name ? `t.${name} arguments do not form a valid descriptor` : "column type must be a t.* descriptor",
    rewrite: rewrites[name ?? ""] ?? `${sibling("text")}(100)`,
  };
}

export function invalidNativeDescriptorRefusal(node: ts.Expression): ReturnType<typeof invalidDescriptorRefusal> | undefined {
  const call = unwrapCall(node);
  if (!call || !nativeDescriptorName(call)) return undefined;
  return invalidDescriptorRefusal(node);
}

function nativeDescriptorName(call: ts.CallExpression): string | undefined {
  const name = callLeaf(call);
  if (!name || !["id", "principal", "text", "int", "bool", "time", "ref", "json", "optional", "list", "enum", "decimal", "money"].includes(name)
    || !ts.isPropertyAccessExpression(call.expression)) return undefined;
  const owner = call.expression.expression.getText();
  if (owner === "t" || owner.endsWith(".t")) return name;
  for (const statement of call.getSourceFile().statements) {
    if (!ts.isImportDeclaration(statement) || !ts.isStringLiteral(statement.moduleSpecifier)
      || statement.moduleSpecifier.text !== "snapback2") continue;
    const bindings = statement.importClause?.namedBindings;
    if (bindings && ts.isNamedImports(bindings) && bindings.elements.some((item) =>
      (item.propertyName?.text ?? item.name.text) === "t" && item.name.text === owner)) return name;
  }
  return undefined;
}

function correctedScale(value: number | undefined): number {
  return value === undefined || !Number.isFinite(value) ? 2 : Math.max(0, Math.min(12, Math.trunc(value)));
}

function validPositiveInteger(value: number | undefined): value is number {
  return value !== undefined && Number.isInteger(value) && value > 0;
}

function validateRecordShape(
  module: SchemaModule,
  object: ts.ObjectLiteralExpression,
  label: string,
  code: "E_SCHEMA_INVALID" | "E_SCHEMA_INDEX_OPTION" | "E_SCHEMA_CONSTRAINT" | "E_SCHEMA_MAINTAIN" | "E_RULE_INVALID",
  diagnostics: FrontendDiagnostic[],
): void {
  if (propertyEntries(object).length !== object.properties.length) {
    diagnostics.push(schemaDiagnostic(module, code, object, `${label} uses an unsupported spread, method, or computed property`));
  }
}

function validateKnownKeys(
  module: SchemaModule,
  object: ts.ObjectLiteralExpression,
  allowed: string[],
  label: string,
  code: "E_SCHEMA_INVALID" | "E_SCHEMA_INDEX_OPTION" | "E_SCHEMA_CONSTRAINT" | "E_SCHEMA_MAINTAIN" | "E_RULE_INVALID",
  diagnostics: FrontendDiagnostic[],
): void {
  validateRecordShape(module, object, label, code, diagnostics);
  for (const entry of propertyEntries(object)) {
    if (!allowed.includes(entry.name)) {
      diagnostics.push(schemaDiagnostic(module, code, entry.node, `${label} has unknown option ${entry.name}; use ${allowed.join(", ")}`));
    }
  }
}

function schemaDiagnostic(
  module: SchemaModule,
  code: "E_SCHEMA_RESERVED" | "E_SCHEMA_ID_RESERVED" | "E_SCHEMA_UNKNOWN_TABLE" | "E_SCHEMA_INDEX_COLUMN"
    | "E_SCHEMA_INDEX_OPTION" | "E_SCHEMA_CONSTRAINT" | "E_SCHEMA_MAINTAIN" | "E_SCHEMA_DEFAULT_EXPORT"
    | "E_SCHEMA_COLUMN" | "E_SCHEMA_INVALID" | "E_RULE_INVALID",
  node: ts.Node,
  message: string,
  replacement?: string,
): FrontendDiagnostic {
  const rewrite = replacement ?? (code === "E_SCHEMA_ID_RESERVED"
    ? "columns: {}"
    : code === "E_SCHEMA_CONSTRAINT"
      ? "{ appendOnly: true }"
      : code === "E_SCHEMA_INDEX_OPTION"
        ? "indexes: {}"
        : code === "E_SCHEMA_MAINTAIN"
          ? "maintains: []"
          : schemaDeclarationRewrite(node));
  return diagnostic(module, code, node, message, rewrite);
}

function ruleDiagnostic(module: SchemaModule, node: ts.Node, message: string): FrontendDiagnostic {
  return diagnostic(module, "E_RULE_INVALID", node, message, "rule.deny()");
}

function schemaDeclarationRewrite(node: ts.Node): string {
  let current: ts.Node | undefined = node;
  while (current) {
    if (ts.isVariableDeclaration(current) && ts.isIdentifier(current.name)) {
      const call = current.initializer && unwrapCall(current.initializer);
      const kind = call && callLeaf(call);
      const callee = call?.expression.getText() ?? kind;
      if (kind === "channel") {
        const prefix = callee?.endsWith(".channel") ? callee.slice(0, -"channel".length) : "";
        return `export const ${current.name.text} = ${callee}({ args: {}, publish: ${prefix}rule.allow(), subscribe: ${prefix}rule.allow(), ttlMs: 4000 });`;
      }
      if (kind === "table") {
        const name = current.name.text.startsWith("_") ? "rows" : current.name.text;
        return `export const ${name} = ${callee}({ columns: {} });`;
      }
    }
    if (ts.isExportAssignment(current)) {
      const call = unwrapCall(current.expression);
      return `export default ${call?.expression.getText() ?? "schema"}({ tables: {} });`;
    }
    current = current.parent;
  }
  return "export default schema({ tables: {} });";
}
