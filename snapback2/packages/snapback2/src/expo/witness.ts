// @ref LLP 1013#7-the-simulator-witness — the app connects outward before construction.
import type { SnapbackClient } from "../types.js";
import type { PersistedRangeState } from "../store/range-store.js";
import type { ByteCache, ByteDelta } from "../store/byte-cache.js";
import { isRefusalError } from "../client-wire.js";
import { runSqliteDriverConformance as conformance } from "../store/sqlite-driver.conformance.js";
import type { SqliteDriver } from "../store/sqlite-driver.js";
import { SearchExecution } from "../../../evaluator/src/search-runtime.js";
import { SEARCH_CONTRACT, searchQueryToken } from "../../../evaluator/src/unicode.js";
import { asString, field, wireJson } from "../../../evaluator/src/value-runtime.js";

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
/** Witness-only view of held global-search normalization, directory selection, and postings. */
export function witnessSearchProbe(client: SnapbackClient, terms: string[]): unknown {
  const indexed = (client as any).offlineRuntime?.twin?.indexed;
  const store = indexed?.store;
  if (!store) return { state: "unhydrated" };
  const index = store.index("messages", "bySearch");
  const entry = [...store.directories.entries()].find(([descriptor]: [any, unknown]) =>
    descriptor.table === "messages" && descriptor.index === "bySearch");
  const selected = (entry?.[1] as any)?.select([], 50);
  const heldScopes = [...index.scopes.seek(() => 0)] as Array<[any[], Set<any>]>;
  const scopes = heldScopes.map(([scope, rows]) => ({
    scope: scope.map(wireJson), ids: [...rows].map(row => asString(field(row, "id"))),
  }));
  const postings = Object.fromEntries(terms.map(term => [term, {
    token: searchQueryToken(term, 128),
    scopes: heldScopes.map(([scope]) => ({ scope: scope.map(wireJson), ids: [...index.scan({
      prefix: [...scope.map(value => ({ Scalar: value })), new SearchExecution().atom(index.parts[index.derived], {
        WordPrefix: { source: term, contract: SEARCH_CONTRACT },
      }, 128)], after: null, before: null, range: null, order: "Desc",
    })].map(row => asString(field(row, "id"))) })),
  }]));
  return { selected: selected && { ...selected, scopes: selected.scopes.map((scope: any[]) => scope.map(wireJson)) }, scopes, postings,
    runtime: { typedArrayFromSet: [...Uint32Array.from(new Set([3, 5]) as any)] } };
}
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
        let phase = "decode command";
        try {
          const request = JSON.parse(String(message.data));
          id = request.id;
          if (typeof request.verb !== "string") throw new TypeError("witness command needs a verb");
          phase = `command:${request.verb}`;
          const result = await run(request.verb, request.args ?? {});
          send({ id, ok: true, result });
        } catch (error) {
          const details = isRefusalError(error) ? error.envelope : { message: String(error) };
          send({ id, ok: false, error: { ...details, phase,
            stack: error instanceof Error ? error.stack : undefined } });
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
