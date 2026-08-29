import ts from "typescript";
import type {
  DiagnosticFamily,
  Expr,
  FrontendDiagnostic,
  LoopDomain,
  LowerResult,
  Program,
  Provenance,
  Scan,
  Span,
  Stmt,
  Value,
} from "./ir";

type TableInfo = { name: string; private: boolean; maintainedFrom?: string };
type VariableInfo = { provenance: Provenance; max?: number; boundSource?: string };
type FunctionLike = ts.FunctionDeclaration | ts.ArrowFunction | ts.FunctionExpression;

type ModuleInfo = {
  sourceFile: ts.SourceFile;
  source: string;
  fileName: string;
  tables: Map<string, TableInfo>;
  helpers: Map<string, FunctionLike>;
  exports: Set<string>;
};

type Environment = ModuleInfo & {
  programName: string;
  kind: "Query" | "Mutation";
  args: Record<string, "Scalar" | { List: { max: number } }>;
  variables: Map<string, VariableInfo>;
  substitutions: Map<string, ts.Expression>;
  helperStack: string[];
};

class Refusal extends Error {
  constructor(readonly diagnostic: FrontendDiagnostic) {
    super(diagnostic.message);
  }
}

export function typecheckSource(
  source: string,
  fileName: string,
  libText: string,
): ts.Diagnostic[] {
  const sourceName = fileName.endsWith(".ts") ? fileName : `${fileName}.ts`;
  const files = new Map([
    [sourceName, source],
    ["bounded-lib.d.ts", libText],
  ]);
  const options: ts.CompilerOptions = {
    module: ts.ModuleKind.ESNext,
    noEmit: true,
    noLib: true,
    strict: true,
    target: ts.ScriptTarget.ES2022,
  };
  const host: ts.CompilerHost = {
    fileExists: (name) => files.has(name),
    getCanonicalFileName: (name) => name,
    getCurrentDirectory: () => "",
    getDefaultLibFileName: () => "bounded-lib.d.ts",
    getNewLine: () => "\n",
    getSourceFile: (name, languageVersion) => {
      const text = files.get(name);
      return text === undefined ? undefined : ts.createSourceFile(name, text, languageVersion, true);
    },
    readFile: (name) => files.get(name),
    useCaseSensitiveFileNames: () => true,
    writeFile: () => undefined,
  };
  const program = ts.createProgram([sourceName, "bounded-lib.d.ts"], options, host);
  return ts
    .getPreEmitDiagnostics(program)
    .filter((diagnostic) => diagnostic.file?.fileName !== "bounded-lib.d.ts");
}

export function formatTypeDiagnostic(diagnostic: ts.Diagnostic): string {
  return ts.flattenDiagnosticMessageText(diagnostic.messageText, "\n");
}

export function lowerSource(
  source: string,
  fileName = "input.ts",
  libText?: string,
): LowerResult {
  const sourceFile = ts.createSourceFile(fileName, source, ts.ScriptTarget.ES2022, true);
  const module = inspectModule(sourceFile, source, fileName);
  const policy = findPolicyRefusal(module);
  if (policy) return { ok: false, diagnostics: [policy] };

  if (libText !== undefined) {
    const diagnostics = typecheckSource(source, fileName, libText);
    if (diagnostics.length > 0) {
      const first = diagnostics[0]!;
      const node = first.file && first.start !== undefined
        ? findNarrowestNode(first.file, first.start)
        : sourceFile;
      return {
        ok: false,
        diagnostics: [diagnostic(module, "E_OPAQUE", node, formatTypeDiagnostic(first), source)],
      };
    }
  }

  try {
    const programs: Program[] = [];
    for (const statement of sourceFile.statements) {
      if (!ts.isVariableStatement(statement) || !hasExport(statement)) continue;
      for (const declaration of statement.declarationList.declarations) {
        if (!ts.isIdentifier(declaration.name) || !declaration.initializer) continue;
        const call = unwrapCall(declaration.initializer);
        if (!call || !ts.isIdentifier(call.expression)) continue;
        if (call.expression.text !== "query" && call.expression.text !== "mutation") continue;
        programs.push(lowerOperation(module, declaration.name.text, call.expression.text, call));
      }
    }
    return { ok: true, programs };
  } catch (error) {
    if (error instanceof Refusal) return { ok: false, diagnostics: [error.diagnostic] };
    throw error;
  }
}

