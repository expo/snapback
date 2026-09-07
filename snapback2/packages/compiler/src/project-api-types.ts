import ts from "typescript";
import { expandArgumentObject } from "./args";
import { requiredType, type AuthoredType, type TableInfo } from "./authored-types";
import type { OperationDecl } from "./lower/effects";
import {
  callLeaf,
  numberValue,
  objectOf,
  property,
  propertyEntries,
  stringArray,
  stringValue,
} from "./lower/static";
import { hasExport, propertyName, staticMemberPath, unwrapCall, unwrapExpression } from "./syntax";

type ApiType = {
  text: string;
  special: boolean;
  fields?: Record<string, ApiType>;
  row?: TableInfo;
  element?: ApiType;
  optional?: boolean;
  groupedInArray?: boolean;
};

type ApiTypeBinding =
  | { kind: "args" }
  | { kind: "local"; row?: TableInfo; elementRow?: TableInfo; type?: ApiType };

type ApiTypeEnvironment = { bindings: Map<string, ApiTypeBinding> };

// @ref LLP 1002#3-the-compiler-worker-and-the-project-json — API declarations are inferred build output owned by the compiler pass.
export function generateApiDts(
  operations: Map<string, OperationDecl>,
  program: ts.Program,
  checker: ts.TypeChecker,
  tables: Map<string, TableInfo>,
  bindingsByModule: Map<string, Map<string, TableInfo>>,
): string {
  const grouped = new Map<string, string[]>();
  for (const operation of [...operations.values()].sort((left, right) => left.name.localeCompare(right.name))) {
    const checkedCall = checkedOperationCall(program, operation);
    const args = checkedCall?.arguments[0] && objectOf(checkedCall.arguments[0]);
    const argsText = args ? apiArgsType(args, checker, operation.kind === "mutation") : "{}";
    const handler = checkedCall?.arguments[1];
    let resultText = "unknown";
    if (handler && (ts.isArrowFunction(handler) || ts.isFunctionExpression(handler))) {
      const signature = checker.getSignatureFromDeclaration(handler);
      if (signature) {
        resultText = checker.typeToString(
          checker.getReturnTypeOfSignature(signature),
          handler,
          ts.TypeFormatFlags.NoTruncation | ts.TypeFormatFlags.InTypeAlias,
        ).replaceAll('import("snapback2").', "");
      }
      const tables = bindingsByModule.get(operation.moduleName) ?? new Map();
      const authored = apiAuthoredResult(handler, args, tables, checker);
      if (authored?.special) resultText = authored.text;
    }
    const items = grouped.get(operation.moduleName) ?? [];
    items.push(`      readonly ${quoteProperty(operation.exportName)}: Op<${argsText}, ${resultText}>;`);
    grouped.set(operation.moduleName, items);
  }
  const rowTypes = [...tables.values()]
    .sort((left, right) => left.name.localeCompare(right.name))
    .map(apiRowType)
    .join("\n");
  const channels = apiChannels(program, checker);
  const modulesText = [...grouped].sort(([left], [right]) => left.localeCompare(right))
    .filter(([name]) => name !== "channels" || channels.length === 0)
    .map(([name, items]) => `    readonly ${quoteProperty(name)}: {\n${items.join("\n")}\n    };`)
    .join("\n");
  const channelsText = channels.length === 0 ? "" : (() => {
    const channelByName = new Map(channels.map((item) => [item.name, item]));
    const channelOperations = [...operations.values()]
      .sort((left, right) => left.name.localeCompare(right.name))
      .filter((operation) => operation.moduleName === "channels");
    const operationItems = (grouped.get("channels") ?? []).map((item, index) => {
      const channel = channelByName.get(channelOperations[index]!.exportName);
      return channel ? item.replace(/;$/, ` & Channel<${channel.args}, unknown>;`) : item;
    });
    const operationNames = new Set(channelOperations.map((operation) => operation.exportName));
    const channelItems = channels
      .filter((item) => !operationNames.has(item.name))
      .map((item) => `${quoteProperty(item.name)}: Channel<${item.args}, unknown>`);
    const catalog = operationItems.length === 0
      ? `    readonly channels: { ${channelItems.join("; ")} };`
      : `    readonly channels: {\n${operationItems.join("\n")}\n${channelItems.map((item) => `      readonly ${item};`).join("\n")}\n    };`;
    const occupiedRoots = new Set([...grouped.keys(), "channels", "op", "then", "toJSON"]);
    const aliases = channels
      .filter((item) => !occupiedRoots.has(item.name))
      .map((item) => `    readonly ${quoteProperty(item.name)}: Channel<${item.args}, unknown>;`);
    return [catalog, ...aliases].join("\n");
  })();
  const members = [modulesText, channelsText].filter(Boolean).join("\n");
  return `import type { Bytes, Column, Cursor, Decimal, ImageAsset, Json, Money, Page, Principal, RowOfColumns, VideoAsset } from 'snapback2';\nimport type { Channel, Op } from 'snapback2/client';\n\n${rowTypes}\n\ndeclare module 'snapback2/client' {\n  interface Api {\n${members}\n  }\n}\n\nexport {};\n`;
}

