import { basename, dirname, join } from "node:path";
import type { Document, FunctionDecl, ProcDecl, ShapeDecl, Site } from "./ast";
import { QuarryError, nameRewrite } from "./diagnostics";

export type BoundShapeDefinition = { declaration: ShapeDecl; document: Document };

export class BoundShapeRegistry {
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

  resolve(file: string, name: string, useSite: Site, imports: string[] = []): BoundShapeDefinition {
    const document = this.modules.get(file);
    const member = document && this.members.get(document)?.get(name);
    if (!document || !member) throw new QuarryError(
      useSite, `unknown shape ${name} in ${file}`, "E_QUARRY_UNKNOWN",
      nameRewrite(name, document ? this.members.get(document)?.keys() ?? [] : []),
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
      nameRewrite(member.module, [...this.modules.keys()].map(file => basename(file, ".q"))),
    );
    return this.resolve(target.file, name, member.site, [...imports, identity]);
  }
}

export type BoundFunctionDefinition = { declaration: FunctionDecl; document: Document };

export type BoundProcDefinition = { declaration: ProcDecl; document: Document };

// @ref LLP 1018.005#2-elaboration — procs resolve like fns: module-local names,
// imports by module, duplicates and import cycles refused; one name space with fn.
export class BoundProcRegistry {
  private readonly modules: Map<string, Document>;
  private readonly members = new Map<Document, Map<string, ProcDecl | Document["procImports"][number]>>();

  constructor(documents: Document[]) {
    this.modules = new Map(documents.map((document) => [document.file, document]));
    for (const document of documents) {
      const names = new Map<string, ProcDecl | Document["procImports"][number]>();
      const functionNames = new Set([...document.functions, ...document.functionImports].map((declaration) => declaration.name));
      for (const declaration of [...document.procs, ...document.procImports]) {
        const prior = names.get(declaration.name);
        if (prior) throw new QuarryError(
          declaration.site,
          `duplicate proc ${declaration.name}; first declared at ${siteText(prior.site)}`,
          "E_QUARRY_UNKNOWN", `remove the duplicate proc ${declaration.name} declaration or import`,
        );
        if (functionNames.has(declaration.name)) throw new QuarryError(
          declaration.site,
          `proc ${declaration.name} shares its name with a fn in this module`,
          "E_QUARRY_UNKNOWN", `rename proc ${declaration.name}; fn and proc share one name space`,
        );
        names.set(declaration.name, declaration);
      }
      this.members.set(document, names);
    }
  }

  names(file: string): string[] {
    const document = this.modules.get(file);
    return document ? [...(this.members.get(document)?.keys() ?? [])] : [];
  }

  has(file: string, name: string): boolean {
    const document = this.modules.get(file);
    return !!document && this.members.get(document)?.has(name) === true;
  }

  resolve(file: string, name: string, useSite: Site, imports: string[] = []): BoundProcDefinition {
    const document = this.modules.get(file);
    const member = document && this.members.get(document)?.get(name);
    if (!document || !member) throw new QuarryError(
      useSite, `unknown proc ${name} in ${file}`, "E_QUARRY_UNKNOWN",
      nameRewrite(name, document ? this.members.get(document)?.keys() ?? [] : []),
    );
    if (!("module" in member)) return { declaration: member, document };
    const identity = `proc:${document.file}:${name}`;
    if (imports.includes(identity)) throw new QuarryError(
      member.site, `proc import cycle ${[...imports, identity].join(" -> ")}`, "E_QUARRY_UNSUPPORTED",
      `replace one import of ${name} with a local proc declaration`,
    );
    const target = this.modules.get(join(dirname(document.file), `${member.module}.q`));
    if (!target) throw new QuarryError(
      member.site, `unknown module ${member.module} for proc ${name}`, "E_QUARRY_UNKNOWN",
      nameRewrite(member.module, [...this.modules.keys()].map(file => basename(file, ".q"))),
    );
    return this.resolve(target.file, name, member.site, [...imports, identity]);
  }
}

export class BoundFunctionRegistry {
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

  names(file: string): string[] {
    const document = this.modules.get(file);
    return document ? [...(this.members.get(document)?.keys() ?? [])] : [];
  }

  has(file: string, name: string): boolean {
    const document = this.modules.get(file);
    return !!document && this.members.get(document)?.has(name) === true;
  }

  resolve(file: string, name: string, useSite: Site, imports: string[] = []): BoundFunctionDefinition {
    const document = this.modules.get(file);
    const member = document && this.members.get(document)?.get(name);
    if (!document || !member) throw new QuarryError(
      useSite, `unknown fn ${name} in ${file}`, "E_QUARRY_UNKNOWN",
      nameRewrite(name, document ? this.members.get(document)?.keys() ?? [] : []),
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
      nameRewrite(member.module, [...this.modules.keys()].map(file => basename(file, ".q"))),
    );
    return this.resolve(target.file, name, member.site, [...imports, identity]);
  }
}

function siteText(site: Site): string { return `${site.file}:${site.line}:${site.col}`; }
