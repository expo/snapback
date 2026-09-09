import type { Expr, ScalarType } from "./ast";
import type { BoundExpression, BoundSourceStack, BoundType, BoundValueFacts } from "./bound-model";
import { typeError } from "./diagnostics";
import { typeName } from "./bound-source";

export function bindBuiltinCall(
  expression: Extract<Expr, { kind: "call" }>,
  args: BoundExpression[],
  source: BoundSourceStack,
): BoundExpression | undefined {
  if (expression.name === "range") {
    if (args.length !== 2) typeError(expression.site,
      `range(a, b) requires exactly 2 arguments; received ${args.length}`, "use range(integerStart, integerEnd)");
    const start = literalInteger(expression.args[0]);
    const end = literalInteger(expression.args[1]);
    if (start === undefined || end === undefined) typeError(expression.site,
      "range endpoints must be integer literals", "use range(0, 10)");
    const max = Math.max(0, end - start);
    return { kind: "range", start, end, max,
      facts: facts({ kind: "list", item: { kind: "int", optional: false }, max, optional: false }, "Const", max), source };
  }
  if (expression.name === "tokens") {
    const type: ScalarType = { kind: "list", item: { kind: "text", max: 4096, optional: false }, max: 64, optional: false };
    return { kind: "builtin", builtin: "MentionTokens", args, facts: facts(type, "Computed", 64), source };
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
  if (expression.name === "slice") {
    if (args.length !== 3) typeError(expression.site,
      `slice(text, start, end) requires exactly 3 arguments; received ${args.length}`,
      "use slice(presentText, integerStart, integerEnd)");
    const [value, start, end] = args as [BoundExpression, BoundExpression, BoundExpression];
    if (value.facts.type.kind !== "text" || value.facts.presence !== "required") typeError(expression.args[0]!.site,
      `slice's first argument must be present text; received ${typeName(value.facts.type)}`,
      "use a present text value before slicing");
    for (const [index, endpoint] of [[1, start], [2, end]] as const) {
      if (endpoint.facts.type.kind !== "int" || endpoint.facts.presence !== "required") typeError(expression.args[index]!.site,
        `slice's ${index === 1 ? "start" : "end"} must be an int; received ${typeName(endpoint.facts.type)}`,
        "use integer start and end positions");
    }
    const literalStart = literalInteger(expression.args[1]);
    const literalEnd = literalInteger(expression.args[2]);
    const literalMax = literalStart === undefined || literalEnd === undefined
      ? value.facts.type.max
      : Math.max(0, Math.max(0, literalEnd) - Math.max(0, literalStart));
    return { kind: "builtin", builtin: "Slice", args,
      facts: facts({ kind: "text", max: Math.min(value.facts.type.max, literalMax), optional: false }, "Computed"), source };
  }
  if (expression.name === "min" || expression.name === "max") {
    if (args.length < 2) typeError(expression.site, `${expression.name} requires at least two arguments`, `use ${expression.name}(a, b)`);
    const builtin = expression.name === "min" ? "Min" : "Max";
    return args.slice(1).reduce<BoundExpression>((left, right) => ({
      kind: "builtin", builtin, args: [left, right], facts: facts(left.facts.type, "Computed"), source,
    }), args[0]!);
  }
  if (expression.name === "divmod") {
    if (args.length !== 2) typeError(expression.site,
      `divmod(a, b) requires exactly 2 arguments; received ${args.length}`, "use divmod(amount, integerDivisor)");
    const numerator = args[0]!;
    const divisor = args[1]!;
    if (!numeric(numerator.facts.type) && !(numerator.facts.type.kind === "time" && numerator.facts.presence === "required")) {
      typeError(expression.args[0]!.site,
        `divmod's first argument must be int, time, decimal, or money; received ${typeName(numerator.facts.type)}`,
        "use a present int, time, decimal, or money numerator");
    }
    if (divisor.facts.type.kind !== "int" || divisor.facts.presence !== "required") typeError(expression.args[1]!.site,
      "divmod's divisor must be an int", "use an integer expression or integer literal as the divisor");
    const resultType: BoundType = numerator.facts.type.kind === "time"
      ? { kind: "int", optional: false } : numerator.facts.type;
    const fields = new Map(["quotient", "remainder"].map((name) => [name, facts(resultType, "Computed")]));
    return { kind: "builtin", builtin: { Divmod: { remainder_sink: "lexicographic-id" } }, args,
      facts: facts({ kind: "object", fields, nullable: false }, "Computed"), source };
  }
  if (expression.name === "share") {
    if (args.length !== 3) typeError(expression.site,
      `share(amount, recipients, recipient) requires exactly 3 arguments; received ${args.length}`,
      "use share(amount, recipients, recipient)");
    const [amount, recipients, recipient] = args as [BoundExpression, BoundExpression, BoundExpression];
    if (!numeric(amount.facts.type)) typeError(expression.args[0]!.site,
      `share's amount must be int, decimal, or money; received ${typeName(amount.facts.type)}`,
      "use an int, decimal, or money amount");
    const item = boundedItem(recipients.facts.type);
    if (!item) typeError(expression.args[1]!.site,
      `share recipients must be a bounded list or page; received ${typeName(recipients.facts.type)}`,
      "use a bounded [T] <=N argument or bounded page-derived list");
    if (!sameRecipient(item, recipient.facts.type)) typeError(expression.args[2]!.site,
      `share recipient type ${typeName(recipient.facts.type)} does not match recipient-list item type ${typeName(item)}`,
      "use a recipient with the same nominal type as the recipients list items");
    return { kind: "builtin", builtin: "DeterministicShare", args,
      facts: facts(amount.facts.type, "Computed"), source };
  }
}

function facts(type: BoundType, origin: BoundValueFacts["origin"], max?: number): BoundValueFacts {
  const optional = type.kind === "null" || type.kind === "row" && type.nullable
    || type.kind === "object" && type.nullable || "optional" in type && type.optional;
  return { type, presence: optional ? "optional" : "required", origin, ...(max === undefined ? {} : { max }) };
}
function numeric(type: BoundType): boolean {
  return ["int", "decimal", "money"].includes(type.kind) && "optional" in type && !type.optional;
}
function boundedItem(type: BoundType): BoundType | undefined {
  if (type.kind === "list") return type.item;
  if (type.kind === "page") return type.item?.type ?? { kind: "row", table: type.table, nullable: false };
  if (type.kind === "collection") return type.item.type;
}
function sameRecipient(left: BoundType, right: BoundType): boolean {
  if (left.kind === "row" || right.kind === "row") return left.kind === "row" && right.kind === "row"
    && left.table.id === right.table.id && !left.nullable && !right.nullable;
  if (!("optional" in left) || !("optional" in right) || left.optional || right.optional || left.kind !== right.kind) return false;
  if (left.kind === "ref" && right.kind === "ref") return left.table === right.table;
  if (left.kind === "decimal" && right.kind === "decimal") return left.scale === right.scale;
  if (left.kind === "money" && right.kind === "money") return left.currency === right.currency && left.scale === right.scale;
  return true;
}
function literalInteger(expression: Expr | undefined): number | undefined {
  if (expression?.kind === "literal" && typeof expression.value === "number" && Number.isSafeInteger(expression.value)) return expression.value;
  if (expression?.kind === "unary" && expression.op === "-") {
    const value = literalInteger(expression.value);
    return value === undefined ? undefined : -value;
  }
}
