import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { lowerProject } from "./project";
import { rustCheck } from "./rust-check";
import { assert, compileInline, diagnosticsText, withProject, type Test } from "./quarry-check-helpers";
import { createGlobalSearchPager } from "../../snapback2/src/global-search-pager";

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
      assert(!result.ok && result.diagnostics.some((d) => d.code === code && `${d.message} ${d.rewrite}`.includes(message!) && d.site.startsWith(`snapback/schema.q:${cap!.includes("\n") ? 10 : 9}:`)), `cap refusal lost site/code/message: ${cap}`);
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

  test("prefix-pinned OR admits private DM counts and fanout without disclosing the other arm", async () => {
    const dmSchema = `use identity

table deliveries:
  sender: principal
  recipient: principal
  cap 50 by sender
  by bySender: sender, id
  by byRecipient: recipient, id
  read <- .recipient = viewer or .sender = viewer
  insert <- .sender = viewer
  update <- deny
  delete <- .sender = viewer
`;
    for (const column of ["Sender", "Recipient"]) {
      await withProject({ "snapback/schema.q": dmSchema, "snapback/ops.q":
        `query mine():\n  return count(deliveries[viewer] first 50 by by${column})\n` }, async root => {
        const lowered = await lowerProject(root); assert(lowered.ok, "DM query did not lower");
        const [checked] = rustCheck(lowered.project.programs, "synthetic", lowered.project.schema);
        assert(checked?.certificate && !checked.error, `DM count refused: ${JSON.stringify(checked)}`);
        assert((checked.certificate.read_sites as any[]).every((site: any) => site.hoist && site.decided_true), "DM disjunct did not decide visibility");
      });
    }
    for (const principal of ["viewer", "other"]) {
      await withProject({ "snapback/schema.q": dmSchema, "snapback/ops.q":
        `mutation remove(other: principal):\n  for row in deliveries[${principal}] first 50 by bySender:\n    delete deliveries[row.id]\n` }, async root => {
        const lowered = await lowerProject(root); assert(lowered.ok, "DM fanout did not lower");
        const [checked] = rustCheck(lowered.project.programs, "synthetic", lowered.project.schema);
        assert(principal === "viewer" ? !checked?.error : checked?.error?.code === "E_STRUCTURAL_FANOUT",
          `pinning an arbitrary argument must not prove equality to viewer: ${JSON.stringify(checked)}`);
      });
    }
  });

  test("chat groupCreate prices its same-key count-backed cap once per write", async () => {
    const chat = await lowerProject(resolve(frontend, "../snapback2/templates/chat"));
    assert(chat.ok, "chat template did not lower");
    const p = chat.project.programs.find((p) => p.name === "groups.groupCreate")!;
    const [checked] = rustCheck(chat.project.programs, "synthetic", chat.project.schema, undefined, chat.project.effects).filter((r) => r.program === p.name);
    assert(checked && !checked.error && checked.certificate, `groupCreate refused: ${JSON.stringify(checked)}`);
    const uncapped = structuredClone(chat.project.schema) as any;
    // The cap-only baseline has no delivery declaration depending on that cap.
    delete uncapped.tables.messages.deliver;
    delete uncapped.tables.deliveries;
    delete uncapped.tables.deliveriesReceipts;
    uncapped.tables.memberships.constraints = uncapped.tables.memberships.constraints.filter((c: any) => !c.Cap);
    // The baseline certifies one program, so the schema's schedule bindings (whose
    // binding programs are not in that list) are dropped alongside the cap.
    if (uncapped.schedules) uncapped.schedules = Array.isArray(uncapped.schedules) ? [] : {};
    const [baseline] = rustCheck([p], "synthetic", { ...uncapped, effects: [] });
    assert(baseline && !baseline.error && baseline.certificate, `uncapped groupCreate baseline refused: ${JSON.stringify(baseline?.error)}`);
    assert(Number(checked.certificate.max_examined) - Number(baseline.certificate.max_examined) === 50, "groupCreate did not reserve 50 × 1 examined");
    assert(Number(checked.certificate.max_index_entries) - Number(baseline.certificate.max_index_entries) === 50, "groupCreate did not reserve 50 × 1 index entries");
    assert(Number(checked.certificate.max_steps) - Number(baseline.certificate.max_steps) === 50 * 5, "groupCreate did not reserve 50 × 5 cap steps");
    const indexes = checked.certificate.indexes_required as string[];
    assert(indexes.includes("memberships.byConversationPrincipal"), "groupCreate lost the cap enforcement index");
    assert(indexes.includes("memberCounts.byId"), "groupCreate lost the maintained count point index");
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
      assert(error && error.message.includes(item.reason) && error.family === "bound" && error.guide === "fanout"
        && error.site.startsWith("ops.send/for/"), `fanout reason/envelope: ${JSON.stringify(checked)}`);
      const sourceSite = lowered.sources[error.site];
      assert(sourceSite?.file === "snapback/ops.q" && item.source.split("\n")[sourceSite.line - 1]?.trim().startsWith("for m"), `fanout source map did not identify for line: ${JSON.stringify(sourceSite)}`);
      const generatedBinding = error.site.split("/for/")[1]?.split("/")[0];
      const authoredRewrite = generatedBinding ? error.rewrite.replaceAll(generatedBinding, "m") : error.rewrite;
      let repairedSchema = item.schema;
      let repairedSource = item.source;
      if (item.repair === "cap") repairedSchema = repairedSchema.replace("  public", `  ${authoredRewrite}\n  public`);
      if (item.repair === "bound") repairedSource = repairedSource.replace("first 50", authoredRewrite);
      if (item.repair === "head") repairedSource = repairedSource.replace(/^  for .*:$/m, `  ${authoredRewrite}`);
      if (item.repair === "prefix") {
        const [index, head] = authoredRewrite.split("\n");
        repairedSchema = repairedSchema.replace("  cap 50", `  ${index}\n  cap 50`);
        repairedSource = repairedSource.replace(/^  for .*:$/m, `  ${head}`);
      }
      if (item.repair === "other-prefix") {
        const [index, read] = authoredRewrite.split("\n");
        repairedSchema = repairedSchema.replace("  by byPrincipal: principal, id", `  ${index}`);
        repairedSource = repairedSource.replace("other[] first 2 by byPrincipal", read!);
      }
      await withProject({ "snapback/schema.q": repairedSchema, "snapback/ops.q": repairedSource }, async (fixedRoot) => {
        const fixed = await lowerProject(fixedRoot);
        assert(fixed.ok, `pasted ${item.name} rewrite failed: ${fixed.ok ? "" : diagnosticsText(fixed.diagnostics)}\n${authoredRewrite}`);
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
      const scanName = (scan.Let ?? scan.Const).name;
      read.take = { Arg: { name: "n", max: 50 } }; p.args.n = "Int";
      const error = rustCheck([p], "synthetic", result.project.schema)[0]!.error;
      assert(error?.code === "E_STRUCTURAL_FANOUT" && error.message.includes("the bound is an argument") && error.rewrite === "first 50", "argument-bound repair lost");
      read.take = { Literal: Number(error.rewrite.split(" ")[1]) };
      assert(!rustCheck([p], "synthetic", result.project.schema)[0]!.error, "argument-bound pasted repair refused");
      const loopIndex = p.body.findIndex((statement: any) => statement.For);
      p.body.splice(loopIndex, 0, { Assign: { name: scanName, value: { Builtin: {
        builtin: "Slice", args: [{ Variable: scanName }, { Literal: { Int: 0 } }, { Literal: { Int: 50 } }],
      } } } });
      const cut = rustCheck([p], "synthetic", result.project.schema)[0]!.error;
      const cutBinding = cut?.site.split("/for/")[1]?.split("/")[0];
      const cutRewrite = cut && cutBinding ? cut.rewrite.replaceAll(cutBinding, "m") : cut?.rewrite;
      assert(cut?.code === "E_STRUCTURAL_FANOUT" && cutRewrite === head, `known binding did not paste scan: ${JSON.stringify(cut)}`);
      await withProject({ "snapback/schema.q": schema, "snapback/ops.q": bound.replace("for m in page:", cutRewrite!) }, async (root) => {
        const fixed = await lowerProject(root); assert(fixed.ok, "head repair did not lower");
        // Keep the original raw-IR Slice assignment: the only repair is the head.
        const fixedProgram: any = fixed.project.programs[0]!;
        const fixedScan = fixedProgram.body.find((statement: any) => statement.Let?.value.Scan || statement.Const?.value.Scan);
        const fixedScanName = (fixedScan.Let ?? fixedScan.Const).name;
        const fixedLoopIndex = fixedProgram.body.findIndex((statement: any) => statement.For);
        fixedProgram.body.splice(fixedLoopIndex, 0, { Assign: { name: fixedScanName, value: { Builtin: {
          builtin: "Slice", args: [{ Variable: fixedScanName }, { Literal: { Int: 0 } }, { Literal: { Int: 50 } }],
        } } } });
        assert(JSON.stringify(fixedProgram.body[fixedLoopIndex]).includes("Slice"), "transformed fixture was lost");
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
      assert(errors.some((e) => e.code === "E_STRUCTURAL_FANOUT" && e.message.includes("a merge page has no union proof; loop one scan, or move the pass to a job (guide fanout)") && e.rewrite === "loop one scan, not a merge"), "merge lost its instructional direction");
    });
  });

  // @ref LLP 1017.000#31-d1 — every echoed number states its origin, and the
  // pasted cap certifies at the author's own bound, small or large.
  test("fanout no-cap reasons state numeric provenance and paste-certify at 1, 50, and 500", async () => {
    const uncapped = schema.replace("  cap 50 by conversationId\n", "");
    for (const [n, ordinal] of [[1, "2nd"], [50, "51st"], [500, "501st"]] as const) {
      const source = direct.replace("first 50", `first ${n}`);
      await withProject({ "snapback/schema.q": uncapped, "snapback/ops.q": source }, async (root) => {
        const lowered = await lowerProject(root); assert(lowered.ok, `n=${n} fixture failed to lower`);
        const error = rustCheck(lowered.project.programs, "synthetic", lowered.project.schema).find((r) => r.error?.code === "E_STRUCTURAL_FANOUT")?.error;
        const expected = `memberships has no cap over conversationId; ${n} is this loop's bound, not a platform maximum. A cap refuses the ${ordinal} row per group and prices writes by ${n} (guide fanout)`;
        assert(error?.message.includes(expected), `n=${n} provenance reason lost: ${JSON.stringify(error)}`);
        assert(error?.rewrite === `cap ${n} by conversationId`, `n=${n} rewrite changed: ${JSON.stringify(error)}`);
      });
      await withProject({ "snapback/schema.q": uncapped.replace("  public", `  cap ${n} by conversationId\n  public`), "snapback/ops.q": source }, async (root) => {
        const fixed = await lowerProject(root); assert(fixed.ok, `n=${n} pasted repair failed to lower`);
        assert(rustCheck(fixed.project.programs, "synthetic", fixed.project.schema).every((r) => !r.error), `n=${n} pasted repair did not certify`);
      });
    }
  });

  test("fanout argument bounds name the argument's maximum without a cap and the schema cap with one", async () => {
    await withProject({ "snapback/schema.q": schema, "snapback/ops.q": bound }, async (root) => {
      const result = await lowerProject(root); assert(result.ok, "argument origin fixture failed");
      const capped: any = structuredClone(result.project.programs[0]);
      const cappedScan = capped.body.find((s: any) => s.Let?.value.Scan || s.Const?.value.Scan);
      (cappedScan.Let ?? cappedScan.Const).value.Scan.take = { Arg: { name: "n", max: 50 } };
      capped.args.n = "Int";
      const withCap = rustCheck([capped], "synthetic", result.project.schema)[0]!.error;
      assert(withCap?.message.includes("the bound is an argument; 50 is memberships's schema cap"), `capped argument provenance lost: ${JSON.stringify(withCap)}`);
      const uncappedSchema: any = structuredClone(result.project.schema);
      uncappedSchema.tables.memberships.constraints = uncappedSchema.tables.memberships.constraints.filter((c: any) => !c.Cap);
      const noCap = rustCheck([capped], "synthetic", uncappedSchema)[0]!.error;
      assert(noCap?.message.includes("50 is the argument's declared maximum, not a platform maximum"), `argument provenance lost: ${JSON.stringify(noCap)}`);
      assert(noCap?.rewrite === "cap 50 by conversationId", `argument no-cap rewrite changed: ${JSON.stringify(noCap)}`);
    });
  });

  test("whole-table fanout directs to a chunk job as instruction, not a paste", async () => {
    const source = "mutation sweep():\n  for m in memberships[] first 50 by byConversationPrincipal:\n    insert deliveries { principal: m.principal }\n";
    await withProject({ "snapback/schema.q": schema, "snapback/ops.q": source }, async (root) => {
      const result = await lowerProject(root); assert(result.ok, "whole-table fixture failed to lower");
      const error = rustCheck(result.project.programs, "synthetic", result.project.schema).find((r) => r.error?.code === "E_STRUCTURAL_FANOUT")?.error;
      assert(error?.message.includes("has no cap over its unpinned range; a whole-table pass belongs in a job (guide job)"), `whole-table reason lost: ${JSON.stringify(error)}`);
      assert(error?.rewrite.includes("author a job with a chunk loop over memberships") && error.rewrite.includes("run <job> --as system"), `whole-table direction lost: ${JSON.stringify(error)}`);
    });
  });

  // @ref LLP 1017.000#32-d2 — the guide's worked shapes are compiled fixtures.
  test("the fanout guide hub queries and jobs are the compiled fixture and certify", async () => {
    const page = readFileSync(resolve(frontend, "../snapback2/guide/fanout.md"), "utf8");
    const fixtureFeeds = readFileSync(resolve(frontend, "fixtures/quarry-fanout-guide/snapback/feeds.q"), "utf8");
    const fixtureDigest = readFileSync(resolve(frontend, "fixtures/quarry-fanout-guide/snapback/digest.q"), "utf8");
    const fixtureMessages = readFileSync(resolve(frontend, "fixtures/quarry-fanout-guide/snapback/messages.q"), "utf8");
    const snippets = [...page.matchAll(/```q\n([\s\S]*?)\n```/g)].map((match) => match[1]!);
    assert(snippets.some((snippet) => fixtureFeeds.includes(snippet)), "guide feed recipe diverged from its fixture");
    assert(snippets.every((snippet) => fixtureFeeds.includes(snippet) || fixtureMessages.includes(snippet) || fixtureDigest.includes(snippet)), "guide recipe diverged from its executed fixture");
    const lowered = await lowerProject(resolve(frontend, "fixtures/quarry-fanout-guide"));
    assert(lowered.ok, `guide fanout fixture did not lower: ${lowered.ok ? "" : diagnosticsText(lowered.diagnostics)}`);
    const checked = rustCheck(lowered.project.programs, "synthetic", lowered.project.schema);
    assert(checked.every((r) => !r.error), `guide fanout fixture refused: ${JSON.stringify(checked.flatMap((r) => r.error ? [r.error] : []))}`);
    const byName = new Map(checked.map((result) => [result.program, result.certificate]));
    assert(byName.has("feeds.followingFeed") && byName.has("feeds.followingHeads")
      && byName.has("messages.searchGroups") && byName.has("messages.searchChat") && byName.has("messages.richThread") && byName.has("feeds.conversationMessageSearch")
      && byName.has("feeds.searchScopes") && byName.has("digest.digestPass")
      && byName.has("digest.directoryBackfill"), `guide fanout programs missing: ${JSON.stringify([...byName.keys()])}`);
  });

  test("the shipped global search pager covers 1000 scopes with ordered refill and duplicate suppression", async () => {
    type Scope = { id: string };
    type Row = { id: string; at: number };
    const scopes = Array.from({ length: 1000 }, (_, index) => ({ id: `c${index}` }));
    const touched = new Set<string>();
    let active = 0, maximumActive = 0;
    const pager = createGlobalSearchPager<Scope, Row>({
      concurrency: 13,
      loadScopes: async after => {
        const offset = after === null ? 0 : Number(after.slice(1));
        const data = scopes.slice(offset, offset + 100);
        if (offset > 0) data.unshift(scopes[offset - 1]!); // changing page boundaries must not duplicate a lane.
        const next = offset + 100 < scopes.length ? `s${offset + 100}` : null;
        return { state: next ? "capped" : "complete", data, next };
      },
      loadMessages: async (scope, after) => {
        touched.add(scope.id); active++; maximumActive = Math.max(maximumActive, active);
        await Promise.resolve(); active--;
        const index = Number(scope.id.slice(1));
        if (index >= 998 && after === null) return { state: "capped", data: [{ id: "shared", at: 2000 }], next: `m${index}` };
        if (index === 999 && after !== null) return { state: "complete", data: [{ id: "tail-999", at: 1500 }], next: null };
        if (index === 998 && after !== null) return { state: "complete", data: [{ id: "tail-998", at: 1499 }], next: null };
        return { state: "complete", data: [{ id: `m${index}`, at: index }], next: null };
      },
      scopeId: scope => scope.id,
      messageId: row => row.id,
      compare: (left, right) => left.at - right.at || left.id.localeCompare(right.id),
    });
    const rows: Row[] = [];
    const firstTwo = await Promise.all([pager.next(), pager.next()]);
    for (const page of firstTwo) {
      assert(page.state === "capped" && page.issues.length === 0, `concurrent pager call lost serialization: ${JSON.stringify(page)}`);
      rows.push(...page.items);
    }
    for (let pages = 0; pages < 58; pages++) {
      const page = await pager.next();
      assert(page.state === (page.hasMore ? "capped" : "complete") && page.issues.length === 0,
        `global pager lost complete/capped state: ${JSON.stringify(page)}`);
      rows.push(...page.items);
      if (!page.hasMore) break;
    }
    const ordered = [...rows].sort((a, b) => b.at - a.at || b.id.localeCompare(a.id));
    assert(touched.size === 1000 && maximumActive <= 13, `pager did not bound all 1000 scopes: ${touched.size}/${maximumActive}`);
    assert(rows.length === 1001 && new Set(rows.map(row => row.id)).size === rows.length,
      `pager lost refill or duplicate suppression: ${rows.length}`);
    assert(JSON.stringify(rows) === JSON.stringify(ordered), "pager lost global (at,id) order");
    assert(rows.at(-1)?.id === "m0", "pager stopped before the last authorized scope");
  });

  test("the shipped global search pager rejects repeated cursors and never retains an invalid head", async () => {
    let calls = 0;
    const pager = createGlobalSearchPager<{ id: string }, { id: string; at: number }>({
      loadScopes: async () => ({ state: "complete", data: [{ id: "one" }], next: null }),
      loadMessages: async () => ++calls === 1
        ? { state: "capped", data: [{ id: "first", at: 2 }], next: "same" }
        : { state: "capped", data: [{ id: "invalid", at: 1 }], next: "same" },
      scopeId: scope => scope.id,
      messageId: row => row.id,
      compare: (left, right) => left.at - right.at,
    });
    const first = await pager.next();
    const again = await pager.next();
    assert(first.state === "partial" && JSON.stringify(first.items.map(row => row.id)) === '["first"]'
      && first.issues[0]?.receipt.reason === "search cursor repeated", `repeated cursor was consumed: ${JSON.stringify(first)}`);
    assert(again.state === "partial" && again.items.length === 0, `invalid head leaked after cursor refusal: ${JSON.stringify(again)}`);

    let missingNext = 0;
    const capped = createGlobalSearchPager<{ id: string }, { id: string; at: number }>({
      loadScopes: async () => ({ state: "complete", data: [{ id: "one" }], next: null }),
      loadMessages: async () => ++missingNext === 1
        ? { state: "capped", data: [{ id: "invalid", at: 2 }], next: null }
        : { state: "complete", data: [{ id: "valid", at: 1 }], next: null },
      scopeId: scope => scope.id, messageId: row => row.id, compare: (left, right) => left.at - right.at,
    });
    const invalid = await capped.next(), valid = await capped.next();
    assert(invalid.state === "partial" && invalid.items.length === 0, `capped head without next leaked: ${JSON.stringify(invalid)}`);
    assert(valid.state === "complete" && valid.items[0]?.id === "valid", `retry retained capped invalid head: ${JSON.stringify(valid)}`);
  });

  test("the shipped global search pager exposes the weakest unusable partition and retries it", async () => {
    const attempts = new Map<string, number>();
    const pager = createGlobalSearchPager<{ id: string }, { id: string; at: number }>({
      loadScopes: async () => ({ state: "complete", data: [{ id: "held" }, { id: "refused" }, { id: "ready" }], next: null }),
      loadMessages: async scope => {
        const attempt = (attempts.get(scope.id) ?? 0) + 1; attempts.set(scope.id, attempt);
        if (attempt === 1 && scope.id === "held") return { state: "held", data: [], next: null };
        if (attempt === 1 && scope.id === "refused") return { state: "refused", reason: "transport" };
        return { state: "complete", data: [{ id: scope.id, at: scope.id === "ready" ? 3 : 1 }], next: null };
      },
      scopeId: scope => scope.id,
      messageId: row => row.id,
      compare: (left, right) => left.at - right.at || left.id.localeCompare(right.id),
    });
    const blocked = await pager.next();
    assert(blocked.state === "refused" && blocked.items.length === 0 && blocked.issues.length === 2,
      `pager hid a weaker partition: ${JSON.stringify(blocked)}`);
    const retried = await pager.next();
    assert(retried.state === "complete" && JSON.stringify(retried.items.map(row => row.id)) === '["ready","refused","held"]',
      `pager did not retry only unusable heads: ${JSON.stringify(retried)}`);
  });
}
