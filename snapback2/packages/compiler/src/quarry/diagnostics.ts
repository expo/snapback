import type { Expr, QuarryCode, QuarryDiagnostic, Site } from "./ast";

export class QuarryError extends Error {
  readonly diagnostic: QuarryDiagnostic;

  constructor(site: Site, message: string, code: QuarryCode = "E_QUARRY_UNKNOWN", rewrite = message, guide = guideFor(code), executableRewrite = false) {
    const expanded = site.expandedFrom;
    const contextualMessage = expanded
      ? `${message} (from a shape, fn, or proc used at ${expanded.file}:${expanded.line}:${expanded.col})`
      : message;
    super(contextualMessage);
    this.diagnostic = { ...site, code, message: contextualMessage, rewrite, guide, executableRewrite };
  }
}

export function refuse(site: Site, message: string, rewrite?: string, executableRewrite = false): never {
  throw new QuarryError(site, message, "E_QUARRY_UNKNOWN", rewrite ?? message, undefined, executableRewrite);
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

export function decimalScale(site: Site, message: string, rewrite: string): never {
  throw new QuarryError(site, message, "E_DECIMAL_SCALE", rewrite);
}

export function opaque(site: Site, message: string, rewrite: string): never {
  throw new QuarryError(site, message, "E_OPAQUE", rewrite);
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
  if (code === "E_DECIMAL_SCALE") return "programs/types";
  if (code === "E_EMIT_IN_QUERY") return "effects/authoring";
  if (code === "E_OPAQUE") return "programs/refusals";
  if (code === "E_OP_RESERVED") return "programs/refusals";
  if (code === "E_UNBOUND_SCAN") return "quarry";
  if (code === "E_UNBOUND_LOOP") return "bound/loop";
  if (code === "E_QUARRY_SYNTAX") return "quarry/grammar";
  if (code === "E_QUARRY_AMBIGUOUS") return "quarry";
  if (code === "E_QUARRY_UNSUPPORTED") return "quarry/refusals";
  if (code === "E_QUARRY_PLACEMENT") return "quarry/projects";
  if (code === "E_QUARRY_TYPE") return "quarry";
  if (code === "E_QUARRY_RETAIN") return "quarry/grammar";
  if (code === "E_DELIVER_UNBOUNDED" || code === "E_DELIVER_PRINCIPAL") return "deliver";
  return "quarry/names";
}

// @ref LLP 1016#d1--the-system-principal-is-the-stores-owner — removed rule word; no compatibility grant.
export function currentRule(expr: Expr): Expr {
  if (expr.kind === "name" && expr.name === "system") {
    throw new QuarryError(expr.site, "the system principal never consults rules; `deny` is what this meant", "E_QUARRY_UNSUPPORTED", "deny");
  }
  if (expr.kind === "unary") currentRule(expr.value);
  if (expr.kind === "binary") {
    currentRule(expr.left); currentRule(expr.right);
  }
  if (expr.kind === "member") currentRule(expr.base);
  if (expr.kind === "exists" || expr.kind === "created") currentRule(expr.read);
  if (expr.kind === "read") for (const key of expr.keys) currentRule(key.value);
  return expr;
}

// @ref LLP 1002#diagnostics-say-the-fix — one spelling repair across every declared namespace.
export function nameRewrite(name: string, declared: Iterable<string>, fallback?: string | ((suggestion: string | undefined) => string)): string {
  const names = [...new Set(declared)].sort();
  const ranked = names.filter(candidate => Math.abs(candidate.length - name.length) <= 2 || candidate.toLowerCase() === name.toLowerCase()).map(candidate => ({ candidate, distance: nameDistance(name, candidate) }))
    .filter(item => item.distance <= 2 || item.candidate.toLowerCase() === name.toLowerCase())
    .sort((a, b) => Number(b.candidate.toLowerCase() === name.toLowerCase()) - Number(a.candidate.toLowerCase() === name.toLowerCase())
      || a.distance - b.distance || a.candidate.localeCompare(b.candidate));
  const suggestion = ranked[0]?.candidate;
  const repair = typeof fallback === "function" ? fallback(suggestion) : fallback;
  const namesText = suggestion ? `did you mean \`${suggestion}\`?`
    : `declared names: ${names.length ? names.join(", ") : "none"}`;
  return repair ? `${namesText}; ${repair}` : namesText;
}

// Unrestricted Damerau–Levenshtein, including adjacent transpositions.
function nameDistance(left: string, right: string): number {
  const a = [...left], b = [...right], max = a.length + b.length;
  const d = Array.from({ length: a.length + 2 }, () => Array<number>(b.length + 2).fill(0));
  d[0]![0] = max;
  for (let i = 0; i <= a.length; i++) { d[i + 1]![0] = max; d[i + 1]![1] = i; }
  for (let j = 0; j <= b.length; j++) { d[0]![j + 1] = max; d[1]![j + 1] = j; }
  const last = new Map<string, number>();
  for (let i = 1; i <= a.length; i++) {
    let match = 0;
    for (let j = 1; j <= b.length; j++) {
      const row = last.get(b[j - 1]!) ?? 0, col = match;
      const cost = Number(a[i - 1] !== b[j - 1]);
      if (cost === 0) match = j;
      d[i + 1]![j + 1] = Math.min(d[i]![j]! + cost, d[i + 1]![j]! + 1, d[i]![j + 1]! + 1,
        d[row]![col]! + i - row - 1 + 1 + j - col - 1);
    }
    last.set(a[i - 1]!, i);
  }
  return d[a.length + 1]![b.length + 1]!;
}
