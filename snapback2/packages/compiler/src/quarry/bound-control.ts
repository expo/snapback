import type { BoundStatement, BoundValueFacts } from "./bound-model";

export function completionFacts(statements: BoundStatement[]): BoundValueFacts[] {
  const returns: BoundValueFacts[] = [];
  let fallsThrough = true;
  for (const statement of statements) {
    if (!fallsThrough) break;
    if (statement.kind === "return") {
      returns.push(statement.value.facts);
      fallsThrough = false;
    } else if (statement.kind === "expr" && statement.completion) {
      returns.push(statement.value.facts);
      fallsThrough = false;
    } else if (statement.kind === "if") {
      const thenCompletion = completionFacts(statement.thenBody);
      const elseCompletion = completionFacts(statement.elseBody);
      const thenFalls = statementsFallThrough(statement.thenBody);
      const elseFalls = statementsFallThrough(statement.elseBody);
      returns.push(...thenCompletion.slice(0, thenFalls ? -1 : undefined));
      returns.push(...elseCompletion.slice(0, elseFalls ? -1 : undefined));
      fallsThrough = thenFalls || elseFalls;
    } else if (statement.kind === "for") {
      const bodyCompletion = completionFacts(statement.body);
      const bodyFalls = statementsFallThrough(statement.body);
      returns.push(...bodyCompletion.slice(0, bodyFalls ? -1 : undefined));
    } else if (statement.kind === "match") {
      const someCompletion = completionFacts(statement.someBody);
      const noneCompletion = completionFacts(statement.noneBody);
      const someFalls = statementsFallThrough(statement.someBody);
      const noneFalls = statementsFallThrough(statement.noneBody);
      returns.push(...someCompletion.slice(0, someFalls ? -1 : undefined));
      returns.push(...noneCompletion.slice(0, noneFalls ? -1 : undefined));
      fallsThrough = someFalls || noneFalls;
    }
  }
  if (fallsThrough) returns.push({ type: { kind: "null" }, presence: "optional", origin: "Const" });
  return returns;
}

export function statementsFallThrough(statements: BoundStatement[]): boolean {
  for (const statement of statements) {
    if (statement.kind === "return") return false;
    if (statement.kind === "expr" && statement.completion) return false;
    if (statement.kind === "if"
      && !statementsFallThrough(statement.thenBody) && !statementsFallThrough(statement.elseBody)) return false;
    if (statement.kind === "match"
      && !statementsFallThrough(statement.someBody) && !statementsFallThrough(statement.noneBody)) return false;
  }
  return true;
}
