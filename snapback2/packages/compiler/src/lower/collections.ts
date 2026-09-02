import ts from "typescript";
import { requiredType } from "../authored-types";
import { refuse } from "../diagnostics";
import type { Expr, Stmt } from "../ir";
import { collectionConstructor, contextualNodeKey, literal, temporary, unwrapExpression } from "../syntax";
import { staticBound } from "./binding-bound";
import type { Environment, LoweredValue } from "./environment";

type LowerValue = (node: ts.Expression, env: Environment, hint?: string) => LoweredValue;

export function lowerCollectionConstructor(
  expression: ts.NewExpression,
  env: Environment,
  lowerValue: LowerValue,
  hint?: string,
): LoweredValue {
  const kind = collectionConstructor(expression);
  if (!kind) refuse(env, "E_OPAQUE", expression, "only Map and Set constructors are admitted");
  const initializer = expression.arguments?.[0];
  if (!initializer) return { statements: [], expression: { Array: [] } };
  if ((expression.arguments?.length ?? 0) !== 1) {
    refuse(env, "E_OPAQUE", expression, `${kind} constructor accepts at most one bounded initializer`);
  }
  if (kind === "Set") return lowerSetConstructor(initializer, env, lowerValue, hint);
  const entries = unwrapExpression(initializer);
  if (!ts.isArrayLiteralExpression(entries)) {
    refuse(env, "E_OPAQUE", initializer, "Map initializer must be a bounded array literal of [key, value] pairs");
  }
  const statements: Stmt[] = [];
  const result = temporary(env, "mapResult");
  statements.push({ Let: { name: result, value: { Array: [] } } });
  let maximum = 0;
  for (const entry of entries.elements) {
    const pair = unwrapExpression(entry);
    if (!ts.isArrayLiteralExpression(pair) || pair.elements.length !== 2) {
      refuse(env, "E_OPAQUE", entry, "Map initializer entries must be [key, value] pairs");
    }
    requirePrimitiveCollectionIdentity(pair.elements[0]!, env, "Map keys");
    const key = lowerValue(pair.elements[0]!, env, hint);
    const value = lowerValue(pair.elements[1]!, env, hint);
    statements.push(...lowerMapAssignment(result, key, value, maximum, "Map initializer bound", env));
    maximum += 1;
  }
  return { statements, expression: { Variable: result } };
}

function lowerSetConstructor(
  initializer: ts.Expression,
  env: Environment,
  lowerValue: LowerValue,
  hint?: string,
): LoweredValue {
  const lowered = lowerValue(initializer, env, hint);
  const max = staticBound(initializer, env);
  if (max === undefined) refuse(env, "E_UNBOUND_LOOP", initializer, "Set initializer must have a static bound");
  const sourceValue = unwrapExpression(initializer);
  if (ts.isArrayLiteralExpression(sourceValue)) {
    for (const element of sourceValue.elements) {
      if (ts.isSpreadElement(element)) {
        requirePrimitiveCollectionIdentity(element.expression, env, "Set elements", true);
      } else {
        requirePrimitiveCollectionIdentity(element, env, "Set elements");
      }
    }
  } else {
    requirePrimitiveCollectionIdentity(initializer, env, "Set elements", true);
  }
  const source = temporary(env, "setSource");
  const result = temporary(env, "setResult");
  const item = temporary(env, "setItem");
  const existing = temporary(env, "setExisting");
  const found = temporary(env, "setFound");
  return {
    statements: [
      ...lowered.statements,
      { Let: { name: source, value: lowered.expression } },
      { Let: { name: result, value: { Array: [] } } },
      { For: {
        binding: item,
        domain: { DerivedArray: { value: { Variable: source }, max, bound_source: `${initializer.getText(env.sourceFile)} static bound` } },
        body: [
          { Let: { name: found, value: literal(false) } },
          { For: {
            binding: existing,
            domain: { DerivedArray: { value: { Variable: result }, max, bound_source: "Set uniqueness bound" } },
            body: [{ If: {
              condition: { Binary: { op: "SameValueZero", left: { Variable: existing }, right: { Variable: item } } },
              then_body: [{ Assign: { name: found, value: literal(true) } }],
              else_body: [],
            } }],
          } },
          { If: {
            condition: { Unary: { op: "Not", value: { Variable: found } } },
            then_body: [{ Push: { target: result, value: { Variable: item } } }],
            else_body: [],
          } },
        ],
      } },
    ],
    expression: { Variable: result },
  };
}

