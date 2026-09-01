import ts from "typescript";
import type { TableInfo } from "./authored-types";
import { argumentSpreadRewrite, expandArgumentObject } from "./args";
import { boundedDiagnostics, diagnostic, refuse, Refusal } from "./diagnostics";
import {
  allocateReadSite, cloneEnvironment, containsRead, enterLexicalScope,
  loopDomainMaximum, lowerCoalesce, lowerArrayMethod, lowerCollectionDomain,
  lowerDomain, lowerExpr, lowerKey, lowerPatch, lowerSortExpression, reserveWriteSite, tableReference,
} from "./lower/expr";
import { knownObjectFields, nullableReadSpread, nullableSpreadRefusal, rowCollectionFields } from "./lower/object-shape";
import { derivedBound, staticBound } from "./lower/binding-bound";
import { collectionElementBinding, collectionOriginsBinding, combinedProvenanceBinding, isRowCollectionExpression, isRowExpression, provenanceBinding, readProvenance } from "./lower/provenance";
import { appendCollectionFacts, collectionFactsFor, collectionMutationIncrement, maintainCollectionFacts,
  mergeAssignedCollectionFacts } from "./lower/collection-facts";
import { forkBranchEnvironment, mergeBranchEnvironments } from "./lower/branch-bindings";
import { lowerLoopBodyWithMutationPlan } from "./lower/loop-mutations";
import { findPolicyRefusals, mechanicalBoundRewrite } from "./policy";
import { analyzeOperationTypes, type TypePlan } from "./type-analysis";
import { formatTypeDiagnostic, typecheckSource } from "./typecheck";
import { typeDiagnosticSite } from "./type-diagnostic-site";
import { invalidNativeDescriptorRefusal, lowerArgDescriptor, lowerLegacyArgDescriptor } from "./lower/schema";
import { duplicateHandlerBinding, duplicateHandlerBindingRewrite,
  nestedHandlerBinding, nestedHandlerDestructuringRewrite } from "./handler-bindings";
import { inspectModule, type ModuleInfo } from "./lower/module";
import type {
  CollectionEscapeSite, Environment, FunctionLike, LoweredValue, LowerSourceOptions, ProvenanceOrigin, Substitution, VariableInfo,
} from "./lower/environment";
import { assignedBindings, collectionSharingSites, isLocallyCreatedCollection,
  isOperationCompositeBinding, moduleBasename, operationCompositeBindings, recordAssignmentOrigin,
  requireCollectionMutation, withDirectRewrite } from "./lower/operation-context";
