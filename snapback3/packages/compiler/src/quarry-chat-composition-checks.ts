import { deepStrictEqual } from "node:assert";
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
  test("shipped chat functions compose one certified history view with derived custody", async () => {
    const productionRoot = resolve(frontend, "../snapback3/templates/chat");
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
      expiresAt: "Null", editedAt: "Null",
      at: { Int: 10 },
    });
    add("deliveries", "delivery-one", {
      recipient: viewer,
      conversationId: conversation,
      row: { Id: "message-one" },
      incarnation: { Int: 1 }, audience: { Int: 1 }, seq: { Int: 10 },
      kind: { String: "delivered" },
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
    }, ["message-two"]), false, certificate(post.name), true);
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
      && postedResult.messages[0]?.message?.id === "message-two"
      && postedResult.preview.length === 1
      && postedResult.preview[0]?.message?.id === "message-two",
    `post did not update messages/count/preview coherently: ${JSON.stringify(postedResult)}`);

    const end = store.reexecute(view, context({ conversationId: conversation,
      c: { String: afterPost.execution.next! } }), certificate(view.name));
    const endResult = wireJson(end.execution.result) as typeof postedResult;
    assert(end.state === "fresh" && end.execution.next === null && endResult.messages.length === 0,
      `the fixed preview stole the message-page continuation: ${JSON.stringify(end)}`);
    assert(endResult.count === postedResult.count && endResult.preview[0]?.message?.id === postedResult.preview[0]?.message?.id,
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
    assert(afterUnsend.state === "fresh" && removedResult.count === 1
      && removedResult.messages.length === 1 && removedResult.preview.length === 1,
    `unsend did not update history/count/preview coherently: ${JSON.stringify(afterUnsend)}`);

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
