import { createHash } from "node:crypto";
import { multiplexFetch } from "./live-fixture.ts";
/**
 * A replay-aware owner double for the outbox suites: manifest, program
 * certificates, resume minting grants, mutations with the intent ledger
 * (dedup, 503-after-commit, rejection, conflict), and the delivery log.
 */
import { fileRangeStore } from "../dist/test.mjs";
import { canonicalProgramJson } from "../dist/sqlite-test.mjs";
import { schemaDigest } from "../dist/index.mjs";
import { searchQueryToken, searchWords } from "../dist/image-runtime.mjs";

export const generation = "d".repeat(64);
const namespace = "0".repeat(31) + "a";
export const DAY = 24 * 60 * 60 * 1_000;
const schema = {
  tables: {
    messages: {
      columns: { id: "Id", conversationId: "Id", authorId: "Principal", body: { Text: { max: 4000 } }, at: "Time" },
      indexes: { byId: { components: [{ Column: "id" }], unique: true } },
      rules: { read: "Allow", insert: "Allow", update: "Allow", delete: "Allow" },
      constraints: [],
      retain: "until-revoked",
    },
    deliveries: {
      columns: {
        id: "Id", recipient: "Principal", conversationId: "Id", messageId: "Id",
        kind: { Text: { max: 20 } }, at: "Time",
      },
      indexes: {
        byId: { components: [{ Column: "id" }], unique: true },
        byRecipientAt: { components: [{ Column: "recipient" }, { Column: "at" }, { Column: "id" }], unique: false },
        byRecipientConversationAt: {
          components: [{ Column: "recipient" }, { Column: "conversationId" }, { Column: "at" }, { Column: "id" }],
          unique: false,
        },
      },
      rules: { read: "Allow", insert: "Allow", update: "Allow", delete: "Allow" },
      constraints: [],
      retain: "until-revoked",
    },
  },
  maintains: [],
};
export const schemaHash = schemaDigest(schema);

const postIr = { name: "deliveries.post", kind: "Mutation", args: { body: { Text: { max: 4000 } }, conversationId: "Id" }, read_time_granularity_ms: null,
  body: [{ Insert: { table: "messages", row: { Object: { at: { Input: "Now" }, authorId: { Input: "Viewer" },
    body: { Variable: "body" }, conversationId: { Variable: "conversationId" }, id: { Input: "NewId" } } } } }] };
const editIr = { name: "deliveries.edit", kind: "Mutation", args: { messageId: { Ref: { table: "messages" } }, body: { Text: { max: 4000 } } },
  read_time_granularity_ms: null, body: [{ Update: { table: "messages", key: { Variable: "messageId" }, patch: { Object: { body: { Variable: "body" } } } } }] };
