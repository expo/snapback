import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { lowerProject } from "./project";
import { rustCheck } from "./rust-check";
import { parseDocument } from "./quarry/parser";
import { assert, withProject, type Test } from "./quarry-check-helpers";

export function registerJobChecks(test: Test, frontend: string): void {
  test("Quarry jobs lower independent sweeps with typed prefixes and per-chunk engine writes", async () => {
    const lowered = await lowerProject(resolve(frontend, "fixtures/quarry-jobs"));
    assert(lowered.ok, JSON.stringify(lowered));
    assert(lowered.project.programs.every((p) => p.kind === "job"), "job kind was lost");
    assert(!lowered.apiDts.includes("fillAvatars"), "job leaked into the client API");
    const checked = rustCheck(lowered.project.programs, "synthetic", lowered.project.schema);
    assert(checked.every((c) => c.certificate), JSON.stringify(checked));
    const scoped = checked.find((c) => c.program === "admin.scoped")!.certificate!;
    assert(scoped.kind === "job" && scoped.chunks === "unbounded", JSON.stringify(scoped));
    assert((scoped.sweeps as any[]).length === 2 && (scoped.perChunk as any[]).length === 2, JSON.stringify(scoped));
    assert(JSON.stringify(scoped.engineWrites) === '["_jobs"]', JSON.stringify(scoped));
  });
  test("Quarry jobs refuse statements between chunks and cross-chunk bindings", async () => {
    for (const source of [
      "job bad:\n  return true\n",
      "job bad:\n  chunk p in profiles first 100 by byId:\n    update profiles[p.id] { avatarUrl: 'x' }\n  return true\n",
      "job bad:\n  chunk p in profiles last 100 by byId:\n    return true\n",
    ]) assert(parseDocument("bad.q", source).diagnostics.length > 0, source);
    const schema = readFileSync(resolve(frontend, "fixtures/quarry-jobs/snapback/schema.q"), "utf8");
    await withProject({ "snapback/schema.q": schema, "snapback/jobs.q": "job bad:\n  chunk p in profiles first 100 by byId:\n    saved = p.id\n  chunk q in profiles first 100 by byId:\n    update profiles[saved] { avatarUrl: 'x' }\n" }, async (root) => {
      assert(!(await lowerProject(root)).ok, "a chunk binding escaped its block");
    });
  });
  test("Job guide recipe is the compiled fixture and mutable keys refuse at check", async () => {
    const page = readFileSync(resolve(frontend, "../snapback2/guide/job.md"), "utf8");
    const fixture = readFileSync(resolve(frontend, "fixtures/quarry-jobs/snapback/admin.q"), "utf8");
    const snippet = page.match(/```q\n([\s\S]*?)\n```/)![1]!;
    assert(fixture.includes(snippet), "guide recipe diverged from its fixture");
    const lowered = await lowerProject(resolve(frontend, "fixtures/quarry-jobs"));
    assert(lowered.ok, JSON.stringify(lowered));
    const schema: any = structuredClone(lowered.project.schema);
    schema.tables.profiles.constraints = [];
    const checked = rustCheck(lowered.project.programs, "synthetic", schema);
    assert(checked.some((c) => c.error?.code === "E_JOB_CURSOR_INDEX" && c.error.family === "job" && c.error.guide === "job" && c.error.rewrite.includes("immutable")), JSON.stringify(checked));
  });
  // @ref LLP 1016#d4--expand-fill-contract — the narrowing refusal's paste is a fixture: the engine test pins the text, this check pins that it lowers and certifies.
  test("The narrowing refusal's pasted job lowers with its typed argument, enum quoting included, and certifies", async () => {
    const paste = readFileSync(resolve(frontend, "fixtures/quarry-jobs/snapback/narrowing.q"), "utf8");
    assert(paste.startsWith("-- keep profiles.avatarUrl optional and apply, then fill it:\njob fill_profiles_avatarUrl(value: text <=2048):"), "the paste lost its shape");
    const lowered = await lowerProject(resolve(frontend, "fixtures/quarry-jobs"));
    assert(lowered.ok, JSON.stringify(lowered));
    const byName = new Map(lowered.project.programs.map((p) => [p.name, p]));
    const text = byName.get("narrowing.fill_profiles_avatarUrl");
    const tier = byName.get("narrowing.fill_profiles_tier");
    assert(text?.kind === "job" && tier?.kind === "job", "the pasted jobs did not lower as jobs");
    assert(JSON.stringify(text.args.value) === JSON.stringify({ Text: { max: 2048 } }), JSON.stringify(text.args));
    assert(JSON.stringify(tier.args.value) === JSON.stringify({ Enum: { variants: ["free", "pro"] } }), JSON.stringify(tier.args));
    const checked = rustCheck([text, tier], "synthetic", lowered.project.schema);
    assert(checked.every((c) => c.certificate && (c.certificate.sweeps as any[])[0].table === "profiles"), JSON.stringify(checked));
  });
  test("A job that is not only chunk blocks refuses as E_JOB_SHAPE in the job family, naming the statement", async () => {
    const lowered = await lowerProject(resolve(frontend, "fixtures/quarry-jobs"));
    assert(lowered.ok, JSON.stringify(lowered));
    const chunk: any = lowered.project.programs.find((p) => p.name === "admin.fillAvatars")!.body[0]!;
    // A second chunk that reads the first chunk's loop binding: the crossing is a shape
    // error at certification, not an unknown variable parking the job at chunk time.
    const crossing = structuredClone(chunk);
    crossing.For.binding = "q";
    crossing.For.body = [{ Update: { table: "profiles", key: { Field: { base: { Variable: chunk.For.binding }, name: "id" } }, patch: { Object: { avatarUrl: { Literal: { String: "x" } } } } } }];
    const shapes = [
      { name: "admin.plain", body: [{ Return: { Variable: "nothing" } }], statement: 1, detail: "plain statement" },
      { name: "admin.trailing", body: [chunk, { Return: { Variable: "nothing" } }], statement: 2, detail: "plain statement" },
      { name: "admin.crossing", body: [chunk, crossing], statement: 2, detail: `it names \`${chunk.For.binding}\`, which another statement binds` },
    ];
    const checked = rustCheck(shapes.map(({ name, body }) => ({ name, kind: "job" as const, args: {}, read_time_granularity_ms: null, result_page_site: null, body })), "synthetic", lowered.project.schema);
    for (const [i, shape] of shapes.entries()) {
      const error = checked[i]!.error;
      assert(error?.code === "E_JOB_SHAPE" && error.family === "job" && error.guide === "job", JSON.stringify(checked[i]));
      const site = `${shape.name}:statement:${shape.statement}`;
      assert(error.site === site, `site ${error.site} is not ${site}`);
      assert(error.message.startsWith(`${site} is not a chunk: `) && error.message.includes(shape.detail), error.message);
      assert(error.rewrite.includes("one or more `chunk` blocks and nothing else"), error.rewrite);
    }
    // An empty body sites the job itself.
    const empty = rustCheck([{ name: "admin.empty", kind: "job", args: {}, read_time_granularity_ms: null, result_page_site: null, body: [] }], "synthetic", lowered.project.schema)[0]!.error;
    assert(empty?.code === "E_JOB_SHAPE" && empty.site === "admin.empty", JSON.stringify(empty));
  });
  test("No chat template mutation patches an immutable messages key", async () => {
    const lowered = await lowerProject(resolve(frontend, "../snapback2/templates/chat"));
    assert(lowered.ok, JSON.stringify(lowered));
    const messages: any = (lowered.project.schema as any).tables.messages;
    const immutable = new Set<string>(messages.constraints.flatMap((c: any) => c.Immutable?.fields ?? []));
    assert(immutable.has("conversationId") && immutable.has("authorId"), JSON.stringify(messages.constraints));
    const offenders: string[] = [];
    let updates = 0;
    const walk = (node: unknown, program: string): void => {
      if (Array.isArray(node)) { for (const item of node) walk(item, program); return; }
      if (!node || typeof node !== "object") return;
      const update = (node as any).Update;
      if (update?.table === "messages") {
        updates += 1;
        for (const key of Object.keys(update.patch?.Object ?? {})) if (immutable.has(key)) offenders.push(`${program} patches messages.${key}`);
      }
      for (const value of Object.values(node as object)) walk(value, program);
    };
    for (const program of lowered.project.programs) walk(program.body, program.name);
    assert(updates > 0, "the walk saw no messages update; the template's edit mutation moved");
    assert(offenders.length === 0, offenders.join("; "));
  });
}
