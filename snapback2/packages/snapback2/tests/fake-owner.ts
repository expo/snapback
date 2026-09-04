/**
 * A replay-aware owner double for the outbox suites: manifest, program
 * certificates, resume minting grants, mutations with the intent ledger
 * (dedup, 503-after-commit, rejection, conflict), and the delivery log.
 */
import { fileRangeStore } from "../dist/test.mjs";
import { schemaDigest } from "../dist/index.mjs";

export const generation = "d".repeat(64);
export const planHash = "f".repeat(64);
const namespace = "0".repeat(31) + "a";
export const DAY = 24 * 60 * 60 * 1_000;
const schema = {
  tables: {
    messages: {
      columns: { id: "Id" },
      indexes: { byId: { columns: ["id"], unique: true } },
      rules: { read: "Allow", insert: "Allow", update: "Allow", delete: "Allow" },
      constraints: [],
      retain: "until-revoked",
    },
  },
  maintains: [],
};
export const schemaHash = schemaDigest(schema);

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
  /** The delivery log page an op yields for alice: one `message` row per held message. */
  const page = (op: string, args: any) => {
    const wanted = [...messages.values()]
      .filter((message) => op !== "deliveries.thread" || message.conversationId === args.conversationId)
      .sort((a, b) => b.at - a.at || (a.id < b.id ? 1 : -1));
    const rows = wanted.map((message) => ({ table: "messages", id: message.id, row: { ...message } }));
    return {
      protocol: 1, generation, schemaHash, planHash,
      authority: { principal: "dev:alice", authEpoch: 7 }, state: "complete",
      data: wanted.map((message) => ({
        id: `delivery-${message.id}`, recipient: "dev:alice", conversationId: message.conversationId,
        messageId: message.id, kind: "message", at: message.at, message: ref("messages", message.id),
      })),
      next: null, seq, rows, receipt: emptyReceipt(), validator: String(seq).padStart(64, "0"),
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
      return json({
        generation: "schema-generation", programGeneration: generation,
        ops: options.cursorArg ? {
          "deliveries.inbox": { kind: "query", planHash, args: { [options.cursorArg]: { Optional: "Cursor" } } },
        } : {},
        channels: {}, auth: {},
        tables: { messages: { retain: "delivered-history" } },
      });
    }
    if (url.pathname === "/api/program") {
      return json({
        generation, schemaHash,
        schema,
        programs: {
          "deliveries.post": {
            kind: "mutation", planHash, ir: {
              name: "deliveries.post", kind: "Mutation", args: {}, read_time_granularity_ms: null,
              body: [{ Insert: { table: "messages", row: { Object: { id: { Input: "NewId" } } } } }],
            },
            certificate: { plan_hash: planHash, write_sites: [
              { table: "messages", kind: "Insert", max_rows: 1 },
              { table: "deliveries", kind: "Insert", max_rows: 50 },
            ] },
          },
          "deliveries.edit": {
            kind: "mutation", planHash, ir: { body: [] },
            certificate: { plan_hash: planHash, write_sites: [
              { table: "messages", kind: "Update", max_rows: 1 },
              { table: "deliveries", kind: "Insert", max_rows: 50 },
            ] },
          },
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
    if (url.pathname === "/api/auth/login") return json({ token: "token-alice", viewer: "dev:alice", grant: mint() });
    if (url.pathname === "/api/auth/me") return json({ viewer: "dev:alice", kind: "user" });
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
        response = { state: "committed", seq, data: apply(body.op, body.args, ids), intent };
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
  return { fetch, executions, stored, requests, state, messages, grantsMinted: () => grants };
}

export async function seededStore(factory: ReturnType<typeof fileRangeStore>): Promise<void> {
  const store = factory();
  await store.open("dev:alice");
  await store.commit({
    deliveries: [{
      op: "deliveries.inbox", args: { c: null }, state: "complete", data: [], next: null, seq: 3,
      validator: "1".repeat(64), receipt: emptyReceipt(),
    }],
    watermark: {
      op: "deliveries.inbox", args: { c: null }, watermark: "cursor-9", validator: "1".repeat(64),
      generation, schemaHash, authEpoch: 7, updatedAt: 10,
    },
  });
  await store.close?.();
}
