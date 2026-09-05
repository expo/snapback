import { readFileSync } from "node:fs";
import { writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { ClientStore, type ClosureReceipt, type Context } from "../../evaluator/src/evaluator";
import type { Program } from "./ir";
import { lowerProject } from "./project";
import { rustCheck } from "./rust-check";
import { compileQuarry } from "./quarry/index";
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
      assert(JSON.stringify(program.args.c) === JSON.stringify({ Optional: "Cursor" })
        && program.result_page_site === "ops.page.0", `cursor IR/certificate provenance changed: ${JSON.stringify(program)}`);
      const checked = rustCheck([program, aliased], "synthetic", lowered.project.schema);
      assert(checked.every((item) => !item.error)
        && (checked[0]!.certificate as any).result_page_site?.site === "ops.page.0",
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
      const failures = rustCheck(lowered.project.programs, "synthetic", lowered.project.schema).filter((item) => item.error);
      assert(failures.length === 0, `page provenance failed certification: ${JSON.stringify(failures)}`);
      for (const name of ["ops.direct", "ops.shaped", "ops.merged"])
        assert(operation(lowered.project.programs, name).result_page_site, `${name} lost result-page provenance`);
      for (const name of ["ops.nested", "ops.branched", "ops.consumed"])
        assert(!operation(lowered.project.programs, name).result_page_site, `${name} incorrectly gained result-page provenance`);
      const merged = rustCheck([operation(lowered.project.programs, "ops.merged")], "synthetic", lowered.project.schema)[0]!;
      assert((merged.certificate as any)?.result_page_site?.merge === true, `merge provenance did not name its merge: ${JSON.stringify(merged)}`);
    });
  });

  test("Quarry merge lowers bounded lanes, records its certificate site, and refuses malformed lanes", async () => {
    const chat = await lowerProject(resolve(fixtures, "quarry-chat"));
    assert(chat.ok, `Quarry chat merge refused: ${chat.ok ? "" : diagnosticsText(chat.diagnostics)}`);
    const following = operation(chat.project.programs, "feeds.followingFeed");
    const body = JSON.stringify(following.body);
    assert(body.includes('"DedupeById"') && body.includes('"Sort"') && body.includes('"Slice"'), `merge composition changed: ${body}`);
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
    const beforeShapes = certificate.read_sites
      .filter((site: any) => site.table !== "profiles")
      .reduce((total: number, site: any) => total + (site.take + 2) * site.max_calls, 0);
    assert(beforeShapes === 1174, `following feed examined ${beforeShapes} before shaped point reads, expected 1174`);

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
      ["read", "authorName: users[.author].name", "db.get(users"],
      ["array", "payload: [.author]", ".author"],
      ["exists", "flag: exists users[.author]", "db.exists(users"],
      ["walk", "payload: walk nodes[.node] up .parent depth 2", "recurse("],
      ["nested write", "related: insert logs { post: .id }", "db.insert(logs"],
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
    const unsafe = "mutation copy():\n  for post in posts[] first 5 by byAuthor { *, author: .author }:\n    insert copies { name: post.author.name }\n  null\n";
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
    const schema = "table nodes:\n  parent: nodes?\n  name: text <=50\n  public\n  by name\n  cap 3 by name\n\ntable copies:\n  name: text <=50\n  public\n";
    const module = "mutation copyWalk(seed: nodes):\n  for ancestor in walk nodes[seed] up .parent depth 3:\n    name = ancestor.name\n  null\n\nmutation copyPage(name: text <=50):\n  for node in nodes[name] first 3 by byName { * }:\n    name = node.name\n  null\n";
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
