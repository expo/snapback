import type { ArgType, Expr, IndexKeyExpr, Program, Stmt, Value } from "../ir";
import type { ScalarType } from "./ast";
import type { BoundExpression, BoundQuarryProgram, BoundRead } from "./bound";
import { unsupported } from "./diagnostics";

type Lowering = {
  program: string;
  accessOrdinal: number;
  temporaryOrdinal: number;
  operandOrdinal: number;
  focals: Map<string, Expr>;
  bindings: Map<string, Expr>;
};
type LoweredValue = { setup: Stmt[]; value: Expr };

export function lowerBoundQuarryProgram(program: BoundQuarryProgram): Program {
  const lowering: Lowering = {
    program: program.name, accessOrdinal: 0, temporaryOrdinal: 0, operandOrdinal: 0,
    focals: new Map(), bindings: new Map(),
  };
  const body = program.body.flatMap((statement): Stmt[] => {
    const value = lowerExpression(statement.value, lowering);
    return [...value.setup, { Return: value.value }];
  });
  return {
    name: program.name,
    kind: program.kind === "query" ? "Query" : program.kind === "mutation" ? "Mutation" : "job",
    args: Object.fromEntries([...program.args]
      .sort((left, right) => left.name.localeCompare(right.name))
      .map((arg) => [arg.name, lowerArgType(arg.type)])),
    read_time_granularity_ms: null,
    body,
  };
}

function lowerExpression(expression: BoundExpression, lowering: Lowering): LoweredValue {
  if (expression.kind === "literal") return { setup: [], value: { Literal: literalValue(expression) } };
  if (expression.kind === "variable") {
    return { setup: [], value: lowering.bindings.get(expression.symbol.id) ?? { Variable: expression.symbol.name } };
  }
  if (expression.kind === "focal") {
    const value = lowering.focals.get(expression.id);
    if (!value) throw new Error(`bound focal ${expression.id} has no lowering scope`);
    return { setup: [], value };
  }
  if (expression.kind === "input") return { setup: [], value: { Input: expression.input } };
  if (expression.kind === "array") {
    const items = lowerMany(expression.items, lowering);
    return { setup: items.setup, value: { Array: items.values } };
  }
  if (expression.kind === "object") {
    return lowerObjectFields(expression.fields, lowering);
  }
  if (expression.kind === "unary") {
    const value = lowerExpression(expression.value, lowering);
    return { setup: value.setup, value: { Unary: { op: expression.op, value: value.value } } };
  }
  if (expression.kind === "binary") return lowerBinary(expression, lowering);
  if (expression.kind === "invoke") return lowerInvocation(expression, lowering);
  if (expression.kind === "shape") return lowerShape(expression, lowering);
  if (expression.kind === "member") {
    const loweredBase = lowerExpression(expression.base, lowering);
    if (expression.base.facts.presence === "optional") {
      const baseName = temporary(lowering, "nullableBase");
      const resultName = temporary(lowering, "nullableMember");
      return {
        setup: [
          ...loweredBase.setup,
          { Let: { name: baseName, value: loweredBase.value } },
          { Let: { name: resultName, value: { Literal: "Null" } } },
          { If: {
            condition: { Binary: { op: "Ne", left: { Variable: baseName }, right: { Literal: "Null" } } },
            then_body: [{ Assign: { name: resultName,
              value: { Field: { base: { Variable: baseName }, name: expression.name } } } }],
            else_body: [],
          } },
        ],
        value: { Variable: resultName },
      };
    }
    const base = captureObservable(loweredBase, lowering);
    return { setup: base.setup, value: { Field: { base: base.value, name: expression.name } } };
  }
  if (expression.kind === "builtin") {
    const args = lowerMany(expression.args, lowering);
    return { setup: args.setup, value: { Builtin: { builtin: expression.builtin, args: args.values } } };
  }
  if (expression.kind === "aggregate") return lowerAggregate(expression.read, lowering);
  if (expression.kind === "scan") return lowerScan(expression.read, lowering);
  return lowerPointRead(expression.read, expression.kind, lowering);
}

