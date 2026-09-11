// @ref LLP 1002#4-the-wire — one physical SSE stream, independently fenced logical streams.
import { parseSse, type SseResponse } from "./sse-parser.js";
import { responseRefusal, wireShape, wireRefusal, isTerminalSession, RefusalError } from "./client-wire.js";

interface Entry {
  id: string;
  path: string;
  lastEventId?: string;
  controller: ReadableStreamDefaultController<Uint8Array>;
  pending?: Uint8Array;
  closed: boolean;
  detach(): void;
  ready(): void;
  refuse(error: unknown): void;
}
interface Connection {
  headers: Headers;
  key: string;
  abort: AbortController;
  entries: Map<string, Entry>;
  sent: Set<string>;
  session?: string;
  flushing: boolean;
  terminal(error: RefusalError): Promise<void>;
}
const encoder = new TextEncoder();
const maxSubscriptions = 256;
const aborted = () => { const error = new Error("subscription closed"); error.name = "AbortError"; return error; };
const capacityRefusal = () => new RefusalError({
  code: "E_OWNER_BUSY", family: "owner",
  message: `a live connection supports at most ${maxSubscriptions} subscriptions`,
  site: "client.subscribe", rewrite: "close unused subscriptions", guide: "live-query",
});

export class SharedSse {
  private connection?: Connection;
  private next = 0;
  constructor(private readonly url: string, private readonly fetch: typeof globalThis.fetch) {}

  open(path: string, lastEventId: string | undefined, signal: AbortSignal, headers: Headers, terminal: Connection["terminal"]): Promise<SseResponse> {
    if (signal.aborted) throw aborted();
    const key = JSON.stringify([...headers].filter(([name]) => name !== "last-event-id"));
    if (this.connection && this.connection.key !== key) this.close();
    let connection = this.connection;
    // @ref LLP 1002#4-the-wire — refuse only the excess logical child; a
    // server-level control refusal would otherwise terminally fail all 256
    // healthy siblings carried by the same physical stream.
    if (connection && connection.entries.size >= maxSubscriptions) {
      return Promise.reject(capacityRefusal());
    }
    if (!connection) {
      connection = { headers: new Headers(headers), key, abort: new AbortController(), entries: new Map(), sent: new Set(), flushing: false, terminal };
      connection.headers.delete("Last-Event-ID");
      this.connection = connection;
      // Register the first child before even a synchronous fixture can return.
      queueMicrotask(() => { void this.read(connection!).catch(error => this.fail(connection!, error)); });
    }
    const current = connection;
    const id = String(++this.next);
    let entry: Entry;
    let response: SseResponse;
    let resolve!: (response: SseResponse) => void;
    let reject!: (error: unknown) => void;
    const ready = new Promise<SseResponse>((yes, no) => { resolve = yes; reject = no; });
    const remove = () => {
      if (entry.closed) return;
      entry.closed = true;
      entry.refuse(aborted());
      entry.detach();
      entry.pending = undefined;
      current.entries.delete(id);
      // Keep already-buffered terminal evidence readable across an abort.
      try { entry.controller.close(); } catch {}
      this.schedule(current);
    };
    const body = new ReadableStream<Uint8Array>({
      start: controller => {
        entry = { id, path, lastEventId, controller, closed: false, ready: () => resolve(response), refuse: reject, detach: () => signal.removeEventListener("abort", remove) };
        current.entries.set(id, entry);
        signal.addEventListener("abort", remove, { once: true });
      },
      pull: controller => {
        if (entry.pending && !entry.closed) {
          const pending = entry.pending; entry.pending = undefined;
          controller.enqueue(pending);
        }
      },
      cancel: remove,
    }, { highWaterMark: 2 });
    this.schedule(current);
    // React Native's global Response does not expose a streaming body, even
    // when fetch itself streams. A logical child needs only this parser input.
    response = { ok: true, body };
    if (current.session) entry!.ready();
    return ready;
  }

  close(): void {
    const connection = this.connection;
    if (!connection) return;
    this.connection = undefined;
    connection.abort.abort();
    for (const entry of connection.entries.values()) {
      entry.closed = true; entry.refuse(aborted()); entry.detach(); entry.pending = undefined;
      try { entry.controller.close(); } catch {}
    }
    connection.entries.clear();
    // Release owner subscriptions promptly instead of waiting for its heartbeat
    // to discover the closed socket. This request carries the old authority.
    if (connection.session) {
      const abort = new AbortController();
      const timer = setTimeout(() => abort.abort(), 2_000);
      void this.control(connection, { close: true }, abort.signal)
        .catch(() => undefined).finally(() => clearTimeout(timer));
    }
  }

