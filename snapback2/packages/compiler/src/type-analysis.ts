import ts from "typescript";
import { requiredType, sameDecimal, unknownType, type AuthoredType, type TableInfo } from "./authored-types";
import { diagnostic, type DiagnosticModule } from "./diagnostics";
import type { FrontendDiagnostic } from "./ir";
import { callName, isDb, isFunctionLike, propertyName, replaceNode, unwrapCall, unwrapExpression } from "./syntax";

// @ref LLP 1002#2-the-authored-surface-the-snapback2-module — Decimal target scales are compiler facts; the emitted value is integer minor units.

type FunctionLike = ts.FunctionDeclaration | ts.ArrowFunction | ts.FunctionExpression;
type TypeModule = DiagnosticModule & { tables: Map<string, TableInfo>; helpers?: Map<string, FunctionLike> };
type TypeEnvironment = { variables: Map<string, AuthoredType>; constants: Map<string, ts.Expression>; args: Record<string, AuthoredType> };

export type TypePlan = {
  diagnostics: FrontendDiagnostic[];
  literalValues: Map<number, number>;
};

export function analyzeOperationTypes(module: TypeModule, call: ts.CallExpression): TypePlan {
  const analyzer = new Analyzer(module);
  const argsObject = call.arguments[0] && unwrapExpression(call.arguments[0]);
  const args: Record<string, AuthoredType> = {};
  if (argsObject && ts.isObjectLiteralExpression(argsObject)) {
    for (const property of argsObject.properties) {
      if (!ts.isPropertyAssignment(property)) continue;
      const name = propertyName(property.name);
      if (name) args[name] = descriptorType(property.initializer);
    }
  }
  const handler = call.arguments[1];
  if (handler && isFunctionLike(handler)) {
    const env: TypeEnvironment = { variables: new Map(), constants: new Map(), args };
    if (ts.isBlock(handler.body)) analyzer.statements(handler.body.statements, env);
    else analyzer.expression(handler.body, env);
  }
  return { diagnostics: analyzer.diagnostics, literalValues: analyzer.literalValues };
}

class Analyzer {
  readonly diagnostics: FrontendDiagnostic[] = [];
  readonly literalValues = new Map<number, number>();
  private readonly seen = new Set<string>();

  constructor(private readonly module: TypeModule) {}

  statements(statements: readonly ts.Statement[], env: TypeEnvironment): void {
    for (const statement of statements) {
      if (this.diagnostics.length >= 50) return;
      this.statement(statement, env);
    }
  }

  private statement(statement: ts.Statement, env: TypeEnvironment): void {
    if (ts.isVariableStatement(statement)) {
      for (const declaration of statement.declarationList.declarations) {
        if (!declaration.initializer) continue;
        const type = this.expression(declaration.initializer, env);
        for (const name of bindingNames(declaration.name)) {
          env.variables.set(name, type);
          if ((statement.declarationList.flags & ts.NodeFlags.Const) !== 0) env.constants.set(name, declaration.initializer);
        }
      }
      return;
    }
    if (ts.isExpressionStatement(statement)) {
      this.expression(statement.expression, env);
      return;
    }
    if (ts.isReturnStatement(statement) && statement.expression) {
      this.expression(statement.expression, env);
      return;
    }
    if (ts.isIfStatement(statement)) {
      this.expression(statement.expression, env);
      this.controlled(statement.thenStatement, cloneEnv(env));
      if (statement.elseStatement) this.controlled(statement.elseStatement, cloneEnv(env));
      return;
    }
    if (ts.isForOfStatement(statement)) {
      const domain = this.expression(statement.expression, env);
      const loop = cloneEnv(env);
      if (ts.isVariableDeclarationList(statement.initializer)) {
        for (const declaration of statement.initializer.declarations) {
          for (const name of bindingNames(declaration.name)) {
            loop.variables.set(name, domain.kind === "list" ? domain.of : unknownType);
          }
        }
      }
      this.controlled(statement.statement, loop);
      return;
    }
    if (ts.isBlock(statement)) this.statements(statement.statements, env);
  }

  private controlled(statement: ts.Statement, env: TypeEnvironment): void {
    if (ts.isBlock(statement)) this.statements(statement.statements, env);
    else this.statement(statement, env);
  }

