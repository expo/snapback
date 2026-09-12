import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { createReadStream } from "node:fs";
import { realpath, stat } from "node:fs/promises";
import { extname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { pipeline } from "node:stream/promises";
import { OwnerError, type WorkerTransport } from "./worker.js";
import { PasswordAttempts } from "./auth-limit.js";

const BODY_LIMIT = 1024 * 1024;
const STREAM_BUFFER_LIMIT = 16 * 1024 * 1024;
const MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8", ".json": "application/json; charset=utf-8", ".svg": "image/svg+xml",
  ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".webp": "image/webp", ".ico": "image/x-icon",
  ".woff2": "font/woff2", ".wasm": "application/wasm",
};

export interface HttpOptions {
  worker: WorkerTransport;
  root: string;
  dev: boolean;
  origins?: readonly string[];
  heartbeatMs?: number;
  maxStreams?: number;
  log?: (message: string) => void;
}

interface ResourceQuery { key: string; op: string; args: Record<string, unknown> }
interface LiveStream {
  response: ServerResponse;
  token: string;
  queries?: ResourceQuery[];
  checking: boolean;
  reading: boolean;
  dirty: boolean;
}

/** Public routes are deliberately enumerated. The internal worker's project,
 * seed, and owner methods are never selected by an HTTP request. */
