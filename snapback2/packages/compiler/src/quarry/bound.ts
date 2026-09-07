import { basename, dirname, join } from "node:path";
import type { IndexComponent, Provenance } from "../ir";
import type { Document, Expr, FunctionDecl, IndexDecl, ProgramDecl, ScalarType, ShapeDecl, ShapeField, Site, TableCatalog, TableDecl } from "./ast";
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
};

export type BoundType =
  | ScalarType
  | { kind: "null" }
  | { kind: "row"; table: BoundTableSymbol; nullable: boolean }
  | { kind: "page"; table: BoundTableSymbol; max: number }
  | { kind: "collection"; item: BoundValueFacts; max: number }
  | { kind: "object"; fields: ReadonlyMap<string, BoundValueFacts>; nullable: boolean }
  | { kind: "numeric-literal"; fractionalDigits: number };

export type BoundValueFacts = {
  type: BoundType;
  presence: BoundPresence;
  max?: number;
  origin: Provenance;
  tableOrigin?: BoundTableSymbol;
  readOrigin?: BoundRead;
};

type BoundExpressionBase = { facts: BoundValueFacts; source: BoundSourceStack };
export type BoundExpression = BoundExpressionBase & (
  | { kind: "literal"; value: string | number | boolean | null; numericText?: string }
  | { kind: "variable"; symbol: BoundArgumentSymbol }
  | { kind: "focal"; id: string }
  | { kind: "input"; input: "Viewer" | "Now" | "NewId" | "ReadTime" }
  | { kind: "array"; items: BoundExpression[] }
  | { kind: "object"; fields: Array<{ name: string; value: BoundExpression; source: BoundSourceStack }> }
  | { kind: "unary"; op: "Not" | "Neg"; value: BoundExpression }
  | { kind: "binary"; op: string; left: BoundExpression; right: BoundExpression }
  | { kind: "member"; base: BoundExpression; name: string }
  | { kind: "shape"; base: BoundExpression; focal: Extract<BoundExpression, { kind: "focal" }>;
      fields: Array<{ name: string; value: BoundExpression; source: BoundSourceStack }> }
  | { kind: "builtin"; builtin: string | Record<string, unknown>; args: BoundExpression[] }
  | { kind: "invoke"; bindings: Array<{ symbol: BoundArgumentSymbol; value: BoundExpression }>; body: BoundExpression }
  | { kind: "get" | "exists" | "scan" | "aggregate"; read: BoundRead }
);

export type BoundRead = {
  table: BoundTableSymbol;
  index: BoundIndexSymbol;
  key: BoundExpression[];
  provenance: Provenance;
  source: BoundSourceStack;
  range?: {
    components: IndexComponent[];
    order: "Asc" | "Desc";
    take: number;
    after: BoundExpression | null;
    opaqueCursor: boolean;
  };
};

export type BoundStatement = { kind: "return"; value: BoundExpression; source: BoundSourceStack };
export type BoundQuarryProgram = {
  name: string;
  kind: ProgramDecl["kind"];
  args: BoundArgumentSymbol[];
  result: BoundValueFacts;
  body: BoundStatement[];
  source: BoundSourceStack;
};

