// @ref LLP 3000.011.003.000#8 — a browser proof calls the app's own authenticated client.
import type { App } from "./app.js";
import type { Mutation, Write } from "./contract.js";

type Operations = Record<string, unknown>;
export function registerWebWitness(app: App, api: Operations): void {
  if (typeof window === "undefined" || typeof window.location?.search !== "string") return;
  const enabled = new URLSearchParams(window.location.search).get("witness") === "web";
  const armed = () => { if (!enabled) throw Object.assign(Error("E_WITNESS_DISABLED: add &witness=web"), { code: "E_WITNESS_DISABLED" }); };
  const operations: unknown[] = [];
  const walk = (value: Operations) => { for (const entry of Object.values(value)) {
    if (entry && typeof entry === "object") {
      if ("kind" in entry && entry.kind === "mutation" && !("ephemeral" in entry && entry.ephemeral === true)) operations.push(entry);
      else if (!("kind" in entry)) walk(entry as Operations);
    }
  } };
  walk(api);
  let ready = false;
  void app.ready.then(result => { ready = result.ok; }, () => {});
  let form: { terminal: Promise<unknown>; cancel: () => void; claimHandler: (owner: App, event: Event) => { mutate: App["mutate"]; done: () => void } | undefined } | undefined;
  Object.defineProperty(window, "__snapback4Witness", { configurable: true, value: {
    ready: () => app.ready,
    viewer: () => app.client?.viewer(),
    beginForm: (name: string | undefined, expected: Record<string, unknown> | null | undefined, button: Element) => {
      armed();
      if (!app.client) throw Error("E_WITNESS_AUTH: no signed-in client");
      form?.cancel();
      const client = app.client, originalClient = client.mutate, originalApp = app.mutate;
      let click: Event | undefined, submit: Event | undefined, clickTimer: ReturnType<typeof setTimeout> | undefined, claimed = false, cancelObserver = () => {};
      let clickedReady = false, handlerClaimed = false;
      const handlerToken = Symbol("witness handler claim");
      const outsideClick = Symbol("witness outside clicked dispatch");
      let resolve!: (write: unknown) => void;
      const terminal = new Promise(answer => { resolve = answer; });
      let settled = false, noWriteTimer: ReturnType<typeof setTimeout> | undefined;
      const noWrite = () => finish({ state: "failed", mutation: name, why: { code: "E_WITNESS_NO_WRITE", reason: clickedReady ? "returned-early" : "not-ready", message: "armed click produced no durable mutation (form handler returned early, or the app was not ready)" } });
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
          click = event; submit = undefined; clickedReady = ready;
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
        const eventMatches = !!click && (window.event === click || (!!submit && window.event === submit))
          || handlerClaimed && options?.[handlerToken] === true;
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
              : "arguments: durable mutation arguments did not match the armed form";
            finish({ state: "failed", mutation: op.name, why: { code: "E_WITNESS_UNCLAIMED", reason: !eventMatches || options?.[outsideClick] ? "event" : "arguments", message: reason } });
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

      const claimHandler = (owner: App, event: Event) => {
        if (owner !== app || handlerClaimed || claimed || settled || !event.isTrusted
          || !(click && event === click && window.event === click || submit && event === submit && window.event === submit)) return undefined;
        handlerClaimed = true; clearTimeout(noWriteTimer);
        return {
          mutate: ((op: Mutation<any, any>, args: Record<string, unknown>, options?: any) =>
            app.mutate(op, args, { ...options, [handlerToken]: true })) as App["mutate"],
          done: () => { if (!claimed) noWrite(); },
        };
      };
      form = { terminal, claimHandler, cancel: () => { if (!claimed) noWrite(); else finish({ state: "failed", mutation: name, why: { code: "E_WITNESS_UNCLAIMED", reason: "event", message: "rearmed before the claimed write settled; inspect its original intent id" } }); } };
    },
    claimHandler: (owner: App, event: Event) => form?.claimHandler(owner, event),
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

/** Run an event handler with an explicit write claim that survives awaited uploads.
 * Call synchronously from the clicked control. Use the supplied mutate inside
 * the callback; it carries only that arm's token, never another handler's writes.
 */
export async function witnessForm<T>(app: App, event: Event | { nativeEvent: Event }, handler: (mutate: App["mutate"]) => Promise<T>): Promise<T> {
  const native = "nativeEvent" in event ? event.nativeEvent : event;
  const bridge = typeof window === "undefined" ? undefined : (window as unknown as { __snapback4Witness?: {
    claimHandler(owner: App, event: Event): { mutate: App["mutate"]; done(): void } | undefined;
  } }).__snapback4Witness;
  const claim = bridge?.claimHandler(app, native);
  try { return await handler(claim?.mutate ?? app.mutate.bind(app)); }
  finally { claim?.done(); }
}
