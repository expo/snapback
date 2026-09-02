import ts from "typescript";
import type { Environment, LoweredValue, ProvenanceOrigin, VariableInfo } from "../compiler";
import { refuse, Refusal } from "../diagnostics";
import type { Expr, LoopDomain, Scan, Stmt } from "../ir";
import {
  collectionElementBinding,
  combineProvenance,
  isRowCollectionExpression,
  isRowExpression,
  provenanceBinding,
  readProvenance,
} from "./provenance";
import { expandHelper } from "./helper-expansion";
import {
  arraySpreadRewrite,
  knownObjectFields,
  nullableReadSpread,
  nullableSpreadRefusal,
  objectSpreadRewrite,
  rowCollectionFields,
} from "./object-shape";
import {
  binaryOperator,
  callName,
  collectionConstructor,
  contextualNodeKey,
  expressionProperty,
  expandedNumericLiteral,
  identifierFromArgsOrLocal,
  isDbMember,
  isFunctionLike,
  literal,
  numberProperty,
  numericLiteral,
  propertyName,
  replaceNode,
  staticMemberPath,
  stringLiteral,
  syntheticIdentifier,
  temporary,
  unwrapCall,
  unwrapExpression,
} from "../syntax";
import { isOperationCompositeBinding, withDirectRewrite } from "./operation-context";
import { guardedWalk, MAX_RECURSION_DEPTH } from "./recursion";
import { derivedBound, operationArgumentList, staticBound } from "./binding-bound";
import { maintainCollectionFacts } from "./collection-facts";
function concatExpressions(expressions: Expr[]): Expr {
  return expressions.slice(1).reduce<Expr>(
    (left, right) => ({ Builtin: { builtin: "Concat", args: [left, right] } }),
    expressions[0]!,
  );
}
function rowFields(target: ts.Expression | undefined, env: Environment): string[] | undefined {
  if (!target) return undefined;
  const value = unwrapExpression(target);
  const binding = ts.isIdentifier(value)
    ? value.text
    : ts.isPropertyAccessExpression(value) && ts.isIdentifier(value.expression)
      ? value.expression.text
      : undefined;
  const columns = binding && env.tables.get(binding)?.columns;
  if (!columns) return undefined;
  return [...new Set(["id", ...Object.keys(columns)])];
}

function isKnownRowOrObject(expression: ts.Expression, env: Environment): boolean {
  return knownObjectFields(expression, env) !== undefined || isRowExpression(expression, env);
}

export function lowerPropertyValue(value: ts.PropertyAccessExpression, base: Expr, env: Environment): Expr {
  const collection = ts.isIdentifier(value.expression)
    ? env.variables.get(value.expression.text)?.collection
    : undefined;
  if ((value.name.text === "length" && !isKnownRowOrObject(value.expression, env))
    || (value.name.text === "size" && collection)) {
    return { Builtin: { builtin: "Len", args: [base] } };
  }
  return { Field: { base, name: value.name.text } };
}

export function lowerOptionalPropertyChain(
  value: ts.PropertyAccessChain,
  env: Environment,
  lowerValue: (node: ts.Expression, env: Environment, hint?: string) => LoweredValue,
  hint?: string,
): LoweredValue {
  const segments: ts.PropertyAccessExpression[] = [];
  let baseNode: ts.Expression = value;
  while (ts.isPropertyAccessChain(baseNode)) {
    segments.unshift(baseNode);
    baseNode = baseNode.expression;
  }
  const base = lowerValue(baseNode, env, hint);
  const baseName = temporary(env, "optionalBase");
  const result = temporary(env, "optionalValue");
  const lowerSegments = (index: number, current: Expr): Stmt[] => {
    const segment = segments[index]!;
    const accessed = lowerPropertyValue(segment, current, env);
    const body = index === segments.length - 1
      ? [{ Assign: { name: result, value: accessed } } satisfies Stmt]
      : (() => {
          const next = temporary(env, "optionalStep");
          return [
            { Let: { name: next, value: accessed } } satisfies Stmt,
            ...lowerSegments(index + 1, { Variable: next }),
          ];
        })();
    return segment.questionDotToken
      ? [{ If: {
          condition: { Binary: { op: "Ne", left: current, right: literal(null) } },
          then_body: body,
          else_body: [],
        } }]
      : body;
  };
  return {
    statements: [
      ...base.statements,
      { Let: { name: baseName, value: base.expression } },
      { Let: { name: result, value: literal(null) } },
      ...lowerSegments(0, { Variable: baseName }),
    ],
    expression: { Variable: result },
  };
}

export function loopDomainMaximum(domain: LoopDomain): number {
  if ("Page" in domain) {
    return "Literal" in domain.Page.take ? domain.Page.take.Literal : domain.Page.take.Arg.max;
  }
  if ("LiteralRange" in domain) {
    return Math.max(0, domain.LiteralRange.end_exclusive - domain.LiteralRange.start);
  }
  if ("ArgList" in domain) return domain.ArgList.max;
  if ("DerivedArray" in domain) return domain.DerivedArray.max;
  const recurse = domain.Recurse;
  if (recurse.fanout === 0) return 1;
  if (recurse.fanout === 1) return recurse.depth + 1;
  const total = (recurse.fanout ** (recurse.depth + 1) - 1) / (recurse.fanout - 1);
  return Number.isSafeInteger(total) ? total : Number.MAX_SAFE_INTEGER;
}

