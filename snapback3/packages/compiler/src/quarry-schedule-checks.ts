import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { ClientStore, type ClosureReceipt, type Context, type Value } from "../../evaluator/src/evaluator";
import { lowerProject } from "./project";
import { rustCheck } from "./rust-check";
import { assert, operation, withProject, type Test } from "./quarry-check-helpers";

// @ref LLP 1016#d5--schedules-row-timers-and-periods-on-the-owners-clock — the compiler proof for both triggers, the certified binding, and the schedule family.
export function registerScheduleChecks(test: Test, frontend: string): void {
  const fixture = resolve(frontend, "fixtures/quarry-schedules");
  test("Quarry schedules lower row and period triggers into certified bindings on the schema", async () => {
    const lowered = await lowerProject(fixture);
    assert(lowered.ok, JSON.stringify(lowered));
    const schedules = lowered.project.schema.schedules ?? [];
    assert(schedules.length === 4, JSON.stringify(schedules));
    const daily = schedules.find((s) => s.name === "dailyDigest")!;
    const expire = schedules.find((s) => s.name === "expireMessage")!;
    const recipeDigest = schedules.find((s) => s.name === "recipeDigest")!;
    assert(JSON.stringify(daily.trigger) === '{"every":{"durationMs":86400000}}' && daily.target === "admin.digestSweep", JSON.stringify(daily));
    assert(JSON.stringify(expire.trigger) === '{"row":{"table":"messages","column":"expiresAt"}}' && expire.target === "admin.purgeMessage", JSON.stringify(expire));
    assert(JSON.stringify(recipeDigest.trigger) === '{"every":{"durationMs":120000}}'
      && recipeDigest.target === "digest-recipes.periodDigestSweep", JSON.stringify(recipeDigest));
    const expireBinding = lowered.project.programs.find((p) => p.name === expire.binding)!;
    const dailyBinding = lowered.project.programs.find((p) => p.name === daily.binding)!;
    const recipeBinding = lowered.project.programs.find((p) => p.name === recipeDigest.binding)!;
    assert(expireBinding?.kind === "Query" && Object.keys(expireBinding.args).join() === "id", JSON.stringify(expireBinding));
    assert(dailyBinding?.kind === "Query" && Object.keys(dailyBinding.args).length === 0, JSON.stringify(dailyBinding));
    assert(recipeBinding?.kind === "Query" && JSON.stringify(recipeBinding.args) === '{"periodEnd":"Time"}', JSON.stringify(recipeBinding));
    assert(expire.site.startsWith("snapback/admin.q:") && daily.site.startsWith("snapback/admin.q:"), "schedule sites");
    assert(!lowered.apiDts.includes("_timerBinding_") && !lowered.apiDts.includes("digestSweep"), "a binding or job leaked into the client API");
    assert(!lowered.apiDts.includes("purgeMessage"), "a schedule target leaked into the client API");
    assert(!lowered.project.schema.schedules!.some((s) => s.target === "admin.purgeMessage" && !lowered.project.programs.some((p) => p.name === s.target)), "the target stays a program of the project");
    assert(Object.values(expire).every((v) => typeof v !== "object" || v === expire.trigger), "the schema carries scalars and the trigger only");
    const checked = rustCheck(lowered.project.programs, "synthetic", lowered.project.schema, undefined, lowered.project.effects);
    assert(checked.every((c) => c.certificate), JSON.stringify(checked));
    const purge = checked.find((c) => c.program === "admin.purgeMessage")!.certificate!;
    assert(JSON.stringify(purge.engineWrites) === '["_timers"]', JSON.stringify(purge));
    assert((purge.write_sites as any[]).some((site) => site.table === "_timers"), JSON.stringify(purge.write_sites));
    const sweep = checked.find((c) => c.program === "admin.digestSweep")!.certificate!;
    assert(sweep.kind === "job" && JSON.stringify(sweep.engineWrites) === '["_jobs"]', JSON.stringify(sweep));
  });
  test("message expiry policy uses configured windows and bounds one stored-and-emitted preview", async () => {
    const lowered = await lowerProject(fixture);
    assert(lowered.ok, JSON.stringify(lowered));
    const checked = rustCheck(lowered.project.programs, "synthetic", lowered.project.schema, undefined, lowered.project.effects);
    assert(checked.every((item) => !item.error && item.certificate), JSON.stringify(checked));
    const send = operation(lowered.project.programs, "message-recipes.send");
    const certificate = checked.find((item) => item.program === send.name)!.certificate!;
    const baseRows: ClosureReceipt["rows"] = [
      { table: "appSettings", id: "settings", row: { Row: {
        id: { Id: "settings" }, key: { String: "windows" },
        disappear24hMs: { Int: 86_401_234 }, disappear7dMs: { Int: 604_812_345 },
        digestPeriodMs: { Int: 120_000 }, replayMode: { Bool: true },
      } } },
    ];
    const context = (conversation: string, message: string, expiresAt: Value): Context => ({
      viewer: "alice", principal_kind: "user", auth_epoch: 1, now: 10_000, read_time: 10_000,
      args: {
        conversationId: { Id: conversation }, target: { Id: "bob" },
        body: { String: `${"🙂".repeat(79)}界tail` }, expiresAt, messageId: { Id: message },
      },
      new_ids: [`push-${message}`, `outbox-${message}`],
    });
    for (const [mode, expiresAt, expected] of [
      ["off", "Null", "Null"],
      ["24h", "Null", { Int: 86_411_234 }],
      ["7d", "Null", { Int: 604_822_345 }],
      ["24h", { Int: 44_444 }, { Int: 44_444 }],
    ] as Array<[string, Value, Value]>) {
      const conversation = `conversation-${mode}-${JSON.stringify(expiresAt)}`;
      const message = `message-${mode}-${JSON.stringify(expiresAt)}`;
      const rows = [...baseRows, { table: "conversations", id: conversation, row: { Row: {
        id: { Id: conversation }, disappearing: { String: mode },
      } } }] as ClosureReceipt["rows"];
      const receipt: ClosureReceipt = {
        schema_hash: certificate.schema_hash as string,
        rows,
        ranges: [], verdicts: [],
        absences: [
          ["messages", "byId", [{ Id: message }]],
          ["pushLog", "byId", [{ Id: `push-${message}` }]],
        ],
      };
      const store = new ClientStore(lowered.project.schema, receipt);
      const applied = store.applyMutation(send, context(conversation, message, expiresAt), false, certificate);
      assert(applied.state === "predicted", `${mode} send was ${applied.state}: ${JSON.stringify(applied)}`);
      const stored = store.rows("messages")!.find((value) => value !== "Null" && "Row" in value
        && JSON.stringify(value.Row.id) === JSON.stringify({ Id: message }));
      assert(stored !== undefined && stored !== "Null" && "Row" in stored
        && JSON.stringify(stored.Row.expiresAt) === JSON.stringify(expected),
      `${mode} stored ${JSON.stringify(stored)}, expected ${JSON.stringify(expected)}`);
      const pushed = store.rows("pushLog")![0]!;
      const preview = pushed !== "Null" && "Row" in pushed && pushed.Row.preview !== "Null"
        && "String" in pushed.Row.preview ? pushed.Row.preview.String : "";
      assert(preview === `${"🙂".repeat(79)}界` && preview.length > 80 && [...preview].length === 80,
        `preview was not 80 Unicode scalars: ${JSON.stringify(preview)}`);
    }

    const nested = (statements: any[]): any[] => statements.flatMap((statement) => {
      if (statement.If) return [statement, ...nested(statement.If.then_body), ...nested(statement.If.else_body)];
      if (statement.For) return [statement, ...nested(statement.For.body)];
      return [statement];
    });
    const body = nested(send.body as any[]);
    const logs = body.filter((statement) => statement.Insert?.table === "pushLog");
    const emits = body.filter((statement) => statement.Emit?.effect === "push.notify");
    assert(logs.length === 4 && emits.length === 4, `expected one log/effect lane per expiry branch: ${logs.length}/${emits.length}`);
    for (let index = 0; index < logs.length; index += 1) {
      const storedPreview = logs[index]!.Insert.row.Object.preview.Variable;
      const emittedPreview = emits[index]!.Emit.payload.Object.body.Variable;
      assert(storedPreview === emittedPreview, `stored and emitted previews diverged in branch ${index}`);
    }
  });
  test("period digest reads current bounded selections and period-maintained activity atomically", async () => {
    const lowered = await lowerProject(fixture);
    assert(lowered.ok, JSON.stringify(lowered));
    const checked = rustCheck(lowered.project.programs, "synthetic", lowered.project.schema, undefined, lowered.project.effects);
    const job = operation(lowered.project.programs, "digest-recipes.periodDigestSweep");
    const certificate = checked.find((item) => item.program === job.name)!.certificate!;
    assert(certificate.kind === "job" && (certificate.perChunk as any[]).length === 2, JSON.stringify(certificate));
    const body = JSON.stringify(job.body);
    for (const required of ["digestFollows", "postPeriodCounters", "periodUnreadByRecipientPeriod", "periodChatsByRecipientPeriod", "digests", "pushLog", "push.notify"]) {
      assert(body.includes(required), `digest job lost ${required}`);
    }
    assert(!body.includes("unreadMessageTotals") && !body.includes("unreadChatCounts"), "digest job used standing unread totals");
    const source = readFileSync(resolve(fixture, "snapback/digest-recipes.q"), "utf8");
    const schema = readFileSync(resolve(fixture, "snapback/schema.q"), "utf8");
    assert(source.includes("digestFollows[p.principal] first 500 by byFollower")
      && source.includes("periodUnreadByRecipientPeriod[p.principal, periodStart]")
      && source.includes("periodChatsByRecipientPeriod[p.principal, periodStart]")
      && !source.includes("memberships[p.principal]"),
    "digest must count recipient activity without enumerating memberships");
    assert(schema.includes("cap 500 by follower") && schema.includes("cap 1000 by principal"), "digest pages are not storage-bounded");
    assert(source.includes("if cfg.replayMode = false:")
      && source.includes("if newFollowers != 0 or summary.newPostsInFollowing != 0 or summary.unreadMessages != 0 or summary.unreadChats != 0:"),
    "replay or quiet-period guard moved");
    assert(source.includes("digestEligible: cfg.replayMode = false")
      && source.includes("newFollowerPeriodCounts[p.principal, true, periodStart]"),
    "replay-created follows can leak into a later sweep in the same period");
    const follow = JSON.stringify(operation(lowered.project.programs, "digest-recipes.setRecipeFollow").body);
    assert(follow.includes("follows") && follow.includes("digestFollows") && follow.includes("Insert") && follow.includes("Delete"),
      "follow/mirror equality lost a transaction path");
    const post = JSON.stringify(operation(lowered.project.programs, "digest-recipes.createRecipePost").body);
    assert(post.includes("posts") && post.includes("postPeriodCounters") && post.includes("replayMode")
      && !post.includes("digestFollows") && !post.includes("For"), "post creation lost its follower-independent period counter");
    assert(source.includes("job periodDigestSweep(cutoff: time):")
      && source.indexOf("chunk row in periodUnread") > source.indexOf("chunk p in profiles")
      && source.includes("schedule recipeDigest every 2m: periodDigestSweep(.periodEnd)"),
    "period cutoff or post-digest prune ordering moved");
    assert(source.includes("row.periodStart < currentPeriodStart - cfg.digestPeriodMs"),
      "period unread prune can delete the active completed digest bucket");
    assert(source.includes("clearPeriodUnread(row.id)"), "prune must remove the final chat with its last unread row");
    assert((certificate.max_closure_bytes as number) < 2_000_000
      && (certificate.max_heap_bytes as number) < 3_000_000, "recipient digest lost its measured headroom");
    for (const name of ["message-recipes.send", "message-recipes.sendPhoto", "message-recipes.sendClip", "message-recipes.sendOncePhoto",
      "message-recipes.unsend", "admin.purgeMessage", "digest-recipes.clearRecipeUnread", "custody.leaveRecipeConversation", "custody.removeRecipeMember"]) {
      const writer = JSON.stringify(operation(lowered.project.programs, name).body);
      assert(writer.includes("periodUnread") && writer.includes("periodChats"), `${name} lost atomic chat custody`);
    }
    const deletion = JSON.stringify(operation(lowered.project.programs, "digest-recipes.deleteRecipePost").body);
    assert(deletion.includes("digestEligible") && deletion.includes("postPeriodCounters") && deletion.includes("Delete"),
      "post deletion must remove eligible period activity");
  });
  test("period schedules expose only typed logical boundary fields", async () => {
    const schema = readFileSync(resolve(fixture, "snapback/schema.q"), "utf8");
    const valid = `job sweep(cutoff: time):
  chunk p in profiles first 1 by byId:
    update profiles[p] { unreadMessages: 0 }

schedule digest every 2m: sweep(.periodEnd)
`;
    await withProject({ "snapback/schema.q": schema, "snapback/period.q": valid }, async (root) => {
      const lowered = await lowerProject(root);
      assert(lowered.ok, JSON.stringify(lowered));
      const schedule = lowered.project.schema.schedules![0]!;
      const binding = operation(lowered.project.programs, schedule.binding);
      assert(JSON.stringify(binding.args) === '{"periodEnd":"Time"}', JSON.stringify(binding));
    });
    for (const [argument, message] of [
      [".missing", "unknown period field"],
      [".periodEnd", "does not satisfy target bool"],
    ]) {
      const target = message.includes("bool") ? "enabled: bool" : "cutoff: time";
      const source = `job sweep(${target}):
  chunk p in profiles first 1 by byId:
    update profiles[p] { unreadMessages: 0 }

schedule digest every 2m: sweep(${argument})
`;
      await withProject({ "snapback/schema.q": schema, "snapback/period.q": source }, async (root) => {
        const lowered = await lowerProject(root);
        assert(!lowered.ok && JSON.stringify(lowered.diagnostics).includes(message), JSON.stringify(lowered));
      });
    }
  });
  test("Quarry schedules refuse non-time columns, bad targets, and sub-minute or calendar durations with the schedule family", async () => {
    const schema = readFileSync(resolve(fixture, "snapback/schema.q"), "utf8");
    const push = readFileSync(resolve(fixture, "snapback/push.ts"), "utf8");
    const admin = readFileSync(resolve(fixture, "snapback/admin.q"), "utf8");
    const base = admin.split("\nschedule dailyDigest")[0]! + "\n\nmutation purgeMessage(id: messages):\n  update messages[id] { body: null, expiresAt: null }\n  return null\n\nquery peek(id: messages):\n  return messages[id]\n\n";
    const withPhoto = schema;
    const cases: Array<[string, string, { rewrite?: string; message?: string; schema?: string }?]> = [
      ["schedule expire on messages at .body: purgeMessage(.id)\n", "E_SCHEDULE_COLUMN"],
      ["schedule expire on profiles at .expiresAt: purgeMessage(.id)\n", "E_SCHEDULE_COLUMN"],
      ["schedule expire on messages at .expiresAt: missing(.id)\n", "E_SCHEDULE_TARGET"],
      ["schedule expire on messages at .expiresAt: peek(.id)\n", "E_SCHEDULE_TARGET"],
      ["schedule expire on messages at .expiresAt: purgeMessage(.body)\n", "E_SCHEDULE_TARGET"],
      ["schedule expire on messages at .expiresAt: purgeMessage()\n", "E_SCHEDULE_TARGET"],
      ["schedule expire on messages at .expiresAt if .body: purgeMessage(.id)\n", "E_SCHEDULE_TARGET"],
      ["schedule daily every 24h: purgeMessage()\n", "E_SCHEDULE_TARGET"],
      ["schedule daily every 24h: digestSweep()\n\nschedule daily every 1h: digestSweep()\n", "E_SCHEDULE_TARGET", { rewrite: "-- give each schedule a unique name" }],
      ["schedule expire on messages at .expiresAt if .photo: purgeMessage(.id)\n", "E_SCHEDULE_TARGET", { message: "asset column", schema: withPhoto }],
      ["schedule daily every 30s: digestSweep()\n", "E_SCHEDULE_DURATION"],
      ["schedule daily every 0m: digestSweep()\n", "E_SCHEDULE_DURATION"],
      ["schedule daily every 1.5h: digestSweep()\n", "E_SCHEDULE_DURATION"],
      ["schedule daily at 09:00: digestSweep()\n", "E_SCHEDULE_DURATION"],
      ["schedule daily every 24h: digestSweep()\n\nschedule expire on messages at .expiresAt: purgeMessage(.id)\n", "ok"],
    ];
    for (const [source, code, expect] of cases) {
      await withProject({ "snapback/schema.q": expect?.schema ?? schema, "snapback/push.ts": push, "snapback/admin.q": base + source }, async (root) => {
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
        if (expect?.rewrite !== undefined) assert(first.rewrite === expect.rewrite, `${source}: rewrite ${JSON.stringify(first.rewrite)}`);
        if (expect?.message !== undefined) assert(first.message.includes(expect.message), `${source}: message ${JSON.stringify(first.message)}`);
      });
    }
  });
  test("Schedule guide snippets are the compiled fixture and the chat template's server-side expiry", async () => {
    const page = readFileSync(resolve(frontend, "../snapback3/guide/schedule.md"), "utf8");
    const snippets = [...page.matchAll(/```q\n([\s\S]*?)\n```/g)].map((match) => match[1]!);
    const admin = readFileSync(resolve(fixture, "snapback/admin.q"), "utf8");
    const digest = readFileSync(resolve(fixture, "snapback/digest-recipes.q"), "utf8");
    const messages = readFileSync(resolve(frontend, "../snapback3/templates/chat/snapback/messages.q"), "utf8");
    const schema = readFileSync(resolve(fixture, "snapback/schema.q"), "utf8");
    assert(snippets.length === 6 && snippets.every((snippet) =>
      [schema, admin, digest, messages].some((source) => source.includes(snippet))),
      "guide recipe diverged from its compiled fixture");
    assert(snippets.some((snippet) => snippet.includes("schedule utcDigest on digestClocks")),
      "guide lost its configured UTC row-clock recipe");
    const chat = await lowerProject(resolve(frontend, "../snapback3/templates/chat"));
    assert(chat.ok, JSON.stringify(chat));
    const schedules = chat.project.schema.schedules ?? [];
    assert(schedules.length === 1 && schedules[0]!.target === "messages._timerDelete_expireMessage", JSON.stringify(schedules));
    assert(!chat.apiDts.includes("purgeExpired"), "a client-invoked purge survived");
    assert(!chat.apiDts.includes("purgeMessage") && chat.apiDts.includes("unsend"), "the schedule target is not a client operation; unsend still is");
    assert(chat.apiDts.includes("expiresAt"), "post lost its expiry argument");
    const quarry = readFileSync(resolve(frontend, "../snapback3/guide/quarry.md"), "utf8");
    assert(!/E_QUARRY_UNSUPPORTED[^.]*`schedule`/.test(quarry) && quarry.includes("guide schedule"), "quarry.md still refuses schedule");
  });
}
