import ts from "typescript";
import type { Environment, FunctionLike, LoweredValue, VariableInfo } from "../compiler";
import { refuse, Refusal } from "../diagnostics";
import type { Expr, LoopDomain, Provenance, Scan } from "../ir";
import {
  binaryOperator,
  callName,
  collectionConstructor,
  expressionProperty,
  expandedNumericLiteral,
  identifierFromArgsOrLocal,
  isDbMember,
  isFunctionLike,
  literal,
  lowerFirst,
  numberProperty,
  numericLiteral,
  propertyName,
  replaceNode,
  singular,
  staticMemberPath,
  stringLiteral,
  syntheticIdentifier,
  temporary,
  unwrapCall,
  unwrapExpression,
  walk,
} from "../syntax";

function concatExpressions(expressions: Expr[]): Expr {
  return expressions.slice(1).reduce<Expr>(
    (left, right) => ({ Builtin: { builtin: "Concat", args: [left, right] } }),
    expressions[0]!,
  );
}

export function knownObjectFields(node: ts.Expression, env: Environment): string[] | undefined {
  const value = unwrapExpression(node);
  if (ts.isIdentifier(value)) {
    if (value.text === "args") return Object.keys(env.args);
    return env.variables.get(value.text)?.objectFields;
  }
  if (ts.isObjectLiteralExpression(value)) {
    const fields: string[] = [];
    for (const property of value.properties) {
      if (ts.isSpreadAssignment(property)) {
        const spread = knownObjectFields(property.expression, env);
        if (!spread) return undefined;
        for (const field of spread) if (!fields.includes(field)) fields.push(field);
        continue;
      }
      if (ts.isShorthandPropertyAssignment(property)) {
        if (!fields.includes(property.name.text)) fields.push(property.name.text);
        continue;
      }
      if (!ts.isPropertyAssignment(property)) return undefined;
      const name = propertyName(property.name);
      if (!name) return undefined;
      if (!fields.includes(name)) fields.push(name);
    }
    return fields;
  }
  const call = unwrapCall(value);
  if (call && callName(call).endsWith(".get") && isDbMember(call.expression)) {
    return rowFields(call.arguments[0], env);
  }
  if (call && ts.isPropertyAccessExpression(call.expression) && call.expression.name.text === "require") {
    return knownObjectFields(call.expression.expression, env);
  }
  return undefined;
}

export function nullableReadSpread(node: ts.Expression, env: Environment): string | undefined {
  const value = unwrapExpression(node);
  if (ts.isIdentifier(value) && env.variables.get(value.text)?.nullableRead) return value.text;
  const call = unwrapCall(value);
  return call && callName(call).endsWith(".get") && isDbMember(call.expression) ? call.getText(env.sourceFile) : undefined;
}

