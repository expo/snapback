import { requiredType, sameDecimal, type AuthoredType } from "./authored-types";
import type { ValueConversion } from "./lower/value-conversion";

/** A destination changes the representation of a value, never its source facts. */
export function destinationConversion(own: AuthoredType | undefined, target: AuthoredType | undefined,
  columns: (table: string) => Record<string, AuthoredType> | undefined): ValueConversion | undefined {
  return own && destinationPlan(own, target, columns).conversion;
}

// @ref LLP 1002#2-the-authored-surface-the-snapback2-module — conversion describes the destination value, retaining the capture's presence, bounds and source member set.
export function destinationPlan(own: AuthoredType, target: AuthoredType | undefined,
  columns: (table: string) => Record<string, AuthoredType> | undefined): { type: AuthoredType; conversion?: ValueConversion } {
  if (!target) return { type: own };
  target = requiredType(target);
  if (own.kind === "optional") {
    const inner = destinationPlan(own.of, target, columns);
    return inner.conversion ? { type: { kind: "optional", of: inner.type }, conversion: { optional: inner.conversion } } : { type: own };
  }
  if (own.kind === "int" && own.wholeUnits && target.kind === "decimal") return { type: target, conversion: { scale: 10 ** target.scale } };
  if (own.kind === "object" && own.fields && (target.kind === "row" || target.kind === "object")) {
    const destinations = target.kind === "row" ? columns(target.table) : target.fields;
    const plans = Object.fromEntries(Object.entries(own.fields).map(([name, type]) =>
      [name, destinationPlan(type, destinations?.[name], columns)]));
    if (Object.values(plans).some(plan => plan.conversion)) return {
      type: { ...own, fields: Object.fromEntries(Object.entries(plans).map(([name, plan]) => [name, plan.type])) },
      conversion: { fields: Object.fromEntries(Object.entries(plans).map(([name, plan]) => [name, plan.conversion])) },
    };
  }
  if (own.kind === "list" && target.kind === "list" && own.max !== undefined) {
    const element = destinationPlan(own.of, target.of, columns);
    if (element.conversion) return { type: { ...own, of: element.type }, conversion: { list: { element: element.conversion, max: own.max } } };
  }
  return { type: own };
}

export function combineConversions(a: ValueConversion | undefined, b: ValueConversion | undefined): ValueConversion | undefined {
  if (!a) return b;
  if (!b) return a;
  if ("fields" in a && "fields" in b) return { fields: Object.fromEntries([...new Set([...Object.keys(a.fields), ...Object.keys(b.fields)])]
    .map(name => [name, combineConversions(a.fields[name], b.fields[name])])) };
  return a;
}

/** Mutable captures retain numeric representation, without claiming a lexical
 * text bound or a constant initializer for a subsequently assigned binding. */
export function mutableCaptureType(type: AuthoredType): AuthoredType {
  if (type.kind === "object" && type.fields) return { ...type, fields: Object.fromEntries(Object.entries(type.fields).map(([k,v]) => [k,mutableCaptureType(v)])) };
  if (type.kind === "list") return { ...type, of: mutableCaptureType(type.of) };
  // Losing a lexical bound or row authority does not turn a text value into an
  // unknown object, or an object member into collection cardinality. Keep only
  // representation here; never recover row members from its table's columns.
  if (type.kind === "string") { const { max, ...representation } = type; return representation; }
  if (type.kind === "object" || type.kind === "row" || type.kind === "asset") return { kind: "object" };
  if (type.kind === "optional") return { kind: "optional", of: mutableCaptureType(type.of) };
  return ["int", "decimal", "null", "enum", "principal", "unknown"].includes(type.kind) ? type : { kind: "unknown" };
}

