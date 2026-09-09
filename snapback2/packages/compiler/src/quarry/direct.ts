import type { ArgType, Expr, IndexKeyExpr, Program, SourceSite, Stmt, Value } from "../ir";
import type { ScalarType } from "./ast";
import type { BoundExpression, BoundQuarryProgram, BoundRead, BoundSourceStack, BoundStatement } from "./bound";
import { unsupported } from "./diagnostics";

type Lowering = {
  program: string;
  accessOrdinal: number;
  temporaryOrdinal: number;
  operandOrdinal: number;
  usesReadTime: boolean;
  sources: Array<[string, SourceSite]>;
  loopOrdinals: Map<string, number>;
  reservedNames: Set<string>;
  focals: Map<string, Expr>;
  bindings: Map<string, Expr>;
};
type LoweredValue = { setup: Stmt[]; value: Expr };

export function lowerBoundQuarryProgram(program: BoundQuarryProgram): Program {
  return lowerBoundQuarryArtifact(program).program;
}

export function lowerBoundQuarryArtifact(program: BoundQuarryProgram): {
  program: Program;
  sources: Array<[string, SourceSite]>;
} {
  const lowering: Lowering = {
    program: program.name, accessOrdinal: 0, temporaryOrdinal: 0, operandOrdinal: 0, usesReadTime: false,
    sources: [], loopOrdinals: new Map(),
    reservedNames: new Set([...program.args.map((arg) => arg.name), ...boundLocalNames(program.body)]),
    focals: new Map(), bindings: new Map(),
  };
  if (program.focal) lowering.focals.set(program.focal.id, { Object: Object.fromEntries(program.args
    .map((arg): [string, Expr] => [arg.name, { Variable: arg.name }])
    .sort(([left], [right]) => left.localeCompare(right))) });
  const body = lowerStatements(program.body, lowering);
  if (program.kind !== "job" && statementsFallThrough(program.body)) body.push({ Return: { Literal: "Null" } });
  return { program: {
    name: program.name,
    kind: program.kind === "query" ? "Query" : program.kind === "mutation" ? "Mutation" : "job",
    args: Object.fromEntries([...program.args]
      .sort((left, right) => left.name.localeCompare(right.name))
      .map((arg) => [arg.name, lowerArgType(arg.type)])),
    read_time_granularity_ms: lowering.usesReadTime ? 1 : null,
    body,
  }, sources: lowering.sources };
}

function lowerExpression(expression: BoundExpression, lowering: Lowering): LoweredValue {
  if (expression.kind === "literal") return { setup: [], value: { Literal: literalValue(expression) } };
  if (expression.kind === "variable") {
    const binding = lowering.bindings.get(expression.symbol.id);
    if (binding) return { setup: [], value: binding };
    if (expression.symbol.kind === "local") throw new Error(`bound local ${expression.symbol.id} has no lowering scope`);
    return { setup: [], value: { Variable: expression.symbol.name } };
  }
  if (expression.kind === "focal") {
    const value = lowering.focals.get(expression.id);
    if (!value) throw new Error(`bound focal ${expression.id} has no lowering scope`);
    return { setup: [], value };
  }
  if (expression.kind === "input") {
    if (expression.input === "ReadTime") lowering.usesReadTime = true;
    return { setup: [], value: { Input: expression.input } };
  }
  if (expression.kind === "array") {
    const items = lowerMany(expression.items, lowering);
    return { setup: items.setup, value: { Array: items.values } };
  }
  if (expression.kind === "scale") {
    const value = captureObservable(lowerExpression(expression.value, lowering), lowering);
    const scaled = { Binary: {
      op: "Mul" as const, left: value.value, right: { Literal: { Int: expression.multiplier } },
    } } satisfies Expr;
    if (!expression.preserveNull) return { setup: value.setup, value: scaled };
    const result = temporary(lowering, "scaledOptional");
    return { setup: [...value.setup,
      { Let: { name: result, value: { Literal: "Null" } } },
      { If: { condition: { Binary: { op: "Ne", left: value.value, right: { Literal: "Null" } } },
        then_body: [{ Assign: { name: result, value: scaled } }], else_body: [] } }], value: { Variable: result } };
  }
  if (expression.kind === "scale-list") return lowerScaledList(expression, lowering);
  if (expression.kind === "object") {
    return lowerObjectFields(expression.fields, lowering);
  }
  if (expression.kind === "unary") {
    const value = lowerExpression(expression.value, lowering);
    return { setup: value.setup, value: { Unary: { op: expression.op, value: value.value } } };
  }
  if (expression.kind === "binary") return lowerBinary(expression, lowering);
  if (expression.kind === "assert") {
    const value = captureObservable(lowerExpression(expression.value, lowering), lowering);
    return {
      setup: [...value.setup, { Require: { condition: {
        Binary: { op: "Ne", left: value.value, right: { Literal: "Null" } },
      }, code: expression.code, site: requireSite(expression.source) } }],
      value: value.value,
    };
  }
  if (expression.kind === "invoke") return lowerInvocation(expression, lowering);
  if (expression.kind === "shape") return lowerShape(expression, lowering);
  if (expression.kind === "range") return lowerRange(expression, lowering);
  if (expression.kind === "walk") return lowerWalk(expression, lowering);
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
  if (expression.kind === "merge") return lowerMerge(expression, lowering);
  if (expression.kind === "aggregate") return lowerAggregate(expression.read, lowering);
  if (expression.kind === "scan") return lowerScan(expression.read, lowering);
  if (expression.kind === "write") return lowerWrite(expression, lowering, true);
  return lowerPointRead(expression.read, expression.kind, lowering);
}

