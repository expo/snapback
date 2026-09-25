import type { DeviceCore } from "./local-device.ts";
import type { Refusal } from "./contract.ts";
import { logoutEpoch, sessionEpoch } from "./app-storage.ts";

export interface AdmissionAuthority { key: string; epoch: string; principal: string }
export interface AdmissionAuthorityContext {
  capture(): AdmissionAuthority;
  // Ownership exists even when a wrapped/asynchronous store has no reader.
  read: ((key: string) => string | null) | undefined;
}
const plans = new WeakMap<object, AdmissionAuthorityContext>();
const hosts = new WeakMap<DeviceCore, (context: AdmissionAuthorityContext) => void>();
export const prepareAdmissionAuthority = (options: object, context: AdmissionAuthorityContext) => { plans.set(options, context); };
export const admissionAuthorityHost = (core: DeviceCore, configure: (context: AdmissionAuthorityContext) => void) => { hosts.set(core, configure); };
export const attachAdmissionAuthority = (core: DeviceCore, options: object) => {
  const context = plans.get(options);
  if (context) hosts.get(core)?.(context);
};

/** Call only while holding storeLock(stamp.key), through the admission commit.
 * A rotation may replace a bearer in the same epoch; logout/account changes
 * must not promote an older, as-yet-unadmitted journal record. */
export function sameAdmissionAuthority(stamp: AdmissionAuthority, context: AdmissionAuthorityContext, viewer: string): boolean {
  if (!context.read) return false;
  if (stamp.key !== context.capture().key || stamp.principal !== viewer) return false;
  const raw = context.read(stamp.key);
  if (!raw || logoutEpoch(raw) !== null) return false;
  let session: { principal?: unknown };
  try { session = JSON.parse(raw); } catch { return false; }
  const marker = context.read(stamp.key + ".epoch") ?? "0";
  const stored = sessionEpoch(raw) ?? "0";
  if (!/^(0|[1-9][0-9]*)$/.test(marker)) return false;
  const epoch = BigInt(marker) > BigInt(stored) ? marker : stored;
  return session?.principal === stamp.principal && epoch === stamp.epoch;
}
export const admissionAuthorityRefusal = (): Refusal => ({ code: "E_AUTH", family: "auth",
  message: "the session changed before this journaled write was admitted", site: "client.mutate",
  rewrite: "restore the current app session; submit again only if the write is still intended", guide: "writes" });
