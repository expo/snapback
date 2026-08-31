import ts from "typescript";
import type { CollectionMutationCounts, Environment, VariableInfo } from "../compiler";
import { addCollectionMutationCount, mergeCollectionFactAlternatives } from "./collection-facts";
import { cloneEnvironment } from "./expr";
import { candidateAmbiguity } from "./operation-context";

export type BranchEnvironment = {
  environment: Environment;
  outerBindings: Map<string, VariableInfo>;
  collectionMutationCounts?: CollectionMutationCounts;
};

export function forkBranchEnvironment(env: Environment): BranchEnvironment {
  const environment = cloneEnvironment(env);
  const collectionMutationCounts = env.collectionMutationCounts ? new Map() : undefined;
  environment.collectionMutationCounts = collectionMutationCounts;
  return { environment, outerBindings: new Map(environment.variables), collectionMutationCounts };
}

export function mergeBranchEnvironments(
  env: Environment,
  branches: readonly BranchEnvironment[],
  site: ts.Node,
): void {
  for (const [name, target] of env.variables) {
    const alternatives = branches.flatMap((branch) => branch.outerBindings.get(name)
      ? [branch.outerBindings.get(name)!]
      : []);
    if (alternatives.length !== branches.length) continue;
    const candidates = new Set(alternatives.flatMap((info) => [
      ...(info.provenanceAmbiguity?.candidates ?? []),
      ...(info.provenanceAmbiguity?.directRewrite ? [info.provenanceAmbiguity.directRewrite] : []),
    ]));
    if (candidates.size > 0) {
      target.provenance = "Computed";
      target.provenanceAmbiguity = candidateAmbiguity([...candidates]);
    }
    mergeCollectionFactAlternatives(target, alternatives, `${site.getText(env.sourceFile)} branch maximum`);
    if (alternatives.some((info) => info.nullableRead === false)) target.nullableRead = false;
  }
  if (!env.collectionMutationCounts) return;
  const identities = new Set(branches.flatMap((branch) => [...(branch.collectionMutationCounts?.keys() ?? [])]));
  for (const identity of identities) {
    const alternatives = branches.map((branch) => branch.collectionMutationCounts?.get(identity));
    const maximum = Math.max(...alternatives.map((entry) => entry?.count ?? 0));
    const name = alternatives.find((entry) => entry)?.name;
    if (name && maximum > 0) addCollectionMutationCount(env.collectionMutationCounts, identity, maximum, name);
  }
}
