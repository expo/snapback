import ts from "typescript";
import type { Environment } from "../compiler";
import { refuse } from "../diagnostics";
import { replaceNode } from "../syntax";

export type RecursionState = { depth: number; active: Map<ts.Node, Set<string>> };

export const MAX_RECURSION_DEPTH = 128;

export function guardedWalk<T>(
  env: Environment,
  node: ts.Node,
  kind: string,
  walk: () => T,
): T {
  const activeKinds = env.recursion.active.get(node);
  if (env.recursion.depth >= MAX_RECURSION_DEPTH || activeKinds?.has(kind)) {
    return refuseRecursiveWalk(env, node);
  }
  env.recursion.depth += 1;
  if (activeKinds) activeKinds.add(kind);
  else env.recursion.active.set(node, new Set([kind]));
  try {
    return walk();
  } finally {
    const remaining = env.recursion.active.get(node);
    remaining?.delete(kind);
    if (remaining?.size === 0) env.recursion.active.delete(node);
    env.recursion.depth -= 1;
  }
}

export function refuseRecursiveWalk(env: Environment, node: ts.Node): never {
  const expression = ts.isExpression(node) ? node : undefined;
  const rewrite = expression
    ? replaceNode(
        env.source,
        expression,
        "PROVENANCE_ORIGIN_REQUIRED(/* choose one direct origin; recursive expansion was refused */)",
      )
    : `${env.source}\n// E_PROVENANCE_AMBIGUOUS: replace the recursive value with one direct origin.`;
  refuse(
    env,
    "E_PROVENANCE_AMBIGUOUS",
    node,
    `provenance expansion is recursive or exceeds ${MAX_RECURSION_DEPTH} levels; choose one direct origin`,
    rewrite,
  );
}
