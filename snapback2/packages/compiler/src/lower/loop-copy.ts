import type { Expr, HeldSearchDescriptor, IndexKeyExpr, LoopDomain, Read, Scan, Stmt } from "../ir";

type Loop = Extract<Stmt, { For: unknown }>;
type Names = { binding(name: string): string; reference(name: string): string; site(name: string): string };

// @ref LLP 1002#2-the-authored-surface-the-snapback2-module — clone lexical identities at IR binding/reference positions. Object keys, literal values and builtin policy descriptors are data, even when they resemble IR tags.
export function copyLoop(loop: Loop, names: Names): Loop {
  function expression(value: Expr): Expr {
    if ("Literal" in value || "Input" in value) return value;
    if ("Variable" in value) return { Variable: names.reference(value.Variable) };
    if ("Field" in value) return { Field: { ...value.Field, base: expression(value.Field.base) } };
    if ("Array" in value) return { Array: value.Array.map(expression) };
    if ("Object" in value) return { Object: Object.fromEntries(Object.entries(value.Object).map(([key, item]) => [key, expression(item)])) };
    if ("Binary" in value) return { Binary: { ...value.Binary, left: expression(value.Binary.left), right: expression(value.Binary.right) } };
    if ("Unary" in value) return { Unary: { ...value.Unary, value: expression(value.Unary.value) } };
    if ("Builtin" in value) return { Builtin: { ...value.Builtin, args: value.Builtin.args.map(expression) } };
    if ("Get" in value) return { Get: read(value.Get) };
    if ("Exists" in value) return { Exists: read(value.Exists) };
    if ("Scan" in value) return { Scan: scan(value.Scan) };
    if ("Merge" in value) {
      const bindings = value.Merge.lanes.map(lane => lane.source ? names.binding(lane.binding) : lane.binding);
      return { Merge: { ...value.Merge, site: names.site(value.Merge.site),
        lanes: value.Merge.lanes.map((lane, i) => ({ ...lane,
          ...(lane.setup ? { setup: lane.setup.map(statement) } : {}),
          scan: scan(lane.scan), source: lane.source && scan(lane.source), binding: bindings[i]!,
        })),
        ...(value.Merge.held_search ? { held_search: heldSearch(value.Merge.held_search) } : {}),
      } };
    }
    return unhandled(value);
  }
  const nullable = (value: Expr | null): Expr | null => value && expression(value);
  function read(value: Read): Read {
    return { ...value, site: names.site(value.site), key: value.key.map(expression) };
  }
  function indexKey(value: IndexKeyExpr): IndexKeyExpr {
    if ("Scalar" in value) return { Scalar: expression(value.Scalar) };
    if ("WordPrefix" in value) return { WordPrefix: { ...value.WordPrefix, source: expression(value.WordPrefix.source) } };
    return unhandled(value);
  }
  function scan(value: Scan): Scan {
    return { ...value, site: names.site(value.site), prefix: value.prefix.map(indexKey),
      after: nullable(value.after), before: nullable(value.before),
      range: value.range && { gt: nullable(value.range.gt), gte: nullable(value.range.gte),
        lt: nullable(value.range.lt), lte: nullable(value.range.lte) },
      ...(value.merge_site == null ? {} : { merge_site: names.site(value.merge_site) }),
    };
  }
  function heldSearch(value: HeldSearchDescriptor): HeldSearchDescriptor {
    return { ...value, term: { ...value.term, source: expression(value.term.source) },
      scope: value.scope.map(item => ({ ...item, value: expression(item.value) })), after: nullable(value.after),
      discovery: { ...value.discovery, scan: scan(value.discovery.scan), binding: names.reference(value.discovery.binding) },
    };
  }
  function domain(value: LoopDomain): LoopDomain {
    if ("LiteralRange" in value) return value;
    if ("ArgList" in value) return { ArgList: { ...value.ArgList, name: names.reference(value.ArgList.name) } };
    if ("DerivedArray" in value) return { DerivedArray: { ...value.DerivedArray, value: expression(value.DerivedArray.value) } };
    if ("Page" in value) return { Page: scan(value.Page) };
    if ("Recurse" in value) return { Recurse: { ...value.Recurse, site: names.site(value.Recurse.site), seed: expression(value.Recurse.seed) } };
    return unhandled(value);
  }
  function forLoop(value: Loop["For"]): Loop["For"] {
    return { ...value, binding: names.binding(value.binding), domain: domain(value.domain), body: value.body.map(statement) };
  }
  function statement(value: Stmt): Stmt {
    if (typeof value === "string") return value;
    if ("Const" in value) return { Const: { name: names.binding(value.Const.name), value: expression(value.Const.value) } };
    if ("Let" in value) return { Let: { name: names.binding(value.Let.name), value: expression(value.Let.value) } };
    if ("Assign" in value) return { Assign: { name: names.reference(value.Assign.name), value: expression(value.Assign.value) } };
    if ("Push" in value) return { Push: { target: names.reference(value.Push.target), value: expression(value.Push.value) } };
    if ("If" in value) return { If: { condition: expression(value.If.condition), then_body: value.If.then_body.map(statement), else_body: value.If.else_body.map(statement) } };
    if ("For" in value) return { For: forLoop(value.For) };
    if ("Require" in value) return { Require: { ...value.Require, condition: expression(value.Require.condition) } };
    if ("Insert" in value) return { Insert: { ...value.Insert, row: expression(value.Insert.row) } };
    if ("Update" in value) return { Update: { ...value.Update, key: expression(value.Update.key), patch: expression(value.Update.patch) } };
    if ("Upsert" in value) return { Upsert: { ...value.Upsert, key: expression(value.Upsert.key), row: expression(value.Upsert.row) } };
    if ("Delete" in value) return { Delete: { ...value.Delete, key: expression(value.Delete.key) } };
    if ("Emit" in value) return { Emit: { ...value.Emit, payload: expression(value.Emit.payload) } };
    if ("Return" in value) return { Return: expression(value.Return) };
    return unhandled(value);
  }
  return { For: forLoop(loop.For) };
}

function unhandled(value: never): never {
  throw new Error(`unhandled compiler IR in loop copy: ${JSON.stringify(value)}`);
}