export function nullableSpreadRefusal(node: ts.SpreadAssignment, env: Environment, value: string): never {
  const direct = value.includes(".get(");
  const rewrite = direct
    ? `const row = ${value};\ndb.require(row !== null, "ROW_REQUIRED");\n{ ...row }`
    : `db.require(${value} !== null, "ROW_REQUIRED");\n{ ...${value} }`;
  refuse(env, "E_OPAQUE", node, `nullable db.get result ${value} cannot be spread before it is required`, rewrite);
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

function objectSpreadRewrite(env: Environment, spread: ts.SpreadAssignment): string {
  const value = spread.expression.getText(env.sourceFile);
  return replaceNode(env.source, spread, `field: ${value}.field`);
}

function arraySpreadRewrite(env: Environment, spread: ts.SpreadElement): string {
  const value = spread.expression.getText(env.sourceFile);
  return replaceNode(env.source, spread, `${value}[0], ${value}[1]`);
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
  let total = 1;
  let width = 1;
  for (let depth = 0; depth < recurse.depth; depth += 1) {
    width *= recurse.fanout;
    total += width;
  }
  return total;
}

export function collectionMutationCounts(node: ts.Node): Map<string, number> {
  const result = new Map<string, number>();
  walk(node, (child) => {
    if (!ts.isCallExpression(child) || !ts.isPropertyAccessExpression(child.expression)
      || !ts.isIdentifier(child.expression.expression)
      || (child.expression.name.text !== "set" && child.expression.name.text !== "add")) return;
    const name = child.expression.expression.text;
    result.set(name, (result.get(name) ?? 0) + 1);
  });
  return result;
}

export function lowerCoalesce(
  node: ts.BinaryExpression,
  env: Environment,
  hint: string | undefined,
  lowerValue: (node: ts.Expression, env: Environment, hint?: string) => LoweredValue,
): LoweredValue {
  const right = lowerValue(node.right, env, hint);
  const name = temporary(env, "coalesce");
  if (ts.isPropertyAccessExpression(node.left) && node.left.questionDotToken) {
    const base = lowerValue(node.left.expression, env, hint);
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
    callbackEnv.variables.set(node.parameters[0].name.text, { provenance: "Shape" });
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
  const expanded = expandHelper(expression, env);
  if (expanded) return lowerDomain(expanded.expression, expanded.environment, binding, expanded.siteHint ?? hint);
  const call = unwrapCall(expression);
  if (call && callName(call).endsWith(".scan")) {
    return {
      domain: { Page: lowerScan(call, env, hint ?? `${env.programName}.${tableReference(call.arguments[0]!, env).table}`) },
      bindingInfo: { provenance: "Shape", objectFields: rowFields(call.arguments[0], env) },
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
  const identifier = identifierFromArgsOrLocal(expression);
  if (identifier) {
    const info = env.variables.get(identifier);
    if (info?.max !== undefined) {
      if (env.args[identifier] && typeof env.args[identifier] !== "string") {
        return {
          domain: { ArgList: { name: identifier, max: info.max } },
          bindingInfo: { provenance: info.provenance },
        };
      }
      return {
        domain: { DerivedArray: {
          value: { Variable: identifier },
          max: info.max,
          bound_source: info.boundSource ?? `${identifier} declared max`,
        } },
        bindingInfo: { provenance: info.provenance },
      };
    }
  }
  if (ts.isArrayLiteralExpression(expression)) {
    return {
      domain: { DerivedArray: {
        value: lowerExpr(expression, env),
        max: expression.elements.length,
        bound_source: `literal array length ${expression.elements.length}`,
      } },
      bindingInfo: { provenance: provenance(expression, env) },
    };
  }
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
  const body = ts.isBlock(step.body)
    ? step.body.statements.find(ts.isReturnStatement)?.expression
    : step.body;
  const get = body && unwrapCall(body);
  if (!get || !callName(get).endsWith(".get")) refuse(env, "E_OPAQUE", step, "recurse step must be one db.get");
  const ref = tableReference(get.arguments[0]!, env);
  const key = get.arguments[1];
  if (!key || !ts.isPropertyAccessExpression(key)) refuse(env, "E_OPAQUE", get, "recurse step key must be a row field");
  return {
    domain: { Recurse: {
      site: `${env.programName}.step`,
      table: ref.table,
      index: ref.index,
      seed: lowerExpr(seed, env),
      next_field: key.name.text,
      depth,
      fanout,
      provenance: "Shape",
    } },
    bindingInfo: { provenance: "Shape" },
  };
}

export function lowerExpr(node: ts.Expression, env: Environment, hint?: string): Expr {
  const substituted = ts.isIdentifier(node) ? env.substitutions.get(node.text) : undefined;
  if (substituted) return lowerExpr(substituted, env, hint);
  const unwrapped = unwrapExpression(node);
  if (unwrapped !== node) return lowerExpr(unwrapped, env, hint);

  if (node.kind === ts.SyntaxKind.NullKeyword) return literal(null);
  if (node.kind === ts.SyntaxKind.TrueKeyword) return literal(true);
  if (node.kind === ts.SyntaxKind.FalseKeyword) return literal(false);
  if (ts.isNumericLiteral(node)) {
    const scaled = env.literalValues.get(node.getStart(env.sourceFile));
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
    return literal(scaled ?? Number(node.text));
  }
  if (ts.isStringLiteralLike(node)) return literal(node.text);
  if (ts.isIdentifier(node)) return { Variable: node.text };
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
    const object: Record<string, Expr> = {};
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
          if (ts.isIdentifier(property.expression) && property.expression.text === "args") {
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
    if (ts.isIdentifier(node.expression) && node.expression.text === "args") return { Variable: node.name.text };
    if (ts.isIdentifier(node.expression) && node.expression.text === "ctx") {
      if (node.name.text === "viewer") return { Input: "Viewer" };
      if (node.name.text === "readTime") return { Input: "ReadTime" };
      if (node.name.text === "commitTime") return { Input: "Now" };
    }
    if (node.name.text === "length") {
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
    if (parts.length === 1) return parts[0]!;
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
  if (expanded) return lowerExpr(expanded.expression, expanded.environment, expanded.siteHint ?? hint);
  const name = callName(call);
  if (name === "decimal" && call.arguments[0]) return lowerExpr(call.arguments[0], env, hint);
  if (name === "ctx.now" || name === "ctx.commitTime") return { Input: "Now" };
  if (name === "ctx.newId") return { Input: "NewId" };
  if (name.endsWith(".get") && isDbMember(call.expression)) return { Get: lowerRead(call, env, hint) };
  if (name.endsWith(".exists") && isDbMember(call.expression)) return { Exists: lowerRead(call, env, hint) };
  if (name.endsWith(".scan") && isDbMember(call.expression)) return { Scan: lowerScan(call, env, hint) };
  if (["normalizeWordPrefix", "normalizeHandle"].includes(name) && call.arguments[0]) {
    return lowerExpr(call.arguments[0], env, hint);
  }
  if (name === "memberOf") {
    const conversation = call.arguments[0];
    if (!conversation) refuse(env, "E_OPAQUE", call, "memberOf requires a conversation id");
    return {
      Exists: {
        site: `${env.programName}.memberOf`,
        table: "memberships",
        index: "byConvUser",
        key: [lowerExpr(conversation, env), { Input: "Viewer" }],
        provenance: "Shape",
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
    if (name === "concat" && args.length > 2) return concatExpressions(args);
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
      return { Builtin: { builtin: "Slice", args: [lowerExpr(owner, env), ...call.arguments.map((arg) => lowerExpr(arg, env))] } };
    }
    if (method === "sort") return lowerSort(owner, call.arguments[0], env);
  }
  refuse(env, "E_OPAQUE", call, `helper ${name} is not defined in this module or the pure builtin set`);
}

function lowerSort(owner: ts.Expression, comparator: ts.Expression | undefined, env: Environment): Expr {
  if (!comparator || !isFunctionLike(comparator) || comparator.parameters.length < 2 || ts.isBlock(comparator.body)) {
    refuse(env, "E_OPAQUE", comparator ?? owner, "sort requires an inline field comparator");
  }
  const body = comparator.body;
  if (!ts.isBinaryExpression(body) || body.operatorToken.kind !== ts.SyntaxKind.MinusToken
    || !ts.isPropertyAccessExpression(body.left) || !ts.isPropertyAccessExpression(body.right)) {
    refuse(env, "E_OPAQUE", body, "sort comparator must subtract the same scalar field");
  }
  const leftParam = ts.isIdentifier(body.left.expression) ? body.left.expression.text : "";
  const firstParam = ts.isIdentifier(comparator.parameters[0]!.name) ? comparator.parameters[0].name.text : "";
  const order = leftParam === firstParam ? "Asc" : "Desc";
  return { Builtin: {
    builtin: { Sort: { keys: [{ field: body.left.name.text, order }] } },
    args: [lowerExpr(owner, env)],
  } };
}

function lowerRead(call: ts.CallExpression, env: Environment, hint?: string) {
  const target = call.arguments[0];
  const key = call.arguments[1];
  if (!target || !key) refuse(env, "E_OPAQUE", call, "point read requires target and key");
  const ref = tableReference(target, env);
  return {
    site: hint ?? `${env.programName}.${singular(ref.table)}`,
    table: ref.table,
    index: ref.index,
    key: lowerKey(key, env),
    provenance: provenance(key, env),
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
    const name = identifierFromArgsOrLocal(takeNode);
    const arg = name && env.args[name];
    const max = name && arg && typeof arg !== "string" && "List" in arg ? arg.List.max : undefined;
    if (!name || max === undefined) refuse(env, "E_UNBOUND_SCAN", takeNode, "take argument needs a declared max");
    take = { Arg: { name, max } };
  }
  const orderNode = expressionProperty(options, "order");
  const rangeNode = expressionProperty(options, "range");
  return {
    site: hint ?? `${env.programName}.${ref.table}`,
    table: ref.table,
    index: ref.index,
    prefix: lowerKey(prefix, env),
    order: stringLiteral(orderNode) === "desc" ? "Desc" : "Asc",
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
    provenance: provenance(prefix, env),
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

export function provenance(node: ts.Expression, env: Environment): Provenance {
  const substituted = ts.isIdentifier(node) ? env.substitutions.get(node.text) : undefined;
  if (substituted) return provenance(substituted, env);
  const value = unwrapExpression(node);
  if (ts.isStringLiteralLike(value) || ts.isNumericLiteral(value)
    || value.kind === ts.SyntaxKind.NullKeyword || value.kind === ts.SyntaxKind.TrueKeyword
    || value.kind === ts.SyntaxKind.FalseKeyword) return "Const";
  if (ts.isIdentifier(value)) return env.variables.get(value.text)?.provenance ?? "Const";
  if (ts.isPropertyAccessExpression(value)) {
    if (ts.isIdentifier(value.expression) && value.expression.text === "args") return "Arg";
    if (ts.isIdentifier(value.expression) && value.expression.text === "ctx" && value.name.text === "viewer") return "Viewer";
    return "Shape";
  }
  if (ts.isTemplateExpression(value)) return "Computed";
  if (ts.isCallExpression(value)) {
    const expanded = expandHelper(value, env);
    if (expanded) return provenance(expanded.expression, expanded.environment);
    return "Computed";
  }
  const children: Provenance[] = [];
  value.forEachChild((child) => {
    if (ts.isExpression(child)) children.push(provenance(child, env));
  });
  return combineProvenance(children);
}

export function combineProvenance(values: Provenance[]): Provenance {
  if (values.includes("Computed")) return "Computed";
  const meaningful = new Set(values.filter((value) => value !== "Const"));
  if (meaningful.size === 0) return "Const";
  if (meaningful.size === 1) return [...meaningful][0]!;
  return "Shape";
}

function expandHelper(
  node: ts.Expression,
  env: Environment,
): { expression: ts.Expression; environment: Environment; siteHint?: string } | undefined {
  const call = unwrapCall(node);
  if (!call || !ts.isIdentifier(call.expression)) return undefined;
  const helper = env.helpers.get(call.expression.text);
  if (!helper) return undefined;
  if (env.helperStack.includes(call.expression.text)) {
    refuse(env, "E_OPAQUE", call, "recursive helper is not inlineable");
  }
  const body = helperBodyExpression(helper);
  if (!body) refuse(env, "E_OPAQUE", helper, "helper must be a single pure return expression");
  const next = cloneEnvironment(env);
  next.helperStack.push(call.expression.text);
  helper.parameters.forEach((parameter, index) => {
    if (!ts.isIdentifier(parameter.name) || !call.arguments[index]) {
      refuse(env, "E_OPAQUE", parameter, "helper parameters must be positional identifiers");
    }
    const argument = call.arguments[index]!;
    if (!ts.isIdentifier(argument) || argument.text !== parameter.name.text) {
      next.substitutions.set(parameter.name.text, argument);
    }
  });
  return { expression: body, environment: next, siteHint: helperSite(call.expression.text, env.exports) };
}

function helperSite(name: string, exports: Set<string>): string {
  const prefix = [...exports]
    .filter((candidate) => name.startsWith(candidate) && name.length > candidate.length)
    .sort((a, b) => b.length - a.length)[0];
  if (prefix) return `${prefix}.${lowerFirst(name.slice(prefix.length))}`;
  const match = /^([a-z]+)([A-Z].*)$/.exec(name);
  return match ? `${match[1]}.${lowerFirst(match[2]!)}` : name;
}

function helperBodyExpression(helper: FunctionLike): ts.Expression | undefined {
  if (!helper.body) return undefined;
  if (!ts.isBlock(helper.body)) return helper.body;
  if (helper.body.statements.length !== 1 || !ts.isReturnStatement(helper.body.statements[0])) return undefined;
  return helper.body.statements[0].expression;
}

export function cloneEnvironment(env: Environment): Environment {
  return {
    ...env,
    variables: new Map([...env.variables].map(([name, info]) => [name, { ...info }])),
    substitutions: new Map(env.substitutions),
    helperStack: [...env.helperStack],
  };
}

export function derivedBound(node: ts.Expression, env: Environment): Partial<VariableInfo> {
  const known = staticBound(node, env);
  if (known !== undefined) return { max: known, boundSource: `${node.getText()} static bound` };
  return {};
}

export function staticBound(node: ts.Expression, env: Environment): number | undefined {
  const value = unwrapExpression(node);
  if (ts.isIdentifier(value)) return env.variables.get(value.text)?.max;
  if (ts.isPropertyAccessExpression(value) && ts.isIdentifier(value.expression)
    && value.expression.text === "args") return env.variables.get(value.name.text)?.max;
  if (ts.isArrayLiteralExpression(value)) {
    let total = 0;
    for (const element of value.elements) {
      if (ts.isSpreadElement(element)) {
        const bound = staticBound(element.expression, env);
        if (bound === undefined) return undefined;
        total += bound;
      } else total += 1;
    }
    return total;
  }
  if (ts.isNewExpression(value) && collectionConstructor(value)) {
    const initializer = value.arguments?.[0];
    return initializer ? staticBound(initializer, env) : 0;
  }
  const call = unwrapCall(node);
  if (call && callName(call).endsWith(".scan")) {
    const take = scanTake(call);
    if (typeof take === "number") return take;
  }
  if (call && ts.isIdentifier(call.expression) && call.expression.text === "mentionTokens") {
    return 85;
  }
  if (call && ts.isPropertyAccessExpression(call.expression)) {
    const method = call.expression.name.text;
    const owner = staticBound(call.expression.expression, env);
    if (method === "map" || method === "filter" || method === "sort") return owner;
    if (method === "slice") {
      const start = numericLiteral(call.arguments[0]) ?? 0;
      const end = numericLiteral(call.arguments[1]);
      return end === undefined ? owner : Math.max(0, end - start);
    }
    if (method === "flatMap" && owner !== undefined) {
      const callback = call.arguments[0];
      if (callback && isFunctionLike(callback) && !ts.isBlock(callback.body)) {
        const inner = staticBound(callback.body, env);
        if (inner !== undefined) return owner * inner;
      }
    }
  }
  return undefined;
}

function optionalLower(node: ts.Expression | undefined, env: Environment): Expr | null {
  return node ? lowerExpr(node, env) : null;
}

function scanTake(call: ts.CallExpression): number | "arg" | undefined {
  const options = call.arguments[2];
  if (!options || !ts.isObjectLiteralExpression(options)) return undefined;
  const take = expressionProperty(options, "take");
  if (!take) return undefined;
  return numericLiteral(take) ?? "arg";
}