function lowerInvocation(expression: Extract<BoundExpression, { kind: "invoke" }>, lowering: Lowering): LoweredValue {
  const setup: Stmt[] = [];
  const prior = new Map<string, Expr | undefined>();
  for (const binding of expression.bindings) {
    const value = lowerExpression(binding.value, lowering);
    setup.push(...value.setup);
    const name = temporary(lowering, "fnArgument");
    setup.push({ Const: { name, value: value.value } });
    prior.set(binding.symbol.id, lowering.bindings.get(binding.symbol.id));
    lowering.bindings.set(binding.symbol.id, { Variable: name });
  }
  try {
    const body = lowerExpression(expression.body, lowering);
    return { setup: [...setup, ...body.setup], value: body.value };
  } finally {
    for (const [id, value] of prior) {
      if (value) lowering.bindings.set(id, value);
      else lowering.bindings.delete(id);
    }
  }
}

function lowerShape(expression: Extract<BoundExpression, { kind: "shape" }>, lowering: Lowering): LoweredValue {
  const base = lowerExpression(expression.base, lowering);
  const baseName = temporary(lowering, "shapeBase");
  if (expression.base.facts.type.kind === "page") {
    const resultName = temporary(lowering, "shapeRows");
    const rowName = temporary(lowering, "shapeRow");
    lowering.focals.set(expression.focal.id, { Variable: rowName });
    let object: LoweredValue;
    try {
      object = lowerObjectFields(expression.fields, lowering);
    } finally {
      lowering.focals.delete(expression.focal.id);
    }
    return {
      setup: [
        ...base.setup,
        { Const: { name: baseName, value: base.value } },
        { Const: { name: resultName, value: { Array: [] } } },
        { For: {
          binding: rowName,
          domain: { DerivedArray: {
            value: { Variable: baseName }, max: expression.base.facts.type.max,
            bound_source: `${expression.source.definition.file}:${expression.source.definition.line}:${expression.source.definition.col} bounded shape`,
          } },
          body: [...object.setup, { Push: { target: resultName, value: object.value } }],
        } },
      ],
      value: { Variable: resultName },
    };
  }
  lowering.focals.set(expression.focal.id, { Variable: baseName });
  let object: LoweredValue;
  try {
    object = lowerObjectFields(expression.fields, lowering);
  } finally {
    lowering.focals.delete(expression.focal.id);
  }
  const resultName = temporary(lowering, "shapeResult");
  const setup: Stmt[] = [...base.setup, { Const: { name: baseName, value: base.value } }];
  if (expression.base.facts.presence === "optional") {
    setup.push(
      { Let: { name: resultName, value: { Literal: "Null" } } },
      { If: {
        condition: { Binary: { op: "Ne", left: { Variable: baseName }, right: { Literal: "Null" } } },
        then_body: [...object.setup, { Assign: { name: resultName, value: object.value } }],
        else_body: [],
      } },
    );
  } else {
    setup.push(...object.setup, { Const: { name: resultName, value: object.value } });
  }
  return { setup, value: { Variable: resultName } };
}

function lowerObjectFields(
  fields: Array<{ name: string; value: BoundExpression }>,
  lowering: Lowering,
): LoweredValue {
  const setup: Stmt[] = [];
  const loweredFields: Array<{ name: string; value: Expr }> = [];
  for (const field of fields) {
    const lowered = lowerExpression(field.value, lowering);
    setup.push(...lowered.setup);
    let value = lowered.value;
    // Serde maps are sorted after lowering. Capture order-sensitive fields in
    // authored order before that sort; each input/read/member is evaluated once.
    if (!inlineObjectValue(value)) {
      const name = `__operand${lowering.operandOrdinal++}`;
      setup.push({ Const: { name, value } });
      value = { Variable: name };
    }
    loweredFields.push({ name: field.name, value });
  }
  return {
    setup,
    value: { Object: Object.fromEntries(loweredFields.sort((left, right) => left.name.localeCompare(right.name))
      .map((field) => [field.name, field.value])) },
  };
}