  private fail(connection: Connection, error: unknown): void {
    if (this.connection !== connection) return;
    for (const entry of connection.entries.values()) {
      entry.closed = true; entry.refuse(error); entry.detach();
      try { entry.controller.error(error); } catch {}
    }
    connection.entries.clear();
    this.close();
  }

  private async read(connection: Connection): Promise<void> {
    const response = await this.fetch(`${this.url}/api/live`, {
      // Expo Android represents a body-less POST as a NUL byte; send valid JSON.
      method: "POST", body: "{}", headers: connection.headers, signal: connection.abort.signal,
    });
    if (!response.ok) {
      const error = await responseRefusal(response);
      if (this.connection !== connection && isTerminalSession(error.envelope)) await connection.terminal(error);
      throw error;
    }
    const activity = () => {
      if (this.connection !== connection) return;
      for (const entry of connection.entries.values()) {
        if ((entry.controller.desiredSize ?? 0) > 1) entry.controller.enqueue(encoder.encode(": heartbeat\n\n"));
      }
    };
    for await (const parsed of parseSse(response, connection.abort.signal, activity)) {
      let frame: any;
      try { frame = JSON.parse(parsed.data); } catch { throw wireShape("invalid live frame JSON"); }
      if (!frame || typeof frame !== "object" || Array.isArray(frame)) throw wireShape("invalid live frame");
      if (frame.data?.state === "refused" && isTerminalSession(frame.data)
        && (this.connection !== connection || !connection.entries.has(frame.id))) {
        await connection.terminal(new RefusalError(wireRefusal(frame.data, "live session refusal")));
      }
      if (this.connection !== connection) continue;
      if (typeof frame.session === "string") {
        if (connection.session || !/^[a-f0-9]{64}$/.test(frame.session)) throw wireShape("invalid live session");
        connection.session = frame.session;
        for (const entry of connection.entries.values()) entry.ready();
        this.schedule(connection);
        continue;
      }
      if (!connection.session || typeof frame.id !== "string") throw wireShape("live frame requires a subscription id");
      const entry = connection.entries.get(frame.id);
      if (!entry) continue; // A removed subscription can still have bytes in flight.
      if (frame.closed === true) { this.finish(connection, entry); continue; }
      if (typeof frame.terminal !== "boolean" || !Object.hasOwn(frame, "data")
        || !(frame.seq === null || (Number.isSafeInteger(frame.seq) && frame.seq >= 0))) {
        throw wireShape("invalid live delivery envelope");
      }
      const id = frame.seq === null ? "" : `id: ${frame.seq}\n`;
      const bytes = encoder.encode(`${id}data: ${JSON.stringify(frame.data)}\n\n`);
      if (frame.terminal) {
        entry.pending = undefined;
        entry.controller.enqueue(bytes);
        this.finish(connection, entry);
      } else if ((entry.controller.desiredSize ?? 0) > 0) {
        entry.controller.enqueue(bytes);
      } else {
        // @ref LLP 1001.000#snapshot-and-transport — each child carries replaceable current state.
        entry.pending = bytes;
      }
    }
    if (this.connection === connection) throw new TypeError("live connection closed");
  }

  private finish(connection: Connection, entry: Entry): void {
    entry.closed = true; entry.detach();
    connection.entries.delete(entry.id);
    try { entry.controller.close(); } catch {}
    this.schedule(connection);
  }

  private schedule(connection: Connection): void {
    if (this.connection !== connection || connection.flushing || !connection.session) return;
    connection.flushing = true;
    queueMicrotask(() => {
      void this.flush(connection).catch(error => this.fail(connection, error)).finally(() => {
        connection.flushing = false;
        if (this.connection === connection && (connection.entries.size !== connection.sent.size
          || [...connection.entries.keys()].some(id => !connection.sent.has(id)))) this.schedule(connection);
      });
    });
  }

  private async flush(connection: Connection): Promise<void> {
    while (this.connection === connection) {
      const add = [...connection.entries.values()].filter(entry => !connection.sent.has(entry.id))
        .map(({ id, path, lastEventId }) => ({ id, path, lastEventId }));
      const remove = [...connection.sent].filter(id => !connection.entries.has(id));
      if (!add.length && !remove.length) return;
      for (const { id } of add) connection.sent.add(id);
      for (const id of remove) connection.sent.delete(id);
      await this.control(connection, { add, remove }, connection.abort.signal);
    }
  }

  private async control(connection: Connection, command: object, signal: AbortSignal): Promise<void> {
    const headers = new Headers(connection.headers); headers.set("Content-Type", "application/json");
    const response = await this.fetch(`${this.url}/api/live/control`, {
      method: "POST", headers, signal, body: JSON.stringify({ session: connection.session, ...command }),
    });
    if (!response.ok) throw await responseRefusal(response);
    const value = await response.json();
    if (value?.ok !== true) throw wireShape("invalid live control acknowledgement");
  }
}
