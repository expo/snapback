// @ref LLP 1001.000#observable-client-surface — one owned handle exposes current ephemeral state and privately holds its live lease.
import {
  RefusalError, copyRefusal, toRefusal, isTerminalSession, wireChannelFrame, wireChannelWrite,
  type ChannelFrame,
} from "./client-wire.js";
import { referenceName, type Channel as ChannelRef } from "./api.js";
import { ReconnectingSse } from "./sse.js";
import type { SseResponse } from "./sse-parser.js";
import type {
  ChannelHandle, ChannelSnapshot, ChannelWriteResult, ClientSnapshot,
  Refusal, Subscription,
} from "./types.js";

/** Authority and transport custody remain with the ordinary client. */
export interface ChannelHost<Authority, Expiration> {
  operationAuthority(): Promise<Authority>;
  trackWrite<Result>(run: () => Promise<Result>): Promise<Result>;
  json(path: string, init: RequestInit, authority: Authority, options: { terminalSession: "typed-result" }): Promise<unknown>;
  stream(path: string, lastEventId: string | undefined, signal: AbortSignal, authority: Authority): Promise<SseResponse>;
  authorityCurrent(authority: Authority | undefined): boolean;
  ensureAuthority(authority: Authority | undefined): void;
  validated(authority: Authority): void;
  expireSession(authority: Authority): Promise<Expiration>;
  expirationCurrent(expiration: Expiration): boolean;
  supersededRefusal(): RefusalError;
  recordRefusal(refusal: Refusal): void;
  patchSnapshot(patch: Partial<ClientSnapshot>): void;
  transportFailureState(): "reconnecting" | "offline";
  subscriptionError(error: unknown, authority: Authority | undefined, origin: Subscription<unknown>):
    Promise<{ event?: unknown; retry: boolean; refusal?: RefusalError }>;
  track<Event>(subscription: Subscription<Event>): Subscription<Event>;
}

interface Waiter<Value> {
  predicate: (snapshot: ChannelSnapshot<Value>) => boolean;
  resolve(snapshot: ChannelSnapshot<Value>): void;
  reject(error: Error): void;
  timer: ReturnType<typeof setTimeout>;
}
interface Lease { key: string; token: string }
interface Connection<Authority, Value> {
  authority?: Authority;
  lease?: Lease;
  attempt: number;
  version: number;
  sse?: ReconnectingSse<ChannelFrame<Value>>;
  tracked: Subscription<ChannelSnapshot<Value>> & { reconnect(): void };
  pending: Set<{ resolve(lease: Lease): void; reject(error: Error): void }>;
}

function refusal(code: string, message: string): RefusalError {
  return new RefusalError({ code, family: "op", message, guide: "live-query", site: "client.channel", retryable: false,
    rewrite: "use a ready channel handle; reconnect or create a new handle after closing it" });
}
function freeze<Value>(value: Value): Value {
  if (value !== null && typeof value === "object") {
    for (const child of Object.values(value)) freeze(child);
    Object.freeze(value);
  }
  return value;
}