function apiChannels(program: ts.Program, checker: ts.TypeChecker): Array<{ name: string; args: string }> {
  const schema = program.getSourceFiles().find((item) => /[/\\]snapback[/\\]schema\.ts$/.test(item.fileName));
  if (!schema) return [];
  const channels: Array<{ name: string; args: string }> = [];
  for (const statement of schema.statements) {
    if (!ts.isVariableStatement(statement) || !hasExport(statement)) continue;
    for (const declaration of statement.declarationList.declarations) {
      if (!ts.isIdentifier(declaration.name) || !declaration.initializer) continue;
      const call = unwrapCall(declaration.initializer);
      if (!call || callLeaf(call) !== "channel") continue;
      const config = objectOf(call.arguments[0]);
      const args = config && objectOf(property(config, "args"));
      channels.push({ name: declaration.name.text, args: args ? apiArgsType(args, checker, false) : "{}" });
    }
  }
  return channels.sort((left, right) => left.name.localeCompare(right.name));
}

function apiRowType(table: TableInfo): string {
  const fields = Object.entries(table.columns ?? {}).map(([name, type]) => {
    const optional = type.kind === "optional";
    return `  ${quoteProperty(name)}${optional ? "?" : ""}: ${apiAuthoredType(optional ? type.of : type)};`;
  });
  if (!fields.some((field) => /^  id[?:]/.test(field))) fields.unshift("  id: string;");
  return `type ${apiRowName(table.name)} = {\n${fields.join("\n")}\n};`;
}

export function apiRowName(table: string): string {
  const pascal = table.split(/[^A-Za-z0-9]+/).filter(Boolean)
    .map((part) => part[0]!.toUpperCase() + part.slice(1))
    .join("");
  return `${pascal || "Table"}Row`;
}

function checkedOperationCall(program: ts.Program, operation: OperationDecl): ts.CallExpression | undefined {
  const file = program.getSourceFiles().find((item) => item.fileName.endsWith(`/snapback/${operation.moduleName}.ts`));
  if (!file) return undefined;
  for (const statement of file.statements) {
    if (!ts.isVariableStatement(statement) || !hasExport(statement)) continue;
    for (const declaration of statement.declarationList.declarations) {
      if (!ts.isIdentifier(declaration.name) || declaration.name.text !== operation.exportName || !declaration.initializer) continue;
      return unwrapCall(declaration.initializer);
    }
  }
  return undefined;
}

function apiArgsType(object: ts.ObjectLiteralExpression, checker: ts.TypeChecker, acceptFiles: boolean): string {
  const fields = expandArgumentObject(object).entries.map((entry) => {
    const call = unwrapCall(entry.value);
    const optional = call && callLeaf(call) === "optional";
    const type = call ? argumentDescriptorType(call, checker, acceptFiles) : "unknown";
    const brand = call && argumentBrand(call);
    const comment = brand ? `/** ${brand} — minor units */ ` : "";
    return `${comment}${quoteProperty(entry.name)}${optional ? "?" : ""}: ${type}`;
  });
  return fields.length === 0 ? "{}" : `{ ${fields.join("; ")} }`;
}

// @ref LLP 1004#money-and-decimal-worked-out-2026-09-03 — callers write integer minor units while results retain nominal brands.
function argumentDescriptorType(call: ts.CallExpression, checker: ts.TypeChecker, acceptFiles: boolean): string {
  const name = callLeaf(call);
  if ((name === "decimal" || name === "money")) return "number";
  if ((name === "optional" || name === "list") && call.arguments[0]) {
    const inner = unwrapCall(call.arguments[0]);
    const value = inner ? argumentDescriptorType(inner, checker, acceptFiles) : "unknown";
    return name === "list" ? `${value.includes(" | ") ? `(${value})` : value}[]` : `${value} | null`;
  }
  if (acceptFiles && (name === "image" || name === "video")) {
    // @ref LLP 1006#10-clients — File substitution is a generated mutation-call convenience; programs and results retain records.
    return `File | ${name === "image" ? "ImageAsset" : "VideoAsset"}`;
  }
  return descriptorType(call, checker);
}