function inspectModule(sourceFile: ts.SourceFile, source: string, fileName: string): ModuleInfo {
  const tables = new Map<string, TableInfo>();
  const helpers = new Map<string, FunctionLike>();
  const exports = new Set<string>();
  for (const statement of sourceFile.statements) {
    if (ts.isFunctionDeclaration(statement) && statement.name) {
      helpers.set(statement.name.text, statement);
      continue;
    }
    if (!ts.isVariableStatement(statement)) continue;
    for (const declaration of statement.declarationList.declarations) {
      if (!ts.isIdentifier(declaration.name) || !declaration.initializer) continue;
      const name = declaration.name.text;
      if (hasExport(statement)) exports.add(name);
      const call = unwrapCall(declaration.initializer);
      if (!call || !ts.isIdentifier(call.expression)) {
        if (ts.isArrowFunction(declaration.initializer) || ts.isFunctionExpression(declaration.initializer)) {
          helpers.set(name, declaration.initializer);
        }
        continue;
      }
      const callee = call.expression.text;
      if (callee === "table" || callee === "privateTable" || callee === "maintained") {
        const tableName = stringArgument(call.arguments[0]) ?? name;
        const maintainedFrom = callee === "maintained" && ts.isIdentifier(call.arguments[1])
          ? call.arguments[1].text
          : undefined;
        tables.set(name, { name: tableName, private: callee === "privateTable", maintainedFrom });
      } else if (ts.isArrowFunction(declaration.initializer) || ts.isFunctionExpression(declaration.initializer)) {
        helpers.set(name, declaration.initializer);
      }
    }
  }
  return { sourceFile, source, fileName, tables, helpers, exports };
}

function findPolicyRefusal(module: ModuleInfo): FrontendDiagnostic | undefined {
  let found: FrontendDiagnostic | undefined;
  const visit = (node: ts.Node, currentFunction?: string) => {
    if (found) return;
    if (ts.isFunctionDeclaration(node) && node.name) currentFunction = node.name.text;

    if (ts.isWhileStatement(node)) {
      found = diagnostic(
        module,
        "E_OPAQUE",
        node,
        "while loops have no static iteration bound",
        rewriteWhile(module.source, node),
      );
      return;
    }
    if (ts.isAwaitExpression(node) || hasAsyncModifier(node)) {
      found = diagnostic(module, "E_OPAQUE", node, "async/await is outside data programs", module.source);
      return;
    }
    if (ts.isCallExpression(node)) {
      const name = callName(node);
      if (name === "Date.now" || (name === "Date" && node.arguments.length === 0)) {
        found = diagnostic(
          module,
          "E_AMBIENT_TIME",
          node,
          "ambient time is not replay-stable",
          replaceNode(module.source, node, "ctx.now()"),
        );
        return;
      }
      if (["Math.random", "fetch", "setTimeout", "eval"].includes(name)) {
        found = diagnostic(module, "E_OPAQUE", node, `${name} is outside the deterministic subset`, module.source);
        return;
      }
      if (currentFunction && ts.isIdentifier(node.expression) && node.expression.text === currentFunction) {
        found = diagnostic(module, "E_OPAQUE", node, "recursive helpers must use recurse with depth and fanout", module.source);
        return;
      }
    }
    ts.forEachChild(node, (child) => visit(child, currentFunction));
  };
  visit(module.sourceFile);
  if (found) return found;

  const reductions: ts.CallExpression[] = [];
  const scans: ts.CallExpression[] = [];
  const forLoops: ts.ForOfStatement[] = [];
  const structuralSorts: ts.ElementAccessExpression[] = [];
  walk(module.sourceFile, (node) => {
    if (ts.isCallExpression(node) && callName(node).endsWith(".scan")) scans.push(node);
    if (ts.isCallExpression(node) && ["count", "reduce"].includes(memberName(node.expression) ?? "")) reductions.push(node);
    if (ts.isForOfStatement(node)) forLoops.push(node);
    if (ts.isElementAccessExpression(node) && isZero(node.argumentExpression) && containsCall(node.expression, ".sort")) {
      structuralSorts.push(node);
    }
  });

  for (const reduction of reductions) {
    const scan = firstDescendantCall(reduction.expression, ".scan");
    if (!scan) continue;
    if (!scanTake(scan)) {
      return diagnostic(
        module,
        "E_UNBOUND_COUNT",
        reduction,
        "an exact reduction over a growing population has no static bound",
        rewriteUnboundCount(module.source),
      );
    }
    if (scanIsPrivate(module, scan)) {
      return structuralDiagnostic(module, reduction, scan);
    }
  }

  for (const access of structuralSorts) {
    const scan = firstDescendantCall(access.expression, ".scan");
    if (scan && scanIsPrivate(module, scan)) return structuralDiagnostic(module, access, scan);
  }

  for (const loop of forLoops) {
    const scan = firstDescendantCall(loop.expression, ".scan");
    if (scan && scanIsPrivate(module, scan) && containsIncrement(loop.statement)) {
      return structuralLoopDiagnostic(module, loop, scan);
    }
    if (containsCall(loop.expression, ".split") && !boundedSplit(loop.expression)) {
      return diagnostic(
        module,
        "E_UNBOUND_LOOP",
        loop.expression,
        "split-derived loop cardinality is not declared",
        rewriteSplit(module.source),
      );
    }
  }

  for (const scan of scans) {
    if (!scanTake(scan)) {
      return diagnostic(
        module,
        "E_UNBOUND_SCAN",
        scan,
        "scan requires a literal take or an argument with a declared maximum",
        rewriteMapReturns(rewriteAllScans(module.sourceFile, module.source)),
      );
    }
  }
  const bound = boundRefusal(module);
  if (bound) return bound;
  return undefined;
}