function lowerStatements(statements: BoundStatement[], lowering: Lowering): Stmt[] {
  const body: Stmt[] = [];
  for (const statement of statements) {
    if (statement.kind === "return") {
      const value = lowerExpression(statement.value, lowering);
      body.push(...value.setup, { Return: value.value });
      continue;
    }
    if (statement.kind === "expr") {
      const value = statement.value.kind === "write"
        ? lowerWrite(statement.value, lowering, statement.completion)
        : lowerExpression(statement.value, lowering);
      body.push(...value.setup);
      if (statement.completion) body.push({ Return: value.value });
      continue;
    }
    if (statement.kind === "bind") {
      const value = lowerExpression(statement.value, lowering);
      body.push(...value.setup);
      const valueName = temporary(lowering, "localValue");
      body.push({ Const: { name: valueName, value: value.value } });
      if (statement.symbols.length === 1) {
        lowering.bindings.set(statement.symbols[0]!.id, { Variable: valueName });
      } else {
        for (const [index, symbol] of statement.symbols.entries()) {
          const name = temporary(lowering, "localPart");
          const field = statement.tupleFields?.[index];
          if (!field) throw new Error("bound tuple local has no field identity");
          body.push({ Const: { name, value: { Field: { base: { Variable: valueName }, name: field } } } });
          lowering.bindings.set(symbol.id, { Variable: name });
        }
      }
      continue;
    }
    if (statement.kind === "require") {
      const condition = captureObservable(lowerExpression(statement.condition, lowering), lowering);
      body.push(...condition.setup, { Require: { condition: condition.value, code: statement.code, site: requireSite(statement.source) } });
      continue;
    }
    if (statement.kind === "emit") {
      const payload = lowerExpression(statement.payload, lowering);
      body.push(...payload.setup, { Emit: { effect: statement.effect, payload: payload.value } });
      continue;
    }
    if (statement.kind === "if") {
      const condition = captureObservable(lowerExpression(statement.condition, lowering), lowering);
      const outerBindings = new Map(lowering.bindings);
      lowering.bindings = new Map(outerBindings);
      const thenBody = lowerStatements(statement.thenBody, lowering);
      lowering.bindings = new Map(outerBindings);
      const elseBody = lowerStatements(statement.elseBody, lowering);
      lowering.bindings = outerBindings;
      body.push(...condition.setup, { If: { condition: condition.value, then_body: thenBody, else_body: elseBody } });
      continue;
    }
    if (statement.kind === "invoke") {
      // @ref LLP 1018.005#3-the-bound-tree-and-its-lowering — one Const per
      // argument, then the body's statements; the whole binding map is restored
      // after, so nothing the proc bound becomes an export of the invocation.
      const outerBindings = new Map(lowering.bindings);
      for (const binding of statement.bindings) {
        const value = lowerExpression(binding.value, lowering);
        body.push(...value.setup);
        const name = temporary(lowering, "procArgument");
        const captured = binding.coercion === "row-id"
          ? { Field: { base: value.value, name: "id" } } satisfies Expr
          : value.value;
        body.push({ Const: { name, value: captured } });
        lowering.bindings.set(binding.symbol.id, { Variable: name });
      }
      try {
        body.push(...lowerStatements(statement.body, lowering));
      } finally {
        lowering.bindings = outerBindings;
      }
      continue;
    }
    if (statement.kind === "for") {
      const domain = statement.domain.kind === "range"
        ? { setup: [], value: { Literal: "Null" } as Expr }
        : statement.domain.kind === "array" ? lowerLoopArray(statement.domain, lowering)
          : lowerExpression(statement.domain, lowering);
      const binding = temporary(lowering, "loopItem");
      let loopDomain: Extract<Stmt, { For: unknown }>["For"]["domain"];
      if (statement.domain.kind === "range") {
        loopDomain = { LiteralRange: { start: statement.domain.start, end_exclusive: statement.domain.end } };
      } else if (statement.domain.facts.type.kind === "page" && "Scan" in domain.value) {
        loopDomain = { Page: domain.value.Scan };
      } else if (statement.domain.facts.type.kind === "list" && statement.domain.kind === "variable"
        && statement.domain.symbol.kind === "argument" && !lowering.bindings.has(statement.domain.symbol.id)) {
        // A program's own list argument; a fn or proc parameter has a lowered binding and loops over its captured actual (LLP 1018.005 §2).
        loopDomain = { ArgList: { name: statement.domain.symbol.name, max: statement.domain.facts.type.max } };
      } else {
        const max = statement.domain.facts.max
          ?? ("max" in statement.domain.facts.type ? statement.domain.facts.type.max : undefined);
        if (max === undefined) throw new Error("bound loop domain has no static maximum");
        loopDomain = { DerivedArray: {
          value: domain.value, max,
          bound_source: `${statement.source.definition.file}:${statement.source.definition.line}:${statement.source.definition.col} bounded loop`,
        } };
      }
      const prior = lowering.bindings.get(statement.symbol.id);
      lowering.bindings.set(statement.symbol.id, { Variable: binding });
      const loopBody = lowerStatements(statement.body, lowering);
      if (prior) lowering.bindings.set(statement.symbol.id, prior);
      else lowering.bindings.delete(statement.symbol.id);
      recordLoopSource(lowering, binding, statement.source);
      body.push(...domain.setup, { For: { binding, domain: loopDomain, body: loopBody } });
      continue;
    }
    const matched = lowerExpression(statement.value, lowering);
    const matchName = temporary(lowering, "matchValue");
    const rowName = temporary(lowering, "matchRow");
    const outerBindings = new Map(lowering.bindings);
    lowering.bindings = new Map(outerBindings);
    lowering.bindings.set(statement.symbol.id, { Variable: rowName });
    const someBody = [{ Const: { name: rowName, value: { Variable: matchName } } } satisfies Stmt,
      ...lowerStatements(statement.someBody, lowering)];
    lowering.bindings = new Map(outerBindings);
    const noneBody = lowerStatements(statement.noneBody, lowering);
    lowering.bindings = outerBindings;
    body.push(...matched.setup, { Const: { name: matchName, value: matched.value } }, { If: {
      condition: { Binary: { op: "Ne", left: { Variable: matchName }, right: { Literal: "Null" } } },
      then_body: someBody, else_body: noneBody,
    } });
  }
  return body;
}

