import assert from "node:assert/strict";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { once } from "node:events";
import { test, before, after } from "node:test";
import {
  SnapbackRefusal,
  api,
  createClient,
  stableSerialize,
  type SnapbackClient,
} from "../dist/client.mjs";
import { initialQueryState, reduceQueryState } from "../dist/react.mjs";

type Session = { viewer: string; kind: string };
type QueryStream = { response: ServerResponse; op: string; args: unknown };
type ChannelStream = { response: ServerResponse; key: string };

const refusal = (code: string, message: string) => ({
  code,
  family: code.startsWith("E_AUTH") ? "auth" : "op",
  message,
  guide: code.startsWith("E_AUTH") ? "auth/session" : "op/reference",
});

async function body(request: IncomingMessage): Promise<any> {
  const chunks: Buffer[] = [];
  for await (const chunk of request) chunks.push(Buffer.from(chunk));
  return chunks.length === 0 ? {} : JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

function json(response: ServerResponse, status: number, value: unknown): void {
  response.writeHead(status, {
    "Access-Control-Allow-Origin": "*",
    "Content-Type": "application/json",
  });
  response.end(JSON.stringify(value));
}

function channelKey(name: string, args: unknown): string {
  return `${name}:${stableSerialize(args)}`;
}

class MockOwner {
  readonly mode: "dev" | "serve";
  readonly rows: Array<{ id: string; conversationId: string; body: string }> = [];
  readonly lastEventIds: string[] = [];
  readonly personaHeaders: string[] = [];
  private server: Server | undefined;
  private port: number | undefined;
  private seq = 0;
  private tokenCounter = 0;
  private rowCounter = 0;
  private readonly tokens = new Map<string, Session>();
  private readonly accounts = new Map<string, { password: string; viewer: string }>();
  private readonly queryStreams = new Set<QueryStream>();
  private readonly channelStreams = new Set<ChannelStream>();
  private readonly sockets = new Set<import("node:net").Socket>();

  constructor(mode: "dev" | "serve" = "dev") {
    this.mode = mode;
  }

  get url(): string {
    if (this.port === undefined) throw new Error("mock owner is not started");
    return `http://127.0.0.1:${this.port}`;
  }

  async start(): Promise<void> {
    if (this.server) return;
    const server = createServer((request, response) => {
      void this.handle(request, response).catch((error) => {
        if (!response.headersSent) json(response, 500, refusal("E_OWNER_MOCK", String(error)));
        else response.destroy(error instanceof Error ? error : new Error(String(error)));
      });
    });
    server.on("connection", (socket) => {
      this.sockets.add(socket);
      socket.on("close", () => this.sockets.delete(socket));
    });
    server.listen(this.port ?? 0, "127.0.0.1");
    await once(server, "listening");
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("mock owner has no TCP address");
    this.port = address.port;
    this.server = server;
  }

  async stop(): Promise<void> {
    const server = this.server;
    if (!server) return;
    this.server = undefined;
    for (const stream of this.queryStreams) stream.response.destroy();
    for (const stream of this.channelStreams) stream.response.destroy();
    this.queryStreams.clear();
    this.channelStreams.clear();
    for (const socket of this.sockets) socket.destroy();
    server.close();
    await once(server, "close");
  }

  private session(request: IncomingMessage): Session | undefined {
    const persona = request.headers["x-snapback-as"];
    if (typeof persona === "string" && this.mode === "dev") {
      this.personaHeaders.push(persona);
      return { viewer: persona, kind: "persona" };
    }
    const authorization = request.headers.authorization;
    return authorization?.startsWith("Bearer ") ? this.tokens.get(authorization.slice(7)) : undefined;
  }

  private mint(viewer: string, kind: string): { token: string; viewer: string } {
    const token = `token-${++this.tokenCounter}`;
    this.tokens.set(token, { viewer, kind });
    return { token, viewer };
  }

  private openSse(response: ServerResponse): void {
    response.writeHead(200, {
      "Access-Control-Allow-Origin": "*",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
      "Content-Type": "text/event-stream",
    });
    response.write(": heartbeat\n\n");
  }

  private sendQuery(stream: QueryStream): void {
    if (stream.response.destroyed) return;
    stream.response.write(`id: ${this.seq}\n`);
    stream.response.write(`data: ${JSON.stringify({ state: "live", seq: this.seq, data: this.rows })}\n\n`);
  }

  private broadcastQueries(): void {
    for (const stream of this.queryStreams) this.sendQuery(stream);
  }

  private async handle(request: IncomingMessage, response: ServerResponse): Promise<void> {
    const parsed = new URL(request.url ?? "/", this.url);
    const persona = request.headers["x-snapback-as"];
    if (this.mode === "serve" && typeof persona === "string" && parsed.pathname.startsWith("/api/")) {
      json(response, 403, refusal("E_AUTH_PERSONA_NOT_DEV", "development personas are refused by serve mode"));
      return;
    }

    if (request.method === "GET" && parsed.pathname === "/") {
      json(response, 200, { ok: true, version: "0.0.1", generation: 1, mode: this.mode, url: this.url });
      return;
    }
    if (request.method === "POST" && parsed.pathname === "/api/auth/guest") {
      json(response, 200, this.mint(`guest-${this.tokenCounter + 1}`, "guest"));
      return;
    }
    if (request.method === "POST" && parsed.pathname === "/api/auth/signup") {
      const input = await body(request);
      const viewer = `user-${this.accounts.size + 1}`;
      this.accounts.set(input.email, { password: input.password, viewer });
      json(response, 200, this.mint(viewer, "user"));
      return;
    }
    if (request.method === "POST" && parsed.pathname === "/api/auth/login") {
      const input = await body(request);
      const account = this.accounts.get(input.email);
      if (!account || account.password !== input.password) {
        json(response, 401, refusal("E_AUTH_LOGIN", "email or password did not match"));
      } else {
        json(response, 200, this.mint(account.viewer, "user"));
      }
      return;
    }
    if (request.method === "POST" && parsed.pathname === "/api/auth/logout") {
      json(response, 200, { ok: true });
      return;
    }
    if (request.method === "GET" && parsed.pathname === "/api/auth/me") {
      const session = this.session(request);
      if (!session) json(response, 401, refusal("E_AUTH_REQUIRED", "a session is required"));
      else json(response, 200, session);
      return;
    }
    if (request.method === "GET" && parsed.pathname === "/api/manifest") {
      json(response, 200, {
        generation: 1,
        ops: { "messages.thread": { kind: "query", args: { conversationId: "id" } } },
        channels: { typing: { args: { conversationId: "id" } } },
        auth: { password: true, guests: true },
      });
      return;
    }
    if (request.method === "POST" && parsed.pathname === "/api/query") {
      const input = await body(request);
      if (input.op === "states.complete" || input.op === "messages.thread") {
        json(response, 200, { state: "complete", data: this.rows, seq: this.seq });
      } else if (input.op === "states.capped") {
        json(response, 200, { state: "capped", data: this.rows, seq: this.seq, take: 1, site: "messages.scan" });
      } else if (input.op === "states.partial") {
        json(response, 200, { state: "partial", data: this.rows, seq: this.seq, reason: "coverage" });
      } else if (input.op === "states.denied") {
        json(response, 200, { state: "denied", data: [], seq: this.seq, rule: "members only" });
      } else {
        json(response, 404, refusal("E_OP_UNKNOWN", `unknown operation ${input.op}`));
      }
      return;
    }
    if (request.method === "POST" && parsed.pathname === "/api/mutation") {
      const input = await body(request);
      if (input.op === "messages.reject" || input.args?.body === "reject") {
        json(response, 200, { state: "rejected", ...refusal("E_REQUIRE:REJECTED", "mutation rejected") });
        return;
      }
      if (input.op !== "messages.send") {
        json(response, 404, refusal("E_OP_UNKNOWN", `unknown operation ${input.op}`));
        return;
      }
      const id = `message-${++this.rowCounter}`;
      this.rows.push({ id, conversationId: input.args.conversationId, body: input.args.body });
      this.seq += 1;
      json(response, 200, { state: "committed", seq: this.seq, data: { id } });
      queueMicrotask(() => this.broadcastQueries());
      return;
    }
    if (request.method === "GET" && parsed.pathname === "/api/subscribe") {
      const stream = {
        response,
        op: parsed.searchParams.get("op") ?? "",
        args: JSON.parse(parsed.searchParams.get("args") ?? "{}"),
      };
      const lastEventId = request.headers["last-event-id"];
      if (typeof lastEventId === "string") this.lastEventIds.push(lastEventId);
      this.openSse(response);
      this.queryStreams.add(stream);
      response.on("close", () => this.queryStreams.delete(stream));
      queueMicrotask(() => this.sendQuery(stream));
      return;
    }

    const channel = /^\/api\/channel\/([^/]+)\/(publish|subscribe)$/.exec(parsed.pathname);
    if (channel) {
      const name = decodeURIComponent(channel[1]);
      if (request.method === "GET" && channel[2] === "subscribe") {
        const args = JSON.parse(parsed.searchParams.get("args") ?? "{}");
        const stream = { response, key: channelKey(name, args) };
        this.openSse(response);
        this.channelStreams.add(stream);
        response.on("close", () => this.channelStreams.delete(stream));
        return;
      }
      if (request.method === "POST" && channel[2] === "publish") {
        const input = await body(request);
        const session = this.session(request);
        if (!session) {
          json(response, 200, { state: "refused", code: "E_AUTH_REQUIRED" });
          return;
        }
        const event = { from: session.viewer, payload: input.payload, at: Date.now() };
        for (const stream of this.channelStreams) {
          if (stream.key === channelKey(name, input.args) && !stream.response.destroyed) {
            stream.response.write(`data: ${JSON.stringify(event)}\n\n`);
          }
        }
        json(response, 200, { ok: true });
        return;
      }
    }
    json(response, 404, refusal("E_OP_UNKNOWN", `${request.method} ${parsed.pathname}`));
  }
}

const externalUrl = process.env.SNAPBACK_URL;
const owner = new MockOwner();
let url = externalUrl ?? "";
const clients = new Set<SnapbackClient>();

function client(options: Record<string, unknown> = {}): SnapbackClient {
  const value = createClient({ url, ...options });
  clients.add(value);
  return value;
}

before(async () => {
  if (!externalUrl) {
    await owner.start();
    url = owner.url;
  }
});

after(async () => {
  for (const value of clients) value.close();
  if (!externalUrl) await owner.stop();
});

test("api proxy produces inert qualified operation references", () => {
  assert.equal(api.messages.thread.op, "messages.thread");
  assert.deepEqual(JSON.parse(JSON.stringify(api.messages.thread)), { op: "messages.thread" });
});

test("guest, signup, login, logout, me, token memory, and persistence", async () => {
  const persisted: Array<string | null> = [];
  const guestClient = client({ persist: (token: string | null) => persisted.push(token) });
  const guest = await guestClient.auth.guest();
  assert.ok(guest.token.length > 0);
  assert.equal((await guestClient.auth.me()).kind, "guest");
  assert.equal(guestClient.snapshot.token, guest.token);
  assert.equal((await guestClient.auth.logout()).ok, true);
  assert.equal(guestClient.snapshot.token, undefined);
  assert.deepEqual(persisted, [guest.token, null]);
  await assert.rejects(() => guestClient.auth.me(), (error: unknown) =>
    error instanceof SnapbackRefusal && error.envelope.code === "E_AUTH_REQUIRED");

  const signupClient = client();
  const email = `lane-d-${Date.now()}@example.com`;
  const signup = await signupClient.auth.signup({ email, password: "correct horse" });
  assert.equal((await signupClient.auth.me()).viewer, signup.viewer);
  const loginClient = client();
  const login = await loginClient.auth.login({ email, password: "correct horse" });
  assert.equal(login.viewer, signup.viewer);
});

test("query returns every typed read state and refuses 4xx/network as envelopes", async () => {
  const value = client(externalUrl ? { as: "alice" } : {});
  if (!externalUrl) await value.auth.guest();
  const manifest = await value.manifest();
  assert.equal(manifest.generation, 1);
  assert.equal(manifest.ops["messages.thread"]?.kind, "query");
  if (externalUrl) {
    const result = await value.query(api.messages.thread, { conversationId: "conversation-1" });
    assert.ok(["complete", "capped", "partial", "denied"].includes(result.state));
  } else {
    for (const state of ["complete", "capped", "partial", "denied"] as const) {
      const result = await value.query(api.states[state], {});
      assert.equal(result.state, state);
    }
  }
  await assert.rejects(() => value.query(api.states.missing, {}), (error: unknown) =>
    error instanceof SnapbackRefusal && error.envelope.code === "E_OP_UNKNOWN");
  const offline = createClient({
    url,
    fetch: async () => { throw new Error("offline on purpose"); },
  });
  await assert.rejects(() => offline.query(api.states.complete, {}), (error: unknown) =>
    error instanceof SnapbackRefusal && error.envelope.code === "E_NETWORK");
  offline.close();
});

test("mutation returns committed and rejected without throwing rejected", async () => {
  const value = client(externalUrl ? { as: "alice" } : {});
  if (!externalUrl) await value.auth.guest();
  const committed = await value.mutation(api.messages.send, {
    conversationId: externalUrl ? "conversation-1" : "general",
    recipientId: externalUrl ? "dev:bob" : undefined,
    body: `first-${Date.now()}`,
  });
  assert.equal(committed.state, "committed");
  const rejected = externalUrl
    ? await value.mutation(api.messages.send, {
        conversationId: "conversation-1",
        recipientId: "dev:missing",
        body: "reject",
      })
    : await value.mutation(api.messages.reject, { body: "reject" });
  assert.equal(rejected.state, "rejected");
  if (rejected.state === "rejected") assert.equal(rejected.code, "E_REQUIRE:REJECTED");
});

test("subscription observes another client's mutation and until resolves", async () => {
  const reader = client(externalUrl ? { as: "alice" } : {});
  const writer = client(externalUrl ? { as: "bob" } : {});
  if (!externalUrl) await Promise.all([reader.auth.guest(), writer.auth.guest()]);
  const conversationId = externalUrl ? "conversation-1" : "general";
  const seen: string[] = [];
  const sub = reader.subscribe(api.messages.thread, { conversationId }, (delivery) => seen.push(delivery.state));
  const initial = await sub.until((delivery) => delivery.state === "live", 2_000);
  assert.equal(initial.state, "live");
  const initialSeq = initial.state === "live" ? initial.seq : -1;
  const body = `from-writer-${Date.now()}`;
  const committed = await writer.mutation(api.messages.send, {
    conversationId,
    recipientId: externalUrl ? "dev:alice" : undefined,
    body,
  });
  assert.equal(committed.state, "committed");
  const updated = await sub.until((delivery) =>
    delivery.state === "live" && delivery.seq > initialSeq && delivery.data.some((row: any) => row.body === body), 2_000);
  assert.equal(updated.state, "live");
  assert.ok(seen.filter((state) => state === "live").length >= 2);
  sub.close();
});

test("subscription reconnect reports stale, resumes with Last-Event-ID, then reports live", async (context) => {
  if (externalUrl) return context.skip("owner process control is supplied in the second integration round");
  const value = client();
  await value.auth.guest();
  const sub = value.subscribe(api.messages.thread, { conversationId: "general" }, () => undefined);
  const initial = await sub.until((delivery) => delivery.state === "live", 2_000);
  assert.equal(initial.state, "live");
  const initialSeq = initial.state === "live" ? initial.seq : -1;
  const stale = sub.until((delivery) => delivery.state === "stale", 2_000);
  await owner.stop();
  assert.equal((await stale).state, "stale");
  await owner.start();
  const resumed = await sub.until((delivery) => delivery.state === "live", 4_000);
  assert.equal(resumed.state, "live");
  assert.ok(owner.lastEventIds.includes(String(initialSeq)));
  sub.close();
});

test("channel publish and subscribe carry ephemeral payloads", async () => {
  const reader = client(externalUrl ? { as: "alice" } : {});
  const writer = client(externalUrl ? { as: "bob" } : {});
  if (!externalUrl) await Promise.all([reader.auth.guest(), writer.auth.guest()]);
  const args = { conversationId: externalUrl ? "conversation-1" : "general" };
  const receiving = reader.channel<{ typing: boolean }>(api.typing, args);
  const publishing = writer.channel<{ typing: boolean }>(api.typing, args);
  const sub = receiving.subscribe(() => undefined);
  await new Promise((resolve) => setTimeout(resolve, 25));
  const next = sub.until((event) => event.payload.typing === true, 2_000);
  assert.deepEqual(await publishing.publish({ typing: true }), { ok: true });
  const event = await next;
  assert.deepEqual(event.payload, { typing: true });
  assert.ok(event.from.length > 0);
  sub.close();
});

test("serve mode turns X-Snapback-As into a refused state", async () => {
  const serve = new MockOwner("serve");
  await serve.start();
  const value = createClient({ url: serve.url, as: "alice" });
  const result = await value.query(api.messages.thread, { conversationId: "general" });
  assert.equal(result.state, "refused");
  if (result.state === "refused") assert.equal(result.code, "E_AUTH_PERSONA_NOT_DEV");
  value.close();
  await serve.stop();
});

test("React query reducer exposes eight states and preserves data identity", () => {
  const hydrating = initialQueryState<Array<{ id: string }>>();
  assert.equal(hydrating.state, "hydrating");
  const data = [{ id: "one" }];
  const live = reduceQueryState(hydrating, { state: "live", data, seq: 1 });
  const equivalent = reduceQueryState(live, { state: "live", data: [{ id: "one" }], seq: 1 });
  assert.strictEqual(equivalent, live);
  assert.strictEqual(equivalent.data, data);
  const stale = reduceQueryState(live, { state: "stale", since: Date.now(), seq: 1 });
  assert.strictEqual(stale.data, data);
  assert.equal(reduceQueryState(stale, { state: "partial", data, seq: 2 }).state, "partial");
  assert.equal(reduceQueryState(stale, { state: "denied", data: [], seq: 2 }).state, "denied");
  assert.equal(reduceQueryState(stale, {
    state: "refused",
    code: "E_AUTH",
    family: "auth",
    message: "no",
    guide: "auth/session",
  }).state, "refused");
  assert.equal(reduceQueryState(stale, { state: "capped", data, seq: 2, take: 1 }).state, "capped");
  assert.equal(reduceQueryState(stale, { state: "complete", data, seq: 2 }).state, "complete");
  assert.equal(stableSerialize({ b: 2, a: [1] }), stableSerialize({ a: [1], b: 2 }));
});
