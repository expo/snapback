import { dirname, join } from "node:path";
import type { Document, Expr, ProgramDecl, QuarryDiagnostic, ShapeDecl, ShapeField, ShapeImport, Site, Stmt } from "./ast";
import { QuarryError } from "./diagnostics";

const MAX_SHAPE_DEPTH = 8;
const MAX_EXPANDED_NODES = 4096;
const CONTEXT_NAMES = new Set(["viewer", "now", "commit", "new"]);
type Definition = { declaration: ShapeDecl; document: Document };
type ExpansionContext = { document: Document; bound: Set<string> };

// @ref LLP 1011#b2-shape — named projections expand in their defining module;
// every read is certified in the caller while diagnostics retain definition sites.
export function expandDocuments(documents: Document[]): { documents: Document[]; diagnostics: QuarryDiagnostic[] } {
  const diagnostics: QuarryDiagnostic[] = [];
  const registry = new ShapeRegistry(documents, diagnostics);
  if (diagnostics.length > 0) return { documents, diagnostics };
  const expanded = documents.map((document) => {
    for (const imported of document.shapeImports) {
      try { registry.resolve(document, imported.name, imported.site); }
      catch (error) { diagnostics.push(caught(error)); }
    }
    for (const shape of document.shapes) {
      try { new Expander(document, registry).instantiate(shape.name, shape.site, 1, []); }
      catch (error) { diagnostics.push(caught(error)); }
    }
    const programs: ProgramDecl[] = [];
    for (const program of document.programs) {
      try {
        const expander = new Expander(document, registry);
        programs.push({ ...program, body: program.body.map((statement) => expander.statement(statement)) });
      } catch (error) {
        diagnostics.push(caught(error));
        programs.push(program);
      }
    }
    return { ...document, programs };
  });
  return { documents: expanded, diagnostics: uniqueDiagnostics(diagnostics) };
}

class ShapeRegistry {
  private readonly modules: Map<string, Document>;
  private readonly members = new Map<Document, Map<string, ShapeDecl | ShapeImport>>();

  constructor(documents: Document[], diagnostics: QuarryDiagnostic[]) {
    this.modules = new Map(documents.map((document) => [document.file, document]));
    for (const document of documents) {
      const names = new Map<string, ShapeDecl | ShapeImport>();
      for (const declaration of [...document.shapes, ...document.shapeImports]) {
        const prior = names.get(declaration.name);
        if (prior) diagnostics.push(new QuarryError(
          declaration.site, `duplicate shape ${declaration.name}; first declared at ${siteText(prior.site)}`,
          "E_QUARRY_UNKNOWN", `remove the duplicate shape ${declaration.name} declaration or import`,
        ).diagnostic);
        else names.set(declaration.name, declaration);
      }
      this.members.set(document, names);
    }
  }

  resolve(document: Document, name: string, useSite: Site, imports: string[] = []): Definition {
    const member = this.members.get(document)?.get(name);
    if (!member) throw new QuarryError(
      useSite, `unknown shape ${name} in ${document.file}`, "E_QUARRY_UNKNOWN",
      `define shape ${name} = { * } in ${document.file}, or import shape ${name} from its module`,
    );
    if (!("module" in member)) return { declaration: member, document };
    const identity = `${document.file}:${name}`;
    if (imports.includes(identity)) throw new QuarryError(
      member.site, `shape import cycle ${[...imports, identity].join(" -> ")}`, "E_QUARRY_UNSUPPORTED",
      `replace one import of ${name} with shape ${name} = { * } and fill in its fields`,
    );
    const target = this.modules.get(join(dirname(document.file), `${member.module}.q`));
    if (!target) throw new QuarryError(
      member.site, `unknown shape module ${member.module}`, "E_QUARRY_UNKNOWN",
      `create snapback/${member.module}.q with shape ${name} = { * }, or correct the module name`,
    );
    return this.resolve(target, name, member.site, [...imports, identity]);
  }
}

class Expander {
  private expandedNodes = 0;
  private expansionId = 0;
  private readonly root: ExpansionContext;
  constructor(document: Document, private readonly registry: ShapeRegistry) {
    this.root = { document, bound: new Set() };
  }

