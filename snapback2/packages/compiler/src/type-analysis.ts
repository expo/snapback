import { nativeDescriptorName, legacyDescriptorName } from "./lower/descriptor-origin";
import { destinationConversion, destinationPlan, destinationRepresentationError, combineConversions, mutableCaptureType, commonCaptureType } from "./destination-conversion";
import { boundedList, concatenatedList, collectionProducerType } from "./producer-types";
import ts from "typescript";
import { MAX_SEARCH_SOURCE_SCALARS } from "./index-components";
import { expandArgumentObject } from "./args";
import { idType, isIdType, requiredType, sameDecimal, unknownType, type AuthoredType, type TableInfo } from "./authored-types";
import { diagnostic, type DiagnosticModule } from "./diagnostics";
import type { FrontendDiagnostic } from "./ir";
import { assignedBindings } from "./lower/operation-context";
import { moduleScalarCaptures, moduleAmbientComposites } from "./lower/module";
import type { ValueConversion } from "./lower/value-conversion";
import { callName, contextualNodeKey, expandedNumericLiteral, expansionContext, isFunctionLike, nonNullIdentifier, propertyName, replaceNode, staticMemberPath, unwrapCall, unwrapExpression, expressionProperty, numericLiteral } from "./syntax";

// @ref LLP 1002#2-the-authored-surface-the-snapback2-module — Decimal target scales are compiler facts; the emitted value is integer minor units.

type FunctionLike = ts.FunctionDeclaration | ts.ArrowFunction | ts.FunctionExpression;
type TypeModule = DiagnosticModule & { tables: Map<string, TableInfo>; helpers?: Map<string, FunctionLike> };
type OperationComposite = "args" | "ctx" | "db";
type TypeBinding = { type: AuthoredType; identity?: object; operationComposite?: OperationComposite };
type TypeConstant = { expression: ts.Expression; environment: TypeEnvironment };
type TypeEnvironment = {
  variables: Map<string, TypeBinding>;
  constants: Map<string, TypeConstant>;
  args: Record<string, AuthoredType>;
  mutableBindings: Set<ts.Identifier>;
  memo: Map<ts.Expression, Map<string, AuthoredType>>;
  literalContext: string;
  facts: TypeFacts;
  allowAbsent?: boolean;
  stopped?: boolean;
  exits?: Map<string, TypeBinding>[];
};

type TypeFacts = {
  literalValues: Map<string, number>;
  expressionTypes: Map<string, AuthoredType>;
  contextualTypes: Map<string, AuthoredType>;
  valueConversions: Map<string, ValueConversion>;
};

const MAX_TYPE_ANALYSIS_DEPTH = 512;
const MAX_TYPE_ANALYSIS_NODES = 8192;

export type TypePlan = {
  diagnostics: FrontendDiagnostic[];
  literalValues: ReadonlyMap<string, number>;
  expressionTypes: ReadonlyMap<string, AuthoredType>;
  contextualTypes: ReadonlyMap<string, AuthoredType>;
  valueConversions: ReadonlyMap<string, ValueConversion>;
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
      facts: analyzer,
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
    contextualTypes: analyzer.contextualTypes,
    valueConversions: analyzer.valueConversions,
    analysisLimitReached: analyzer.analysisLimitReached,
  };
}