function argumentBrand(call: ts.CallExpression): string | undefined {
  const name = callLeaf(call);
  if (name === "optional" && call.arguments[0]) {
    const inner = unwrapCall(call.arguments[0]);
    return inner && argumentBrand(inner);
  }
  if (name === "decimal") return `decimal ${numberValue(call.arguments[0]) ?? "?"}`;
  if (name === "money") {
    return `money ${stringValue(call.arguments[0]) ?? "?"} ${numberValue(call.arguments[1]) ?? 2}`;
  }
  return undefined;
}

function descriptorType(call: ts.CallExpression, checker: ts.TypeChecker): string {
  const name = callLeaf(call);
  if (name === "cursor") return "Cursor";
  if (name === "principal") return "Principal";
  if (name === "id" || name === "text" || name === "ref") return "string";
  if (name === "bytes") return "Bytes";
  if (name === "image") return "ImageAsset";
  if (name === "video") return "VideoAsset";
  if (name === "int" || name === "time") return "number";
  if (name === "bool") return "boolean";
  if (name === "enum") {
    const variants = stringArray(call.arguments[0]);
    return variants?.map((item) => JSON.stringify(item)).join(" | ") || "never";
  }
  if (name === "decimal") return `Decimal<${numberValue(call.arguments[0]) ?? "number"}>`;
  if (name === "money") {
    return `Money<${JSON.stringify(stringValue(call.arguments[0]) ?? "")}, ${numberValue(call.arguments[1]) ?? 2}>`;
  }
  if (name === "optional" && call.arguments[0]) {
    const inner = unwrapCall(call.arguments[0]);
    return inner ? descriptorType(inner, checker) : "unknown";
  }
  if (name === "list" && call.arguments[0]) {
    const inner = unwrapCall(call.arguments[0]);
    return `${inner ? descriptorType(inner, checker) : "unknown"}[]`;
  }
  if (name === "json") {
    const type = checker.getTypeAtLocation(call);
    const property = type.getProperty("__value");
    if (property) return checker.typeToString(checker.getTypeOfSymbolAtLocation(property, call), call, ts.TypeFormatFlags.NoTruncation);
  }
  return "unknown";
}

function apiAuthoredResult(
  handler: ts.ArrowFunction | ts.FunctionExpression,
  args: ts.ObjectLiteralExpression | undefined,
  tables: Map<string, TableInfo>,
  checker: ts.TypeChecker,
): ApiType | undefined {
  const environment: ApiTypeEnvironment = { bindings: new Map() };
  for (const parameter of handler.parameters) {
    for (const name of apiBindingNames(parameter.name)) environment.bindings.set(name, { kind: "local" });
  }
  const context = handler.parameters[0]?.name;
  if (context && ts.isObjectBindingPattern(context)) {
    for (const element of context.elements) {
      if (!ts.isIdentifier(element.name)) continue;
      const name = element.propertyName ? propertyName(element.propertyName) : element.name.text;
      if (name === "args") environment.bindings.set(element.name.text, { kind: "args" });
      if (name === "ctx") {
        const viewer = { text: "Principal", special: true };
        environment.bindings.set(element.name.text, {
          kind: "local",
          type: { text: "unknown", special: true, fields: { viewer } },
        });
      }
    }
  }
  if (!ts.isBlock(handler.body)) return apiExpressionType(handler.body, args, tables, checker, environment);
  const returns: ApiType[] = [];
  const terminated = apiStatements(handler.body.statements, args, tables, checker, environment, returns);
  const result = returns.reduce<ApiType | undefined>((current, item) => current ? apiUnionType(current, item) : item, undefined);
  return result && terminated && returns.length > 1 && !result.text.includes("unknown") ? { ...result, special: true } : result;
}