  expression(node: ts.Expression, env: TypeEnvironment, expected?: AuthoredType, quietFraction = false): AuthoredType {
    const value = unwrapExpression(node);
    const target = expected && requiredType(expected);
    if (ts.isNumericLiteral(value)) return this.numeric(value, target, quietFraction);
    if (ts.isStringLiteralLike(value)) {
      if (target?.kind === "enum" && !target.variants.includes(value.text)) this.enumVariant(value, target);
      return target?.kind === "enum" ? target : { kind: "string" };
    }
    if (value.kind === ts.SyntaxKind.TrueKeyword || value.kind === ts.SyntaxKind.FalseKeyword) return { kind: "bool" };
    if (value.kind === ts.SyntaxKind.NullKeyword) return unknownType;
    if (ts.isIdentifier(value)) {
      const constant = target && env.constants.get(value.text);
      return constant ? this.expression(constant, env, target) : env.variables.get(value.text) ?? unknownType;
    }
    if (ts.isPrefixUnaryExpression(value)) {
      return this.expression(value.operand, env, target, quietFraction);
    }
    if (ts.isPropertyAccessExpression(value)) {
      if (ts.isIdentifier(value.expression) && value.expression.text === "args") {
        return requiredType(env.args[value.name.text]);
      }
      const base = this.expression(value.expression, env, undefined, true);
      if (base.kind === "row") return requiredType(this.table(base.table)?.columns?.[value.name.text]);
      if ((base.kind === "list" || base.kind === "string") && value.name.text === "length") return { kind: "int" };
      return unknownType;
    }
    if (ts.isArrayLiteralExpression(value)) {
      const elementTarget = target?.kind === "list" ? target.of : undefined;
      const values = value.elements.map((item) => this.expression(item, env, elementTarget));
      return { kind: "list", of: commonType(values), max: values.length };
    }
    if (ts.isObjectLiteralExpression(value)) {
      const row = target?.kind === "row" ? this.table(target.table) : undefined;
      for (const property of value.properties) {
        if (ts.isSpreadAssignment(property)) {
          this.expression(property.expression, env);
          continue;
        }
        if (ts.isShorthandPropertyAssignment(property)) {
          this.expression(property.name, env, row?.columns?.[property.name.text]);
          continue;
        }
        if (!ts.isPropertyAssignment(property)) continue;
        const name = propertyName(property.name);
        const field = name ? row?.columns?.[name] ?? this.uniqueFieldType(name) : undefined;
        this.expression(property.initializer, env, field);
      }
      return target ?? unknownType;
    }
    if (ts.isConditionalExpression(value)) {
      this.expression(value.condition, env);
      const left = this.expression(value.whenTrue, env, target);
      const right = this.expression(value.whenFalse, env, target);
      return commonType([left, right]);
    }
    if (ts.isBinaryExpression(value)) return this.binary(value, env, target);
    if (ts.isCallExpression(value)) return this.call(value, env, target);
    if (ts.isArrowFunction(value) || ts.isFunctionExpression(value)) {
      const nested = cloneEnv(env);
      for (const parameter of value.parameters) {
        for (const name of bindingNames(parameter.name)) nested.variables.set(name, unknownType);
      }
      if (ts.isBlock(value.body)) this.statements(value.body.statements, nested);
      else this.expression(value.body, nested, target);
    }
    return target ?? unknownType;
  }

  private numeric(node: ts.NumericLiteral, expected: AuthoredType | undefined, quiet: boolean): AuthoredType {
    const digits = fractionalDigits(node.text);
    if (digits === 0) return { kind: "int" };
    if (expected?.kind !== "decimal") {
      if (!quiet) {
        const minor = node.text.replace(".", "");
        this.add("E_DECIMAL_SCALE", node, `fractional literal ${node.text} has ${digits} fractional digits but no Decimal scale`, replaceNode(this.module.source, node, minor));
      }
      return unknownType;
    }
    if (digits > expected.scale) {
      const minor = node.text.replace(".", "");
      this.add(
        "E_DECIMAL_SCALE",
        node,
        `${digits} fractional digits, scale ${expected.scale}; ${decimalName(expected)} cannot represent ${node.text}`,
        replaceNode(this.module.source, node, minor),
      );
      return expected;
    }
    const minor = scaledInteger(node.text, expected.scale);
    if (minor === undefined) {
      this.add("E_DECIMAL_SCALE", node, `${node.text} at scale ${expected.scale} is outside the safe integer wire range`, replaceNode(this.module.source, node, node.text.replace(".", "")));
    } else {
      this.literalValues.set(node.getStart(this.module.sourceFile), minor);
    }
    return expected;
  }