const digest = (ir: unknown) => createHash('sha256').update(canonicalProgramJson(ir)).digest('hex');
const certificate = (ir: unknown, kind: string) => ({
  plan_hash: digest(ir), schema_hash: schemaHash,
  mutation_targets: { complete: true, targets: [{ table: "messages", kind: kind === "Insert" ? "create" : "update",
    source: kind === "Insert" ? { newId: 0 } : { argument: "messageId" } }] },
  evaluator_version: 'bounded-spike-rust-search-text-refinements-5', value_model_version: 'i53-codepoint-bytes-unicode-search-text-refinements-v5',
  max_steps: 1000000, max_heap_bytes: 8388608, max_closure_bytes: 4194304, max_output_bytes: 1048576,
  write_sites: [{ table: 'messages', kind, max_rows: 1 }, { table: 'deliveries', kind: 'Insert', max_rows: 50 }],
});
const scanIr = (name: "deliveries.inbox" | "deliveries.inboxAlternate" | "deliveries.thread", cursor: string) => {
  const thread = name === "deliveries.thread";
  const row = "row";
  const field = (name: string) => ({ Field: { base: { Variable: row }, name } });
  return {
    name, kind: "Query", args: {
      ...(thread ? { conversationId: "Id" } : {}), [cursor]: { Optional: "Cursor" },
    }, read_time_granularity_ms: null,
    body: [
      { Const: { name: "page", value: { Scan: {
        site: `${name}.0`, table: "deliveries", index: thread ? "byRecipientConversationAt" : "byRecipientAt",
        prefix: [{ Scalar: { Input: "Viewer" } }, ...(thread ? [{ Scalar: { Variable: "conversationId" } }] : [])],
        order: thread ? "Desc" : "Asc", take: { Literal: 50 }, after: { Variable: cursor }, before: null,
        range: null, opaque_cursor: true, merge_site: null, provenance: thread ? "Shape" : "Viewer",
      } } } },
      { Const: { name: "rows", value: { Array: [] } } },
      { For: { binding: row, domain: { DerivedArray: { value: { Variable: "page" }, max: 50, bound_source: "page static bound" } }, body: [
        { Push: { target: "rows", value: { Object: {
          at: field("at"), conversationId: field("conversationId"), id: field("id"), kind: field("kind"),
          message: { Get: { site: `${name}.1`, table: "messages", index: "byId", key: [field("messageId")], provenance: "Shape" } },
          messageId: field("messageId"), recipient: field("recipient"),
        } } } },
      ] } },
      { Return: { Variable: "rows" } },
    ],
  };
};
const queryCertificate = (ir: ReturnType<typeof scanIr>) => {
  const scan = (ir.body[0] as any).Const.value.Scan;
  const inbox = ir.name !== "deliveries.thread";
  return {
    program: ir.name, plan_hash: digest(ir), schema_hash: schemaHash,
    tables: { deliveries: { retain: "until-revoked" }, messages: { retain: "until-revoked" } },
    rule_hashes: {
      "deliveries.read": "f6ddd28fe7b2931a7192f7b58e6aaaf98366f6d1d525aefca5dcb682d3f35e53",
      "messages.read": "f6ddd28fe7b2931a7192f7b58e6aaaf98366f6d1d525aefca5dcb682d3f35e53",
    },
    evaluator_version: 'bounded-spike-rust-search-text-refinements-5', value_model_version: 'i53-codepoint-bytes-unicode-search-text-refinements-v5',
    read_sites: [
      { site: scan.site, table: "deliveries", index: scan.index, prefix_template: inbox ? "Viewer" : "Shape", take: 50,
        max_calls: 1, rule_probes_per_candidate: 0, hoist: true, decided_true: true, complete: false },
      { site: `${ir.name}.1`, table: "messages", index: "byId", prefix_template: "Shape", take: 1,
        max_calls: 50, rule_probes_per_candidate: 0, hoist: false, complete: false },
    ],
    result_pages: { "3": { site: scan.site, table: "deliveries", index: scan.index, order: scan.order,
      suffix: [{ name: "at", kind: "Time" }, { name: "id", kind: "Id" }], merge: false } },
    write_sites: [], maintained_amplification: 0, constraint_checks: [], max_examined: 102, max_index_entries: 102,
    max_rule_probes: 0, max_steps: inbox ? 1320 : 1321, derived_steps: 0, derived_scratch_bytes: 0,
    max_heap_bytes: inbox ? 42240 : 42272, max_output_bytes: 866512, max_closure_bytes: 865900,
    completeness: "Page", prediction_sites: [], read_time_granularity_ms: null, halo_rows: 1,
    indexes_required: [`deliveries.${scan.index}`, "messages.byId"], disclosures: [],
    bound_product: `${scan.site} take 50 (+2 reserve) × 1 calls on deliveries = 52 + ${ir.name}.1 point read on messages × 50 calls (calls from page static bound 50) = 50`,
  };
};
const drainFrom = (certificate: ReturnType<typeof queryCertificate>, cursor: string) =>
  Object.values(certificate.result_pages)[0]!.order === "Asc" ? { cursor } : { reason: "descending" };
const defaultInbox = queryCertificate(scanIr("deliveries.inbox", "c"));
export const planHash = defaultInbox.plan_hash;

export function engineId(sequence: number): string {
  return `s2id-${namespace}-${sequence.toString(16).padStart(16, "0")}`;
}

