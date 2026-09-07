import { basename } from "node:path";
import type { Provenance } from "../ir";
import type { Expr, IndexDecl, ProgramDecl, ScalarType, Site, TableCatalog, TableDecl } from "./ast";
import { selectIndex } from "./catalog";
import { refuse, unsupported } from "./diagnostics";

export type BoundSourceStack = {
  definition: Site;
  use?: Site;
};

export type BoundTableSymbol = {
  kind: "table";
  id: string;
  name: string;
  declaration: TableDecl;
  source: BoundSourceStack;
};

export type BoundIndexSymbol = {
  kind: "index";
  id: string;
  name: string;
  declaration: IndexDecl;
  table: BoundTableSymbol;
  source: BoundSourceStack;
};

export type BoundArgumentSymbol = {
  kind: "argument";
  id: string;
  name: string;
  type: ScalarType;
  source: BoundSourceStack;
};

export type BoundExpression =
  | {
      kind: "variable";
      symbol: BoundArgumentSymbol;
      type: ScalarType;
      source: BoundSourceStack;
    }
  | {
      kind: "exists";
      read: BoundRead;
      type: Extract<ScalarType, { kind: "bool" }>;
      source: BoundSourceStack;
    };

export type BoundRead = {
  siteId: string;
  table: BoundTableSymbol;
  index: BoundIndexSymbol;
  key: BoundExpression[];
  provenance: Provenance;
  source: BoundSourceStack;
};

export type BoundStatement = {
  kind: "return";
  value: BoundExpression;
  source: BoundSourceStack;
};

export type BoundQuarryProgram = {
  name: string;
  kind: ProgramDecl["kind"];
  args: BoundArgumentSymbol[];
  resultType: ScalarType;
  body: BoundStatement[];
  source: BoundSourceStack;
};

/**
 * First vertical direct-lowering seam. It intentionally accepts only the
 * indexed-existence program used by the parity witness; subsequent slices grow
 * this bound tree before it replaces the generated-TypeScript route.
 */
export function bindQuarryProgram(program: ProgramDecl, catalog: TableCatalog): BoundQuarryProgram {
  const statement = program.body[0];
  if (program.focalTable || program.body.length !== 1 || statement?.kind !== "return"
    || statement.value.kind !== "exists") {
    unsupported(program.site, "this operation in the initial direct Quarry lowering seam", "keep it on the parity oracle until the bound tree supports its expressions");
  }
  const operationName = `${basename(program.site.file, ".q")}.${program.name}`;
  const args = program.args.map((arg, index): BoundArgumentSymbol => ({
    kind: "argument",
    id: `${operationName}:argument:${index}`,
    name: arg.name,
    type: structuredClone(arg.type),
    source: sourceStack(arg.site),
  }));
  const argumentsByName = new Map(args.map((arg) => [arg.name, arg]));
  let accessOrdinal = 0;
  const expression = bindExists(statement.value, catalog, argumentsByName, operationName, () => accessOrdinal++);
  return {
    name: operationName,
    kind: program.kind,
    args,
    resultType: expression.type,
    body: [{ kind: "return", value: expression, source: sourceStack(statement.site) }],
    source: sourceStack(program.site),
  };
}

function bindExists(
  expression: Extract<Expr, { kind: "exists" }>,
  catalog: TableCatalog,
  args: Map<string, BoundArgumentSymbol>,
  operationName: string,
  nextAccess: () => number,
): Extract<BoundExpression, { kind: "exists" }> {
  const tableInfo = catalog.get(expression.read.table);
  if (!tableInfo) refuse(expression.read.site, `unknown table ${expression.read.table}`);
  const table: BoundTableSymbol = {
    kind: "table",
    id: `table:${expression.read.table}`,
    name: expression.read.table,
    declaration: tableInfo.declaration,
    source: sourceStack(tableInfo.declaration.site),
  };
  const infer = (value: Expr): ScalarType | undefined => value.kind === "name" ? args.get(value.name)?.type : undefined;
  const selected = selectIndex(
    catalog,
    expression.read.table,
    expression.read.keys,
    "exists",
    expression.read.index,
    infer,
    expression.read.site,
  );
  const index: BoundIndexSymbol = {
    kind: "index",
    id: `${table.id}:index:${selected.name}`,
    name: selected.name,
    declaration: selected,
    table,
    source: sourceStack(selected.site),
  };
  const key = expression.read.keys.map((part) => bindArgument(part.value, args));
  return {
    kind: "exists",
    read: {
      siteId: `${operationName}.${nextAccess()}`,
      table,
      index,
      key,
      provenance: "Arg",
      source: sourceStack(expression.read.site),
    },
    type: { kind: "bool", optional: false },
    source: sourceStack(expression.site),
  };
}

function bindArgument(expression: Expr, args: Map<string, BoundArgumentSymbol>): Extract<BoundExpression, { kind: "variable" }> {
  if (expression.kind !== "name") {
    unsupported(expression.site, "this key expression in the initial direct Quarry lowering seam", "use an operation argument until direct expression lowering lands");
  }
  const symbol = args.get(expression.name);
  if (!symbol) refuse(expression.site, `unknown operation argument ${expression.name}`);
  return { kind: "variable", symbol, type: symbol.type, source: sourceStack(expression.site) };
}

function sourceStack(site: Site): BoundSourceStack {
  const definition = withoutExpansion(site);
  return site.expandedFrom ? { definition, use: withoutExpansion(site.expandedFrom) } : { definition };
}

function withoutExpansion(site: Site): Site {
  const { expandedFrom: _expandedFrom, expansionId: _expansionId, ...authored } = site;
  return authored;
}
