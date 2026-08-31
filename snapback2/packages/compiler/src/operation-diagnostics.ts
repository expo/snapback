import ts from "typescript";
import { boundedDiagnostics, refuse, type DiagnosticModule } from "./diagnostics";
import type { FrontendDiagnostic } from "./ir";
import { replaceNode } from "./syntax";

type Module = { sourceFile: ts.SourceFile };

export function boundOperationDiagnostics(
  diagnostics: FrontendDiagnostic[],
  operations: Array<{ name: string; call: ts.CallExpression }>,
  module: Module,
): FrontendDiagnostic[] {
  const assigned = new Set<number>();
  const result: FrontendDiagnostic[] = [];
  operations.forEach(({ name, call }) => {
    const selected = diagnostics.filter((item, index) => {
      const match = item.site.match(/:(\d+):(\d+)$/);
      if (!match) return false;
      const position = module.sourceFile.getPositionOfLineAndCharacter(Number(match[1]) - 1, Number(match[2]) - 1);
      if (position < call.getStart(module.sourceFile) || position > call.getEnd()) return false;
      assigned.add(index);
      return true;
    });
    result.push(...boundedDiagnostics(selected, 20, `refusals in operation ${name}`));
  });
  diagnostics.forEach((item, index) => {
    if (!assigned.has(index)) result.push(item);
  });
  return result;
}

export function localConstructorShadow(sourceFile: ts.SourceFile): { name: string; node: ts.Node } | undefined {
  const constructors = new Set(["query", "mutation", "effect", "channel", "table", "schema", "seed", "emit"]);
  for (const statement of sourceFile.statements) {
    if (ts.isFunctionDeclaration(statement) && statement.name && constructors.has(statement.name.text)) {
      return { name: statement.name.text, node: statement };
    }
    if (!ts.isVariableStatement(statement)) continue;
    for (const declaration of statement.declarationList.declarations) {
      if (ts.isIdentifier(declaration.name) && constructors.has(declaration.name.text)) return { name: declaration.name.text, node: declaration };
    }
  }
  return undefined;
}

export function refuseReservedAuthCode(
  module: DiagnosticModule,
  node: ts.Expression | undefined,
  code: string,
): void {
  if (!node || !code.startsWith("E_AUTH_")) return;
  refuse(
    module,
    "E_OP_RESERVED",
    node,
    `application refusal code ${code} uses the reserved E_AUTH_* namespace`,
    replaceNode(module.source, node, '"ACCESS_DENIED"'),
  );
}