function lowerBinary(
  expression: Extract<BoundExpression, { kind: "binary" }>,
  lowering: Lowering,
): LoweredValue {
  const left = lowerExpression(expression.left, lowering);
  const right = lowerExpression(expression.right, lowering);
  if (expression.op === "Coalesce") {
    const leftName = temporary(lowering, "coalesceLeft");
    const resultName = temporary(lowering, "coalesceResult");
    return {
      setup: [
        ...left.setup,
        { Let: { name: leftName, value: left.value } },
        { Let: { name: resultName, value: { Variable: leftName } } },
        { If: {
          condition: { Binary: { op: "Eq", left: { Variable: leftName }, right: { Literal: "Null" } } },
          then_body: [...right.setup, { Assign: { name: resultName, value: right.value } }],
          else_body: [],
        } },
      ],
      value: { Variable: resultName },
    };
  }
  if ((expression.op === "And" || expression.op === "Or")
    && (right.setup.length > 0 || observableEvaluation(right.value))) {
    const leftName = temporary(lowering, "logicalLeft");
    const resultName = temporary(lowering, "logicalResult");
    const reachedRight = captureObservable(right, lowering);
    const runRight = expression.op === "And"
      ? { Variable: leftName } satisfies Expr
      : { Unary: { op: "Not" as const, value: { Variable: leftName } } } satisfies Expr;
    return {
      setup: [
        ...left.setup,
        { Let: { name: leftName, value: left.value } },
        { Let: { name: resultName, value: { Variable: leftName } } },
        { If: { condition: runRight,
          then_body: [...reachedRight.setup, { Assign: { name: resultName, value: reachedRight.value } }], else_body: [] } },
      ],
      value: { Variable: resultName },
    };
  }
  const operands = captureMany([left, right], lowering);
  return {
    setup: operands.setup,
    value: { Binary: { op: expression.op, left: operands.values[0]!, right: operands.values[1]! } },
  };
}

function lowerPointRead(read: BoundRead, kind: "get" | "exists", lowering: Lowering): LoweredValue {
  // Point-read identities precede identities nested inside their key, matching
  // the established lexical access ordering.
  const site = accessSite(lowering);
  const key = lowerMany(read.key, lowering);
  return {
    setup: key.setup,
    value: { [kind === "get" ? "Get" : "Exists"]: {
      site, table: read.table.name, index: read.index.name,
      key: key.values.map((value, index) => keyValue(read.key[index]!, value)), provenance: read.provenance,
    } } as Expr,
  };
}

function lowerScan(read: BoundRead, lowering: Lowering): LoweredValue {
  const range = read.range;
  if (!range) throw new Error("bound scan has no range");
  const key = lowerMany(read.key, lowering);
  const after = range.after ? lowerExpression(range.after, lowering) : { setup: [], value: null } as const;
  const prefix = key.values.map((value, index): IndexKeyExpr => {
    const component = range.components[index];
    if (!component || !("Column" in component)) {
      unsupported(read.source.definition, "derived search in the basic direct scan seam", "keep search on the parity oracle until held-search lowering lands");
    }
    return { Scalar: keyValue(read.key[index]!, value) };
  });
  // Scan identities follow prefix/cursor expression identities, matching the
  // legacy lexical lowering order.
  const site = accessSite(lowering);
  return {
    setup: [...key.setup, ...after.setup],
    value: { Scan: {
      site, table: read.table.name, index: read.index.name, prefix,
      order: range.order, take: { Literal: range.take }, after: after.value,
      before: null, range: null,
      ...(range.opaqueCursor ? { opaque_cursor: true } : {}),
      merge_site: null, provenance: read.provenance,
    } },
  };
}