export function commonCaptureType(values: AuthoredType[]): AuthoredType {
  if (!values.length || values.some(v => v.kind === "unknown")) return commonRepresentation(values);
  if (values.some(v => v.kind === "null" || v.kind === "optional")) {
    const present = values.filter(v => v.kind !== "null").map(requiredType);
    return present.length ? { kind: "optional", of: commonCaptureType(present) } : { kind: "null" };
  }
  const first = values[0]!;
  if (values.every(v => v.kind === "int")) return values.every(v => v.kind === "int" && v.wholeUnits)
    ? { kind: "int", wholeUnits: true } : { kind: "int" };
  if (first.kind === "object" && first.fields && values.every(v => v.kind === "object" && v.fields
    && Object.keys(v.fields).sort().join("\0") === Object.keys(first.fields!).sort().join("\0"))) {
    return { kind: "object", fields: Object.fromEntries(Object.keys(first.fields).map(name => [name,
      commonCaptureType(values.map(v => v.kind === "object" ? v.fields![name]! : { kind: "unknown" }))])) };
  }
  if (values.every(v => v.kind === "object")) return { kind: "object" };
  if (first.kind === "string" && values.every(v => v.kind === "string"
    && v.id === first.id && v.builtText === first.builtText)) {
    const { max, ...representation } = first;
    return values.every(v => v.kind === "string" && v.max !== undefined)
      ? { ...representation, max: Math.max(...values.map(v => v.kind === "string" ? v.max! : 0)) }
      : representation;
  }
  if (values.every(v => v.kind === "list")) {
    const of = commonCaptureType(values.flatMap(v => v.kind === "list" && v.max !== 0 ? [v.of] : []));
    const max = values.every(v => v.kind === "list" && v.max !== undefined)
      ? Math.max(...values.map(v => v.kind === "list" ? v.max! : 0)) : undefined;
    return { kind: "list", of, ...(max !== undefined ? { max } : {}) };
  }
  return values.every(v => JSON.stringify(v) === JSON.stringify(first)) ? first : commonRepresentation(values);
}

/** A single member dispatch across alternatives does not prove their members,
 * element types, identities, presence, or bounds. Those facts remain separate. */
function commonRepresentation(values: AuthoredType[]): AuthoredType {
  const representations = values.filter(value => value.kind !== "null").map(value => {
    const type = requiredType(value);
    if (type.kind === "unknown") return type.lengthRepresentation;
    if (["list", "string", "enum", "principal"].includes(type.kind)) return "collection" as const;
    if (["object", "row", "asset"].includes(type.kind)) return "member" as const;
    return undefined;
  });
  const first = representations[0];
  return first && representations.every(value => value === first)
    ? { kind: "unknown", lengthRepresentation: first } : { kind: "unknown" };
}

/** Unknown representation is not evidence that no conversion is necessary. */
export function destinationRepresentationError(own: AuthoredType, target: AuthoredType,
  columns: (table: string) => Record<string, AuthoredType> | undefined): string | undefined {
  if (target.kind === "optional" && own.kind === "null") return undefined;
  target = requiredType(target);
  own = requiredType(own);
  if (target.kind === "decimal") {
    if (sameDecimal(own, target) || own.kind === "int" && own.wholeUnits) return undefined;
    const source = own.kind === "decimal" ? `Decimal<${own.scale}>${own.currency ? ` ${own.currency}` : ""}` : own.kind;
    return `${source} does not prove the representation required by Decimal<${target.scale}>${target.currency ? ` ${target.currency}` : ""}`;
  }
  if (target.kind === "list") {
    if (own.kind === "list" && own.max === 0) return undefined;
    if (own.kind === "list" && own.max === undefined && destinationConversion(own.of, target.of, columns)) {
      return "list conversion requires a proven source maximum";
    }
    return destinationRepresentationError(own.kind === "list" ? own.of : { kind: "unknown" }, target.of, columns);
  }
  const fields = target.kind === "row" ? columns(target.table) : target.kind === "object" ? target.fields : undefined;
  const sources = own.kind === "row" ? columns(own.table) : own.kind === "object" ? own.fields : undefined;
  if (fields && !sources) for (const [name, type] of Object.entries(fields)) {
    const error = destinationRepresentationError({ kind: "unknown" }, type, columns);
    if (error) return `${name}: ${error}`;
  }
  // A patch need only prove fields it actually supplies.
  if (fields && sources) for (const [name, type] of Object.entries(sources)) {
    const error = fields[name] && destinationRepresentationError(type, fields[name]!, columns);
    if (error) return `${name}: ${error}`;
  }
  return undefined;
}
