import ts from "typescript";
import type { Environment, FunctionLike, Substitution } from "../compiler";
import { refuse } from "../diagnostics";
import { expansionContext, unwrapCall, unwrapExpression } from "../syntax";
import { refuseRecursiveWalk } from "./recursion";

export function expandHelper(
  node: ts.Expression,
  env: Environment,
): { expression: ts.Expression; environment: Environment } | undefined {
  const call = unwrapCall(node);
  if (!call || !ts.isIdentifier(call.expression)) return undefined;
  const helper = env.helpers.get(call.expression.text);
  if (!helper) return undefined;
  if (env.helperStack.includes(call.expression.text)) {
    refuse(env, "E_OPAQUE", call, "recursive helper is not inlineable");
  }
  const body = helperBodyExpression(helper);
  if (!body) refuse(env, "E_OPAQUE", helper, "helper must be a single pure return expression");
  const next: Environment = {
    ...env,
    variables: new Map([...env.variables].map(([name, info]) => [name, { ...info }])),
    substitutions: new Map(env.substitutions),
    helperStack: [...env.helperStack, call.expression.text],
    literalContext: expansionContext(env.literalContext, call, env.sourceFile),
  };
  helper.parameters.forEach((parameter, index) => {
    if (!ts.isIdentifier(parameter.name) || !call.arguments[index]) {
      refuse(env, "E_OPAQUE", parameter, "helper parameters must be positional identifiers");
    }
    const argument = resolveSubstitution(call.arguments[index]!, env);
    next.substitutions.delete(parameter.name.text);
    if (!ts.isIdentifier(argument.expression) || argument.expression.text !== parameter.name.text
      || argument.environment !== env) {
      next.substitutions.set(parameter.name.text, argument);
    }
  });
  return { expression: body, environment: next };
}

function resolveSubstitution(node: ts.Expression, env: Environment): Substitution {
  let value = node;
  let environment = env;
  const seen = new Set<string>();
  for (;;) {
    const unwrapped = unwrapExpression(value);
    if (!ts.isIdentifier(unwrapped)) return { expression: value, environment };
    const substitution = environment.substitutions.get(unwrapped.text);
    if (!substitution) return { expression: value, environment };
    if (seen.has(unwrapped.text) || seen.size >= 128) return refuseRecursiveWalk(env, node);
    seen.add(unwrapped.text);
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
