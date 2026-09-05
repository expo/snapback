import type { Expr, KeyPart, ObjectField, ShapeDecl } from "./ast";

export function quarryWriteWithoutField(expr: Extract<Expr, { kind: "write" }>, removed: ObjectField): string {
  const key = expr.op === "insert" ? "" : `[${expr.keys.map(quarryKeyPart).join(", ")}]`;
  const fields = expr.op === "delete" ? "" : ` { ${expr.fields.filter((field) => field !== removed).map(quarryObjectField).join(", ")} }`;
  return `${expr.op} ${expr.table}${key}${fields}`;
}

function quarryKeyPart(part: KeyPart): string {
  return `${part.column ? `${part.column} = ` : ""}${quarryExpression(part.value)}`;
}

function quarryObjectField(field: ObjectField): string {
  return field.value ? `${field.name}: ${quarryExpression(field.value)}` : field.name;
}

export function quarryExpression(expr: Expr): string {
  if (expr.kind === "name") return expr.name;
  if (expr.kind === "focal") return ".";
  if (expr.kind === "literal") return JSON.stringify(expr.value);
  if (expr.kind === "array") return `[${expr.items.map(quarryExpression).join(", ")}]`;
  if (expr.kind === "object") return `{ ${expr.fields.map(quarryObjectField).join(", ")} }`;
  if (expr.kind === "unary") return `${expr.op} (${quarryExpression(expr.value)})`;
  if (expr.kind === "binary") return `(${quarryExpression(expr.left)} ${expr.op} ${quarryExpression(expr.right)})`;
  if (expr.kind === "member") {
    return expr.base.kind === "focal"
      ? `.${expr.name}`
      : `(${quarryExpression(expr.base)}).${expr.name}`;
  }
  if (expr.kind === "call") return `${expr.name}(${expr.args.map(quarryExpression).join(", ")})`;
  if (expr.kind === "read") {
    let rendered = `${expr.table}[${expr.keys.map(quarryKeyPart).join(", ")}]`;
    if (expr.range?.cursor) rendered += ` ${expr.range.cursorKind ?? "after"} ${quarryExpression(expr.range.cursor)}`;
    if (expr.range) rendered += ` ${expr.range.order === "asc" ? "first" : "last"} ${expr.range.take}`;
    if (expr.index) rendered += ` by ${expr.index}`;
    if (expr.range?.where) rendered += ` where ${quarryExpression(expr.range.where.predicate)}`;
    return rendered;
  }
  if (expr.kind === "merge") {
    const cursor = expr.cursor ? ` ${expr.cursorKind ?? "after"} ${quarryExpression(expr.cursor)}` : "";
    const lanes = expr.lanes.map((lane) => `  [${lane.prefix.map((value, i) => quarryKeyPart({ value, column: lane.columns?.[i], site: value.site })).join(", ")}]${lane.loop ? ` for ${lane.loop.name} in ${quarryExpression(lane.loop.domain)}` : ""}`).join("\n");
    return `merge ${expr.table}${cursor} ${expr.order === "asc" ? "first" : "last"} ${expr.take} by ${expr.index}:\n${lanes}`;
  }
  if (expr.kind === "exists" || expr.kind === "created") return `${expr.kind} ${quarryExpression(expr.read)}`;
  if (expr.kind === "aggregate") return `#${expr.table}[${expr.keys.map(quarryKeyPart).join(", ")}]`;
  if (expr.kind === "assert") return `(${quarryExpression(expr.value)})! else ${expr.code}`;
  if (expr.kind === "shapeUse") return `(${quarryExpression(expr.base)}) ${expr.name}`;
  if (expr.kind === "shape") {
    if (expr.authoredName) return `(${quarryExpression(expr.base)}) ${expr.authoredName}`;
    const fields = (expr.authoredFields ?? expr.fields).map((field) => field.kind === "spread"
      ? "*"
      : field.kind === "namedSpread" ? `...${field.name}`
      : field.kind === "bare" ? field.name : `${field.name}: ${quarryExpression(field.value)}`);
    return `(${quarryExpression(expr.base)}) { ${fields.join(", ")} }`;
  }
  if (expr.kind === "walk") return `walk ${expr.table}[${quarryExpression(expr.seed)}] up .${expr.column} depth ${expr.depth}`;
  return quarryWriteWithoutField(expr, { name: "", site: expr.site });
}

export function quarryShapeDeclaration(shape: ShapeDecl): string {
  return `shape ${shape.name} = { ${shape.fields.map((field) => field.kind === "spread"
    ? "*"
    : field.kind === "namedSpread" ? `...${field.name}`
      : field.kind === "bare" ? field.name : `${field.name}: ${quarryExpression(field.value)}`).join(", ")} }`;
}