export function lowerCoalesce(
  node: ts.BinaryExpression,
  env: Environment,
  hint: string | undefined,
  lowerValue: (node: ts.Expression, env: Environment, hint?: string) => LoweredValue,
): LoweredValue {
  const name = temporary(env, "coalesce");
  if (ts.isPropertyAccessExpression(node.left) && node.left.questionDotToken) {
    const base = lowerValue(node.left.expression, env, hint);
    const right = lowerValue(node.right, env, hint);
    const baseName = temporary(env, "optional");
    return {
      statements: [
        ...base.statements,
        { Let: { name: baseName, value: base.expression } },
        ...right.statements,
        { Let: { name, value: right.expression } },
        { If: {
          condition: { Binary: { op: "Ne", left: { Variable: baseName }, right: literal(null) } },
          then_body: [{ Assign: { name, value: { Field: { base: { Variable: baseName }, name: node.left.name.text } } } }],
          else_body: [],
        } },
      ],
      expression: { Variable: name },
    };
  }
  const left = lowerValue(node.left, env, hint);
  const right = lowerValue(node.right, env, hint);
  const leftName = temporary(env, "optional");
  return {
    statements: [
      ...left.statements,
      { Let: { name: leftName, value: left.expression } },
      ...right.statements,
      { Let: { name, value: right.expression } },
      { If: {
        condition: { Binary: { op: "Ne", left: { Variable: leftName }, right: literal(null) } },
        then_body: [{ Assign: { name, value: { Variable: leftName } } }],
        else_body: [],
      } },
    ],
    expression: { Variable: name },
  };
}
export function lowerPatch(node: ts.Expression, env: Environment): Expr {
  if (ts.isArrowFunction(node) || ts.isFunctionExpression(node)) {
    if (node.parameters.length !== 1 || !ts.isIdentifier(node.parameters[0]!.name)) {
      refuse(env, "E_OPAQUE", node, "write callback must have one identifier parameter");
    }
    if (ts.isBlock(node.body)) refuse(env, "E_OPAQUE", node.body, "write callback body must be an expression");
    const callbackEnv = cloneEnvironment(env);
    const name = node.parameters[0].name.text;
    callbackEnv.variables.set(name, { provenance: "Shape", rowBinding: true });
    return lowerExpr(node.body, callbackEnv);
  }
  return lowerExpr(node, env);
}

export function lowerDomain(
  expression: ts.Expression,
  env: Environment,
  binding: string,
  hint?: string,
): { domain: LoopDomain; bindingInfo: VariableInfo } {
  return guardedWalk(env, expression, "loop domain", () => lowerDomainInner(expression, env, binding, hint));
}
function lowerDomainInner(
  expression: ts.Expression,
  env: Environment,
  binding: string,
  hint?: string,
): { domain: LoopDomain; bindingInfo: VariableInfo } {
  const expanded = expandHelper(expression, env);
  if (expanded) return lowerDomain(expanded.expression, expanded.environment, binding, hint);
  const call = unwrapCall(expression);
  if (call && callName(call).endsWith(".scan")) {
    return {
      domain: { Page: lowerScan(call, env, hint ?? `${env.programName}.${tableReference(call.arguments[0]!, env).table}`) },
      bindingInfo: { provenance: "Shape", objectFields: rowFields(call.arguments[0], env), rowBinding: true },
    };
  }
  if (call && ts.isIdentifier(call.expression) && call.expression.text === "range") {
    const start = numericLiteral(call.arguments[0]);
    const end = numericLiteral(call.arguments[1]);
    if (start === undefined || end === undefined) refuse(env, "E_UNBOUND_LOOP", call, "literal range requires literal endpoints");
    return { domain: { LiteralRange: { start, end_exclusive: end } }, bindingInfo: { provenance: "Const" } };
  }
  if (call && ts.isIdentifier(call.expression) && call.expression.text === "mentionTokens") {
    const value = call.arguments[0];
    if (!value) refuse(env, "E_OPAQUE", call, "mentionTokens requires text");
    return {
      domain: { DerivedArray: {
        value: { Builtin: { builtin: "MentionTokens", args: [lowerExpr(value, env)] } },
        max: 85,
        bound_source: "messages.body max 256 / min whitespace mention 3",
      } },
      bindingInfo: { provenance: "Computed" },
    };
  }
  if (call && ts.isIdentifier(call.expression) && call.expression.text === "recurse") {
    return lowerRecurse(call, env);
  }
  const operationList = operationArgumentList(expression, env);
  if (operationList?.max !== undefined) {
    return {
      domain: { ArgList: { name: operationList.name, max: operationList.max } },
      bindingInfo: collectionElementBinding(expression, env),
    };
  }
  const identifier = operationList ? undefined : identifierFromArgsOrLocal(expression, (name) => env.variables.get(name)?.operationComposite === "args");
  if (identifier) {
    const info = env.variables.get(identifier);
    if (info?.max !== undefined) {
      if (info.operationArgument && env.args[info.operationArgument]
        && typeof env.args[info.operationArgument] !== "string") {
        return {
          domain: { ArgList: { name: info.operationArgument, max: info.max } },
          bindingInfo: collectionElementBinding(expression, env),
        };
      }
      return {
        domain: { DerivedArray: {
          value: { Variable: identifier },
          max: info.max,
          bound_source: info.boundSource ?? `${identifier} declared max`,
        } },
        bindingInfo: {
          provenance: info.provenance,
          ...(info.provenanceAmbiguity ? { provenanceAmbiguity: { ...info.provenanceAmbiguity } } : {}),
          ...(info.rowCollection ? { rowBinding: true, objectFields: info.objectFields } : {}),
          ...(info.elementOrigins ? { alternativeOrigins: info.elementOrigins } : {}),
        },
      };
    }
  }
  const maximum = staticBound(expression, env);
  if (maximum !== undefined) return {
    domain: { DerivedArray: { value: lowerExpr(expression, env), max: maximum,
      bound_source: `${expression.getText(env.sourceFile)} static bound` } },
    bindingInfo: collectionElementBinding(expression, env),
  };
  refuse(env, "E_UNBOUND_LOOP", expression, "loop domain has no static cardinality");
}