class Analyzer {
  readonly diagnostics: FrontendDiagnostic[] = [];
  readonly literalValues = new Map<string, number>();
  readonly expressionTypes = new Map<string, AuthoredType>();
  readonly contextualTypes = new Map<string, AuthoredType>();
  readonly valueConversions = new Map<string, ValueConversion>();
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
      if (env.stopped || this.analysisLimitReached) break;
      this.statement(statement, env);
    }
  }

  private statement(statement: ts.Statement, env: TypeEnvironment): void {
    if (this.analysisLimitReached) return;
    if (ts.isVariableStatement(statement)) {
      for (const declaration of statement.declarationList.declarations) {
        if (!declaration.initializer) continue;
        const type = this.expression(declaration.initializer, env);
        const bindings = this.bindingTypes(declaration.name, declaration.initializer, type, env);
        for (const [name, bindingType] of bindings) {
          const identifier = namedBinding(declaration.name, name);
          const mutable = identifier !== undefined && env.mutableBindings.has(identifier);
          const binding = ts.isIdentifier(declaration.name)
            ? this.binding(declaration.initializer, env, mutable ? mutableCaptureType(bindingType) : bindingType)
            : { type: mutable ? mutableCaptureType(bindingType) : bindingType };
          setBinding(
            env,
            name,
            binding,
            !mutable && ts.isIdentifier(declaration.name) ? declaration.initializer : undefined,
          );
        }
      }
      return;
    }
    if (ts.isExpressionStatement(statement)) {
      this.expression(statement.expression, env);
      return;
    }
    if (ts.isReturnStatement(statement)) {
      if (statement.expression) this.expression(statement.expression, env);
      env.stopped = true;
      return;
    }
    if (ts.isBreakStatement(statement) || ts.isContinueStatement(statement)) {
      (env.exits ??= []).push(new Map([...env.variables].map(([name, binding]) => [name, { ...binding }])));
      env.stopped = true;
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
      const elseEnv = cloneEnv(env);
      if (statement.elseStatement) this.controlled(statement.elseStatement, elseEnv);
      mergeTypeFlow(env, [thenEnv, elseEnv]);
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
      // A later iteration can reach an earlier use with a different source
      // representation. Widen entry facts before publishing body conversions.
      for (let round = 0; hasLoopCarry(statement.statement, env) && round < 128; round++) {
        const before = JSON.stringify([...loop.variables].map(([name, binding]) => [name, binding.type]));
        const trial = cloneEnv(loop);
        trial.facts = { expressionTypes: new Map(), contextualTypes: new Map(), literalValues: new Map(), valueConversions: new Map() };
        this.controlled(statement.statement, trial);
        mergeTypeEnvironments(loop, [loop, ...loopPaths(trial)]);
        if (JSON.stringify([...loop.variables].map(([name, binding]) => [name, binding.type])) === before) break;
        if (round === 127) this.analysisLimit(statement.expression);
      }
      this.controlled(statement.statement, loop);
      mergeTypeEnvironments(env, [env, ...loopPaths(loop)]);
      return;
    }
    if (ts.isBlock(statement)) {
      const block = cloneEnv(env);
      this.statements(statement.statements, block);
      mergeTypeFlow(env, [block]);
    }
  }

  private controlled(statement: ts.Statement, env: TypeEnvironment): void {
    if (ts.isBlock(statement)) this.statements(statement.statements, env);
    else this.statement(statement, env);
  }

  expression(node: ts.Expression, env: TypeEnvironment, expected?: AuthoredType, quietFraction = false): AuthoredType {
    const value = unwrapExpression(node);
    const target = expected && requiredType(expected);
    const memoKey = `${quietFraction ? "quiet" : "loud"}:${env.allowAbsent ? "nullable" : "required"}:${JSON.stringify(target ?? null)}`;
    const cached = env.memo.get(value)?.get(memoKey);
    const expressionKey = contextualNodeKey(env.literalContext, value, this.module.sourceFile);
    if (cached) {
      this.recordType(value, env, expressionKey, cached, target);
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
    if (target) {
      const { conversion, type } = destinationPlan(result, target, table => this.table(table)?.columns);
      if (conversion) {
        env.facts.valueConversions.set(expressionKey, conversion);
        result = type;
      }
      const error = destinationRepresentationError(result, expected!, table => this.table(table)?.columns);
      if (error && !(env.allowAbsent && result.kind === "null")) this.add("E_DECIMAL_SCALE", value, error,
        "use a value with the destination's exact Decimal scale, or convert each whole-unit value before combining representations");
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
    this.recordType(value, env, expressionKey, result, target);
    return result;
  }

  private recordType(value: ts.Expression, env: TypeEnvironment, key: string, result: AuthoredType, target?: AuthoredType): void {
    // @ref LLP 1001#unicode-search-foundation — a conversion's destination is never the captured source's Q.
    if (target) env.facts.contextualTypes.set(key, result);
    const own = ts.isIdentifier(value) ? env.variables.get(value.text)?.type ?? unknownType
      : ts.isStringLiteralLike(value) ? { kind: "string" as const, max: [...value.text].length }
        : result;
    if (!target || !env.facts.expressionTypes.has(key)) env.facts.expressionTypes.set(key, own);
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
        : { kind: "string", max: [...value.text].length };
    }
    if (value.kind === ts.SyntaxKind.TrueKeyword || value.kind === ts.SyntaxKind.FalseKeyword) return { kind: "bool" };
    if (value.kind === ts.SyntaxKind.NullKeyword) return { kind: "null" };
    if (ts.isIdentifier(value)) {
      const constant = target && env.constants.get(value.text);
      const contextual = constant && !(isIdType(target) && opaqueScalarInitializer(constant.expression));
      if (!contextual) return env.variables.get(value.text)?.type ?? unknownType;
      // Rechecking a captured initializer can validate a destination, but cannot
      // republish any of that destination's facts at the initializer's source site.
      const captured = cloneEnv(constant.environment);
      captured.allowAbsent = env.allowAbsent;
      captured.facts = { expressionTypes: new Map(), contextualTypes: new Map(), literalValues: new Map(), valueConversions: new Map() };
      const result = this.expression(constant.expression, captured, target);
      const own = env.variables.get(value.text)?.type;
      const selected = this.captureConversion(constant.expression, constant.environment, captured);
      const conversion = selected && "choice" in selected ? selected : combineConversions(
        destinationConversion(own, target, table => this.table(table)?.columns), selected);
      if (conversion) env.facts.valueConversions.set(contextualNodeKey(env.literalContext, value, this.module.sourceFile), conversion);
      return result;
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
      if (base.kind === "object") {
        const own = base.fields?.[value.name.text] ?? unknownType;
        if (target && !destinationConversion(own, target, table => this.table(table)?.columns)
          && ["decimal", "list", "object", "row"].includes(target.kind)) {
          const captured = cloneEnv(env);
          captured.facts = { expressionTypes: new Map(), contextualTypes: new Map(), literalValues: new Map(), valueConversions: new Map() };
          this.expression(value.expression, captured, { kind: "object", fields: { ...base.fields, [value.name.text]: target } });
          const conversion = captured.facts.valueConversions.get(contextualNodeKey(captured.literalContext, unwrapExpression(value.expression), this.module.sourceFile));
          if (conversion) {
            env.facts.valueConversions.set(contextualNodeKey(env.literalContext, value, this.module.sourceFile), { project: { conversion, field: value.name.text } });
            return target;
          }
        }
        return own;
      }
      if (base.kind === "asset") {
        const field = assetFieldType(base.asset, value.name.text);
        if (field) return field;
        const available = base.asset === "image" ? "id, width, height" : "id, width, height, duration";
        const replacement = `${value.expression.getText(this.module.sourceFile)}.${base.asset === "video" ? "duration" : "width"}`;
        this.add(
          "E_ARGS_TYPE",
          value,
          `${base.asset} asset has no field ${value.name.text}; available fields are ${available}`,
          replaceNode(this.module.source, value, replacement),
        );
        return unknownType;
      }
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
      return { kind: "string", builtText: true };
    }
    if (ts.isArrayLiteralExpression(value)) {
      const elementTarget = target?.kind === "list" ? target.of : undefined;
      let max = 0;
      const values = value.elements.map(item => {
        if (!ts.isSpreadElement(item)) { max++; return this.expression(item, env, elementTarget); }
        const spread = this.expression(item.expression, env, target);
        if (spread.kind !== "list" || spread.max === undefined) { max = NaN; return unknownType; }
        max += spread.max;
        return spread.of;
      });
      return { kind: "list", of: commonType(values), ...(Number.isSafeInteger(max) ? { max } : {}) };
    }
    if (ts.isObjectLiteralExpression(value)) {
      const columns = target?.kind === "row" ? this.table(target.table)?.columns : target?.kind === "object" ? target.fields : undefined;
      const fields: Record<string, AuthoredType> = Object.create(null);
      for (const property of value.properties) {
        if (ts.isSpreadAssignment(property)) {
          const spread = this.expression(property.expression, env, target);
          const own = env.facts.expressionTypes.get(contextualNodeKey(env.literalContext, unwrapExpression(property.expression), this.module.sourceFile));
          if (spread.kind === "object" && spread.fields) Object.assign(fields, spread.fields);
          else if (own?.kind === "object" && own.fields) Object.assign(fields, own.fields);
          else for (const name of Object.keys(fields)) delete fields[name];
          continue;
        }
        if (ts.isShorthandPropertyAssignment(property)) {
          fields[property.name.text] = this.expression(property.name, env, columns?.[property.name.text]);
          continue;
        }
        if (!ts.isPropertyAssignment(property)) continue;
        const name = propertyName(property.name);
        const field = name ? columns?.[name] : undefined;
        const type = this.expression(property.initializer, env, field);
        if (name) fields[name] = type;
      }
      return target ?? { kind: "object", fields };
    }
    if (ts.isConditionalExpression(value)) {
      this.expression(value.condition, env);
      const yes = cloneEnv(env), no = cloneEnv(env);
      const left = this.expression(value.whenTrue, yes, target);
      const right = this.expression(value.whenFalse, no, target);
      mergeTypeEnvironments(env, [yes, no]);
      if (target && env.allowAbsent && (left.kind === "null" || right.kind === "null")) {
        const present = left.kind === "null" ? right : left;
        return present.kind === "null" ? present : { kind: "optional", of: present };
      }
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

  private captureConversion(node: ts.Expression, before: TypeEnvironment, after: TypeEnvironment): ValueConversion | undefined {
    const value = unwrapExpression(node);
    const key = contextualNodeKey(after.literalContext, value, this.module.sourceFile);
    if (!after.facts.expressionTypes.has(key)) return undefined;
    const priorKey = contextualNodeKey(before.literalContext, value, this.module.sourceFile);
    // Source facts describe the authored value; contextual facts describe the
    // representation already produced at this occurrence, before its capture.
    const own = before.facts.contextualTypes.get(priorKey) ?? before.facts.expressionTypes.get(priorKey);
    const destination = after.facts.contextualTypes.get(key) ?? after.facts.expressionTypes.get(key);
    if (ts.isConditionalExpression(value) || ts.isBinaryExpression(value) && value.operatorToken.kind === ts.SyntaxKind.QuestionQuestionToken) {
      const whenTrue = this.captureConversion(ts.isConditionalExpression(value) ? value.whenTrue : value.right, before, after);
      const whenFalse = this.captureConversion(ts.isConditionalExpression(value) ? value.whenFalse : value.left, before, after);
      if (whenTrue || whenFalse) return { choice: { whenTrue, whenFalse } };
    }
    if (ts.isNumericLiteral(value)) {
      const scaled = after.facts.literalValues.get(key);
      const prior = before.facts.literalValues.get(priorKey) ?? Number(value.text);
      return scaled !== undefined && scaled !== prior ? { literal: { Int: scaled } } : undefined;
    }
    const structural = destinationConversion(own, destination, table => this.table(table)?.columns);
    if (structural && !("fields" in structural)) return structural;
    if (ts.isIdentifier(value) || ts.isPropertyAccessExpression(value)) {
      const conversion = after.facts.valueConversions.get(key);
      return JSON.stringify(conversion) === JSON.stringify(before.facts.valueConversions.get(priorKey))
        ? structural : conversion ?? structural;
    }
    if (ts.isStringLiteralLike(value)) {
      return isIdType(after.facts.contextualTypes.get(key)) && !isIdType(before.facts.contextualTypes.get(priorKey))
        ? { literal: { Id: value.text } } : undefined;
    }
    if (ts.isArrayLiteralExpression(value)) {
      const segments: Array<ValueConversion | undefined> = [];
      let items: Array<ValueConversion | undefined> = [];
      const flush = () => { if (items.length) segments.push(items.some(Boolean) ? { items } : undefined); items = []; };
      for (const item of value.elements) {
        if (ts.isSpreadElement(item)) { flush(); segments.push(this.captureConversion(item.expression, before, after)); }
        else items.push(this.captureConversion(item, before, after));
      }
      flush();
      return segments.reduce<ValueConversion | undefined>((left, right, index) => index === 0 ? right
        : left || right ? { concat: { left, right } } : undefined, undefined);
    }
    if (ts.isObjectLiteralExpression(value)) {
      const fields: Record<string, ValueConversion | undefined> = structural && "fields" in structural ? { ...structural.fields } : Object.create(null);
      for (const property of value.properties) {
        if (ts.isSpreadAssignment(property)) {
          const spread = this.captureConversion(property.expression, before, after);
          const source = before.facts.expressionTypes.get(contextualNodeKey(before.literalContext, unwrapExpression(property.expression), this.module.sourceFile));
          if (source?.kind === "object" && source.fields) for (const name of Object.keys(source.fields)) delete fields[name];
          if (spread && "fields" in spread) Object.assign(fields, spread.fields);
          continue;
        }
        const child = ts.isPropertyAssignment(property) ? property.initializer : ts.isShorthandPropertyAssignment(property) ? property.name : undefined;
        const name = property.name && propertyName(property.name);
        const conversion = child && this.captureConversion(child, before, after);
        if (name) {
          if (conversion) fields[name] = conversion;
          else delete fields[name];
        }
      }
      return Object.keys(fields).length ? { fields } : undefined;
    }
    if (ts.isCallExpression(value) && ts.isIdentifier(value.expression) && !before.variables.has(value.expression.text)) {
      const returned = helperReturnExpression(this.module.helpers?.get(value.expression.text));
      if (returned) return this.captureConversion(returned,
        { ...before, literalContext: expansionContext(before.literalContext, value, this.module.sourceFile) },
        { ...after, literalContext: expansionContext(after.literalContext, value, this.module.sourceFile) });
    }
    return structural;
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
        env.facts.literalValues.set(contextualNodeKey(env.literalContext, node, this.module.sourceFile), minor);
      }
      return expected;
    }
    if (digits === 0) return { kind: "int", wholeUnits: true };
    if (!quiet) {
      this.add("E_DECIMAL_SCALE", node, `fractional literal ${node.text} has ${digits} fractional digits but no Decimal scale`,
        replaceNode(this.module.source, node, `decimal(${node.text}, ${digits})`));
    }
    return unknownType;
  }

  private binary(node: ts.BinaryExpression, env: TypeEnvironment, expected?: AuthoredType): AuthoredType {
    const operator = node.operatorToken.kind;
    const leftEnv = operator === ts.SyntaxKind.QuestionQuestionToken ? { ...env, allowAbsent: true } : env;
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
    if (operator === ts.SyntaxKind.EqualsToken && ts.isIdentifier(node.left)) {
      const result = this.expression(node.right, env);
      const binding = env.variables.get(node.left.text);
      if (binding) {
        binding.type = mutableCaptureType(result);
        delete binding.operationComposite;
      }
      env.constants.delete(node.left.text);
      env.memo = new Map();
      return result;
    }
    let left = this.expression(node.left, env, undefined, true);
    let right = this.expression(node.right, env, undefined, true);
    const equality = [
      ts.SyntaxKind.EqualsEqualsToken,
      ts.SyntaxKind.EqualsEqualsEqualsToken,
      ts.SyntaxKind.ExclamationEqualsToken,
      ts.SyntaxKind.ExclamationEqualsEqualsToken,
    ].includes(operator);
    const retargetIdentity = equality && left.kind !== "null" && right.kind !== "null" && identityScalar(left) !== identityScalar(right);
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
      left = this.expression(node.left, leftEnv, expected);
      right = this.expression(node.right, env, expected);
    }
    if (this.analysisLimitReached) return unknownType;
    if (operator === ts.SyntaxKind.QuestionQuestionToken) {
      if (left.kind === "optional" && left.of.kind === "string") left = left.of;
      if (left.kind === "enum") right = this.expression(node.right, env, left);
      if (right.kind === "enum") left = this.expression(node.left, env, right);
      if (left.kind === "string") right = this.expression(node.right, env, left);
      if (right.kind === "string") {
        left = this.expression(node.left, env, right);
        if (left.kind === "optional" && left.of.kind === "string") left = left.of;
      }
      if (left.kind === "unknown") return unknownType;
      if (left.kind === "string" && right.kind === "string") return {
        ...left,
        max: left.max !== undefined && right.max !== undefined ? Math.max(left.max, right.max) : undefined,
        ...(right.builtText ? { builtText: true } : {}),
      };
      // Every possible produced representation participates in the join. A
      // producer cannot inherit just the nullable receiver's element brand.
      return left.kind === "null" ? right : commonCaptureType([requiredType(left), right]);
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
    if (operator === ts.SyntaxKind.PlusToken && (left.kind === "string" || right.kind === "string")) {
      return { kind: "string", builtText: true };
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
          const nested = this.helperEnvironment(call, helper, env);
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
      const type: AuthoredType = Number.isInteger(scale) && scale! >= 0 && scale! <= 12
        ? { kind: "decimal", scale: scale! }
        : unknownType;
      if (!input || type.kind !== "decimal" || !numericExpression(input)) {
        this.add("E_DECIMAL_SCALE", call, "decimal(value, scale) requires a numeric literal and an integer scale from 0 through 12", "use decimal(9.99, 2)");
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
      if ((method === "get" || method === "scan" || method === "exists") && table) {
        if (target) this.expression(target, env);
        const indexTypes = this.indexTypes(target, table);
        const key = call.arguments[1];
        if (key) this.key(key, env, indexTypes);
        if (method === "scan") {
          const options = call.arguments[2];
          if (options) this.scanOptions(options, env, indexTypes.slice(this.prefixArity(key, env)));
        }
        const row: AuthoredType = { kind: "row", table: table.name };
        const options = call.arguments[2];
        const take = options && ts.isObjectLiteralExpression(options) ? numericLiteral(expressionProperty(options, "take")) : undefined;
        return method === "scan" ? boundedList(row, take) : method === "exists" ? { kind: "bool" } : row;
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
    if (name === "divmod" && !env.variables.has(name) && call.arguments.length === 2) {
      const numeratorNode = unwrapExpression(call.arguments[0]!);
      if (ts.isBinaryExpression(numeratorNode)
        && numeratorNode.operatorToken.kind === ts.SyntaxKind.AsteriskToken) {
        const left = this.expression(numeratorNode.left, env, undefined, true);
        const right = this.expression(numeratorNode.right, env, undefined, true);
        if (left.kind === "decimal" && right.kind === "decimal") {
          // @ref LLP 1004#money-and-decimal-worked-out-2026-09-03 — the only branded × branded lowering is an exact product divided by the dropped scale.
          const divisorNode = call.arguments[1]!;
          this.expression(divisorNode, env, { kind: "int" });
          if (left.currency && right.currency) {
            this.add(
              "E_DECIMAL_SCALE",
              numeratorNode,
              "money multiplied by money has no currency-squared value",
              "multiply the money value by a decimal rate or an int",
            );
          }
          const dropped = left.currency ? right : right.currency ? left : right;
          const surviving = left.currency ? left : right.currency ? right : left;
          const expectedDivisor = 10 ** dropped.scale;
          if (integerLiteralValue(divisorNode) !== expectedDivisor) {
            this.add(
              "E_DECIMAL_SCALE",
              divisorNode,
              `branded multiplication must divide by 10^${dropped.scale} (${expectedDivisor}) to drop ${decimalName(dropped)}`,
              replaceNode(this.module.source, divisorNode, String(expectedDivisor)),
            );
          }
          return { kind: "object", fields: { quotient: surviving, remainder: surviving } };
        }
      }
      const numerator = this.expression(call.arguments[0]!, env, undefined, true);
      this.expression(call.arguments[1]!, env, { kind: "int" });
      const carried = requiredType(numerator);
      if (carried.kind === "int" || carried.kind === "decimal") {
        return { kind: "object", fields: { quotient: carried, remainder: carried } };
      }
      return unknownType;
    }
    if (name === "words" && !env.variables.has(name) && call.arguments.length === 1) {
      const input = requiredType(this.expression(call.arguments[0]!, env));
      if (input.kind === "string" && input.builtText) {
        this.add("E_QUARRY_TYPE", call, "words requires a declared text bound; + or template-built text has no declared maximum",
          "use words(body) with body declared as t.text(N) in an argument or column");
        return unknownType;
      }
      if (input.kind === "string" && !input.id && input.max !== undefined
        && Number.isSafeInteger(input.max) && input.max >= 0 && input.max <= MAX_SEARCH_SOURCE_SCALARS) {
        return { kind: "list", of: { ...input, max: 4 * input.max }, max: Math.floor(4 * input.max / 2) + 1 };
      }
      this.add("E_ARGS_TYPE", call, "words requires bounded text",
        "use words(body) with body declared as t.text(N)");
      return unknownType;
    }
    if (name === "deterministicShare" && !env.variables.has(name) && call.arguments.length === 3) {
      const amount = this.expression(call.arguments[0]!, env, undefined, true);
      this.expression(call.arguments[1]!, env);
      this.expression(call.arguments[2]!, env);
      return amount;
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
        return concatenatedList(lists);
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
      if (owner.kind === "list" && method === "push" && ts.isIdentifier(call.expression.expression)) {
        const name = call.expression.expression.text;
        const appended = call.arguments.map(argument => this.expression(argument, env));
        const binding = env.variables.get(name);
        if (binding) binding.type = { ...owner, max: Math.max(1, owner.max ?? 1),
          of: commonCaptureType([...(owner.max === 0 ? [] : [owner.of]), ...appended]) };
        env.constants.delete(name);
        env.memo = new Map();
        return { kind: "int" };
      }
    }
    const producer = collectionProducerType(call, node => this.expression(node, env),
      (node, first, second) => this.callback(node, env, first, undefined, second));
    if (producer) return producer;
    for (const argument of call.arguments) this.expression(argument, env);
    return unknownType;
  }

  private callback(node: ts.ArrowFunction | ts.FunctionExpression | ts.FunctionDeclaration, env: TypeEnvironment, parameter: AuthoredType, expected?: AuthoredType, second?: AuthoredType): AuthoredType {
    const nested = cloneEnv(env);
    for (const [index, item] of node.parameters.entries()) {
      for (const name of bindingNames(item.name)) setBinding(nested, name, { type: index === 1 && second ? second : parameter });
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
    return { sources: array.elements, env: this.helperEnvironment(value, helper, env) };
  }

  private helperEnvironment(value: ts.CallExpression, helper: FunctionLike, env: TypeEnvironment): TypeEnvironment {
    const nested = cloneEnv(env);
    nested.variables.clear();
    nested.constants.clear();
    nested.literalContext = expansionContext(env.literalContext, value, this.module.sourceFile);
    for (const name of moduleAmbientComposites(this.module.sourceFile)) setBinding(nested, name, { type: unknownType, operationComposite: name });
    for (const [name, expression] of moduleScalarCaptures(this.module.sourceFile)) {
      setBinding(nested, name, { type: this.expression(expression, nested) }, expression);
    }
    helper.parameters.forEach((parameter, index) => {
      const argument = value.arguments[index];
      const type = argument ? this.expression(argument, env) : unknownType;
      const binding = argument ? this.binding(argument, env, type) : { type: unknownType };
      for (const name of bindingNames(parameter.name)) setBinding(nested, name, binding, argument, env);
    });
    return nested;
  }

  private prefixArity(
    node: ts.Expression | undefined,
    env: TypeEnvironment,
    depth = 0,
  ): number {
    if (!node) return 0;
    const value = unwrapExpression(node);
    if (depth >= MAX_TYPE_ANALYSIS_DEPTH) { this.analysisLimit(value); return 0; }
    if (ts.isArrayLiteralExpression(value)) return value.elements.length;
    if (ts.isIdentifier(value)) {
      const stable = env.constants.get(value.text);
      return stable ? this.prefixArity(stable.expression, stable.environment, depth + 1) : 1;
    }
    if (ts.isCallExpression(value) && ts.isIdentifier(value.expression) && !env.variables.has(value.expression.text)) {
      const helper = this.module.helpers?.get(value.expression.text);
      const returned = helperReturnExpression(helper);
      return helper && returned ? this.prefixArity(returned, this.helperEnvironment(value, helper, env), depth + 1) : 1;
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

  private add(code: "E_QUARRY_TYPE" | "E_DECIMAL_SCALE" | "E_ENUM_VARIANT" | "E_ARGS_TYPE" | "E_ARGS_ID_SCALAR" | "E_ARGS_ID_TEXT" | "E_OPAQUE", node: ts.Node, message: string, rewrite: string): void {
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
  const name = call && (nativeDescriptorName(call) ?? legacyDescriptorName(call));
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
  if (name === "image" || name === "video") {
    const maxNode = call.arguments[0] && unwrapExpression(call.arguments[0]);
    return { kind: "asset", asset: name, max: maxNode && ts.isNumericLiteral(maxNode) ? Number(maxNode.text) : 0 };
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

function setBinding(env: TypeEnvironment, name: string, binding: TypeBinding, constant?: ts.Expression, sourceEnv = env): void {
  // @ref LLP 1001#unicode-search-foundation — contextual reanalysis must retain the captured source's Q, not a later shadow's type.
  // Capture before installing the binding, including for a same-name alias. Both
  // expressionTypes and numeric literal facts are shared with lowering, so an
  // initializer must always be reanalyzed in its declaration environment.
  const origin = constant && { expression: constant, environment: cloneEnv(sourceEnv) };
  env.variables.set(name, { ...binding, identity: {} });
  if (origin) env.constants.set(name, origin);
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
    facts: env.facts,
    allowAbsent: env.allowAbsent,
  };
}

// @ref LLP 1002#2-the-authored-surface-the-snapback2-module — joins and lexical exits carry assignments to the same binding, never a shadow's initializer.
function mergeTypeEnvironments(env: TypeEnvironment, branches: TypeEnvironment[]): void {
  for (const [name, binding] of env.variables) {
    const alternatives = branches.map(branch => {
      const next = branch.variables.get(name);
      return next && next.identity === binding.identity ? next : binding;
    });
    binding.type = commonCaptureType(alternatives.map(next => next.type));
    if (alternatives.some(next => next.operationComposite !== binding.operationComposite)) delete binding.operationComposite;
    if (branches.some(branch => branch.variables.get(name)?.identity === binding.identity && !branch.constants.has(name))) env.constants.delete(name);
  }
  env.memo = new Map();
}

function mergeTypeFlow(env: TypeEnvironment, branches: TypeEnvironment[]): void {
  (env.exits ??= []).push(...branches.flatMap(branch => branch.exits ?? []));
  const live = branches.filter(branch => !branch.stopped);
  if (live.length) mergeTypeEnvironments(env, live);
  else env.stopped = true;
}

function loopPaths(env: TypeEnvironment): TypeEnvironment[] {
  return [...(env.stopped ? [] : [env]), ...(env.exits ?? []).map(variables => ({ ...env, variables }))];
}

/** No back-edge analysis is needed when the body cannot assign an outer value. */
function hasLoopCarry(body: ts.Statement, env: TypeEnvironment): boolean {
  let carried = false;
  const visit = (node: ts.Node): void => {
    if (carried) return;
    const assigned = ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.EqualsToken ? node.left
      : (ts.isPostfixUnaryExpression(node) || ts.isPrefixUnaryExpression(node))
        && [ts.SyntaxKind.PlusPlusToken, ts.SyntaxKind.MinusMinusToken].includes(node.operator) ? node.operand
        : ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression)
          && node.expression.name.text === "push" ? node.expression.expression : undefined;
    if (assigned && ts.isIdentifier(assigned) && env.variables.has(assigned.text)) carried = true;
    else ts.forEachChild(node, visit);
  };
  visit(body);
  return carried;
}

function commonType(values: AuthoredType[]): AuthoredType {
  return commonCaptureType(values);
}

function assetFieldType(asset: "image" | "video", field: string): AuthoredType | undefined {
  // @ref LLP 1006#3-authoring-surface — admission facts are a closed object type before ordinary Field lowering.
  if (field === "id") return idType;
  if (field === "width" || field === "height" || asset === "video" && field === "duration") return { kind: "int" };
  return undefined;
}

function authoredTypeName(value: AuthoredType): string {
  if (isIdType(value)) return "Id";
  if (value.kind === "list") return "an array";
  if (value.kind === "object" || value.kind === "json") return "an object";
  if (value.kind === "asset") return `${value.asset} asset`;
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

function integerLiteralValue(node: ts.Expression): number | undefined {
  const value = unwrapExpression(node);
  return ts.isNumericLiteral(value) ? scaledInteger(value.text, 0) : undefined;
}

function numericExpression(node: ts.Expression): boolean {
  const value = unwrapExpression(node);
  return ts.isNumericLiteral(value)
    || (ts.isPrefixUnaryExpression(value) && value.operator === ts.SyntaxKind.MinusToken && ts.isNumericLiteral(value.operand));
}

function operatorText(kind: ts.SyntaxKind): string {
  return ts.tokenToString(kind) ?? ts.SyntaxKind[kind];
}