function lowerAggregate(read: BoundRead, lowering: Lowering): LoweredValue {
  const row = lowerPointRead(read, "get", lowering);
  const rowName = temporary(lowering, "aggregateRow");
  const resultName = temporary(lowering, "aggregateResult");
  return {
    setup: [
      ...row.setup,
      { Let: { name: rowName, value: row.value } },
      { Let: { name: resultName, value: { Literal: { Int: 0 } } } },
      { If: {
        condition: { Binary: { op: "Ne", left: { Variable: rowName }, right: { Literal: "Null" } } },
        then_body: [{ Assign: { name: resultName, value: { Field: { base: { Variable: rowName }, name: "value" } } } }],
        else_body: [],
      } },
    ],
    value: { Variable: resultName },
  };
}

function lowerMany(expressions: BoundExpression[], lowering: Lowering): { setup: Stmt[]; values: Expr[] } {
  return captureMany(expressions.map((expression) => lowerExpression(expression, lowering)), lowering);
}

function captureMany(values: LoweredValue[], lowering: Lowering): { setup: Stmt[]; values: Expr[] } {
  const setup: Stmt[] = [];
  const captured: Expr[] = [];
  for (const value of values) {
    const lowered = captureObservable(value, lowering);
    setup.push(...lowered.setup);
    captured.push(lowered.value);
  }
  return { setup, values: captured };
}

function captureObservable(value: LoweredValue, lowering: Lowering): LoweredValue {
  if (!observableEvaluation(value.value)) return value;
  const name = `__operand${lowering.operandOrdinal++}`;
  return { setup: [...value.setup, { Const: { name, value: value.value } }], value: { Variable: name } };
}

function keyValue(expression: BoundExpression, value: Expr): Expr {
  return expression.facts.type.kind === "row" ? { Field: { base: value, name: "id" } } : value;
}

function literalValue(expression: Extract<BoundExpression, { kind: "literal" }>): Value {
  if (expression.value === null) return "Null";
  if (typeof expression.value === "boolean") return { Bool: expression.value };
  if (typeof expression.value === "string") return { String: expression.value };
  if (expression.facts.type.kind === "numeric-literal") {
    unsupported(expression.source.definition, "an uncontextualized decimal literal in direct Quarry", "use a typed decimal or money position");
  }
  return { Int: expression.value };
}

function accessSite(lowering: Lowering): string {
  const site = `${lowering.program}.${lowering.accessOrdinal}`;
  lowering.accessOrdinal += 1;
  return site;
}

function temporary(lowering: Lowering, stem: string): string {
  const name = `__bound_${stem}_${lowering.temporaryOrdinal}`;
  lowering.temporaryOrdinal += 1;
  return name;
}

function inlineObjectValue(value: Expr): boolean {
  if ("Literal" in value || "Variable" in value) return true;
  if ("Array" in value) return value.Array.every(inlineObjectValue);
  if ("Object" in value) return Object.values(value.Object).every(inlineObjectValue);
  return false;
}

/** Runtime inputs can allocate, reads can refuse, and numeric operations can
 * fail. Capturing these values before the next operand's setup preserves the
 * authored left-to-right order without relying on expression evaluator order. */
function observableEvaluation(value: unknown): boolean {
  if (!value || typeof value !== "object") return false;
  if ("Input" in value && value.Input === "NewId") return true;
  if ("Field" in value) return true;
  if (["Get", "Exists", "Scan", "Merge", "Builtin"].some((key) => key in value)) return true;
  if ("Binary" in value && value.Binary && typeof value.Binary === "object"
    && "op" in value.Binary && !["Eq", "Ne"].includes(String(value.Binary.op))) return true;
  if ("Unary" in value && value.Unary && typeof value.Unary === "object"
    && "op" in value.Unary && value.Unary.op === "Neg") return true;
  return Object.values(value).some(observableEvaluation);
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
    case "text": return { Text: { max: type.max,
      ...(type.min === undefined ? {} : { min: type.min }),
      ...(type.format === undefined ? {} : { format: type.format }) } };
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
