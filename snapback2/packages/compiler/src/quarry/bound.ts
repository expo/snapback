import { basename, dirname, join } from "node:path";
import type { IndexComponent, Provenance } from "../ir";
import { columnAt, derivedPosition, ordinaryColumns } from "../index-components";
import type { Document, Expr, FunctionDecl, IndexDecl, ProgramDecl, ScalarType, ShapeDecl, ShapeField, Site, Stmt as QuarryStatement, TableCatalog, TableDecl } from "./ast";
import { selectIndex } from "./catalog";
import { QuarryError, refuse, typeError, unsupported } from "./diagnostics";

const MAX_EXPANSION_DEPTH = 8;
const MAX_EXPANDED_NODES = 4096;
const CONTEXT_NAMES = new Set(["viewer", "now", "commit", "new"]);

export type BoundSourceStack = { definition: Site; use?: Site };
export type BoundPresence = "required" | "optional";

export type BoundTableSymbol = {
  kind: "table"; id: string; name: string; declaration: TableDecl; source: BoundSourceStack;
};
export type BoundIndexSymbol = {
  kind: "index"; id: string; name: string; declaration: IndexDecl; table: BoundTableSymbol; source: BoundSourceStack;
};
export type BoundArgumentSymbol = {
  kind: "argument"; id: string; name: string; type: ScalarType; origin: Provenance; source: BoundSourceStack;
  narrowedMembers?: ReadonlySet<string>;
};
export type BoundLocalSymbol = {
  kind: "local"; id: string; name: string; facts: BoundValueFacts; source: BoundSourceStack;
  narrowedMembers?: ReadonlySet<string>;
};
export type BoundValueSymbol = BoundArgumentSymbol | BoundLocalSymbol;

export type BoundType =
  | ScalarType
  | { kind: "unknown" }
  | { kind: "null" }
  | { kind: "empty-list"; max: 0 }
  | { kind: "row"; table: BoundTableSymbol; nullable: boolean }
  | { kind: "page"; table: BoundTableSymbol; max: number; item?: BoundValueFacts }
  | { kind: "collection"; item: BoundValueFacts; max: number }
  | { kind: "object"; fields: ReadonlyMap<string, BoundValueFacts>; nullable: boolean }
  | { kind: "numeric-literal"; fractionalDigits: number };

export type BoundValueFacts = {
  type: BoundType;
  presence: BoundPresence;
  max?: number;
  origin: Provenance;
  fieldProjection?: "inherited-row" | "constructed";
  tableOrigin?: BoundTableSymbol;
  readOrigin?: BoundRead;
};

type BoundExpressionBase = { facts: BoundValueFacts; source: BoundSourceStack };
export type BoundExpression = BoundExpressionBase & (
  | { kind: "literal"; value: string | number | boolean | null; numericText?: string; wireValue?: number; wireKind?: "id" }
  | { kind: "variable"; symbol: BoundValueSymbol }
  | { kind: "focal"; id: string }
  | { kind: "input"; input: "Viewer" | "Now" | "NewId" | "ReadTime" }
  | { kind: "array"; items: BoundExpression[] }
  | { kind: "object"; fields: Array<{ name: string; value: BoundExpression; source: BoundSourceStack }> }
  | { kind: "unary"; op: "Not" | "Neg"; value: BoundExpression }
  | { kind: "binary"; op: string; left: BoundExpression; right: BoundExpression; scaleDivisor?: number }
  | { kind: "assert"; value: BoundExpression; code: string }
  | { kind: "member"; base: BoundExpression; name: string }
  | { kind: "shape"; base: BoundExpression; focal: Extract<BoundExpression, { kind: "focal" }>;
      fields: Array<{ name: string; value: BoundExpression; source: BoundSourceStack }> }
  | { kind: "builtin"; builtin: string | Record<string, unknown>; args: BoundExpression[] }
  | { kind: "invoke"; bindings: Array<{
      symbol: BoundArgumentSymbol;
      value: BoundExpression;
      coercion?: "row-id";
    }>; body: BoundExpression }
  | { kind: "range"; start: number; end: number; max: number }
  | { kind: "walk"; site: string; table: BoundTableSymbol; index: BoundIndexSymbol;
      seed: BoundExpression; column: string; depth: number }
  | { kind: "merge"; site: string; table: BoundTableSymbol; index: BoundIndexSymbol;
      lanes: BoundMergeLane[]; heldSearch?: BoundHeldSearch }
  | { kind: "write"; op: "insert" | "update" | "upsert" | "delete";
      table: BoundTableSymbol; index?: BoundIndexSymbol; key: BoundExpression[];
      fields: Array<{ name: string; value: BoundExpression; expected: ScalarType; coercion?: "row-id"; source: BoundSourceStack }>;
      focal?: Extract<BoundExpression, { kind: "focal" }>; usesFocal: boolean; addressedColumns: string[]; provenance: Provenance }
  | { kind: "get" | "exists" | "scan" | "aggregate"; read: BoundRead }
);

export type BoundRead = {
  table: BoundTableSymbol;
  index: BoundIndexSymbol;
  key: BoundExpression[];
  provenance: Provenance;
  source: BoundSourceStack;
  skipNullKey?: boolean;
  range?: {
    components: IndexComponent[];
    order: "Asc" | "Desc";
    take: number;
    after: BoundExpression | null;
    opaqueCursor: boolean;
    mergeSite?: string;
  };
};

export type BoundMergeLane = {
  sourceRead?: BoundRead;
  symbol?: BoundLocalSymbol;
  scan: BoundRead;
  source: BoundSourceStack;
};

export type BoundHeldSearch = {
  term: BoundExpression;
  termComponent: Extract<IndexComponent, { WordPrefixes: unknown }>;
  scope: Array<{ column: string; value: BoundExpression }>;
  suffix: string[];
  authorizationIndex: string;
};

export type BoundStatement =
  | { kind: "return"; value: BoundExpression; source: BoundSourceStack }
  | { kind: "expr"; value: BoundExpression; completion: boolean; source: BoundSourceStack }
  | { kind: "bind"; symbols: BoundLocalSymbol[]; tupleFields?: string[]; value: BoundExpression; source: BoundSourceStack }
  | { kind: "require"; condition: BoundExpression; code: string; source: BoundSourceStack }
  | { kind: "emit"; effect: string; payload: BoundExpression; source: BoundSourceStack }
  | { kind: "if"; condition: BoundExpression; thenBody: BoundStatement[]; elseBody: BoundStatement[]; source: BoundSourceStack }
  | { kind: "for"; symbol: BoundLocalSymbol; domain: BoundExpression; body: BoundStatement[]; source: BoundSourceStack }
  | { kind: "match"; value: BoundExpression & { kind: "get" }; symbol: BoundLocalSymbol;
      someBody: BoundStatement[]; noneBody: BoundStatement[]; source: BoundSourceStack };
