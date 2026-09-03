import ts from "typescript";
import { expandArgumentObject } from "./args";
import { idType, isIdType, requiredType, sameDecimal, unknownType, type AuthoredType, type TableInfo } from "./authored-types";
import { diagnostic, type DiagnosticModule } from "./diagnostics";
import type { FrontendDiagnostic } from "./ir";
import { assignedBindings } from "./lower/operation-context";
import { callName, contextualNodeKey, expandedNumericLiteral, expansionContext, isFunctionLike, nonNullIdentifier, propertyName, replaceNode, staticMemberPath, unwrapCall, unwrapExpression } from "./syntax";

// @ref LLP 1002#2-the-authored-surface-the-snapback2-module — Decimal target scales are compiler facts; the emitted value is integer minor units.

type FunctionLike = ts.FunctionDeclaration | ts.ArrowFunction | ts.FunctionExpression;
type TypeModule = DiagnosticModule & { tables: Map<string, TableInfo>; helpers?: Map<string, FunctionLike> };
type OperationComposite = "args" | "ctx" | "db";
type TypeBinding = { type: AuthoredType; operationComposite?: OperationComposite };
type TypeEnvironment = {
  variables: Map<string, TypeBinding>;
  constants: Map<string, ts.Expression>;
  args: Record<string, AuthoredType>;
  mutableBindings: Set<ts.Identifier>;
  memo: Map<ts.Expression, Map<string, AuthoredType>>;
  literalContext: string;
};

const MAX_TYPE_ANALYSIS_DEPTH = 512;
const MAX_TYPE_ANALYSIS_NODES = 8192;

export type TypePlan = {
  diagnostics: FrontendDiagnostic[];
  literalValues: Map<string, number>;
  expressionTypes: Map<string, AuthoredType>;
  analysisLimitReached: boolean;
};

export function analyzeOperationTypes(module: TypeModule, call: ts.CallExpression): TypePlan {
  const analyzer = new Analyzer(module, callName(call) === "mutation" ? "Mutation" : "Query", call);
  const argsObject = call.arguments[0] && unwrapExpression(call.arguments[0]);
  const args: Record<string, AuthoredType> = Object.create(null);
  if (argsObject && ts.isObjectLiteralExpression(argsObject)) {
    for (const property of expandArgumentObject(argsObject).entries) {
      args[property.name] = descriptorType(property.value);
    }
  }
  const handler = call.arguments[1];
  if (handler && isFunctionLike(handler)) {
    const env: TypeEnvironment = {
      variables: new Map(),
      constants: new Map(),
      args,
      mutableBindings: assignedBindings(handler),
      memo: new Map(),
      literalContext: "operation",
    };
    for (const parameter of handler.parameters) {
      for (const name of bindingNames(parameter.name)) setBinding(env, name, { type: unknownType });
    }
    for (const [composite, name] of Object.entries(operationCompositeBindings(handler))) {
      if (name) setBinding(env, name, { type: unknownType, operationComposite: composite as OperationComposite });
    }
    if (ts.isBlock(handler.body)) analyzer.statements(handler.body.statements, env);
    else analyzer.expression(handler.body, env);
  }
  return {
    diagnostics: analyzer.diagnostics,
    literalValues: analyzer.literalValues,
    expressionTypes: analyzer.expressionTypes,
    analysisLimitReached: analyzer.analysisLimitReached,
  };
}

class Analyzer {
  readonly diagnostics: FrontendDiagnostic[] = [];
  readonly literalValues = new Map<string, number>();
  readonly expressionTypes = new Map<string, AuthoredType>();
  private readonly seen = new Set<string>();
  private readonly helperStack: string[] = [];
  private analysisVisits = 0;
  private analysisDepth = 0;
  analysisLimitReached = false;

  constructor(
    private readonly module: TypeModule,
    private readonly programKind: "Query" | "Mutation",
    private readonly operation: ts.CallExpression,
  ) {}

  statements(statements: readonly ts.Statement[], env: TypeEnvironment): void {
    for (const statement of statements) {
      this.statement(statement, env);
    }
  }

