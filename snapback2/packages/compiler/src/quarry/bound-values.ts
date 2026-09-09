import { nameRewrite } from "./diagnostics";
import type { Provenance } from "../ir";
import type { Expr, ScalarType, Site } from "./ast";
import { decimalScale, typeError } from "./diagnostics";
import { typeName } from "./bound-source";
import type { BoundExpression, BoundPresence, BoundType, BoundValueFacts } from "./bound-model";

export function joinFacts(values: BoundValueFacts[], site: Site): BoundValueFacts {
  const type = values.slice(1).reduce((joined, value) => joinType(joined, value.type, site), values[0]!.type);
  const origins = new Set(values.map((value) => value.origin).filter((origin) => origin !== "Const"));
  const originated = values.filter((value) => value.type.kind !== "null");
  const tableOrigin = originated[0]?.tableOrigin;
  const readOrigin = originated[0]?.readOrigin;
  const fieldProjection = values.every((value) => value.fieldProjection === "inherited-row")
    ? "inherited-row" : values.some((value) => value.fieldProjection) ? "constructed" : undefined;
  return { ...facts(type, origins.size === 0 ? "Const" : origins.size === 1 ? [...origins][0]! : "Computed", {
    ...(values.some((value) => value.max !== undefined) ? { max: Math.max(...values.map((value) => value.max ?? 0)) } : {}),
    ...(tableOrigin && originated.every((value) => value.tableOrigin?.id === tableOrigin.id) ? { tableOrigin } : {}),
    ...(readOrigin && originated.every((value) => value.readOrigin === readOrigin) ? { readOrigin } : {}),
    ...(fieldProjection ? { fieldProjection } : {}),
  }), presence: values.some((value) => value.presence === "optional") ? "optional" : "required" };
}

function rowObjectType(row: Extract<BoundType, { kind: "row" }>): Extract<BoundType, { kind: "object" }> {
  const fields = new Map<string, BoundValueFacts>();
  fields.set("id", facts({ kind: "ref", table: row.table.name, optional: row.nullable }, "Shape", {
    tableOrigin: row.table, fieldProjection: "inherited-row",
  }));
  for (const column of row.table.declaration.columns) {
    fields.set(column.name, facts({ ...column.type, optional: column.type.optional || row.nullable } as ScalarType, "Shape", {
      tableOrigin: row.table, fieldProjection: "inherited-row",
    }));
  }
  return { kind: "object", fields, nullable: row.nullable };
}

