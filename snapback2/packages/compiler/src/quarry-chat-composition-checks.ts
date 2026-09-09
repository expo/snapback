import { deepStrictEqual } from "node:assert";
import { cp, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import {
  ClientStore,
  scopedRuleHash,
  wireJson,
  type ClosureReceipt,
  type Context,
  type Value,
} from "../../evaluator/src/evaluator";
import { lowerProject } from "./project";
import { rustCheck } from "./rust-check";
import { assert, operation, type Test } from "./quarry-check-helpers";

export function registerQuarryChatCompositionChecks(test: Test, frontend: string): void {
  test("unused shipped chat merge retains its executable lane requirement and certifies", async () => {
    const root = await mkdtemp(resolve(tmpdir(), "snapback2-chat-merge-"));
    try {
      await cp(resolve(frontend, "../snapback2/templates/chat/snapback"), resolve(root, "snapback"), { recursive: true });
      const path = resolve(root, "snapback/messages.q");
      const source = await readFile(path, "utf8");
      const guard = "  require isMember(conversationId, viewer) else MEMBERSHIP_REQUIRED\n";
      await writeFile(path, source.replace(guard, guard
        + "  unused = merge messages last 1 by byConvTime:\n"
        + "    [(messages['message-1'] ! else HAS_MESSAGE).conversationId]\n"));
      const lowered = await lowerProject(root);
      assert(lowered.ok, `merge counterexample refused: ${JSON.stringify(lowered)}`);
      const thread = operation(lowered.project.programs, "messages.thread");
      const binding = thread.body.find(statement => "Const" in statement && "Merge" in statement.Const.value);
      assert(binding && "Const" in binding && "Merge" in binding.Const.value, "unused merge was not retained");
      const setup = binding.Const.value.Merge.lanes[0]!.setup!;
      assert(setup.some(statement => "Const" in statement && "Get" in statement.Const.value
        && statement.Const.value.Get.table === "messages"), JSON.stringify(setup));
      assert(setup.some(statement => "Require" in statement && statement.Require.code === "HAS_MESSAGE"), JSON.stringify(setup));
      const checked = rustCheck(lowered.project.programs, "synthetic", lowered.project.schema, undefined, lowered.project.effects);
      assert(checked.every(item => !item.error), `merge counterexample did not certify: ${JSON.stringify(checked.filter(item => item.error))}`);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  test("shipped chat functions compose one certified conversation view with honest tombstones", async () => {
    const productionRoot = resolve(frontend, "../snapback2/templates/chat");
    const lowered = await lowerProject(productionRoot);
    assert(lowered.ok, `shipped chat composition refused: ${JSON.stringify(lowered)}`);
    const checked = rustCheck(
      lowered.project.programs,
      "synthetic",
      lowered.project.schema,
      undefined,
      lowered.project.effects,
    );
    const failures = checked.filter((item) => item.error);
    assert(failures.length === 0, `shipped chat composition did not certify: ${JSON.stringify(failures)}`);
    const certificate = (name: string) => checked.find((item) => item.program === name)!.certificate!;
    const view = operation(lowered.project.programs, "messages.conversationView");
    const post = operation(lowered.project.programs, "messages.send");
    const targets = (name: string) => (certificate(name).mutation_targets as { targets: any[]; complete: boolean });
    deepStrictEqual(targets(post.name).targets.find(target => target.table === "messages"),
      { table: "messages", kind: "create", source: { newId: 0 } });
    deepStrictEqual(targets("messages.edit").targets.find(target => target.table === "messages"),
      { table: "messages", kind: "update", source: { argument: "messageId" } });
    deepStrictEqual(targets("messages.unsend").targets.find(target => target.table === "messages"),
      { table: "messages", kind: "remove", source: { argument: "messageId" } });
    assert(!targets(post.name).complete, "the named message target hid repeated delivery fan-out");
    const reordered = structuredClone(post);
    const extraSchema = structuredClone(lowered.project.schema);
    extraSchema.tables.audit = { columns: { id: "Id" }, indexes: { byId: { components: [{ Column: "id" }], unique: true } },
      rules: { read: "Allow", insert: "Allow", update: "Deny", delete: "Deny" }, constraints: [], retain: "until-revoked" };
    reordered.body.unshift({ Insert: { table: "audit", row: { Object: { id: { Input: "NewId" } } } } });
    const reorderedCheck = rustCheck(lowered.project.programs.map(program => program.name === post.name ? reordered : program),
      "synthetic", extraSchema, undefined, lowered.project.effects).find(result => result.program === post.name)!;
    assert(!reorderedCheck.error, `reordered mutation refused: ${JSON.stringify(reorderedCheck.error)}`);
    deepStrictEqual((reorderedCheck.certificate!.mutation_targets as any).targets.find((target: any) => target.table === "messages"),
      { table: "messages", kind: "create", source: { newId: 1 } });
    const unsend = operation(lowered.project.programs, "messages.unsend");
    assert(Object.keys(certificate(view.name).result_pages ?? {}).length === 1,
      `the composite lost its one cursor-bearing message page: ${JSON.stringify(certificate(view.name).result_pages)}`);

    const schema = lowered.project.schema;
    const viewer = { Id: "principal-alice" } as Value;
    const conversation = { Id: "conversation-one" } as Value;
    const rows: ClosureReceipt["rows"] = [];
    const add = (table: string, id: string, fields: Record<string, Value>) => rows.push({
      table,
      id,
      row: { Row: { id: { Id: id }, ...fields } },
    });
    add("memberships", "membership-alice", {
      conversationId: conversation,
      principal: viewer,
      role: { String: "admin" },
      joinedAt: { Int: 1 },
    });
    add("messages", "message-one", {
      conversationId: conversation,
      authorId: viewer,
      body: { String: "first" },
      photo: "Null",
      clip: "Null",
      oncePhoto: "Null",
      expiresAt: "Null",
      at: { Int: 10 },
    });
    add("deliveries", "delivery-one", {
      recipient: viewer,
      conversationId: conversation,
      messageId: { Id: "message-one" },
      kind: { String: "message" },
      at: { Int: 10 },
    });
    const countId = '[{"Id":"conversation-one"}]';
    add("messageCounts", countId, { conversationId: conversation, value: { Int: 1 } });

    const completeReceipt = receipt(schema, certificate(view.name).schema_hash as string, rows);
    const store = new ClientStore(schema, completeReceipt);
    const context = (args: Context["args"], newIds: string[] = [], now = 20): Context => ({
      viewer: "principal-alice",
      principal_kind: "user",
      auth_epoch: 1,
      args,
      now,
      new_ids: newIds,
      read_time: now,
    });

    const posted = store.applyMutation(post, context({
      conversationId: conversation,
      body: { String: "second" },
      expiresAt: "Null",
    }, ["message-two", "delivery-two"]), false, certificate(post.name));
    assert(posted.state === "predicted", `held post did not predict completely: ${JSON.stringify(posted)}`);
    const afterPost = store.reexecute(view, context({ conversationId: conversation, c: "Null" }), certificate(view.name));
    assert(afterPost.state === "fresh" && typeof afterPost.execution.next === "string",
      `composed view did not carry its certified message continuation: ${JSON.stringify(afterPost)}`);
    const postedResult = wireJson(afterPost.execution.result) as {
      messages: Array<{ id: string; message: { id: string } | null }>;
      count: number;
      preview: Array<{ id: string; message: { id: string } | null }>;
    };
    assert(postedResult.count === 2
      && postedResult.messages.length === 2
      && postedResult.messages[0]?.id === "delivery-two"
      && postedResult.messages[0]?.message?.id === "message-two"
      && postedResult.preview.length === 1
      && postedResult.preview[0]?.id === "delivery-two",
    `post did not update messages/count/preview coherently: ${JSON.stringify(postedResult)}`);

    const end = store.reexecute(view, context({ conversationId: conversation,
      c: { String: afterPost.execution.next! } }), certificate(view.name));
    const endResult = wireJson(end.execution.result) as typeof postedResult;
    assert(end.state === "fresh" && end.execution.next === null && endResult.messages.length === 0,
      `the fixed preview stole the message-page continuation: ${JSON.stringify(end)}`);
    assert(endResult.count === postedResult.count && endResult.preview[0]?.id === postedResult.preview[0]?.id,
      "an older message page keeps its coherent count and fixed latest preview");

    const removed = store.applyMutation(unsend, context({ messageId: { Id: "message-two" } }, ["delivery-removed"], 30),
      false, certificate(unsend.name));
    assert(removed.state === "predicted", `held unsend did not predict completely: ${JSON.stringify(removed)}`);
    const afterUnsend = store.reexecute(view, context({ conversationId: conversation, c: "Null" }, [], 30), certificate(view.name));
    const removedResult = wireJson(afterUnsend.execution.result) as {
      messages: Array<{ kind: string; message: unknown }>;
      count: number;
      preview: Array<{ kind: string; message: unknown }>;
    };
    assert(afterUnsend.state === "partial"
      && afterUnsend.partialSites.includes("messages.conversationView.3")
      && afterUnsend.partialSites.includes("messages.conversationView.5")
      && removedResult.count === 1 && removedResult.messages.length === 2
      && removedResult.messages[0]?.kind === "message" && removedResult.messages[0]?.message === null
      && removedResult.preview.length === 1 && removedResult.preview[0]?.kind === "message"
      && removedResult.preview[0]?.message === null,
    `tombstone preview or live message count was dishonest: ${JSON.stringify(afterUnsend)}`);

    const withoutMembership = new ClientStore(schema, receipt(
      schema,
      certificate(view.name).schema_hash as string,
      rows.filter((row) => row.table !== "memberships"),
    ));
    let denied: { code?: string; authoredCode?: string } | undefined;
    try {
      withoutMembership.reexecute(view, context({ conversationId: conversation, c: "Null" }), certificate(view.name));
    } catch (error) {
      denied = error as { code?: string; authoredCode?: string };
    }
    assert(denied?.code === "E_REQUIRE" && denied.authoredCode === "MEMBERSHIP_REQUIRED",
      `conversation view changed its membership refusal: ${JSON.stringify(denied)}`);

    const missingCountReceipt = receipt(
      schema,
      certificate(view.name).schema_hash as string,
      rows.filter((row) => row.table !== "messageCounts"),
      new Set(["messageCounts"]),
    );
    const missingCount = new ClientStore(schema, missingCountReceipt)
      .reexecute(view, context({ conversationId: conversation, c: "Null" }), certificate(view.name));
    assert(missingCount.state === "partial"
      && missingCount.partialSites.includes("messages.conversationView.4")
      && (wireJson(missingCount.execution.result) as { count: number }).count === 0,
    `missing maintained-count authority implied a complete zero: ${JSON.stringify(missingCount)}`);
  });
}

function receipt(
  schema: Record<string, any>,
  schemaHash: string,
  rows: ClosureReceipt["rows"],
  omitAuthority = new Set<string>(),
): ClosureReceipt {
  return {
    schema_hash: schemaHash,
    rows,
    ranges: Object.entries(schema.tables as Record<string, any>)
      .filter(([table]) => !omitAuthority.has(table))
      .map(([table, definition]) => ({
        site: `held.${table}`,
        table,
        index: "byId",
        prefix: [],
        order: "Asc" as const,
        take: 100,
        after: null,
        before: null,
        gt: null,
        gte: null,
        lt: null,
        lte: null,
        rule_hash: scopedRuleHash(schema, definition.rules.read),
        row_ids: rows.filter((row) => row.table === table).map((row) => row.id),
        stop: "Exhausted" as const,
        absence: false,
        halo: null,
        n2_suffix: null,
      })),
    absences: [],
    verdicts: [],
  };
}