  instantiate(name: string, useSite: Site, depth: number, stack: string[], context = this.root): ShapeField[] {
    const { declaration, document } = this.registry.resolve(context.document, name, useSite);
    this.site(declaration.site, useSite);
    const identity = `${document.file}:${name}`;
    if (stack.includes(identity)) {
      throw new QuarryError(
        declaration.site,
        `shape cycle ${[...stack, identity].join(" -> ")} is not supported; shape ${name} was used at ${siteText(useSite)}`,
        "E_QUARRY_UNSUPPORTED",
        `remove the recursive ${name} shape use`,
      );
    }
    if (depth > MAX_SHAPE_DEPTH) {
      throw new QuarryError(
        declaration.site,
        `shape expansion exceeds depth ${MAX_SHAPE_DEPTH}; shape ${name} was used at ${siteText(useSite)}`,
        "E_QUARRY_UNSUPPORTED",
        `inline or split the projection so it expands through at most ${MAX_SHAPE_DEPTH} named shapes`,
      );
    }
    return this.fields(declaration.fields, useSite, depth, [...stack, identity], true, { document, bound: new Set() });
  }

  statement(statement: Stmt): Stmt {
    if (statement.kind === "bind" || statement.kind === "expr" || statement.kind === "return") {
      return { ...statement, value: this.expression(statement.value) };
    }
    if (statement.kind === "require") return { ...statement, condition: this.expression(statement.condition) };
    if (statement.kind === "emit") return { ...statement, payload: this.expression(statement.payload) };
    if (statement.kind === "if") return {
      ...statement,
      condition: this.expression(statement.condition),
      thenBody: statement.thenBody.map((item) => this.statement(item)),
      elseBody: statement.elseBody.map((item) => this.statement(item)),
    };
    if (statement.kind === "for") return {
      ...statement,
      domain: this.expression(statement.domain),
      body: statement.body.map((item) => this.statement(item)),
    };
    const read = this.expression(statement.read);
    return {
      ...statement,
      read: read as Extract<Expr, { kind: "read" }>,
      someBody: statement.someBody.map((item) => this.statement(item)),
      noneBody: statement.noneBody.map((item) => this.statement(item)),
    };
  }