  private statement(statement: ts.Statement, env: TypeEnvironment): void {
    if (ts.isVariableStatement(statement)) {
      for (const declaration of statement.declarationList.declarations) {
        if (!declaration.initializer) continue;
        const type = this.expression(declaration.initializer, env);
        const bindings = this.bindingTypes(declaration.name, declaration.initializer, type, env);
        for (const [name, bindingType] of bindings) {
          const identifier = namedBinding(declaration.name, name);
          const mutable = identifier !== undefined && env.mutableBindings.has(identifier);
          const binding = ts.isIdentifier(declaration.name)
            ? this.binding(declaration.initializer, env, mutable ? unknownType : bindingType)
            : { type: mutable ? unknownType : bindingType };
          setBinding(
            env,
            name,
            binding,
            !mutable ? declaration.initializer : undefined,
          );
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
      const thenEnv = cloneEnv(env);
      const narrowed = nonNullIdentifier(statement.expression);
      if (narrowed) {
        const binding = thenEnv.variables.get(narrowed);
        if (binding) binding.type = requiredType(binding.type);
        thenEnv.constants.delete(narrowed);
      }
      this.controlled(statement.thenStatement, thenEnv);
      if (statement.elseStatement) this.controlled(statement.elseStatement, cloneEnv(env));
      return;
    }
    if (ts.isForOfStatement(statement)) {
      const domain = this.expression(statement.expression, env);
      const loop = cloneEnv(env);
      if (ts.isVariableDeclarationList(statement.initializer)) {
        for (const declaration of statement.initializer.declarations) {
          for (const name of bindingNames(declaration.name)) {
            setBinding(loop, name, { type: domain.kind === "list" ? domain.of : unknownType });
          }
        }
      }
      this.controlled(statement.statement, loop);
      return;
    }
    if (ts.isBlock(statement)) this.statements(statement.statements, cloneEnv(env));
  }

  private controlled(statement: ts.Statement, env: TypeEnvironment): void {
    if (ts.isBlock(statement)) this.statements(statement.statements, env);
    else this.statement(statement, env);
  }

  expression(node: ts.Expression, env: TypeEnvironment, expected?: AuthoredType, quietFraction = false): AuthoredType {
    const value = unwrapExpression(node);
    const target = expected && requiredType(expected);
    const memoKey = `${quietFraction ? "quiet" : "loud"}:${JSON.stringify(target ?? null)}`;
    const cached = env.memo.get(value)?.get(memoKey);
    const expressionKey = contextualNodeKey(env.literalContext, value, this.module.sourceFile);
    if (cached) {
      this.expressionTypes.set(expressionKey, cached);
      return cached;
    }
    if (this.analysisLimitReached) return unknownType;
    if (this.analysisDepth >= MAX_TYPE_ANALYSIS_DEPTH) return this.analysisLimit(value);
    if (this.analysisVisits >= MAX_TYPE_ANALYSIS_NODES) return this.analysisLimit(value);
    this.analysisVisits += 1;
    this.analysisDepth += 1;
    let result: AuthoredType;
    try {
      result = this.expressionInner(value, env, target, quietFraction);
    } finally {
      this.analysisDepth -= 1;
    }
    if (isIdType(target) && !identityValueMatches(result) && result.kind !== "unknown" && result.kind !== "json"
      && isRuntimeValidatedIdentitySink(node)
      && !(expected?.kind === "optional" && result.kind === "null")) {
      this.add(
        "E_ARGS_ID_SCALAR",
        value,
        `an Id position requires an Id scalar, not ${authoredTypeName(result)}`,
        this.idScalarRewrite(value, env),
      );
    }
    const entries = env.memo.get(value) ?? new Map<string, AuthoredType>();
    entries.set(memoKey, result);
    env.memo.set(value, entries);
    this.expressionTypes.set(expressionKey, result);
    return result;
  }

  private expressionInner(
    value: ts.Expression,
    env: TypeEnvironment,
    target: AuthoredType | undefined,
    quietFraction: boolean,
  ): AuthoredType {
    if (ts.isNumericLiteral(value)) return this.numeric(value, env, target, quietFraction);
    if (ts.isStringLiteralLike(value)) {
      if (target?.kind === "enum" && !target.variants.includes(value.text)) this.enumVariant(value, target);
      if (target?.kind === "string" && target.max !== undefined && [...value.text].length > target.max) {
        this.add(
          "E_ARGS_TYPE",
          value,
          `text literal has ${[...value.text].length} Unicode scalars but text(${target.max}) allows at most ${target.max}`,
          replaceNode(this.module.source, value, JSON.stringify([...value.text].slice(0, target.max).join(""))),
        );
      }
      return target?.kind === "enum" || (target?.kind === "string" && (!isIdType(target) || value.text.length > 0))
        ? target
        : { kind: "string" };
    }
    if (value.kind === ts.SyntaxKind.TrueKeyword || value.kind === ts.SyntaxKind.FalseKeyword) return { kind: "bool" };
    if (value.kind === ts.SyntaxKind.NullKeyword) return { kind: "null" };
    if (ts.isIdentifier(value)) {
      const constant = target && env.constants.get(value.text);
      const contextual = constant && !(isIdType(target) && opaqueScalarInitializer(constant));
      return contextual ? this.expression(constant, env, target) : env.variables.get(value.text)?.type ?? unknownType;
    }
    if (ts.isPrefixUnaryExpression(value)) {
      return this.expression(value.operand, env, target, quietFraction);
    }
    if (ts.isPropertyAccessExpression(value)) {
      const composite = this.operationComposite(value.expression, env);
      if (composite === "args") return requiredType(env.args[value.name.text]);
      if (composite === "ctx") {
        if (value.name.text === "viewer") return { kind: "principal" };
        if (["readTime", "commitTime"].includes(value.name.text)) return { kind: "int" };
      }
      const base = this.expression(value.expression, env, undefined, true);
      if (base.kind === "row") return this.table(base.table)?.columns?.[value.name.text] ?? unknownType;
      if (base.kind === "object") return base.fields?.[value.name.text] ?? unknownType;
      if ((base.kind === "list" || base.kind === "string") && value.name.text === "length") return { kind: "int" };
      return unknownType;
    }
    if (ts.isNoSubstitutionTemplateLiteral(value)) return { kind: "string" };
    if (ts.isTemplateExpression(value)) {
      const expressions = value.templateSpans.map((span) => span.expression);
      const types = expressions.map((expression) => this.expression(expression, env));
      // Id-derived text is runtime-green in Text/List/Json positions (Concat with a String
      // operand yields String); only an Id/Ref target makes it a certify-time refusal.
      if (types.some(identityScalar) && isIdType(requiredType(target)) && isRuntimeValidatedIdentitySink(value)) {
        this.add(
          "E_ARGS_ID_TEXT",
          value,
          "Id scalars cannot be interpolated into text; keep identity values structurally separate",
          this.idTextRewrite(value, target, expressions, types),
        );
        return unknownType;
      }
      return { kind: "string" };
    }
    if (ts.isArrayLiteralExpression(value)) {
      const elementTarget = target?.kind === "list" ? target.of : undefined;
      const values = value.elements.map((item) => this.expression(item, env, elementTarget));
      return { kind: "list", of: commonType(values), max: values.length };
    }
    if (ts.isObjectLiteralExpression(value)) {
      const row = target?.kind === "row" ? this.table(target.table) : undefined;
      const fields: Record<string, AuthoredType> = Object.create(null);
      for (const property of value.properties) {
        if (ts.isSpreadAssignment(property)) {
          const spread = this.expression(property.expression, env);
          if (spread.kind === "object" && spread.fields) Object.assign(fields, spread.fields);
          else for (const name of Object.keys(fields)) delete fields[name];
          continue;
        }
        if (ts.isShorthandPropertyAssignment(property)) {
          fields[property.name.text] = this.expression(property.name, env, row?.columns?.[property.name.text]);
          continue;
        }
        if (!ts.isPropertyAssignment(property)) continue;
        const name = propertyName(property.name);
        const field = name ? row?.columns?.[name] : undefined;
        const type = this.expression(property.initializer, env, field);
        if (name) fields[name] = type;
      }
      return target ?? { kind: "object", fields };
    }
    if (ts.isConditionalExpression(value)) {
      this.expression(value.condition, env);
      const left = this.expression(value.whenTrue, env, target);
      const right = this.expression(value.whenFalse, env, target);
      return commonType([left, right]);
    }
    if (ts.isBinaryExpression(value)) return this.binary(value, env, target);
    if (ts.isCallExpression(value)) return this.call(value, env, target);
    if (ts.isNewExpression(value)) {
      for (const argument of value.arguments ?? []) this.expression(argument, env);
      return { kind: "object" };
    }
    if (ts.isArrowFunction(value) || ts.isFunctionExpression(value)) {
      const nested = cloneEnv(env);
      for (const parameter of value.parameters) {
        for (const name of bindingNames(parameter.name)) setBinding(nested, name, { type: unknownType });
      }
      if (ts.isBlock(value.body)) this.statements(value.body.statements, nested);
      else this.expression(value.body, nested, target);
    }
    return target ?? unknownType;
  }

  private analysisLimit(node: ts.Expression): AuthoredType {
    if (!this.analysisLimitReached) {
      this.analysisLimitReached = true;
      this.add(
        "E_OPAQUE",
        node,
        `type analysis is limited per operation to ${MAX_TYPE_ANALYSIS_DEPTH} nested expressions and ${MAX_TYPE_ANALYSIS_NODES} contextual expression visits; reduce this operation below those bounds or split it into multiple operations (naming values inside the same operation does not reset the bounds)`,
        replaceNode(
          this.module.source,
          node,
          `__snapback2_type_analysis_limit_${MAX_TYPE_ANALYSIS_DEPTH}_depth_${MAX_TYPE_ANALYSIS_NODES}_visits_per_operation__()`,
        ),
      );
    }
    return unknownType;
  }

  private numeric(
    node: ts.NumericLiteral,
    env: TypeEnvironment,
    expected: AuthoredType | undefined,
    quiet: boolean,
  ): AuthoredType {
    const digits = fractionalDigits(node.text);
    if (expected?.kind === "decimal") {
      if (digits > expected.scale) {
        this.add(
          "E_DECIMAL_SCALE",
          node,
          `${digits} fractional digits, scale ${expected.scale}; ${decimalName(expected)} cannot represent ${node.text}`,
          replaceNode(this.module.source, node, `decimal(${node.text}, ${expected.scale})`),
        );
        return expected;
      }
      const minor = scaledInteger(node.text, expected.scale);
      if (minor === undefined) {
        this.add("E_DECIMAL_SCALE", node, `${node.text} at scale ${expected.scale} is outside the safe integer wire range`,
          replaceNode(this.module.source, node, `decimal(${node.text}, ${expected.scale})`));
      } else {
        this.literalValues.set(contextualNodeKey(env.literalContext, node, this.module.sourceFile), minor);
      }
      return expected;
    }
    if (digits === 0) return { kind: "int" };
    if (!quiet) {
      this.add("E_DECIMAL_SCALE", node, `fractional literal ${node.text} has ${digits} fractional digits but no Decimal scale`,
        replaceNode(this.module.source, node, `decimal(${node.text}, ${digits})`));
    }
    return unknownType;
  }

  private binary(node: ts.BinaryExpression, env: TypeEnvironment, expected?: AuthoredType): AuthoredType {
    const operator = node.operatorToken.kind;
    if (operator === ts.SyntaxKind.PlusToken) {
      const operands = flattenPlus(node);
      const types = operands.map((operand) => this.expression(operand, env, undefined, true));
      if (types.some(identityScalar)) {
        this.add(
          "E_ARGS_ID_TEXT",
          node,
          "Id scalars cannot be concatenated or added into text; keep identity values structurally separate",
          this.idTextRewrite(node, expected, operands, types),
        );
        return unknownType;
      }
    }
    let left = this.expression(node.left, env, undefined, true);
    let right = this.expression(node.right, env, undefined, true);
    const equality = [
      ts.SyntaxKind.EqualsEqualsToken,
      ts.SyntaxKind.EqualsEqualsEqualsToken,
      ts.SyntaxKind.ExclamationEqualsToken,
      ts.SyntaxKind.ExclamationEqualsEqualsToken,
    ].includes(operator);
    const retargetIdentity = equality && identityScalar(left) !== identityScalar(right);
    if (this.analysisLimitReached) return unknownType;
    if (operator === ts.SyntaxKind.AsteriskToken) {
      if (left.kind === "decimal") right = this.expression(node.right, env);
      else if (right.kind === "decimal") left = this.expression(node.left, env);
      else {
        left = this.expression(node.left, env);
        right = this.expression(node.right, env);
      }
    } else if (retargetIdentity) {
      if (identityScalar(left)) {
        right = this.expression(node.right, env, idType);
      } else {
        left = this.expression(node.left, env, idType);
      }
    } else if (left.kind === "decimal") right = this.expression(node.right, env, left);
    else if (right.kind === "decimal") left = this.expression(node.left, env, right);
    else if (left.kind === "enum") right = this.expression(node.right, env, left);
    else if (right.kind === "enum") left = this.expression(node.left, env, right);
    else {
      left = this.expression(node.left, env, expected);
      right = this.expression(node.right, env, expected);
    }
    if (this.analysisLimitReached) return unknownType;
    if (operator === ts.SyntaxKind.QuestionQuestionToken) {
      if (left.kind === "enum") right = this.expression(node.right, env, left);
      if (right.kind === "enum") left = this.expression(node.left, env, right);
      if (left.kind === "string") right = this.expression(node.right, env, left);
      if (right.kind === "string") left = this.expression(node.left, env, right);
      if (left.kind === "unknown") return unknownType;
      return left.kind === "null" ? right : left;
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
    if (comparison && (left.kind === "null" || right.kind === "null")) return { kind: "bool" };
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
    if (ts.isPropertyAccessExpression(call.expression)
      && this.operationComposite(call.expression.expression, env) === "ctx") {
      if (call.expression.name.text === "newId") return idType;
      if (call.expression.name.text === "now") return { kind: "int" };
    }
    if (ts.isIdentifier(call.expression)) {
      const helper = env.variables.has(call.expression.text) ? undefined : this.module.helpers?.get(call.expression.text);
      if (helper) {
        if (this.helperStack.includes(call.expression.text) || this.helperStack.length >= 128) return unknownType;
        this.helperStack.push(call.expression.text);
        try {
          const nested = cloneEnv(env);
          nested.literalContext = expansionContext(env.literalContext, call, this.module.sourceFile);
          helper.parameters.forEach((parameter, index) => {
            const type = call.arguments[index] ? this.expression(call.arguments[index]!, env) : unknownType;
            const binding = call.arguments[index]
              ? this.binding(call.arguments[index]!, env, type)
              : { type: unknownType };
            for (const parameterName of bindingNames(parameter.name)) setBinding(nested, parameterName, binding);
          });
          if (helper.body && ts.isBlock(helper.body)) {
            const returned = helper.body.statements.find(ts.isReturnStatement)?.expression;
            return returned ? this.expression(returned, nested, expected) : unknownType;
          }
          if (helper.body) return this.expression(helper.body, nested, expected);
        } finally {
          this.helperStack.pop();
        }
      }
    }
    if (name === "decimal" && !env.variables.has(name)) {
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
    if (ts.isPropertyAccessExpression(call.expression)
      && this.operationComposite(call.expression.expression, env) === "db") {
      const method = call.expression.name.text;
      const target = call.arguments[0];
      const table = target && this.tableReference(target);
      if (method === "insert" || method === "update" || method === "upsert") {
        const row = call.arguments[method === "insert" ? 1 : 2];
        if (target) this.expression(target, env);
        if (call.arguments[1] && method !== "insert") {
          this.expression(call.arguments[1], env, table?.columns?.id ?? idType);
        }
        if (row && table) {
          const rowType: AuthoredType = { kind: "row", table: table.name };
          if (isFunctionLike(row)) this.callback(row, env, rowType, rowType);
          else this.expression(row, env, rowType);
        }
        return method === "insert" && table ? { kind: "row", table: table.name } : unknownType;
      }
      if ((method === "get" || method === "scan") && table) {
        if (target) this.expression(target, env);
        const indexTypes = this.indexTypes(target, table);
        const key = call.arguments[1];
        if (key) this.key(key, env, indexTypes);
        if (method === "scan") {
          const options = call.arguments[2];
          if (options) this.scanOptions(options, env, indexTypes.slice(this.prefixArity(key, env)));
        }
        const row: AuthoredType = { kind: "row", table: table.name };
        return method === "scan" ? { kind: "list", of: row } : row;
      }
    }
    if ((name === "min" || name === "max") && !env.variables.has(name) && call.arguments.length > 0) {
      let types = call.arguments.map((item) => this.expression(item, env, undefined, true));
      const decimal = types.find((item) => item.kind === "decimal");
      if (decimal?.kind === "decimal") types = call.arguments.map((item) => this.expression(item, env, decimal));
      const valid = types.every((item, index) => sameDecimal(decimal ?? unknownType, item) || isIntegerZero(call.arguments[index]!));
      if (decimal?.kind === "decimal" && !valid) this.decimalMismatch(call, types[0] ?? unknownType, types[1] ?? unknownType, name);
      return decimal ?? commonType(types);
    }
    if (name === "concat" && !env.variables.has(name)) {
      const types = call.arguments.map((argument) => this.expression(argument, env, undefined, true));
      if (types.some(identityScalar)
        && types.some((type) => requiredType(type).kind === "string" && !isIdType(requiredType(type)))
        && isIdType(requiredType(expected))
        && isRuntimeValidatedIdentitySink(call)) {
        this.add(
          "E_ARGS_ID_TEXT",
          call,
          "Id scalars cannot be concatenated into text; keep identity values structurally separate",
          this.idTextRewrite(call, expected, [...call.arguments], types),
        );
        return unknownType;
      }
      if (types.length > 0 && types.every(identityScalar)) return idType;
      if (types.every((type) => requiredType(type).kind === "list")) {
        const lists = types.map(requiredType) as Array<Extract<AuthoredType, { kind: "list" }>>;
        return { kind: "list", of: commonType(lists.map((type) => type.of)) };
      }
      return types.some((type) => requiredType(type).kind === "string")
        ? { kind: "string" }
        : commonType(types);
    }
    if (name === "String" && !env.variables.has(name) && call.arguments.length === 1) {
      const argument = call.arguments[0]!;
      const type = this.expression(argument, env, undefined, true);
      if (identityScalar(type) && isIdType(requiredType(expected)) && isRuntimeValidatedIdentitySink(call)) {
        this.add(
          "E_ARGS_ID_TEXT",
          call,
          "String(id) would erase the Id's nominal domain; keep the identity value separate",
          this.idTextRewrite(call, expected, [argument], [type]),
        );
        return unknownType;
      }
      return { kind: "string" };
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
      for (const name of bindingNames(item.name)) setBinding(nested, name, { type: parameter });
    }
    if (!node.body) return unknownType;
    if (ts.isBlock(node.body)) {
      this.statements(node.body.statements, nested);
      return unknownType;
    }
    return this.expression(node.body, nested, expected);
  }

  private binding(node: ts.Expression, env: TypeEnvironment, type: AuthoredType): TypeBinding {
    const value = unwrapExpression(node);
    return ts.isIdentifier(value) ? { ...env.variables.get(value.text), type } : { type };
  }

  private operationComposite(node: ts.Expression, env: TypeEnvironment): OperationComposite | undefined {
    const value = unwrapExpression(node);
    return ts.isIdentifier(value) ? env.variables.get(value.text)?.operationComposite : undefined;
  }

  private tableReference(node: ts.Expression): TableInfo | undefined {
    const path = staticMemberPath(node);
    if (!path) return undefined;
    const direct = this.module.tables.get(path);
    if (direct) return direct;
    const separator = path.lastIndexOf(".");
    return separator > 0 ? this.module.tables.get(path.slice(0, separator)) : undefined;
  }

  private table(name: string): TableInfo | undefined {
    return [...this.module.tables.values()].find((item) => item.name === name);
  }

  private indexTypes(node: ts.Expression | undefined, table: TableInfo): AuthoredType[] {
    const path = node && staticMemberPath(node);
    if (!path) return [];
    const direct = this.module.tables.get(path);
    if (direct) return direct.indexes?.byId?.types ?? [idType];
    const separator = path.lastIndexOf(".");
    return separator > 0 ? table.indexes?.[path.slice(separator + 1)]?.types ?? [] : [];
  }

  private key(node: ts.Expression, env: TypeEnvironment, types: AuthoredType[]): void {
    const value = unwrapExpression(node);
    if (ts.isArrayLiteralExpression(value)) {
      value.elements.forEach((item, index) => this.expression(item, env, types[index]));
    } else {
      this.expression(
        value,
        env,
        types.length === 1 ? types[0] : { kind: "list", of: commonType(types), max: types.length },
      );
    }
  }

  private scanOptions(node: ts.Expression, env: TypeEnvironment, cursorTypes: AuthoredType[]): void {
    const value = unwrapExpression(node);
    if (!ts.isObjectLiteralExpression(value)) {
      this.expression(value, env);
      return;
    }
    for (const property of value.properties) {
      if (!ts.isPropertyAssignment(property)) continue;
      const name = propertyName(property.name);
      if (name === "after" || name === "before") {
        const cursor = unwrapExpression(property.initializer);
        if (ts.isArrayLiteralExpression(cursor)) {
          cursor.elements.forEach((element, index) => this.expression(element, env, cursorTypes[index]));
        } else {
          this.expression(cursor, env, cursorTypes.length === 1 ? cursorTypes[0] : undefined);
        }
      } else if (name === "range") {
        const range = unwrapExpression(property.initializer);
        if (!ts.isObjectLiteralExpression(range)) this.expression(range, env);
        else for (const bound of range.properties) {
          if (ts.isPropertyAssignment(bound)) this.expression(bound.initializer, env, cursorTypes[0]);
        }
      } else {
        this.expression(property.initializer, env);
      }
    }
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

  private idScalarRewrite(node: ts.Expression, env: TypeEnvironment): string {
    if (this.programKind === "Mutation" && isInsertIdSink(node)) {
      const ctx = [...env.variables].find(([, binding]) => binding.operationComposite === "ctx")?.[0];
      if (ctx) return replaceNode(this.module.source, node, insertIdReplacement(node, `${ctx}.newId()`));

      const handler = enclosingFunction(node);
      const parameter = handler?.parameters[0]?.name;
      if (parameter && ts.isObjectBindingPattern(parameter)) {
        const binding = uniqueBindingName(this.module.source, "snapbackCtx");
        const text = parameter.getText(this.module.sourceFile);
        const inserted = `${text.slice(0, -1).trimEnd()}${parameter.elements.length === 0 ? " " : ", "}ctx: ${binding} }`;
        return replaceSourceRanges(this.module.source, [
          { start: parameter.getStart(this.module.sourceFile), end: parameter.getEnd(), value: inserted },
          { start: node.getStart(this.module.sourceFile), end: node.getEnd(), value: insertIdReplacement(node, `${binding}.newId()`) },
        ]);
      }
    }

    const args = [...env.variables].find(([, binding]) => binding.operationComposite === "args")?.[0];
    const directArgument = directArgsProperty(node, args);
    const argsNode = this.operation.arguments[0];
    const argsObject = argsNode ? unwrapExpression(argsNode) : undefined;
    if (directArgument && argsObject && ts.isObjectLiteralExpression(argsObject)) {
      const property = argsObject.properties.find((candidate) =>
        ts.isPropertyAssignment(candidate) && propertyName(candidate.name) === directArgument);
      if (property && ts.isPropertyAssignment(property)) {
        return replaceNode(this.module.source, property.initializer, "t.id()");
      }
    }

    const idArgument = Object.entries(env.args).find(([, type]) => isIdType(requiredType(type)))?.[0];
    if (args && idArgument) return replaceNode(this.module.source, node, `${args}.${idArgument}`);

    if (argsObject && ts.isObjectLiteralExpression(argsObject)) {
      const argument = uniqueArgumentName(env.args, "id");
      const argsText = argsObject.getText(this.module.sourceFile);
      const rewrittenArgs = `${argsText.slice(0, -1).trimEnd()}${argsObject.properties.length === 0 ? " " : ", "}${argument}: t.id() }`;
      const ranges = [
        { start: argsObject.getStart(this.module.sourceFile), end: argsObject.getEnd(), value: rewrittenArgs },
      ];
      let argsBinding = args;
      if (!argsBinding) {
        const parameter = enclosingFunction(node)?.parameters[0]?.name;
        if (parameter && ts.isObjectBindingPattern(parameter)) {
          argsBinding = uniqueBindingName(this.module.source, "snapbackArgs");
          const text = parameter.getText(this.module.sourceFile);
          ranges.push({
            start: parameter.getStart(this.module.sourceFile),
            end: parameter.getEnd(),
            value: `${text.slice(0, -1).trimEnd()}${parameter.elements.length === 0 ? " " : ", "}args: ${argsBinding} }`,
          });
        }
      }
      if (argsBinding) {
        ranges.push({ start: node.getStart(this.module.sourceFile), end: node.getEnd(), value: `${argsBinding}.${argument}` });
        return replaceSourceRanges(this.module.source, ranges);
      }
    }
    return this.module.source;
  }

  private bindingTypes(
    name: ts.BindingName,
    initializer: ts.Expression,
    overall: AuthoredType,
    env: TypeEnvironment,
  ): Map<string, AuthoredType> {
    const result = new Map<string, AuthoredType>();
    const visit = (
      binding: ts.BindingName,
      source: ts.Expression | undefined,
      fallback: AuthoredType,
      sourceEnv = env,
    ): void => {
      if (ts.isIdentifier(binding)) {
        result.set(binding.text, source ? this.expression(source, sourceEnv) : fallback);
        return;
      }
      const value = source && unwrapExpression(source);
      const structural = ts.isArrayBindingPattern(binding) && value
        ? this.arrayBindingSources(value, sourceEnv)
        : undefined;
      binding.elements.forEach((element, index) => {
        if (!ts.isBindingElement(element)) return;
        const elementFallback = fallback.kind === "list" ? fallback.of : unknownType;
        const elementSource = structural?.sources[index];
        visit(
          element.name,
          elementSource && !ts.isOmittedExpression(elementSource) ? elementSource as ts.Expression : undefined,
          elementFallback,
          structural?.env ?? sourceEnv,
        );
      });
    };
    visit(name, initializer, overall);
    return result;
  }

  private arrayBindingSources(
    value: ts.Expression,
    env: TypeEnvironment,
  ): { sources: readonly ts.Expression[]; env: TypeEnvironment } | undefined {
    if (ts.isArrayLiteralExpression(value)) return { sources: value.elements, env };
    if (!ts.isCallExpression(value) || !ts.isIdentifier(value.expression) || env.variables.has(value.expression.text)) return undefined;
    const helper = this.module.helpers?.get(value.expression.text);
    const returned = helperReturnExpression(helper);
    const array = returned && unwrapExpression(returned);
    if (!helper || !array || !ts.isArrayLiteralExpression(array)) return undefined;
    const nested = cloneEnv(env);
    nested.literalContext = expansionContext(env.literalContext, value, this.module.sourceFile);
    helper.parameters.forEach((parameter, index) => {
      const argument = value.arguments[index];
      const type = argument ? this.expression(argument, env) : unknownType;
      const binding = argument ? this.binding(argument, env, type) : { type: unknownType };
      for (const name of bindingNames(parameter.name)) setBinding(nested, name, binding);
    });
    return { sources: array.elements, env: nested };
  }

  private prefixArity(
    node: ts.Expression | undefined,
    env: TypeEnvironment,
    seen = new Set<string>(),
  ): number {
    if (!node) return 0;
    const value = unwrapExpression(node);
    if (ts.isArrayLiteralExpression(value)) return value.elements.length;
    if (ts.isIdentifier(value)) {
      const key = `binding:${value.text}`;
      if (seen.has(key)) return 1;
      seen.add(key);
      const stable = env.constants.get(value.text);
      return stable ? this.prefixArity(stable, env, seen) : 1;
    }
    if (ts.isCallExpression(value) && ts.isIdentifier(value.expression) && !env.variables.has(value.expression.text)) {
      const key = `helper:${value.expression.text}`;
      if (seen.has(key)) return 1;
      seen.add(key);
      const returned = helperReturnExpression(this.module.helpers?.get(value.expression.text));
      return returned ? this.prefixArity(returned, env, seen) : 1;
    }
    return 1;
  }

  private idTextRewrite(
    node: ts.Expression,
    expected: AuthoredType | undefined,
    operands: ts.Expression[],
    types: AuthoredType[],
  ): string {
    const idOperands = operands.filter((_, index) => isIdType(types[index]));
    let replacement: string;
    if (isIdType(requiredType(expected))) {
      replacement = idOperands[0]?.getText(this.module.sourceFile) ?? JSON.stringify("replace-with-id");
    } else if (["string", "enum"].includes(requiredType(expected).kind)) {
      replacement = JSON.stringify("replace-with-text");
    } else {
      replacement = `[${idOperands.map((operand) => operand.getText(this.module.sourceFile)).join(", ")}]`;
    }
    return replaceNode(this.module.source, node, replacement);
  }

  private add(code: "E_DECIMAL_SCALE" | "E_ENUM_VARIANT" | "E_ARGS_TYPE" | "E_ARGS_ID_SCALAR" | "E_ARGS_ID_TEXT" | "E_OPAQUE", node: ts.Node, message: string, rewrite: string): void {
    const key = `${code}:${node.getStart(this.module.sourceFile)}:${message}`;
    if (this.seen.has(key)) return;
    this.seen.add(key);
    this.diagnostics.push(diagnostic(this.module, code, node, message, rewrite));
  }
}

function flattenPlus(node: ts.Expression): ts.Expression[] {
  const value = unwrapExpression(node);
  return ts.isBinaryExpression(value) && value.operatorToken.kind === ts.SyntaxKind.PlusToken
    ? [...flattenPlus(value.left), ...flattenPlus(value.right)]
    : [value];
}

function opaqueScalarInitializer(node: ts.Expression): boolean {
  const value = unwrapExpression(node);
  return ts.isArrayLiteralExpression(value)
    || ts.isCallExpression(value)
    || ts.isBinaryExpression(value) && value.operatorToken.kind === ts.SyntaxKind.QuestionQuestionToken;
}

function identityScalar(type: AuthoredType): boolean {
  const value = requiredType(type);
  return isIdType(value) || value.kind === "principal";
}

function isInsertIdSink(node: ts.Expression): boolean {
  let current: ts.Node = node;
  while (current.parent && !ts.isFunctionLike(current.parent)) {
    const parent = current.parent;
    if ((ts.isPropertyAssignment(parent) || ts.isShorthandPropertyAssignment(parent))
      && propertyName(parent.name) === "id") {
      const object = parent.parent;
      const call = object.parent;
      return ts.isObjectLiteralExpression(object)
        && ts.isCallExpression(call)
        && call.arguments[1] === object
        && ts.isPropertyAccessExpression(call.expression)
        && call.expression.name.text === "insert";
    }
    current = parent;
  }
  return false;
}

function isRuntimeValidatedIdentitySink(node: ts.Expression): boolean {
  for (let current: ts.Node = node; current.parent && !ts.isFunctionLike(current.parent); current = current.parent) {
    const parent = current.parent;
    if (!ts.isPropertyAssignment(parent) && !ts.isShorthandPropertyAssignment(parent)) continue;
    const object = parent.parent;
    const call = object.parent;
    if (!ts.isObjectLiteralExpression(object) || !ts.isCallExpression(call)
      || !ts.isPropertyAccessExpression(call.expression)) continue;
    const method = call.expression.name.text;
    if (method === "insert" && call.arguments[1] === object) return true;
    if ((method === "update" || method === "upsert") && call.arguments[2] === object) return true;
  }
  return false;
}

function identityValueMatches(type: AuthoredType): boolean {
  const value = requiredType(type);
  return isIdType(value) || value.kind === "principal";
}

function insertIdReplacement(node: ts.Expression, value: string): string {
  return ts.isIdentifier(node) && ts.isShorthandPropertyAssignment(node.parent)
    ? `id: ${value}`
    : value;
}

function directArgsProperty(node: ts.Expression, argsBinding: string | undefined): string | undefined {
  const value = unwrapExpression(node);
  return argsBinding
    && ts.isPropertyAccessExpression(value)
    && ts.isIdentifier(value.expression)
    && value.expression.text === argsBinding
    ? value.name.text
    : undefined;
}

function uniqueArgumentName(args: Record<string, AuthoredType>, base: string): string {
  let candidate = base;
  let suffix = 1;
  while (candidate in args) candidate = `${base}${suffix++}`;
  return candidate;
}

function enclosingFunction(node: ts.Node): FunctionLike | undefined {
  for (let parent = node.parent; parent; parent = parent.parent) {
    if (isFunctionLike(parent)) return parent;
  }
  return undefined;
}

function uniqueBindingName(source: string, base: string): string {
  let candidate = base;
  let suffix = 1;
  while (new RegExp(`\\b${candidate}\\b`).test(source)) candidate = `${base}${suffix++}`;
  return candidate;
}

function replaceSourceRanges(
  source: string,
  ranges: Array<{ start: number; end: number; value: string }>,
): string {
  let rewritten = source;
  for (const range of ranges.sort((left, right) => right.start - left.start)) {
    rewritten = `${rewritten.slice(0, range.start)}${range.value}${rewritten.slice(range.end)}`;
  }
  return rewritten;
}

function descriptorType(node: ts.Expression): AuthoredType {
  const call = unwrapCall(node);
  const name = call && (ts.isIdentifier(call.expression)
    ? call.expression.text
    : ts.isPropertyAccessExpression(call.expression) ? call.expression.name.text : undefined);
  if (!call) return unknownType;
  if (name === "int" || name === "time") return { kind: "int" };
  if (name === "principal") return { kind: "principal" };
  if (name === "id" || name === "ref") return idType;
  if (name === "text") {
    const maxNode = call.arguments[0] && unwrapExpression(call.arguments[0]);
    return { kind: "string", ...(maxNode && ts.isNumericLiteral(maxNode) ? { max: Number(maxNode.text) } : {}) };
  }
  if (name === "bytes") {
    const maxNode = call.arguments[0] && unwrapExpression(call.arguments[0]);
    return { kind: "bytes", max: maxNode && ts.isNumericLiteral(maxNode) ? Number(maxNode.text) : 0 };
  }
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

function namedBinding(name: ts.BindingName, target: string): ts.Identifier | undefined {
  if (ts.isIdentifier(name)) return name.text === target ? name : undefined;
  for (const element of name.elements) {
    if (!ts.isBindingElement(element)) continue;
    const found = namedBinding(element.name, target);
    if (found) return found;
  }
  return undefined;
}

function helperReturnExpression(helper: FunctionLike | undefined): ts.Expression | undefined {
  if (!helper?.body) return undefined;
  if (!ts.isBlock(helper.body)) return helper.body;
  if (helper.body.statements.length !== 1 || !ts.isReturnStatement(helper.body.statements[0])) return undefined;
  return helper.body.statements[0].expression;
}

function operationCompositeBindings(handler: FunctionLike): Partial<Record<OperationComposite, string>> {
  const parameter = handler.parameters[0];
  if (!parameter || !ts.isObjectBindingPattern(parameter.name)) return {};
  const bindings: Partial<Record<OperationComposite, string>> = {};
  for (const element of parameter.name.elements) {
    if (!ts.isIdentifier(element.name)) continue;
    const property = element.propertyName ? propertyName(element.propertyName) : element.name.text;
    if (property === "args" || property === "ctx" || property === "db") bindings[property] = element.name.text;
  }
  return bindings;
}

function setBinding(env: TypeEnvironment, name: string, binding: TypeBinding, constant?: ts.Expression): void {
  env.variables.set(name, { ...binding });
  if (constant) env.constants.set(name, constant);
  else env.constants.delete(name);
}

function cloneEnv(env: TypeEnvironment): TypeEnvironment {
  return {
    variables: new Map([...env.variables].map(([name, binding]) => [name, { ...binding }])),
    constants: new Map(env.constants),
    args: env.args,
    mutableBindings: env.mutableBindings,
    memo: new Map(),
    literalContext: env.literalContext,
  };
}

function commonType(values: AuthoredType[]): AuthoredType {
  if (values.length === 0 || values.some((item) => item.kind === "unknown")) return unknownType;
  const first = JSON.stringify(values[0]);
  return values.every((item) => JSON.stringify(item) === first) ? values[0]! : unknownType;
}

function authoredTypeName(value: AuthoredType): string {
  if (isIdType(value)) return "Id";
  if (value.kind === "list") return "an array";
  if (value.kind === "object" || value.kind === "json") return "an object";
  return value.kind;
}

function fractionalDigits(value: string): number {
  const expanded = expandedNumericLiteral(value);
  return expanded?.fraction.length ?? 1;
}

function scaledInteger(value: string, scale: number): number | undefined {
  const expanded = expandedNumericLiteral(value);
  if (!expanded || expanded.fraction.length > scale) return undefined;
  const result = BigInt(`${expanded.whole}${expanded.fraction.padEnd(scale, "0")}`);
  return result <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(result) : undefined;
}

function decimalName(value: AuthoredType): string {
  if (value.kind === "decimal") return value.currency ? `Money<${JSON.stringify(value.currency)}, ${value.scale}>` : `Decimal<${value.scale}>`;
  return value.kind === "int" ? "Int" : value.kind === "enum" ? "Enum" : "Unknown";
}

function isIntegerZero(node: ts.Expression): boolean {
  const value = unwrapExpression(node);
  const expanded = ts.isNumericLiteral(value) && expandedNumericLiteral(value.text);
  return !!expanded && expanded.whole === "0" && expanded.fraction === "";
}

function numericExpression(node: ts.Expression): boolean {
  const value = unwrapExpression(node);
  return ts.isNumericLiteral(value)
    || (ts.isPrefixUnaryExpression(value) && value.operator === ts.SyntaxKind.MinusToken && ts.isNumericLiteral(value.operand));
}

function operatorText(kind: ts.SyntaxKind): string {
  return ts.tokenToString(kind) ?? ts.SyntaxKind[kind];
}
