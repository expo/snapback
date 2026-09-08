import { basename } from "node:path";
import type { Provenance } from "../ir";
import { columnAt, derivedPosition, ordinaryColumns } from "../index-components";
import type { Document, Expr, IndexDecl, ProgramDecl, QuarryDiagnostic, ScalarType, ShapeField, Site, Stmt as QuarryStatement, TableCatalog } from "./ast";
import { selectIndex } from "./catalog";
import { decimalScale, opaque, QuarryError, refuse, typeError, unsupported } from "./diagnostics";
import { completionFacts } from "./bound-control";
import { bindBuiltinCall } from "./bound-builtins";
import { BoundFunctionRegistry, BoundProcRegistry, BoundShapeRegistry } from "./bound-declarations";
import { validateCursorIndex, validatePageableMergeIndex } from "./bound-index-validation";
import { siteText, sourceStack, typeName, withoutExpansion } from "./bound-source";
import { assignableBoundValue, binaryOperator, boolType, brandedType, coalescedType, combineOrigins, comparable,
  contextualPair, contextualTarget, contextualValue, decimalPlaces, facts, idFallbackCompatible, isScalar, joinFacts,
  joinType, numericAmount, optionalType, orderedType, projectedField, representationMismatch, requiredType, sameBrand, scalarForIndex,
  scalarType, writeAssignable } from "./bound-values";
import { quarryExpression, quarryWriteWithoutField } from "./print";
import type { BoundArgumentSymbol, BoundExpression, BoundHeldSearch, BoundIndexSymbol, BoundLocalSymbol,
  BoundMergeLane, BoundQuarryProgram, BoundRead, BoundSourceStack, BoundStatement, BoundTableSymbol, BoundType,
  BoundValueFacts, BoundValueSymbol } from "./bound-model";

const MAX_EXPANSION_DEPTH = 8;
const MAX_EXPANDED_NODES = 4096;
const CONTEXT_NAMES = new Set(["viewer", "now", "commit", "new"]);

export * from "./bound-model";
export { assignableBoundValue } from "./bound-values";

/** Bind one operation without routing its data plane through generated TypeScript. */
export function bindQuarryProgram(program: ProgramDecl, catalog: TableCatalog, documents: Document[] = []): BoundQuarryProgram {
  return bindProgram(program, catalog, documents);
}

export type BoundQuarryProgramAttempt = {
  program?: BoundQuarryProgram;
  diagnostics: QuarryDiagnostic[];
};

/** Diagnostic recovery discards an invalid statement and any binding it would
 * have introduced. The partial bound body is never executable project output;
 * it exists only so later independent statements and effect modules can be
 * checked without granting facts from the failed statement. */
export function tryBindQuarryProgram(
  program: ProgramDecl,
  catalog: TableCatalog,
  documents: Document[] = [],
): BoundQuarryProgramAttempt {
  const diagnostics: QuarryDiagnostic[] = [];
  try {
    return { program: bindProgram(program, catalog, documents, diagnostics), diagnostics };
  } catch (error) {
    if (!(error instanceof QuarryError)) throw error;
    diagnostics.push(error.diagnostic);
    return { diagnostics };
  }
}

function bindProgram(
  program: ProgramDecl,
  catalog: TableCatalog,
  documents: Document[],
  diagnostics?: QuarryDiagnostic[],
): BoundQuarryProgram {
  const operationName = `${basename(program.site.file, ".q")}.${program.name}`;
  const args = program.args.map((arg, index): BoundArgumentSymbol => ({
    kind: "argument", id: `${operationName}:argument:${index}`, name: arg.name,
    type: structuredClone(arg.type), origin: "Arg", source: sourceStack(arg.site),
  }));
  let focal: Extract<BoundExpression, { kind: "focal" }> | undefined;
  if (program.focalTable) {
    const info = catalog.get(program.focalTable);
    if (!info) refuse(program.site, `unknown focal table ${program.focalTable}`);
    const table: BoundTableSymbol = { kind: "table", id: `table:${program.focalTable}`, name: program.focalTable,
      declaration: info.declaration, source: sourceStack(info.declaration.site) };
    focal = { kind: "focal", id: `${operationName}:focal`, facts: facts({ kind: "row", table, nullable: false }, "Arg", {
      tableOrigin: table,
    }), source: sourceStack(program.site) };
  }
  const binder = new ExpressionBinder(
    program, catalog, new Map(args.map((arg) => [arg.name, arg])),
    new BoundShapeRegistry(documents), new BoundFunctionRegistry(documents), new BoundProcRegistry(documents),
    { nodes: 0, expansionId: 0, shapeId: 0 }, focal,
    new Map(documents.find((document) => document.file === program.site.file)?.effects
      .map((effect) => [effect.name, `${effect.module}.${effect.name}`] as const) ?? []),
    diagnostics,
  );
  const body = binder.statements(program.body, false);
  const returns = completionFacts(body);
  return {
    name: operationName, kind: program.kind, args, ...(focal ? { focal } : {}), result: joinFacts(returns, program.site),
    body, source: sourceStack(program.site),
  };
}

type ExpansionBudget = { nodes: number; expansionId: number; shapeId: number };

class FailedBoundValue extends Error {}

class ExpressionBinder {
  private focal: Extract<BoundExpression, { kind: "focal" }> | undefined;
  private expansionUse: Site | undefined;
  private namedShapeDepth = 0;
  private helperDepth = 0;
  private shapeFile: string;
  private functionFile: string;
  private readonly expansionFrames: string[] = [];
  private localId = 0;
  private failedBindings = new Set<string>();

  constructor(
    private readonly program: ProgramDecl,
    private readonly catalog: TableCatalog,
    private scope: Map<string, BoundValueSymbol>,
    private readonly shapes: BoundShapeRegistry,
    private readonly functions: BoundFunctionRegistry,
    private readonly procs: BoundProcRegistry,
    private readonly budget: ExpansionBudget,
    initialFocal?: Extract<BoundExpression, { kind: "focal" }>,
    private effects = new Map<string, string>(),
    private readonly diagnostics?: QuarryDiagnostic[],
  ) {
    this.shapeFile = program.site.file;
    this.functionFile = program.site.file;
    this.focal = initialFocal;
  }

