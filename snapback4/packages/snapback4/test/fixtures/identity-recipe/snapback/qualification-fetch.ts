const controlOrigin = "http://127.0.0.1:38974";

function requestUrl(input: RequestInfo | URL): URL {
  if (input instanceof Request) return new URL(input.url);
  return new URL(String(input));
}

async function throughControl(input: RequestInfo | URL, init: RequestInit | undefined, target: URL): Promise<Response> {
  const request = new Request(input, init);
  const headers = new Headers(request.headers);
  headers.set("x-snapback4-qualification-worker-pid", String(process.pid));
  const body = request.method === "GET" || request.method === "HEAD"
    ? undefined
    : await request.arrayBuffer();
  return globalThis.fetch(target, {
    method: request.method,
    headers,
    body,
    redirect: request.redirect,
    signal: request.signal,
  });
}

/** Qualification-only transport. Engine calls cross a parent-owned loopback
 * fault proxy; provider calls stay direct after a metadata-only gate. */
export const qualificationFetch: typeof fetch = async (input, init) => {
  const engine = process.env.SNAPBACK_URL;
  if (!engine) throw new Error("qualification engine URL is unavailable");
  const url = requestUrl(input);
  if (url.origin === new URL(engine).origin) {
    return throughControl(input, init, new URL(`${url.pathname}${url.search}`, controlOrigin));
  }

  const gate = await globalThis.fetch(`${controlOrigin}/__qualification/provider-attempt`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ method: new Request(input, init).method, path: url.pathname, pid: process.pid }),
    signal: AbortSignal.timeout(5_000),
  });
  if (!gate.ok) throw new Error("qualification provider access is closed after the committed mint cut");
  return globalThis.fetch(input, init);
};
