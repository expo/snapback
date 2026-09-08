import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { once } from "node:events";
import { randomBytes } from "node:crypto";
import { stableSerialize } from "../dist/client.mjs";

type Session = { viewer: string; kind: string };
type QueryStream = { response: ServerResponse; op: string; args: unknown };
type ChannelStream = {
  response: ServerResponse; room: string; key: string; lease: string;
  from: string; version: number; entry?: { key: string; from: string; value: unknown; expiresAt: number };
};

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

export class MockOwner {
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

  private mint(viewer: string, kind: string): { token: string; viewer: string; kind: string } {
    const token = `token-${++this.tokenCounter}`;
    this.tokens.set(token, { viewer, kind });
    return { token, viewer, kind };
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

  private queryResult(op: string): unknown {
    if (op === "states.capped") {
      return { state: "capped", data: this.rows, seq: this.seq, next: null };
    }
    if (op === "states.partial") {
      return { state: "partial", data: this.rows, seq: this.seq, reason: "coverage" };
    }
    if (op === "states.denied") {
      return { state: "denied", seq: this.seq, rule: "members only" };
    }
    return { state: "complete", data: this.rows, seq: this.seq, next: null };
  }

  private sendQuery(stream: QueryStream): void {
    if (stream.response.destroyed) return;
    stream.response.write(`id: ${this.seq}\n`);
    stream.response.write(`data: ${JSON.stringify(this.queryResult(stream.op))}\n\n`);
  }

  private broadcastQueries(): void {
    for (const stream of this.queryStreams) this.sendQuery(stream);
  }

  private broadcastChannel(room: string): void {
    const streams = [...this.channelStreams].filter(stream => stream.room === room && !stream.response.destroyed);
    const entries = streams.flatMap(stream => stream.entry ? [stream.entry] : []).sort((a, b) => a.key.localeCompare(b.key));
    for (const stream of streams) stream.response.write(`data: ${JSON.stringify({
      state: "snapshot", key: stream.key, lease: stream.lease, entries,
    })}\n\n`);
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
        generation: "mock-generation",
        programGeneration: "mock-program-generation",
        ops: { "messages.thread": { kind: "query", args: { conversationId: "id" }, planHash: "mock-plan" } },
        channels: { typing: { args: { conversationId: "id" }, value: { typing: "Bool" }, ttl_ms: 4000 } },
        auth: { password: true, guests: true },
      });
      return;
    }
    if (request.method === "POST" && parsed.pathname === "/api/query") {
      const input = await body(request);
      if (!["states.complete", "states.capped", "states.partial", "states.denied", "messages.thread"].includes(input.op)) {
        json(response, 404, refusal("E_OP_UNKNOWN", `unknown operation ${input.op}`));
      } else {
        json(response, 200, this.queryResult(input.op));
      }
      return;
    }
    if (request.method === "POST" && parsed.pathname === "/api/mutation") {
      const input = await body(request);
      if (input.op === "messages.reject" || input.args?.body === "reject") {
        json(response, 200, { state: "rejected", ...refusal("RECIPIENT_UNKNOWN", "mutation rejected") });
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

    const channel = /^\/api\/channel\/([^/]+)\/(set|clear|subscribe)$/.exec(parsed.pathname);
    if (channel) {
      const name = decodeURIComponent(channel[1]);
      if (request.method === "GET" && channel[2] === "subscribe") {
        const args = JSON.parse(parsed.searchParams.get("args") ?? "{}");
        const session = this.session(request);
        if (!session) { json(response, 401, refusal("E_AUTH_REQUIRED", "a session is required")); return; }
        const stream: ChannelStream = { response, room: channelKey(name, args), from: session.viewer,
          key: randomBytes(16).toString("hex"), lease: randomBytes(32).toString("hex"), version: 0 };
        this.openSse(response);
        this.channelStreams.add(stream);
        response.on("close", () => { this.channelStreams.delete(stream); this.broadcastChannel(stream.room); });
        this.broadcastChannel(stream.room);
        return;
      }
      if (request.method === "POST" && ["set", "clear"].includes(channel[2])) {
        const input = await body(request);
        const session = this.session(request);
        if (!session) {
          json(response, 200, { state: "refused", ...refusal("E_AUTH_REQUIRED", "a session is required") });
          return;
        }
        const stream = [...this.channelStreams].find(candidate => candidate.lease === input.lease
          && candidate.from === session.viewer && candidate.room === channelKey(name, input.args));
        if (!stream || stream.response.destroyed) {
          json(response, 200, { state: "refused", ...refusal("E_CHANNEL_LEASE", "invalid channel lease") });
          return;
        }
        if (!Number.isSafeInteger(input.version) || input.version <= stream.version) {
          json(response, 200, { state: "refused", ...refusal("E_CHANNEL_VERSION", "stale channel version") });
          return;
        }
        stream.version = input.version;
        stream.entry = channel[2] === "set" ? {
          key: stream.key, from: stream.from, value: input.value, expiresAt: Date.now() + 4000,
        } : undefined;
        this.broadcastChannel(stream.room);
        json(response, 200, { ok: true });
        return;
      }
    }
    json(response, 404, refusal("E_OP_UNKNOWN", `${request.method} ${parsed.pathname}`));
  }
}
