import ts from "typescript";
import type { CollectionMutationCounts, Environment, VariableInfo } from "./environment";
import type { Stmt } from "../ir";
import { refuse, Refusal } from "../diagnostics";
import { addCollectionMutationCount, maintainCollectionFacts } from "./collection-facts";
import { cloneEnvironment } from "./expr";

type InheritedCollection = { name: string; info: VariableInfo };
type LoopMutationPlan = {
  counts: CollectionMutationCounts;
  facts: Map<object, VariableInfo>;
  iterations: number;
};

const LOOP_MUTATION_FIXPOINT_LIMIT = 16;

export function lowerLoopBodyWithMutationPlan(
  statement: ts.ForOfStatement,
  env: Environment,
  iterations: number,
  domainIdentity: object | undefined,
  lowerBody: (statement: ts.Statement, env: Environment) => Stmt[],
): Stmt[] {
  const ancestorDeferred = new Set(env.deferredCollectionMutations);
  const inherited = inheritedCollections(env);
  const plan = settleLoopMutationPlan(statement, env, inherited, iterations, domainIdentity, lowerBody);
  applyLoopMutationPlan(env, inherited, plan, ancestorDeferred);
  env.deferredCollectionMutations = new Set([...ancestorDeferred, ...inherited.keys()]);
  const parentMutationCounts = env.collectionMutationCounts;
  env.collectionMutationCounts = new Map();
  const body = lowerBody(statement.statement, env);
  applyLoopMutationPlan(env, inherited, plan, ancestorDeferred);
  if (parentMutationCounts) {
    for (const [identity, mutation] of plan.counts) {
      const scaled = mutation.count * iterations;
      if (!Number.isSafeInteger(scaled)) {
        refuse(env, "E_UNBOUND_LOOP", statement.expression, "nested collection mutation delta exceeds the static integer range");
      }
      addCollectionMutationCount(parentMutationCounts, identity, scaled, mutation.name);
    }
  }
  return body;
}

function inheritedCollections(env: Environment): Map<object, InheritedCollection> {
  const inherited = new Map<object, InheritedCollection>();
  for (const [name, info] of env.variables) {
    if (info.collectionIdentity && !inherited.has(info.collectionIdentity)) {
      inherited.set(info.collectionIdentity, { name, info });
    }
  }
  return inherited;
}

function settleLoopMutationPlan(
  statement: ts.ForOfStatement,
  env: Environment,
  inherited: Map<object, InheritedCollection>,
  iterations: number,
  domainIdentity: object | undefined,
  lowerBody: (statement: ts.Statement, env: Environment) => Stmt[],
): LoopMutationPlan {
  let priorCounts: CollectionMutationCounts = new Map();
  let priorFacts = new Map<object, VariableInfo>();
  for (let pass = 0; pass < LOOP_MUTATION_FIXPOINT_LIMIT; pass += 1) {
    const probe = isolatedAnalysisEnvironment(env);
    for (const [identity, collection] of inherited) {
      const info = variableByIdentity(probe, identity, collection.name);
      if (!info) continue;
      const prior = priorFacts.get(identity);
      if (prior) copyCollectionBounds(info, prior);
      const mutation = priorCounts.get(identity);
      if (mutation && !env.deferredCollectionMutations.has(identity)) {
        if (collection.info.max === undefined) {
          refuse(env, "E_UNBOUND_LOOP", statement.expression, "collection mutation has no provable pre-loop cardinality");
        }
        const maximum = collection.info.max + iterations * mutation.count;
        if (!Number.isSafeInteger(maximum)) {
          refuse(env, "E_UNBOUND_LOOP", statement.expression, "collection mutation bound exceeds the static integer range");
        }
        maintainCollectionFacts(info, {
          max: maximum,
          boundSource: `${mutation.name} mutations × loop bound ${iterations}`,
          ...(info.elementOrigins !== undefined ? { elementOrigins: info.elementOrigins } : {}),
        });
      }
    }
    probe.deferredCollectionMutations = new Set([...env.deferredCollectionMutations, ...inherited.keys()]);
    probe.collectionMutationCounts = new Map();
    lowerBody(statement.statement, probe);
    const unbound = probe.diagnostics.find((diagnostic) => diagnostic.code === "E_UNBOUND_LOOP");
    if (unbound) throw new Refusal(unbound);
    const counts = new Map([...probe.collectionMutationCounts]
      .filter(([identity]) => inherited.has(identity)));
    if (domainIdentity && counts.has(domainIdentity)) {
      refuse(
        env,
        "E_UNBOUND_LOOP",
        statement.expression,
        "collection mutation bound depends on its own growing loop domain and has no finite static fixed point",
      );
    }
    const facts = new Map<object, VariableInfo>();
    for (const [identity, collection] of inherited) {
      const info = variableByIdentity(probe, identity, collection.name);
      if (info) facts.set(identity, info);
    }
    if (sameMutationCounts(priorCounts, counts)) return { counts, facts, iterations };
    priorCounts = counts;
    priorFacts = facts;
  }
  refuse(
    env,
    "E_UNBOUND_LOOP",
    statement.expression,
    "collection mutation bound depends on a growing loop domain and has no finite static fixed point",
  );
}

