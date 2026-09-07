import type { ArgType, Expr, Program, Stmt } from "../ir";
import type { ScalarType } from "./ast";
import type { BoundExpression, BoundQuarryProgram } from "./bound";

export function lowerBoundQuarryProgram(program: BoundQuarryProgram): Program {
  return {
    name: program.name,
    kind: program.kind === "query" ? "Query" : program.kind === "mutation" ? "Mutation" : "job",
    args: Object.fromEntries(program.args.map((arg) => [arg.name, lowerArgType(arg.type)])),
    read_time_granularity_ms: null,
    body: program.body.map((statement): Stmt => ({ Return: lowerExpression(statement.value) })),
  };
}

function lowerExpression(expression: BoundExpression): Expr {
  if (expression.kind === "variable") return { Variable: expression.symbol.name };
  return {
    Exists: {
      site: expression.read.siteId,
      table: expression.read.table.name,
      index: expression.read.index.name,
      key: expression.read.key.map(lowerExpression),
      provenance: expression.read.provenance,
    },
  };
}

function lowerArgType(type: ScalarType): ArgType {
  const required = lowerRequiredArgType(type);
  return type.optional ? { Optional: required } : required;
}

function lowerRequiredArgType(type: ScalarType): ArgType {
  switch (type.kind) {
    case "cursor": return "Cursor";
    case "id": return "Id";
    case "principal": return "Principal";
    case "int": return "Int";
    case "bool": return "Bool";
    case "time": return "Time";
    case "text": return { Text: {
      max: type.max,
      ...(type.min === undefined ? {} : { min: type.min }),
      ...(type.format === undefined ? {} : { format: type.format }),
    } };
    case "bytes": return { Bytes: { max: type.max } };
    case "image": return { Image: { max: type.max } };
    case "video": return { Video: { max: type.max } };
    case "json": return { Json: { max_bytes: type.max } };
    case "enum": return { Enum: { variants: [...type.variants] } };
    case "decimal": return { Decimal: { scale: type.scale } };
    case "money": return { Money: { currency: type.currency, scale: type.scale } };
    case "ref": return { Ref: { table: type.table } };
    case "list": return { List: { of: lowerArgType(type.item), max: type.max } };
  }
}
