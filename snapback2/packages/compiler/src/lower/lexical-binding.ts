import type { Environment, VariableInfo } from "./environment";
import { temporary } from "../syntax";

// @ref LLP 1002#2-the-authored-surface-the-snapback2-module — source spellings belong to lexical scopes; flat IR registers must not overwrite an outer binding.
export function declareBinding(name: string, info: VariableInfo, env: Environment): string {
  // Runtime registers outlive lexical maps (including helper expansion). The
  // shared register ledger must reserve caller and exited-scope identities.
  const runtimeName = (env.runtimeBindings.has(name) || env.variables.has(name) || env.substitutions.has(name))
    ? temporary(env, `${name}Binding`) : name;
  info.runtimeName = runtimeName;
  env.variables.set(name, info);
  env.runtimeBindings.set(runtimeName, info);
  env.substitutions.delete(name);
  return runtimeName;
}

export function bindingName(name: string, env: Environment): string {
  return env.variables.get(name)?.runtimeName ?? name;
}

export function runtimeBinding(name: string, env: Environment): VariableInfo | undefined {
  const local = env.variables.get(name);
  if (local && (local.runtimeName ?? name) === name) return local;
  return env.runtimeBindings?.get(name);
}