export function joinType(left: BoundType, right: BoundType, site: Site): BoundType {
  if (left.kind === "null") return optionalType(right);
  if (right.kind === "null") return optionalType(left);
  if (left.kind === "empty-list" && right.kind === "empty-list") return left;
  if (left.kind === "empty-list" && right.kind === "list") return right;
  if (left.kind === "list" && right.kind === "empty-list") return left;
  if (left.kind === "ref" && right.kind === "id") return { ...left, optional: left.optional || right.optional };
  if (left.kind === "id" && right.kind === "ref") return { ...right, optional: left.optional || right.optional };
  if (left.kind === "row" && right.kind === "object") left = rowObjectType(left);
  if (left.kind === "object" && right.kind === "row") right = rowObjectType(right);
  if (left.kind !== right.kind) typeError(site,
    `conditional returns disagree: ${typeName(left)} and ${typeName(right)}`,
    "return the same value type from every branch");
  if (left.kind === "row" && right.kind === "row") {
    if (left.table.name !== right.table.name) typeError(site, "conditional returns rows from different tables", "return rows from one table");
    return { ...left, nullable: left.nullable || right.nullable };
  }
  if (left.kind === "page" && right.kind === "page") {
    if (left.table.name !== right.table.name) typeError(site, "conditional returns pages from different tables", "return pages from one table");
    const rawItem = (page: typeof left): BoundValueFacts => facts(
      { kind: "row", table: page.table, nullable: false }, "Shape", { tableOrigin: page.table },
    );
    const item = joinFacts([left.item ?? rawItem(left), right.item ?? rawItem(right)], site);
    return { ...left, item, max: Math.max(left.max, right.max) };
  }
  if (left.kind === "collection" && right.kind === "collection") {
    return { kind: "collection", item: joinFacts([left.item, right.item], site), max: Math.max(left.max, right.max) };
  }
  if (left.kind === "object" && right.kind === "object") {
    const leftNames = [...left.fields.keys()];
    const rightNames = [...right.fields.keys()];
    if (leftNames.length !== rightNames.length || leftNames.some((name) => !right.fields.has(name))) typeError(site,
      "conditional returns objects with different fields", "return the same object fields from every branch");
    return { kind: "object", nullable: left.nullable || right.nullable,
      fields: new Map(leftNames.map((name) => [name, joinFacts([left.fields.get(name)!, right.fields.get(name)!], site)])) };
  }
  if (left.kind === "numeric-literal" && right.kind === "numeric-literal") {
    return { kind: "numeric-literal", fractionalDigits: Math.max(left.fractionalDigits, right.fractionalDigits) };
  }
  if (!isScalar(left) || !isScalar(right)) return left;
  if (left.kind === "ref" && right.kind === "ref" && left.table !== right.table) typeError(site,
    `conditional returns ${left.table} and ${right.table} references`, "return references to one table");
  if (left.kind === "decimal" && right.kind === "decimal" && left.scale !== right.scale) decimalScale(site,
    `conditional returns decimal ${left.scale} and decimal ${right.scale}`, "return decimals with one scale");
  if (left.kind === "money" && right.kind === "money"
    && (left.currency !== right.currency || left.scale !== right.scale)) {
    if (left.currency === right.currency) decimalScale(site,
      "conditional returns money with different scales", "return money with one scale");
    typeError(site, "conditional returns different money brands", "return money with one currency and scale");
  }
  if (left.kind === "list" && right.kind === "list") {
    const item = joinType(left.item, right.item, site);
    if (!isScalar(item)) typeError(site, "conditional list items disagree", "return lists with one scalar item type");
    return { ...left, item, max: Math.max(left.max, right.max), optional: left.optional || right.optional };
  }
  if (left.kind === "text" && right.kind === "text") {
    const { min: _leftMin, format: _leftFormat, ...base } = left;
    const min = Math.min(left.min ?? 0, right.min ?? 0);
    return {
      ...base, max: Math.max(left.max, right.max),
      ...(min > 0 ? { min } : {}),
      ...(left.format === right.format && left.format ? { format: left.format } : {}),
      optional: left.optional || right.optional,
    };
  }
  if (left.kind === "enum" && right.kind === "enum") return {
    ...left, variants: [...new Set([...left.variants, ...right.variants])], optional: left.optional || right.optional,
  };
  if (left.kind === "bytes" && right.kind === "bytes") return {
    ...left, max: Math.max(left.max, right.max), optional: left.optional || right.optional,
  };
  if (left.kind === "image" && right.kind === "image") return {
    kind: "image", max: Math.max(left.max, right.max),
    ...(left.once && right.once ? { once: true } : {}), optional: left.optional || right.optional,
  };
  if (left.kind === "video" && right.kind === "video") return {
    ...left, max: Math.max(left.max, right.max), optional: left.optional || right.optional,
  };
  if (left.kind === "json" && right.kind === "json") return {
    ...left, max: Math.max(left.max, right.max), optional: left.optional || right.optional,
  };
  return { ...left, optional: left.optional || right.optional } as ScalarType;
}

export function contextualValue(expression: BoundExpression, target: ScalarType, site: Site): BoundExpression {
  if (expression.kind === "array" && target.kind === "list") {
    const itemTarget = { ...target.item, optional: target.item.optional } as ScalarType;
    const items = expression.items.map((item) => contextualValue(item, itemTarget, item.source.definition));
    const mismatch = items.find((item) => !assignableBoundValue(item.facts.type, itemTarget));
    if (mismatch) {
      const message = `list item expects ${typeName(itemTarget)}, got ${typeName(mismatch.facts.type)}`;
      const rewrite = `use ${typeName(itemTarget)} values in this list`;
      if (representationMismatch(mismatch.facts.type, itemTarget)) decimalScale(site, message, rewrite);
      typeError(site, message, rewrite);
    }
    return { ...expression, items, facts: facts({
      kind: "list", item: structuredClone(itemTarget), max: items.length, optional: false,
    }, combineOrigins(items), { max: items.length }) };
  }
  if (numericLiteralExpression(expression) && numericTarget(target)) return contextualLiteral(expression, target, site);
  if (stringLiteralExpression(expression) && (target.kind === "id" || target.kind === "ref" || target.kind === "enum")) {
    return contextualLiteral(expression, target, site);
  }
  return expression;
}

