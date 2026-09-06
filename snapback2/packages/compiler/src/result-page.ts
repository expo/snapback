import type { Expr, LoopDomain, Program, Stmt } from "./ir";

// @ref LLP 1011#b1-opaque-cursors — Paging provenance follows a scan or merge
// through bindings and a one-to-one shape, independent of its retyped value.

type Origin = string | undefined;
type NodeStmt = Exclude<Stmt, string>;

function node(statement: Stmt): statement is NodeStmt {
  return typeof statement === "object";
}

function builtinKind(value: string | Record<string, unknown>): [string, any] {
  if (typeof value === "string") return [value, undefined];
  const entry = Object.entries(value)[0];
  return entry ? [entry[0], entry[1]] : ["", undefined];
}

function expressionOrigin(expr: Expr, bindings: Map<string, Origin>): Origin {
  if ("Merge" in expr) return expr.Merge.site;
  if ("Variable" in expr) return bindings.get(expr.Variable);
  if ("Scan" in expr && expr.Scan.opaque_cursor) return expr.Scan.merge_site ?? expr.Scan.site;
  if ("Builtin" in expr) {
    const [kind, data] = builtinKind(expr.Builtin.builtin);
    if (["Slice", "Sort"].includes(kind)) {
      return expr.Builtin.args[0] && expressionOrigin(expr.Builtin.args[0], bindings);
    }
  }
  return undefined;
}

function domainOrigin(domain: LoopDomain, bindings: Map<string, Origin>): Origin {
  if ("Page" in domain && domain.Page.opaque_cursor) return domain.Page.merge_site ?? domain.Page.site;
  if ("DerivedArray" in domain) return expressionOrigin(domain.DerivedArray.value, bindings);
  return undefined;
}

function directPushTargets(body: Stmt[]): string[] {
  return body.flatMap((statement) => node(statement) && "Push" in statement ? [statement.Push.target] : []);
}

/**
 * Tracks one result page through IR bindings and one-to-one shape loops. A
 * branch-local return, nesting, or consumption by an authored loop is not a
 * result-page certificate.
 */
export function resultPageSite(program: Program): string | undefined {
  const bindings = new Map<string, Origin>();
  const returned: Origin[] = [];
  let conditionalReturn = false;

  const containsReturn = (body: Stmt[]): boolean => body.some((statement) => node(statement) && (
    "Return" in statement
    || ("If" in statement && (containsReturn(statement.If.then_body) || containsReturn(statement.If.else_body)))
    || ("For" in statement && containsReturn(statement.For.body))));

  for (const statement of program.body) {
    if (!node(statement)) continue;
    if ("Const" in statement || "Let" in statement || "Assign" in statement) {
      const binding = "Const" in statement ? statement.Const : "Let" in statement ? statement.Let : statement.Assign;
      bindings.set(binding.name, expressionOrigin(binding.value, bindings));
    } else if ("For" in statement) {
      if (containsReturn(statement.For.body)) conditionalReturn = true;
      const origin = domainOrigin(statement.For.domain, bindings);
      const targets = directPushTargets(statement.For.body);
      if (origin && targets.length === 1) bindings.set(targets[0]!, origin);
    } else if ("If" in statement) {
      if (containsReturn(statement.If.then_body) || containsReturn(statement.If.else_body)) {
        conditionalReturn = true;
      }
    } else if ("Return" in statement) {
      returned.push(expressionOrigin(statement.Return, bindings));
    }
  }
  return !conditionalReturn && returned.length === 1 ? returned[0] : undefined;
}

export function attachResultPageSite(program: Program): Program {
  const site = program.kind === "Query" ? resultPageSite(program) : undefined;
  return site ? { ...program, result_page_site: site } : program;
}