export type BoundQuarryProgram = {
  name: string;
  kind: ProgramDecl["kind"];
  args: BoundArgumentSymbol[];
  focal?: Extract<BoundExpression, { kind: "focal" }>;
  result: BoundValueFacts;
  body: BoundStatement[];
  source: BoundSourceStack;
};

/** Bind one operation without routing its data plane through generated TypeScript. */
export function bindQuarryProgram(program: ProgramDecl, catalog: TableCatalog, documents: Document[] = []): BoundQuarryProgram {
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
    new BoundShapeRegistry(documents), new BoundFunctionRegistry(documents),
    { nodes: 0, expansionId: 0, shapeId: 0 }, focal,
    new Map(documents.find((document) => document.file === program.site.file)?.effects
      .map((effect) => [effect.name, `${effect.module}.${effect.name}`] as const) ?? []),
  );
  const body = binder.statements(program.body, false);
  const returns = completionFacts(body);
  return {
    name: operationName, kind: program.kind, args, ...(focal ? { focal } : {}), result: joinFacts(returns, program.site),
    body, source: sourceStack(program.site),
  };
}

type ExpansionBudget = { nodes: number; expansionId: number; shapeId: number };
type ShapeDefinition = { declaration: ShapeDecl; document: Document };

class BoundShapeRegistry {
  private readonly modules: Map<string, Document>;
  private readonly members = new Map<Document, Map<string, ShapeDecl | Document["shapeImports"][number]>>();

  constructor(documents: Document[]) {
    this.modules = new Map(documents.map((document) => [document.file, document]));
    for (const document of documents) {
      const names = new Map<string, ShapeDecl | Document["shapeImports"][number]>();
      for (const declaration of [...document.shapes, ...document.shapeImports]) {
        const prior = names.get(declaration.name);
        if (prior) throw new QuarryError(
          declaration.site,
          `duplicate shape ${declaration.name}; first declared at ${siteText(prior.site)}`,
          "E_QUARRY_UNKNOWN", `remove the duplicate shape ${declaration.name} declaration or import`,
        );
        names.set(declaration.name, declaration);
      }
      this.members.set(document, names);
    }
  }

  resolve(file: string, name: string, useSite: Site, imports: string[] = []): ShapeDefinition {
    const document = this.modules.get(file);
    const member = document && this.members.get(document)?.get(name);
    if (!document || !member) throw new QuarryError(
      useSite, `unknown shape ${name} in ${file}`, "E_QUARRY_UNKNOWN",
      `define shape ${name} = { * } in ${file}, or import shape ${name} from its module`,
    );
    if (!("module" in member)) return { declaration: member, document };
    const identity = `shape:${document.file}:${name}`;
    if (imports.includes(identity)) throw new QuarryError(
      member.site, `shape import cycle ${[...imports, identity].join(" -> ")}`, "E_QUARRY_UNSUPPORTED",
      `replace one import of ${name} with shape ${name} = { * } and fill in its fields`,
    );
    const target = this.modules.get(join(dirname(document.file), `${member.module}.q`));
    if (!target) throw new QuarryError(
      member.site, `unknown shape module ${member.module}`, "E_QUARRY_UNKNOWN",
      `create snapback/${member.module}.q with shape ${name} = { * }, or correct the module name`,
    );
    return this.resolve(target.file, name, member.site, [...imports, identity]);
  }
}

type FunctionDefinition = { declaration: FunctionDecl; document: Document };

class BoundFunctionRegistry {
  private readonly modules: Map<string, Document>;
  private readonly members = new Map<Document, Map<string, FunctionDecl | Document["functionImports"][number]>>();

  constructor(documents: Document[]) {
    this.modules = new Map(documents.map((document) => [document.file, document]));
    for (const document of documents) {
      const names = new Map<string, FunctionDecl | Document["functionImports"][number]>();
      for (const declaration of [...document.functions, ...document.functionImports]) {
        const prior = names.get(declaration.name);
        if (prior) throw new QuarryError(
          declaration.site,
          `duplicate fn ${declaration.name}; first declared at ${siteText(prior.site)}`,
          "E_QUARRY_UNKNOWN", `remove the duplicate fn ${declaration.name} declaration or import`,
        );
        names.set(declaration.name, declaration);
      }
      this.members.set(document, names);
    }
  }

  has(file: string, name: string): boolean {
    const document = this.modules.get(file);
    return !!document && this.members.get(document)?.has(name) === true;
  }

  resolve(file: string, name: string, useSite: Site, imports: string[] = []): FunctionDefinition {
    const document = this.modules.get(file);
    const member = document && this.members.get(document)?.get(name);
    if (!document || !member) throw new QuarryError(
      useSite, `unknown fn ${name} in ${file}`, "E_QUARRY_UNKNOWN",
      `define fn ${name}(value: int) = value in ${file}, or import fn ${name} from its module`,
    );
    if (!("module" in member)) return { declaration: member, document };
    const identity = `fn:${document.file}:${name}`;
    if (imports.includes(identity)) throw new QuarryError(
      member.site, `fn import cycle ${[...imports, identity].join(" -> ")}`, "E_QUARRY_UNSUPPORTED",
      `replace one import of ${name} with a local expression-only fn declaration`,
    );
    const target = this.modules.get(join(dirname(document.file), `${member.module}.q`));
    if (!target) throw new QuarryError(
      member.site, `unknown fn module ${member.module}`, "E_QUARRY_UNKNOWN",
      `create snapback/${member.module}.q with fn ${name}(value: int) = value, or correct the module name`,
    );
    return this.resolve(target.file, name, member.site, [...imports, identity]);
  }
}

class ExpressionBinder {
  private focal: Extract<BoundExpression, { kind: "focal" }> | undefined;
  private expansionUse: Site | undefined;
  private namedShapeDepth = 0;
  private helperDepth = 0;
  private shapeFile: string;
  private functionFile: string;
  private readonly expansionFrames: string[] = [];
  private localId = 0;