/** The direct seam currently accepts expression-return operations only. */
export function bindQuarryProgram(program: ProgramDecl, catalog: TableCatalog, documents: Document[] = []): BoundQuarryProgram {
  const statement = program.body[0];
  if (program.focalTable || program.body.length !== 1 || statement?.kind !== "return") {
    unsupported(program.site, "this statement form in the direct Quarry expression seam", "keep it on the parity oracle until direct statement lowering lands");
  }
  const operationName = `${basename(program.site.file, ".q")}.${program.name}`;
  const args = program.args.map((arg, index): BoundArgumentSymbol => ({
    kind: "argument", id: `${operationName}:argument:${index}`, name: arg.name,
    type: structuredClone(arg.type), origin: "Arg", source: sourceStack(arg.site),
  }));
  const binder = new ExpressionBinder(
    program, catalog, new Map(args.map((arg) => [arg.name, arg])),
    new BoundShapeRegistry(documents), new BoundFunctionRegistry(documents),
    { nodes: 0, expansionId: 0, shapeId: 0 },
  );
  const value = binder.expression(statement.value);
  return {
    name: operationName, kind: program.kind, args, result: value.facts,
    body: [{ kind: "return", value, source: sourceStack(statement.site) }], source: sourceStack(program.site),
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

  constructor(
    private readonly program: ProgramDecl,
    private readonly catalog: TableCatalog,
    private scope: Map<string, BoundArgumentSymbol>,
    private readonly shapes: BoundShapeRegistry,
    private readonly functions: BoundFunctionRegistry,
    private readonly budget: ExpansionBudget,
  ) {
    this.shapeFile = program.site.file;
    this.functionFile = program.site.file;
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
      const items = expression.items.map((item) => this.expression(item));
      const itemType = items[0]?.facts.type ?? ({ kind: "null" } as const);
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
      const type = expression.op === "not" ? boolType() : value.facts.type;
      return { kind: "unary", op: expression.op === "not" ? "Not" : "Neg", value, facts: facts(type, "Computed"), source };
    }
    if (expression.kind === "binary") return this.binary(expression);
    if (expression.kind === "member") return this.member(expression);
    if (expression.kind === "shape" || expression.kind === "shapeUse") return this.shape(expression);
    if (expression.kind === "call") return this.call(expression);
    if (expression.kind === "read") return this.read(expression);
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
    if (expression.kind === "created") refuse(expression.site, "created is valid only in an insert table rule");
    unsupported(expression.site, `${expression.kind} in the direct Quarry expression seam`, "keep this operation on the parity oracle until its bound form lands");
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
    if (this.namedShapeDepth > 0) {
      if (!CONTEXT_NAMES.has(name)) throw new QuarryError(
        this.diagnosticSite(site), `named shapes cannot capture operation name ${name}`,
        "E_QUARRY_UNKNOWN", `use .${name} for a focal-row field, or move the argument-dependent field into the caller's shape block`,
      );
      return this.contextName(name, source, site);
    }
    const argument = this.scope.get(name);
    if (argument) return { kind: "variable", symbol: argument, facts: facts(argument.type, argument.origin), source };
    if (this.helperDepth > 0 && !CONTEXT_NAMES.has(name)) throw new QuarryError(
      this.diagnosticSite(site), `fn expressions cannot capture caller name ${name}`,
      "E_QUARRY_UNKNOWN", `add an explicitly typed ${name} parameter to this fn`,
    );
    if (this.helperDepth > 0 && name === "new") throw new QuarryError(
      this.diagnosticSite(site), "new is mutation-only caller state and is not available inside fn expressions",
      "E_QUARRY_UNSUPPORTED", "pass the new value as an explicit fn argument",
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
    const left = this.expression(expression.left);
    const right = this.expression(expression.right);
    const op = binaryOperator(expression.op);
    if (!op) unsupported(expression.site, `operator ${expression.op}`, "use a comparison, Boolean operator, +, -, or *");
    let type: BoundType;
    if (["Eq", "Ne", "Lt", "Lte", "Gt", "Gte", "And", "Or"].includes(op)) type = boolType();
    else if (expression.op === "??") type = coalescedType(left.facts.type, right.facts.type);
    else if (left.facts.type.kind === "time" && right.facts.type.kind === "time" && op === "Sub") type = { kind: "int", optional: false };
    else type = requiredType(left.facts.type);
    return { kind: "binary", op, left, right, facts: facts(type, "Computed"), source: this.source(expression.site) };
  }

  private member(expression: Extract<Expr, { kind: "member" }>): BoundExpression {
    const base = this.expression(expression.base);
    const source = this.source(expression.site);
    const baseType = base.facts.type;
    if ((baseType.kind === "list" || baseType.kind === "page" || baseType.kind === "collection") && expression.name === "length") {
      return { kind: "builtin", builtin: "Len", args: [base], facts: facts({ kind: "int", optional: false }, "Computed"), source };
    }
    let type: BoundType | undefined;
    let origin: Provenance = "Computed";
    if (baseType.kind === "row") {
      const column = expression.name === "id"
        ? { kind: "ref", table: baseType.table.name, optional: false } as ScalarType
        : this.catalog.get(baseType.table.name)?.columns.get(expression.name);
      if (column) type = { ...column, optional: column.optional || baseType.nullable } as ScalarType;
      origin = "Shape";
    } else if (baseType.kind === "object") {
      const field = baseType.fields.get(expression.name);
      if (field) type = baseType.nullable ? optionalType(field.type) : field.type;
      origin = field?.origin ?? "Computed";
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
      ? { kind: "collection", item: facts(objectType, "Shape", { tableOrigin: table }), max: base.facts.type.max }
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
    const read: BoundRead = { table, index, key: [base], provenance: base.facts.origin, source: this.source(site) };
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
    const prior = { focal: this.focal, use: this.expansionUse, named: this.namedShapeDepth, file: this.shapeFile };
    this.focal = focal;
    this.expansionUse = useSite;
    this.namedShapeDepth += named ? 1 : 0;
    this.shapeFile = file;
    try {
      return fields.flatMap((field) => {
        if (field.kind === "namedSpread") {
          return this.namedShapeFields(field.name, useSite ?? field.site, focal);
        }
        const source = this.source(field.site);
        if (field.kind === "spread") {
          if (focal.facts.type.kind !== "row") return [];
          const members = ["id", ...(this.catalog.get(focal.facts.type.table.name)?.columns.keys() ?? [])];
          return members.map((name) => ({ name, value: this.focalMember(focal, name, field.site), source }));
        }
        if (field.kind === "bare") {
          return [{ name: field.name, value: this.focalMember(focal, field.name, field.site), source }];
        }
        return [{ name: field.name, value: this.expression(field.value), source }];
      });
    } finally {
      this.focal = prior.focal;
      this.expansionUse = prior.use;
      this.namedShapeDepth = prior.named;
      this.shapeFile = prior.file;
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
    if (expression.name === "tokens") {
      const type: ScalarType = { kind: "list", item: { kind: "text", max: 4096, optional: false }, max: 64, optional: false };
      return { kind: "builtin", builtin: "MentionTokens", args, facts: facts(type, "Computed", { max: 64 }), source };
    }
    if (expression.name === "count") return { kind: "builtin", builtin: "Len", args, facts: facts({ kind: "int", optional: false }, "Computed"), source };
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
      const value = actuals[index]!;
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
      return { symbol, value };
    });
    const prior = {
      scope: this.scope, use: this.expansionUse, helperDepth: this.helperDepth,
      namedShapeDepth: this.namedShapeDepth, functionFile: this.functionFile, shapeFile: this.shapeFile,
    };
    this.scope = new Map(bindings.map((binding) => [binding.symbol.name, binding.symbol]));
    this.expansionUse = this.expansionUse ?? expression.site;
    this.helperDepth += 1;
    this.namedShapeDepth = 0;
    this.functionFile = document.file;
    this.shapeFile = document.file;
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

  private boundRead(expression: Extract<Expr, { kind: "read" }>, mode: "point" | "range" | "exists"): BoundRead {
    const tableInfo = this.catalog.get(expression.table);
    if (!tableInfo) refuse(expression.site, `unknown table ${expression.table}`);
    const table: BoundTableSymbol = { kind: "table", id: `table:${expression.table}`, name: expression.table,
      declaration: tableInfo.declaration, source: sourceStack(tableInfo.declaration.site) };
    const keyed = expression.keys.map((part) => ({ authored: part.value, bound: this.expression(part.value) }));
    const selected = selectIndex(this.catalog, expression.table, expression.keys, mode, expression.index,
      (authored) => scalarForIndex(keyed.find((item) => item.authored === authored)?.bound.facts.type), expression.site);
    const index: BoundIndexSymbol = { kind: "index", id: `${table.id}:index:${selected.name}`, name: selected.name,
      declaration: selected, table, source: sourceStack(selected.site) };
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

function facts(type: BoundType, origin: Provenance, extra: Partial<BoundValueFacts> = {}): BoundValueFacts {
  return { type, presence: presence(type), origin, ...extra };
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
  return !["null", "row", "page", "collection", "object", "numeric-literal"].includes(type.kind);
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
function coalescedType(left: BoundType, right: BoundType): BoundType {
  if (left.kind === "text" && right.kind === "text") return { ...left, max: Math.max(left.max, right.max), optional: right.optional };
  if (left.kind === "list" && right.kind === "list") return { ...left, max: Math.max(left.max, right.max), optional: right.optional };
  return requiredType(left);
}
function binaryOperator(operator: string): string | undefined {
  return new Map([
    ["=", "Eq"], ["!=", "Ne"], ["<", "Lt"], ["<=", "Lte"], [">", "Gt"], [">=", "Gte"],
    ["+", "Add"], ["-", "Sub"], ["*", "Mul"], ["and", "And"], ["or", "Or"], ["??", "Coalesce"],
  ]).get(operator);
}
function boolType(): Extract<ScalarType, { kind: "bool" }> { return { kind: "bool", optional: false }; }
function decimalPlaces(text: string | undefined): number {
  const dot = text?.indexOf(".") ?? -1;
  return dot < 0 ? 0 : text!.length - dot - 1;
}
function assignable(actual: BoundType, expected: ScalarType): boolean {
  if (actual.kind === "null") return expected.optional;
  if (actual.kind === "row") return expected.kind === "ref"
    && actual.table.name === expected.table && (expected.optional || !actual.nullable);
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
function typeName(type: BoundType): string {
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