function lowerRecurse(call: ts.CallExpression, env: Environment): { domain: LoopDomain; bindingInfo: VariableInfo } {
  const seed = call.arguments[0];
  const step = call.arguments[1];
  const options = call.arguments[2];
  if (!seed || !step || !isFunctionLike(step) || !options || !ts.isObjectLiteralExpression(options)) {
    refuse(env, "E_OPAQUE", call, "recurse requires seed, inline step, depth, and fanout");
  }
  const depth = numberProperty(options, "depth");
  const fanout = numberProperty(options, "fanout");
  if (depth === undefined || fanout === undefined) refuse(env, "E_UNBOUND_LOOP", options, "recurse bounds must be literals");
  if (depth > 10_000) refuse(env, "E_UNBOUND_LOOP", options, "recurse depth must be at most 10000");
  if (step.parameters.length !== 1 || !ts.isIdentifier(step.parameters[0]!.name)) {
    refuse(env, "E_OPAQUE", step, "recurse step requires exactly one row parameter");
  }
  const row = step.parameters[0].name.text;
  const body = ts.isBlock(step.body)
    && step.body.statements.length === 1
    && ts.isReturnStatement(step.body.statements[0])
    ? step.body.statements[0].expression
    : ts.isBlock(step.body) ? undefined : step.body;
  const get = body && unwrapCall(body);
  if (!get || !callName(get).endsWith(".get")
    || !isDbMember(get.expression, (binding) => isOperationCompositeBinding(binding, "db", env))) {
    refuse(env, "E_OPAQUE", step, "recurse step must be exactly one get through the operation db binding");
  }
  const ref = tableReference(get.arguments[0]!, env);
  const key = get.arguments[1];
  if (!key || !ts.isPropertyAccessExpression(key)
    || !ts.isIdentifier(key.expression) || key.expression.text !== row) {
    refuse(env, "E_OPAQUE", get, "recurse step key must be a field of its bound row parameter");
  }
  return {
    domain: { Recurse: {
      site: allocateReadSite(env),
      table: ref.table,
      index: ref.index,
      seed: lowerExpr(seed, env),
      next_field: key.name.text,
      depth,
      fanout,
      provenance: "Shape",
    } },
    bindingInfo: { provenance: "Shape", rowBinding: true },
  };
}

export function lowerExpr(node: ts.Expression, env: Environment, hint?: string): Expr {
  return guardedWalk(env, node, "expression", () => lowerExprInner(node, env, hint));
}

