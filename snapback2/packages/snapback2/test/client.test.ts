import assert from "node:assert/strict";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { once } from "node:events";
import { test, before, after } from "node:test";
import React from "react";
import TestRenderer, { act } from "react-test-renderer";
import {
  SnapbackRefusal,
  api,
  createClient,
  stableSerialize,
  type SnapbackClient,
} from "../dist/client.mjs";
import {
  SnapbackProvider,
  initialQueryState,
  reduceQueryState,
  useMutation,
  useQuery,
} from "../dist/react.mjs";

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

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

function fetchJson(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function fetchSse(...values: unknown[]): Response {
  const encoder = new TextEncoder();
  return new Response(new ReadableStream({
    start(controller) {
      for (const [index, value] of values.entries()) {
        controller.enqueue(encoder.encode(`id: ${index + 1}\ndata: ${JSON.stringify(value)}\n\n`));
      }
      controller.close();
    },
  }), { status: 200, headers: { "Content-Type": "text/event-stream" } });
}

function isWireShape(error: unknown, missing: string): boolean {
  return error instanceof SnapbackRefusal
    && error.code === "E_WIRE_SHAPE"
    && error.envelope.family === "op"
    && error.message.includes(missing);
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
  assert.equal(api.channels.typing.op, "channels.typing");
  assert.equal(api.channels.op.op, "channels.op");
  assert.equal(api.channels.then.op, "channels.then");
  assert.equal(api.channels.toJSON.op, "channels.toJSON");
  assert.deepEqual(JSON.parse(JSON.stringify(api.messages.thread)), { op: "messages.thread" });
});

