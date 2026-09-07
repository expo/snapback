import ts from "typescript";
import type { FrontendDiagnostic } from "./ir";

type Cause = { absence: boolean; assignment: boolean; booleanDestination: boolean };
const causes = new WeakMap<FrontendDiagnostic, Cause>();

// @ref LLP 1002#3-the-compiler-worker-and-the-project-json — repair advice
// comes from the checked source and destination, never words in an error.
// These facts are compiler-local; they do not change the refusal wire shape.
export function recordTypeDiagnosticCause(
  diagnostic: FrontendDiagnostic, item: ts.Diagnostic, node: ts.Node, checker: ts.TypeChecker,
): FrontendDiagnostic {
  let expression = ts.isExpression(node) ? node : undefined;
  const property = node.parent;
  if (property && ts.isPropertyAssignment(property) && property.name === node) expression = property.initializer;
  if (!expression) return diagnostic;
  const source = checker.getTypeAtLocation(expression);
  const present = checker.getNonNullableType(source);
  const hasPresentValue = present !== source && !(present.flags & (ts.TypeFlags.Never | ts.TypeFlags.Any | ts.TypeFlags.Unknown));
  const destination = checker.getContextualType(expression);
  const absenceAccess = [2531, 2532, 2533, 18047, 18048, 18049].includes(item.code);
  const assignment = [2322, 2345].includes(item.code);
  const absenceAssignment = assignment && destination
    && !checker.isTypeAssignableTo(source, destination) && checker.isTypeAssignableTo(present, destination);
  const wanted = destination && checker.getNonNullableType(destination);
  const booleanDestination = !!wanted && (wanted.isUnion() ? wanted.types : [wanted])
    .every(type => !!(type.flags & ts.TypeFlags.BooleanLike));
  causes.set(diagnostic, { absence: hasPresentValue && !!(absenceAccess || absenceAssignment), assignment, booleanDestination });
  return diagnostic;
}

export function typeDiagnosticCause(diagnostic: FrontendDiagnostic): Cause | undefined {
  return causes.get(diagnostic);
}