  constructor(
    private readonly program: ProgramDecl,
    private readonly catalog: TableCatalog,
    private scope: Map<string, BoundValueSymbol>,
    private readonly shapes: BoundShapeRegistry,
    private readonly functions: BoundFunctionRegistry,
    private readonly budget: ExpansionBudget,
    initialFocal?: Extract<BoundExpression, { kind: "focal" }>,
    private readonly effects = new Map<string, string>(),
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
      if (statement.kind === "return") {
        bound.push({ kind: "return", value: this.expression(statement.value), source });
      } else if (statement.kind === "bind") {
        if (statement.names.length > 1 && (statement.names.length !== 2 || statement.value.kind !== "call"
          || !["divmod", "sorted"].includes(statement.value.name) || statement.value.args.length !== 2)) {
          refuse(this.diagnosticSite(statement.site), "tuple bindings take exactly two names and sorted(a, b) or divmod(a, b)",
            "(quotient, remainder) = divmod(dividend, divisor)");
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
          declaredHere.add(name);
          return symbol;
        });
        bound.push({ kind: "bind", symbols, value, source, ...(tupleFields ? { tupleFields } : {}) });
      } else if (statement.kind === "require") {
        const condition = this.expression(statement.condition);
        requireBool(condition, statement.condition.site);
        bound.push({ kind: "require", condition, code: statement.code, source });
      } else if (statement.kind === "emit") {
        const effect = this.effects.get(statement.effect);
        if (!effect) refuse(this.diagnosticSite(statement.site),
          `unknown effect ${statement.effect}; declare effect ${statement.effect} from <module>`);
        bound.push({ kind: "emit", effect, payload: this.expression(statement.payload), source });
      } else if (statement.kind === "if") {
        const condition = this.expression(statement.condition);
        requireBool(condition, statement.condition.site);
        const prior = this.scope;
        let thenBody: BoundStatement[];
        let elseBody: BoundStatement[];
        try {
          this.scope = narrowedScope(condition, prior, true);
          thenBody = this.statements(statement.thenBody, true, completes);
          this.scope = narrowedScope(condition, prior, false);
          elseBody = this.statements(statement.elseBody, true, completes);
        } finally {
          this.scope = prior;
        }
        bound.push({ kind: "if", condition, thenBody, elseBody, source });
      } else if (statement.kind === "for") {
        const domain = this.expression(statement.domain);
        const item = loopItemFacts(domain, statement.domain.site);
        const symbol: BoundLocalSymbol = {
          kind: "local", id: `${this.program.site.file}:${this.program.name}:loop:${this.localId++}`,
          name: statement.name, facts: item, source,
        };
        const prior = this.scope;
        let body: BoundStatement[];
        try {
          this.scope = new Map(prior);
          this.scope.set(statement.name, symbol);
          body = this.statements(statement.body, true, false);
        } finally {
          this.scope = prior;
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
        let someBody: BoundStatement[];
        let noneBody: BoundStatement[];
        try {
          this.scope = new Map(prior);
          this.scope.set(statement.someName, symbol);
          someBody = this.statements(statement.someBody, true, completes);
          this.scope = new Map(prior);
          noneBody = this.statements(statement.noneBody, true, completes);
        } finally {
          this.scope = prior;
        }
        bound.push({ kind: "match", value: point, symbol, someBody, noneBody, source });
      } else if (statement.kind === "expr") {
        const value = this.expression(statement.value);
        if (!completes && value.kind !== "write") refuse(this.diagnosticSite(statement.site),
          "a non-final expression must be a write; bind it if its value is needed");
        bound.push({ kind: "expr", value, completion: completes, source });
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
      return { kind: "array", items, facts: facts(type, combineOrigins(items), { max: items.length }), source };
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
      return { kind: "unary", op: expression.op === "not" ? "Not" : "Neg", value, facts: facts(type, "Computed"), source };
    }
    if (expression.kind === "binary") return this.binary(expression);
    if (expression.kind === "assert") {
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
        const value = contextualValue(
          this.expression(field.value ?? { kind: "name", name: field.name, site: field.site }),
          expected,
          this.diagnosticSite(field.site),
        );
        if (!writeAssignable(value.facts.type, expected, field.value)) typeError(this.diagnosticSite(field.site),
          `${field.name} expects ${typeName(expected)}, got ${typeName(value.facts.type)}`, `use a ${typeName(expected)} value for ${field.name}`);
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
    if (authoredId) typeError(this.diagnosticSite(authoredId.site), expression.op === "upsert"
      ? "upsert rows may not name id; identity comes from the addressed row or is minted on insert"
      : "update patches may not name id; row identity is immutable", `remove id from the ${expression.op} fields`);
    for (const [offset, column] of columns.entries()) {
      const field = expression.fields.find((candidate) => candidate.name === column);
      if (!field) continue;
      const value = field.value ?? { kind: "name", name: field.name, site: field.site } satisfies Expr;
      if (expressionText(value) === expressionText(expression.keys[offset]!.value)) continue;
      typeError(this.diagnosticSite(field.site), `${expression.op} may not reassign addressed key column ${column}`,
        `remove ${column} from the ${expression.op} fields`);
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
      facts: facts(type, "Const"), source: this.source(expression.site) };
  }

  private name(name: string, site: Site): BoundExpression {
    const source = this.source(site);
    if (this.helperDepth > 0 && name === "new") throw new QuarryError(
      this.diagnosticSite(site), "new is mutation-only caller state and is not available inside fn expressions",
      "E_QUARRY_UNSUPPORTED", "pass the new value as an explicit fn argument",
    );
    if (this.namedShapeDepth > 0) {
      if (!CONTEXT_NAMES.has(name)) throw new QuarryError(
        this.diagnosticSite(site), `named shapes cannot capture operation name ${name}`,
        "E_QUARRY_UNKNOWN", `use .${name} for a focal-row field, or move the argument-dependent field into the caller's shape block`,
      );
      return this.contextName(name, source, site);
    }
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
        "time - time yields int; add or subtract an int offset from time");
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
      if (!leftBrand || !rightBrand || !sameBrand(leftBrand, rightBrand)) typeError(expression.site,
        `${expression.op} requires matching ${typeName(brand)} values`, `use two matching ${typeName(brand)} values`);
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
    return { kind: "binary", op, left, right, facts: facts(requiredType(leftType), "Computed"), source: this.source(expression.site) };
  }

