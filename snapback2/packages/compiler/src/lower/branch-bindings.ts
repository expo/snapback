import ts from "typescript";
import type { Environment, VariableInfo } from "../compiler";
import { mergeCollectionFactAlternatives } from "./collection-facts";
import { cloneEnvironment } from "./expr";

export function forkBranchEnvironment(env: Environment): {
  environment: Environment;
  outerBindings: Map<string, VariableInfo>;
} {
  const environment = cloneEnvironment(env);
  return { environment, outerBindings: new Map(environment.variables) };
}

export function mergeBranchEnvironments(
  env: Environment,
  branches: readonly Map<string, VariableInfo>[],
  site: ts.Node,
): void {
  for (const [name, target] of env.variables) {
    const alternatives = branches.flatMap((branch) => branch.get(name) ? [branch.get(name)!] : []);
    if (alternatives.length !== branches.length) continue;
    const candidates = new Set(alternatives.flatMap((info) => [
      ...(info.provenanceAmbiguity?.candidates ?? []),
      ...(info.provenanceAmbiguity?.directRewrite ? [info.provenanceAmbiguity.directRewrite] : []),
    ]));
    if (candidates.size > 0) {
      target.provenance = "Computed";
      target.provenanceAmbiguity = rewriteAmbiguity([...candidates]);
    }
    mergeCollectionFactAlternatives(target, alternatives, `${site.getText(env.sourceFile)} branch maximum`);
    if (alternatives.some((info) => info.nullableRead === false)) target.nullableRead = false;
  }
}

function rewriteAmbiguity(candidates: string[]): NonNullable<VariableInfo["provenanceAmbiguity"]> {
  const distinct = [...new Set(candidates)];
  return {
    ...(distinct.length === 1 ? { directRewrite: distinct[0] } : {}),
    ...(distinct.length > 0 ? { candidates: distinct } : {}),
  };
}
