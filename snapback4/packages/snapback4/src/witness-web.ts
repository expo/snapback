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
    beginForm: (name: string | undefined, expected: Record<string, unknown> | undefined, button: Element) => {
      if (!app.client) throw Error("E_WITNESS_AUTH: no signed-in client");
      form?.cancel();
      const client = app.client, originalClient = client.mutate, originalApp = app.mutate;
      let click: Event | undefined, claimed = false, cancelObserver = () => {};
      const outsideClick = Symbol("witness outside clicked dispatch");
      let resolve!: (write: unknown) => void;
      const terminal = new Promise(answer => { resolve = answer; });
      // Chromium's active event ties admission to this actual control's handler.
      // Timers, input autosaves and previously-started writes cannot claim it.
      const capture = (event: Event) => { if (event.isTrusted && event.composedPath().includes(button)) click = event; };
      document.addEventListener("click", capture, true);
      const restore = () => {
        if (client.mutate === clientWrapper) client.mutate = originalClient;
        if (app.mutate === appWrapper) app.mutate = originalApp;
        document.removeEventListener("click", capture, true);
      };
      const canonical = (value: unknown): unknown => Array.isArray(value) ? value.map(canonical) : value && typeof value === "object"
        ? Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical((value as Record<string, unknown>)[key])])) : value;
      const execute = async (original: Function, receiver: unknown, op: Mutation<any, any>, args: Record<string, unknown>, options?: any): Promise<Write> => {
        const durable = operations.some(value => (value as Mutation<any, any>).name === op.name);
        const eligible = !claimed && !!click && window.event === click && !options?.[outsideClick] && durable && (!name || name === op.name);
        // An App call entered from a submit/other context must not borrow the
        // restored outer click when its readiness await reaches the Client.
        const forwarded = !eligible && receiver === app && durable ? { ...options, id: options?.id, waitSeconds: options?.waitSeconds, [outsideClick]: true } : options;
        const invoke = () => original.call(receiver, op, args, forwarded) as Promise<Write>;
        if (!eligible) return invoke();
        claimed = true; restore();
        if (expected && JSON.stringify(canonical(expected)) !== JSON.stringify(canonical(args))) {
          resolve({ state: "failed", why: { code: "E_WITNESS_ARGUMENT" } });
          return invoke();
        }
        let id: string | undefined, early: Write[] = [];
        const stop = client.onWrite(write => {
          if (id === undefined) { early.push(write); if (early.length > 256) early.shift(); }
          else if (write.id === id) { stop(); resolve({ ...write, mutation: op.name }); }
        });
        cancelObserver = stop;
        try {
          const write = await invoke();
          id = write.id;
          const receipt = write.state === "pending" ? early.find(value => value.id === id) : write;
          early = [];
          if (receipt) { stop(); resolve({ ...receipt, mutation: op.name }); }
          return write;
        } catch (error) { stop(); resolve({ state: "failed", why: { code: "E_WITNESS_WEB" } }); throw error; }
      };
      // Hooks submit through client; forms using app.mutate enter before its readiness await.
      const clientWrapper = ((op: Mutation<any, any>, args: Record<string, unknown>, options?: any) => execute(originalClient, client, op, args, options)) as typeof client.mutate;
      const appWrapper = ((op: Mutation<any, any>, args: Record<string, unknown>, options?: any) => execute(originalApp, app, op, args, options)) as typeof app.mutate;
      client.mutate = clientWrapper; app.mutate = appWrapper;
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
