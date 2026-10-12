import { DeliveryQueue, type DeliveryStorage } from "./delivery.ts";
import { emptyDelivery, type DeliveryRefused, type DeliveryState } from "./delivery-state.ts";
import type { Refusal } from "./contract.ts";
import type { BackendJson } from "./backend.ts";
import type { StoreCapture } from "./local-types.ts";
import { mintId } from "./client.ts";

interface Environment {
  viewer: string; url: string; fetch: typeof fetch;
  call(request: Record<string, unknown>): Promise<{ ok?: unknown; denied?: Refusal }>;
  // A host without conditional commit may safely omit supplementary manifests.
  collect?: ((request: Record<string, unknown>, current: () => boolean) => Promise<{ ok?: unknown; denied?: Refusal }>) | undefined;
  backend(): BackendJson | null;
  offline?(): void;
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
    update: (edit, current) => serial(async () => {
      for (;;) {
        const read = await call({ action: "read" }) as { value: string };
        const state = read.value ? JSON.parse(read.value) as DeliveryState : emptyDelivery();
        const result = edit(state);
        const value = JSON.stringify(state);
        if (value === read.value || (current && !current())) return result;
        const request = { op: "delivery", viewer: env.viewer, action: "write", expected: read.value, value };
        if (current) {
          if (!env.collect) return result; // An unsupported host under-reports, never writes stale debt.
          const reply = await env.collect(request, current);
          if (reply.denied) throw new Error(reply.denied.code);
          if (reply.ok) return result;
        } else if (await call(request)) return result;
      }
    }),
    clear: () => serial(async () => { await call({ action: "clear" }); }),
  };
  const queue = new DeliveryQueue({ storage, local: true, mint: mintId,
    onOffline: () => env.offline?.(), onSettled: () => scheduleEnumeration(0),
    ready: () => enabled && !stopped && env.ready(), onRefused: event => env.onRefused?.(event),
    send: async (mutation, body, signal) => {
      if (env.refresh()) await env.refresh();
      const credentials = env.credentials(), capture = await env.capture();
      if (!capture || !env.ready() || !env.current() || signal.aborted || credentials.revision !== env.credentials().revision) return { json: {}, accepted: false, deferred: true };
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
  let enumerationDone = false, enumerationBackoff = 1000;
  function scheduleEnumeration(delay: number) {
    if (enumerationTimer || enumerationDone || stopped || !enabled) return;
    enumerationTimer = setTimeout(() => { enumerationTimer = undefined; void enumerate(); }, delay);
    (enumerationTimer as { unref?: () => void }).unref?.();
  }
  const enumerate = async () => {
    if (enumerating || enumerationDone || stopped || !enabled || !env.current() || !env.ready()) return;
    enumerating = true;
    try {
      // Startup witnessing and the ordinary outbox gate apply to scanning too.
      // Only startup debt holds the barrier. The device stops a later page
      // at capacity without advancing over or evicting uncollected rows.
      if (!await queue.flushed()) return;
      if (stopped || !env.current() || !env.ready()) return;
      const reply = await serial(() => stopped || !env.current() || !env.ready() ? Promise.resolve(undefined)
        : call({ action: "enumerate", now: env.now() })) as { more: boolean; blocked?: boolean } | undefined;
      if (!reply) return;
      enumerationDone = !reply.more;
      enumerationBackoff = 1000;
      queue.published();
      if (reply.more && !reply.blocked) scheduleEnumeration(0);
    } catch {
      // The device owns the durable raw cursor; a failed page resumes there.
      scheduleEnumeration(enumerationBackoff);
      enumerationBackoff = Math.min(60_000, enumerationBackoff * 2);
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
      scheduleEnumeration(0);
    })();
    try { await opening; } finally { opening = undefined; }
  };
  return {
    open,
    get enabled() { return enabled; },
    async accept(manifest: unknown, current: () => boolean = () => true) {
      if (!Array.isArray(manifest) || !manifest.length || stopped) return;
      await open(true); if (!stopped) await queue.accept(manifest, current);
    },
    published() { if (enabled) { queue.published(); scheduleEnumeration(0); } else void open().catch(() => {}); },
    available() { if (enabled) { queue.available(); scheduleEnumeration(0); } },
    reconnect() { if (enabled) { void queue.reconnect().catch(() => {}); scheduleEnumeration(0); } },
    fence(clear = false) { enumerationDone = false; if (enabled) void queue.reset(clear).catch(() => {}); },
    async stop() { stopped = true; if (enumerationTimer) clearTimeout(enumerationTimer); await queue.stop(); await tail; },
  };
}