function apiStatements(
  statements: ts.NodeArray<ts.Statement> | readonly ts.Statement[],
  args: ts.ObjectLiteralExpression | undefined,
  tables: Map<string, TableInfo>,
  checker: ts.TypeChecker,
  environment: ApiTypeEnvironment,
  returns: ApiType[],
): boolean {
  for (const statement of statements) {
    if (apiStatement(statement, args, tables, checker, environment, returns)) return true;
  }
  return false;
}

function apiStatement(
  statement: ts.Statement,
  args: ts.ObjectLiteralExpression | undefined,
  tables: Map<string, TableInfo>,
  checker: ts.TypeChecker,
  environment: ApiTypeEnvironment,
  returns: ApiType[],
): boolean {
  if (ts.isVariableStatement(statement)) {
    for (const declaration of statement.declarationList.declarations) {
      const type = declaration.initializer
        ? apiExpressionType(declaration.initializer, args, tables, checker, environment)
        : undefined;
      for (const name of apiBindingNames(declaration.name)) {
        environment.bindings.set(name, apiLocalBinding(type));
      }
    }
    return false;
  }
  if (ts.isExpressionStatement(statement)) {
    apiExpressionEffect(statement.expression, args, tables, checker, environment);
    return false;
  }
  if (ts.isReturnStatement(statement) && statement.expression) {
    returns.push(apiExpressionType(statement.expression, args, tables, checker, environment));
    return true;
  }
  if (ts.isBlock(statement)) {
    return apiStatements(statement.statements, args, tables, checker, environment, returns);
  }
  if (ts.isIfStatement(statement)) {
    const before = apiCloneEnvironment(environment);
    const whenTrue = apiCloneEnvironment(before);
    const whenFalse = apiCloneEnvironment(before);
    apiNarrowNullGuard(statement.expression, whenTrue, whenFalse);
    const trueTerminates = apiStatement(statement.thenStatement, args, tables, checker, whenTrue, returns);
    const falseTerminates = statement.elseStatement
      ? apiStatement(statement.elseStatement, args, tables, checker, whenFalse, returns)
      : false;
    if (trueTerminates && falseTerminates) return true;
    apiMergeEnvironments(environment, before, [whenTrue, whenFalse]);
    return false;
  }
  if (ts.isForOfStatement(statement)) {
    const loop = apiCloneEnvironment(environment);
    const source = apiExpressionType(statement.expression, args, tables, checker, environment);
    if (ts.isVariableDeclarationList(statement.initializer)) {
      for (const declaration of statement.initializer.declarations) {
        for (const name of apiBindingNames(declaration.name)) loop.bindings.set(name, apiLocalBinding(source.element));
      }
    }
    apiStatement(statement.statement, args, tables, checker, loop, returns);
    apiMergeEnvironments(environment, environment, [environment, loop]);
    return false;
  }
  return false;
}

function apiExpressionEffect(
  node: ts.Expression,
  args: ts.ObjectLiteralExpression | undefined,
  tables: Map<string, TableInfo>,
  checker: ts.TypeChecker,
  environment: ApiTypeEnvironment,
): void {
  const value = unwrapExpression(node);
  if (ts.isBinaryExpression(value) && value.operatorToken.kind === ts.SyntaxKind.EqualsToken
    && ts.isIdentifier(unwrapExpression(value.left))) {
    const name = (unwrapExpression(value.left) as ts.Identifier).text;
    const type = apiExpressionType(value.right, args, tables, checker, environment);
    environment.bindings.set(name, apiLocalBinding(type));
    return;
  }
  if (!ts.isCallExpression(value) || !ts.isPropertyAccessExpression(value.expression)
    || value.expression.name.text !== "push" || value.arguments.length === 0) return;
  const receiver = unwrapExpression(value.expression.expression);
  if (!ts.isIdentifier(receiver)) return;
  const binding = environment.bindings.get(receiver.text);
  if (binding?.kind !== "local") return;
  const pushed = apiExpressionType(value.arguments[0]!, args, tables, checker, environment);
  const element = binding.type?.element ? apiUnionType(binding.type.element, pushed) : pushed;
  environment.bindings.set(receiver.text, apiLocalBinding(apiArrayType(element)));
}