const emptyReceipt = () => ({ ranges: [], absences: [], verdicts: [] });
const ref = (table: string, id: string) => ({ $row: { table, id } });

function json(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), { status, headers: { "content-type": "application/json" } });
}

function hang(): Response {
  return new Response(new ReadableStream({ start() {} }), { status: 200, headers: { "content-type": "text/event-stream" } });
}

export interface FakeOwnerOptions {
  /** Seed alice's log with `message-1` ("Welcome", conversation-1) and a delivery in conversation-2. */
  seed?: boolean;
  grantCount?: number;
  grantMintedAt?: () => number;
  /** Executes the intent, then answers 503 this many times (a 503 after a commit). */
  failAfterCommit?: number;
  /** Intents whose execution is a trace conflict. */
  conflict?: (intent: string, body: any) => boolean;
  /** Intents whose execution is an ordinary rejection. */
  reject?: (intent: string, body: any) => boolean;
  /** Replays the owner refuses outright (a coded 4xx envelope) instead of executing. */
  refuse?: (intent: string, body: any) => { status: number; envelope: Record<string, unknown> } | undefined;
  /** Refuses every request as a network failure. */
  dead?: () => boolean;
  /** Manifest name for the delivery log's optional Cursor argument; omitted by older outbox tests. */
  cursorArg?: string;
  /** The session epoch `/api/auth/me` reports (the real owner always does); omitted by older tests. */
  meEpoch?: number;
}

type Message = { id: string; conversationId: string; authorId: string; body: string; at: number };

function sse(frame: unknown): Response {
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(new TextEncoder().encode(`data: ${JSON.stringify(frame)}\n\n`));
    },
  });
  return new Response(stream, { status: 200, headers: { "content-type": "text/event-stream" } });
}