function lowerOperation(
  module: ModuleInfo,
  name: string,
  kindName: "query" | "mutation",
  call: ts.CallExpression,
): Program {
  const argObject = call.arguments[0];
  const handler = call.arguments[1];
  if (!argObject || !ts.isObjectLiteralExpression(argObject) || !handler || !isFunctionLike(handler)) {
    refuse(module, "E_OPAQUE", call, "query/mutation requires an argument object and inline handler");
  }
  const args: Program["args"] = {};
  for (const property of argObject.properties) {
    if (!ts.isPropertyAssignment(property)) continue;
    const argName = propertyName(property.name);
    if (!argName) refuse(module, "E_OPAQUE", property, "computed argument names are not supported");
    const descriptor = unwrapCall(property.initializer);
    if (descriptor && ts.isIdentifier(descriptor.expression) && descriptor.expression.text === "list") {
      const options = descriptor.arguments[1];
      const max = options && ts.isObjectLiteralExpression(options) ? numberProperty(options, "max") : undefined;
      if (max === undefined) refuse(module, "E_UNBOUND_LOOP", property, `list argument ${argName} needs max`);
      args[argName] = { List: { max } };
    } else {
      args[argName] = "Scalar";
    }
  }
  const variables = new Map<string, VariableInfo>();
  for (const [argName, type] of Object.entries(args)) {
    variables.set(argName, {
      provenance: "Arg",
      max: typeof type === "string" ? undefined : type.List.max,
      boundSource: typeof type === "string" ? undefined : `arg ${argName} max`,
    });
  }
  const environment: Environment = {
    ...module,
    programName: name,
    kind: kindName === "query" ? "Query" : "Mutation",
    args,
    variables,
    substitutions: new Map(),
    helperStack: [],
  };
  const body = ts.isBlock(handler.body)
    ? lowerStatements(handler.body.statements, environment)
    : [{ Return: lowerExpr(handler.body, environment, `${name}.result`) } satisfies Stmt];
  return {
    name,
    kind: environment.kind,
    args,
    read_time_granularity_ms: null,
    body,
  };
}

function lowerStatements(nodes: ts.NodeArray<ts.Statement> | readonly ts.Statement[], env: Environment): Stmt[] {
  const result: Stmt[] = [];
  for (const statement of nodes) result.push(...lowerStatement(statement, env));
  return result;
}

function lowerStatement(statement: ts.Statement, env: Environment): Stmt[] {
  if (ts.isVariableStatement(statement)) {
    const out: Stmt[] = [];
    for (const declaration of statement.declarationList.declarations) {
      if (!ts.isIdentifier(declaration.name) || !declaration.initializer) {
        refuse(env, "E_OPAQUE", declaration, "destructuring declarations are not yet lowerable");
      }
      const name = declaration.name.text;
      const value = lowerExpr(declaration.initializer, env, `${env.programName}.${name}`);
      env.variables.set(name, {
        provenance: provenance(declaration.initializer, env),
        ...derivedBound(declaration.initializer, env),
      });
      const isConst = (statement.declarationList.flags & ts.NodeFlags.Const) !== 0;
      out.push(isConst ? { Const: { name, value } } : { Let: { name, value } });
    }
    return out;
  }
  if (ts.isExpressionStatement(statement)) return lowerExpressionStatement(statement.expression, env);
  if (ts.isReturnStatement(statement)) {
    if (!statement.expression) return [{ Return: literal(null) }];
    return [{ Return: lowerExpr(statement.expression, env, `${env.programName}.result`) }];
  }
  if (ts.isIfStatement(statement)) {
    return [{
      If: {
        condition: lowerExpr(statement.expression, env),
        then_body: lowerControlled(statement.thenStatement, cloneEnvironment(env)),
        else_body: statement.elseStatement
          ? lowerControlled(statement.elseStatement, cloneEnvironment(env))
          : [],
      },
    }];
  }
  if (ts.isForOfStatement(statement)) {
    if (!ts.isVariableDeclarationList(statement.initializer)
      || statement.initializer.declarations.length !== 1
      || !ts.isIdentifier(statement.initializer.declarations[0]!.name)) {
      refuse(env, "E_OPAQUE", statement.initializer, "for-of binding must be one identifier");
    }
    const binding = statement.initializer.declarations[0].name.text;
    const loopEnv = cloneEnvironment(env);
    const { domain, bindingInfo } = lowerDomain(statement.expression, loopEnv, binding);
    loopEnv.variables.set(binding, bindingInfo);
    return [{ For: { binding, domain, body: lowerControlled(statement.statement, loopEnv) } }];
  }
  if (statement.kind === ts.SyntaxKind.BreakStatement) return ["Break"];
  if (statement.kind === ts.SyntaxKind.ContinueStatement) return ["Continue"];
  if (ts.isBlock(statement)) return lowerStatements(statement.statements, env);
  if (ts.isEmptyStatement(statement)) return [];
  refuse(env, "E_OPAQUE", statement, `statement ${ts.SyntaxKind[statement.kind]} is outside the subset`);
}

function lowerControlled(statement: ts.Statement, env: Environment): Stmt[] {
  return ts.isBlock(statement) ? lowerStatements(statement.statements, env) : lowerStatement(statement, env);
}