  private binary(node: ts.BinaryExpression, env: TypeEnvironment, expected?: AuthoredType): AuthoredType {
    let left = this.expression(node.left, env, undefined, true);
    let right = this.expression(node.right, env, undefined, true);
    if (left.kind === "decimal") right = this.expression(node.right, env, left);
    else if (right.kind === "decimal") left = this.expression(node.left, env, right);
    else if (left.kind === "enum") right = this.expression(node.right, env, left);
    else if (right.kind === "enum") left = this.expression(node.left, env, right);
    else {
      left = this.expression(node.left, env, expected);
      right = this.expression(node.right, env, expected);
    }
    const operator = node.operatorToken.kind;
    if (operator === ts.SyntaxKind.QuestionQuestionToken) {
      if (left.kind === "enum") right = this.expression(node.right, env, left);
      if (right.kind === "enum") left = this.expression(node.left, env, right);
      return left.kind !== "unknown" ? left : right;
    }
    const comparison = [
      ts.SyntaxKind.LessThanToken, ts.SyntaxKind.LessThanEqualsToken, ts.SyntaxKind.GreaterThanToken,
      ts.SyntaxKind.GreaterThanEqualsToken, ts.SyntaxKind.EqualsEqualsToken, ts.SyntaxKind.EqualsEqualsEqualsToken,
      ts.SyntaxKind.ExclamationEqualsToken, ts.SyntaxKind.ExclamationEqualsEqualsToken,
    ].includes(operator);
    if (left.kind === "enum" && ts.isStringLiteralLike(unwrapExpression(node.right))) this.enumVariant(unwrapExpression(node.right) as ts.StringLiteralLike, left);
    if (right.kind === "enum" && ts.isStringLiteralLike(unwrapExpression(node.left))) this.enumVariant(unwrapExpression(node.left) as ts.StringLiteralLike, right);
    if (left.kind === "decimal" || right.kind === "decimal") {
      return this.decimalBinary(node, left, right, comparison);
    }
    return comparison ? { kind: "bool" } : commonType([left, right]);
  }

  private decimalBinary(node: ts.BinaryExpression, left: AuthoredType, right: AuthoredType, comparison: boolean): AuthoredType {
    const operator = node.operatorToken.kind;
    const decimal = left.kind === "decimal" ? left : right.kind === "decimal" ? right : unknownType;
    const zero = isIntegerZero(node.left) || isIntegerZero(node.right);
    const same = left.kind === "decimal" && right.kind === "decimal" && sameDecimal(left, right);
    const addCompare = comparison || operator === ts.SyntaxKind.PlusToken || operator === ts.SyntaxKind.MinusToken;
    if (addCompare && (same || zero)) return comparison ? { kind: "bool" } : decimal;
    if (operator === ts.SyntaxKind.AsteriskToken
      && ((left.kind === "decimal" && right.kind === "int") || (right.kind === "decimal" && left.kind === "int"))) return decimal;
    this.decimalMismatch(node, left, right, operatorText(operator));
    return comparison ? { kind: "bool" } : decimal;
  }