function lowerExprInner(node: ts.Expression, env: Environment, hint?: string): Expr {
  const substituted = ts.isIdentifier(node) ? env.substitutions.get(node.text) : undefined;
  if (substituted) return lowerExpr(substituted.expression, substituted.environment, hint);
  const unwrapped = unwrapExpression(node);
  if (unwrapped !== node) return lowerExpr(unwrapped, env, hint);

  if (node.kind === ts.SyntaxKind.NullKeyword) return literal(null);
  if (node.kind === ts.SyntaxKind.TrueKeyword) return literal(true);
  if (node.kind === ts.SyntaxKind.FalseKeyword) return literal(false);
  if (ts.isNumericLiteral(node)) {
    const scaled = env.literalValues.get(contextualNodeKey(env.literalContext, node, env.sourceFile));
    const expanded = expandedNumericLiteral(node.text);
    const fractional = !Number.isInteger(Number(node.text)) || (expanded?.fraction.length ?? 0) > 0;
    if (fractional && scaled === undefined) {
      const scale = Math.max(1, expanded?.fraction.length ?? 0);
      refuse(
        env,
        "E_DECIMAL_SCALE",
        node,
        `fractional literal ${node.text} has no known Decimal scale`,
        replaceNode(env.source, node, `decimal(${node.text}, ${scale})`),
      );
    }
    if (!fractional && scaled === undefined && expanded
      && BigInt(expanded.whole) > 9_007_199_254_740_991n) {
      refuse(
        env,
        "E_OPAQUE",
        node,
        `integer literal ${node.text} is outside the safe integer range`,
        replaceNode(env.source, node, "9007199254740991"),
      );
    }
    return literal(scaled ?? Number(node.text));
  }
  if (ts.isStringLiteralLike(node)) return literal(node.text);
  if (ts.isIdentifier(node)) {
    const info = env.variables.get(node.text);
    if (info?.operationComposite === "args") {
      return { Object: Object.fromEntries(Object.keys(env.args).map((name) => [name, { Variable: name } satisfies Expr])) };
    }
    if (info?.operationComposite === "ctx") return { Object: { viewer: { Input: "Viewer" } } };
    return { Variable: node.text };
  }
  if (ts.isArrayLiteralExpression(node)) {
    const segments: Expr[] = [];
    let plain: Expr[] = [];
    const flush = () => {
      if (plain.length > 0) segments.push({ Array: plain });
      plain = [];
    };
    for (const element of node.elements) {
      try {
        if (ts.isSpreadElement(element)) {
          if (staticBound(element.expression, env) === undefined) {
            refuse(
              env,
              "E_OPAQUE",
              element,
              "array spread requires a statically bounded array; spell its elements explicitly",
              arraySpreadRewrite(env, element),
            );
          }
          flush();
          segments.push(lowerExpr(element.expression, env));
        } else {
          plain.push(lowerExpr(element, env));
        }
      } catch (error) {
        captureRefusal(env, error);
      }
    }
    flush();
    return segments.length === 0 ? { Array: [] } : segments.length === 1 ? segments[0]! : concatExpressions(segments);
  }
  if (ts.isObjectLiteralExpression(node)) {
    const object: Record<string, Expr> = Object.create(null);
    for (const property of node.properties) {
      try {
        if (ts.isSpreadAssignment(property)) {
          const nullable = nullableReadSpread(property.expression, env);
          if (nullable) nullableSpreadRefusal(property, env, nullable);
          const fields = knownObjectFields(property.expression, env);
          if (!fields) {
            refuse(
              env,
              "E_OPAQUE",
              property,
              "object spread requires a statically known object shape; spell its fields explicitly",
              objectSpreadRewrite(env, property),
            );
          }
          if (ts.isIdentifier(property.expression)
            && env.variables.get(property.expression.text)?.operationComposite === "args") {
            for (const field of fields) object[field] = { Variable: field };
          } else {
            const base = lowerExpr(property.expression, env);
            if ("Object" in base) {
              for (const [field, expression] of Object.entries(base.Object)) object[field] = expression;
            } else {
              for (const field of fields) object[field] = { Field: { base, name: field } };
            }
          }
          continue;
        }
        if (ts.isShorthandPropertyAssignment(property)) {
          object[property.name.text] = lowerExpr(property.name, env);
          continue;
        }
        if (!ts.isPropertyAssignment(property)) refuse(env, "E_OPAQUE", property, "object method/property form is unsupported");
        const name = propertyName(property.name);
        if (!name) refuse(env, "E_OPAQUE", property.name, "computed object keys are unsupported");
        object[name] = lowerExpr(property.initializer, env, hint ? `${hint}.${name}` : name);
      } catch (error) {
        captureRefusal(env, error);
      }
    }
    return { Object: object };
  }
  if (ts.isPropertyAccessExpression(node)) {
    if (node.questionDotToken) {
      refuse(env, "E_OPAQUE", node, "optional property access must be lowered in a statement-aware expression position");
    }
    if (ts.isIdentifier(node.expression)) {
      const composite = env.variables.get(node.expression.text)?.operationComposite;
      if (composite === "args") return { Variable: node.name.text };
      if (composite === "ctx") {
        if (node.name.text === "viewer") return { Input: "Viewer" };
        if (node.name.text === "readTime") return { Input: "ReadTime" };
        if (node.name.text === "commitTime") return { Input: "Now" };
      }
    }
    if (node.name.text === "length" && !isKnownRowOrObject(node.expression, env)) {
      return { Builtin: { builtin: "Len", args: [lowerExpr(node.expression, env)] } };
    }
    const base = lowerExpr(node.expression, env);
    if ("Object" in base && base.Object[node.name.text]) return base.Object[node.name.text]!;
    return { Field: { base, name: node.name.text } };
  }
  if (ts.isBinaryExpression(node)) {
    const op = binaryOperator(node.operatorToken.kind);
    if (!op) refuse(env, "E_OPAQUE", node.operatorToken, `operator ${node.operatorToken.getText()} is outside the IR`);
    return { Binary: { op, left: lowerExpr(node.left, env), right: lowerExpr(node.right, env) } };
  }
  if (ts.isPrefixUnaryExpression(node)) {
    if (node.operator === ts.SyntaxKind.ExclamationToken) return { Unary: { op: "Not", value: lowerExpr(node.operand, env) } };
    if (node.operator === ts.SyntaxKind.MinusToken) return { Unary: { op: "Neg", value: lowerExpr(node.operand, env) } };
  }
  if (ts.isNoSubstitutionTemplateLiteral(node)) return literal(node.text);
  if (ts.isTemplateExpression(node)) {
    const parts: Expr[] = [];
    if (node.head.text) parts.push(literal(node.head.text));
    for (const span of node.templateSpans) {
      parts.push(lowerExpr(span.expression, env));
      if (span.literal.text) parts.push(literal(span.literal.text));
    }
    if (parts.length === 1) return concatExpressions([literal(""), parts[0]!]);
    return concatExpressions(parts);
  }
  if (ts.isCallExpression(node)) return lowerCall(node, env, hint);
  refuse(env, "E_OPAQUE", node, `expression ${ts.SyntaxKind[node.kind]} is outside the S1 IR`);
}