  statements(statements: QuarryStatement[], allowOuterShadow = true, completion = true): BoundStatement[] {
    const bound: BoundStatement[] = [];
    const declaredHere = new Set<string>();
    for (const [statementIndex, statement] of statements.entries()) {
      const completes = completion && statementIndex === statements.length - 1;
      const source = this.source(statement.site);
      // @ref LLP 1002#3-the-compiler-worker-and-the-project-json — recovery
      // journals only names this statement can publish; valid binding stays linear.
      const checkpoint = {
        localId: this.localId, nodes: this.budget.nodes, expansionId: this.budget.expansionId,
        shapeId: this.budget.shapeId,
        bindings: statement.kind === "bind" ? statement.names.map((name) => ({
          name, symbol: this.scope.get(name), failed: this.failedBindings.has(name), declared: declaredHere.has(name),
        })) : [],
      };
      try {
      if (statement.kind === "return") {
        bound.push({ kind: "return", value: this.expression(statement.value), source });
      } else if (statement.kind === "bind") {
        if (statement.names.length > 1 && (statement.names.length !== 2 || statement.value.kind !== "call"
          || !["divmod", "sorted"].includes(statement.value.name) || statement.value.args.length !== 2)) {
          const pair = statement.value.kind === "call" && ["divmod", "sorted"].includes(statement.value.name)
            && statement.value.args.length === 2
            ? `(${statement.names.slice(0, 2).join(", ")}) = ${quarryExpression(statement.value)}`
            : "(quotient, remainder) = divmod(dividend, divisor)";
          refuse(this.diagnosticSite(statement.site), "tuple bindings take exactly two names and sorted(a, b) or divmod(a, b)",
            pair, true);
        }
        const value = statement.names.length === 2 && statement.value.kind === "call" && statement.value.name === "sorted"
          ? this.sortedPair(statement.value)
          : this.expression(statement.value);
        if (value.kind === "write" && value.op === "delete") refuse(this.diagnosticSite(statement.site),
          "delete does not yield a value; return a confirmation value after the write");
        const tupleFields = statement.names.length === 1 ? undefined
          : statement.value.kind === "call" && statement.value.name === "sorted"
            ? ["first", "second"] : ["quotient", "remainder"];
        const symbols = statement.names.map((name, index): BoundLocalSymbol => {
          if (declaredHere.has(name) || (!allowOuterShadow && this.scope.has(name))) refuse(this.diagnosticSite(statement.site), `duplicate local ${name}`,
            `rename ${name} so every local in this scope is unique`);
          const symbolFacts = statement.names.length === 1
            ? value.facts
            : tupleFieldFacts(value.facts, tupleFields![index]!, statement.site);
          const symbol: BoundLocalSymbol = {
            kind: "local", id: `${this.program.site.file}:${this.program.name}:local:${this.localId++}`,
            name, facts: symbolFacts, source,
          };
          this.scope.set(name, symbol);
          this.failedBindings.delete(name);
          declaredHere.add(name);
          return symbol;
        });
        bound.push({ kind: "bind", symbols, value, source, ...(tupleFields ? { tupleFields } : {}) });
      } else if (statement.kind === "require") {
        validateRefusalCode(statement.site, statement.code);
        const condition = this.expression(statement.condition);
        requireBool(condition, statement.condition.site);
        bound.push({ kind: "require", condition, code: statement.code, source });
      } else if (statement.kind === "emit") {
        if (this.program.kind === "query") throw new QuarryError(
          this.diagnosticSite(statement.site), "queries cannot emit effects", "E_EMIT_IN_QUERY",
          "change query to mutation before emitting an effect",
        );
        const effect = this.effects.get(statement.effect);
        if (!effect) refuse(this.diagnosticSite(statement.site),
          `unknown effect ${statement.effect}; declare effect ${statement.effect} from <module>`);
        bound.push({ kind: "emit", effect, payload: this.expression(statement.payload), source });
      } else if (statement.kind === "if") {
        const condition = this.expression(statement.condition);
        requireBool(condition, statement.condition.site);
        const prior = this.scope;
        const priorFailed = this.failedBindings;
        let thenBody: BoundStatement[];
        let elseBody: BoundStatement[];
        try {
          this.scope = narrowedScope(condition, prior, true);
          this.failedBindings = new Set(priorFailed);
          thenBody = this.statements(statement.thenBody, true, completes);
          this.scope = narrowedScope(condition, prior, false);
          this.failedBindings = new Set(priorFailed);
          elseBody = this.statements(statement.elseBody, true, completes);
        } finally {
          this.scope = prior;
          this.failedBindings = priorFailed;
        }
        bound.push({ kind: "if", condition, thenBody, elseBody, source });
      } else if (statement.kind === "for") {
        const domain = this.expression(statement.domain);
        const item = loopItemFacts(domain, statement.domain);
        const symbol: BoundLocalSymbol = {
          kind: "local", id: `${this.program.site.file}:${this.program.name}:loop:${this.localId++}`,
          name: statement.name, facts: item, source,
        };
        const prior = this.scope;
        const priorFailed = this.failedBindings;
        let body: BoundStatement[];
        try {
          this.scope = new Map(prior);
          this.failedBindings = new Set(priorFailed);
          this.scope.set(statement.name, symbol);
          this.failedBindings.delete(statement.name);
          body = this.statements(statement.body, true, false);
        } finally {
          this.scope = prior;
          this.failedBindings = priorFailed;
        }
        bound.push({ kind: "for", symbol, domain, body, source });
      } else if (statement.kind === "match") {
        const value = this.expression(statement.read);
        if (value.kind !== "get" || value.facts.type.kind !== "row") typeError(statement.read.site,
          "match requires one point read", "match table[key]: some row: ... none: ...");
        const point = value as BoundExpression & { kind: "get" };
        const symbol: BoundLocalSymbol = {
          kind: "local", id: `${this.program.site.file}:${this.program.name}:match:${this.localId++}`,
          name: statement.someName,
          facts: facts({ ...value.facts.type, nullable: false }, value.facts.origin, {
            tableOrigin: value.facts.type.table, readOrigin: point.read,
          }), source,
        };
        const prior = this.scope;
        const priorFailed = this.failedBindings;
        let someBody: BoundStatement[];
        let noneBody: BoundStatement[];
        try {
          this.scope = new Map(prior);
          this.failedBindings = new Set(priorFailed);
          this.scope.set(statement.someName, symbol);
          this.failedBindings.delete(statement.someName);
          someBody = this.statements(statement.someBody, true, completes);
          this.scope = new Map(prior);
          this.failedBindings = new Set(priorFailed);
          noneBody = this.statements(statement.noneBody, true, completes);
        } finally {
          this.scope = prior;
          this.failedBindings = priorFailed;
        }
        bound.push({ kind: "match", value: point, symbol, someBody, noneBody, source });
      } else if (statement.kind === "expr" && statement.value.kind === "call"
        && this.procs.has(this.functionFile, statement.value.name)) {
        bound.push(this.procCall(statement.value));
      } else if (statement.kind === "expr") {
        const value = this.expression(statement.value);
        if (!completes && value.kind !== "write") refuse(this.diagnosticSite(statement.site),
          "a non-final expression must be a write; bind it if its value is needed");
        bound.push({ kind: "expr", value, completion: completes, source });
      }
      } catch (error) {
        if (!this.diagnostics || (!(error instanceof QuarryError) && !(error instanceof FailedBoundValue))) throw error;
        this.localId = checkpoint.localId;
        this.budget.nodes = checkpoint.nodes;
        this.budget.expansionId = checkpoint.expansionId;
        this.budget.shapeId = checkpoint.shapeId;
        for (const binding of checkpoint.bindings) {
          if (binding.symbol) this.scope.set(binding.name, binding.symbol);
          else this.scope.delete(binding.name);
          if (binding.failed) this.failedBindings.add(binding.name);
          else this.failedBindings.delete(binding.name);
          if (binding.declared) declaredHere.add(binding.name);
          else declaredHere.delete(binding.name);
        }
        if (statement.kind === "bind") for (const name of statement.names) {
          this.scope.delete(name);
          this.failedBindings.add(name);
        }
        if (error instanceof QuarryError) this.diagnostics.push((this.fromExpansion(error) as QuarryError).diagnostic);
      }
    }
    return bound;
  }

  expression(expression: Expr): BoundExpression {
    const source = this.source(expression.site);
    if (expression.kind === "literal") return this.literal(expression);
    if (expression.kind === "name") return this.name(expression.name, expression.site);
    if (expression.kind === "focal") {
      if (!this.focal) refuse(this.diagnosticSite(expression.site), "focal . is valid only inside a row shape");
      return { ...this.focal, source };
    }
    if (expression.kind === "array") {
      let items = expression.items.map((item) => this.expression(item));
      if (items.length === 0) {
        const type: BoundType = { kind: "empty-list", max: 0 };
        return { kind: "array", items, facts: facts(type, "Const", { max: 0 }), source };
      }
      const target = items.map((item) => contextualTarget(item.facts.type))
        .find((type) => type && (brandedType(type) || type.kind === "ref" || type.kind === "id"));
      if (target) items = items.map((item) => contextualValue(item, target, item.source.definition));
      const itemType = items.slice(1).reduce<BoundType>(
        (joined, item) => joinType(joined, item.facts.type, expression.site),
        items[0]?.facts.type ?? ({ kind: "null" } as const),
      );
      const type: ScalarType = { kind: "list", item: scalarType(itemType, expression.site), max: items.length, optional: false };
      return { kind: "array", items, facts: facts(type, combineOrigins(items), {
        max: items.length, ...(items.every((item) => item.facts.wholeUnits) ? { wholeUnits: true } : {}),
      }), source };
    }
    if (expression.kind === "object") {
      const fields = expression.fields.map((field) => ({
        name: field.name,
        value: this.expression(field.value ?? { kind: "name", name: field.name, site: field.site }),
        source: this.source(field.site),
      }));
      const type: BoundType = { kind: "object", fields: new Map(fields.map((field) => [field.name, field.value.facts])), nullable: false };
      return { kind: "object", fields, facts: facts(type, combineOrigins(fields.map((field) => field.value))), source };
    }
    if (expression.kind === "unary") {
      const value = this.expression(expression.value);
      if (expression.op === "not") requireBool(value, expression.value.site);
      else if (!numericAmount(value.facts.type)) typeError(expression.site,
        `unary - requires a present numeric value, got ${typeName(value.facts.type)}`,
        "negate an int, decimal, or money value");
      const type = expression.op === "not" ? boolType() : value.facts.type;
      return { kind: "unary", op: expression.op === "not" ? "Not" : "Neg", value, facts: facts(type, "Computed", {
        ...(expression.op !== "not" && value.facts.wholeUnits ? { wholeUnits: true } : {}),
      }), source };
    }
    if (expression.kind === "binary") return this.binary(expression);
    if (expression.kind === "assert") {
      if (this.helperDepth > 0) unsupported(this.diagnosticSite(expression.site),
        "fn expressions are read-pure and cannot assert authorization",
        "return the optional value and assert it in the calling query or mutation");
      validateRefusalCode(expression.site, expression.code);
      const value = this.expression(expression.value);
      return { kind: "assert", value, code: expression.code,
        facts: facts(requiredType(value.facts.type), value.facts.origin, {
          ...(value.facts.tableOrigin ? { tableOrigin: value.facts.tableOrigin } : {}),
          ...(value.facts.readOrigin ? { readOrigin: value.facts.readOrigin } : {}),
        }), source };
    }
    if (expression.kind === "member") return this.member(expression);
    if (expression.kind === "shape" || expression.kind === "shapeUse") return this.shape(expression);
    if (expression.kind === "call") return this.call(expression);
    if (expression.kind === "read") return this.read(expression);
    if (expression.kind === "merge") return this.merge(expression);
    if (expression.kind === "walk") return this.walk(expression);
    if (expression.kind === "exists") {
      const read = this.boundRead(expression.read, "exists");
      return { kind: "exists", read, facts: facts(boolType(), "Computed", { readOrigin: read }), source };
    }
    if (expression.kind === "aggregate") {
      const readExpression: Extract<Expr, { kind: "read" }> = {
        kind: "read", table: expression.table, keys: expression.keys, site: expression.site,
      };
      const read = this.boundRead(readExpression, "point");
      const value = this.catalog.get(expression.table)?.columns.get("value");
      if (!value) refuse(expression.site, `#${expression.table}[...] requires a maintained target with a value column`);
      const type = { ...value, optional: false } as ScalarType;
      return { kind: "aggregate", read, facts: facts(type, "Computed", { readOrigin: read }), source };
    }
    if (expression.kind === "write") return this.write(expression);
    return refuse(expression.site, "created is valid only in an insert table rule");
  }

  private expressionExpected(expression: Expr, expected: ScalarType): BoundExpression {
    if (expression.kind !== "array" || expected.kind !== "list") {
      return contextualValue(this.expression(expression), expected, this.diagnosticSite(expression.site));
    }
    const items = expression.items.map((item) => this.expressionExpected(item, expected.item));
    const mismatch = items.find((item) => !assignableBoundValue(item.facts.type, expected.item));
    if (mismatch) typeError(this.diagnosticSite(expression.site),
      `list item expects ${typeName(expected.item)}, got ${typeName(mismatch.facts.type)}`,
      `use ${typeName(expected.item)} values in this list`);
    return { kind: "array", items, facts: facts({
      kind: "list", item: structuredClone(expected.item), max: items.length, optional: false,
    }, combineOrigins(items), { max: items.length,
      ...(items.every((item) => item.facts.wholeUnits) ? { wholeUnits: true } : {}) }),
    source: this.source(expression.site) };
  }

