import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { lowerProject } from "./project";
import { rustCheck } from "./rust-check";
import { assert, withProject, type Test } from "./quarry-check-helpers";

// @ref LLP 1016#d5--schedules-row-timers-and-periods-on-the-owners-clock — the compiler proof for both triggers, the certified binding, and the schedule family.
export function registerScheduleChecks(test: Test, frontend: string): void {
  const fixture = resolve(frontend, "fixtures/quarry-schedules");
  test("Quarry schedules lower row and period triggers into certified bindings on the schema", async () => {
    const lowered = await lowerProject(fixture);
    assert(lowered.ok, JSON.stringify(lowered));
    const schedules = lowered.project.schema.schedules ?? [];
    assert(schedules.length === 2, JSON.stringify(schedules));
    const daily = schedules.find((s) => s.name === "dailyDigest")!;
    const expire = schedules.find((s) => s.name === "expireMessage")!;
    assert(JSON.stringify(daily.trigger) === '{"every":{"durationMs":86400000}}' && daily.target === "admin.digestSweep", JSON.stringify(daily));
    assert(JSON.stringify(expire.trigger) === '{"row":{"table":"messages","column":"expiresAt"}}' && expire.target === "admin.purgeMessage", JSON.stringify(expire));
    const expireBinding = lowered.project.programs.find((p) => p.name === expire.binding)!;
    const dailyBinding = lowered.project.programs.find((p) => p.name === daily.binding)!;
    assert(expireBinding?.kind === "Query" && Object.keys(expireBinding.args).join() === "id", JSON.stringify(expireBinding));
    assert(dailyBinding?.kind === "Query" && Object.keys(dailyBinding.args).length === 0, JSON.stringify(dailyBinding));
    assert(expire.site.startsWith("snapback/admin.q:") && daily.site.startsWith("snapback/admin.q:"), "schedule sites");
    assert(!lowered.apiDts.includes("_timerBinding_") && !lowered.apiDts.includes("digestSweep"), "a binding or job leaked into the client API");
    assert(Object.values(expire).every((v) => typeof v !== "object" || v === expire.trigger), "the schema carries scalars and the trigger only");
    const checked = rustCheck(lowered.project.programs, "synthetic", lowered.project.schema, undefined, lowered.project.effects);
    assert(checked.every((c) => c.certificate), JSON.stringify(checked));
    const purge = checked.find((c) => c.program === "admin.purgeMessage")!.certificate!;
    assert(JSON.stringify(purge.engineWrites) === '["_timers"]', JSON.stringify(purge));
    assert((purge.write_sites as any[]).some((site) => site.table === "_timers"), JSON.stringify(purge.write_sites));
    const sweep = checked.find((c) => c.program === "admin.digestSweep")!.certificate!;
    assert(sweep.kind === "job" && JSON.stringify(sweep.engineWrites) === '["_jobs"]', JSON.stringify(sweep));
  });
  test("Quarry schedules refuse non-time columns, bad targets, and sub-minute or calendar durations with the schedule family", async () => {
    const schema = readFileSync(resolve(fixture, "snapback/schema.q"), "utf8");
    const push = readFileSync(resolve(fixture, "snapback/push.ts"), "utf8");
    const admin = readFileSync(resolve(fixture, "snapback/admin.q"), "utf8");
    const base = admin.split("\nschedule dailyDigest")[0]! + "\n\nmutation purgeMessage(id: messages):\n  update messages[id] { body: null, expiresAt: null }\n  return null\n\nquery peek(id: messages):\n  return messages[id]\n\n";
    const cases: Array<[string, string]> = [
      ["schedule expire on messages at .body:\n  purgeMessage(.id)\n", "E_SCHEDULE_COLUMN"],
      ["schedule expire on profiles at .expiresAt:\n  purgeMessage(.id)\n", "E_SCHEDULE_COLUMN"],
      ["schedule expire on messages at .expiresAt:\n  missing(.id)\n", "E_SCHEDULE_TARGET"],
      ["schedule expire on messages at .expiresAt:\n  peek(.id)\n", "E_SCHEDULE_TARGET"],
      ["schedule expire on messages at .expiresAt:\n  purgeMessage(.body)\n", "E_SCHEDULE_TARGET"],
      ["schedule expire on messages at .expiresAt:\n  purgeMessage\n", "E_SCHEDULE_TARGET"],
      ["schedule expire on messages at .expiresAt if .body:\n  purgeMessage(.id)\n", "E_SCHEDULE_TARGET"],
      ["schedule daily every 24h:\n  purgeMessage\n", "E_SCHEDULE_TARGET"],
      ["schedule daily every 24h:\n  digestSweep\n\nschedule daily every 1h:\n  digestSweep\n", "E_SCHEDULE_TARGET"],
      ["schedule daily every 30s:\n  digestSweep\n", "E_SCHEDULE_DURATION"],
      ["schedule daily every 0m:\n  digestSweep\n", "E_SCHEDULE_DURATION"],
      ["schedule daily every 1.5h:\n  digestSweep\n", "E_SCHEDULE_DURATION"],
      ["schedule daily at 09:00:\n  digestSweep\n", "E_SCHEDULE_DURATION"],
      ["schedule daily every 24h:\n  digestSweep\n\nschedule expire on messages at .expiresAt:\n  purgeMessage(.id)\n", "ok"],
    ];
    for (const [source, code] of cases) {
      await withProject({ "snapback/schema.q": schema, "snapback/push.ts": push, "snapback/admin.q": base + source }, async (root) => {
        const lowered = await lowerProject(root);
        if (code === "ok") {
          assert(lowered.ok, `${source}: ${JSON.stringify(lowered)}`);
          return;
        }
        assert(!lowered.ok, `${source} lowered`);
        const first = lowered.diagnostics[0]!;
        assert(first.code === code, `${source}: expected ${code}, got ${JSON.stringify(lowered.diagnostics)}`);
        assert(first.family === "schedule" && first.guide === "schedule", JSON.stringify(first));
        assert(first.site.startsWith("snapback/admin.q:") && first.rewrite.length > 0 && first.message.length > 0, JSON.stringify(first));
      });
    }
  });
  test("Schedule guide snippets are the compiled fixture and the chat template's server-side expiry", async () => {
    const page = readFileSync(resolve(frontend, "../snapback2/guide/schedule.md"), "utf8");
    const snippets = [...page.matchAll(/```q\n([\s\S]*?)\n```/g)].map((match) => match[1]!);
    const admin = readFileSync(resolve(fixture, "snapback/admin.q"), "utf8");
    const deliveries = readFileSync(resolve(frontend, "../snapback2/templates/chat/snapback/deliveries.q"), "utf8");
    assert(snippets.length === 2 && snippets.every((snippet) => admin.includes(snippet)), "guide recipe diverged from its fixture");
    assert(deliveries.includes(snippets[0]!), "the template's expiry schedule diverged from the guide");
    const chat = await lowerProject(resolve(frontend, "../snapback2/templates/chat"));
    assert(chat.ok, JSON.stringify(chat));
    const schedules = chat.project.schema.schedules ?? [];
    assert(schedules.length === 1 && schedules[0]!.target === "deliveries.purgeMessage", JSON.stringify(schedules));
    assert(!chat.apiDts.includes("purgeExpired"), "a client-invoked purge survived");
    assert(chat.apiDts.includes("expiresAt"), "post lost its expiry argument");
    const quarry = readFileSync(resolve(frontend, "../snapback2/guide/quarry.md"), "utf8");
    assert(!/E_QUARRY_UNSUPPORTED[^.]*`schedule`/.test(quarry) && quarry.includes("guide schedule"), "quarry.md still refuses schedule");
  });
}
