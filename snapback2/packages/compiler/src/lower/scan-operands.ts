import ts from "typescript";
import type { Expr, Scan } from "../ir";
import type { Environment } from "./environment";
import { propertyName } from "../syntax";
import { refuse } from "../diagnostics";

/** A static descriptor must account for every authored property. Otherwise a
 * spread, shorthand or unknown property can hide an unevaluated operand. */
export function requireStaticOperands(object: ts.ObjectLiteralExpression, names: readonly string[], env: Environment, label: string): void {
  const seen = new Set<string>();
  for (const property of object.properties) {
    const name = property.name && propertyName(property.name);
    if (!ts.isPropertyAssignment(property) || !name || !names.includes(name) || seen.has(name)) {
      refuse(env, "E_OPAQUE", property, `${label} requires distinct explicit properties: ${names.join(", ")}`,
        `write each supported ${label} property explicitly; evaluate other expressions in a binding before this call`);
    }
    seen.add(name);
  }
}

const fields = ["after", "before", "gt", "gte", "lt", "lte"] as const;
type Field = typeof fields[number];
function operands(options: ts.ObjectLiteralExpression): Array<[Field,ts.Expression]> {
  const out: Array<[Field,ts.Expression]> = [];
  for (const property of options.properties) {
    if (!ts.isPropertyAssignment(property)) continue;
    const name = propertyName(property.name);
    if (name === "after" || name === "before") out.push([name,property.initializer]);
    if (name === "range" && ts.isObjectLiteralExpression(property.initializer)) {
      for (const bound of property.initializer.properties) {
        if (!ts.isPropertyAssignment(bound)) continue;
        const name = propertyName(bound.name);
        if (name === "gt" || name === "gte" || name === "lt" || name === "lte") out.push([name,bound.initializer]);
      }
    }
  }
  return out;
}
export function scanOperands(options: ts.ObjectLiteralExpression, env: Environment,
  lower: (node:ts.Expression,env:Environment)=>Expr): Pick<Scan,"after"|"before"|"range"> {
  requireStaticOperands(options, ["take","order","after","before","range","opaqueCursor","mergeSite"], env, "scan options");
  for (const property of options.properties) if (ts.isPropertyAssignment(property) && propertyName(property.name) === "range") {
    if (!ts.isObjectLiteralExpression(property.initializer)) refuse(env, "E_OPAQUE", property.initializer,
      "scan range requires an explicit bounded-key object", "write range: { gt: value }, or gte, lt, lte explicitly");
    requireStaticOperands(property.initializer, ["gt","gte","lt","lte"], env, "scan range");
  }
  const values: Record<Field,Expr|null> = {after:null,before:null,gt:null,gte:null,lt:null,lte:null};
  for (const [name,node] of operands(options)) values[name]=lower(node,env);
  const {after,before,...range}=values;
  return {after,before,range:options.properties.some(p=>ts.isPropertyAssignment(p)&&propertyName(p.name)==="range"&&ts.isObjectLiteralExpression(p.initializer))?range:null};
}
export function scanOptionsNeedSequence(call:ts.CallExpression): boolean {
  const options=call.arguments[2];
  if (!options || !ts.isObjectLiteralExpression(options)) return false;
  const order=operands(options).map(([name])=>fields.indexOf(name));
  return order.some((n,i)=>i>0 && n<order[i-1]!);
}
