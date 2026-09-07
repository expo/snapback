import type { Expr, Stmt, LoopDomain } from "../ir";
import { temporary } from "../syntax";
import type { Environment, LoweredValue } from "./environment";
import { runtimeBinding } from "./lexical-binding";

/** The interpreter canonicalizes object fields by Unicode scalar, whereas JS
 * enumerates index keys first and Array.sort compares UTF-16 code units. */
export function objectOrderNeedsCapture(authored: string[]): boolean {
  const scalarOrder = (a: string, b: string): number => {
    const left = Array.from(a), right = Array.from(b);
    for (let i = 0; i < Math.min(left.length, right.length); i++) {
      const difference = left[i]!.codePointAt(0)! - right[i]!.codePointAt(0)!;
      if (difference) return difference;
    }
    return left.length - right.length;
  };
  const keys = Object.keys(Object.fromEntries(authored.map(name => [name, true])));
  return JSON.stringify(authored) !== JSON.stringify(keys)
    || JSON.stringify(authored) !== JSON.stringify([...authored].sort(scalarOrder));
}

/** Evaluation can allocate, read, or refuse even when it has no setup. */
export function observableEvaluation(value: unknown): boolean {
  if (!value || typeof value !== "object") return false;
  if ("Input" in value && value.Input === "NewId") return true;
  if (["Get", "Exists", "Scan", "Merge", "Builtin"].some(key => key in value)) return true;
  if ("Binary" in value && value.Binary && typeof value.Binary === "object"
    && "op" in value.Binary && !["Eq", "Ne"].includes(String(value.Binary.op))) return true;
  if ("Unary" in value && value.Unary && typeof value.Unary === "object"
    && "op" in value.Unary && value.Unary.op === "Neg") return true;
  return Object.values(value).some(observableEvaluation);
}

// @ref LLP 1002#2-the-authored-surface-the-snapback2-module — evaluate earlier operands before a later operand's setup, retaining tuple components for key expansion.
export class OperandOrder {
  readonly statements: Stmt[] = [];
  private pending: Expr[] = [];
  constructor(private readonly env: Environment) {}

  add(lowered: LoweredValue): Expr {
    if (this.conflicts(lowered.statements)) this.flush();
    this.statements.push(...lowered.statements);
    // Each operand owns its expression handles. Flush replaces their leaves in
    // place, including leaves already selected by tuple/spread lowering.
    const value = structuredClone(lowered.expression);
    this.pending.push(value);
    return value;
  }

  /** Keep domains as domains: capture their operands, not a speculative scan
   * or callback execution. Scan options have already retained authored order. */
  addDomain(domain: LoopDomain, statements: Stmt[]): LoopDomain {
    if (this.conflicts(statements)) this.flush();
    this.statements.push(...statements);
    const operand = (value: Expr) => this.add({ statements: [], expression: value });
    if ("DerivedArray" in domain) return { DerivedArray: { ...domain.DerivedArray, value: operand(domain.DerivedArray.value) } };
    if ("Recurse" in domain) return { Recurse: { ...domain.Recurse, seed: operand(domain.Recurse.seed) } };
    if (!("Page" in domain)) return domain;
    const page = domain.Page;
    return { Page: { ...page,
      prefix: page.prefix.map(item => "Scalar" in item ? { Scalar: operand(item.Scalar) }
        : { WordPrefix: { ...item.WordPrefix, source: operand(item.WordPrefix.source) } }),
      after: page.after && operand(page.after), before: page.before && operand(page.before),
      range: page.range && { gt: page.range.gt && operand(page.range.gt), gte: page.range.gte && operand(page.range.gte),
        lt: page.range.lt && operand(page.range.lt), lte: page.range.lte && operand(page.range.lte) },
    } };
  }

  private conflicts(statements: Stmt[]): boolean {
    const reads = new Set<string>();
    const references = (value: unknown): void => {
      if (!value || typeof value !== "object") return;
      if ("Variable" in value && typeof value.Variable === "string") reads.add(value.Variable);
      Object.values(value).forEach(references);
    };
    this.pending.forEach(references);
    const effectful = (value: unknown): boolean => {
      if (!value || typeof value !== "object") return false;
      if (observableEvaluation(value)) return true;
      if (["Require", "Insert", "Update", "Upsert", "Delete", "Emit", "Push"].some(k => k in value)) return true;
      if ("name" in value && typeof value.name === "string" && reads.has(value.name)) return true;
      if ("binding" in value && typeof value.binding === "string" && reads.has(value.binding)) return true;
      return Object.values(value).some(effectful);
    };
    // Pure setup of unrelated temporaries commutes. This retains existing IR
    // when no input, read, refusal or captured register can observe the move.
    return statements.some(effectful);
  }

  flush(): void {
    const visit = (value: Expr): void => {
      if ("Array" in value) { value.Array.forEach(visit); return; }
      if ("Object" in value) { Object.values(value.Object).forEach(visit); return; }
      if ("Literal" in value) return;
      if ("Variable" in value) {
        const info = runtimeBinding(value.Variable, this.env);
        if (info?.identityExpression || value.Variable in this.env.args) return;
      }
      const expression = { ...value };
      const name = temporary(this.env, "operand");
      this.statements.push({ Const: { name, value: expression } });
      this.env.runtimeBindings.set(name, { provenance: "Const", identityExpression: expression,
        identityEnvironment: { ...this.env, variables: new Map(this.env.variables), substitutions: new Map(this.env.substitutions) } });
      for (const key of Object.keys(value)) Reflect.deleteProperty(value, key);
      Object.assign(value, { Variable: name });
    };
    this.pending.forEach(visit);
    this.pending = [];
  }
}