  private write(expression: Extract<Expr, { kind: "write" }>): BoundExpression {
    if (this.helperDepth > 0) unsupported(this.diagnosticSite(expression.site),
      "fn expressions are read-pure and cannot write", "move the write into the calling mutation");
    if (this.program.kind === "query") refuse(this.diagnosticSite(expression.site), "queries cannot write", "change query to mutation");
    if (expression.table === "connected") refuse(this.diagnosticSite(expression.site), "connected is read-only", "use exists connected[viewer] or #connected[viewer]");
    const info = this.catalog.get(expression.table);
    if (!info) refuse(this.diagnosticSite(expression.site), `unknown table ${expression.table}`);
    const table: BoundTableSymbol = { kind: "table", id: `table:${expression.table}`, name: expression.table,
      declaration: info.declaration, source: sourceStack(info.declaration.site) };
    let index: BoundIndexSymbol | undefined;
    let key: BoundExpression[] = [];
    let addressedColumns: string[] = [];
    if (expression.op !== "insert") {
      let keyed = expression.keys.map((part) => ({ authored: part.value, bound: this.expression(part.value) }));
      const selected = selectIndex(this.catalog, expression.table, expression.keys, "point", undefined,
        (authored) => scalarForIndex(keyed.find((item) => item.authored === authored)?.bound.facts.type), expression.site);
      index = { kind: "index", id: `${table.id}:index:${selected.name}`, name: selected.name,
        declaration: selected, table, source: sourceStack(selected.site) };
      keyed = keyed.map((item, offset) => {
        const component = selected.components[offset];
        if (!component || !("Column" in component)) return item;
        const expected = component.Column === "id"
          ? { kind: "ref", table: expression.table, optional: false } satisfies ScalarType
          : info.columns.get(component.Column);
        return expected ? { ...item, bound: contextualValue(item.bound, expected, item.authored.site) } : item;
      });
      key = keyed.map((item) => item.bound);
      addressedColumns = ordinaryColumns(selected.components) ?? [];
      this.validateAddressedFields(expression, addressedColumns);
    }
    const focal = expression.op !== "insert" ? {
      kind: "focal" as const, id: `${this.program.site.file}:${this.program.name}:write:${this.budget.shapeId++}`,
      facts: facts({ kind: "row" as const, table, nullable: expression.op === "upsert" }, "Shape", { tableOrigin: table }),
      source: this.source(expression.site),
    } : undefined;
    const prior = this.focal;
    if (focal) this.focal = focal;
    let fields: Extract<BoundExpression, { kind: "write" }>["fields"];
    try {
      const seen = new Set<string>();
      fields = expression.fields.map((field) => {
        if (seen.has(field.name)) typeError(this.diagnosticSite(field.site), `duplicate write field ${field.name}`, `remove the repeated ${field.name} field`);
        seen.add(field.name);
        const expected = field.name === "id"
          ? { kind: "id", optional: false } satisfies ScalarType
          : info.columns.get(field.name);
        if (!expected) typeError(this.diagnosticSite(field.site), `unknown ${expression.table} field ${field.name}`, `use a declared ${expression.table} column`);
        const value = this.expressionExpected(
          field.value ?? { kind: "name", name: field.name, site: field.site }, expected);
        if (!writeAssignable(value.facts.type, expected, field.value)) {
          const message = `${field.name} expects ${typeName(expected)}, got ${typeName(value.facts.type)}`;
          const authored = field.value ?? { kind: "name" as const, name: field.name, site: field.site };
          const present = requiredType(value.facts.type);
          const rewrite = value.facts.presence === "optional" && !expected.optional
            && assignableBoundValue(present, expected)
            ? `set ${field.name} to ${quarryExpression(authored)}! else CODE`
            : expected.kind === "bool" ? `use true or false for ${field.name}`
              : `use a ${typeName(expected)} value for ${field.name}`;
          if (representationMismatch(value.facts.type, expected)) decimalScale(this.diagnosticSite(field.site), message, rewrite);
          typeError(this.diagnosticSite(field.site), message, rewrite);
        }
        return { name: field.name, value, expected,
          ...(value.facts.type.kind === "row" ? { coercion: "row-id" as const } : {}), source: this.source(field.site) };
      });
    } finally {
      this.focal = prior;
    }
    const usesFocal = !!focal && fields.some((field) => boundMentionsFocal(field.value, focal.id));
    if (expression.op === "insert" || expression.op === "upsert") {
      const names = new Set(fields.map((field) => field.name));
      for (const [name, column] of info.columns) if (!column.optional && !names.has(name) && !addressedColumns.includes(name)) {
        typeError(this.diagnosticSite(expression.site), `${expression.op} ${expression.table} is missing required field ${name}`,
          `add ${name} to the ${expression.op} row`);
      }
    }
    const resultType: BoundType = expression.op === "insert"
      ? { kind: "row", table, nullable: false }
      : expression.op === "delete" ? { kind: "null" }
        : { kind: "row", table, nullable: true };
    return { kind: "write", op: expression.op, table, ...(index ? { index } : {}), key, fields,
      ...(focal ? { focal } : {}), usesFocal, addressedColumns, provenance: combineOrigins(key),
      facts: facts(resultType, "Computed", { tableOrigin: table }), source: this.source(expression.site) };
  }

  private validateAddressedFields(expression: Extract<Expr, { kind: "write" }>, columns: string[]): void {
    if (expression.op === "delete") return;
    const authoredId = expression.fields.find((field) => field.name === "id");
    if (authoredId) throw new QuarryError(this.diagnosticSite(authoredId.site), expression.op === "upsert"
      ? "upsert rows may not name id; identity comes from the addressed row or is minted on insert"
      : "update patches may not name id; row identity is immutable", "E_QUARRY_TYPE",
      quarryWriteWithoutField(expression, authoredId), undefined, true);
    for (const [offset, column] of columns.entries()) {
      const field = expression.fields.find((candidate) => candidate.name === column);
      if (!field) continue;
      const value = field.value ?? { kind: "name", name: field.name, site: field.site } satisfies Expr;
      if (expressionText(value) === expressionText(expression.keys[offset]!.value)) continue;
      throw new QuarryError(this.diagnosticSite(field.site),
        `${expression.op} may not reassign addressed key column ${column}`, "E_QUARRY_TYPE",
        quarryWriteWithoutField(expression, field), undefined, true);
    }
  }

  private literal(expression: Extract<Expr, { kind: "literal" }>): BoundExpression {
    let type: BoundType;
    if (expression.value === null) type = { kind: "null" };
    else if (typeof expression.value === "string") type = { kind: "text", max: Math.max(1, [...expression.value].length), optional: false };
    else if (typeof expression.value === "boolean") type = boolType();
    else {
      const fractionalDigits = decimalPlaces(expression.numericText);
      type = fractionalDigits === 0 ? { kind: "int", optional: false } : { kind: "numeric-literal", fractionalDigits };
    }
    return { kind: "literal", value: expression.value, numericText: expression.numericText,
      facts: facts(type, "Const", {
        ...(typeof expression.value === "number" && Number.isInteger(expression.value) ? { wholeUnits: true } : {}),
      }), source: this.source(expression.site) };
  }

  private name(name: string, site: Site): BoundExpression {
    const source = this.source(site);
    if (this.namedShapeDepth > 0) {
      if (!CONTEXT_NAMES.has(name)) throw new QuarryError(
        this.diagnosticSite(site), `named shapes cannot capture operation name ${name}`,
        "E_QUARRY_UNKNOWN", `use .${name} for a focal-row field, or move the argument-dependent field into the caller's shape block`,
      );
      return this.contextName(name, source, site);
    }
    if (this.failedBindings.has(name)) throw new FailedBoundValue(name);
    const argument = this.scope.get(name);
    if (argument) return { kind: "variable", symbol: argument,
      facts: argument.kind === "argument" ? facts(argument.type, argument.origin) : argument.facts, source };
    if (this.helperDepth > 0 && !CONTEXT_NAMES.has(name)) throw new QuarryError(
      this.diagnosticSite(site), `fn expressions cannot capture caller name ${name}`,
      "E_QUARRY_UNKNOWN", `add an explicitly typed ${name} parameter to this fn`,
    );
    if (CONTEXT_NAMES.has(name)) return this.contextName(name, source, site);
    refuse(site, `unknown name ${name}`);
  }

  private contextName(name: string, source: BoundSourceStack, site: Site): BoundExpression {
    if (this.helperDepth > 0 && (name === "commit" || (name === "now" && this.program.kind !== "query"))) {
      throw new QuarryError(
        this.diagnosticSite(site), `fn expressions are read-pure and cannot use mutation ${name} time`,
        "E_QUARRY_UNSUPPORTED", "pass the needed time as an explicit fn argument",
      );
    }
    if (this.helperDepth > 0 && name === "new") throw new QuarryError(
      this.diagnosticSite(site), "new is mutation-only caller state and is not available inside fn expressions",
      "E_QUARRY_UNSUPPORTED", "pass the new value as an explicit fn argument",
    );
    if (name === "viewer") return { kind: "input", input: "Viewer", facts: facts({ kind: "principal", optional: false }, "Viewer"), source };
    if (name === "now") return { kind: "input", input: this.program.kind === "query" ? "ReadTime" : "Now",
      facts: facts({ kind: "time", optional: false }, "Computed"), source };
    if (name === "commit") return { kind: "input", input: "Now", facts: facts({ kind: "time", optional: false }, "Computed"), source };
    if (name === "new") return { kind: "input", input: "NewId", facts: facts({ kind: "id", optional: false }, "Computed"), source };
    refuse(this.diagnosticSite(site), `unknown context name ${name}`);
  }