  private call(call: ts.CallExpression, env: TypeEnvironment, expected?: AuthoredType): AuthoredType {
    const name = callName(call);
    if (ts.isIdentifier(call.expression)) {
      const helper = this.module.helpers?.get(call.expression.text);
      if (helper) {
        const nested = cloneEnv(env);
        helper.parameters.forEach((parameter, index) => {
          const type = call.arguments[index] ? this.expression(call.arguments[index]!, env) : unknownType;
          for (const binding of bindingNames(parameter.name)) nested.variables.set(binding, type);
        });
        if (helper.body && ts.isBlock(helper.body)) {
          const returned = helper.body.statements.find(ts.isReturnStatement)?.expression;
          return returned ? this.expression(returned, nested, expected) : unknownType;
        }
        if (helper.body) return this.expression(helper.body, nested, expected);
      }
    }
    if (name === "decimal") {
      const scaleNode = call.arguments[1] && unwrapExpression(call.arguments[1]);
      const scale = scaleNode && ts.isNumericLiteral(scaleNode) ? Number(scaleNode.text) : undefined;
      const input = call.arguments[0];
      const type: AuthoredType = Number.isInteger(scale) && scale! >= 0 && scale! <= 18
        ? { kind: "decimal", scale: scale! }
        : unknownType;
      if (!input || type.kind !== "decimal" || !numericExpression(input)) {
        this.add("E_DECIMAL_SCALE", call, "decimal(value, scale) requires a numeric literal and an integer scale from 0 through 18", "use decimal(9.99, 2)");
      } else {
        this.expression(input, env, type);
      }
      return type;
    }
    if (ts.isPropertyAccessExpression(call.expression) && isDb(call.expression.expression)) {
      const method = call.expression.name.text;
      const target = call.arguments[0];
      const table = target && this.tableReference(target);
      if (method === "insert" || method === "update" || method === "upsert") {
        const row = call.arguments[method === "insert" ? 1 : 2];
        if (target) this.expression(target, env);
        if (call.arguments[1] && method !== "insert") this.expression(call.arguments[1], env);
        if (row && table) {
          const rowType: AuthoredType = { kind: "row", table: table.name };
          if (isFunctionLike(row)) this.callback(row, env, rowType, rowType);
          else this.expression(row, env, rowType);
        }
        return method === "insert" && table ? { kind: "row", table: table.name } : unknownType;
      }
      if ((method === "get" || method === "scan") && table) {
        for (const argument of call.arguments.slice(1)) this.expression(argument, env);
        const row: AuthoredType = { kind: "row", table: table.name };
        return method === "scan" ? { kind: "list", of: row } : row;
      }
    }
    if ((name === "min" || name === "max") && call.arguments.length > 0) {
      let types = call.arguments.map((item) => this.expression(item, env, undefined, true));
      const decimal = types.find((item) => item.kind === "decimal");
      if (decimal?.kind === "decimal") types = call.arguments.map((item) => this.expression(item, env, decimal));
      const valid = types.every((item, index) => sameDecimal(decimal ?? unknownType, item) || isIntegerZero(call.arguments[index]!));
      if (decimal?.kind === "decimal" && !valid) this.decimalMismatch(call, types[0] ?? unknownType, types[1] ?? unknownType, name);
      return decimal ?? commonType(types);
    }
    if (ts.isPropertyAccessExpression(call.expression)) {
      const owner = this.expression(call.expression.expression, env);
      const method = call.expression.name.text;
      if (owner.kind === "list" && ["map", "filter", "some"].includes(method)) {
        const callback = call.arguments[0];
        const result = callback && isFunctionLike(callback) ? this.callback(callback, env, owner.of) : unknownType;
        return method === "map" ? { kind: "list", of: result } : method === "filter" ? owner : { kind: "bool" };
      }
    }
    for (const argument of call.arguments) this.expression(argument, env);
    return expected ?? unknownType;
  }

  private callback(node: ts.ArrowFunction | ts.FunctionExpression | ts.FunctionDeclaration, env: TypeEnvironment, parameter: AuthoredType, expected?: AuthoredType): AuthoredType {
    const nested = cloneEnv(env);
    for (const item of node.parameters) {
      for (const name of bindingNames(item.name)) nested.variables.set(name, parameter);
    }
    if (!node.body) return unknownType;
    if (ts.isBlock(node.body)) {
      this.statements(node.body.statements, nested);
      return unknownType;
    }
    return this.expression(node.body, nested, expected);
  }

  private tableReference(node: ts.Expression): TableInfo | undefined {
    const value = unwrapExpression(node);
    if (ts.isIdentifier(value)) return this.module.tables.get(value.text);
    if (ts.isPropertyAccessExpression(value) && ts.isIdentifier(value.expression)) return this.module.tables.get(value.expression.text);
    return undefined;
  }

  private table(name: string): TableInfo | undefined {
    return [...this.module.tables.values()].find((item) => item.name === name);
  }

  private uniqueFieldType(name: string): AuthoredType | undefined {
    const candidates = [...this.module.tables.values()]
      .map((table) => table.columns?.[name])
      .filter((item): item is AuthoredType => !!item)
      .map(requiredType)
      .filter((item) => item.kind === "decimal" || item.kind === "enum");
    if (candidates.length === 0) return undefined;
    const first = JSON.stringify(candidates[0]);
    return candidates.every((item) => JSON.stringify(item) === first) ? candidates[0] : undefined;
  }

  private enumVariant(node: ts.StringLiteralLike, type: Extract<AuthoredType, { kind: "enum" }>): void {
    if (type.variants.includes(node.text)) return;
    this.add(
      "E_ENUM_VARIANT",
      node,
      `${JSON.stringify(node.text)} is not an enum variant; expected ${type.variants.map((item) => JSON.stringify(item)).join(", ")}`,
      replaceNode(this.module.source, node, JSON.stringify(type.variants[0] ?? "")),
    );
  }

