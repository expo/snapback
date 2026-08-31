import ts from "typescript";
import type { Environment, ProvenanceOrigin, VariableInfo } from "../compiler";
import { collectionElementOrigins, originDirectCandidates, snapshotEnvironment } from "./collection-origins";
import { candidateAmbiguity } from "./operation-context";

export type CollectionFacts = Pick<VariableInfo, "max" | "boundSource" | "elementOrigins">;

/**
 * The only writer for cardinality and per-element origin facts. Callers may
 * compute facts in different lowering contexts, but a bound and the origins
 * that justify widening it are installed or invalidated together here.
 */
export function maintainCollectionFacts(info: VariableInfo, facts: CollectionFacts): VariableInfo {
  setOrDelete(info, "max", facts.max);
  setOrDelete(info, "boundSource", facts.boundSource);
  setOrDelete(info, "elementOrigins", facts.elementOrigins);
  return info;
}

export function collectionFactsFor(
  node: ts.Expression,
  env: Environment,
  max: number | undefined,
  boundSource: string | undefined,
): CollectionFacts {
  const elementOrigins = collectionElementOrigins(node, env);
  return {
    ...(max !== undefined ? { max, boundSource } : {}),
    ...(elementOrigins !== undefined ? { elementOrigins } : max === 0 ? { elementOrigins: [] } : {}),
  };
}

export function appendCollectionFacts(
  info: VariableInfo,
  value: ts.Expression,
  env: Environment,
  count: number,
  summarize: (origins: readonly ProvenanceOrigin[], authoredNode: ts.Expression) =>
    Pick<VariableInfo, "provenance" | "provenanceAmbiguity">,
): void {
  const prior = info.elementOrigins ?? (info.max === 0 ? [] : undefined);
  if (!prior) {
    const candidates = new Set<string>([
      "unknown prior collection origin",
      ...(info.provenanceAmbiguity?.candidates ?? []),
      ...(info.provenanceAmbiguity?.directRewrite ? [info.provenanceAmbiguity.directRewrite] : []),
      ...directCandidatesForBinding(info),
      ...originDirectCandidates([{ expression: value, environment: env }]),
    ]);
    info.provenance = "Computed";
    info.provenanceAmbiguity = candidateAmbiguity([...candidates]);
    maintainCollectionFacts(info, {});
    return;
  }
  const origins = [
    ...prior,
    { expression: value, environment: snapshotEnvironment(env) } satisfies ProvenanceOrigin,
  ];
  maintainCollectionFacts(info, {
    ...(info.max !== undefined ? { max: info.max + count } : {}),
    ...(info.max !== undefined ? { boundSource: `${value.getText(env.sourceFile)} push count` } : {}),
    elementOrigins: origins,
  });
  const summary = summarize(origins, value);
  if (summary.provenanceAmbiguity) {
    info.provenance = summary.provenance;
    info.provenanceAmbiguity = summary.provenanceAmbiguity;
  } else if (!info.provenanceAmbiguity) {
    info.provenance = summary.provenance;
  }
}

export function mergeAssignedCollectionFacts(
  info: VariableInfo,
  value: ts.Expression,
  env: Environment,
  nextMax: number | undefined,
  nextBoundSource: string | undefined,
): void {
  const nextOrigins = collectionElementOrigins(value, env);
  const isCollection = info.collection !== undefined || info.max !== undefined
    || info.elementOrigins !== undefined || nextMax !== undefined || nextOrigins !== undefined;
  if (!isCollection) return;
  const priorOrigins = info.elementOrigins ?? (info.max === 0 ? [] : undefined);
  maintainCollectionFacts(info, {
    ...(info.max !== undefined && nextMax !== undefined
      ? { max: Math.max(info.max, nextMax), boundSource: nextBoundSource ?? info.boundSource }
      : {}),
    ...(priorOrigins !== undefined && nextOrigins !== undefined
      ? { elementOrigins: [...priorOrigins, ...nextOrigins] }
      : {}),
  });
}

export function mergeCollectionFactAlternatives(
  target: VariableInfo,
  alternatives: readonly VariableInfo[],
  boundSource: string,
): void {
  const isCollection = target.collection !== undefined || target.max !== undefined
    || target.elementOrigins !== undefined || alternatives.some((info) =>
      info.collection !== undefined || info.max !== undefined || info.elementOrigins !== undefined);
  if (!isCollection) return;
  const maxima = alternatives.map((info) => info.max);
  const origins = alternatives.map((info) => info.elementOrigins);
  maintainCollectionFacts(target, {
    ...(maxima.every((maximum): maximum is number => maximum !== undefined)
      ? { max: Math.max(...maxima), boundSource }
      : {}),
    ...(origins.every((items): items is ProvenanceOrigin[] => items !== undefined)
      ? { elementOrigins: origins.flat() }
      : {}),
  });
}

function directCandidatesForBinding(info: VariableInfo): string[] {
  if (info.immutableOrigin) return originDirectCandidates([info.immutableOrigin]);
  return [];
}

function setOrDelete<K extends "max" | "boundSource" | "elementOrigins">(
  info: VariableInfo,
  key: K,
  value: VariableInfo[K],
): void {
  if (key === "max") {
    if (value === undefined) delete info.max;
    else info.max = value as number;
  } else if (key === "boundSource") {
    if (value === undefined) delete info.boundSource;
    else info.boundSource = value as string;
  } else if (value === undefined) delete info.elementOrigins;
  else info.elementOrigins = value as ProvenanceOrigin[];
}
