import { DeliveryQueue, memoryDelivery } from "./delivery.ts";
import type { Refusal } from "./contract.ts";
import type { DeliveryRefused } from "./delivery-state.ts";

export function onlineDelivery(env: {
  url: string; fetch: typeof fetch; mint(): string;
  offline?(): void;
  ready(): boolean; current(): boolean;
  headers(): Record<string, string>; revision(): number;
  floor(): number; store(): string | undefined;
  observe(json: Record<string, unknown>, floor: number): void;
  obsolete(why: Refusal | undefined, revision: number): Promise<boolean>;
  refresh(): Promise<unknown> | null;
  onRefused?: ((event: DeliveryRefused) => void) | undefined;
}) {
  return new DeliveryQueue({ local: false, storage: memoryDelivery(), mint: env.mint,
    ready: env.ready, onOffline: () => env.offline?.(), onRefused: event => env.onRefused?.(event),
    send: async (mutation, body, signal) => {
      if (env.refresh()) await env.refresh();
      if (!env.ready() || signal.aborted) return { json: {}, accepted: false, deferred: true };
      const revision = env.revision(), floor = env.floor(), store = env.store();
      const response = await env.fetch(`${env.url}/m/${encodeURIComponent(mutation)}`, {
        method: "POST", headers: env.headers(), body: JSON.stringify({ ...body, store_id: store, retry_write: true }), signal,
      });
      const json = await response.json() as Record<string, unknown>;
      if (signal.aborted || !env.current()) throw new Error("obsolete delivery response");
      const why = (json.why ?? json.denied) as Refusal | undefined;
      // Missing heads are uncertain, never inferred from a receipt's historical seq.
      const validHead = Number.isSafeInteger(json.head) && Number(json.head) >= 0;
      env.observe(validHead ? json : { ...json, seq: undefined, head: undefined }, floor);
      if (!env.current()) return { json: { ...json, denied: { code: typeof json.store_id === "string" && store && json.store_id !== store ? "E_STORE_REPLACED" : "E_STORE_RESTORE" } }, accepted: false };
      if (why?.code === "E_AUTH") return { json, accepted: false, obsoleteAuth: await env.obsolete(why, revision) };
      return { json, accepted: validHead && typeof json.store_id === "string" && response.status < 500 };
    },
  });
}