export function createChannel<Authority, Expiration, Args, Value>(
  host: ChannelHost<Authority, Expiration>, ref: ChannelRef<Args, Value>, args: Args,
): ChannelHandle<Value> {
  const path = referenceName(ref);
  const name = encodeURIComponent(path.startsWith("channels.") ? path.slice("channels.".length) : path);
  // Keep the submitted scope stable across callers mutating their argument object.
  const scope = JSON.stringify(args), requestArgs: unknown = JSON.parse(scope);
  const subscribePath = `/api/channel/${name}/subscribe?args=${encodeURIComponent(scope)}`;
  let state: ChannelSnapshot<Value> = freeze({ status: "loading", entries: [] });
  let connection: Connection<Authority, Value> | undefined;
  let closed = false;
  let failure: Error | undefined;
  let invocation = 0, clearedThrough = 0;
  const listeners = new Set<(snapshot: ChannelSnapshot<Value>) => void>();
  const waiters = new Set<Waiter<Value>>();

  function rejectWaiters(error: Error): void {
    for (const waiter of waiters) { clearTimeout(waiter.timer); waiter.reject(error); }
    waiters.clear();
  }
  function publish(snapshot: ChannelSnapshot<Value>): void {
    state = freeze(snapshot);
    for (const listener of [...listeners]) { try { listener(state); } catch {} }
    for (const waiter of [...waiters]) {
      try {
        if (!waiter.predicate(state)) continue;
        clearTimeout(waiter.timer); waiters.delete(waiter); waiter.resolve(state);
      } catch (error) {
        clearTimeout(waiter.timer); waiters.delete(waiter);
        waiter.reject(error instanceof Error ? error : new Error(String(error)));
      }
    }
  }
  function invalidate(current: Connection<Authority, Value>, error: Error): void {
    current.lease = undefined;
    for (const pending of current.pending) pending.reject(error);
    current.pending.clear();
  }
  function release(current: Connection<Authority, Value>): void {
    if (connection === current) connection = undefined;
    invalidate(current, failure ?? refusal("E_CHANNEL_LEASE", "channel connection closed"));
    current.sse?.close();
    // The registered close sees that this connection has already been retired.
    current.tracked.close();
  }
  function terminal(current: Connection<Authority, Value>, error: Error, envelope?: Refusal): void {
    if (connection !== current) return;
    failure = error;
    rejectWaiters(error);
    release(current);
    publish({ status: "unavailable", reason: envelope ? "refused" : "closed", entries: [],
      ...(envelope ? { refusal: copyRefusal(envelope) } : {}) });
  }
  function loss(current: Connection<Authority, Value>): void {
    if (connection !== current) return;
    invalidate(current, refusal("E_CHANNEL_LEASE", "channel connection changed before the write completed"));
    publish({ status: "unavailable", reason: host.transportFailureState(), entries: [] });
  }
  function until(predicate: Waiter<Value>["predicate"], timeoutMs = 30_000,
    owned?: Set<Waiter<Value>>): Promise<ChannelSnapshot<Value>> {
    if (failure) return Promise.reject(failure);
    if (closed) return Promise.reject(refusal("E_CHANNEL_CLOSED", "channel handle is closed"));
    try { if (predicate(state)) return Promise.resolve(state); } catch (error) { return Promise.reject(error); }
    return new Promise((resolve, reject) => {
      const remove = () => { waiters.delete(waiter); owned?.delete(waiter); };
      const waiter: Waiter<Value> = {
        predicate,
        resolve: value => { remove(); resolve(value); },
        reject: error => { remove(); reject(error); },
        timer: setTimeout(() => { remove(); reject(new Error(`channel condition timed out after ${timeoutMs} ms`)); }, timeoutMs),
      };
      waiters.add(waiter); owned?.add(waiter);
    });
  }
  function start(): Connection<Authority, Value> {
    if (failure) throw failure;
    if (closed) throw refusal("E_CHANNEL_CLOSED", "channel handle is closed");
    if (connection) return connection;
    const current: Connection<Authority, Value> = {
      attempt: 0, version: 0, pending: new Set(),
      tracked: {
        close: () => {
          if (connection !== current) return;
          closed = true;
          terminal(current, refusal("E_CHANNEL_CLOSED", "channel handle is closed"));
        },
        until,
        reconnect: () => { loss(current); current.sse?.reconnect(); },
      },
    };
    connection = current;
    host.track(current.tracked);
    current.sse = new ReconnectingSse<ChannelFrame<Value>>({
      open: async (_lastEventId, signal) => {
        current.attempt += 1;
        current.version = 0;
        current.authority ??= await host.operationAuthority();
        host.ensureAuthority(current.authority);
        return host.stream(subscribePath, undefined, signal, current.authority);
      },
      decode: ({ data }, active) => {
        const frame = wireChannelFrame<Value>(data);
        if (frame.state === "refused" && (isTerminalSession(frame) || frame.code === "E_CHANNEL_RESET")) {
          throw new RefusalError(copyRefusal(frame), frame.code === "E_CHANNEL_RESET");
        }
        host.ensureAuthority(current.authority);
        if (!active() || connection !== current) throw host.supersededRefusal();
        host.patchSnapshot({ connection: "connected", lastRefusal: frame.state === "refused" ? copyRefusal(frame) : undefined });
        if (frame.state === "snapshot") {
          if (current.lease && (current.lease.token !== frame.lease || current.lease.key !== frame.key)) {
            throw refusal("E_WIRE_SHAPE", "channel identity changed inside a live stream");
          }
          current.lease ??= { key: frame.key, token: frame.lease };
        }
        return frame;
      },
      bufferedTerminal: ({ data }) => {
        const frame = wireChannelFrame<Value>(data);
        return frame.state === "refused" && isTerminalSession(frame)
          ? new RefusalError(copyRefusal(frame)) : undefined;
      },
      onEvent: frame => {
        if (connection !== current) return;
        if (frame.state === "refused") {
          host.recordRefusal(copyRefusal(frame));
          terminal(current, new RefusalError(copyRefusal(frame)), frame);
        } else {
          publish({ status: "ready", key: frame.key, entries: frame.entries });
          if (connection !== current) return;
          for (const pending of current.pending) pending.resolve(current.lease!);
          current.pending.clear();
        }
      },
      onError: async error => {
        const decision = await host.subscriptionError(error, current.authority, current.tracked);
        if (connection !== current) return { retry: false };
        if (!decision.retry) {
          const problem = decision.refusal ?? refusal("E_CHANNEL_LEASE", "channel subscription ended");
          terminal(current, problem, decision.event ? problem.envelope : undefined);
        }
        return { retry: decision.retry, failure: decision.refusal };
      },
      onLoss: () => { loss(current); return undefined; },
      terminal: frame => frame.state === "refused" ? new RefusalError(copyRefusal(frame)) : undefined,
    });
    return current;
  }
  function readyLease(current: Connection<Authority, Value>): Promise<Lease> {
    if (current.lease) return Promise.resolve(current.lease);
    return new Promise((resolve, reject) => {
      const done = () => { clearTimeout(timer); current.pending.delete(pending); };
      const pending = {
        resolve: (lease: Lease) => { done(); resolve(lease); },
        reject: (error: Error) => { done(); reject(error); },
      };
      const timer = setTimeout(() => {
        done(); reject(refusal("E_CHANNEL_LEASE", "channel did not receive its initial snapshot within 30000 ms"));
      }, 30_000);
      current.pending.add(pending);
    });
  }
  // @ref LLP 1001.000#snapshot-and-transport — versions order invocations even when HTTP arrival is reordered; no write is replayed onto a new lease.
  async function write(kind: "set" | "clear", value?: Value): Promise<ChannelWriteResult> {
    const call = ++invocation;
    if (failure) throw failure;
    if (closed) throw refusal("E_CHANNEL_CLOSED", "channel handle is closed");
    if (kind === "clear" && !connection?.lease) {
      clearedThrough = call;
      if (connection) for (const pending of connection.pending) {
        pending.reject(refusal("E_CHANNEL_LEASE", "pending channel set was cleared before its initial snapshot"));
      }
      return { ok: true };
    }
    if (state.status === "unavailable") throw refusal("E_CHANNEL_LEASE", "channel is not connected");
    const submitted = kind === "set" ? JSON.parse(JSON.stringify(value)) : undefined;
    const current = start(), attempt = current.attempt, version = ++current.version;
    if (!Number.isSafeInteger(version)) throw refusal("E_CHANNEL_VERSION", "channel write version exhausted");
    const lease = await readyLease(current);
    const authority = await host.operationAuthority();
    const ensureLease = () => {
      host.ensureAuthority(current.authority);
      if (connection !== current || current.attempt !== attempt || current.lease !== lease || call <= clearedThrough) {
        throw refusal("E_CHANNEL_LEASE", "channel lease changed or the pending write was cleared");
      }
    };
    ensureLease();
    return host.trackWrite(async () => {
      const result = wireChannelWrite(await host.json(`/api/channel/${name}/${kind}`, {
        method: "POST", body: JSON.stringify({ args: requestArgs, lease: lease.token, version,
          ...(kind === "set" ? { value: submitted } : {}) }),
      }, authority, { terminalSession: "typed-result" }));
      if ("state" in result && isTerminalSession(result)) {
        const wasCurrent = host.authorityCurrent(authority);
        const expiration = await host.expireSession(authority);
        if (!wasCurrent || !host.expirationCurrent(expiration)) throw host.supersededRefusal();
        host.recordRefusal(copyRefusal(result));
      } else {
        ensureLease();
        if ("state" in result) host.recordRefusal(copyRefusal(result));
        else host.validated(authority);
      }
      return result;
    });
  }

  return {
    getSnapshot: () => state,
    set: value => write("set", value).catch(error => ({ state: "refused", ...toRefusal(error) })),
    clear: () => write("clear").catch(error => ({ state: "refused", ...toRefusal(error) })),
    subscribe: callback => {
      const owned = new Set<Waiter<Value>>();
      const notify = (snapshot: ChannelSnapshot<Value>) => callback(snapshot);
      let detached = false;
      listeners.add(notify);
      try { notify(state); } catch {}
      if (!closed && !failure) start();
      return {
        close: () => {
          if (detached) return;
          detached = true; listeners.delete(notify);
          for (const waiter of owned) {
            clearTimeout(waiter.timer); waiter.reject(refusal("E_CHANNEL_CLOSED", "channel observation closed"));
          }
          owned.clear();
        },
        until: (predicate, timeout) => detached
          ? Promise.reject(refusal("E_CHANNEL_CLOSED", "channel observation closed")) : until(predicate, timeout, owned),
      };
    },
    close: () => {
      if (closed) return;
      closed = true;
      const error = refusal("E_CHANNEL_CLOSED", "channel handle is closed");
      if (connection) terminal(connection, error);
      else { failure = error; rejectWaiters(error); publish({ status: "unavailable", reason: "closed", entries: [] }); }
    },
  };
}