function captureRefusal(env: Environment, error: unknown): void {
  if (error instanceof Refusal) env.diagnostics.push(error.diagnostic);
  else throw error;
}

function lowerCall(call: ts.CallExpression, env: Environment, hint?: string): Expr {
  const expanded = expandHelper(call, env);
  if (expanded) return lowerExpr(expanded.expression, expanded.environment, hint);
  const name = callName(call);
  if (name === "decimal" && call.arguments[0]) return lowerExpr(call.arguments[0], env, hint);
  const compositeMember = ts.isPropertyAccessExpression(call.expression) ? call.expression : undefined;
  const compositeCall = compositeMember && ts.isIdentifier(compositeMember.expression)
    ? env.variables.get(compositeMember.expression.text)?.operationComposite
    : undefined;
  if (compositeCall === "ctx" && compositeMember?.name.text === "now") {
    return { Input: env.kind === "Query" ? "ReadTime" : "Now" };
  }
  if (compositeCall === "ctx" && compositeMember?.name.text === "commitTime") return { Input: "Now" };
  if (compositeCall === "ctx" && compositeMember?.name.text === "newId") return { Input: "NewId" };
  if (name.endsWith(".get")
    && isDbMember(call.expression, (binding) => isOperationCompositeBinding(binding, "db", env))) {
    return { Get: lowerRead(call, env, hint) };
  }
  if (name.endsWith(".exists")
    && isDbMember(call.expression, (binding) => isOperationCompositeBinding(binding, "db", env))) {
    return { Exists: lowerRead(call, env, hint) };
  }
  if (name.endsWith(".scan")
    && isDbMember(call.expression, (binding) => isOperationCompositeBinding(binding, "db", env))) {
    return { Scan: lowerScan(call, env, hint) };
  }
  if (["normalizeWordPrefix", "normalizeHandle"].includes(name) && call.arguments[0]) {
    return lowerExpr(call.arguments[0], env, hint);
  }
  if (name === "memberOf") {
    const conversation = call.arguments[0];
    if (!conversation) refuse(env, "E_OPAQUE", call, "memberOf requires a conversation id");
    return {
      Exists: {
        site: allocateReadSite(env),
        table: "memberships",
        index: "byConvUser",
        key: [lowerExpr(conversation, env), { Input: "Viewer" }],
        provenance: combineProvenance([readProvenance(conversation, env), "Viewer"]),
      },
    };
  }
  if (["concat", "max", "min", "divmod", "deterministicShare", "mentionTokens"].includes(name)) {
    const builtin = ({
      concat: "Concat",
      max: "Max",
      min: "Min",
      divmod: { Divmod: { remainder_sink: "lexicographic-id" } },
      deterministicShare: "DeterministicShare",
      mentionTokens: "MentionTokens",
    } as Record<string, string | Record<string, unknown>>)[name]!;
    const args = call.arguments.map((arg) => lowerExpr(arg, env));
    const required = name === "deterministicShare" ? 3 : name === "mentionTokens" ? 1 : 2;
    if (args.length < required || (name !== "concat" && name !== "max" && name !== "min" && args.length !== required)) {
      refuse(env, "E_OPAQUE", call, `${name} requires ${required === 1 ? "one argument" : required === 2 ? "at least two arguments" : "three arguments"}`);
    }
    if (name === "concat" && args.length > 2) return concatExpressions(args);
    if ((name === "max" || name === "min") && args.length > 2) {
      return args.slice(1).reduce<Expr>(
        (left, right) => ({ Builtin: { builtin, args: [left, right] } }),
        args[0]!,
      );
    }
    return { Builtin: { builtin, args } };
  }
  if (ts.isPropertyAccessExpression(call.expression)) {
    const method = call.expression.name.text;
    const owner = call.expression.expression;
    if (method === "count" || method === "countCapped") {
      return { Builtin: {
        builtin: method === "count" ? "Count" : "CountCapped",
        args: [lowerExpr(owner, env, hint)],
      } };
    }
    if (method === "slice") {
      if (call.arguments.length !== 2) refuse(env, "E_OPAQUE", call, "slice requires start and end arguments");
      return { Builtin: { builtin: "Slice", args: [lowerExpr(owner, env), ...call.arguments.map((arg) => lowerExpr(arg, env))] } };
    }
    if (method === "sort") return lowerSort(owner, call.arguments[0], env);
  }
  refuse(env, "E_OPAQUE", call, `helper ${name} is not defined in this module or the pure builtin set`);
}

function lowerSort(owner: ts.Expression, comparator: ts.Expression | undefined, env: Environment): Expr {
  return lowerSortExpression(lowerExpr(owner, env), comparator, env);
}

