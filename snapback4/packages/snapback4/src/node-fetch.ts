// Node 24.18's bundled writer can throw setTypeOfService EINVAL outside the
// fetch promise on macOS (undici#5544). Keep the host Fetch API and pass a
// private fixed dispatcher, including through a host's fetch instrumentation.
import { createRequire } from "node:module";
import { channel } from "node:diagnostics_channel";
import type { Socket } from "node:net";
import type { Dispatcher } from "undici";
const require = createRequire(import.meta.url);
// Import the pinned implementation directly: undici's root import installs a
// process-wide dispatcher as a side effect. SDK requests need no global change.
const Agent: typeof import("undici").Agent = require("undici/lib/dispatcher/agent.js");
const Dispatcher1Wrapper: typeof import("undici").Dispatcher1Wrapper = require("undici/lib/dispatcher/dispatcher1-wrapper.js");
const Client: typeof import("undici").Client = require("undici/lib/dispatcher/client.js");
const Pool: typeof import("undici").Pool = require("undici/lib/dispatcher/pool.js");
// The pinned dispatcher's request owns this handler through queues and socket
// selection. Do not correlate by async context: a pool can drain a different
// caller's request on the completing caller's stack.
type Attempt = { socket?: Socket; read?: number; reused?: boolean; origin: string; path: string; sameTarget?: boolean; dispatches: number };
const attempts = new WeakMap<object, Attempt>();
const requests = new WeakMap<object, Attempt>();
const completed = new WeakSet<Socket>();
let creating: Attempt | undefined;
class TrackedClient extends Client {
  override dispatch(options: Dispatcher.DispatchOptions, handler: Dispatcher.DispatchHandler): boolean {
    const previous = creating;
    creating = attempts.get(handler);
    try { return super.dispatch(options, handler); }
    finally { creating = previous; }
  }
}
type Sent = { request: { origin: string; path: string }; socket: Socket };
channel("undici:request:create").subscribe(message => {
  if (creating) requests.set((message as Sent).request, creating);
});
channel("undici:client:sendHeaders").subscribe(message => {
  const { request, socket } = message as Sent;
  const attempt = requests.get(request);
  if (!attempt) return;
  attempt.socket = socket;
  attempt.read = socket.bytesRead;
  attempt.reused = completed.has(socket);
  attempt.sameTarget = String(request.origin) === attempt.origin && request.path === attempt.path;
});
channel("undici:request:trailers").subscribe(message => {
  const { request } = message as Sent;
  const socket = requests.get(request)?.socket;
  if (socket) completed.add(socket);
});

// @ref LLP 3000#http-overload-diagnostics — retire idle sockets well before the host's five seconds; held responses keep their independent deadlines.
const agent = new Agent({ keepAliveTimeout: 1000, keepAliveMaxTimeout: 1000, keepAliveTimeoutThreshold: 1000,
  factory: (origin, options) => new Pool(origin, { ...options, factory: (url, opts) => new TrackedClient(url, opts) }),
});

function repeatable(url: URL, init?: RequestInit): boolean {
  const method = (init?.method ?? "GET").toUpperCase();
  if (method === "GET") return /^\/(?:schema|probe|changes|write(?:\/[^/]+)?|api\.ts|native\.wasm)?$/.test(url.pathname);
  // Only replay materialized JSON. Request objects and streamed uploads keep
  // their existing single-dispatch behavior, as do one-view GETs and auth.
  if (method !== "POST" || typeof init?.body !== "string") return false;
  if (url.pathname.startsWith("/q/") || url.pathname === "/sync") return true;
  if (!url.pathname.startsWith("/m/")) return false;
  try {
    const body = JSON.parse(init.body);
    return body?.retry_write === true && typeof body.id === "string" && body.id.length > 0;
  } catch { return false; }
}

export const defaultFetch: typeof fetch = async (input, init) => {
  const url = typeof input === "string" || input instanceof URL ? new URL(input) : new URL(input.url);
  // Fetch snapshots mutable inputs at dispatch. A retry must keep that same
  // URL, write ID, body and authority even if the caller edits its options.
  const target = input instanceof URL ? url.href : input;
  const settings = { ...init };
  const headers = init?.headers === undefined ? undefined : Object.fromEntries(new Headers(init.headers));
  const send = (dispatcher: Dispatcher) => globalThis.fetch(target, {
    ...settings, ...(headers ? { headers: { ...headers } } : {}), dispatcher,
  } as RequestInit);
  const attempt: Attempt = { origin: url.origin, path: url.pathname + url.search, dispatches: 0 };
  const dispatcher = new Dispatcher1Wrapper(agent.compose(dispatch => (options, handler) => {
    attempt.dispatches++;
    attempts.set(handler, attempt);
    // No implicit pipeline replays (GET /assets can consume a view).
    return dispatch({ ...options, idempotent: false }, handler);
  }));
  try {
    return await send(dispatcher);
  } catch (error) {
    const code = (error as { cause?: { code?: string } })?.cause?.code;
    if (input instanceof Request || !repeatable(url, settings) || settings.signal?.aborted
      || attempt.dispatches !== 1 || !attempt.reused || !attempt.sameTarget || !attempt.socket || attempt.socket.bytesRead !== attempt.read
      || !["ECONNRESET", "EPIPE", "UND_ERR_SOCKET"].includes(code ?? "")) throw error;
    // Exactly one fresh-connection attempt. close() drains the response body;
    // destroying at fetch resolution would truncate a streaming /sync reply.
    const retry = new Agent({ pipelining: 0 });
    try {
      return await send(new Dispatcher1Wrapper(retry));
    } finally { void retry.close().catch(() => {}); }
  }
};