  private member(expression: Extract<Expr, { kind: "member" }>): BoundExpression {
    let base = this.expression(expression.base);
    if (base.facts.type.kind === "ref") base = this.shapeBase(base, expression.base, expression.site);
    const source = this.source(expression.site);
    const baseType = base.facts.type;
    if ((baseType.kind === "list" || baseType.kind === "empty-list" || baseType.kind === "page" || baseType.kind === "collection") && expression.name === "length") {
      if (base.facts.presence === "optional") typeError(expression.site,
        "list length requires a present list; its maximum does not prove presence",
        "coalesce the possibly absent list with [] before selecting .length");
      return { kind: "builtin", builtin: "Len", args: [base], facts: facts({ kind: "int", optional: false }, "Computed"), source };
    }
    let type: BoundType | undefined;
    let origin: Provenance = "Computed";
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
    } else if (baseType.kind === "json" || baseType.kind === "unknown") {
      type = { kind: "unknown" };
    } else if (baseType.kind === "image" || baseType.kind === "video") {
      if (["width", "height", "duration"].includes(expression.name)) type = { kind: "int", optional: baseType.optional };
    }
    if (!type) typeError(expression.site, `cannot select .${expression.name} from ${baseType.kind}`, "select a declared row or object field");
    return { kind: "member", base, name: expression.name, facts: facts(type, origin), source };
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
    if (this.functions.has(this.functionFile, expression.name)) return this.functionCall(expression);
    if (expression.name === "words") unsupported(expression.site, "words() in direct Quarry", "use an engine-maintained wordPrefixes index");
    const args = expression.args.map((argument) => this.expression(argument));
    const source = this.source(expression.site);
    if (expression.name === "range") {
      if (args.length !== 2) typeError(expression.site, `range(a, b) requires exactly 2 arguments; received ${args.length}`,
        "use range(integerStart, integerEnd)");
      const start = literalInteger(expression.args[0]);
      const end = literalInteger(expression.args[1]);
      if (start === undefined || end === undefined) typeError(expression.site,
        "range endpoints must be integer literals", "use range(0, 10)");
      return { kind: "range", start, end, max: Math.max(0, end - start),
        facts: facts({ kind: "list", item: { kind: "int", optional: false }, max: Math.max(0, end - start), optional: false }, "Const", {
          max: Math.max(0, end - start),
        }), source };
    }
    if (expression.name === "tokens") {
      const type: ScalarType = { kind: "list", item: { kind: "text", max: 4096, optional: false }, max: 64, optional: false };
      return { kind: "builtin", builtin: "MentionTokens", args, facts: facts(type, "Computed", { max: 64 }), source };
    }
    if (expression.name === "count") {
      const argument = args[0];
      if (args.length !== 1 || !argument || !["list", "empty-list", "page", "collection"].includes(argument.facts.type.kind)) {
        typeError(expression.site, "count(x) requires exactly one bounded list or page", "use count(presentBoundedList)");
      }
      if (argument.facts.presence === "optional") typeError(expression.site,
        "count requires a present list; its maximum does not prove presence",
        "coalesce the possibly absent list with [] before calling count");
      return { kind: "builtin", builtin: "Len", args, facts: facts({ kind: "int", optional: false }, "Computed"), source };
    }
    if (expression.name === "min" || expression.name === "max") {
      if (args.length < 2) typeError(expression.site, `${expression.name} requires at least two arguments`, `use ${expression.name}(a, b)`);
      const builtin = expression.name === "min" ? "Min" : "Max";
      return args.slice(1).reduce<BoundExpression>((left, right) => ({
        kind: "builtin", builtin, args: [left, right], facts: facts(left.facts.type, "Computed"), source,
      }), args[0]!);
    }
    if (expression.name === "divmod" && args.length === 2) {
      const fields = new Map(["quotient", "remainder"].map((name) => [name, facts(requiredType(args[0]!.facts.type), "Computed")]));
      return { kind: "builtin", builtin: { Divmod: { remainder_sink: "lexicographic-id" } }, args,
        facts: facts({ kind: "object", fields, nullable: false }, "Computed"), source };
    }
    if (expression.name === "share" && args.length === 3) {
      return { kind: "builtin", builtin: "DeterministicShare", args, facts: facts(requiredType(args[0]!.facts.type), "Computed"), source };
    }
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
    if (!assignable(seed.facts.type, { kind: "ref", table: expression.table, optional: false })) typeError(expression.seed.site,
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
    const args = expression.args.map((argument) => this.expression(argument));
    const source = this.source(expression.site);
    const fields = [
      { name: "first", value: args[0]!, source },
      { name: "second", value: args[1]!, source },
    ];
    return { kind: "object", fields, facts: facts({
      kind: "object", fields: new Map(fields.map((field) => [field.name, field.value.facts])), nullable: false,
    }, combineOrigins(args)), source };
  }

