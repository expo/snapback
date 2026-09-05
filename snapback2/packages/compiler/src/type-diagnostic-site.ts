import ts from "typescript";
import type { FrontendDiagnostic } from "./ir";
import { callLeaf } from "./lower/static";
import { propertyName, unwrapCall } from "./syntax";

export type TypeDiagnosticSite = {
  code: "E_SCHEMA_INVALID" | "E_EFFECT_TYPE" | "E_EFFECT_THEN_ARGS" | "E_ARGS_TYPE" | "E_OPAQUE";
  family: FrontendDiagnostic["family"];
  guide: string;
};

export function typeDiagnosticSite(node: ts.Node, file: string): TypeDiagnosticSite {
  if (file === "schema.ts" || file.endsWith("/schema.ts")) {
    return { code: "E_SCHEMA_INVALID", family: "schema", guide: "schema/project" };
  }
  // A local declaration inside run is still an effect site.
  let effect: ts.Node | undefined = node;
  while (effect) {
    if (ts.isCallExpression(effect) && callLeaf(effect) === "effect") {
      const property = ancestor(node, ts.isPropertyAssignment);
      return property && propertyName(property.name) === "then"
        ? { code: "E_EFFECT_THEN_ARGS", family: "effect", guide: "effects/authoring" }
        : { code: "E_EFFECT_TYPE", family: "effect", guide: "effects/authoring" };
    }
    effect = effect.parent;
  }
  const declaration = ancestor(node, ts.isVariableDeclaration);
  const call = declaration?.initializer && unwrapCall(declaration.initializer);
  const kind = call && callLeaf(call);
  if (call && (kind === "query" || kind === "mutation")) {
    const args = call.arguments[0];
    if (args && node.getStart() >= args.getStart() && node.getEnd() <= args.getEnd()) {
      return { code: "E_ARGS_TYPE", family: "args", guide: "programs/args" };
    }
  }
  return { code: "E_OPAQUE", family: "opaque", guide: "opaque/subset" };
}

function ancestor<T extends ts.Node>(node: ts.Node, guard: (value: ts.Node) => value is T): T | undefined {
  let current: ts.Node | undefined = node;
  while (current) {
    if (guard(current)) return current;
    current = current.parent;
  }
  return undefined;
}
