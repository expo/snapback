import ts from "typescript";
import { propertyName, replaceNode, unwrapExpression } from "./syntax";

export type ArgumentEntry = {
  name: string;
  value: ts.Expression;
  node: ts.PropertyAssignment;
};

export type ExpandedArguments = {
  entries: ArgumentEntry[];
  invalidSpread?: ts.SpreadAssignment;
  invalidProperty?: ts.ObjectLiteralElementLike;
};

export function expandArgumentObject(object: ts.ObjectLiteralExpression): ExpandedArguments {
  const constants = moduleArgumentObjects(object.getSourceFile());
  const entries = new Map<string, ArgumentEntry>();
  const active = new Set<ts.ObjectLiteralExpression>();
  let invalidSpread: ts.SpreadAssignment | undefined;
  let invalidProperty: ts.ObjectLiteralElementLike | undefined;

  const expand = (value: ts.ObjectLiteralExpression): void => {
    if (active.has(value)) return;
    active.add(value);
    for (const property of value.properties) {
      if (invalidSpread || invalidProperty) break;
      if (ts.isSpreadAssignment(property)) {
        const spread = unwrapExpression(property.expression);
        const target = ts.isIdentifier(spread) ? constants.get(spread.text) : undefined;
        if (!target || active.has(target)) invalidSpread = property;
        else expand(target);
        continue;
      }
      if (!ts.isPropertyAssignment(property)) {
        invalidProperty = property;
        continue;
      }
      const name = propertyName(property.name);
      if (!name) {
        invalidProperty = property;
        continue;
      }
      entries.delete(name);
      entries.set(name, { name, value: property.initializer, node: property });
    }
    active.delete(value);
  };

  expand(object);
  return { entries: [...entries.values()], invalidSpread, invalidProperty };
}

export function argumentSpreadRewrite(source: string, spread: ts.SpreadAssignment): string {
  const value = spread.expression.getText(spread.getSourceFile());
  return replaceNode(source, spread, `field: ${value}.field`);
}

function moduleArgumentObjects(sourceFile: ts.SourceFile): Map<string, ts.ObjectLiteralExpression> {
  const objects = new Map<string, ts.ObjectLiteralExpression>();
  for (const statement of sourceFile.statements) {
    if (!ts.isVariableStatement(statement) || !(statement.declarationList.flags & ts.NodeFlags.Const)) continue;
    for (const declaration of statement.declarationList.declarations) {
      if (!ts.isIdentifier(declaration.name) || !declaration.initializer) continue;
      const value = unwrapExpression(declaration.initializer);
      if (ts.isObjectLiteralExpression(value)) objects.set(declaration.name.text, value);
    }
  }
  return objects;
}