  private binary(expression: Extract<Expr, { kind: "binary" }>): BoundExpression {
    let left = this.expression(expression.left);
    let right = this.expression(expression.right);
    const op = binaryOperator(expression.op);
    if (!op) unsupported(expression.site, `operator ${expression.op}`, "use a comparison, Boolean operator, +, -, or *");
    if (op === "And" || op === "Or") {
      requireBool(left, expression.left.site);
      requireBool(right, expression.right.site);
      return { kind: "binary", op, left, right, facts: facts(boolType(), "Computed"), source: this.source(expression.site) };
    }
    if (expression.op === "??") {
      if (left.facts.type.kind === "list" && right.kind === "array") {
        right = contextualValue(right, { ...left.facts.type, optional: false }, expression.right.site);
      } else if (right.facts.type.kind === "list" && left.kind === "array") {
        left = contextualValue(left, { ...right.facts.type, optional: false }, expression.left.site);
      }
      [left, right] = contextualPair(left, right, expression.site);
      if ((left.facts.type.kind === "ref" || left.facts.type.kind === "id")
        && !idFallbackCompatible(right.facts.type, left.facts.type)) typeError(expression.right.site,
          `Id fallback requires ${typeName(left.facts.type)}, got ${typeName(right.facts.type)}`,
          "use a non-empty text literal or a reference to the same table");
      return { kind: "binary", op, left, right, facts: facts(coalescedType(left.facts.type, right.facts.type, expression.site), "Computed"),
        source: this.source(expression.site) };
    }
    if (["Eq", "Ne", "Lt", "Lte", "Gt", "Gte"].includes(op)) {
      const nullComparison = left.facts.type.kind === "null" || right.facts.type.kind === "null";
      if (nullComparison && (op === "Eq" || op === "Ne")) {
        return { kind: "binary", op, left, right, facts: facts(boolType(), "Computed"), source: this.source(expression.site) };
      }
      [left, right] = contextualPair(left, right, expression.site);
      if (representationMismatch(left.facts.type, right.facts.type)) decimalScale(expression.site,
        `cannot compare ${typeName(left.facts.type)} with ${typeName(right.facts.type)}`,
        "compare decimal or money values with one scale");
      if (!comparable(left.facts.type, right.facts.type)) typeError(expression.site,
        `cannot compare nominal ${typeName(left.facts.type)} with ${typeName(right.facts.type)}`,
        "compare values with the same nominal type");
      if (!["Eq", "Ne"].includes(op) && !orderedType(left.facts.type)) typeError(expression.site,
        `ordered comparison ${expression.op} does not admit ${typeName(left.facts.type)}`,
        "compare present text, Id, enum, numeric, or time values");
      if (!["Eq", "Ne"].includes(op) && (left.facts.presence === "optional" || right.facts.presence === "optional")) {
        typeError(expression.site, `ordered comparison ${expression.op} requires present operands`, "assert optional operands before comparing them");
      }
      return { kind: "binary", op, left, right, facts: facts(boolType(), "Computed"), source: this.source(expression.site) };
    }
    // A bare integral multiplier is a whole integer, not a value carrying the
    // other operand's decimal or money scale. Add/subtract and comparisons do
    // contextually brand literals; multiplication preserves the distinction.
    if (op !== "Mul") [left, right] = contextualPair(left, right, expression.site);
    const leftType = left.facts.type;
    const rightType = right.facts.type;
    if (leftType.kind === "time" || rightType.kind === "time") {
      const difference = op === "Sub" && leftType.kind === "time" && rightType.kind === "time";
      const offset = (op === "Add" || op === "Sub") && leftType.kind === "time" && rightType.kind === "int"
        || op === "Add" && leftType.kind === "int" && rightType.kind === "time";
      if (left.facts.presence === "optional" || right.facts.presence === "optional" || (!difference && !offset)) typeError(expression.site,
        `time arithmetic does not admit ${typeName(leftType)} ${expression.op} ${typeName(rightType)}`,
        "time - time yields int milliseconds; add or subtract an int offset from time");
      const type: BoundType = { kind: difference ? "int" : "time", optional: false };
      return { kind: "binary", op, left, right, facts: facts(type, "Computed"), source: this.source(expression.site) };
    }
    const leftBrand = brandedType(leftType);
    const rightBrand = brandedType(rightType);
    const brand = leftBrand ?? rightBrand;
    if (brand && (left.facts.presence === "optional" || right.facts.presence === "optional")) typeError(expression.site,
      `${expression.op} requires present numeric operands; got ${typeName(leftType)} and ${typeName(rightType)}`,
      "assert optional operands before arithmetic");
    if (brand && (expression.op === "/" || expression.op === "%")) typeError(expression.site,
      `${typeName(brand)} does not admit ${expression.op}`,
      `use divmod(left, right).${expression.op === "/" ? "quotient" : "remainder"}`);
    if (op === "Div" || op === "Mod") typeError(expression.site,
      `integer ${expression.op} is not an implicit rounding operation`,
      `use divmod(left, right).${op === "Div" ? "quotient" : "remainder"}`);
    if (brand && (op === "Add" || op === "Sub")) {
      if (!leftBrand || !rightBrand || !sameBrand(leftBrand, rightBrand)) {
        const message = `${expression.op} requires matching ${typeName(brand)} values`;
        const rewrite = `use two matching ${typeName(brand)} values`;
        if (representationMismatch(left.facts.type, right.facts.type)) decimalScale(expression.site, message, rewrite);
        typeError(expression.site, message, rewrite);
      }
      return { kind: "binary", op, left, right, facts: facts(leftBrand, "Computed"), source: this.source(expression.site) };
    }
    if (brand && op === "Mul") {
      if (leftBrand && rightBrand) {
        if (leftBrand.kind === "money" && rightBrand.kind === "money") typeError(expression.site,
          "money multiplied by money has no currency-squared value", "multiply money by a decimal rate or int");
        const dropped = leftBrand.kind === "money" ? rightBrand
          : rightBrand.kind === "money" ? leftBrand : rightBrand;
        const result = leftBrand.kind === "money" ? leftBrand
          : rightBrand.kind === "money" ? rightBrand : leftBrand;
        return { kind: "binary", op, left, right, scaleDivisor: 10 ** dropped.scale,
          facts: facts(result, "Computed"), source: this.source(expression.site) };
      }
      const other = leftBrand ? right : left;
      if (other.facts.type.kind !== "int" || other.facts.presence === "optional") typeError(expression.site,
        `${typeName(brand)} multiplication requires an int operand or decimal-typed rate`,
        "use a present int operand or a declared decimal rate");
      return { kind: "binary", op, left, right, facts: facts(brand, "Computed"), source: this.source(expression.site) };
    }
    if (leftType.kind !== "int" || rightType.kind !== "int"
      || left.facts.presence === "optional" || right.facts.presence === "optional") typeError(expression.site,
        `${expression.op} requires present numeric operands; got ${typeName(leftType)} and ${typeName(rightType)}`,
        "use present int, decimal, or money values");
    return { kind: "binary", op, left, right, facts: facts(requiredType(leftType), "Computed", {
      ...(left.facts.wholeUnits && right.facts.wholeUnits ? { wholeUnits: true } : {}),
    }), source: this.source(expression.site) };
  }

  private member(expression: Extract<Expr, { kind: "member" }>): BoundExpression {
    let base = this.expression(expression.base);
    if (base.facts.type.kind === "ref") base = this.shapeBase(base, expression.base, expression.site);
    const source = this.source(expression.site);
    const baseType = base.facts.type;
    if ((baseType.kind === "json" || baseType.kind === "unknown") && expression.name === "length") {
      opaque(expression.site, `cannot prove .length on opaque ${baseType.kind}`,
        "select .length from a declared bounded list");
    }
    if ((baseType.kind === "list" || baseType.kind === "empty-list" || baseType.kind === "page" || baseType.kind === "collection") && expression.name === "length") {
      if (base.facts.presence === "optional") typeError(expression.site,
        "list length requires a present list; its maximum does not prove presence",
        "coalesce the possibly absent list with [] before selecting .length");
      return { kind: "builtin", builtin: "Len", args: [base], facts: facts({ kind: "int", optional: false }, "Computed"), source };
    }
    let type: BoundType | undefined;
    let origin: Provenance = "Computed";
    let wholeUnits: true | undefined;
    if (baseType.kind === "row") {
      const column = expression.name === "id"
        ? { kind: "ref", table: baseType.table.name, optional: false } as ScalarType
        : this.catalog.get(baseType.table.name)?.columns.get(expression.name);
      if (column) type = { ...column, optional: column.optional || baseType.nullable } as ScalarType;
      if (type && base.kind === "variable" && base.symbol.narrowedMembers?.has(expression.name)) type = requiredType(type) as ScalarType;
      origin = "Shape";
    } else if (baseType.kind === "object") {
      const field = baseType.fields.get(expression.name);
      if (field) type = baseType.nullable ? optionalType(field.type) : field.type;
      if (type && base.kind === "variable" && base.symbol.narrowedMembers?.has(expression.name)) type = requiredType(type);
      origin = field?.origin ?? "Computed";
      wholeUnits = field?.wholeUnits;
    } else if (baseType.kind === "json" || baseType.kind === "unknown") {
      type = { kind: "unknown" };
    } else if (baseType.kind === "image" || baseType.kind === "video") {
      const fields = baseType.kind === "image" ? ["width", "height"] : ["width", "height", "duration"];
      if (fields.includes(expression.name)) type = { kind: "int", optional: baseType.optional };
      else typeError(expression.site, `${baseType.kind} asset has no field ${expression.name}`,
        `select ${quarryExpression(expression.base)}.${fields[0]}`);
    }
    if (!type) typeError(expression.site, `cannot select .${expression.name} from ${baseType.kind}`, "select a declared row or object field");
    return { kind: "member", base, name: expression.name, facts: facts(type, origin, {
      ...(wholeUnits ? { wholeUnits } : {}),
    }), source };
  }