export function createOwnerServer(options: HttpOptions) {
  const passwordAttempts = new PasswordAttempts();
  const streams = new Set<LiveStream>();
  let pendingStreams = 0;
  let closed = false;
  let nextInvalidation: Record<string, unknown> | undefined;
  let scheduled = false;

  const send = (response: ServerResponse, event: string, value: unknown) => {
    if (response.destroyed || response.writableEnded) return;
    const frame = `event: ${event}\ndata: ${JSON.stringify(value)}\n\n`;
    if (response.writableLength + Buffer.byteLength(frame) > STREAM_BUFFER_LIMIT) { response.destroy(); return; }
    response.write(frame);
  };
  const failStream = (stream: LiveStream, error: unknown) => {
    const reason = asOwnerError(error);
    send(stream.response, reason.code === "S3_AUTH" ? "auth" : "unavailable", {
      type: reason.code === "S3_AUTH" ? "signed-out" : "unavailable", code: reason.code,
    });
    stream.response.end(); streams.delete(stream);
  };
  const refresh = (stream: LiveStream) => {
    stream.dirty = true;
    if (stream.reading) return;
    stream.reading = true;
    void (async () => {
      try {
        while (stream.dirty && streams.has(stream)) {
          stream.dirty = false;
          // Each frame is projected by the core under this session's current
          // authority. A commit triggers a fresh read, never a raw row push.
          const frame = await options.worker.request("read", { token: stream.token, queries: stream.queries });
          if (streams.has(stream)) send(stream.response, "resources", frame);
        }
      } catch (error) { failStream(stream, error); }
      finally { stream.reading = false; }
    })();
  };
  const invalidate = (details: { seq?: unknown; generation?: unknown } = {}) => {
    nextInvalidation = {
      type: "invalidate",
      ...(Number.isSafeInteger(details.seq) ? { seq: details.seq } : {}),
      ...(typeof details.generation === "string" ? { generation: details.generation } : {}),
    };
    if (scheduled) return;
    scheduled = true;
    queueMicrotask(() => {
      scheduled = false;
      const value = nextInvalidation;
      nextInvalidation = undefined;
      for (const stream of streams) {
        if (stream.queries) refresh(stream);
        else send(stream.response, "invalidate", value);
      }
    });
  };
  const closeStreams = () => {
    for (const { response } of streams) response.end();
    streams.clear();
  };
  const heartbeat = setInterval(() => {
    for (const stream of streams) {
      if (stream.checking) continue;
      stream.checking = true;
      void options.worker.request("authenticate", { token: stream.token }).then(() => {
        if (stream.response.writableLength > STREAM_BUFFER_LIMIT) stream.response.destroy();
        else if (!stream.response.destroyed && !stream.response.writableEnded) stream.response.write(": keepalive\n\n");
      }, error => failStream(stream, error)).finally(() => { stream.checking = false; });
    }
  }, options.heartbeatMs ?? 10_000);
  heartbeat.unref();

  const server = createServer({ maxHeaderSize: 16 * 1024 }, (request, response) => {
    void route(request, response).catch(error => {
      const reason = asOwnerError(error);
      if (response.headersSent) { response.end(); return; }
      if (reason.code.startsWith("S3_WORKER")) options.log?.(`${reason.code}: ${reason.message}`);
      json(response, statusFor(reason.code), { error: { code: reason.code, message: reason.message } });
    });
  });
  server.requestTimeout = 15_000;
  server.headersTimeout = 10_000;
  server.keepAliveTimeout = 5_000;
  server.on("close", () => { closed = true; clearInterval(heartbeat); closeStreams(); });

  async function route(request: IncomingMessage, response: ServerResponse): Promise<void> {
    response.setHeader("X-Content-Type-Options", "nosniff");
    response.setHeader("Referrer-Policy", "no-referrer");
    if (closed) throw new OwnerError("S3_OWNER_CLOSED", "The server is stopping.");
    const origin = request.headers.origin;
    if (origin) {
      if (!originAllowed(origin, request.headers.host, options)) throw new OwnerError("S3_FORBIDDEN", "This browser origin is not allowed by the server.");
      response.setHeader("Access-Control-Allow-Origin", origin);
      response.setHeader("Vary", "Origin");
    }
    const rawPath = (request.url ?? "/").split("?")[0];
    let path: string;
    try { path = decodeURIComponent(rawPath); }
    catch { throw new OwnerError("S3_INPUT", "The URL contains invalid encoding."); }
    if (path.includes("\0") || path.includes("\\") || path.split("/").some(part => part === "..")) {
      throw new OwnerError("S3_FORBIDDEN", "The requested path is not available.");
    }
    if (request.method === "OPTIONS") {
      if (!path.startsWith("/api/")) throw new OwnerError("S3_NOT_FOUND", "No route at this path.");
      response.writeHead(204, {
        "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
        "Access-Control-Allow-Headers": "Authorization, Content-Type",
        "Access-Control-Max-Age": "600",
      });
      response.end(); return;
    }
    if (path.startsWith("/api/")) response.setHeader("Cache-Control", "no-store");
    if (path === "/api/health" && request.method === "GET") {
      json(response, 200, await options.worker.request("health")); return;
    }
    if (path === "/api/manifest" && request.method === "GET") {
      json(response, 200, await options.worker.request("manifest")); return;
    }
    if (path.startsWith("/api/auth/") && request.method === "POST") {
      const action = path.slice("/api/auth/".length);
      if (!["signup", "login", "persona", "logout"].includes(action)) throw new OwnerError("S3_NOT_FOUND", "Unknown authentication action.");
      if (action === "persona" && !options.dev) throw new OwnerError("S3_FORBIDDEN", "Personas are available only in snapback3 dev.");
      const body = await readJson(request);
      const params: Record<string, unknown> = { action };
      if (action === "signup" || action === "login") {
        keys(body, ["email", "password"]);
        params.email = text(body.email, "email", 320);
        params.password = text(body.password, "password", 1024);
      } else if (action === "persona") {
        keys(body, ["name"]); params.name = text(body.name, "name", 128);
      } else { keys(body, []); params.token = bearer(request); }
      const release = action === "signup" || action === "login"
        ? passwordAttempts.acquire(request.socket.remoteAddress ?? "unknown", params.email as string)
        : undefined;
      try { json(response, 200, await options.worker.request("auth", params)); }
      finally { release?.(); }
      return;
    }
    if (path === "/api/events" && ["GET", "POST"].includes(request.method ?? "")) {
      if (streams.size + pendingStreams >= (options.maxStreams ?? 256)) throw new OwnerError("S3_OWNER_BUSY", "The server has reached its live connection limit.");
      pendingStreams++;
      try {
        const token = bearer(request);
        const queries = request.method === "POST" ? resourceQueries(await readJson(request)) : undefined;
        await options.worker.request("authenticate", { token });
        if (request.aborted || response.destroyed || closed) return;
        response.writeHead(200, {
          "Content-Type": "text/event-stream; charset=utf-8", "Cache-Control": "no-cache, no-transform",
          Connection: "keep-alive", "X-Accel-Buffering": "no",
        });
        response.flushHeaders();
        const stream: LiveStream = { response, token, queries, checking: false, reading: false, dirty: false };
        streams.add(stream);
        response.on("close", () => streams.delete(stream));
        if (queries) refresh(stream);
        else send(response, "ready", { type: "ready" });
      } finally { pendingStreams--; }
      return;
    }
    if (path.startsWith("/api/operation/") && request.method === "GET") {
      const intent = operationId(path.slice("/api/operation/".length));
      json(response, 200, await options.worker.request("status", { token: bearer(request), intent }));
      return;
    }
    if (["/api/query", "/api/read", "/api/mutation"].includes(path) && request.method === "POST") {
      const token = bearer(request);
      const body = await readJson(request);
      if (path === "/api/read") {
        const queries = resourceQueries(body);
        json(response, 200, await options.worker.request("read", { token, queries }));
      } else {
        const mutation = path === "/api/mutation";
        keys(body, mutation ? ["op", "args", "intent", "planHash", "schemaHash"] : ["op", "args"]);
        const params: Record<string, unknown> = { token, op: operation(body.op), args: object(body.args ?? {}, "args") };
        if (mutation) {
          params.intent = operationId(body.intent);
          params.planHash = text(body.planHash, "planHash", 128);
          params.schemaHash = text(body.schemaHash, "schemaHash", 128);
        }
        const result = await options.worker.request<Record<string, unknown>>(mutation ? "mutation" : "query", params);
        if (mutation && result.state === "committed") invalidate({ seq: result.seq });
        json(response, 200, result);
      }
      return;
    }
    if (path.startsWith("/api/")) throw new OwnerError("S3_NOT_FOUND", "No public route at this path.");
    if (request.method !== "GET" && request.method !== "HEAD") throw new OwnerError("S3_NOT_FOUND", "No route for this method.");
    await staticFile(options.root, path, request, response);
  }

  return {
    server, invalidate, closeStreams,
    async close(): Promise<void> {
      if (closed) return;
      closed = true; clearInterval(heartbeat); closeStreams();
      await new Promise<void>((done, reject) => server.close(error =>
        error && (error as NodeJS.ErrnoException).code !== "ERR_SERVER_NOT_RUNNING" ? reject(error) : done()));
      server.closeAllConnections();
    },
  };
}

