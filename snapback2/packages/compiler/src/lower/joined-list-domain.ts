import type { Expr, LoopDomain, Stmt, Value } from "../ir";
import type { Environment } from "./environment";
import { runtimeBinding } from "./lexical-binding";
import { temporary } from "../syntax";
import { copyLoop } from "./loop-copy";

type DomainChoice = { domain: LoopDomain } | { tuple: Expr[] } | {
  condition: Expr; whenTrue: DomainChoice; whenFalse: DomainChoice;
};

// @ref LLP 1017#32-the-rule — branch-assigned joins have no native population origin. Select genuine immutable list domains using the already captured choice; never retag the joined register.
export function joinedListLoop(loop: Extract<Stmt, { For: unknown }>, env: Environment, accessStart: number): Stmt | undefined {
  if (env.kind !== "Mutation" || !("DerivedArray" in loop.For.domain)) return undefined;
  let remaining = 128, choices = 0;
  function shape(value: Expr, scope: Environment): { value: Expr; scope: Environment } | undefined {
    if (--remaining < 0) return undefined;
    if ("Variable" in value) {
      const info = runtimeBinding(value.Variable, scope);
      if (!info || info.mutatedCollection || info.collectionDeclaration && scope.mutableBindings.has(info.collectionDeclaration)) return undefined;
      const next = info.capturedShape ?? info.identityExpression;
      if (next) return shape(next, info.identityEnvironment ?? scope);
    }
    if ("Field" in value) {
      const base = shape(value.Field.base, scope);
      const field = base && "Object" in base.value && base.value.Object[value.Field.name];
      return field ? shape(field, base!.scope) : undefined;
    }
    return { value, scope };
  }
  function domain(value: Expr, scope: Environment): DomainChoice | undefined {
    if (--remaining < 0) return undefined;
    if ("Variable" in value) {
      const info = runtimeBinding(value.Variable, scope);
      if (!info || info.mutatedCollection || info.collectionDeclaration && scope.mutableBindings.has(info.collectionDeclaration)) return undefined;
      if (info.choice?.nullish) {
        const yes = domain(info.choice.whenTrue, scope), no = domain(info.choice.whenFalse, scope);
        if (!yes || !no) return undefined;
        choices++;
        return { condition: info.choice.condition, whenTrue: yes, whenFalse: no };
      }
      if (info.operationArgument === value.Variable) {
        let type = env.args[value.Variable];
        while (type && typeof type !== "string" && "Optional" in type) type = type.Optional;
        if (type && typeof type !== "string" && "List" in type) {
          return { domain: { ArgList: { name: value.Variable, max: type.List.max } } };
        }
      }
      const next = info.capturedShape ?? info.identityExpression;
      return next && domain(next, info.identityEnvironment ?? scope);
    }
    if ("Field" in value) {
      const base = shape(value.Field.base, scope);
      const field = base && "Object" in base.value && base.value.Object[value.Field.name];
      return field ? domain(field, base!.scope) : undefined;
    }
    const constant = constantValue(value);
    if (constant && typeof constant !== "string" && "Array" in constant) {
      return { domain: { DerivedArray: { value: { Literal: constant }, max: constant.Array.length,
        bound_source: "captured constant list alternative" } } };
    }
    return "Array" in value && value.Array.every(item => capturedValue(item, scope)) ? { tuple: value.Array } : undefined;
  }
  const plan = domain(loop.For.domain.DerivedArray.value, env);
  if (!plan || choices === 0) return undefined;
  // The joined register, its lazy setup and any returned aliases stay intact.
  // Leaves use immutable arguments, constants or saved tuple components,
  // never a replayed initializer, helper, field computation, allocation or scan.
  const accessCount = env.accessOrdinal.value - accessStart;
  let first = true;
  function select(plan: DomainChoice): Stmt {
    if ("condition" in plan) return { If: { condition: plan.condition,
      then_body: [select(plan.whenTrue)], else_body: [select(plan.whenFalse)] } };
    const selected = "tuple" in plan ? tupleLoop(plan.tuple, loop, env) : { For: { ...loop.For, domain: plan.domain } };
    if (first) { first = false; return selected; }
    return freshLoop(selected, env, accessStart, accessCount);
  }
  return select(plan);
}