function apiExpressionType(
  node: ts.Expression,
  args: ts.ObjectLiteralExpression | undefined,
  tables: Map<string, TableInfo>,
  checker: ts.TypeChecker,
  environment: ApiTypeEnvironment,
  expected?: AuthoredType,
): ApiType {
  const asserted = apiHasNonNullAssertion(node);
  const value = unwrapExpression(node);
  const target = expected && requiredType(expected);
  if (target?.kind === "decimal") return { text: apiAuthoredType(target), special: true };
  if (target?.kind === "enum" && ts.isStringLiteralLike(value)) return { text: apiAuthoredType(target), special: true };
  if (ts.isNumericLiteral(value)) return { text: "number", special: false };
  if (ts.isStringLiteralLike(value) || ts.isTemplateExpression(value)) return { text: "string", special: false };
  if (value.kind === ts.SyntaxKind.TrueKeyword || value.kind === ts.SyntaxKind.FalseKeyword) return { text: "boolean", special: false };
  if (value.kind === ts.SyntaxKind.NullKeyword) return { text: "null", special: false };
  if (ts.isIdentifier(value)) {
    const binding = environment.bindings.get(value.text);
    if (binding?.kind === "local" && binding.type) return asserted ? apiWithoutNull(binding.type) : binding.type;
  }
  if (ts.isPrefixUnaryExpression(value) && value.operator === ts.SyntaxKind.MinusToken) {
    return apiExpressionType(value.operand, args, tables, checker, environment);
  }
  const propertyBase = ts.isPropertyAccessExpression(value) ? unwrapExpression(value.expression) : undefined;
  const propertyBinding = propertyBase && ts.isIdentifier(propertyBase)
    ? environment.bindings.get(propertyBase.text)
    : undefined;
  if (ts.isPropertyAccessExpression(value) && propertyBase && ts.isIdentifier(propertyBase)
    && propertyBinding?.kind === "args" && args) {
    const descriptor = propertyEntries(args).find((item) => item.name === value.name.text)?.value;
    const call = descriptor && unwrapCall(descriptor);
    if (call) {
      const text = `${descriptorType(call, checker)}${callLeaf(call) === "optional" ? " | undefined" : ""}`;
      return { text, special: apiTypeIsSpecial(text) };
    }
  }
  if (ts.isPropertyAccessExpression(value) && propertyBase) {
    const base = propertyBinding?.kind === "local" && propertyBinding.type
      ? propertyBinding.type
      : apiExpressionType(propertyBase, args, tables, checker, environment);
    const field = apiTypeField(base, value.name.text);
    if (field) {
      const optionalChain = Boolean(value.questionDotToken) && apiIncludesNull(base);
      return optionalChain ? apiUnionType(field, { text: "undefined", special: true, optional: true }) : field;
    }
    if (value.name.text === "length" && base.element) return { text: "number", special: base.special };
  }
  if (ts.isObjectLiteralExpression(value)) {
    let special = false;
    const fields: string[] = [];
    const fieldTypes: Record<string, ApiType> = {};
    const rowSpreads: TableInfo[] = [];
    for (const item of value.properties) {
      if (ts.isSpreadAssignment(item)) {
        const spread = apiExpressionType(item.expression, args, tables, checker, environment);
        if (spread.row) {
          rowSpreads.push(spread.row);
          special = true;
        }
        continue;
      }
      if (ts.isShorthandPropertyAssignment(item)) {
        const type = apiExpressionType(item.name, args, tables, checker, environment);
        special ||= type.special;
        fields.push(apiObjectField(item.name.text, type));
        fieldTypes[item.name.text] = type;
        continue;
      }
      if (!ts.isPropertyAssignment(item)) continue;
      const name = propertyName(item.name);
      if (!name) continue;
      const type = apiExpressionType(item.initializer, args, tables, checker, environment);
      special ||= type.special;
      fields.push(apiObjectField(name, type));
      fieldTypes[name] = type;
    }
    const spreadRows = [...new Map(rowSpreads.map((row) => [row.name, row])).values()];
    const aliases = spreadRows.map((row) => {
      const collisions = Object.keys(fieldTypes)
        .filter((name) => name === "id" || Object.hasOwn(row.columns ?? {}, name));
      const alias = apiRowName(row.name);
      return collisions.length === 0
        ? alias
        : `Omit<${alias}, ${collisions.map((name) => JSON.stringify(name)).join(" | ")}>`;
    });
    const object = `{ ${fields.join("; ")} }`;
    const text = aliases.length === 0 ? object : [...aliases, ...(fields.length > 0 ? [object] : [])].join(" & ");
    return {
      text,
      special,
      fields: fieldTypes,
      ...(rowSpreads.length === 1 ? { row: rowSpreads[0] } : {}),
      groupedInArray: aliases.length + Number(fields.length > 0) > 1,
    };
  }
  if (ts.isArrayLiteralExpression(value)) {
    if (value.elements.length === 1 && ts.isSpreadElement(value.elements[0]!)) {
      const spread = apiExpressionType(value.elements[0]!.expression, args, tables, checker, environment);
      if (spread.element) return apiArrayType(spread.element);
    }
    const items = value.elements
      .filter((item): item is ts.Expression => !ts.isSpreadElement(item))
      .map((item) => apiExpressionType(item, args, tables, checker, environment));
    const element = items.reduce<ApiType | undefined>((result, item) => result ? apiUnionType(result, item) : item, undefined);
    return element ? apiArrayType(element) : { text: "unknown[]", special: false };
  }
  if (ts.isConditionalExpression(value)) {
    const left = apiExpressionType(value.whenTrue, args, tables, checker, environment, target);
    const right = apiExpressionType(value.whenFalse, args, tables, checker, environment, target);
    return apiUnionType(left, right);
  }
  if (ts.isBinaryExpression(value)) {
    const left = apiExpressionType(value.left, args, tables, checker, environment);
    const right = apiExpressionType(value.right, args, tables, checker, environment);
    if ([
      ts.SyntaxKind.LessThanToken, ts.SyntaxKind.LessThanEqualsToken, ts.SyntaxKind.GreaterThanToken,
      ts.SyntaxKind.GreaterThanEqualsToken, ts.SyntaxKind.EqualsEqualsToken, ts.SyntaxKind.EqualsEqualsEqualsToken,
      ts.SyntaxKind.ExclamationEqualsToken, ts.SyntaxKind.ExclamationEqualsEqualsToken,
    ].includes(value.operatorToken.kind)) return { text: "boolean", special: false };
    if (value.operatorToken.kind === ts.SyntaxKind.QuestionQuestionToken && (left.special || right.special)) {
      return { ...apiWithoutUndefined(left.special ? left : right), special: true };
    }
    const branded = [left, right].filter((item) => /^(Decimal|Money)</.test(item.text));
    if (value.operatorToken.kind === ts.SyntaxKind.AsteriskToken && branded.length > 0) {
      return branded.find((item) => item.text.startsWith("Money<")) ?? branded[0]!;
    }
    if (branded.length > 0 && [ts.SyntaxKind.PlusToken, ts.SyntaxKind.MinusToken]
      .includes(value.operatorToken.kind)) return branded[0]!;
  }
  if (ts.isCallExpression(value)) {
    const name = callLeaf(value);
    if ((name === "scan" || name === "get") && value.arguments[0]) {
      const table = apiTable(value.arguments[0], tables);
      if (table) {
        const row = apiNamedRowType(table);
        return name === "scan"
          ? { text: `Page<${row.text}>`, special: true, element: row }
          : apiUnionType(row, { text: "null", special: false });
      }
    }
    if (name === "decimal") {
      return { text: `Decimal<${numberValue(value.arguments[1]) ?? "number"}>`, special: true };
    }
    if (name === "recurse" && value.arguments[1]) {
      const row = apiRecurseRow(value.arguments[1], tables);
      if (row) return apiArrayType(apiNamedRowType(row));
    }
    if (name === "divmod" && value.arguments[0]) {
      const carried = apiExpressionType(value.arguments[0], args, tables, checker, environment);
      return {
        text: `{ quotient: ${carried.text}; remainder: ${carried.text} }`,
        special: carried.special,
        fields: { quotient: carried, remainder: carried },
      };
    }
    if (name === "deterministicShare" && value.arguments[0]) {
      return apiExpressionType(value.arguments[0], args, tables, checker, environment);
    }
    if (name === "min" || name === "max") {
      const branded = value.arguments.map((item) => apiExpressionType(item, args, tables, checker, environment))
        .find((item) => /^(Decimal|Money)</.test(item.text));
      if (branded) return branded;
    }
  }
  const text = checker.typeToString(
    checker.getTypeAtLocation(value),
    value,
    ts.TypeFormatFlags.NoTruncation | ts.TypeFormatFlags.InTypeAlias,
  ).replaceAll('import("snapback2").', "");
  return { text, special: apiTypeIsSpecial(text) };
}

