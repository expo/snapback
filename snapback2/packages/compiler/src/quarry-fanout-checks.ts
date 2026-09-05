import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { lowerProject } from "./project";
import { rustCheck } from "./rust-check";
import { assert, compileInline, diagnosticsText, withProject, type Test } from "./quarry-check-helpers";

export function registerQuarryFanoutChecks(test: Test, frontend: string): void {
  const schema = readFileSync(resolve(frontend, "fixtures/quarry-fanout/snapback/schema.q"), "utf8");
  const head = "for m in memberships[conversationId] first 50 by byConversationPrincipal:";
  const direct = `mutation send(conversationId: id):\n  ${head}\n    insert deliveries { principal: m.principal }\n`;
  const bound = `mutation send(conversationId: id):\n  page = memberships[conversationId] first 50 by byConversationPrincipal\n  for m in page:\n    insert deliveries { principal: m.principal }\n`;

  test("Quarry cap syntax and grouping refusals retain their declaration site", () => {
    for (const value of ["0", "-1", "1.5", "4294967296", "n"]) {
      const result = compileInline([{ fileName: "snapback/schema.q", source: schema.replace("cap 50", `cap ${value}`) }]);
      assert(!result.ok && result.diagnostics.some((d) => d.code === "E_QUARRY_SYNTAX" && d.rewrite.includes("cap 50 by <cols>")), `cap ${value} lost syntax repair`);
    }
    const cases = [
      ["cap 50 by conversationI", "E_QUARRY_UNKNOWN", "conversationId"],
      ["cap 50 by conversationId, conversationId", "E_SCHEMA_CONSTRAINT", "repeats"],
      ["cap 50 by conversationId\n  cap 60 by conversationId", "E_SCHEMA_CONSTRAINT", "already caps conversationId"],
      ["cap 50 by", "E_QUARRY_SYNTAX", "non-empty"],
    ];
    for (const [cap, code, message] of cases) {
      const result = compileInline([{ fileName: "snapback/schema.q", source: schema.replace("cap 50 by conversationId", cap!) }]);
      assert(!result.ok && result.diagnostics.some((d) => d.code === code && d.message.includes(message!) && d.site.startsWith(`snapback/schema.q:${cap!.includes("\n") ? 10 : 9}:`)), `cap refusal lost site/code/message: ${cap}`);
    }
    for (const type of ["[principal] <=5", "image <=100", "video <=100"]) {
      const result = compileInline([{ fileName: "snapback/schema.q", source: schema.replace("group: text <=32 ?", `group: ${type}`).replace("cap 50 by conversationId", "cap 50 by group").replace("  by byGroup: group, id\n", "") }]);
      assert(!result.ok && result.diagnostics.some((d) => d.code === "E_SCHEMA_CONSTRAINT"), `cap indexed ${type}`);
    }
    const notGlobal = compileInline([{ fileName: "snapback/schema.q", source: schema }, { fileName: "snapback/ops.q", source: "query cap():\n  return null\n" }]);
    assert(notGlobal.ok, "cap was incorrectly made globally reserved");
  });

  test("Quarry cap lowers once and Rust admits indexes even without writers", async () => {
    await withProject({ "snapback/schema.q": schema.replace("cap 50 by conversationId", "cap 50 by group").replace("  by byGroup: group, id\n", ""), "snapback/ops.q": "query noop():\n  return null\n" }, async (root) => {
      const result = await lowerProject(root);
      assert(result.ok, `cap lowering failed: ${result.ok ? "" : diagnosticsText(result.diagnostics)}`);
      const constraint = (result.project.schema.tables as any).memberships.constraints.find((c: any) => c.Cap);
      assert(JSON.stringify(constraint) === '{"Cap":{"by":["group"],"max":50}}', "cap lowering duplicated or changed");
      const checked = rustCheck([], "synthetic", result.project.schema);
      assert(checked.some((r) => r.error?.code === "E_SCHEMA_CONSTRAINT" && r.error.rewrite === "by group" && r.error.site === "schema.tables.memberships.constraints[1]"), `missing cap enforcement index admitted: ${JSON.stringify(checked)}`);
      assert(Object.values(result.sources).some((site) => site.file === "snapback/schema.q" && site.line === 8), "cap declaration source map lost");
    });
  });

  test("implicit id is an indexable cap column alone and in a tuple", async () => {
    for (const columns of ["id", "id, conversationId"]) {
      const source = schema.replace("cap 50 by conversationId", `cap 1 by ${columns}\n  by byIdentityGroup: id, conversationId`);
      await withProject({ "snapback/schema.q": source, "snapback/ops.q": "query noop():\n  return null\n" }, async (root) => {
        const lowered = await lowerProject(root); assert(lowered.ok, `implicit id cap did not lower: ${lowered.ok ? "" : diagnosticsText(lowered.diagnostics)}`);
        assert(rustCheck(lowered.project.programs, "synthetic", lowered.project.schema).every((r) => !r.error), "implicit id cap did not certify");
      });
    }
  });

  test("unsupported rule prefix repairs give direction without unbound pasted names", async () => {
    for (const rule of [".principal != viewer", "exists grants[.principal]"]) {
      const source = schema.replace("  public", `  read <- ${rule}`) + "\ntable grants:\n  principal: principal\n  unique byPrincipal: principal\n  public\n";
      await withProject({ "snapback/schema.q": source, "snapback/ops.q": direct }, async (root) => {
        const lowered = await lowerProject(root); assert(lowered.ok, `rule fixture failed: ${lowered.ok ? "" : diagnosticsText(lowered.diagnostics)}`);
        const error = rustCheck(lowered.project.programs, "synthetic", lowered.project.schema).find((r) => r.error?.code === "E_STRUCTURAL_FANOUT")?.error;
        assert(error?.rewrite === "denormalize principal into the index prefix and pin it from an argument or `viewer`", `fabricated prefix repair: ${JSON.stringify(error)}`);
      });
    }
  });

  test("chat groupCreate reserves fifty times fifty cap candidates", async () => {
    const chat = await lowerProject(resolve(frontend, "../snapback2/templates/chat"));
    assert(chat.ok, "chat template did not lower");
    const p = chat.project.programs.find((p) => p.name === "groups.groupCreate")!;
    const [checked] = rustCheck(chat.project.programs, "synthetic", chat.project.schema, undefined, chat.project.effects).filter((r) => r.program === p.name);
    assert(checked && !checked.error && checked.certificate, `groupCreate refused: ${JSON.stringify(checked)}`);
    const uncapped = structuredClone(chat.project.schema) as any;
    uncapped.tables.memberships.constraints = uncapped.tables.memberships.constraints.filter((c: any) => !c.Cap);
    // The baseline certifies one program, so the schema's schedule bindings (whose
    // binding programs are not in that list) are dropped alongside the cap.
    if (uncapped.schedules) uncapped.schedules = Array.isArray(uncapped.schedules) ? [] : {};
    const [baseline] = rustCheck([p], "synthetic", { ...uncapped, effects: [] });
    assert(baseline && !baseline.error && baseline.certificate, `uncapped groupCreate baseline refused: ${JSON.stringify(baseline?.error)}`);
    assert(Number(checked.certificate.max_examined) - Number(baseline.certificate.max_examined) === 50 * 50, "groupCreate did not reserve 50 × 50 examined");
    assert(Number(checked.certificate.max_index_entries) - Number(baseline.certificate.max_index_entries) === 50 * 50, "groupCreate did not reserve 50 × 50 index entries");
  });

  const reasons = [
    { name: "uncapped", schema: schema.replace("  cap 50 by conversationId\n", ""), source: direct, reason: "has no cap over conversationId", repair: "cap" },
    { name: "below cap", schema: schema.replace("cap 50", "cap 100"), source: direct, reason: "bound 50 is below cap 100", repair: "bound" },
    { name: "let-bound uncapped", schema: schema.replace("  cap 50 by conversationId\n", ""), source: bound, reason: "has no cap over conversationId", repair: "cap" },
    { name: "nonuniform rule", schema: schema.replace("  public", "  read <- .principal = viewer"), source: direct, reason: "the read rule is not uniform", repair: "prefix" },
    { name: "cursor", schema, source: direct.replace("conversationId: id)", "conversationId: id, c: cursor ?)").replace("first 50", "after c first 50"), reason: "the loop reads after a cursor", repair: "head" },
    { name: "nonuniform elsewhere", schema: schema + "\ntable other:\n  principal: principal\n  by byPrincipal: principal, id\n  read <- .principal = viewer\n", source: direct.replace(`  ${head}`, `  unused = other[] first 2 by byPrincipal\n  ${head}`), reason: "the non-uniform scan at", repair: "other-prefix" },
  ];
  for (const item of reasons) test(`Quarry fanout ${item.name} refuses and its pasted repair certifies`, async () => {
    await withProject({ "snapback/schema.q": item.schema, "snapback/ops.q": item.source }, async (root) => {
      const lowered = await lowerProject(root);
      assert(lowered.ok, `fanout front end failed: ${lowered.ok ? "" : diagnosticsText(lowered.diagnostics)}`);
      const checked = rustCheck(lowered.project.programs, "synthetic", lowered.project.schema);
      const error = checked.find((r) => r.error?.code === "E_STRUCTURAL_FANOUT")?.error;
      assert(error && error.message.includes(item.reason) && error.family === "bound" && error.guide === "bound/loop" && error.site === "ops.send/for/m/0", `fanout reason/envelope: ${JSON.stringify(checked)}`);
      const sourceSite = lowered.sources["ops.send/for/m/0"];
      assert(sourceSite?.file === "snapback/ops.q" && item.source.split("\n")[sourceSite.line - 1]?.trim().startsWith("for m"), `fanout source map did not identify for line: ${JSON.stringify(sourceSite)}`);
      let repairedSchema = item.schema;
      let repairedSource = item.source;
      if (item.repair === "cap") repairedSchema = repairedSchema.replace("  public", `  ${error.rewrite}\n  public`);
      if (item.repair === "bound") repairedSource = repairedSource.replace("first 50", error.rewrite);
      if (item.repair === "head") repairedSource = repairedSource.replace(/^  for .*:$/m, `  ${error.rewrite}`);
      if (item.repair === "prefix") {
        const [index, head] = error.rewrite.split("\n");
        repairedSchema = repairedSchema.replace("  cap 50", `  ${index}\n  cap 50`);
        repairedSource = repairedSource.replace(/^  for .*:$/m, `  ${head}`);
      }
      if (item.repair === "other-prefix") {
        const [index, read] = error.rewrite.split("\n");
        repairedSchema = repairedSchema.replace("  by byPrincipal: principal, id", `  ${index}`);
        repairedSource = repairedSource.replace("other[] first 2 by byPrincipal", read!);
      }
      await withProject({ "snapback/schema.q": repairedSchema, "snapback/ops.q": repairedSource }, async (fixedRoot) => {
        const fixed = await lowerProject(fixedRoot);
        assert(fixed.ok, `pasted ${item.name} rewrite failed: ${fixed.ok ? "" : diagnosticsText(fixed.diagnostics)}\n${error.rewrite}`);
        assert(rustCheck(fixed.project.programs, "synthetic", fixed.project.schema).every((r) => !r.error), `pasted ${item.name} repair did not certify`);
      });
    });
  });

  test("Quarry complete pages certify directly, through identities and shapes, and over longer prefixes; queries are uncapped", async () => {
    const fixture = await lowerProject(resolve(frontend, "fixtures/quarry-fanout"));
    assert(fixture.ok, "complete fanout fixture did not lower");
    assert(rustCheck(fixture.project.programs, "synthetic", fixture.project.schema).every((r) => !r.error), "complete fixture refused");
    for (const source of [direct, bound, direct.replace("first 50 by byConversationPrincipal:", "first 50 by byConversationPrincipal { principal }:")]) {
      await withProject({ "snapback/schema.q": schema, "snapback/ops.q": source }, async (root) => {
        const result = await lowerProject(root); assert(result.ok, `complete page failed to lower: ${result.ok ? "" : diagnosticsText(result.diagnostics)}`);
        const checked = rustCheck(result.project.programs, "synthetic", result.project.schema);
        assert(checked.every((r) => !r.error && (r.certificate as any).read_sites.some((s: any) => s.complete)), `complete flag missing: ${JSON.stringify(checked)}`);
      });
    }
    await withProject({ "snapback/schema.q": schema.replace("  cap 50 by conversationId\n", ""), "snapback/ops.q": direct.replace("mutation", "query").replace("insert deliveries { principal: m.principal }", "require m.principal = viewer else NOT_ME") }, async (root) => {
      const result = await lowerProject(root); assert(result.ok, "query page failed to lower");
      assert(rustCheck(result.project.programs, "synthetic", result.project.schema).every((r) => !r.error), "uncapped query refused");
    });
  });

  test("fanout raw argument bound and known transformed binding paste literal/head repairs; unknown and merge honestly refuse", async () => {
    await withProject({ "snapback/schema.q": schema, "snapback/ops.q": bound }, async (root) => {
      const result = await lowerProject(root); assert(result.ok, "bound fixture failed");
      const p: any = structuredClone(result.project.programs[0]);
      const scan = p.body.find((s: any) => s.Let?.value.Scan || s.Const?.value.Scan);
      const read = (scan.Let ?? scan.Const).value.Scan;
      read.take = { Arg: { name: "n", max: 50 } }; p.args.n = "Int";
      const error = rustCheck([p], "synthetic", result.project.schema)[0]!.error;
      assert(error?.code === "E_STRUCTURAL_FANOUT" && error.message.includes("the bound is an argument") && error.rewrite === "first 50", "argument-bound repair lost");
      read.take = { Literal: Number(error.rewrite.split(" ")[1]) };
      assert(!rustCheck([p], "synthetic", result.project.schema)[0]!.error, "argument-bound pasted repair refused");
      p.body.splice(1, 0, { Assign: { name: "page", value: { Builtin: { builtin: "Slice", args: [{ Variable: "page" }, { Literal: { Int: 0 } }, { Literal: { Int: 50 } }] } } } });
      const cut = rustCheck([p], "synthetic", result.project.schema)[0]!.error;
      assert(cut?.code === "E_STRUCTURAL_FANOUT" && cut.rewrite === head, `known binding did not paste scan: ${JSON.stringify(cut)}`);
      await withProject({ "snapback/schema.q": schema, "snapback/ops.q": bound.replace("for m in page:", cut.rewrite) }, async (root) => {
        const fixed = await lowerProject(root); assert(fixed.ok, "head repair did not lower");
        // Keep the original raw-IR Slice assignment: the only repair is the head.
        fixed.project.programs[0]!.body.splice(1, 0, structuredClone(p.body[1]));
        assert(JSON.stringify(fixed.project.programs[0]!.body[1]).includes("Slice"), "transformed fixture was lost");
        assert(rustCheck(fixed.project.programs, "synthetic", fixed.project.schema).every((r) => !r.error), "head repair on transformed fixture did not certify");
      });
      p.body.find((s: any) => s.For).For.domain.DerivedArray.value = { Variable: "unknownPage" };
      const unknown = rustCheck([p], "synthetic", result.project.schema)[0]!.error;
      assert(unknown?.code === "E_STRUCTURAL_FANOUT" && unknown.rewrite.includes("bind exactly one page"), "unknown origin promised a fabricated scan");
    });
    const merge = "mutation send(conversationId: id, other: id):\n  page = merge memberships first 50 by byConversationRole:\n    [conversationId]\n    [other]\n  for m in page:\n    insert deliveries { principal: m.principal }\n";
    await withProject({ "snapback/schema.q": schema, "snapback/ops.q": merge }, async (root) => {
      const result = await lowerProject(root); assert(result.ok, `merge failed to lower: ${result.ok ? "" : diagnosticsText(result.diagnostics)}`);
      const errors = rustCheck(result.project.programs, "synthetic", result.project.schema).flatMap((r) => r.error ? [r.error] : []);
      assert(errors.some((e) => e.code === "E_STRUCTURAL_FANOUT" && e.message.includes("a merge page has no union proof") && e.rewrite.includes("not yet available")), "merge suggested unavailable work");
    });
  });
}