import { boundOperationDiagnostics, localConstructorShadow } from "./operation-diagnostics";
import {
  binaryOperator,
  collectionConstructor,
  findNarrowestNode,
  hasExport,
  isDb,
  isDbInsertCall,
  isNullableDbGet,
  isDbWriteCall,
  isFunctionLike,
  literal,
  memberName,
  nonNullIdentifier,
  propertyName,
  replaceNode,
  singular,
  snapbackCallName,
  staticMemberPath,
  stringArgument,
  syntheticIdentifier,
  temporary,
  unwrapCall,
  unwrapExpression,
} from "./syntax";
import type { Expr, FrontendDiagnostic, LowerResult, Program, Stmt } from "./ir";
export type { TableInfo } from "./authored-types";
export type {
  CollectionEscapeSite, CollectionMutationCounts, Environment, FunctionLike, LoweredValue, LowerSourceOptions, ProvenanceOrigin, Substitution, VariableInfo,
} from "./lower/environment";
export { typecheckSource } from "./typecheck";
export { mechanicalBoundRewrite } from "./policy";
export async function lowerProject(root: string) {
  return (await import("./project")).lowerProject(root);
}
function captureRefusal(diagnostics: FrontendDiagnostic[], error: unknown): void {
  if (error instanceof Refusal) diagnostics.push(error.diagnostic);
  else throw error;
}
export function lowerSource(
  source: string,
  fileName = "input.ts",
  libText?: string,
  options: LowerSourceOptions = {},
): LowerResult {
  const sourceFile = ts.createSourceFile(fileName, source, ts.ScriptTarget.ES2022, true);
  const module = inspectModule(sourceFile, source, fileName, options);
  const diagnostics = findPolicyRefusals(module, Number.MAX_SAFE_INTEGER);
  const operationSpans: Array<{ name: string; call: ts.CallExpression }> = [];

  if (libText !== undefined) {
    const typed = typecheckSource(source, fileName, libText);
    for (const item of typed) {
      const node = item.file && item.start !== undefined
        ? findNarrowestNode(item.file, item.start)
        : sourceFile;
      const siteKind = typeDiagnosticSite(node, fileName);
      const schemaLabelRewrite = source.replace(/\bschema\s+\([^\n:]+\):/g, "schema:");
      diagnostics.push(diagnostic(module, siteKind.code, node, formatTypeDiagnostic(item), schemaLabelRewrite));
    }
  }
  let recognizableExports = 0;
  const programs: Program[] = [];
  for (const statement of sourceFile.statements) {
    if (!ts.isVariableStatement(statement) || !hasExport(statement)) continue;
    for (const declaration of statement.declarationList.declarations) {
      if (!declaration.initializer) continue;
      const call = unwrapCall(declaration.initializer);
      const kind = call && snapbackCallName(call, sourceFile);
      if (kind === "effect") {
        recognizableExports += 1;
        continue;
      }
      if (!call || (kind !== "query" && kind !== "mutation")) continue;
      recognizableExports += 1;
      const name = options.operationPrefix
        ? `${options.operationPrefix}.${ts.isIdentifier(declaration.name) ? declaration.name.text : "operation"}`
        : ts.isIdentifier(declaration.name) ? declaration.name.text : "operation";
      operationSpans.push({ name, call });
      const handler = call.arguments[1];
      const duplicateBinding = handler && isFunctionLike(handler) ? duplicateHandlerBinding(handler) : undefined;
      if (duplicateBinding && handler && isFunctionLike(handler)) {
        diagnostics.push(diagnostic(
          module,
          "E_OPAQUE",
          duplicateBinding.elements[1]!,
          `handler property ${duplicateBinding.property} is destructured more than once; bind it once and alias locally`,
          duplicateHandlerBindingRewrite(module, handler, duplicateBinding),
        ));
        continue;
      }
      const nestedBinding = handler && isFunctionLike(handler) ? nestedHandlerBinding(handler) : undefined;
      if (nestedBinding && handler && isFunctionLike(handler)) {
        diagnostics.push(diagnostic(
          module,
          "E_OPAQUE",
          nestedBinding,
          "nested handler destructuring is not lowerable; bind each operation composite to an identifier and access its fields explicitly",
          nestedHandlerDestructuringRewrite(module, handler),
        ));
        continue;
      }
      const plan = analyzeOperationTypes(module, call);
      diagnostics.push(...plan.diagnostics);
      if (plan.analysisLimitReached) continue;
      if (!ts.isIdentifier(declaration.name)) continue;
      try {
        programs.push(lowerOperation(module, name, declaration.name.text, kind, call, plan, diagnostics));
      } catch (error) {
        captureRefusal(diagnostics, error);
      }
    }
  }
  if (recognizableExports === 0) {
    const shadow = localConstructorShadow(sourceFile);
    diagnostics.push(diagnostic(
      module,
      "E_OP_NONE",
      shadow?.node ?? sourceFile,
      shadow
        ? `module exports no query/mutation/effect; local declaration ${shadow.name} shadows the Snapback constructor`
        : "module exports no query/mutation/effect",
      "export const operation = query({}, ({ args }) => args);",
    ));
  }
  const bounded = boundOperationDiagnostics(diagnostics, operationSpans, module);
  return bounded.length > 0 ? { ok: false, diagnostics: boundedDiagnostics(bounded, 50, "refusals in this module") } : { ok: true, programs };
}
function lowerOperation(
  module: ModuleInfo,
  name: string,
  exportName: string,
  kindName: "query" | "mutation",
  call: ts.CallExpression,
  typePlan?: TypePlan,
  diagnostics: FrontendDiagnostic[] = [],
): Program {
  const argObject = call.arguments[0];
  const handler = call.arguments[1];
  if (!argObject || !ts.isObjectLiteralExpression(argObject) || !handler || !isFunctionLike(handler)) {
    refuse(module, "E_OPAQUE", call, "query/mutation requires an argument object and inline handler");
  }
  const offending = nestedHandlerBinding(handler);
  if (offending) {
    refuse(
      module,
      "E_OPAQUE",
      offending,
      "nested handler destructuring is not lowerable; bind each operation composite to an identifier and access its fields explicitly",
      nestedHandlerDestructuringRewrite(module, handler),
    );
  }
  const args: Program["args"] = {};
  const expandedArgs = expandArgumentObject(argObject);
  if (expandedArgs.invalidSpread) {
    refuse(module, "E_ARGS_SPREAD", expandedArgs.invalidSpread, "argument object spread is not a module-level constant object; spell out every argument field",
      argumentSpreadRewrite(module.source, expandedArgs.invalidSpread));
  }
  if (expandedArgs.invalidProperty) refuse(module, "E_ARGS_TYPE", expandedArgs.invalidProperty, "argument members must use name: descriptor syntax");
  for (const property of expandedArgs.entries) {
    const argName = property.name;
    const loweredDescriptor = lowerArgDescriptor(property.value, module.tables);
    const invalid = loweredDescriptor === undefined ? invalidNativeDescriptorRefusal(property.value) : undefined;
    if (invalid) refuse(module, "E_ARGS_DESCRIPTOR", invalid.node, `invalid argument descriptor ${argName}; ${invalid.message}`, invalid.rewrite);
    const lowered = (loweredDescriptor ?? lowerLegacyArgDescriptor(property.value)) as Program["args"][string] | undefined;
    if (!lowered) refuse(module, "E_ARGS_TYPE", property.node, `invalid argument descriptor ${argName}`);
    args[argName] = lowered;
  }
  const variables = new Map<string, VariableInfo>();
  for (const [argName, type] of Object.entries(args)) {
    const info: VariableInfo = {
      provenance: "Arg",
      operationArgument: argName,
    };
    if (typeof type !== "string" && "List" in type) {
      info.collectionIdentity = {};
      maintainCollectionFacts(info, {
        max: type.List.max,
        boundSource: `arg ${argName} max`,
        elementOrigins: [{ binding: { provenance: "Arg", operationArgument: argName }, candidate: argName }],
      });
    }
    variables.set(argName, info);
  }
  const handlerBindings = operationCompositeBindings(handler);
  const collectionSharing = collectionSharingSites(handler);
  if (handlerBindings.args) {
    variables.set(handlerBindings.args, {
      provenance: Object.keys(args).length === 0 ? "Const" : "Arg",
      operationComposite: "args",
      objectFields: Object.keys(args),
    });
  }
  if (handlerBindings.ctx) {
    variables.set(handlerBindings.ctx, {
      provenance: "Viewer",
      operationComposite: "ctx",
      objectFields: ["viewer"],
    });
  }
  if (handlerBindings.db) {
    variables.set(handlerBindings.db, { provenance: "Const", operationComposite: "db" });
  }
  const environment: Environment = {
    ...module,
    programName: name,
    siteBase: `${moduleBasename(module.fileName)}.${exportName}`,
    kind: kindName === "query" ? "Query" : "Mutation",
    args,
    variables,
    substitutions: new Map(),
    helperStack: [],
    mutableBindings: assignedBindings(handler),
    deferredCollectionMutations: new Set(),
    collectionAliasSites: collectionSharing.aliases,
    collectionEscapeSites: collectionSharing.escapes,
    accessOrdinal: { value: 0 },
    temp: { value: 0 },
    literalValues: typePlan?.literalValues ?? new Map(),
    literalContext: "operation",
    diagnostics,
    recursion: { depth: 0, active: new Map() },
  };
  let body: Stmt[];
  if (ts.isBlock(handler.body)) {
    body = lowerStatements(handler.body.statements, environment);
  } else if (isDbWriteCall(handler.body, (binding) => isOperationCompositeBinding(binding, "db", environment))) {
    body = lowerExpressionStatement(handler.body, environment);
  } else {
    const lowered = lowerValue(handler.body, environment, `${name}.result`);
    body = [...lowered.statements, { Return: lowered.expression }];
  }
  return {
    name,
    kind: environment.kind,
    args,
    read_time_granularity_ms: environment.kind === "Query" && JSON.stringify(body).includes('"Input":"ReadTime"') ? 1 : null,
    body,
  };
}