test("api proxy preserves operations named like proxy metadata", async () => {
  const seen: string[] = [];
  const value = createClient({
    url: "http://wire.test",
    fetch: async (_input, init) => {
      seen.push(JSON.parse(String(init?.body)).op);
      return fetchJson({ state: "complete", seq: seen.length, data: true });
    },
  });
  for (const ref of [api.messages.op, api.messages.then, api.messages.toJSON, api.op.list, api.then.list, api.toJSON.list]) {
    assert.equal((await value.query(ref, {})).state, "complete");
  }
  assert.deepEqual(seen, ["messages.op", "messages.then", "messages.toJSON", "op.list", "then.list", "toJSON.list"]);
  value.close();
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

test("every HTTP wire state validates its state-specific required fields", async () => {
  const queryCases = [
    [{ state: "complete", seq: 1 }, "data"],
    [{ state: "capped", data: [], seq: 1, take: 1 }, "site"],
    [{ state: "partial", seq: 1 }, "reason"],
    [{ state: "denied", seq: 1 }, "rule"],
  ] as const;
  for (const [wire, missing] of queryCases) {
    const value = createClient({ url: "http://wire.test", fetch: async () => fetchJson(wire) });
    await assert.rejects(() => value.query(api.states.complete, {}), (error: unknown) => isWireShape(error, missing));
    value.close();
  }

  const mutationCases = [
    [{ state: "committed", seq: 1 }, "data"],
    [{ state: "rejected", family: "op", message: "no" }, "code"],
  ] as const;
  for (const [wire, missing] of mutationCases) {
    const value = createClient({ url: "http://wire.test", fetch: async () => fetchJson(wire) });
    await assert.rejects(() => value.mutation(api.messages.send, {}), (error: unknown) => isWireShape(error, missing));
    value.close();
  }

  const malformed4xx = createClient({
    url: "http://wire.test",
    fetch: async () => fetchJson({ family: "op", message: "missing code" }, 400),
  });
  await assert.rejects(
    () => malformed4xx.query(api.states.complete, {}),
    (error: unknown) => isWireShape(error, "code"),
  );
  malformed4xx.close();

  const authCases: Array<[(value: SnapbackClient) => Promise<unknown>, unknown, string]> = [
    [(value) => value.auth.guest(), { token: "token" }, "viewer"],
    [(value) => value.auth.logout(), {}, "ok"],
    [(value) => value.auth.me(), { viewer: "viewer" }, "kind"],
  ];
  for (const [run, wire, missing] of authCases) {
    const value = createClient({ url: "http://wire.test", fetch: async () => fetchJson(wire) });
    await assert.rejects(() => run(value), (error: unknown) => isWireShape(error, missing));
    value.close();
  }

  const manifest = createClient({
    url: "http://wire.test",
    fetch: async () => fetchJson({ generation: 1, ops: {}, auth: {} }),
  });
  await assert.rejects(() => manifest.manifest(), (error: unknown) => isWireShape(error, "channels"));
  manifest.close();

  const publishing = createClient({
    url: "http://wire.test",
    fetch: async () => fetchJson({ state: "refused" }),
  });
  await assert.rejects(
    () => publishing.channel(api.typing, {}).publish({ typing: true }),
    (error: unknown) => isWireShape(error, "code"),
  );
  publishing.close();
});

test("a no-op snapshot patch preserves object identity and does not notify", async () => {
  const value = client();
  await value.manifest();
  const snapshot = value.snapshot;
  let notifications = 0;
  const unsubscribe = value.subscribeStatus(() => { notifications += 1; });
  await value.manifest();
  assert.strictEqual(value.snapshot, snapshot);
  assert.equal(notifications, 1, "subscribeStatus should only make its initial delivery");
  unsubscribe();
});

test("malformed subscription and channel frames deliver E_WIRE_SHAPE", async (context) => {
  const queryCases = [
    [{ state: "live", seq: 1 }, "data"],
    [{ state: "partial", seq: 2 }, "reason"],
    [{ state: "stale", seq: 3 }, "since"],
    [{ state: "refused", seq: 4 }, "code"],
  ] as const;
  for (const [wire, missing] of queryCases) {
    const queryClient = createClient({
      url: "http://wire.test",
      fetch: async () => fetchSse(wire),
    });
    const querySub = queryClient.subscribe(api.messages.thread, {}, () => undefined);
    context.after(() => { querySub.close(); queryClient.close(); });
    const refused = await querySub.until((delivery) => delivery.state === "refused", 500);
    assert.equal(refused.code, "E_WIRE_SHAPE");
    assert.equal(refused.family, "op");
    assert.match(refused.message ?? "", new RegExp(missing));
    querySub.close();
    queryClient.close();
  }

  let channelDelivery: any;
  const channelClient = createClient({
    url: "http://wire.test",
    fetch: async () => fetchSse({ from: "alice", at: 1 }),
  });
  const channelSub = channelClient.channel(api.typing, {}).subscribe((event) => { channelDelivery = event; });
  context.after(() => { channelSub.close(); channelClient.close(); });
  await assert.rejects(
    () => channelSub.until(() => false, 500),
    (error: unknown) => isWireShape(error, "payload"),
  );
  assert.equal(channelDelivery.state, "refused");
  assert.equal(channelDelivery.code, "E_WIRE_SHAPE");
  channelSub.close();
  channelClient.close();
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

test("subscription loss never combines data and seq from different deliveries", async (context) => {
  const rows = [{ id: "message-1" }];
  const value = createClient({
    url: "http://wire.test",
    fetch: async () => fetchSse(
      { state: "live", seq: 3, data: rows },
      { state: "refused", seq: 4, code: "E_AUTH_REQUIRED", family: "auth", message: "login" },
    ),
  });
  const deliveries: any[] = [];
  const sub = value.subscribe(api.messages.thread, {}, (delivery) => deliveries.push(delivery));
  context.after(() => { sub.close(); value.close(); });
  const stale = await sub.until((delivery) => delivery.state === "stale", 500);
  assert.equal(stale.seq, 4);
  assert.equal("data" in stale, false);
  assert.equal(typeof stale.since, "number");
  assert.equal(deliveries[0]?.seq, 3);
  assert.equal(deliveries[1]?.state, "refused");
  sub.close();
  value.close();
});

test("channel publish and subscribe carry ephemeral payloads", async () => {
  const reader = client(externalUrl ? { as: "alice" } : {});
  const writer = client(externalUrl ? { as: "bob" } : {});
  if (!externalUrl) await Promise.all([reader.auth.guest(), writer.auth.guest()]);
  const args = { conversationId: externalUrl ? "conversation-1" : "general" };
  const receiving = reader.channel<typeof args, { typing: boolean }>(api.typing, args);
  const publishing = writer.channel<typeof args, { typing: boolean }>(api.channels.typing, args);
  const sub = receiving.subscribe(() => undefined);
  await new Promise((resolve) => setTimeout(resolve, 25));
  const next = sub.until((event) => event.payload.typing === true, 2_000);
  assert.deepEqual(await publishing.publish({ typing: true }), { ok: true });
  const event = await next;
  assert.deepEqual(event.payload, { typing: true });
  assert.ok(event.from.length > 0);
  sub.close();
});

test("terminal channel refusals reach callbacks and reject until immediately", async () => {
  const value = createClient({
    url: "http://wire.test",
    fetch: async () => fetchJson(refusal("E_AUTH_REQUIRED", "a session is required"), 401),
  });
  let delivered: any;
  const sub = value.channel(api.typing, { conversationId: "general" }).subscribe((event) => { delivered = event; });
  const started = Date.now();
  await assert.rejects(
    () => sub.until(() => false, 2_000),
    (error: unknown) => error instanceof SnapbackRefusal && error.code === "E_AUTH_REQUIRED",
  );
  assert.ok(Date.now() - started < 500, "until waited for its timeout instead of rejecting the refusal");
  assert.equal(delivered.state, "refused");
  assert.equal(delivered.code, "E_AUTH_REQUIRED");
  sub.close();
  value.close();
});

test("query and mutation throw every 4xx refusal while subscriptions deliver refused", async () => {
  const serve = new MockOwner("serve");
  await serve.start();
  const value = createClient({ url: serve.url, as: "alice" });
  await assert.rejects(
    () => value.query(api.messages.thread, { conversationId: "general" }),
    (error: unknown) => error instanceof SnapbackRefusal && error.code === "E_AUTH_PERSONA_NOT_DEV",
  );
  await assert.rejects(
    () => value.mutation(api.messages.send, { conversationId: "general", body: "hello" }),
    (error: unknown) => error instanceof SnapbackRefusal && error.code === "E_AUTH_PERSONA_NOT_DEV",
  );
  const sub = value.subscribe(api.messages.thread, { conversationId: "general" }, () => undefined);
  const refused = await sub.until((delivery) => delivery.state === "refused", 500);
  assert.equal(refused.code, "E_AUTH_PERSONA_NOT_DEV");
  sub.close();
  value.close();
  await serve.stop();
});

test("React query reducer preserves every discriminant field and only reuses a deep-equal whole view", () => {
  const hydrating = initialQueryState<Array<{ id: string }>>();
  assert.deepEqual(hydrating, { state: "hydrating" });
  const data = [{ id: "one" }];
  const live = reduceQueryState(hydrating, { state: "live", data, seq: 1 });
  const equivalent = reduceQueryState(live, { state: "live", data: [{ id: "one" }], seq: 1 });
  assert.strictEqual(equivalent, live);
  assert.strictEqual(equivalent.data, data);

  const stale = reduceQueryState(live, { state: "stale", since: 99, data, seq: 1 });
  assert.strictEqual(stale.data, data);
  assert.equal(stale.since, 99);

  const partial = reduceQueryState(stale, { state: "partial", seq: 2, reason: "coverage" });
  assert.deepEqual(partial, { state: "partial", seq: 2, reason: "coverage" });
  const denied = reduceQueryState(stale, { state: "denied", seq: 2, rule: "members only" });
  assert.deepEqual(denied, { state: "denied", seq: 2, rule: "members only" });
  const refused = reduceQueryState(stale, {
    state: "refused",
    code: "E_AUTH",
    family: "auth",
    message: "no",
    guide: "auth/session",
  });
  assert.deepEqual(refused, {
    state: "refused",
    refusal: { code: "E_AUTH", family: "auth", message: "no", guide: "auth/session" },
  });

  const capped = reduceQueryState(stale, { state: "capped", data, seq: 2, take: 1, site: "messages.scan" });
  const cappedEquivalent = reduceQueryState(capped, {
    state: "capped", data: [{ id: "one" }], seq: 2, take: 1, site: "messages.scan",
  });
  assert.strictEqual(cappedEquivalent, capped);
  const differentTake = reduceQueryState(capped, { state: "capped", data, seq: 2, take: 2, site: "messages.scan" });
  const differentSite = reduceQueryState(capped, { state: "capped", data, seq: 2, take: 1, site: "messages.other" });
  assert.notStrictEqual(differentTake, capped);
  assert.notStrictEqual(differentSite, capped);
  assert.equal(differentTake.take, 2);
  assert.equal(differentSite.site, "messages.other");

  assert.deepEqual(reduceQueryState(stale, { state: "complete", data, seq: 2 }), {
    state: "complete", data, seq: 2,
  });
  assert.equal(stableSerialize({ b: 2, a: [1] }), stableSerialize({ a: [1], b: 2 }));
});

test("useMutation exposes pending for exactly the in-flight interval", async () => {
  let release: ((response: Response) => void) | undefined;
  let current: any;
  const fetch = async (input: string | URL | Request) => {
    const path = new URL(String(input)).pathname;
    if (path === "/api/manifest") {
      return fetchJson({ generation: 1, ops: {}, channels: {}, auth: {} });
    }
    return await new Promise<Response>((resolve) => { release = resolve; });
  };
  function Harness() {
    current = useMutation(api.messages.send);
    return null;
  }
  let renderer: TestRenderer.ReactTestRenderer;
  await act(async () => {
    renderer = TestRenderer.create(React.createElement(
      SnapbackProvider,
      { url: "http://wire.test", fetch },
      React.createElement(Harness),
    ));
  });
  assert.equal(current.pending, false);
  assert.equal(current.last, undefined);
  let running!: Promise<unknown>;
  await act(async () => {
    running = current.run({ conversationId: "general", body: "hello" });
    await Promise.resolve();
  });
  assert.equal(current.pending, true);
  assert.equal(current.last, undefined);
  await act(async () => {
    release!(fetchJson({ state: "committed", seq: 1, data: { id: "message-1" } }));
    await running;
  });
  assert.equal(current.pending, false);
  assert.equal(current.last.state, "committed");
  await act(async () => { renderer!.unmount(); });
});

test("non-live useQuery keeps hydrating across a network failure, reports connection, and retries", async () => {
  let queryAttempts = 0;
  const fetch = async (input: string | URL | Request) => {
    const path = new URL(String(input)).pathname;
    if (path === "/api/manifest") {
      return fetchJson({ generation: 1, ops: {}, channels: {}, auth: {} });
    }
    if (path === "/api/query") {
      queryAttempts += 1;
      if (queryAttempts === 1) {
        await new Promise((resolve) => setTimeout(resolve, 10));
        throw new Error("offline once");
      }
      return fetchJson({ state: "complete", seq: 7, data: [{ id: "message-1" }] });
    }
    throw new Error(`unexpected route ${path}`);
  };
  const views: any[] = [];
  function Harness() {
    const view = useQuery(api.messages.thread, { conversationId: "general" }, { live: false });
    views.push(view);
    return null;
  }
  let renderer: TestRenderer.ReactTestRenderer;
  await act(async () => {
    renderer = TestRenderer.create(React.createElement(
      SnapbackProvider,
      { url: "http://wire.test", fetch },
      React.createElement(Harness),
    ));
  });
  await act(async () => { await new Promise((resolve) => setTimeout(resolve, 350)); });
  assert.equal(queryAttempts, 2);
  assert.ok(views.some((view) => view.state === "hydrating" && view.connection === "reconnecting"));
  const final = views.at(-1);
  assert.equal(final.state, "complete");
  assert.equal(final.connection, "connected");
  assert.ok(!views.some((view) => view.state === "refused" && view.refusal?.code === "E_NETWORK"));
  await act(async () => { renderer!.unmount(); });
});

test("separately bundled client and React entry points share generated API references", async () => {
  const bundledClient: any = await import("../dist/client.mjs");
  const bundledReact: any = await import("../dist/react.mjs");
  let operation: string | undefined;
  const fetch = async (input: string | URL | Request, init?: RequestInit) => {
    const path = new URL(String(input)).pathname;
    if (path === "/api/manifest") return fetchJson({ generation: 1, ops: {}, channels: {}, auth: {} });
    operation = JSON.parse(String(init?.body)).op;
    return fetchJson({ state: "complete", seq: 1, data: [] });
  };
  function Harness() {
    bundledReact.useQuery(bundledClient.api.messages.thread, {}, { live: false });
    return null;
  }
  let renderer: TestRenderer.ReactTestRenderer;
  await act(async () => {
    renderer = TestRenderer.create(React.createElement(
      bundledReact.SnapbackProvider,
      { url: "http://wire.test", fetch },
      React.createElement(Harness),
    ));
    await new Promise((resolve) => setTimeout(resolve, 10));
  });
  assert.equal(operation, "messages.thread");
  await act(async () => { renderer!.unmount(); });
});