function apiLocalBinding(type: ApiType | undefined): ApiTypeBinding {
  return {
    kind: "local",
    ...(type ? { type } : {}),
    ...(type?.row ? { row: type.row } : {}),
    ...(type?.element?.row ? { elementRow: type.element.row } : {}),
  };
}

function apiCloneEnvironment(environment: ApiTypeEnvironment): ApiTypeEnvironment {
  return {
    bindings: new Map([...environment.bindings].map(([name, binding]) => [
      name,
      binding.kind === "args" ? binding : { ...binding },
    ])),
  };
}

function apiMergeEnvironments(
  target: ApiTypeEnvironment,
  before: ApiTypeEnvironment,
  branches: ApiTypeEnvironment[],
): void {
  for (const [name, original] of before.bindings) {
    if (original.kind === "args") continue;
    const bindings = branches.map((branch) => branch.bindings.get(name)).filter((item): item is ApiTypeBinding => Boolean(item));
    const locals = bindings.filter((item): item is Extract<ApiTypeBinding, { kind: "local" }> => item.kind === "local");
    const types = locals.flatMap((binding) => binding.type ? [binding.type] : []);
    const type = types.reduce<ApiType | undefined>((result, item) => result ? apiUnionType(result, item) : item, undefined);
    target.bindings.set(name, apiLocalBinding(type));
  }
}