  private shape(expression: Extract<Expr, { kind: "shape" | "shapeUse" }>): BoundExpression {
    const base = this.shapeBase(this.expression(expression.base), expression.base, expression.site);
    if (base.facts.type.kind !== "row" && base.facts.type.kind !== "page") {
      typeError(this.diagnosticSite(expression.site), "shapes may focus only a row, reference, or page", "apply the shape to a table read or typed table reference");
    }
    const table = base.facts.type.table;
    const focal: Extract<BoundExpression, { kind: "focal" }> = {
      kind: "focal", id: `${this.program.site.file}:${this.program.name}:shape:${this.budget.shapeId++}`,
      facts: facts({ kind: "row", table, nullable: false }, "Shape", { tableOrigin: table }),
      source: this.source(expression.site),
    };
    const fields = expression.kind === "shapeUse"
      ? this.namedShapeFields(expression.name, expression.site, focal)
      : this.shapeFields(expression.fields, focal, this.shapeFile, this.expansionUse, false);
    const objectType: BoundType = {
      kind: "object", fields: new Map(fields.map((field) => [field.name, field.value.facts])),
      nullable: base.facts.type.kind === "row" && base.facts.type.nullable,
    };
    const type: BoundType = base.facts.type.kind === "page"
      ? { kind: "page", table, item: facts(objectType, "Shape", { tableOrigin: table }), max: base.facts.type.max }
      : objectType;
    return { kind: "shape", base, focal, fields,
      facts: facts(type, "Shape", {
        ...(base.facts.type.kind === "page" ? { max: base.facts.type.max } : {}), tableOrigin: table,
      }), source: this.source(expression.site) };
  }

  private shapeBase(base: BoundExpression, authored: Expr, site: Site): BoundExpression {
    if (base.facts.type.kind !== "ref") return base;
    const tableInfo = this.catalog.get(base.facts.type.table);
    if (!tableInfo) refuse(this.diagnosticSite(site), `unknown table ${base.facts.type.table}`);
    const table: BoundTableSymbol = { kind: "table", id: `table:${base.facts.type.table}`, name: base.facts.type.table,
      declaration: tableInfo.declaration, source: sourceStack(tableInfo.declaration.site) };
    const selected = selectIndex(this.catalog, table.name, [{ value: authored, site: authored.site }], "point", "byId",
      () => base.facts.type.kind === "ref" ? base.facts.type : undefined, site);
    const index: BoundIndexSymbol = { kind: "index", id: `${table.id}:index:${selected.name}`, name: selected.name,
      declaration: selected, table, source: sourceStack(selected.site) };
    const read: BoundRead = { table, index, key: [base], provenance: base.facts.origin, source: this.source(site),
      ...(base.facts.type.optional ? { skipNullKey: true } : {}) };
    return { kind: "get", read,
      facts: facts({ kind: "row", table, nullable: true }, "Shape", { tableOrigin: table, readOrigin: read }),
      source: this.source(site) };
  }

  private namedShapeFields(
    name: string,
    useSite: Site,
    focal: Extract<BoundExpression, { kind: "focal" }>,
  ): Array<{ name: string; value: BoundExpression; source: BoundSourceStack }> {
    const { declaration, document } = this.shapes.resolve(this.shapeFile, name, useSite);
    const identity = `shape:${document.file}:${name}`;
    if (this.expansionFrames.includes(identity)) throw new QuarryError(
      this.diagnosticSite(declaration.site, useSite),
      `shape cycle ${[...this.expansionFrames, identity].join(" -> ")} is not supported; shape ${name} was used at ${siteText(useSite)}`,
      "E_QUARRY_UNSUPPORTED", `remove the recursive ${name} shape use`,
    );
    if (this.expansionFrames.length + 1 > MAX_EXPANSION_DEPTH) throw new QuarryError(
      this.diagnosticSite(declaration.site, useSite),
      `shape expansion exceeds depth ${MAX_EXPANSION_DEPTH}; shape ${name} was used at ${siteText(useSite)}`,
      "E_QUARRY_UNSUPPORTED", `inline or split the projection so it expands through at most ${MAX_EXPANSION_DEPTH} named shapes`,
    );
    this.expansionFrames.push(identity);
    try {
      return this.shapeFields(declaration.fields, focal, document.file, useSite, true);
    } finally {
      this.expansionFrames.pop();
    }
  }

  private shapeFields(
    fields: ShapeField[],
    focal: Extract<BoundExpression, { kind: "focal" }>,
    file: string,
    useSite: Site | undefined,
    named: boolean,
  ): Array<{ name: string; value: BoundExpression; source: BoundSourceStack }> {
    const prior = {
      focal: this.focal, use: this.expansionUse, named: this.namedShapeDepth,
      shapeFile: this.shapeFile, functionFile: this.functionFile,
    };
    this.focal = focal;
    this.expansionUse = useSite;
    this.namedShapeDepth += named ? 1 : 0;
    this.shapeFile = file;
    this.functionFile = file;
    try {
      return fields.flatMap((field) => {
        if (field.kind === "namedSpread") {
          return this.namedShapeFields(field.name, useSite ?? field.site, focal);
        }
        const source = this.source(field.site);
        if (field.kind === "spread") {
          if (focal.facts.type.kind !== "row") return [];
          const members = ["id", ...(this.catalog.get(focal.facts.type.table.name)?.columns.keys() ?? [])];
          return members.map((name) => ({ name, value: projectedField(
            this.focalMember(focal, name, field.site), "inherited-row",
          ), source }));
        }
        if (field.kind === "bare") {
          return [{ name: field.name, value: projectedField(
            this.focalMember(focal, field.name, field.site), "constructed",
          ), source }];
        }
        return [{ name: field.name, value: projectedField(
          this.expression(field.value), "constructed",
        ), source }];
      });
    } catch (error) {
      throw this.fromExpansion(error);
    } finally {
      this.focal = prior.focal;
      this.expansionUse = prior.use;
      this.namedShapeDepth = prior.named;
      this.shapeFile = prior.shapeFile;
      this.functionFile = prior.functionFile;
    }
  }

  private focalMember(focal: Extract<BoundExpression, { kind: "focal" }>, name: string, site: Site): BoundExpression {
    const prior = this.focal;
    this.focal = focal;
    try {
      return this.member({ kind: "member", base: { kind: "focal", site }, name, site });
    } finally {
      this.focal = prior;
    }
  }

  private call(expression: Extract<Expr, { kind: "call" }>): BoundExpression {
    if (this.procs.has(this.functionFile, expression.name)) typeError(this.diagnosticSite(expression.site),
      `proc ${expression.name} is a statement; call it on its own line`, `${expression.name}(${expression.args.map(quarryExpression).join(", ")})`);
    if (this.functions.has(this.functionFile, expression.name)) return this.functionCall(expression);
    if (expression.name === "words") unsupported(expression.site, "words() in direct Quarry", "use an engine-maintained wordPrefixes index");
    const args = expression.args.map((argument) => this.expression(argument));
    const source = this.source(expression.site);
    const builtin = bindBuiltinCall(expression, args, source);
    if (builtin) return builtin;
    unsupported(expression.site, `call ${expression.name}`, "use a direct Quarry pure builtin");
  }

  private walk(expression: Extract<Expr, { kind: "walk" }>): BoundExpression {
    const info = this.catalog.get(expression.table);
    if (!info) refuse(expression.site, `unknown table ${expression.table}`);
    const column = info.columns.get(expression.column);
    if (column?.kind !== "ref" || column.table !== expression.table) refuse(expression.site,
      `walk ${expression.table} up .${expression.column} requires a self-reference column`);
    if (!Number.isSafeInteger(expression.depth) || expression.depth < 0 || expression.depth > 10_000) typeError(expression.site,
      "walk depth must be an integer from 0 through 10000", "use a finite depth no greater than 10000");
    const seed = contextualValue(this.expression(expression.seed),
      { kind: "ref", table: expression.table, optional: false }, expression.seed.site);
    if (!assignableBoundValue(seed.facts.type, { kind: "ref", table: expression.table, optional: false })) typeError(expression.seed.site,
      `walk seed expects ${expression.table}, got ${typeName(seed.facts.type)}`, `pass a ${expression.table} reference`);
    const table: BoundTableSymbol = { kind: "table", id: `table:${expression.table}`, name: expression.table,
      declaration: info.declaration, source: sourceStack(info.declaration.site) };
    const byId = info.indexes.find((candidate) => candidate.name === "byId");
    if (!byId) refuse(expression.site, `table ${expression.table} has no intrinsic byId index`);
    const index: BoundIndexSymbol = { kind: "index", id: `${table.id}:index:byId`, name: "byId",
      declaration: byId, table, source: sourceStack(byId.site) };
    const item = facts({ kind: "row", table, nullable: false }, "Shape", { tableOrigin: table });
    return { kind: "walk", site: siteText(expression.site), table, index, seed, column: expression.column,
      depth: expression.depth, facts: facts({ kind: "collection", item, max: expression.depth + 1 }, "Shape", {
        max: expression.depth + 1, tableOrigin: table,
      }), source: this.source(expression.site) };
  }

