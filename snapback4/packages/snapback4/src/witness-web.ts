// @ref LLP 3000.011.003.000#8 — a browser proof calls the app's own authenticated client.
import type { App } from "./app.js";
import type { Mutation, Write } from "./contract.js";

type Operations = Record<string, unknown>;
export function registerWebWitness(app: App, api: Operations): void {
  if (typeof window === "undefined" || new URLSearchParams(window.location.search).get("witness") !== "web") return;
  const operations: unknown[] = [];
  const walk = (value: Operations) => { for (const entry of Object.values(value)) {
    if (entry && typeof entry === "object") {
      if ("kind" in entry && entry.kind === "mutation" && !("ephemeral" in entry && entry.ephemeral === true)) operations.push(entry);
      else if (!("kind" in entry)) walk(entry as Operations);
    }
  } };
  walk(api);
  let form: { terminal: Promise<unknown>; cancel: () => void } | undefined;
  Object.defineProperty(window, "__snapback4Witness", { configurable: true, value: {
    ready: () => app.ready,
    viewer: () => app.client?.viewer(),
    beginForm: (name: string | undefined, expected?: Record<string, unknown>) => {
      if (!app.client) throw Error("E_WITNESS_AUTH: no signed-in client");
      form?.cancel();
      const client = app.client, original = client.mutate;
      let cancelObserver = () => {};
      let claimed = false;
      let resolve!: (write: unknown) => void;
      const terminal = new Promise(answer => { resolve = answer; });
      const restore = () => { if (client.mutate === instrumented) client.mutate = original; };
      const canonical = (value: unknown): unknown => Array.isArray(value) ? value.map(canonical) : value && typeof value === "object"
        ? Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical((value as Record<string, unknown>)[key])])) : value;
      const instrumented = async (op: Mutation<any, any>, args: Record<string, unknown>, options?: any) => {
        if (claimed || !operations.some(value => (value as Mutation<any, any>).name === op.name) || (name && name !== op.name)) return original.call(client, op, args, options);
        claimed = true; restore();
        if (expected && JSON.stringify(canonical(expected)) !== JSON.stringify(canonical(args))) {
          resolve({ state: "failed", why: { code: "E_WITNESS_ARGUMENT" } });
          return original.call(client, op, args, options);
        }
        let id: string | undefined, early: Write[] = [];
        const stop = client.onWrite(write => {
          if (id === undefined) { early.push(write); if (early.length > 256) early.shift(); }
          else if (write.id === id) { stop(); resolve({ ...write, mutation: op.name }); }
        });
        cancelObserver = stop;
        try {
          const write = await original.call(client, op, args, options);
          id = write.id;
          const receipt = write.state === "pending" ? early.find(value => value.id === id) : write;
          early = [];
          if (receipt) { stop(); resolve({ ...receipt, mutation: op.name }); }
          return write;
        } catch (error) { stop(); resolve({ state: "failed", why: { code: "E_WITNESS_WEB" } }); throw error; }
      };
      client.mutate = instrumented as typeof client.mutate;
      form = { terminal, cancel: () => { restore(); cancelObserver(); } };
    },
    formResult: () => form?.terminal,
    mutate: async (name: string | undefined, args: Record<string, unknown>, id: string) => {
      const operation = operations.find(value => !name || (value as { name: string }).name === name);
      if (!operation) throw Error("E_WITNESS_MUTATION: no matching durable mutation; pass --mutation with a generated API name (ephemeral signals do not prove stored writes)");
      if (!app.client) throw Error("E_WITNESS_AUTH: the app has no signed-in client");
      let observed: unknown;
      let settle: ((write: unknown) => void) | undefined;
      const stop = app.client.onWrite(write => { if (write.id === id) { observed = write; settle?.(write); } });
      try {
        const write = await app.mutate(operation as Mutation<any, any>, args, { id, waitSeconds: 0 });
        if (write.state !== "pending") return write;
        return observed ?? await new Promise(resolve => { settle = resolve; });
      } finally { stop(); }
    },
  } });
}
