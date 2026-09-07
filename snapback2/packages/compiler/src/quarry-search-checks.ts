import assert from "node:assert/strict";
import { registerArgumentFormatChecks } from "./argument-format-checks";
import { registerCaptureValueChecks, runPure } from "./capture-value-checks";
import { lowerProject } from "./project";
import { lowerSource, typecheckSource } from "./compiler";
import { lowerSchema } from "./lower/schema";
import { apiConsumerDiagnostics, compileInline, withProject, type Test } from "./quarry-check-helpers";
import type { Expr, Index, Program, Scan } from "./ir";
import { SEARCH_CONTRACT } from "./index-components";
import { heldSearchDescriptor } from "./lower/held-search";
import type { Environment } from "./lower/environment";

const schema = `table rooms:
  title: text <=50
  public
table memberships:
  room: rooms
  principal: principal
  role: text <=20
  unique byRoomPrincipal: room, principal
  by byPrincipal: principal, room, id
  by byPrincipalRole: principal, role, room, id
  cap 100 by principal
  read <- exists memberships[.room, viewer] by byRoomPrincipal
table docs:
  room: rooms
  body: text <=4000 ?
  caption: text <=50 ?
  at: time
  by byRoom: room, at, id
  by bySearch: room, wordPrefixes(body, caption), at, id
  read <- exists memberships[.room, viewer] by byRoomPrincipal
  insert <- allow
  update <- allow
  delete <- allow
table people:
  name: text <=50
  handle: text <=20 ?
  by bySearch: wordPrefixes(name, handle), id
  public
`;
const global = `query search(term: text <=2000, c: cursor ?):
  page = merge docs after c last 20 by bySearch:
    [m.room, term] for m in memberships[viewer] first 100 by byPrincipal
  return page
`;

async function compiled(source: string, schemaSource = schema) {
  return withProject({ "snapback/schema.q": schemaSource, "snapback/search.q": source }, async root => {
    const result = await lowerProject(root);
    assert(result.ok, JSON.stringify(result));
    return result;
  });
}
function find<T>(value: unknown, tag: string): T[] {
  if (!value || typeof value !== "object") return [];
  const object = value as Record<string, unknown>;
  return [...(tag in object ? [object[tag] as T] : []), ...Object.values(object).flatMap(v => find<T>(v, tag))];
}
function merge(program: Program) { return find<Extract<Expr, { Merge: unknown }>["Merge"]>(program, "Merge")[0]!; }

