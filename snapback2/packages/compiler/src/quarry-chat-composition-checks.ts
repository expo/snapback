import { deepStrictEqual } from "node:assert";
import { readFileSync } from "node:fs";
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
  test("shipped chat functions compose one certified conversation view with honest tombstones", async () => {
    const productionRoot = resolve(frontend, "../snapback2/templates/chat");
    const fixtureRoot = resolve(frontend, "fixtures/quarry-chat");
    for (const file of ["access.q", "deliveries.q", "groups.q", "messages.q"]) {
      deepStrictEqual(
        readFileSync(resolve(productionRoot, "snapback", file), "utf8"),
        readFileSync(resolve(fixtureRoot, "snapback", file), "utf8"),
        `${file} drifted between the shipped chat and its compiler fixture`,
      );
    }

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
    const view = operation(lowered.project.programs, "deliveries.conversationView");
    const post = operation(lowered.project.programs, "deliveries.post");
    const unsend = operation(lowered.project.programs, "deliveries.unsend");
    assert(!certificate(view.name).result_pages,
      `object-composed conversation view acquired a root continuation: ${JSON.stringify(certificate(view.name).result_pages)}`);

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
    const afterPost = store.reexecute(view, context({ conversationId: conversation }), certificate(view.name));
    assert(afterPost.state === "fresh" && afterPost.execution.next === null,
      `composed view was not one complete root outcome: ${JSON.stringify(afterPost)}`);
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

    const removed = store.applyMutation(unsend, context({ messageId: { Id: "message-two" } }, ["delivery-removed"], 30),
      false, certificate(unsend.name));
    assert(removed.state === "predicted", `held unsend did not predict completely: ${JSON.stringify(removed)}`);
    const afterUnsend = store.reexecute(view, context({ conversationId: conversation }, [], 30), certificate(view.name));
    const removedResult = wireJson(afterUnsend.execution.result) as {
      messages: Array<{ kind: string; message: unknown }>;
      count: number;
      preview: Array<{ kind: string; message: unknown }>;
    };
    assert(afterUnsend.state === "partial"
      && afterUnsend.partialSites.includes("deliveries.conversationView.3")
      && afterUnsend.partialSites.includes("deliveries.conversationView.5")
      && removedResult.count === 1 && removedResult.messages.length === 3
      && removedResult.preview.length === 1 && removedResult.preview[0]?.kind === "removed"
      && removedResult.preview[0]?.message === null,
    `tombstone preview or live message count was dishonest: ${JSON.stringify(afterUnsend)}`);

    const withoutMembership = new ClientStore(schema, receipt(
      schema,
      certificate(view.name).schema_hash as string,
      rows.filter((row) => row.table !== "memberships"),
    ));
    let denied: { code?: string; authoredCode?: string } | undefined;
    try {
      withoutMembership.reexecute(view, context({ conversationId: conversation }), certificate(view.name));
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
      .reexecute(view, context({ conversationId: conversation }), certificate(view.name));
    assert(missingCount.state === "partial"
      && missingCount.partialSites.includes("deliveries.conversationView.4")
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
