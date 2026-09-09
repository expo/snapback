import { deepStrictEqual } from "node:assert";
import { readFileSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { canonicalValue, ClientStore, type ClosureReceipt, type Context } from "../../evaluator/src/evaluator";
import { lowerProject } from "./project";
import { rustCheck } from "./rust-check";
import { bindQuarrySchema } from "./quarry/bound-schema";
import { bindQuarryProgram, type BoundValueFacts } from "./quarry/bound";
import { QuarryError } from "./quarry/diagnostics";
import { lowerBoundQuarryProgram } from "./quarry/direct";
import { prepareQuarry, type QuarryInput } from "./quarry/index";
import { assert, operation, type Test } from "./quarry-check-helpers";

const schema = `table rows:
  seenAt: time ?
  amount: money USD
  public

table others:
  public
`;

export function registerQuarryDirectValidationChecks(test: Test, frontend: string): void {
  test("direct Quarry validates nominal operators and narrows one-hop optional members", async () => {
    const operations = `query valid(id: rows, maybe: rows ?, maybeCount: int ?, upTo: time, amount: money USD, rate: decimal 4):
  row = rows[id]! else MISSING
  if row.seenAt != null:
    return { present: row.seenAt >= upTo, same: id = 'known', fallback: maybe ?? 'fallback', count: maybeCount ?? 2, values: [amount, 1.0], product: amount * rate, timesInt: amount * 2, intTimes: 2 * amount }
  return { present: false, same: false, fallback: id, count: 2, values: [amount], product: amount, timesInt: amount, intTimes: amount }

query nullFirst():
  return null ?? 2

mutation priced():
  return insert rows { seenAt: null, amount: 1.25 }
`;
    const prepared = prepare(schema, operations);
    const valid = program(prepared, "valid");
    const bound = bindQuarryProgram(valid, prepared.catalog, prepared.documents);
    const nullFirst = bindQuarryProgram(program(prepared, "nullFirst"), prepared.catalog, prepared.documents);
    assert(nullFirst.result.type.kind === "int" && !nullFirst.result.type.optional,
      `null ?? int did not infer required int: ${JSON.stringify(nullFirst.result)}`);
    const direct = lowerBoundQuarryProgram(bound);
    const serialized = JSON.stringify(direct);
    assert(serialized.includes('"Id":"known"') && serialized.includes('"Id":"fallback"'),
      `contextual Id literals did not reach the wire as Id values: ${serialized}`);
    assert(serialized.includes('"Int":100') && serialized.includes('"Int":10000'),
      `scaled literals or branded product divisor were lost: ${serialized}`);
    const priced = lowerBoundQuarryProgram(bindQuarryProgram(program(prepared, "priced"), prepared.catalog, prepared.documents));
    assert(JSON.stringify(priced).includes('"Int":125'), `money write literal was not scaled once: ${JSON.stringify(priced)}`);

    const directSchema = bindQuarrySchema(prepared.documents, prepared.catalog);
    const checked = rustCheck([direct], "synthetic", directSchema)[0]!;
    assert(!checked.error && checked.certificate, `validated direct program did not certify: ${JSON.stringify(checked)}`);
    const receipt: ClosureReceipt = {
      rows: [{ table: "rows", id: "r1", row: { Row: { id: { Id: "r1" }, seenAt: { Int: 12 }, amount: { Int: 300 } } } }],
      ranges: [], absences: [], verdicts: [],
    };
    const context: Context = { viewer: "viewer", principal_kind: "user", auth_epoch: 1,
      args: { id: { Id: "r1" }, maybe: "Null", maybeCount: "Null", upTo: { Int: 10 }, amount: { Int: 300 }, rate: { Int: 20_000 } },
      now: 1, new_ids: [], read_time: 1 };
    const execution = new ClientStore(directSchema, receipt).reexecute(direct, context, checked.certificate).execution;
    const row = (execution.result as { Row: Record<string, unknown> }).Row;
    deepStrictEqual(row.present, { Bool: true });
    deepStrictEqual(row.fallback, { Id: "fallback" });
    assert(canonicalValue(row.product as never) === canonicalValue({ Int: 600 }),
      `branded product changed scale: ${canonicalValue(execution.result)}`);
    deepStrictEqual(row.timesInt, { Int: 600 });
    deepStrictEqual(row.intTimes, { Int: 600 });
    deepStrictEqual(row.count, { Int: 2 });
  });

  test("direct Quarry certifies the shipped chat held search with oracle bounds", async () => {
    const root = resolve(frontend, "fixtures/quarry-chat");
    const directory = join(root, "snapback");
    const inputs: QuarryInput[] = readdirSync(directory).filter((name) => name.endsWith(".q")).map((name) => ({
      path: join(directory, name), fileName: `snapback/${name}`, source: readFileSync(join(directory, name), "utf8"),
    }));
    const prepared = prepareQuarry(inputs);
    assert(prepared.ok, `shipped chat search did not prepare: ${JSON.stringify(prepared)}`);
    const declaration = prepared.prepared.documents.flatMap((document) => document.programs)
      .find((candidate) => candidate.site.file === "snapback/messages.q" && candidate.name === "search");
    assert(declaration, "shipped chat has no messages.search declaration");
    const direct = lowerBoundQuarryProgram(bindQuarryProgram(
      declaration, prepared.prepared.catalog, prepared.prepared.documents,
    ));
    const merge = JSON.stringify(direct);
    assert(merge.includes('"held_search"') && merge.includes('"WordPrefix"')
      && merge.includes('"authorization_index":"byConversationPrincipal"'),
    `direct chat search lost its held descriptor: ${merge}`);
    const directCheck = rustCheck([direct], "synthetic", bindQuarrySchema(prepared.prepared.documents, prepared.prepared.catalog))[0]!;
    assert(!directCheck.error && directCheck.certificate, `direct chat search did not certify: ${JSON.stringify(directCheck)}`);

    const oracle = await lowerProject(root);
    assert(oracle.ok, `chat search oracle refused: ${JSON.stringify(oracle)}`);
    const oracleCheck = rustCheck([operation(oracle.project.programs, "messages.search")], "synthetic",
      { ...oracle.project.schema, effects: [], schedules: [] })[0]!;
    assert(!oracleCheck.error && oracleCheck.certificate, `chat search oracle did not certify: ${JSON.stringify(oracleCheck)}`);
    const { plan_hash: _directPlan, ...directCertificate } = directCheck.certificate;
    const { plan_hash: _oraclePlan, ...oracleCertificate } = oracleCheck.certificate;
    deepStrictEqual(directCertificate, oracleCertificate);

    const directPrograms = prepared.prepared.documents.flatMap((document) => document.programs).map((program) =>
      lowerBoundQuarryProgram(bindQuarryProgram(program, prepared.prepared.catalog, prepared.prepared.documents)));
    const directProjectSchema = { ...bindQuarrySchema(prepared.prepared.documents, prepared.prepared.catalog),
      effects: oracle.project.schema.effects };
    const projectFailures = rustCheck(directPrograms, "synthetic", directProjectSchema, undefined, oracle.project.effects)
      .filter((item) => item.error);
    assert(projectFailures.length === 0, `direct shipped chat programs did not certify: ${JSON.stringify(projectFailures)}`);
  });

  test("direct Quarry binds and certifies the public surface, todos, and Clique corpora", () => {
    for (const name of ["quarry-surface", "quarry-todos", "quarry-clique"]) {
      const prepared = fixture(frontend, name);
      const programs = prepared.documents.flatMap((document) => document.programs).map((program) =>
        lowerBoundQuarryProgram(bindQuarryProgram(program, prepared.catalog, prepared.documents)));
      const failures = rustCheck(programs, "synthetic", bindQuarrySchema(prepared.documents, prepared.catalog))
        .filter((item) => item.error);
      assert(failures.length === 0, `${name} direct programs did not certify: ${JSON.stringify(failures)}`);
    }
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

query optionalMoney(left: money USD ?, right: money USD):
  return left + right

query optionalRate(left: money USD, right: decimal 4 ?):
  return left * right

query mixedFallback(value: int):
  return value ?? true

query orderedBool(left: bool, right: bool):
  return left < right

query orderedList(left: [int] <=2, right: [int] <=2):
  return left < right

query orderedAsset(left: image <=100, right: image <=100):
  return left < right

query opaqueLength(value: json <=100):
  return value.length

query removedWords(value: text <=100):
  return words(value)

fn decimal3(value: decimal 3): value
query wrongScale(value: decimal 2):
  return decimal3(value)
`;
    const prepared = prepare(schema, operations);
    for (const [name, text] of [
      ["mixed", "conditional returns disagree"],
      ["wrongMoney", "matching money USD 2"],
      ["fractional", "requires matching decimal 1"],
      ["boolean", "condition requires bool"],
      ["optionalOrdered", "requires present operands"],
      ["optionalMember", "requires present operands"],
      ["wrongRef", "cannot compare nominal"],
      ["optionalMoney", "requires present numeric operands"],
      ["optionalRate", "requires present numeric operands"],
      ["mixedFallback", "conditional returns disagree"],
      ["orderedBool", "does not admit bool"],
      ["orderedList", "does not admit [int]"],
      ["orderedAsset", "does not admit image"],
    ]) {
      let failure: QuarryError | undefined;
      try { bindQuarryProgram(program(prepared, name), prepared.catalog, prepared.documents); }
      catch (error) { if (error instanceof QuarryError) failure = error; else throw error; }
      assert(failure?.diagnostic.code === "E_QUARRY_TYPE" && failure.message.includes(text),
        `${name} did not refuse with ${text}: ${failure?.diagnostic.code} ${failure?.message}`);
    }

    for (const [name, code] of [["opaqueLength", "E_OPAQUE"], ["removedWords", "E_QUARRY_UNSUPPORTED"],
      ["wrongScale", "E_DECIMAL_SCALE"]] as const) {
      let failure: QuarryError | undefined;
      try { bindQuarryProgram(program(prepared, name), prepared.catalog, prepared.documents); }
      catch (error) { if (error instanceof QuarryError) failure = error; else throw error; }
      assert(failure?.diagnostic.code === code,
        `${name} did not retain ${code}: ${failure?.diagnostic.code} ${failure?.message}`);
    }

    const fractionalRule = prepare(`table fractions:\n  value: int\n  read <- 1.5 = 1.5\n`, "query probe():\n  return null\n");
    let schemaFailure: QuarryError | undefined;
    try { bindQuarrySchema(fractionalRule.documents, fractionalRule.catalog); }
    catch (error) { if (error instanceof QuarryError) schemaFailure = error; else throw error; }
    assert(schemaFailure?.diagnostic.code === "E_QUARRY_TYPE" && (schemaFailure.message.includes("require a decimal or money context")
      || schemaFailure.message.includes("int positions take integer literals")),
      `direct schema emitted a fractional Int literal: ${schemaFailure?.diagnostic.code} ${schemaFailure?.message}`);
  });

  test("direct Quarry joins raw and shaped page items structurally in either branch order", () => {
    const prepared = prepare(schema, `query rawFirst(flag: bool):
  if flag:
    return rows[] first 2 by byId
  return rows[] first 2 by byId { *, extra: 1 }

query shapeFirst(flag: bool):
  if flag:
    return rows[] first 2 by byId { *, extra: 1 }
  return rows[] first 2 by byId

query sameFields(flag: bool):
  if flag:
    return rows[] first 2 by byId { * }
  return rows[] first 2 by byId

query partial(id: rows):
  row = rows[id]! else MISSING
  return row { seenAt, amount }

query exact(id: rows):
  row = rows[id]! else MISSING
  return row { * }

query override(id: rows, replacement: time ?):
  row = rows[id]! else MISSING
  return row { *, seenAt: replacement }
`);
    for (const name of ["rawFirst", "shapeFirst"]) {
      let failure: QuarryError | undefined;
      try { bindQuarryProgram(program(prepared, name), prepared.catalog, prepared.documents); }
      catch (error) { if (error instanceof QuarryError) failure = error; else throw error; }
      assert(failure?.diagnostic.code === "E_QUARRY_TYPE" && failure.message.includes("different fields"),
        `${name} unsoundly claimed a shaped-only page field: ${failure?.diagnostic.code} ${failure?.message}`);
    }
    const sameFields = bindQuarryProgram(program(prepared, "sameFields"), prepared.catalog, prepared.documents);
    assert(sameFields.result.type.kind === "page" && sameFields.result.type.item?.type.kind === "object"
      && !sameFields.result.type.item.type.fields.has("extra"),
    `raw page did not participate in the page item join: ${JSON.stringify(sameFields.result)}`);
    const objectFields = (name: string) => {
      const bound = bindQuarryProgram(program(prepared, name), prepared.catalog, prepared.documents);
      assert(bound.result.type.kind === "object", `${name} did not return an object shape`);
      return bound.result.type.fields;
    };
    assert([...objectFields("partial").values()].every((field) => field.fieldProjection === "constructed"),
      "a partial shape was mistaken for inherited row custody");
    assert([...objectFields("exact").values()].every((field) => field.fieldProjection === "inherited-row"),
      "an exact spread lost inherited row custody");
    const overridden = objectFields("override");
    assert(overridden.get("seenAt")?.fieldProjection === "constructed"
      && [...overridden].filter(([name]) => name !== "seenAt").every(([, field]) => field.fieldProjection === "inherited-row"),
    "a computed shape override was mistaken for an inherited optional column");
  });

  test("direct Quarry gives empty lists a bottom type and contextual bounded joins", () => {
    const prepared = prepare(schema, `fn size(values: [int] <=3): count(values)

query empty():
  return []

query callEmpty():
  return size([])

query selected(flag: bool):
  if flag:
    return []
  return [1, 2, 3]

query fallback(values: [int] <=3 ?):
  return values ?? []

query wider(values: [int] <=3 ?, more: [int] <=7):
  return values ?? more
`);
    const bound = new Map(["empty", "callEmpty", "selected", "fallback", "wider"].map((name) => [name,
      bindQuarryProgram(program(prepared, name), prepared.catalog, prepared.documents)]));
    assert(bound.get("empty")!.result.type.kind === "empty-list" && bound.get("empty")!.result.max === 0,
      `standalone [] lost its zero bound: ${JSON.stringify(bound.get("empty")!.result)}`);
    assert(bound.get("callEmpty")!.result.type.kind === "int",
      `typed fn did not contextualize []: ${JSON.stringify(bound.get("callEmpty")!.result)}`);
    for (const name of ["selected", "fallback"]) {
      const result = bound.get(name)!.result;
      assert(result.type.kind === "list" && result.type.item.kind === "int" && result.type.max === 3
        && !result.type.optional && result.presence === "required",
      `${name} did not retain the nonempty list's type/bound: ${JSON.stringify(result)}`);
    }
    const wider = bound.get("wider")!.result;
    assert(wider.type.kind === "list" && wider.type.item.kind === "int" && wider.type.max === 7
      && !wider.type.optional && wider.presence === "required",
    `coalesce did not retain the wider fallback bound: ${JSON.stringify(wider)}`);
    const schemaJson = bindQuarrySchema(prepared.documents, prepared.catalog);
    const direct = new Map([...bound].map(([name, value]) => [name, lowerBoundQuarryProgram(value)]));
    const certificates = new Map([...direct].map(([name, value]) => {
      const checked = rustCheck([value], "synthetic", schemaJson)[0]!;
      assert(!checked.error && checked.certificate, `${name} empty-list program did not certify: ${JSON.stringify(checked)}`);
      return [name, checked.certificate] as const;
    }));
    const execute = (name: string, args: Context["args"]) => new ClientStore(schemaJson).reexecute(direct.get(name)!, {
      viewer: "viewer", principal_kind: "user", auth_epoch: 1, args, now: 1, read_time: 1, new_ids: [],
    }, certificates.get(name)).execution.result;
    deepStrictEqual(execute("empty", {}), { Array: [] });
    deepStrictEqual(execute("callEmpty", {}), { Int: 0 });
    deepStrictEqual(execute("selected", { flag: { Bool: true } }), { Array: [] });
    deepStrictEqual(execute("selected", { flag: { Bool: false } }), { Array: [{ Int: 1 }, { Int: 2 }, { Int: 3 }] });
    deepStrictEqual(execute("fallback", { values: "Null" }), { Array: [] });
    deepStrictEqual(execute("fallback", { values: { Array: [{ Int: 7 }] } }), { Array: [{ Int: 7 }] });
    deepStrictEqual(execute("wider", { values: "Null", more: { Array: [{ Int: 7 }, { Int: 8 }] } }),
      { Array: [{ Int: 7 }, { Int: 8 }] });
    deepStrictEqual(execute("wider", { values: { Array: [{ Int: 1 }] }, more: { Array: [{ Int: 7 }] } }),
      { Array: [{ Int: 1 }] });
  });

  test("direct Quarry explicit decimal fallbacks preserve their value and optional absence", () => {
    const prepared = prepare(`table records:
  amounts: [decimal 3] <=4 ?
  public
  insert <- allow
`, `mutation normalized(values: [decimal 3] <=4 ?):
  original = values ?? [2.000, 3.000]
  box = {original}
  row = insert records {amounts: box.original}
  return {original, alias: box.original, stored: row.amounts}

query plain():
  return [2, 3]

query scalarFirst(flag: bool):
  if flag:
    return {amount: 2, values: [2, 3]}
  return {amount: null, values: null}

query nullFirst(flag: bool):
  if flag:
    return {amount: null, values: null}
  return {amount: 2, values: [2, 3]}
`);
    const schemaJson = bindQuarrySchema(prepared.documents, prepared.catalog);
    const direct = (name: string) => lowerBoundQuarryProgram(
      bindQuarryProgram(program(prepared, name), prepared.catalog, prepared.documents));
    const normalized = direct("normalized");
    const checked = rustCheck([normalized], "synthetic", schemaJson)[0]!;
    assert(!checked.error && checked.certificate,
      `whole-unit decimal fallback did not certify: ${JSON.stringify(checked)}`);
    const execute = (values: Context["args"][string]) => new ClientStore(schemaJson).reexecute(normalized, {
      viewer: "viewer", principal_kind: "user", auth_epoch: 1, args: { values }, now: 1, read_time: 1,
      new_ids: ["record-1"],
    }, checked.certificate).execution;
    for (const { values, expected } of [
      { values: "Null" as const, expected: [2_000, 3_000] },
      { values: { Array: [{ Int: 1_250 }] }, expected: [1_250] },
    ]) {
      const execution = execute(values);
      const ints = (items: readonly number[]) => ({ Array: items.map((value) => ({ Int: value })) });
      deepStrictEqual(execution.result, { Row: {
        alias: ints(expected), original: ints(expected), stored: ints(expected),
      } });
      deepStrictEqual(execution.writes, [{ table: "records", id: "record-1", row: { Row: {
        id: { Id: "record-1" }, amounts: ints(expected),
      } } }]);
    }
    const plain = direct("plain");
    const plainCheck = rustCheck([plain], "synthetic", schemaJson)[0]!;
    assert(!plainCheck.error && plainCheck.certificate, `plain integer list did not certify: ${JSON.stringify(plainCheck)}`);
    deepStrictEqual(new ClientStore(schemaJson).reexecute(plain, {
      viewer: "viewer", principal_kind: "user", auth_epoch: 1, args: {}, now: 1, read_time: 1, new_ids: [],
    }, plainCheck.certificate).execution.result, { Array: [{ Int: 2 }, { Int: 3 }] });

    const optionalField = (name: string, field: string): BoundValueFacts => {
      const result = bindQuarryProgram(program(prepared, name), prepared.catalog, prepared.documents).result;
      assert(result.type.kind === "object", `${name} did not retain its object result`);
      const value = result.type.fields.get(field);
      assert(value, `${name} lost ${field}`);
      return value;
    };
    for (const name of ["scalarFirst", "nullFirst"]) {
      const amount = optionalField(name, "amount");
      const values = optionalField(name, "values");
      assert(amount.type.kind === "int" && amount.presence === "optional",
        `${name} erased nullable whole-unit scalar facts: ${JSON.stringify(amount)}`);
      assert(values.type.kind === "list" && values.presence === "optional",
        `${name} erased nullable whole-unit list facts: ${JSON.stringify(values)}`);
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

function fixture(frontend: string, name: string) {
  const directory = resolve(frontend, `fixtures/${name}/snapback`);
  const inputs: QuarryInput[] = readdirSync(directory).filter((entry) => entry.endsWith(".q")).map((entry) => ({
    path: join(directory, entry), fileName: `snapback/${entry}`, source: readFileSync(join(directory, entry), "utf8"),
  }));
  const result = prepareQuarry(inputs);
  if (!result.ok) throw new Error(`${name} did not prepare: ${JSON.stringify(result.diagnostics)}`);
  return result.prepared;
}

function program(prepared: ReturnType<typeof prepare>, name: string) {
  const declaration = prepared.documents[1]?.programs.find((item) => item.name === name);
  assert(declaration, `missing ${name} declaration`);
  return declaration;
}
