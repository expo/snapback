import { bindDescriptorProgram } from "./lower/descriptor-origin";
import { lowerConditionalValue, lowerLogicalValue } from "./lower/choice";
import { checkAssignmentForm } from "./lower/assignment";
import { objectOrderNeedsCapture, observableEvaluation, OperandOrder } from "./lower/operand-order";
import { lowerCallValue, lowerScalarKey } from "./lower/operands";
import ts from "typescript";
import { checkCallOperands } from "./lower/call-operands";
import type { TableInfo } from "./authored-types";
import { argumentSpreadRewrite, expandArgumentObject } from "./args";
import { boundedDiagnostics, diagnostic, refuse, Refusal } from "./diagnostics";
import { allocateReadSite, cloneEnvironment, containsRead, enterLexicalScope,
  loopDomainMaximum, lowerArrayMethod, lowerCollectionDomain,
  lowerDomain, lowerExpr, lowerOptionalPropertyChain, lowerPropertyValue,
  lowerSortExpression, reserveWriteSite, tableReference,
} from "./lower/expr";
import { knownObjectFields, nullableReadSpread, nullableSpreadRefusal } from "./lower/object-shape";
import { derivedBound, staticBound } from "./lower/binding-bound";
import { collectionElementBinding, collectionOriginsBinding, provenanceBinding, readProvenance } from "./lower/provenance";
import { appendCollectionFacts, collectionMutationIncrement, maintainCollectionFacts,
  mergeAssignedCollectionFacts } from "./lower/collection-facts";
import { forkBranchEnvironment, mergeBranchEnvironments } from "./lower/branch-bindings";
import { lowerLoopBodyWithMutationPlan, recordLoopSite } from "./lower/loop-mutations";
import { lowerMergeByIndex } from "./lower/merge";
import { convertAtUse } from "./lower/value-conversion";
import { bindingName, declareBinding, runtimeBinding } from "./lower/lexical-binding";
import { lowerVariableStatement } from "./lower/variable-statement";
import { emptyDefaultArgument } from "./lower/empty-list-domain";
import { joinedListLoop } from "./lower/joined-list-domain";
import { requireOrdinaryRead } from "./lower/search-key";
import { lowerCollectionConstructor, lowerCollectionLookup, lowerMapAssignment, requirePrimitiveCollectionIdentity } from "./lower/collections";
import { upsertIdentityMatches } from "./lower/write-identity";
import { findPolicyRefusals, mechanicalBoundRewrite } from "./policy";
import { analyzeOperationTypes, type TypePlan } from "./type-analysis";
import { createSourceProgram, formatTypeDiagnostic } from "./typecheck";
import { typeDiagnosticSite } from "./type-diagnostic-site";
import { invalidDescriptorRefusal, lowerArgDescriptor, lowerLegacyArgDescriptor } from "./lower/schema";
import { duplicateHandlerBinding, duplicateHandlerBindingRewrite,
  nestedHandlerBinding, nestedHandlerDestructuringRewrite } from "./handler-bindings";
import { inspectModule, type ModuleInfo } from "./lower/module";
import type {
  CollectionEscapeSite, Environment, FunctionLike, LoweredValue, LowerSourceOptions, ProvenanceOrigin, Substitution, VariableInfo,
} from "./lower/environment";
import { assignedBindings, collectionSharingSites,
  isOperationCompositeBinding, moduleBasename, operationCompositeBindings, recordAssignmentOrigin,
  requireCollectionMutation, withDirectRewrite } from "./lower/operation-context";