export function fakeOwner(options: FakeOwnerOptions = {}) {
  const executions: Array<{ op: string; args: unknown; intent: string; ids: string[] }> = [];
  const stored = new Map<string, unknown>();
  const requests: string[] = [];
  const messages = new Map<string, Message>();
  if (options.seed) {
    messages.set("message-1", { id: "message-1", conversationId: "conversation-1", authorId: "dev:alice", body: "Welcome", at: 2 });
    messages.set("message-2", { id: "message-2", conversationId: "conversation-2", authorId: "dev:alice", body: "Side note", at: 1 });
  }
  let seq = 5;
  let allocated = 100;
  let grants = 0;
  const state = { failAfterCommit: options.failAfterCommit ?? 0 };
  const apply = (op: string, args: any, ids: string[]): unknown => {
    if (op === "deliveries.post") {
      const id = ids[0]!;
      messages.set(id, { id, conversationId: args.conversationId, authorId: "dev:alice", body: args.body, at: Date.now() });
      return { id };
    }
    if (op === "deliveries.edit") {
      const message = messages.get(args.messageId);
      if (message) message.body = args.body;
      return null;
    }
    if (op === "deliveries.unsend") {
      messages.delete(args.messageId);
      return null;
    }
    return { id: ids[0] };
  };
  /** The delivery log page an op yields for alice, with its certified scan receipt. */
  const page = (op: string, args: any) => {
    if (op === "messages.search") {
      const term = searchQueryToken(String(args.term), 128);
      const data = term === null ? [] : [...messages.values()]
        .filter((message) => typeof message.body === "string" && searchWords(message.body, 4_000).some((word) => word.startsWith(term)))
        .sort((a, b) => b.at - a.at || (a.id < b.id ? 1 : -1))
        .slice(0, 20)
        .map((message) => ({ ...message }));
      // Search screen tests exercise the actual named operation and Unicode
      // contract. Real receipt admission and held evaluation live in the web,
      // Expo, and owner journeys rather than this delivery-log fixture.
      return { state: "complete", data, next: null, seq };
    }
    const inbox = op !== "deliveries.thread";
    const cursor = inbox ? (options.cursorArg ?? "c") : "c";
    const ir = scanIr(inbox ? op as "deliveries.inbox" | "deliveries.inboxAlternate" : "deliveries.thread", cursor);
    const cert = queryCertificate(ir);
    const wanted = [...messages.values()]
      .filter((message) => inbox || message.conversationId === args.conversationId)
      .sort((a, b) => inbox
        ? a.at - b.at || (a.id < b.id ? -1 : 1)
        : b.at - a.at || (a.id < b.id ? 1 : -1));
    const deliveries = wanted.map((message) => ({
      id: `delivery-${message.id}`, recipient: "dev:alice", conversationId: message.conversationId,
      messageId: message.id, kind: "message", at: message.at,
    }));
    const rows = [
      ...deliveries.map((delivery) => ({ table: "deliveries", id: delivery.id, row: delivery })),
      ...wanted.map((message) => ({ table: "messages", id: message.id, row: { ...message } })),
    ];
    const scan = (ir.body[0] as any).Const.value.Scan;
    return {
      protocol: 1, generation, schemaHash, planHash: cert.plan_hash,
      authority: { principal: "dev:alice", authEpoch: 7 }, state: "complete",
      data: deliveries.map((delivery) => ({ ...delivery, message: ref("messages", delivery.messageId) })),
      next: null, seq, rows,
      receipt: { ranges: [{
        site: scan.site, table: "deliveries", index: scan.index,
        prefix: [{ Scalar: "dev:alice" }, ...(inbox ? [] : [{ Scalar: args.conversationId }])],
        order: scan.order, take: 50, after: null, before: null, gt: null, gte: null, lt: null, lte: null,
        ruleHash: cert.rule_hashes["deliveries.read"], rowIds: deliveries.map(({ id }) => id),
        stop: "Exhausted", absence: deliveries.length === 0,
      }], absences: [], verdicts: [] },
      validator: String(seq).padStart(64, "0"),
    };
  };
  const mint = () => {
    const from = engineId(allocated);
    const count = options.grantCount ?? 8_192;
    allocated += count;
    grants += 1;
    const mintedAt = options.grantMintedAt?.() ?? Date.now();
    return { id: from, from, count, mintedAt, expiresAt: mintedAt + 30 * DAY };
  };
  const fetch = async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
    const url = new URL(String(input));
    requests.push(url.pathname);
    if (options.dead?.()) throw new TypeError("fetch failed");
    if (url.pathname === "/api/manifest") {
      const cursor = options.cursorArg ?? "c";
      const inboxIr = scanIr("deliveries.inbox", cursor);
      const inboxCert = queryCertificate(inboxIr);
      return json({
        generation: "schema-generation", programGeneration: generation,
        schemaHash, schema,
        ops: options.cursorArg ? {
          "deliveries.inbox": { kind: "query", planHash: inboxCert.plan_hash, drain: drainFrom(inboxCert, cursor), args: inboxIr.args },
        } : {},
        channels: {}, auth: {},
        tables: { messages: { retain: "delivered-history" } },
      });
    }
    if (url.pathname === "/api/program") {
      const cursor = options.cursorArg ?? "c";
      const inboxIr = scanIr("deliveries.inbox", cursor);
      const inboxCert = queryCertificate(inboxIr);
      const threadIr = scanIr("deliveries.thread", "c");
      const threadCert = queryCertificate(threadIr);
      const alternateIr = scanIr("deliveries.inboxAlternate", "c");
      const alternateCert = queryCertificate(alternateIr);
      return json({
        generation, schemaHash,
        schema,
        programs: {
          "deliveries.inbox": { kind: "query", planHash: inboxCert.plan_hash, drain: drainFrom(inboxCert, cursor), ir: inboxIr, certificate: inboxCert },
          "deliveries.inboxAlternate": { kind: "query", planHash: alternateCert.plan_hash, drain: drainFrom(alternateCert, "c"), ir: alternateIr, certificate: alternateCert },
          "deliveries.thread": { kind: "query", planHash: threadCert.plan_hash, drain: drainFrom(threadCert, "c"), ir: threadIr, certificate: threadCert },
          "deliveries.post": { kind: "mutation", planHash: certificate(postIr, 'Insert').plan_hash, ir: postIr, certificate: certificate(postIr, 'Insert') },
          "deliveries.edit": { kind: "mutation", planHash: certificate(editIr, 'Update').plan_hash, ir: editIr, certificate: certificate(editIr, 'Update') },
        },
      });
    }
    if (url.pathname === "/api/resume") {
      return json({
        seq, generation, schemaHash, authority: { principal: "dev:alice", authEpoch: 7 },
        log: { unchanged: true }, mounted: [], grant: mint(),
      });
    }
    // A login mints a grant like a resume does; the bearer flow is otherwise unchecked here.
    if (url.pathname === "/api/auth/login") return json({ token: "token-alice", viewer: "dev:alice", kind: "user", grant: mint() });
    // With `meEpoch`, the identity check reports the session epoch it authenticated, as the real owner does.
    if (url.pathname === "/api/auth/me") return json({ viewer: "dev:alice", kind: "user", ...(options.meEpoch === undefined ? {} : { authEpoch: options.meEpoch }) });
    if (url.pathname === "/api/mutation") {
      const body = JSON.parse(String(init?.body));
      if (!body.replay) {
        seq += 1;
        return json({ state: "committed", seq, data: apply(body.op, body.args, [engineId(allocated++)]) });
      }
      const intent = body.replay.intent as string;
      if (stored.has(intent)) return json(stored.get(intent));
      const refused = options.refuse?.(intent, body);
      if (refused) return json(refused.envelope, refused.status);
      const ids = Array.from({ length: body.replay.count as number }, (_, index) =>
        engineId(Number.parseInt(body.replay.grant.slice(-16), 16) + body.replay.offset + index));
      executions.push({ op: body.op, args: body.args, intent, ids });
      let response: unknown;
      if (options.conflict?.(intent, body)) {
        response = { state: "rejected", reason: "conflict", site: "deliveries.edit.messages[messageId]", intent };
      } else if (options.reject?.(intent, body)) {
        response = { state: "rejected", code: "NOT_MEMBER", family: "input", message: "E_REQUIRE:NOT_MEMBER: program requirement failed", rewrite: "fix the rejected mutation input and retry", guide: "input/runtime", intent };
      } else {
        seq += 1;
        response = { state: "committed", seq, data: apply(body.op, body.args, ids), intent, program: { planHash: digest(body.op === "deliveries.post" ? postIr : editIr), schemaHash } };
      }
      stored.set(intent, response);
      if (state.failAfterCommit > 0) {
        state.failAfterCommit -= 1;
        return json({ message: "upstream failed" }, 503);
      }
      return json(response);
    }
    if (url.pathname === "/api/query") {
      const body = JSON.parse(String(init?.body));
      return json(page(body.op, body.args));
    }
    if (url.pathname === "/api/subscribe") {
      const op = url.searchParams.get("op") ?? "";
      const args = JSON.parse(url.searchParams.get("args") ?? "{}");
      return sse(page(op, args));
    }
    return hang();
  };
  return { fetch: multiplexFetch(fetch), executions, stored, requests, state, messages, grantsMinted: () => grants };
}

export async function seededStore(factory: ReturnType<typeof fileRangeStore>): Promise<void> {
  const store = factory();
  await store.open("dev:alice");
  await store.commit({
    deliveries: [{
      op: "deliveries.inbox", args: { c: null }, state: "complete", data: [], next: null, seq: 3,
      validator: "1".repeat(64), rows: [], receipt: { ranges: [{
        site: "deliveries.inbox.0", table: "deliveries", index: "byRecipientAt", prefix: [{ Scalar: "dev:alice" }],
        order: "Asc", take: 50, after: null, before: null, gt: null, gte: null, lt: null, lte: null,
        ruleHash: defaultInbox.rule_hashes["deliveries.read"], rowIds: [], stop: "Exhausted", absence: true,
      }], absences: [], verdicts: [] },
    }],
    schema,
    watermark: {
      op: "deliveries.inbox", args: { c: null }, watermark: "cursor-9", validator: "1".repeat(64),
      generation, schemaHash, authEpoch: 7, updatedAt: 10,
    },
  });
  await store.close?.();
}