function lowerStatements(nodes: ts.NodeArray<ts.Statement> | readonly ts.Statement[], env: Environment): Stmt[] {
  const result: Stmt[] = [];
  for (const statement of nodes) {
    try {
      result.push(...lowerStatement(statement, env));
    } catch (error) {
      captureRefusal(env.diagnostics, error);
    }
  }
  return result;
}
function lowerStatement(statement: ts.Statement, env: Environment): Stmt[] {
  if (ts.isVariableStatement(statement)) {
    const out: Stmt[] = [];
    for (const declaration of statement.declarationList.declarations) {
      try {
        if (!declaration.initializer) {
          refuse(env, "E_OPAQUE", declaration, "destructuring declarations are not yet lowerable");
        }
        if (ts.isArrayBindingPattern(declaration.name)) {
          const call = unwrapCall(declaration.initializer);
          if (!call || !ts.isIdentifier(call.expression) || call.expression.text !== "orderedPair"
            || declaration.name.elements.length !== 2 || call.arguments.length !== 2) {
            refuse(env, "E_OPAQUE", declaration, "array destructuring is admitted only for orderedPair");
          }
          const defaulted = declaration.name.elements.find((element) => ts.isBindingElement(element) && element.initializer);
          if (defaulted) {
            refuse(
              env,
              "E_OPAQUE",
              defaulted,
              "orderedPair destructuring defaults have authored runtime semantics; normalize each input before orderedPair",
            );
          }
          const identifiers = declaration.name.elements.map((element) => ts.isBindingElement(element) && ts.isIdentifier(element.name)
            ? element.name
            : undefined);
          if (!identifiers[0] || !identifiers[1]) refuse(env, "E_OPAQUE", declaration.name, "orderedPair bindings must be identifiers");
          const args = call.arguments.map((argument) => lowerExpr(argument, env));
          out.push({ Let: { name: identifiers[0].text, value: { Builtin: { builtin: "Min", args } } } });
          out.push({ Let: { name: identifiers[1].text, value: { Builtin: { builtin: "Max", args } } } });
          const origin = withDirectRewrite(combinedProvenanceBinding(call.arguments, env), declaration.initializer, env);
          for (const identifier of identifiers as [ts.Identifier, ts.Identifier]) {
            env.variables.set(identifier.text, { ...origin });
          }
          continue;
        }
        if (!ts.isIdentifier(declaration.name)) refuse(env, "E_OPAQUE", declaration.name, "binding pattern is unsupported");
        const name = declaration.name.text;
        const lowered = lowerValue(declaration.initializer, env, `${env.programName}.${name}`);
        const collection = collectionConstructor(declaration.initializer);
        const isConst = (statement.declarationList.flags & ts.NodeFlags.Const) !== 0;
        const stableBinding = !env.mutableBindings.has(declaration.name);
        const loweredBinding = "Variable" in lowered.expression ? env.variables.get(lowered.expression.Variable) : undefined;
        const rowCollection = loweredBinding?.rowCollection === true || isRowCollectionExpression(declaration.initializer, env);
        const objectFields = stableBinding
          ? knownObjectFields(declaration.initializer, env) ?? (rowCollection ? rowCollectionFields(declaration.initializer, env) : undefined)
          : undefined;
        const classified = provenanceBinding(declaration.initializer, env);
        const origin = withDirectRewrite(classified, declaration.initializer, env);
        const bindTime = cloneEnvironment(env);
        const bound = derivedBound(declaration.initializer, env);
        const facts = collectionFactsFor(declaration.initializer, env, bound.max, bound.boundSource);
        if (facts.elementOrigins === undefined && loweredBinding?.elementOrigins !== undefined) {
          facts.elementOrigins = loweredBinding.elementOrigins;
        }
        const info = maintainCollectionFacts({
          ...origin,
          ...(collection || facts.max !== undefined || facts.elementOrigins !== undefined
            ? { collectionIdentity: {} }
            : {}),
          collectionDeclaration: declaration.name,
          locallyCreatedCollection: isLocallyCreatedCollection(declaration.initializer),
          ...(collection ? { collection } : {}),
          ...(objectFields ? { objectFields } : {}),
          immutableOrigin: { expression: declaration.initializer, environment: bindTime },
          ...(isRowExpression(declaration.initializer, env) ? { rowBinding: true } : {}),
          ...(rowCollection ? { rowCollection: true } : {}),
          ...(isNullableDbGet(declaration.initializer,
            (binding) => isOperationCompositeBinding(binding, "db", env)) ? { nullableRead: true } : {}),
        }, facts);
        env.variables.set(name, info);
        out.push(...lowered.statements);
        out.push(isConst
          ? { Const: { name, value: lowered.expression } }
          : { Let: { name, value: lowered.expression } });
      } catch (error) {
        captureRefusal(env.diagnostics, error);
      }
    }
    return out;
  }
  if (ts.isExpressionStatement(statement)) return lowerExpressionStatement(statement.expression, env);
  if (ts.isReturnStatement(statement)) {
    if (!statement.expression) return [{ Return: literal(null) }];
    const lowered = lowerValue(statement.expression, env, `${env.programName}.result`);
    return [...lowered.statements, { Return: lowered.expression }];
  }
  if (ts.isIfStatement(statement)) {
    const condition = lowerValue(statement.expression, env);
    const thenBranch = forkBranchEnvironment(env);
    const elseBranch = forkBranchEnvironment(env);
    const thenEnv = thenBranch.environment;
    const narrowed = nonNullIdentifier(statement.expression);
    if (narrowed && thenEnv.variables.has(narrowed)) thenEnv.variables.get(narrowed)!.nullableRead = false;
    const thenBody = lowerControlled(statement.thenStatement, thenEnv);
    const elseBody = statement.elseStatement
      ? lowerControlled(statement.elseStatement, elseBranch.environment)
      : [];
    mergeBranchEnvironments(env, [thenBranch, elseBranch], statement);
    return [...condition.statements, {
      If: {
        condition: condition.expression,
        then_body: thenBody,
        else_body: elseBody,
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
    const loopEnv = enterLexicalScope(env);
    const { statements, domain, bindingInfo } = lowerCollectionDomain(statement.expression, loopEnv, binding, lowerValue);
    loopEnv.variables.set(binding, bindingInfo);
    const iterations = loopDomainMaximum(domain);
    const domainIdentity = "DerivedArray" in domain && "Variable" in domain.DerivedArray.value
      ? loopEnv.variables.get(domain.DerivedArray.value.Variable)?.collectionIdentity
      : undefined;
    // @ref LLP 1002#2-the-authored-surface-the-snapback2-module — lowering-order analysis reserves inherited collections to their proven end-of-loop facts before nested domains are emitted.
    const body = lowerLoopBodyWithMutationPlan(statement, loopEnv, iterations, domainIdentity, lowerControlled);
    return [...statements, { For: { binding, domain, body } }];
  }
  if (statement.kind === ts.SyntaxKind.BreakStatement) return ["Break"];
  if (statement.kind === ts.SyntaxKind.ContinueStatement) return ["Continue"];
  // @ref LLP 1002#2-the-authored-surface-the-snapback2-module — lexical bindings classify authored facts and cannot escape their block.
  if (ts.isBlock(statement)) return lowerStatements(statement.statements, enterLexicalScope(env));
  if (ts.isEmptyStatement(statement)) return [];
  refuse(env, "E_OPAQUE", statement, `statement ${ts.SyntaxKind[statement.kind]} is outside the subset`);
}

function lowerControlled(statement: ts.Statement, env: Environment): Stmt[] {
  if (ts.isBlock(statement)) return lowerStatements(statement.statements, env);
  try {
    return lowerStatement(statement, env);
  } catch (error) {
    captureRefusal(env.diagnostics, error);
    return [];
  }
}

function lowerExpressionStatement(expression: ts.Expression, env: Environment): Stmt[] {
  if (ts.isCallExpression(expression)) {
    if (snapbackCallName(expression, env.sourceFile) === "emit") {
      // @ref LLP 1001#8-emit-and-the-outbox — Emit is IR, never an authoring-process side effect.
      if (env.kind === "Query") {
        refuse(env, "E_EMIT_IN_QUERY", expression, "emit is available only in mutations");
      }
      const effectNode = expression.arguments[0];
      const payloadNode = expression.arguments[1];
      if (!effectNode || !payloadNode) {
        refuse(env, "E_EFFECT_UNKNOWN", expression, "emit requires an imported effect and a JSON payload");
      }
      const effectPath = staticMemberPath(effectNode);
      const effect = effectPath && env.effects.get(effectPath);
      if (!effect) {
        refuse(env, "E_EFFECT_UNKNOWN", effectNode, `effect ${effectNode.getText(env.sourceFile)} is not declared in this project`);
      }
      reserveWriteSite(env);
      const payload = lowerValue(payloadNode, env, `${env.programName}.emit`);
      return [...payload.statements, { Emit: { effect, payload: payload.expression } }];
    }
    if (ts.isPropertyAccessExpression(expression.expression)) {
      const owner = expression.expression.expression;
      const method = expression.expression.name.text;
      if (ts.isIdentifier(owner) && env.variables.has(owner.text) && method === "push") {
        if (expression.arguments.length === 0) refuse(env, "E_OPAQUE", expression, "push requires at least one value");
        requireCollectionMutation(owner, expression, env);
        return expression.arguments.flatMap((value) => {
          const info = env.variables.get(owner.text)!;
          appendCollectionFacts(info, value, env,
            collectionMutationIncrement(info, owner.text, env), collectionOriginsBinding);
          const lowered = lowerValue(value, env, `${env.programName}.${owner.text}`);
          return [...lowered.statements, { Push: { target: owner.text, value: lowered.expression } } satisfies Stmt];
        });
      }
      if (ts.isIdentifier(owner) && env.variables.get(owner.text)?.collection === "Map" && method === "set") {
        requireCollectionMutation(owner, expression, env);
        const key = expression.arguments[0];
        const value = expression.arguments[1];
        if (!key || !value) refuse(env, "E_OPAQUE", expression, "Map.set requires key and value");
        const loweredKey = lowerValue(key, env);
        const loweredValue = lowerValue(value, env);
        const info = env.variables.get(owner.text)!;
        appendCollectionFacts(info, value, env, collectionMutationIncrement(info, owner.text, env), collectionOriginsBinding);
        return [
          ...loweredKey.statements,
          ...loweredValue.statements,
          { Push: {
            target: owner.text,
            value: { Object: { key: loweredKey.expression, value: loweredValue.expression } },
          } },
        ];
      }
      if (ts.isIdentifier(owner) && env.variables.get(owner.text)?.collection === "Set" && method === "add") {
        requireCollectionMutation(owner, expression, env);
        const value = expression.arguments[0];
        if (!value) refuse(env, "E_OPAQUE", expression, "Set.add requires a value");
        const loweredValue = lowerValue(value, env);
        const found = lowerCollectionLookup(owner, loweredValue.expression, env, "SetHas");
        const info = env.variables.get(owner.text)!;
        appendCollectionFacts(info, value, env, collectionMutationIncrement(info, owner.text, env), collectionOriginsBinding);
        return [
          ...loweredValue.statements,
          ...found.statements,
          { If: {
            condition: { Unary: { op: "Not", value: found.expression } },
            then_body: [{ Push: { target: owner.text, value: loweredValue.expression } }],
            else_body: [],
          } },
        ];
      }
      if (isDb(owner, (binding) => isOperationCompositeBinding(binding, "db", env))) {
        return lowerDbStatement(method, expression, env);
      }
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
    const info = env.variables.get(expression.left.text);
    recordAssignmentOrigin(info, expression.right, env);
    const bound = derivedBound(expression.right, env);
    if (info) mergeAssignedCollectionFacts(info, expression.right, env, bound.max, bound.boundSource);
    return [{ Assign: { name: expression.left.text, value: lowerExpr(expression.right, env) } }];
  }
  if (ts.isConditionalExpression(expression)) {
    const condition = lowerValue(expression.condition, env);
    const thenBranch = forkBranchEnvironment(env);
    const elseBranch = forkBranchEnvironment(env);
    const thenBody = lowerExpressionStatement(expression.whenTrue, thenBranch.environment);
    const elseBody = lowerExpressionStatement(expression.whenFalse, elseBranch.environment);
    mergeBranchEnvironments(env, [thenBranch, elseBranch], expression);
    return [...condition.statements, { If: {
      condition: condition.expression,
      then_body: thenBody,
      else_body: elseBody,
    } }];
  }
  refuse(env, "E_OPAQUE", expression, "expression statement does not lower to a data operation");
}

function lowerDbStatement(method: string, call: ts.CallExpression, env: Environment): Stmt[] {
  if (method === "require" || method === "assert") {
    const condition = call.arguments[0];
    if (!condition) refuse(env, "E_OPAQUE", call, `${method} requires a condition`);
    const lowered = lowerValue(condition, env);
    const narrowed = nonNullIdentifier(condition);
    if (narrowed) {
      const info = env.variables.get(narrowed);
      if (info) info.nullableRead = false;
    }
    return [...lowered.statements, { Require: {
      condition: lowered.expression,
      code: stringArgument(call.arguments[1]) ?? (method === "assert" ? "ASSERTION_FAILED" : "REQUIRE_FAILED"),
    } }];
  }
  const target = call.arguments[0];
  const table = target && tableReference(target, env).table;
  if (!table) refuse(env, "E_OPAQUE", call, `${method} requires a static table`);
  if (method === "insert") {
    const row = call.arguments[1];
    if (!row) refuse(env, "E_OPAQUE", call, "insert requires a row");
    reserveWriteSite(env);
    const lowered = lowerValue(row, env);
    return [...lowered.statements, { Insert: { table, row: lowered.expression } }];
  }
  if (method === "delete") {
    const key = call.arguments[1];
    if (!key) refuse(env, "E_OPAQUE", call, "delete requires a key");
    reserveWriteSite(env);
    return [{ Delete: { table, key: lowerExpr(key, env) } }];
  }
  if (method === "update" || method === "upsert") {
    const key = call.arguments[1];
    const row = call.arguments[2];
    if (!key || !row) refuse(env, "E_OPAQUE", call, `${method} requires key and row/patch`);
    if (ts.isArrayLiteralExpression(unwrapExpression(key))) {
      refuse(
        env,
        "E_OPAQUE",
        key,
        `${method} with a composite identity cannot be represented by S1's scalar write key`,
      );
    }
    if (isFunctionLike(row)) return lowerCallbackWrite(method, target!, table, key, row, env);
    if (method === "update" && knownObjectFields(row, env)?.includes("id")) {
      refuse(env, "E_SCHEMA_ID_RESERVED", row, "update patches cannot contain id", "remove id from the update patch");
    }
    reserveWriteSite(env);
    // The write call itself owns the first ordinal; its operands then lower in
    // authored order (key before patch/row), including any nested reads.
    const loweredKey = lowerExpr(key, env);
    const lowered = lowerPatch(row, env);
    return method === "update"
      ? [{ Update: { table, key: loweredKey, patch: lowered } }]
      : [{ Upsert: { table, key: loweredKey, row: lowered } }];
  }
  refuse(env, "E_OPAQUE", call, `db.${method} is not part of the S1 IR`);
}

function lowerCallbackWrite(
  method: "update" | "upsert",
  target: ts.Expression,
  table: string,
  key: ts.Expression,
  callback: ts.ArrowFunction | ts.FunctionExpression,
  env: Environment,
): Stmt[] {
  if (callback.parameters.length !== 1 || !ts.isIdentifier(callback.parameters[0]!.name)) {
    refuse(env, "E_OPAQUE", callback, "write callback must have one identifier parameter");
  }
  if (ts.isBlock(callback.body)) {
    refuse(env, "E_OPAQUE", callback.body, "write callback body must be an expression");
  }
  if (method === "update" && knownObjectFields(callback.body, env)?.includes("id")) {
    refuse(env, "E_SCHEMA_ID_RESERVED", callback.body, "update patches cannot contain id", "remove id from the update patch");
  }
  const ref = tableReference(target, env);
  if (method === "upsert" && ref.index !== "byId") {
    refuse(env, "E_OPAQUE", target, "upsert callbacks require a table primary key");
  }
  const site = allocateReadSite(env);
  reserveWriteSite(env);
  // A callback write performs one synthetic current-row read and one write at
  // the authored call site. Lower each authored operand once after those sites,
  // in source order, so a nested key read precedes callback-body reads.
  const loweredKey = lowerKey(key, env);
  const authoredKey = loweredKey[0]!;
  const keyTemporary = containsRead(authoredKey) ? temporary(env, `${singular(table)}WriteKey`) : undefined;
  const scalarKey: Expr = keyTemporary ? { Variable: keyTemporary } : authoredKey;
  const current = temporary(env, `${singular(table)}Current`);
  const callbackEnv = cloneEnvironment(env);
  callbackEnv.substitutions.set(
    callback.parameters[0].name.text,
    { expression: syntheticIdentifier(env.sourceFile, current), environment: callbackEnv },
  );
  callbackEnv.variables.set(current, { provenance: "Shape", rowBinding: true });
  const lowered = lowerValue(callback.body, callbackEnv, `${env.programName}.${singular(table)}Write`);
  const statements: Stmt[] = keyTemporary ? [{ Let: { name: keyTemporary, value: authoredKey } }] : [];
  statements.push({ Let: {
    name: current,
    value: { Get: {
      site,
      table: ref.table,
      index: ref.index,
      key: [scalarKey],
      provenance: readProvenance(key, env),
    } },
  } });
  if (method === "update") {
    statements.push({ Require: {
      condition: { Binary: { op: "Ne", left: { Variable: current }, right: literal(null) } },
      code: "UPDATE_ROW_MISSING",
    } });
  }
  statements.push(...lowered.statements);
  if (method === "update") {
    statements.push({ Update: { table, key: scalarKey, patch: lowered.expression } });
  } else {
    statements.push({ Upsert: { table, key: scalarKey, row: lowered.expression } });
  }
  return statements;
}

function lowerValue(node: ts.Expression, env: Environment, hint?: string): LoweredValue {
  const value = unwrapExpression(node);
  if (ts.isConditionalExpression(value)) {
    const name = temporary(env, "conditional");
    const condition = lowerValue(value.condition, env);
    const whenTrue = lowerValue(value.whenTrue, cloneEnvironment(env), hint);
    const whenFalse = lowerValue(value.whenFalse, cloneEnvironment(env), hint);
    return {
      statements: [
        ...condition.statements,
        { Let: { name, value: literal(null) } },
        { If: {
          condition: condition.expression,
          then_body: [...whenTrue.statements, { Assign: { name, value: whenTrue.expression } }],
          else_body: [...whenFalse.statements, { Assign: { name, value: whenFalse.expression } }],
        } },
      ],
      expression: { Variable: name },
    };
  }
  if (ts.isBinaryExpression(value) && value.operatorToken.kind === ts.SyntaxKind.QuestionQuestionToken) {
    return lowerCoalesce(value, env, hint, lowerValue);
  }
  if (ts.isBinaryExpression(value)) {
    const op = binaryOperator(value.operatorToken.kind);
    if (!op) return { statements: [], expression: lowerExpr(value, env, hint) };
    const left = lowerValue(value.left, env, hint);
    const right = lowerValue(value.right, env, hint);
    return {
      statements: [...left.statements, ...right.statements],
      expression: { Binary: { op, left: left.expression, right: right.expression } },
    };
  }
  if (ts.isPrefixUnaryExpression(value)
    && (value.operator === ts.SyntaxKind.ExclamationToken || value.operator === ts.SyntaxKind.MinusToken)) {
    const operand = lowerValue(value.operand, env, hint);
    return {
      statements: operand.statements,
      expression: {
        Unary: {
          op: value.operator === ts.SyntaxKind.ExclamationToken ? "Not" : "Neg",
          value: operand.expression,
        },
      },
    };
  }
  if (ts.isPropertyAccessExpression(value)) {
    if (ts.isIdentifier(value.expression)
      && env.variables.get(value.expression.text)?.operationComposite) {
      return { statements: [], expression: lowerExpr(value, env, hint) };
    }
    const base = lowerValue(value.expression, env, hint);
    const collection = ts.isIdentifier(value.expression)
      ? env.variables.get(value.expression.text)?.collection
      : undefined;
    if (value.name.text === "length" || (value.name.text === "size" && collection)) {
      return {
        statements: base.statements,
        expression: { Builtin: { builtin: "Len", args: [base.expression] } },
      };
    }
    return {
      statements: base.statements,
      expression: { Field: { base: base.expression, name: value.name.text } },
    };
  }
  if (ts.isObjectLiteralExpression(value)) {
    const statements: Stmt[] = [];
    const object: Record<string, Expr> = {};
    for (const property of value.properties) {
      try {
        if (ts.isSpreadAssignment(property)) {
          const nullable = nullableReadSpread(property.expression, env);
          if (nullable) nullableSpreadRefusal(property, env, nullable);
          const fields = knownObjectFields(property.expression, env);
          if (!fields) {
            const spread = property.expression.getText(env.sourceFile);
            refuse(env, "E_OPAQUE", property, "object spread requires a statically known object shape; spell its fields explicitly",
              replaceNode(env.source, property, `field: ${spread}.field`));
          }
          if (ts.isIdentifier(property.expression)
            && env.variables.get(property.expression.text)?.operationComposite === "args") {
            for (const field of fields) object[field] = { Variable: field };
            continue;
          }
          const lowered = lowerValue(property.expression, env, hint);
          statements.push(...lowered.statements);
          if ("Object" in lowered.expression) {
            for (const [field, expression] of Object.entries(lowered.expression.Object)) object[field] = expression;
            continue;
          }
          let base = lowered.expression;
          if (fields.length > 1 && !("Variable" in base)) {
            const name = temporary(env, "spread");
            statements.push({ Let: { name, value: base } });
            base = { Variable: name };
          }
          for (const field of fields) object[field] = { Field: { base, name: field } };
          continue;
        }
        if (ts.isShorthandPropertyAssignment(property)) {
          object[property.name.text] = lowerExpr(property.name, env);
          continue;
        }
        if (!ts.isPropertyAssignment(property)) refuse(env, "E_OPAQUE", property, "object member is outside the subset");
        const name = propertyName(property.name);
        if (!name) refuse(env, "E_OPAQUE", property.name, "computed object keys are unsupported");
        const lowered = lowerValue(property.initializer, env, hint ? `${hint}.${name}` : name);
        statements.push(...lowered.statements);
        object[name] = lowered.expression;
      } catch (error) {
        captureRefusal(env.diagnostics, error);
      }
    }
    return { statements, expression: { Object: object } };
  }
  if (ts.isArrayLiteralExpression(value)) {
    const statements: Stmt[] = [];
    const segments: Expr[] = [];
    let plain: Expr[] = [];
    const flush = () => {
      if (plain.length) segments.push({ Array: plain });
      plain = [];
    };
    for (const element of value.elements) {
      try {
        if (ts.isSpreadElement(element)) {
          if (staticBound(element.expression, env) === undefined) {
            const spread = element.expression.getText(env.sourceFile);
            refuse(env, "E_OPAQUE", element, "array spread requires a statically bounded array; spell its elements explicitly",
              replaceNode(env.source, element, `${spread}[0], ${spread}[1]`));
          }
          flush();
          const lowered = lowerValue(element.expression, env, hint);
          statements.push(...lowered.statements);
          segments.push(lowered.expression);
        } else {
          const lowered = lowerValue(element, env, hint);
          statements.push(...lowered.statements);
          plain.push(lowered.expression);
        }
      } catch (error) {
        captureRefusal(env.diagnostics, error);
      }
    }
    flush();
    return {
      statements,
      expression: segments.length === 0
        ? { Array: [] }
        : segments.length === 1
          ? segments[0]!
          : concatExpressions(segments),
    };
  }
  if (ts.isNewExpression(value)) return lowerCollectionConstructor(value, env, hint);
  if (ts.isCallExpression(value)) {
    const method = memberName(value.expression);
    if (method && ts.isPropertyAccessExpression(value.expression)
      && ts.isIdentifier(value.expression.expression)) {
      const owner = value.expression.expression;
      const info = env.variables.get(owner.text);
      const key = value.arguments[0];
      if (info?.collection === "Map" && (method === "get" || method === "has") && key) {
        const loweredKey = lowerValue(key, env, hint);
        const found = lowerCollectionLookup(owner, loweredKey.expression, env, method === "get" ? "MapGet" : "MapHas");
        return { statements: [...loweredKey.statements, ...found.statements], expression: found.expression };
      }
      if (info?.collection === "Set" && method === "has" && key) {
        const loweredKey = lowerValue(key, env, hint);
        const found = lowerCollectionLookup(owner, loweredKey.expression, env, "SetHas");
        return { statements: [...loweredKey.statements, ...found.statements], expression: found.expression };
      }
    }
    if (method === "slice" && ts.isPropertyAccessExpression(value.expression)) {
      const owner = lowerValue(value.expression.expression, env, hint);
      const args = value.arguments.map((argument) => lowerValue(argument, env));
      return {
        statements: [...owner.statements, ...args.flatMap((argument) => argument.statements)],
        expression: { Builtin: {
          builtin: "Slice",
          args: [owner.expression, ...args.map((argument) => argument.expression)],
        } },
      };
    }
    if (method === "sort" && ts.isPropertyAccessExpression(value.expression)) {
      const owner = lowerValue(value.expression.expression, env, hint);
      return {
        statements: owner.statements,
        expression: lowerSortExpression(owner.expression, value.arguments[0], env),
      };
    }
    if (method && ["map", "flatMap", "filter", "reduce", "some"].includes(method)
      && ts.isPropertyAccessExpression(value.expression)) {
      return lowerArrayMethod(method, value.expression.expression, value, env, lowerValue, hint);
    }
    if (method === "require" && ts.isPropertyAccessExpression(value.expression)) {
      const base = lowerValue(value.expression.expression, env, hint);
      const name = temporary(env, "required");
      return {
        statements: [
          ...base.statements,
          { Let: { name, value: base.expression } },
          { Require: {
            condition: { Binary: { op: "Ne", left: { Variable: name }, right: literal(null) } },
            code: "REQUIRED_ROW_MISSING",
          } },
        ],
        expression: { Variable: name },
      };
    }
    if (isDbInsertCall(value, (binding) => isOperationCompositeBinding(binding, "db", env))) {
      const target = value.arguments[0];
      const row = value.arguments[1];
      if (!target || !row) refuse(env, "E_OPAQUE", value, "insert requires table and row");
      reserveWriteSite(env);
      const loweredRow = lowerValue(row, env, hint);
      return {
        statements: [...loweredRow.statements, { Insert: { table: tableReference(target, env).table, row: loweredRow.expression } }],
        expression: loweredRow.expression,
      };
    }
    if (ts.isIdentifier(value.expression) && ["top", "mergeByTime", "intersectById"].includes(value.expression.text)) {
      return lowerCollectionBuiltin(value.expression.text, value, env, hint);
    }
  }
  return { statements: [], expression: lowerExpr(value, env, hint) };
}

function lowerCollectionConstructor(
  expression: ts.NewExpression,
  env: Environment,
  hint?: string,
): LoweredValue {
  const kind = collectionConstructor(expression);
  if (!kind) refuse(env, "E_OPAQUE", expression, "only Map and Set constructors are admitted");
  const initializer = expression.arguments?.[0];
  if (!initializer) return { statements: [], expression: { Array: [] } };
  if ((expression.arguments?.length ?? 0) !== 1) {
    refuse(env, "E_OPAQUE", expression, `${kind} constructor accepts at most one bounded initializer`);
  }
  if (kind === "Set") return lowerValue(initializer, env, hint);
  const entries = unwrapExpression(initializer);
  if (!ts.isArrayLiteralExpression(entries)) {
    refuse(env, "E_OPAQUE", initializer, "Map initializer must be a bounded array literal of [key, value] pairs");
  }
  const statements: Stmt[] = [];
  const values: Expr[] = [];
  for (const entry of entries.elements) {
    const pair = unwrapExpression(entry);
    if (!ts.isArrayLiteralExpression(pair) || pair.elements.length !== 2) {
      refuse(env, "E_OPAQUE", entry, "Map initializer entries must be [key, value] pairs");
    }
    const key = lowerValue(pair.elements[0]!, env, hint);
    const value = lowerValue(pair.elements[1]!, env, hint);
    statements.push(...key.statements, ...value.statements);
    values.push({ Object: { key: key.expression, value: value.expression } });
  }
  return { statements, expression: { Array: values } };
}

function lowerCollectionLookup(
  owner: ts.Identifier,
  needle: Expr,
  env: Environment,
  mode: "MapGet" | "MapHas" | "SetHas",
): LoweredValue {
  const info = env.variables.get(owner.text);
  if (info?.max === undefined) {
    refuse(env, "E_UNBOUND_LOOP", owner, `${owner.text}.${mode === "MapGet" ? "get" : "has"} needs a statically bounded collection`);
  }
  const binding = temporary(env, mode === "SetHas" ? "setItem" : "mapEntry");
  const result = temporary(env, mode === "MapGet" ? "mapValue" : "collectionHas");
  const candidate = mode === "SetHas"
    ? { Variable: binding } satisfies Expr
    : { Field: { base: { Variable: binding }, name: "key" } } satisfies Expr;
  const assignment = mode === "MapGet"
    ? { Field: { base: { Variable: binding }, name: "value" } } satisfies Expr
    : literal(true);
  return {
    statements: [
      { Let: { name: result, value: mode === "MapGet" ? literal(null) : literal(false) } },
      { For: {
        binding,
        domain: { DerivedArray: {
          value: { Variable: owner.text },
          max: info.max,
          bound_source: info.boundSource ?? `${owner.text} static bound`,
        } },
        body: [{ If: {
          condition: { Binary: { op: "Eq", left: candidate, right: needle } },
          then_body: [{ Assign: { name: result, value: assignment } }],
          else_body: [],
        } }],
      } },
    ],
    expression: { Variable: result },
  };
}

function concatExpressions(expressions: Expr[]): Expr {
  return expressions.slice(1).reduce<Expr>(
    (left, right) => ({ Builtin: { builtin: "Concat", args: [left, right] } }),
    expressions[0]!,
  );
}
function lowerCollectionBuiltin(name: string, call: ts.CallExpression, env: Environment, hint?: string): LoweredValue {
  const valueNode = name === "top" ? call.arguments[1] : call.arguments[0];
  if (!valueNode) refuse(env, "E_OPAQUE", call, `${name} requires a bounded collection`);
  const lowered = lowerValue(valueNode, env, hint);
  let expression = lowered.expression;
  if (name === "mergeByTime") {
    const inputs = "Array" in expression ? expression.Array : [expression];
    expression = inputs.length === 0 ? { Array: [] } : concatExpressions(inputs);
  }
  if (name !== "intersectById") {
    expression = { Builtin: {
      builtin: { Sort: { keys: [{ field: "at", order: "Desc" }] } },
      args: [expression],
    } };
  }
  const limitNode = name === "top" ? call.arguments[0] : call.arguments[1];
  if (limitNode) expression = { Builtin: { builtin: "Slice", args: [expression, literal(0), lowerExpr(limitNode, env)] } };
  return { statements: lowered.statements, expression };
}