  private functionCall(expression: Extract<Expr, { kind: "call" }>): BoundExpression {
    const actuals = expression.args.map((argument) => this.expression(argument));
    const { declaration, document } = this.functions.resolve(this.functionFile, expression.name, expression.site);
    if (actuals.length !== declaration.args.length) typeError(
      this.diagnosticSite(expression.site),
      `fn ${expression.name} expects ${declaration.args.length} arguments, got ${actuals.length}`,
      `call ${expression.name}(${declaration.args.map((arg) => arg.name).join(", ")})`,
    );
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
      if (!assignable(value.facts.type, parameter.type)) typeError(
        this.diagnosticSite(expression.args[index]?.site ?? expression.site),
        `fn ${expression.name} argument ${parameter.name} expects ${typeName(parameter.type)}, got ${typeName(value.facts.type)}`,
        `pass ${parameter.name}: ${typeName(parameter.type)}`,
      );
      const symbol: BoundArgumentSymbol = {
        kind: "argument", id: `${identity}:call:${this.budget.expansionId++}:argument:${index}`,
        name: parameter.name, type: structuredClone(parameter.type), origin: value.facts.origin,
        source: sourceStack(parameter.site, this.expansionUse ?? expression.site),
      };
      return { symbol, value, ...(value.facts.type.kind === "row" ? { coercion: "row-id" as const } : {}) };
    });
    const prior = {
      scope: this.scope, use: this.expansionUse, helperDepth: this.helperDepth,
      namedShapeDepth: this.namedShapeDepth, functionFile: this.functionFile, shapeFile: this.shapeFile,
      focal: this.focal,
    };
    this.scope = new Map(bindings.map((binding) => [binding.symbol.name, binding.symbol]));
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
    } finally {
      this.expansionFrames.pop();
      this.scope = prior.scope;
      this.expansionUse = prior.use;
      this.helperDepth = prior.helperDepth;
      this.namedShapeDepth = prior.namedShapeDepth;
      this.functionFile = prior.functionFile;
      this.shapeFile = prior.shapeFile;
      this.focal = prior.focal;
    }
  }

  private read(expression: Extract<Expr, { kind: "read" }>): BoundExpression {
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
    if (columnAt(declaration.components, -1) !== "id") typeError(declaration.site,
      `pageable merge ${expression.table}.${declaration.name} must end in intrinsic id`,
      `add id as the final ${declaration.name} component`);
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
      try {
        if (lane.loop) {
          sourceRead = this.boundRead(lane.loop.domain, "range");
          symbol = { kind: "local", id: `${this.program.site.file}:${this.program.name}:merge:${this.localId++}`,
            name: lane.loop.name, facts: facts({ kind: "row", table: sourceRead.table, nullable: false }, "Shape", {
              tableOrigin: sourceRead.table, readOrigin: sourceRead,
            }), source: this.source(lane.site) };
          this.scope = new Map(prior);
          this.scope.set(symbol.name, symbol);
        }
        const readExpression: Extract<Expr, { kind: "read" }> = {
          kind: "read", table: expression.table,
          keys: lane.prefix.map((value, offset) => ({ value, column: lane.columns?.[offset], site: value.site })),
          index: expression.index,
          range: { order: expression.order, take: expression.take, site: lane.site },
          site: lane.site,
        };
        const scan = this.boundRead(readExpression, "range");
        scan.range = { ...scan.range!, after, opaqueCursor: after !== null, mergeSite };
        return { ...(sourceRead ? { sourceRead } : {}), ...(symbol ? { symbol } : {}), scan, source: this.source(lane.site) };
      } finally {
        this.scope = prior;
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

  private boundRead(expression: Extract<Expr, { kind: "read" }>, mode: "point" | "range" | "exists"): BoundRead {
    const tableInfo = this.catalog.get(expression.table);
    if (!tableInfo) refuse(expression.site, `unknown table ${expression.table}`);
    const table: BoundTableSymbol = { kind: "table", id: `table:${expression.table}`, name: expression.table,
      declaration: tableInfo.declaration, source: sourceStack(tableInfo.declaration.site) };
    let keyed = expression.keys.map((part) => ({ authored: part.value, bound: this.expression(part.value) }));
    const selected = selectIndex(this.catalog, expression.table, expression.keys, mode, expression.index,
      (authored) => scalarForIndex(keyed.find((item) => item.authored === authored)?.bound.facts.type), expression.site);
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
        `named shapes expand beyond ${MAX_EXPANDED_NODES} syntax nodes in one operation or declaration`,
        "E_QUARRY_UNSUPPORTED", "remove repeated shape spreads or split the operation into smaller bounded projections",
      );
      this.budget.expansionId += 1;
    }
    return sourceStack(site, this.expansionUse);
  }

  private diagnosticSite(site: Site, useSite = this.expansionUse): Site {
    return useSite ? { ...site, expandedFrom: useSite } : site;
  }
}

function completionFacts(statements: BoundStatement[]): BoundValueFacts[] {
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
  if (fallsThrough) returns.push(facts({ kind: "null" }, "Const"));
  return returns;
}

