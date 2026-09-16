import { GiveUp, Retry } from "./worker.ts";
import { ParkStep, ServerError } from "./server-json.ts";
import type { ServerContext } from "./server.ts";

export interface RouteRequest {
  readonly method: "POST";
  readonly path: string;
  /** HTTP-normalized fields. Repeated fields follow the Headers API. */
  readonly headers: Headers;
  /** Exact incoming bytes, in a fresh copy on every call. */
  rawBody(): Promise<Uint8Array>;
}

export interface VerificationContext<Secrets extends string = never> {
  readonly secrets: Readonly<Record<Secrets, string>>;
  readonly signal: AbortSignal;
}

export type RouteHandler<Secrets extends string = never> =
  (request: RouteRequest, context: ServerContext<Secrets>) => Response | Promise<Response>;

export interface ServiceRoute<Secrets extends string = never> {
  verify(request: RouteRequest, context: VerificationContext<Secrets>): boolean | Promise<boolean>;
  handle: RouteHandler<Secrets>;
}

export interface RouteDeclaration {
  readonly contract: string;
  readonly method: "POST";
  readonly path: string;
  readonly service: string | null;
  readonly secrets: readonly string[];
}

export interface WireRouteResponse {
  readonly status: number;
  readonly headers: [string, string][];
  readonly bodyHex: string;
  readonly applicationRefusal?: string;
}

const BODY_BYTES = 64 * 1024;
const HEADER_BYTES = 16 * 1024;
const HEADER_COUNT = 64;
const transportHeaders = new Set(["connection", "content-length", "transfer-encoding", "keep-alive", "upgrade", "proxy-authenticate", "proxy-authorization", "te", "trailer"]);
const invalid = (message: string) => new ServerError("E_ROUTE_RESULT", message, "route");

function headers(value: unknown, response: boolean): [string, string][] {
  if (!Array.isArray(value) || value.length > HEADER_COUNT) throw invalid("route headers exceed 64 fields");
  let size = 0;
  return value.map(pair => {
    if (!Array.isArray(pair) || pair.length !== 2) throw invalid("route headers must be name/value pairs");
    const [name, text] = pair;
    if (typeof name !== "string" || !/^[!#$%&'*+\-.^_`|~0-9A-Za-z]+$/.test(name)
      || typeof text !== "string" || !/^[\t\x20-\x7e]*$/.test(text)) throw invalid("route headers need token names and printable ASCII values");
    size += name.length + text.length;
    if (size > HEADER_BYTES) throw invalid("route headers exceed 16 KiB");
    if (response && transportHeaders.has(name.toLowerCase())) throw invalid("route responses cannot supply transport-owned headers");
    return [name, text] as [string, string];
  });
}

// @ref LLP 3000.009#5.1 — signature verification sees exact bytes, never a JSON round trip.
export function routeRequest(value: unknown, declaration: RouteDeclaration): RouteRequest {
  if (!value || typeof value !== "object" || Array.isArray(value)
    || Reflect.ownKeys(value).length !== 4
    || !["method", "path", "headers", "bodyHex"].every(key => Object.hasOwn(value, key))) throw invalid("invalid route request envelope");
  const wire = value as { method: unknown; path: unknown; headers: unknown; bodyHex: unknown };
  if (wire.method !== "POST" || wire.path !== declaration.path || declaration.method !== "POST") throw invalid("the request does not match the declared POST route");
  if (typeof wire.bodyHex !== "string" || wire.bodyHex.length > BODY_BYTES * 2 || wire.bodyHex.length % 2 !== 0 || !/^[0-9a-f]*$/.test(wire.bodyHex)) throw invalid("route bytes need canonical lowercase base16 within 64 KiB");
  const bytes = Buffer.from(wire.bodyHex, "hex");
  return Object.freeze({ method: "POST" as const, path: declaration.path,
    headers: new Headers(headers(wire.headers, false)),
    async rawBody() { return Uint8Array.from(bytes); },
  });
}

/** Also observes a late rejection from a transport/body reader ignoring abort. */
export function untilAborted<T>(work: () => Promise<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) return Promise.reject(signal.reason);
  return new Promise((resolve, reject) => {
    const abort = () => { signal.removeEventListener("abort", abort); reject(signal.reason); };
    signal.addEventListener("abort", abort, { once: true });
    Promise.resolve().then(() => { signal.throwIfAborted(); return work(); }).then(resolve, reject)
      .finally(() => signal.removeEventListener("abort", abort));
  });
}

