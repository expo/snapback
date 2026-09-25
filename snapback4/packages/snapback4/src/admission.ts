import type { Refusal, Write } from "./contract.ts";
import type { DeviceCore } from "./local-device.ts";
import type { SessionStore } from "./auth.ts";

/** Internal synchronous web admission boundary. Native hosts still commit
 * through their normal async call. No transport runs before that commit. */
const hosts = new WeakMap<DeviceCore, (request: Record<string, unknown>) => Refusal | undefined>();
export const admissionHost = (core: DeviceCore, capture: (request: Record<string, unknown>) => Refusal | undefined) => { hosts.set(core, capture); };
export const admitNow = (core: DeviceCore, request: Record<string, unknown>) => {
  const capture = hosts.get(core);
  return capture ? capture(request) : browserAdmission() ? admissionRefusal("the device has no synchronous admission journal", "client.mutate", "open a webDevice() with an exclusive persistence claim before writing") : undefined;
};
export const browserAdmission = () => typeof window !== "undefined" && typeof window.location !== "undefined";
export function admissionRefusal(message: string, site = "client.mutate", rewrite = "wait for app.ready and client.acquired, restore writable localStorage, then retry with the same id"): Refusal {
  return { code: "E_ADMISSION", family: "store", message, site, rewrite, guide: "writes" };
}
/** A fulfilled failed promise also exposes its refusal in the calling stack.
 * Awaiting it remains the existing Write API. It has admitted no new intent. */
export function failedAdmission<R>(id: string, why: Refusal): Promise<Write<R>> & Extract<Write<R>, { state: "failed" }> {
  const write = { state: "failed" as const, id: typeof id === "string" ? id : "", why };
  return Object.assign(Promise.resolve(write), write);
}
const readers = new WeakMap<SessionStore, (key: string) => string | null>();
export function synchronousSessionStore(store: SessionStore, read: (key: string) => string | null): SessionStore { readers.set(store, read); return store; }
export const sessionReader = (store: SessionStore) => readers.get(store);