export function lowerSortExpression(owner: Expr, comparator: ts.Expression | undefined, env: Environment): Expr {
  if (!comparator || !isFunctionLike(comparator) || comparator.parameters.length !== 2
    || !ts.isIdentifier(comparator.parameters[0]!.name) || !ts.isIdentifier(comparator.parameters[1]!.name)
    || ts.isBlock(comparator.body)) {
    refuse(env, "E_OPAQUE", comparator ?? env.sourceFile, "sort requires an inline field comparator");
  }
  const body = comparator.body;
  if (!ts.isBinaryExpression(body) || body.operatorToken.kind !== ts.SyntaxKind.MinusToken
    || !ts.isPropertyAccessExpression(body.left) || !ts.isPropertyAccessExpression(body.right)) {
    refuse(env, "E_OPAQUE", body, "sort comparator must subtract the same scalar field");
  }
  const leftParam = ts.isIdentifier(body.left.expression) ? body.left.expression.text : "";
  const rightParam = ts.isIdentifier(body.right.expression) ? body.right.expression.text : "";
  const firstParam = comparator.parameters[0].name.text;
  const secondParam = comparator.parameters[1].name.text;
  if (body.left.name.text !== body.right.name.text
    || !((leftParam === firstParam && rightParam === secondParam)
      || (leftParam === secondParam && rightParam === firstParam))) {
    refuse(env, "E_OPAQUE", body, "sort comparator must subtract the same field from its two opposite parameters");
  }
  const order = leftParam === firstParam ? "Asc" : "Desc";
  return { Builtin: {
    builtin: { Sort: { keys: [{ field: body.left.name.text, order }] } },
    args: [owner],
  } };
}

function lowerRead(call: ts.CallExpression, env: Environment, hint?: string) {
  const target = call.arguments[0];
  const key = call.arguments[1];
  if (!target || !key) refuse(env, "E_OPAQUE", call, "point read requires target and key");
  const ref = tableReference(target, env);
  return {
    site: allocateReadSite(env),
    table: ref.table,
    index: ref.index,
    key: lowerKey(key, env),
    provenance: readProvenance(key, env),
  };
}

function lowerScan(call: ts.CallExpression, env: Environment, hint?: string): Scan {
  const target = call.arguments[0];
  const prefix = call.arguments[1];
  const options = call.arguments[2];
  if (!target || !prefix || !options || !ts.isObjectLiteralExpression(options)) {
    refuse(env, "E_UNBOUND_SCAN", call, "scan requires target, prefix, and options with take");
  }
  const ref = tableReference(target, env);
  const takeNode = expressionProperty(options, "take");
  if (!takeNode) refuse(env, "E_UNBOUND_SCAN", call, "scan options require take");
  let take: Scan["take"];
  const literalTake = numericLiteral(takeNode);
  if (literalTake !== undefined) {
    take = { Literal: literalTake };
  } else {
    const name = identifierFromArgsOrLocal(
      takeNode,
      (binding) => env.variables.get(binding)?.operationComposite === "args",
    );
    const operationArgument = name && env.variables.get(name)?.operationArgument;
    const arg = operationArgument && env.args[operationArgument];
    const max = name && arg && typeof arg !== "string" && "List" in arg ? arg.List.max : undefined;
    if (!operationArgument || max === undefined) refuse(env, "E_UNBOUND_SCAN", takeNode, "take argument needs a declared max");
    take = { Arg: { name: operationArgument, max } };
  }
  const orderNode = expressionProperty(options, "order");
  const authoredOrder = stringLiteral(orderNode);
  if (orderNode && authoredOrder !== "asc" && authoredOrder !== "desc") {
    refuse(env, "E_OPAQUE", orderNode, 'scan order must be "asc" or "desc"');
  }
  const rangeNode = expressionProperty(options, "range");
  return {
    site: allocateReadSite(env),
    table: ref.table,
    index: ref.index,
    prefix: lowerKey(prefix, env),
    order: authoredOrder === "desc" ? "Desc" : "Asc",
    take,
    after: optionalLower(expressionProperty(options, "after"), env),
    before: optionalLower(expressionProperty(options, "before"), env),
    range: rangeNode && ts.isObjectLiteralExpression(rangeNode)
      ? {
          gt: optionalLower(expressionProperty(rangeNode, "gt"), env),
          gte: optionalLower(expressionProperty(rangeNode, "gte"), env),
          lt: optionalLower(expressionProperty(rangeNode, "lt"), env),
          lte: optionalLower(expressionProperty(rangeNode, "lte"), env),
        }
      : null,
    provenance: readProvenance(prefix, env),
  };
}

export function tableReference(node: ts.Expression, env: Environment): { table: string; index: string } {
  const path = staticMemberPath(node);
  const direct = path && env.tables.get(path);
  if (direct) return { table: direct.name, index: direct.maintainedFrom ? "byGroup" : "byId" };
  const separator = path?.lastIndexOf(".") ?? -1;
  const owner = separator > 0 ? env.tables.get(path!.slice(0, separator)) : undefined;
  if (owner) return { table: owner.name, index: path!.slice(separator + 1) };
  refuse(
    env,
    "E_OPAQUE",
    node,
    `static table/index reference required; ${node.getText(env.sourceFile)} does not resolve to an imported table or table.index`,
    replaceNode(env.source, node, "table.index"),
  );
}

export function lowerKey(node: ts.Expression, env: Environment): Expr[] {
  const value = unwrapExpression(node);
  return ts.isArrayLiteralExpression(value)
    ? value.elements.map((element) => lowerExpr(element, env))
    : [lowerExpr(value, env)];
}