function originAllowed(origin: string, host: string | undefined, options: HttpOptions): boolean {
  if (options.origins?.includes(origin)) return true;
  try {
    const url = new URL(origin);
    if (!["http:", "https:"].includes(url.protocol) || url.origin !== origin) return false;
    if (!options.dev && host && url.host === host) return true;
    return options.dev && ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
  } catch { return false; }
}

function bearer(request: IncomingMessage): string {
  const value = request.headers.authorization;
  const match = value && /^Bearer ([^\s]+)$/i.exec(value);
  if (!match || match[1].length > 4096) throw new OwnerError("S3_AUTH", "Sign in before accessing application data.");
  return match[1];
}

function object(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new OwnerError("S3_INPUT", `${label} must be a JSON object.`);
  return value as Record<string, unknown>;
}
function keys(value: Record<string, unknown>, allowed: readonly string[]): void {
  if (Object.keys(value).some(key => !allowed.includes(key))) throw new OwnerError("S3_INPUT", `Expected only ${allowed.length ? allowed.join(", ") : "an empty object"}.`);
}
function text(value: unknown, label: string, max: number): string {
  if (typeof value !== "string" || value.length === 0 || Buffer.byteLength(value) > max) throw new OwnerError("S3_INPUT", `${label} must be a nonempty string of at most ${max} bytes.`);
  return value;
}
function operation(value: unknown): string {
  return text(value, "op", 256);
}
function operationId(value: unknown): string {
  if (typeof value !== "string" || !/^[A-Za-z0-9_-]{1,128}$/.test(value)) {
    throw new OwnerError("S3_INTENT_INVALID", "intent must be 1–128 ASCII letters, digits, hyphens or underscores.");
  }
  return value;
}
function resourceQueries(body: Record<string, unknown>): ResourceQuery[] {
  keys(body, ["queries"]);
  if (!Array.isArray(body.queries) || body.queries.length > 64) throw new OwnerError("S3_INPUT", "queries must be an array containing at most 64 resources.");
  const seen = new Set<string>();
  return body.queries.map(value => {
    const query = object(value, "query"); keys(query, ["key", "op", "args"]);
    const key = text(query.key, "resource key", 512);
    if (seen.has(key)) throw new OwnerError("S3_INPUT", "Resource keys must be unique within a read.");
    seen.add(key);
    return { key, op: operation(query.op), args: object(query.args ?? {}, "args") };
  });
}
function asOwnerError(error: unknown): OwnerError {
  return error instanceof OwnerError ? error : new OwnerError("S3_INTERNAL", "The server could not complete this request.");
}
function statusFor(code: string): number {
  if (code === "S3_AUTH") return 401;
  if (code === "S3_FORBIDDEN") return 403;
  if (code === "S3_NOT_FOUND") return 404;
  if (code === "S3_CONTENT_TYPE") return 415;
  if (code === "S3_INPUT_TOO_LARGE") return 413;
  if (code === "S3_OWNER_BUSY" || code === "S3_AUTH_RATE_LIMIT") return 429;
  if (code.startsWith("S3_WORKER") || code === "S3_OWNER_CLOSED") return 503;
  if (code === "S3_INTERNAL") return 500;
  return 400;
}
function json(response: ServerResponse, status: number, value: unknown): void {
  response.writeHead(status, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" });
  response.end(JSON.stringify(value));
}

function readJson(request: IncomingMessage): Promise<Record<string, unknown>> {
  if (!request.headers["content-type"]?.toLowerCase().startsWith("application/json")) {
    request.resume(); return Promise.reject(new OwnerError("S3_CONTENT_TYPE", "Send application/json."));
  }
  if (Number(request.headers["content-length"] ?? 0) > BODY_LIMIT) {
    request.resume(); return Promise.reject(new OwnerError("S3_INPUT_TOO_LARGE", "Request body exceeds 1 MiB."));
  }
  return new Promise((resolveBody, reject) => {
    let bytes = 0;
    const chunks: Buffer[] = [];
    let finished = false;
    const timer = setTimeout(() => fail(new OwnerError("S3_INPUT", "Request body timed out.")), 10_000);
    timer.unref();
    const fail = (error: Error) => {
      if (finished) return;
      finished = true; clearTimeout(timer); request.resume(); reject(error);
    };
    request.on("data", (chunk: Buffer) => {
      if (finished) return;
      bytes += chunk.length;
      if (bytes > BODY_LIMIT) { fail(new OwnerError("S3_INPUT_TOO_LARGE", "Request body exceeds 1 MiB.")); return; }
      chunks.push(chunk);
    });
    request.once("aborted", () => fail(new OwnerError("S3_INPUT", "Request was interrupted.")));
    request.once("error", fail);
    request.once("end", () => {
      if (finished) return;
      finished = true; clearTimeout(timer);
      try { resolveBody(object(JSON.parse(Buffer.concat(chunks, bytes).toString("utf8")), "request")); }
      catch { reject(new OwnerError("S3_INPUT", "Request body must be a JSON object.")); }
    });
  });
}

async function staticFile(root: string, path: string, request: IncomingMessage, response: ServerResponse): Promise<void> {
  if (path.split("/").some(part => part.startsWith("."))) throw new OwnerError("S3_NOT_FOUND", "This file is not public.");
  for (const directory of [join(root, "dist", "public"), join(root, "dist"), join(root, "public")]) {
    let base: string;
    try { base = await realpath(directory); } catch { continue; }
    let candidate = resolve(base, `.${path}`);
    try {
      let information = await stat(candidate);
      if (information.isDirectory()) { candidate = join(candidate, "index.html"); information = await stat(candidate); }
      if (!information.isFile()) continue;
    } catch {
      if (extname(path) || !request.headers.accept?.includes("text/html")) continue;
      candidate = join(base, "index.html");
    }
    let actual: string;
    try { actual = await realpath(candidate); } catch { continue; }
    const within = relative(base, actual);
    if (within === ".." || within.startsWith(`..${sep}`) || isAbsolute(within)) throw new OwnerError("S3_FORBIDDEN", "This file is outside the public directory.");
    const information = await stat(actual);
    if (!information.isFile()) continue;
    response.writeHead(200, { "Content-Type": MIME[extname(actual)] ?? "application/octet-stream", "Content-Length": information.size, "Cache-Control": "no-cache" });
    if (request.method === "HEAD") response.end();
    else await pipeline(createReadStream(actual), response);
    return;
  }
  if (path === "/") {
    response.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
    response.end(request.method === "HEAD" ? undefined : "<!doctype html><meta charset=utf-8><title>Snapback 3</title><style>body{font:18px system-ui;max-width:40rem;margin:12vh auto;padding:2rem;line-height:1.6}</style><h1>Snapback 3 is running.</h1><p>Build your client into <code>dist/</code> or put static files in <code>public/</code> to serve your application here.</p>");
    return;
  }
  throw new OwnerError("S3_NOT_FOUND", "No public file at this path.");
}