export function registerQuarrySearchChecks(test: Test, libText: string): void {
  registerCaptureValueChecks(test, libText);
  registerArgumentFormatChecks(test, libText);
  const minimumSchema = `table records:
  body: text 1..20
  public
  insert <- allow
  update <- allow
`;
  const minimumArgs = "body: text 2..20, items: [text 3..10] <=4, maybe: text 2..20 ?, optionalItems: [text 3..10] <=4 ?, nested: [[text 2..5] <=3] <=2";
  const minimumDescriptors = {
    body: { Text: { max: 20, min: 2 } },
    items: { List: { of: { Text: { max: 10, min: 3 } }, max: 4 } },
    maybe: { Optional: { Text: { max: 20, min: 2 } } },
    optionalItems: { Optional: { List: { of: { Text: { max: 10, min: 3 } }, max: 4 } } },
    nested: { List: { of: { List: { of: { Text: { max: 5, min: 2 } }, max: 3 } }, max: 2 } },
  };
  for (const kind of ["query", "mutation", "job", "channel"]) {
    test(`text minimum descriptors reach ${kind} admission recursively without body guards`, async () => {
      const body = kind === "job"
        ? "  chunk row in records first 2 by byId:\n    update records[row.id] { body }\n"
        : kind === "channel" ? "  publish <- allow\n  subscribe <- allow\n  ttl 5s\n"
          : "  return { body, items, maybe, optionalItems, nested }\n";
      const declaration = `${kind} probe(${minimumArgs}):\n${body}`;
      const result = await compiled(kind === "channel" ? "query probe():\n  return true\n" : declaration,
        minimumSchema + (kind === "channel" ? declaration : ""));
      const args = kind === "channel"
        ? find(result.project.schema.channels, "args")[0] : result.project.programs[0]!.args;
      assert.deepEqual(JSON.parse(JSON.stringify(args)), minimumDescriptors);
      assert.equal(find(result.project.programs, "Require").length, 0);
      if (kind === "job") {
        assert.equal(result.project.programs[0]!.kind, "job");
        assert.equal(result.project.programs[0]!.body.length, 1);
        const sweep = result.project.programs[0]!.body[0]!;
        assert(typeof sweep === "object" && "For" in sweep);
      }
    });
  }

  test("text minimum missing and zero canonicalize identically through List and Optional", async () => {
    const implicit = await compiled("query probe(body: text <=20, items: [text <=10] <=4 ?):\n  return { body, items }\n", minimumSchema);
    const zero = await compiled("query probe(body: text 0..20, items: [text 0..10] <=4 ?):\n  return { body, items }\n", minimumSchema);
    assert.deepEqual(zero.project.programs, implicit.project.programs);
    for (const descriptor of ["t.text(20)", "t.text(20, {})", "t.text(20, { min: 0 })"]) {
      const lowered = lowerSource(`import { query, t } from 'snapback2';
        export const probe = query({ value: t.optional(t.list(${descriptor}, { max: 4 })) }, ({ args }) => args.value);`, "zero.ts", libText);
      assert(lowered.ok, JSON.stringify(lowered));
      assert.deepEqual(lowered.programs[0]!.args.value, { Optional: { List: { of: { Text: { max: 20 } }, max: 4 } } });
    }
  });

  test("text minimum private descriptors preserve nested wrappers and the u32 endpoints", () => {
    const lowered = lowerSource(`import { query, t } from 'snapback2';
      export const probe = query({
        direct: t.text(4294967295, { min: 4294967295 }),
        nested: t.optional(t.list(t.optional(t.text(3, { min: 2 })), { max: 4 }))
      }, ({ args }) => args.direct);`, "minimum.ts", libText);
    assert(lowered.ok, JSON.stringify(lowered));
    assert.deepEqual(lowered.programs[0]!.args.direct, { Text: { max: 4294967295, min: 4294967295 } });
    assert.deepEqual(lowered.programs[0]!.args.nested, {
      Optional: { List: { of: { Optional: { Text: { max: 3, min: 2 } } }, max: 4 } },
    });
  });

  test("text minimum malformed raw descriptors refuse instead of discarding refinements", () => {
    const invalid = [
      "t.text(3, { min: 4 })", "t.text(3, { min: -1 })", "t.text(3, { min: 1.5 })",
      "t.text(4294967296, { min: 2 })", "t.text(3, { min: 4294967296 })",
      "t.text(3, { min: undefined })", "t.text(3, { min: null })", "t.text(3, { min: '2' })",
      "t.text(3, { ...{ min: 2 } })", "t.text(3, { ['min']: 2 })", "t.text(3, { min })",
      "t.text(3, { get min() { return 2; } })", "t.text(3, { min: 2, min: 0 })",
      "t.text(3, { min: 2, format: 'unknown' })", "t.text(3, options)", "t.text(3, { min: 2 }, 0)",
    ];
    for (const descriptor of invalid) for (const value of [descriptor, `t.optional(t.list(${descriptor}, { max: 4 }))`]) {
      // No TypeScript checker here: compiler admission must reject these on its own.
      const lowered = lowerSource(`import { query, t } from 'snapback2';
        export const probe = query({ value: ${value} }, () => true);`, "invalid-minimum.ts");
      assert(!lowered.ok && lowered.diagnostics.some(d => d.code === "E_ARGS_DESCRIPTOR"), JSON.stringify({ value, lowered }));
      const channel = lowerSchema(`import { channel, schema, rule, t } from 'snapback2';
        export const probe = channel({ args: { value: ${value} }, publish: rule.allow(), subscribe: rule.allow(), ttlMs: 5000 });
        export default schema({ tables: {}, channels: { probe } });`, "schema.ts");
      assert(channel.diagnostics.some(d => d.code === "E_SCHEMA_INVALID"), value);
    }
    for (const type of ["text 4..3", "text 1.5..3", "text -1..3", "[text 4..3] <=4 ?", "[text 2..3 ?] <=4"]) {
      for (const kind of ["query", "mutation", "job", "channel"]) {
        const declaration = `${kind} probe(value: ${type}):\n${kind === "channel"
          ? "  publish <- allow\n  subscribe <- allow\n  ttl 5s\n"
          : kind === "job" ? "  chunk row in records first 2 by byId:\n    update records[row.id] { body: 'ok' }\n" : "  return value\n"}`;
        const lowered = compileInline([
          { fileName: "snapback/schema.q", source: minimumSchema + (kind === "channel" ? declaration : "") },
          { fileName: "snapback/probe.q", source: kind === "channel" ? "query read():\n  return true\n" : declaration },
        ]);
        assert(!lowered.ok, declaration);
      }
    }
  });

  test("text minimum argument form cannot become a column or alter existing column refinements", async () => {
    const declarations = minimumSchema.replace("body: text 1..20", "body: text 1..20 format handle");
    const result = await compiled("mutation probe(body: text 2..20):\n  return insert records { body }\n", declarations);
    assert.deepEqual(find(result.project.schema.tables.records!.columns, "Text"), [{ max: 20 }]);
    assert.deepEqual(find(result.project.schema.tables.records!.constraints, "Text"), [{ field: "body", min: 1, format: "handle" }]);
    assert.deepEqual(result.project.programs[0]!.args.body, { Text: { max: 20, min: 2 } });
    for (const value of ["t.text(20, { min: 2 })", "t.optional(t.text(20, { min: 2 }))", "t.list(t.text(20, { min: 2 }), { max: 4 })"]) {
      const source = `import { schema, table, t } from 'snapback2';
        export const records = table({ columns: { body: ${value} } });
        export default schema({ tables: { records } });`;
      assert(lowerSchema(source, "schema.ts").diagnostics.some(d => d.code === "E_SCHEMA_COLUMN"), value);
      assert(typecheckSource(source, "schema.ts", libText).length > 0, `argument-only type admitted as a column: ${value}`);
    }
  });

  test("text minimum keeps Unicode scalar literals, search Q, optional refinement and public string types", async () => {
    const result = await compiled(`query search(term: text 2..2000, maybe: text 2..3 ?):
  if maybe != null:
    return { page: people[term] first 20 by bySearch, same: maybe = '😀a', decomposed: maybe = 'é' }
  return { page: people[term] first 20 by bySearch, same: false, decomposed: false }
`);
    assert.deepEqual(result.project.programs[0]!.args.term, { Text: { max: 2000, min: 2 } });
    const sources = find<{ source_max: number }>(result.project.programs, "WordPrefix");
    assert.equal(sources.length, 2);
    assert(sources.every(source => source.source_max === 2000));
    const literals = find<string>(result.project.programs, "String");
    assert(literals.includes("😀a") && literals.includes("é"));
    for (const [literal, scalars] of [["😀a", 2], ["é", 2], ["😀", 1], ["é", 1]] as const) {
      const control = await compiled(`query literal():\n  return people['${literal}'] first 20 by bySearch\n`);
      assert.deepEqual(find(control.project.programs, "WordPrefix"), [{
        source: { Literal: { String: literal } }, contract: SEARCH_CONTRACT, source_max: scalars,
      }]);
    }
    assert.deepEqual(apiConsumerDiagnostics(result.apiDts, `import { api } from 'snapback2/client';
      api.search.search.__args?.({ term: '😀a', maybe: 'é' });
      api.search.search.__args?.({ term: '😀a' });
      // @ts-expect-error text is still a string on the public API
      api.search.search.__args?.({ term: 2 });`), []);
  });

  test("text minimum rendering survives the Quarry-only diagnostic repair recursively", async () => {
    await withProject({
      "snapback/schema.q": minimumSchema,
      "snapback/probe.ts": `import { query, t } from 'snapback2';
        export const probe = query({ value: t.optional(t.list(t.text(20, { min: 2 }), { max: 4 })) }, ({ args }) => args.value);`,
    }, async root => {
      const result = await lowerProject(root);
      assert(!result.ok, "TypeScript authoring was admitted");
      assert(result.diagnostics.some(d => d.code === "E_QUARRY_ONLY" && d.rewrite === "query probe(value: [text 2..20] <=4 ?):"), JSON.stringify(result));
    });
  });

  for (const [kind, initializer, optional] of [
    ["coalesce", "wide ?? ''", " ?"],
    ["object field", "{ text: wide }.text", ""],
  ]) {
    for (const shadow of ["wide", "other"]) for (const later of [false, true]) {
      test(`captured ${kind} keeps Q with ${shadow} declared ${later ? "after" : "before"} scan`, async () => {
        const result = await compiled(`query search(term: text <=2000${optional}):
  wide = term
  original = ${initializer}
  if true:
${later ? "" : `    ${shadow} = 'x'\n`}    page = people[original] first 20 by bySearch
${later ? `    ${shadow} = 'x'\n` : ""}    return page
  return null
`);
        const scan = find<Scan>(result.project.programs, "Scan")[0]!;
        assert.deepEqual(runPure(result.project.programs[0]!, {term: "café"}).scans[0]!.prefix, [{source: "café", Q: 2000}]);
        assert.deepEqual(scan.prefix, [{ WordPrefix: {
          source: { Variable: "original" }, contract: SEARCH_CONTRACT, source_max: 2000,
        } }]);
      });
    }
    test(`merged ${kind} capture preserves Q and existing held eligibility across shadows`, async () => {
      for (const shadow of ["wide", "otherWide"]) {
        const source = `query search(other: principal, term: text <=2000${optional}, c: cursor ?):
  who = viewer
  originalViewer = who
  wide = term
  original = ${initializer}
  if true:
    who = other
    ${shadow} = 'x'
    page = merge docs after c last 20 by bySearch:
      [m.room, original] for m in memberships[originalViewer] first 100 by byPrincipal
    return page
  return null
`;
        const result = await compiled(source);
        const value = merge(result.project.programs[0]!);
        const term = { source: { Variable: "original" }, contract: SEARCH_CONTRACT, source_max: 2000 };
        assert.deepEqual(value.lanes[0]!.scan.prefix[1], { WordPrefix: term });
        // Compound terms already use ordinary replay. The same captured viewer
        // must still qualify when the term is a direct required argument.
        assert.equal(value.held_search, undefined);
        const direct = await compiled(source.replace("term: text <=2000 ?", "term: text <=2000")
          .replace("[m.room, original]", "[m.room, term]"));
        const held = merge(direct.project.programs[0]!).held_search;
        assert.deepEqual(held?.term, { ...term, source: { Variable: "term" } });
        assert.deepEqual(held?.discovery.scan.prefix, [{ Scalar: { Variable: "originalViewer" } }]);
      }
    });
  }

  test("captured optional words aliases keep whole-list and element bounds after contextual writes", async () => {
    for (const shadow of ["wide", "other"]) {
      const result = await compiled(`mutation search(body: text <=50 ?):
  wide = body
  terms = words(wide)
  alias = terms
  if true:
    ${shadow} = 'x'
    insert records { terms: alias }
    for term in alias:
      page = people[term] first 20 by bySearch
  return null
`, schema + `table records:
  terms: [text <=200] <=101
  public
  insert <- allow
`);
      const program = result.project.programs[0]!;
      assert.equal(find<{ max: number }>(program, "DerivedArray")[0]?.max, 101);
      assert.equal(find<{ source_max: number }>(program, "WordPrefix")[0]?.source_max, 200);
      const actual = runPure(program, {body: "ONE two"});
      assert.deepEqual(actual.writes, [{id: "new-id", terms: ["one", "two"]}]);
      assert.deepEqual(actual.scans.map(s => s.prefix), [[{source: "one", Q: 200}], [{source: "two", Q: 200}]]);
    }
  });

  for (const search of [false, true]) test(`generated ${search ? "search" : "ordinary"} merge API checks as a real imported page`, async () => {
    const page = `merge docs after c last 20 by ${search ? "bySearch" : "byRoom"}:
    [m.room${search ? ", term" : ""}] for m in memberships[viewer] first 100 by byPrincipal`;
    const args = `${search ? "term: text <=2000, " : ""}c: cursor ?`;
    const source = `query global(${args}):
  page = ${page}
  alias = page
  return alias
query docs(${args}):
  return ${page}
query mergeByIndex(${args}):
  page = ${page}
  return page
query cards(${args}):
  page = ${page}
  return page { room, body }
`;
    const result = await compiled(source);
    assert.equal((result.apiDts.match(/Page<DocsRow>/g) ?? []).length, 3);
    assert.deepEqual(apiConsumerDiagnostics(result.apiDts, `
import type { Cursor, Page } from 'snapback2';
import { api, type Op } from 'snapback2/client';
type Row = { id: string; room: string; body?: string; caption?: string; at: number };
type Args = { ${search ? "term: string; " : ""}c?: Cursor | null };
const global: Op<Args, Page<Row>> = api.search.global;
const tableName: typeof global = api.search.docs;
const builtinName: typeof global = api.search.mergeByIndex;
const cards: Op<Args, { room: string; body?: string }[]> = api.search.cards;
type Result = NonNullable<typeof global.__result>;
declare const row: NonNullable<typeof api.search.global.__result>[number];
const room: string = row.room;
const caption: string | undefined = row.caption;
// @ts-expect-error a malformed declaration must not turn result fields into any.
const invalidTime: string = row.at;
// @ts-expect-error an undeclared result field must refuse.
row.missing;
// @ts-expect-error generated private operation aliases are not public members.
api.search.$q_operation_global;
// @ts-expect-error cursor arguments retain their nominal type.
const invalidArgs: Args = { ${search ? "term: 'h', " : ""}c: 'raw' };
// @ts-expect-error check the public member itself so widening its cursor to any is caught.
api.search.global.__args?.({ ${search ? "term: 'h', " : ""}c: 'raw' });
`), []);
  });

  test("search emits only explicit components and typed prefixes with independent Q through aliases", async () => {
    const result = await compiled(`query search(room: rooms, term: text <=2000, c: cursor ?):
  alias = term
  return docs[room, alias] after c last 20 by bySearch
query findPeople(term: text <=2000):
  return people[term] first 20 by bySearch
query decomposed():
  return people['É'] first 20 by bySearch
`);
    const indexes = result.project.schema.tables.docs!.indexes as Record<string, Index>;
    assert.deepEqual(indexes.bySearch, { components: [{ Column: "room" }, { WordPrefixes: { fields: ["body", "caption"], contract: SEARCH_CONTRACT } }, { Column: "at" }, { Column: "id" }], unique: false });
    assert.deepEqual(indexes.byId, { components: [{ Column: "id" }], unique: true });
    assert.deepEqual(indexes.byRoom!.components, [{ Column: "room" }, { Column: "at" }, { Column: "id" }]);
    const scans = ["search", "findPeople", "decomposed"].map(name => find<Scan>(result.project.programs.find(p => p.name === `search.${name}`), "Scan")[0]!);
    assert.deepEqual(scans[0]!.prefix, [{ Scalar: { Variable: "room" } }, { WordPrefix: { source: { Variable: "alias" }, contract: SEARCH_CONTRACT, source_max: 2000 } }]);
    assert.equal((scans[1]!.prefix[0] as any).WordPrefix.source_max, 2000);
    assert.equal((scans[2]!.prefix[0] as any).WordPrefix.source_max, 2);
    assert(result.apiDts.includes("search") && result.apiDts.includes("Cursor"));
    assert(Object.values(result.sources).some(s => s.file === "snapback/search.q"));
  });

  for (const declaration of [
    "unique bySearch: wordPrefixes(body), id", "by bySearch: wordPrefixes(body)",
    "by bySearch: wordPrefixes(body), wordPrefixes(caption), id", "by bySearch: wordPrefixes(), id",
    "by bySearch: wordPrefixes(body, body), id", "by bySearch: wordPrefixes(missing), id",
    "by bySearch: wordPrefixes(at), id", "by bySearch: wordPrefixes(id), id",
    "by bySearch: room, room, wordPrefixes(body), id", "cap 20 by wordPrefixes(body)",
  ]) test(`search refuses invalid declaration ${declaration}`, () => {
    const result = compileInline([{ fileName: "snapback/schema.q", source: schema.replace("by bySearch: room, wordPrefixes(body, caption), at, id", declaration) }]);
    assert(!result.ok, declaration);
    assert(result.diagnostics.every(d => d.site.startsWith("snapback/schema.q:") && d.family && d.guide && d.rewrite));
  });
  for (const expression of [
    "docs[room] first 20 by bySearch", "docs[room, term] by bySearch", "exists docs[room, term] by bySearch",
    "docs[room = room, body = term] first 20 by bySearch", "docs[room, maybe] first 20 by bySearch",
    "docs[room, term + term] first 20 by bySearch", "docs[room, 3] first 20 by bySearch",
    "update docs[room, term] { body: term }", "upsert docs[room, term] { body: term, at: now }", "delete docs[room, term]",
  ]) test(`search refuses invalid access ${expression}`, async () => {
    await withProject({ "snapback/schema.q": schema, "snapback/search.q": `mutation bad(room: rooms, term: text <=2000, maybe: text <=20 ?):\n  return ${expression}\n` }, async root => {
      const result = await lowerProject(root);
      assert(!result.ok, expression);
      assert(result.diagnostics.some(d => d.site.startsWith("snapback/search.q:") && d.family && d.guide && d.rewrite));
    });
  });
  test("derived rule probes, final-exists, and maintain expressions are refused", () => {
    for (const source of [
      schema.replace("read <- exists memberships[.room, viewer] by byRoomPrincipal", "read <- exists docs[.room, .role] by bySearch"),
      schema + "table refs:\n  room: rooms\n  text: text <=20\n  after insert <- exists docs[.room, .text] by bySearch\n",
      schema + "maintain counts = count docs by wordPrefixes(body):\n  read <- allow\n",
    ]) assert.equal(compileInline([{ fileName: "snapback/schema.q", source }]).ok, false);
  });
  test("canonical global search emits the complete held descriptor", async () => {
    const result = await compiled(global);
    const value = merge(result.project.programs[0]!);
    assert(value.held_search, JSON.stringify(value));
    const lane = value.lanes[0]!;
    assert.deepEqual(value.held_search, {
      table: "docs", index: "bySearch", term: { source: { Variable: "term" }, contract: SEARCH_CONTRACT, source_max: 2000 },
      scope: [{ column: "room", value: { Field: { base: { Variable: "m" }, name: "room" } } }],
      suffix: ["at", "id"], order: "Desc", take: { Literal: 20 }, after: { Variable: "c" },
      discovery: { scan: lane.source, binding: "m", authorization_index: "byRoomPrincipal" },
    });
    const generated = result.quarry.find(q => q.file === "snapback/schema.q")!.source;
    const tables = lowerSchema(generated, "schema.ts", true).tables;
    const env = { kind: "Query", tables, args: result.project.programs[0]!.args, variables: new Map() } as Environment;
    for (const patch of [{ before: { Literal: "Null" } }, { range: { gt: { Literal: { Int: 1 } }, gte: null, lt: null, lte: null } }]) {
      const changed = { ...value, lanes: [{ ...lane, scan: { ...lane.scan, ...patch } as Scan }] };
      assert.equal(heldSearchDescriptor(changed, env), undefined);
    }
    for (const patch of [{ after: { Literal: "Null" } }, { range: { gt: { Literal: { Int: 1 } }, gte: null, lt: null, lte: null } }]) {
      const changed = { ...value, lanes: [{ ...lane, source: { ...lane.source!, ...patch } as Scan }] };
      assert.equal(heldSearchDescriptor(changed, env), undefined);
    }
  });
  for (const [label, source, schemaSource] of [
    ["extra membership role", global.replace("memberships[viewer] first 100 by byPrincipal", "memberships[viewer, 'admin'] first 100 by byPrincipalRole"), schema],
    ["different principal", global.replace("term: text <=2000", "who: principal, term: text <=2000").replace("memberships[viewer]", "memberships[who]"), schema],
    ["extra source rule", global, schema.replace("  insert <- allow", "  insert <- allow").replace("  read <- exists memberships[.room, viewer] by byRoomPrincipal\n  insert", "  read <- exists memberships[.room, viewer] by byRoomPrincipal and .body = 'x'\n  insert")],
    ["unproven discovery authority", global, schema.replace("  read <- exists memberships[.room, viewer] by byRoomPrincipal", "  read <- .role = 'admin'")],
    ["row-dependent term", global.replace("[m.room, term]", "[m.room, m.role]"), schema],
    ["lane setup", global.replace("[m.room, term]", "[m.room, docs[term]!.body!]").replace("term: text <=2000", "term: docs"), schema],
    ["extra fixed lane", global.replace("  return page", "    ['room-other', term]\n  return page"), schema],
  ] as const) test(`held descriptor excludes ${label}`, async () => {
    const result = await compiled(source, schemaSource);
    assert.equal(merge(result.project.programs[0]!).held_search, undefined);
  });

  for (const capturedViewer of [false, true]) {
    for (const innerName of ["who", "person"]) {
      test(`held discovery preserves captured ${capturedViewer ? "viewer" : "argument"} with inner ${innerName}`, async () => {
        const result = await compiled(`query search(${capturedViewer ? "other" : "who"}: principal, term: text <=2000, c: cursor ?):
${capturedViewer ? "  who = viewer\n" : ""}  original = who
  if true:
    ${innerName} = ${capturedViewer ? "other" : "viewer"}
    page = merge docs after c last 20 by bySearch:
      [m.room, term] for m in memberships[original] first 100 by byPrincipal
    return page
  return null
`);
        const program = result.project.programs[0]!;
        const value = merge(program);
        assert.equal(Boolean(value.held_search), capturedViewer);
        const actual = runPure(program, {who: "argument-1", other: "argument-1", term: "café", c: null}, {memberships: [{room: "room-1"}]});
        assert.deepEqual(actual.scans[0]!.prefix, [{scalar: capturedViewer ? "viewer-1" : "argument-1"}]);
        assert.deepEqual(actual.scans[1]!.prefix, [{scalar: "room-1"}, {source: "café", Q: 2000}]);
        assert.deepEqual(value.lanes[0]!.source!.prefix, [{ Scalar: { Variable: "original" } }]);
        assert.equal(value.lanes[0]!.source!.provenance, capturedViewer ? "Viewer" : "Arg");
        const captures = find<any>(program, "Const");
        assert.deepEqual(captures.find(c => c.name === "original").value, { Variable: "who" });
        if (capturedViewer) assert.deepEqual(captures.find(c => c.name === "who").value, { Input: "Viewer" });
      });
    }
  }
  for (const helper of [false, true]) for (const viewer of [false, true]) {
    test(`held tuple discovery retains actual principal and eligibility helper=${helper} viewer=${viewer}`, async () => {
      const base = await compiled(global);
      const tables = lowerSchema(base.quarry.find(q => q.file === "snapback/schema.q")!.source, "schema.ts", true).tables;
      const result = lowerSource(`import { query, t, mergeByIndex } from 'snapback2';
        declare const memberships: any; declare const docs: any;
        function tuple(x: unknown) { return [x]; }
        export const search = query({other:t.principal(),term:t.text(2000)},({db,args,ctx})=>{
          const who=${viewer ? 'ctx.viewer' : 'args.other'};
          const original=${helper ? 'tuple(who)' : '[who]'};
          if(true){const who=${viewer ? 'args.other' : 'ctx.viewer'};
            return mergeByIndex([{rows:db.scan(memberships.byPrincipal,original,{take:100}),
              lane:(m:any)=>db.scan(docs.bySearch,[m.room,args.term],{take:20})}],20,'search');}
          return null;
        });`, "search.ts", libText, {tables});
      assert(result.ok, JSON.stringify(result));
      const program = result.programs[0]!;
      assert.equal(Boolean(merge(program).held_search), viewer);
      const actual = runPure(program, {other:"other-1",term:"café"}, {memberships:[{room:"room-1"}]});
      assert.deepEqual(actual.scans[0]!.prefix, [{scalar:viewer ? "viewer-1" : "other-1"}]);
      assert.deepEqual(actual.scans[1]!.prefix, [{scalar:"room-1"},{source:"café",Q:2000}]);
    });
  }
  test("captured search term Q and held invariance survive a smaller same-name binding", async () => {
    const result = await compiled(`query search(term: text <=2000, c: cursor ?):
  original = term
  if true:
    term = 'x'
    page = merge docs after c last 20 by bySearch:
      [m.room, original] for m in memberships[viewer] first 100 by byPrincipal
    return page
  return null
query peopleSearch(term: text <=2000):
  original = term
  if true:
    term = 'x'
    return people[original] first 20 by bySearch
  return null
`);
    const value = merge(result.project.programs.find(p => p.name === "search.search")!);
    assert(value.held_search);
    assert.deepEqual(value.held_search.term, { source: { Variable: "original" }, contract: SEARCH_CONTRACT, source_max: 2000 });
    const scan = find<Scan>(result.project.programs.find(p => p.name === "search.peopleSearch"), "Scan")[0]!;
    assert.deepEqual(scan.prefix, [{ WordPrefix: value.held_search.term }]);
  });
  test("held scope does not confuse a captured outer row with the lane's same-name row", async () => {
    const result = await compiled(`query search(member: memberships, term: text <=2000, c: cursor ?):
  m = memberships[member]!
  room = m.room
  page = merge docs after c last 20 by bySearch:
    [room, term] for m in memberships[viewer] first 100 by byPrincipal
  return page
`);
    const value = merge(result.project.programs[0]!);
    assert.equal(value.held_search, undefined);
    assert.deepEqual(value.lanes[0]!.scan.prefix[0], { Scalar: { Variable: "room" } });
  });

  test("ordinary and derived suffix bounds retain Expr shapes; omitted derived and unique constraints refuse", () => {
    const lowered = lowerSchema(`import { table, schema, t, rule } from 'snapback2';
      export const docs = table({ columns: { body: t.optional(t.text(20)), at: t.int() },
        indexes: { search: { components: [{ WordPrefixes: { fields: ['body'], contract: '${SEARCH_CONTRACT}' } }, { Column: 'at' }, { Column: 'id' }] } }, rules: { read: rule.allow() } });
      export default schema({ tables: { docs } });`, "schema.ts");
    assert.deepEqual(lowered.diagnostics, []);
    const program = (prefix: string) => lowerSource(`import { query, t } from 'snapback2'; declare const docs: any;
      export const search = query({ term: t.text(2000) }, ({ db, args }) => db.scan(docs.search, ${prefix}, { take: 10, range: { gte: 7 }, after: [8, 'r'], before: [99, 'z'] }));`, "search.ts", libText, { tables: lowered.tables });
    const result = program("[args.term]");
    assert(result.ok, JSON.stringify(result));
    const scan = find<Scan>(result.programs[0], "Scan")[0]!;
    assert.deepEqual(scan.range, { gt: null, gte: { Literal: { Int: 7 } }, lt: null, lte: null });
    assert(scan.after && "Array" in scan.after && scan.before && "Array" in scan.before);
    assert.equal(program("[]").ok, false);
    const source = `import { table, schema, t } from 'snapback2'; export const docs=table({ columns: { body:t.text(20) }, indexes:{ search:{ components:[{WordPrefixes:{fields:['body'],contract:'${SEARCH_CONTRACT}'}},{Column:'id'}] } }, constraints:[{unique:'search'}] }); export default schema({tables:{docs}});`;
    assert(lowerSchema(source, "schema.ts").diagnostics.some(d => d.code === "E_SCHEMA_CONSTRAINT"));
  });

  test("Unicode words accepts optional null and preserves expanded element bounds through aliases", async () => {
    const result = await compiled(`query wordsProbe(body: text <=50 ?):
  first = words(body)
  second = first
  for word in second:
    require word != '' else EMPTY
  return second
`);
    const loop = find<any>(result.project.programs[0], "DerivedArray")[0];
    assert.equal(loop.max, 101);
    assert.equal(find<any>(result.project.programs[0], "Builtin").filter(b => b.builtin === "Words").length, 1);
  });

  test("search fallback, assertion, field, object and list-element sources carry their own maxima", async () => {
    const result = await compiled(`query fallback(room: rooms, term: text <=2000 ?):
  return docs[room, term ?? ''] first 20 by bySearch
query asserted(room: rooms, term: text <=2000 ?):
  return docs[room, term!] first 20 by bySearch
query fieldSource(room: rooms, person: people):
  p = people[person]!
  return docs[room, p.name] first 20 by bySearch
query objectSource(room: rooms, term: text <=2000):
  pair = { text: term }
  return docs[room, pair.text] first 20 by bySearch
query wordsSource(room: rooms, body: text <=20 ?):
  terms = words(body)
  for term in terms:
    page = docs[room, term] first 20 by bySearch
  return true
`);
    const expected = { fallback: 2000, asserted: 2000, fieldSource: 50, objectSource: 2000, wordsSource: 80 };
    for (const [name, maximum] of Object.entries(expected)) {
      const scan = find<Scan>(result.project.programs.find(p => p.name === `search.${name}`), "Scan").find(s => s.index === "bySearch")!;
      assert.equal((scan.prefix[1] as any).WordPrefix.source_max, maximum, name);
    }
  });

  test("a derived equality never pins its source field for authorization", async () => {
    const result = await compiled(global);
    const tables = lowerSchema(result.quarry.find(q => q.file === "snapback/schema.q")!.source, "schema.ts", true).tables;
    tables.get("docs")!.readRule = { Eq: [{ Field: "body" }, { Literal: { String: "x" } }] };
    const counted = lowerSource(`import { query } from 'snapback2';
      export const countSearch = query({}, ({db}) => db.scan(docs.bySearch, ['room', 'x'], {take:20}).count());`,
      "count.ts", undefined, { tables });
    assert(!counted.ok, JSON.stringify(counted));
    assert(counted.diagnostics.some(d => d.code === "E_STRUCTURAL_COUNT"), JSON.stringify(counted));
  });

  test("search source and words maxima refuse beyond the finite normalizer bound", async () => {
    for (const expression of ["words(term)", "people[term] first 20 by bySearch"]) {
      await withProject({ "snapback/schema.q": schema, "snapback/search.q": `query bad(term: text <=1073741824):\n  return ${expression}\n` }, async root => {
        assert.equal((await lowerProject(root)).ok, false);
      });
    }
  });

  test("schema exports preserve all derived fields, order and contract without fabricating a source column", async () => {
    const left = await compiled(global), right = await compiled(global, schema.replace("wordPrefixes(body, caption)", "wordPrefixes(caption, body)"));
    const one = (left.project.schema.tables.docs!.indexes as any).bySearch;
    const two = (right.project.schema.tables.docs!.indexes as any).bySearch;
    assert.notDeepEqual(one, two);
    assert.equal(one.columns, undefined);
    assert.equal((left.project.schema.tables.docs!.columns as any).wordPrefixes, undefined);
    assert.equal(one.components[1].WordPrefixes.contract, SEARCH_CONTRACT);
    assert.equal(compileInline([{ fileName: "snapback/schema.q", source: schema.replace("wordPrefixes(body, caption)", "wordPrefixes(body, 'caption')") }]).ok, false);
  });

  test("nonpageable search accepts an ordinary non-id suffix; pageable repair preserves derived components", async () => {
    const shortSchema = schema.replace("by bySearch: wordPrefixes(name, handle), id", "by bySearch: wordPrefixes(name, handle), name");
    const result = await compiled("query search(term: text <=2000):\n  return people[term] first 20 by bySearch\n", shortSchema);
    const tables = lowerSchema(result.quarry.find(q => q.file === "snapback/schema.q")!.source, "schema.ts", true).tables;
    const cursored = lowerSource(`import { query, t } from 'snapback2'; declare const people: any;
      export const search = query({ term: t.text(2000) }, ({ db, args }) => db.scan(people.bySearch, [args.term], { take: 20, after: ['A'] }));`, "search.ts", libText, { tables });
    assert(!cursored.ok);
    const repair = cursored.diagnostics.find(d => d.code === "E_ARGS_CURSOR_INDEX")!.rewrite;
    assert(repair.includes('"WordPrefixes"') && repair.includes('"Column":"id"') && !repair.includes("columns:"), repair);
    await withProject({ "snapback/schema.q": shortSchema, "snapback/search.q": "query search(term: text <=2000, c: cursor ?):\n  return people[term] after c first 20 by bySearch\n" }, async root => {
      const page = await lowerProject(root);
      assert(!page.ok);
      assert(page.diagnostics.some(d => d.rewrite.includes("wordPrefixes(name, handle), name, id")), JSON.stringify(page));
    });
  });

  test("private lowering carries independent Q through tuple aliases and helper bindings", async () => {
    const result = await compiled(global);
    const tables = lowerSchema(result.quarry.find(q => q.file === "snapback/schema.q")!.source, "schema.ts", true).tables;
    const lowered = lowerSource(`import { query, t, Db } from 'snapback2'; declare const people: any;
      function key(term: string) { return [term]; }
      function search(db: Db, term: string) { return db.scan(people.bySearch, [term], { take: 20 }); }
      export const alias = query({ term: t.text(2000) }, ({db,args}) => { const prefix = [args.term]; return db.scan(people.bySearch, prefix, {take:20}); });
      export const helperTuple = query({ term: t.text(2000) }, ({db,args}) => db.scan(people.bySearch, key(args.term), {take:20}));
      export const helperScan = query({ term: t.text(2000) }, ({db,args}) => search(db, args.term));`, "search.ts", libText, { tables });
    assert(lowered.ok, JSON.stringify(lowered));
    for (const program of lowered.programs) {
      const scan = find<Scan>(program, "Scan")[0]!;
      assert.equal((scan.prefix[0] as any).WordPrefix.source_max, 2000, program.name);
    }
  });

  test("private point, write and recursion addresses cannot use a derived index", async () => {
    const result = await compiled(global);
    const tables = lowerSchema(result.quarry.find(q => q.file === "snapback/schema.q")!.source, "schema.ts", true).tables;
    for (const body of [
      "return db.get(people.bySearch, [args.term]);", "return db.exists(people.bySearch, [args.term]);",
      "db.insert(people.bySearch, {id:'p',name:args.term,handle:null}); return true;",
      "return db.insert(people.bySearch, {id:'p',name:args.term,handle:null});",
      "db.update(people.bySearch, 'p', {name:args.term}); return true;",
      "db.delete(people.bySearch, 'p'); return true;",
      "db.upsert(people.bySearch, 'p', {name:args.term}); return true;",
      "for (const row of recurse(db.get(people, 'p'), (row) => db.get(people.bySearch, row.handle), {depth:2,fanout:1})) {} return true;",
    ]) {
      const lowered = lowerSource(`import { mutation, t, recurse } from 'snapback2';
        export const bad = mutation({term:t.text(2000)}, ({db,args}) => { ${body} });`, "search.ts", undefined, { tables });
      assert(!lowered.ok, body);
      assert(lowered.diagnostics.some(d => d.message.includes("wordPrefixes") && d.code === "E_ARGS_TYPE"), JSON.stringify(lowered));
    }
  });

  test("schema descriptor validation refuses unknown contracts, mixed tags and dual representations", () => {
    for (const index of [
      `{components:[{WordPrefixes:{fields:['body'],contract:'ascii'}},{Column:'id'}]}`,
      `{components:[{Column:'body',WordPrefixes:{fields:['body'],contract:'${SEARCH_CONTRACT}'}},{Column:'id'}]}`,
      `{columns:['body'],components:[{Column:'body'}]}`,
      `{components:[{WordPrefixes:{fields:['body'],contract:'${SEARCH_CONTRACT}',max:50}},{Column:'id'}]}`,
    ]) {
      const result = lowerSchema(`import {table,schema,t} from 'snapback2';
        export const docs=table({columns:{body:t.text(20)},indexes:{search:${index}}}); export default schema({tables:{docs}});`, "schema.ts");
      assert(result.diagnostics.length > 0, index);
    }
  });
}