export function cloneEnvironment(env: Environment): Environment {
  return {
    ...env,
    variables: new Map([...env.variables].map(([name, info]) => [name, { ...info }])),
    substitutions: new Map(env.substitutions),
    helperStack: [...env.helperStack],
    deferredCollectionMutations: new Set(env.deferredCollectionMutations),
  };
}

export function enterLexicalScope(env: Environment): Environment {
  return {
    ...env,
    // Declarations and shadows write only to this map. Existing bindings keep
    // their VariableInfo identity so analysis updates survive the scope.
    variables: new Map(env.variables),
    substitutions: new Map(env.substitutions),
    helperStack: [...env.helperStack],
    deferredCollectionMutations: new Set(env.deferredCollectionMutations),
  };
}

/**
 * Certificate identities are pinned to module + exported operation + the lexical
 * read/write ordinal. The shared counter makes helper rename, extraction/inlining,
 * and whitespace irrelevant; writes reserve ordinals even though today's WriteSite
 * serde shape does not yet expose a site string.
 */
export function allocateReadSite(env: Environment): string {
  const site = `${env.siteBase}.${env.accessOrdinal.value}`;
  env.accessOrdinal.value += 1;
  return site;
}

export function reserveWriteSite(env: Environment): void {
  env.accessOrdinal.value += 1;
}

export function containsRead(value: unknown, seen = new Set<object>(), depth = 0): boolean {
  if (depth >= MAX_RECURSION_DEPTH) return true;
  if (Array.isArray(value)) {
    if (seen.has(value)) return true;
    seen.add(value);
    const result = value.some((item) => containsRead(item, seen, depth + 1));
    seen.delete(value);
    return result;
  }
  if (!value || typeof value !== "object") return false;
  const object = value as Record<string, unknown>;
  if (seen.has(object)) return true;
  seen.add(object);
  const result = ["Get", "Exists", "Scan"].some((kind) => kind in object)
    || Object.values(object).some((item) => containsRead(item, seen, depth + 1));
  seen.delete(object);
  return result;
}

export function lowerArrayMethod(
  method: string,
  owner: ts.Expression,
  call: ts.CallExpression,
  env: Environment,
  lowerValue: (node: ts.Expression, env: Environment, hint?: string) => LoweredValue,
  hint?: string,
): LoweredValue {
  const callback = call.arguments[0];
  if (!callback || !isFunctionLike(callback) || callback.parameters.length < 1
    || !ts.isIdentifier(callback.parameters[0]!.name)) {
    refuse(env, "E_OPAQUE", call, `${method} requires an inline callback with an identifier`);
  }
  if (ts.isBlock(callback.body)) refuse(env, "E_OPAQUE", callback.body, `${method} callback must be an expression`);
  const expectedParameters = method === "reduce" ? 2 : 1;
  if (callback.parameters.length !== expectedParameters
    || callback.parameters.some((parameter) => !ts.isIdentifier(parameter.name))) {
    refuse(env, "E_OPAQUE", callback, method === "reduce"
      ? "reduce callback requires exactly accumulator and item parameters"
      : `${method} callback requires exactly one parameter`);
  }
  const binding = callback.parameters[0].name.text;
  const loopEnv = cloneEnvironment(env);
  const { statements: domainStatements, domain, bindingInfo } = lowerCollectionDomain(
    owner,
    loopEnv,
    binding,
    lowerValue,
    hint,
  );
  loopEnv.variables.set(binding, bindingInfo);
  if (method === "map" || method === "filter") {
    const name = temporary(env, method);
    const lowered = lowerValue(callback.body, loopEnv, hint);
    const body = method === "map"
      ? [...lowered.statements, { Push: { target: name, value: lowered.expression } } satisfies import("../ir").Stmt]
      : [...lowered.statements, { If: {
          condition: lowered.expression,
          then_body: [{ Push: { target: name, value: { Variable: binding } } }],
          else_body: [],
        } } satisfies import("../ir").Stmt];
    const resultOrigin = method === "filter"
      ? { provenance: bindingInfo.provenance, ...(bindingInfo.provenanceAmbiguity
          ? { provenanceAmbiguity: { ...bindingInfo.provenanceAmbiguity } }
          : {}) }
      : withDirectRewrite(provenanceBinding(callback.body, loopEnv), callback.body, loopEnv);
    const callbackValue = unwrapExpression(callback.body);
    const identityMap = method === "map" && ts.isIdentifier(callbackValue) && callbackValue.text === binding;
    const preservesRows = (method === "filter" || identityMap) && bindingInfo.rowBinding;
    const elementOrigins = method === "filter"
      ? bindingOrigins(bindingInfo)
      : [{ expression: callback.body, environment: loopEnv } satisfies ProvenanceOrigin];
    const bound = derivedBound(owner, env);
    env.variables.set(name, maintainCollectionFacts({
      ...resultOrigin,
      ...(preservesRows ? { rowCollection: true, objectFields: bindingInfo.objectFields } : {}),
    }, { ...bound, elementOrigins }));
    return {
      statements: [...domainStatements, { Let: { name, value: { Array: [] } } }, { For: { binding, domain, body } }],
      expression: { Variable: name },
    };
  }
  if (method === "flatMap") {
    const name = temporary(env, "flatMap");
    const innerBinding = temporary(env, "flatItem");
    const inner = lowerCollectionDomain(callback.body, loopEnv, innerBinding, lowerValue, hint);
    const innerEnv = cloneEnvironment(loopEnv);
    innerEnv.variables.set(innerBinding, inner.bindingInfo);
    env.variables.set(name, maintainCollectionFacts({
      ...inner.bindingInfo,
      ...(inner.bindingInfo.rowBinding
        ? { rowCollection: true, objectFields: inner.bindingInfo.objectFields }
        : {}),
    }, {
      max: loopDomainMaximum(domain) * loopDomainMaximum(inner.domain),
      boundSource: `${call.getText(env.sourceFile)} flatMap bounds`,
      elementOrigins: bindingOrigins(inner.bindingInfo),
    }));
    return {
      statements: [
        ...domainStatements,
        { Let: { name, value: { Array: [] } } },
        { For: {
          binding,
          domain,
          body: [...inner.statements, { For: {
            binding: innerBinding,
            domain: inner.domain,
            body: [{ Push: { target: name, value: { Variable: innerBinding } } }],
          } }],
        } },
      ],
      expression: { Variable: name },
    };
  }
  if (method === "reduce") {
    const initial = call.arguments[1];
    if (!initial || callback.parameters.length < 2 || !ts.isIdentifier(callback.parameters[1]!.name)) {
      refuse(env, "E_OPAQUE", call, "reduce requires accumulator, item, and initial value");
    }
    const accumulator = callback.parameters[0].name.text;
    const item = callback.parameters[1].name.text;
    const reduceEnv = cloneEnvironment(env);
    reduceEnv.variables.set(item, bindingInfo);
    const name = temporary(env, "reduce");
    reduceEnv.substitutions.set(accumulator, {
      expression: syntheticIdentifier(env.sourceFile, name),
      environment: reduceEnv,
    });
    const lowered = lowerValue(callback.body, reduceEnv, hint);
    return {
      statements: [
        ...domainStatements,
        { Let: { name, value: lowerExpr(initial, env) } },
        { For: { binding: item, domain, body: [...lowered.statements, { Assign: { name, value: lowered.expression } }] } },
      ],
      expression: { Variable: name },
    };
  }
  const name = temporary(env, "some");
  const lowered = lowerValue(callback.body, loopEnv, hint);
  return {
    statements: [
      ...domainStatements,
      { Let: { name, value: literal(false) } },
      { For: {
        binding,
        domain,
        body: [...lowered.statements, { If: {
          condition: lowered.expression,
          then_body: [{ Assign: { name, value: literal(true) } }, "Break"],
          else_body: [],
        } }],
      } },
    ],
    expression: { Variable: name },
  };
}

