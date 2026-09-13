import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import type { Socket } from "node:net";
import { createReadStream } from "node:fs";
import { realpath, stat } from "node:fs/promises";
import { extname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { pipeline } from "node:stream/promises";
import { gzipSync } from "node:zlib";
import { OwnerError, type WorkerTransport } from "./worker.js";
import { PasswordAttempts } from "./auth-limit.js";
import { parseAssetKind, type AssetCredential, type AssetRuntime } from "./assets.js";
import { matchOperatorRoute, type OperatorSurface } from "./operator.js";

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
  assets?: AssetRuntime;
  operator?: OperatorSurface;
  activity?: { noteCommit(details: { seq?: unknown; generation?: unknown }): void; poke(): void };
  shutdownMs?: number;
  log?: (message: string) => void;
}

interface ResourceQuery { key: string; op: string; args: Record<string, unknown> }
interface AcquisitionChain extends ResourceQuery {
  cursor: string;
  follow: boolean;
  validator?: string;
}
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
  const connections = new Set<Socket>();
  let pendingStreams = 0;
  let closed = false;
  let closing: Promise<void> | undefined;
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
      ...nextInvalidation,
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
  const refreshClock = (operations: readonly string[]) => {
    const due = new Set(operations);
    if (!due.size) return;
    for (const stream of streams) {
      // Clock-only renewal is query-selective. It does not issue a generic
      // invalidation that would suspend unrelated resources or acquisitions.
      if (stream.queries?.some(query => due.has(query.op))) refresh(stream);
    }
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
      if (response.destroyed || response.writableEnded) return;
      if (response.headersSent) { response.end(); return; }
      if (reason.code.startsWith("S3_WORKER")) options.log?.(`${reason.code}: ${reason.message}`);
      const value = { error: { code: reason.code, message: reason.message } };
      if (isIncompleteAssetRequest(request)) refuseIncompleteBody(request, response, statusFor(reason.code), value);
      else json(response, statusFor(reason.code), value);
    });
  });
  // Media gets a bounded two-minute body window; JSON routes retain their
  // existing explicit ten-second reader deadline and 1 MiB ceiling.
  server.requestTimeout = 120_000;
  server.headersTimeout = 10_000;
  server.keepAliveTimeout = 5_000;
  server.on("connection", socket => {
    connections.add(socket);
    socket.once("close", () => connections.delete(socket));
  });
  server.on("close", () => { closed = true; clearInterval(heartbeat); closeStreams(); });

  async function route(request: IncomingMessage, response: ServerResponse): Promise<void> {
    response.setHeader("X-Content-Type-Options", "nosniff");
    response.setHeader("Referrer-Policy", "no-referrer");
    if (closed) throw new OwnerError("S3_OWNER_CLOSED", "The server is stopping.");
    const origin = request.headers.origin;
    if (origin) {
      if (!originAllowed(origin, request.headers.host, options)) throw new OwnerError("S3_FORBIDDEN", "This browser origin is not allowed by the server.");
      response.setHeader("Access-Control-Allow-Origin", origin);
      response.setHeader("Access-Control-Expose-Headers", "Accept-Ranges, Content-Length, Content-Range, Content-Type, ETag");
      response.setHeader("Vary", "Origin");
    }
    const rawUrl = request.url ?? "/";
    const rawPath = rawUrl.split("?")[0];
    let path: string;
    try { path = decodeURIComponent(rawPath); }
    catch { throw new OwnerError("S3_INPUT", "The URL contains invalid encoding."); }
    if (path.includes("\0") || path.includes("\\") || path.split("/").some(part => part === "..")) {
      throw new OwnerError("S3_FORBIDDEN", "The requested path is not available.");
    }
    if (path.startsWith("/control/")) {
      if (!options.operator) throw new OwnerError("S3_NOT_FOUND", "No operator surface is available.");
      options.operator.authenticate(request.headers.authorization);
      const command = matchOperatorRoute(request.method, path);
      if (!command) throw new OwnerError("S3_NOT_FOUND", "No operator route at this path.");
      if (new URL(rawUrl, "http://snapback.invalid").search) throw new OwnerError("S3_INPUT", "Operator routes do not accept query parameters.");
      const body = request.method === "POST" ? await readJson(request) : {};
      json(response, 200, await options.operator.execute(command, body));
      return;
    }
    if (request.method === "OPTIONS") {
      if (!path.startsWith("/api/")) throw new OwnerError("S3_NOT_FOUND", "No route at this path.");
      response.writeHead(204, {
        "Access-Control-Allow-Methods": "GET, HEAD, POST, OPTIONS",
        "Access-Control-Allow-Headers": "Authorization, Content-Type, Range, If-None-Match",
        "Access-Control-Expose-Headers": "Accept-Ranges, Content-Length, Content-Range, Content-Type, ETag",
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
    if (path === "/api/assets" && request.method === "POST") {
      if (!options.assets) throw new OwnerError("S3_NOT_FOUND", "Media is not available in this owner.");
      const url = new URL(rawUrl, "http://snapback.invalid");
      if ([...url.searchParams.keys()].some(key => key !== "kind") || url.searchParams.getAll("kind").length !== 1) {
        throw new OwnerError("S3_INPUT", "Asset upload accepts exactly one kind query parameter.");
      }
      json(response, 200, await options.assets.upload(request, bearer(request), parseAssetKind(url.searchParams.get("kind"))));
      return;
    }
    if (path === "/api/assets/session" && request.method === "POST") {
      if (!options.assets) throw new OwnerError("S3_NOT_FOUND", "Media is not available in this owner.");
      const url = new URL(rawUrl, "http://snapback.invalid");
      if (url.search) throw new OwnerError("S3_INPUT", "Asset session creation does not accept query parameters.");
      emptyBody(request);
      json(response, 200, await options.assets.createSession(bearer(request)));
      return;
    }
    const assetLifecycle = /^\/api\/assets\/([^/]+)\/(status|discard)$/.exec(path);
    if (assetLifecycle) {
      if (!options.assets) throw new OwnerError("S3_NOT_FOUND", "Media is not available in this owner.");
      const url = new URL(rawUrl, "http://snapback.invalid");
      if (url.search) throw new OwnerError("S3_INPUT", "Asset lifecycle routes do not accept query parameters.");
      const [, id, action] = assetLifecycle;
      if (action === "status" && request.method === "GET") {
        json(response, 200, await options.assets.status(bearer(request), id)); return;
      }
      if (action === "discard" && request.method === "POST") {
        const body = await readJson(request); keys(body, []);
        json(response, 200, await options.assets.discard(bearer(request), id)); return;
      }
      throw new OwnerError("S3_NOT_FOUND", "No route for this asset lifecycle method.");
    }
    const assetDelivery = /^\/api\/assets\/([^/]+)$/.exec(path);
    if (assetDelivery && (request.method === "GET" || request.method === "HEAD")) {
      if (!options.assets) throw new OwnerError("S3_NOT_FOUND", "Media is not available in this owner.");
      const url = new URL(rawUrl, "http://snapback.invalid");
      const credential = assetCredential(request, url);
      await options.assets.serve(request, response, credential, assetDelivery[1]);
      return;
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
    if (["/api/query", "/api/read", "/api/acquire", "/api/mutation"].includes(path) && request.method === "POST") {
      const token = bearer(request);
      const body = await readJson(request);
      if (path === "/api/read") {
        const queries = resourceQueries(body);
        json(response, 200, await options.worker.request("read", { token, queries }));
      } else if (path === "/api/acquire") {
        const acquisition = acquisitionRequest(body);
        negotiatedJson(request, response, 200, await options.worker.request("acquire", { token, ...acquisition }));
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
        if (mutation && result.state === "committed") {
          if (options.activity) options.activity.noteCommit({ seq: result.seq });
          else invalidate({ seq: result.seq });
        }
        json(response, 200, result);
      }
      return;
    }
    if (path.startsWith("/api/")) throw new OwnerError("S3_NOT_FOUND", "No public route at this path.");
    if (request.method !== "GET" && request.method !== "HEAD") throw new OwnerError("S3_NOT_FOUND", "No route for this method.");
    await staticFile(options.root, path, request, response);
  }

  const close = (): Promise<void> => closing ??= (async () => {
      closed = true; clearInterval(heartbeat); closeStreams();
      const serverClosing = new Promise<void>((done, reject) => server.close(error => {
        error && (error as NodeJS.ErrnoException).code !== "ERR_SERVER_NOT_RUNNING" ? reject(error) : done();
      }));
      server.closeIdleConnections();
      if (!await settlesWithin(serverClosing, boundedShutdown(options.shutdownMs))) {
        for (const socket of connections) socket.destroy();
        server.closeAllConnections();
        if (!await settlesWithin(serverClosing, Math.min(1_000, boundedShutdown(options.shutdownMs)))) {
          if ([...connections].some(socket => !socket.destroyed)) {
            throw new OwnerError("S3_HTTP_SHUTDOWN_TIMEOUT", "HTTP connections did not close within the bounded shutdown window.");
          }
        }
      }
    })();

  return { server, invalidate, refreshClock, closeStreams, close };
}

function boundedShutdown(value: number | undefined): number {
  return value !== undefined && Number.isFinite(value) && value >= 1
    ? Math.min(Math.floor(value), 30_000)
    : 5_000;
}

async function settlesWithin(promise: Promise<void>, milliseconds: number): Promise<boolean> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const settled = await Promise.race([
    promise.then(() => true),
    new Promise<false>(done => { timer = setTimeout(() => done(false), milliseconds); }),
  ]);
  if (timer) clearTimeout(timer);
  return settled;
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

function assetCredential(request: IncomingMessage, url: URL): AssetCredential {
  const parameters = [...url.searchParams.keys()];
  if (parameters.length === 0) {
    return request.headers.authorization === undefined
      ? { kind: "public" }
      : { kind: "header", token: bearer(request) };
  }
  if (parameters.some(key => key !== "s") || url.searchParams.getAll("s").length !== 1) {
    throw new OwnerError("S3_INPUT", "Asset delivery accepts only one optional s query parameter.");
  }
  if (request.headers.authorization !== undefined) {
    throw new OwnerError("S3_INPUT", "Asset delivery cannot combine header and URL credentials.");
  }
  const carrier = url.searchParams.get("s");
  if (!carrier || !/^[A-Za-z0-9_-]{32,128}$/.test(carrier)) {
    throw new OwnerError("S3_ASSET_UNAVAILABLE", "Asset is unavailable.");
  }
  return { kind: "carrier", token: carrier };
}

function emptyBody(request: IncomingMessage): void {
  const length = request.headers["content-length"];
  const transfer = request.headers["transfer-encoding"];
  if ((length !== undefined && length !== "0") || transfer !== undefined) {
    request.pause();
    throw new OwnerError("S3_INPUT", "This media route accepts an empty request body.");
  }
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
function acquisitionRequest(body: Record<string, unknown>): { expectedSeq?: number; chains: AcquisitionChain[] } {
  keys(body, ["expectedSeq", "chains"]);
  let expectedSeq: number | undefined;
  if (body.expectedSeq !== undefined) {
    if (!Number.isSafeInteger(body.expectedSeq) || (body.expectedSeq as number) < 0 || Object.is(body.expectedSeq, -0)) {
      throw new OwnerError("S3_INPUT", "expectedSeq must be a nonnegative safe integer.");
    }
    expectedSeq = body.expectedSeq as number;
  }
  if (!Array.isArray(body.chains) || body.chains.length === 0 || body.chains.length > 64) {
    throw new OwnerError("S3_INPUT", "chains must be an array containing between 1 and 64 declarations.");
  }
  const seen = new Set<string>();
  const chains = body.chains.map(value => {
    const chain = object(value, "acquisition chain");
    keys(chain, ["key", "op", "args", "cursor", "follow", "validator"]);
    const key = text(chain.key, "acquisition key", 512);
    if (seen.has(key)) throw new OwnerError("S3_INPUT", "Acquisition chain keys must be unique within a request.");
    seen.add(key);
    const args = object(chain.args, "args");
    const cursor = text(chain.cursor, "cursor", 256);
    if (!Object.hasOwn(args, cursor) || (args[cursor] !== null && typeof args[cursor] !== "string")) {
      throw new OwnerError("S3_INPUT", `args.${cursor} must be null or a cursor string.`);
    }
    const follow = chain.follow === undefined ? true : chain.follow;
    if (typeof follow !== "boolean") throw new OwnerError("S3_INPUT", "follow must be a boolean when present.");
    let validator: string | undefined;
    if (chain.validator !== undefined) {
      if (typeof chain.validator !== "string" || !/^[0-9a-f]{64}$/.test(chain.validator)) {
        throw new OwnerError("S3_INPUT", "validator must be a lowercase SHA-256 digest.");
      }
      if (follow) throw new OwnerError("S3_INPUT", "validator requires follow:false.");
      validator = chain.validator;
    }
    return { key, op: operation(chain.op), args, cursor, follow, ...(validator === undefined ? {} : { validator }) };
  });
  return { ...(expectedSeq === undefined ? {} : { expectedSeq }), chains };
}
function asOwnerError(error: unknown): OwnerError {
  return error instanceof OwnerError ? error : new OwnerError("S3_INTERNAL", "The server could not complete this request.");
}
function statusFor(code: string): number {
  if (code === "S3_AUTH" || code === "S3_OPERATOR_AUTH") return 401;
  if (code === "S3_FORBIDDEN") return 403;
  if (code === "S3_NOT_FOUND") return 404;
  if (code === "S3_CONTENT_TYPE") return 415;
  if (code === "S3_INPUT_TOO_LARGE" || code === "S3_ACQUISITION_OVERSIZE" || code === "S3_ASSET_TOO_LARGE") return 413;
  if (code === "S3_ASSET_TYPE") return 422;
  if (code === "S3_ASSET_VIEWED" || code === "E_ASSET_VIEWED") return 410;
  if (code === "S3_ASSET_UPLOAD_TIMEOUT") return 408;
  if (code === "S3_ASSET_NOT_READY" || code === "E_ASSET_NOT_READY" || code === "S3_ASSET_UNAVAILABLE") return 404;
  if (code === "S3_SEQUENCE_CHANGED" || code === "S3_GENERATION_CHANGED") return 409;
  if (code === "S3_OWNER_BUSY" || code === "S3_AUTH_RATE_LIMIT") return 429;
  if (code.startsWith("S3_WORKER") || code === "S3_OWNER_CLOSED" || code.startsWith("S3_MEDIA")
    || ["S3_ASSET_BYTES_UNAVAILABLE", "S3_ASSET_IO", "S3_ASSET_STORAGE", "S3_ASSET_FINALIZE_UNKNOWN",
      "S3_ASSET_RESERVE_UNKNOWN", "S3_ASSET_SHUTDOWN_TIMEOUT"].includes(code)) return 503;
  if (code === "S3_INTERNAL") return 500;
  return 400;
}
function json(response: ServerResponse, status: number, value: unknown): void {
  response.writeHead(status, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" });
  response.end(JSON.stringify(value));
}

function isIncompleteAssetRequest(request: IncomingMessage): boolean {
  if (request.complete || request.method !== "POST") return false;
  const path = (request.url ?? "/").split("?", 1)[0];
  return path === "/api/assets" || path.startsWith("/api/assets/");
}

function refuseIncompleteBody(request: IncomingMessage, response: ServerResponse, status: number, value: unknown): void {
  request.pause();
  response.shouldKeepAlive = false;
  response.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    Connection: "close",
  });
  const force = setTimeout(() => request.socket.destroy(), 1_000);
  force.unref();
  response.once("close", () => clearTimeout(force));
  response.end(JSON.stringify(value), () => {
    clearTimeout(force);
    request.socket.destroy();
  });
}

function negotiatedJson(request: IncomingMessage, response: ServerResponse, status: number, value: unknown): void {
  const raw = Buffer.from(JSON.stringify(value));
  const encoded = raw.length >= 1024 && acceptsGzip(request.headers["accept-encoding"])
    ? gzipSync(raw)
    : raw;
  const compressed = encoded !== raw;
  const vary = response.getHeader("Vary");
  response.setHeader("Vary", vary ? `${String(vary)}, Accept-Encoding` : "Accept-Encoding");
  response.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    "Content-Length": encoded.length,
    ...(compressed ? { "Content-Encoding": "gzip" } : {}),
  });
  response.end(encoded);
}

function acceptsGzip(header: string | undefined): boolean {
  if (!header) return false;
  let wildcard: boolean | undefined;
  for (const item of header.split(",")) {
    const [name, ...parameters] = item.trim().toLowerCase().split(";");
    const qualityParameter = parameters.find(parameter => /^q\s*=/.test(parameter.trim()));
    const quality = qualityParameter
      ? /^q\s*=\s*(0(?:\.\d+)?|1(?:\.0+)?)$/.exec(qualityParameter.trim())?.[1]
      : undefined;
    const accepted = qualityParameter === undefined || (quality !== undefined && Number(quality) > 0);
    if (name === "gzip") return accepted;
    if (name === "*") wildcard = accepted;
  }
  return wildcard ?? false;
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