export function lowerMapAssignment(
  target: string,
  key: LoweredValue,
  value: LoweredValue,
  max: number,
  boundSource: string | undefined,
  env: Environment,
): Stmt[] {
  // @ref LLP 1002#2-the-authored-surface-the-snapback2-module — Materialize each Map operand before any later operand setup.
  const authoredKey = temporary(env, "authoredMapKey");
  const authoredValue = temporary(env, "authoredMapValue");
  const keyName = temporary(env, "mapKey");
  const valueName = temporary(env, "mapValue");
  const result = temporary(env, "mapUpdated");
  const entry = temporary(env, "mapEntry");
  const found = temporary(env, "mapFound");
  const replacement = { Object: { key: { Variable: keyName }, value: { Variable: valueName } } } satisfies Expr;
  return [
    ...key.statements,
    { Let: { name: authoredKey, value: key.expression } },
    ...value.statements,
    { Let: { name: authoredValue, value: value.expression } },
    { Let: { name: keyName, value: { Variable: authoredKey } } },
    { Let: { name: valueName, value: { Variable: authoredValue } } },
    { Let: { name: result, value: { Array: [] } } },
    { Let: { name: found, value: literal(false) } },
    { For: {
      binding: entry,
      domain: { DerivedArray: { value: { Variable: target }, max, bound_source: boundSource ?? "Map static bound" } },
      body: [{ If: {
        condition: { Binary: { op: "SameValueZero", left: { Field: { base: { Variable: entry }, name: "key" } }, right: { Variable: keyName } } },
        then_body: [
          { If: {
            condition: { Unary: { op: "Not", value: { Variable: found } } },
            then_body: [{ Push: { target: result, value: replacement } }],
            else_body: [],
          } },
          { Assign: { name: found, value: literal(true) } },
        ],
        else_body: [{ Push: { target: result, value: { Variable: entry } } }],
      } }],
    } },
    { If: {
      condition: { Unary: { op: "Not", value: { Variable: found } } },
      then_body: [{ Push: { target: result, value: replacement } }],
      else_body: [],
    } },
    { Assign: { name: target, value: { Variable: result } } },
  ];
}

export function lowerCollectionLookup(
  owner: ts.Identifier,
  needle: Expr,
  env: Environment,
  mode: "MapGet" | "MapHas" | "SetHas",
): LoweredValue {
  const info = env.variables.get(owner.text);
  if (info?.max === undefined) {
    refuse(env, "E_UNBOUND_LOOP", owner, `${owner.text}.${mode === "MapGet" ? "get" : "has"} needs a statically bounded collection`);
  }
  const binding = temporary(env, mode === "SetHas" ? "setItem" : "mapEntry");
  const needleName = temporary(env, "collectionNeedle");
  const result = temporary(env, mode === "MapGet" ? "mapValue" : "collectionHas");
  const candidate = mode === "SetHas"
    ? { Variable: binding } satisfies Expr
    : { Field: { base: { Variable: binding }, name: "key" } } satisfies Expr;
  const assignment = mode === "MapGet"
    ? { Field: { base: { Variable: binding }, name: "value" } } satisfies Expr
    : literal(true);
  return {
    statements: [
      { Let: { name: needleName, value: needle } },
      { Let: { name: result, value: mode === "MapGet" ? literal(null) : literal(false) } },
      { For: {
        binding,
        domain: { DerivedArray: {
          value: { Variable: owner.text },
          max: info.max,
          bound_source: info.boundSource ?? `${owner.text} static bound`,
        } },
        body: [{ If: {
          condition: { Binary: { op: "SameValueZero", left: candidate, right: { Variable: needleName } } },
          then_body: [{ Assign: { name: result, value: assignment } }],
          else_body: [],
        } }],
      } },
    ],
    expression: { Variable: result },
  };
}

export function requirePrimitiveCollectionIdentity(
  node: ts.Expression,
  env: Environment,
  label: string,
  listElement = false,
): void {
  // @ref LLP 1002#2-the-authored-surface-the-snapback2-module — Composite JS identity is refused; primitive keys use SameValueZero.
  const value = unwrapExpression(node);
  if (value.kind === ts.SyntaxKind.NullKeyword) return;
  let type = env.expressionTypes.get(contextualNodeKey(env.literalContext, value, env.sourceFile));
  if (listElement) type = type?.kind === "list" ? type.of : undefined;
  const required = type && requiredType(type);
  if (required && ["null", "bool", "int", "decimal", "enum", "string"].includes(required.kind)) return;
  refuse(
    env,
    "E_OPAQUE",
    node,
    `${label} must be primitive strings, numbers, booleans, or null; object identity cannot be preserved in bounded data IR`,
    "select a primitive identity field before using this Map or Set operation",
  );
}
