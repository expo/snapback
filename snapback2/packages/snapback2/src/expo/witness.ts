import { twinLastDecline } from "../twin.js";
// @ref LLP 1013#7-the-simulator-witness — the app connects outward before construction.
import type { SnapbackClient } from "../types.js";
import type { PersistedRangeState } from "../store/range-store.js";
import type { ByteCache, ByteDelta } from "../store/byte-cache.js";
import { isSnapbackRefusal } from "../client.js";
import { runSqliteDriverConformance as conformance } from "../../tests/sqlite-driver.conformance.js";
import type { SqliteDriver } from "../store/sqlite-driver.js";

export interface WitnessHooks {
  beforeCommit(state: PersistedRangeState, bytes: ByteDelta): Promise<void>;
  emit(event: string, value?: unknown): void;
}
export interface WitnessApplication {
  construct(hooks: WitnessHooks, args: Record<string, unknown>): Promise<SnapbackClient>;
  /** Persist transport/fault configuration outside the range store, before acknowledging. */
  persist?(change: { offline?: boolean; fault?: "carrier" | "none" }): Promise<void>;
  command?(client: SnapbackClient | undefined, verb: string, args: Record<string, unknown>, hooks: WitnessHooks): Promise<unknown>;
}
export interface WitnessControl { close(): void }

/** The factory overload connects before any carrier opens; the client overload attaches to an existing client. */
export { twinLastDecline };
export function witnessControl(source: SnapbackClient | WitnessApplication, url: string): WitnessControl {
  if (!/^wss?:\/\//.test(url)) throw new TypeError("witness URL must be ws:// or wss://");
  const app = "construct" in source ? source : undefined;
  let client = app ? undefined : source as SnapbackClient;
  let closed = false;
  let socket: WebSocket;
  let retry: ReturnType<typeof setTimeout> | undefined;
  let barrier = false;
  const releases = new Set<() => void>();
  const send = (value: unknown) => { if (socket?.readyState === 1) socket.send(JSON.stringify(value)); };
  const hooks: WitnessHooks = {
    emit: (event, value) => send({ event, value }),
    async beforeCommit() {
      if (!barrier) return;
      // Install the release before the acknowledgement. Neither socket.close nor
      // control.close resolves or rejects it: only barrier(off) can allow COMMIT.
      const held = new Promise<void>((resolve) => { releases.add(resolve); });
      hooks.emit("barrier reached");
      await held;
    },
  };
  const construct = async (args: Record<string, unknown>) => {
    if (app) client = await app.construct(hooks, args);
    if (!client) throw new Error("construct did not return a client");
    await client.ready;
    return { constructed: true, snapshot: client.snapshot };
  };
  const run = async (verb: string, args: Record<string, unknown>) => {
    if (verb === "barrier") {
      if (args.mode !== "on" && args.mode !== "off") throw new TypeError("barrier mode must be on or off");
      barrier = args.mode === "on";
      if (!barrier) { for (const release of releases) release(); releases.clear(); }
      return { barrier: args.mode };
    }
    if (verb === "fault") {
      if (args.mode !== "carrier" && args.mode !== "none") throw new TypeError("fault mode must be carrier or none");
      if (!app?.persist) throw new Error("witness application must persist carrier faults");
      await app.persist({ fault: args.mode });
      return { fault: args.mode };
    }
    if (verb === "construct") return construct(args);
    if (verb === "login") return construct(args);
    if (verb === "offline" || verb === "online") {
      if (!client) throw new Error("construct first");
      await app?.persist?.({ offline: verb === "offline" });
      await client[verb]();
      return { connection: client.snapshot.connection };
    }
    if (app?.command) return app.command(client, verb, args, hooks);
    if (verb === "state" && client) return { snapshot: client.snapshot, outbox: await client.outbox.entries(),
      coverage: await (client.assetCache as ByteCache | undefined)?.store.coverage() };
    throw new Error(`unsupported witness verb ${verb}`);
  };
  const connect = () => {
    if (closed) return;
    socket = new WebSocket(url);
    socket.onopen = () => hooks.emit("connected", { constructed: client !== undefined });
    socket.onmessage = (message) => {
      // Commands are independent so barrier(off) can release a suspended swap.
      void (async () => {
        let id: unknown;
        try {
          const request = JSON.parse(String(message.data));
          id = request.id;
          if (typeof request.verb !== "string") throw new TypeError("witness command needs a verb");
          const result = await run(request.verb, request.args ?? {});
          send({ id, ok: true, result });
        } catch (error) {
          send({ id, ok: false, error: isSnapbackRefusal(error) ? error.envelope : { message: String(error), stack: error instanceof Error ? error.stack : undefined } });
        }
      })();
    };
    socket.onerror = () => {}; // close schedules reconnect; it never releases the barrier.
    socket.onclose = () => { if (!closed) retry = setTimeout(connect, 250); };
  };
  connect();
  return { close() { closed = true; clearTimeout(retry); socket.close(); } };
}
export function runSqliteDriverConformance(open: () => SqliteDriver | Promise<SqliteDriver>): Promise<{ journalMode: string; checks: string[] }> {
  return conformance(open);
}
