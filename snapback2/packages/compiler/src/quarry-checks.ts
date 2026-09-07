import { deepStrictEqual } from "node:assert";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { ClientStore, scopedRuleHash, type ClosureReceipt, type Context, type Value } from "../../evaluator/src/evaluator";
import { lowerSource } from "./compiler";
import { lowerProject } from "./project";
import { rustCheck } from "./rust-check";
import { compileQuarry } from "./quarry/index";
import { expandDocuments } from "./quarry/expand";
import { parseDocument } from "./quarry/parser";
import { quarryExpression, quarryShapeDeclaration } from "./quarry/print";
import {
  assert,
  compileFixture,
  compileInline,
  diagnosticsText,
  generatedOperation,
  occurrences,
  operation,
  type Test,
  withProject,
  writeKeyNames,
} from "./quarry-check-helpers";
import { registerJobChecks } from "./quarry-job-checks";
import { registerScheduleChecks } from "./quarry-schedule-checks";
import { registerQuarryProgramChecks } from "./quarry-program-checks";
import { registerQuarryDirectMutationChecks } from "./quarry-direct-mutation-checks";
import { registerQuarryDirectValidationChecks } from "./quarry-direct-validation-checks";
import { registerQuarryDirectProjectChecks } from "./quarry-direct-project-checks";
import { registerQuarryDirectArgumentChecks } from "./quarry-direct-argument-checks";
import { runQuarryBoundApiChecks } from "./quarry-bound-api-checks";
import { registerQuarryDirectSearchEligibilityChecks } from "./quarry-direct-search-eligibility-checks";
import ts from "typescript";