export function contextualPair(left: BoundExpression, right: BoundExpression, site: Site): [BoundExpression, BoundExpression] {
  const leftTarget = contextualTarget(right.facts.type);
  const rightTarget = contextualTarget(left.facts.type);
  // A branded numeric operand supplies context to an integral literal. Never
  // attempt the reverse coercion using the zero's original int type.
  const branded = (type: ScalarType | undefined) => type?.kind === "decimal" || type?.kind === "money";
  if (branded(leftTarget) && rightTarget?.kind === "int") return [contextualValue(left, leftTarget!, site), right];
  if (branded(rightTarget) && leftTarget?.kind === "int") return [left, contextualValue(right, rightTarget!, site)];
  if (leftTarget) left = contextualValue(left, leftTarget, site);
  if (rightTarget) right = contextualValue(right, rightTarget, site);
  return [left, right];
}

export function contextualTarget(type: BoundType): ScalarType | undefined {
  if (type.kind === "row") return { kind: "ref", table: type.table.name, optional: type.nullable };
  return isScalar(type) ? type : undefined;
}

function contextualLiteral(expression: BoundExpression, target: ScalarType, site: Site): BoundExpression {
  if (expression.kind === "unary" && expression.op === "Neg") {
    const value = contextualLiteral(expression.value, target, site);
    return { ...expression, value, facts: facts({ ...target, optional: false } as ScalarType, expression.facts.origin) };
  }
  if (expression.kind !== "literal") return expression;
  if (typeof expression.value === "string" && target.kind === "enum") {
    if (!target.variants.includes(expression.value)) typeError(site,
      `enum literal ${JSON.stringify(expression.value)} is not one of ${target.variants.join(", ")}`,
      nameRewrite(expression.value, target.variants));
    return { ...expression, facts: facts({ ...target, optional: false }, expression.facts.origin) };
  }
  if (typeof expression.value === "string" && (target.kind === "id" || target.kind === "ref")) {
    if (expression.value.length === 0) typeError(site, "Id literals cannot be empty", "use a non-empty Id literal");
    return { ...expression, wireKind: "id", facts: facts({ ...target, optional: false } as ScalarType, expression.facts.origin) };
  }
  if (typeof expression.value !== "number" || !numericTarget(target)) return expression;
  const text = expression.numericText ?? String(expression.value);
  const scale = target.kind === "decimal" || target.kind === "money" ? target.scale : 0;
  if ((target.kind === "decimal" || target.kind === "money") && scale > 0 && !text.includes(".") && expression.value !== 0) {
    typeError(site, `integer ${text} does not implicitly become ${typeName(target)} whole units`,
      `write ${text}.0 for whole decimal units, or pass an already typed ${typeName(target)} value`);
  }
  const wireValue = scaledInteger(text, scale);
  if (wireValue === undefined) {
    const message = `${decimalPlaces(text)} fractional digits do not fit ${typeName(target)}`;
    const rewrite = target.kind === "decimal" || target.kind === "money" ? `use at most ${target.scale} fractional digits` : "use an integer literal";
    if (target.kind === "decimal" || target.kind === "money") decimalScale(site, message, rewrite);
    typeError(site, message, rewrite);
  }
  return { ...expression, wireValue, facts: facts({ ...target, optional: false } as ScalarType, expression.facts.origin) };
}