function statementsFallThrough(statements: BoundStatement[]): boolean {
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

function joinFacts(values: BoundValueFacts[], site: Site): BoundValueFacts {
  const type = values.slice(1).reduce((joined, value) => joinType(joined, value.type, site), values[0]!.type);
  const origins = new Set(values.map((value) => value.origin).filter((origin) => origin !== "Const"));
  const originated = values.filter((value) => value.type.kind !== "null");
  const tableOrigin = originated[0]?.tableOrigin;
  const readOrigin = originated[0]?.readOrigin;
  const fieldProjection = values.every((value) => value.fieldProjection === "inherited-row")
    ? "inherited-row" : values.some((value) => value.fieldProjection) ? "constructed" : undefined;
  return { ...facts(type, origins.size === 0 ? "Const" : origins.size === 1 ? [...origins][0]! : "Computed", {
    ...(values.some((value) => value.max !== undefined) ? { max: Math.max(...values.map((value) => value.max ?? 0)) } : {}),
    ...(tableOrigin && originated.every((value) => value.tableOrigin?.id === tableOrigin.id) ? { tableOrigin } : {}),
    ...(readOrigin && originated.every((value) => value.readOrigin === readOrigin) ? { readOrigin } : {}),
    ...(fieldProjection ? { fieldProjection } : {}),
  }), presence: values.some((value) => value.presence === "optional") ? "optional" : "required" };
}

function rowObjectType(row: Extract<BoundType, { kind: "row" }>): Extract<BoundType, { kind: "object" }> {
  const fields = new Map<string, BoundValueFacts>();
  fields.set("id", facts({ kind: "ref", table: row.table.name, optional: row.nullable }, "Shape", {
    tableOrigin: row.table, fieldProjection: "inherited-row",
  }));
  for (const column of row.table.declaration.columns) {
    fields.set(column.name, facts({ ...column.type, optional: column.type.optional || row.nullable } as ScalarType, "Shape", {
      tableOrigin: row.table, fieldProjection: "inherited-row",
    }));
  }
  return { kind: "object", fields, nullable: row.nullable };
}

function joinType(left: BoundType, right: BoundType, site: Site): BoundType {
  if (left.kind === "null") return optionalType(right);
  if (right.kind === "null") return optionalType(left);
  if (left.kind === "empty-list" && right.kind === "empty-list") return left;
  if (left.kind === "empty-list" && right.kind === "list") return right;
  if (left.kind === "list" && right.kind === "empty-list") return left;
  if (left.kind === "ref" && right.kind === "id") return { ...left, optional: left.optional || right.optional };
  if (left.kind === "id" && right.kind === "ref") return { ...right, optional: left.optional || right.optional };
  if (left.kind === "row" && right.kind === "object") left = rowObjectType(left);
  if (left.kind === "object" && right.kind === "row") right = rowObjectType(right);
  if (left.kind !== right.kind) typeError(site,
    `conditional returns disagree: ${typeName(left)} and ${typeName(right)}`,
    "return the same value type from every branch");
  if (left.kind === "row" && right.kind === "row") {
    if (left.table.name !== right.table.name) typeError(site, "conditional returns rows from different tables", "return rows from one table");
    return { ...left, nullable: left.nullable || right.nullable };
  }
  if (left.kind === "page" && right.kind === "page") {
    if (left.table.name !== right.table.name) typeError(site, "conditional returns pages from different tables", "return pages from one table");
    const rawItem = (page: typeof left): BoundValueFacts => facts(
      { kind: "row", table: page.table, nullable: false }, "Shape", { tableOrigin: page.table },
    );
    const item = joinFacts([left.item ?? rawItem(left), right.item ?? rawItem(right)], site);
    return { ...left, item, max: Math.max(left.max, right.max) };
  }
  if (left.kind === "collection" && right.kind === "collection") {
    return { kind: "collection", item: joinFacts([left.item, right.item], site), max: Math.max(left.max, right.max) };
  }
  if (left.kind === "object" && right.kind === "object") {
    const leftNames = [...left.fields.keys()];
    const rightNames = [...right.fields.keys()];
    if (leftNames.length !== rightNames.length || leftNames.some((name) => !right.fields.has(name))) typeError(site,
      "conditional returns objects with different fields", "return the same object fields from every branch");
    return { kind: "object", nullable: left.nullable || right.nullable,
      fields: new Map(leftNames.map((name) => [name, joinFacts([left.fields.get(name)!, right.fields.get(name)!], site)])) };
  }
  if (left.kind === "numeric-literal" && right.kind === "numeric-literal") {
    return { kind: "numeric-literal", fractionalDigits: Math.max(left.fractionalDigits, right.fractionalDigits) };
  }
  if (!isScalar(left) || !isScalar(right)) return left;
  if (left.kind === "ref" && right.kind === "ref" && left.table !== right.table) typeError(site,
    `conditional returns ${left.table} and ${right.table} references`, "return references to one table");
  if (left.kind === "decimal" && right.kind === "decimal" && left.scale !== right.scale) typeError(site,
    `conditional returns decimal ${left.scale} and decimal ${right.scale}`, "return decimals with one scale");
  if (left.kind === "money" && right.kind === "money"
    && (left.currency !== right.currency || left.scale !== right.scale)) typeError(site,
    "conditional returns different money brands", "return money with one currency and scale");
  if (left.kind === "list" && right.kind === "list") {
    const item = joinType(left.item, right.item, site);
    if (!isScalar(item)) typeError(site, "conditional list items disagree", "return lists with one scalar item type");
    return { ...left, item, max: Math.max(left.max, right.max), optional: left.optional || right.optional };
  }
  if (left.kind === "text" && right.kind === "text") {
    const { min: _leftMin, format: _leftFormat, ...base } = left;
    const min = Math.min(left.min ?? 0, right.min ?? 0);
    return {
      ...base, max: Math.max(left.max, right.max),
      ...(min > 0 ? { min } : {}),
      ...(left.format === right.format && left.format ? { format: left.format } : {}),
      optional: left.optional || right.optional,
    };
  }
  if (left.kind === "enum" && right.kind === "enum") return {
    ...left, variants: [...new Set([...left.variants, ...right.variants])], optional: left.optional || right.optional,
  };
  if (left.kind === "bytes" && right.kind === "bytes") return {
    ...left, max: Math.max(left.max, right.max), optional: left.optional || right.optional,
  };
  if (left.kind === "image" && right.kind === "image") return {
    kind: "image", max: Math.max(left.max, right.max),
    ...(left.once && right.once ? { once: true } : {}), optional: left.optional || right.optional,
  };
  if (left.kind === "video" && right.kind === "video") return {
    ...left, max: Math.max(left.max, right.max), optional: left.optional || right.optional,
  };
  if (left.kind === "json" && right.kind === "json") return {
    ...left, max: Math.max(left.max, right.max), optional: left.optional || right.optional,
  };
  return { ...left, optional: left.optional || right.optional } as ScalarType;
}

function tupleFieldFacts(value: BoundValueFacts, name: string, site: Site): BoundValueFacts {
  if (value.type.kind !== "object") typeError(site, "tuple binding requires an object-valued pair", "use divmod(a, b)");
  const field = value.type.fields.get(name);
  if (!field) typeError(site, `tuple binding result has no ${name} field`, "use (quotient, remainder) = divmod(a, b)");
  return field;
}

function loopItemFacts(domain: BoundExpression, site: Site): BoundValueFacts {
  const type = domain.facts.type;
  if (type.kind === "page") return type.item ?? facts({ kind: "row", table: type.table, nullable: false }, domain.facts.origin, {
    tableOrigin: type.table, readOrigin: domain.facts.readOrigin,
  });
  if (type.kind === "collection") return type.item;
  if (type.kind === "list") {
    if (type.optional) typeError(site, "for cannot iterate an optional list", "supply an empty default before the loop");
    return facts(type.item, domain.facts.origin, { max: type.max, tableOrigin: domain.facts.tableOrigin });
  }
  if (type.kind === "empty-list") return facts({ kind: "unknown" }, domain.facts.origin, { max: 0 });
  typeError(site, `for cannot iterate ${typeName(type)}`, "iterate a bounded page or required capped list");
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

function contextualValue(expression: BoundExpression, target: ScalarType, site: Site): BoundExpression {
  if (expression.kind === "array" && target.kind === "list") {
    const itemTarget = { ...target.item, optional: target.item.optional } as ScalarType;
    const items = expression.items.map((item) => contextualValue(item, itemTarget, item.source.definition));
    const mismatch = items.find((item) => !assignable(item.facts.type, itemTarget));
    if (mismatch) typeError(site, `list item expects ${typeName(itemTarget)}, got ${typeName(mismatch.facts.type)}`,
      `use ${typeName(itemTarget)} values in this list`);
    return { ...expression, items, facts: facts({
      kind: "list", item: structuredClone(itemTarget), max: items.length, optional: false,
    }, combineOrigins(items), { max: items.length }) };
  }
  if (numericLiteralExpression(expression) && numericTarget(target)) return contextualLiteral(expression, target, site);
  if (stringLiteralExpression(expression) && (target.kind === "id" || target.kind === "ref" || target.kind === "enum")) {
    return contextualLiteral(expression, target, site);
  }
  return expression;
}

function contextualPair(left: BoundExpression, right: BoundExpression, site: Site): [BoundExpression, BoundExpression] {
  const leftTarget = contextualTarget(right.facts.type);
  const rightTarget = contextualTarget(left.facts.type);
  if (numericLiteralExpression(left) && leftTarget && numericTarget(leftTarget)) left = contextualLiteral(left, leftTarget, site);
  if (numericLiteralExpression(right) && rightTarget && numericTarget(rightTarget)) right = contextualLiteral(right, rightTarget, site);
  if (stringLiteralExpression(left) && leftTarget && (leftTarget.kind === "id" || leftTarget.kind === "ref")) {
    left = contextualLiteral(left, leftTarget, site);
  }
  if (stringLiteralExpression(right) && rightTarget && (rightTarget.kind === "id" || rightTarget.kind === "ref")) {
    right = contextualLiteral(right, rightTarget, site);
  }
  return [left, right];
}

function contextualTarget(type: BoundType): ScalarType | undefined {
  if (type.kind === "row") return { kind: "ref", table: type.table.name, optional: type.nullable };
  return isScalar(type) ? type : undefined;
}

function contextualLiteral(expression: BoundExpression, target: ScalarType, site: Site): BoundExpression {
  if (expression.kind === "unary" && expression.op === "Neg") {
    const value = contextualLiteral(expression.value, target, site);
    return { ...expression, value, facts: facts({ ...target, optional: false } as ScalarType, expression.facts.origin) };
  }
  if (expression.kind !== "literal") return expression;
  if (typeof expression.value === "string" && target.kind === "enum") {
    if (!target.variants.includes(expression.value)) typeError(site,
      `enum literal ${JSON.stringify(expression.value)} is not one of ${target.variants.join(", ")}`,
      `use one of ${target.variants.map((variant) => JSON.stringify(variant)).join(", ")}`);
    return { ...expression, facts: facts({ ...target, optional: false }, expression.facts.origin) };
  }
  if (typeof expression.value === "string" && (target.kind === "id" || target.kind === "ref")) {
    if (expression.value.length === 0) typeError(site, "Id literals cannot be empty", "use a non-empty Id literal");
    return { ...expression, wireKind: "id", facts: facts({ ...target, optional: false } as ScalarType, expression.facts.origin) };
  }
  if (typeof expression.value !== "number" || !numericTarget(target)) return expression;
  const text = expression.numericText ?? String(expression.value);
  const scale = target.kind === "decimal" || target.kind === "money" ? target.scale : 0;
  const wireValue = scaledInteger(text, scale);
  if (wireValue === undefined) typeError(site,
    `${decimalPlaces(text)} fractional digits do not fit ${typeName(target)}`,
    target.kind === "decimal" || target.kind === "money" ? `use at most ${target.scale} fractional digits` : "use an integer literal");
  return { ...expression, wireValue, facts: facts({ ...target, optional: false } as ScalarType, expression.facts.origin) };
}

function numericLiteralExpression(expression: BoundExpression): boolean {
  return expression.kind === "literal" && typeof expression.value === "number"
    || expression.kind === "unary" && expression.op === "Neg" && numericLiteralExpression(expression.value);
}
function stringLiteralExpression(expression: BoundExpression): boolean {
  return expression.kind === "literal" && typeof expression.value === "string";
}
function numericTarget(type: ScalarType): type is Extract<ScalarType, { kind: "int" | "decimal" | "money" }> {
  return ["int", "decimal", "money"].includes(type.kind);
}
function numericAmount(type: BoundType): boolean {
  return (type.kind === "int" || type.kind === "decimal" || type.kind === "money") && !type.optional
    || type.kind === "numeric-literal";
}
function brandedType(type: BoundType): Extract<ScalarType, { kind: "decimal" | "money" }> | undefined {
  return type.kind === "decimal" || type.kind === "money" ? type : undefined;
}
function sameBrand(left: Extract<ScalarType, { kind: "decimal" | "money" }>, right: Extract<ScalarType, { kind: "decimal" | "money" }>): boolean {
  return left.kind === "decimal" && right.kind === "decimal" && left.scale === right.scale
    || left.kind === "money" && right.kind === "money" && left.currency === right.currency && left.scale === right.scale;
}
function comparable(left: BoundType, right: BoundType): boolean {
  if (left.kind === "row") return right.kind === "row" && left.table.name === right.table.name
    || right.kind === "ref" && left.table.name === right.table;
  if (right.kind === "row") return comparable(right, left);
  if (!isScalar(left) || !isScalar(right)) return false;
  if (left.kind === "principal" || right.kind === "principal") return left.kind === "principal" && right.kind === "principal";
  if (left.kind === "ref" || left.kind === "id") return right.kind === "id"
    || right.kind === "ref" && (left.kind === "id" || left.table === right.table);
  if (right.kind === "ref" || right.kind === "id") return false;
  if ((left.kind === "enum" && right.kind === "text") || (left.kind === "text" && right.kind === "enum")) return true;
  if (left.kind === "decimal" || right.kind === "decimal") return left.kind === "decimal" && right.kind === "decimal" && left.scale === right.scale;
  if (left.kind === "money" || right.kind === "money") return left.kind === "money" && right.kind === "money"
    && left.currency === right.currency && left.scale === right.scale;
  return left.kind === right.kind;
}
function orderedType(type: BoundType): boolean {
  return ["text", "id", "principal", "int", "decimal", "money", "time", "enum", "ref"].includes(type.kind);
}
function idFallbackCompatible(actual: BoundType, expected: Extract<ScalarType, { kind: "id" | "ref" }>): boolean {
  if (actual.kind === "null") return expected.optional;
  if (actual.kind === "row") return expected.kind === "ref" && actual.table.name === expected.table;
  if (!isScalar(actual)) return false;
  return actual.kind === "id" || actual.kind === "ref" && (expected.kind === "id" || actual.table === expected.table);
}

function facts(type: BoundType, origin: Provenance, extra: Partial<BoundValueFacts> = {}): BoundValueFacts {
  return { type, presence: presence(type), origin, ...extra };
}

function projectedField<T extends BoundExpression>(expression: T, fieldProjection: NonNullable<BoundValueFacts["fieldProjection"]>): T {
  return { ...expression, facts: { ...expression.facts, fieldProjection } };
}
function presence(type: BoundType): BoundPresence {
  if (type.kind === "null") return "optional";
  if (type.kind === "row" || type.kind === "object") return type.nullable ? "optional" : "required";
  return "optional" in type && type.optional ? "optional" : "required";
}
function combineOrigins(expressions: BoundExpression[]): Provenance {
  const origins = expressions.map((expression) => expression.facts.origin);
  if (origins.includes("Computed")) return "Computed";
  const meaningful = new Set(origins.filter((origin) => origin !== "Const"));
  if (meaningful.size === 0) return "Const";
  if (meaningful.size === 1) return [...meaningful][0]!;
  return "Shape";
}
function scalarForIndex(type: BoundType | undefined): ScalarType | undefined {
  if (!type) return undefined;
  if (type.kind === "row") return { kind: "ref", table: type.table.name, optional: type.nullable };
  return isScalar(type) ? type : undefined;
}
function scalarType(type: BoundType, site: Site): ScalarType {
  if (isScalar(type)) return type;
  typeError(site, `bounded arrays require scalar items; got ${type.kind}`, "use scalar array elements");
}
function isScalar(type: BoundType): type is ScalarType {
  return !["unknown", "null", "empty-list", "row", "page", "collection", "object", "numeric-literal"].includes(type.kind);
}
function requiredType(type: BoundType): BoundType {
  if (type.kind === "row" || type.kind === "object") return { ...type, nullable: false };
  if (isScalar(type)) return { ...type, optional: false } as ScalarType;
  return type;
}
function optionalType(type: BoundType): BoundType {
  if (type.kind === "row" || type.kind === "object") return { ...type, nullable: true };
  if (isScalar(type)) return { ...type, optional: true } as ScalarType;
  return type;
}
function withOptional(type: BoundType, optional: boolean): BoundType {
  if (type.kind === "row" || type.kind === "object") return { ...type, nullable: optional };
  if (isScalar(type)) return { ...type, optional } as ScalarType;
  return type;
}
function coalescedType(left: BoundType, right: BoundType, site: Site): BoundType {
  if (left.kind === "null") return right;
  if (right.kind === "null") return left;
  const joined = joinType(left, right, site);
  return withOptional(joined, presence(left) === "optional" && presence(right) === "optional");
}
function binaryOperator(operator: string): string | undefined {
  return new Map([
    ["=", "Eq"], ["!=", "Ne"], ["<", "Lt"], ["<=", "Lte"], [">", "Gt"], [">=", "Gte"],
    ["+", "Add"], ["-", "Sub"], ["*", "Mul"], ["/", "Div"], ["%", "Mod"],
    ["and", "And"], ["or", "Or"], ["??", "Coalesce"],
  ]).get(operator);
}
function boolType(): Extract<ScalarType, { kind: "bool" }> { return { kind: "bool", optional: false }; }
function decimalPlaces(text: string | undefined): number {
  const dot = text?.indexOf(".") ?? -1;
  return dot < 0 ? 0 : text!.length - dot - 1;
}
function scaledInteger(text: string, scale: number): number | undefined {
  const match = text.match(/^(\d+)(?:\.(\d+))?$/);
  if (!match) return undefined;
  const fraction = match[2] ?? "";
  if (fraction.length > scale) return undefined;
  const value = BigInt(`${match[1]}${fraction.padEnd(scale, "0")}`);
  const number = Number(value);
  return Number.isSafeInteger(number) ? number : undefined;
}
function assignable(actual: BoundType, expected: ScalarType): boolean {
  if (actual.kind === "null") return expected.optional;
  if (actual.kind === "empty-list") return expected.kind === "list";
  if (actual.kind === "row") return expected.kind === "ref"
    && actual.table.name === expected.table && !actual.nullable;
  if (actual.kind === "id" && expected.kind === "ref") return !actual.optional || expected.optional;
  if (actual.kind === "ref" && expected.kind === "id") return !actual.optional || expected.optional;
  if (!isScalar(actual) || actual.kind !== expected.kind) return false;
  if (!expected.optional && actual.optional) return false;
  if (actual.kind === "text" && expected.kind === "text") {
    return actual.max <= expected.max && (expected.min === undefined || (actual.min ?? 0) >= expected.min)
      && (expected.format === undefined || actual.format === expected.format);
  }
  if (["bytes", "image", "video", "json"].includes(actual.kind)) {
    return "max" in actual && "max" in expected && actual.max <= expected.max;
  }
  if (actual.kind === "decimal" && expected.kind === "decimal") return actual.scale === expected.scale;
  if (actual.kind === "money" && expected.kind === "money") {
    return actual.currency === expected.currency && actual.scale === expected.scale;
  }
  if (actual.kind === "enum" && expected.kind === "enum") {
    return actual.variants.every((variant) => expected.variants.includes(variant));
  }
  if (actual.kind === "ref" && expected.kind === "ref") return actual.table === expected.table;
  if (actual.kind === "list" && expected.kind === "list") {
    return actual.max <= expected.max && assignable(actual.item, expected.item);
  }
  return true;
}
function writeAssignable(actual: BoundType, expected: ScalarType, authored: Expr | undefined): boolean {
  if (actual.kind === "null") return expected.optional;
  if (actual.kind === "empty-list") return expected.kind === "list";
  if (actual.kind === "unknown") return true;
  if (actual.kind === "object" && expected.kind === "json") return !actual.nullable || expected.optional;
  if (actual.kind === "numeric-literal") {
    if (expected.kind === "int") return actual.fractionalDigits === 0;
    if (expected.kind === "decimal" || expected.kind === "money") return actual.fractionalDigits <= expected.scale;
    return false;
  }
  if (authored?.kind === "literal" && typeof authored.value === "number" && expected.kind === "int") {
    return Number.isInteger(authored.value);
  }
  if (actual.kind === "text" && expected.kind === "text") {
    return (!actual.optional || expected.optional) && actual.max <= expected.max;
  }
  return assignable(actual, expected);
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
function literalInteger(expression: Expr | undefined): number | undefined {
  if (!expression) return;
  if (expression.kind === "literal" && typeof expression.value === "number" && Number.isSafeInteger(expression.value)) return expression.value;
  if (expression.kind === "unary" && expression.op === "-") {
    const value = literalInteger(expression.value);
    return value === undefined ? undefined : -value;
  }
  return;
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
function typeName(type: BoundType): string {
  if (type.kind === "empty-list") return "[]";
  if (type.kind === "ref") return type.table;
  if (type.kind === "row") return `${type.table.name} row`;
  if (type.kind === "money") return `money ${type.currency} ${type.scale}`;
  if (type.kind === "decimal") return `decimal ${type.scale}`;
  if (type.kind === "list") return `[${typeName(type.item)}] <=${type.max}`;
  if (type.kind === "collection") return `bounded collection <=${type.max}`;
  return type.kind;
}
function sourceStack(site: Site, use?: Site): BoundSourceStack {
  const definition = withoutExpansion(site);
  const expandedUse = use ?? site.expandedFrom;
  return expandedUse ? { definition, use: withoutExpansion(expandedUse) } : { definition };
}
function withoutExpansion(site: Site): Site {
  const { expandedFrom: _expandedFrom, expansionId: _expansionId, ...authored } = site;
  return authored;
}
function siteText(site: Site): string { return `${site.file}:${site.line}:${site.col}`; }