export function lowerCollectionDomain(
  expression: ts.Expression,
  env: Environment,
  binding: string,
  lowerValue: (node: ts.Expression, env: Environment, hint?: string) => LoweredValue,
  hint?: string,
): ReturnType<typeof lowerDomain> & { statements: import("../ir").Stmt[] } {
  const value = unwrapExpression(expression);
  const call = unwrapCall(value);
  const method = call && ts.isPropertyAccessExpression(call.expression) ? call.expression.name.text : undefined;
  if (method && ["map", "flatMap", "filter", "sort", "slice"].includes(method)) {
    const lowered = lowerValue(expression, env, hint);
    if ("Variable" in lowered.expression) {
      const loweredDomain = lowerDomain(syntheticIdentifier(env.sourceFile, lowered.expression.Variable), env, binding, hint);
      return { statements: lowered.statements, ...loweredDomain };
    }
    const maximum = staticBound(expression, env);
    if (maximum === undefined) refuse(env, "E_UNBOUND_LOOP", expression, "loop domain has no static cardinality");
    const rowCollection = isRowCollectionExpression(expression, env);
    return {
      statements: lowered.statements,
      domain: { DerivedArray: {
        value: lowered.expression,
        max: maximum,
        bound_source: `${expression.getText(env.sourceFile)} static bound`,
      } },
      bindingInfo: rowCollection
        ? { provenance: "Shape", rowBinding: true, objectFields: rowCollectionFields(expression, env) }
        : collectionElementBinding(expression, env),
    };
  }
  if (ts.isArrayLiteralExpression(value)) {
    const maximum = staticBound(expression, env);
    if (maximum === undefined) refuse(env, "E_UNBOUND_LOOP", expression, "loop domain has no static cardinality");
    const lowered = lowerValue(expression, env, hint);
    return {
      statements: lowered.statements,
      domain: { DerivedArray: {
        value: lowered.expression,
        max: maximum,
        bound_source: `${expression.getText(env.sourceFile)} static bound`,
      } },
      bindingInfo: collectionElementBinding(expression, env),
    };
  }
  return { statements: [], ...lowerDomain(expression, env, binding, hint) };
}

function bindingOrigins(binding: VariableInfo): ProvenanceOrigin[] {
  if (binding.alternativeOrigins) return binding.alternativeOrigins;
  const { elementOrigins: _elements, ...valueBinding } = binding;
  return [{ binding: valueBinding }];
}

function optionalLower(node: ts.Expression | undefined, env: Environment): Expr | null {
  return node ? lowerExpr(node, env) : null;
}
