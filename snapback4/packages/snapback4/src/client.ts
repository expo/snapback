// The online tier (LLP 2000.000 §7.4): no store, no interpreter. Reads go
// to the server and are `fresh` when it answered; an observed read re-runs
// when a commit touches its tables; a write is sent with a client-minted id
// and applies at most once, and waits as `pending` while the link is down.
// Every word a screen reads is on the card (contract.ts).

import type { Client, Cursor, Link, Mutation, Observed, Principal, Query, Read, Refusal, Write } from "./contract.ts";
import type { Session } from "./auth.ts";

export interface ClientOptions {
  /** The server, e.g. `http://127.0.0.1:4400`. */
  readonly url: string;
  /** A development persona (loopback only): `alice` acts as `dev:alice`. */
  readonly persona?: string;
  /** A session from `guest()`, `login()` or `signup()` (deployed servers). */
  readonly session?: Session;
  /** A bare bearer token, when the app keeps sessions itself. */
  readonly token?: string;
  readonly fetch?: typeof fetch;
  /** How long a change poll waits at the server, in seconds. */
  readonly waitSeconds?: number;
}

type ReadyRead<T> = Extract<Read<T>, { data: T }>;

interface Watch {
  op: Query<unknown, unknown>;
  args: unknown;
  key: string;
  tables: Set<string>;
  snapshot: Read<unknown>;
  lastServer: ReadyRead<unknown> | null;
  lastServerAt: number;
  subscribers: Set<() => void>;
  inFlight: boolean;
  dirty: boolean;
}

const ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";

/** A time-ordered 128-bit id: 48 bits of milliseconds, 80 bits of entropy, 26 base32 digits. */
export function mintId(now = Date.now()): string {
  const bytes = new Uint8Array(10);
  if (typeof crypto !== "undefined" && crypto.getRandomValues) crypto.getRandomValues(bytes);
  else for (let i = 0; i < bytes.length; i++) bytes[i] = Math.floor(Math.random() * 256);
  let value = BigInt(now) << 80n;
  for (const byte of bytes) value = (value << 8n) | BigInt(byte);
  let out = "";
  for (let i = 0; i < 26; i++) {
    out = ALPHABET[Number(value & 31n)] + out;
    value >>= 5n;
  }
  return out;
}

