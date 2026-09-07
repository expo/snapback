import ts from "typescript";
import type { Environment, FunctionLike, Substitution } from "../compiler";
import { refuse } from "../diagnostics";
import { expansionContext, unwrapCall, unwrapExpression } from "../syntax";
import { refuseRecursiveWalk } from "./recursion";
import { moduleScalarCaptures, moduleAmbientComposites } from "./module";

// @ref LLP 1002#2-the-authored-surface-the-snapback2-module — helper free names belong to the module declaration; actual parameters retain their caller's captured value.
export function expandHelper(
  node: ts.Expression,
  env: Environment,
): { expression: ts.Expression; environment: Environment } | undefined {
  const call = unwrapCall(node);
  if (!call || !ts.isIdentifier(call.expression)) return undefined;
  if (env.variables.has(call.expression.text) || env.substitutions.has(call.expression.text)) return undefined;
  const helper = env.helpers.get(call.expression.text);
  if (!helper?.body) return undefined;
  if (env.helperStack.includes(call.expression.text)) {
    refuse(env, "E_OPAQUE", call, "recursive helper is not inlineable");
  }
  const body = helperBodyExpression(helper);
  if (!body) refuse(env, "E_OPAQUE", helper, "helper must be a single pure return expression");
  const next: Environment = {
    ...env,
    variables: new Map(),
    substitutions: new Map(),
    helperStack: [...env.helperStack, call.expression.text],
    deferredCollectionMutations: new Set(env.deferredCollectionMutations),
    literalContext: expansionContext(env.literalContext, call, env.sourceFile),
  };
  for (const name of moduleAmbientComposites(env.sourceFile)) {
    const intrinsic = [...env.runtimeBindings.values()].find(info => info.operationComposite === name);
    if (intrinsic) next.variables.set(name, intrinsic);
  }
  for (const [name, expression] of moduleScalarCaptures(env.sourceFile)) {
    next.substitutions.set(name, { expression, environment: next });
  }
  helper.parameters.forEach((parameter, index) => {
    if (!ts.isIdentifier(parameter.name) || parameter.dotDotDotToken || !call.arguments[index]) {
      refuse(env, "E_OPAQUE", parameter, "helper parameters must be positional identifiers");
    }
    const argument = resolveSubstitution(call.arguments[index]!, env);
    next.substitutions.set(parameter.name.text, argument);
  });
  return { expression: body, environment: next };
}

function resolveSubstitution(node: ts.Expression, env: Environment): Substitution {
  let value = node;
  let environment = env;
  const seen = new Set<Substitution>();
  for (;;) {
    const unwrapped = unwrapExpression(value);
    if (!ts.isIdentifier(unwrapped)) return { expression: value, environment };
    const substitution = environment.substitutions.get(unwrapped.text);
    if (!substitution) return { expression: value, environment };
    if (substitution.value) return substitution;
    if (seen.has(substitution) || seen.size >= 128) return refuseRecursiveWalk(env, node);
    seen.add(substitution);
    value = substitution.expression;
    environment = substitution.environment;
  }
}

function helperBodyExpression(helper: FunctionLike): ts.Expression | undefined {
  if (!helper.body) return undefined;
  if (!ts.isBlock(helper.body)) return helper.body;
  if (helper.body.statements.length !== 1 || !ts.isReturnStatement(helper.body.statements[0])) return undefined;
  return helper.body.statements[0].expression;
}