// Nonstreaming means fully buffered before settlement, not that Response was
// constructed without a stream. Never allocate an unbounded arrayBuffer().
export async function routeResponse(value: unknown, signal: AbortSignal, milliseconds = 10_000): Promise<WireRouteResponse> {
  signal.throwIfAborted();
  let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
  const deadline = new AbortController();
  const lifetime = AbortSignal.any([signal, deadline.signal]);
  const timer = setTimeout(() => deadline.abort(invalid("route response buffering exceeded its time bound")), milliseconds);
  const cancel = () => {
    try {
      if (reader) void reader.cancel().catch(() => {});
      else if (value instanceof Response && value.body && !value.body.locked) void value.body.cancel().catch(() => {});
    } catch {}
  };
  lifetime.addEventListener("abort", cancel, { once: true });
  let complete = false;
  try {
    if (!(value instanceof Response) || !Number.isInteger(value.status) || value.status < 200 || value.status > 599
      || value.bodyUsed || value.body?.locked) throw invalid("return an unused, unlocked Response with status 200 through 599");
    const pairs: [string, string][] = [];
    for (const [name, text] of value.headers) {
      if (name.toLowerCase() !== "set-cookie") pairs.push([name, text]);
      if (pairs.length > HEADER_COUNT) throw invalid("route headers exceed 64 fields");
    }
    for (const cookie of value.headers.getSetCookie()) {
      pairs.push(["set-cookie", cookie]);
      if (pairs.length > HEADER_COUNT) throw invalid("route headers exceed 64 fields");
    }
    const fields = headers(pairs, true);
    const buffered = Buffer.alloc(BODY_BYTES);
    let size = 0, reads = 0;
    if (value.body) {
      reader = value.body.getReader();
      for (;;) {
        const next = await untilAborted(() => reader!.read(), lifetime);
        lifetime.throwIfAborted();
        if (next.done) break;
        if (!(next.value instanceof Uint8Array)) throw invalid("route response streams must contain bytes");
        if (size + next.value.byteLength > BODY_BYTES) throw invalid("a route response body exceeds 64 KiB");
        buffered.set(next.value, size);
        size += next.value.byteLength;
        // Empty chunks must not starve the deadline timer in a microtask loop.
        if (++reads % 256 === 0) await untilAborted(() => new Promise<void>(resolve => setImmediate(resolve)), lifetime);
      }
    }
    if ([204, 205, 304].includes(value.status) && size !== 0) throw invalid("this response status cannot have a body");
    lifetime.throwIfAborted();
    complete = true;
    if (value.status >= 500) throw new Retry(`route handler returned HTTP ${value.status}`);
    return { status: value.status, headers: fields, bodyHex: buffered.subarray(0, size).toString("hex") };
  } catch (error) {
    if (lifetime.aborted) throw lifetime.reason;
    if (error instanceof ServerError || error instanceof Retry) throw error;
    throw invalid("the route response could not be buffered");
  } finally {
    clearTimeout(timer);
    lifetime.removeEventListener("abort", cancel);
    if (!complete) cancel();
    try { reader?.releaseLock(); } catch {}
  }
}

export function applicationRefusal(error: unknown, redact: (message: string) => string): WireRouteResponse | undefined {
  if (!(error instanceof GiveUp) || error instanceof ServerError || error instanceof ParkStep) return;
  let message = "", size = 0;
  for (const character of redact(error.message)) {
    size += Buffer.byteLength(character, "utf8");
    if (size > 2000) break;
    message += character;
  }
  // JSON permits escaped lone UTF-16 surrogates that the core's UTF-8 JSON
  // parser cannot represent. Normalize those without exceeding the byte cap.
  return { status: 204, headers: [], bodyHex: "", applicationRefusal: Buffer.from(message, "utf8").toString("utf8") };
}
