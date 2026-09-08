/** Multiplex wire fixture backed by the existing per-query/channel test sources. */
import { parseSse } from "../src/sse-parser.ts";
import { createClient as realClient } from "../dist/client.mjs";

export function channelFrame<Value = unknown>(
  entries: readonly { key: string; from: string; value: Value; expiresAt: number }[] = [],
  key = "a".repeat(32),
  lease = "b".repeat(64),
) {
  return { state: "snapshot" as const, key, lease, entries };
}

export function fixtureClient(options: Parameters<typeof realClient>[0]): ReturnType<typeof realClient> {
  return realClient({ ...options, fetch: multiplexFetch(options.fetch ?? globalThis.fetch.bind(globalThis)) });
}
export function multiplexFetch(source: typeof fetch): typeof fetch {
  let next = 0;
  const sessions = new Map<string, { output: ReadableStreamDefaultController<Uint8Array>; children: Map<string, AbortController>; closed: boolean }>();
  const bytes = new TextEncoder();
  const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status });
  return async (input, init) => {
    const url = new URL(String(input));
    if (url.pathname !== "/api/live" && url.pathname !== "/api/live/control") return source(input, init);
    if (url.pathname === "/api/live") {
      const id = (++next).toString(16).padStart(64, "0");
      let session: typeof sessions extends Map<any, infer V> ? V : never;
      const close = () => {
        if (session.closed) return;
        session.closed = true; sessions.delete(id);
        for (const child of session.children.values()) child.abort();
        try { session.output.close(); } catch {}
      };
      return new Response(new ReadableStream({
        start(output) {
          session = { output, children: new Map(), closed: false }; sessions.set(id, session);
          output.enqueue(bytes.encode(`data: ${JSON.stringify({ session: id })}\n\n`));
          init?.signal?.addEventListener("abort", close, { once: true });
        },
        cancel: close,
      }), { headers: { "Content-Type": "text/event-stream" } });
    }
    const command = JSON.parse(String(init?.body));
    const session = sessions.get(command.session);
    if (!session) return json({ code: "E_INPUT", family: "input", guide: "input/json", message: "closed live fixture" }, 400);
    const send = (value: unknown) => { if (!session.closed) session.output.enqueue(bytes.encode(`data: ${JSON.stringify(value)}\n\n`)); };
    for (const id of command.remove ?? []) { session.children.get(id)?.abort(); session.children.delete(id); }
    if (command.close) {
      session.closed = true; sessions.delete(command.session);
      for (const child of session.children.values()) child.abort();
      session.output.close();
    } else for (const { id, path, lastEventId } of command.add ?? []) {
      const abort = new AbortController(); session.children.set(id, abort);
      const headers = new Headers(init?.headers); headers.delete("Content-Type");
      if (lastEventId !== undefined) headers.set("Last-Event-ID", lastEventId);
      void (async () => {
        const response = await source(new URL(path, url).href, { headers, signal: abort.signal });
        if (!response.ok) {
          const data = await response.json();
          if (response.status >= 500 || typeof data?.code !== "string" || typeof data?.family !== "string" || typeof data?.guide !== "string") {
            throw new TypeError("fixture upstream subscription transport failed");
          }
          send({ id, seq: null, data: { ...data, state: "refused" }, terminal: true });
          return;
        }
        for await (const event of parseSse(response, abort.signal, () => {
          if (!session.closed) session.output.enqueue(bytes.encode(": heartbeat\n\n"));
        })) {
          const data = JSON.parse(event.data);
          const terminal = data?.state === "refused";
          if (!abort.signal.aborted) send({ id, seq: event.id === undefined ? null : Number(event.id), data, terminal });
        }
        if (!abort.signal.aborted) send({ id, closed: true });
      })().catch(error => {
        if (!abort.signal.aborted && !session.closed) { session.closed = true; session.output.error(error); }
      });
    }
    return json({ ok: true });
  };
}

/** Public reads/writes resolve a complete refusal value; a thrown promise fails this assertion. */
export async function assertRefused(request: Promise<any> | (() => Promise<any>), expected?: any, message?: string): Promise<void> {
  const assert = (await import('node:assert/strict')).default;
  const value = await (typeof request === 'function' ? request() : request);
  assert.ok(value?.state === 'refused' || value?.state === 'rejected', message ?? `expected a refusal, received ${JSON.stringify(value)}`);
  for (const field of ['code', 'family', 'message']) assert.equal(typeof value[field], 'string', field);
  if (expected instanceof RegExp) assert.match(value.message, expected, message);
  else if (typeof expected === 'function') assert.equal(expected(value), true, message);
  else if (expected && typeof expected === 'object') for (const [field, wanted] of Object.entries(expected)) {
    if (wanted instanceof RegExp) assert.match(value[field], wanted, message);
    else assert.deepEqual(value[field], wanted, message);
  }
}