function copyCollectionBounds(target: VariableInfo, source: VariableInfo): void {
  maintainCollectionFacts(target, {
    ...(source.max !== undefined ? { max: source.max } : {}),
    ...(source.boundSource !== undefined ? { boundSource: source.boundSource } : {}),
    ...(target.elementOrigins !== undefined ? { elementOrigins: target.elementOrigins } : {}),
  });
}

function isolatedAnalysisEnvironment(env: Environment): Environment {
  const probe = cloneEnvironment(env);
  probe.accessOrdinal = { value: env.accessOrdinal.value };
  probe.temp = { value: env.temp.value };
  probe.diagnostics = [];
  probe.recursion = { depth: 0, active: new Map() };
  probe.collectionMutationCounts = new Map();
  return probe;
}

function applyLoopMutationPlan(
  env: Environment,
  inherited: Map<object, InheritedCollection>,
  plan: LoopMutationPlan,
  ancestorDeferred: Set<object>,
): void {
  for (const [identity, collection] of inherited) {
    if (ancestorDeferred.has(identity)) continue;
    const target = variableByIdentity(env, identity, collection.name);
    const source = plan.facts.get(identity);
    if (!target || !source) continue;
    copyCollectionState(target, source);
    const mutation = plan.counts.get(identity);
    if (mutation && target.max !== undefined) {
      target.boundSource = `${mutation.name} mutations × loop bound ${plan.iterations}`;
    }
  }
}

function copyCollectionState(target: VariableInfo, source: VariableInfo): void {
  target.mutatedCollection = source.mutatedCollection;
  target.provenance = source.provenance;
  if (source.provenanceAmbiguity) {
    target.provenanceAmbiguity = {
      ...source.provenanceAmbiguity,
      ...(source.provenanceAmbiguity.candidates
        ? { candidates: [...source.provenanceAmbiguity.candidates] }
        : {}),
    };
  } else {
    delete target.provenanceAmbiguity;
  }
  maintainCollectionFacts(target, {
    ...(source.max !== undefined ? { max: source.max } : {}),
    ...(source.boundSource !== undefined ? { boundSource: source.boundSource } : {}),
    ...(source.elementOrigins !== undefined ? { elementOrigins: [...source.elementOrigins] } : {}),
  });
}

function variableByIdentity(env: Environment, identity: object, preferredName: string): VariableInfo | undefined {
  const preferred = env.variables.get(preferredName);
  if (preferred?.collectionIdentity === identity) return preferred;
  return [...env.variables.values()].find((info) => info.collectionIdentity === identity);
}

function sameMutationCounts(left: CollectionMutationCounts, right: CollectionMutationCounts): boolean {
  if (left.size !== right.size) return false;
  for (const [identity, mutation] of left) {
    if (right.get(identity)?.count !== mutation.count) return false;
  }
  return true;
}

export function recordLoopSite(env: Environment, statement: ts.ForOfStatement, binding: string): Environment {
  let ordinal = 0;
  while (env.sourceSites?.[`${env.programName}/for/${binding}/${ordinal}`]) ordinal++;
  if (env.sourceSites) {
    const position = env.sourceFile.getLineAndCharacterOfPosition(statement.getStart());
    env.sourceSites[`${env.programName}/for/${binding}/${ordinal}`] = { file: env.fileName, line: position.line + 1, col: position.character + 1 };
  }
  return env;
}
