import ts from "typescript";
import type { Environment, VariableInfo } from "../compiler";
import { propertyName, unwrapExpression } from "../syntax";
import { guardedWalk } from "./recursion";

type FunctionLike = ts.FunctionDeclaration | ts.ArrowFunction | ts.FunctionExpression;
type BindingScope = { parent?: BindingScope; bindings: Map<string, ts.Identifier> };

export function assignedBindings(handler: FunctionLike): Set<ts.Identifier> {
  const assigned = new Set<ts.Identifier>();
  const functionScope: BindingScope = { bindings: new Map() };
  for (const parameter of handler.parameters) declareBinding(parameter.name, functionScope);
  if (handler.body) visitBindingMutations(handler.body, functionScope, assigned);
  return assigned;
}

export function operationCompositeBindings(
  handler: FunctionLike,
): { args?: string; ctx?: string; db?: string } {
  const parameter = handler.parameters[0];
  if (!parameter || !ts.isObjectBindingPattern(parameter.name)) return {};
  const bindings: { args?: string; ctx?: string; db?: string } = {};
  for (const element of parameter.name.elements) {
    if (!ts.isIdentifier(element.name)) continue;
    const property = element.propertyName ? propertyName(element.propertyName) : element.name.text;
    if (property === "args" || property === "ctx" || property === "db") bindings[property] = element.name.text;
  }
  return bindings;
}

export function isOperationCompositeBinding(
  name: string,
  composite: "args" | "ctx" | "db",
  env: Environment,
): boolean {
  return resolvesOperationComposite(name, composite, env, new Set());
}

function resolvesOperationComposite(
  name: string,
  composite: "args" | "ctx" | "db",
  env: Environment,
  seen: Set<string>,
): boolean {
  if (env.variables.get(name)?.operationComposite === composite) return true;
  const substitution = env.substitutions.get(name);
  if (!substitution || seen.has(name)) return false;
  const value = unwrapExpression(substitution.expression);
  if (!ts.isIdentifier(value)) return false;
  seen.add(name);
  return resolvesOperationComposite(value.text, composite, substitution.environment, seen);
}

export function hasForOfAncestor(node: ts.Node): boolean {
  for (let current = node.parent; current; current = current.parent) {
    if (ts.isForOfStatement(current)) return true;
    if (ts.isFunctionLike(current)) return false;
  }
  return false;
}

function visitBindingMutations(node: ts.Node, scope: BindingScope, assigned: Set<ts.Identifier>): void {
  if (ts.isBlock(node)) {
    const block: BindingScope = { parent: scope, bindings: new Map() };
    for (const statement of node.statements) {
      if (!ts.isVariableStatement(statement)) continue;
      for (const declaration of statement.declarationList.declarations) declareBinding(declaration.name, block);
    }
    for (const statement of node.statements) visitBindingMutations(statement, block, assigned);
    return;
  }
  if (ts.isForOfStatement(node)) {
    visitBindingMutations(node.expression, scope, assigned);
    const loop: BindingScope = { parent: scope, bindings: new Map() };
    if (ts.isVariableDeclarationList(node.initializer)) {
      for (const declaration of node.initializer.declarations) declareBinding(declaration.name, loop);
    } else {
      visitBindingMutations(node.initializer, scope, assigned);
    }
    visitBindingMutations(node.statement, loop, assigned);
    return;
  }
  if (ts.isFunctionDeclaration(node) || ts.isArrowFunction(node) || ts.isFunctionExpression(node)) {
    const nested: BindingScope = { parent: scope, bindings: new Map() };
    for (const parameter of node.parameters) declareBinding(parameter.name, nested);
    if (node.body) visitBindingMutations(node.body, nested, assigned);
    return;
  }
  if (ts.isVariableDeclaration(node)) {
    if (node.initializer) visitBindingMutations(node.initializer, scope, assigned);
    return;
  }
  if (ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.EqualsToken
    && ts.isIdentifier(node.left)) {
    const binding = resolveBinding(node.left.text, scope);
    if (binding) assigned.add(binding);
    visitBindingMutations(node.right, scope, assigned);
    return;
  }
  if ((ts.isPostfixUnaryExpression(node) || ts.isPrefixUnaryExpression(node))
    && (node.operator === ts.SyntaxKind.PlusPlusToken || node.operator === ts.SyntaxKind.MinusMinusToken)
    && ts.isIdentifier(node.operand)) {
    const binding = resolveBinding(node.operand.text, scope);
    if (binding) assigned.add(binding);
    return;
  }
  ts.forEachChild(node, (child) => visitBindingMutations(child, scope, assigned));
}

function declareBinding(name: ts.BindingName, scope: BindingScope): void {
  if (ts.isIdentifier(name)) {
    scope.bindings.set(name.text, name);
    return;
  }
  for (const element of name.elements) {
    if (ts.isBindingElement(element)) declareBinding(element.name, scope);
  }
}