function lowerExpressionStatement(expression: ts.Expression, env: Environment): Stmt[] {
  if (ts.isCallExpression(expression)) {
    if (ts.isPropertyAccessExpression(expression.expression)) {
      const owner = expression.expression.expression;
      const method = expression.expression.name.text;
      if (ts.isIdentifier(owner) && env.variables.has(owner.text) && method === "push") {
        const value = expression.arguments[0];
        if (!value) refuse(env, "E_OPAQUE", expression, "push requires one value");
        return [{ Push: { target: owner.text, value: lowerExpr(value, env, `${env.programName}.${owner.text}`) } }];
      }
      if (isDb(owner)) return lowerDbStatement(method, expression, env);
    }
  }
  if (ts.isPostfixUnaryExpression(expression) || ts.isPrefixUnaryExpression(expression)) {
    if ((expression.operator === ts.SyntaxKind.PlusPlusToken || expression.operator === ts.SyntaxKind.MinusMinusToken)
      && ts.isIdentifier(expression.operand)) {
      return [{ Assign: {
        name: expression.operand.text,
        value: {
          Binary: {
            op: expression.operator === ts.SyntaxKind.PlusPlusToken ? "Add" : "Sub",
            left: { Variable: expression.operand.text },
            right: literal(1),
          },
        },
      } }];
    }
  }
  if (ts.isBinaryExpression(expression)
    && expression.operatorToken.kind === ts.SyntaxKind.EqualsToken
    && ts.isIdentifier(expression.left)) {
    return [{ Assign: { name: expression.left.text, value: lowerExpr(expression.right, env) } }];
  }
  if (ts.isConditionalExpression(expression)) {
    return [{ If: {
      condition: lowerExpr(expression.condition, env),
      then_body: lowerExpressionStatement(expression.whenTrue, cloneEnvironment(env)),
      else_body: lowerExpressionStatement(expression.whenFalse, cloneEnvironment(env)),
    } }];
  }
  refuse(env, "E_OPAQUE", expression, "expression statement does not lower to a data operation");
}

function lowerDbStatement(method: string, call: ts.CallExpression, env: Environment): Stmt[] {
  if (method === "require" || method === "assert") {
    const condition = call.arguments[0];
    if (!condition) refuse(env, "E_OPAQUE", call, `${method} requires a condition`);
    return [{ Require: {
      condition: lowerExpr(condition, env),
      code: stringArgument(call.arguments[1]) ?? (method === "assert" ? "ASSERTION_FAILED" : "REQUIRE_FAILED"),
    } }];
  }
  const target = call.arguments[0];
  const table = target && tableReference(target, env).table;
  if (!table) refuse(env, "E_OPAQUE", call, `${method} requires a static table`);
  if (method === "insert") {
    const row = call.arguments[1];
    if (!row) refuse(env, "E_OPAQUE", call, "insert requires a row");
    return [{ Insert: { table, row: lowerExpr(row, env) } }];
  }
  if (method === "delete") {
    const key = call.arguments[1];
    if (!key) refuse(env, "E_OPAQUE", call, "delete requires a key");
    return [{ Delete: { table, key: lowerExpr(key, env) } }];
  }
  if (method === "update" || method === "upsert") {
    const key = call.arguments[1];
    const row = call.arguments[2];
    if (!key || !row) refuse(env, "E_OPAQUE", call, `${method} requires key and row/patch`);
    const lowered = lowerPatch(row, env);
    return method === "update"
      ? [{ Update: { table, key: lowerExpr(key, env), patch: lowered } }]
      : [{ Upsert: { table, key: lowerExpr(key, env), row: lowered } }];
  }
  refuse(env, "E_OPAQUE", call, `db.${method} is not part of the S1 IR`);
}

