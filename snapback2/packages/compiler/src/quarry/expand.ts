import type { Document, Expr, ProgramDecl, QuarryDiagnostic, ShapeDecl, ShapeField, Site, Stmt } from "./ast";
import { QuarryError } from "./diagnostics";

const MAX_SHAPE_DEPTH = 8;

// @ref LLP 1011#b2-shape — named projections are macro-like AST data: every
// field keeps its definition site while the generated read work belongs to the caller.
export function expandDocuments(documents: Document[]): { documents: Document[]; diagnostics: QuarryDiagnostic[] } {
  const diagnostics: QuarryDiagnostic[] = [];
  const expanded = documents.map((document) => {
    const definitions = new Map<string, ShapeDecl>();
    for (const shape of document.shapes) {
      if (definitions.has(shape.name)) {
        diagnostics.push(new QuarryError(
          shape.site,
          `duplicate shape ${shape.name}`,
          "E_QUARRY_UNKNOWN",
          `rename shape ${shape.name} or remove this declaration`,
        ).diagnostic);
      } else definitions.set(shape.name, shape);
    }
    if (diagnostics.length > 0) return document;

    const expander = new Expander(definitions);
    for (const shape of document.shapes) {
      try {
        expander.instantiate(shape.name, shape.site, 1, []);
      } catch (error) {
        diagnostics.push(caught(error));
      }
    }
    const programs: ProgramDecl[] = [];
    for (const program of document.programs) {
      try {
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

class Expander {
  constructor(private readonly definitions: Map<string, ShapeDecl>) {}

  instantiate(name: string, useSite: Site, depth: number, stack: string[]): ShapeField[] {
    const declaration = this.definitions.get(name);
    if (!declaration) {
      throw new QuarryError(
        useSite,
        `unknown shape ${name}`,
        "E_QUARRY_UNKNOWN",
        `define shape ${name} = { * } in this operation module`,
      );
    }
    if (stack.includes(name)) {
      throw new QuarryError(
        declaration.site,
        `shape cycle ${[...stack, name].join(" -> ")} is not supported; shape ${name} was used at ${siteText(useSite)}`,
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
    return this.fields(declaration.fields, useSite, depth, [...stack, name], true);
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

  expression(expr: Expr, useSite?: Site, depth = 0, stack: string[] = []): Expr {
    const nested = (value: Expr) => this.expression(value, useSite, depth, stack);
    if (expr.kind === "shapeUse") {
      const outerUse = useSite ?? expr.site;
      return {
        kind: "shape",
        base: nested(expr.base),
        fields: this.instantiate(expr.name, outerUse, depth + 1, stack),
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
        fields: this.fields(expr.fields, useSite ?? expr.site, depth, stack, !!useSite),
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
      fields: expr.fields.map((field) => ({ ...field, value: field.value && nested(field.value), site: this.site(field.site, useSite) })),
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
      lanes: expr.lanes.map((lane) => ({
        ...lane,
        prefix: lane.prefix.map(nested),
        loop: lane.loop && { ...lane.loop, domain: nested(lane.loop.domain) as Extract<Expr, { kind: "read" }> },
        site: this.site(lane.site, useSite),
      })),
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
      fields: expr.fields.map((field) => ({ ...field, value: field.value && nested(field.value), site: this.site(field.site, useSite) })),
      site: this.site(expr.site, useSite),
    };
    return { ...expr, site: this.site(expr.site, useSite) };
  }

  private fields(fields: ShapeField[], useSite: Site, depth: number, stack: string[], annotate: boolean): ShapeField[] {
    return fields.flatMap((field) => {
      if (field.kind === "namedSpread") return this.instantiate(field.name, useSite, depth + 1, stack);
      const site = this.site(field.site, annotate ? useSite : undefined);
      if (field.kind === "field") {
        return [{ ...field, value: this.expression(field.value, annotate ? useSite : undefined, depth, stack), site }];
      }
      return [{ ...field, site }];
    });
  }

  private site(site: Site, useSite: Site | undefined): Site {
    return useSite
      ? { file: site.file, line: site.line, col: site.col, expandedFrom: useSite.expandedFrom ?? useSite }
      : site;
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
