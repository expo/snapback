import type { Expr, Stmt, Value } from "../ir";
import type { Environment, LoweredValue } from "./environment";
import { contextualNodeKey, temporary } from "../syntax";
import type ts from "typescript";
import { runtimeBinding } from "./lexical-binding";
import { refuse } from "../diagnostics";

/** A use-site conversion applies to an already evaluated capture. */
export type ValueConversion =
  | { optional: ValueConversion }
  | { concat: { left?: ValueConversion; right?: ValueConversion } }
  | { project: { conversion: ValueConversion; field: string } }
  | { choice: { whenTrue?: ValueConversion; whenFalse?: ValueConversion } }
  | { literal: Value }
  | { scale: number }
  | { fields: Record<string, ValueConversion | undefined> }
  | { items: Array<ValueConversion | undefined> }
  | { list: { element: ValueConversion; max: number } };

export function convertAtUse(node: ts.Expression, env: Environment, value: Expr, valueEnv = env, statements?: Stmt[]): Expr {
  const conversion = env.valueConversions.get(contextualNodeKey(env.literalContext, node, env.sourceFile));
  if (!conversion) return value;
  return convertCapturedValue(value, conversion, undefined, valueEnv, statements, node);
}

function capturedShape(value: Expr, env?: Environment, seen = new Set<string>()): Expr {
  if (!env) return value;
  if ("Variable" in value && !seen.has(value.Variable) && seen.size < 128) {
    const info = runtimeBinding(value.Variable, env);
    if (info?.mutatedCollection) return value;
    if (info?.capturedShape) {
      seen.add(value.Variable);
      return capturedShape(info.capturedShape, info.identityEnvironment ?? env, seen);
    }
  }
  if ("Field" in value) {
    const base = capturedShape(value.Field.base, env, seen);
    if ("Object" in base && base.Object[value.Field.name]) return capturedShape(base.Object[value.Field.name]!, env, seen);
  }
  return value;
}

function capturedChoice(value: Expr, env: Environment, depth = 0): import("./environment").VariableInfo["choice"] {
  if (depth >= 128) return undefined;
  if ("Variable" in value) {
    const info = runtimeBinding(value.Variable, env);
    if (info?.choice) return info.choice;
    const next = info?.capturedShape ?? info?.identityExpression;
    if (next) return capturedChoice(next, info?.identityEnvironment ?? env, depth + 1);
  }
  if ("Field" in value) {
    const base = capturedShape(value.Field.base, env);
    if ("Object" in base && base.Object[value.Field.name]) return capturedChoice(base.Object[value.Field.name]!, env, depth + 1);
  }
  return undefined;
}

function evaluatedListBound(value: Expr, env?: Environment, depth = 0): number | undefined {
  if (!env || depth >= 128) return undefined;
  if ("Array" in value) return value.Array.length;
  if ("Variable" in value) {
    const info = runtimeBinding(value.Variable, env);
    return info?.max ?? (info?.capturedShape ? evaluatedListBound(info.capturedShape, info.identityEnvironment ?? env, depth + 1) : undefined);
  }
  if ("Builtin" in value) {
    if (value.Builtin.builtin === "Concat") {
      const max = value.Builtin.args.reduce((sum, part) => sum + (evaluatedListBound(part, env, depth + 1) ?? NaN), 0);
      return Number.isSafeInteger(max) ? max : undefined;
    }
    if (value.Builtin.builtin === "Slice" || typeof value.Builtin.builtin === "object" && "Sort" in value.Builtin.builtin) {
      const input = value.Builtin.args[0];
      return input && evaluatedListBound(input, env, depth + 1);
    }
  }
  if ("Field" in value) {
    const base = capturedShape(value.Field.base, env);
    if ("Object" in base && base.Object[value.Field.name]) return evaluatedListBound(base.Object[value.Field.name]!, env, depth + 1);
  }
  return undefined;
}

