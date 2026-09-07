import { deepStrictEqual } from "node:assert";
import { readFileSync, readdirSync } from "node:fs";
import { writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { canonicalValue, ClientStore, scopedRuleHash, type ClosureReceipt, type Context, type Value } from "../../evaluator/src/evaluator";
import type { Program } from "./ir";
import { lowerProject, lowerSeed } from "./project";
import { rustCheck, type RustCheckResult } from "./rust-check";
import { bindQuarryProgram } from "./quarry/bound";
import { lowerBoundQuarryProgram } from "./quarry/direct";
import { compileQuarry, prepareQuarry, type QuarryInput } from "./quarry/index";
import { parseDocument } from "./quarry/parser";
import {
  assert,
  compileFixture,
  compileInline,
  deepKey,
  diagnosticsText,
  occurrences,
  operation,
  type Test,
  withProject,
} from "./quarry-check-helpers";
import ts from "typescript";

export function registerQuarryProgramChecks(test: Test, frontend: string): void {
  const fixtures = resolve(frontend, "fixtures");
  const packageRoot = resolve(frontend, "../snapback2");
  test("direct Quarry binds and certifies one indexed existence query identically to the parity oracle", async () => {
    const root = join(fixtures, "quarry-surface");
    const inputs: QuarryInput[] = ["schema", "surface"].map((stem) => {
      const path = join(root, "snapback", `${stem}.q`);
      return { path, fileName: `snapback/${stem}.q`, source: readFileSync(path, "utf8") };
    });
    const prepared = prepareQuarry(inputs);
    assert(prepared.ok, `direct Quarry preparation failed: ${JSON.stringify(prepared.ok ? [] : prepared.diagnostics)}`);
    assert(prepared.prepared.diagnostics.length === 0,
      `direct Quarry preparation retained diagnostics: ${JSON.stringify(prepared.prepared.diagnostics)}`);
    const declaration = prepared.prepared.documents
      .flatMap((document) => document.programs)
      .find((program) => program.name === "hasMembership");
    assert(declaration, "quarry-surface has no hasMembership declaration");

    const bound = bindQuarryProgram(declaration, prepared.prepared.catalog);
    const direct = lowerBoundQuarryProgram(bound);
    const oracle = await lowerProject(root);
    assert(oracle.ok, `generated-TypeScript parity oracle failed: ${oracle.ok ? "" : diagnosticsText(oracle.diagnostics)}`);
    const legacy = operation(oracle.project.programs, "surface.hasMembership");
    deepStrictEqual(direct, legacy);
    deepStrictEqual(bound.result.type, { kind: "bool", optional: false });
    assert(bound.source.definition.file === "snapback/surface.q"
      && bound.source.definition.line === 11 && bound.source.definition.col === 1,
    `direct source stack lost the authored operation site: ${JSON.stringify(bound.source)}`);

    const directCheck = rustCheck([direct], "synthetic", oracle.project.schema)[0]!;
    const legacyCheck = rustCheck([legacy], "synthetic", oracle.project.schema)[0]!;
    assert(!directCheck.error && directCheck.certificate,
      `direct indexed existence query did not certify: ${JSON.stringify(directCheck)}`);
    deepStrictEqual(directCheck, legacyCheck);
  });

  test("direct Quarry value and bounded-read core matches public fixture programs", async () => {
    const cases = [
      { fixture: "quarry-surface", operations: ["surface.keyedRow", "surface.wordTokens", "surface.counterTotal"] },
      { fixture: "quarry-todos", operations: ["todos.list"] },
      { fixture: "quarry-money", operations: ["money.atMost"] },
      { fixture: "quarry-assets", operations: ["assets.echo", "assets.echoNested"] },
    ];
    for (const fixture of cases) {
      const root = join(fixtures, fixture.fixture);
      const inputs: QuarryInput[] = readdirSync(join(root, "snapback"))
        .filter((file) => file.endsWith(".q"))
        .map((file) => {
          const path = join(root, "snapback", file);
          return { path, fileName: `snapback/${file}`, source: readFileSync(path, "utf8") };
        });
      const prepared = prepareQuarry(inputs);
      assert(prepared.ok, `${fixture.fixture} direct preparation failed: ${JSON.stringify(prepared.ok ? [] : prepared.diagnostics)}`);
      const oracle = await lowerProject(root);
      assert(oracle.ok, `${fixture.fixture} parity oracle failed: ${oracle.ok ? "" : diagnosticsText(oracle.diagnostics)}`);
      for (const name of fixture.operations) {
        const [moduleName, operationName] = name.split(".");
        const declaration = prepared.prepared.documents
          .find((document) => document.file === `snapback/${moduleName}.q`)
          ?.programs.find((program) => program.name === operationName);
        assert(declaration, `${fixture.fixture} has no ${name} declaration`);
        const bound = bindQuarryProgram(declaration, prepared.prepared.catalog);
        const direct = lowerBoundQuarryProgram(bound);
        const legacy = operation(oracle.project.programs, name);
        const directCheck: RustCheckResult = rustCheck([direct], "synthetic", oracle.project.schema)[0]!;
        const legacyCheck: RustCheckResult = rustCheck([legacy], "synthetic", oracle.project.schema)[0]!;
        assert(!directCheck.error && directCheck.certificate, `${name} direct program did not certify: ${JSON.stringify(directCheck)}`);
        assert(!legacyCheck.error && legacyCheck.certificate, `${name} oracle program did not certify: ${JSON.stringify(legacyCheck)}`);
        if (name === "surface.counterTotal") {
          deepStrictEqual(directCheck.certificate.bounds, legacyCheck.certificate.bounds);
        } else {
          deepStrictEqual(direct, legacy);
          deepStrictEqual(directCheck, legacyCheck);
        }
      }
    }
  });

  test("direct Quarry value lowering preserves authored order and bound facts", async () => {
    const schema = `table rows:
  public

table groups:
  public

table memberships:
  group: groups
  principal: principal
  unique group, principal
  public
`;
    const values = `query values(photo: image <=5000000, a: int, b: int):
  return { pair: [a, b], negative: -a, inverted: not false, sum: a + b, maximum: max(a, b), width: photo.width, owner: viewer, missing: null }

query ordered(group: groups, left: principal, right: principal):
  return exists memberships[group, left] or exists memberships[group, right]
`;
    await withProject({ "snapback/schema.q": schema, "snapback/values.q": values }, async (root) => {
      const paths = ["schema", "values"].map((stem) => join(root, "snapback", `${stem}.q`));
      const prepared = prepareQuarry(paths.map((path, index) => ({
        path, fileName: `snapback/${["schema", "values"][index]}.q`, source: readFileSync(path, "utf8"),
      })));
      assert(prepared.ok, `direct value preparation failed: ${JSON.stringify(prepared.ok ? [] : prepared.diagnostics)}`);
      const declaration = prepared.prepared.documents[1]?.programs[0];
      assert(declaration, "direct value fixture has no operation");
      const bound = bindQuarryProgram(declaration, prepared.prepared.catalog);
      const direct = lowerBoundQuarryProgram(bound);
      const oracle = await lowerProject(root);
      assert(oracle.ok, `direct value parity oracle failed: ${oracle.ok ? "" : diagnosticsText(oracle.diagnostics)}`);
      deepStrictEqual(direct, operation(oracle.project.programs, "values.values"));
      assert(bound.result.type.kind === "object" && bound.result.presence === "required",
        `direct object result lost presence: ${JSON.stringify(bound.result)}`);
      const pair = bound.result.type.fields.get("pair");
      assert(pair?.max === 2 && pair.presence === "required", `direct array result lost bound facts: ${JSON.stringify(pair)}`);

      const orderedDeclaration = prepared.prepared.documents[1]?.programs[1];
      assert(orderedDeclaration, "direct value fixture has no ordered-read operation");
      const ordered = lowerBoundQuarryProgram(bindQuarryProgram(orderedDeclaration, prepared.prepared.catalog));
      deepStrictEqual(ordered.body, [
        { Const: { name: "__operand0", value: { Exists: {
          site: "values.ordered.0", table: "memberships", index: "byGroupPrincipal",
          key: [{ Variable: "group" }, { Variable: "left" }], provenance: "Arg",
        } } } },
        { Const: { name: "__operand1", value: { Exists: {
          site: "values.ordered.1", table: "memberships", index: "byGroupPrincipal",
          key: [{ Variable: "group" }, { Variable: "right" }], provenance: "Arg",
        } } } },
        { Return: { Binary: { op: "Or", left: { Variable: "__operand0" }, right: { Variable: "__operand1" } } } },
      ]);
      const orderedCheck = rustCheck([ordered], "synthetic", oracle.project.schema)[0]!;
      const orderedOracle = rustCheck([operation(oracle.project.programs, "values.ordered")], "synthetic", oracle.project.schema)[0]!;
      assert(!orderedCheck.error && orderedCheck.certificate, `ordered direct program did not certify: ${JSON.stringify(orderedCheck)}`);
      assert(!orderedOracle.error && orderedOracle.certificate, `ordered oracle program did not certify: ${JSON.stringify(orderedOracle)}`);
      deepStrictEqual(orderedCheck.certificate.read_sites, orderedOracle.certificate.read_sites);
    });
  });

  test("direct Quarry names do not inherit generated TypeScript restrictions", () => {
    const inputs: QuarryInput[] = [
      { path: "/virtual/snapback/schema.q", fileName: "snapback/schema.q", source: "table rows:\n  public\n" },
      { path: "/virtual/snapback/names.q", fileName: "snapback/names.q", source: "query class(default: int):\n  return default\n" },
    ];
    const prepared = prepareQuarry(inputs);
    assert(prepared.ok, `direct Quarry retained emitter name restrictions: ${JSON.stringify(prepared.ok ? [] : prepared.diagnostics)}`);
    const declaration = prepared.prepared.documents[1]?.programs[0];
    assert(declaration, "direct name fixture has no operation");
    const direct = lowerBoundQuarryProgram(bindQuarryProgram(declaration, prepared.prepared.catalog));
    deepStrictEqual(direct, {
      name: "names.class", kind: "Query", args: { default: "Int" }, read_time_granularity_ms: null,
      body: [{ Return: { Variable: "default" } }],
    });
    const legacy = compileQuarry(inputs);
    assert(!legacy.ok && legacy.diagnostics.some((diagnostic) => diagnostic.message.includes("generated TypeScript binding")),
      `legacy oracle unexpectedly accepted its emitter-restricted names: ${JSON.stringify(legacy)}`);
  });

  test("Quarry table and operation names occupy separate generated bindings", async () => {
    const schema = `table messages:
  body: text <=100
  public
table reactions:
  messageId: messages
  emoji: text <=8
  by byMessage: messageId, id
  public
`;
    const module = `query reactions(messageId: messages):
  return reactions[messageId] first 20 by byMessage
`;
    await withProject({
      "snapback/schema.q": schema,
      "snapback/api.q": module,
      "snapback/seed.ts": `export default {
  personas: ["alice"],
  rows: {
    messages: [{ id: "m1", body: "hello" }, { id: "m2", body: "other" }],
    reactions: [
      { id: "r1", messageId: "m1", emoji: ":+1:" },
      { id: "r2", messageId: "m1", emoji: ":heart:" },
      { id: "r3", messageId: "m2", emoji: ":wave:" },
    ],
  },
};
`,
    }, async (root) => {
      const lowered = await lowerProject(root);
      assert(lowered.ok, `table/operation collision refused: ${lowered.ok ? "" : diagnosticsText(lowered.diagnostics)}`);
      const seed = await lowerSeed(root);
      assert(seed.ok && seed.seed.rows.reactions?.length === 3, "collision fixture seed did not lower");
      const seededMessages = seed.seed.rows.messages as Array<{ id: string; body: string }>;
      const seededReactions = seed.seed.rows.reactions as Array<{ id: string; messageId: string; emoji: string }>;
      assert(lowered.apiDts.includes("type ReactionsRow = {")
        && lowered.apiDts.includes("readonly reactions: Op<{ messageId: string }, Page<ReactionsRow>>;"),
      `api.d.ts did not retain both the reactions row and api.reactions query: ${lowered.apiDts}`);

      const generated = lowered.quarry?.find((item) => item.file === "snapback/api.q")?.source ?? "";
      assert(generated.includes("reactions as reactions$table")
        && generated.includes("db.scan(reactions$table.byMessage"),
      `generated table references did not use the collision-proof alias: ${generated}`);

      const program = operation(lowered.project.programs, "api.reactions");
      const checked = rustCheck([program], "synthetic", lowered.project.schema)[0]!;
      assert(!checked.error && checked.certificate, `collision query did not certify: ${JSON.stringify(checked)}`);
      const reactionValue = (row: { id: string; messageId: string; emoji: string }): Value => ({ Row: {
        id: { Id: row.id }, messageId: { Id: row.messageId }, emoji: { String: row.emoji },
      } });
      const reactionOne = reactionValue(seededReactions[0]!);
      const reactionTwo = reactionValue(seededReactions[1]!);
      const receipt: ClosureReceipt = {
        schema_hash: checked.certificate.schema_hash as string,
        rows: [
          ...seededMessages.map((row) => ({
            table: "messages", id: row.id, row: { Row: { id: { Id: row.id }, body: { String: row.body } } } as Value,
          })),
          ...seededReactions.map((row) => ({ table: "reactions", id: row.id, row: reactionValue(row) })),
        ],
        ranges: [], absences: [], verdicts: [],
      };
      const context: Context = {
        viewer: "alice", principal_kind: "user", auth_epoch: 1,
        args: { messageId: { Id: "m1" } }, now: 1, new_ids: [], read_time: 1,
      };
      const discovered = new ClientStore(lowered.project.schema, receipt)
        .reexecute(program, context, checked.certificate);
      assert(discovered.execution.trace.ranges.length === 1, "collision query did not execute its seeded range");
      receipt.ranges = discovered.execution.trace.ranges.map((range) => ({
        ...range, row_ids: ["r1", "r2"], stop: "Exhausted", absence: false, halo: null, n2_key: null,
      }));
      const replayed = new ClientStore(lowered.project.schema, receipt)
        .reexecute(program, context, checked.certificate);
      assert(replayed.state === "fresh", `seeded collision query was not locally complete: ${JSON.stringify(replayed)}`);
      deepStrictEqual(replayed.execution.result, { Array: [reactionOne, reactionTwo] });
    });
  });

  test("Quarry refuses effect names captured by generated helpers at the declaration", () => {
    const schema = "table rows:\n  public\n";
    for (const fixture of [
      { source: "effect range from delivery\nquery ping():\n  return null\n", collision: "generated module helper" },
      { source: "effect orderedPair from delivery\nquery ping():\n  return null\n", collision: "generated module helper" },
    ]) {
      const compiled = compileInline([
        { fileName: "snapback/schema.q", source: schema },
        { fileName: "snapback/ops.q", source: fixture.source },
      ]);
      const diagnostic = !compiled.ok && compiled.diagnostics.find((item) => item.family === "quarry");
      assert(diagnostic && diagnostic.site.startsWith("snapback/ops.q:")
        && diagnostic.message.includes(fixture.collision)
        && diagnostic.rewrite.includes("rename the "),
      `generated-import collision did not produce a sited Quarry rename: ${JSON.stringify(compiled)}`);
    }
  });

  test("Quarry hygiene preserves same-name table, operation, argument, cursor, and API identities", async () => {
    const schema = `table reactions:
  value: int
  public
  insert <- allow
  update <- allow
  delete <- allow
`;
    const reads = `query reactions(row: reactions):
  return reactions[row]

query ordinary(row: reactions):
  return reactions[row]
`;
    await withProject({
      "snapback/schema.q": schema,
      "snapback/reads.q": reads,
      "snapback/pages.q": "query reactions(c: cursor ?):\n  return reactions[] after c first 3 by byId\n",
      "snapback/writes.q": "mutation reactions(row: reactions, value: int):\n  update reactions[row] { value }\n  return reactions[row]\n",
    }, async (root) => {
      const result = await lowerProject(root);
      assert(result.ok, diagnosticsText(result.ok ? [] : result.diagnostics));
      const { project, apiDts, sources } = result;
      deepStrictEqual(project.programs.map((p) => p.name).sort(), ["pages.reactions", "reads.ordinary", "reads.reactions", "writes.reactions"]);
      deepStrictEqual(Object.keys(project.schema.tables), ["reactions"]);
      const same = operation(project.programs, "reads.reactions");
      const ordinary = operation(project.programs, "reads.ordinary");
      deepStrictEqual(same.args, ordinary.args);
      deepStrictEqual(JSON.parse(JSON.stringify(same.body).replaceAll("reads.reactions", "reads.ordinary")), ordinary.body);
      assert(JSON.stringify(same.args).includes('"table":"reactions"'), "reference argument lost its authored table");
      const page = operation(project.programs, "pages.reactions");
      assert(JSON.stringify(page).includes('"site":"pages.reactions.0"')
        && JSON.stringify(page).includes('"table":"reactions"'), "cursor site or scan table acquired a generated name");
      const write = operation(project.programs, "writes.reactions");
      assert(deepKey(write.body, "Update") && deepKey(write.body, "Get"), "same-name mutation lost its write/result read");
      assert(apiDts.includes("readonly reactions: Op<{ row: string }, ReactionsRow | null>")
        && apiDts.includes("Page<ReactionsRow>"), `same-name API lost its exact types: ${apiDts}`);
      assert(sources["reads.reactions"]?.file === "snapback/reads.q", "source identity is not the authored module");
      assert(!JSON.stringify({ project, apiDts, sources }).includes("$q_operation_"), "private name escaped into product output");
    });
  });

  test("Quarry hygiene isolates operation names from generated builtin imports and orderedPair", async () => {
    const names = ["deterministicShare", "divmod", "emit", "max", "mergeByIndex", "mentionTokens", "min", "mutation", "query", "range", "recurse", "t", "words", "orderedPair"];
    const modules = names.map((name) => `query ${name}(value: int):\n  (lo, hi) = sorted(value, 3)\n  return min(value, 3)\n`).join("\n");
    await withProject({ "snapback/schema.q": "table records:\n  value: int\n  public\n", "snapback/helpers.q": modules }, async (root) => {
      const result = await lowerProject(root);
      assert(result.ok, diagnosticsText(result.ok ? [] : result.diagnostics));
      deepStrictEqual(result.project.programs.map((p) => p.name).sort(), names.map((n) => `helpers.${n}`).sort());
      for (const name of names) {
        const program = operation(result.project.programs, `helpers.${name}`);
        assert(JSON.stringify(program.body).includes('"builtin":"Min"'), `${name} captured the min builtin`);
        assert(result.apiDts.includes(`readonly ${name}: Op<{ value: number }, number>`), `${name} lost its API types`);
      }
    });
  });

  test("Quarry hygiene preserves an effect import and its same-name then operation", async () => {
    await withProject({
      "snapback/schema.q": "table records:\n  value: int\n  public\n",
      "snapback/ops.q": `effect notify from delivery

mutation notify(outboxId: id, effect: text <=100, result: json <=1000):
  return true

mutation fire():
  emit notify { value: 1 }
  return true
`,
      "snapback/delivery.ts": `import { effect } from "snapback2";
import { notify as completed } from "./ops";
export const notify = effect({ grants: ["https://api.example.com"], run: async (payload: { value: number }) => payload, then: completed });
`,
    }, async (root) => {
      const result = await lowerProject(root);
      assert(result.ok, diagnosticsText(result.ok ? [] : result.diagnostics));
      assert(result.project.effects[0]?.name === "delivery.notify" && result.project.effects[0]?.then === "ops.notify", "effect/then lost exported identity");
      assert(JSON.stringify(operation(result.project.programs, "ops.fire").body).includes('"effect":"delivery.notify"'), "emit captured the same-name operation");
      assert(result.apiDts.includes("readonly notify: Op<"), "then operation disappeared from the API");
    });
  });

  test("Quarry hygiene retains existing named and namespace table alias lowering", async () => {
    await withProject({
      "snapback/schema.ts": `import { table, schema, rule, t } from "snapback2";
export const reactions = table({ columns: { value: t.int() }, rules: { read: rule.allow(), update: rule.allow() } });
export default schema({ tables: { reactions } });
`,
      "snapback/ops.ts": `import { query, mutation, t } from "snapback2";
import { reactions as rows } from "./schema";
import * as tables from "./schema";
export const reactions = query({ row: t.ref(rows) }, ({ db, args }) => db.get(rows, args.row));
export const page = query({}, ({ db }) => db.scan(tables.reactions.byId, [], { take: 3, order: "asc" }));
export const change = mutation({ row: t.ref(tables.reactions), value: t.int() }, ({ db, args }) => { db.update(rows, args.row, { value: args.value }); return db.get(tables.reactions, args.row); });
`,
    }, async (root) => {
      const result = await lowerProject(root, { authoring: "any" });
      assert(result.ok, diagnosticsText(result.ok ? [] : result.diagnostics));
      for (const program of result.project.programs) {
        assert(JSON.stringify(program.body).includes('"table":"reactions"'), `${program.name} lost the source table`);
        assert(!JSON.stringify(program).includes('"table":"rows"') && !JSON.stringify(program).includes('"table":"tables.reactions"'), "local table alias became the IR identity");
      }
      assert(result.apiDts.includes("ReactionsRow | null") && result.apiDts.includes("Page<ReactionsRow>"), "aliased table lost API row types");
    });
  });

  test("Quarry effects, maintains, aggregate sugar, returns, objects, and count reach IR", async () => {
    const chat = await lowerProject(resolve(fixtures, "quarry-chat"));
    const surface = await lowerProject(resolve(fixtures, "quarry-surface"));
    assert(chat.ok && surface.ok, "Quarry feature fixtures refused");
    const send = operation(chat.project.programs, "messages.send");
    assert(deepKey(send.body, "Emit") && JSON.stringify(send.body).includes('"effect":"delivery.notify"'), "effect/emit did not lower with its qualified effect");
    assert(chat.project.effects[0]?.then === "notifications.recordNotified", "effect then did not resolve the virtual Quarry mutation");
    const countMaintain = chat.project.schema.maintains[0] as any;
    assert(countMaintain.kind === "Count" && countMaintain.source === "messages" && countMaintain.target === "messageCounts", "count maintain changed");
    const sumMaintain = surface.project.schema.maintains[0] as any;
    assert(sumMaintain.kind?.Sum?.of === "value" && sumMaintain.readable, "sum/readable maintain changed");
    assert(deepKey(operation(surface.project.programs, "surface.counterTotal").body, "Get"), "#maintain did not lower to a target-table get");
    assert(deepKey(operation(surface.project.programs, "surface.visiblePosts").body, "Object"), "object literal did not reach IR");
    assert(deepKey(operation(surface.project.programs, "surface.visiblePosts").body, "Builtin")
      && JSON.stringify(operation(surface.project.programs, "surface.visiblePosts")).includes('"builtin":"Len"'), "count(page) did not lower through bounded Len policy");
    for (const name of ["surface.postsAfter", "surface.ensureUser", "surface.firstPositive"]) {
      assert(deepKey(operation(surface.project.programs, name).body, "Return"), `${name} lost a nested explicit return`);
    }
  });

  test("Quarry cursor arguments lower as opaque values and certify a result-page site", async () => {
    const schema = "table posts:\n  author: principal\n  at: time\n  by byAuthorAt: author, at, id\n  public\n";
    const module = `query page(author: principal, c: cursor ?):
  return posts[author] after c first 3 by byAuthorAt

query aliased(author: principal, c: cursor ?):
  position = c
  return posts[author] after position first 3 by byAuthorAt
`;
    const compiled = compileInline([
      { fileName: "snapback/schema.q", source: schema },
      { fileName: "snapback/ops.q", source: module },
    ]);
    assert(compiled.ok, `opaque cursor front end refused: ${compiled.ok ? "" : diagnosticsText(compiled.diagnostics)}`);
    const source = compiled.modules[0]!.source;
    assert(source.includes("c: t.optional(t.cursor())") && source.includes("after: args.c")
      && source.includes("opaqueCursor: true"), `cursor did not preserve its opaque lowering:\n${source}`);

    await withProject({ "snapback/schema.q": schema, "snapback/ops.q": module }, async (root) => {
      const lowered = await lowerProject(root);
      assert(lowered.ok, `opaque cursor project refused: ${lowered.ok ? "" : diagnosticsText(lowered.diagnostics)}`);
      const program = operation(lowered.project.programs, "ops.page");
      const aliased = operation(lowered.project.programs, "ops.aliased");
      assert(JSON.stringify(program.args.c) === JSON.stringify({ Optional: "Cursor" }), `cursor IR/certificate provenance changed: ${JSON.stringify(program)}`);
      const checked = rustCheck([program, aliased], "synthetic", lowered.project.schema);
      assert(checked.every((item) => !item.error)
        && (Object.values(checked[0]!.certificate!.result_pages as any)[0] as any)?.site === "ops.page.0",
      `opaque pages did not certify: ${JSON.stringify(checked)}`);
      assert(JSON.stringify(aliased.body).includes('"Variable":"position"'),
        `cursor expression alias was not preserved for preflight: ${JSON.stringify(aliased)}`);
    });
  });

  test("Quarry range modifiers refuse permutations and repeats with the complete canonical read", () => {
    const schema = "table posts:\n  at: time\n  by byAt: at, id\n  public\n";
    const cases = [
      {
        name: "permutation",
        source: "query page(at: time, c: cursor):\n  return posts[at] by byAt after c first 3\n",
        rewrite: "-- posts[at] after c first 3 by byAt",
      },
      {
        name: "double by",
        source: "query page(at: time):\n  return posts[at] first 3 by byAt by byId\n",
        rewrite: "-- posts[at] first 3 by byAt",
      },
    ];
    for (const item of cases) {
      const result = compileInline([
        { fileName: "snapback/schema.q", source: schema },
        { fileName: "snapback/ops.q", source: item.source },
      ]);
      const refusal = !result.ok && result.diagnostics.find((diagnostic) => diagnostic.code === "E_QUARRY_SYNTAX");
      assert(refusal && refusal.rewrite === item.rewrite,
        `${item.name} did not receive its canonical read rewrite: ${JSON.stringify(result)}`);
      const repaired = item.source.replace(item.source.split("\n")[1]!.trim().slice("return ".length), refusal.rewrite.slice(3));
      const fixed = compileInline([
        { fileName: "snapback/schema.q", source: schema },
        { fileName: "snapback/ops.q", source: repaired },
      ]);
      assert(fixed.ok, `${item.name} canonical rewrite did not compile: ${fixed.ok ? "" : diagnosticsText(fixed.diagnostics)}`);
    }
  });

  test("Quarry refuses before with a forward after rewrite", () => {
    const schema = "table posts:\n  author: principal\n  at: time\n  by byAuthorAt: author, at, id\n  public\n";
    const scalar = "query page(author: principal, c: cursor ?):\n  return posts[author] before c last 3 by byAuthorAt\n";
    const refused = compileInline([
      { fileName: "snapback/schema.q", source: schema },
      { fileName: "snapback/ops.q", source: scalar },
    ]);
    assert(!refused.ok, "before remained in the Quarry grammar");
    const diagnostic = refused.diagnostics.find((item) => item.code === "E_QUARRY_UNSUPPORTED");
    assert(diagnostic?.family === "quarry" && diagnostic.site.startsWith("snapback/ops.q:2:")
      && diagnostic.rewrite.includes("use after c"), `before refusal lost site/rewrite: ${JSON.stringify(refused)}`);
  });

  test("Quarry result-page provenance covers bindings, shapes, merges, nesting, branches, and consumers", async () => {
    const schema = "table posts:\n  author: principal\n  at: time\n  by byAt: at, id\n  by byAuthorAt: author, at, id\n  public\n";
    const operations = `query direct(c: cursor ?):
  page = posts[] after c first 3 by byAt
  return page

query shaped(c: cursor ?):
  return posts[] after c first 3 by byAt { id, at }

query merged(c: cursor ?, other: principal):
  return merge posts after c first 3 by byAuthorAt:
    [viewer]
    [other]

query nested(c: cursor ?):
  page = posts[] after c first 3 by byAt
  return { rows: page }

query branched(which: bool, c: cursor ?):
  if which:
    return posts[] after c first 3 by byAt
  return posts[] after c first 3 by byAt

query consumed(c: cursor ?):
  page = posts[] after c first 3 by byAt
  for post in page:
    require post.id = post.id else NEVER
  return []
`;
    await withProject({ "snapback/schema.q": schema, "snapback/ops.q": operations }, async (root) => {
      const lowered = await lowerProject(root);
      assert(lowered.ok, `page provenance fixture was refused: ${lowered.ok ? "" : diagnosticsText(lowered.diagnostics)}`);
      const certificates = rustCheck(lowered.project.programs, "synthetic", lowered.project.schema);
      const failures = certificates.filter((item) => item.error);
      assert(failures.length === 0, `page provenance failed certification: ${JSON.stringify(failures)}`);
      for (const name of ["ops.direct", "ops.shaped", "ops.merged", "ops.branched"])
        assert(Object.keys(certificates.find((item) => item.program === name)!.certificate!.result_pages as any).length, `${name} lost result-page provenance`);
      for (const name of ["ops.nested", "ops.consumed"])
        assert(!certificates.find((item) => item.program === name)!.certificate!.result_pages, `${name} incorrectly gained result-page provenance`);
      const merged = rustCheck([operation(lowered.project.programs, "ops.merged")], "synthetic", lowered.project.schema)[0]!;
      assert((Object.values(merged.certificate!.result_pages as any)[0] as any)?.merge === true, `merge provenance did not name its merge: ${JSON.stringify(merged)}`);
    });
  });

  test("Quarry conditional range and discovered merge pages keep branch-local shapes and cursor scope", async () => {
    const schema = `table follows:
  follower: principal
  followed: principal
  by byFollower: follower, id
  public
table posts:
  author: principal
  at: time
  body: text <=20
  by byAt: at, id
  by byAuthorAt: author, at, id
  public
`;
    const queries = `query feed(global: bool, c: cursor ?):
  if global:
    page = posts[] after c last 20 by byAt
    alias = page
    return alias { body }
  else:
    page = merge posts after c last 20 by byAuthorAt:
      [viewer]
      [f.followed] for f in follows[viewer] first 500 by byFollower
    alias = page
    return alias { body }

query empty(global: bool, c: cursor ?):
  if global:
    return posts[] after c first 20 by byAt { body }
  return []
`;
    await withProject({ "snapback/schema.q": schema, "snapback/feed.q": queries }, async (root) => {
      const lowered = await lowerProject(root);
      assert(lowered.ok, `conditional feed refused: ${lowered.ok ? "" : diagnosticsText(lowered.diagnostics)}`);
      const program = operation(lowered.project.programs, "feed.feed");
      const checked = rustCheck([program], "synthetic", lowered.project.schema)[0]!;
      assert(!checked.error, `conditional feed certification failed: ${JSON.stringify(checked)}`);
      const pages = Object.values(checked.certificate!.result_pages as any) as any[];
      assert(pages.length === 2 && pages.some((page) => page.merge) && pages.some((page) => !page.merge),
        `conditional page certificate lost a branch: ${JSON.stringify(checked.certificate)}`);
      const receipt: ClosureReceipt = { rows: [
        { table: "follows", id: "f1", row: { Row: { id: { Id: "f1" }, follower: { Id: "u1" }, followed: { Id: "u2" } } } },
        ...Array.from({ length: 47 }, (_, at) => ({ table: "posts", id: `p${at}`, row: { Row: {
          id: { Id: `p${at}` }, author: { Id: at < 43 ? (at % 2 ? "u1" : "u2") : "u3" },
          at: { Int: at }, body: { String: `entry-${at}` },
        } } })),
      ], ranges: [], absences: [], verdicts: [] };
      for (const table of ["follows", "posts"]) receipt.ranges.push({
        site: `held.${table}`, table, index: "byId", prefix: [], order: "Asc", take: 100,
        after: null, before: null, gt: null, gte: null, lt: null, lte: null,
        rule_hash: scopedRuleHash(lowered.project.schema, (lowered.project.schema.tables as any)[table].rules.read),
        row_ids: receipt.rows.filter((row) => row.table === table).map((row) => row.id),
        stop: "Exhausted", absence: false, halo: null, n2_suffix: null,
      });
      const store = new ClientStore(lowered.project.schema, receipt);
      const context: Context = { viewer: "u1", principal_kind: "user", auth_epoch: 1,
        args: { global: { Bool: true }, c: "Null" }, now: 1, new_ids: [], read_time: 1 };
      const tokens: string[] = [];
      for (const global of [true, false]) {
        context.args = { global: { Bool: global }, c: "Null" };
        const seen: Value[] = [];
        for (let page = 0; page < 3; page++) {
          const replay = store.reexecute(program, context, checked.certificate);
          const data = (replay.execution.result as { Array: Value[] }).Array;
          assert(data.length === (page < 2 ? 20 : global ? 7 : 3), `wrong conditional page size: ${JSON.stringify(replay)}`);
          seen.push(...data);
          if (page < 2) {
            assert(replay.execution.next, "nonempty conditional page lost its continuation");
            if (page === 0) tokens.push(replay.execution.next);
            context.args.c = { String: replay.execution.next };
          } else assert(!replay.execution.next, "terminal conditional page kept a cursor");
        }
        deepStrictEqual(seen, Array.from({ length: global ? 47 : 43 }, (_, n) =>
          ({ Row: { body: { String: `entry-${(global ? 46 : 42) - n}` } } })), "conditional page order, shape, or membership changed");
      }
      for (const [global, token] of [[false, tokens[0]], [true, tokens[1]], [true, `${tokens[0]}=`]] as const) {
        context.args = { global: { Bool: global }, c: { String: token! } };
        let refusal: any;
        try { store.reexecute(program, context, checked.certificate); } catch (error) { refusal = error; }
        assert(refusal?.code === "E_INPUT", `conditional cursor scope accepted ${JSON.stringify(context.args)}`);
      }
      const empty = operation(lowered.project.programs, "feed.empty");
      const emptyCertificate = rustCheck([empty], "synthetic", lowered.project.schema)[0]!.certificate;
      context.args = { global: { Bool: false }, c: { String: tokens[1]! } };
      const noPage = store.reexecute(empty, context, emptyCertificate).execution;
      deepStrictEqual(noPage.result, { Array: [] });
      assert(noPage.next === null, "a non-page return borrowed another branch's cursor");
    });
  });

  test("Quarry merge keeps nullable lane-prefix guards inside each discovered lane", async () => {
    await withProject({ "snapback/schema.q": `table follows:
  follower: principal
  followed: principal ?
  by byFollower: follower, id
  public
table posts:
  author: principal
  at: time
  by byAuthor: author, at, id
  public
`, "snapback/feed.q": `query feed():
  return merge posts last 20 by byAuthor:
    [f.followed ?? viewer] for f in follows[viewer] first 500 by byFollower
` }, async (root) => {
      const lowered = await lowerProject(root);
      assert(lowered.ok, `nullable merge prefix refused: ${lowered.ok ? "" : diagnosticsText(lowered.diagnostics)}`);
      const checked = rustCheck(lowered.project.programs, "synthetic", lowered.project.schema);
      assert(checked.every((result) => !result.error), `nullable merge prefix did not certify: ${JSON.stringify(checked)}`);
      const body = JSON.stringify(lowered.project.programs[0]!.body);
      assert(body.includes('"setup"') && body.includes('"If"'), `merge lost its per-lane guard: ${body}`);
    });
  });

  test("Quarry merge lowers bounded lanes, records its certificate site, and refuses malformed lanes", async () => {
    const chat = await lowerProject(resolve(fixtures, "quarry-chat"));
    assert(chat.ok, `Quarry chat merge refused: ${chat.ok ? "" : diagnosticsText(chat.diagnostics)}`);
    const following = operation(chat.project.programs, "feeds.followingFeed");
    const body = JSON.stringify(following.body);
    assert(body.includes('"Merge"') && !body.includes('"DedupeById"'), `merge composition changed: ${body}`);
    const checked = rustCheck(
      [following],
      "synthetic",
      chat.project.schema,
      undefined,
      chat.project.effects as unknown as Array<Record<string, unknown>>,
    );
    assert(checked.length === 1 && !checked[0]!.error, `chat merge did not certify: ${JSON.stringify(checked)}`);
    const certificate = checked[0]!.certificate as any;
    assert(certificate.merge_sites?.length === 1
      && certificate.merge_sites[0].lane_sites.length === 2
      && certificate.merge_sites[0].take === 20,
    `merge certificate site changed: ${JSON.stringify(certificate.merge_sites)}`);
    const beforeShapes = certificate.max_examined - certificate.read_sites
      .filter((site: any) => site.table === "profiles")
      .reduce((total: number, site: any) => total + site.max_calls, 0);
    assert(beforeShapes === 125, `following feed examined ${beforeShapes} before shaped point reads, expected 52 + 51 + 22`);
    assert(certificate.merge_sites[0].uniform && certificate.merge_sites[0].max_lanes === 51,
      `merge lost its heads bound: ${JSON.stringify(certificate.merge_sites)}`);

    const schema = "table posts:\n  author: principal\n  at: time\n  by byAuthorAt: author, at, id\n  public\n";
    const cases = [
      ["empty", "query q():\n  return merge posts first 3 by byAuthorAt:\n", "E_QUARRY_SYNTAX"],
      ["unequal", "query q():\n  return merge posts first 3 by byAuthorAt:\n    [viewer]\n    [viewer, now]\n", "E_QUARRY_TYPE"],
      ["duplicate", "query q():\n  return merge posts first 3 by byAuthorAt:\n    [viewer]\n    [viewer]\n", "E_QUARRY_TYPE"],
      ["missing by", "query q():\n  return merge posts first 3:\n    [viewer]\n", "E_QUARRY_SYNTAX"],
    ] as const;
    for (const [name, source, code] of cases) {
      const result = compileInline([
        { fileName: "snapback/schema.q", source: schema },
        { fileName: "snapback/ops.q", source },
      ]);
      assert(!result.ok && result.diagnostics.some((item) => item.code === code), `${name} merge compiled: ${JSON.stringify(result)}`);
    }
  });

  test("Quarry cursors require a total index and pageable merges end in id", () => {
    const nonTotalSchema = "table posts:\n  author: principal\n  at: time\n  by byAuthorAt: author, at\n  public\n";
    const nonTotalOps = "query page(c: cursor ?):\n  return posts[] after c first 3 by byAuthorAt\n";
    const nonTotal = compileInline([
      { fileName: "snapback/schema.q", source: nonTotalSchema },
      { fileName: "snapback/ops.q", source: nonTotalOps },
    ]);
    assert(!nonTotal.ok, "cursor on a non-total Quarry index compiled");
    const indexRefusals = nonTotal.diagnostics.filter((item) => item.code === "E_QUARRY_TYPE");
    assert(indexRefusals.length === 1 && indexRefusals[0]!.site.startsWith("snapback/schema.q:")
      && indexRefusals[0]!.message.includes("snapback/ops.q:2:")
      && indexRefusals[0]!.rewrite === "-- by byAuthorAt: author, at, id",
    `non-total cursor lost its exact Quarry rewrite: ${JSON.stringify(nonTotal)}`);
    assert(nonTotal.diagnostics.every((item) => item.code !== "E_ARGS_CURSOR_INDEX"),
      `platform cursor-index refusal leaked through Quarry: ${JSON.stringify(nonTotal)}`);
    const totalSchemaRepair = nonTotalSchema.replace("by byAuthorAt: author, at", indexRefusals[0]!.rewrite.slice(3));
    const afterIndexRepair = compileInline([
      { fileName: "snapback/schema.q", source: totalSchemaRepair },
      { fileName: "snapback/ops.q", source: nonTotalOps },
    ]);
    assert(afterIndexRepair.ok, `total-index cursor repair did not compile: ${JSON.stringify(afterIndexRepair)}`);
    const mergeSchema = "table posts:\n  author: principal\n  kind: text <=20\n  unique byActorKind: author, kind\n  public\n";
    const merge = compileInline([
      { fileName: "snapback/schema.q", source: mergeSchema },
      { fileName: "snapback/ops.q", source: "query feed(c: cursor ?):\n  return merge posts after c first 3 by byActorKind:\n    [viewer]\n" },
    ]);
    const mergeRefusal = merge.ok ? undefined : merge.diagnostics.find((item) => item.code === "E_QUARRY_TYPE");
    assert(mergeRefusal !== undefined && mergeRefusal.site.startsWith("snapback/schema.q:")
      && mergeRefusal.rewrite.includes("author, kind, id"), `merge id refusal lost site/rewrite: ${JSON.stringify(merge)}`);
  });

  test("Quarry alternate-key unreadable updates are NOT_FOUND while direct-id updates are E_RULE", async () => {
    const qSchema = `table secrets:
  owner: principal
  label: text <=40
  unique byOwner: owner
  read <- .owner = viewer
  insert <- allow
  update <- .owner = viewer
`;
    const operations = `mutation alternate(owner: principal, label: text <=40):
  update secrets[owner] { label }
  return true

mutation direct(id: secrets, label: text <=40):
  update secrets[id] { label }
  return true
`;
    await withProject({
      "snapback/schema.q": qSchema,
      "snapback/ops.q": operations,
    }, async (root) => {
      const lowered = await lowerProject(root);
      assert(lowered.ok, `unreadable update pair did not lower: ${lowered.ok ? "" : diagnosticsText(lowered.diagnostics)}`);
      assert(rustCheck(lowered.project.programs, "synthetic", lowered.project.schema).every((item) => !item.error),
        "unreadable update pair did not certify");
      const receipt: ClosureReceipt = {
        rows: [{ table: "secrets", id: "secret-1", row: { Row: {
          id: { Id: "secret-1" }, owner: { Id: "owner-1" }, label: { String: "hidden" },
        } } }],
        ranges: [], absences: [], verdicts: [],
      };
      const context = (args: Context["args"]): Context => ({
        viewer: "viewer-1", principal_kind: "user", auth_epoch: 1,
        args, now: 1, new_ids: [], read_time: 1,
      });
      const executeCode = (program: Program, args: Context["args"]): string => {
        const store = new ClientStore(lowered.project.schema, receipt);
        try {
          store.applyMutation(program, context(args));
          return "green";
        } catch (error) {
          const refusal = error as { code?: string; authoredCode?: string | null };
          return refusal.authoredCode ? `${refusal.code}:${refusal.authoredCode}` : refusal.code ?? "unknown";
        }
      };
      assert(executeCode(operation(lowered.project.programs, "ops.alternate"), {
        owner: { Id: "owner-1" }, label: { String: "changed" },
      }) === "E_REQUIRE:NOT_FOUND", "alternate-key unreadable update did not produce E_REQUIRE:NOT_FOUND");
      assert(executeCode(operation(lowered.project.programs, "ops.direct"), {
        id: { Id: "secret-1" }, label: { String: "changed" },
      }) === "E_RULE", "direct-id unreadable update did not produce E_RULE");
    });
  });

  test("Quarry alternate-key update and upsert id fields are front-end refusals", async () => {
    const compiled = compileFixture(fixtures, "quarry-update-id", ["schema", "update"]);
    assert(!compiled.ok, "alternate-key update naming id compiled");
    const compileDiagnostics = compiled.diagnostics.filter((item) => item.code === "E_QUARRY_TYPE");
    assert(compileDiagnostics.length === 2
      && compileDiagnostics.some((item) => item.site.startsWith("snapback/update.q:")
        && item.rewrite === '-- update keyedRows[owner] { label: "changed" }')
      && compileDiagnostics.some((item) => item.site.startsWith("snapback/update.q:")
        && item.rewrite === '-- upsert keyedRows[owner] { label: "changed" }'),
    `update id front-end refusal changed: ${JSON.stringify(compiled)}`);

    const lowered = await lowerProject(resolve(fixtures, "quarry-update-id"));
    assert(!lowered.ok, "alternate-key update naming id lowered");
    assert(lowered.diagnostics.length === 2 && lowered.diagnostics.every((item) => item.code === "E_QUARRY_TYPE"),
    `update id leaked platform diagnostics: ${JSON.stringify(lowered)}`);
    assert(lowered.diagnostics.every((item) => item.code !== "E_SCHEMA_ID_RESERVED" && item.code !== "E_OPAQUE"),
      `update id retained platform leakage: ${JSON.stringify(lowered)}`);
  });

  test("Quarry consumed updates and upserts return authorized row snapshots with one evaluation", async () => {
    const schema = `table rows:
  owner: principal
  label: text <=40
  count: int
  token: id
  at: time
  visible: bool
  unique byOwner: owner
  read <- .visible = true
  insert <- allow
  update <- allow

table locked:
  label: text <=40
  read <- allow
  update <- deny
`;
    const module = `mutation direct(id: rows):
  row = update rows[id] { label: 'changed', token: new, at: now }
  return row

mutation indexed(owner: principal):
  return update rows[owner] { label: 'changed', token: new, at: now }

mutation focal(id: rows):
  update rows[id] { count: .count + 1 }

mutation ensure(id: rows, owner: principal):
  return upsert rows[id] { owner, label: 'ensured', count: (.count ?? 0) + 1, token: new, at: now, visible: true }

mutation ensureMinted(owner: principal):
  return upsert rows[new] { owner, label: 'ensured', count: 1, token: new, at: now, visible: true }

mutation ensureIndexed(owner: principal):
  return upsert rows[owner] { label: 'ensured', count: (.count ?? 0) + 1, token: new, at: now, visible: true }

mutation snapshots(id: rows):
  return { first: update rows[id] { count: 1 }, second: update rows[id] { count: 2 } }

mutation revoke(id: rows):
  return update rows[id] { visible: false }

mutation revokeIndexed(owner: principal):
  return upsert rows[owner] { label: 'revoked', count: 1, token: new, at: now, visible: false }

mutation blind(id: rows):
  update rows[id] { label: 'blind write' }
  return true

mutation denied(id: locked):
  return update locked[id] { label: 'forbidden' }
`;
    await withProject({ "snapback/schema.q": schema, "snapback/writes.q": module }, async (root) => {
      const lowered = await lowerProject(root);
      assert(lowered.ok, `write results refused: ${lowered.ok ? "" : diagnosticsText(lowered.diagnostics)}`);
      const checked = rustCheck(lowered.project.programs, "synthetic", lowered.project.schema);
      assert(checked.every((item) => !item.error), `write results did not certify: ${JSON.stringify(checked)}`);
      assert(!deepKey(operation(lowered.project.programs, "writes.blind").body, "Get"),
        "discarded write gained a read-authority requirement");
      assert(lowered.apiDts.includes("RowsRow | null"),
        `write-result API lost its nullable row type: ${lowered.apiDts}`);
      const row: Value = { Row: {
        id: { Id: "row-1" }, owner: { Id: "owner-1" }, label: { String: "original" },
        count: { Int: 7 }, token: { Id: "original-token" }, at: { Int: 1 }, visible: { Bool: true },
      } };
      const receipt: ClosureReceipt = {
        schema_hash: checked[0]!.certificate!.schema_hash as string,
        rows: [
          { table: "rows", id: "row-1", row },
          { table: "locked", id: "locked-1", row: { Row: { id: { Id: "locked-1" }, label: { String: "original" } } } },
        ],
        ranges: [], verdicts: [],
        absences: [["rows", "byId", [{ Id: "inserted-id" }]], ["rows", "byOwner", [{ Id: "owner-2" }]]],
      };
      const context = (args: Context["args"], newIds = ["minted-token"]): Context => ({
        viewer: "viewer-1", principal_kind: "user", auth_epoch: 1, args,
        now: 23, read_time: 19, new_ids: newIds,
      });
      for (const [name, args] of [
        ["direct", { id: { Id: "row-1" } }], ["indexed", { owner: { Id: "owner-1" } }],
      ] as const) {
        const store = new ClientStore(lowered.project.schema, receipt);
        const result = store.applyMutation(operation(lowered.project.programs, `writes.${name}`), context(args));
        const expected: Value = { Row: { ...row.Row, label: { String: "changed" }, token: { Id: "minted-token" }, at: { Int: 23 } } };
        assert(result.state === "predicted" && canonicalValue(result.execution.result) === canonicalValue(expected),
          `${name} did not return its stored image: ${JSON.stringify(result)}`);
        assert(canonicalValue(store.rows("rows")[0]!) === canonicalValue(expected), `${name} returned a different row from storage`);
      }
      const focal = new ClientStore(lowered.project.schema, receipt)
        .applyMutation(operation(lowered.project.programs, "writes.focal"), context({ id: { Id: "row-1" } }, []));
      assert(focal.execution.result !== "Null" && "Row" in focal.execution.result
        && JSON.stringify(focal.execution.result.Row.count) === '{"Int":8}', "implicit focal update lost its returned image");
      for (const [name, args, newIds, expectedId, expectedCount] of [
        ["ensure", { id: { Id: "row-1" }, owner: { Id: "owner-1" } }, ["minted-token"], "row-1", 8],
        ["ensure", { id: { Id: "inserted-id" }, owner: { Id: "owner-2" } }, ["minted-token"], "inserted-id", 1],
        ["ensureMinted", { owner: { Id: "owner-2" } }, ["inserted-id", "minted-token"], "inserted-id", 1],
        ["ensureIndexed", { owner: { Id: "owner-1" } }, ["minted-token"], "row-1", 8],
        ["ensureIndexed", { owner: { Id: "owner-2" } }, ["minted-token", "inserted-id"], "inserted-id", 1],
      ] as Array<[string, Context["args"], string[], string, number]>) {
        const store = new ClientStore(lowered.project.schema, receipt);
        const result = store.applyMutation(operation(lowered.project.programs, `writes.${name}`), context(args, newIds));
        const actual = result.execution.result;
        assert(result.state === "predicted" && actual !== "Null" && "Row" in actual,
          `${name} did not return a readable upsert row: ${JSON.stringify(result)}`);
        assert(JSON.stringify(actual.Row.id) === JSON.stringify({ Id: expectedId })
          && JSON.stringify(actual.Row.token) === '{"Id":"minted-token"}'
          && JSON.stringify(actual.Row.count) === JSON.stringify({ Int: expectedCount }),
        `${name} re-evaluated identity/fields or lost its branch: ${JSON.stringify(actual)}`);
        assert(store.rows("rows").some((stored) => JSON.stringify(stored) === JSON.stringify(actual)),
          `${name} returned an image absent from storage`);
      }
      const snapshots = new ClientStore(lowered.project.schema, receipt)
        .applyMutation(operation(lowered.project.programs, "writes.snapshots"), context({ id: { Id: "row-1" } }, []));
      const snapshot = snapshots.execution.result as { Row: { first: { Row: { count: Value } }; second: { Row: { count: Value } } } };
      assert(JSON.stringify(snapshot.Row.first.Row.count) === '{"Int":1}'
        && JSON.stringify(snapshot.Row.second.Row.count) === '{"Int":2}',
      `a later sibling write changed an earlier result snapshot: ${JSON.stringify(snapshots)}`);
      for (const [name, args] of [
        ["revoke", { id: { Id: "row-1" } }], ["revokeIndexed", { owner: { Id: "owner-1" } }],
      ] as const) {
        const store = new ClientStore(lowered.project.schema, receipt);
        const revoked = store.applyMutation(operation(lowered.project.programs, `writes.${name}`), context(args));
        assert(revoked.state === "predicted" && revoked.execution.result === "Null", `${name} exposed a revoked row`);
        const blind = store.applyMutation(operation(lowered.project.programs, "writes.blind"), context({ id: { Id: "row-1" } }, []));
        assert(blind.state === "predicted" && JSON.stringify(blind.execution.result) === '{"Bool":true}',
          "unreadable row lost its independent write authority");
        const consumed = store.applyMutation(operation(lowered.project.programs, "writes.direct"), context({ id: { Id: "row-1" } }));
        assert(consumed.state === "predicted" && consumed.execution.result === "Null", "consumed write exposed an unreadable row");
      }
      const locked = new ClientStore(lowered.project.schema, receipt);
      let denied = "";
      try { locked.applyMutation(operation(lowered.project.programs, "writes.denied"), context({ id: { Id: "locked-1" } }, [])); }
      catch (error) { denied = (error as { code: string }).code; }
      assert(denied === "E_RULE" && JSON.stringify(locked.rows("locked")[0]).includes('"original"'),
        "consuming an update bypassed its write rule or committed a refused write");
    });
  });

  test("Quarry maps platform refusals and operation source sites back to .q", async () => {
    const qSchema = readFileSync(resolve(fixtures, "quarry-chat/snapback/schema.q"), "utf8");
    const effect = readFileSync(resolve(fixtures, "quarry-chat/snapback/delivery.ts"), "utf8");
    const bad = `effect notify from delivery\n\nquery bad():\n  emit notify { to: 'somebody', body: 'hello' }\n  return null\n`;
    await withProject({
      "snapback/schema.q": qSchema,
      "snapback/delivery.ts": effect,
      "snapback/bad.q": bad,
    }, async (root) => {
      const lowered = await lowerProject(root);
      assert(!lowered.ok, "emit in a Quarry query unexpectedly lowered");
      const refusal = lowered.diagnostics.find((item) => item.code === "E_EMIT_IN_QUERY");
      assert(refusal?.site === "snapback/bad.q:4:3", `generated refusal site was not mapped to the emit: ${refusal?.site}`);
      assert(refusal.rewrite === bad, "generated refusal rewrite was not Quarry source");
    });

    const chat = await lowerProject(resolve(fixtures, "quarry-chat"));
    assert(chat.ok && chat.sources["messages.send"]?.file === "snapback/messages.q", "certification source map did not point at messages.q");
    assert((chat.sources["messages.send"]?.col ?? 0) > 0, "certification source map lost the Quarry column");
  });

  test("Quarry parser recovers and every refusal envelope is complete", () => {
    const syntax = compileFixture(fixtures, "quarry-invalid", ["schema", "syntax"]);
    assert(!syntax.ok, "invalid syntax fixture unexpectedly compiled");
    assert(syntax.diagnostics.filter((item) => item.code === "E_QUARRY_SYNTAX").length >= 3,
      `parser stopped before reporting all syntax defects: ${diagnosticsText(syntax.diagnostics)}`);

    const cases: Array<[string, string]> = [
      ["syntax", "E_QUARRY_SYNTAX"],
      ["unknown", "E_QUARRY_UNKNOWN"],
      ["ambiguous", "E_QUARRY_AMBIGUOUS"],
      ["unsupported", "E_QUARRY_UNSUPPORTED"],
      ["placement", "E_QUARRY_PLACEMENT"],
    ];
    for (const [file, code] of cases) {
      const result = compileFixture(fixtures, "quarry-invalid", ["schema", file]);
      assert(!result.ok, `${file} unexpectedly compiled`);
      const matching = result.diagnostics.filter((diagnostic) => diagnostic.code === code);
      const item = matching[0];
      assert(item, `${file} did not report ${code}: ${diagnosticsText(result.diagnostics)}`);
      const minimum = code === "E_QUARRY_AMBIGUOUS" ? 1 : 2;
      assert(matching.length >= minimum, `${file} stopped before ${minimum} ${code} refusals: ${diagnosticsText(result.diagnostics)}`);
      assert(item.family === "quarry" && item.site.includes(`/${file}.q:`), `${code} lost Quarry family/site`);
      assert(item.rewrite.startsWith("-- ") && item.guide.startsWith("quarry/"), `${code} lost Quarry rewrite/guide`);
      if (code === "E_QUARRY_UNSUPPORTED") assert(item.message.includes("not part of the Snapback 2 platform"), "unsupported wording drifted back to subset language");
      if (code === "E_QUARRY_AMBIGUOUS") assert(item.rewrite.includes(" by "), `ambiguous rewrite lost its explicit-index repair: ${item.rewrite}`);
    }
  });

  test("Quarry conditions require Boolean operands and null is an explicit presence test", async () => {
    const schema = "table rows:\n  value: int\n  seenAt: time ?\n  public\n";
    for (const condition of ["value", "seenAt"]) {
      const refused = compileInline([
        { fileName: "snapback/schema.q", source: schema },
        { fileName: "snapback/ops.q", source: `query bad(${condition}: ${condition === "value" ? "int" : "time ?"}):\n  if ${condition}:\n    return true\n  return false\n` },
      ]);
      assert(!refused.ok && refused.diagnostics.some((item) => item.code === "E_QUARRY_TYPE"),
        `non-Boolean if condition compiled: ${JSON.stringify(refused)}`);
      if (condition === "seenAt") assert(refused.diagnostics.some((item) => item.rewrite.includes("seenAt != null")),
        `optional condition lost its presence-test rewrite: ${JSON.stringify(refused)}`);
    }
    const accepted = await withProject({
      "snapback/schema.q": schema,
      "snapback/ops.q": "query present(seenAt: time ?):\n  if seenAt != null:\n    return true\n  return false\n\nquery field(rowId: rows):\n  row = rows[rowId]! else MISSING\n  return row.seenAt != null\n",
    }, (root) => lowerProject(root));
    assert(accepted.ok, `presence tests refused: ${accepted.ok ? "" : diagnosticsText(accepted.diagnostics)}`);
  });

  test("Quarry optional-column equality and inequality execute with total semantics", async () => {
    const schema = "table rows:\n  value: int ?\n  public\n";
    const module = `query equal(left: rows, right: rows):
  a = rows[left]! else LEFT_MISSING
  b = rows[right]! else RIGHT_MISSING
  return a.value = b.value

query different(left: rows, right: rows):
  a = rows[left]! else LEFT_MISSING
  b = rows[right]! else RIGHT_MISSING
  return a.value != b.value
`;
    await withProject({ "snapback/schema.q": schema, "snapback/compare.q": module }, async (root) => {
      const lowered = await lowerProject(root);
      assert(lowered.ok, `total-equality project refused: ${lowered.ok ? "" : diagnosticsText(lowered.diagnostics)}`);
      assert(rustCheck(lowered.project.programs, "synthetic", lowered.project.schema).every((item) => !item.error),
        "total-equality programs did not certify through the Rust checker");
      const receipt: ClosureReceipt = {
        rows: [
          { table: "rows", id: "absent-a", row: { Row: { id: { Id: "absent-a" } } } },
          { table: "rows", id: "absent-b", row: { Row: { id: { Id: "absent-b" } } } },
          { table: "rows", id: "present-a", row: { Row: { id: { Id: "present-a" }, value: { Int: 7 } } } },
          { table: "rows", id: "present-b", row: { Row: { id: { Id: "present-b" }, value: { Int: 7 } } } },
        ],
        ranges: [], absences: [], verdicts: [],
      };
      const context = (left: string, right: string): Context => ({
        viewer: "viewer-1", principal_kind: "user", auth_epoch: 1,
        args: { left: { Id: left }, right: { Id: right } }, now: 1, new_ids: [], read_time: 1,
      });
      const cases: Array<[string, string, boolean]> = [
        ["absent-a", "absent-b", true],
        ["absent-a", "present-a", false],
        ["present-a", "absent-a", false],
        ["present-a", "present-b", true],
      ];
      for (const [left, right, equal] of cases) {
        const store = new ClientStore(lowered.project.schema, receipt);
        const actualEqual = store.reexecute(operation(lowered.project.programs, "compare.equal"), context(left, right)).execution.result;
        const actualDifferent = store.reexecute(operation(lowered.project.programs, "compare.different"), context(left, right)).execution.result;
        assert(JSON.stringify(actualEqual) === JSON.stringify({ Bool: equal }),
          `${left} = ${right} returned ${JSON.stringify(actualEqual)} instead of ${equal}`);
        assert(JSON.stringify(actualDifferent) === JSON.stringify({ Bool: !equal }),
          `${left} != ${right} returned ${JSON.stringify(actualDifferent)} instead of ${!equal}`);
      }
    });
  });

  test("Quarry ordered comparison refuses an optional operand with an assertion rewrite", () => {
    const source = "query older(id: rows, cutoff: time):\n  row = rows[id]! else MISSING\n  return row.seenAt < cutoff\n";
    const result = compileInline([
      { fileName: "snapback/schema.q", source: "table rows:\n  seenAt: time ?\n  public\n" },
      { fileName: "snapback/ops.q", source },
    ]);
    const refusal = result.ok ? undefined : result.diagnostics.find((item) => item.code === "E_QUARRY_TYPE");
    assert(refusal?.rewrite === "-- row.seenAt! < cutoff" && refusal.site === "snapback/ops.q:3:21",
      `optional ordered comparison lost its exact rewrite/site: ${JSON.stringify(result)}`);
  });

  test("Quarry null equality works in either operand position without weakening nominal types", async () => {
    const types: Array<[string, string, Value]> = [
      ["amount", "money USD", { Int: 250 }], ["at", "time", { Int: 12 }],
      ["actor", "principal", { Id: "viewer-1" }], ["row", "rows", { Id: "row-1" }],
      ["enabled", "bool", { Bool: false }],
    ];
    const schema = "table rows:\n  value: int ?\n  public\n";
    const module = types.map(([name, type]) => `query ${name}(value: ${type} ?):
  return { left: null = value, right: value = null, different: null != value, self: value = value }
`).join("\n");
    await withProject({ "snapback/schema.q": schema, "snapback/absence.q": module }, async (root) => {
      const lowered = await lowerProject(root);
      assert(lowered.ok, `symmetric null equality refused: ${lowered.ok ? "" : diagnosticsText(lowered.diagnostics)}`);
      assert(rustCheck(lowered.project.programs, "synthetic", lowered.project.schema).every((item) => !item.error),
        "symmetric null equality did not certify");
      const store = new ClientStore(lowered.project.schema, { rows: [], ranges: [], absences: [], verdicts: [] });
      for (const [name, , present] of types) {
        for (const value of ["Null", present] as const) {
          const absent = value === "Null";
          const execution = store.reexecute(operation(lowered.project.programs, `absence.${name}`), {
            viewer: "viewer-1", principal_kind: "user", auth_epoch: 1,
            args: { value }, now: 1, new_ids: [], read_time: 1,
          }).execution;
          const expected: Value = { Row: {
            left: { Bool: absent }, right: { Bool: absent }, different: { Bool: !absent }, self: { Bool: true },
          } };
          assert(canonicalValue(execution.result) === canonicalValue(expected),
            `${name} null equality was not symmetric/reflexive: ${JSON.stringify(execution.result)}`);
        }
      }
    });
    for (const [left, right] of [["money USD ?", "money EUR ?"], ["principal ?", "rows ?"]]) {
      const result = await withProject({
        "snapback/schema.q": schema,
        "snapback/bad.q": `query bad(left: ${left}, right: ${right}):\n  return left = right\n`,
      }, (root) => lowerProject(root));
      assert(!result.ok, `optional equality admitted mismatched nominal ${left} and ${right}`);
    }
  });

  test("Quarry if presence tests narrow only the then-branch binding identity", async () => {
    const schema = "table members:\n  lastReadAt: time ?\n  public\n";
    const watermark = `query reached(id: members, upTo: time):
  m = members[id]! else NOT_MEMBER
  if m.lastReadAt != null:
    if m.lastReadAt >= upTo:
      return true
  return false

query direct(value: time ?, upTo: time):
  if value != null:
    return value >= upTo
  return false
`;
    await withProject({ "snapback/schema.q": schema, "snapback/watermark.q": watermark }, async (root) => {
      const lowered = await lowerProject(root);
      assert(lowered.ok, `narrowed watermark refused: ${lowered.ok ? "" : diagnosticsText(lowered.diagnostics)}`);
      const program = operation(lowered.project.programs, "watermark.reached");
      const generated = compileInline([
        { fileName: "snapback/schema.q", source: schema },
        { fileName: "snapback/watermark.q", source: watermark },
      ]);
      assert(generated.ok && occurrences(generated.modules[0]!.source, "db.require(") === 1
        && !generated.modules[0]!.source.includes("lastReadAt!") && !generated.modules[0]!.source.includes("args.value!"),
        `if narrowing emitted an assertion: ${JSON.stringify(generated)}`);
      const store = new ClientStore(lowered.project.schema, {
        rows: [{ table: "members", id: "m1", row: { Row: { id: { Id: "m1" }, lastReadAt: { Int: 12 } } } }],
        ranges: [], absences: [], verdicts: [],
      });
      const execution = store.reexecute(program, {
        viewer: "viewer", principal_kind: "user", auth_epoch: 1,
        args: { id: { Id: "m1" }, upTo: { Int: 10 } }, now: 1, new_ids: [], read_time: 1,
      });
      assert(JSON.stringify(execution.execution.result) === JSON.stringify({ Bool: true }),
        `narrowed watermark did not execute: ${JSON.stringify(execution)}`);
      const directExecution = store.reexecute(operation(lowered.project.programs, "watermark.direct"), {
        viewer: "viewer", principal_kind: "user", auth_epoch: 1,
        args: { value: { Int: 12 }, upTo: { Int: 10 } }, now: 1, new_ids: [], read_time: 1,
      });
      assert(JSON.stringify(directExecution.execution.result) === JSON.stringify({ Bool: true }),
        `narrowed bound name did not execute: ${JSON.stringify(directExecution)}`);
    });

    const refusing = [
      ["shadow", "query bad(x: time ?, y: time, z: time ?):\n  if x != null:\n    x = z\n    return x >= y\n  return false\n"],
      ["else", "query bad(x: time ?, y: time):\n  if x != null:\n    return true\n  else:\n    return x >= y\n"],
      ["conjunction", "query bad(x: time ?, y: time):\n  return x != null and x >= y\n"],
    ] as const;
    for (const [name, source] of refusing) {
      const result = compileInline([
        { fileName: "snapback/schema.q", source: schema },
        { fileName: `snapback/${name}.q`, source },
      ]);
      const diagnostic = result.ok ? undefined : result.diagnostics.find((item) => item.code === "E_QUARRY_TYPE");
      assert(diagnostic?.rewrite.includes("x)! >= y"), `${name} unexpectedly retained narrowing: ${JSON.stringify(result)}`);
    }
  });

  test("Quarry where emits the schema index and indexed-prefix repairs", () => {
    const result = compileInline([
      { fileName: "snapback/schema.q", source: "table posts:\n  author: principal\n  visible: bool\n  at: time\n  by byAuthorAt: author, at, id\n  public\n" },
      { fileName: "snapback/posts.q", source: "query byAuthor():\n  return posts[viewer] first 5 by byAuthorAt where .visible = true\n" },
    ]);
    const refusals = result.ok ? [] : result.diagnostics.filter((item) => item.code === "E_QUARRY_UNSUPPORTED");
    assert(refusals.length === 2
      && refusals.some((item) => item.site.startsWith("snapback/schema.q:")
        && item.rewrite === "-- by byAuthorVisibleAt: author, visible, at, id")
      && refusals.some((item) => item.site.startsWith("snapback/posts.q:")
        && item.rewrite === "-- posts[viewer, true] first 5 by byAuthorVisibleAt"),
    `where did not produce its two sited repairs: ${JSON.stringify(result)}`);

    const reused = compileInline([
      { fileName: "snapback/schema.q", source: "table posts:\n  author: principal\n  visible: bool\n  at: time\n  by byAuthorAt: author, at, id\n  by byAuthorVisibleAt: author, visible, at, id\n  public\n" },
      { fileName: "snapback/posts.q", source: "query byAuthor():\n  return posts[viewer] first 5 by byAuthorAt where .visible = true\n" },
    ]);
    const reusedRefusals = reused.ok ? [] : reused.diagnostics.filter((item) => item.code === "E_QUARRY_UNSUPPORTED");
    assert(reusedRefusals.length === 2
      && reusedRefusals.some((item) => item.message.includes("reuses posts.byAuthorVisibleAt"))
      && reusedRefusals.some((item) => item.rewrite === "-- posts[viewer, true] first 5 by byAuthorVisibleAt"),
    `where did not reuse a compatible index: ${JSON.stringify(reused)}`);

    const fallbacks = [
      [
        "non-conjunction",
        "table posts:\n  author: principal\n  at: time\n  by byAuthorAt: author, at, id\n  public\n",
        "return posts[viewer] first 5 by byAuthorAt where .author != viewer",
      ],
      [
        "non-indexable",
        "table posts:\n  author: principal\n  metadata: json <=100\n  at: time\n  by byAuthorAt: author, at, id\n  public\n",
        "return posts[viewer] first 5 by byAuthorAt where .metadata = {}",
      ],
      [
        "uncertain index",
        "table posts:\n  author: principal\n  visible: bool\n  at: time\n  by byAuthorAt: author, at, id\n  by byAuthorVisibleAt: author, visible, at, id\n  public\n",
        "return posts[viewer] first 5 where .visible = true",
      ],
    ] as const;
    for (const [name, fallbackSchema, statement] of fallbacks) {
      const fallback = compileInline([
        { fileName: "snapback/schema.q", source: fallbackSchema },
        { fileName: "snapback/posts.q", source: `query byAuthor():\n  ${statement}\n` },
      ]);
      const refusal = fallback.ok ? undefined : fallback.diagnostics.find((item) => item.code === "E_QUARRY_UNSUPPORTED");
      assert(refusal?.rewrite.includes("index whose prefix pins the predicate")
        && refusal.rewrite.includes("table invariant (after insert <- exists ...)")
        && refusal.rewrite.includes("merge for a fan-in feed"),
      `${name} where lost its honest refusal: ${JSON.stringify(fallback)}`);
    }
  });

  test("Quarry filter repairs preserve named keys, ordering, and pageable result provenance", async () => {
    const schema = `table posts:
  author: principal
  visible: bool
  at: time
  rank: int
  by byAuthorAt: author, at, id
  by byWrongOrder: author, visible, rank, id
  public
`;
    const read = "posts[author = viewer] after c first 2 by byAuthorAt where true = .visible";
    const source = `query page(c: cursor ?):\n  rows = ${read}\n  return rows { id, at }\n`;
    const result = compileInline([
      { fileName: "snapback/schema.q", source: schema },
      { fileName: "snapback/feed.q", source },
    ]);
    assert(!result.ok, "where must still refuse before execution");
    const schemaRepair = result.diagnostics.find((item) => item.site.startsWith("snapback/schema.q:"));
    const readRepair = result.diagnostics.find((item) => item.site.startsWith("snapback/feed.q:"));
    assert(schemaRepair && readRepair, `filter lost its paired repair: ${diagnosticsText(result.diagnostics)}`);
    const repairedSchema = `${schema}  ${schemaRepair.rewrite.slice(3)}\n`;
    const repairedSource = source.replace(read, readRepair.rewrite.slice(3));
    await withProject({ "snapback/schema.q": repairedSchema, "snapback/feed.q": repairedSource }, async (root) => {
      const lowered = await lowerProject(root);
      assert(lowered.ok, `applying both repairs did not compile: ${lowered.ok ? "" : diagnosticsText(lowered.diagnostics)}`);
      const program = operation(lowered.project.programs, "feed.page");
      const checked = rustCheck([program], "synthetic", lowered.project.schema)[0]!;
      assert(!checked.error && checked.certificate?.result_pages,
        `repaired projection lost certification or continuation: ${JSON.stringify(checked)}`);
      const receipt: ClosureReceipt = {
        rows: [
          ["first", 1, 9, true], ["hidden", 2, 0, false], ["second", 3, 2, true], ["third", 4, 1, true],
        ].map(([id, at, rank, visible]) => ({ table: "posts", id: String(id), row: { Row: {
          id: { Id: String(id) }, author: { Id: "viewer-1" }, at: { Int: Number(at) },
          rank: { Int: Number(rank) }, visible: { Bool: Boolean(visible) },
        } } })),
        ranges: [], absences: [], verdicts: [],
      };
      const context: Context = { viewer: "viewer-1", principal_kind: "user", auth_epoch: 1,
        args: { c: "Null" }, now: 1, new_ids: [], read_time: 1 };
      receipt.ranges.push({ site: "drain.posts", table: "posts", index: "byId", prefix: [],
        order: "Asc", take: 5, after: null, before: null, gt: null, gte: null, lt: null, lte: null,
        rule_hash: scopedRuleHash(lowered.project.schema, (lowered.project.schema.tables as any).posts.rules.read),
        row_ids: receipt.rows.map((row) => row.id), stop: "Exhausted", absence: false, halo: null, n2_suffix: null });
      const execution = new ClientStore(lowered.project.schema, receipt).reexecute(program, context, checked.certificate).execution;
      deepStrictEqual(execution.result, { Array: [
        { Row: { id: { Id: "first" }, at: { Int: 1 } } },
        { Row: { id: { Id: "second" }, at: { Int: 3 } } },
      ] }, "repair changed the requested at order or failed to fill the page");
      assert(execution.next, "repaired shaped page did not mint a continuation");
      context.args.c = { String: execution.next };
      const next = new ClientStore(lowered.project.schema, receipt).reexecute(program, context, checked.certificate).execution;
      deepStrictEqual(next.result, { Array: [
        { Row: { id: { Id: "third" }, at: { Int: 4 } } },
      ] }, "repaired continuation skipped or repeated rows");
    });
  });

  test("Quarry filter repairs do not hoist row work or suggest non-scalar indexes", () => {
    const schema = `table accounts:
  owner: principal
  public

table posts:
  author: principal
  photo: image <=1000
  visible: bool
  at: time
  by byAuthorAt: author, at, id
  public
`;
    for (const predicate of [".author = .author", ".author = new", ".author = posts['other']!.author", ".author = account.owner", ".photo = photo", ".id = id"]) {
      const result = compileInline([
        { fileName: "snapback/schema.q", source: schema },
        { fileName: "snapback/feed.q", source: `query page(photo: image <=1000, account: accounts, id: posts, c: cursor ?):\n  return posts[viewer] after c first 2 by byAuthorAt where ${predicate}\n` },
      ]);
      assert(!result.ok && result.diagnostics.length === 1
        && result.diagnostics[0]!.rewrite.includes("index whose prefix pins the predicate"),
      `${predicate} received an unsafe prefix repair: ${JSON.stringify(result)}`);
    }
  });

  test("Quarry rule binders use focal dot and two-binding updates retain row images", async () => {
    for (const rule of ["read (r, extra) <- allow", "insert (r, extra) <- allow", "delete (r, extra) <- allow", "update (old, next, extra) <- allow"]) {
      const result = compileInline([{ fileName: "snapback/schema.q", source: `table rows:\n  value: int\n  ${rule}\n` }]);
      assert(!result.ok && result.diagnostics.some((item) => item.code === "E_QUARRY_SYNTAX" && item.message.includes("named bindings")),
        `invalid rule arity compiled: ${rule}: ${JSON.stringify(result)}`);
    }
    const named = compileInline([{
      fileName: "snapback/schema.q",
      source: "table rows:\n  value: int\n  update next <- next.value = 1\n",
    }]);
    const namedRefusal = named.ok ? undefined : named.diagnostics.find((item) => item.code === "E_QUARRY_SYNTAX");
    assert(namedRefusal?.rewrite === "-- update <- (.value = 1)",
      `named single-row rule lost its dot rewrite: ${JSON.stringify(named)}`);
    const oneRow = compileInline([{
      fileName: "snapback/schema.q",
      source: "table rows:\n  value: int\n  update <- .value = 1\n",
    }]);
    assert(oneRow.ok, `focal one-row update refused: ${oneRow.ok ? "" : diagnosticsText(oneRow.diagnostics)}`);
    await withProject({
      "snapback/schema.q": "table rows:\n  value: int\n  read <- allow\n  update (old, next) <- old.value != next.value\n",
      "snapback/rows.q": "query one(id: rows):\n  return rows[id]\n",
    }, async (root) => {
      const lowered = await lowerProject(root);
      assert(lowered.ok, `two-binding update refused: ${lowered.ok ? "" : diagnosticsText(lowered.diagnostics)}`);
      const rule = JSON.stringify((lowered.project.schema.tables.rows as any).rules.update);
      assert(rule.includes("OldField") && rule.includes("NextField"), `update row images were not retained: ${rule}`);
    });
  });

  test("Quarry maintain readable rules are typed against the materialized target", () => {
    const accepted = compileInline([{ fileName: "snapback/schema.q", source: "table source:\n  group: text <=20\n  body: text <=50\n  public\n\nmaintain totals = count source by group:\n  read <- allow\n  readable <- .value = 0\n" }]);
    assert(accepted.ok, `target value readable rule refused: ${accepted.ok ? "" : diagnosticsText(accepted.diagnostics)}`);
    const refused = compileInline([{ fileName: "snapback/schema.q", source: "table source:\n  group: text <=20\n  body: text <=50\n  public\n\nmaintain totals = count source by group:\n  read <- allow\n  readable <- .body = ''\n" }]);
    assert(!refused.ok && refused.diagnostics.some((item) => item.message.includes("body")),
      `source-only readable field compiled: ${JSON.stringify(refused)}`);
  });

  test("Quarry result annotations are refused because results are inferred", () => {
    const result = compileInline([
      { fileName: "snapback/schema.q", source: "table rows:\n  value: int\n  public\n" },
      { fileName: "snapback/ops.q", source: "query wrong() -> int:\n  return 'x'\n" },
    ]);
    assert(!result.ok && result.diagnostics.some((item) => item.code === "E_QUARRY_UNSUPPORTED"
      && item.rewrite.includes("results are inferred; remove the annotation")),
    `result annotation compiled or lost its rewrite: ${JSON.stringify(result)}`);
  });

  test("Quarry channel properties recover per line", () => {
    const result = compileInline([{ fileName: "snapback/schema.q", source: "table rows:\n  value: int\n  public\n\nchannel updates():\n  broken one\n  alsoBroken two\n  publish <- public\n  subscribe <- public\n  ttl 1s\n" }]);
    assert(!result.ok && result.diagnostics.filter((item) => item.code === "E_QUARRY_SYNTAX"
      && item.message.includes("unknown channel property")).length === 2,
    `channel parsing stopped before both defects: ${JSON.stringify(result)}`);
  });

  test("Quarry index inference prefers an exact-length probe over a longer prefix", async () => {
    await withProject({
      "snapback/schema.q": `table owners:\n  name: text <=20\n  public\n\ntable items:\n  owner: owners\n  label: text <=20\n  by owner\n  by byOwnerLabel: owner, label\n  public\n`,
      "snapback/items.q": `query exact(owner: owners):\n  return exists items[owner]\n`,
    }, async (root) => {
      const lowered = await lowerProject(root);
      assert(lowered.ok, `exact-length inference refused: ${lowered.ok ? "" : diagnosticsText(lowered.diagnostics)}`);
    });
  });

  test("Quarry index inference matches known reference tables", async () => {
    await withProject({
      "snapback/schema.q": `table owners:\n  name: text <=20\n  public\n\ntable otherOwners:\n  name: text <=20\n  public\n\ntable lookups:\n  owner: owners\n  otherOwner: otherOwners\n  unique owner\n  unique otherOwner\n  public\n`,
      "snapback/lookups.q": `query byOwner(owner: owners):\n  return lookups[owner]\n`,
    }, async (root) => {
      const lowered = await lowerProject(root);
      assert(lowered.ok, `ref-table inference refused: ${lowered.ok ? "" : diagnosticsText(lowered.diagnostics)}`);
    });
  });

  test("Quarry refuses every reserved generated binding with a sited rename rewrite", () => {
    const cases = [
      {
        name: "table",
        inputs: [{ fileName: "snapback/schema.q", source: "table delete:\n  value: int\n  public\n" }],
        site: "snapback/schema.q:1:7",
      },
      {
        name: "channel",
        inputs: [{ fileName: "snapback/schema.q", source: "table rows:\n  value: int\n  public\n\nchannel delete():\n  publish <- public\n  subscribe <- public\n  ttl 1s\n" }],
        site: "snapback/schema.q:5:9",
      },
      {
        name: "effect",
        inputs: [
          { fileName: "snapback/schema.q", source: "table rows:\n  value: int\n  public\n" },
          { fileName: "snapback/ops.q", source: "effect delete from notifications\n\nquery okay():\n  null\n" },
        ],
        site: "snapback/ops.q:1:8",
      },
      {
        name: "operation",
        inputs: [
          { fileName: "snapback/schema.q", source: "table rows:\n  value: int\n  public\n" },
          { fileName: "snapback/ops.q", source: "query delete():\n  null\n" },
        ],
        site: "snapback/ops.q:1:7",
      },
    ];
    for (const item of cases) {
      const result = compileInline(item.inputs);
      assert(!result.ok, `reserved ${item.name} binding compiled`);
      const refusal = result.diagnostics.find((diagnostic) => diagnostic.message.includes("reserved"));
      assert(refusal?.site === item.site, `reserved ${item.name} refusal site changed: ${JSON.stringify(result)}`);
      assert(refusal.rewrite.includes("rename") && refusal.rewrite.includes("delete"),
        `reserved ${item.name} refusal lost its rename rewrite: ${refusal.rewrite}`);
    }
    for (const word of ["insert", "update", "upsert"]) {
      const result = compileInline([{ fileName: "snapback/schema.q", source: `table ${word}:\n  value: int\n  public\n` }]);
      const refusal = result.ok ? undefined : result.diagnostics.find((diagnostic) => diagnostic.message.includes("reserved"));
      assert(refusal?.site === "snapback/schema.q:1:7" && refusal.rewrite.includes(word),
        `reserved write word ${word} compiled or lost its rename rewrite: ${JSON.stringify(result)}`);
    }
  });

  test("Quarry validates compound and range keys against the selected index types", () => {
    const schema = "table items:\n  done: bool\n  rank: int\n  public\n  unique done, rank\n  by ranked: done, rank\n";
    const modules = [
      "query wrongCompound():\n  items[true, 'high'] by byDoneRank\n",
      "query wrongRange():\n  items[true, 'high'] first 5 by ranked\n",
    ];
    for (const module of modules) {
      const result = compileInline([
        { fileName: "snapback/schema.q", source: schema },
        { fileName: "snapback/ops.q", source: module },
      ]);
      assert(!result.ok && result.diagnostics.some((item) => item.message.includes("expects int for rank, got text")),
        `selected-index key mismatch compiled: ${JSON.stringify(result)}`);
    }
  });

  test("Quarry reference-table identity rejects named, inferred, and ranged cross-table keys", () => {
    const schema = "table users:\n  public\n\ntable posts:\n  public\n\ntable todos:\n  owner: users\n  public\n  unique owner\n";
    const operations = [
      "query named(post: posts):\n  todos[owner = post]\n",
      "query inferred(post: posts):\n  todos[post]\n",
      "query ranged(post: posts):\n  todos[post] first 5 by byOwner\n",
    ];
    for (const operation of operations) {
      const result = compileInline([
        { fileName: "snapback/schema.q", source: schema },
        { fileName: "snapback/ops.q", source: operation },
      ]);
      assert(!result.ok, `cross-table reference key compiled: ${operation}`);
      assert(result.diagnostics.some((item) => item.message.includes("reference to posts") || item.message.includes("no unique index")),
        `cross-table refusal lost its actual type: ${JSON.stringify(result)}`);
    }
  });

  test("Quarry focal detection covers every expression container used by patches", () => {
    const schema = "table users:\n  name: text <=50\n  public\n  by byName: name, id\n\ntable nodes:\n  parent: nodes?\n  public\n\ntable posts:\n  author: users\n  node: nodes\n  authorName: text <=50\n  payload: json <=2048\n  related: logs?\n  flag: bool\n  public\n\ntable logs:\n  post: posts\n  public\n";
    const cases: Array<[string, string, string]> = [
      ["read", "authorName: users[.author].name", "db.get(users$table"],
      ["array", "payload: [.author]", ".author"],
      ["exists", "flag: exists users[.author]", "db.exists(users$table"],
      ["walk", "payload: walk nodes[.node] up .parent depth 2", "recurse("],
      ["nested write", "related: insert logs { post: .id }", "db.insert(logs$table"],
      ["object literal", "payload: { author: .author }", "author:"],
    ];
    for (const [name, field, emitted] of cases) {
      const result = compileInline([
        { fileName: "snapback/schema.q", source: schema },
        { fileName: "snapback/ops.q", source: `mutation refresh(id: posts):\n  update posts[id] { ${field} }\n` },
      ]);
      assert(result.ok, `${name} focal container was refused: ${result.ok ? "" : diagnosticsText(result.diagnostics)}`);
      const source = result.modules[0]!.source;
      const callback = source.indexOf("(__q_old_");
      assert(callback >= 0 && source.indexOf(emitted, callback) > callback,
        `${name} focal container did not take the row callback path:\n${source}`);
    }
  });

  test("Quarry focal patch preludes remain callback-local and preserve field order", () => {
    const result = compileInline([
      { fileName: "snapback/schema.q", source: "table users:\n  name: text <=50\n  public\n\ntable posts:\n  author: users\n  authorName: text <=50\n  payload: json <=2048\n  public\n" },
      { fileName: "snapback/ops.q", source: "mutation refresh(id: posts):\n  update posts[id] { authorName: users[.author].name, payload: { author: .author } }\n" },
    ]);
    assert(result.ok, `focal patch refused: ${result.ok ? "" : diagnosticsText(result.diagnostics)}`);
    const source = result.modules[0]!.source;
    const callback = source.indexOf("(__q_old_");
    const dereference = source.indexOf("db.get(users$table", callback);
    const firstField = source.indexOf("const __q_patch_", callback);
    const secondField = source.indexOf("const __q_patch_", firstField + 1);
    const returned = source.indexOf("return {", callback);
    assert(callback >= 0 && firstField > callback && dereference > firstField
      && secondField > firstField && returned > secondField,
    `focal patch evaluation escaped or reordered its callback:\n${source}`);
  });

  test("Quarry shaped pages retain spread/override field types and reference identity", async () => {
    const schema = "table authors:\n  name: text <=50\n  public\n\ntable posts:\n  author: authors\n  public\n  by author\n\ntable copies:\n  name: text <=50\n  public\n";
    const unsafe = "mutation copy():\n  for post in posts[] first 5 by byAuthor { *, author: .author }:\n    insert copies { name: post.author.name }\n  null\n";
    await withProject({ "snapback/schema.q": schema, "snapback/ops.q": unsafe }, async (root) => {
      const compiled = compileInline([
        { fileName: "snapback/schema.q", source: schema },
        { fileName: "snapback/ops.q", source: unsafe },
      ]);
      assert(compiled.ok && compiled.modules[0]!.source.includes("db.get(authors$table"),
        `shaped reference field was not auto-dereferenced: ${compiled.ok ? compiled.modules[0]!.source : diagnosticsText(compiled.diagnostics)}`);
      const refused = await lowerProject(root);
      assert(!refused.ok && refused.diagnostics.some((item) => item.message.includes("undefined")
        && item.rewrite.includes("! else CODE")),
      `possibly absent shaped read was not refused with a Quarry assertion rewrite: ${JSON.stringify(refused)}`);

      await writeFile(join(root, "snapback/ops.q"), unsafe.replace("post.author.name", "post.author.name! else AUTHOR_MISSING"));
      const asserted = await lowerProject(root);
      assert(asserted.ok, `asserted shaped read refused: ${asserted.ok ? "" : diagnosticsText(asserted.diagnostics)}`);
      assert(JSON.stringify(asserted.project.programs).includes('"table":"authors"'),
        "asserted shaped-page operation lost its authors read site");
    });
  });

  test("Quarry walked rows and shaped page rows stay row/object values", async () => {
    const schema = "table nodes:\n  parent: nodes?\n  name: text <=50\n  public\n  by name\n  cap 3 by name\n\ntable copies:\n  name: text <=50\n  public\n";
    const module = "mutation copyWalk(seed: nodes):\n  for ancestor in walk nodes[seed] up .parent depth 3:\n    name = ancestor.name\n  null\n\nmutation copyPage(name: text <=50):\n  for node in nodes[name] first 3 by byName { * }:\n    name = node.name\n  null\n";
    const compiled = compileInline([
      { fileName: "snapback/schema.q", source: schema },
      { fileName: "snapback/ops.q", source: module },
    ]);
    assert(compiled.ok, `walk/page front end refused: ${compiled.ok ? "" : diagnosticsText(compiled.diagnostics)}`);
    const source = compiled.modules[0]!.source;
    assert(!source.includes("db.get(nodes$table, ancestor)") && !source.includes("db.get(nodes$table, node)"),
      `walked or shaped row was treated as a reference:\n${source}`);
    assert(source.includes("ancestor.name") && source.includes("node.name"), `row fields were not selected directly:\n${source}`);
    await withProject({ "snapback/schema.q": schema, "snapback/ops.q": module }, async (root) => {
      const lowered = await lowerProject(root);
      assert(lowered.ok, `walk/page project refused: ${lowered.ok ? "" : diagnosticsText(lowered.diagnostics)}`);
      assert(rustCheck(lowered.project.programs, "synthetic", lowered.project.schema).every((item) => !item.error),
        "walk/page project did not certify");
    });
  });

  test("Quarry mid-body matches discard arm values and accept write-only arms", async () => {
    const schema = "table todos:\n  title: text <=50\n  public\n";
    const module = "mutation touch(id: todos):\n  match todos[id]:\n    some todo:\n      todo.title\n    none:\n      'missing'\n  update todos[id] { title: 'touched' }\n\nmutation ensure(id: todos):\n  match todos[id]:\n    some todo:\n      update todos[id] { title: 'found' }\n    none:\n      insert todos { title: 'made' }\n  return null\n";
    await withProject({ "snapback/schema.q": schema, "snapback/ops.q": module }, async (root) => {
      const lowered = await lowerProject(root);
      assert(lowered.ok, `mid-body match refused: ${lowered.ok ? "" : diagnosticsText(lowered.diagnostics)}`);
      assert(rustCheck(lowered.project.programs, "synthetic", lowered.project.schema).every((item) => !item.error),
        "mid-body match project did not certify");
    });
  });

  test("every Quarry diagnostic family rewrite is fenced parseable Quarry", () => {
    const families = JSON.parse(readFileSync(resolve(packageRoot, "guide/families.source.json"), "utf8")) as Array<Record<string, string>>;
    const quarry = families.filter((item) => item.family === "quarry");
    const expected = new Set(["E_QUARRY_SYNTAX", "E_QUARRY_UNKNOWN", "E_QUARRY_AMBIGUOUS", "E_QUARRY_UNSUPPORTED", "E_QUARRY_PLACEMENT", "E_QUARRY_TYPE", "E_QUARRY_RETAIN", "E_QUARRY_ONLY"]);
    assert(quarry.length === expected.size, `Quarry family entry count changed: ${quarry.length}`);
    for (const item of quarry) {
      assert(expected.delete(item.code), `unexpected/duplicate Quarry family code ${item.code}`);
      const match = item.right.match(/^```q\n([\s\S]+)\n```$/);
      assert(match, `${item.code} right rewrite is not fenced Quarry`);
      const parsed = parseDocument("right.q", match[1]!);
      assert(parsed.diagnostics.length === 0, `${item.code} right rewrite does not parse: ${parsed.diagnostics.map((entry) => entry.message).join("; ")}`);
    }
    assert(expected.size === 0, `missing Quarry family entries: ${[...expected].join(", ")}`);
  });

  test("principal remains nominal in Quarry rules and program values", () => {
    const source = `use identity\n\ntable users:\n  name: text <=40\n  public\n\ntable items:\n  owner: users\n  read <- .owner = viewer\n`;
    const compiled = compileQuarry([{ path: "/virtual/schema.q", fileName: "snapback/schema.q", source }]);
    assert(!compiled.ok, "a table ref compared with viewer was accepted");
    const refusal = compiled.diagnostics[0]!;
    assert(refusal.code === "E_QUARRY_UNKNOWN" && refusal.family === "quarry" && refusal.site === "snapback/schema.q:9:18",
      `nominal refusal was not a sited Quarry diagnostic: ${JSON.stringify(refusal)}`);
    assert(refusal.message.includes("fields compared with viewer must be principal"), `nominal refusal message changed: ${refusal.message}`);
  });

  test("db.insert row expressions are bound once and share the returned variable", async () => {
    await withProject({
      "snapback/schema.ts": `import { rule, schema, table, t } from "snapback2";\nexport const items = table({ columns: { owner: t.principal() }, rules: { read: rule.allow(), insert: rule.allow() } });\nexport default schema({ auth: { password: true, guests: true }, tables: { items } });\n`,
      "snapback/items.ts": `import { mutation } from "snapback2";\nimport { items } from "./schema";\nexport const add = mutation({}, ({ db, ctx }) => {\n  return db.insert(items, { id: ctx.newId(), owner: ctx.viewer });\n});\n`,
    }, async (root) => {
      const lowered = await lowerProject(root, { authoring: "any" });
      assert(lowered.ok, `inline insert fixture refused: ${lowered.ok ? "" : diagnosticsText(lowered.diagnostics)}`);
      const body = operation(lowered.project.programs, "items.add").body as any[];
      const letStmt = body.find((item) => item.Let?.name?.startsWith("__insertRow"));
      const insert = body.find((item) => item.Insert);
      const returned = body.find((item) => item.Return);
      assert(letStmt && insert?.Insert?.row?.Variable === letStmt.Let.name && returned?.Return?.Variable === letStmt.Let.name,
        `insert/storage/return do not share one temporary: ${JSON.stringify(body)}`);
      assert(rustCheck(lowered.project.programs, "synthetic", lowered.project.schema).every((item) => !item.error), "single-evaluation insert IR did not certify");
    });
  });

  test("Quarry mutually exclusive branch writes share the certifier/runtime bound", async () => {
    const lowered = await lowerProject(resolve(fixtures, "quarry-surface"));
    assert(lowered.ok, "Quarry branch-write fixture refused");
    const program = operation(lowered.project.programs, "surface.branchWrite");
    const checked = rustCheck([program], "synthetic", lowered.project.schema)[0]!;
    assert(!checked.error, `branch write did not certify: ${JSON.stringify(checked.error)}`);
    const sites = checked.certificate?.write_sites as Array<{ table: string; max_rows: number }>;
    assert(sites?.some((site) => site.table === "counters" && site.max_rows === 1), `branch write bound is not one: ${JSON.stringify(sites)}`);
  });

  test("Quarry-only authoring and module placement are exact", async () => {
    await withProject({
      "snapback/schema.q": "table items:\n  value: int\n  public\n",
      "snapback/schema.ts": "export default {};\n",
      "snapback/items.q": "query list():\n  return null\n",
    }, async (root) => {
      const result = await lowerProject(root);
      assert(!result.ok && result.diagnostics[0]?.code === "E_QUARRY_ONLY" && result.diagnostics[0].site === "snapback/schema.ts:1:1",
        "TypeScript schema did not receive the Quarry-only refusal");
    });
    await withProject({
      "snapback/schema.ts": "export default {};\n",
      "snapback/items.q": "query list():\n  return null\n",
    }, async (root) => {
      const result = await lowerProject(root);
      assert(!result.ok && result.diagnostics[0]?.code === "E_QUARRY_ONLY", "TypeScript schema was not refused");
    });
    await withProject({
      "snapback/schema.q": "table items:\n  value: int\n  public\n",
      "snapback/items.q": "query fromQuarry():\n  return null\n",
      "snapback/items.ts": "import { effect } from 'snapback2'; export const notify = effect({ grants: ['https://api.example.com'], run: async () => null });\n",
    }, async (root) => {
      const result = await lowerProject(root);
      assert(!result.ok && result.diagnostics.some((item) => item.code === "E_OP_MODULE_BASENAME"), "same-stem Quarry/effect modules were not refused");
    });
  });
}