export function registerQuarryChecks(test: Test, frontend: string): void {
  const fixtures = resolve(frontend, "fixtures");
  registerQuarryDirectValidationChecks(test, frontend);
  registerQuarryDirectArgumentChecks(test);
  test("bound Quarry API follows direct result and custody facts", runQuarryBoundApiChecks);
  registerQuarryDirectSearchEligibilityChecks(test);
  registerQuarryDirectProjectChecks(test, frontend);
  test("removed system rule refuses in the parser with a deny rewrite", () => {
    for (const rule of [
      "system", "allow or system", "not system", "(deny or system)",
      "viewer = system", "system != viewer", "viewer != (system)", "(system) = viewer",
      "exists records[system]", "exists records[id = (system)]",
      "created records[system]", "created records[id = (system)]",
    ]) {
      const parsed = parseDocument("snapback/schema.q", `table records:\n  value: int\n  insert <- ${rule}\n`);
      const refusal = parsed.diagnostics.find((item) => item.code === "E_QUARRY_UNSUPPORTED");
      assert(refusal?.rewrite === "deny", JSON.stringify(parsed.diagnostics));
      assert(refusal?.message === "the system principal never consults rules; `deny` is what this meant", JSON.stringify(refusal));
      assert(refusal?.line === 3 && Boolean(refusal.guide), JSON.stringify(refusal));
      const compiled = compileInline([
        { fileName: "snapback/schema.q", source: `table records:\n  value: int\n  insert <- ${rule}\n` },
      ]);
      assert(!compiled.ok && compiled.diagnostics.some((item) => item.code === "E_QUARRY_UNSUPPORTED" && item.rewrite === "deny" && item.family === "quarry"), JSON.stringify(compiled));

    }
  });

  test("Quarry todos and full surface lower in memory and certify", async () => {
    for (const [name, count] of [["quarry-todos", 2], ["quarry-surface", 26]] as const) {
      const lowered = await lowerProject(resolve(fixtures, name));
      assert(lowered.ok, `${name} refused: ${lowered.ok ? "" : diagnosticsText(lowered.diagnostics)}`);
      assert(lowered.project.programs.length === count, `${name} program count changed to ${lowered.project.programs.length}`);
      const failures = rustCheck(lowered.project.programs, "synthetic", lowered.project.schema).filter((item) => item.error);
      assert(failures.length === 0, `${name} did not certify: ${JSON.stringify(failures)}`);
      assert(!existsSync(resolve(fixtures, name, "snapback/schema.ts")), `${name} wrote generated schema.ts into the authored tree`);
      assert(!existsSync(resolve(fixtures, name, "snapback/surface.q.ts")), `${name} wrote generated .q.ts into the authored tree`);
      assert(lowered.quarry.every((item) => item.file.endsWith(".q") && item.generated.endsWith(".ts")
        && item.source.startsWith("// GENERATED")), `${name} lost its Quarry inspection response`);
    }

    const compiled = compileFixture(fixtures, "quarry-surface", ["schema", "surface"]);
    assert(compiled.ok, `surface front end refused: ${compiled.ok ? "" : diagnosticsText(compiled.diagnostics)}`);
    const text = `${compiled.schema.source}\n${compiled.modules[0]!.source}`;
    for (const spelling of [
      "rule.and(", "rule.or(", "rule.not(", "rule.exists(", "channel({", "t.optional(", "t.enum(",
      "t.principal()", "t.id()", "t.json(2048)", "t.bytes(1024)", "db.upsert(", "orderedPair(",
      "mentionTokens(", "recurse(", "after:", "__q_matchResult", "db.get(users$table",
    ]) assert(text.includes(spelling), `Quarry full-surface lowering lost ${spelling}`);
    for (const line of text.split("\n").filter((line) => line.trim())) {
      assert(/\/\/ q:.+:\d+:\d+$/.test(line), `generated Quarry line lacks file:line:column provenance: ${line}`);
    }
  });

  test("Quarry named shapes expand in every use position and print as authored", async () => {
    const schema = `table profiles:
  displayName: text <=80
  handle: text <=40
  by byDisplayName: displayName, id
  public

table posts:
  author: profiles
  body: text <=500
  public
`;
    const module = `shape card = { displayName, handle }
shape labeledCard = { ...card, label: .displayName }
shape postCard = { body, author: profiles[.author] card }

query direct(id: profiles):
  return profiles[id] card

query boundRow(id: profiles):
  row = profiles[id]! else MISSING
  return row labeledCard

query boundPage():
  page = profiles[] first 2 by byDisplayName
  return page card

query nested(id: posts):
  return posts[id] postCard
`;
    const parsed = parseDocument("snapback/cards.q", module);
    assert(parsed.diagnostics.length === 0, `named-shape source did not parse: ${JSON.stringify(parsed.diagnostics)}`);
    const expanded = expandDocuments([parsed.document]);
    const direct = expanded.documents[0]!.programs.find((program) => program.name === "direct")!.body[0]!;
    assert(direct.kind === "return" && quarryExpression(direct.value) === "(profiles[id]) card",
      `expanded use did not print the authored shape name: ${direct.kind === "return" ? quarryExpression(direct.value) : direct.kind}`);
    assert(quarryShapeDeclaration(parsed.document.shapes[1]!) === "shape labeledCard = { ...card, label: .displayName }",
      "shape declaration printer did not preserve the authored declaration");

    await withProject({ "snapback/schema.q": schema, "snapback/cards.q": module }, async (root) => {
      const lowered = await lowerProject(root);
      assert(lowered.ok, `named shapes refused: ${lowered.ok ? "" : diagnosticsText(lowered.diagnostics)}`);
      const failures = rustCheck(lowered.project.programs, "synthetic", lowered.project.schema).filter((item) => item.error);
      assert(failures.length === 0, `expanded shapes did not certify: ${JSON.stringify(failures)}`);
      for (const name of ["cards.direct", "cards.boundRow", "cards.boundPage", "cards.nested"]) {
        const serialized = JSON.stringify(operation(lowered.project.programs, name));
        assert(serialized.includes("displayName"), `${name} lost the named projection: ${serialized}`);
      }
    });
  });

  test("Quarry nested named-shape collections isolate expansions and iterations under RBAC and cursors", async () => {
    // Reduced from the immutable published-m3-check.log, retaining its messageCard and both page contexts.
    const schema = `table profiles:
  principal: principal
  displayName: text <=20
  handle: text <=20
  avatar: text <=20
  visible: bool
  unique byPrincipal: principal
  read <- .visible = true
table conversations:
  public
table members:
  conversation: conversations
  principal: principal
  by byPrincipal: principal, id
  public
table messages:
  conversation: conversations
  sender: principal
  body: text <=20
  quote: messages ?
  at: time
  by byConversation: conversation, at, id
  public
table targets:
  conversation: conversations
  message: messages
  recipient: principal
  reader: principal
  membership: members
  state: text <=10
  by byConversationMessage: conversation, message, id
  read <- .reader = viewer
`;
    const cards = `shape person = { principal, displayName, handle, avatar }
shape target = { recipient, state, active: exists members[.membership] }
shape messageCard = { *, author: profiles[.sender] person, quoted: messages[.quote] { id, body, sender }, targets: targets[.conversation, .id] first 50 by byConversationMessage target }
`;
    const queries = `query history(conversation: conversations, c: cursor ?):
  return messages[conversation] after c last 20 by byConversation messageCard
query inbox(c: cursor ?):
  return members[viewer] after c first 2 by byPrincipal { id, recent: messages[.conversation] last 1 by byConversation messageCard }
query pair(a: messages, b: messages):
  return { first: messages[a] messageCard, second: messages[b] messageCard }
`;
    for (const imported of [false, true]) await withProject({
      "snapback/schema.q": schema,
      ...(imported ? { "snapback/cards.q": cards } : {}),
      "snapback/chats.q": `${imported ? "shape messageCard from cards\n" : cards}${queries}`,
    }, async (root) => {
      const lowered = await lowerProject(root);
      assert(lowered.ok, `nested named collections refused (imported=${imported}): ${lowered.ok ? "" : diagnosticsText(lowered.diagnostics)}`);
      const { programs, schema: irSchema } = lowered.project;
      const checked = rustCheck(programs, "synthetic", irSchema);
      assert(checked.every((item) => !item.error), `nested shapes did not certify: ${JSON.stringify(checked)}`);
      const certificate = (name: string) => checked.find((item) => item.program === `chats.${name}`)!.certificate;
      for (const name of ["history", "inbox"]) {
        const pages = Object.values(certificate(name)!.result_pages as Record<string, { table: string }>);
        assert(pages.length === 1 && pages[0]!.table === (name === "history" ? "messages" : "members"),
          `nested targets or recent messages stole ${name}'s cursor: ${JSON.stringify(pages)}`);
      }
      assert(!certificate("pair")!.result_pages, "object-nested pages acquired a result cursor");
      const tooSmall = rustCheck([operation(programs, "chats.history")], "synthetic", irSchema, { examined: 10 });
      assert(tooSmall[0]?.error, "nested shape reads escaped their resource ceiling");
      const receipt: ClosureReceipt = { rows: [], ranges: [], verdicts: [],
        schema_hash: certificate("history")!.schema_hash as string,
        absences: [["members", "byId", [{ Id: "gone" }]], ["messages", "byId", ["Null"]]],
      };
      const add = (table: string, id: string, row: Record<string, Value>) => receipt.rows.push({
        table, id, row: { Row: { id: { Id: id }, ...row } },
      });
      for (const id of ["a", "b"]) {
        add("conversations", id, {});
        add("members", id, { conversation: { Id: id }, principal: { Id: "u1" } });
      }
      for (const [id, visible] of [["u1", true], ["u2", false]] as const) add("profiles", id, {
        principal: { Id: id }, displayName: { String: id }, handle: { String: id }, avatar: { String: id }, visible: { Bool: visible },
      });
      for (let i = 0; i < 23; i++) {
        const conversation = { Id: i < 21 ? "a" : "b" };
        add("messages", `m${i}`, { conversation, sender: { Id: i % 2 ? "u2" : "u1" }, body: { String: `body${i}` },
          quote: i ? { Id: `m${i - 1}` } : "Null", at: { Int: i } });
        if (i > 0) add("targets", `t${i}`, { conversation, message: { Id: `m${i}` }, recipient: { Id: `recipient${i}` }, reader: { Id: "u1" },
          membership: { Id: i % 2 ? "gone" : "a" }, state: { String: i % 2 ? "read" : "sent" } });
        add("targets", `hidden${i}`, { conversation, message: { Id: `m${i}` }, recipient: { Id: "hidden" }, reader: { Id: "u2" },
          membership: { Id: "b" }, state: { String: "hidden" } });
      }
      for (const table of Object.keys(irSchema.tables as object)) receipt.ranges.push({
        site: `held.${table}`, table, index: "byId", prefix: [], order: "Asc", take: 100,
        after: null, before: null, gt: null, gte: null, lt: null, lte: null,
        rule_hash: scopedRuleHash(irSchema, (irSchema.tables as any)[table].rules.read),
        row_ids: receipt.rows.filter((row) => row.table === table).map((row) => row.id),
        stop: "Exhausted", absence: false, halo: null, n2_suffix: null,
      });
      const store = new ClientStore(irSchema, receipt);
      const run = (name: string, args: Context["args"]) => {
        const replay = store.reexecute(operation(programs, `chats.${name}`), {
          viewer: "u1", principal_kind: "user", auth_epoch: 1, args, now: 1, new_ids: [], read_time: 1,
        }, certificate(name));
        assert(replay.state === "fresh", `fixture lacks coverage for ${name}: ${JSON.stringify(replay.partialSites)}`);
        return replay.execution;
      };
      const expectCard = (value: Value, i: number) => {
        const card = (value as { Row: Record<string, Value> }).Row;
        deepStrictEqual(card.id, { Id: `m${i}` });
        deepStrictEqual(card.targets, { Array: i ? [{ Row: {
          recipient: { Id: `recipient${i}` }, state: { String: i % 2 ? "read" : "sent" }, active: { Bool: i % 2 === 0 },
        } }] : [] }, "targets leaked across iterations or RBAC");
        deepStrictEqual(card.author, i % 2 ? "Null" : { Row: {
          principal: { Id: "u1" }, displayName: { String: "u1" }, handle: { String: "u1" }, avatar: { String: "u1" },
        } });
        deepStrictEqual(card.quoted, i ? { Row: { id: { Id: `m${i - 1}` }, body: { String: `body${i - 1}` },
          sender: { Id: (i - 1) % 2 ? "u2" : "u1" } } } : "Null");
      };
      const first = run("history", { conversation: { Id: "a" }, c: "Null" });
      const history = (first.result as { Array: Value[] }).Array;
      assert(history?.length === 20 && first.next, `history page failed: ${JSON.stringify(first)}`);
      history.forEach((card, n) => expectCard(card, 20 - n));
      const second = run("history", { conversation: { Id: "a" }, c: { String: first.next } });
      const remaining = (second.result as { Array: Value[] }).Array;
      assert(remaining?.length === 1, `history cursor followed a nested page: ${JSON.stringify(second)}`);
      expectCard(remaining[0]!, 0);
      const inbox = (run("inbox", { c: "Null" }).result as { Array: Array<{ Row: { recent: { Array: Value[] } } }> }).Array;
      assert(inbox?.length === 2, "inbox lost a membership");
      for (const [n, i] of [20, 22].entries()) {
        assert(inbox[n]!.Row.recent.Array.length === 1, "recent page accumulated a prior iteration");
        expectCard(inbox[n]!.Row.recent.Array[0]!, i);
      }
      const pair = (run("pair", { a: { Id: "m0" }, b: { Id: "m1" } }).result as { Row: Record<string, Value> }).Row;
      expectCard(pair.first!, 0);
      expectCard(pair.second!, 1);
    });
  });

  test("Quarry named shapes refuse placement, cycles, depth, and carry definition plus use sites", () => {
    const schema = "table profiles:\n  displayName: text <=80\n  public\n";
    const placement = compileInline([
      { fileName: "snapback/schema.q", source: `${schema}\nshape card = { displayName }\n` },
      { fileName: "snapback/ops.q", source: "query one():\n  return null\n" },
    ]);
    assert(!placement.ok && placement.diagnostics.some((item) => item.code === "E_QUARRY_PLACEMENT"),
      `schema shape did not receive a placement refusal: ${JSON.stringify(placement)}`);

    for (const [name, declarations] of [
      ["direct", "shape a = { ...a }"],
      ["indirect", "shape a = { ...b }\nshape b = { ...a }"],
    ] as const) {
      const result = compileInline([
        { fileName: "snapback/schema.q", source: schema },
        { fileName: `snapback/${name}.q`, source: `${declarations}\nquery use(id: profiles):\n  return profiles[id] a\n` },
      ]);
      assert(!result.ok && result.diagnostics.some((item) => item.code === "E_QUARRY_UNSUPPORTED" && item.message.includes("shape cycle")),
        `${name} shape cycle compiled: ${JSON.stringify(result)}`);
    }

    const chain = Array.from({ length: 9 }, (_, offset) =>
      `shape s${offset + 1} = { ${offset === 8 ? "displayName" : `...s${offset + 2}`} }`).join("\n");
    const deep = compileInline([
      { fileName: "snapback/schema.q", source: schema },
      { fileName: "snapback/deep.q", source: `${chain}\nquery use(id: profiles):\n  return profiles[id] s1\n` },
    ]);
    assert(!deep.ok && deep.diagnostics.some((item) => item.code === "E_QUARRY_UNSUPPORTED" && item.message.includes("depth 8")),
      `nine-deep shape compiled: ${JSON.stringify(deep)}`);

    const bad = compileInline([
      { fileName: "snapback/schema.q", source: schema },
      { fileName: "snapback/bad.q", source: "shape broken = { missing }\nquery use(id: profiles):\n  return profiles[id] broken\n" },
    ]);
    const refusal = bad.ok ? undefined : bad.diagnostics.find((item) => item.code === "E_QUARRY_UNKNOWN");
    assert(refusal?.site === "snapback/bad.q:1:18" && refusal.message.includes("used at snapback/bad.q:3:"),
      `expanded diagnostic lost its definition and use sites: ${JSON.stringify(bad)}`);

    for (const keyword of ["shape", "fn", "cursor"]) {
      const result = compileInline([
        { fileName: "snapback/schema.q", source: schema },
        { fileName: "snapback/reserved.q", source: `query bad(${keyword}: int):\n  return ${keyword}\n` },
      ]);
      assert(!result.ok && result.diagnostics.some((item) => item.code === "E_QUARRY_UNKNOWN" && item.message.includes("reserved")),
        `${keyword} was not reserved as a binding: ${JSON.stringify(result)}`);
    }
  });

  test("Quarry imported shapes share lexical projections, unique temporaries, and page provenance", async () => {
    const files = {
      "snapback/schema.q": `table profiles:
  displayName: text <=80
  handle: text <=40
  friend: profiles ?
  by byDisplayName: displayName, id
  public
`,
      "snapback/cards.q": `shape card = { displayName }
shape profileCard = { ...card, friend: .friend card, current: viewer }
`,
      "snapback/exports.q": "shape profileCard from cards\n",
      "snapback/ops.q": `shape profileCard from exports
shape card = { handle }
query pair(id: profiles, viewer: principal):
  row = profiles[id]! else MISSING
  first = row profileCard
  second = row profileCard
  return { first, second }
query page(c: cursor ?):
  return profiles[] after c first 2 by byDisplayName profileCard
`,
    };
    const compiled = compileInline(Object.entries(files).map(([fileName, source]) => ({ fileName, source })));
    assert(compiled.ok, `imported shapes refused: ${compiled.ok ? "" : diagnosticsText(compiled.diagnostics)}`);
    assert(compiled.modules.length === 1 && compiled.modules[0]!.authored === "snapback/ops.q",
      "shape-only modules created phantom API modules");
    await withProject(files, async (root) => {
      const lowered = await lowerProject(root);
      assert(lowered.ok, `cross-file/repeated shapes did not lower: ${lowered.ok ? "" : diagnosticsText(lowered.diagnostics)}`);
      assert(lowered.project.programs.length === 2 && !lowered.apiDts.includes('readonly cards:'),
        "shape-only modules generated API operations");
      assert(compiled.modules[0]!.lineMap.some((site) => site?.file === "snapback/cards.q"),
        "imported reads lost their definition source sites");
      assert(rustCheck([operation(lowered.project.programs, "ops.page")], "synthetic", lowered.project.schema)[0]?.certificate?.result_pages,
        "imported page projection lost cursor provenance");
      const checked = rustCheck(lowered.project.programs, "synthetic", lowered.project.schema);
      assert(checked.every((item) => !item.error), `imported shapes did not certify: ${JSON.stringify(checked)}`);
      const store = new ClientStore(lowered.project.schema, {
        rows: [
          { table: "profiles", id: "one", row: { Row: {
            id: { Id: "one" }, displayName: { String: "Alice" }, handle: { String: "alice" }, friend: { Id: "two" },
          } } },
          { table: "profiles", id: "two", row: { Row: {
            id: { Id: "two" }, displayName: { String: "Bob" }, handle: { String: "bob" },
          } } },
        ], ranges: [], absences: [], verdicts: [],
      });
      const actual = store.reexecute(operation(lowered.project.programs, "ops.pair"), {
        viewer: "actual-viewer", principal_kind: "user", auth_epoch: 1,
        args: { id: { Id: "one" }, viewer: { Id: "argument-viewer" } }, now: 1, new_ids: [], read_time: 1,
      }).execution.result;
      const projected = { Row: {
        current: { Id: "actual-viewer" }, displayName: { String: "Alice" }, friend: { Row: { displayName: { String: "Bob" } } },
      } };
      assert(JSON.stringify(actual) === JSON.stringify({ Row: { first: projected, second: projected } }),
        `imported shapes captured a caller binding/shape or reused a temporary: ${JSON.stringify(actual)}`);
    });
  });

  test("Quarry imported-shape lowering refusals rewrite the definition and identify its caller", async () => {
    await withProject({
      "snapback/schema.q": "table accounts:\n  amount: money USD\n  public\n",
      "snapback/cards.q": "shape card = { total: .amount + 0.001 }\n",
      "snapback/ops.q": "shape card from cards\nquery one(id: accounts):\n  return accounts[id] card\n",
    }, async (root) => {
      const result = await lowerProject(root);
      const refusal = !result.ok && result.diagnostics.find((item) => item.code === "E_DECIMAL_SCALE");
      assert(refusal && refusal.site === "snapback/cards.q:1:16"
        && refusal.rewrite.startsWith("shape card = { total: .amount + 0.001 }")
        && refusal.message.includes("used at snapback/ops.q:3:"),
      `lowering refusal did not point to the imported source: ${JSON.stringify(result)}`);
    });
  });

  test("Quarry shape imports refuse missing declarations, cycles, captures, and expansion blowups", () => {
    const schema = "table profiles:\n  displayName: text <=80\n  public\n";
    const compile = (files: Record<string, string>) => compileInline([
      { fileName: "snapback/schema.q", source: schema },
      ...Object.entries(files).map(([fileName, source]) => ({ fileName, source })),
    ]);
    const cases: Array<[string, Record<string, string>, string]> = [
      ["missing module", { "snapback/ops.q": "shape card from missing\n" }, "unknown shape module missing"],
      ["missing export", { "snapback/cards.q": "shape other = { displayName }\n", "snapback/ops.q": "shape card from cards\n" }, "unknown shape card"],
      ["duplicate import", { "snapback/cards.q": "shape card = { displayName }\n", "snapback/ops.q": "shape card from cards\nshape card = { displayName }\n" }, "duplicate shape card"],
      ["import cycle", { "snapback/a.q": "shape card from b\n", "snapback/b.q": "shape card from a\n" }, "shape import cycle"],
      ["projection cycle", { "snapback/a.q": "shape b from b\nshape a = { ...b }\n", "snapback/b.q": "shape a from a\nshape b = { ...a }\n" }, "shape cycle"],
      ["direct capture", { "snapback/cards.q": "shape card = { label: argument }\n", "snapback/ops.q": "shape card from cards\nquery one(id: profiles, argument: text <=80):\n  return profiles[id] card\n" }, "cannot capture operation name argument"],
      ["object shorthand capture", { "snapback/cards.q": "shape card = { nested: { argument } }\n" }, "cannot capture operation name argument"],
      ["nonimported use", { "snapback/cards.q": "shape card = { displayName }\n", "snapback/ops.q": "query one(id: profiles):\n  return profiles[id] card\n" }, "unknown shape card in snapback/ops.q"],
    ];
    for (const [label, files, message] of cases) {
      const result = compile(files);
      assert(!result.ok && result.diagnostics.some((item) => item.message.includes(message)
        && item.site.startsWith("snapback/") && item.rewrite.length > 10 && item.guide.startsWith("quarry/")),
        `${label} was not a sited actionable refusal: ${JSON.stringify(result)}`);
    }
    for (const leaf of ["displayName", ""]) {
      const declarations = Array.from({ length: 7 }, (_, level) =>
        `shape s${level} = { ${level === 6 ? leaf : Array.from({ length: 8 }, () => `...s${level + 1}`).join(", ")} }`).join("\n");
      const result = compile({ "snapback/cards.q": `${declarations}\n` });
      assert(!result.ok && result.diagnostics.some((item) => item.message.includes("4096 syntax nodes")),
        `wide ${leaf ? "field" : "empty"} expansion escaped its budget: ${JSON.stringify(result)}`);
    }
    const mismatch = compile({
      "snapback/cards.q": "shape card = { missing }\n",
      "snapback/ops.q": "shape card from cards\nquery one(id: profiles):\n  return profiles[id] card\n",
    });
    assert(!mismatch.ok && mismatch.diagnostics.some((item) => item.site === "snapback/cards.q:1:16"
      && item.message.includes("used at snapback/ops.q:3:")),
      `cross-file field refusal lost the definition or use site: ${JSON.stringify(mismatch)}`);
    const inferredContext = compileInline([
      { fileName: "snapback/schema.q", source: "table profiles:\n  principal: principal\n  unique byPrincipal: principal\n  public\n" },
      { fileName: "snapback/cards.q", source: "shape card = { current: profiles[viewer] { principal } }\n" },
      { fileName: "snapback/ops.q", source: "shape card from cards\nquery one(id: profiles, viewer: text <=80):\n  return profiles[id] card\n" },
    ]);
    assert(inferredContext.ok && inferredContext.modules[0]!.source.includes('db.get(profiles$table.byPrincipal, [ctx.viewer])'),
      `shape context inference captured the caller argument type: ${JSON.stringify(inferredContext)}`);
  });

  test("image once is column custody, carries through lowering, and video refuses with a range repair", async () => {
    await withProject({ "snapback/schema.q": `table photos:
  photo: image <=10000000 once ?
  gallery: [image <=10000000 once] <=4
  read <- public
  insert <- allow
`, "snapback/photos.q": `mutation put(photo: image <=10000000):
  return insert photos { photo, gallery: [] }
` }, async root => {
      const result = await lowerProject(root);
      assert(result.ok, JSON.stringify(result));
      const table = (result.project.schema.tables as any).photos;
      assert(table.columns.photo.Optional.Image.once === true, JSON.stringify(table));
      assert(table.columns.gallery.List.of.Image.once === true, JSON.stringify(table));
      assert(!("once" in (result.project.programs[0]!.args.photo as any).Image), "argument acquired column custody");
      assert(rustCheck(result.project.programs, "synthetic", result.project.schema).every(item => !item.error), "once image did not certify");
    });
    const parsed = parseDocument("snapback/schema.q", "table photos:\n  clip: video <=10000000 once\n  read <- public\n");
    assert(parsed.diagnostics.some(item => /ranges.*unspecified/.test(item.message) && /image.*once/.test(item.rewrite)), JSON.stringify(parsed));
  });

  test("Quarry accepts word writes and refuses every write sigil with the word forms", () => {
    const sigils = ["+", "~", ["+", "~"].join(""), "-"];
    const forms = [
      `${sigils[0]}items { value: 1 }`,
      `${sigils[1]}items[id] { value: 2 }`,
      `${sigils[2]}items[id] { value: 3 }`,
      `${sigils[3]}items[id]`,
    ];
    const parsed = parseDocument("snapback/ops.q", `mutation oldWrites(id: items):\n${forms.map((form) => `  ${form}`).join("\n")}\n`);
    const refusals = parsed.diagnostics.filter((item) => item.code === "E_QUARRY_SYNTAX" && item.message.startsWith("write sigils"));
    assert(refusals.length === 4, `write sigils did not each refuse: ${JSON.stringify(parsed.diagnostics)}`);
    for (const refusal of refusals) {
      assert(["insert", "update", "upsert", "delete"].every((word) => refusal.message.includes(word)),
        `write-sigil refusal did not name all four words: ${refusal.message}`);
      assert(!/[~+-].*items/.test(refusal.rewrite), `write-sigil refusal pasted a compatibility rewrite: ${refusal.rewrite}`);
    }
  });

  test("Quarry image/video spellings lower as closed records through IR, manifest descriptors, and API types", async () => {
    const projectRoot = resolve(fixtures, "quarry-assets");
    const compiled = compileFixture(fixtures, "quarry-assets", ["schema", "assets"]);
    assert(compiled.ok, `asset spellings did not parse: ${compiled.ok ? "" : diagnosticsText(compiled.diagnostics)}`);
    const generated = `${compiled.schema.source}\n${compiled.modules[0]!.source}`;
    for (const spelling of [
      "t.image(5000000)", "t.optional(t.image(5000000))", "t.video(50000000)", "t.optional(t.video(50000000))",
      "t.list(t.image(12000000), { max: 4 })", "t.list(t.video(50000000), { max: 2 })",
      "args.clip.duration", "args.photo.width",
    ]) assert(generated.includes(spelling), `asset Quarry lowering lost ${spelling}:\n${generated}`);

    const lowered = await lowerProject(projectRoot);
      assert(lowered.ok, `asset project refused: ${lowered.ok ? "" : diagnosticsText(lowered.diagnostics)}`);
      const columns = (lowered.project.schema.tables.media as any).columns;
      assert(JSON.stringify(columns.photo) === JSON.stringify({ Image: { max: 5_000_000 } })
        && JSON.stringify(columns.avatar) === JSON.stringify({ Optional: { Image: { max: 5_000_000 } } })
        && JSON.stringify(columns.clip) === JSON.stringify({ Video: { max: 50_000_000 } })
        && JSON.stringify(columns.trailer) === JSON.stringify({ Optional: { Video: { max: 50_000_000 } } })
        && JSON.stringify(columns.gallery) === JSON.stringify({ List: { of: { Image: { max: 12_000_000 } }, max: 4 } })
        && JSON.stringify(columns.albums) === JSON.stringify({ Optional: { List: { of: { Image: { max: 12_000_000 } }, max: 4 } } })
        && JSON.stringify(columns.reels) === JSON.stringify({ List: { of: { Video: { max: 50_000_000 } }, max: 2 } }),
      `asset columns did not use the exact externally tagged JSON: ${JSON.stringify(columns)}`);
      const inspect = operation(lowered.project.programs, "assets.inspect");
      const args = inspect.args as any;
      assert(JSON.stringify(args.photo) === JSON.stringify({ Image: { max: 5_000_000 } })
        && JSON.stringify(args.clip) === JSON.stringify({ Video: { max: 50_000_000 } }),
      `asset operation/manifest descriptors changed: ${JSON.stringify(inspect.args)}`);
      const allArgs = operation(lowered.project.programs, "assets.acceptAll").args as any;
      assert(JSON.stringify(allArgs.avatar) === JSON.stringify({ Optional: { Image: { max: 5_000_000 } } })
        && JSON.stringify(allArgs.trailer) === JSON.stringify({ Optional: { Video: { max: 50_000_000 } } })
        && JSON.stringify(allArgs.gallery) === JSON.stringify({ List: { of: { Image: { max: 12_000_000 } }, max: 4 } })
        && JSON.stringify(allArgs.albums) === JSON.stringify({ Optional: { List: { of: { Image: { max: 12_000_000 } }, max: 4 } } })
        && JSON.stringify(allArgs.reels) === JSON.stringify({ List: { of: { Video: { max: 50_000_000 } }, max: 2 } }),
      `nested asset operation/manifest descriptors changed: ${JSON.stringify(allArgs)}`);
      const body = JSON.stringify(inspect.body);
      assert(body.includes('"Field":{"base":{"Variable":"clip"},"name":"duration"}')
        && body.includes('"Field":{"base":{"Variable":"photo"},"name":"width"}'),
      `asset member selection did not lower to ordinary Field IR: ${body}`);
      assert(lowered.apiDts.includes("photo: File | ImageAsset")
        && lowered.apiDts.includes("avatar?: File | ImageAsset | null")
        && lowered.apiDts.includes("clip: File | VideoAsset")
        && lowered.apiDts.includes("trailer?: File | VideoAsset | null")
        && lowered.apiDts.includes("gallery: (File | ImageAsset)[]")
        && lowered.apiDts.includes("albums?: (File | ImageAsset)[] | null")
        && lowered.apiDts.includes("reels: (File | VideoAsset)[]"),
      `mutation API args lost recursive File unions:\n${lowered.apiDts}`);
      const query = lowered.apiDts.match(/readonly echo: Op<([^\n]+)>;/)?.[1] ?? "";
      assert(query.includes("photo: ImageAsset") && query.includes("clip: VideoAsset") && !query.includes("File"),
        `query args/results admitted File or lost asset records: ${query}`);
      const mutation = lowered.apiDts.match(/readonly inspect: Op<([^\n]+)>;/)?.[1] ?? "";
      const resultStart = mutation.indexOf("}, {");
      const result = mutation.slice(resultStart);
      assert(resultStart > 0 && !result.includes("File")
        && result.includes("photo: ImageAsset") && result.includes("clip: VideoAsset"),
      `mutation result did not remain asset-record-only: ${mutation}`);

      const nested = lowered.apiDts.match(/readonly echoNested: Op<([^\n]+)>;/)?.[1] ?? "";
      assert(nested.includes("albums?: ImageAsset[] | null")
        && nested.includes("{ albums: ImageAsset[] | undefined }"),
      `optional(list(asset)) did not survive query args/results: ${nested}`);

      await withProject({
        "snapback2.d.ts": readFileSync(resolve(frontend, "lib.d.ts"), "utf8"),
        "client.d.ts": `declare module "snapback2/client" {
          export interface Op<Args, Result> { readonly __args?: (args: Args) => void; readonly __result?: Result }
          export interface Channel<Args, Payload = unknown> { readonly __args?: Args; readonly __payload?: Payload }
          export interface Api {}
        }`,
        "api.d.ts": lowered.apiDts,
        "asset-declarations.ts": `import type { ImageAsset, VideoAsset } from "snapback2";
          import type { Api, Op } from "snapback2/client";
          type ResultOf<T> = T extends Op<any, infer Result> ? Result : never;
          type Echo = ResultOf<Api["assets"]["echo"]>;
          declare const echo: Echo;
          declare const image: ImageAsset;
          declare const anotherImage: ImageAsset;
          declare const video: VideoAsset;
          const sameKind: ImageAsset = anotherImage;
          const fromQueryResult: ImageAsset = echo.photo;
          const runtimeJsonShape: { id: string; width: number; height: number } = echo.photo;
          // @ts-expect-error VideoAsset is nominally distinct from ImageAsset despite its superset shape.
          const videoAsImage: ImageAsset = video;
          // @ts-expect-error ImageAsset is nominally distinct from VideoAsset.
          const imageAsVideo: VideoAsset = image;
          // @ts-expect-error A literal object cannot forge the phantom image brand.
          const forged: ImageAsset = { id: "asset-1", width: 1, height: 1 };
          void [sameKind, fromQueryResult, runtimeJsonShape, videoAsImage, imageAsVideo, forged];`,
      }, async (root) => {
        const sample = resolve(root, "asset-declarations.ts");
        const program = ts.createProgram({
          rootNames: [
            resolve(root, "snapback2.d.ts"),
            resolve(root, "client.d.ts"),
            resolve(root, "api.d.ts"),
            sample,
          ],
          options: {
            lib: ["lib.es2022.d.ts", "lib.dom.d.ts"],
            module: ts.ModuleKind.ESNext,
            moduleResolution: ts.ModuleResolutionKind.Bundler,
            noEmit: true,
            strict: true,
            target: ts.ScriptTarget.ES2022,
          },
        });
        const diagnostics = ts.getPreEmitDiagnostics(program)
          .filter((item) => item.file?.fileName === sample || item.file?.fileName === resolve(root, "api.d.ts"));
        assert(diagnostics.length === 0,
          `asset nominal declaration proof failed:\n${diagnostics.map((item) => ts.flattenDiagnosticMessageText(item.messageText, "\n")).join("\n")}`);
      });
  });

  test("asset IR rustCheck round trip — SKIP while lane A rejects Image", async () => {
    const lowered = await lowerProject(resolve(fixtures, "quarry-assets"));
    assert(lowered.ok, `asset project refused before rustCheck: ${lowered.ok ? "" : diagnosticsText(lowered.diagnostics)}`);
    const failures = rustCheck(lowered.project.programs, "synthetic", lowered.project.schema)
      .filter((item) => item.error);
    const laneABlocked = failures.some((item) => item.error?.code === "E_CHECK_IR_UNSUPPORTED"
      && item.error.message.includes("unknown variant `Image`"));
    if (laneABlocked) {
      assert(failures.every((item) => item.error?.code === "E_CHECK_IR_UNSUPPORTED"
        && /unknown variant `(Image|Video)`/.test(item.error.message)),
      `asset IR rustCheck skip encountered a non-lane-A failure: ${JSON.stringify(failures)}`);
      return;
    }
    assert(failures.length === 0, `asset IR did not round-trip through rustCheck: ${JSON.stringify(failures)}`);
  });

  test("asset index and maintain.by matrices refuse scalar, video, optional, and list forms", async () => {
    await withProject({
      "snapback/schema.q": `table media:
  photo: image <=5000000
  avatar: image <=5000000 ?
  gallery: [image <=5000000] <=4
  clip: video <=50000000
  unique photo
  by avatar
  by gallery
  by clip
  public
`,
      "snapback/media.q": "query one():\n  return null\n",
    }, async (root) => {
      const result = await lowerProject(root);
      const refusals = result.ok ? [] : result.diagnostics.filter((item) => item.code === "E_SCHEMA_INDEX_COLUMN");
      assert(refusals.length === 4 && refusals.every((item) => item.family === "schema")
        && ["photo", "avatar", "gallery", "clip"].every((field) => refusals.some((item) => item.message.includes(`column ${field}`))),
      `asset index matrix did not return four E_SCHEMA_INDEX_COLUMN refusals: ${JSON.stringify(result)}`);
    });

    await withProject({
      "snapback/schema.q": `table events:
  photo: image <=5000000
  public

maintain totals = count events by photo:
  read <- public
`,
      "snapback/events.q": "query one():\n  return null\n",
    }, async (root) => {
      const result = await lowerProject(root);
      const refusal = result.ok ? undefined : result.diagnostics.find((item) => item.code === "E_SCHEMA_ASSET_MAINTAIN");
      assert(!result.ok && result.diagnostics.length === 1 && refusal?.family === "schema"
        && refusal.message.includes("events.photo") && refusal.site.startsWith("snapback/schema.q:"),
      `asset maintain.by did not return one source-sited E_SCHEMA_ASSET_MAINTAIN: ${JSON.stringify(result)}`);
    });

    await withProject({
      "snapback/schema.q": `table events:
  avatar: image <=5000000 ?
  gallery: [image <=5000000] <=4
  clip: video <=50000000
  public

maintain avatarTotals = count events by avatar:
  read <- public

maintain galleryTotals = count events by gallery:
  read <- public

maintain clipTotals = count events by clip:
  read <- public
`,
      "snapback/events.q": "query one():\n  return null\n",
    }, async (root) => {
      const result = await lowerProject(root);
      const refusals = result.ok ? [] : result.diagnostics.filter((item) => item.code === "E_SCHEMA_ASSET_MAINTAIN");
      assert(!result.ok && result.diagnostics.length === 3 && refusals.length === 3
        && ["events.avatar", "events.gallery", "events.clip"].every((field) => refusals.some((item) => item.message.includes(field))),
      `asset maintain.by nested/video matrix did not return only dedicated refusals: ${JSON.stringify(result)}`);
    });
  });

  test("Quarry recursively rejects image/video assignment mismatches and literal record forges", () => {
    const schema = `table media:
  images: [image <=5000000] <=4
  videos: [video <=50000000] <=4
  optionalImages: [image <=5000000] <=4 ?
  nestedImages: [[image <=5000000] <=4] <=3
  photo: image <=5000000
  optionalPhoto: image <=5000000 ?
  public
`;
    const cases = [
      ["scalar-video-to-image", "clip: video <=50000000", "photo: clip", "photo", "image asset", "video asset"],
      ["list-video-to-image", "videos: [video <=50000000] <=4", "images: videos", "images", "image asset", "video asset"],
      ["list-image-to-video", "images: [image <=5000000] <=4", "videos: images", "videos", "video asset", "image asset"],
      ["optional-list", "videos: [video <=50000000] <=4 ?", "optionalImages: videos", "optionalImages", "image asset", "video asset"],
      ["nested-list", "videos: [[video <=50000000] <=4] <=3", "nestedImages: videos", "nestedImages", "image asset", "video asset"],
      ["list-to-scalar", "photos: [image <=5000000] <=4", "photo: photos", "photo", "image asset", "[image asset]"],
      ["scalar-to-list", "photo: image <=5000000", "images: photo", "images", "[image asset]", "image asset"],
      ["shallow-to-nested", "photos: [image <=5000000] <=4", "nestedImages: photos", "nestedImages", "[[image asset]]", "[image asset]"],
      ["nested-to-shallow", "photos: [[image <=5000000] <=4] <=3", "images: photos", "images", "[image asset]", "[[image asset]]"],
      ["optional-to-required", "photo: image <=5000000 ?", "photo: photo", "photo", "image asset", "image asset or null"],
      ["optional-list-to-required", "photos: [image <=5000000] <=4 ?", "images: photos", "images", "[image asset]", "[image asset] or null"],
    ] as const;
    for (const [name, argument, assignment, field, expected, actual] of cases) {
      const result = compileInline([
        { fileName: "snapback/schema.q", source: schema },
        { fileName: "snapback/ops.q", source: `mutation ${name.replaceAll("-", "_")}(${argument}):\n  return insert media { ${assignment} }\n` },
      ]);
      const refusal = result.ok ? undefined : result.diagnostics.find((item) => item.code === "E_QUARRY_TYPE");
      assert(refusal?.family === "quarry" && refusal.site.startsWith("snapback/ops.q:2:")
        && refusal.message.includes(field) && refusal.message.includes(expected) && refusal.message.includes(actual)
        && refusal.rewrite.includes(`use a ${expected} value for ${field}`),
      `${name} lost its recursive kind refusal/rewrite: ${JSON.stringify(result)}`);
    }

    const accepted = compileInline([
      { fileName: "snapback/schema.q", source: schema },
      { fileName: "snapback/ops.q", source: `mutation accepted(photo: image <=5000000, photos: [image <=5000000] <=4):
  return insert media { images: [], optionalImages: photos, optionalPhoto: photo }

mutation nested_empty():
  return insert media { nestedImages: [[]] }

mutation empty_first(photos: [image <=5000000] <=4):
  return insert media { nestedImages: [[], photos] }

mutation empty_last(photos: [image <=5000000] <=4):
  return insert media { nestedImages: [photos, []] }
` },
    ]);
    assert(accepted.ok, `nested empty asset list or required-to-optional asset assignment refused: ${accepted.ok ? "" : JSON.stringify(accepted.diagnostics)}`);

    const scalarEmpty = compileInline([
      { fileName: "snapback/schema.q", source: schema },
      { fileName: "snapback/ops.q", source: "mutation scalar_empty():\n  return insert media { photo: [] }\n" },
    ]);
    assert(!scalarEmpty.ok && scalarEmpty.diagnostics.some((item) => item.code === "E_QUARRY_TYPE"
      && item.message.includes("photo requires image asset")),
    `empty list literal was accepted for scalar asset column: ${JSON.stringify(scalarEmpty)}`);

    const forge = compileInline([
      { fileName: "snapback/schema.q", source: schema },
      { fileName: "snapback/ops.q", source: "mutation forge():\n  return insert media { photo: { id: 'asset-1', width: 1, height: 1 } }\n" },
    ]);
    assert(!forge.ok && forge.diagnostics.some((item) => item.code === "E_QUARRY_TYPE"
      && item.message.includes("photo requires image asset")),
    `literal asset record forge did not remain E_QUARRY_TYPE: ${JSON.stringify(forge)}`);
  });

  test("the TypeScript lowering twin diagnoses missing asset fields and preserves descriptor/API shapes", async () => {
    const fixture = resolve(fixtures, "assets");
    const lowered = await lowerProject(fixture, { authoring: "any" });
    assert(lowered.ok, `TS-authored asset fixture refused: ${lowered.ok ? "" : diagnosticsText(lowered.diagnostics)}`);
    const columns = (lowered.project.schema.tables.media as any).columns;
    assert(JSON.stringify(columns.photo) === JSON.stringify({ Image: { max: 5_000_000 } })
      && JSON.stringify(columns.albums) === JSON.stringify({ Optional: { List: { of: { Image: { max: 12_000_000 } }, max: 4 } } }),
    `TS-authored asset descriptors changed: ${JSON.stringify(columns)}`);
    assert(lowered.apiDts.includes("photo: File | ImageAsset")
      && lowered.apiDts.includes("albums?: (File | ImageAsset)[] | null")
      && lowered.apiDts.includes("readonly echo: Op<{ photo: ImageAsset }, ImageAsset>")
      && lowered.apiDts.includes("{ photo: ImageAsset; width: number; clip: VideoAsset")
      && lowered.apiDts.includes("duration: number"),
    `TS-authored asset fixture lost File unions or result types:\n${lowered.apiDts}`);

    const invalidSource = readFileSync(resolve(fixture, "snapback/photo-duration.invalid.ts.fixture"), "utf8");
    const invalid = lowerSource(invalidSource, "snapback/photo-duration.ts");
    const refusal = invalid.ok ? undefined : invalid.diagnostics.find((item) => item.code === "E_ARGS_TYPE");
    assert(refusal?.message.includes("image asset has no field duration")
      && refusal.site.startsWith("snapback/photo-duration.ts:")
      && refusal.rewrite.includes("args.photo.width"),
    `TS twin returned unknown instead of a sited missing-field refusal: ${JSON.stringify(invalid)}`);
  });

  test("seed assets use E_SCHEMA_ASSET_SEED recursively while optional null remains allowed", async () => {
    await withProject({
      "snapback/schema.q": `table media:
  photo: image <=5000000
  clip: video <=50000000
  gallery: [image <=5000000] <=4
  reels: [video <=50000000] <=4 ?
  avatar: image <=5000000 ?
  public
`,
      "snapback/seed.ts": `import { seed } from "snapback2";
        export default seed({ personas: [], rows: { media: [{
          id: "media-1",
          photo: { id: "image-1", width: 10, height: 10 },
          clip: { id: "video-1", width: 10, height: 10, duration: 1000 },
          gallery: [{ id: "image-2", width: 10, height: 10 }],
          reels: [{ id: "video-2", width: 10, height: 10, duration: 1000 }],
          avatar: null,
        }] } });`,
    }, async (root) => {
      const result = await (await import("./project")).lowerSeed(root);
      const refusals = result.ok ? [] : result.diagnostics.filter((item) => item.code === "E_SCHEMA_ASSET_SEED");
      assert(!result.ok && result.diagnostics.length === 4 && refusals.length === 4
        && refusals.every((item) => item.family === "schema"
          && item.site.startsWith("snapback/seed.ts:")
          && item.message.includes("seeds cannot mint ledger rows")
          && item.rewrite === "upload through the app; seeds cannot mint ledger rows"),
      `seed assets did not use the dedicated recursive refusal/null exception: ${JSON.stringify(result)}`);
    });
  });

  test("asset records reject unknown fields with a typed Quarry rewrite and have no legacy URL compatibility", () => {
    const nullable = compileInline([
      { fileName: "snapback/schema.q", source: "table media:\n  photo: image <=5000000 ?\n  public\n" },
      { fileName: "snapback/media.q", source: "mutation clear():\n  return insert media { photo: null }\n" },
    ]);
    assert(nullable.ok, `optional asset column refused null: ${nullable.ok ? "" : diagnosticsText(nullable.diagnostics)}`);
    const unknown = compileInline([
      { fileName: "snapback/schema.q", source: "table media:\n  photo: image <=5000000\n  public\n" },
      { fileName: "snapback/media.q", source: "query bad(photo: image <=5000000):\n  return photo.duration\n" },
    ]);
    const refusal = unknown.ok ? undefined : unknown.diagnostics.find((item) => item.code === "E_QUARRY_TYPE");
    assert(refusal?.message.includes("image asset has no field duration") && refusal.rewrite?.includes("photo.width"),
      `unknown asset field lost its typed rewrite: ${JSON.stringify(unknown)}`);

    const useAssets = parseDocument("snapback/schema.q", "use assets\n");
    assert(useAssets.diagnostics.length === 1 && useAssets.diagnostics[0]?.code === "E_QUARRY_UNSUPPORTED"
      && !/url/i.test(`${useAssets.diagnostics[0]?.message} ${useAssets.diagnostics[0]?.rewrite}`),
    `use assets did not stay on the generic non-URL refusal path: ${JSON.stringify(useAssets.diagnostics)}`);
    for (const source of ["use assets\n", "table media:\n  photo: asset <=5000000\n  public\n"]) {
      const legacy = parseDocument("snapback/schema.q", source);
      assert(legacy.diagnostics.length > 0 && legacy.diagnostics.every((item) => !/url/i.test(`${item.message} ${item.rewrite}`)),
        `legacy asset spelling retained URL compatibility advice: ${JSON.stringify(legacy.diagnostics)}`);
    }
    for (const source of [
      "table media:\n  photo: image <=1.5\n  public\n",
      "table media:\n  clip: video <=0\n  public\n",
      "table media:\n  photo: image <=4294967296\n  public\n",
    ]) {
      const invalid = compileInline([{ fileName: "snapback/schema.q", source }]);
      assert(!invalid.ok && invalid.diagnostics.some((item) => /integer literal|positive integers/.test(item.message)),
        `non-integer/non-positive asset bound compiled: ${JSON.stringify(invalid)}`);
    }
  });

  test("Quarry money and decimal spellings preserve scale through IR and API types", async () => {
    const lowered = await lowerProject(resolve(fixtures, "quarry-money"));
    assert(lowered.ok, `quarry-money refused: ${lowered.ok ? "" : diagnosticsText(lowered.diagnostics)}`);
    const schema = JSON.stringify(lowered.project.schema);
    assert(schema.includes('"Money":{"currency":"USD","scale":2}')
      && schema.includes('"Decimal":{"scale":3}'), `Quarry descriptors changed: ${schema}`);
    const add = JSON.stringify(operation(lowered.project.programs, "money.add"));
    assert(add.includes('"Int":250') && add.includes('"Int":1000'),
      `whole-unit Quarry literals did not lower to minor units: ${add}`);
    assert(add.includes('"op":"Add"') && add.includes('"op":"Sub"')
      && add.includes('"op":"Mul"') && add.includes('"builtin":"Min"'),
      `matching money/decimal arithmetic did not reach IR: ${add}`);
    assert(lowered.apiDts.includes('price: Money<"USD", 2>')
      && lowered.apiDts.includes("rate: Decimal<3>")
      && lowered.apiDts.includes('yen?: Money<"JPY", 0>')
      && lowered.apiDts.includes('/** money USD 2 — minor units */ amount: number')
      && lowered.apiDts.includes('/** decimal 3 — minor units */ rate: number'),
    `Quarry branded API types are missing:\n${lowered.apiDts}`);
    const failures = rustCheck(lowered.project.programs, "synthetic", lowered.project.schema).filter((item) => item.error);
    assert(failures.length === 0, `quarry-money did not certify: ${JSON.stringify(failures)}`);

    const compiled = compileFixture(fixtures, "quarry-money", ["schema", "money"]);
    assert(compiled.ok, `quarry-money front end refused: ${compiled.ok ? "" : diagnosticsText(compiled.diagnostics)}`);
    const generated = `${compiled.schema.source}\n${compiled.modules[0]!.source}`;
    assert(generated.includes('t.money("USD")') && generated.includes('t.money("JPY", 0)')
      && generated.includes("t.decimal(3)")
      && generated.includes("price: 2.50") && generated.includes("+ 1.000"),
    `Quarry lowering lost a descriptor or authored literal spelling:\n${generated}`);
  });

  test("Quarry money and decimal refusals are nominal, exact-scale, and sited", async () => {
    const schema = `table values:
  cents: decimal 2
  mills: decimal 3
  amount: money USD
  count: int
  public
  insert <- public
`;
    await withProject({
      "snapback/schema.q": schema,
      "snapback/mixed.q": "query mixed(id: values):\n  row = values[id]! else MISSING\n  return row.cents + row.mills\n",
    }, async (root) => {
      const result = await lowerProject(root);
      assert(!result.ok, "mixed Quarry Decimal scales compiled");
      const refusal = result.diagnostics.find((item) => item.code === "E_DECIMAL_SCALE");
      assert(refusal, `mixed-scale refusal was not E_DECIMAL_SCALE: ${JSON.stringify(result)}`);
      assert(refusal.site.startsWith("snapback/mixed.q:") && !refusal.site.includes(".ts:"),
        `mixed-scale refusal did not map to Quarry: ${JSON.stringify(result)}`);
      assert(refusal.rewrite.includes("row.cents + row.mills") && refusal.rewrite.includes("--"),
        `mixed-scale refusal lost its Quarry rewrite: ${refusal.rewrite}`);
    });

    await withProject({
      "snapback/schema.q": schema,
      "snapback/literal.q": "mutation bad():\n  return insert values { cents: 1.234, mills: 1.000, amount: 2.50, count: 1 }\n",
    }, async (root) => {
      const result = await lowerProject(root);
      assert(!result.ok, "over-precise Quarry Decimal literal compiled");
      const refusal = result.diagnostics.find((item) => item.code === "E_DECIMAL_SCALE");
      assert(refusal?.site.startsWith("snapback/literal.q:")
        && refusal.rewrite.includes("cents: 1.234") && refusal.rewrite.includes("--"),
      `literal scale refusal lost its Quarry site/rewrite: ${JSON.stringify(result)}`);
    });

    const nominal = compileInline([
      { fileName: "snapback/schema.q", source: schema },
      { fileName: "snapback/nominal.q", source: "query bad(amount: money USD, count: int):\n  return amount = count\n" },
    ]);
    assert(!nominal.ok && nominal.diagnostics.some((item) => item.code === "E_QUARRY_TYPE"
      && item.message.includes("money USD 2") && item.message.includes("int")),
    `int/money comparison lost its nominal refusal: ${JSON.stringify(nominal)}`);

    const fractionalInt = compileInline([
      { fileName: "snapback/schema.q", source: schema },
      { fileName: "snapback/int.q", source: "mutation bad():\n  return insert values { cents: 1.00, mills: 1.000, amount: 2, count: 2.50 }\n" },
    ]);
    assert(!fractionalInt.ok && fractionalInt.diagnostics.some((item) => item.code === "E_QUARRY_TYPE"
      && item.message === "int positions take integer literals"),
    `decimal literal entered an int position: ${JSON.stringify(fractionalInt)}`);

    for (const operator of ["/", "%"]) {
      const result = compileInline([
        { fileName: "snapback/schema.q", source: schema },
        { fileName: "snapback/divmod.q", source: `query bad(left: money USD, right: money USD):\n  return left ${operator} right\n` },
      ]);
      assert(!result.ok && result.diagnostics.some((item) => item.code === "E_QUARRY_TYPE"
        && item.message.includes(`does not admit ${operator}`)),
      `Quarry admitted money ${operator}: ${JSON.stringify(result)}`);
    }

    const syntax = compileInline([{ fileName: "snapback/schema.q", source: "table invalid:\n  lower: money usd\n  huge: decimal 19\n  public\n" }]);
    assert(!syntax.ok && syntax.diagnostics.filter((item) => item.code === "E_QUARRY_SYNTAX").length === 2,
      `money currency/decimal scale syntax did not report both refusals: ${JSON.stringify(syntax)}`);
  });

  test("Quarry composite unique-key writes lower through row identity and certify", async () => {
    const compiled = compileFixture(fixtures, "quarry-surface", ["schema", "surface"]);
    assert(compiled.ok, `composite write front end refused: ${compiled.ok ? "" : diagnosticsText(compiled.diagnostics)}`);
    const source = compiled.modules[0]!.source;
    const update = generatedOperation(source, "updateKeyedRow");
    const upsert = generatedOperation(source, "upsertKeyedRow");
    const authored = generatedOperation(source, "upsertKeyedRowWithId");
    const remove = generatedOperation(source, "deleteKeyedRow");
    const updateKeys = writeKeyNames(update);
    const upsertKeys = writeKeyNames(upsert);
    assert(updateKeys && update.includes(`db.get(keyedRows$table.byOwnerLabel, [${updateKeys[0]}, ${updateKeys[1]}])`)
      && update.includes('db.require(__q_writeRow_')
      && update.includes("db.update(keyedRows$table, __q_writeRow_")
      && update.includes("{ value: args.value }")
      && occurrences(update, "args.owner") === 1 && occurrences(update, "args.label") === 1,
    `composite update did not bind its address once, elide same-key fields, and write by row id:\n${update}`);
    assert(upsertKeys && upsert.includes(`db.get(keyedRows$table.byOwnerLabel, [${upsertKeys[0]}, ${upsertKeys[1]}])`)
      && upsert.includes("?.id ?? ctx.newId()")
      && upsert.includes("db.upsert(keyedRows$table, __q_upsertKey_")
      && upsert.includes(`owner: ${upsertKeys[0]}, label: ${upsertKeys[1]}`)
      && occurrences(upsert, "args.owner") === 1 && occurrences(upsert, "args.label") === 1,
    `composite upsert did not bind/inject its key columns into the platform scalar db.upsert row:\n${upsert}`);
    assert(authored.includes("?.id ?? ctx.newId()")
      && authored.includes("db.upsert(keyedRows$table, __q_upsertKey_")
      && !authored.includes("UPSERT_ID_"),
    `migrated alternate upsert did not keep the present id or mint on absence:\n${authored}`);
    assert(remove.includes("db.get(keyedRows$table.byOwnerLabel, [__q_writeKey1_")
      && remove.includes('db.require(__q_writeRow_')
      && remove.includes("db.delete(keyedRows$table, __q_writeRow_"),
    `composite delete did not resolve and write by row id:\n${remove}`);
    for (const line of source.split("\n").filter((line) => line.includes("__q_writeRow_") || line.includes("__q_upsertKey_") || line.includes("__q_writeKey"))) {
      assert(/\/\/ q:snapback\/surface\.q:\d+:\d+$/.test(line), `generated indexed-write statement lost its .q site: ${line}`);
    }

    const lowered = await lowerProject(resolve(fixtures, "quarry-surface"));
    assert(lowered.ok, `composite write project refused: ${lowered.ok ? "" : diagnosticsText(lowered.diagnostics)}`);
    const names = [
      "surface.updateKeyedRow", "surface.upsertKeyedRow", "surface.upsertKeyedRowWithId",
      "surface.deleteKeyedRow", "surface.updateKeyedRowById", "surface.deleteKeyedRowById",
    ];
    const failures = rustCheck(names.map((name) => operation(lowered.project.programs, name)), "synthetic", lowered.project.schema)
      .filter((item) => item.error);
    assert(failures.length === 0, `composite writes did not certify: ${JSON.stringify(failures)}`);
  });

  test("Quarry addressed key columns refuse disagreement and paste drop-field rewrites", async () => {
    const schema = "table keyedRows:\n  owner: principal\n  label: text <=40\n  value: int\n  unique owner, label\n  public\n";
    const badUpsert = "upsert keyedRows[owner, label] { owner: viewer, label, value }";
    const badUpdate = "update keyedRows[owner, label] { owner, label: 'other', value }";
    const operations = `mutation upsertMismatch(owner: principal, label: text <=40, value: int):
  ${badUpsert}

mutation updateMismatch(owner: principal, label: text <=40, value: int):
  ${badUpdate}
`;
    const refused = compileInline([
      { fileName: "snapback/schema.q", source: schema },
      { fileName: "snapback/ops.q", source: operations },
    ]);
    assert(!refused.ok, "disagreeing addressed key fields compiled");
    const diagnostics = refused.diagnostics.filter((item) => item.code === "E_QUARRY_TYPE");
    assert(diagnostics.length === 2, `addressed-key check did not report both failures: ${JSON.stringify(refused)}`);
    const upsert = diagnostics.find((item) => item.message.startsWith("upsert may not"));
    const update = diagnostics.find((item) => item.message.startsWith("update may not"));
    assert(upsert?.family === "quarry" && upsert.site === "snapback/ops.q:2:36"
      && upsert.rewrite === "-- upsert keyedRows[owner, label] { label, value }" && upsert.guide === "quarry/types",
    `upsert mismatch lost its code/family/field site/drop-field rewrite/guide: ${JSON.stringify(upsert)}`);
    assert(update?.family === "quarry" && update.site === "snapback/ops.q:5:43"
      && update.rewrite === "-- update keyedRows[owner, label] { owner, value }" && update.guide === "quarry/types",
    `update mismatch lost its code/family/field site/drop-field rewrite/guide: ${JSON.stringify(update)}`);

    const repaired = operations
      .replace(badUpsert, upsert.rewrite.slice(3))
      .replace(badUpdate, update.rewrite.slice(3));
    await withProject({ "snapback/schema.q": schema, "snapback/ops.q": repaired }, async (root) => {
      const lowered = await lowerProject(root);
      assert(lowered.ok, `addressed-key rewrites did not paste/lower: ${lowered.ok ? "" : diagnosticsText(lowered.diagnostics)}`);
      const failures = rustCheck(lowered.project.programs, "synthetic", lowered.project.schema).filter((item) => item.error);
      assert(failures.length === 0, `addressed-key rewrites did not certify: ${JSON.stringify(failures)}`);
    });
  });

  test("Quarry upsert rows refuse every authored id with a drop-field rewrite", async () => {
    const schema = "table keyedRows:\n  owner: principal\n  label: text <=40\n  value: int\n  unique owner, label\n  read <- allow\n  insert <- allow\n  update <- allow\n  delete <- allow\n";
    const module = "mutation bump(owner: principal, label: text <=40, value: int):\n  upsert keyedRows[owner, label] { id: new, value }\n  return true\n";
    const compiled = compileInline([
      { fileName: "snapback/schema.q", source: schema },
      { fileName: "snapback/keyed.q", source: module },
    ]);
    assert(!compiled.ok, "id: new upsert compiled");
    const diagnostic = compiled.diagnostics.find((item) => item.code === "E_QUARRY_TYPE");
    assert(diagnostic?.site === "snapback/keyed.q:2:36"
      && diagnostic.message.includes("upsert rows may not name id")
      && diagnostic.rewrite === "-- upsert keyedRows[owner, label] { value }",
    `authored upsert id lost its field site and drop-field rewrite: ${JSON.stringify(compiled)}`);
    const repaired = module.replace("upsert keyedRows[owner, label] { id: new, value }", diagnostic!.rewrite.slice(3));
    const fixed = compileInline([
      { fileName: "snapback/schema.q", source: schema },
      { fileName: "snapback/keyed.q", source: repaired },
    ]);
    assert(fixed.ok && fixed.modules[0]!.source.includes("?.id ?? ctx.newId()"),
      `drop-field rewrite did not restore the absent insert branch: ${JSON.stringify(fixed)}`);
  });

  test("Quarry Clique M1-M3 plus Pay regression fixture lowers and certifies all 38 operations", async () => {
    const lowered = await lowerProject(resolve(fixtures, "quarry-clique"));
    assert(lowered.ok, `Quarry Clique refused: ${lowered.ok ? "" : diagnosticsText(lowered.diagnostics)}`);
    assert(lowered.project.programs.length === 38,
      `Quarry Clique program count changed to ${lowered.project.programs.length}`);
    assert(JSON.stringify(lowered.project.programs.map((program) => program.name).sort()) === JSON.stringify([
      "chat.addMember", "chat.chatThread", "chat.convMembers",
      "chat.conversation", "chat.createGroup", "chat.leaveGroup", "chat.markDelivered",
      "chat.markRead", "chat.myConversations", "chat.promoteAdmin", "chat.removeMember",
      "chat.send", "chat.startDm", "social.createPost", "social.createProfile",
      "pay.addExpense", "pay.convExpenses", "pay.expenseShares", "pay.myBalance", "pay.myLedger",
      "pay.myOpenShares", "pay.sendMoney", "pay.settleShare",
      "social.createReply", "social.followingFeed", "social.globalFeed", "social.listUsers",
      "social.me", "social.myFeedMarks",
      "social.myFollowing", "social.myLikes", "social.profile", "social.profileByHandle",
      "social.thread", "social.toggleFollow", "social.toggleLike", "social.toggleRepost",
      "social.updateProfile",
    ].sort()), "Quarry Clique operation inventory changed");
    const failures = rustCheck(lowered.project.programs, "synthetic", lowered.project.schema)
      .filter((item) => item.error);
    assert(failures.length === 0, `Quarry Clique did not certify: ${JSON.stringify(failures)}`);
  });

  test("Quarry Clique nested row shapes use selected column widths", async () => {
    const schema = readFileSync(resolve(fixtures, "quarry-clique/snapback/schema.q"), "utf8");
    const operations = `query focused(c: conversations):
  require exists members[c, viewer] else NOT_MEMBER
  return expenses[c] last 20 by byConv { *, payerProfile: users[principal = .payer] { displayName, handle }, shares: shares[c, .id] first 50 by byConvExpense { id, debtor, amount, settled, settledAt, debtorProfile: users[principal = .debtor] { displayName, handle } } }

query spread(c: conversations):
  require exists members[c, viewer] else NOT_MEMBER
  return expenses[c] last 20 by byConv { *, payerProfile: users[principal = .payer] { displayName, handle }, shares: shares[c, .id] first 50 by byConvExpense { *, debtorProfile: users[principal = .debtor] { displayName, handle } } }
`;
    await withProject({ "snapback/schema.q": schema, "snapback/row-width.q": operations }, async (root) => {
      const lowered = await lowerProject(root);
      assert(lowered.ok, `Clique row-width scratch project refused: ${lowered.ok ? "" : diagnosticsText(lowered.diagnostics)}`);
      const checked = rustCheck(lowered.project.programs, "synthetic", lowered.project.schema);
      const focused = checked.find((item) => item.program === "row-width.focused")!;
      assert(focused.error === null && focused.certificate?.max_output_bytes === 822_692
        && focused.certificate.max_closure_bytes === 821_450,
      `focused Clique shape did not certify at its pinned bounds: ${JSON.stringify(focused)}`);

      const spread = checked.find((item) => item.program === "row-width.spread")!;
      assert(spread.certificate === null && spread.error?.code === "E_BOUND"
        && spread.error.message.startsWith("output bytes 1820692 exceeds ceiling 1048576")
        && spread.error.rewrite.includes("widest nested collection")
        && spread.error.rewrite.includes("shares first 50")
        && spread.error.rewrite.includes("shares.expenseDescription")
        && !spread.error.rewrite.includes("return null"),
      `Clique spread did not retain its pinned output refusal: ${JSON.stringify(spread)}`);

      const raised = rustCheck(lowered.project.programs, "synthetic", lowered.project.schema, {
        examined: 10_240,
        index_entries: 10_240,
        rule_probes: 10_240,
        steps: 1_000_000,
        heap_bytes: 8 * 1024 * 1024,
        output_bytes: 32 * 1024 * 1024,
        closure_bytes: 4 * 1024 * 1024,
        write_rows: 2_048,
      }).find((item) => item.program === "row-width.spread")!;
      assert(raised.error === null && raised.certificate?.max_output_bytes === 1_820_692
        && raised.certificate.max_closure_bytes === 1_879_850,
      `raised-ceiling Clique spread changed: ${JSON.stringify(raised)}`);
      // Four-byte text pricing makes the complete expense/share rows 1,098/1,426;
      // both 20 × 50 figures are direct pins from the real certifier.
    });
  });

  registerQuarryProgramChecks(test, frontend);
  registerQuarryDirectMutationChecks(test, frontend);
  registerJobChecks(test, frontend);
  registerScheduleChecks(test, frontend);
}