  expression(expr: Expr, useSite?: Site, depth = 0, stack: string[] = [], context = this.root): Expr {
    const nested = (value: Expr) => this.expression(value, useSite, depth, stack, context);
    if (useSite && expr.kind === "name" && !CONTEXT_NAMES.has(expr.name) && !context.bound.has(expr.name)) {
      throw new QuarryError(
        this.site(expr.site, useSite), `named shapes cannot capture operation name ${expr.name}`,
        "E_QUARRY_UNKNOWN", `use .${expr.name} for a focal-row field, or move the argument-dependent field into the caller's shape block`,
      );
    }
    if (expr.kind === "shapeUse") {
      const outerUse = useSite ?? expr.site;
      return {
        kind: "shape",
        base: nested(expr.base),
        fields: this.instantiate(expr.name, outerUse, depth + 1, stack, context),
        authoredName: expr.name,
        site: this.site(expr.site, useSite),
      };
    }
    if (expr.kind === "shape") {
      const authoredFields = expr.fields.some((field) => field.kind === "namedSpread")
        ? structuredClone(expr.fields)
        : expr.authoredFields;
      return {
        ...expr,
        base: nested(expr.base),
        fields: this.fields(expr.fields, useSite ?? expr.site, depth, stack, !!useSite, context),
        ...(authoredFields ? { authoredFields } : {}),
        site: this.site(expr.site, useSite),
      };
    }
    if (expr.kind === "unary" || expr.kind === "assert") return { ...expr, value: nested(expr.value), site: this.site(expr.site, useSite) };
    if (expr.kind === "binary") return { ...expr, left: nested(expr.left), right: nested(expr.right), site: this.site(expr.site, useSite) };
    if (expr.kind === "member") return { ...expr, base: nested(expr.base), site: this.site(expr.site, useSite) };
    if (expr.kind === "call") return { ...expr, args: expr.args.map(nested), site: this.site(expr.site, useSite) };
    if (expr.kind === "array") return { ...expr, items: expr.items.map(nested), site: this.site(expr.site, useSite) };
    if (expr.kind === "object") return {
      ...expr,
      fields: expr.fields.map((field) => ({
        ...field,
        value: field.value ? nested(field.value) : useSite ? nested({ kind: "name", name: field.name, site: field.site }) : undefined,
        site: this.site(field.site, useSite),
      })),
      site: this.site(expr.site, useSite),
    };
    if (expr.kind === "read") return {
      ...expr,
      keys: expr.keys.map((key) => ({ ...key, value: nested(key.value), site: this.site(key.site, useSite) })),
      range: expr.range && {
        ...expr.range,
        cursor: expr.range.cursor && nested(expr.range.cursor),
        where: expr.range.where && {
          ...expr.range.where,
          predicate: nested(expr.range.where.predicate),
          site: this.site(expr.range.where.site, useSite),
        },
        site: this.site(expr.range.site, useSite),
      },
      site: this.site(expr.site, useSite),
    };
    if (expr.kind === "merge") return {
      ...expr,
      cursor: expr.cursor && nested(expr.cursor),
      lanes: expr.lanes.map((lane) => {
        if (useSite && lane.loop && CONTEXT_NAMES.has(lane.loop.name)) throw new QuarryError(
          this.site(lane.site, useSite), `named-shape merge binder ${lane.loop.name} shadows a context builtin`,
          "E_QUARRY_UNKNOWN", `rename this merge binder to row and use row.<field> in the lane prefix`,
        );
        const laneContext = lane.loop ? { ...context, bound: new Set([...context.bound, lane.loop.name]) } : context;
        return {
          ...lane,
          prefix: lane.prefix.map((value) => this.expression(value, useSite, depth, stack, laneContext)),
          loop: lane.loop && { ...lane.loop, domain: nested(lane.loop.domain) as Extract<Expr, { kind: "read" }> },
          site: this.site(lane.site, useSite),
        };
      }),
      site: this.site(expr.site, useSite),
    };
    if (expr.kind === "exists" || expr.kind === "created") {
      return { ...expr, read: nested(expr.read) as Extract<Expr, { kind: "read" }>, site: this.site(expr.site, useSite) };
    }
    if (expr.kind === "aggregate") return {
      ...expr,
      keys: expr.keys.map((key) => ({ ...key, value: nested(key.value), site: this.site(key.site, useSite) })),
      site: this.site(expr.site, useSite),
    };
    if (expr.kind === "walk") return { ...expr, seed: nested(expr.seed), site: this.site(expr.site, useSite) };
    if (expr.kind === "write") return {
      ...expr,
      keys: expr.keys.map((key) => ({ ...key, value: nested(key.value), site: this.site(key.site, useSite) })),
      fields: expr.fields.map((field) => ({
        ...field,
        value: field.value ? nested(field.value) : useSite ? nested({ kind: "name", name: field.name, site: field.site }) : undefined,
        site: this.site(field.site, useSite),
      })),
      site: this.site(expr.site, useSite),
    };
    return { ...expr, site: this.site(expr.site, useSite) };
  }

  private fields(fields: ShapeField[], useSite: Site, depth: number, stack: string[], annotate: boolean, context: ExpansionContext): ShapeField[] {
    return fields.flatMap((field) => {
      if (field.kind === "namedSpread") return this.instantiate(field.name, useSite, depth + 1, stack, context);
      const site = this.site(field.site, annotate ? useSite : undefined);
      if (field.kind === "field") {
        return [{ ...field, value: this.expression(field.value, annotate ? useSite : undefined, depth, stack, context), site }];
      }
      return [{ ...field, site }];
    });
  }

  private site(site: Site, useSite: Site | undefined): Site {
    if (!useSite) return site;
    this.expandedNodes += 1;
    if (this.expandedNodes > MAX_EXPANDED_NODES) throw new QuarryError(
      { ...site, expandedFrom: useSite.expandedFrom ?? useSite },
      `named shapes expand beyond ${MAX_EXPANDED_NODES} syntax nodes in one operation or declaration`,
      "E_QUARRY_UNSUPPORTED", "remove repeated shape spreads or split the operation into smaller bounded projections",
    );
    return {
      file: site.file, line: site.line, col: site.col,
      expandedFrom: useSite.expandedFrom ?? useSite, expansionId: ++this.expansionId,
    };
  }
}

function caught(error: unknown): QuarryDiagnostic {
  if (error instanceof QuarryError) return error.diagnostic;
  throw error;
}

function siteText(site: Site): string { return `${site.file}:${site.line}:${site.col}`; }

function uniqueDiagnostics(diagnostics: QuarryDiagnostic[]): QuarryDiagnostic[] {
  const seen = new Set<string>();
  return diagnostics.filter((diagnostic) => {
    const key = `${siteText(diagnostic)}\0${diagnostic.code}\0${diagnostic.message}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