function lowerPatch(node: ts.Expression, env: Environment): Expr {
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

function lowerDomain(
  expression: ts.Expression,
  env: Environment,
  binding: string,
  hint?: string,
): { domain: LoopDomain; bindingInfo: VariableInfo } {
  const expanded = expandHelper(expression, env);
  if (expanded) return lowerDomain(expanded.expression, expanded.environment, binding, expanded.siteHint ?? hint);
  const call = unwrapCall(expression);
  if (call && callName(call).endsWith(".scan")) {
    return { domain: { Page: lowerScan(call, env, hint ?? `${env.programName}.${tableReference(call.arguments[0]!, env).table}`) }, bindingInfo: { provenance: "Shape" } };
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

function lowerExpr(node: ts.Expression, env: Environment, hint?: string): Expr {
  const substituted = ts.isIdentifier(node) ? env.substitutions.get(node.text) : undefined;
  if (substituted) return lowerExpr(substituted, env, hint);
  const unwrapped = unwrapExpression(node);
  if (unwrapped !== node) return lowerExpr(unwrapped, env, hint);

  if (node.kind === ts.SyntaxKind.NullKeyword) return literal(null);
  if (node.kind === ts.SyntaxKind.TrueKeyword) return literal(true);
  if (node.kind === ts.SyntaxKind.FalseKeyword) return literal(false);
  if (ts.isNumericLiteral(node)) return literal(Number(node.text));
  if (ts.isStringLiteralLike(node)) return literal(node.text);
  if (ts.isIdentifier(node)) return { Variable: node.text };
  if (ts.isArrayLiteralExpression(node)) return { Array: node.elements.map((value) => lowerExpr(value, env)) };
  if (ts.isObjectLiteralExpression(node)) {
    const object: Record<string, Expr> = {};
    for (const property of node.properties) {
      if (ts.isSpreadAssignment(property)) {
        if (ts.isIdentifier(property.expression) && property.expression.text === "args") {
          for (const arg of Object.keys(env.args)) object[arg] = { Variable: arg };
          continue;
        }
        // A spread in a patch callback repeats unchanged fields and is semantically redundant.
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
    return { Builtin: { builtin: "Concat", args: parts } };
  }
  if (ts.isCallExpression(node)) return lowerCall(node, env, hint);
  refuse(env, "E_OPAQUE", node, `expression ${ts.SyntaxKind[node.kind]} is outside the S1 IR`);
}

function lowerCall(call: ts.CallExpression, env: Environment, hint?: string): Expr {
  const expanded = expandHelper(call, env);
  if (expanded) return lowerExpr(expanded.expression, expanded.environment, expanded.siteHint ?? hint);
  const name = callName(call);
  if (name === "ctx.now" || name === "ctx.commitTime") return { Input: "Now" };
  if (name === "ctx.newId") return { Input: "NewId" };
  if (name.endsWith(".get") && isDbMember(call.expression)) return { Get: lowerRead(call, env, hint) };
  if (name.endsWith(".exists") && isDbMember(call.expression)) return { Exists: lowerRead(call, env, hint) };
  if (name.endsWith(".scan") && isDbMember(call.expression)) return { Scan: lowerScan(call, env, hint) };
  if (["concat", "max", "min", "divmod", "deterministicShare", "mentionTokens"].includes(name)) {
    const builtin = ({
      concat: "Concat",
      max: "Max",
      min: "Min",
      divmod: { Divmod: { remainder_sink: "lexicographic-id" } },
      deterministicShare: "DeterministicShare",
      mentionTokens: "MentionTokens",
    } as Record<string, string | Record<string, unknown>>)[name]!;
    return { Builtin: { builtin, args: call.arguments.map((arg) => lowerExpr(arg, env)) } };
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
    const max = name && arg && typeof arg !== "string" ? arg.List.max : undefined;
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

function tableReference(node: ts.Expression, env: Pick<Environment, "tables">): { table: string; index: string } {
  if (ts.isIdentifier(node)) {
    const info = env.tables.get(node.text);
    return { table: info?.name ?? node.text, index: info?.maintainedFrom ? "byGroup" : "byId" };
  }
  if (ts.isPropertyAccessExpression(node) && ts.isIdentifier(node.expression)) {
    const info = env.tables.get(node.expression.text);
    return { table: info?.name ?? node.expression.text, index: node.name.text };
  }
  throw new Error(`non-static table reference: ${node.getText()}`);
}

function lowerKey(node: ts.Expression, env: Environment): Expr[] {
  const value = unwrapExpression(node);
  return ts.isArrayLiteralExpression(value)
    ? value.elements.map((element) => lowerExpr(element, env))
    : [lowerExpr(value, env)];
}

function provenance(node: ts.Expression, env: Environment): Provenance {
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

function combineProvenance(values: Provenance[]): Provenance {
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

function cloneEnvironment(env: Environment): Environment {
  return {
    ...env,
    variables: new Map(env.variables),
    substitutions: new Map(env.substitutions),
    helperStack: [...env.helperStack],
  };
}

function derivedBound(node: ts.Expression, env: Environment): Partial<VariableInfo> {
  const call = unwrapCall(node);
  if (call && callName(call).endsWith(".scan")) {
    const take = scanTake(call);
    if (typeof take === "number") return { max: take, boundSource: `${call.getText()} take` };
  }
  if (call && ts.isIdentifier(call.expression) && call.expression.text === "mentionTokens") {
    return { max: 85, boundSource: "messages.body max 256 / min whitespace mention 3" };
  }
  if (ts.isArrayLiteralExpression(node)) return { max: node.elements.length, boundSource: `literal array length ${node.elements.length}` };
  return {};
}

function diagnostic(
  module: Pick<ModuleInfo, "sourceFile" | "fileName">,
  family: DiagnosticFamily,
  node: ts.Node,
  message: string,
  rewrite: string,
): FrontendDiagnostic {
  return { family, span: span(module, node), message, rewrite };
}

function span(module: Pick<ModuleInfo, "sourceFile" | "fileName">, node: ts.Node): Span {
  const start = node.getStart(module.sourceFile);
  const position = module.sourceFile.getLineAndCharacterOfPosition(start);
  return {
    file: module.fileName,
    start,
    end: node.getEnd(),
    line: position.line + 1,
    column: position.character + 1,
  };
}

function refuse(
  module: Pick<ModuleInfo, "sourceFile" | "source" | "fileName">,
  family: DiagnosticFamily,
  node: ts.Node,
  message: string,
  rewrite = module.source,
): never {
  throw new Refusal(diagnostic(module, family, node, message, rewrite));
}

function structuralDiagnostic(module: ModuleInfo, node: ts.Node, scan: ts.CallExpression): FrontendDiagnostic {
  const replacement = maintainedReplacement(module, scan);
  return diagnostic(
    module,
    "E_STRUCTURAL_COUNT",
    node,
    "reduction would expose a fact about rows hidden by a non-tautologous rule",
    replacement ? replaceNode(module.source, node, replacement) : module.source,
  );
}

function structuralLoopDiagnostic(module: ModuleInfo, loop: ts.ForOfStatement, scan: ts.CallExpression): FrontendDiagnostic {
  const replacement = maintainedReplacement(module, scan) ?? "null";
  let start = loop.getStart(module.sourceFile);
  let end = loop.getEnd();
  const previous = previousStatement(module.sourceFile, loop);
  const next = nextStatement(module.sourceFile, loop);
  if (previous && ts.isVariableStatement(previous) && next && ts.isReturnStatement(next)) {
    start = previous.getStart(module.sourceFile);
    end = next.getEnd();
  }
  return diagnostic(
    module,
    "E_STRUCTURAL_COUNT",
    loop,
    "loop tally would expose a structural count through caller visibility",
    `${module.source.slice(0, start)}return ${replacement};${module.source.slice(end)}`,
  );
}

function maintainedReplacement(module: ModuleInfo, scan: ts.CallExpression): string | undefined {
  const target = scan.arguments[0];
  const prefix = scan.arguments[1];
  if (!target || !prefix) return undefined;
  const table = tableReference(target, { tables: module.tables }).table;
  const maintained = [...module.tables.entries()].find(([, info]) => {
    const source = info.maintainedFrom ? module.tables.get(info.maintainedFrom) : undefined;
    return source?.name === table;
  });
  if (!maintained) return undefined;
  const key = ts.isArrayLiteralExpression(prefix) && prefix.elements.length === 1
    ? prefix.elements[0]!.getText(module.sourceFile)
    : prefix.getText(module.sourceFile);
  return `db.get(${maintained[0]}, ${key})`;
}

function rewriteAllScans(sourceFile: ts.SourceFile, source: string): string {
  const edits: Array<{ start: number; end: number; text: string }> = [];
  walk(sourceFile, (node) => {
    if (!ts.isCallExpression(node) || !callName(node).endsWith(".scan") || scanTake(node)) return;
    if (node.arguments.length < 3) {
      edits.push({ start: node.arguments.end, end: node.arguments.end, text: ", { take: 50 }" });
      return;
    }
    const options = node.arguments[2];
    if (options && ts.isObjectLiteralExpression(options)) {
      const at = options.properties.pos;
      edits.push({ start: at, end: at, text: "take: 50, " });
    }
  });
  return applyEdits(source, edits);
}

function rewriteUnboundCount(source: string): string {
  const sourceFile = ts.createSourceFile("rewrite.ts", source, ts.ScriptTarget.ES2022, true);
  let rewritten = rewriteAllScans(sourceFile, source);
  rewritten = rewritten.replace(/\.count\s*\(\s*\)/g, ".countCapped()");
  return rewritten;
}

function rewriteMapReturns(source: string): string {
  const sourceFile = ts.createSourceFile("rewrite-map.ts", source, ts.ScriptTarget.ES2022, true);
  const edits: Array<{ start: number; end: number; text: string }> = [];
  walk(sourceFile, (node) => {
    if (!ts.isReturnStatement(node) || !node.expression || !ts.isCallExpression(node.expression)
      || !ts.isPropertyAccessExpression(node.expression.expression)
      || node.expression.expression.name.text !== "map") return;
    const callback = node.expression.arguments[0];
    if (!callback || !isFunctionLike(callback) || callback.parameters.length !== 1
      || !ts.isIdentifier(callback.parameters[0]!.name) || ts.isBlock(callback.body)) return;
    const binding = callback.parameters[0].name.text;
    const base = node.expression.expression.expression.getText(sourceFile);
    const value = callback.body.getText(sourceFile);
    edits.push({
      start: node.getStart(sourceFile),
      end: node.getEnd(),
      text: `let mapped = []; for (const ${binding} of ${base}) mapped.push(${value}); return mapped;`,
    });
  });
  return applyEdits(source, edits);
}

function rewriteSplit(source: string): string {
  return source.replace(/([A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)*)\.split\(\s*(['"]) \2\s*\)/g, "mentionTokens($1)");
}

function rewriteWhile(source: string, node: ts.WhileStatement): string {
  if (!ts.isBinaryExpression(node.expression)
    || node.expression.operatorToken.kind !== ts.SyntaxKind.LessThanToken
    || !ts.isIdentifier(node.expression.left)
    || numericLiteral(node.expression.right) === undefined) return source;
  const variable = node.expression.left.text;
  const end = numericLiteral(node.expression.right)!;
  let body = node.statement.getText();
  body = body.replace(new RegExp(`\\b${variable}\\+\\+\\s*;?`), "");
  return replaceNode(source, node, `for (const _ of range(0, ${end})) ${body}`);
}

function boundRefusal(module: ModuleInfo): FrontendDiagnostic | undefined {
  let result: FrontendDiagnostic | undefined;
  const visitLoop = (loop: ts.ForOfStatement, factors: Array<{ value: number; node: ts.Expression }>) => {
    const scan = firstDescendantCall(loop.expression, ".scan");
    const takeNode = scan && scan.arguments[2] && ts.isObjectLiteralExpression(scan.arguments[2])
      ? expressionProperty(scan.arguments[2], "take")
      : undefined;
    const take = numericLiteral(takeNode);
    const next = take !== undefined && takeNode ? [...factors, { value: take, node: takeNode }] : factors;
    const product = next.reduce((total, factor) => total * factor.value, 1);
    if (product > 10_240 && takeNode) {
      const largest = [...next].sort((a, b) => b.value - a.value)[0]!;
      const other = product / largest.value;
      const replacement = Math.max(1, Math.floor(10_240 / other));
      result = diagnostic(
        module,
        "E_BOUND",
        loop,
        `nested population product ${next.map((factor) => factor.value).join(" × ")} = ${product} exceeds 10240`,
        replaceNode(module.source, largest.node, String(replacement)),
      );
      return;
    }
    const body = ts.isBlock(loop.statement) ? loop.statement.statements : [loop.statement];
    for (const statement of body) {
      if (result) return;
      walk(statement, (node) => {
        if (!result && ts.isForOfStatement(node) && node !== loop) visitLoop(node, next);
      });
    }
  };
  walk(module.sourceFile, (node) => {
    if (!result && ts.isForOfStatement(node)
      && !findAncestor(node, ts.isForOfStatement)) visitLoop(node, []);
  });
  return result;
}

function findAncestor<T extends ts.Node>(node: ts.Node, predicate: (node: ts.Node) => node is T): T | undefined {
  let parent = node.parent;
  while (parent) {
    if (predicate(parent)) return parent;
    parent = parent.parent;
  }
  return undefined;
}

function replaceNode(source: string, node: ts.Node, replacement: string): string {
  return source.slice(0, node.getStart()) + replacement + source.slice(node.getEnd());
}

function applyEdits(source: string, edits: Array<{ start: number; end: number; text: string }>): string {
  return edits
    .sort((a, b) => b.start - a.start)
    .reduce((text, edit) => text.slice(0, edit.start) + edit.text + text.slice(edit.end), source);
}

function scanIsPrivate(module: ModuleInfo, scan: ts.CallExpression): boolean {
  const target = scan.arguments[0];
  if (!target) return false;
  const ref = tableReference(target, { tables: module.tables });
  return [...module.tables.values()].some((info) => info.name === ref.table && info.private);
}

function scanTake(call: ts.CallExpression): number | "arg" | undefined {
  const options = call.arguments[2];
  if (!options || !ts.isObjectLiteralExpression(options)) return undefined;
  const take = expressionProperty(options, "take");
  if (!take) return undefined;
  return numericLiteral(take) ?? "arg";
}

function boundedSplit(expression: ts.Expression): boolean {
  const text = expression.getText();
  return /\.split\([^)]*\)\.slice\(\s*0\s*,\s*\d+\s*\)/.test(text) || text.includes("mentionTokens(");
}

function containsIncrement(node: ts.Node): boolean {
  let found = false;
  walk(node, (child) => {
    if ((ts.isPostfixUnaryExpression(child) || ts.isPrefixUnaryExpression(child))
      && (child.operator === ts.SyntaxKind.PlusPlusToken || child.operator === ts.SyntaxKind.MinusMinusToken)) found = true;
  });
  return found;
}

function containsCall(node: ts.Node, suffix: string): boolean {
  let found = false;
  walk(node, (child) => {
    if (ts.isCallExpression(child) && callName(child).endsWith(suffix)) found = true;
  });
  return found;
}

function firstDescendantCall(node: ts.Node, suffix: string): ts.CallExpression | undefined {
  let found: ts.CallExpression | undefined;
  walk(node, (child) => {
    if (!found && ts.isCallExpression(child) && callName(child).endsWith(suffix)) found = child;
  });
  return found;
}

function findNarrowestNode(sourceFile: ts.SourceFile, position: number): ts.Node {
  let best: ts.Node = sourceFile;
  const visit = (node: ts.Node) => {
    if (node.getFullStart() <= position && position < node.getEnd()) {
      best = node;
      ts.forEachChild(node, visit);
    }
  };
  visit(sourceFile);
  return best;
}

function previousStatement(sourceFile: ts.SourceFile, node: ts.Statement): ts.Statement | undefined {
  const statements = statementSiblings(sourceFile, node);
  const index = statements?.indexOf(node) ?? -1;
  return index > 0 ? statements![index - 1] : undefined;
}

function nextStatement(sourceFile: ts.SourceFile, node: ts.Statement): ts.Statement | undefined {
  const statements = statementSiblings(sourceFile, node);
  const index = statements?.indexOf(node) ?? -1;
  return index >= 0 ? statements![index + 1] : undefined;
}

function statementSiblings(sourceFile: ts.SourceFile, node: ts.Statement): readonly ts.Statement[] | undefined {
  if (node.parent === sourceFile) return sourceFile.statements;
  if (ts.isBlock(node.parent)) return node.parent.statements;
  return undefined;
}

function walk(node: ts.Node, visit: (node: ts.Node) => void): void {
  visit(node);
  ts.forEachChild(node, (child) => walk(child, visit));
}

function hasExport(node: ts.Node): boolean {
  return ts.canHaveModifiers(node)
    && !!ts.getModifiers(node)?.some((modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword);
}

function hasAsyncModifier(node: ts.Node): boolean {
  return !!ts.canHaveModifiers(node) && !!ts.getModifiers(node)?.some((modifier) => modifier.kind === ts.SyntaxKind.AsyncKeyword);
}

function isFunctionLike(node: ts.Node): node is ts.ArrowFunction | ts.FunctionExpression {
  return ts.isArrowFunction(node) || ts.isFunctionExpression(node);
}

function unwrapCall(node: ts.Expression): ts.CallExpression | undefined {
  const value = unwrapExpression(node);
  return ts.isCallExpression(value) ? value : undefined;
}

function unwrapExpression(node: ts.Expression): ts.Expression {
  let value = node;
  while (ts.isParenthesizedExpression(value) || ts.isAsExpression(value) || ts.isNonNullExpression(value)) value = value.expression;
  return value;
}

function callName(call: ts.CallExpression): string {
  return call.expression.getText();
}

function memberName(node: ts.LeftHandSideExpression): string | undefined {
  return ts.isPropertyAccessExpression(node) ? node.name.text : undefined;
}

function isDb(node: ts.Expression): boolean {
  return ts.isIdentifier(node) && node.text === "db";
}

function isDbMember(node: ts.LeftHandSideExpression): boolean {
  return ts.isPropertyAccessExpression(node) && isDb(node.expression);
}

function propertyName(name: ts.PropertyName): string | undefined {
  return ts.isIdentifier(name) || ts.isStringLiteralLike(name) || ts.isNumericLiteral(name) ? name.text : undefined;
}

function expressionProperty(object: ts.ObjectLiteralExpression, name: string): ts.Expression | undefined {
  const property = object.properties.find((item): item is ts.PropertyAssignment =>
    ts.isPropertyAssignment(item) && propertyName(item.name) === name);
  return property?.initializer;
}

function numberProperty(object: ts.ObjectLiteralExpression, name: string): number | undefined {
  return numericLiteral(expressionProperty(object, name));
}

function numericLiteral(node: ts.Expression | undefined): number | undefined {
  return node && ts.isNumericLiteral(unwrapExpression(node)) ? Number((unwrapExpression(node) as ts.NumericLiteral).text) : undefined;
}

function stringLiteral(node: ts.Expression | undefined): string | undefined {
  const value = node && unwrapExpression(node);
  return value && ts.isStringLiteralLike(value) ? value.text : undefined;
}

function stringArgument(node: ts.Expression | undefined): string | undefined {
  return stringLiteral(node);
}

function optionalLower(node: ts.Expression | undefined, env: Environment): Expr | null {
  return node ? lowerExpr(node, env) : null;
}

function isZero(node: ts.Expression | undefined): boolean {
  return numericLiteral(node) === 0;
}

function literal(value: null | boolean | number | string): Expr {
  let encoded: Value;
  if (value === null) encoded = "Null";
  else if (typeof value === "boolean") encoded = { Bool: value };
  else if (typeof value === "number") encoded = { Int: value };
  else encoded = { String: value };
  return { Literal: encoded };
}

function binaryOperator(kind: ts.SyntaxKind): string | undefined {
  return new Map<ts.SyntaxKind, string>([
    [ts.SyntaxKind.EqualsEqualsEqualsToken, "Eq"],
    [ts.SyntaxKind.EqualsEqualsToken, "Eq"],
    [ts.SyntaxKind.ExclamationEqualsEqualsToken, "Ne"],
    [ts.SyntaxKind.ExclamationEqualsToken, "Ne"],
    [ts.SyntaxKind.LessThanToken, "Lt"],
    [ts.SyntaxKind.LessThanEqualsToken, "Lte"],
    [ts.SyntaxKind.GreaterThanToken, "Gt"],
    [ts.SyntaxKind.GreaterThanEqualsToken, "Gte"],
    [ts.SyntaxKind.PlusToken, "Add"],
    [ts.SyntaxKind.MinusToken, "Sub"],
    [ts.SyntaxKind.AsteriskToken, "Mul"],
    [ts.SyntaxKind.AmpersandAmpersandToken, "And"],
    [ts.SyntaxKind.BarBarToken, "Or"],
  ]).get(kind);
}

function singular(table: string): string {
  return table.endsWith("ies") ? `${table.slice(0, -3)}y` : table.endsWith("s") ? table.slice(0, -1) : table;
}

function lowerFirst(value: string): string {
  return value ? value[0]!.toLowerCase() + value.slice(1) : value;
}

function identifierFromArgsOrLocal(node: ts.Expression): string | undefined {
  const value = unwrapExpression(node);
  if (ts.isIdentifier(value)) return value.text;
  if (ts.isPropertyAccessExpression(value) && ts.isIdentifier(value.expression) && value.expression.text === "args") return value.name.text;
  return undefined;
}