function apiNarrowNullGuard(condition: ts.Expression, whenTrue: ApiTypeEnvironment, whenFalse: ApiTypeEnvironment): void {
  const value = unwrapExpression(condition);
  if (!ts.isBinaryExpression(value)) return;
  const left = unwrapExpression(value.left);
  const right = unwrapExpression(value.right);
  const identifier = ts.isIdentifier(left) && right.kind === ts.SyntaxKind.NullKeyword
    ? left
    : ts.isIdentifier(right) && left.kind === ts.SyntaxKind.NullKeyword ? right : undefined;
  if (!identifier) return;
  const equal = value.operatorToken.kind === ts.SyntaxKind.EqualsEqualsToken
    || value.operatorToken.kind === ts.SyntaxKind.EqualsEqualsEqualsToken;
  const unequal = value.operatorToken.kind === ts.SyntaxKind.ExclamationEqualsToken
    || value.operatorToken.kind === ts.SyntaxKind.ExclamationEqualsEqualsToken;
  if (!equal && !unequal) return;
  const present = unequal ? whenTrue : whenFalse;
  const binding = present.bindings.get(identifier.text);
  if (binding?.kind === "local" && binding.type) present.bindings.set(identifier.text, apiLocalBinding(apiWithoutNull(binding.type)));
}

function apiNamedRowType(table: TableInfo): ApiType {
  return { text: apiRowName(table.name), special: true, row: table };
}

function apiTypeField(type: ApiType, name: string): ApiType | undefined {
  const explicit = type.fields?.[name];
  if (explicit) return explicit;
  if (!type.row) return undefined;
  if (name === "id") return { text: "string", special: true };
  const authored = type.row.columns?.[name];
  if (!authored) return undefined;
  const optional = authored.kind === "optional";
  return {
    text: `${apiAuthoredType(optional ? authored.of : authored)}${optional ? " | undefined" : ""}`,
    special: true,
    optional,
  };
}

function apiObjectField(name: string, type: ApiType): string {
  return `${quoteProperty(name)}${type.optional ? "?" : ""}: ${type.text}`;
}

function apiArrayType(element: ApiType): ApiType {
  return {
    text: `${element.groupedInArray ? `(${element.text})` : element.text}[]`,
    special: element.special,
    element,
  };
}

function apiUnionType(left: ApiType, right: ApiType): ApiType {
  if (left.text === right.text) return {
    ...left,
    special: left.special || right.special,
    optional: left.optional || right.optional,
  };
  if (left.text === "unknown[]" && !left.element && (right.element || right.text.endsWith("[]"))) return right;
  if (right.text === "unknown[]" && !right.element && (left.element || left.text.endsWith("[]"))) return left;
  if (left.element && right.element) return apiArrayType(apiUnionType(left.element, right.element));
  const items = [left, right].sort((a, b) => Number(apiNullishType(a)) - Number(apiNullishType(b)));
  const members = [...new Set(items.flatMap((item) => apiUnionMembers(item.text)))];
  const shaped = items.find((item) => item.fields || item.row);
  return {
    text: members.join(" | "),
    special: left.special || right.special,
    ...(shaped?.fields ? { fields: shaped.fields } : {}),
    ...(shaped?.row ? { row: shaped.row } : {}),
    optional: left.optional || right.optional,
    groupedInArray: true,
  };
}

