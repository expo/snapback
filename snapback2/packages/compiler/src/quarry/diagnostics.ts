import type { Expr, QuarryCode, QuarryDiagnostic, Site } from "./ast";

export class QuarryError extends Error {
  readonly diagnostic: QuarryDiagnostic;

  constructor(site: Site, message: string, code: QuarryCode = "E_QUARRY_UNKNOWN", rewrite = "fix the named Quarry declaration", guide = guideFor(code)) {
    const expanded = site.expandedFrom;
    const contextualMessage = expanded
      ? `${message} (from a named shape used at ${expanded.file}:${expanded.line}:${expanded.col})`
      : message;
    super(contextualMessage);
    this.diagnostic = { ...site, code, message: contextualMessage, rewrite, guide };
  }
}

export function refuse(site: Site, message: string, rewrite?: string): never {
  throw new QuarryError(site, message, "E_QUARRY_UNKNOWN", rewrite ?? "fix the named Quarry declaration");
}

export function syntax(site: Site, message: string, rewrite = "fix this Quarry declaration and rerun snapback2 check"): never {
  throw new QuarryError(site, message, "E_QUARRY_SYNTAX", rewrite);
}

export function unsupported(site: Site, construct: string, alternative: string): never {
  throw new QuarryError(
    site,
    `${construct} is not part of the Snapback 2 platform`,
    "E_QUARRY_UNSUPPORTED",
    alternative,
  );
}

export function ambiguous(site: Site, message: string, rewrite: string): never {
  throw new QuarryError(site, message, "E_QUARRY_AMBIGUOUS", rewrite);
}

export function placement(site: Site, message: string, rewrite: string): never {
  throw new QuarryError(site, message, "E_QUARRY_PLACEMENT", rewrite);
}

export function typeError(site: Site, message: string, rewrite: string): never {
  throw new QuarryError(site, message, "E_QUARRY_TYPE", rewrite);
}

export function retention(site: Site, message: string): never {
  throw new QuarryError(
    site,
    message,
    "E_QUARRY_RETAIN",
    "retain until-revoked  -- alternatively: retain delivered-history",
  );
}

export function formatDiagnostic(item: QuarryDiagnostic): string {
  return `${item.file}:${item.line}:${item.col} — ${item.message}`;
}

function guideFor(code: QuarryCode): string {
  if (code === "E_QUARRY_SYNTAX") return "quarry/grammar";
  if (code === "E_QUARRY_AMBIGUOUS") return "quarry/indexes";
  if (code === "E_QUARRY_UNSUPPORTED") return "quarry/refusals";
  if (code === "E_QUARRY_PLACEMENT") return "quarry/projects";
  if (code === "E_QUARRY_TYPE") return "quarry/types";
  if (code === "E_QUARRY_RETAIN") return "quarry/grammar";
  return "quarry/names";
}

// @ref LLP 1016#d1--the-system-principal-is-the-stores-owner — removed rule word; no compatibility grant.
export function currentRule(expr: Expr): Expr {
  if (expr.kind === "name" && expr.name === "system") {
    throw new QuarryError(expr.site, "the system principal never consults rules; `deny` is what this meant", "E_QUARRY_UNSUPPORTED", "deny");
  }
  if (expr.kind === "unary") currentRule(expr.value);
  if (expr.kind === "binary" && (expr.op === "and" || expr.op === "or")) {
    currentRule(expr.left); currentRule(expr.right);
  }
  return expr;
}