function capturedValue(value: Expr, env: Environment): boolean {
  if ("Literal" in value) return true;
  if ("Variable" in value) return runtimeBinding(value.Variable, env)?.capturedTupleValue === true;
  if ("Array" in value) return value.Array.every(item => capturedValue(item, env));
  if ("Object" in value) return Object.values(value.Object).every(item => capturedValue(item, env));
  return false;
}

// @ref LLP 1017#32-the-rule — a constructed tuple has an exact count, not a page maximum. Traverse every saved component without a body filter or re-evaluation.
function tupleLoop(items: Expr[], loop: Extract<Stmt, { For: unknown }>, env: Environment): Extract<Stmt, { For: unknown }> {
  const position = temporary(env, "joinPosition"), name = loop.For.binding;
  function select(start: number, end: number): Stmt {
    if (end - start === 1) return { Assign: { name, value: items[start]! } };
    const middle = Math.floor((start + end) / 2);
    return { If: { condition: { Binary: { op: "Lt", left: { Variable: position }, right: { Literal: { Int: middle } } } },
      then_body: [select(start, middle)], else_body: [select(middle, end)] } };
  }
  const binding: Stmt[] = items.length === 1 ? [{ Const: { name, value: items[0]! } }]
    : items.length ? [{ Let: { name, value: { Literal: "Null" } } }, select(0, items.length)] : [];
  copyLoopSource(env, name, position);
  return { For: { binding: position, domain: { LiteralRange: { start: 0, end_exclusive: items.length } },
    body: [...binding, ...loop.For.body] } };
}

function constantValue(value: Expr): Value | undefined {
  if ("Literal" in value) return value.Literal;
  if ("Array" in value) {
    const items = value.Array.map(constantValue);
    if (items.every((item): item is Value => item !== undefined)) return { Array: items };
  }
  if ("Object" in value) {
    const fields = Object.entries(value.Object).map(([key, item]) => [key, constantValue(item)] as const);
    if (fields.every((field): field is readonly [string, Value] => field[1] !== undefined)) {
      return { Row: Object.fromEntries(fields) };
    }
  }
  return undefined;
}

/** Each alternative has its own lexical registers and read sites, while
 * assignments to outer bindings and the authored early exits remain shared. */
function freshLoop(loop: Extract<Stmt, { For: unknown }>, env: Environment, accessStart: number, accessCount: number): Stmt {
  const names = new Map<string, string>(), sites = new Map<string, string>();
  const accessBase = env.accessOrdinal.value;
  env.accessOrdinal.value += accessCount;
  const identity = (name: string) => name;
  copyLoop(loop, { reference: identity, site: identity, binding(name) {
    if (!names.has(name)) names.set(name, temporary(env, "joinBinding"));
    return name;
  } });
  function site(name: string): string {
    if (!sites.has(name)) {
      // Keep module/export/read-write ordinals, including gaps reserved by
      // writes. A cloned access has fresh registers but the same source site.
      const prefix = `${env.siteBase}.`, ordinal = name.startsWith(prefix) ? Number(name.slice(prefix.length)) : NaN;
      const next = Number.isInteger(ordinal) && ordinal >= accessStart && ordinal < accessStart + accessCount
        ? `${prefix}${accessBase + ordinal - accessStart}` : name;
      sites.set(name, next);
      if (env.sourceSites?.[name]) env.sourceSites[next] = env.sourceSites[name]!;
    }
    return sites.get(name)!;
  }
  const reference = (name: string) => names.get(name) ?? name;
  const next = copyLoop(loop, { binding: reference, reference, site });
  for (const [before, after] of names) copyLoopSource(env, before, after);
  return next;
}

function copyLoopSource(env: Environment, before: string, after: string): void {
  if (!env.sourceSites) return;
  const prefix = `${env.programName}/for/${before}/`;
  for (const [name, source] of Object.entries(env.sourceSites)) {
    if (name.startsWith(prefix)) env.sourceSites[`${env.programName}/for/${after}/${name.slice(prefix.length)}`] = source;
  }
}