  private sortedPair(expression: Extract<Expr, { kind: "call" }>): BoundExpression {
    let [left, right] = expression.args.map((argument) => this.expression(argument)) as [BoundExpression, BoundExpression];
    [left, right] = contextualPair(left, right, expression.site);
    if (representationMismatch(left.facts.type, right.facts.type)) decimalScale(expression.site,
      `sorted operands ${typeName(left.facts.type)} and ${typeName(right.facts.type)} have different representations`,
      "sort values with one decimal or money scale");
    const leftType = left.facts.type;
    const rightType = right.facts.type;
    if (!isScalar(leftType) || !isScalar(rightType)) {
      typeError(expression.site,
        `sorted requires compatible ordered operands, got ${typeName(leftType)} and ${typeName(rightType)}`,
        "sort two present values with the same nominal text, Id, enum, numeric, or time type");
    }
    if (!comparable(leftType, rightType) || !orderedType(leftType)) typeError(expression.site,
      `sorted requires compatible ordered operands, got ${typeName(leftType)} and ${typeName(rightType)}`,
      "sort two present values with the same nominal text, Id, enum, numeric, or time type");
    if (left.facts.presence === "optional" || right.facts.presence === "optional") typeError(expression.site,
      "sorted requires present operands", "assert optional operands before sorting them");
    const source = this.source(expression.site);
    const values = [left, right];
    const identity = `${this.program.site.file}:${this.program.name}:sorted:${this.budget.expansionId++}`;
    const bindings = values.map((value, index) => ({
      symbol: { kind: "argument", id: `${identity}:argument:${index}`, name: index === 0 ? "left" : "right",
        type: structuredClone(index === 0 ? leftType : rightType), origin: value.facts.origin, source: value.source } satisfies BoundArgumentSymbol,
      value,
    }));
    const operands = bindings.map(({ symbol }) => ({
      kind: "variable", symbol, facts: facts(symbol.type, symbol.origin), source: symbol.source,
    }) satisfies BoundExpression);
    const resultType = scalarType(joinType(leftType, rightType, expression.site), expression.site);
    const fields = [
      { name: "first", value: { kind: "builtin", builtin: "Min", args: operands,
        facts: facts(resultType, "Computed"), source } satisfies BoundExpression, source },
      { name: "second", value: { kind: "builtin", builtin: "Max", args: operands,
        facts: facts(resultType, "Computed"), source } satisfies BoundExpression, source },
    ];
    const body = { kind: "object", fields, facts: facts({
      kind: "object", fields: new Map(fields.map((field) => [field.name, field.value.facts])), nullable: false,
    }, "Computed"), source } satisfies BoundExpression;
    return { kind: "invoke", bindings, body, facts: body.facts, source };
  }

  // @ref LLP 1018.005#2-elaboration — a proc call binds its arguments exactly as
  // a fn call does, then binds the body under the caller's program with a
  // parameter-only scope, the proc module's shapes, fns, and effects, no focal,
  // completion off, and no helper depth: the body may do what the caller may.
  private procCall(expression: Extract<Expr, { kind: "call" }>): BoundStatement {
    const { declaration, document } = this.procs.resolve(this.functionFile, expression.name, expression.site);
    if (expression.args.length !== declaration.args.length) typeError(
      this.diagnosticSite(expression.site),
      `proc ${expression.name} expects ${declaration.args.length} arguments, got ${expression.args.length}`,
      `call ${expression.name}(${declaration.args.map((arg) => arg.name).join(", ")})`,
    );
    const returned = firstReturn(declaration.body);
    if (returned) throw new QuarryError(
      this.diagnosticSite(returned, expression.site),
      `proc ${expression.name} cannot return; a proc has no value`, "E_QUARRY_PLACEMENT",
      "return from the caller after the call, or make the helper a fn",
    );
    const actuals = expression.args.map((argument, index) =>
      this.expressionExpected(argument, declaration.args[index]!.type));
    const identity = `proc:${document.file}:${expression.name}`;
    if (this.expansionFrames.includes(identity)) throw new QuarryError(
      this.diagnosticSite(declaration.site, expression.site),
      `proc call cycle ${[...this.expansionFrames, identity].join(" -> ")} is not supported`,
      "E_QUARRY_UNSUPPORTED", `remove the recursive ${expression.name} call`,
    );
    if (this.expansionFrames.length + 1 > MAX_EXPANSION_DEPTH) throw new QuarryError(
      this.diagnosticSite(declaration.site, expression.site),
      `proc expansion exceeds depth ${MAX_EXPANSION_DEPTH}; proc ${expression.name} was used at ${siteText(expression.site)}`,
      "E_QUARRY_UNSUPPORTED", `inline or split the block so it expands through at most ${MAX_EXPANSION_DEPTH} named shapes, fns, and procs`,
    );
    const bindings = declaration.args.map((parameter, index) => {
      const value = contextualValue(actuals[index]!, parameter.type, this.diagnosticSite(expression.args[index]?.site ?? expression.site));
      if (!assignableBoundValue(value.facts.type, parameter.type)) {
        const site = this.diagnosticSite(expression.args[index]?.site ?? expression.site);
        const message = `proc ${expression.name} argument ${parameter.name} expects ${typeName(parameter.type)}, got ${typeName(value.facts.type)}`;
        const rewrite = `pass ${parameter.name}: ${typeName(parameter.type)}`;
        if (representationMismatch(value.facts.type, parameter.type)) decimalScale(site, message, rewrite);
        typeError(site, message, rewrite);
      }
      const symbol: BoundArgumentSymbol = {
        kind: "argument", id: `${identity}:call:${this.budget.expansionId++}:argument:${index}`,
        name: parameter.name, type: structuredClone(parameter.type), origin: value.facts.origin,
        source: sourceStack(parameter.site, this.expansionUse ?? expression.site),
      };
      return { symbol, value, ...(value.facts.type.kind === "row" ? { coercion: "row-id" as const } : {}) };
    });
    const prior = {
      scope: this.scope, failedBindings: this.failedBindings, use: this.expansionUse,
      namedShapeDepth: this.namedShapeDepth, functionFile: this.functionFile, shapeFile: this.shapeFile,
      focal: this.focal, effects: this.effects,
    };
    this.scope = new Map(bindings.map((binding) => [binding.symbol.name, binding.symbol]));
    this.failedBindings = new Set();
    this.expansionUse = this.expansionUse ?? expression.site;
    this.namedShapeDepth = 0;
    this.functionFile = document.file;
    this.shapeFile = document.file;
    this.focal = undefined;
    this.effects = new Map(document.effects.map((effect) => [effect.name, `${effect.module}.${effect.name}`] as const));
    this.expansionFrames.push(identity);
    try {
      const body = this.statements(declaration.body, false, false);
      return { kind: "invoke", bindings, body, source: this.source(expression.site) };
    } catch (error) {
      throw this.fromExpansion(error);
    } finally {
      this.expansionFrames.pop();
      this.scope = prior.scope;
      this.failedBindings = prior.failedBindings;
      this.expansionUse = prior.use;
      this.namedShapeDepth = prior.namedShapeDepth;
      this.functionFile = prior.functionFile;
      this.shapeFile = prior.shapeFile;
      this.focal = prior.focal;
      this.effects = prior.effects;
    }
  }

  private functionCall(expression: Extract<Expr, { kind: "call" }>): BoundExpression {
    const { declaration, document } = this.functions.resolve(this.functionFile, expression.name, expression.site);
    if (expression.args.length !== declaration.args.length) typeError(
      this.diagnosticSite(expression.site),
      `fn ${expression.name} expects ${declaration.args.length} arguments, got ${expression.args.length}`,
      `call ${expression.name}(${declaration.args.map((arg) => arg.name).join(", ")})`,
    );
    const actuals = expression.args.map((argument, index) =>
      this.expressionExpected(argument, declaration.args[index]!.type));
    const identity = `fn:${document.file}:${expression.name}`;
    if (this.expansionFrames.includes(identity)) throw new QuarryError(
      this.diagnosticSite(declaration.site, expression.site),
      `fn call cycle ${[...this.expansionFrames, identity].join(" -> ")} is not supported`,
      "E_QUARRY_UNSUPPORTED", `remove the recursive ${expression.name} call`,
    );
    if (this.expansionFrames.length + 1 > MAX_EXPANSION_DEPTH) throw new QuarryError(
      this.diagnosticSite(declaration.site, expression.site),
      `fn expansion exceeds depth ${MAX_EXPANSION_DEPTH}; fn ${expression.name} was used at ${siteText(expression.site)}`,
      "E_QUARRY_UNSUPPORTED", `inline or split the expression so it expands through at most ${MAX_EXPANSION_DEPTH} named shapes and functions`,
    );
    const bindings = declaration.args.map((parameter, index) => {
      const value = contextualValue(actuals[index]!, parameter.type, this.diagnosticSite(expression.args[index]?.site ?? expression.site));
      if (!assignableBoundValue(value.facts.type, parameter.type)) {
        const site = this.diagnosticSite(expression.args[index]?.site ?? expression.site);
        const message = `fn ${expression.name} argument ${parameter.name} expects ${typeName(parameter.type)}, got ${typeName(value.facts.type)}`;
        const rewrite = `pass ${parameter.name}: ${typeName(parameter.type)}`;
        if (representationMismatch(value.facts.type, parameter.type)) decimalScale(site, message, rewrite);
        typeError(site, message, rewrite);
      }
      const symbol: BoundArgumentSymbol = {
        kind: "argument", id: `${identity}:call:${this.budget.expansionId++}:argument:${index}`,
        name: parameter.name, type: structuredClone(parameter.type), origin: value.facts.origin,
        source: sourceStack(parameter.site, this.expansionUse ?? expression.site),
      };
      return { symbol, value, ...(value.facts.type.kind === "row" ? { coercion: "row-id" as const } : {}) };
    });
    const prior = {
      scope: this.scope, failedBindings: this.failedBindings, use: this.expansionUse, helperDepth: this.helperDepth,
      namedShapeDepth: this.namedShapeDepth, functionFile: this.functionFile, shapeFile: this.shapeFile,
      focal: this.focal,
    };
    this.scope = new Map(bindings.map((binding) => [binding.symbol.name, binding.symbol]));
    this.failedBindings = new Set();
    this.expansionUse = this.expansionUse ?? expression.site;
    this.helperDepth += 1;
    this.namedShapeDepth = 0;
    this.functionFile = document.file;
    this.shapeFile = document.file;
    this.focal = undefined;
    this.expansionFrames.push(identity);
    try {
      const body = this.expression(declaration.body);
      return { kind: "invoke", bindings, body, facts: body.facts, source: this.source(expression.site) };
    } catch (error) {
      throw this.fromExpansion(error);
    } finally {
      this.expansionFrames.pop();
      this.scope = prior.scope;
      this.failedBindings = prior.failedBindings;
      this.expansionUse = prior.use;
      this.helperDepth = prior.helperDepth;
      this.namedShapeDepth = prior.namedShapeDepth;
      this.functionFile = prior.functionFile;
      this.shapeFile = prior.shapeFile;
      this.focal = prior.focal;
    }
  }

