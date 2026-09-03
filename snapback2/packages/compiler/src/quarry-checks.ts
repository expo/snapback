import { existsSync, readFileSync } from "node:fs";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import type { FrontendDiagnostic, Program } from "./ir";
import { lowerProject } from "./project";
import { rustCheck } from "./rust-check";
import { compileQuarry, type QuarryInput } from "./quarry/index";
import { parseDocument } from "./quarry/parser";

type Test = (name: string, run: () => void | Promise<void>) => void;

export function registerQuarryChecks(test: Test, frontend: string): void {
  const fixtures = resolve(frontend, "fixtures");
  const packageRoot = resolve(frontend, "../snapback2");

  test("Quarry todos and full surface lower in memory and certify", async () => {
    for (const [name, count] of [["quarry-todos", 2], ["quarry-surface", 20]] as const) {
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
      "mentionTokens(", "recurse(", 'order: "desc"', "after:", "__q_matchResult", "db.get(users",
    ]) assert(text.includes(spelling), `Quarry full-surface lowering lost ${spelling}`);
    for (const line of text.split("\n").filter((line) => line.trim())) {
      assert(/\/\/ q:.+:\d+:\d+$/.test(line), `generated Quarry line lacks file:line:column provenance: ${line}`);
    }
  });

  test("Quarry effects, maintains, aggregate sugar, where, returns, objects, and count reach IR", async () => {
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
    assert(deepKey(operation(surface.project.programs, "surface.visiblePosts").body, "For")
      && deepKey(operation(surface.project.programs, "surface.visiblePosts").body, "Push"), "where did not lower to a bounded filter loop");
    assert(deepKey(operation(surface.project.programs, "surface.visiblePosts").body, "Object"), "object literal did not reach IR");
    assert(deepKey(operation(surface.project.programs, "surface.visiblePosts").body, "Builtin")
      && JSON.stringify(operation(surface.project.programs, "surface.visiblePosts")).includes('"builtin":"Len"'), "count(page) did not lower through bounded Len policy");
    for (const name of ["surface.postsAfter", "surface.ensureUser", "surface.firstPositive"]) {
      assert(deepKey(operation(surface.project.programs, name).body, "Return"), `${name} lost a nested explicit return`);
    }
  });

  test("Quarry tuple cursors lower, group, bind, and certify with Ref ids", async () => {
    const schema = "table posts:\n  author: principal\n  at: time\n  by byAuthorAt: author, at, id\n  public\n";
    const module = `query page(author: principal, cursorAt: time ?, cursorId: posts ?):
  if cursorAt != null:
    return posts[author] after (cursorAt, cursorId) first 3
  return posts[author] first 3

query grouped(value: int):
  return (value)

query scalar(author: principal, at: time, cursorId: posts):
  return posts[author, at] after cursorId first 3 by byAuthorAt

query ordered(a: int, b: int):
  (lo, hi) = sorted(a, b)
  return [lo, hi]
`;
    const compiled = compileInline([
      { fileName: "snapback/schema.q", source: schema },
      { fileName: "snapback/ops.q", source: module },
    ]);
    assert(compiled.ok, `tuple cursor front end refused: ${compiled.ok ? "" : diagnosticsText(compiled.diagnostics)}`);
    const source = compiled.modules[0]!.source;
    assert(source.includes("after: [args.cursorAt, args.cursorId]"), `tuple cursor did not emit an array literal:\n${source}`);
    assert(source.includes("after: args.cursorId"), `one-column scalar cursor sugar stopped lowering:\n${source}`);
    assert(source.includes("return args.value;") && !source.includes("return [args.value];"), `single parentheses stopped grouping:\n${source}`);
    assert(source.includes("orderedPair(args.a, args.b)"), `tuple binding changed:\n${source}`);

    await withProject({ "snapback/schema.q": schema, "snapback/ops.q": module }, async (root) => {
      const lowered = await lowerProject(root);
      assert(lowered.ok, `tuple cursor project refused: ${lowered.ok ? "" : diagnosticsText(lowered.diagnostics)}`);
      const failures = rustCheck(lowered.project.programs, "synthetic", lowered.project.schema).filter((item) => item.error);
      assert(failures.length === 0, `tuple cursor project did not certify: ${JSON.stringify(failures)}`);
    });
  });

  test("Quarry refuses a scalar composite cursor with a pasteable tuple rewrite", async () => {
    const schema = "table posts:\n  author: principal\n  at: time\n  by byAuthorAt: author, at, id\n  public\n";
    const scalar = "query page(author: principal, cursor: time, cursorId: posts):\n  return posts[author] after cursor first 3\n";
    const refused = compileInline([
      { fileName: "snapback/schema.q", source: schema },
      { fileName: "snapback/ops.q", source: scalar },
    ]);
    assert(!refused.ok, "scalar cursor over two remaining columns compiled");
    const diagnostic = refused.diagnostics.find((item) => item.code === "E_QUARRY_TYPE");
    assert(diagnostic?.family === "quarry" && diagnostic.site === "snapback/ops.q:2:30",
      `scalar cursor refusal lost code/family/site: ${JSON.stringify(refused)}`);
    assert(diagnostic.rewrite === "-- after (cursor, cursorId)" && diagnostic.guide === "quarry/types",
      `scalar cursor refusal lost tuple rewrite/guide: ${JSON.stringify(diagnostic)}`);

    const repaired = scalar.replace("after cursor", diagnostic.rewrite.slice(3));
    await withProject({ "snapback/schema.q": schema, "snapback/ops.q": repaired }, async (root) => {
      const lowered = await lowerProject(root);
      assert(lowered.ok, `tuple rewrite did not parse/lower: ${lowered.ok ? "" : diagnosticsText(lowered.diagnostics)}`);
      const failures = rustCheck(lowered.project.programs, "synthetic", lowered.project.schema).filter((item) => item.error);
      assert(failures.length === 0, `tuple rewrite did not certify: ${JSON.stringify(failures)}`);
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

  test("Quarry where preludes stay inside the per-row loop and certify", async () => {
    const schema = "table authors:\n  name: text <=50\n  public\n\ntable posts:\n  author: authors\n  public\n  by author\n";
    const module = "query byAuthor(author: authors):\n  return posts[author] first 5 where .author.name = 'Alice'\n";
    const compiled = compileInline([
      { fileName: "snapback/schema.q", source: schema },
      { fileName: "snapback/posts.q", source: module },
    ]);
    assert(compiled.ok, `nested where refused: ${compiled.ok ? "" : diagnosticsText(compiled.diagnostics)}`);
    const source = compiled.modules[0]!.source;
    const loop = source.indexOf("for (const __q_whereRow_");
    assert(loop >= 0 && source.indexOf("db.get(authors", loop) > loop && source.indexOf(".push(__q_whereRow_", loop) > loop,
      `where prelude escaped its row loop:\n${source}`);
    await withProject({ "snapback/schema.q": schema, "snapback/posts.q": module }, async (root) => {
      const lowered = await lowerProject(root);
      assert(lowered.ok, `nested where project refused: ${lowered.ok ? "" : diagnosticsText(lowered.diagnostics)}`);
      assert(rustCheck(lowered.project.programs, "synthetic", lowered.project.schema).every((item) => !item.error),
        "nested where project did not certify");
    });
  });

  test("Quarry rule binding arity is exact and two-binding updates retain row images", async () => {
    for (const rule of ["read (r, extra) <- allow", "insert (r, extra) <- allow", "delete (r, extra) <- allow", "update (old, next, extra) <- allow"]) {
      const result = compileInline([{ fileName: "snapback/schema.q", source: `table rows:\n  value: int\n  ${rule}\n` }]);
      assert(!result.ok && result.diagnostics.some((item) => item.code === "E_QUARRY_SYNTAX" && item.rewrite.includes("binding")),
        `invalid rule arity compiled: ${rule}: ${JSON.stringify(result)}`);
    }
    const oneBinding = compileInline([{
      fileName: "snapback/schema.q",
      source: "table rows:\n  value: int\n  update next <- next.value = 1\n",
    }]);
    assert(oneBinding.ok, `one-binding update refused: ${oneBinding.ok ? "" : diagnosticsText(oneBinding.diagnostics)}`);
    await withProject({
      "snapback/schema.q": "table rows:\n  value: int\n  read r <- allow\n  update (old, next) <- old.value != next.value\n",
      "snapback/rows.q": "query one(id: rows):\n  return rows[id]\n",
    }, async (root) => {
      const lowered = await lowerProject(root);
      assert(lowered.ok, `two-binding update refused: ${lowered.ok ? "" : diagnosticsText(lowered.diagnostics)}`);
      const rule = JSON.stringify((lowered.project.schema.tables.rows as any).rules.update);
      assert(rule.includes("OldField") && rule.includes("NextField"), `update row images were not retained: ${rule}`);
    });
  });

  test("Quarry maintain readable rules are typed against the materialized target", () => {
    const accepted = compileInline([{ fileName: "snapback/schema.q", source: "table source:\n  group: text <=20\n  body: text <=50\n  public\n\nmaintain totals = count source by group:\n  read r <- allow\n  readable r <- r.value = 0\n" }]);
    assert(accepted.ok, `target value readable rule refused: ${accepted.ok ? "" : diagnosticsText(accepted.diagnostics)}`);
    const refused = compileInline([{ fileName: "snapback/schema.q", source: "table source:\n  group: text <=20\n  body: text <=50\n  public\n\nmaintain totals = count source by group:\n  read r <- allow\n  readable r <- r.body = ''\n" }]);
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
    const schema = "table users:\n  name: text <=50\n  public\n  by name\n\ntable nodes:\n  parent: nodes?\n  public\n\ntable posts:\n  author: users\n  node: nodes\n  authorName: text <=50\n  payload: json <=2048\n  related: logs?\n  flag: bool\n  public\n\ntable logs:\n  post: posts\n  public\n";
    const cases: Array<[string, string, string]> = [
      ["read", "authorName: users[.author].name", "db.get(users"],
      ["cursor", "payload: users[] first 1 after .author by byName", "db.scan(users.byName"],
      ["array", "payload: [.author]", ".author"],
      ["exists", "flag: exists users[.author]", "db.exists(users"],
      ["walk", "payload: walk nodes[.node] up .parent depth 2", "recurse("],
      ["nested write", "related: +logs { post: .id }", "db.insert(logs"],
      ["object literal", "payload: { author: .author }", "author:"],
    ];
    for (const [name, field, emitted] of cases) {
      const result = compileInline([
        { fileName: "snapback/schema.q", source: schema },
        { fileName: "snapback/ops.q", source: `mutation refresh(id: posts):\n  ~posts[id] { ${field} }\n` },
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
      { fileName: "snapback/ops.q", source: "mutation refresh(id: posts):\n  ~posts[id] { authorName: users[.author].name, payload: { author: .author } }\n" },
    ]);
    assert(result.ok, `focal patch refused: ${result.ok ? "" : diagnosticsText(result.diagnostics)}`);
    const source = result.modules[0]!.source;
    const callback = source.indexOf("(__q_old_");
    const dereference = source.indexOf("db.get(users", callback);
    const firstField = source.indexOf("const __q_patch_", callback);
    const secondField = source.indexOf("const __q_patch_", firstField + 1);
    const returned = source.indexOf("return {", callback);
    assert(callback >= 0 && firstField > callback && dereference > firstField
      && secondField > firstField && returned > secondField,
    `focal patch evaluation escaped or reordered its callback:\n${source}`);
  });

  test("Quarry shaped pages retain spread/override field types and reference identity", async () => {
    const schema = "table authors:\n  name: text <=50\n  public\n\ntable posts:\n  author: authors\n  public\n  by author\n\ntable copies:\n  name: text <=50\n  public\n";
    const unsafe = "mutation copy():\n  for post in posts[] first 5 by byAuthor { *, author: .author }:\n    +copies { name: post.author.name }\n  null\n";
    await withProject({ "snapback/schema.q": schema, "snapback/ops.q": unsafe }, async (root) => {
      const compiled = compileInline([
        { fileName: "snapback/schema.q", source: schema },
        { fileName: "snapback/ops.q", source: unsafe },
      ]);
      assert(compiled.ok && compiled.modules[0]!.source.includes("db.get(authors"),
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
    const schema = "table nodes:\n  parent: nodes?\n  name: text <=50\n  public\n  by name\n\ntable copies:\n  name: text <=50\n  public\n";
    const module = "mutation copyWalk(seed: nodes):\n  for ancestor in walk nodes[seed] up .parent depth 3:\n    name = ancestor.name\n  null\n\nmutation copyPage():\n  for node in nodes[] first 3 by byName { * }:\n    name = node.name\n  null\n";
    const compiled = compileInline([
      { fileName: "snapback/schema.q", source: schema },
      { fileName: "snapback/ops.q", source: module },
    ]);
    assert(compiled.ok, `walk/page front end refused: ${compiled.ok ? "" : diagnosticsText(compiled.diagnostics)}`);
    const source = compiled.modules[0]!.source;
    assert(!source.includes("db.get(nodes, ancestor)") && !source.includes("db.get(nodes, node)"),
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
    const module = "mutation touch(id: todos):\n  match todos[id]:\n    some todo:\n      todo.title\n    none:\n      'missing'\n  ~todos[id] { title: 'touched' }\n\nmutation ensure(id: todos):\n  match todos[id]:\n    some todo:\n      ~todos[id] { title: 'found' }\n    none:\n      +todos { title: 'made' }\n  return null\n";
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
    const expected = new Set(["E_QUARRY_SYNTAX", "E_QUARRY_UNKNOWN", "E_QUARRY_AMBIGUOUS", "E_QUARRY_UNSUPPORTED", "E_QUARRY_PLACEMENT", "E_QUARRY_TYPE", "E_QUARRY_ONLY"]);
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
    const source = `use identity\n\ntable users:\n  name: text <=40\n  public\n\ntable items:\n  owner: users\n  read r <- r.owner = viewer\n`;
    const compiled = compileQuarry([{ path: "/virtual/schema.q", fileName: "snapback/schema.q", source }]);
    assert(!compiled.ok, "a table ref compared with viewer was accepted");
    const refusal = compiled.diagnostics[0]!;
    assert(refusal.code === "E_QUARRY_UNKNOWN" && refusal.family === "quarry" && refusal.site === "snapback/schema.q:9:21",
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

function compileFixture(fixtures: string, name: string, stems: string[]) {
  const directory = resolve(fixtures, name, "snapback");
  const inputs: QuarryInput[] = stems.map((stem) => {
    const path = resolve(directory, `${stem}.q`);
    return { path, fileName: `snapback/${stem}.q`, source: readFileSync(path, "utf8") };
  });
  return compileQuarry(inputs);
}

function compileInline(inputs: Array<{ fileName: string; source: string }>) {
  return compileQuarry(inputs.map((input) => ({
    ...input,
    path: resolve("/virtual", input.fileName),
  })));
}

async function withProject<T>(files: Record<string, string>, run: (root: string) => Promise<T>): Promise<T> {
  const root = await mkdtemp(join(tmpdir(), "snapback2-quarry-check-"));
  try {
    for (const [path, source] of Object.entries(files)) {
      const target = resolve(root, path);
      await mkdir(dirname(target), { recursive: true });
      await writeFile(target, source);
    }
    return await run(root);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

function operation(programs: Program[], name: string): Program {
  const program = programs.find((item) => item.name === name);
  assert(program, `missing operation ${name}`);
  return program;
}
function deepKey(value: unknown, key: string): boolean {
  if (Array.isArray(value)) return value.some((item) => deepKey(item, key));
  if (!value || typeof value !== "object") return false;
  return key in value || Object.values(value).some((item) => deepKey(item, key));
}
function diagnosticsText(diagnostics: FrontendDiagnostic[]): string {
  return diagnostics.map((item) => `${item.code}@${item.site}: ${item.message}`).join("; ");
}
function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}
