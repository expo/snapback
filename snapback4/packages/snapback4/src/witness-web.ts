// @ref LLP 3000.011.003.000#8 — a browser proof calls the app's own authenticated client.
import type { App } from "./app.js";
import type { Mutation, Write } from "./contract.js";

type Operations = Record<string, unknown>;
export function registerWebWitness(app: App, api: Operations): void {
  if (typeof window === "undefined" || typeof window.location?.search !== "string") return;
  const enabled = new URLSearchParams(window.location.search).get("witness") === "web";
  const armed = () => { if (!enabled) throw Error("E_WITNESS_DISABLED: add &witness=web"); };
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
    beginForm: (name: string | undefined, expected: Record<string, unknown> | null | undefined, button: Element) => {
      armed();
      if (!app.client) throw Error("E_WITNESS_AUTH: no signed-in client");
      form?.cancel();
      const client = app.client, originalClient = client.mutate, originalApp = app.mutate;
      let click: Event | undefined, submit: Event | undefined, clickTimer: ReturnType<typeof setTimeout> | undefined, claimed = false, cancelObserver = () => {};
      const outsideClick = Symbol("witness outside clicked dispatch");
      let resolve!: (write: unknown) => void;
      const terminal = new Promise(answer => { resolve = answer; });
      let settled = false, noWriteTimer: ReturnType<typeof setTimeout> | undefined;
      const noWrite = () => finish({ state: "failed", mutation: name, why: { code: "E_WITNESS_NO_WRITE", message: "armed click produced no durable mutation (form handler returned early, or the app was not ready)" } });
      const finish = (write: unknown) => {
        if (settled) return;
        settled = true; clearTimeout(expiry); clearTimeout(noWriteTimer); restore(); cancelObserver(); resolve(write);
      };
      // Bound even an abandoned arm or a claimed write that never settles.
      const receiptExpired = () => finish({ state: "failed", mutation: name, why: { code: "E_WITNESS_SENT", message: "claimed write did not settle within 30000 ms; inspect its original intent id" } });
      let expiry = setTimeout(noWrite, 30_000);
      // Chromium's active event ties admission to this actual control's handler.
      // Timers, input autosaves and previously-started writes cannot claim it.
      const capture = (event: Event) => {
        if (!event.isTrusted) { click = undefined; submit = undefined; clearTimeout(clickTimer); return; }
        if (event.isTrusted && event.composedPath().includes(button)) {
          click = event; submit = undefined;
          clearTimeout(noWriteTimer);
          noWriteTimer = setTimeout(() => { if (!claimed) noWrite(); }, 1000);
          clearTimeout(clickTimer);
          clickTimer = setTimeout(() => { click = undefined; submit = undefined; }, 0);
        }
      };
      const captureSubmit = (event: Event) => {
        if (click && event.isTrusted && (event as SubmitEvent).submitter === button) submit = event;
      };
      document.addEventListener("click", capture, true);
      document.addEventListener("submit", captureSubmit, true);
      const restore = () => {
        if (client.mutate === clientWrapper) client.mutate = originalClient;
        if (app.mutate === appWrapper) app.mutate = originalApp;
        document.removeEventListener("click", capture, true);
        document.removeEventListener("submit", captureSubmit, true); clearTimeout(clickTimer);
      };
      const canonical = (value: unknown): unknown => Array.isArray(value) ? value.map(canonical) : value && typeof value === "object"
        ? Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical((value as Record<string, unknown>)[key])])) : value;
      const execute = async (original: Function, receiver: unknown, op: Mutation<any, any>, args: Record<string, unknown>, options?: any): Promise<Write> => {
        const durable = operations.some(value => (value as Mutation<any, any>).name === op.name);
        const eventMatches = !!click && (window.event === click || (!!submit && window.event === submit));
        const argsMatch = expected == null || JSON.stringify(canonical(expected)) === JSON.stringify(canonical(args));
        const eligible = !claimed && eventMatches && !options?.[outsideClick] && durable && (!name || name === op.name) && argsMatch;
        let forwarded = options;
        if (!eligible && receiver === app && durable) {
          const { id, waitSeconds, ...other } = options ?? {};
          forwarded = { ...other, id, waitSeconds, [outsideClick]: true };
        }
        const invoke = () => original.call(receiver, op, args, forwarded) as Promise<Write>;
        if (!eligible) {
          if (!claimed && durable) {
            claimed = true; restore();
            const reason = !eventMatches || options?.[outsideClick] ? "event: expected the armed click or its synchronous submit"
              : name && name !== op.name ? `operation: expected ${name}, got ${op.name}`
              : `arguments: expected ${JSON.stringify(canonical(expected))}, got ${JSON.stringify(canonical(args))}`;
            finish({ state: "failed", mutation: op.name, why: { code: "E_WITNESS_UNCLAIMED", message: reason } });
          }
          return invoke();
        }
        claimed = true; restore(); clearTimeout(expiry); clearTimeout(noWriteTimer);
        // A late click receives its own complete settlement allowance.
        expiry = setTimeout(receiptExpired, 30_000);
        let id: string | undefined, early: Write[] = [];
        const stop = client.onWrite(write => {
          // Native clients publish terminal receipts; foreign adapters must not
          // turn a pending notification into terminal proof evidence either.
          if ((write as Write).state === "pending") return;
          if (id === undefined) { early.push(write); if (early.length > 256) early.shift(); }
          else if (write.id === id) { stop(); finish({ ...write, mutation: op.name }); }
        });
        cancelObserver = stop;
        try {
          const write = await invoke();
          id = write.id;
          const receipt = write.state === "pending" ? early.find(value => value.id === id && value.state !== "pending") : write;
          early = [];
          if (receipt) { stop(); finish({ ...receipt, mutation: op.name }); }
          return write;
        } catch (error) { stop(); finish({ state: "failed", why: { code: "E_WITNESS_WEB" } }); throw error; }
      };
      // Hooks submit through client; forms using app.mutate enter before its readiness await.
      const clientWrapper = ((op: Mutation<any, any>, args: Record<string, unknown>, options?: any) => execute(originalClient, client, op, args, options)) as typeof client.mutate;
      const appWrapper = ((op: Mutation<any, any>, args: Record<string, unknown>, options?: any) => execute(originalApp, app, op, args, options)) as typeof app.mutate;
      client.mutate = clientWrapper; app.mutate = appWrapper;
      form = { terminal, cancel: () => { if (!claimed) noWrite(); else finish({ state: "failed", mutation: name, why: { code: "E_WITNESS_UNCLAIMED", message: "rearmed before the claimed write settled; inspect its original intent id" } }); } };
    },
    formResult: () => form?.terminal,
    mutate: async (name: string | undefined, args: Record<string, unknown>, id: string) => {
      armed();
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
