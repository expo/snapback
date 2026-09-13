export interface EffectFetchLimits {
  requestBytes: number;
  responseBytes: number;
  concurrentFetches: number;
  totalFetches: number;
  redirects: number;
}

export interface EffectFetchController {
  fetch(input: string | URL, init?: RequestInit): Promise<EffectResponse>;
  close(): { active: number; total: number };
}

export interface EffectResponse {
  readonly status: number;
  readonly ok: boolean;
  readonly url: string;
  readonly redirected: boolean;
  readonly headers: Headers;
  readonly bodyUsed: boolean;
  text(): Promise<string>;
  json(): Promise<unknown>;
  arrayBuffer(): Promise<ArrayBuffer>;
}

interface FetchHost {
  nativeFetch: typeof globalThis.fetch;
  Headers: typeof globalThis.Headers;
  URL: typeof globalThis.URL;
  TextDecoder: typeof globalThis.TextDecoder;
  TextEncoder: typeof globalThis.TextEncoder;
  harden<T>(value: T): T;
  beforeDispatch(): Promise<void>;
}

const BODY_HEADERS = [
  "content-encoding", "content-language", "content-length", "content-location", "content-type",
];
const SENSITIVE_HEADERS = ["authorization", "proxy-authorization", "cookie"];
const REDIRECTS = new Set([301, 302, 303, 307, 308]);

// @ref LLP 1003#1-authoring — grants are checked before every raw request and
// redirect rewrites preserve Fetch method/header semantics.
export function createEffectFetch(
  rawGrants: readonly string[],
  limits: EffectFetchLimits,
  host: FetchHost,
): EffectFetchController {
  const grants = parseGrants(rawGrants, host.URL);
  const controllers = new Set<AbortController>();
  let active = 0;
  let total = 0;
  let closed = false;

  async function effectFetch(input: string | URL, init: RequestInit = {}): Promise<EffectResponse> {
    if (closed) throw effectError("E_EFFECT_CANCELLED", "effect fetch is closed", host.harden);
    if (active >= limits.concurrentFetches || total >= limits.totalFetches) {
      throw effectError("E_EFFECT_FETCH_LIMIT", "effect fetch count exceeds its bound", host.harden);
    }
    const redirect = init.redirect ?? "follow";
    if (redirect !== "follow" && redirect !== "manual" && redirect !== "error") {
      throw effectError("E_EFFECT_FETCH", "redirect must be follow, manual, or error", host.harden);
    }
    let url: URL;
    try { url = new host.URL(String(input)); }
    catch { throw effectError("E_EFFECT_FETCH", "fetch URL is invalid", host.harden); }
    let method = (init.method ?? "GET").toUpperCase();
    let headers: Headers;
    try { headers = new host.Headers(init.headers); }
    catch (error) { throw effectError("E_EFFECT_FETCH", safeMessage(error, "invalid fetch headers"), host.harden); }
    let body = copyBody(init.body, limits.requestBytes, host);
    total++;
    active++;
    try {
      let redirected = false;
      for (let hop = 0; ; hop++) {
        assertGrant(url, grants, host.harden);
        await host.beforeDispatch();
        if (closed) throw effectError("E_EFFECT_CANCELLED", "effect fetch is closed", host.harden);
        const controller = new AbortController();
        controllers.add(controller);
        let response: Response;
        try {
          response = await host.nativeFetch(url.href, {
            method,
            headers,
            body: requestBody(body),
            redirect: "manual",
            signal: controller.signal,
          });
        } catch (error) {
          throw effectError("E_EFFECT_FETCH", safeMessage(error, "provider request failed"), host.harden);
        }
        if (!REDIRECTS.has(response.status) || !response.headers.has("location")) {
          try {
            return await snapshotResponse(response, url.href, redirected, controller, limits, host);
          } finally {
            controllers.delete(controller);
          }
        }
        if (redirect === "manual") {
          try {
            return await snapshotResponse(response, url.href, redirected, controller, limits, host);
          } finally {
            controllers.delete(controller);
          }
        }
        await cancelBody(response);
        controllers.delete(controller);
        if (redirect === "error") {
          throw effectError("E_EFFECT_REDIRECT", "provider response redirected while redirect mode is error", host.harden);
        }
        if (hop >= limits.redirects) {
          throw effectError("E_EFFECT_REDIRECT", "provider response exceeded the redirect bound", host.harden);
        }
        const next = new host.URL(response.headers.get("location")!, url);
        if (next.origin !== url.origin) for (const name of SENSITIVE_HEADERS) headers.delete(name);
        if (response.status === 303 ? method !== "GET" && method !== "HEAD"
          : (response.status === 301 || response.status === 302) && method === "POST") {
          method = "GET";
          body = undefined;
          for (const name of BODY_HEADERS) headers.delete(name);
        }
        url = next;
        redirected = true;
      }
    } finally {
      active--;
    }
  }

  return host.harden({
    fetch: host.harden(effectFetch),
    close() {
      closed = true;
      const snapshot = { active, total };
      for (const controller of controllers) controller.abort();
      controllers.clear();
      return snapshot;
    },
  });
}

