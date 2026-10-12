import type { DeviceCore } from "./local-device.ts";
import type { Refusal } from "./contract.ts";
import { logoutEpoch, sessionEpoch, storeKey, StorageWarning } from "./app-storage.ts";
import { admissionRefusal, browserAdmission } from "./admission.ts";

export interface AdmissionAuthority { kind?: "persona"; key: string; epoch: string; principal: string; source?: string | undefined }
export interface AdmissionAuthorityContext {
  capture(): AdmissionAuthority;
  // Ownership exists even when a wrapped/asynchronous store has no reader.
  read: ((key: string) => Promise<string | null>) | undefined;
  // Schedule the app's locked check after an admission lock has released.
  recheck(): void;
}
const plans = new WeakMap<object, AdmissionAuthorityContext>();
// Enumerable capabilities survive device adapters that forward with {...core}.
export const admissionOwnership = Symbol("snapback4.admissionOwnership");
export const prepareAdmissionAuthority = (options: object, context: AdmissionAuthorityContext) => { plans.set(options, context); };
export const admissionAuthorityHost = (core: DeviceCore, configure: (context: AdmissionAuthorityContext) => void) => { core[admissionOwnership] = configure; };
export const attachAdmissionAuthority = (core: DeviceCore, options: object) => {
  const context = plans.get(options);
  if (!context) return;
  const configure = core[admissionOwnership];
  if (configure) configure(context);
  else if (browserAdmission()) throw new StorageWarning(admissionRefusal("app device ownership is unavailable", "createApp.device.open",
    "forward every webDevice capability with { ...core } before overriding methods"));
};

/** Call only while holding storeLock(stamp.key), through the admission commit.
 * A rotation may replace a bearer in the same epoch; logout/account changes
 * must not promote an older, as-yet-unadmitted journal record. */
export async function sameAdmissionAuthority(stamp: AdmissionAuthority, context: AdmissionAuthorityContext, viewer: string): Promise<boolean> {
  const current = context.capture();
  if (!stamp.source || stamp.source !== current.source || stamp.key !== current.key || stamp.principal !== viewer) return false;
  // @ref LLP 3000.013.000#17 — personas have principal custody, no session epoch.
  if (stamp.kind === "persona" || current.kind === "persona") return stamp.kind === "persona" && current.kind === "persona"
    && stamp.principal === current.principal && stamp.epoch === "0" && current.epoch === "0";
  if (!context.read) return false;
  const raw = await context.read(stamp.key);
  if (!raw || logoutEpoch(raw) !== null) return false;
  let session: { principal?: unknown };
  try { session = JSON.parse(raw); } catch { return false; }
  const marker = await context.read(stamp.key + ".epoch") ?? "0";
  const stored = sessionEpoch(raw) ?? "0";
  if (!/^(0|[1-9][0-9]*)$/.test(marker)) return false;
  const epoch = BigInt(marker) > BigInt(stored) ? marker : stored;
  return session?.principal === stamp.principal && epoch === stamp.epoch;
}
export const admissionAuthorityRefusal = (): Refusal => ({ code: "E_AUTH", family: "auth",
  message: "the session changed before this journaled write was admitted", site: "client.mutate",
  rewrite: "restore the current app session; submit again only if the write is still intended", guide: "writes" });

/** Stable dev principal scope, disjoint from every session authority source. */
export function personaAdmissionAuthority(url: string, principal: string, source: string): AdmissionAuthorityContext {
  const stamp: AdmissionAuthority = { kind: "persona", key: storeKey("session", url, principal) + ".persona",
    epoch: "0", principal, source: "persona:" + source };
  return { capture: () => stamp, read: undefined, recheck() {} };
}
