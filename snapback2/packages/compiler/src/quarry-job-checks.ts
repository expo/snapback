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
}
