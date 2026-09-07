import { deepStrictEqual } from "node:assert";
import { canonicalValue, ClientStore, type ClosureReceipt, type Context } from "../../evaluator/src/evaluator";
import { rustCheck } from "./rust-check";
import { bindQuarrySchema } from "./quarry/bound-schema";
import { bindQuarryProgram } from "./quarry/bound";
import { QuarryError } from "./quarry/diagnostics";
import { lowerBoundQuarryProgram } from "./quarry/direct";
import { prepareQuarry, type QuarryInput } from "./quarry/index";
import { assert, type Test, withProject } from "./quarry-check-helpers";

const schema = `table rows:
  seenAt: time ?
  amount: money USD
  public

table others:
  public
`;

export function registerQuarryDirectValidationChecks(test: Test): void {
  test("direct Quarry validates nominal operators and narrows one-hop optional members", async () => {
    const operations = `query valid(id: rows, maybe: rows ?, upTo: time, amount: money USD, rate: decimal 4):
  row = rows[id]! else MISSING
  if row.seenAt != null:
    return { present: row.seenAt >= upTo, same: id = 'known', fallback: maybe ?? 'fallback', values: [amount, 1], product: amount * rate }
  return { present: false, same: false, fallback: id, values: [amount], product: amount }

mutation priced():
  return insert rows { seenAt: null, amount: 1.25 }
`;
    const prepared = prepare(schema, operations);
    const valid = program(prepared, "valid");
    const bound = bindQuarryProgram(valid, prepared.catalog, prepared.documents);
    const direct = lowerBoundQuarryProgram(bound);
    const serialized = JSON.stringify(direct);
    assert(serialized.includes('"Id":"known"') && serialized.includes('"Id":"fallback"'),
      `contextual Id literals did not reach the wire as Id values: ${serialized}`);
    assert(serialized.includes('"Int":100') && serialized.includes('"Int":10000'),
      `scaled literals or branded product divisor were lost: ${serialized}`);
    const priced = lowerBoundQuarryProgram(bindQuarryProgram(program(prepared, "priced"), prepared.catalog, prepared.documents));
    assert(JSON.stringify(priced).includes('"Int":125'), `money write literal was not scaled once: ${JSON.stringify(priced)}`);

    const directSchema = bindQuarrySchema(prepared.documents, prepared.catalog);
    await withProject({ "snapback/schema.q": schema, "snapback/ops.q": operations }, async () => {
      const checked = rustCheck([direct], "synthetic", directSchema)[0]!;
      assert(!checked.error && checked.certificate, `validated direct program did not certify: ${JSON.stringify(checked)}`);
      const receipt: ClosureReceipt = {
        rows: [{ table: "rows", id: "r1", row: { Row: { id: { Id: "r1" }, seenAt: { Int: 12 }, amount: { Int: 300 } } } }],
        ranges: [], absences: [], verdicts: [],
      };
      const context: Context = { viewer: "viewer", principal_kind: "user", auth_epoch: 1,
        args: { id: { Id: "r1" }, maybe: "Null", upTo: { Int: 10 }, amount: { Int: 300 }, rate: { Int: 20_000 } },
        now: 1, new_ids: [], read_time: 1 };
      const execution = new ClientStore(directSchema, receipt).reexecute(direct, context, checked.certificate).execution;
      const row = (execution.result as { Row: Record<string, unknown> }).Row;
      deepStrictEqual(row.present, { Bool: true });
      deepStrictEqual(row.fallback, { Id: "fallback" });
      assert(canonicalValue(row.product as never) === canonicalValue({ Int: 600 }),
        `branded product changed scale: ${canonicalValue(execution.result)}`);
    });
  });

  test("direct Quarry refuses heterogeneous arrays and invalid operator domains before IR", () => {
    const operations = `query mixed(value: int):
  return [value, true]

query wrongMoney(usd: money USD, eur: money EUR):
  return usd + eur

query fractional(value: int):
  return value + 1.5

query boolean(value: int):
  return value and true

query optionalOrdered(value: int, maybe: int ?):
  return maybe >= value

query optionalMember(id: rows, upTo: time):
  row = rows[id]! else MISSING
  return row.seenAt >= upTo

query wrongRef(left: rows, right: others):
  return left = right
`;
    const prepared = prepare(schema, operations);
    for (const [name, text] of [
      ["mixed", "conditional returns disagree"],
      ["wrongMoney", "matching money USD 2"],
      ["fractional", "fractional digits"],
      ["boolean", "condition requires bool"],
      ["optionalOrdered", "requires present operands"],
      ["optionalMember", "requires present operands"],
      ["wrongRef", "cannot compare nominal"],
    ]) {
      let failure: QuarryError | undefined;
      try { bindQuarryProgram(program(prepared, name), prepared.catalog, prepared.documents); }
      catch (error) { if (error instanceof QuarryError) failure = error; else throw error; }
      assert(failure?.diagnostic.code === "E_QUARRY_TYPE" && failure.message.includes(text),
        `${name} did not refuse with ${text}: ${failure?.diagnostic.code} ${failure?.message}`);
    }
  });
}

function prepare(schemaSource: string, operationSource: string) {
  const inputs: QuarryInput[] = [
    { path: "/virtual/snapback/schema.q", fileName: "snapback/schema.q", source: schemaSource },
    { path: "/virtual/snapback/ops.q", fileName: "snapback/ops.q", source: operationSource },
  ];
  const result = prepareQuarry(inputs);
  if (!result.ok) throw new Error(`direct validation fixture did not prepare: ${JSON.stringify(result.diagnostics)}`);
  return result.prepared;
}

function program(prepared: ReturnType<typeof prepare>, name: string) {
  const declaration = prepared.documents[1]?.programs.find((item) => item.name === name);
  assert(declaration, `missing ${name} declaration`);
  return declaration;
}