export function createClient(options: ClientOptions): Client {
  const doFetch = options.fetch ?? globalThis.fetch.bind(globalThis);
  const base = options.url.replace(/\/$/, "");
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (options.persona) headers["x-snapback-persona"] = options.persona;
  const token = options.session?.token ?? options.token;
  if (token) headers.authorization = `Bearer ${token}`;
  const viewer: Principal | null = options.persona ? (`dev:${options.persona}` as Principal) : options.session ? (options.session.principal as Principal) : null;
  let link: Link = viewer ? "online" : "signed-out";
  let closed = false;
  const aborter = new AbortController();
  let seq = 0;
  const linkListeners = new Set<(link: Link) => void>();
  const watches = new Map<string, Watch>();
  const pending: { id: string; op: Mutation<unknown, unknown>; args: unknown; resolve: (write: Write) => void }[] = [];

  const setLink = (next: Link) => {
    if (link === next) return;
    link = next;
    for (const listener of linkListeners) listener(next);
    if (next === "online") {
      void flush();
      for (const watch of watches.values()) void refresh(watch);
    } else {
      for (const watch of watches.values()) {
        if (watch.lastServer) {
          watch.snapshot = { ...watch.lastServer, fresh: false, since: watch.lastServerAt };
          notify(watch);
        }
      }
    }
  };

  const offline = (): Refusal => ({ code: "E_OFFLINE", family: "link", message: "the server is unreachable", retryable: true });

  async function post(path: string, body: unknown): Promise<{ ok: true; json: Record<string, unknown> } | { ok: false }> {
    try {
      const response = await doFetch(`${base}${path}`, { method: "POST", headers, body: JSON.stringify(body) });
      const json = (await response.json()) as Record<string, unknown>;
      if (response.status === 503) return { ok: false };
      if (link !== "online" && viewer) setLink("online");
      return { ok: true, json };
    } catch {
      if (viewer) setLink("offline");
      return { ok: false };
    }
  }

  async function runQuery<A, R>(op: Query<A, R>, args: A): Promise<{ read: Read<R>; tables: string[]; seq: number }> {
    if (!viewer) return { read: { denied: { code: "E_AUTH", family: "auth", message: "sign in to read" } }, tables: [], seq };
    const result = await post(`/q/${op.name}`, { args });
    if (!result.ok) return { read: { denied: offline() }, tables: [], seq };
    const json = result.json;
    if (json.denied) return { read: { denied: json.denied as Refusal }, tables: [], seq };
    const at = Number(json.seq ?? 0);
    if (at > seq) seq = at;
    const next = (json.next as Cursor | null | undefined) ?? null;
    return { read: { data: json.data as R, complete: json.complete !== false, fresh: true, next }, tables: (json.tables as string[] | undefined) ?? [], seq: at };
  }

  function notify(watch: Watch) {
    for (const subscriber of watch.subscribers) subscriber();
  }

  async function refresh(watch: Watch) {
    if (watch.inFlight) {
      watch.dirty = true;
      return;
    }
    watch.inFlight = true;
    try {
      const { read, tables } = await runQuery(watch.op, watch.args);
      if (closed) return;
      if ("data" in read) {
        watch.lastServer = read;
        watch.lastServerAt = Date.now();
        watch.tables = new Set(tables);
        watch.snapshot = read;
      } else if ("denied" in read && read.denied.code === "E_OFFLINE" && watch.lastServer) {
        watch.snapshot = { ...watch.lastServer, fresh: false, since: watch.lastServerAt };
      } else {
        watch.snapshot = read;
      }
      notify(watch);
    } finally {
      watch.inFlight = false;
      if (watch.dirty) {
        watch.dirty = false;
        void refresh(watch);
      }
    }
  }

  let polling = false;
  async function poll() {
    if (polling) return;
    polling = true;
    while (!closed && watches.size > 0) {
      if (link !== "online") {
        await new Promise((r) => setTimeout(r, 1000));
        if (viewer && link === "offline") {
          const probe = await post("/q/__probe", {});
          if (probe.ok) setLink("online");
        }
        continue;
      }
      try {
        const response = await doFetch(`${base}/changes?since=${seq}&wait=${options.waitSeconds ?? 25}`, { headers, signal: aborter.signal });
        const json = (await response.json()) as { seq: number; tables: string[] };
        if (json.seq > seq) {
          seq = json.seq;
          const touched = new Set(json.tables);
          for (const watch of watches.values()) {
            if ([...watch.tables].some((t) => touched.has(t))) void refresh(watch);
          }
        }
      } catch {
        if (closed) break;
        if (viewer) setLink("offline");
        await new Promise((r) => setTimeout(r, 1000));
      }
    }
    polling = false;
  }

  async function send(entry: (typeof pending)[number]): Promise<boolean> {
    const result = await post(`/m/${entry.op.name}`, { id: entry.id, args: entry.args });
    if (!result.ok) return false;
    const json = result.json;
    if (json.state === "sent") {
      const at = Number(json.seq ?? 0);
      if (at > seq) seq = at;
      entry.resolve({ state: "sent", id: entry.id, seq: at });
      for (const watch of watches.values()) void refresh(watch);
    } else {
      // A 400 carries `denied` (an input or auth refusal), a judged write
      // carries `why`; neither is the link's fault.
      entry.resolve({ state: "failed", id: entry.id, why: (json.why as Refusal | undefined) ?? (json.denied as Refusal | undefined) ?? { code: "E_STORE", family: "store", message: "the server answered without a state", retryable: true } });
    }
    return true;
  }

  async function flush() {
    while (pending.length > 0 && link === "online") {
      const entry = pending[0]!;
      const sent = await send(entry);
      if (!sent) return;
      pending.shift();
    }
  }

  const client: Client = {
    async query(op, args) {
      return (await runQuery(op, args)).read;
    },
    observe<A, R>(op: Query<A, R>, args: A): Observed<R> {
      const key = `${op.name}:${JSON.stringify(args)}`;
      let watch = watches.get(key);
      if (!watch) {
        watch = { op: op as Query<unknown, unknown>, args, key, tables: new Set(), snapshot: { loading: true }, lastServer: null, lastServerAt: 0, subscribers: new Set(), inFlight: false, dirty: false };
        watches.set(key, watch);
        void refresh(watch);
        void poll();
      }
      const own = watch;
      const mine = new Set<() => void>();
      return {
        getSnapshot: () => own.snapshot as Read<R>,
        subscribe(notifyMe) {
          mine.add(notifyMe);
          own.subscribers.add(notifyMe);
          return () => {
            mine.delete(notifyMe);
            own.subscribers.delete(notifyMe);
          };
        },
        close() {
          for (const s of mine) own.subscribers.delete(s);
          if (own.subscribers.size === 0) watches.delete(own.key);
        },
      };
    },
    async mutate<A, R>(op: Mutation<A, R>, args: A): Promise<Write> {
      const id = mintId();
      if (!viewer) return { state: "failed", id, why: { code: "E_AUTH", family: "auth", message: "sign in to write" } };
      let settle!: (write: Write) => void;
      const settled = new Promise<Write>((resolve) => { settle = resolve; });
      const entry = { id, op: op as Mutation<unknown, unknown>, args, resolve: settle };
      if (link === "offline" || pending.length > 0) {
        pending.push(entry);
        void flush();
        return { state: "pending", id };
      }
      pending.push(entry);
      const sent = await send(entry);
      if (sent) {
        pending.shift();
        return settled;
      }
      // Durable admission on this device: the write waits for the link.
      return { state: "pending", id };
    },
    link: () => link,
    onLink(listener) {
      linkListeners.add(listener);
      return () => linkListeners.delete(listener);
    },
    viewer: () => viewer,
    async close() {
      closed = true;
      aborter.abort();
      watches.clear();
      linkListeners.clear();
    },
  };
  return client;
}
