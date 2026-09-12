import type { Document, ProgramDecl, ScalarType, TableCatalog } from "./ast";
import { assignableBoundValue, bindQuarryProgram, type BoundExpression } from "./bound";

/** Validate the pure schedule binding through the same typed elaborator used
 * for its executable IR, then compare each produced target argument. */
export function validateScheduleExpressions(
  program: ProgramDecl,
  catalog: TableCatalog,
  documents: Document[],
  expected: ScalarType[],
): void {
  const bound = bindQuarryProgram(program, catalog, documents);
  const returned = bound.body.find((statement) => statement.kind === "return");
  const result = returned?.kind === "return" ? returned.value : undefined;
  if (!result || result.kind !== "object") throw new Error("schedule binding must return enabled and args");
  const enabled = field(result, "enabled");
  if (enabled.facts.type.kind !== "bool" || enabled.facts.presence !== "required") {
    throw new Error("schedule if requires a present bool");
  }
  const args = field(result, "args");
  if (args.kind !== "object" || args.fields.length !== expected.length) {
    throw new Error("schedule binding argument count does not match its target");
  }
  args.fields.forEach((argument, index) => {
    if (!assignableBoundValue(argument.value.facts.type, expected[index]!)) {
      throw new Error(`schedule argument ${index + 1} does not satisfy target ${expected[index]!.kind}`);
    }
  });
}

function field(expression: Extract<BoundExpression, { kind: "object" }>, name: string): BoundExpression {
  const value = expression.fields.find((candidate) => candidate.name === name)?.value;
  if (!value) throw new Error(`schedule binding has no ${name} field`);
  return value;
}