function numericLiteralExpression(expression: BoundExpression): boolean {
  return expression.kind === "literal" && typeof expression.value === "number"
    || expression.kind === "unary" && expression.op === "Neg" && numericLiteralExpression(expression.value);
}
function stringLiteralExpression(expression: BoundExpression): boolean {
  return expression.kind === "literal" && typeof expression.value === "string";
}
function numericTarget(type: ScalarType): type is Extract<ScalarType, { kind: "int" | "decimal" | "money" }> {
  return ["int", "decimal", "money"].includes(type.kind);
}
export function numericAmount(type: BoundType): boolean {
  return (type.kind === "int" || type.kind === "decimal" || type.kind === "money") && !type.optional
    || type.kind === "numeric-literal";
}
export function brandedType(type: BoundType): Extract<ScalarType, { kind: "decimal" | "money" }> | undefined {
  return type.kind === "decimal" || type.kind === "money" ? type : undefined;
}
export function sameBrand(left: Extract<ScalarType, { kind: "decimal" | "money" }>, right: Extract<ScalarType, { kind: "decimal" | "money" }>): boolean {
  return left.kind === "decimal" && right.kind === "decimal" && left.scale === right.scale
    || left.kind === "money" && right.kind === "money" && left.currency === right.currency && left.scale === right.scale;
}
export function comparable(left: BoundType, right: BoundType): boolean {
  if (left.kind === "row") return right.kind === "row" && left.table.name === right.table.name
    || right.kind === "ref" && left.table.name === right.table;
  if (right.kind === "row") return comparable(right, left);
  if (!isScalar(left) || !isScalar(right)) return false;
  if (left.kind === "principal" || right.kind === "principal") return left.kind === "principal" && right.kind === "principal";
  if (left.kind === "ref" || left.kind === "id") return right.kind === "id"
    || right.kind === "ref" && (left.kind === "id" || left.table === right.table);
  if (right.kind === "ref" || right.kind === "id") return false;
  if ((left.kind === "enum" && right.kind === "text") || (left.kind === "text" && right.kind === "enum")) return true;
  if (left.kind === "decimal" || right.kind === "decimal") return left.kind === "decimal" && right.kind === "decimal" && left.scale === right.scale;
  if (left.kind === "money" || right.kind === "money") return left.kind === "money" && right.kind === "money"
    && left.currency === right.currency && left.scale === right.scale;
  return left.kind === right.kind;
}
export function orderedType(type: BoundType): boolean {
  return ["text", "id", "principal", "int", "decimal", "money", "time", "enum", "ref"].includes(type.kind);
}
export function idFallbackCompatible(actual: BoundType, expected: Extract<ScalarType, { kind: "id" | "ref" }>): boolean {
  if (actual.kind === "null") return expected.optional;
  if (actual.kind === "row") return expected.kind === "ref" && actual.table.name === expected.table;
  if (!isScalar(actual)) return false;
  return actual.kind === "id" || actual.kind === "ref" && (expected.kind === "id" || actual.table === expected.table);
}

export function facts(type: BoundType, origin: Provenance, extra: Partial<BoundValueFacts> = {}): BoundValueFacts {
  return { type, presence: presence(type), origin, ...extra };
}