function boundLocalNames(statements: BoundStatement[]): string[] {
  return statements.flatMap((statement) => {
    if (statement.kind === "bind") return statement.symbols.map((symbol) => symbol.name);
    if (statement.kind === "if") return [...boundLocalNames(statement.thenBody), ...boundLocalNames(statement.elseBody)];
    if (statement.kind === "for") return [statement.symbol.name, ...boundLocalNames(statement.body)];
    if (statement.kind === "match") return [
      statement.symbol.name, ...boundLocalNames(statement.someBody), ...boundLocalNames(statement.noneBody),
    ];
    return [];
  });
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

function lowerLoopArray(expression: Extract<BoundExpression, { kind: "array" }>, lowering: Lowering): LoweredValue {
  const items = expression.items.map((item) => lowerExpression(item, lowering));
  if (items.every((item) => item.setup.length === 0)) return { setup: [], value: { Array: items.map((item) => item.value) } };
  const captured = captureMany(items, lowering);
  return { setup: captured.setup, value: { Array: captured.values } };
}

function lowerRange(expression: Extract<BoundExpression, { kind: "range" }>, lowering: Lowering): LoweredValue {
  const result = temporary(lowering, "rangeValues");
  const item = temporary(lowering, "rangeValue");
  recordLoopSource(lowering, item, expression.source);
  return {
    setup: [
      { Const: { name: result, value: { Array: [] } } },
      { For: { binding: item, domain: { LiteralRange: { start: expression.start, end_exclusive: expression.end } },
        body: [{ Push: { target: result, value: { Variable: item } } }] } },
    ],
    value: { Variable: result },
  };
}

function lowerScaledList(
  expression: Extract<BoundExpression, { kind: "scale-list" }>,
  lowering: Lowering,
): LoweredValue {
  const source = captureObservable(lowerExpression(expression.value, lowering), lowering);
  const result = temporary(lowering, "scaledList");
  const item = temporary(lowering, "scaledItem");
  recordLoopSource(lowering, item, expression.source);
  const converted: Stmt[] = [
    { Const: { name: result, value: { Array: [] } } },
    { For: { binding: item, domain: { DerivedArray: {
      value: source.value, max: expression.max,
      bound_source: `${expression.source.definition.file}:${expression.source.definition.line}:${expression.source.definition.col} whole-unit conversion`,
    } }, body: [{ Push: { target: result, value: { Binary: {
      op: "Mul", left: { Variable: item }, right: { Literal: { Int: expression.multiplier } },
    } } } }] } },
  ];
  if (expression.preserveNull) {
    const optionalResult = temporary(lowering, "scaledOptionalList");
    return {
      setup: [...source.setup,
        { Let: { name: optionalResult, value: { Literal: "Null" } } },
        { If: { condition: { Binary: { op: "Ne", left: source.value, right: { Literal: "Null" } } },
          then_body: [...converted, { Assign: { name: optionalResult, value: { Variable: result } } }], else_body: [] } }],
      value: { Variable: optionalResult },
    };
  }
  return {
    setup: [...source.setup, ...converted],
    value: { Variable: result },
  };
}

function lowerWalk(expression: Extract<BoundExpression, { kind: "walk" }>, lowering: Lowering): LoweredValue {
  // Like point reads, the traversal owns its lexical access identity before
  // evaluating the seed expression's nested reads.
  const site = accessSite(lowering, expression.source);
  const seed = captureObservable(lowerExpression(expression.seed, lowering), lowering);
  const result = temporary(lowering, "walkRows");
  const row = temporary(lowering, "walkRow");
  recordLoopSource(lowering, row, expression.source);
  return {
    setup: [
      ...seed.setup,
      { Const: { name: result, value: { Array: [] } } },
      { For: { binding: row, domain: { Recurse: {
        site, table: expression.table.name, index: expression.index.name, seed: keyValue(expression.seed, seed.value),
        next_field: expression.column, depth: expression.depth, fanout: 1, provenance: "Shape",
      } }, body: [{ Push: { target: result, value: { Variable: row } } }] } },
    ],
    value: { Variable: result },
  };
}

function lowerWrite(
  expression: Extract<BoundExpression, { kind: "write" }>,
  lowering: Lowering,
  resultUsed: boolean,
): LoweredValue {
  if (expression.op === "insert") {
    const idField = expression.fields.find((field) => field.name === "id");
    const fields = idField ? expression.fields : [{
      name: "id", expected: { kind: "id", optional: false } as const,
      value: { kind: "input", input: "NewId", facts: {
        type: { kind: "id", optional: false }, presence: "required", origin: "Computed",
      }, source: expression.source } as BoundExpression,
      source: expression.source,
    }, ...expression.fields];
    const row = lowerWriteFields(fields, lowering, new Map());
    accessSite(lowering, expression.source);
    if (!resultUsed) return {
      setup: [...row.setup, { Insert: { table: dataTableName(expression.table.name), row: row.value } }],
      value: { Literal: "Null" },
    };
    const rowName = temporary(lowering, "insertRow");
    return {
      setup: [...row.setup, { Const: { name: rowName, value: row.value } },
        { Insert: { table: dataTableName(expression.table.name), row: { Variable: rowName } } }],
      value: { Variable: rowName },
    };
  }
  if (!expression.index || expression.key.length === 0) throw new Error("bound write has no point address");
  const keys = lowerMany(expression.key, lowering);
  const keyValues = keys.values.map((value, index) => keyValue(expression.key[index]!, value));
  const directId = expression.index.name === "byId" && keyValues.length === 1;
  const setup: Stmt[] = [...keys.setup];
  let row: Expr | undefined;
  let identity: Expr = keyValues[0]!;
  if (!directId || expression.usesFocal) {
    const rowName = temporary(lowering, "writeRow");
    setup.push({ Const: { name: rowName, value: { Get: {
      site: accessSite(lowering, expression.source), table: dataTableName(expression.table.name), index: expression.index.name,
      key: keyValues, provenance: expression.provenance,
    } } } });
    row = { Variable: rowName };
    if (!directId) {
      if (expression.op === "delete" || expression.op === "update") setup.push({ Require: {
        condition: { Binary: { op: "Ne", left: row, right: { Literal: "Null" } } }, code: "NOT_FOUND", site: requireSite(expression.source),
      } });
      identity = { Field: { base: row, name: "id" } };
    }
  }
  if (expression.op === "delete") {
    accessSite(lowering, expression.source);
    setup.push({ Delete: { table: dataTableName(expression.table.name), key: identity } });
    return { setup, value: { Literal: "Null" } };
  }
  if (expression.focal && row) lowering.focals.set(expression.focal.id, row);
  try {
    const replacements = new Map<string, Expr>();
    expression.addressedColumns.forEach((column, index) => replacements.set(column, keyValues[index]!));
    if (expression.op === "update") {
      const patch = lowerWriteFields(
        expression.fields.filter((field) => !replacements.has(field.name)), lowering, new Map(),
      );
      accessSite(lowering, expression.source);
      setup.push(...patch.setup, { Update: { table: dataTableName(expression.table.name), key: identity, patch: patch.value } });
    } else {
      if (!directId) {
        const identityName = temporary(lowering, "upsertId");
        setup.push({ Let: { name: identityName, value: { Literal: "Null" } } }, { If: {
          condition: { Binary: { op: "Ne", left: row!, right: { Literal: "Null" } } },
          then_body: [{ Assign: { name: identityName, value: identity } }],
          else_body: [{ Assign: { name: identityName, value: { Input: "NewId" } } }],
        } });
        identity = { Variable: identityName };
      }
      replacements.set("id", identity);
      const present = new Set(expression.fields.map((field) => field.name));
      const injected = expression.addressedColumns
        .flatMap((column, index) => present.has(column) || column === "id" ? [] : [{
          name: column, expected: expression.table.declaration.columns.find((field) => field.name === column)!.type,
          value: expression.key[index]!, source: expression.source,
        }]);
      const builtRow = lowerWriteFields([
        { name: "id", expected: { kind: "id", optional: false } as const,
          value: expression.key[0]!, source: expression.source },
        ...injected, ...expression.fields,
      ], lowering, replacements);
      accessSite(lowering, expression.source);
      setup.push(...builtRow.setup, { Upsert: { table: dataTableName(expression.table.name), key: identity, row: builtRow.value } });
    }
  } finally {
    if (expression.focal && row) lowering.focals.delete(expression.focal.id);
  }
  if (!resultUsed) return { setup, value: { Literal: "Null" } };
  return {
    setup,
    value: { Get: { site: accessSite(lowering, expression.source), table: dataTableName(expression.table.name), index: "byId",
      key: [identity], provenance: expression.provenance } },
  };
}

function lowerWriteFields(
  fields: Extract<BoundExpression, { kind: "write" }>["fields"],
  lowering: Lowering,
  replacements: Map<string, Expr>,
): LoweredValue {
  const setup: Stmt[] = [];
  const entries: Array<{ name: string; value: Expr }> = [];
  for (const field of fields) {
    const replacement = replacements.get(field.name);
    let value: Expr;
    if (replacement) value = replacement;
    else {
      const lowered = captureObservable(lowerExpression(field.value, lowering), lowering);
      setup.push(...lowered.setup);
      value = field.coercion === "row-id" ? { Field: { base: lowered.value, name: "id" } } : lowered.value;
    }
    entries.push({ name: field.name, value });
  }
  return { setup, value: { Object: Object.fromEntries(entries
    .sort((left, right) => left.name.localeCompare(right.name)).map((field) => [field.name, field.value])) } };
}

function lowerInvocation(expression: Extract<BoundExpression, { kind: "invoke" }>, lowering: Lowering): LoweredValue {
  const setup: Stmt[] = [];
  const prior = new Map<string, Expr | undefined>();
  for (const binding of expression.bindings) {
    const value = lowerExpression(binding.value, lowering);
    setup.push(...value.setup);
    const name = temporary(lowering, "fnArgument");
    const captured = binding.coercion === "row-id"
      ? { Field: { base: value.value, name: "id" } } satisfies Expr
      : value.value;
    setup.push({ Const: { name, value: captured } });
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
    recordLoopSource(lowering, rowName, expression.source);
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
      const name = operand(lowering);
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
  if (expression.scaleDivisor !== undefined) {
    return {
      setup: operands.setup,
      value: { Field: { base: { Builtin: { builtin: { Divmod: { remainder_sink: "lexicographic-id" } }, args: [
        { Binary: { op: expression.op, left: operands.values[0]!, right: operands.values[1]! } },
        { Literal: { Int: expression.scaleDivisor } },
      ] } }, name: "quotient" } },
    };
  }
  return {
    setup: operands.setup,
    value: { Binary: { op: expression.op, left: operands.values[0]!, right: operands.values[1]! } },
  };
}

function lowerPointRead(read: BoundRead, kind: "get" | "exists", lowering: Lowering): LoweredValue {
  // Point-read identities precede identities nested inside their key, matching
  // the established lexical access ordering.
  const site = accessSite(lowering, read.source);
  const key = lowerMany(read.key, lowering);
  const readValue = { [kind === "get" ? "Get" : "Exists"]: {
    site, table: dataTableName(read.table.name), index: read.index.name,
    key: key.values.map((value, index) => keyValue(read.key[index]!, value)), provenance: read.provenance,
  } } as Expr;
  if (read.skipNullKey) {
    if (kind !== "get" || key.values.length !== 1) throw new Error("null-skipping point read is not a unary get");
    const keyName = temporary(lowering, "derefKey");
    const resultName = temporary(lowering, "derefResult");
    const deferred: Expr = { Get: { site, table: dataTableName(read.table.name), index: read.index.name,
      key: [{ Variable: keyName }], provenance: read.provenance } };
    return {
      setup: [...key.setup,
        { Const: { name: keyName, value: key.values[0]! } },
        { Let: { name: resultName, value: { Literal: "Null" } } },
        { If: { condition: { Binary: { op: "Ne", left: { Variable: keyName }, right: { Literal: "Null" } } },
          then_body: [{ Assign: { name: resultName, value: deferred } }], else_body: [] } }],
      value: { Variable: resultName },
    };
  }
  return {
    setup: key.setup,
    value: readValue,
  };
}

function lowerScan(read: BoundRead, lowering: Lowering, captureKeys = true): LoweredValue {
  const range = read.range;
  if (!range) throw new Error("bound scan has no range");
  const loweredKeys = read.key.map((expression) => lowerExpression(expression, lowering));
  const key = captureKeys ? captureMany(loweredKeys, lowering) : {
    setup: loweredKeys.flatMap((value) => value.setup), values: loweredKeys.map((value) => value.value),
  };
  const after = range.after ? lowerExpression(range.after, lowering) : { setup: [], value: null } as const;
  const prefix = key.values.map((value, index): IndexKeyExpr => {
    const component = range.components[index];
    if (!component) throw new Error("bound scan key has no index component");
    if ("Column" in component) return { Scalar: keyValue(read.key[index]!, value) };
    const type = read.key[index]!.facts.type;
    if (type.kind !== "text" || type.optional) throw new Error("bound word-prefix key is not required text");
    return { WordPrefix: { source: value, contract: component.WordPrefixes.contract, source_max: type.max } };
  });
  // Scan identities follow prefix/cursor expression identities, matching the
  // legacy lexical lowering order.
  const site = accessSite(lowering, read.source);
  return {
    setup: [...key.setup, ...after.setup],
    value: { Scan: {
      site, table: dataTableName(read.table.name), index: read.index.name, prefix,
      order: range.order, take: { Literal: range.take }, after: after.value,
      before: null, range: null,
      ...(range.opaqueCursor ? { opaque_cursor: true } : {}),
      merge_site: range.mergeSite ?? null, provenance: read.provenance,
    } },
  };
}

function lowerMerge(
  expression: Extract<BoundExpression, { kind: "merge" }>,
  lowering: Lowering,
): LoweredValue {
  const setup: Stmt[] = [];
  const lanes: Extract<Expr, { Merge: unknown }>["Merge"]["lanes"] = [];
  for (const lane of expression.lanes) {
    const source = lane.sourceRead ? lowerScan(lane.sourceRead, lowering) : undefined;
    if (source) setup.push(...source.setup);
    const priorBindings = new Map(lowering.bindings);
    let binding = "";
    if (lane.symbol) {
      binding = temporary(lowering, "mergeRow");
      lowering.bindings.set(lane.symbol.id, { Variable: binding });
    }
    const scan = lowerScan(lane.scan, lowering, expression.heldSearch === undefined);
    lowering.bindings = priorBindings;
    if (!("Scan" in scan.value) || source && !("Scan" in source.value)) throw new Error("bound merge lane did not lower to scans");
    lanes.push({ ...(scan.setup.length ? { setup: scan.setup } : {}), scan: scan.value.Scan,
      source: source && "Scan" in source.value ? source.value.Scan : null, binding });
  }
  const merge: Extract<Expr, { Merge: unknown }>["Merge"] = { site: expression.site, lanes };
  if (expression.heldSearch) {
    const lane = lanes[0]!;
    const derived = expression.index.declaration.components.findIndex((component) => "WordPrefixes" in component);
    const term = lane.scan.prefix[derived];
    if (!term || !("WordPrefix" in term) || !lane.source) throw new Error("bound held search lost its term or discovery scan");
    const scope = expression.heldSearch.scope.map((item, index) => {
      const atom = lane.scan.prefix[index];
      if (!atom || !("Scalar" in atom)) throw new Error("bound held search lost a scalar scope key");
      return { column: item.column, value: atom.Scalar };
    });
    merge.held_search = {
      table: dataTableName(expression.table.name), index: expression.index.name, term: term.WordPrefix, scope,
      suffix: expression.heldSearch.suffix, order: lane.scan.order, take: lane.scan.take, after: lane.scan.after,
      discovery: { scan: lane.source, binding: lane.binding,
        authorization_index: expression.heldSearch.authorizationIndex },
    };
  }
  return { setup, value: { Merge: merge } };
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
  const name = operand(lowering);
  return { setup: [...value.setup, { Const: { name, value: value.value } }], value: { Variable: name } };
}

function keyValue(expression: BoundExpression, value: Expr): Expr {
  return expression.facts.type.kind === "row" ? { Field: { base: value, name: "id" } } : value;
}

function literalValue(expression: Extract<BoundExpression, { kind: "literal" }>): Value {
  if (expression.value === null) return "Null";
  if (typeof expression.value === "boolean") return { Bool: expression.value };
  if (typeof expression.value === "string") return expression.wireKind === "id"
    ? { Id: expression.value } : { String: expression.value };
  if (expression.wireValue !== undefined) return { Int: expression.wireValue };
  if (expression.facts.type.kind === "numeric-literal") {
    unsupported(expression.source.definition, "an uncontextualized decimal literal in direct Quarry", "use a typed decimal or money position");
  }
  return { Int: expression.value };
}

function requireSite(source: BoundSourceStack): string {
  const { file, line, col } = source.definition;
  return `${file}:${line}:${col}`;
}

function accessSite(lowering: Lowering, source?: BoundSourceStack): string {
  const site = `${lowering.program}.${lowering.accessOrdinal}`;
  lowering.accessOrdinal += 1;
  if (source) lowering.sources.push([site, source.definition]);
  return site;
}

function recordLoopSource(lowering: Lowering, binding: string, source: BoundSourceStack): void {
  const ordinal = lowering.loopOrdinals.get(binding) ?? 0;
  lowering.loopOrdinals.set(binding, ordinal + 1);
  lowering.sources.push([`${lowering.program}/for/${binding}/${ordinal}`, source.definition]);
}

function dataTableName(name: string): string { return name === "connected" ? "_connected" : name; }

function temporary(lowering: Lowering, stem: string): string {
  while (true) {
    const name = `__bound_${stem}_${lowering.temporaryOrdinal}`;
    lowering.temporaryOrdinal += 1;
    if (!lowering.reservedNames.has(name)) {
      lowering.reservedNames.add(name);
      return name;
    }
  }
}

function operand(lowering: Lowering): string {
  while (true) {
    const name = `__operand${lowering.operandOrdinal++}`;
    if (!lowering.reservedNames.has(name)) {
      lowering.reservedNames.add(name);
      return name;
    }
  }
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
      ...(type.min ? { min: type.min } : {}),
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