function parseGrants(grants: readonly string[], URLConstructor: typeof URL): Set<string> {
  const parsed = new Set<string>();
  for (const grant of grants) {
    const url = new URLConstructor(grant);
    if (url.origin !== grant || url.username || url.password
      || (url.protocol !== "https:" && !(url.protocol === "http:" && url.hostname === "127.0.0.1"))) {
      throw new TypeError("effect grants must be exact https:// or http://127.0.0.1 origins");
    }
    parsed.add(url.origin);
  }
  return parsed;
}

function assertGrant(url: URL, grants: Set<string>, hardenValue: FetchHost["harden"]): void {
  if (!grants.has(url.origin)) {
    throw effectError("E_EFFECT_GRANT", `denied net.fetch origin ${url.origin}`, hardenValue);
  }
}

function copyBody(body: BodyInit | null | undefined, maxBytes: number, host: FetchHost): string | Uint8Array | undefined {
  if (body === undefined || body === null) return undefined;
  if (typeof body === "string") {
    if (host.TextEncoder.prototype.encode.call(new host.TextEncoder(), body).byteLength > maxBytes) {
      throw effectError("E_EFFECT_REQUEST_TOO_LARGE", `effect request body exceeds ${maxBytes} bytes`, host.harden);
    }
    return body;
  }
  let bytes: Uint8Array;
  if (body instanceof ArrayBuffer) bytes = new Uint8Array(body.slice(0));
  else if (ArrayBuffer.isView(body)) bytes = new Uint8Array(body.buffer, body.byteOffset, body.byteLength).slice();
  else throw effectError("E_EFFECT_FETCH", "effect request body must be a string, ArrayBuffer, or typed array", host.harden);
  if (bytes.byteLength > maxBytes) {
    throw effectError("E_EFFECT_REQUEST_TOO_LARGE", `effect request body exceeds ${maxBytes} bytes`, host.harden);
  }
  return bytes;
}

function requestBody(body: string | Uint8Array | undefined): BodyInit | undefined {
  return body instanceof Uint8Array ? body.slice() : body;
}

async function snapshotResponse(
  response: Response,
  logicalUrl: string,
  redirected: boolean,
  controller: AbortController,
  limits: EffectFetchLimits,
  host: FetchHost,
): Promise<EffectResponse> {
  const stated = response.headers.get("content-length");
  if (stated && /^\d+$/.test(stated) && Number(stated) > limits.responseBytes) {
    controller.abort();
    throw effectError("E_EFFECT_RESPONSE_TOO_LARGE", `effect response body exceeds ${limits.responseBytes} bytes`, host.harden);
  }
  const bytes = await readBounded(response, limits.responseBytes, controller, host.harden);
  const headers = host.harden(new host.Headers(response.headers));
  let used = false;
  function take(): Uint8Array {
    if (used) throw effectError("E_EFFECT_BODY_USED", "effect response body is already used", host.harden);
    used = true;
    return bytes.slice();
  }
  const result = {
    status: response.status,
    ok: response.ok,
    url: logicalUrl,
    redirected,
    headers,
    get bodyUsed() { return used; },
    async text() { return new host.TextDecoder().decode(take()); },
    async json() { return JSON.parse(new host.TextDecoder().decode(take())); },
    async arrayBuffer() {
      const copy = take();
      const buffer = new ArrayBuffer(copy.byteLength);
      new Uint8Array(buffer).set(copy);
      return buffer;
    },
  };
  return host.harden(result);
}

async function readBounded(
  response: Response,
  maxBytes: number,
  controller: AbortController,
  hardenValue: FetchHost["harden"],
): Promise<Uint8Array> {
  if (!response.body) return new Uint8Array();
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > maxBytes) {
        controller.abort();
        throw effectError("E_EFFECT_RESPONSE_TOO_LARGE", `effect response body exceeds ${maxBytes} bytes`, hardenValue);
      }
      chunks.push(value.slice());
    }
  } finally {
    reader.releaseLock();
  }
  const output = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) { output.set(chunk, offset); offset += chunk.byteLength; }
  return output;
}

async function cancelBody(response: Response): Promise<void> {
  try { await response.body?.cancel(); }
  catch { /* redirect cleanup is best effort; the owning child still exits */ }
}

function effectError(code: string, message: string, hardenValue: FetchHost["harden"]): Error & { code: string } {
  const error = new Error(message) as Error & { code: string };
  Object.defineProperty(error, "code", { value: code, enumerable: true });
  return hardenValue(error);
}

function safeMessage(error: unknown, fallback: string): string {
  return error instanceof Error && error.message ? error.message.slice(0, 1_024) : fallback;
}