export function projectedField<T extends BoundExpression>(expression: T, fieldProjection: NonNullable<BoundValueFacts["fieldProjection"]>): T {
  return { ...expression, facts: { ...expression.facts, fieldProjection } };
}
function presence(type: BoundType): BoundPresence {
  if (type.kind === "null") return "optional";
  if (type.kind === "row" || type.kind === "object") return type.nullable ? "optional" : "required";
  return "optional" in type && type.optional ? "optional" : "required";
}
export function combineOrigins(expressions: BoundExpression[]): Provenance {
  const origins = expressions.map((expression) => expression.facts.origin);
  if (origins.includes("Computed")) return "Computed";
  const meaningful = new Set(origins.filter((origin) => origin !== "Const"));
  if (meaningful.size === 0) return "Const";
  if (meaningful.size === 1) return [...meaningful][0]!;
  return "Shape";
}
export function scalarForIndex(type: BoundType | undefined): ScalarType | undefined {
  if (!type) return undefined;
  if (type.kind === "row") return { kind: "ref", table: type.table.name, optional: type.nullable };
  return isScalar(type) ? type : undefined;
}
export function scalarType(type: BoundType, site: Site): ScalarType {
  if (isScalar(type)) return type;
  typeError(site, `bounded arrays require scalar items; got ${type.kind}`, "use scalar array elements");
}
export function isScalar(type: BoundType): type is ScalarType {
  return !["unknown", "null", "empty-list", "row", "page", "collection", "object", "numeric-literal"].includes(type.kind);
}
export function requiredType(type: BoundType): BoundType {
  if (type.kind === "row" || type.kind === "object") return { ...type, nullable: false };
  if (isScalar(type)) return { ...type, optional: false } as ScalarType;
  return type;
}
export function optionalType(type: BoundType): BoundType {
  if (type.kind === "row" || type.kind === "object") return { ...type, nullable: true };
  if (isScalar(type)) return { ...type, optional: true } as ScalarType;
  return type;
}
function withOptional(type: BoundType, optional: boolean): BoundType {
  if (type.kind === "row" || type.kind === "object") return { ...type, nullable: optional };
  if (isScalar(type)) return { ...type, optional } as ScalarType;
  return type;
}
export function coalescedType(left: BoundType, right: BoundType, site: Site): BoundType {
  if (left.kind === "null") return right;
  if (right.kind === "null") return left;
  const joined = joinType(left, right, site);
  return withOptional(joined, presence(left) === "optional" && presence(right) === "optional");
}
export function binaryOperator(operator: string): string | undefined {
  return new Map([
    ["=", "Eq"], ["!=", "Ne"], ["<", "Lt"], ["<=", "Lte"], [">", "Gt"], [">=", "Gte"],
    ["+", "Add"], ["-", "Sub"], ["*", "Mul"], ["/", "Div"], ["%", "Mod"],
    ["and", "And"], ["or", "Or"], ["??", "Coalesce"],
  ]).get(operator);
}
export function boolType(): Extract<ScalarType, { kind: "bool" }> { return { kind: "bool", optional: false }; }
export function decimalPlaces(text: string | undefined): number {
  const dot = text?.indexOf(".") ?? -1;
  return dot < 0 ? 0 : text!.length - dot - 1;
}
function scaledInteger(text: string, scale: number): number | undefined {
  const match = text.match(/^(\d+)(?:\.(\d+))?$/);
  if (!match) return undefined;
  const fraction = match[2] ?? "";
  if (fraction.length > scale) return undefined;
  const value = BigInt(`${match[1]}${fraction.padEnd(scale, "0")}`);
  const number = Number(value);
  return Number.isSafeInteger(number) ? number : undefined;
}
export function assignableBoundValue(actual: BoundType, expected: ScalarType): boolean {
  if (actual.kind === "null") return expected.optional;
  if (actual.kind === "empty-list") return expected.kind === "list";
  if (actual.kind === "row") return expected.kind === "ref"
    && actual.table.name === expected.table && !actual.nullable;
  if (actual.kind === "id" && expected.kind === "ref") return !actual.optional || expected.optional;
  if (actual.kind === "ref" && expected.kind === "id") return !actual.optional || expected.optional;
  if (!isScalar(actual) || actual.kind !== expected.kind) return false;
  if (!expected.optional && actual.optional) return false;
  if (actual.kind === "text" && expected.kind === "text") {
    return actual.max <= expected.max && (expected.min === undefined || (actual.min ?? 0) >= expected.min)
      && (expected.format === undefined || actual.format === expected.format);
  }
  if (["bytes", "image", "video", "json"].includes(actual.kind)) {
    return "max" in actual && "max" in expected && actual.max <= expected.max;
  }
  if (actual.kind === "decimal" && expected.kind === "decimal") return actual.scale === expected.scale;
  if (actual.kind === "money" && expected.kind === "money") {
    return actual.currency === expected.currency && actual.scale === expected.scale;
  }
  if (actual.kind === "enum" && expected.kind === "enum") {
    return actual.variants.every((variant) => expected.variants.includes(variant));
  }
  if (actual.kind === "ref" && expected.kind === "ref") return actual.table === expected.table;
  if (actual.kind === "list" && expected.kind === "list") {
    return actual.max <= expected.max && assignableBoundValue(actual.item, expected.item);
  }
  return true;
}
export function representationMismatch(actual: BoundType, expected: BoundType): boolean {
  if (actual.kind === "decimal" && expected.kind === "decimal") return actual.scale !== expected.scale;
  if (actual.kind === "money" && expected.kind === "money") {
    return actual.currency === expected.currency && actual.scale !== expected.scale;
  }
  return actual.kind === "list" && expected.kind === "list" && representationMismatch(actual.item, expected.item);
}
export function writeAssignable(actual: BoundType, expected: ScalarType, authored: Expr | undefined): boolean {
  if (actual.kind === "null") return expected.optional;
  if (actual.kind === "empty-list") return expected.kind === "list";
  if (actual.kind === "unknown") return true;
  if (actual.kind === "object" && expected.kind === "json") return !actual.nullable || expected.optional;
  if (actual.kind === "numeric-literal") {
    if (expected.kind === "int") return actual.fractionalDigits === 0;
    if (expected.kind === "decimal" || expected.kind === "money") return actual.fractionalDigits <= expected.scale;
    return false;
  }
  if (authored?.kind === "literal" && typeof authored.value === "number" && expected.kind === "int") {
    return Number.isInteger(authored.value);
  }
  if (actual.kind === "text" && expected.kind === "text") {
    return (!actual.optional || expected.optional) && actual.max <= expected.max;
  }
  return assignableBoundValue(actual, expected);
}
