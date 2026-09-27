import { DeliveryQueue, type DeliveryStorage } from "./delivery.ts";
import { emptyDelivery, type DeliveryRefused, type DeliveryState } from "./delivery-state.ts";
import type { Refusal } from "./contract.ts";
import type { BackendJson } from "./backend.ts";
import type { StoreCapture } from "./local-types.ts";
import { mintId } from "./client.ts";

interface Environment {
  viewer: string; url: string; fetch: typeof fetch;
  call(request: Record<string, unknown>): Promise<{ ok?: unknown; denied?: Refusal }>;
  backend(): BackendJson | null;
  ready(): boolean;
  current(): boolean;
  credentials(): { headers: Record<string, string>; revision: number };
  refresh(): Promise<unknown> | null;
  capture(): Promise<StoreCapture | undefined>;
  witness(id: unknown, head: unknown, capture: StoreCapture): Promise<boolean>;
  restored(): boolean;
  replaced(): void;
  auth(why: unknown, revision: number): Promise<unknown>;
  onRefused?: ((event: DeliveryRefused) => void) | undefined;
  now(): number;
}

// @ref LLP 3000.022#3 — CAS preserves debt arriving in another publication/host transaction.
export function localDelivery(env: Environment) {
  let tail: Promise<unknown> = Promise.resolve();
  let enabled = false, opening: Promise<void> | undefined, enumerating = false, stopped = false;
  let enumerationTimer: ReturnType<typeof setTimeout> | undefined;
  const call = async (request: Record<string, unknown>) => {
    const result = await env.call({ op: "delivery", viewer: env.viewer, ...request });
    if (result.denied) throw new Error(`${result.denied.code}: ${result.denied.message}`);
    return result.ok;
  };
  const serial = <T>(body: () => Promise<T>): Promise<T> => {
    const work = tail.then(body); tail = work.catch(() => {}); return work;
  };
  const storage: DeliveryStorage = {
    update: edit => serial(async () => {
      for (;;) {
        const read = await call({ action: "read" }) as { value: string };
        const state = read.value ? JSON.parse(read.value) as DeliveryState : emptyDelivery();
        const result = edit(state);
        if (await call({ action: "write", expected: read.value, value: JSON.stringify(state) })) return result;
      }
    }),
    clear: () => serial(async () => { await call({ action: "clear" }); }),
  };
  const queue = new DeliveryQueue({ storage, local: true, mint: mintId,
    ready: () => enabled && !stopped && env.ready(), onRefused: event => env.onRefused?.(event),
    send: async (mutation, body, signal) => {
      if (env.refresh()) await env.refresh();
      const credentials = env.credentials(), capture = await env.capture();
      if (!capture || !env.ready() || signal.aborted || credentials.revision !== env.credentials().revision) return { json: {}, accepted: false, deferred: true };
      const id = capture.transfer_store_id ?? capture.store_id;
      if (!id) throw new Error("delivery needs an observed store identity");
      const response = await env.fetch(`${env.url}/m/${encodeURIComponent(mutation)}`, { method: "POST", headers: credentials.headers, body: JSON.stringify({ ...body, store_id: id }), signal });
      const json = await response.json() as Record<string, unknown>;
      if (signal.aborted || !env.current()) throw new Error("obsolete delivery response");
      const why = (json.why ?? json.denied) as Refusal | undefined;
      if (typeof json.store_id === "string" && json.store_id !== id || why?.code === "E_STORE_REPLACED") {
        env.replaced();
        return { json: { ...json, denied: { code: "E_STORE_REPLACED" } }, accepted: false };
      }
      const validHead = Number.isSafeInteger(json.head) && Number(json.head) >= 0;
      const refused = validHead && await env.witness(json.store_id, json.head, capture);
      if (refused) return { json: env.restored() ? { ...json, denied: { code: "E_STORE_RESTORE" } } : {}, accepted: false };
      if (why?.code === "E_AUTH") {
        if (env.refresh()) await env.refresh();
        const obsoleteAuth = credentials.revision !== env.credentials().revision && env.current();
        if (!obsoleteAuth) await env.auth(why, credentials.revision);
        return { json, accepted: false, obsoleteAuth };
      }
      return { json, accepted: validHead && json.store_id === id && response.status < 500 };
    },
  });
  const enumerate = async () => {
    if (enumerating || stopped || !enabled || !env.current()) return;
    enumerating = true;
    try {
      const reply = await serial(() => call({ action: "enumerate", now: env.now() })) as { more: boolean };
      queue.published();
      if (reply.more && !stopped) {
        enumerationTimer = setTimeout(() => { void enumerate().catch(() => {}); }, 0);
        (enumerationTimer as { unref?: () => void }).unref?.();
      }
    } finally { enumerating = false; }
  };
  const open = async (force = false) => {
    if (enabled || stopped) return;
    if (opening) return opening;
    opening = (async () => {
      const active = force || !!env.backend()?.schema.delivery?.length || (await env.call({ op: "meta", key: "delivery-active" })).ok === "1";
      if (!active || stopped) return;
      await call({ action: "read" }); // Register viewer before any subsequent publication.
      await env.call({ op: "set_meta", key: "delivery-active", value: "1" });
      enabled = true;
      await queue.start(); // Persisted attempts precede bounded activation pages.
      void enumerate().catch(() => {});
    })();
    try { await opening; } finally { opening = undefined; }
  };
  return {
    open,
    get enabled() { return enabled; },
    async accept(manifest: unknown) {
      if (!Array.isArray(manifest) || !manifest.length || stopped) return;
      await open(true); if (!stopped) await queue.accept(manifest);
    },
    published() { if (enabled) queue.published(); else void open().catch(() => {}); },
    available() { if (enabled) queue.available(); },
    reconnect() { if (enabled) void queue.reconnect().catch(() => {}); },
    fence(clear = false) { if (enabled) void queue.reset(clear).catch(() => {}); },
    async stop() { stopped = true; if (enumerationTimer) clearTimeout(enumerationTimer); await queue.stop(); await tail; },
  };
}