import { boundOperationDiagnostics, localConstructorShadow, refuseReservedAuthCode } from "./operation-diagnostics";
import {
  contextualNodeKey,
  binaryOperator,
  findNarrowestNode,
  exportedVariables,
  isDb,
  isDbInsertCall,
  isDbWriteCall,
  isFunctionLike,
  literal,
  memberName,
  nonNullIdentifier,
  numericLiteral,
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
export async function lowerProject(root: string) { return (await import("./project")).lowerProject(root, { authoring: "any" }); }
function captureRefusal(diagnostics: FrontendDiagnostic[], error: unknown): void {
  if (error instanceof Refusal) diagnostics.push(error.diagnostic); else throw error;
}
export function lowerSource(
  source: string,
  fileName = "input.ts",
  libText?: string,
  options: LowerSourceOptions = {},
): LowerResult {
  const checked = libText !== undefined ? createSourceProgram(source, fileName, libText) : undefined;
  if (checked) bindDescriptorProgram(checked.program, checked.library);
  const sourceFile = options.checkedSource ?? checked?.sourceFile ?? ts.createSourceFile(fileName, source, ts.ScriptTarget.ES2022, true);
  const module = inspectModule(sourceFile, source, fileName, options);
  const diagnostics: FrontendDiagnostic[] = []; // Policy refusals follow lexical prefix lowering.
  const operationSpans: Array<{ name: string; call: ts.CallExpression }> = [];
  if (checked) {
    const typed = ts.getPreEmitDiagnostics(checked.program).filter(item => item.file !== checked.library);
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
  for (const { declaration, exportName } of exportedVariables(sourceFile)) {
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
      ? `${options.operationPrefix}.${exportName}`
      : exportName;
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
      programs.push(lowerOperation(module, name, exportName, kind, call, plan, diagnostics));
    } catch (error) {
      captureRefusal(diagnostics, error);
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
  diagnostics.unshift(...findPolicyRefusals(module, Number.MAX_SAFE_INTEGER));
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
  const args: Program["args"] = Object.create(null);
  const expandedArgs = expandArgumentObject(argObject);
  if (expandedArgs.invalidSpread) {
    refuse(module, "E_ARGS_SPREAD", expandedArgs.invalidSpread, "argument object spread is not a module-level constant object; spell out every argument field",
      argumentSpreadRewrite(module.source, expandedArgs.invalidSpread));
  }
  if (expandedArgs.invalidProperty) refuse(module, "E_ARGS_TYPE", expandedArgs.invalidProperty, "argument members must use name: descriptor syntax");
  for (const property of expandedArgs.entries) {
    const argName = property.name;
    const loweredDescriptor = lowerArgDescriptor(property.value, module.tables);
    const lowered = (loweredDescriptor ?? lowerLegacyArgDescriptor(property.value, module.tables)) as Program["args"][string] | undefined;
    if (lowered === undefined) {
      const invalid = invalidDescriptorRefusal(property.value, "argument");
      refuse(module, "E_ARGS_DESCRIPTOR", invalid.node, `invalid argument descriptor ${argName}; ${invalid.message}`, invalid.rewrite);
    }
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
    runtimeBindings: new Map(variables),
    substitutions: new Map(),
    helperStack: [],
    mutableBindings: assignedBindings(handler),
    deferredCollectionMutations: new Set(),
    collectionAliasSites: collectionSharing.aliases,
    collectionEscapeSites: collectionSharing.escapes,
    accessOrdinal: { value: 0 },
    temp: { value: 0 },
    literalValues: typePlan?.literalValues ?? new Map(),
    expressionTypes: typePlan?.expressionTypes ?? new Map(),
    contextualTypes: typePlan?.contextualTypes ?? new Map(),
    valueConversions: typePlan?.valueConversions ?? new Map(),
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
  if (ts.isVariableStatement(statement)) return lowerVariableStatement(statement, env, lowerValue);
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
    const loopEnv = recordLoopSite(enterLexicalScope(env), statement, binding);
    const emptyArgument = emptyDefaultArgument(statement.expression, loopEnv);
    const { statements, domain, bindingInfo } = emptyArgument
      ? { statements: [], domain: { ArgList: { name: emptyArgument.name, max: emptyArgument.max } },
          bindingInfo: collectionElementBinding(statement.expression, loopEnv) }
      : lowerCollectionDomain(statement.expression, loopEnv, binding, lowerValue);
    const runtimeName = declareBinding(binding, bindingInfo, loopEnv);
    const iterations = loopDomainMaximum(domain);
    const domainIdentity = "DerivedArray" in domain && "Variable" in domain.DerivedArray.value
      ? runtimeBinding(domain.DerivedArray.value.Variable, loopEnv)?.collectionIdentity
      : undefined;
    // @ref LLP 1002#2-the-authored-surface-the-snapback2-module — lowering-order analysis reserves inherited collections to their proven end-of-loop facts before nested domains are emitted.
    const accessStart = env.accessOrdinal.value;
    const body = lowerLoopBodyWithMutationPlan(statement, loopEnv, iterations, domainIdentity, lowerControlled);
    const loop = { For: { binding: runtimeName, domain, body } };
    return emptyArgument
      ? [{ If: { condition: { Binary: { op: "Ne", left: { Variable: emptyArgument.name }, right: literal(null) } },
          then_body: [loop], else_body: [] } }]
      : [...statements, joinedListLoop(loop, loopEnv, accessStart) ?? loop];
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
    checkCallOperands(expression, env);
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
        // @ref LLP 1002#2-the-authored-surface-the-snapback2-module — all call actuals evaluate once before the receiver changes, including later operands that inspect it.
        const statements: Stmt[] = [];
        const actuals = expression.arguments.map((value) => {
          const lowered = lowerValue(value, env, `${env.programName}.${owner.text}`);
          const name = temporary(env, "pushArgument");
          statements.push(...lowered.statements, { Const: { name, value: lowered.expression } });
          return { Variable: name } satisfies Expr;
        });
        for (const value of expression.arguments) {
          const info = env.variables.get(owner.text)!;
          appendCollectionFacts(info, value, env,
            collectionMutationIncrement(info, owner.text, env), collectionOriginsBinding);
        }
        return [...statements, ...actuals.map(value => ({
          Push: { target: bindingName(owner.text, env), value },
        }))];
      }
      if (ts.isIdentifier(owner) && env.variables.get(owner.text)?.collection === "Map" && method === "set") {
        requireCollectionMutation(owner, expression, env);
        const key = expression.arguments[0];
        const value = expression.arguments[1];
        if (!key || !value) refuse(env, "E_OPAQUE", expression, "Map.set requires key and value");
        requirePrimitiveCollectionIdentity(key, env, "Map keys");
        const loweredKey = lowerValue(key, env);
        const loweredValue = lowerValue(value, env);
        const info = env.variables.get(owner.text)!;
        const priorMax = info.max;
        const increment = collectionMutationIncrement(info, owner.text, env);
        appendCollectionFacts(info, value, env, increment, collectionOriginsBinding);
        if (info.max === undefined && priorMax !== undefined) {
          info.max = priorMax + increment;
          info.boundSource = `${value.getText(env.sourceFile)} Map.set bound`;
        }
        return [
          ...lowerMapAssignment(bindingName(owner.text, env), loweredKey, loweredValue, info.max ?? 0, info.boundSource, env),
        ];
      }
      if (ts.isIdentifier(owner) && env.variables.get(owner.text)?.collection === "Set" && method === "add") {
        requireCollectionMutation(owner, expression, env);
        const value = expression.arguments[0];
        if (!value) refuse(env, "E_OPAQUE", expression, "Set.add requires a value");
        requirePrimitiveCollectionIdentity(value, env, "Set values");
        const loweredValue = lowerValue(value, env);
        const valueName = temporary(env, "setValue");
        const found = lowerCollectionLookup(owner, { Variable: valueName }, env, "SetHas");
        const info = env.variables.get(owner.text)!;
        const priorMax = info.max;
        const increment = collectionMutationIncrement(info, owner.text, env);
        appendCollectionFacts(info, value, env, increment, collectionOriginsBinding);
        if (info.max === undefined && priorMax !== undefined) {
          info.max = priorMax + increment;
          info.boundSource = `${value.getText(env.sourceFile)} Set.add bound`;
        }
        return [
          ...loweredValue.statements,
          { Let: { name: valueName, value: loweredValue.expression } },
          ...found.statements,
          { If: {
            condition: { Unary: { op: "Not", value: found.expression } },
            then_body: [{ Push: { target: bindingName(owner.text, env), value: { Variable: valueName } } }],
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
        name: bindingName(expression.operand.text, env),
        value: {
          Binary: {
            op: expression.operator === ts.SyntaxKind.PlusPlusToken ? "Add" : "Sub",
            left: { Variable: bindingName(expression.operand.text, env) },
            right: literal(1),
          },
        },
      } }];
    }
  }
  if (ts.isBinaryExpression(expression)
    && expression.operatorToken.kind === ts.SyntaxKind.EqualsToken
    && ts.isIdentifier(expression.left)) {
    checkAssignmentForm(expression.right, env);
    const info = env.variables.get(expression.left.text);
    const bound = derivedBound(expression.right, env);
    const lowered = lowerValue(expression.right, env);
    // The RHS still observes the old binding, including an operation receiver.
    // Invalidate its authority only after all RHS operands have been lowered.
    recordAssignmentOrigin(info, expression.right, env);
    if (info) mergeAssignedCollectionFacts(info, expression.right, env, bound.max, bound.boundSource);
    return [...lowered.statements, { Assign: { name: bindingName(expression.left.text, env), value: lowered.expression } }];
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
    const codeNode = call.arguments[1];
    if (codeNode && stringArgument(codeNode) === undefined) refuse(env, "E_OPAQUE", codeNode,
      `${method} requires a literal error code`, 'use a literal error code, for example "REQUIRE_FAILED"');
    if (call.arguments.length > 2) refuse(env, "E_OPAQUE", call, `${method} accepts only a condition and literal error code`);
    const code = stringArgument(codeNode) ?? (method === "assert" ? "ASSERTION_FAILED" : "REQUIRE_FAILED");
    refuseReservedAuthCode(env, codeNode, code);
    const lowered = lowerValue(condition, env);
    const narrowed = nonNullIdentifier(condition);
    if (narrowed) {
      const info = env.variables.get(narrowed);
      if (info) info.nullableRead = false;
    }
    return [...lowered.statements, { Require: {
      condition: lowered.expression,
      code,
    } }];
  }
  const target = call.arguments[0];
  const reference = target && tableReference(target, env);
  if (reference) requireOrdinaryRead(target!, env, reference.table, reference.index);
  const table = reference?.table;
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
    const order = new OperandOrder(env);
    const value = lowerScalarKey(key, env, (node, scope) => order.add(lowerValue(node, scope)));
    return [...order.statements, { Delete: { table, key: value } }];
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
    // The write owns the first ordinal; operands lower in authored order (key before patch/row).
    const order = new OperandOrder(env);
    const loweredKey = lowerScalarKey(key, env, (node, scope) => order.add(lowerValue(node, scope)));
    const lowered = order.add(lowerValue(row, env));
    if (method === "upsert" && upsertIdentityMatches(
      loweredKey,
      lowered,
      (name) => runtimeBinding(name, env)?.identityExpression,
    ) === false) {
      refuse(
        env,
        "E_SCHEMA_ID_RESERVED",
        row,
        "upsert key and row id must be one identity",
        "const rowId = ctx.newId(); db.upsert(table, rowId, { ...row, id: rowId })",
      );
    }
    return [...order.statements, method === "update"
      ? { Update: { table, key: loweredKey, patch: lowered } }
      : { Upsert: { table, key: loweredKey, row: lowered } }];
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
  if (callback.parameters.length !== 1 || !ts.isIdentifier(callback.parameters[0]!.name) || callback.parameters[0]!.dotDotDotToken) {
    refuse(env, "E_OPAQUE", callback, "write callback must have one identifier parameter");
  }
  if (ts.isBlock(callback.body) && !env.source.startsWith("// GENERATED by the Snapback 2 Quarry front end from ")) {
    refuse(env, "E_OPAQUE", callback.body, "write callback body must be an expression");
  }
  const callbackResult = ts.isBlock(callback.body) ? finalCallbackReturn(callback.body, env) : callback.body;
  if (method === "update" && knownObjectFields(callbackResult, env)?.includes("id")) {
    refuse(env, "E_SCHEMA_ID_RESERVED", callbackResult, "update patches cannot contain id", "remove id from the update patch");
  }
  const ref = tableReference(target, env);
  if (method === "upsert" && ref.index !== "byId") refuse(env, "E_OPAQUE", target, "upsert callbacks require a table primary key");
  const site = allocateReadSite(env);
  reserveWriteSite(env);
  // Reserve the current-row read and write first, then lower key before callback operands.
  const statements: Stmt[] = [];
  const authoredKey = lowerScalarKey(key, env, (node, scope) => {
    const lowered = lowerValue(node, scope);
    statements.push(...lowered.statements);
    return lowered.expression;
  });
  const keyTemporary = containsRead(authoredKey) || JSON.stringify(authoredKey).includes('"Input":"NewId"') ? temporary(env, `${singular(table)}WriteKey`) : undefined;
  const scalarKey: Expr = keyTemporary ? { Variable: keyTemporary } : authoredKey;
  const current = temporary(env, `${singular(table)}Current`);
  const callbackEnv = cloneEnvironment(env);
  callbackEnv.substitutions.set(callback.parameters[0].name.text,
    { expression: syntheticIdentifier(env.sourceFile, current), environment: callbackEnv });
  callbackEnv.variables.set(current, { provenance: "Shape", rowBinding: true });
  const lowered = ts.isBlock(callback.body)
    ? lowerBlockCallback(callback.body, callbackEnv, `${env.programName}.${singular(table)}Write`)
    : lowerValue(callback.body, callbackEnv, `${env.programName}.${singular(table)}Write`);
  if (method === "upsert" && upsertIdentityMatches(
    scalarKey,
    lowered.expression,
    (name) => runtimeBinding(name, env)?.identityExpression,
  ) === false) {
    refuse(
      env,
      "E_SCHEMA_ID_RESERVED",
      callbackResult,
      "upsert key and row id must be one identity",
      "bind the identity once and use that binding for both the upsert key and row id",
    );
  }
  if (keyTemporary) statements.push({ Let: { name: keyTemporary, value: authoredKey } });
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
      code: "NOT_FOUND",
    } });
  }
  statements.push(...lowered.statements);
  if (method === "update") {
    statements.push({ Update: { table, key: scalarKey, patch: lowered.expression } });
  } else {
    // @ref LLP 1001#1-store-storers — retain addressed Upsert IR so both physical branches enforce key = row.id.
    statements.push({ Upsert: { table, key: scalarKey, row: lowered.expression } });
  }
  return statements;
}
function finalCallbackReturn(body: ts.Block, env: Environment): ts.Expression {
  const final = body.statements.at(-1);
  if (!final || !ts.isReturnStatement(final) || !final.expression) {
    refuse(env, "E_OPAQUE", body, "write callback block must end with a returned patch expression");
  }
  return final.expression;
}
function lowerBlockCallback(body: ts.Block, env: Environment, hint: string): LoweredValue {
  const expression = finalCallbackReturn(body, env);
  const statements = lowerStatements(body.statements.slice(0, -1), env);
  const returned = lowerValue(expression, env, hint);
  return { statements: [...statements, ...returned.statements], expression: returned.expression };
}
function lowerValue(node: ts.Expression, env: Environment, hint?: string): LoweredValue {
  const value = unwrapExpression(node);
  const key = contextualNodeKey(env.literalContext, value, env.sourceFile);
  const conversion = env.valueConversions.get(key);
  if (!conversion) return lowerValueInner(node, env, hint);
  const conversions = new Map(env.valueConversions);
  conversions.delete(key);
  const lowered = lowerValueInner(node, { ...env, valueConversions: conversions }, hint);
  lowered.expression = convertAtUse(value, env, lowered.expression, env, lowered.statements);
  return lowered;
}
function lowerValueInner(node: ts.Expression, env: Environment, hint?: string): LoweredValue {
  const value = unwrapExpression(node);
  const substituted = ts.isIdentifier(value) && env.substitutions.get(value.text);
  if (substituted) {
    const lowered = substituted.value ? { statements: [], expression: substituted.value }
      : lowerValue(substituted.expression, substituted.environment, hint);
    return { statements: lowered.statements, expression: convertAtUse(value, env, lowered.expression, substituted.environment) };
  }
  if (ts.isConditionalExpression(value)) return lowerConditionalValue(value, env, lowerValue, hint);
  if (ts.isBinaryExpression(value)) {
    const op = binaryOperator(value.operatorToken.kind);
    const nullish = value.operatorToken.kind === ts.SyntaxKind.QuestionQuestionToken;
    if (!op && !nullish) return { statements: [], expression: lowerExpr(value, env, hint) };
    const left = lowerValue(value.left, env, hint);
    const right = lowerValue(value.right, env, hint);
    if (op === "And" || op === "Or" || nullish) return lowerLogicalValue(left, right, op === "And" ? "And" : op === "Or" ? "Or" : "Nullish", env);
    const order = new OperandOrder(env);
    const a = order.add(left), b = order.add(right);
    return { statements: order.statements, expression: { Binary: { op: op!, left: a, right: b } } };
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
    if (ts.isPropertyAccessChain(value)) return lowerOptionalPropertyChain(value, env, lowerValue, hint);
    const base = lowerValue(value.expression, env, hint);
    return {
      statements: base.statements,
      expression: lowerPropertyValue(value, base.expression, env),
    };
  }
  if (ts.isTemplateExpression(value)) {
    const order = new OperandOrder(env);
    const parts: Expr[] = value.head.text ? [literal(value.head.text)] : [];
    for (const span of value.templateSpans) {
      parts.push(order.add(lowerValue(span.expression, env)));
      if (span.literal.text) parts.push(literal(span.literal.text));
    }
    return { statements: order.statements, expression: concatExpressions(parts.length === 1 ? [literal(""), ...parts] : parts) };
  }
  if (ts.isObjectLiteralExpression(value)) {
    const order = new OperandOrder(env);
    const statements = order.statements;
    const object: Record<string, Expr> = Object.create(null);
    const authoredFields: string[] = [];
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
          const spreadValue = order.add(lowered);
          if ("Object" in spreadValue) {
            for (const [field, expression] of Object.entries(spreadValue.Object)) {
              if (field in object && observableEvaluation(object[field])) order.flush();
              object[field] = expression;
              authoredFields.push(field);
            }
            continue;
          }
          let base = spreadValue;
          if (fields.length > 1 && !("Variable" in base)) {
            const name = temporary(env, "spread");
            statements.push({ Let: { name, value: base } });
            base = { Variable: name };
          }
          for (const field of fields) {
            if (field in object && observableEvaluation(object[field])) order.flush();
            object[field] = { Field: { base, name: field } };
            authoredFields.push(field);
          }
          continue;
        }
        if (ts.isShorthandPropertyAssignment(property)) {
          if (property.name.text in object && observableEvaluation(object[property.name.text])) order.flush();
          object[property.name.text] = order.add(lowerValue(property.name, env));
          authoredFields.push(property.name.text);
          continue;
        }
        if (!ts.isPropertyAssignment(property)) refuse(env, "E_OPAQUE", property, "object member is outside the subset");
        const name = propertyName(property.name);
        if (!name) refuse(env, "E_OPAQUE", property.name, "computed object keys are unsupported");
        const lowered = lowerValue(property.initializer, env, hint ? `${hint}.${name}` : name);
        if (name in object && observableEvaluation(object[name])) order.flush();
        object[name] = order.add(lowered);
        authoredFields.push(name);
      } catch (error) {
        captureRefusal(env.diagnostics, error);
      }
    }
    const effects = authoredFields.filter(name => observableEvaluation(object[name]));
    if (objectOrderNeedsCapture(effects)) order.flush();
    return { statements, expression: { Object: object } };
  }
  if (ts.isArrayLiteralExpression(value)) {
    const order = new OperandOrder(env);
    const statements = order.statements;
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
          segments.push(order.add(lowered));
        } else {
          const lowered = lowerValue(element, env, hint);
          plain.push(order.add(lowered));
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
  if (ts.isNewExpression(value)) return lowerCollectionConstructor(value, env, lowerValue, hint);
  if (ts.isCallExpression(value)) {
    checkCallOperands(value, env);
    const method = memberName(value.expression);
    if (method && ts.isPropertyAccessExpression(value.expression)
      && ts.isIdentifier(value.expression.expression)) {
      const owner = value.expression.expression;
      const info = env.variables.get(owner.text);
      const key = value.arguments[0];
      if (info?.collection === "Map" && (method === "get" || method === "has") && key) {
        requirePrimitiveCollectionIdentity(key, env, "Map keys");
        const loweredKey = lowerValue(key, env, hint);
        const found = lowerCollectionLookup(owner, loweredKey.expression, env, method === "get" ? "MapGet" : "MapHas");
        return { statements: [...loweredKey.statements, ...found.statements], expression: found.expression };
      }
      if (info?.collection === "Set" && method === "has" && key) {
        requirePrimitiveCollectionIdentity(key, env, "Set values");
        const loweredKey = lowerValue(key, env, hint);
        const found = lowerCollectionLookup(owner, loweredKey.expression, env, "SetHas");
        return { statements: [...loweredKey.statements, ...found.statements], expression: found.expression };
      }
    }
    if (method === "slice" && ts.isPropertyAccessExpression(value.expression)) {
      if (value.arguments.length !== 2) refuse(env, "E_OPAQUE", value, "slice requires start and end arguments");
      const owner = lowerValue(value.expression.expression, env, hint);
      const order = new OperandOrder(env);
      const receiver = order.add(owner);
      const args = value.arguments.map(argument => order.add(lowerValue(argument, env)));
      const literals = value.arguments.map(numericLiteral);
      if (literals.some(index => index === undefined || index < 0)) {
        // JS slice counts negative indices from the evaluated receiver length;
        // IR Slice clamps negative inputs to zero. Evaluate all authored operands
        // once before normalizing, so receiver/argument errors keep their order.
        order.flush();
        for (let i = 0; i < args.length; i++) {
          if (literals[i] !== undefined && literals[i]! >= 0) continue;
          const index = args[i]!;
          const negative: Expr = { Builtin: { builtin: "Max", args: [literal(0),
            { Binary: { op: "Add", left: { Builtin: { builtin: "Len", args: [receiver] } }, right: index } }] } };
          if (literals[i] !== undefined) { args[i] = negative; continue; }
          const name = temporary(env, "sliceIndex");
          order.statements.push({ Let: { name, value: index } }, { If: {
            condition: { Binary: { op: "Lt", left: index, right: literal(0) } },
            then_body: [{ Assign: { name, value: negative } }], else_body: [],
          } });
          args[i] = { Variable: name };
        }
      }
      return { statements: order.statements, expression: { Builtin: { builtin: "Slice", args: [receiver, ...args] } } };
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
      const reference = tableReference(target, env);
      requireOrdinaryRead(target, env, reference.table, reference.index);
      reserveWriteSite(env);
      const loweredRow = lowerValue(row, env, hint);
      const rowName = temporary(env, "insertRow"); // @ref LLP 1007#3-finding-where-check-is-green-and-the-runtime-is-red — evaluate impure row members once for storage and return.
      return { statements: [
        ...loweredRow.statements, { Let: { name: rowName, value: loweredRow.expression } },
        { Insert: { table: reference.table, row: { Variable: rowName } } },
      ], expression: { Variable: rowName } };
    }
    if (ts.isIdentifier(value.expression) && value.expression.text === "mergeByIndex") {
      return lowerMergeByIndex(value, env, hint, lowerValue, lowerBlockCallback);
    }
    if (ts.isIdentifier(value.expression) && ["top", "mergeByTime", "intersectById"].includes(value.expression.text)) {
      return lowerCollectionBuiltin(value.expression.text, value, env, hint);
    }
    return lowerCallValue(value, env, lowerValue, hint);
  }
  return { statements: [], expression: lowerExpr(value, env, hint) };
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
  if (name === "mergeByTime") {
    const inputs = unwrapExpression(valueNode);
    if (!ts.isArrayLiteralExpression(inputs) || inputs.elements.some(ts.isSpreadElement)) refuse(env, "E_OPAQUE", valueNode,
      "mergeByTime requires an explicit bounded list of input lists", "pass each bounded input explicitly: mergeByTime([first, second], limit)");
  }
  const order = new OperandOrder(env);
  const values = call.arguments.map(argument => isFunctionLike(argument) ? undefined : order.add(lowerValue(argument, env, hint)));
  if (!values[name === "top" ? 1 : 0] || call.arguments[name === "top" ? 0 : 1] && !values[name === "top" ? 0 : 1]) {
    refuse(env, "E_OPAQUE", call, `${name} requires ordinary collection and limit values, not function values`);
  }
  // The limit precedes the collection in top's authored call, although Slice
  // evaluates its collection first. Ignored ordinary arguments still evaluate.
  order.flush();
  let expression = values[name === "top" ? 1 : 0]!;
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
  const limit = values[name === "top" ? 0 : 1];
  if (limit) expression = { Builtin: { builtin: "Slice", args: [expression, literal(0), limit] } };
  return { statements: order.statements, expression };
}