function resolveBinding(name: string, scope: BindingScope | undefined): ts.Identifier | undefined {
  for (let current = scope; current; current = current.parent) {
    const binding = current.bindings.get(name);
    if (binding) return binding;
  }
  return undefined;
}

export function directOriginCandidates(node: ts.Expression, env: Environment): Set<string> {
  return guardedWalk(env, node, "direct origin", () => directOriginCandidatesInner(node, env));
}

function directOriginCandidatesInner(node: ts.Expression, env: Environment): Set<string> {
  const value = unwrapExpression(node);
  if (ts.isPropertyAccessExpression(value) && ts.isIdentifier(value.expression)) {
    const info = env.variables.get(value.expression.text);
    const composite = info?.operationComposite;
    if (composite === "args" || composite === "ctx" && value.name.text === "viewer") {
      return new Set([value.getText(env.sourceFile)]);
    }
    if (info?.rowBinding) return new Set([value.getText(env.sourceFile)]);
  }
  if (ts.isIdentifier(value)) {
    const info = env.variables.get(value.text);
    if (info?.operationComposite === "args") return new Set([value.text]);
    if (info?.operationComposite === "ctx") return new Set([`${value.text}.viewer`]);
    if (info?.operationArgument) {
      const args = [...env.variables].find(([, candidate]) => candidate.operationComposite === "args")?.[0];
      return new Set([args ? `${args}.${info.operationArgument}` : info.operationArgument]);
    }
    if (info?.provenanceAmbiguity) {
      return new Set([
        ...(info.provenanceAmbiguity.candidates ?? []),
        ...(info.provenanceAmbiguity.directRewrite ? [info.provenanceAmbiguity.directRewrite] : []),
      ]);
    }
    return info?.immutableOrigin
      ? directOriginCandidates(info.immutableOrigin.expression, info.immutableOrigin.environment)
      : new Set();
  }
  // Property names are labels, never value operands. Walking `value.key` through
  // forEachChild would otherwise discover an unrelated operation argument named
  // `key` and rewrite the helper declaration instead of the authored read key.
  if (ts.isPropertyAccessExpression(value)) return directOriginCandidates(value.expression, env);
  if (ts.isObjectLiteralExpression(value)) {
    const candidates = new Set<string>();
    for (const property of value.properties) {
      const expression = ts.isSpreadAssignment(property)
        ? property.expression
        : ts.isPropertyAssignment(property)
          ? property.initializer
          : ts.isShorthandPropertyAssignment(property)
            ? property.name
            : undefined;
      if (!expression) continue;
      for (const direct of directOriginCandidates(expression, env)) candidates.add(direct);
    }
    return candidates;
  }
  if (ts.isCallExpression(value)) {
    const candidates = new Set<string>();
    for (const argument of value.arguments) {
      for (const direct of directOriginCandidates(argument, env)) candidates.add(direct);
    }
    return candidates;
  }
  const candidates = new Set<string>();
  value.forEachChild((child) => {
    if (!ts.isExpression(child)) return;
    for (const direct of directOriginCandidates(child, env)) candidates.add(direct);
  });
  return candidates;
}

export function withDirectRewrite(
  binding: Pick<VariableInfo, "provenance" | "provenanceAmbiguity">,
  node: ts.Expression,
  env: Environment,
): Pick<VariableInfo, "provenance" | "provenanceAmbiguity"> {
  if (!binding.provenanceAmbiguity) return binding;
  const candidates = new Set([
    ...(binding.provenanceAmbiguity.candidates ?? []),
    ...(binding.provenanceAmbiguity.directRewrite ? [binding.provenanceAmbiguity.directRewrite] : []),
    ...directOriginCandidates(node, env),
  ]);
  return { ...binding, provenanceAmbiguity: ambiguity([...candidates]) };
}

export function recordAssignmentOrigin(info: VariableInfo | undefined, node: ts.Expression, env: Environment): void {
  if (!info) return;
  const discovered = [...directOriginCandidates(node, env)];
  const candidates = new Set([
    ...(info.provenanceAmbiguity?.candidates ?? []),
    ...(info.provenanceAmbiguity?.directRewrite ? [info.provenanceAmbiguity.directRewrite] : []),
    ...(info.immutableOrigin ? directOriginCandidates(
      info.immutableOrigin.expression,
      info.immutableOrigin.environment,
    ) : []),
    ...(discovered.length > 0 ? discovered : [node.getText(env.sourceFile)]),
  ]);
  info.provenanceAmbiguity = ambiguity([...candidates]);
}

function ambiguity(candidates: string[]): NonNullable<VariableInfo["provenanceAmbiguity"]> {
  const distinct = [...new Set(candidates)];
  return {
    ...(distinct.length === 1 ? { directRewrite: distinct[0] } : {}),
    ...(distinct.length > 0 ? { candidates: distinct } : {}),
  };
}

export function moduleBasename(fileName: string): string {
  return fileName.split(/[\\/]/).at(-1)!.replace(/\.[^.]+$/, "");
}