  private read(expression: Extract<Expr, { kind: "read" }>): BoundExpression {
    if (expression.table === "connected") refuse(expression.site,
      "connected supports only existence and count reads", "use exists connected[viewer] or #connected[viewer]");
    const read = this.boundRead(expression, expression.range ? "range" : "point");
    if (expression.range) {
      const type: BoundType = { kind: "page", table: read.table, max: expression.range.take };
      return { kind: "scan", read, facts: facts(type, "Shape", { max: expression.range.take, tableOrigin: read.table, readOrigin: read }), source: this.source(expression.site) };
    }
    const type: BoundType = { kind: "row", table: read.table, nullable: true };
    return { kind: "get", read, facts: facts(type, "Shape", { tableOrigin: read.table, readOrigin: read }), source: this.source(expression.site) };
  }

  private merge(expression: Extract<Expr, { kind: "merge" }>): BoundExpression {
    const tableInfo = this.catalog.get(expression.table);
    if (!tableInfo) refuse(expression.site, `unknown table ${expression.table}`);
    const declaration = tableInfo.indexes.find((candidate) => candidate.name === expression.index);
    if (!declaration) refuse(expression.site, `table ${expression.table} has no index ${expression.index}`);
    validatePageableMergeIndex(expression.table, declaration);
    if (expression.lanes.length === 0) typeError(expression.site, "merge requires at least one lane", "add one bounded merge lane");
    const width = expression.lanes[0]!.prefix.length;
    if (width >= declaration.components.length) typeError(expression.lanes[0]!.site,
      `merge lane prefixes must leave at least one ${expression.table}.${declaration.name} suffix column`,
      "drop the last prefix key from every lane");
    const mismatch = expression.lanes.find((lane) => lane.prefix.length !== width);
    if (mismatch) typeError(mismatch.site, "merge lanes must have equal-width index prefixes", `use ${width} prefix key(s) in this lane`);
    const seen = new Set<string>();
    for (const lane of expression.lanes) {
      const identity = lane.prefix.map(expressionText).join("\u0000");
      if (seen.has(identity)) typeError(lane.site, "merge lanes have structurally identical prefixes", "drop this duplicate lane");
      seen.add(identity);
    }
    const after = expression.cursor ? this.expression(expression.cursor) : null;
    if (after && after.facts.type.kind !== "cursor") typeError(expression.cursor!.site,
      `merge after expects cursor, got ${typeName(after.facts.type)}`, "declare c: cursor ? and pass after c");
    const table: BoundTableSymbol = { kind: "table", id: `table:${expression.table}`, name: expression.table,
      declaration: tableInfo.declaration, source: sourceStack(tableInfo.declaration.site) };
    const index: BoundIndexSymbol = { kind: "index", id: `${table.id}:index:${declaration.name}`, name: declaration.name,
      declaration, table, source: sourceStack(declaration.site) };
    const mergeSite = siteText(expression.site);
    const lanes = expression.lanes.map((lane): BoundMergeLane => {
      let sourceRead: BoundRead | undefined;
      let symbol: BoundLocalSymbol | undefined;
      const prior = this.scope;
      const priorFailed = this.failedBindings;
      try {
        if (lane.loop) {
          sourceRead = this.boundRead(lane.loop.domain, "range");
          symbol = { kind: "local", id: `${this.program.site.file}:${this.program.name}:merge:${this.localId++}`,
            name: lane.loop.name, facts: facts({ kind: "row", table: sourceRead.table, nullable: false }, "Shape", {
              tableOrigin: sourceRead.table, readOrigin: sourceRead,
            }), source: this.source(lane.site) };
          this.scope = new Map(prior);
          this.failedBindings = new Set(priorFailed);
          this.scope.set(symbol.name, symbol);
          this.failedBindings.delete(symbol.name);
        }
        const readExpression: Extract<Expr, { kind: "read" }> = {
          kind: "read", table: expression.table,
          keys: lane.prefix.map((value, offset) => ({ value, column: lane.columns?.[offset], site: value.site })),
          index: expression.index,
          range: { order: expression.order, take: expression.take, site: lane.site },
          site: lane.site,
        };
        const prefix = lane.prefix.map((authored, offset) => {
          const value = this.expression(authored);
          const column = columnAt(declaration.components, offset);
          if (!column) return value;
          const expected = column === "id"
            ? { kind: "ref", table: expression.table, optional: false } satisfies ScalarType
            : tableInfo.columns.get(column);
          const contextual = expected ? contextualValue(value, expected, authored.site) : value;
          if (expected && !assignableBoundValue(contextual.facts.type, expected)) typeError(
            this.diagnosticSite(authored.site),
            `merge lane key ${offset + 1} is ${typeName(contextual.facts.type)}; ${expression.table}.${declaration.name}.${column} is ${typeName(expected)}`,
            `use a ${typeName(expected)} value for merge lane key ${offset + 1}`,
          );
          return contextual;
        });
        const scan = this.boundRead(readExpression, "range", prefix);
        scan.range = { ...scan.range!, after, opaqueCursor: after !== null, mergeSite };
        return { ...(sourceRead ? { sourceRead } : {}), ...(symbol ? { symbol } : {}), scan, source: this.source(lane.site) };
      } finally {
        this.scope = prior;
        this.failedBindings = priorFailed;
      }
    });
    const heldSearch = this.heldSearch(expression, declaration, lanes);
    return { kind: "merge", site: mergeSite, table, index, lanes, ...(heldSearch ? { heldSearch } : {}),
      facts: facts({ kind: "page", table, max: expression.take }, "Shape", { max: expression.take, tableOrigin: table }),
      source: this.source(expression.site) };
  }

  private heldSearch(
    expression: Extract<Expr, { kind: "merge" }>,
    index: IndexDecl,
    lanes: BoundMergeLane[],
  ): BoundHeldSearch | undefined {
    if (this.program.kind !== "query" || lanes.length !== 1) return;
    const lane = lanes[0]!;
    if (!lane.sourceRead || !lane.symbol || !lane.scan.range) return;
    const derived = derivedPosition(index.components);
    const termComponent = index.components[derived];
    const term = lane.scan.key[derived];
    if (derived < 1 || !termComponent || !("WordPrefixes" in termComponent) || !term
      || lane.scan.key.length !== derived + 1 || term.facts.type.kind !== "text" || term.facts.type.optional
      || !invariantSearchTerm(term)) return;
    const suffix = ordinaryColumns(index.components.slice(derived + 1));
    if (!suffix?.length) return;
    const scope: BoundHeldSearch["scope"] = [];
    for (let position = 0; position < derived; position++) {
      const value = lane.scan.key[position];
      const column = columnAt(index.components, position);
      if (!value || !column || !boundMemberOf(value, lane.symbol.id)) return;
      scope.push({ column, value });
    }
    const targetRule = lane.scan.table.declaration.rules.find((rule) => rule.effect === "read")?.value;
    if (!targetRule || targetRule.kind !== "exists" || targetRule.read.table !== lane.sourceRead.table.name
      || targetRule.read.keys.length !== scope.length + 1) return;
    const targetFields = targetRule.read.keys.slice(0, scope.length).map((part) => focalField(part.value));
    const targetViewer = targetRule.read.keys.at(-1)?.value;
    if (targetFields.some((field, position) => field !== scope[position]!.column)
      || targetViewer?.kind !== "name" || targetViewer.name !== "viewer") return;
    const authorization = lane.sourceRead.table.declaration.indexes.find((candidate) => candidate.unique
      && JSON.stringify(ordinaryColumns(candidate.components)) === JSON.stringify([
        ...scope.map((item) => boundMemberOf(item.value, lane.symbol!.id)), "principal",
      ]));
    if (!authorization) return;
    const discoveryColumns = ordinaryColumns(lane.sourceRead.index.declaration.components);
    if (!discoveryColumns || discoveryColumns[0] !== "principal" || discoveryColumns[1] !== scope[0]?.column
      || lane.sourceRead.key.length !== 1 || !invariantViewer(lane.sourceRead.key[0]!)) return;
    const discoveryRule = lane.sourceRead.table.declaration.rules.find((rule) => rule.effect === "read")?.value;
    const discoveryViewer = discoveryRule?.kind === "exists" ? discoveryRule.read.keys[1]?.value : undefined;
    if (!discoveryRule || discoveryRule.kind !== "exists" || discoveryRule.read.table !== lane.sourceRead.table.name
      || focalField(discoveryRule.read.keys[0]?.value) !== scope[0]?.column
      || discoveryViewer?.kind !== "name" || discoveryViewer.name !== "viewer") return;
    return { term, termComponent, scope, suffix, authorizationIndex: authorization.name };
  }

