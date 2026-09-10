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
  return { code, family, message, site: `${file}:${line}:${col}`, rule: diagnosticRule(code), rewrite, guide };
}

export function boundedDiagnostics(
  values: FrontendDiagnostic[],
  limit: number,
  scope: string,
): FrontendDiagnostic[] {
  const seen = new Set<string>();
  const unique = values.filter((item) => {
    const key = `${item.code}\0${item.site}\0${item.message}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  }).sort((left, right) => left.site.localeCompare(right.site) || left.code.localeCompare(right.code));
  if (unique.length <= limit) return unique;
  const kept = unique.slice(0, limit - 1);
  const exemplar = unique[limit - 1]!;
  const more = unique.slice(limit - 1).reduce((total, item) => {
    const represented = item.code === "E_DIAG_TRUNCATED" && item.message.match(/^…and (\d+) more/);
    return total + (represented ? Number(represented[1]) : 1);
  }, 0);
  kept.push({
    ...exemplar,
    code: "E_DIAG_TRUNCATED",
    family: "opaque",
    message: `…and ${more} more ${scope}`,
    rule: undefined,
    rewrite: `${exemplar.rewrite}\n// Fix the remaining diagnostics and run snapback2 check again.`,
    guide: "opaque/subset",
  });
  return kept;
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
  if (code.startsWith("E_QUARRY_")) return "quarry";
  if (code.startsWith("E_SCHEMA_") || code === "E_DELIVER_PRINCIPAL") return "schema";
  if (code === "E_DELIVER_UNBOUNDED") return "bound";
  if (code.startsWith("E_RULE_")) return "rule";
  if (code.startsWith("E_SEED_")) return "input";
  if (code.startsWith("E_EFFECT_") || code === "E_EMIT_IN_QUERY") return "effect";
  if (code.startsWith("E_ARGS_") || code === "E_DECIMAL_SCALE") return "args";
  if (code.startsWith("E_OP_")) return "op";
  if (["E_UNBOUND_SCAN", "E_UNBOUND_LOOP", "E_STRUCTURAL_COUNT", "E_STRUCTURAL_FANOUT", "E_BOUND"].includes(code)) {
    return "bound";
  }
  return "opaque";
}

function diagnosticGuide(code: DiagnosticCode): string {
  if (code === "E_QUARRY_TYPE") return "quarry";
  if (code === "E_QUARRY_SYNTAX") return "quarry/grammar";
  if (code === "E_QUARRY_AMBIGUOUS") return "quarry";
  if (code === "E_QUARRY_UNSUPPORTED") return "quarry/refusals";
  if (code === "E_QUARRY_PLACEMENT") return "quarry/projects";
  if (code === "E_QUARRY_RETAIN" || code === "E_QUARRY_TOMBSTONE") return "quarry/grammar";
  if (code === "E_QUARRY_ONLY") return "quarry/projects";
  if (code === "E_QUARRY_UNKNOWN") return "quarry/names";
  if (code === "E_DELIVER_UNBOUNDED" || code === "E_DELIVER_PRINCIPAL") return "offline/deliver";
  if (code === "E_UNBOUND_SCAN") return "quarry";
  if (code === "E_UNBOUND_LOOP") return "bound/loop";
  // @ref LLP 1017.000#31-d1 — the fan-out refusal anchors the which-shape decision.
  if (code === "E_STRUCTURAL_FANOUT") return "fanout";
  if (code === "E_STRUCTURAL_COUNT") return "bound/count";
  if (code === "E_BOUND") return "bound/ceiling";
  if (code === "E_AMBIENT_TIME") return "opaque/time";
  if (code === "E_OP_MODULE_BASENAME") return "programs/module-basename";
  if (code.startsWith("E_SCHEMA_")) return "schema/project";
  if (code.startsWith("E_RULE_")) return "schema/rules";
  if (code.startsWith("E_SEED_")) return "schema/seed";
  if (code.startsWith("E_EFFECT_") || code === "E_EMIT_IN_QUERY") return "effects/authoring";
  if (code.startsWith("E_ARGS_") || code === "E_DECIMAL_SCALE") return "programs/types";
  if (code.startsWith("E_OP_")) return "programs/operations";
  return "opaque/subset";
}

function diagnosticRule(code: DiagnosticCode): string | undefined {
  const rules: Partial<Record<DiagnosticCode, string>> = {
    E_UNBOUND_SCAN: "every scan names take",
    E_UNBOUND_LOOP: "every loop has a static maximum",
    E_STRUCTURAL_FANOUT: "a mutation population loop covers its selected range",
    E_STRUCTURAL_COUNT: "rules do not leak hidden population structure",
    E_AMBIENT_TIME: "programs use now",
    E_OP_MODULE_BASENAME: "module basenames are unique",
    E_BOUND: "the certified ceiling is finite",
    E_EMIT_IN_QUERY: "only mutations emit effects",
  };
  return rules[code];
}