export function convertCapturedValue(value: Expr, conversion: ValueConversion, shape?: Expr, env?: Environment,
  statements?: Stmt[], site?: ts.Expression): Expr {
  if ("optional" in conversion && env && statements) {
    // Capture the actual operand once. Shape metadata must not replay a selected
    // initializer, and neither scalar work nor list iteration runs on absence.
    const source = temporary(env, "conversionSource"), result = temporary(env, "convertedOptional");
    const captured: Expr = { Variable: source }, body: Stmt[] = [];
    const converted = convertCapturedValue(captured, conversion.optional, undefined, env, body, site);
    statements.push({ Const: { name: source, value } }, { Let: { name: result, value: { Literal: "Null" } } },
      { If: { condition: { Binary: { op: "Ne", left: captured, right: { Literal: "Null" } } },
        then_body: [...body, { Assign: { name: result, value: converted } }], else_body: [] } });
    return { Variable: result };
  }
  if ("project" in conversion && "fields" in conversion.project.conversion) {
    const field = conversion.project.conversion.fields[conversion.project.field];
    return field ? convertCapturedValue(value, field, shape, env, statements, site) : value;
  }
  if ("project" in conversion && "Field" in value) {
    const base = convertCapturedValue(value.Field.base, conversion.project.conversion, undefined, env, statements, site);
    return { Field: { base, name: conversion.project.field } };
  }
  if ("choice" in conversion && env && statements) {
    const choice = capturedChoice(shape ?? value, env);
    if (choice) {
      const name = temporary(env, "convertedChoice");
      const yes: Stmt[] = [], no: Stmt[] = [];
      const a = conversion.choice.whenTrue ? convertCapturedValue(value, conversion.choice.whenTrue, choice.whenTrue, env, yes, site) : value;
      const b = conversion.choice.whenFalse ? convertCapturedValue(value, conversion.choice.whenFalse, choice.whenFalse, env, no, site) : value;
      statements.push({ Let: { name, value: { Literal: "Null" } } }, { If: { condition: choice.condition,
        then_body: [...yes, { Assign: { name, value: a } }], else_body: [...no, { Assign: { name, value: b } }] } });
      return { Variable: name };
    }
  }
  if ("literal" in conversion) return { Literal: conversion.literal };
  if ("scale" in conversion) return { Binary: { op: "Mul", left: value, right: { Literal: { Int: conversion.scale } } } };
  const evaluated = capturedShape(shape ?? value, env);
  const convert = (value: Expr, conversion: ValueConversion, shape?: Expr) => convertCapturedValue(value, conversion, shape, env, statements, site);
  if ("concat" in conversion && "Builtin" in evaluated && evaluated.Builtin.builtin === "Concat") {
    const [left, right] = evaluated.Builtin.args;
    if (left && right) return { Builtin: { builtin: "Concat", args: [
      conversion.concat.left ? convert(left, conversion.concat.left) : left,
      conversion.concat.right ? convert(right, conversion.concat.right) : right,
    ] } };
  }
  if ("list" in conversion) {
    // Convert each evaluated element, including aliases, field reads and selected
    // branches. No initializer replay or guessed tuple length is involved.
    if ("Array" in evaluated) return { Array: evaluated.Array.map(item => convert(item, conversion.list.element)) };
    if (env && statements) {
      const result = temporary(env, "convertedList"), binding = temporary(env, "convertedElement");
      const body: Stmt[] = [];
      const element = convertCapturedValue({ Variable: binding }, conversion.list.element, undefined, env, body, site);
      statements.push({ Let: { name: result, value: { Array: [] } } }, { For: { binding,
        domain: { DerivedArray: { value, max: Math.max(conversion.list.max, evaluatedListBound(value, env) ?? 0), bound_source: "captured list destination conversion" } },
        body: [...body, { Push: { target: result, value: element } }] } });
      return { Variable: result };
    }
  }
  if ("items" in conversion) {
    if ("Array" in evaluated) return { Array: evaluated.Array.map((item, index) => conversion.items[index]
      ? convert(item, conversion.items[index]!) : item) };
  }
  if ("fields" in conversion) {
    const object = "Object" in evaluated ? evaluated.Object : undefined;
    const names = object ? Object.keys(object) : Object.keys(conversion.fields);
    let base = value;
    if (!("Object" in value) && !("Variable" in value) && names.length > 1 && env && statements) {
      const name = temporary(env, "convertedObject");
      statements.push({ Const: { name, value } });
      base = { Variable: name };
    }
    return { Object: Object.fromEntries(names.map(name => {
      const field = "Object" in base ? base.Object[name]! : { Field: { base, name } };
      return [name, conversion.fields[name] ? convert(field, conversion.fields[name]!, object?.[name]) : field];
    })) };
  }
  if (env && site) refuse(env, "E_OPAQUE", site, "this destination conversion needs a bounded evaluated list",
    "bind the bounded list before using it at this destination");
  throw new Error("missing bounded list conversion context");
}

// @ref LLP 1002#2-the-authored-surface-the-snapback2-module — tuple expansion is substitution of captured values, including through nested containers and helpers.
export function captureTupleValues(lowered: LoweredValue, env: Environment): Expr {
  const identityEnvironment = { ...env, variables: new Map(env.variables), substitutions: new Map(env.substitutions) };
  function visit(value: Expr, tuple = false): Expr {
    if ("Builtin" in value && value.Builtin.builtin === "Concat") return {
      Builtin: { builtin: "Concat", args: value.Builtin.args.map(item => visit(item, true)) },
    };
    if ("Array" in value) return { Array: value.Array.map(item => visit(item, true)) };
    if ("Object" in value) return { Object: Object.fromEntries(Object.entries(value.Object).map(([name, field]) => [name, visit(field, tuple)])) };
    if (!tuple || "Literal" in value) return value;
    const name = temporary(env, "capturedItem");
    lowered.statements.push({ Const: { name, value } });
    const prior = "Variable" in value ? runtimeBinding(value.Variable, env) : undefined;
    const info = { provenance: "Const" as const, capturedTupleValue: true, identityExpression: value, identityEnvironment,
      capturedShape: prior?.capturedShape, mutatedCollection: prior?.mutatedCollection, max: prior?.max };
    env.variables.set(name, info);
    env.runtimeBindings.set(name, info);
    return { Variable: name };
  }
  // A tuple descendant must not jump ahead of an earlier object member.
  const containsTuple = (value: Expr): boolean => "Array" in value
    || "Builtin" in value && value.Builtin.builtin === "Concat"
    || "Object" in value && Object.values(value.Object).some(containsTuple);
  return visit(lowered.expression, containsTuple(lowered.expression));
}