  private boundRead(
    expression: Extract<Expr, { kind: "read" }>,
    mode: "point" | "range" | "exists",
    boundKeys?: BoundExpression[],
  ): BoundRead {
    const tableInfo = this.catalog.get(expression.table);
    if (!tableInfo) refuse(expression.site, `unknown table ${expression.table}`);
    const table: BoundTableSymbol = { kind: "table", id: `table:${expression.table}`, name: expression.table,
      declaration: tableInfo.declaration, source: sourceStack(tableInfo.declaration.site) };
    let keyed = expression.keys.map((part, index) => ({
      authored: part.value, bound: boundKeys?.[index] ?? this.expression(part.value),
    }));
    const selected = selectIndex(this.catalog, expression.table, expression.keys, mode, expression.index,
      (authored) => scalarForIndex(keyed.find((item) => item.authored === authored)?.bound.facts.type), expression.site);
    validateCursorIndex(expression.table, selected, expression.keys.length, expression.range?.cursor?.site);
    const index: BoundIndexSymbol = { kind: "index", id: `${table.id}:index:${selected.name}`, name: selected.name,
      declaration: selected, table, source: sourceStack(selected.site) };
    keyed = keyed.map((item, index) => {
      const component = selected.components[index];
      if (!component || !("Column" in component)) return item;
      const expected = component.Column === "id"
        ? { kind: "ref", table: expression.table, optional: false } satisfies ScalarType
        : tableInfo.columns.get(component.Column);
      return expected ? { ...item, bound: contextualValue(item.bound, expected, item.authored.site) } : item;
    });
    const after = expression.range?.cursor ? this.expression(expression.range.cursor) : null;
    if (after && after.facts.type.kind !== "cursor") typeError(expression.range!.cursor!.site,
      `scan after expects a cursor, got ${typeName(after.facts.type)}`, "declare c: cursor ? and pass after c");
    const range = expression.range && { components: selected.components,
      order: expression.range.order === "desc" ? "Desc" as const : "Asc" as const,
      take: expression.range.take, after, opaqueCursor: after !== null };
    return { table, index, key: keyed.map((item) => item.bound), provenance: combineOrigins(keyed.map((item) => item.bound)),
      source: this.source(expression.site), ...(range ? { range } : {}) };
  }

  private source(site: Site): BoundSourceStack {
    if (this.expansionUse) {
      this.budget.nodes += 1;
      if (this.budget.nodes > MAX_EXPANDED_NODES) throw new QuarryError(
        this.diagnosticSite(site),
        `named shapes, fns, and procs expand beyond ${MAX_EXPANDED_NODES} syntax nodes in one operation or declaration`,
        "E_QUARRY_UNSUPPORTED", "reduce the named shape, fn, or proc expansions or split the operation into smaller bounded pieces",
      );
      this.budget.expansionId += 1;
    }
    return sourceStack(site, this.expansionUse);
  }

  private diagnosticSite(site: Site, useSite = this.expansionUse): Site {
    return useSite ? { ...site, expandedFrom: useSite } : site;
  }

  // @ref LLP 1018.005#2-elaboration — a refusal authored inside a shape, fn, or
  // proc body names the use site however it was raised: validation helpers
  // take raw sites, so the frame attaches the trail once on the way out.
  private fromExpansion(error: unknown): unknown {
    if (!(error instanceof QuarryError) || error.diagnostic.expandedFrom || !this.expansionUse) return error;
    const { code, rewrite, guide, executableRewrite, message: _message, expandedFrom: _from, ...site } = error.diagnostic;
    return new QuarryError({ ...site, expandedFrom: this.expansionUse }, error.diagnostic.message, code, rewrite, guide, executableRewrite);
  }
}

/** The site of the first `return` in a block, at any nesting, or undefined. */
export function firstReturn(statements: QuarryStatement[]): Site | undefined {
  for (const statement of statements) {
    if (statement.kind === "return") return statement.site;
    const nested = statement.kind === "if" ? [...statement.thenBody, ...statement.elseBody]
      : statement.kind === "for" ? statement.body
        : statement.kind === "match" ? [...statement.someBody, ...statement.noneBody] : [];
    const found = firstReturn(nested);
    if (found) return found;
  }
  return undefined;
}

function tupleFieldFacts(value: BoundValueFacts, name: string, site: Site): BoundValueFacts {
  if (value.type.kind !== "object") typeError(site, "tuple binding requires an object-valued pair", "use divmod(a, b)");
  const field = value.type.fields.get(name);
  if (!field) typeError(site, `tuple binding result has no ${name} field`, "use (quotient, remainder) = divmod(a, b)");
  return field;
}

function loopItemFacts(domain: BoundExpression, authored: Expr): BoundValueFacts {
  const type = domain.facts.type;
  if (type.kind === "page") return type.item ?? facts({ kind: "row", table: type.table, nullable: false }, domain.facts.origin, {
    tableOrigin: type.table, readOrigin: domain.facts.readOrigin,
  });
  if (type.kind === "collection") return type.item;
  if (type.kind === "list") {
    if (type.optional) throw new QuarryError(authored.site,
      "for cannot iterate an optional list", "E_QUARRY_TYPE", `${quarryExpression(authored)} ?? []`, undefined, true);
    return facts(type.item, domain.facts.origin, { max: type.max, tableOrigin: domain.facts.tableOrigin });
  }
  if (type.kind === "empty-list") return facts({ kind: "unknown" }, domain.facts.origin, { max: 0 });
  if (type.kind === "unknown") throw new QuarryError(authored.site,
    "for cannot prove a static cardinality for an opaque value", "E_UNBOUND_LOOP",
    "iterate a declared capped list or bounded page", "bound/loop");
  typeError(authored.site, `for cannot iterate ${typeName(type)}`, "iterate a bounded page or required capped list");
}

function narrowedScope(
  condition: BoundExpression,
  scope: Map<string, BoundValueSymbol>,
  thenBranch: boolean,
): Map<string, BoundValueSymbol> {
  const narrowed = new Map(scope);
  if (condition.kind !== "binary" || !["Eq", "Ne"].includes(condition.op)) return narrowed;
  const candidate = condition.right.kind === "literal" && condition.right.value === null
    ? condition.left : condition.left.kind === "literal" && condition.left.value === null
      ? condition.right : undefined;
  if (!candidate || (condition.op === "Ne") !== thenBranch) return narrowed;
  const variable = candidate.kind === "variable" ? candidate
    : candidate.kind === "member" && candidate.base.kind === "variable" ? candidate.base : undefined;
  if (!variable) return narrowed;
  const symbol = variable.symbol;
  if (candidate.kind === "member") {
    narrowed.set(symbol.name, { ...symbol,
      narrowedMembers: new Set([...(symbol.narrowedMembers ?? []), candidate.name]) });
    return narrowed;
  }
  if (symbol.kind === "argument") {
    narrowed.set(symbol.name, { ...symbol, type: requiredType(symbol.type) as ScalarType });
  } else {
    narrowed.set(symbol.name, { ...symbol, facts: {
      ...symbol.facts, type: requiredType(symbol.facts.type), presence: "required",
    } });
  }
  return narrowed;
}

function requireBool(value: BoundExpression, site: Site): void {
  if (value.facts.type.kind !== "bool" || value.facts.type.optional) typeError(site,
    `condition requires bool, got ${typeName(value.facts.type)}`, "use a required Boolean comparison");
}

function validateRefusalCode(site: Site, code: string): void {
  if (!code.startsWith("E_AUTH_")) return;
  throw new QuarryError(site, `application refusal code ${code} uses the reserved E_AUTH_* namespace`,
    "E_OP_RESERVED", "ACCESS_DENIED", undefined, true);
}

function boundMentionsFocal(expression: BoundExpression, id: string): boolean {
  if (expression.kind === "focal") return expression.id === id;
  if (expression.kind === "array") return expression.items.some((item) => boundMentionsFocal(item, id));
  if (expression.kind === "object" || expression.kind === "shape") {
    return (expression.kind === "shape" && boundMentionsFocal(expression.base, id))
      || expression.fields.some((field) => boundMentionsFocal(field.value, id));
  }
  if (expression.kind === "unary" || expression.kind === "assert") return boundMentionsFocal(expression.value, id);
  if (expression.kind === "binary") return boundMentionsFocal(expression.left, id) || boundMentionsFocal(expression.right, id);
  if (expression.kind === "member") return boundMentionsFocal(expression.base, id);
  if (expression.kind === "builtin") return expression.args.some((arg) => boundMentionsFocal(arg, id));
  if (expression.kind === "invoke") return expression.bindings.some((binding) => boundMentionsFocal(binding.value, id))
    || boundMentionsFocal(expression.body, id);
  if (expression.kind === "walk") return boundMentionsFocal(expression.seed, id);
  if (expression.kind === "range") return false;
  if (expression.kind === "merge") return expression.lanes.some((lane) =>
    lane.scan.key.some((key) => boundMentionsFocal(key, id))
    || (!!lane.scan.range?.after && boundMentionsFocal(lane.scan.range.after, id))
    || !!lane.sourceRead?.key.some((key) => boundMentionsFocal(key, id)));
  if (["get", "exists", "scan", "aggregate"].includes(expression.kind)) {
    const read = (expression as Extract<BoundExpression, { kind: "get" | "exists" | "scan" | "aggregate" }>).read;
    return read.key.some((key) => boundMentionsFocal(key, id))
      || (!!read.range?.after && boundMentionsFocal(read.range.after, id));
  }
  if (expression.kind === "write") return expression.key.some((key) => boundMentionsFocal(key, id))
    || expression.fields.some((field) => boundMentionsFocal(field.value, id));
  return false;
}
function expressionText(expression: Expr): string {
  const withoutSites = (value: unknown): unknown => {
    if (Array.isArray(value)) return value.map(withoutSites);
    if (!value || typeof value !== "object") return value;
    return Object.fromEntries(Object.entries(value as Record<string, unknown>)
      .filter(([name]) => name !== "site")
      .map(([name, child]) => [name, withoutSites(child)]));
  };
  return JSON.stringify(withoutSites(expression));
}
function invariantSearchTerm(expression: BoundExpression): boolean {
  return expression.kind === "literal" || expression.kind === "input" && expression.input === "Viewer"
    || expression.kind === "variable" && expression.facts.origin === "Arg";
}
function invariantViewer(expression: BoundExpression): boolean {
  return expression.kind === "input" && expression.input === "Viewer"
    || expression.kind === "variable" && expression.facts.origin === "Viewer";
}
function boundMemberOf(expression: BoundExpression, symbolId: string): string | undefined {
  return expression.kind === "member" && expression.base.kind === "variable" && expression.base.symbol.id === symbolId
    ? expression.name : undefined;
}
function focalField(expression: Expr | undefined): string | undefined {
  return expression?.kind === "member" && expression.base.kind === "focal" ? expression.name : undefined;
}