  private decimalMismatch(node: ts.Node, left: AuthoredType, right: AuthoredType, operator: string): void {
    this.add(
      "E_DECIMAL_SCALE",
      node,
      `${operator} requires equal Decimal scales (or literal 0); received ${decimalName(left)} and ${decimalName(right)}`,
      `make both operands ${left.kind === "decimal" ? decimalName(left) : right.kind === "decimal" ? decimalName(right) : "the same Decimal<S>"}`,
    );
  }

  private add(code: "E_DECIMAL_SCALE" | "E_ENUM_VARIANT", node: ts.Node, message: string, rewrite: string): void {
    const key = `${code}:${node.getStart(this.module.sourceFile)}:${message}`;
    if (this.seen.has(key) || this.diagnostics.length >= 50) return;
    this.seen.add(key);
    this.diagnostics.push(diagnostic(this.module, code, node, message, rewrite));
  }
}

function descriptorType(node: ts.Expression): AuthoredType {
  const call = unwrapCall(node);
  const name = call && (ts.isIdentifier(call.expression)
    ? call.expression.text
    : ts.isPropertyAccessExpression(call.expression) ? call.expression.name.text : undefined);
  if (!call) return unknownType;
  if (name === "int" || name === "time") return { kind: "int" };
  if (name === "id" || name === "text" || name === "ref") return { kind: "string" };
  if (name === "bool") return { kind: "bool" };
  if (name === "json") return { kind: "json" };
  if (name === "enum") {
    const variants = call.arguments[0] && unwrapExpression(call.arguments[0]);
    return variants && ts.isArrayLiteralExpression(variants)
      ? { kind: "enum", variants: variants.elements.filter(ts.isStringLiteralLike).map((item) => item.text) }
      : unknownType;
  }
  if (name === "decimal" || name === "money") {
    const scaleAt = name === "decimal" ? 0 : 1;
    const scaleNode = call.arguments[scaleAt] && unwrapExpression(call.arguments[scaleAt]);
    const scale = scaleNode && ts.isNumericLiteral(scaleNode) ? Number(scaleNode.text) : name === "money" ? 2 : undefined;
    const currencyNode = name === "money" && call.arguments[0] && unwrapExpression(call.arguments[0]);
    return scale !== undefined
      ? { kind: "decimal", scale, ...(currencyNode && ts.isStringLiteralLike(currencyNode) ? { currency: currencyNode.text } : {}) }
      : unknownType;
  }
  if ((name === "optional" || name === "list") && call.arguments[0]) {
    const inner = descriptorType(call.arguments[0]);
    return name === "optional" ? { kind: "optional", of: inner } : { kind: "list", of: inner };
  }
  return unknownType;
}

function bindingNames(name: ts.BindingName): string[] {
  if (ts.isIdentifier(name)) return [name.text];
  return name.elements.flatMap((item) => ts.isBindingElement(item) ? bindingNames(item.name) : []);
}

function cloneEnv(env: TypeEnvironment): TypeEnvironment {
  return { variables: new Map(env.variables), constants: new Map(env.constants), args: env.args };
}

function commonType(values: AuthoredType[]): AuthoredType {
  const known = values.filter((item) => item.kind !== "unknown");
  if (known.length === 0) return unknownType;
  const first = JSON.stringify(known[0]);
  return known.every((item) => JSON.stringify(item) === first) ? known[0]! : unknownType;
}

function fractionalDigits(value: string): number {
  return value.includes(".") ? value.slice(value.indexOf(".") + 1).length : 0;
}

function scaledInteger(value: string, scale: number): number | undefined {
  const [whole, fraction = ""] = value.split(".");
  const result = Number(`${whole}${fraction.padEnd(scale, "0")}`);
  return Number.isSafeInteger(result) ? result : undefined;
}

function decimalName(value: AuthoredType): string {
  if (value.kind === "decimal") return value.currency ? `Money<${JSON.stringify(value.currency)}, ${value.scale}>` : `Decimal<${value.scale}>`;
  return value.kind === "int" ? "Int" : value.kind === "enum" ? "Enum" : "Unknown";
}

function isIntegerZero(node: ts.Expression): boolean {
  const value = unwrapExpression(node);
  return ts.isNumericLiteral(value) && !value.text.includes(".") && Number(value.text) === 0;
}

function numericExpression(node: ts.Expression): boolean {
  const value = unwrapExpression(node);
  return ts.isNumericLiteral(value)
    || (ts.isPrefixUnaryExpression(value) && value.operator === ts.SyntaxKind.MinusToken && ts.isNumericLiteral(value.operand));
}

function operatorText(kind: ts.SyntaxKind): string {
  return ts.tokenToString(kind) ?? ts.SyntaxKind[kind];
}