function apiWithoutNull(type: ApiType): ApiType {
  return { ...type, text: apiRemoveUnionMember(type.text, "null") };
}

function apiWithoutUndefined(type: ApiType): ApiType {
  return { ...type, text: apiRemoveUnionMember(type.text, "undefined"), optional: false };
}

function apiRemoveUnionMember(text: string, member: string): string {
  const parts = apiUnionMembers(text).filter((item) => item !== member);
  return parts.join(" | ") || "never";
}

function apiIncludesNull(type: ApiType): boolean {
  return apiUnionMembers(type.text).includes("null");
}

function apiNullishType(type: ApiType): boolean {
  return type.text === "null" || type.text === "undefined";
}

function apiHasNonNullAssertion(node: ts.Expression): boolean {
  let value = node;
  while (ts.isParenthesizedExpression(value) || ts.isAsExpression(value)) value = value.expression;
  return ts.isNonNullExpression(value);
}

function apiUnionMembers(text: string): string[] {
  const members: string[] = [];
  let start = 0;
  let depth = 0;
  let quote = "";
  for (let index = 0; index < text.length; index += 1) {
    const character = text[index]!;
    if (quote) {
      if (character === quote && text[index - 1] !== "\\") quote = "";
      continue;
    }
    if (character === '"' || character === "'") {
      quote = character;
      continue;
    }
    if ("{[(<".includes(character)) depth += 1;
    else if ("}])>".includes(character)) depth -= 1;
    else if (depth === 0 && text.slice(index, index + 3) === " | ") {
      members.push(text.slice(start, index));
      start = index + 3;
      index += 2;
    }
  }
  members.push(text.slice(start));
  return members;
}

function apiRecurseRow(node: ts.Expression, tables: Map<string, TableInfo>): TableInfo | undefined {
  const callback = unwrapExpression(node);
  if (!ts.isArrowFunction(callback) && !ts.isFunctionExpression(callback)) return undefined;
  let row: TableInfo | undefined;
  const find = (item: ts.Node): void => {
    if (row) return;
    if (ts.isCallExpression(item) && callLeaf(item) === "get" && item.arguments[0]) {
      row = apiTable(item.arguments[0], tables);
      if (row) return;
    }
    ts.forEachChild(item, find);
  };
  find(callback.body);
  return row;
}

function apiBindingNames(name: ts.BindingName): string[] {
  if (ts.isIdentifier(name)) return [name.text];
  return name.elements.flatMap((element) => ts.isBindingElement(element) ? apiBindingNames(element.name) : []);
}

function apiAuthoredType(value: AuthoredType): string {
  if (value.kind === "int") return "number";
  if (value.kind === "string") return "string";
  if (value.kind === "principal") return "Principal";
  if (value.kind === "bytes") return "Bytes";
  if (value.kind === "asset") return value.asset === "image" ? "ImageAsset" : "VideoAsset";
  if (value.kind === "bool") return "boolean";
  if (value.kind === "json") return "Json";
  if (value.kind === "decimal") {
    return value.currency ? `Money<${JSON.stringify(value.currency)}, ${value.scale}>` : `Decimal<${value.scale}>`;
  }
  if (value.kind === "enum") return value.variants.map((item) => JSON.stringify(item)).join(" | ") || "never";
  if (value.kind === "list") return `${apiAuthoredType(value.of)}[]`;
  if (value.kind === "optional") return apiAuthoredType(value.of);
  if (value.kind === "row") return apiRowName(value.table);
  return "unknown";
}

function apiTypeIsSpecial(text: string): boolean {
  return /\b(?:Decimal|Money)</.test(text)
    || /\b(?:ImageAsset|VideoAsset)\b/.test(text)
    || text.includes(" | ");
}

function apiTable(node: ts.Expression, tables: Map<string, TableInfo>): TableInfo | undefined {
  const path = staticMemberPath(node);
  if (!path) return undefined;
  const direct = tables.get(path);
  if (direct) return direct;
  const separator = path.lastIndexOf(".");
  return separator > 0 ? tables.get(path.slice(0, separator)) : undefined;
}

function quoteProperty(value: string): string {
  return /^[A-Za-z_$][\w$]*$/.test(value) ? value : JSON.stringify(value);
}
