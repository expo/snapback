import ts from "typescript";
import type { DiagnosticCode, FrontendDiagnostic, Span } from "./ir";

export type DiagnosticModule = {
  sourceFile: ts.SourceFile;
  source: string;
  fileName: string;
};

export class Refusal extends Error {
  constructor(readonly diagnostic: FrontendDiagnostic) {
    super(diagnostic.message);
  }
}

export function diagnostic(
  module: Pick<DiagnosticModule, "sourceFile" | "fileName">,
  code: DiagnosticCode,
  node: ts.Node,
  message: string,
  rewrite: string,
): FrontendDiagnostic {
  const location = span(module, node);
  return {
    code,
    family: diagnosticFamily(code),
    message,
    site: `${location.file}:${location.line}:${location.column}`,
    rule: diagnosticRule(code),
    rewrite,
    guide: diagnosticGuide(code),
  };
}

export function refusal(
  module: DiagnosticModule,
  code: DiagnosticCode,
  node: ts.Node,
  message: string,
  rewrite = module.source,
): FrontendDiagnostic {
  return diagnostic(module, code, node, message, rewrite);
}

export function refuse(
  module: DiagnosticModule,
  code: DiagnosticCode,
  node: ts.Node,
  message: string,
  rewrite = module.source,
): never {
  throw new Refusal(diagnostic(module, code, node, message, rewrite));
}

export function typeDiagnostic(
  code: DiagnosticCode,
  family: FrontendDiagnostic["family"],
  file: string,
  line: number,
  col: number,
  message: string,
  rewrite: string,
  guide: string,
): FrontendDiagnostic {
  return { code, family, message, site: `${file}:${line}:${col}`, rewrite, guide };
}

function span(module: Pick<DiagnosticModule, "sourceFile" | "fileName">, node: ts.Node): Span {
  const start = node.getStart(module.sourceFile);
  const position = module.sourceFile.getLineAndCharacterOfPosition(start);
  return {
    file: module.fileName,
    start,
    end: node.getEnd(),
    line: position.line + 1,
    column: position.character + 1,
  };
}

function diagnosticFamily(code: DiagnosticCode): FrontendDiagnostic["family"] {
  if (code.startsWith("E_SCHEMA_")) return "schema";
  if (code.startsWith("E_RULE_")) return "rule";
  if (code.startsWith("E_SEED_")) return "input";
  if (code.startsWith("E_EFFECT_") || code === "E_EMIT_IN_QUERY") return "effect";
  if (code.startsWith("E_ARGS_") || code === "E_DECIMAL_SCALE" || code === "E_ENUM_VARIANT") return "args";
  if (code.startsWith("E_OP_")) return "op";
  if (["E_UNBOUND_SCAN", "E_UNBOUND_LOOP", "E_UNBOUND_COUNT", "E_STRUCTURAL_COUNT", "E_BOUND"].includes(code)) {
    return "bound";
  }
  return "opaque";
}

function diagnosticGuide(code: DiagnosticCode): string {
  if (code === "E_UNBOUND_SCAN") return "bound/scan";
  if (code === "E_UNBOUND_LOOP") return "bound/loop";
  if (code === "E_UNBOUND_COUNT" || code === "E_STRUCTURAL_COUNT") return "bound/count";
  if (code === "E_BOUND") return "bound/ceiling";
  if (code === "E_AMBIENT_TIME") return "opaque/time";
  if (code.startsWith("E_SCHEMA_")) return "schema/project";
  if (code.startsWith("E_RULE_")) return "schema/rules";
  if (code.startsWith("E_SEED_")) return "schema/seed";
  if (code.startsWith("E_EFFECT_") || code === "E_EMIT_IN_QUERY") return "effects/authoring";
  if (code.startsWith("E_ARGS_") || code === "E_DECIMAL_SCALE" || code === "E_ENUM_VARIANT") return "programs/types";
  if (code.startsWith("E_OP_")) return "programs/operations";
  return "opaque/subset";
}

function diagnosticRule(code: DiagnosticCode): string | undefined {
  const rules: Partial<Record<DiagnosticCode, string>> = {
    E_UNBOUND_SCAN: "every scan names take",
    E_UNBOUND_LOOP: "every loop has a static maximum",
    E_UNBOUND_COUNT: "growing populations do not expose exact counts",
    E_STRUCTURAL_COUNT: "rules do not leak hidden population structure",
    E_AMBIENT_TIME: "programs use ctx.now()",
    E_BOUND: "the certified ceiling is finite",
    E_EMIT_IN_QUERY: "only mutations emit effects",
  };
  return rules[code];
}
